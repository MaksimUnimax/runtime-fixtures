import type { BrowserFamily } from "@product/shared";
import type { BootstrapSnapshotPayload } from "@product/contracts";
import type {
  VerifyBootstrapEnvelopeResult,
  VerifyBootstrapEnvelopeV2Result,
} from "@product/remote-config";

export type OfflineFallbackTrigger = "NETWORK_TRANSPORT" | "SERVER_TRANSIENT";

export type OfflineClientContext = {
  contractVersion: BootstrapSnapshotPayload["contractVersion"];
  extensionVersion: string;
  browser: {
    family: BrowserFamily;
    version: string;
  };
};

export type VerifiedBootstrapSnapshot =
  | VerifyBootstrapEnvelopeResult
  | VerifyBootstrapEnvelopeV2Result;

export type OfflineBootstrapDecisionReason =
  | "UNVERIFIED_SNAPSHOT"
  | "TERMINALLY_INVALIDATED"
  | "CONTEXT_MISMATCH"
  | "CLOCK_UNSAFE"
  | "CLOCK_ROLLBACK"
  | "FALLBACK_TRIGGER_NOT_ELIGIBLE"
  | "CACHE_EXPIRED"
  | "LOCAL_CAPABILITY_NOT_PACKAGED"
  | "SIGNED_CAPABILITY_DENIED";

export type OfflineBootstrapDecision =
  | {
      decision: "ALLOW";
      freshness: "FRESH" | "STALE_BUT_OFFLINE_GRACE_ELIGIBLE";
      payload: BootstrapSnapshotPayload;
      effectiveFeatures: Record<string, boolean>;
    }
  | {
      decision: "DENY";
      reason: OfflineBootstrapDecisionReason;
    };

/**
 * Pure policy gate for a previously verified signed bootstrap snapshot.
 * Signature verification and strict V1/V2 parsing remain owned by
 * @product/remote-config; this function deliberately accepts their result.
 */
export function evaluateCachedBootstrapEligibility(input: {
  verification: VerifiedBootstrapSnapshot;
  cachedContext: OfflineClientContext;
  currentContext: OfflineClientContext;
  effectiveNowMs: number;
  observedEffectiveNowMs?: number;
  fallbackTrigger: OfflineFallbackTrigger;
  terminallyInvalidated?: boolean;
  localPackagedCapabilities?: ReadonlySet<string>;
  requestedCapabilities?: readonly string[];
}): OfflineBootstrapDecision {
  if (!input.verification.ok)
    return { decision: "DENY", reason: "UNVERIFIED_SNAPSHOT" };
  if (input.terminallyInvalidated)
    return { decision: "DENY", reason: "TERMINALLY_INVALIDATED" };
  if (!sameContext(input.cachedContext, input.currentContext))
    return { decision: "DENY", reason: "CONTEXT_MISMATCH" };
  if (!Number.isFinite(input.effectiveNowMs))
    return { decision: "DENY", reason: "CLOCK_UNSAFE" };
  if (
    input.observedEffectiveNowMs !== undefined &&
    (!Number.isFinite(input.observedEffectiveNowMs) ||
      input.effectiveNowMs < input.observedEffectiveNowMs)
  )
    return { decision: "DENY", reason: "CLOCK_ROLLBACK" };
  if (
    input.fallbackTrigger !== "NETWORK_TRANSPORT" &&
    input.fallbackTrigger !== "SERVER_TRANSIENT"
  )
    return { decision: "DENY", reason: "FALLBACK_TRIGGER_NOT_ELIGIBLE" };

  const expiresAtMs = Date.parse(input.verification.payload.expiresAt);
  const offlineGraceUntilMs = Date.parse(
    input.verification.payload.offlineGraceUntil,
  );
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(offlineGraceUntilMs))
    return { decision: "DENY", reason: "CLOCK_UNSAFE" };
  const freshness =
    input.effectiveNowMs < expiresAtMs
      ? ("FRESH" as const)
      : input.effectiveNowMs < offlineGraceUntilMs
        ? ("STALE_BUT_OFFLINE_GRACE_ELIGIBLE" as const)
        : undefined;
  if (!freshness) return { decision: "DENY", reason: "CACHE_EXPIRED" };

  const packaged = input.localPackagedCapabilities ?? new Set<string>();
  const requested = input.requestedCapabilities ?? [];
  for (const capability of requested) {
    if (!packaged.has(capability))
      return { decision: "DENY", reason: "LOCAL_CAPABILITY_NOT_PACKAGED" };
    if (!signedCapabilityEnabled(input.verification.payload, capability))
      return { decision: "DENY", reason: "SIGNED_CAPABILITY_DENIED" };
  }

  const effectiveFeatures: Record<string, boolean> = {};
  for (const capability of packaged)
    effectiveFeatures[capability] = signedCapabilityEnabled(
      input.verification.payload,
      capability,
    );
  return {
    decision: "ALLOW",
    freshness,
    payload: input.verification.payload,
    effectiveFeatures,
  };
}

function sameContext(
  left: OfflineClientContext,
  right: OfflineClientContext,
): boolean {
  return (
    left.contractVersion === right.contractVersion &&
    left.extensionVersion === right.extensionVersion &&
    left.browser.family === right.browser.family &&
    left.browser.version === right.browser.version
  );
}

function signedCapabilityEnabled(
  payload: BootstrapSnapshotPayload,
  capability: string,
): boolean {
  return Object.hasOwn(payload.features, capability)
    ? payload.features[capability] === true
    : payload.entitlements[capability] === true;
}
