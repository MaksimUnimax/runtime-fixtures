import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HealthClaimV1Schema } from "@product/contracts";
import { signHealthClaimV1, verifyHealthEnvelopeV1 } from "./index.js";

const claim = HealthClaimV1Schema.parse({
  healthClaimVersion: "health_claim_v1",
  status: "PASS",
  target: "WORK",
  context: {
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    contractVersion: "control_plane_v2",
    configVersion: 7,
    ai: {
      family: "chatgpt",
      surface: "web",
      variant: null,
      profileKey: "chatgpt-web",
      revision: 3,
      scopeVariant: null,
      contentSha256: "a".repeat(64),
    },
  },
  observedAt: "2026-09-17T00:00:00.000Z",
  expiresAt: "2026-09-17T00:15:00.000Z",
  executionAuthority: false,
});

describe("signed Health envelope", () => {
  it("uses the existing Ed25519 trust ring and rejects tampering or wrong trust", () => {
    const pair = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const envelope = signHealthClaimV1(claim, "config-key", pair.privateKey);
    expect(
      verifyHealthEnvelopeV1(
        envelope,
        new Map([["config-key", pair.publicKey]]),
      ).ok,
    ).toBe(true);
    expect(
      verifyHealthEnvelopeV1(
        envelope,
        new Map([["config-key", other.publicKey]]),
      ).ok,
    ).toBe(false);
    expect(
      verifyHealthEnvelopeV1(
        { ...envelope, signature: `${envelope.signature}A` },
        new Map([["config-key", pair.publicKey]]),
      ).ok,
    ).toBe(false);
  });
});
