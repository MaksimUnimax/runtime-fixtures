import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  createTrustedDedicatedHealthSessionRegistry,
  DedicatedHealthSessionConfigError,
  type DedicatedHealthSessionConfigErrorCode,
  type DedicatedHealthSessionRegistry,
  type DedicatedHealthSessionStorageState,
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
): Promise<Buffer> {
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
    return contents;
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

function parseConfig(value: unknown): string {
  if (!isRecord(value) || !hasOnlyKeys(value, ["version", "targets"]))
    fail("CONFIG_SCHEMA_INVALID");
  if (value.version !== 1 || !isRecord(value.targets))
    fail("CONFIG_SCHEMA_INVALID");
  if (Object.keys(value.targets).length === 0) fail("NO_TARGETS_CONFIGURED");
  if (!hasOnlyKeys(value.targets, ["chatgpt_standard_health"]))
    fail("CONFIG_SCHEMA_INVALID");
  const target = value.targets.chatgpt_standard_health;
  if (!isRecord(target) || !hasOnlyKeys(target, ["storageStatePath"]))
    fail("CONFIG_SCHEMA_INVALID");
  return requireAbsolutePath(target.storageStatePath);
}

export async function loadDedicatedHealthSessionRegistry(
  configFilePath: string,
): Promise<DedicatedHealthSessionRegistry> {
  if (typeof configFilePath !== "string" || !isAbsolute(configFilePath))
    fail("INVALID_CONFIG_FILE_PATH");
  const resolvedConfigFilePath = resolve(configFilePath);
  const rawConfig = (
    await readValidatedFile(resolvedConfigFilePath, "config")
  ).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig) as unknown;
  } catch {
    fail("CONFIG_JSON_INVALID");
  }
  const storageStatePath = parseConfig(parsed);
  const rawStorageState = await readValidatedFile(storageStatePath, "storage");
  let storageState: unknown;
  try {
    storageState = JSON.parse(rawStorageState.toString("utf8")) as unknown;
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
  const trustedStorageState = deepFreeze(
    storageState as DedicatedHealthSessionStorageState,
  );
  return createTrustedDedicatedHealthSessionRegistry(trustedStorageState);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
