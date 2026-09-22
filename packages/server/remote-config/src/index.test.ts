import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BootstrapRequestV1Schema,
  BootstrapSnapshotPayloadV1Schema,
  type BootstrapSnapshotPayloadV1,
} from "@product/contracts";
import {
  BOOTSTRAP_SIGNATURE_DOMAIN,
  canonicalizeJson,
  createPublicTrustBundle,
  configRolloutSelectionModeV1,
  configReleaseHashes,
  CreateRolloutCommandSchema,
  PersistedSigningKeyReasonCodeSchema,
  SigningKeyEventSchema,
  SigningKeyReasonCommandSchema,
  rolloutBucketV1,
  selectRolloutCandidateV1,
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
  serializePublicTrustBundle,
  verifyBootstrapEnvelope,
  verifyBootstrapEnvelopeV2,
  resolveSigningKeyLifecycle,
  resolveP3BootstrapPolicy,
  type TrustedConfigSigningKeyRing,
} from "./index.js";

describe("P3.3 manifests and cohorts", () => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  it("normalizes manifest source ordering", () => {
    const base = {
      contractVersion: "control_plane_v1" as const,
      snapshotVersion: "bootstrap_snapshot_v1" as const,
      envelopeVersion: "bootstrap_envelope_v1" as const,
      signingKeyId: "config-current",
      compatibilityPolicyRevisionIds: ids,
      featureRuleRevisionIds: [],
      featureRolloutRevisionIds: [],
    };
    expect(configReleaseHashes(base)).toEqual(
      configReleaseHashes({
        ...base,
        compatibilityPolicyRevisionIds: [...ids].reverse(),
      }),
    );
    expect(configReleaseHashes(base).contentHashSha256).not.toBe(
      configReleaseHashes({ ...base, signingKeyId: "config-next" })
        .contentHashSha256,
    );
  });
  it("uses a stable bounded rollout bucket", () => {
    const value = {
      rolloutKey: "feature.example",
      cohortSeed: Buffer.alloc(32, 7),
      subjectKind: "ACCOUNT" as const,
      subjectId: "11111111-1111-4111-8111-111111111111",
    };
    expect(rolloutBucketV1(value)).toBe(rolloutBucketV1(value));
    expect(rolloutBucketV1(value)).toBeGreaterThanOrEqual(0);
    expect(rolloutBucketV1(value)).toBeLessThan(10000);
    expect(
      selectRolloutCandidateV1({ ...value, state: "ACTIVE", percentageBps: 0 }),
    ).toBe(false);
    expect(
      selectRolloutCandidateV1({
        ...value,
        state: "ACTIVE",
        percentageBps: 10000,
      }),
    ).toBe(true);
    expect(
      selectRolloutCandidateV1({
        ...value,
        state: "PAUSED",
        percentageBps: 10000,
      }),
    ).toBe(false);
  });
});

describe("persisted signing-event reason compatibility", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    keyId: "config-current",
    eventType: "REGISTERED" as const,
    occurredAt: new Date("2026-09-21T00:00:00.000Z"),
    createdAt: new Date("2026-09-21T00:00:00.000Z"),
  };

  it.each(["ops.repair-1", null, "PREPROD_CATALOG_REPAIR"])(
    "accepts persisted reason %s",
    (reasonCode) => {
      expect(
        SigningKeyEventSchema.parse({ ...base, reasonCode }).reasonCode,
      ).toBe(reasonCode);
    },
  );

  it.each(["OTHER_UPPERCASE", "MixedCase"])(
    "rejects unapproved uppercase persisted reason %s",
    (reasonCode) => {
      expect(() =>
        PersistedSigningKeyReasonCodeSchema.parse(reasonCode),
      ).toThrow();
      expect(() =>
        SigningKeyEventSchema.parse({ ...base, reasonCode }),
      ).toThrow();
    },
  );

  it("keeps new command validation strict while accepting lowercase reasons", () => {
    expect(() =>
      SigningKeyReasonCommandSchema.parse({
        keyId: "config-current",
        reasonCode: "PREPROD_CATALOG_REPAIR",
      }),
    ).toThrow();
    expect(
      SigningKeyReasonCommandSchema.parse({
        keyId: "config-current",
        reasonCode: "preprod_catalog_repair",
      }).reasonCode,
    ).toBe("preprod_catalog_repair");
  });

  it("resolves historical REGISTERED/ACTIVATED events without changing bytes", () => {
    const historical = [
      SigningKeyEventSchema.parse({
        ...base,
        reasonCode: "PREPROD_CATALOG_REPAIR",
      }),
      SigningKeyEventSchema.parse({
        ...base,
        id: "22222222-2222-4222-8222-222222222222",
        eventType: "ACTIVATED",
        occurredAt: new Date("2026-09-21T00:00:01.000Z"),
        createdAt: new Date("2026-09-21T00:00:01.000Z"),
        reasonCode: null,
      }),
    ];
    expect(resolveSigningKeyLifecycle(historical)).toEqual({ state: "ACTIVE" });
    expect(historical[0]!.reasonCode).toBe("PREPROD_CATALOG_REPAIR");
  });
});

describe("bootstrap.config rollout selection semantics", () => {
  it.each([
    ["ACTIVE", "COHORT"],
    ["PAUSED", "BASELINE_ONLY"],
    ["RETIRED", "ORDINARY_LATEST"],
  ] as const)("maps %s to %s", (state, mode) => {
    expect(configRolloutSelectionModeV1(state)).toBe(mode);
  });
});

describe("version-scoped v2 config selection", () => {
  it("does not admit a second durable config rollout key", () => {
    expect(
      CreateRolloutCommandSchema.safeParse({
        rolloutKey: "bootstrap.config.v2",
        targetKind: "CONFIG_RELEASE",
        subjectKind: "ACCOUNT",
      }).success,
    ).toBe(false);
  });

  it("uses ordinary latest v2 without consulting bootstrap.config", async () => {
    const latest = {
      configVersion: 22,
      contractVersion: "control_plane_v2" as const,
      snapshotVersion: "bootstrap_snapshot_v2" as const,
      envelopeVersion: "bootstrap_envelope_v2" as const,
      contentHashSha256: "a".repeat(64),
      sourceFingerprintSha256: "b".repeat(64),
      signingKeyId: "config-v2",
      publishedAt: new Date("2026-09-04T00:00:00.000Z"),
      createdAt: new Date("2026-09-04T00:00:00.000Z"),
    };
    const findRolloutByKey = vi.fn(() => {
      throw new Error("v2 must not consult bootstrap.config");
    });
    const catalog = {
      findLatestConfigRelease: vi.fn(async (version: string) =>
        version === "control_plane_v2" ? latest : undefined,
      ),
      findRolloutByKey,
      listConfigCompatibilityPolicyRevisions: async () => [],
      listConfigFeatureRules: async () => [],
      listConfigFeatureRolloutRevisions: async () => [],
      findExtensionRelease: async () => undefined,
      listReleaseContracts: async () => [],
      listReleaseBrowsers: async () => [],
      listBlockedVersions: async () => [],
      findConfigRelease: async () => undefined,
      findLatestRolloutRevision: async () => undefined,
      findRolloutById: async () => undefined,
      findFeatureRuleRevision: async () => undefined,
      findFeatureDefinition: async () => undefined,
      findSigningKey: async () => undefined,
      listSigningKeyEvents: async () => [],
      listConfigReleaseCompatibilityPolicies: async () => [],
      listCompatibilityPolicyRevisions: async () => [],
    };
    const result = await resolveP3BootstrapPolicy(
      {
        contractVersion: "control_plane_v2",
        extensionVersion: "1.2.3",
        browser: { family: "chrome", version: "120" },
        accountId: "account-a",
        deviceId: "device-a",
      },
      catalog,
    );
    expect(result).toMatchObject({ configVersion: 22 });
    expect(catalog.findLatestConfigRelease).toHaveBeenCalledWith(
      "control_plane_v2",
    );
    expect(findRolloutByKey).not.toHaveBeenCalled();
  });
});

const payload: BootstrapSnapshotPayloadV1 = {
  snapshotVersion: "bootstrap_snapshot_v1",
  contractVersion: "control_plane_v1",
  configVersion: 1,
  issuedAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-04T00:05:00.000Z",
  offlineGraceUntil: "2026-09-04T00:10:00.000Z",
  serverTime: "2026-09-04T00:00:01.000Z",
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
};

function keyMaterial() {
  const config = generateKeyPairSync("ed25519");
  const previous = generateKeyPairSync("ed25519");
  const access = generateKeyPairSync("ed25519");
  const ring: TrustedConfigSigningKeyRing = new Map([
    ["config-old", previous.publicKey],
    ["config-current", config.publicKey],
  ]);
  return { config, previous, access, ring };
}

describe("canonicalizeJson", () => {
  it("sorts nested keys while preserving array ordering and Unicode", () => {
    const escaped = 'β"\\\n';
    expect(
      canonicalizeJson({
        z: ["β", 2, 1],
        a: { y: true, b: escaped },
      }).toString(),
    ).toBe(`{"a":{"b":${JSON.stringify(escaped)},"y":true},"z":["β",2,1]}`);
    expect(canonicalizeJson({ a: 1, b: 0, c: -2 }).toString()).toBe(
      '{"a":1,"b":0,"c":-2}',
    );
  });

  it("rejects values outside the narrow canonical JSON domain", () => {
    const custom = Object.create({ inherited: true });
    expect(() => canonicalizeJson(-0)).toThrow();
    expect(() => canonicalizeJson(1.5)).toThrow();
    expect(() => canonicalizeJson(Number.NaN)).toThrow();
    expect(() => canonicalizeJson(Infinity)).toThrow();
    expect(() => canonicalizeJson(1n)).toThrow();
    expect(() => canonicalizeJson(undefined)).toThrow();
    expect(() => canonicalizeJson(() => undefined)).toThrow();
    expect(() => canonicalizeJson(Symbol("invalid"))).toThrow();
    expect(() => canonicalizeJson(new Date())).toThrow();
    expect(() => canonicalizeJson(new Map())).toThrow();
    expect(() => canonicalizeJson(new Set())).toThrow();
    expect(() => canonicalizeJson(custom)).toThrow();
  });
});

describe("bootstrap public trust handoff", () => {
  function metadata(
    keyId: string,
    pair: ReturnType<typeof generateKeyPairSync>,
  ) {
    const publicKeySpkiDer = pair.publicKey.export({
      format: "der",
      type: "spki",
    });
    return {
      keyId,
      algorithm: "Ed25519" as const,
      publicKeySpkiDer,
      publicKeySha256: createHash("sha256")
        .update(publicKeySpkiDer)
        .digest("hex"),
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    };
  }

  function entry(
    keyId: string,
    pair: ReturnType<typeof generateKeyPairSync>,
    state: "ACTIVE" | "REGISTERED" | "RETIRED" | "REVOKED",
  ) {
    return { metadata: metadata(keyId, pair), lifecycle: { state } } as const;
  }

  it("exports active automatically and retired only when selected", () => {
    const active = generateKeyPairSync("ed25519");
    const retired = generateKeyPairSync("ed25519");
    const retiredOld = generateKeyPairSync("ed25519");
    const registered = generateKeyPairSync("ed25519");
    const revoked = generateKeyPairSync("ed25519");
    const entries = [
      entry("config-retired", retired, "RETIRED"),
      entry("config-retired-old", retiredOld, "RETIRED"),
      entry("config-registered", registered, "REGISTERED"),
      entry("config-revoked", revoked, "REVOKED"),
      entry("config-active", active, "ACTIVE"),
    ];
    const bundle = createPublicTrustBundle(entries, ["config-retired"]);
    expect(bundle.keys.map((key) => key.keyId)).toEqual([
      "config-active",
      "config-retired",
    ]);
    expect(bundle.keys[0]).toMatchObject({
      lifecycle: "ACTIVE",
      trustEligibility: "SIGNING_AND_VERIFICATION",
    });
    expect(bundle.keys[1]).toMatchObject({
      lifecycle: "RETIRED",
      trustEligibility: "VERIFICATION_OVERLAP",
    });
    expect(JSON.stringify(bundle)).not.toMatch(/PRIVATE KEY|privateKey/i);
    expect(serializePublicTrustBundle(bundle)).toEqual(
      serializePublicTrustBundle(
        createPublicTrustBundle([...entries].reverse(), ["config-retired"]),
      ),
    );
    expect(
      createPublicTrustBundle(entries, []).keys.map((key) => key.keyId),
    ).toEqual(["config-active"]);
  });

  it("fails closed for invalid overlap selections", () => {
    const active = generateKeyPairSync("ed25519");
    const retired = generateKeyPairSync("ed25519");
    const registered = generateKeyPairSync("ed25519");
    const revoked = generateKeyPairSync("ed25519");
    const entries = [
      entry("config-active", active, "ACTIVE"),
      entry("config-retired", retired, "RETIRED"),
      entry("config-registered", registered, "REGISTERED"),
      entry("config-revoked", revoked, "REVOKED"),
    ];
    expect(() => createPublicTrustBundle(entries, ["missing"])).toThrow(
      "P3_PUBLIC_TRUST_KEY_UNKNOWN_OVERLAP",
    );
    expect(() => createPublicTrustBundle(entries, ["config-active"])).toThrow(
      "P3_PUBLIC_TRUST_KEY_OVERLAP_NOT_RETIRED",
    );
    expect(() =>
      createPublicTrustBundle(entries, ["config-registered"]),
    ).toThrow("P3_PUBLIC_TRUST_KEY_REGISTERED_OVERLAP");
    expect(() => createPublicTrustBundle(entries, ["config-revoked"])).toThrow(
      "P3_PUBLIC_TRUST_KEY_REVOKED_OVERLAP",
    );
    expect(() =>
      createPublicTrustBundle(entries, ["config-retired", "config-retired"]),
    ).toThrow("P3_PUBLIC_TRUST_KEY_DUPLICATE_OVERLAP");
  });

  it("is deterministic across selector and registry ordering", () => {
    const active = generateKeyPairSync("ed25519");
    const retiredOne = generateKeyPairSync("ed25519");
    const retiredTwo = generateKeyPairSync("ed25519");
    const entries = [
      entry("config-z-retired", retiredTwo, "RETIRED"),
      entry("config-active", active, "ACTIVE"),
      entry("config-a-retired", retiredOne, "RETIRED"),
    ];
    expect(
      serializePublicTrustBundle(
        createPublicTrustBundle(entries, [
          "config-z-retired",
          "config-a-retired",
        ]),
      ),
    ).toEqual(
      serializePublicTrustBundle(
        createPublicTrustBundle(entries.slice().reverse(), [
          "config-a-retired",
          "config-z-retired",
        ]),
      ),
    );
  });

  it("bounds historical retired-key accumulation to the selected overlap", () => {
    const active = generateKeyPairSync("ed25519");
    const historical = Array.from({ length: 10 }, (_, index) =>
      entry(
        `config-retired-${index}`,
        generateKeyPairSync("ed25519"),
        "RETIRED",
      ),
    );
    const bundle = createPublicTrustBundle(
      [entry("config-active", active, "ACTIVE"), ...historical],
      ["config-retired-7"],
    );
    expect(bundle.keys.map((key) => key.keyId)).toEqual([
      "config-active",
      "config-retired-7",
    ]);
  });

  it("verifies active and selected overlap signatures, then rejects omitted overlap", () => {
    const active = generateKeyPairSync("ed25519");
    const retired = generateKeyPairSync("ed25519");
    const entries = [
      entry("config-active", active, "ACTIVE"),
      entry("config-retired", retired, "RETIRED"),
    ];
    const keyRing = (overlapKeyIds: readonly string[]) => {
      const bundle = createPublicTrustBundle(entries, overlapKeyIds);
      return new Map(
        bundle.keys.map((key) => [
          key.keyId,
          createPublicKey({
            key: Buffer.from(key.publicKey, "base64"),
            format: "der",
            type: "spki",
          }),
        ]),
      );
    };
    const overlapRing = keyRing(["config-retired"]);
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-active", active.privateKey),
        overlapRing,
      ).ok,
    ).toBe(true);
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-retired", retired.privateKey),
        overlapRing,
      ).ok,
    ).toBe(true);
    const laterRing = keyRing([]);
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-retired", retired.privateKey),
        laterRing,
      ),
    ).toEqual({ ok: false, error: "UNKNOWN_SIGNING_KEY" });
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-active", active.privateKey),
        laterRing,
      ).ok,
    ).toBe(true);
  });

  it("fails closed for malformed fingerprints and key aliases", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const firstMetadata = metadata("config-one", first);
    expect(() =>
      createPublicTrustBundle(
        [
          {
            metadata: { ...firstMetadata, publicKeySha256: "0".repeat(64) },
            lifecycle: { state: "ACTIVE" },
          },
        ],
        [],
      ),
    ).toThrow("P3_PUBLIC_TRUST_KEY_FINGERPRINT_MISMATCH");
    expect(() =>
      createPublicTrustBundle(
        [
          { metadata: firstMetadata, lifecycle: { state: "ACTIVE" } },
          {
            metadata: {
              ...metadata("config-two", second),
              publicKeySpkiDer: firstMetadata.publicKeySpkiDer,
              publicKeySha256: firstMetadata.publicKeySha256,
            },
            lifecycle: { state: "RETIRED" },
          },
        ],
        ["config-two"],
      ),
    ).toThrow("P3_PUBLIC_TRUST_KEY_ALIAS_CONFLICT");
    expect(() =>
      createPublicTrustBundle(
        [
          {
            metadata: firstMetadata,
            lifecycle: { state: "INVALID", error: "INVALID_LIFECYCLE" },
          },
        ],
        [],
      ),
    ).toThrow("P3_PUBLIC_TRUST_KEY_INVALID_LIFECYCLE");
  });

  it("rejects malformed public keys and unsupported algorithms", () => {
    const pair = generateKeyPairSync("ed25519");
    const value = metadata("config-invalid", pair);
    expect(() =>
      createPublicTrustBundle(
        [
          {
            metadata: { ...value, publicKeySpkiDer: Buffer.from("bad") },
            lifecycle: { state: "ACTIVE" },
          },
        ],
        [],
      ),
    ).toThrow("P3_PUBLIC_TRUST_KEY_INVALID");
    expect(() =>
      createPublicTrustBundle(
        [
          {
            metadata: { ...value, algorithm: "RSA" as "Ed25519" },
            lifecycle: { state: "ACTIVE" },
          },
        ],
        [],
      ),
    ).toThrow();
  });
});

describe("P3.5 signing-key lifecycle", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const event = (
    eventType: "REGISTERED" | "ACTIVATED" | "RETIRED" | "REVOKED",
    n: number,
  ) => ({
    id,
    keyId: "config-key",
    eventType,
    occurredAt: new Date(1_700_000_000_000 + n),
    reasonCode:
      eventType === "RETIRED" || eventType === "REVOKED" ? "ops" : null,
    createdAt: new Date(1_700_000_000_000 + n),
  });
  it.each([
    [[], "UNREGISTERED"],
    [["REGISTERED"], "REGISTERED"],
    [["REGISTERED", "ACTIVATED"], "ACTIVE"],
    [["REGISTERED", "ACTIVATED", "RETIRED"], "RETIRED"],
    [["REGISTERED", "REVOKED"], "REVOKED"],
    [["REGISTERED", "ACTIVATED", "REVOKED"], "REVOKED"],
    [["REGISTERED", "ACTIVATED", "RETIRED", "REVOKED"], "REVOKED"],
  ] as const)("resolves %j as %s", (sequence, state) => {
    expect(
      resolveSigningKeyLifecycle(
        sequence.map((type, n) =>
          event(
            type as "REGISTERED" | "ACTIVATED" | "RETIRED" | "REVOKED",
            n + 1,
          ),
        ),
      ),
    ).toEqual({ state });
  });
  it.each([
    ["ACTIVATED"],
    ["RETIRED"],
    ["REGISTERED", "REGISTERED"],
    ["REGISTERED", "ACTIVATED", "ACTIVATED"],
    ["REGISTERED", "ACTIVATED", "RETIRED", "ACTIVATED"],
    ["REGISTERED", "REVOKED", "ACTIVATED"],
    ["REGISTERED", "ACTIVATED", "REVOKED", "RETIRED"],
    ["REGISTERED", "ACTIVATED", "RETIRED", "RETIRED"],
    ["REGISTERED", "REVOKED", "REVOKED"],
  ] as readonly string[][])(
    "rejects invalid sequence %j",
    (...sequence: string[]) => {
      expect(
        resolveSigningKeyLifecycle(
          sequence.map((type, n) =>
            event(
              type as "REGISTERED" | "ACTIVATED" | "RETIRED" | "REVOKED",
              n + 1,
            ),
          ),
        ),
      ).toEqual({ state: "INVALID", error: "INVALID_LIFECYCLE" });
    },
  );
  it("rejects non-monotonic event ordering", () => {
    expect(
      resolveSigningKeyLifecycle([
        event("REGISTERED", 2),
        event("ACTIVATED", 1),
      ]),
    ).toEqual({ state: "INVALID", error: "INVALID_LIFECYCLE" });
  });
});

describe("bootstrap V1 schemas", () => {
  it("enforces strict request fields and bounded SemVer/machine identifiers", () => {
    const request = {
      contractVersion: "control_plane_v1",
      extensionVersion: "1.2.3-beta.1+build.7",
      browser: { family: "chrome", version: "128.0.1" },
      deviceId: "9dbd5a3f-5ae6-42bd-b9c5-1da0bafdf1b6",
      lastConfigVersion: null,
      detectedAi: { family: "chatgpt", surface: "standard", variant: null },
    };
    expect(BootstrapRequestV1Schema.safeParse(request).success).toBe(true);
    expect(
      BootstrapRequestV1Schema.safeParse({ ...request, extra: true }).success,
    ).toBe(false);
    expect(
      BootstrapRequestV1Schema.safeParse({ ...request, extensionVersion: "v1" })
        .success,
    ).toBe(false);
    expect(
      BootstrapRequestV1Schema.safeParse({
        ...request,
        detectedAi: { family: "ChatGPT", surface: "standard" },
      }).success,
    ).toBe(false);
  });

  it("requires time ordering and the truthful pre-commercial baseline", () => {
    expect(BootstrapSnapshotPayloadV1Schema.safeParse(payload).success).toBe(
      true,
    );
    expect(
      BootstrapSnapshotPayloadV1Schema.safeParse({
        ...payload,
        expiresAt: payload.issuedAt,
      }).success,
    ).toBe(false);
    expect(
      BootstrapSnapshotPayloadV1Schema.safeParse({
        ...payload,
        ai: { status: "HEALTHY" },
      }).success,
    ).toBe(false);
  });
});

describe("signed bootstrap envelope", () => {
  it("signs and verifies a valid, canonical snapshot", () => {
    const { config, ring } = keyMaterial();
    const envelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(verifyBootstrapEnvelope(envelope, ring)).toEqual({
      ok: true,
      payload,
    });
  });

  it("uses a new envelope and snapshot version for account identity", () => {
    const { config, ring } = keyMaterial();
    const v2Payload = {
      ...payload,
      snapshotVersion: "bootstrap_snapshot_v2" as const,
      contractVersion: "control_plane_v2" as const,
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "ACTIVE" as const,
      },
    };
    const envelope = signBootstrapSnapshotV2(
      v2Payload,
      "config-current",
      config.privateKey,
    );
    expect(envelope.envelopeVersion).toBe("bootstrap_envelope_v2");
    expect(verifyBootstrapEnvelopeV2(envelope, ring)).toEqual({
      ok: true,
      payload: v2Payload,
    });
    expect(verifyBootstrapEnvelope(envelope, ring)).toEqual({
      ok: false,
      error: "INVALID_ENVELOPE",
    });
    const v1Envelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(verifyBootstrapEnvelopeV2(v1Envelope, ring)).toEqual({
      ok: false,
      error: "INVALID_ENVELOPE",
    });
  });

  it("rejects V2 payload, signature, key, algorithm, and encoding tampering", () => {
    const { config, previous, ring } = keyMaterial();
    const v2Payload = {
      ...payload,
      snapshotVersion: "bootstrap_snapshot_v2" as const,
      contractVersion: "control_plane_v2" as const,
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "ACTIVE" as const,
      },
    };
    const envelope = signBootstrapSnapshotV2(
      v2Payload,
      "config-current",
      config.privateKey,
    );
    expect(
      verifyBootstrapEnvelopeV2(
        { ...envelope, payload: flipBase64Url(envelope.payload) },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(
      verifyBootstrapEnvelopeV2(
        { ...envelope, signature: flipBase64Url(envelope.signature) },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(
      verifyBootstrapEnvelopeV2({ ...envelope, keyId: "unknown-key" }, ring),
    ).toEqual({ ok: false, error: "UNKNOWN_SIGNING_KEY" });
    expect(
      verifyBootstrapEnvelopeV2({ ...envelope, algorithm: "ES256" }, ring),
    ).toEqual({ ok: false, error: "INVALID_ENVELOPE" });
    expect(
      verifyBootstrapEnvelopeV2(
        { ...envelope, payload: "not+base64url" },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_ENVELOPE" });
    expect(
      verifyBootstrapEnvelopeV2(
        envelope,
        new Map([["config-current", previous.publicKey]]),
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    const changedAccount = {
      ...v2Payload,
      account: {
        id: "22222222-2222-4222-8222-222222222222",
        status: "ACTIVE" as const,
      },
    };
    expect(
      verifyBootstrapEnvelopeV2(
        {
          ...envelope,
          payload: signBootstrapSnapshotV2(
            changedAccount,
            "config-current",
            config.privateKey,
          ).payload,
        },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("canonicalizes semantic objects independently of insertion order", () => {
    expect(canonicalizeJson({ z: { b: 2, a: 1 }, a: [2, 1] })).toEqual(
      canonicalizeJson({ a: [2, 1], z: { a: 1, b: 2 } }),
    );
  });

  it("changes its signature when its payload changes", () => {
    const { config } = keyMaterial();
    const first = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    const second = signBootstrapSnapshot(
      { ...payload, configVersion: 2 },
      "config-current",
      config.privateKey,
    );
    expect(second.signature).not.toBe(first.signature);
  });

  it("rejects payload and signature tampering", () => {
    const { config, ring } = keyMaterial();
    const envelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(
      verifyBootstrapEnvelope(
        { ...envelope, payload: flipBase64Url(envelope.payload) },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(
      verifyBootstrapEnvelope(
        { ...envelope, signature: flipBase64Url(envelope.signature) },
        ring,
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });

  it("fails closed for wrong, unknown, or non-Ed25519 envelope keys", () => {
    const { config, previous, ring } = keyMaterial();
    const envelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(
      verifyBootstrapEnvelope(
        envelope,
        new Map([["config-current", previous.publicKey]]),
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
    expect(
      verifyBootstrapEnvelope({ ...envelope, keyId: "unknown-key" }, ring),
    ).toEqual({ ok: false, error: "UNKNOWN_SIGNING_KEY" });
    expect(
      verifyBootstrapEnvelope({ ...envelope, algorithm: "ES256" }, ring),
    ).toEqual({ ok: false, error: "UNSUPPORTED_ALGORITHM" });
  });

  it("rejects malformed encodings and signed invalid JSON/schema", () => {
    const { config, ring } = keyMaterial();
    const envelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(
      verifyBootstrapEnvelope({ ...envelope, payload: "not+base64url" }, ring),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD_ENCODING" });
    const malformedJson = signedRaw("{", "config-current", config.privateKey);
    expect(verifyBootstrapEnvelope(malformedJson, ring)).toEqual({
      ok: false,
      error: "INVALID_PAYLOAD_JSON",
    });
    const invalidSchema = signedRaw(
      '{"snapshotVersion":"bootstrap_snapshot_v1"}',
      "config-current",
      config.privateKey,
    );
    expect(verifyBootstrapEnvelope(invalidSchema, ring)).toEqual({
      ok: false,
      error: "INVALID_PAYLOAD_SCHEMA",
    });
  });

  it("rejects a signed but non-canonical JSON payload", () => {
    const { config, ring } = keyMaterial();
    const nonCanonical = JSON.stringify(
      { ...payload, entitlements: {}, features: {} },
      null,
      2,
    );
    expect(
      verifyBootstrapEnvelope(
        signedRaw(nonCanonical, "config-current", config.privateKey),
        ring,
      ),
    ).toEqual({ ok: false, error: "NON_CANONICAL_PAYLOAD" });
  });

  it("supports overlapping config keys, but never an access-token key", () => {
    const { config, previous, access, ring } = keyMaterial();
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-old", previous.privateKey),
        ring,
      ).ok,
    ).toBe(true);
    expect(
      verifyBootstrapEnvelope(
        signBootstrapSnapshot(payload, "config-current", config.privateKey),
        ring,
      ).ok,
    ).toBe(true);
    const configEnvelope = signBootstrapSnapshot(
      payload,
      "config-current",
      config.privateKey,
    );
    expect(
      verifyBootstrapEnvelope(
        configEnvelope,
        new Map([["config-current", access.publicKey]]),
      ),
    ).toEqual({ ok: false, error: "INVALID_SIGNATURE" });
  });
});

function signedRaw(
  rawPayload: string,
  keyId: string,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
) {
  const payloadBytes = Buffer.from(rawPayload, "utf8");
  const bytes = Buffer.concat([
    BOOTSTRAP_SIGNATURE_DOMAIN,
    Buffer.from(keyId),
    Buffer.from([0]),
    payloadBytes,
  ]);
  return {
    envelopeVersion: "bootstrap_envelope_v1",
    algorithm: "Ed25519",
    keyId,
    payload: payloadBytes.toString("base64url"),
    signature: sign(null, bytes, privateKey).toString("base64url"),
  };
}

function flipBase64Url(value: string): string {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}
