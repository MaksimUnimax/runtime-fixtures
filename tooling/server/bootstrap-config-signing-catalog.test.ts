import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "@product/db";
import type { ConfigSigningMaterial } from "../../apps/api/src/bootstrap-signing.js";
import { bootstrapConfigSigningCatalog } from "./bootstrap-config-signing-catalog.js";

const keyId = "config-current";
const pair = generateKeyPairSync("ed25519");
const der = pair.publicKey.export({ format: "der", type: "spki" });
const material = {
  keyId,
  privateKey: pair.privateKey,
  publicKey: pair.publicKey,
  publicKeySpkiDer: der,
  publicKeySha256: createHash("sha256").update(der).digest("hex"),
  keys: new Map([
    [
      keyId,
      {
        keyId,
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        publicKeySpkiDer: der,
        publicKeySha256: createHash("sha256").update(der).digest("hex"),
      },
    ],
  ]),
  sign: (() => undefined) as ConfigSigningMaterial["sign"],
} satisfies ConfigSigningMaterial;

function fakeDatabase(rows: unknown[] = []) {
  return {
    query: vi.fn(async (text: string) =>
      text.includes("FROM signing_keys") ? { rows } : { rows: [] },
    ),
  } as unknown as DatabaseRuntime;
}

function publication() {
  return {
    registerSigningKey: vi.fn(async () => undefined),
    activateSigningKey: vi.fn(async () => undefined),
  };
}

describe("canonical signing catalog bootstrap tool", () => {
  it("uses repository registration and activation for an empty catalog", async () => {
    const database = fakeDatabase();
    const repository = publication();
    const result = await bootstrapConfigSigningCatalog(database, material, {
      publication: repository,
    });
    expect(result.kind).toBe("REGISTERED_AND_ACTIVATED");
    expect(repository.registerSigningKey).toHaveBeenCalledOnce();
    expect(repository.activateSigningKey).toHaveBeenCalledOnce();
  });

  it("returns healthy without mutating an exact active catalog entry", async () => {
    const database = fakeDatabase([
      {
        keyId,
        algorithm: "Ed25519",
        publicKeySpkiDer: der,
        publicKeySha256: material.publicKeySha256,
        createdAt: new Date("2026-09-21T00:00:00.000Z"),
      },
    ]);
    database.query = vi.fn(async (text: string) => {
      if (text.includes("FROM signing_keys"))
        return {
          rows: [
            {
              keyId,
              algorithm: "Ed25519",
              publicKeySpkiDer: der,
              publicKeySha256: material.publicKeySha256,
              createdAt: new Date("2026-09-21T00:00:00.000Z"),
            },
          ],
        };
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            keyId,
            eventType: "REGISTERED",
            occurredAt: new Date("2026-09-21T00:00:00.000Z"),
            reasonCode: null,
            createdAt: new Date("2026-09-21T00:00:00.000Z"),
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            keyId,
            eventType: "ACTIVATED",
            occurredAt: new Date("2026-09-21T00:00:01.000Z"),
            reasonCode: "PREPROD_CATALOG_REPAIR",
            createdAt: new Date("2026-09-21T00:00:01.000Z"),
          },
        ],
      };
    }) as never;
    const repository = publication();
    const result = await bootstrapConfigSigningCatalog(database, material, {
      publication: repository,
    });
    expect(result.kind).toBe("ALREADY_HEALTHY");
    expect(repository.registerSigningKey).not.toHaveBeenCalled();
    expect(repository.activateSigningKey).not.toHaveBeenCalled();
  });

  it("fails closed for a conflicting non-empty catalog", async () => {
    const other = generateKeyPairSync("ed25519").publicKey.export({
      format: "der",
      type: "spki",
    });
    const database = fakeDatabase([
      {
        keyId: "config-other",
        algorithm: "Ed25519",
        publicKeySpkiDer: other,
        publicKeySha256: createHash("sha256").update(other).digest("hex"),
        createdAt: new Date("2026-09-21T00:00:00.000Z"),
      },
    ]);
    const repository = publication();
    await expect(
      bootstrapConfigSigningCatalog(database, material, {
        publication: repository,
      }),
    ).rejects.toThrow("SIGNING_CATALOG_CONFLICT");
    expect(repository.registerSigningKey).not.toHaveBeenCalled();
    expect(repository.activateSigningKey).not.toHaveBeenCalled();
  });

  it("contains no direct signing-event INSERT or history mutation", () => {
    const source = readFileSync(
      new URL("./bootstrap-config-signing-catalog.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/INSERT\s+INTO\s+signing_key_events/i);
    expect(source).not.toMatch(/\b(UPDATE|DELETE)\s+signing_key_events/i);
    expect(source).toContain("registerSigningKey");
    expect(source).toContain("activateSigningKey");
  });
});
