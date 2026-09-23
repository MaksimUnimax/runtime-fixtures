import {
  BootstrapRequestV1Schema,
  SignedBootstrapEnvelopeV1Schema,
  type BootstrapRequestV1,
  type BootstrapSnapshotPayloadV1,
  type SignedBootstrapEnvelopeV1,
} from "@product/contracts";
import {
  verifyBootstrapEnvelope,
  type TrustedConfigSigningKeyRing,
} from "@product/remote-config";
import { BrowserFamilies, type BrowserFamily } from "@product/shared";
import { z } from "zod";

export const BOOTSTRAP_CACHE_VERSION = "bootstrap_cache_v1" as const;

const CACHE_RECORD_DEVICE_ID = "00000000-0000-4000-8000-000000000000";
const IsoTimestampSchema = z.string().datetime({ offset: true });
const DetectedAiSchema = z
  .object({
    family: z.string().min(1),
    surface: z.string().min(1),
    variant: z.string().nullable(),
  })
  .strict();

const CacheRequestContextSchema = z
  .object({
    contractVersion: z.literal("control_plane_v1"),
    extensionVersion: z.string().min(1),
    browser: z
      .object({
        family: z.enum(BrowserFamilies),
        version: z.string().min(1).max(64),
      })
      .strict(),
    detectedAi: DetectedAiSchema.nullable(),
  })
  .strict();

const BootstrapCacheRecordSchema = z
  .object({
    cacheVersion: z.literal(BOOTSTRAP_CACHE_VERSION),
    controlPlaneApiOrigin: z.string().url(),
    deviceId: z.uuid(),
    sessionId: z.uuid(),
    requestContext: CacheRequestContextSchema,
    envelope: SignedBootstrapEnvelopeV1Schema,
    trustedServerTimeHighWatermark: IsoTimestampSchema,
    // Legacy field name retained for the v1 reference record. It is the
    // durable effective-time floor, not merely an observation of wall time.
    lastObservedWallTimeHighWatermark: IsoTimestampSchema,
  })
  .strict();
const TerminalInvalidationRecordSchema = z
  .object({
    cacheVersion: z.literal("bootstrap_cache_terminal_v1"),
    controlPlaneApiOrigin: z.string().url(),
    deviceId: z.uuid(),
    sessionId: z.uuid(),
    contractVersion: z.literal("control_plane_v1"),
    state: z.literal("TERMINALLY_INVALIDATED"),
  })
  .strict();

export type NormalizedDetectedAi = {
  family: string;
  surface: string;
  variant: string | null;
};

export type BootstrapRequestContext = {
  contractVersion: "control_plane_v1";
  extensionVersion: string;
  browser: {
    family: BrowserFamily;
    version: string;
  };
  detectedAi: NormalizedDetectedAi | null;
};

export type BootstrapCacheRecord = {
  cacheVersion: typeof BOOTSTRAP_CACHE_VERSION;
  controlPlaneApiOrigin: string;
  deviceId: string;
  sessionId: string;
  requestContext: BootstrapRequestContext;
  envelope: SignedBootstrapEnvelopeV1;
  trustedServerTimeHighWatermark: string;
  /** Durable local effective-time floor; the legacy field name is retained. */
  lastObservedWallTimeHighWatermark: string;
};
export type TerminalInvalidationRecord = {
  cacheVersion: "bootstrap_cache_terminal_v1";
  controlPlaneApiOrigin: string;
  deviceId: string;
  sessionId: string;
  contractVersion: "control_plane_v1";
  state: "TERMINALLY_INVALIDATED";
};

export type BootstrapSnapshotStoreKey = {
  controlPlaneApiOrigin: string;
  deviceId: string;
  sessionId: string;
  contractVersion: "control_plane_v1";
};

/** A deliberately narrow port; it is not a generic local-storage API. */
export interface BootstrapSnapshotStore {
  load(key: BootstrapSnapshotStoreKey): Promise<unknown | undefined>;
  /** A save must never lower the durable effective-time floor for the key. */
  save(
    key: BootstrapSnapshotStoreKey,
    record: BootstrapCacheRecord,
  ): Promise<void>;
  remove(key: BootstrapSnapshotStoreKey): Promise<void>;
  /** Must durably replace the scoped cache with a terminal marker. */
  markTerminallyInvalidated(key: BootstrapSnapshotStoreKey): Promise<void>;
}

/** Deterministic reference storage. A Bridge adapter is deferred to P11. */
export class InMemoryBootstrapSnapshotStore implements BootstrapSnapshotStore {
  private readonly records = new Map<
    string,
    BootstrapCacheRecord | TerminalInvalidationRecord
  >();

  async load(key: BootstrapSnapshotStoreKey): Promise<unknown | undefined> {
    const value = this.records.get(storeKey(key));
    return value ? structuredClone(value) : undefined;
  }

  async save(
    key: BootstrapSnapshotStoreKey,
    record: BootstrapCacheRecord,
  ): Promise<void> {
    const existing = this.records.get(storeKey(key));
    if (existing?.cacheVersion === "bootstrap_cache_terminal_v1") return;
    if (existing?.cacheVersion === BOOTSTRAP_CACHE_VERSION) {
      record = {
        ...record,
        lastObservedWallTimeHighWatermark: new Date(
          Math.max(
            Date.parse(existing.lastObservedWallTimeHighWatermark),
            Date.parse(record.lastObservedWallTimeHighWatermark),
          ),
        ).toISOString(),
      };
    }
    this.records.set(storeKey(key), structuredClone(record));
  }

  async remove(key: BootstrapSnapshotStoreKey): Promise<void> {
    this.records.delete(storeKey(key));
  }

  async markTerminallyInvalidated(
    key: BootstrapSnapshotStoreKey,
  ): Promise<void> {
    this.records.set(storeKey(key), {
      cacheVersion: "bootstrap_cache_terminal_v1",
      controlPlaneApiOrigin: key.controlPlaneApiOrigin,
      deviceId: key.deviceId,
      sessionId: key.sessionId,
      contractVersion: key.contractVersion,
      state: "TERMINALLY_INVALIDATED",
    });
  }
}

export function normalizeDetectedAi(
  detectedAi: BootstrapRequestV1["detectedAi"] | null,
): NormalizedDetectedAi | null {
  return detectedAi
    ? {
        family: detectedAi.family,
        surface: detectedAi.surface,
        variant: detectedAi.variant ?? null,
      }
    : null;
}

export function normalizeRequestContext(
  input: Omit<BootstrapRequestV1, "deviceId" | "lastConfigVersion"> & {
    detectedAi?: BootstrapRequestV1["detectedAi"] | null;
  },
): BootstrapRequestContext {
  const { detectedAi, ...rest } = input;
  const parsed = BootstrapRequestV1Schema.parse({
    ...rest,
    detectedAi: detectedAi ?? undefined,
    deviceId: CACHE_RECORD_DEVICE_ID,
    lastConfigVersion: null,
  });
  return {
    contractVersion: parsed.contractVersion,
    extensionVersion: parsed.extensionVersion,
    browser: { ...parsed.browser },
    detectedAi: normalizeDetectedAi(parsed.detectedAi),
  };
}

export function cacheKey(input: BootstrapSnapshotStoreKey): string {
  return storeKey(input);
}

export function requestContextsEqual(
  left: BootstrapRequestContext,
  right: BootstrapRequestContext,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type ValidatedBootstrapCache = {
  record: BootstrapCacheRecord;
  payload: BootstrapSnapshotPayloadV1;
  trustedServerTimeHighWatermarkMs: number;
  persistedEffectiveTimeHighWatermarkMs: number;
  lastObservedWallTimeHighWatermarkMs: number;
};

export type CacheValidationFailure =
  | "MALFORMED_RECORD"
  | "INVALID_ENVELOPE"
  | "INCONSISTENT_TIME_METADATA";

export function isTerminallyInvalidatedCache(
  input: unknown,
  key: BootstrapSnapshotStoreKey,
): boolean {
  const parsed = TerminalInvalidationRecordSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.controlPlaneApiOrigin === key.controlPlaneApiOrigin &&
    parsed.data.deviceId === key.deviceId &&
    parsed.data.sessionId === key.sessionId &&
    parsed.data.contractVersion === key.contractVersion
  );
}

export function validateBootstrapCacheRecord(
  input: unknown,
  key: BootstrapSnapshotStoreKey,
  ring: TrustedConfigSigningKeyRing,
):
  | { ok: true; value: ValidatedBootstrapCache }
  | { ok: false; error: CacheValidationFailure } {
  const parsed = BootstrapCacheRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "MALFORMED_RECORD" };
  const record = parsed.data as BootstrapCacheRecord;
  if (
    record.controlPlaneApiOrigin !== key.controlPlaneApiOrigin ||
    record.deviceId !== key.deviceId ||
    record.sessionId !== key.sessionId ||
    record.requestContext.contractVersion !== key.contractVersion
  )
    return { ok: false, error: "MALFORMED_RECORD" };
  try {
    BootstrapRequestV1Schema.parse({
      ...record.requestContext,
      detectedAi: record.requestContext.detectedAi ?? undefined,
      deviceId: key.deviceId,
      lastConfigVersion: null,
    });
  } catch {
    return { ok: false, error: "MALFORMED_RECORD" };
  }

  const verified = verifyBootstrapEnvelope(record.envelope, ring);
  if (!verified.ok) return { ok: false, error: "INVALID_ENVELOPE" };
  const trustedServerTimeHighWatermarkMs = Date.parse(
    record.trustedServerTimeHighWatermark,
  );
  const lastObservedWallTimeHighWatermarkMs = Date.parse(
    record.lastObservedWallTimeHighWatermark,
  );
  const payloadServerTimeMs = Date.parse(verified.payload.serverTime);
  if (
    ![
      trustedServerTimeHighWatermarkMs,
      lastObservedWallTimeHighWatermarkMs,
      payloadServerTimeMs,
    ].every(Number.isFinite) ||
    trustedServerTimeHighWatermarkMs < payloadServerTimeMs ||
    lastObservedWallTimeHighWatermarkMs < trustedServerTimeHighWatermarkMs
  )
    return { ok: false, error: "INCONSISTENT_TIME_METADATA" };
  return {
    ok: true,
    value: {
      record,
      payload: verified.payload,
      trustedServerTimeHighWatermarkMs,
      persistedEffectiveTimeHighWatermarkMs:
        lastObservedWallTimeHighWatermarkMs,
      lastObservedWallTimeHighWatermarkMs,
    },
  };
}

function storeKey(key: BootstrapSnapshotStoreKey): string {
  return JSON.stringify([
    key.controlPlaneApiOrigin,
    key.deviceId,
    key.sessionId,
    key.contractVersion,
  ]);
}
