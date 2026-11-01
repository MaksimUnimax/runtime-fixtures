import { sql } from "drizzle-orm";
import {
  foreignKey,
  pgTable,
  uuid,
  varchar,
  integer,
  jsonb,
  char,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { adminPrincipals } from "./schema/admin.js";
export const adminMaintenanceGrants = pgTable(
  "admin_maintenance_grants",
  {
    id: uuid("id").primaryKey(),
    label: varchar("label", { length: 64 }).notNull(),
    adminPrincipalId: uuid("admin_principal_id").notNull(),
    issuerRevision: integer("issuer_revision").notNull(),
    // Provenance only: the short-lived issuing session may be retained or deleted normally.
    sourceAdminSessionId: uuid("source_admin_session_id").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    tokenHash: char("token_hash", { length: 64 })
      .notNull()
      .unique("admin_maintenance_grants_token_hash_key"),
    previousTokenHash: char("previous_token_hash", { length: 64 }),
    rotationNonceHash: char("rotation_nonce_hash", { length: 64 }),
    rotationReplayUntil: timestamp("rotation_replay_until", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.adminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "admin_maintenance_grants_admin_principal_id_fkey",
    })
      .onDelete("restrict")
      .onUpdate("no action"),
    index("admin_maintenance_grants_principal_idx").on(t.adminPrincipalId),
    check(
      "admin_maintenance_grants_issuer_revision_check",
      sql`${t.issuerRevision} > 0`,
    ),
    check(
      "admin_maintenance_grants_permissions_check",
      sql`jsonb_typeof(${t.permissions})='array' AND jsonb_array_length(${t.permissions}) BETWEEN 1 AND 9`,
    ),
    check(
      "admin_maintenance_grants_check",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      "admin_maintenance_grants_check2",
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`,
    ),
    check(
      "admin_maintenance_grants_check1",
      sql`(${t.previousTokenHash} IS NULL AND ${t.rotationNonceHash} IS NULL AND ${t.rotationReplayUntil} IS NULL) OR (${t.previousTokenHash} IS NOT NULL AND ${t.rotationNonceHash} IS NOT NULL AND ${t.rotationReplayUntil} IS NOT NULL)`,
    ),
  ],
);
