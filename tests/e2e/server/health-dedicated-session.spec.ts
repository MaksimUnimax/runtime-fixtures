import { expect, test } from "@playwright/test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChromeBrowserDriver,
  createControlledTargetRegistry,
  createDedicatedHealthChromeBrowserDriver,
  loadDedicatedHealthSessionRegistry,
} from "@product/health-runner";

const COOKIE_NAME = "synthetic_health_cookie";
const COOKIE_VALUE = "synthetic-health-only";

type Fixture = Readonly<{
  origin: string;
  requests: () => readonly Readonly<{ path: string; cookie: string }>[];
  close: () => Promise<void>;
}>;

async function startFixture(): Promise<Fixture> {
  const requests: Array<{ path: string; cookie: string }> = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push({
      path,
      cookie: request.headers.cookie ?? "",
    });
    if (path === "/redirect") {
      response.writeHead(302, { location: "https://example.invalid/blocked" });
      response.end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html" })
      .end("<!doctype html><title>synthetic health fixture</title>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("HEALTH_DEDICATED_LOOPBACK_ADDRESS_UNAVAILABLE");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests: () => requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function withSyntheticState(
  callback: (statePath: string, configPath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "health-dedicated-e2e-"));
  const statePath = join(directory, "dedicated-state.json");
  const configPath = join(directory, "config.json");
  const stateContents = JSON.stringify({
    cookies: [
      {
        domain: "127.0.0.1",
        expires: -1,
        httpOnly: false,
        name: COOKIE_NAME,
        path: "/",
        sameSite: "Lax",
        secure: false,
        value: COOKIE_VALUE,
      },
    ],
    origins: [],
  });
  await writeFile(statePath, stateContents, { mode: 0o600 });
  await chmod(statePath, 0o600);
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      targets: { chatgpt_standard_health: { storageStatePath: statePath } },
    }),
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600);
  try {
    await callback(statePath, configPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function targets(origin: string, startPath = "/standard-start") {
  return createControlledTargetRegistry([
    {
      key: "chatgpt_standard_health",
      startUrl: `${origin}${startPath}`,
      allowedTopLevelOrigins: [origin],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
    {
      key: "chatgpt_work_health",
      startUrl: `${origin}/work-start`,
      allowedTopLevelOrigins: [origin],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
  ]);
}

type DedicatedFactory = (
  targets: ReturnType<typeof targets>,
  registry: unknown,
  targetKey: string,
) => ChromeBrowserDriver;

test.describe("Standard dedicated Health session capability", () => {
  test("DS-03/04/05/06/07/09/13/14 consumes synthetic state in fresh contexts without writeback", async () => {
    const fixture = await startFixture();
    try {
      await withSyntheticState(async (statePath, configPath) => {
        const stateBefore = await readFile(statePath, "utf8");
        const registry = await loadDedicatedHealthSessionRegistry(configPath);
        const firstDriver = createDedicatedHealthChromeBrowserDriver(
          targets(fixture.origin),
          registry,
          "chatgpt_standard_health",
        );
        try {
          await firstDriver.start();
          const result = await firstDriver.open("chatgpt_standard_health");
          expect(result).toEqual({
            targetKey: "chatgpt_standard_health",
            finalOrigin: fixture.origin,
          });
          expect(JSON.stringify(result)).not.toContain(statePath);
          expect(JSON.stringify(result)).not.toContain(COOKIE_VALUE);
        } finally {
          await firstDriver.closeOrPersist();
        }

        const secondDriver = createDedicatedHealthChromeBrowserDriver(
          targets(fixture.origin),
          registry,
          "chatgpt_standard_health",
        );
        expect(secondDriver).not.toBe(firstDriver);
        try {
          await secondDriver.start();
          await secondDriver.open("chatgpt_standard_health");
        } finally {
          await secondDriver.closeOrPersist();
        }

        const defaultDriver = new ChromeBrowserDriver(targets(fixture.origin));
        try {
          await defaultDriver.start();
          await defaultDriver.open("chatgpt_standard_health");
        } finally {
          await defaultDriver.closeOrPersist();
        }

        expect(fixture.requests()).toEqual([
          {
            path: "/standard-start",
            cookie: `${COOKIE_NAME}=${COOKIE_VALUE}`,
          },
          {
            path: "/standard-start",
            cookie: `${COOKIE_NAME}=${COOKIE_VALUE}`,
          },
          { path: "/standard-start", cookie: "" },
        ]);
        expect(await readFile(statePath, "utf8")).toBe(stateBefore);
      });
    } finally {
      await fixture.close();
    }
  });

  test("DS-08 navigation firewall blocks an unapproved top-level redirect", async () => {
    const fixture = await startFixture();
    try {
      await withSyntheticState(async (_statePath, configPath) => {
        const registry = await loadDedicatedHealthSessionRegistry(configPath);
        const driver = createDedicatedHealthChromeBrowserDriver(
          targets(fixture.origin, "/redirect"),
          registry,
          "chatgpt_standard_health",
        );
        try {
          await driver.start();
          await expect(
            driver.open("chatgpt_standard_health"),
          ).rejects.toMatchObject({ code: "UNSAFE_TOP_LEVEL_REDIRECT" });
          expect(fixture.requests()).toEqual([
            {
              path: "/redirect",
              cookie: `${COOKIE_NAME}=${COOKIE_VALUE}`,
            },
          ]);
        } finally {
          await driver.closeOrPersist();
        }
      });
    } finally {
      await fixture.close();
    }
  });

  test("DS-10 fails closed for Work before browser context creation", async () => {
    const fixture = await startFixture();
    try {
      await withSyntheticState(async (_statePath, configPath) => {
        const registry = await loadDedicatedHealthSessionRegistry(configPath);
        expect(() =>
          (
            createDedicatedHealthChromeBrowserDriver as unknown as DedicatedFactory
          )(targets(fixture.origin), registry, "chatgpt_work_health"),
        ).toThrowError("TARGET_NOT_CONFIGURED");
        expect(fixture.requests()).toEqual([]);
      });
    } finally {
      await fixture.close();
    }
  });
});
