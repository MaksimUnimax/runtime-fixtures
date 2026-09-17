import { describe, expect, it } from "vitest";
import {
  BootstrapRequestV2Schema,
  HealthAuthorityRequestV1Schema,
  HealthClaimV1Schema,
  SignedHealthEnvelopeV1Schema,
} from "./index.js";

const context = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  contractVersion: "control_plane_v2" as const,
  configVersion: 7,
  bootstrapSnapshotSha256: "b".repeat(64),
  ai: {
    family: "chatgpt",
    surface: "web",
    variant: null,
    profileKey: "chatgpt-web",
    revision: 3,
    scopeVariant: null,
    contentSha256: "a".repeat(64),
  },
};

const pass = {
  healthClaimVersion: "health_claim_v1" as const,
  status: "PASS" as const,
  target: "WORK" as const,
  context,
  observedAt: "2026-09-17T00:00:00.000Z",
  expiresAt: "2026-09-17T00:15:00.000Z",
  executionAuthority: false as const,
};

describe("signed Health transport contracts", () => {
  it("keeps the existing V2 request strict and separate", () => {
    expect(
      BootstrapRequestV2Schema.safeParse({
        contractVersion: "control_plane_v2",
        extensionVersion: "0.2.4",
        browser: { family: "chrome", version: "120" },
        deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        lastConfigVersion: null,
      }).success,
    ).toBe(true);
    expect(
      BootstrapRequestV2Schema.safeParse({
        contractVersion: "control_plane_v2",
        extensionVersion: "0.2.4",
        browser: { family: "chrome", version: "120" },
        deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        lastConfigVersion: null,
        health: pass,
      }).success,
    ).toBe(false);
  });

  it("requires a bound, time-limited PASS and rejects positive fields on negatives", () => {
    expect(HealthClaimV1Schema.parse(pass)).toEqual(pass);
    expect(
      HealthClaimV1Schema.safeParse({
        healthClaimVersion: "health_claim_v1",
        status: "DENY",
        target: "WORK",
        reason: "PRODUCER_UNAVAILABLE",
        observedAt: pass.observedAt,
        executionAuthority: false,
        context,
      }).success,
    ).toBe(false);
    expect(
      HealthClaimV1Schema.safeParse({ ...pass, expiresAt: pass.observedAt })
        .success,
    ).toBe(false);
  });

  it("defines an explicit health request and envelope version", () => {
    const request = {
      healthTransportVersion: "health_transport_v1" as const,
      bootstrap: {
        contractVersion: "control_plane_v2" as const,
        extensionVersion: "0.2.4",
        browser: { family: "chrome" as const, version: "120" },
        deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        lastConfigVersion: null,
      },
      bootstrapEnvelope: {
        envelopeVersion: "bootstrap_envelope_v2" as const,
        algorithm: "Ed25519" as const,
        keyId: "config-key",
        payload: "e30",
        signature: "AA",
      },
    };
    expect(HealthAuthorityRequestV1Schema.parse(request)).toEqual(request);
    expect(
      SignedHealthEnvelopeV1Schema.safeParse({
        healthEnvelopeVersion: "health_envelope_v1",
        algorithm: "Ed25519",
        keyId: "config-key",
        payload: "e30",
        signature: "AA",
      }).success,
    ).toBe(true);
  });
});
