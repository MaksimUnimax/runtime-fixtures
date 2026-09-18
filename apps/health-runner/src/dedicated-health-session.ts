import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { CHATGPT_WORK_H3_PROFILE, parseWorkRoute } from "./work-h3-profile.js";
import {
  createTrustedDedicatedHealthSessionRegistry,
  DedicatedHealthSessionConfigError,
  type DedicatedHealthSessionConfigErrorCode,
  type DedicatedHealthSessionRegistry,
  type DedicatedHealthSessionStorageState,
  type DedicatedHealthSessionTargetKey,
} from "./dedicated-health-session-internal.js";

const MAX_CONFIG_FILE_BYTES = 64 * 1024;
const MAX_STORAGE_STATE_FILE_BYTES = 4 * 1024 * 1024;

export { DedicatedHealthSessionConfigError } from "./dedicated-health-session-internal.js";
export type {
  DedicatedHealthSessionConfigErrorCode,
  DedicatedHealthSessionRegistry,
  DedicatedHealthSessionTargetKey,
} from "./dedicated-health-session-internal.js";

type ConfigRecord = Readonly<Record<string, unknown>>;

function fail(code: DedicatedHealthSessionConfigErrorCode): never {
  throw new DedicatedHealthSessionConfigError(code);
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: ConfigRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function requireAbsolutePath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value))
    fail("INVALID_STORAGE_STATE_PATH");
  return resolve(value);
}

function validatePermissions(
  mode: number,
  code: "CONFIG_FILE_PERMISSIONS" | "STORAGE_STATE_PERMISSIONS",
): void {
  if (process.platform === "win32") return;
  if ((mode & 0o077) !== 0 || (mode & 0o400) === 0) fail(code);
}

async function readValidatedFile(
  filePath: string,
  kind: "config" | "storage",
): Promise<{
  contents: Buffer;
  identity: Readonly<{ device: number; inode: number }>;
}> {
  const codes =
    kind === "config"
      ? {
          unavailable: "CONFIG_FILE_UNAVAILABLE" as const,
          notRegular: "CONFIG_FILE_NOT_REGULAR" as const,
          symlink: "CONFIG_FILE_SYMLINK" as const,
          empty: "CONFIG_FILE_EMPTY" as const,
          tooLarge: "CONFIG_FILE_TOO_LARGE" as const,
          permissions: "CONFIG_FILE_PERMISSIONS" as const,
        }
      : {
          unavailable: "STORAGE_STATE_UNAVAILABLE" as const,
          notRegular: "STORAGE_STATE_NOT_REGULAR" as const,
          symlink: "STORAGE_STATE_SYMLINK" as const,
          empty: "STORAGE_STATE_EMPTY" as const,
          tooLarge: "STORAGE_STATE_TOO_LARGE" as const,
          permissions: "STORAGE_STATE_PERMISSIONS" as const,
        };
  const maxBytes =
    kind === "config" ? MAX_CONFIG_FILE_BYTES : MAX_STORAGE_STATE_FILE_BYTES;
  let linkStats;
  try {
    linkStats = await lstat(filePath);
  } catch {
    fail(codes.unavailable);
  }
  if (linkStats.isSymbolicLink()) fail(codes.symlink);
  if (!linkStats.isFile()) fail(codes.notRegular);
  if (linkStats.size <= 0) fail(codes.empty);
  if (linkStats.size > maxBytes) fail(codes.tooLarge);
  validatePermissions(linkStats.mode, codes.permissions);

  const flags =
    constants.O_RDONLY |
    (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0));
  let file;
  try {
    file = await open(filePath, flags);
  } catch {
    fail(codes.unavailable);
  }
  try {
    const stats = await file.stat();
    if (
      stats.dev !== linkStats.dev ||
      stats.ino !== linkStats.ino ||
      stats.size !== linkStats.size ||
      stats.mtimeMs !== linkStats.mtimeMs
    ) {
      fail(
        kind === "config"
          ? "CONFIG_FILE_READ_FAILED"
          : "STORAGE_STATE_UNAVAILABLE",
      );
    }
    if (stats.isSymbolicLink()) fail(codes.symlink);
    if (!stats.isFile()) fail(codes.notRegular);
    if (stats.size <= 0) fail(codes.empty);
    if (stats.size > maxBytes) fail(codes.tooLarge);
    validatePermissions(stats.mode, codes.permissions);
    const contents = await file.readFile();
    const finalStats = await file.stat();
    if (
      finalStats.size !== stats.size ||
      finalStats.mtimeMs !== stats.mtimeMs
    ) {
      fail(
        kind === "config"
          ? "CONFIG_FILE_READ_FAILED"
          : "STORAGE_STATE_UNAVAILABLE",
      );
    }
    if (contents.byteLength !== stats.size) {
      fail(
        kind === "config"
          ? "CONFIG_FILE_READ_FAILED"
          : "STORAGE_STATE_UNAVAILABLE",
      );
    }
    const pathStats = await lstat(filePath);
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      pathStats.dev !== stats.dev ||
      pathStats.ino !== stats.ino ||
      pathStats.size !== stats.size ||
      pathStats.mtimeMs !== stats.mtimeMs
    ) {
      fail(
        kind === "config"
          ? "CONFIG_FILE_READ_FAILED"
          : "STORAGE_STATE_UNAVAILABLE",
      );
    }
    return {
      contents,
      identity: { device: stats.dev, inode: stats.ino },
    };
  } catch (error) {
    if (error instanceof DedicatedHealthSessionConfigError) throw error;
    fail(
      kind === "config"
        ? "CONFIG_FILE_READ_FAILED"
        : "STORAGE_STATE_UNAVAILABLE",
    );
  } finally {
    await file.close().catch(() => undefined);
  }
}

type ParsedTarget = Readonly<{
  targetKey: DedicatedHealthSessionTargetKey;
  storageStatePath: string;
  startUrl?: string;
}>;

const STANDARD_TARGET_KEY = "chatgpt_standard_health" as const;
const WORK_TARGET_KEY = "chatgpt_work_health" as const;

function parseWorkStartUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048)
    fail("INVALID_WORK_START_URL");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("INVALID_WORK_START_URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== CHATGPT_WORK_H3_PROFILE.approvedOrigin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parseWorkRoute(parsed.toString()) === null
  ) {
    fail("INVALID_WORK_START_URL");
  }
  return parsed.toString();
}

function parseTarget(
  targetKey: DedicatedHealthSessionTargetKey,
  value: unknown,
): ParsedTarget {
  if (!isRecord(value)) fail("CONFIG_SCHEMA_INVALID");
  const expectedKeys =
    targetKey === STANDARD_TARGET_KEY
      ? ["storageStatePath"]
      : ["storageStatePath", "startUrl"];
  if (
    !hasOnlyKeys(value, expectedKeys) ||
    !("storageStatePath" in value) ||
    (targetKey === WORK_TARGET_KEY && !("startUrl" in value))
  ) {
    fail("CONFIG_SCHEMA_INVALID");
  }
  const storageStatePath = requireAbsolutePath(value.storageStatePath);
  if (targetKey === STANDARD_TARGET_KEY) {
    return { targetKey, storageStatePath };
  }
  return {
    targetKey,
    storageStatePath,
    startUrl: parseWorkStartUrl(value.startUrl),
  };
}

function parseConfig(value: unknown): ParsedTarget[] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "targets"]))
    fail("CONFIG_SCHEMA_INVALID");
  const targets = value.targets;
  if (value.version !== 1 || !isRecord(targets)) fail("CONFIG_SCHEMA_INVALID");
  if (Object.keys(targets).length === 0) fail("NO_TARGETS_CONFIGURED");
  if (!hasOnlyKeys(targets, [STANDARD_TARGET_KEY, WORK_TARGET_KEY]))
    fail("CONFIG_SCHEMA_INVALID");
  return ([STANDARD_TARGET_KEY, WORK_TARGET_KEY] as const)
    .filter((targetKey) => targetKey in targets)
    .map((targetKey) => parseTarget(targetKey, targets[targetKey]));
}

export async function loadDedicatedHealthSessionRegistry(
  configFilePath: string,
): Promise<DedicatedHealthSessionRegistry> {
  if (typeof configFilePath !== "string" || !isAbsolute(configFilePath))
    fail("INVALID_CONFIG_FILE_PATH");
  const resolvedConfigFilePath = resolve(configFilePath);
  const rawConfig = (
    await readValidatedFile(resolvedConfigFilePath, "config")
  ).contents.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig) as unknown;
  } catch {
    fail("CONFIG_JSON_INVALID");
  }
  const targets = parseConfig(parsed);
  const loadedTargets = await Promise.all(
    targets.map(async (target) => {
      const rawStorageState = await readValidatedFile(
        target.storageStatePath,
        "storage",
      );
      let storageState: unknown;
      try {
        storageState = JSON.parse(
          rawStorageState.contents.toString("utf8"),
        ) as unknown;
      } catch {
        fail("CONFIG_JSON_INVALID");
      }
      if (
        typeof storageState !== "object" ||
        storageState === null ||
        Array.isArray(storageState)
      ) {
        fail("CONFIG_SCHEMA_INVALID");
      }
      return {
        target,
        identity: rawStorageState.identity,
        storageState: deepFreeze(
          storageState as DedicatedHealthSessionStorageState,
        ),
      };
    }),
  );
  for (let left = 0; left < loadedTargets.length; left += 1) {
    for (let right = left + 1; right < loadedTargets.length; right += 1) {
      const first = loadedTargets[left];
      const second = loadedTargets[right];
      if (
        first &&
        second &&
        first.identity.device === second.identity.device &&
        first.identity.inode === second.identity.inode
      ) {
        fail("DUPLICATE_STORAGE_STATE");
      }
    }
  }
  return createTrustedDedicatedHealthSessionRegistry(
    loadedTargets.map(({ target, storageState }) =>
      Object.freeze(
        target.targetKey === STANDARD_TARGET_KEY
          ? { targetKey: target.targetKey, storageState }
          : {
              targetKey: target.targetKey,
              storageState,
              startUrl: target.startUrl as string,
            },
      ),
    ),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
