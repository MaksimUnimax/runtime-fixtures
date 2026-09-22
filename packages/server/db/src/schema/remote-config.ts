import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  customType,
} from "drizzle-orm/pg-core";
import { compatibilityPolicyRevisions } from "./compatibility";
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const signingKeyEventType = pgEnum("signing_key_event_type", [
  "REGISTERED",
  "ACTIVATED",
  "RETIRED",
  "REVOKED",
]);
export const signingKeys = pgTable(
  "signing_keys",
  {
    keyId: varchar("key_id", { length: 64 }).primaryKey(),
    algorithm: varchar("algorithm", { length: 16 }).notNull(),
    publicKeySpkiDer: bytea("public_key_spki_der").notNull(),
    publicKeySha256: varchar("public_key_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("signing_keys_algorithm_ed25519", sql`${t.algorithm} = 'Ed25519'`),
    check(
      "signing_keys_public_key_sha256_format",
      sql`${t.publicKeySha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export const signingKeyEvents = pgTable(
  "signing_key_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyId: varchar("key_id", { length: 64 }).notNull(),
    eventType: signingKeyEventType("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.keyId],
      foreignColumns: [signingKeys.keyId],
      name: "signing_key_events_key_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("signing_key_events_key_id_occurred_at_index").on(
      t.keyId,
      t.occurredAt,
    ),
    check(
      "signing_key_events_reason_code_contract",
      sql`${t.reasonCode} IS NULL OR ${t.reasonCode} ~ '^[a-z0-9][a-z0-9._-]{0,63}$'`,
    ),
  ],
);
export const configReleases = pgTable(
  "config_releases",
  {
    configVersion: integer("config_version")
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    contractVersion: varchar("contract_version", { length: 64 }).notNull(),
    snapshotVersion: varchar("snapshot_version", { length: 64 }).notNull(),
    envelopeVersion: varchar("envelope_version", { length: 64 }).notNull(),
    contentHashSha256: varchar("content_hash_sha256", { length: 64 }).notNull(),
    sourceFingerprintSha256: varchar("source_fingerprint_sha256", {
      length: 64,
    }).notNull(),
    signingKeyId: varchar("signing_key_id", { length: 64 }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.signingKeyId],
      foreignColumns: [signingKeys.keyId],
      name: "config_releases_signing_key_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "config_releases_content_hash_sha256_format",
      sql`${t.contentHashSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "config_releases_source_fingerprint_sha256_format",
      sql`${t.sourceFingerprintSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export const configReleaseCompatibilityPolicies = pgTable(
  "config_release_compatibility_policies",
  {
    configVersion: integer("config_version").notNull(),
    policyRevisionId: uuid("policy_revision_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.configVersion, t.policyRevisionId] }),
    foreignKey({
      columns: [t.configVersion],
      foreignColumns: [configReleases.configVersion],
      name: "config_release_compatibility_policies_config_version_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [t.policyRevisionId],
      foreignColumns: [compatibilityPolicyRevisions.id],
      name: "config_release_compatibility_policies_policy_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
