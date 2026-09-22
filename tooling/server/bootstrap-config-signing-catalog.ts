import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createDatabaseRuntime, type DatabaseRuntime } from "@product/db";
import {
  createP3PolicyPublicationRepository,
  type P3PublicationPort,
} from "@product/db";
import {
  resolveSigningKeyLifecycle,
  SigningKeyEventSchema,
  SigningKeyMetadataSchema,
  type SigningKeyLifecycleResult,
} from "../../packages/server/remote-config/src/index.js";
import { loadConfig } from "@product/shared";
import {
  loadConfigSigningMaterial,
  type ConfigSigningMaterial,
} from "../../apps/api/src/bootstrap-signing.js";

const BOOTSTRAP_REASON = "Initial production signing catalog bootstrap";

export type SigningCatalogBootstrapResult =
  | { kind: "REGISTERED_AND_ACTIVATED"; keyId: string }
  | { kind: "ALREADY_HEALTHY"; keyId: string };

type CatalogQuery = Pick<DatabaseRuntime, "query">;
type CatalogPublication = Pick<
  P3PublicationPort,
  "registerSigningKey" | "activateSigningKey"
>;

export async function bootstrapConfigSigningCatalog(
  database: CatalogQuery,
  material: ConfigSigningMaterial,
  options: {
    publication?: CatalogPublication;
    correlationId?: string;
    reason?: string;
  } = {},
): Promise<SigningCatalogBootstrapResult> {
  const configured = material.keys.get(material.keyId);
  if (!configured) throw new Error("CONFIGURED_SIGNING_KEY_MISSING");

  const rows = await database.query(
    'SELECT key_id AS "keyId",algorithm,public_key_spki_der AS "publicKeySpkiDer",public_key_sha256 AS "publicKeySha256",created_at AS "createdAt" FROM signing_keys ORDER BY key_id',
  );
  const catalog = rows.rows.map((row) => SigningKeyMetadataSchema.parse(row));
  const exact = catalog.find((entry) => entry.keyId === material.keyId);
  const context = {
    actorType: "SYSTEM" as const,
    correlationId: options.correlationId ?? randomUUID(),
    reason: options.reason ?? BOOTSTRAP_REASON,
  };
  const publication =
    options.publication ??
    createP3PolicyPublicationRepository(database as DatabaseRuntime);

  if (!exact) {
    if (catalog.length !== 0) throw new Error("SIGNING_CATALOG_CONFLICT");
    await publication.registerSigningKey(
      {
        keyId: configured.keyId,
        publicKeySpkiDer: configured.publicKeySpkiDer,
      },
      context,
    );
    await publication.activateSigningKey(configured.keyId, context);
    return { kind: "REGISTERED_AND_ACTIVATED", keyId: configured.keyId };
  }

  if (
    exact.algorithm !== "Ed25519" ||
    !Buffer.from(exact.publicKeySpkiDer).equals(configured.publicKeySpkiDer) ||
    exact.publicKeySha256 !== configured.publicKeySha256
  )
    throw new Error("SIGNING_CATALOG_CONFLICT");

  const eventRows = await database.query(
    'SELECT id,key_id AS "keyId",event_type AS "eventType",occurred_at AS "occurredAt",reason_code AS "reasonCode",created_at AS "createdAt" FROM signing_key_events WHERE key_id=$1 ORDER BY occurred_at,id',
    [material.keyId],
  );
  const events = eventRows.rows.map((row) => SigningKeyEventSchema.parse(row));
  const lifecycle: SigningKeyLifecycleResult =
    resolveSigningKeyLifecycle(events);
  if (lifecycle.state === "ACTIVE")
    return { kind: "ALREADY_HEALTHY", keyId: material.keyId };
  if (lifecycle.state !== "REGISTERED")
    throw new Error("SIGNING_CATALOG_CONFLICT");

  await publication.activateSigningKey(material.keyId, context);
  return { kind: "REGISTERED_AND_ACTIVATED", keyId: material.keyId };
}

export async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const database = createDatabaseRuntime(config.databaseUrl);
  try {
    const material = loadConfigSigningMaterial(process.env);
    const result = await bootstrapConfigSigningCatalog(database, material);
    console.log(`CONFIG_SIGNING_CATALOG=${result.kind}`);
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "catalog bootstrap failed",
    );
    process.exitCode = 1;
  });
