import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DedicatedHealthSessionConfigError,
  loadDedicatedHealthSessionRegistry,
} from "./dedicated-health-session.js";
import {
  ChromeBrowserDriver,
  createControlledTargetRegistry,
  createDedicatedHealthChromeBrowserDriver,
  sanitizeH3EvidenceBundle,
} from "./index.js";

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "health-session-test-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function createState(directory: string, name = "state.json") {
  const path = join(directory, name);
  await writeFile(path, '{"cookies":[],"origins":[]}', { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

async function createConfig(
  directory: string,
  config: unknown,
  name = "config.json",
): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

async function expectConfigError(
  action: () => Promise<unknown> | unknown,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error("EXPECTED_CONFIG_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(DedicatedHealthSessionConfigError);
    expect((error as DedicatedHealthSessionConfigError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

function standardConfig(storageStatePath: string): unknown {
  return {
    version: 1,
    targets: { chatgpt_standard_health: { storageStatePath } },
  };
}

function targetRegistry() {
  return createControlledTargetRegistry([
    {
      key: "chatgpt_standard_health",
      startUrl: "http://127.0.0.1:1/standard",
      allowedTopLevelOrigins: ["http://127.0.0.1:1"],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
  ]);
}

type DedicatedFactory = (
  targets: ReturnType<typeof targetRegistry>,
  registry: unknown,
  targetKey: string,
) => ChromeBrowserDriver;

describe("dedicated Standard Health session capability", () => {
  it("DS-01 loads strict Standard-only configuration", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, standardConfig(statePath)),
      );
      expect(Object.isFrozen(registry)).toBe(true);
      expect(JSON.stringify(registry)).toBe("{}");
    });
  });

  it("DS-02 keeps the trusted registry opaque and non-serializing", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(
        directory,
        "state-secret-sentinel.json",
      );
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, standardConfig(statePath)),
      );
      expect(JSON.stringify(registry)).not.toContain(statePath);
      expect(
        "DedicatedHealthSessionBinding" in (await import("./index.js")),
      ).toBe(false);
    });
  });

  it("DS-RED-01 rejects a forged registry/plain object", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const forged = {
        storageStatePath: statePath,
        targetKey: "chatgpt_standard_health",
      };
      expect(() =>
        (
          createDedicatedHealthChromeBrowserDriver as unknown as DedicatedFactory
        )(targetRegistry(), forged, "chatgpt_standard_health"),
      ).toThrowError("UNTRUSTED_SESSION_REGISTRY");
    });
  });

  it("DS-RED-02 keeps extra ChromeBrowserDriver constructor arguments powerless", () => {
    const forged = {
      storageStatePath: "/synthetic/forged-state.json",
      targetKey: "chatgpt_standard_health",
    };
    const driver = new (ChromeBrowserDriver as unknown as new (
      targets: ReturnType<typeof targetRegistry>,
      launchTimeoutMs?: number,
      forgedAuthority?: unknown,
    ) => ChromeBrowserDriver)(targetRegistry(), undefined, forged);
    expect(driver).toBeInstanceOf(ChromeBrowserDriver);
    expect(Object.keys(driver)).not.toContain("storageStatePath");
  });

  it("DS-07 keeps downloads disabled at the BrowserContext boundary", async () => {
    const source = await readFile(
      new URL("./browser-driver.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/acceptDownloads:\s*false/);
    expect(source).not.toMatch(/acceptDownloads:\s*true/);
  });

  it("DS-RED-03 rejects a symlinked storage-state file", async () => {
    if (process.platform === "win32") return;
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const stateLink = join(directory, "state-link.json");
      await symlink(statePath, stateLink);
      const symlinkConfig = await createConfig(
        directory,
        standardConfig(stateLink),
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(symlinkConfig),
        "STORAGE_STATE_SYMLINK",
      );
    });
  });

  it("DS-RED-04 rejects a relative storage-state path", async () => {
    await withTempDirectory(async (directory) => {
      const relativeConfig = await createConfig(
        directory,
        standardConfig("relative-state.json"),
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(relativeConfig),
        "INVALID_STORAGE_STATE_PATH",
      );
    });
  });

  it("DS-RED-05 rejects unsafe POSIX permissions", async () => {
    if (process.platform === "win32") return;
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const configPath = await createConfig(
        directory,
        standardConfig(statePath),
      );
      await chmod(statePath, 0o604);
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(configPath),
        "STORAGE_STATE_PERMISSIONS",
      );
    });
  });

  it("DS-RED-06 rejects unknown config fields", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const unknownFieldConfig = await createConfig(directory, {
        version: 1,
        unexpected: "rejected",
        targets: { chatgpt_standard_health: { storageStatePath: statePath } },
      });
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(unknownFieldConfig),
        "CONFIG_SCHEMA_INVALID",
      );
    });
  });

  it("DS-RED-07 rejects Work configuration and requests before browser creation", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const workConfig = await createConfig(directory, {
        version: 1,
        targets: { chatgpt_work_health: { storageStatePath: statePath } },
      });
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(workConfig),
        "CONFIG_SCHEMA_INVALID",
      );
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(
          directory,
          standardConfig(statePath),
          "standard.json",
        ),
      );
      expect(() =>
        (
          createDedicatedHealthChromeBrowserDriver as unknown as DedicatedFactory
        )(targetRegistry(), registry, "chatgpt_work_health"),
      ).toThrowError("TARGET_NOT_CONFIGURED");
    });
  });

  it("DS-RED-08 keeps auth paths out of serialized capability data", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory, "auth-path-sentinel.json");
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, standardConfig(statePath)),
      );
      const evidence = sanitizeH3EvidenceBundle({
        schemaVersion: 1,
        runId: "00000000-0000-4000-8000-000000000001",
        surface: "CHATGPT_STANDARD",
        startedAt: "2026-09-18T00:00:00.000Z",
        completedAt: "2026-09-18T00:00:00.001Z",
        events: [
          {
            step: "CLEANUP",
            outcome: "PASS",
            durationMs: 0,
            markerCount: null,
            transitionObserved: null,
            observations: [],
          },
        ],
      });
      expect(JSON.stringify(registry)).not.toContain(statePath);
      expect(JSON.stringify(evidence)).not.toContain(statePath);
      expect(JSON.stringify(evidence)).not.toContain("synthetic");
      expect(await readFile(join(directory, "config.json"), "utf8")).toContain(
        "storageStatePath",
      );
    });
  });

  it("rejects a config symlink and non-regular state file", async () => {
    if (process.platform === "win32") return;
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const configPath = await createConfig(
        directory,
        standardConfig(statePath),
      );
      const configLink = join(directory, "config-link.json");
      await symlink(configPath, configLink);
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(configLink),
        "CONFIG_FILE_SYMLINK",
      );
      const stateDirectory = join(directory, "state-directory");
      await mkdir(stateDirectory, { mode: 0o700 });
      const nonRegularConfig = await createConfig(
        directory,
        standardConfig(stateDirectory),
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(nonRegularConfig),
        "STORAGE_STATE_NOT_REGULAR",
      );
    });
  });
});
