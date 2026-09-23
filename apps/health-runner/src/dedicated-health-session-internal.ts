import type { BrowserContextOptions } from "playwright";

export type DedicatedHealthSessionTargetKey =
  | "chatgpt_standard_health"
  | "chatgpt_work_health"
  | "alice_health";

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
  | "DUPLICATE_STORAGE_STATE"
  | "INVALID_WORK_START_URL"
  | "INVALID_ALICE_START_URL"
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

export type TrustedDedicatedHealthSessionBinding = Readonly<
  | {
      targetKey: "chatgpt_standard_health";
      storageState: DedicatedHealthSessionStorageState;
    }
  | {
      targetKey: "chatgpt_work_health";
      storageState: DedicatedHealthSessionStorageState;
      startUrl: string;
    }
  | {
      targetKey: "alice_health";
      storageState: DedicatedHealthSessionStorageState;
      startUrl: string;
    }
>;

const registryBindings = new WeakMap<
  object,
  ReadonlyMap<
    DedicatedHealthSessionTargetKey,
    TrustedDedicatedHealthSessionBinding
  >
>();

function fail(code: DedicatedHealthSessionConfigErrorCode): never {
  throw new DedicatedHealthSessionConfigError(code);
}

export function createTrustedDedicatedHealthSessionRegistry(
  bindings: readonly TrustedDedicatedHealthSessionBinding[],
): DedicatedHealthSessionRegistry {
  const registry = Object.freeze({}) as DedicatedHealthSessionRegistry;
  registryBindings.set(
    registry,
    new Map(bindings.map((binding) => [binding.targetKey, binding])),
  );
  return registry;
}

export function resolveTrustedDedicatedHealthSessionBinding(
  registry: DedicatedHealthSessionRegistry,
  targetKey: string,
): TrustedDedicatedHealthSessionBinding {
  if (
    (typeof registry !== "object" && typeof registry !== "function") ||
    registry === null
  ) {
    fail("UNTRUSTED_SESSION_REGISTRY");
  }
  if (
    targetKey !== "chatgpt_standard_health" &&
    targetKey !== "chatgpt_work_health" &&
    targetKey !== "alice_health"
  ) {
    fail("TARGET_NOT_CONFIGURED");
  }
  const bindings = registryBindings.get(registry);
  if (!bindings) fail("UNTRUSTED_SESSION_REGISTRY");
  const binding = bindings.get(targetKey);
  if (!binding) fail("TARGET_NOT_CONFIGURED");
  return binding;
}
