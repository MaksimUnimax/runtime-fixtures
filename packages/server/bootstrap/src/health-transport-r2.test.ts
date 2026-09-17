import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signBootstrapSnapshotV2,
  signHealthClaimV1,
  verifyBootstrapEnvelopeV2,
  verifyHealthEnvelopeV1,
} from "@product/remote-config";
import { BootstrapService } from "./index.js";

const NOW = new Date("2026-09-17T00:00:00.000Z");
const subject = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const detected = { family: "chatgpt", surface: "web", variant: null } as const;
const profile = {
  profileKey: "chatgpt-web",
  revision: 3,
  scopeVariant: null,
  schemaVersion: "adapter_profile_v1" as const,
  contentSha256: "a".repeat(64),
  content: {},
  compatibility: {},
};

function iso(value: string) {
  return new Date(value);
}

function addSeconds(value: string, seconds: number) {
  return new Date(new Date(value).getTime() + seconds * 1000);
}

function aiPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "RESOLVED" as const,
    detected,
    profile: { ...profile, ...overrides },
  };
}

function makeFixture(
  options: {
    producer?: unknown;
    payload?: Record<string, unknown>;
    request?: Record<string, unknown>;
    policyConfigVersion?: number;
    beta?: boolean;
    commercialDeadline?: Date;
    now?: Date;
  } = {},
) {
  const pair = generateKeyPairSync("ed25519");
  const payload = {
    snapshotVersion: "bootstrap_snapshot_v2" as const,
    contractVersion: "control_plane_v2" as const,
    account: { id: subject.accountId, status: "ACTIVE" as const },
    configVersion: 7,
    serverTime: "2026-09-16T23:59:00.000Z",
    issuedAt: "2026-09-16T23:59:00.000Z",
    expiresAt: "2026-09-17T00:30:00.000Z",
    offlineGraceUntil: "2026-09-17T01:30:00.000Z",
    accessBasis: options.commercialDeadline
      ? ("COMMERCIAL" as const)
      : ("BETA" as const),
    subscription: { state: "NONE" as const, planRevision: null },
    devicePolicy: { status: "ACTIVE" as const },
    compatibility: {
      extension: { status: "SUPPORTED" as const, minimumVersion: null },
      browser: { status: "SUPPORTED" as const },
    },
    entitlements: {},
    features: {},
    ai: aiPayload(),
    ...options.payload,
  };
  const bootstrapEnvelope = signBootstrapSnapshotV2(
    payload,
    "config-key",
    pair.privateKey,
  );
  const request = {
    healthTransportVersion: "health_transport_v1" as const,
    bootstrap: {
      contractVersion: "control_plane_v2" as const,
      extensionVersion: "0.2.4",
      browser: { family: "chrome" as const, version: "120" },
      deviceId: subject.deviceId,
      lastConfigVersion: null,
      detectedAi: detected,
      ...options.request,
    },
    bootstrapEnvelope,
  };
  let resolverCalls = 0;
  const producer = options.producer ?? {
    status: "PASS",
    observedAt: iso("2026-01-01T00:00:00.000Z"),
    expiresAt: iso("2026-01-01T00:15:00.000Z"),
  };
  const service = new BootstrapService(
    {
      resolve: async () => ({
        configVersion: options.policyConfigVersion ?? 7,
        signingKeyId: "config-key",
        sourceFingerprintSha256: "a".repeat(64),
        compatibility: payload.compatibility,
        features: {},
      }),
    },
    {
      sign: async () => {
        throw new Error("unused");
      },
      signHealth: async (_keyId, claim) =>
        signHealthClaimV1(claim, "config-key", pair.privateKey),
    },
    { now: () => options.now ?? NOW },
    options.commercialDeadline
      ? ({
          resolve: async () => ({
            kind: "OK" as const,
            value: {
              access: { kind: "ELIGIBLE" as const },
              accessUntil: options.commercialDeadline!,
            },
          }),
        } as never)
      : undefined,
    {
      resolve: async (input: { detected: typeof detected }) => ({
        status: "RESOLVED" as const,
        detected: input.detected,
        profile,
      }),
    } as never,
    {
      resolve: async () => ({ kind: options.beta === false ? "NONE" : "BETA" }),
    },
    undefined,
    {
      resolve: async (_input) => {
        resolverCalls += 1;
        return producer as never;
      },
    },
    {
      verifyV2: (input) =>
        verifyBootstrapEnvelopeV2(
          input,
          new Map([["config-key", pair.publicKey]]),
        ),
    },
  );
  return {
    service,
    pair,
    request,
    payload,
    get resolverCalls() {
      return resolverCalls;
    },
  };
}

async function passClaim(fixture: ReturnType<typeof makeFixture>) {
  const envelope = await fixture.service.issueHealth(
    subject,
    fixture.request as never,
  );
  const verified = verifyHealthEnvelopeV1(
    envelope,
    new Map([["config-key", fixture.pair.publicKey]]),
  );
  expect(verified).toMatchObject({ ok: true });
  if (!verified.ok || verified.payload.status !== "PASS")
    throw new Error("expected PASS");
  return verified.payload;
}

describe("Health transport R2 producer freshness", () => {
  it("FR-01/02 preserves producer observation and bounds it to 15 minutes", async () => {
    const fixture = makeFixture({
      producer: {
        status: "PASS",
        observedAt: iso("2026-09-16T23:50:00.000Z"),
        expiresAt: iso("2026-09-17T00:20:00.000Z"),
      },
    });
    const claim = await passClaim(fixture);
    expect(claim.observedAt).toBe("2026-09-16T23:50:00.000Z");
    expect(claim.expiresAt).toBe("2026-09-17T00:05:00.000Z");
  });

  it("FR-03 does not refresh an observation that is 14m59s old", async () => {
    const claim = await passClaim(
      makeFixture({
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:45:01.000Z"),
          expiresAt: iso("2026-09-17T00:30:00.000Z"),
        },
      }),
    );
    expect(claim.observedAt).toBe("2026-09-16T23:45:01.000Z");
    expect(claim.expiresAt).toBe("2026-09-17T00:00:01.000Z");
  });

  it.each([
    [
      "FR-04 stale",
      iso("2026-09-16T23:44:59.000Z"),
      iso("2026-09-17T00:30:00.000Z"),
    ],
    [
      "FR-06 expired producer",
      iso("2026-09-16T23:59:00.000Z"),
      iso("2026-09-16T23:59:59.000Z"),
    ],
    [
      "FR-07 future observation",
      iso("2026-09-17T00:00:01.000Z"),
      iso("2026-09-17T00:30:00.000Z"),
    ],
    [
      "FR-08 non-positive producer interval",
      iso("2026-09-16T23:50:00.000Z"),
      iso("2026-09-16T23:50:00.000Z"),
    ],
  ])("%s fails closed", async (_label, observedAt, expiresAt) => {
    await expect(
      passClaim(
        makeFixture({ producer: { status: "PASS", observedAt, expiresAt } }),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("FR-05 preserves an earlier producer expiry", async () => {
    const claim = await passClaim(
      makeFixture({
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:50:00.000Z"),
          expiresAt: iso("2026-09-17T00:02:00.000Z"),
        },
      }),
    );
    expect(claim.expiresAt).toBe("2026-09-17T00:02:00.000Z");
  });

  it.each([
    [
      "FR-09 missing observedAt",
      { status: "PASS", expiresAt: iso("2026-09-17T00:30:00.000Z") },
    ],
    [
      "FR-10 missing expiresAt",
      { status: "PASS", observedAt: iso("2026-09-16T23:50:00.000Z") },
    ],
  ])("%s fails closed", async (_label, producer) => {
    await expect(passClaim(makeFixture({ producer }))).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  it("FR-11/12 ignores the commercial deadline when accessBasis is BETA", async () => {
    const betaOnly = await passClaim(
      makeFixture({
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:59:00.000Z"),
          expiresAt: iso("2026-09-17T00:30:00.000Z"),
        },
      }),
    );
    expect(betaOnly.expiresAt).toBe("2026-09-17T00:14:00.000Z");

    const betaAndCommercial = await passClaim(
      makeFixture({
        commercialDeadline: iso("2026-09-17T00:01:00.000Z"),
        payload: { accessBasis: "BETA" },
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:59:00.000Z"),
          expiresAt: iso("2026-09-17T00:30:00.000Z"),
        },
      }),
    );
    expect(betaAndCommercial.expiresAt).toBe("2026-09-17T00:14:00.000Z");
  });

  it("FR-13 applies the commercial deadline only to COMMERCIAL access", async () => {
    const claim = await passClaim(
      makeFixture({
        beta: false,
        commercialDeadline: iso("2026-09-17T00:10:00.000Z"),
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:59:00.000Z"),
          expiresAt: iso("2026-09-17T00:30:00.000Z"),
        },
      }),
    );
    expect(claim.expiresAt).toBe("2026-09-17T00:09:59.999Z");
  });

  it("FR-14 uses the earlier verified Bootstrap expiry", async () => {
    const claim = await passClaim(
      makeFixture({
        payload: { expiresAt: "2026-09-17T00:03:00.000Z" },
        producer: {
          status: "PASS",
          observedAt: iso("2026-09-16T23:50:00.000Z"),
          expiresAt: iso("2026-09-17T00:30:00.000Z"),
        },
      }),
    );
    expect(claim.expiresAt).toBe("2026-09-17T00:03:00.000Z");
  });

  it("FR-15/16 repeated acquisition cannot refresh producer authority", async () => {
    const producer = {
      status: "PASS",
      observedAt: iso("2026-09-16T23:59:00.000Z"),
      expiresAt: iso("2026-09-17T00:04:00.000Z"),
    };
    let now = NOW;
    const fixture = makeFixture({ producer, now });
    const first = await passClaim(fixture);
    now = addSeconds(NOW.toISOString(), 180);
    const laterFixture = makeFixture({ producer, now });
    const second = await passClaim(laterFixture);
    expect(second.observedAt).toBe(first.observedAt);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(second.expiresAt).toBe("2026-09-17T00:04:00.000Z");
    await expect(
      passClaim(
        makeFixture({ producer, now: addSeconds(NOW.toISOString(), 300) }),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("Health transport R2 trust order", () => {
  it.each([
    ["TO-01 bad Bootstrap signature", { badSignature: true }],
    [
      "TO-02 expired Bootstrap",
      { payload: { expiresAt: "2026-09-16T23:59:59.000Z" } },
    ],
    [
      "TO-03 wrong account",
      {
        payload: {
          account: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            status: "ACTIVE",
          },
        },
      },
    ],
    [
      "TO-04 wrong device",
      { request: { deviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } },
    ],
    [
      "TO-05 AI mismatch",
      {
        request: {
          detectedAi: { family: "alice", surface: "web", variant: null },
        },
      },
    ],
    ["TO-06 config mismatch", { policyConfigVersion: 8 }],
    ["TO-07 access-basis mismatch", { beta: false }],
  ])("%s does not invoke the producer resolver", async (_label, options) => {
    const fixture = makeFixture(options as never);
    if ("badSignature" in options) {
      const signature = fixture.request.bootstrapEnvelope.signature;
      fixture.request.bootstrapEnvelope.signature =
        (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    }
    const wrongDevice = "request" in options && "deviceId" in options.request;
    await expect(
      fixture.service.issueHealth(subject, fixture.request as never),
    ).rejects.toMatchObject({
      code: wrongDevice ? "DEVICE_MISMATCH" : "UNAVAILABLE",
    });
    expect(fixture.resolverCalls).toBe(0);
  });

  it("TO-08 invokes the resolver exactly once for exact current context", async () => {
    const fixture = makeFixture({
      producer: { status: "DENY", reason: "PRODUCER_DENIED" },
    });
    const envelope = await fixture.service.issueHealth(
      subject,
      fixture.request as never,
    );
    expect(fixture.resolverCalls).toBe(1);
    expect(
      verifyHealthEnvelopeV1(
        envelope,
        new Map([["config-key", fixture.pair.publicKey]]),
      ).ok,
    ).toBe(true);
  });
});
