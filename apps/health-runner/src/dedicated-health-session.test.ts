import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  createDedicatedWorkHealthChromeBrowserDriver,
  sanitizeH3EvidenceBundle,
} from "./index.js";
import { resolveTrustedDedicatedHealthSessionBinding } from "./dedicated-health-session-internal.js";

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

const WORK_START_URL =
  "https://chatgpt.com/g/g-p-private-project/c/00000000-0000-4000-8000-000000000001";

function workConfig(
  storageStatePath: string,
  startUrl = WORK_START_URL,
): unknown {
  return {
    version: 1,
    targets: { chatgpt_work_health: { storageStatePath, startUrl } },
  };
}

function twoTargetConfig(
  standardStatePath: string,
  workStatePath: string,
): unknown {
  return {
    version: 1,
    targets: {
      chatgpt_standard_health: { storageStatePath: standardStatePath },
      chatgpt_work_health: {
        storageStatePath: workStatePath,
        startUrl: WORK_START_URL,
      },
    },
  };
}

function workTargetRegistry() {
  return createControlledTargetRegistry([
    {
      key: "chatgpt_work_health",
      startUrl: "https://chatgpt.com/caller-controlled-route",
      allowedTopLevelOrigins: ["https://chatgpt.com"],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
  ]);
}

function bothTargetRegistry() {
  return createControlledTargetRegistry([
    {
      key: "chatgpt_standard_health",
      startUrl: "https://chatgpt.com/",
      allowedTopLevelOrigins: ["https://chatgpt.com"],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
    {
      key: "chatgpt_work_health",
      startUrl: "https://chatgpt.com/caller-controlled-route",
      allowedTopLevelOrigins: ["https://chatgpt.com"],
      browserFamily: "chrome",
      navigationTimeoutMs: 5_000,
    },
  ]);
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

describe("dedicated Work Health session capability", () => {
  it("WD-01 loads a valid Work-only config and keeps its capability opaque", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory, "work-state.json");
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, workConfig(statePath)),
      );
      expect(Object.isFrozen(registry)).toBe(true);
      expect(JSON.stringify(registry)).toBe("{}");
      expect({ ...registry }).toEqual({});
      expect(Reflect.ownKeys(registry)).toEqual([]);
      const binding = resolveTrustedDedicatedHealthSessionBinding(
        registry,
        "chatgpt_work_health",
      );
      expect(binding.targetKey).toBe("chatgpt_work_health");
      if (binding.targetKey !== "chatgpt_work_health")
        throw new Error("EXPECTED_WORK_BINDING");
      expect(binding.startUrl).toBe(WORK_START_URL);
    });
  });

  it("WD-02 preserves valid Standard-only and WD-03 accepts distinct two-target config", async () => {
    await withTempDirectory(async (directory) => {
      const standardState = await createState(directory, "standard.json");
      const workState = await createState(directory, "work.json");
      const standardRegistry = await loadDedicatedHealthSessionRegistry(
        await createConfig(
          directory,
          standardConfig(standardState),
          "standard-config.json",
        ),
      );
      const bothRegistry = await loadDedicatedHealthSessionRegistry(
        await createConfig(
          directory,
          twoTargetConfig(standardState, workState),
          "both-config.json",
        ),
      );
      expect(
        resolveTrustedDedicatedHealthSessionBinding(
          standardRegistry,
          "chatgpt_standard_health",
        ).targetKey,
      ).toBe("chatgpt_standard_health");
      expect(
        resolveTrustedDedicatedHealthSessionBinding(
          bothRegistry,
          "chatgpt_work_health",
        ).targetKey,
      ).toBe("chatgpt_work_health");
    });
  });

  it.each([
    [
      "WD-04",
      "missing startUrl",
      (path: string) => ({
        version: 1,
        targets: { chatgpt_work_health: { storageStatePath: path } },
      }),
    ],
    [
      "WD-05",
      "Standard containing startUrl",
      (path: string) => ({
        version: 1,
        targets: {
          chatgpt_standard_health: {
            storageStatePath: path,
            startUrl: WORK_START_URL,
          },
        },
      }),
    ],
    [
      "WD-06",
      "invalid Work origin",
      (path: string) =>
        workConfig(
          path,
          "https://example.com/g/g-p-x/c/00000000-0000-4000-8000-000000000001",
        ),
    ],
    [
      "WD-07",
      "HTTP Work URL",
      (path: string) =>
        workConfig(path, WORK_START_URL.replace("https:", "http:")),
    ],
    [
      "WD-08",
      "Work URL credentials",
      (path: string) =>
        workConfig(
          path,
          WORK_START_URL.replace(
            "https://chatgpt.com",
            "https://user:pass@chatgpt.com",
          ),
        ),
    ],
    [
      "WD-09",
      "Work URL query",
      (path: string) => workConfig(path, `${WORK_START_URL}?x=1`),
    ],
    [
      "WD-10",
      "Work URL fragment",
      (path: string) => workConfig(path, `${WORK_START_URL}#x`),
    ],
    [
      "WD-11",
      "non-project route",
      (path: string) =>
        workConfig(
          path,
          "https://chatgpt.com/c/00000000-0000-4000-8000-000000000001",
        ),
    ],
    [
      "WD-12",
      "invalid conversation UUID",
      (path: string) =>
        workConfig(
          path,
          "https://chatgpt.com/g/g-p-private-project/c/not-a-uuid",
        ),
    ],
    [
      "WD-13",
      "unknown fields",
      (path: string) => ({
        version: 1,
        unexpected: true,
        targets: {
          chatgpt_work_health: {
            storageStatePath: path,
            startUrl: WORK_START_URL,
          },
        },
      }),
    ],
  ] as const)("%s rejects %s", async (_id, _label, configFactory) => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const configPath = await createConfig(
        directory,
        configFactory(statePath),
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(configPath),
        _id === "WD-04" || _id === "WD-05" || _id === "WD-13"
          ? "CONFIG_SCHEMA_INVALID"
          : "INVALID_WORK_START_URL",
      );
    });
  });

  it("WD-14 rejects a Work state symlink and WD-15 rejects unsafe permissions", async () => {
    if (process.platform === "win32") return;
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory);
      const stateLink = join(directory, "work-state-link.json");
      await symlink(statePath, stateLink);
      const symlinkConfigPath = await createConfig(
        directory,
        workConfig(stateLink),
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(symlinkConfigPath),
        "STORAGE_STATE_SYMLINK",
      );
      const configPath = await createConfig(directory, workConfig(statePath));
      await chmod(statePath, 0o604);
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(configPath),
        "STORAGE_STATE_PERMISSIONS",
      );
    });
  });

  it("WD-16 rejects a Work state replaced during the secure read", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = join(directory, "work-state.json");
      const replacementPath = join(directory, "work-state-replacement.json");
      const largeValue = "x".repeat(3_800_000);
      const originalContents = JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: "https://chatgpt.com",
            localStorage: [{ name: "large", value: largeValue }],
          },
        ],
      });
      await writeFile(statePath, originalContents, { mode: 0o600 });
      await chmod(statePath, 0o600);
      await writeFile(replacementPath, originalContents.replaceAll("x", "y"), {
        mode: 0o600,
      });
      await chmod(replacementPath, 0o600);
      const configPath = await createConfig(directory, workConfig(statePath));
      const loading = loadDedicatedHealthSessionRegistry(configPath);
      const churn = (async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const backupPath = join(
            directory,
            `work-state-backup-${attempt}.json`,
          );
          await rename(statePath, backupPath).catch(() => undefined);
          await rename(replacementPath, statePath).catch(() => undefined);
          await rename(statePath, replacementPath).catch(() => undefined);
          await rename(backupPath, statePath).catch(() => undefined);
        }
      })();
      await expectConfigError(() => loading, "STORAGE_STATE_UNAVAILABLE");
      await churn;
    });
  });

  it("WD-17 rejects the same Standard/Work state path and WD-18 rejects a hardlink", async () => {
    if (process.platform === "win32") return;
    await withTempDirectory(async (directory) => {
      const standardState = await createState(directory, "standard.json");
      const samePathConfig = await createConfig(
        directory,
        twoTargetConfig(standardState, standardState),
        "same-path.json",
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(samePathConfig),
        "DUPLICATE_STORAGE_STATE",
      );
      const hardlinkState = join(directory, "work-hardlink.json");
      await link(standardState, hardlinkState);
      const hardlinkConfig = await createConfig(
        directory,
        twoTargetConfig(standardState, hardlinkState),
        "hardlink.json",
      );
      await expectConfigError(
        () => loadDedicatedHealthSessionRegistry(hardlinkConfig),
        "DUPLICATE_STORAGE_STATE",
      );
    });
  });

  it("WD-19/20 keeps state, paths, and Work route data out of reflection and serialization", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(
        directory,
        "COOKIE_VALUE_PROJECT_UUID.json",
      );
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, workConfig(statePath)),
      );
      const serialized = `${JSON.stringify(registry)}${JSON.stringify({ ...registry })}${Reflect.ownKeys(registry).join()}`;
      expect(serialized).not.toContain(statePath);
      expect(serialized).not.toContain("COOKIE_VALUE_PROJECT_UUID");
      expect(serialized).not.toContain(WORK_START_URL);
      expect(serialized).not.toContain("private-project");
      expect(serialized).not.toContain("00000000-0000-4000-8000-000000000001");
    });
  });

  it.each([
    [
      "WD-21 forged plain object",
      { storageState: { cookies: [] }, startUrl: WORK_START_URL },
    ],
    ["WD-22 frozen empty object", Object.freeze({})],
    ["WD-23 proxy/fake registry", new Proxy({}, {})],
  ] as const)("%s fails closed", (_label, forged) => {
    expect(() =>
      createDedicatedWorkHealthChromeBrowserDriver(
        workTargetRegistry(),
        forged as never,
        "chatgpt_work_health",
      ),
    ).toThrowError("UNTRUSTED_SESSION_REGISTRY");
  });

  it("WD-24/25 enforce registry target presence before browser creation", async () => {
    await withTempDirectory(async (directory) => {
      const standardState = await createState(directory, "standard.json");
      const workState = await createState(directory, "work.json");
      const standardRegistry = await loadDedicatedHealthSessionRegistry(
        await createConfig(
          directory,
          standardConfig(standardState),
          "standard.json.config",
        ),
      );
      const workRegistry = await loadDedicatedHealthSessionRegistry(
        await createConfig(
          directory,
          workConfig(workState),
          "work.json.config",
        ),
      );
      expect(() =>
        createDedicatedWorkHealthChromeBrowserDriver(
          workTargetRegistry(),
          standardRegistry,
          "chatgpt_work_health",
        ),
      ).toThrowError("TARGET_NOT_CONFIGURED");
      expect(() =>
        createDedicatedHealthChromeBrowserDriver(
          bothTargetRegistry(),
          workRegistry,
          "chatgpt_standard_health",
        ),
      ).toThrowError("TARGET_NOT_CONFIGURED");
    });
  });

  it("WD-26 keeps extra constructor arguments powerless and WD-27 keeps raw resolvers private", async () => {
    const driver = new (ChromeBrowserDriver as unknown as new (
      ...args: unknown[]
    ) => ChromeBrowserDriver)(workTargetRegistry(), undefined, {
      storageState: { cookies: [] },
      startUrl: WORK_START_URL,
    });
    expect(driver).toBeInstanceOf(ChromeBrowserDriver);
    expect(Object.keys(driver)).not.toContain("storageState");
    expect(Object.keys(driver)).not.toContain("startUrl");
    expect(
      "resolveTrustedDedicatedHealthSessionBinding" in
        (await import("./index.js")),
    ).toBe(false);
  });

  it("WD-C04 selects the immutable private Work route while the caller route is ignored", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory, "work-private-state.json");
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, workConfig(statePath)),
      );
      const binding = resolveTrustedDedicatedHealthSessionBinding(
        registry,
        "chatgpt_work_health",
      );
      const driver = createDedicatedWorkHealthChromeBrowserDriver(
        workTargetRegistry(),
        registry,
        "chatgpt_work_health",
      );
      if (binding.targetKey !== "chatgpt_work_health")
        throw new Error("EXPECTED_WORK_BINDING");
      expect(binding.startUrl).toBe(WORK_START_URL);
      expect(binding.startUrl).not.toContain("caller-controlled-route");
      await driver.closeOrPersist();
    });
  });

  it("WD-RED-09 keeps the Work route out of returned-driver reflection", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(
        directory,
        "storage-cookie-sentinel-r7.json",
      );
      const privateWorkUrl =
        "https://chatgpt.com/g/g-p-private-project-sentinel-r7/c/77777777-7777-4777-8777-777777777777";
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, workConfig(statePath, privateWorkUrl)),
      );
      const driver = createDedicatedWorkHealthChromeBrowserDriver(
        workTargetRegistry(),
        registry,
        "chatgpt_work_health",
      );
      try {
        const reflected = [
          JSON.stringify(driver),
          ...Object.keys(driver),
          ...Reflect.ownKeys(driver).map(String),
          ...Object.getOwnPropertyNames(driver),
          ...Object.getOwnPropertySymbols(driver).map(String),
          ...Object.values(Object.getOwnPropertyDescriptors(driver)).map(
            (descriptor) => JSON.stringify(descriptor),
          ),
          JSON.stringify({ ...driver }),
        ].join("\n");
        expect(reflected).not.toContain(privateWorkUrl);
        expect(reflected).not.toContain("private-project-sentinel-r7");
        expect(reflected).not.toContain("77777777-7777-4777-8777-777777777777");
        expect(reflected).not.toContain("storage-cookie-sentinel-r7");
        expect(reflected).not.toContain(statePath);

        const reachableTargets = (driver as unknown as { targets?: unknown })
          .targets;
        expect(reachableTargets).toBeUndefined();
      } finally {
        await driver.closeOrPersist();
      }
    });
  });

  it("WD-C09 freezes the dedicated Work policy against caller origin expansion", async () => {
    await withTempDirectory(async (directory) => {
      const statePath = await createState(directory, "work-policy-state.json");
      const registry = await loadDedicatedHealthSessionRegistry(
        await createConfig(directory, workConfig(statePath)),
      );
      const callerTargets = createControlledTargetRegistry([
        {
          key: "chatgpt_work_health",
          startUrl: "https://evil.example/alternate",
          allowedTopLevelOrigins: [
            "https://evil.example",
            "https://chatgpt.com",
          ],
          browserFamily: "chrome",
          navigationTimeoutMs: 5_000,
        },
      ]);
      const driver = createDedicatedWorkHealthChromeBrowserDriver(
        callerTargets,
        registry,
        "chatgpt_work_health",
      );
      try {
        const callerDefinitions = (
          callerTargets as unknown as { targets: Map<string, unknown> }
        ).targets;
        callerDefinitions.set("chatgpt_work_health", {
          key: "chatgpt_work_health",
          startUrl: "https://evil.example/post-construction",
          allowedTopLevelOrigins: ["https://evil.example"],
          browserFamily: "chrome",
          navigationTimeoutMs: 5_000,
        });
        const source = await readFile(
          new URL("./browser-driver.ts", import.meta.url),
          "utf8",
        );
        expect(source).toContain(
          "allowedTopLevelOrigins: [CHATGPT_WORK_H3_PROFILE.approvedOrigin]",
        );
        expect(source).not.toContain("...workTarget");
        expect(
          (driver as unknown as { targets?: unknown }).targets,
        ).toBeUndefined();
      } finally {
        await driver.closeOrPersist();
      }
    });
  });
});
