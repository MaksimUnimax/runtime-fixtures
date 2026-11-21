import { sql } from "drizzle-orm";
import {
  foreignKey,
  uniqueIndex,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { portalSessions } from "./auth";
import { users } from "./identity";

export const adminPrincipalStatus = pgEnum("admin_principal_status", [
  "ACTIVE",
  "SUSPENDED",
]);
export const adminRole = pgEnum("admin_role", [
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BILLING_READONLY",
  "ADMIN_BETA_OPERATOR",
]);

export const adminPrincipals = pgTable(
  "admin_principals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    status: adminPrincipalStatus("status").notNull().default("ACTIVE"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "admin_principals_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "admin_principals_user_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("admin_principals_user_id_unique").on(table.userId),
    check("admin_principals_revision_positive", sql`${table.revision} > 0`),
    index("admin_principals_status_index").on(table.status),
  ],
);

export const adminRoleGrants = pgTable(
  "admin_role_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminPrincipalId: uuid("admin_principal_id").notNull(),
    role: adminRole("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedByAdminPrincipalId: uuid("granted_by_admin_principal_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByAdminPrincipalId: uuid("revoked_by_admin_principal_id"),
  },
  (table) => [
    check(
      "admin_role_grants_revocation_shape",
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByAdminPrincipalId} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByAdminPrincipalId} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.adminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "admin_role_grants_principal_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.grantedByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "admin_role_grants_granted_by_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.revokedByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "admin_role_grants_revoked_by_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("admin_role_grants_principal_index").on(table.adminPrincipalId),
    uniqueIndex("admin_role_grants_active_principal_role_unique")
      .on(table.adminPrincipalId, table.role)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminPrincipalId: uuid("admin_principal_id").notNull(),
    sourcePortalSessionId: uuid("source_portal_session_id").notNull(),
    sessionTokenHash: varchar("session_token_hash", { length: 128 })
      .notNull()
      .unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 128 }),
  },
  (table) => [
    foreignKey({
      columns: [table.adminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "admin_sessions_principal_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.sourcePortalSessionId],
      foreignColumns: [portalSessions.id],
      name: "admin_sessions_source_portal_session_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("admin_sessions_principal_index").on(table.adminPrincipalId),
    index("admin_sessions_source_portal_session_index").on(
      table.sourcePortalSessionId,
    ),
    check(
      "admin_sessions_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "admin_sessions_revoke_shape",
      sql`(${table.revokedAt} IS NULL AND ${table.revokeReason} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokeReason} IS NOT NULL)`,
    ),
  ],
);
