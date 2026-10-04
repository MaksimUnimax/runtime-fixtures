import { sql } from "drizzle-orm";
import {
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
    adminPrincipalId: uuid("admin_principal_id")
      .notNull()
      .references(() => adminPrincipals.id, { onDelete: "restrict" }),
    issuerRevision: integer("issuer_revision").notNull(),
    // Provenance only: the short-lived issuing session may be retained or deleted normally.
    sourceAdminSessionId: uuid("source_admin_session_id").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
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
    index("admin_maintenance_grants_principal_idx").on(t.adminPrincipalId),
    check("admin_maintenance_grants_revision", sql`${t.issuerRevision} > 0`),
    check(
      "admin_maintenance_grants_permissions",
      sql`jsonb_typeof(${t.permissions})='array' AND jsonb_array_length(${t.permissions}) BETWEEN 1 AND 9`,
    ),
    check(
      "admin_maintenance_grants_expiry",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      "admin_maintenance_grants_revocation",
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`,
    ),
    check(
      "admin_maintenance_grants_rotation",
      sql`(${t.previousTokenHash} IS NULL AND ${t.rotationNonceHash} IS NULL AND ${t.rotationReplayUntil} IS NULL) OR (${t.previousTokenHash} IS NOT NULL AND ${t.rotationNonceHash} IS NOT NULL AND ${t.rotationReplayUntil} IS NOT NULL)`,
    ),
  ],
);
