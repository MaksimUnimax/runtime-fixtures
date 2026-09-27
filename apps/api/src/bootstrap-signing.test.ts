import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindConfigSigningMaterial,
  createConfigSigningService,
  loadConfigSigningMaterial,
} from "./bootstrap-signing.js";
import { verifyBootstrapEnvelopeV3 } from "@product/remote-config";

function environment(pem?: string, keyId = "config-key"): NodeJS.ProcessEnv {
  return {
    CONFIG_SIGNING_KEY_ID: keyId,
    ...(pem === undefined
      ? {}
      : {
          CONFIG_SIGNING_PRIVATE_KEY_PEM_B64:
            Buffer.from(pem).toString("base64"),
        }),
  };
}

function ed25519Pem(): string {
  return generateKeyPairSync("ed25519").privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;
}
function ringEnvironment(
  entries: Array<{ keyId: string; pem?: string }>,
): NodeJS.ProcessEnv {
  return {
    CONFIG_SIGNING_KEY_RING_JSON: JSON.stringify({
      version: 1,
      keys: entries.map(({ keyId, pem = ed25519Pem() }) => ({
        keyId,
        privateKeyPemB64: Buffer.from(pem).toString("base64"),
      })),
    }),
  };
}

describe("API config-signing material", () => {
  it.each([1, 2, 8])("loads a canonical ring with %i key(s)", (count) => {
    const material = loadConfigSigningMaterial(
      ringEnvironment(
        Array.from({ length: count }, (_, index) => ({
          keyId: `config-key-${index}`,
        })),
      ),
    );
    expect(material.keys.size).toBe(count);
  });

  it("rejects nine keys, duplicate IDs, duplicate fingerprints, unknown fields, and invalid JSON", () => {
    expect(() =>
      loadConfigSigningMaterial(
        ringEnvironment(
          Array.from({ length: 9 }, (_, index) => ({
            keyId: `config-key-${index}`,
          })),
        ),
      ),
    ).toThrow();
    const pem = ed25519Pem();
    expect(() =>
      loadConfigSigningMaterial(
        ringEnvironment([{ keyId: "same", pem }, { keyId: "same" }]),
      ),
    ).toThrow();
    expect(() =>
      loadConfigSigningMaterial(
        ringEnvironment([
          { keyId: "one", pem },
          { keyId: "two", pem },
        ]),
      ),
    ).toThrow();
    expect(() =>
      loadConfigSigningMaterial({
        CONFIG_SIGNING_KEY_RING_JSON: JSON.stringify({
          version: 1,
          keys: [
            {
              keyId: "one",
              privateKeyPemB64: Buffer.from(pem).toString("base64"),
              extra: true,
            },
          ],
        }),
      }),
    ).toThrow();
    expect(() =>
      loadConfigSigningMaterial({ CONFIG_SIGNING_KEY_RING_JSON: "{" }),
    ).toThrow();
  });

  it("rejects invalid and non-canonical ring material and preserves singleton fallback rules", () => {
    expect(() =>
      loadConfigSigningMaterial({
        CONFIG_SIGNING_KEY_RING_JSON: JSON.stringify({
          version: 1,
          keys: [{ keyId: "one", privateKeyPemB64: "YQ===" }],
        }),
      }),
    ).toThrow();
    const publicPem = generateKeyPairSync("ed25519").publicKey.export({
      format: "pem",
      type: "spki",
    }) as string;
    expect(() =>
      loadConfigSigningMaterial(
        ringEnvironment([{ keyId: "one", pem: publicPem }]),
      ),
    ).toThrow();
    const rsaPem = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    expect(() =>
      loadConfigSigningMaterial(
        ringEnvironment([{ keyId: "one", pem: rsaPem }]),
      ),
    ).toThrow();
    const legacy = loadConfigSigningMaterial(environment(ed25519Pem()));
    expect(legacy.keys.size).toBe(1);
    expect(() =>
      loadConfigSigningMaterial({ CONFIG_SIGNING_KEY_ID: "one" }),
    ).toThrow();
    expect(() =>
      loadConfigSigningMaterial({
        CONFIG_SIGNING_KEY_RING_JSON: JSON.stringify({ version: 1, keys: [] }),
        CONFIG_SIGNING_KEY_ID: "one",
        CONFIG_SIGNING_PRIVATE_KEY_PEM_B64:
          Buffer.from(ed25519Pem()).toString("base64"),
      }),
    ).toThrow();
  });
  it("loads a runtime-generated Ed25519 private PEM and derives public metadata", () => {
    const material = loadConfigSigningMaterial(environment(ed25519Pem()));
    expect(material.keyId).toBe("config-key");
    expect(material.publicKeySpkiDer.length).toBeGreaterThan(0);
    expect(material.publicKeySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["missing", {}],
    ["empty", { CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: "" }],
    ["invalid base64", { CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: "***=" }],
    ["non-canonical base64", { CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: "YQ===" }],
    [
      "invalid pem",
      {
        CONFIG_SIGNING_PRIVATE_KEY_PEM_B64:
          Buffer.from("not a key").toString("base64"),
      },
    ],
  ])("fails closed for %s private-key input", (_name, input) => {
    expect(() =>
      loadConfigSigningMaterial({
        CONFIG_SIGNING_KEY_ID: "config-key",
        ...input,
      }),
    ).toThrow("bootstrap signing configuration is invalid");
  });

  it("rejects a public key, RSA key, and invalid key identifier", () => {
    const ed = generateKeyPairSync("ed25519");
    const publicPem = ed.publicKey.export({
      format: "pem",
      type: "spki",
    }) as string;
    const rsaPem = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    expect(() => loadConfigSigningMaterial(environment(publicPem))).toThrow();
    expect(() => loadConfigSigningMaterial(environment(rsaPem))).toThrow();
    expect(() =>
      loadConfigSigningMaterial(environment(ed25519Pem(), "bad key id")),
    ).toThrow();
  });

  it("binds only exact Ed25519 public metadata", () => {
    const material = loadConfigSigningMaterial(environment(ed25519Pem()));
    const metadata = {
      keyId: material.keyId,
      algorithm: "Ed25519" as const,
      publicKeySpkiDer: material.publicKeySpkiDer,
      publicKeySha256: material.publicKeySha256,
      createdAt: new Date(),
    };
    expect(() => bindConfigSigningMaterial(material, metadata)).not.toThrow();
    expect(() => bindConfigSigningMaterial(material, undefined)).toThrow();
    expect(() =>
      bindConfigSigningMaterial(material, {
        ...metadata,
        publicKeySpkiDer: Buffer.from("different"),
      }),
    ).toThrow();
    expect(() =>
      bindConfigSigningMaterial(material, {
        ...metadata,
        publicKeySha256: "0".repeat(64),
      }),
    ).toThrow();
  });

  it("signs a standalone v3 envelope through the existing active key lifecycle", async () => {
    const material = loadConfigSigningMaterial(environment(ed25519Pem()));
    const key = material.keys.get("config-key")!;
    const catalog = {
      findSigningKey: async () => ({
        keyId: key.keyId,
        algorithm: "Ed25519" as const,
        publicKeySpkiDer: key.publicKeySpkiDer,
        publicKeySha256: key.publicKeySha256,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      listSigningKeyEvents: async () => [
        {
          id: "11111111-1111-4111-8111-111111111111",
          keyId: key.keyId,
          eventType: "REGISTERED" as const,
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
          reasonCode: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          keyId: key.keyId,
          eventType: "ACTIVATED" as const,
          occurredAt: new Date("2026-01-01T00:00:01.000Z"),
          reasonCode: null,
          createdAt: new Date("2026-01-01T00:00:01.000Z"),
        },
      ],
    };
    const signer = createConfigSigningService(material, catalog);
    const timestamp = "2026-01-01T00:00:00.000Z";
    const signed = await signer.signV3!("config-key", {
      snapshotVersion: "bootstrap_snapshot_v3",
      contractVersion: "control_plane_v3",
      configVersion: 1,
      serverTime: timestamp,
      issuedAt: timestamp,
      expiresAt: "2026-01-01T00:15:00.000Z",
      offlineGraceUntil: "2026-01-02T00:15:00.000Z",
      account: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "ACTIVE",
      },
      accessBasis: "NONE",
      subscription: { state: "NONE", planRevision: null },
      devicePolicy: { status: "ACTIVE" },
      entitlements: {},
      subscriptionAccess: null,
      compatibility: {
        extension: { status: "SUPPORTED", minimumVersion: null },
        browser: { status: "SUPPORTED" },
      },
      features: {},
      ai: { status: "UNCONFIGURED" },
    });
    expect(signed.envelopeVersion).toBe("bootstrap_envelope_v3");
    expect(
      verifyBootstrapEnvelopeV3(signed, new Map([[key.keyId, key.publicKey]])),
    ).toMatchObject({ ok: true });
  });
});
