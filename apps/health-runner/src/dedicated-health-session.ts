import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  createTrustedDedicatedHealthSessionRegistry,
  DedicatedHealthSessionConfigError,
  type DedicatedHealthSessionConfigErrorCode,
  type DedicatedHealthSessionRegistry,
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

async function inspectFile(
  filePath: string,
  kind: "config" | "storage",
): Promise<{ size: number }> {
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
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    fail(codes.unavailable);
  }
  if (stats.isSymbolicLink()) fail(codes.symlink);
  if (!stats.isFile()) fail(codes.notRegular);
  if (stats.size <= 0) fail(codes.empty);
  if (stats.size > maxBytes) fail(codes.tooLarge);
  validatePermissions(stats.mode, codes.permissions);
  return { size: stats.size };
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
  const configFile = await inspectFile(resolvedConfigFilePath, "config");
  let rawConfig: string;
  try {
    rawConfig = await readFile(resolvedConfigFilePath, "utf8");
  } catch {
    fail("CONFIG_FILE_READ_FAILED");
  }
  if (Buffer.byteLength(rawConfig, "utf8") !== configFile.size)
    fail("CONFIG_FILE_READ_FAILED");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig) as unknown;
  } catch {
    fail("CONFIG_JSON_INVALID");
  }
  const storageStatePath = parseConfig(parsed);
  await inspectFile(storageStatePath, "storage");
  return createTrustedDedicatedHealthSessionRegistry(storageStatePath);
}
