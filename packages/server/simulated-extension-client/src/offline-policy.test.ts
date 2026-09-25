import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  BootstrapSnapshotPayloadV1,
  BootstrapSnapshotPayloadV2,
} from "@product/contracts";
import {
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
  verifyBootstrapEnvelope,
  verifyBootstrapEnvelopeV2,
} from "@product/remote-config";
import {
  evaluateCachedBootstrapEligibility,
  type OfflineClientContext,
} from "./offline-policy.js";

const key = generateKeyPairSync("ed25519");
const context: OfflineClientContext = {
  contractVersion: "control_plane_v1",
  extensionVersion: "1.0.0",
  browser: { family: "chrome", version: "123" },
};

function payload(
  changes: Partial<BootstrapSnapshotPayloadV1> = {},
): BootstrapSnapshotPayloadV1 {
  return {
    snapshotVersion: "bootstrap_snapshot_v1",
    contractVersion: "control_plane_v1",
    configVersion: 1,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:05:00.000Z",
    offlineGraceUntil: "2026-01-01T00:10:00.000Z",
    serverTime: "2026-01-01T00:00:00.000Z",
    account: { status: "ACTIVE" },
    subscription: { state: "NONE", planRevision: null },
    devicePolicy: { status: "ACTIVE" },
    compatibility: {
      extension: { status: "SUPPORTED", minimumVersion: null },
      browser: { status: "SUPPORTED" },
    },
    entitlements: {},
    features: {},
    ai: { status: "UNCONFIGURED" },
    ...changes,
  };
}

function verified(value = payload()) {
  const envelope = signBootstrapSnapshot(value, "k1", key.privateKey);
  return {
    ok: true as const,
    payload: verifyBootstrapEnvelope(envelope, new Map([["k1", key.publicKey]]))
      .ok
      ? value
      : payload(),
  };
}

function decision(
  value = payload(),
  overrides: Partial<
    Parameters<typeof evaluateCachedBootstrapEligibility>[0]
  > = {},
) {
  return evaluateCachedBootstrapEligibility({
    verification: verified(value),
    cachedContext: context,
    currentContext: context,
    effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
    fallbackTrigger: "NETWORK_TRANSPORT",
    ...overrides,
  });
}

describe("I1-SRV.4 offline policy primitive", () => {
  it("requires a successful strict verification result before policy evaluation", () => {
    expect(
      evaluateCachedBootstrapEligibility({
        verification: { ok: false, error: "UNKNOWN_SIGNING_KEY" },
        cachedContext: context,
        currentContext: context,
        effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
        fallbackTrigger: "NETWORK_TRANSPORT",
      }),
    ).toEqual({ decision: "DENY", reason: "UNVERIFIED_SNAPSHOT" });
  });

  it("preserves strict V1/V2 and signed account identity verification", () => {
    const v1 = signBootstrapSnapshot(payload(), "k1", key.privateKey);
    expect(
      verifyBootstrapEnvelope(v1, new Map([["k1", key.publicKey]])).ok,
    ).toBe(true);
    const v2Payload = {
      ...payload(),
      snapshotVersion: "bootstrap_snapshot_v2" as const,
      contractVersion: "control_plane_v2" as const,
      account: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        status: "ACTIVE" as const,
      },
    };
    const v2 = signBootstrapSnapshotV2(v2Payload, "k1", key.privateKey);
    expect(
      verifyBootstrapEnvelopeV2(v2, new Map([["k1", key.publicKey]])).ok,
    ).toBe(true);
    expect(
      verifyBootstrapEnvelope(v2, new Map([["k1", key.publicKey]])).ok,
    ).toBe(false);
    const tampered = {
      ...v2,
      payload: Buffer.from(
        JSON.stringify({
          ...v2Payload,
          account: {
            ...v2Payload.account,
            id: "123e4567-e89b-42d3-a456-426614174001",
          },
        }),
      ).toString("base64url"),
    };
    expect(
      verifyBootstrapEnvelopeV2(tampered, new Map([["k1", key.publicKey]])),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("evaluates a real successful V2 verification result without changing signed identity", () => {
    const v2Payload = {
      ...payload(),
      snapshotVersion: "bootstrap_snapshot_v2" as const,
      contractVersion: "control_plane_v2" as const,
      account: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        status: "ACTIVE" as const,
      },
    };
    const envelope = signBootstrapSnapshotV2(v2Payload, "k1", key.privateKey);
    const verification = verifyBootstrapEnvelopeV2(
      envelope,
      new Map([["k1", key.publicKey]]),
    );
    expect(verification).toMatchObject({ ok: true });
    if (!verification.ok) throw new Error("V2 fixture did not verify");
    const v2Context = {
      ...context,
      contractVersion: "control_plane_v2" as const,
    };
    expect(
      evaluateCachedBootstrapEligibility({
        verification,
        cachedContext: v2Context,
        currentContext: v2Context,
        effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
        observedEffectiveNowMs: Date.parse("2026-01-01T00:00:00.000Z"),
        fallbackTrigger: "NETWORK_TRANSPORT",
      }),
    ).toMatchObject({
      decision: "ALLOW",
      payload: { account: { id: v2Payload.account.id } },
    });

    const tampered = {
      ...envelope,
      payload: Buffer.from(
        JSON.stringify({
          ...v2Payload,
          account: {
            ...v2Payload.account,
            id: "123e4567-e89b-42d3-a456-426614174001",
          },
        }),
      ).toString("base64url"),
    };
    const tamperedVerification = verifyBootstrapEnvelopeV2(
      tampered,
      new Map([["k1", key.publicKey]]),
    );
    expect(tamperedVerification).toEqual({
      ok: false,
      error: "INVALID_SIGNATURE",
    });
    expect(
      evaluateCachedBootstrapEligibility({
        verification: tamperedVerification,
        cachedContext: v2Context,
        currentContext: v2Context,
        effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
        fallbackTrigger: "NETWORK_TRANSPORT",
      }),
    ).toEqual({ decision: "DENY", reason: "UNVERIFIED_SNAPSHOT" });
  });

  it("keeps privacy-neutral offline capability checks fail-closed without local feature materialization", () => {
    const {
      compatibility: _compatibility,
      features: _features,
      ai: _ai,
      ...common
    } = payload({ entitlements: { "source.ozon": true } });
    void _compatibility;
    void _features;
    void _ai;
    const neutralPayload: BootstrapSnapshotPayloadV2 = {
      ...common,
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      account: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        status: "ACTIVE",
      },
      localClientAuthority: {
        schemaVersion: "local_client_authority_v1",
        contractVersion: "control_plane_v2",
        compatibility: { releases: [], policies: [] },
        featureRules: [
          {
            featureKey: "feature.local-only",
            revision: 1,
            contractVersion: "control_plane_v2",
            enabled: true,
            browserFamily: null,
            minimumExtensionVersion: null,
          },
        ],
        ai: { status: "UNCONFIGURED" },
      },
    };
    const envelope = signBootstrapSnapshotV2(
      neutralPayload,
      "k1",
      key.privateKey,
    );
    const verification = verifyBootstrapEnvelopeV2(
      envelope,
      new Map([["k1", key.publicKey]]),
    );
    if (!verification.ok) throw new Error("neutral V2 fixture did not verify");
    const v2Context = {
      ...context,
      contractVersion: "control_plane_v2" as const,
    };
    const commonInput = {
      verification,
      cachedContext: v2Context,
      currentContext: v2Context,
      effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
      fallbackTrigger: "NETWORK_TRANSPORT" as const,
    };
    expect(
      evaluateCachedBootstrapEligibility({
        ...commonInput,
        localPackagedCapabilities: new Set(["source.ozon"]),
        requestedCapabilities: ["source.ozon"],
      }),
    ).toMatchObject({
      decision: "ALLOW",
      effectiveFeatures: { "source.ozon": true },
    });
    expect(
      evaluateCachedBootstrapEligibility({
        ...commonInput,
        localPackagedCapabilities: new Set(["feature.local-only"]),
        requestedCapabilities: ["feature.local-only"],
      }),
    ).toEqual({ decision: "DENY", reason: "SIGNED_CAPABILITY_DENIED" });
  });

  it.each([
    ["before expiry", "2026-01-01T00:04:59.999Z", "FRESH"],
    [
      "at expiry",
      "2026-01-01T00:05:00.000Z",
      "STALE_BUT_OFFLINE_GRACE_ELIGIBLE",
    ],
    [
      "before grace end",
      "2026-01-01T00:09:59.999Z",
      "STALE_BUT_OFFLINE_GRACE_ELIGIBLE",
    ],
  ] as const)("uses half-open time boundary: %s", (_name, now, freshness) => {
    expect(
      decision(payload(), { effectiveNowMs: Date.parse(now) }),
    ).toMatchObject({ decision: "ALLOW", freshness });
  });

  it("denies exactly at offlineGraceUntil and after it", () => {
    for (const now of ["2026-01-01T00:10:00.000Z", "2026-01-01T00:10:00.001Z"])
      expect(decision(payload(), { effectiveNowMs: Date.parse(now) })).toEqual({
        decision: "DENY",
        reason: "CACHE_EXPIRED",
      });
  });

  it("rejects effective-time rollback and terminal invalidation", () => {
    expect(
      decision(payload(), {
        effectiveNowMs: Date.parse("2026-01-01T00:01:00.000Z"),
        observedEffectiveNowMs: Date.parse("2026-01-01T00:02:00.000Z"),
      }),
    ).toEqual({ decision: "DENY", reason: "CLOCK_ROLLBACK" });
    expect(decision(payload(), { terminallyInvalidated: true })).toEqual({
      decision: "DENY",
      reason: "TERMINALLY_INVALIDATED",
    });
  });

  it("requires exact extension, browser family/version, and contract context", () => {
    for (const currentContext of [
      { ...context, extensionVersion: "2.0.0" },
      {
        ...context,
        browser: { family: "yandex_chromium" as const, version: "123" },
      },
      { ...context, browser: { family: "chrome" as const, version: "124" } },
      { ...context, contractVersion: "control_plane_v2" as const },
    ])
      expect(decision(payload(), { currentContext })).toEqual({
        decision: "DENY",
        reason: "CONTEXT_MISMATCH",
      });
  });

  it("intersects signed capabilities with the local packaged set", () => {
    const signed = payload({ features: { analytics: true, disabled: false } });
    expect(
      decision(signed, {
        localPackagedCapabilities: new Set(["analytics"]),
        requestedCapabilities: ["analytics"],
      }),
    ).toMatchObject({
      decision: "ALLOW",
      effectiveFeatures: { analytics: true },
    });
    expect(
      decision(signed, {
        localPackagedCapabilities: new Set(["analytics", "disabled"]),
        requestedCapabilities: ["disabled"],
      }),
    ).toEqual({ decision: "DENY", reason: "SIGNED_CAPABILITY_DENIED" });
    expect(
      decision(signed, {
        localPackagedCapabilities: new Set(),
        requestedCapabilities: ["analytics"],
      }),
    ).toEqual({ decision: "DENY", reason: "LOCAL_CAPABILITY_NOT_PACKAGED" });
    expect(
      decision(payload({ entitlements: { analytics: true } }), {
        localPackagedCapabilities: new Set(["analytics"]),
        requestedCapabilities: ["analytics"],
      }),
    ).toMatchObject({ decision: "ALLOW" });
  });

  it("allows only network transport and audited transient server triggers", () => {
    expect(decision().decision).toBe("ALLOW");
    expect(
      decision(payload(), { fallbackTrigger: "SERVER_TRANSIENT" }),
    ).toMatchObject({ decision: "ALLOW" });
  });
});
