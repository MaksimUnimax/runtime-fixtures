import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
} from "@product/remote-config";
import type {
  BootstrapSnapshotPayloadV1,
  BootstrapSnapshotPayloadV2,
} from "@product/contracts";
import { SimulatedExtensionClient } from "./index.js";

describe("SimulatedExtensionClient", () => {
  const payload: BootstrapSnapshotPayloadV1 = {
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
  };
  function activatedClient(
    ring: ReadonlyMap<
      string,
      ReturnType<typeof generateKeyPairSync>["publicKey"]
    >,
    fetch: typeof globalThis.fetch,
  ) {
    const client = new SimulatedExtensionClient({
      controlPlaneApiOrigin: "https://api.test",
      portalOrigin: "https://portal.test",
      trustedConfigSigningKeys: ring,
      fetch,
    });
    (client as unknown as { credentials: object }).credentials = {
      deviceId: "123e4567-e89b-42d3-a456-426614174000",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      accessToken: "access",
      accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
      refreshToken: "refresh",
      refreshTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    };
    return client;
  }

  it("defensively copies packaged trust and verifies without remote key discovery", async () => {
    const k1 = generateKeyPairSync("ed25519");
    const k2 = generateKeyPairSync("ed25519");
    const supplied = new Map([["k1", k1.publicKey]]);
    let requests = 0;
    const client = activatedClient(supplied, async () => {
      requests++;
      return new Response(
        JSON.stringify(signBootstrapSnapshot(payload, "k1", k1.privateKey)),
        { status: 200 },
      );
    });
    supplied.set("k2", k2.publicKey);
    supplied.clear();
    expect(
      await client.bootstrap({
        contractVersion: "control_plane_v1",
        extensionVersion: "1.0.0",
        browser: { family: "chrome", version: "123" },
        lastConfigVersion: null,
      }),
    ).toMatchObject({ kind: "VERIFIED" });
    expect(requests).toBe(1);
  });

  it("sends and verifies the control_plane_v2 bootstrap contract", async () => {
    const k1 = generateKeyPairSync("ed25519");
    const payloadV2: BootstrapSnapshotPayloadV2 = {
      ...payload,
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "ACTIVE",
      },
    };
    let requestBody: Record<string, unknown> | undefined;
    const client = activatedClient(
      new Map([["k1", k1.publicKey]]),
      async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify(
            signBootstrapSnapshotV2(payloadV2, "k1", k1.privateKey),
          ),
          { status: 200 },
        );
      },
    );
    const result = await client.bootstrap({
      contractVersion: "control_plane_v2",
      extensionVersion: "1.2.3",
      browser: { family: "chrome", version: "153.0.0.0" },
      lastConfigVersion: null,
    });
    expect(result).toMatchObject({
      kind: "VERIFIED",
      payload: payloadV2,
      envelope: { envelopeVersion: "bootstrap_envelope_v2" },
    });
    expect(requestBody).toMatchObject({
      contractVersion: "control_plane_v2",
      extensionVersion: "1.2.3",
      lastConfigVersion: null,
    });
  });

  it("sends and verifies a privacy-neutral control_plane_v2 bootstrap contract", async () => {
    const k1 = generateKeyPairSync("ed25519");
    const {
      compatibility: _compatibility,
      features: _features,
      ai: _ai,
      ...common
    } = payload;
    void _compatibility;
    void _features;
    void _ai;
    const payloadV2: BootstrapSnapshotPayloadV2 = {
      ...common,
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "ACTIVE",
      },
      localClientAuthority: {
        schemaVersion: "local_client_authority_v1",
        contractVersion: "control_plane_v2",
        compatibility: { releases: [], policies: [] },
        featureRules: [],
        ai: { status: "UNCONFIGURED" },
      },
    };
    let requestBody: Record<string, unknown> | undefined;
    const client = activatedClient(
      new Map([["k1", k1.publicKey]]),
      async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify(
            signBootstrapSnapshotV2(payloadV2, "k1", k1.privateKey),
          ),
          { status: 200 },
        );
      },
    );
    const result = await client.bootstrap({
      contractVersion: "control_plane_v2",
      lastConfigVersion: null,
    });
    expect(result).toMatchObject({
      kind: "VERIFIED",
      payload: payloadV2,
      envelope: { envelopeVersion: "bootstrap_envelope_v2" },
    });
    expect(requestBody).toEqual({
      contractVersion: "control_plane_v2",
      deviceId: "123e4567-e89b-42d3-a456-426614174000",
      lastConfigVersion: null,
    });
  });

  it("rejects unknown keys, tampering, and HTTP errors as non-verified results", async () => {
    const k1 = generateKeyPairSync("ed25519");
    const k2 = generateKeyPairSync("ed25519");
    const envelope = signBootstrapSnapshot(payload, "k2", k2.privateKey);
    const client = activatedClient(
      new Map([["k1", k1.publicKey]]),
      async () => new Response(JSON.stringify(envelope), { status: 200 }),
    );
    expect(
      await client.bootstrap({
        contractVersion: "control_plane_v1",
        extensionVersion: "1.0.0",
        browser: { family: "chrome", version: "123" },
        lastConfigVersion: null,
      }),
    ).toEqual({ kind: "VERIFICATION_FAILURE", error: "UNKNOWN_SIGNING_KEY" });
    const tampered = activatedClient(
      new Map([["k1", k1.publicKey]]),
      async () =>
        new Response(
          JSON.stringify({
            ...signBootstrapSnapshot(payload, "k1", k1.privateKey),
            signature: "A" + envelope.signature.slice(1),
          }),
          { status: 200 },
        ),
    );
    expect(
      (
        await tampered.bootstrap({
          contractVersion: "control_plane_v1",
          extensionVersion: "1.0.0",
          browser: { family: "chrome", version: "123" },
          lastConfigVersion: null,
        })
      ).kind,
    ).toBe("VERIFICATION_FAILURE");
    const error = activatedClient(
      new Map(),
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BOOTSTRAP_UNAVAILABLE",
              message: "not trusted",
              correlationId: "corr",
            },
          }),
          { status: 503 },
        ),
    );
    expect(
      await error.bootstrap({
        contractVersion: "control_plane_v1",
        extensionVersion: "1.0.0",
        browser: { family: "chrome", version: "123" },
        lastConfigVersion: null,
      }),
    ).toEqual({
      kind: "HTTP_ERROR",
      status: 503,
      code: "BOOTSTRAP_UNAVAILABLE",
    });
  });

  it("models old, overlap, and new packaged trust rings", async () => {
    const k1 = generateKeyPairSync("ed25519");
    const k2 = generateKeyPairSync("ed25519");
    const envelope1 = signBootstrapSnapshot(payload, "k1", k1.privateKey);
    const envelope2 = signBootstrapSnapshot(payload, "k2", k2.privateKey);
    const request = {
      contractVersion: "control_plane_v1" as const,
      extensionVersion: "1.0.0",
      browser: { family: "chrome" as const, version: "123" },
      lastConfigVersion: null,
    };
    const old = activatedClient(
      new Map([["k1", k1.publicKey]]),
      async () => new Response(JSON.stringify(envelope1), { status: 200 }),
    );
    expect((await old.bootstrap(request)).kind).toBe("VERIFIED");
    const overlap = activatedClient(
      new Map([
        ["k1", k1.publicKey],
        ["k2", k2.publicKey],
      ]),
      async () => new Response(JSON.stringify(envelope2), { status: 200 }),
    );
    expect((await overlap.bootstrap(request)).kind).toBe("VERIFIED");
    const next = activatedClient(
      new Map([["k2", k2.publicKey]]),
      async () => new Response(JSON.stringify(envelope2), { status: 200 }),
    );
    expect((await next.bootstrap(request)).kind).toBe("VERIFIED");
  });

  it("rejects non-origin constructor inputs", () => {
    for (const input of [
      "/api",
      "ftp://example.test",
      "https://u:p@example.test",
      "https://example.test/path",
      "https://example.test/?q=1",
    ]) {
      expect(
        () =>
          new SimulatedExtensionClient({
            controlPlaneApiOrigin: input,
            portalOrigin: "https://portal.test",
          }),
      ).toThrow("invalid origin");
    }
  });

  it("keeps codes out of the verification URL", async () => {
    const client = new SimulatedExtensionClient({
      controlPlaneApiOrigin: "https://api.test",
      portalOrigin: "https://portal.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            status: "pending",
            authorizationId: "123e4567-e89b-42d3-a456-426614174000",
            deviceCode: "a".repeat(43),
            userCode: "ABCD-EFGH",
            expiresAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 201 },
        ),
    });
    const result = await client.startAuthorization(
      {
        clientType: "browser_extension",
        browserFamily: "chrome",
        extensionVersion: "1",
      },
      "123e4567-e89b-42d3-a456-426614174001",
    );
    expect(result.verificationUrl).toBe(
      "https://portal.test/activate?authorizationId=123e4567-e89b-42d3-a456-426614174000",
    );
    expect(result.verificationUrl).not.toContain("a".repeat(43));
    expect(result.verificationUrl).not.toContain("ABCD-EFGH");
  });
});
