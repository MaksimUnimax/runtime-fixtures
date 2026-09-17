import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signHealthClaimV1,
  verifyHealthEnvelopeV1,
} from "@product/remote-config";
import { BootstrapService, type BootstrapHealthDecision } from "./index.js";

const subject = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const request = {
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

function service(decision: "PASS" | "DENY" | "UNAVAILABLE" = "PASS") {
  const pair = generateKeyPairSync("ed25519");
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
    undefined,
    aiResolution,
    { resolve: async () => ({ kind: "BETA" as const }) },
    undefined,
    {
      resolve: async (): Promise<BootstrapHealthDecision> => {
        if (decision === "PASS") return { status: "PASS" };
        if (decision === "DENY")
          return { status: "DENY", reason: "PRODUCER_DENIED" };
        return { status: "UNAVAILABLE", reason: "PRODUCER_UNAVAILABLE" };
      },
    },
  );
  return { bootstrap, pair };
}

describe("Health transport boundary", () => {
  it("emits a synthetic transport PASS only for resolved AI and always executionAuthority=false", async () => {
    const { bootstrap, pair } = service();
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
      const { bootstrap, pair } = service();
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
    const pair = generateKeyPairSync("ed25519");
    const bootstrap = new BootstrapService(policy, {
      sign: async () => {
        throw new Error("unused");
      },
      signHealth: async (_keyId, claim) =>
        signHealthClaimV1(claim, "config-key", pair.privateKey),
    });
    const envelope = await bootstrap.issueHealth(subject, request);
    const result = verifyHealthEnvelopeV1(
      envelope,
      new Map([["config-key", pair.publicKey]]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.status).toBe("UNAVAILABLE");
  });
});
