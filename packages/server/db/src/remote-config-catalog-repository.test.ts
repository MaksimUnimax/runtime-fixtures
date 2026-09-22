import { createHash, generateKeyPairSync } from "node:crypto";
import { expect, it } from "vitest";
import { createRemoteConfigCatalogRepository } from "./remote-config-catalog-repository.js";
import type { DatabaseQuery } from "./index.js";

it("fails closed for corrupt signing-key rows", async () => {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ format: "der", type: "spki" });
  const valid = {
    keyId: "config-current",
    algorithm: "Ed25519",
    publicKeySpkiDer: der,
    publicKeySha256: createHash("sha256").update(der).digest("hex"),
    createdAt: new Date(),
  };
  for (const row of [
    { ...valid, publicKeySha256: "f".repeat(64) },
    { ...valid, publicKeySpkiDer: Buffer.from("not an SPKI") },
    { ...valid, algorithm: "RSA" },
    { ...valid, publicKeySha256: "F".repeat(64) },
  ]) {
    const database: DatabaseQuery = {
      query: async () => ({ rows: [row] }),
    } as DatabaseQuery;
    await expect(
      createRemoteConfigCatalogRepository(database).findSigningKey(
        "config-current",
      ),
    ).rejects.toThrow();
  }
});

it("reads the approved immutable historical signing reason unchanged", async () => {
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    keyId: "config-current",
    eventType: "REGISTERED",
    occurredAt: new Date("2026-09-21T00:00:00.000Z"),
    reasonCode: "PREPROD_CATALOG_REPAIR",
    createdAt: new Date("2026-09-21T00:00:00.000Z"),
  };
  const database: DatabaseQuery = {
    query: async (sql) =>
      sql.includes("signing_key_events") ? { rows: [event] } : { rows: [] },
  } as DatabaseQuery;
  await expect(
    createRemoteConfigCatalogRepository(database).listSigningKeyEvents(
      "config-current",
    ),
  ).resolves.toEqual([event]);
});
