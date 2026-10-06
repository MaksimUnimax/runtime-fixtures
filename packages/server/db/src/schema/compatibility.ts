import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  boolean,
  integer,
  unique,
} from "drizzle-orm/pg-core";
import { browserFamily } from "./devices";

export const extensionReleases = pgTable(
  "extension_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: varchar("version", { length: 64 }).notNull(),
    releaseChannel: varchar("release_channel", { length: 32 }).notNull(),
    artifactSha256: varchar("artifact_sha256", { length: 64 }),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("extension_releases_version_unique").on(t.version),
    check(
      "extension_releases_artifact_sha256_format",
      sql`${t.artifactSha256} IS NULL OR ${t.artifactSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export const extensionReleaseContracts = pgTable(
  "extension_release_contracts",
  {
    releaseId: uuid("release_id").notNull(),
    contractVersion: varchar("contract_version", { length: 64 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.contractVersion] }),
    foreignKey({
      columns: [t.releaseId],
      foreignColumns: [extensionReleases.id],
      name: "extension_release_contracts_release_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
export const extensionReleaseBrowsers = pgTable(
  "extension_release_browsers",
  {
    releaseId: uuid("release_id").notNull(),
    browserFamily: browserFamily("browser_family").notNull(),
    artifactSha256: varchar("artifact_sha256", { length: 64 }),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.browserFamily] }),
    check(
      "extension_release_browsers_artifact_sha256_format",
      sql`${t.artifactSha256} IS NULL OR ${t.artifactSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      columns: [t.releaseId],
      foreignColumns: [extensionReleases.id],
      name: "extension_release_browsers_release_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
export const compatibilityPolicyRevisions = pgTable(
  "compatibility_policy_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyKey: varchar("policy_key", { length: 64 }).notNull(),
    revision: integer("revision").notNull(),
    contractVersion: varchar("contract_version", { length: 64 }).notNull(),
    browserFamily: browserFamily("browser_family"),
    minimumExtensionVersion: varchar("minimum_extension_version", {
      length: 64,
    }),
    recommendedExtensionVersion: varchar("recommended_extension_version", {
      length: 64,
    }),
    minimumBrowserVersion: varchar("minimum_browser_version", { length: 64 }),
    maintenanceMode: boolean("maintenance_mode").notNull().default(false),
    maintenanceCode: varchar("maintenance_code", { length: 64 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("compatibility_policy_revisions_policy_key_revision_unique").on(
      t.policyKey,
      t.revision,
    ),
    check(
      "compatibility_policy_revisions_revision_positive",
      sql`${t.revision} > 0`,
    ),
  ],
);
export const compatibilityPolicyBlockedVersions = pgTable(
  "compatibility_policy_blocked_versions",
  {
    policyRevisionId: uuid("policy_revision_id").notNull(),
    extensionVersion: varchar("extension_version", { length: 64 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.policyRevisionId, t.extensionVersion] }),
    foreignKey({
      columns: [t.policyRevisionId],
      foreignColumns: [compatibilityPolicyRevisions.id],
      name: "compatibility_policy_blocked_versions_policy_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
