import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signBootstrapSnapshotV2,
  signHealthClaimV1,
  verifyBootstrapEnvelopeV2,
  verifyHealthEnvelopeV1,
} from "@product/remote-config";
import { BootstrapService, type BootstrapHealthDecision } from "./index.js";

const subject = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const requestBase = {
  healthTransportVersion: "health_transport_v1" as const,
  bootstrap: {
    contractVersion: "control_plane_v2" as const,
    extensionVersion: "0.2.4",
    browser: { family: "chrome" as const, version: "120" },
    deviceId: subject.deviceId,
    lastConfigVersion: null,
    detectedAi: { family: "chatgpt", surface: "web", variant: null },
  },
};
const policy = {
  resolve: async () => ({
    configVersion: 7,
    signingKeyId: "config-key",
    sourceFingerprintSha256: "a".repeat(64),
    compatibility: {
      extension: { status: "SUPPORTED" as const, minimumVersion: null },
      browser: { status: "SUPPORTED" as const },
    },
    features: {},
  }),
};

function service(
  decision: "PASS" | "DENY" | "UNAVAILABLE" | "MALFORMED" = "PASS",
  commercialDeadline?: Date,
) {
  const pair = generateKeyPairSync("ed25519");
  const bootstrapEnvelope = signBootstrapSnapshotV2(
    {
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      account: { id: subject.accountId, status: "ACTIVE" },
      configVersion: 7,
      serverTime: "2026-09-16T23:59:00.000Z",
      issuedAt: "2026-09-16T23:59:00.000Z",
      expiresAt: "2026-09-17T00:15:00.000Z",
      offlineGraceUntil: "2026-09-17T01:15:00.000Z",
      accessBasis: "BETA",
      subscription: { state: "NONE", planRevision: null },
      devicePolicy: { status: "ACTIVE" },
      compatibility: {
        extension: { status: "SUPPORTED", minimumVersion: null },
        browser: { status: "SUPPORTED" },
      },
      entitlements: {},
      features: {},
      ai: {
        status: "RESOLVED",
        detected: { family: "chatgpt", surface: "web", variant: null },
        profile: {
          profileKey: "chatgpt-web",
          revision: 3,
          scopeVariant: null,
          schemaVersion: "adapter_profile_v1",
          contentSha256: "a".repeat(64),
          content: {},
          compatibility: {},
        },
      },
    },
    "config-key",
    pair.privateKey,
  );
  const request = { ...requestBase, bootstrapEnvelope };
  const aiResolution = {
    resolve: async () => ({
      status: "RESOLVED" as const,
      detected: { family: "chatgpt", surface: "web", variant: null },
      profile: {
        profileKey: "chatgpt-web",
        revision: 3,
        scopeVariant: null,
        schemaVersion: "adapter_profile_v1" as const,
        contentSha256: "a".repeat(64),
        content: {},
        compatibility: {},
      },
    }),
  } as never;
  const commercialAccess = commercialDeadline
    ? ({
        resolve: async () =>
          ({
            kind: "OK",
            value: {
              access: { kind: "ELIGIBLE" },
              accessUntil: commercialDeadline,
            },
          }) as never,
      } as never)
    : undefined;
  const bootstrap = new BootstrapService(
    policy,
    {
      sign: async () => {
        throw new Error("unused");
      },
      signV2: async () => {
        throw new Error("unused");
      },
      signHealth: async (_keyId, claim) =>
        signHealthClaimV1(claim, "config-key", pair.privateKey),
    },
    { now: () => new Date("2026-09-17T00:00:00.000Z") },
    commercialAccess,
    aiResolution,
    { resolve: async () => ({ kind: "BETA" as const }) },
    undefined,
    {
      resolve: async (): Promise<BootstrapHealthDecision> => {
        if (decision === "PASS") return { status: "PASS" };
        if (decision === "DENY")
          return { status: "DENY", reason: "PRODUCER_DENIED" };
        if (decision === "MALFORMED") return undefined as never;
        return { status: "UNAVAILABLE", reason: "PRODUCER_UNAVAILABLE" };
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
  return { bootstrap, pair, request };
}

describe("Health transport boundary", () => {
  it("emits a synthetic transport PASS only for resolved AI and always executionAuthority=false", async () => {
    const { bootstrap, pair, request } = service();
    const envelope = await bootstrap.issueHealth(subject, request);
    const result = verifyHealthEnvelopeV1(
      envelope,
      new Map([["config-key", pair.publicKey]]),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.payload.status).toBe("PASS");
      expect(result.payload.executionAuthority).toBe(false);
    }
  });

  it.each(["UNCONFIGURED", "UNAVAILABLE"] as const)(
    "does not emit PASS for AI %s",
    async (_status) => {
      const { bootstrap, pair, request } = service();
      const altered = {
        ...request,
        bootstrap: { ...request.bootstrap, detectedAi: undefined },
      };
      const envelope = await bootstrap.issueHealth(subject, altered);
      const result = verifyHealthEnvelopeV1(
        envelope,
        new Map([["config-key", pair.publicKey]]),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.payload.status).not.toBe("PASS");
    },
  );

  it("defaults to unavailable when no trusted resolver is connected", async () => {
    const { bootstrap, pair, request } = service("UNAVAILABLE");
    const envelope = await bootstrap.issueHealth(subject, request);
    const result = verifyHealthEnvelopeV1(
      envelope,
      new Map([["config-key", pair.publicKey]]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.status).toBe("UNAVAILABLE");
  });

  it("defaults to unavailable when no trusted resolver is connected", async () => {
    const pair = generateKeyPairSync("ed25519");
    const bootstrap = new BootstrapService(
      policy,
      {
        sign: async () => {
          throw new Error("unused");
        },
        signV2: async (_keyId, payload) =>
          signBootstrapSnapshotV2(payload, "config-key", pair.privateKey),
        signHealth: async (_keyId, claim) =>
          signHealthClaimV1(claim, "config-key", pair.privateKey),
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        verifyV2: (input) =>
          verifyBootstrapEnvelopeV2(
            input,
            new Map([["config-key", pair.publicKey]]),
          ),
      },
    );
    const signedBootstrap = await bootstrap.issueV2(subject, {
      ...requestBase.bootstrap,
      detectedAi: undefined,
    });
    const envelope = await bootstrap.issueHealth(subject, {
      ...requestBase,
      bootstrapEnvelope: signedBootstrap,
    });
    const result = verifyHealthEnvelopeV1(
      envelope,
      new Map([["config-key", pair.publicKey]]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.status).toBe("UNAVAILABLE");
  });

  it("does not truncate BETA health at a simultaneous commercial deadline", async () => {
    const { bootstrap, pair, request } = service(
      "PASS",
      new Date("2026-09-17T00:01:00.000Z"),
    );
    const result = verifyHealthEnvelopeV1(
      await bootstrap.issueHealth(subject, request),
      new Map([["config-key", pair.publicKey]]),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.payload.status === "PASS")
      expect(result.payload.expiresAt).toBe("2026-09-17T00:15:00.000Z");
  });

  it("fails closed before signing malformed resolver output", async () => {
    const { bootstrap, request } = service("MALFORMED");
    await expect(bootstrap.issueHealth(subject, request)).rejects.toMatchObject(
      {
        code: "UNAVAILABLE",
      },
    );
  });
});
