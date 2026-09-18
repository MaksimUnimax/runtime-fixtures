import type { BrowserContextOptions } from "playwright";

export type DedicatedHealthSessionTargetKey = "chatgpt_standard_health";

export type DedicatedHealthSessionConfigErrorCode =
  | "INVALID_CONFIG_FILE_PATH"
  | "CONFIG_FILE_UNAVAILABLE"
  | "CONFIG_FILE_NOT_REGULAR"
  | "CONFIG_FILE_SYMLINK"
  | "CONFIG_FILE_EMPTY"
  | "CONFIG_FILE_TOO_LARGE"
  | "CONFIG_FILE_PERMISSIONS"
  | "CONFIG_FILE_READ_FAILED"
  | "CONFIG_JSON_INVALID"
  | "CONFIG_SCHEMA_INVALID"
  | "NO_TARGETS_CONFIGURED"
  | "INVALID_STORAGE_STATE_PATH"
  | "STORAGE_STATE_UNAVAILABLE"
  | "STORAGE_STATE_NOT_REGULAR"
  | "STORAGE_STATE_SYMLINK"
  | "STORAGE_STATE_EMPTY"
  | "STORAGE_STATE_TOO_LARGE"
  | "STORAGE_STATE_PERMISSIONS"
  | "UNTRUSTED_SESSION_REGISTRY"
  | "TARGET_NOT_CONFIGURED";

export class DedicatedHealthSessionConfigError extends Error {
  public constructor(
    public readonly code: DedicatedHealthSessionConfigErrorCode,
  ) {
    super(code);
    this.name = "DedicatedHealthSessionConfigError";
  }
}

export interface DedicatedHealthSessionRegistry {
  readonly __dedicatedHealthSessionRegistry?: never;
}

export type DedicatedHealthSessionStorageState = Exclude<
  NonNullable<BrowserContextOptions["storageState"]>,
  string
>;

const trustedStorageStates = new WeakMap<
  object,
  DedicatedHealthSessionStorageState
>();

function fail(code: DedicatedHealthSessionConfigErrorCode): never {
  throw new DedicatedHealthSessionConfigError(code);
}

export function createTrustedDedicatedHealthSessionRegistry(
  storageState: DedicatedHealthSessionStorageState,
): DedicatedHealthSessionRegistry {
  const registry = Object.freeze({}) as DedicatedHealthSessionRegistry;
  trustedStorageStates.set(registry, storageState);
  return registry;
}

export function resolveTrustedDedicatedHealthSessionStorageState(
  registry: DedicatedHealthSessionRegistry,
  targetKey: string,
): DedicatedHealthSessionStorageState {
  if (
    (typeof registry !== "object" && typeof registry !== "function") ||
    registry === null
  ) {
    fail("UNTRUSTED_SESSION_REGISTRY");
  }
  if (targetKey !== "chatgpt_standard_health") fail("TARGET_NOT_CONFIGURED");
  const storageState = trustedStorageStates.get(registry);
  if (storageState === undefined) fail("UNTRUSTED_SESSION_REGISTRY");
  return storageState;
}
