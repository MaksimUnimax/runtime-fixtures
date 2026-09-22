import {
  DeviceAuthorizationExchangeResponseV1Schema,
  DeviceAuthorizationStartResponseV1Schema,
  RefreshResponseV1Schema,
  ApiErrorEnvelopeV1Schema,
  BootstrapRequestV1Schema,
  BootstrapRequestV2Schema,
  SignedBootstrapEnvelopeV1Schema,
  SignedBootstrapEnvelopeV2Schema,
  type BootstrapRequestV1,
  type BootstrapRequestV2,
  type BootstrapSnapshotPayloadV1,
  type BootstrapSnapshotPayloadV2,
  type SignedBootstrapEnvelopeV1,
  type SignedBootstrapEnvelopeV2,
} from "@product/contracts";
import {
  verifyBootstrapEnvelope,
  verifyBootstrapEnvelopeV2,
  type BootstrapVerificationFailure,
} from "@product/remote-config";
import type { KeyObject } from "node:crypto";
import {
  InMemoryBootstrapSnapshotStore,
  isTerminallyInvalidatedCache,
  normalizeRequestContext,
  requestContextsEqual,
  validateBootstrapCacheRecord,
  type BootstrapCacheRecord,
  type BootstrapRequestContext,
  type BootstrapSnapshotStore,
  type BootstrapSnapshotStoreKey,
  type ValidatedBootstrapCache,
} from "./bootstrap-cache.js";
import {
  evaluateCachedBootstrapEligibility,
  type OfflineFallbackTrigger,
} from "./offline-policy.js";
import {
  resolveClientCompatibility,
  type SignedOperationalResult,
} from "./bootstrap-policy.js";
import {
  validateAndBindBootstrapAi,
  type ClientAiBindingContext,
  type SimulatedAiBinding,
} from "./ai-binding.js";
import {
  detectSimulatedPackagedAi,
  type SimulatedPackagedTab,
} from "./detector.js";
export * from "./bootstrap-cache.js";
export * from "./bootstrap-policy.js";
export * from "./offline-policy.js";
export * from "./ai-binding.js";
export * from "./detector.js";
export type ExchangeResult =
  | { kind: "ACTIVATED" }
  | { kind: "PENDING"; retryAfterSeconds: number }
  | { kind: "LIMIT_REACHED" | "CLOSED" | "INVALID" | "RATE_LIMITED" };
type Credentials = {
  deviceId: string;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};
export type BootstrapResultV1 =
  | {
      kind: "VERIFIED";
      payload: BootstrapSnapshotPayloadV1;
      envelope: SignedBootstrapEnvelopeV1;
    }
  | { kind: "HTTP_ERROR"; status: number; code: string }
  | { kind: "VERIFICATION_FAILURE"; error: BootstrapVerificationFailure };
export type BootstrapResultV2 =
  | {
      kind: "VERIFIED";
      payload: BootstrapSnapshotPayloadV2;
      envelope: SignedBootstrapEnvelopeV2;
    }
  | { kind: "HTTP_ERROR"; status: number; code: string }
  | { kind: "VERIFICATION_FAILURE"; error: BootstrapVerificationFailure };
export type BootstrapResult = BootstrapResultV1 | BootstrapResultV2;
export type BootstrapPolicyUnavailableReason =
  | "NOT_AUTHORIZED"
  | "CACHE_INVALID"
  | "CACHE_EXPIRED"
  | "NO_MATCHING_CACHE"
  | "NETWORK_TRANSPORT"
  | "CLOCK_UNSAFE"
  | "SERVER_TIME_ROLLBACK"
  | "INVALID_LIVE_FRESHNESS"
  | "SECURITY_FAILURE"
  | "HTTP_ERROR"
  | "AUTHORIZATION_DENIED"
  | "TERMINALLY_INVALIDATED"
  | "CACHE_STATE_PERSISTENCE_FAILED";
export type BootstrapPolicyResult =
  | SignedOperationalResult
  | {
      kind: "UNAVAILABLE";
      reason: BootstrapPolicyUnavailableReason;
      status?: number;
      error?: string;
    };
export type ClientClock = {
  wallNow: () => Date;
  monotonicNowMs: () => number;
};
export type BootstrapPolicyRequest = Omit<
  BootstrapRequestV1,
  "deviceId" | "lastConfigVersion"
> & { detectedAi?: BootstrapRequestV1["detectedAi"] | null };
export type BootstrapAutoSelectionResult =
  | (SignedOperationalResult & { binding: SimulatedAiBinding | null })
  | Extract<BootstrapPolicyResult, { kind: "UNAVAILABLE" }>;
function validOrigin(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("invalid origin");
    return url.origin;
  } catch {
    throw new Error("invalid origin");
  }
}
export class SimulatedExtensionClient {
  private credentials?: Credentials;
  readonly controlPlaneApiOrigin: string;
  readonly portalOrigin: string;
  constructor(input: {
    controlPlaneApiOrigin: string;
    portalOrigin: string;
    trustedConfigSigningKeys?: ReadonlyMap<string, KeyObject>;
    fetch?: typeof fetch;
    clock?: ClientClock;
    snapshotStore?: BootstrapSnapshotStore;
    store?: BootstrapSnapshotStore;
  }) {
    this.controlPlaneApiOrigin = validOrigin(input.controlPlaneApiOrigin);
    this.portalOrigin = validOrigin(input.portalOrigin);
    this.trustedConfigSigningKeys = new Map(
      input.trustedConfigSigningKeys ?? [],
    );
    this.fetcher = input.fetch ?? fetch;
    this.clock = input.clock ?? {
      wallNow: () => new Date(),
      monotonicNowMs: () =>
        typeof performance !== "undefined" ? performance.now() : Date.now(),
    };
    this.snapshotStore =
      input.snapshotStore ??
      input.store ??
      new InMemoryBootstrapSnapshotStore();
  }
  private readonly fetcher: typeof fetch;
  private readonly trustedConfigSigningKeys: ReadonlyMap<string, KeyObject>;
  private readonly clock: ClientClock;
  private readonly snapshotStore: BootstrapSnapshotStore;
  private trustedServerTimeHighWatermarkMs?: number;
  private lastObservedWallTimeHighWatermarkMs?: number;
  private runtimeAnchor?: { effectiveNowMs: number; monotonicNowMs: number };
  private effectiveNowHighWatermarkMs?: number;
  async startAuthorization(
    metadata: {
      clientType: "browser_extension";
      browserFamily: "chrome" | "yandex_chromium";
      browserVersion?: string;
      extensionVersion: string;
      deviceLabel?: string;
    },
    idempotencyKey = crypto.randomUUID(),
  ) {
    const response = await this.fetcher(
      `${this.controlPlaneApiOrigin}/v1/device-authorizations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(metadata),
      },
    );
    const value = DeviceAuthorizationStartResponseV1Schema.parse(
      await response.json(),
    );
    return {
      ...value,
      verificationUrl: `${this.portalOrigin}/activate?authorizationId=${value.authorizationId}`,
    };
  }
  async exchange(
    deviceCode: string,
    idempotencyKey: string,
  ): Promise<ExchangeResult> {
    const response = await this.fetcher(
      `${this.controlPlaneApiOrigin}/v1/device-authorizations/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ deviceCode }),
      },
    );
    if (response.ok) {
      const value = DeviceAuthorizationExchangeResponseV1Schema.parse(
        await response.json(),
      );
      this.credentials = {
        deviceId: value.deviceId,
        sessionId: value.sessionId,
        accessToken: value.accessToken,
        accessTokenExpiresAt: value.accessTokenExpiresAt,
        refreshToken: value.refreshToken,
        refreshTokenExpiresAt: value.refreshTokenExpiresAt,
      };
      return { kind: "ACTIVATED" };
    }
    const error = (await response.json().catch(() => ({})))?.error?.code;
    if (error === "DEVICE_AUTH_PENDING")
      return {
        kind: "PENDING",
        retryAfterSeconds: Math.max(
          1,
          Number(response.headers.get("retry-after")) || 5,
        ),
      };
    if (error === "DEVICE_LIMIT_REACHED") return { kind: "LIMIT_REACHED" };
    if (error === "DEVICE_AUTH_CLOSED") return { kind: "CLOSED" };
    if (error === "DEVICE_AUTH_RATE_LIMITED") return { kind: "RATE_LIMITED" };
    return { kind: "INVALID" };
  }
  async pollUntilTerminal(
    deviceCode: string,
    input: {
      idempotencyKey: string;
      expiresAt: Date;
      sleep: (ms: number) => Promise<void>;
      clock: () => Date;
    },
  ): Promise<ExchangeResult> {
    while (input.clock() < input.expiresAt) {
      const result = await this.exchange(deviceCode, input.idempotencyKey);
      if (result.kind !== "PENDING") return result;
      const remaining = input.expiresAt.getTime() - input.clock().getTime();
      if (remaining <= 0) break;
      await input.sleep(
        Math.min(remaining, Math.max(1000, result.retryAfterSeconds * 1000)),
      );
    }
    return { kind: "CLOSED" };
  }
  async refresh(idempotencyKey = crypto.randomUUID()): Promise<boolean> {
    if (!this.credentials) return false;
    const key = this.cacheKey();
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.controlPlaneApiOrigin}/v1/auth/refresh`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({ refreshToken: this.credentials.refreshToken }),
        },
      );
    } catch {
      return false;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (
        response.status === 401 &&
        ApiErrorEnvelopeV1Schema.safeParse(body).success &&
        (body as { error: { code: string } }).error.code ===
          "AUTH_REFRESH_INVALID"
      ) {
        await this.markTerminallyInvalidated(key);
        this.credentials = undefined;
      }
      return false;
    }
    try {
      const value = RefreshResponseV1Schema.parse(await response.json());
      this.credentials = { ...this.credentials, ...value };
      return true;
    } catch {
      return false;
    }
  }

  async bootstrap(
    input: Omit<BootstrapRequestV1, "deviceId">,
  ): Promise<BootstrapResultV1>;
  async bootstrap(
    input: Omit<BootstrapRequestV2, "deviceId">,
  ): Promise<BootstrapResultV2>;
  async bootstrap(
    input:
      | Omit<BootstrapRequestV1, "deviceId">
      | Omit<BootstrapRequestV2, "deviceId">,
  ): Promise<BootstrapResult> {
    if (!this.credentials)
      return { kind: "HTTP_ERROR", status: 401, code: "UNAUTHORIZED" };
    const request =
      input.contractVersion === "control_plane_v2"
        ? BootstrapRequestV2Schema.parse({
            ...input,
            deviceId: this.credentials.deviceId,
          })
        : BootstrapRequestV1Schema.parse({
            ...input,
            deviceId: this.credentials.deviceId,
          });
    const response = await this.fetcher(
      `${this.controlPlaneApiOrigin}/v1/bootstrap`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.credentials.accessToken}`,
        },
        body: JSON.stringify(request),
      },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (response.ok)
        return { kind: "VERIFICATION_FAILURE", error: "INVALID_ENVELOPE" };
      return {
        kind: "HTTP_ERROR",
        status: response.status,
        code: "HTTP_ERROR",
      };
    }
    if (!response.ok) {
      const error = ApiErrorEnvelopeV1Schema.safeParse(body);
      return {
        kind: "HTTP_ERROR",
        status: response.status,
        code: error.success ? error.data.error.code : "HTTP_ERROR",
      };
    }
    if (request.contractVersion === "control_plane_v2") {
      const envelope = SignedBootstrapEnvelopeV2Schema.safeParse(body);
      if (!envelope.success)
        return { kind: "VERIFICATION_FAILURE", error: "INVALID_ENVELOPE" };
      const verified = verifyBootstrapEnvelopeV2(
        envelope.data,
        this.trustedConfigSigningKeys,
      );
      return verified.ok
        ? {
            kind: "VERIFIED",
            payload: verified.payload,
            envelope: envelope.data,
          }
        : { kind: "VERIFICATION_FAILURE", error: verified.error };
    }
    const envelope = SignedBootstrapEnvelopeV1Schema.safeParse(body);
    if (!envelope.success)
      return { kind: "VERIFICATION_FAILURE", error: "INVALID_ENVELOPE" };
    const verified = verifyBootstrapEnvelope(
      envelope.data,
      this.trustedConfigSigningKeys,
    );
    return verified.ok
      ? { kind: "VERIFIED", payload: verified.payload, envelope: envelope.data }
      : { kind: "VERIFICATION_FAILURE", error: verified.error };
  }

  async bootstrapWithPolicy(
    input: BootstrapPolicyRequest,
  ): Promise<BootstrapPolicyResult> {
    if (!this.credentials)
      return { kind: "UNAVAILABLE", reason: "NOT_AUTHORIZED" };

    const context = normalizeRequestContext(input);
    const key: BootstrapSnapshotStoreKey = {
      controlPlaneApiOrigin: this.controlPlaneApiOrigin,
      deviceId: this.credentials.deviceId,
      sessionId: this.credentials.sessionId,
      contractVersion: context.contractVersion,
    };
    const cacheState = await this.loadCacheState(key, context);
    const liveRequest = {
      ...input,
      detectedAi: context.detectedAi ?? undefined,
      lastConfigVersion: cacheState.matching?.payload.configVersion ?? null,
    };

    let live: BootstrapResult = {
      kind: "HTTP_ERROR",
      status: 503,
      code: "HTTP_ERROR",
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        live = await this.bootstrap(liveRequest);
      } catch {
        if (
          !cacheState.matching &&
          cacheState.reason === "NO_MATCHING_CACHE" &&
          !cacheState.contextMismatch &&
          !cacheState.terminallyInvalidated
        )
          return { kind: "UNAVAILABLE", reason: "NETWORK_TRANSPORT" };
        return this.useOfflineCache(
          cacheState.matching,
          key,
          cacheState.reason,
          context,
          cacheState.terminallyInvalidated,
          "NETWORK_TRANSPORT",
          cacheState.contextMismatch,
        );
      }
      if (live.kind !== "HTTP_ERROR") break;
      if (
        live.status === 401 &&
        live.code === "UNAUTHORIZED" &&
        attempt === 0
      ) {
        if (await this.refresh()) continue;
        await this.markTerminallyInvalidated(key);
        this.credentials = undefined;
        return {
          kind: "UNAVAILABLE",
          reason: "AUTHORIZATION_DENIED",
          status: live.status,
          error: live.code,
        };
      }
      if (live.status === 401 || live.status === 403) {
        await this.markTerminallyInvalidated(key);
        this.credentials = undefined;
        return {
          kind: "UNAVAILABLE",
          reason: "AUTHORIZATION_DENIED",
          status: live.status,
          error: live.code,
        };
      }
      if (live.status === 503 && cacheState.matching)
        return this.useOfflineCache(
          cacheState.matching,
          key,
          cacheState.reason,
          context,
          cacheState.terminallyInvalidated,
          "SERVER_TRANSIENT",
        );
      return {
        kind: "UNAVAILABLE",
        reason: "HTTP_ERROR",
        status: live.status,
        error: live.code,
      };
    }
    if (live.kind === "VERIFICATION_FAILURE")
      return {
        kind: "UNAVAILABLE",
        reason: "SECURITY_FAILURE",
        error: live.error,
      };

    if (live.kind !== "VERIFIED")
      return { kind: "UNAVAILABLE", reason: "HTTP_ERROR" };
    const liveAi = this.validateAi(live.payload, context);
    if (!liveAi.ok)
      return {
        kind: "UNAVAILABLE",
        reason: "SECURITY_FAILURE",
        error: liveAi.error,
      };

    const payloadServerTimeMs = Date.parse(live.payload.serverTime);
    const expiresAtMs = Date.parse(live.payload.expiresAt);
    if (
      !Number.isFinite(payloadServerTimeMs) ||
      !Number.isFinite(expiresAtMs) ||
      payloadServerTimeMs >= expiresAtMs
    )
      return {
        kind: "UNAVAILABLE",
        reason: "INVALID_LIVE_FRESHNESS",
      };
    if (
      this.trustedServerTimeHighWatermarkMs !== undefined &&
      payloadServerTimeMs < this.trustedServerTimeHighWatermarkMs
    )
      return {
        kind: "UNAVAILABLE",
        reason: "SERVER_TIME_ROLLBACK",
      };

    this.anchorLiveTime(payloadServerTimeMs);
    const record: BootstrapCacheRecord = {
      cacheVersion: "bootstrap_cache_v1",
      controlPlaneApiOrigin: this.controlPlaneApiOrigin,
      deviceId: this.credentials.deviceId,
      sessionId: this.credentials.sessionId,
      requestContext: context,
      envelope: live.envelope,
      trustedServerTimeHighWatermark: new Date(
        this.trustedServerTimeHighWatermarkMs!,
      ).toISOString(),
      lastObservedWallTimeHighWatermark: new Date(
        this.lastObservedWallTimeHighWatermarkMs!,
      ).toISOString(),
    };
    try {
      await this.snapshotStore.save(key, record);
    } catch {
      // A cache is an availability aid; it is never authority over live policy.
    }
    return {
      kind: resolveClientCompatibility(live.payload),
      source: "LIVE",
      freshness: "FRESH",
      payload: live.payload,
    };
  }

  /** Normal simulated UX: detect the tab, bootstrap, then bind automatically. */
  async bootstrapDetectedTabWithPolicy(
    tab: SimulatedPackagedTab,
    input: Omit<BootstrapPolicyRequest, "detectedAi">,
  ): Promise<BootstrapAutoSelectionResult> {
    const detectedAi = detectSimulatedPackagedAi(tab);
    const result = await this.bootstrapWithPolicy({
      ...input,
      detectedAi: detectedAi ?? undefined,
    });
    if (result.kind === "UNAVAILABLE") return result;
    const binding = this.validateAi(result.payload, {
      detectedAi,
      contractVersion: input.contractVersion,
      extensionVersion: input.extensionVersion,
      browser: input.browser,
    });
    return binding.ok
      ? { ...result, binding: binding.binding }
      : {
          kind: "UNAVAILABLE",
          reason: "SECURITY_FAILURE",
          error: binding.error,
        };
  }

  private async loadCacheState(
    key: BootstrapSnapshotStoreKey,
    context: BootstrapRequestContext,
  ): Promise<{
    matching?: ValidatedBootstrapCache;
    reason: "CACHE_INVALID" | "NO_MATCHING_CACHE";
    terminallyInvalidated?: boolean;
    contextMismatch?: boolean;
  }> {
    let raw: unknown;
    try {
      raw = await this.snapshotStore.load(key);
    } catch {
      return { reason: "NO_MATCHING_CACHE" };
    }
    if (raw === undefined) return { reason: "NO_MATCHING_CACHE" };
    if (isTerminallyInvalidatedCache(raw, key))
      return { reason: "NO_MATCHING_CACHE", terminallyInvalidated: true };
    const validated = validateBootstrapCacheRecord(
      raw,
      key,
      this.trustedConfigSigningKeys,
    );
    if (!validated.ok) {
      await this.removeCache(key);
      return { reason: "CACHE_INVALID" };
    }
    this.trustedServerTimeHighWatermarkMs = Math.max(
      this.trustedServerTimeHighWatermarkMs ?? -Infinity,
      validated.value.trustedServerTimeHighWatermarkMs,
    );
    this.lastObservedWallTimeHighWatermarkMs = Math.max(
      this.lastObservedWallTimeHighWatermarkMs ?? -Infinity,
      validated.value.lastObservedWallTimeHighWatermarkMs,
    );
    return requestContextsEqual(validated.value.record.requestContext, context)
      ? { matching: validated.value, reason: "NO_MATCHING_CACHE" }
      : { reason: "NO_MATCHING_CACHE", contextMismatch: true };
  }

  private async useOfflineCache(
    cached: ValidatedBootstrapCache | undefined,
    key: BootstrapSnapshotStoreKey,
    noCacheReason: "CACHE_INVALID" | "NO_MATCHING_CACHE",
    context: BootstrapRequestContext,
    terminallyInvalidated = false,
    fallbackTrigger: OfflineFallbackTrigger = "NETWORK_TRANSPORT",
    contextMismatch = false,
  ): Promise<BootstrapPolicyResult> {
    if (!cached)
      return {
        kind: "UNAVAILABLE",
        reason: terminallyInvalidated
          ? "TERMINALLY_INVALIDATED"
          : contextMismatch
            ? noCacheReason
            : fallbackTrigger === "NETWORK_TRANSPORT" &&
                noCacheReason === "NO_MATCHING_CACHE"
              ? "NETWORK_TRANSPORT"
              : noCacheReason,
      };
    const ai = this.validateAi(cached.payload, {
      detectedAi: context.detectedAi,
      contractVersion: context.contractVersion,
      extensionVersion: context.extensionVersion,
      browser: context.browser,
    });
    if (!ai.ok)
      return {
        kind: "UNAVAILABLE",
        reason: "SECURITY_FAILURE",
        error: ai.error,
      };
    const monotonicNowMs = this.clock.monotonicNowMs();
    if (
      this.runtimeAnchor &&
      monotonicNowMs < this.runtimeAnchor.monotonicNowMs
    )
      return { kind: "UNAVAILABLE", reason: "CLOCK_UNSAFE" };
    const wallNowMs = this.clock.wallNow().getTime();
    if (!Number.isFinite(wallNowMs))
      return { kind: "UNAVAILABLE", reason: "CLOCK_UNSAFE" };
    const runtimeNowMs = this.runtimeAnchor
      ? this.runtimeAnchor.effectiveNowMs +
        (monotonicNowMs - this.runtimeAnchor.monotonicNowMs)
      : -Infinity;
    const effectiveNowMs = Math.max(
      cached.trustedServerTimeHighWatermarkMs,
      cached.lastObservedWallTimeHighWatermarkMs,
      wallNowMs,
      runtimeNowMs,
      this.effectiveNowHighWatermarkMs ?? -Infinity,
    );
    const observedEffectiveNowMs = Math.max(
      cached.trustedServerTimeHighWatermarkMs,
      cached.persistedEffectiveTimeHighWatermarkMs,
      this.effectiveNowHighWatermarkMs ?? -Infinity,
    );
    const decision = evaluateCachedBootstrapEligibility({
      verification: { ok: true, payload: cached.payload },
      cachedContext: cached.record.requestContext,
      currentContext: context,
      effectiveNowMs,
      observedEffectiveNowMs,
      fallbackTrigger,
      terminallyInvalidated,
    });
    if (decision.decision === "DENY") {
      if (decision.reason === "TERMINALLY_INVALIDATED")
        return { kind: "UNAVAILABLE", reason: "TERMINALLY_INVALIDATED" };
      if (decision.reason === "CLOCK_ROLLBACK")
        return { kind: "UNAVAILABLE", reason: "CLOCK_UNSAFE" };
      if (decision.reason === "CACHE_EXPIRED") {
        this.effectiveNowHighWatermarkMs = effectiveNowMs;
        if (this.runtimeAnchor)
          this.runtimeAnchor = { effectiveNowMs, monotonicNowMs };
        if (!(await this.persistEffectiveTimeHighWatermark(cached, key)))
          return {
            kind: "UNAVAILABLE",
            reason: "CACHE_STATE_PERSISTENCE_FAILED",
          };
        return { kind: "UNAVAILABLE", reason: "CACHE_EXPIRED" };
      }
      return {
        kind: "UNAVAILABLE",
        reason:
          decision.reason === "CONTEXT_MISMATCH"
            ? "NO_MATCHING_CACHE"
            : "SECURITY_FAILURE",
        error: decision.reason,
      };
    }
    this.effectiveNowHighWatermarkMs = effectiveNowMs;
    if (this.runtimeAnchor)
      this.runtimeAnchor = { effectiveNowMs, monotonicNowMs };
    if (!(await this.persistEffectiveTimeHighWatermark(cached, key)))
      return {
        kind: "UNAVAILABLE",
        reason: "CACHE_STATE_PERSISTENCE_FAILED",
      };
    return {
      kind: resolveClientCompatibility(
        decision.payload as BootstrapSnapshotPayloadV1,
      ),
      source: "CACHE",
      freshness: decision.freshness === "FRESH" ? "FRESH" : "OFFLINE_GRACE",
      payload: decision.payload as BootstrapSnapshotPayloadV1,
    };
  }

  private cacheKey(): BootstrapSnapshotStoreKey {
    if (!this.credentials) throw new Error("credentials are absent");
    return {
      controlPlaneApiOrigin: this.controlPlaneApiOrigin,
      deviceId: this.credentials.deviceId,
      sessionId: this.credentials.sessionId,
      contractVersion: "control_plane_v1",
    };
  }

  private async markTerminallyInvalidated(
    key: BootstrapSnapshotStoreKey,
  ): Promise<boolean> {
    try {
      await this.snapshotStore.markTerminallyInvalidated(key);
      return true;
    } catch {
      // Removal is a bounded fail-closed fallback for stores that cannot
      // establish the terminal marker. A later restart then has no cache to
      // bypass the observed terminal online result.
      try {
        await this.snapshotStore.remove(key);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async persistEffectiveTimeHighWatermark(
    cached: ValidatedBootstrapCache,
    key: BootstrapSnapshotStoreKey,
  ): Promise<boolean> {
    const persistedFloorMs = cached.persistedEffectiveTimeHighWatermarkMs;
    const effectiveNowMs = this.effectiveNowHighWatermarkMs!;
    if (effectiveNowMs <= persistedFloorMs) return true;
    try {
      await this.snapshotStore.save(key, {
        ...cached.record,
        // This local metadata is the durable effective-time floor. The
        // signed envelope and its signed deadlines remain byte-for-byte
        // unchanged.
        lastObservedWallTimeHighWatermark: new Date(
          effectiveNowMs,
        ).toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  private validateAi(
    payload: BootstrapSnapshotPayloadV1,
    context: ClientAiBindingContext,
  ) {
    return validateAndBindBootstrapAi(payload, context);
  }

  private anchorLiveTime(payloadServerTimeMs: number): number {
    const wallNowMs = this.clock.wallNow().getTime();
    const safeWallNowMs = Number.isFinite(wallNowMs) ? wallNowMs : -Infinity;
    this.trustedServerTimeHighWatermarkMs = Math.max(
      this.trustedServerTimeHighWatermarkMs ?? -Infinity,
      payloadServerTimeMs,
    );
    this.lastObservedWallTimeHighWatermarkMs = Math.max(
      this.lastObservedWallTimeHighWatermarkMs ?? -Infinity,
      safeWallNowMs,
      this.trustedServerTimeHighWatermarkMs,
    );
    const effectiveNowMs = Math.max(
      this.trustedServerTimeHighWatermarkMs,
      this.lastObservedWallTimeHighWatermarkMs,
      safeWallNowMs,
      this.effectiveNowHighWatermarkMs ?? -Infinity,
    );
    const monotonicNowMs = this.clock.monotonicNowMs();
    this.runtimeAnchor = { effectiveNowMs, monotonicNowMs };
    this.effectiveNowHighWatermarkMs = effectiveNowMs;
    return effectiveNowMs;
  }

  private async removeCache(key: BootstrapSnapshotStoreKey): Promise<void> {
    try {
      await this.snapshotStore.remove(key);
    } catch {
      // Removal is best effort; a later load still verifies before use.
    }
  }
}
