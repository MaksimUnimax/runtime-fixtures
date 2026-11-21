import { sql } from "drizzle-orm";
import {
  foreignKey,
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
import { accounts, users, otpChallenges } from "./identity";
import { portalSessions } from "./auth";
import { adminPrincipals } from "./admin";

export const betaMode = pgEnum("beta_mode", ["CLOSED", "OPEN", "PAUSED"]);

export const betaAdmissionState = pgTable(
  "beta_admission_state",
  {
    id: integer("id").primaryKey(),
    mode: betaMode("mode").notNull().default("CLOSED"),
    capacity: integer("capacity").notNull().default(0),
    admitted: integer("admitted").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("beta_admission_state_singleton", sql`${table.id} = 1`),
    check(
      "beta_admission_state_capacity_nonnegative",
      sql`${table.capacity} >= 0`,
    ),
    check(
      "beta_admission_state_admitted_nonnegative",
      sql`${table.admitted} >= 0`,
    ),
    check(
      "beta_admission_state_admitted_within_capacity",
      sql`${table.admitted} <= ${table.capacity}`,
    ),
    check("beta_admission_state_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const betaIdentityInvitations = pgTable(
  "beta_identity_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedIdentityTarget: varchar("normalized_identity_target", {
      length: 320,
    }).notNull(),
    createRequestIdHash: varchar("create_request_id_hash", { length: 128 })
      .notNull()
      .unique("beta_identity_invitations_create_request_unique"),
    createPayloadHash: varchar("create_payload_hash", {
      length: 128,
    }).notNull(),
    createdByAdminPrincipalId: uuid("created_by_admin_principal_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedUserId: uuid("consumed_user_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByAdminPrincipalId: uuid("revoked_by_admin_principal_id"),
    revokeRequestIdHash: varchar("revoke_request_id_hash", {
      length: 128,
    }).unique("beta_identity_invitations_revoke_request_unique"),
    revokePayloadHash: varchar("revoke_payload_hash", { length: 128 }),
  },
  (table) => [
    foreignKey({
      columns: [table.createdByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "beta_identity_invitations_created_by_admin_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.revokedByAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "beta_identity_invitations_revoked_by_admin_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.consumedUserId],
      foreignColumns: [users.id],
      name: "beta_identity_invitations_consumed_user_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("beta_identity_invitations_target_index").on(
      table.normalizedIdentityTarget,
      table.createdAt,
    ),
    index("beta_identity_invitations_expiry_index").on(table.expiresAt),
    check(
      "beta_identity_invitations_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "beta_identity_invitations_consumed_shape",
      sql`(${table.consumedAt} IS NULL AND ${table.consumedUserId} IS NULL) OR (${table.consumedAt} IS NOT NULL AND ${table.consumedUserId} IS NOT NULL)`,
    ),
    check(
      "beta_identity_invitations_revoked_shape",
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByAdminPrincipalId} IS NULL AND ${table.revokeRequestIdHash} IS NULL AND ${table.revokePayloadHash} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByAdminPrincipalId} IS NOT NULL AND ${table.revokeRequestIdHash} IS NOT NULL AND ${table.revokePayloadHash} IS NOT NULL)`,
    ),
    check(
      "beta_identity_invitations_terminal_exclusive",
      sql`NOT (${table.consumedAt} IS NOT NULL AND ${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const betaAdmissions = pgTable(
  "beta_admissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    userId: uuid("user_id").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "beta_admissions_account_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "beta_admissions_user_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("beta_admissions_account_unique").on(table.accountId),
    unique("beta_admissions_user_unique").on(table.userId),
    index("beta_admissions_admitted_at_index").on(table.admittedAt),
  ],
);

export const otpVerifyReplays = pgTable(
  "otp_verify_replays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    challengeId: uuid("challenge_id").notNull(),
    idempotencyHash: varchar("idempotency_hash", { length: 128 }).notNull(),
    userId: uuid("user_id").notNull(),
    portalSessionId: uuid("portal_session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.challengeId],
      foreignColumns: [otpChallenges.id],
      name: "otp_verify_replays_challenge_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "otp_verify_replays_user_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.portalSessionId],
      foreignColumns: [portalSessions.id],
      name: "otp_verify_replays_portal_session_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("otp_verify_replays_challenge_unique").on(table.challengeId),
    unique("otp_verify_replays_challenge_idempotency_unique").on(
      table.challengeId,
      table.idempotencyHash,
    ),
    index("otp_verify_replays_expiry_index").on(table.expiresAt),
  ],
);

export const betaAdmissionMutations = pgTable(
  "beta_admission_mutations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestIdHash: varchar("request_id_hash", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    oldMode: betaMode("old_mode").notNull(),
    oldCapacity: integer("old_capacity").notNull(),
    oldAdmitted: integer("old_admitted").notNull(),
    oldRevision: integer("old_revision").notNull(),
    newMode: betaMode("new_mode").notNull(),
    newCapacity: integer("new_capacity").notNull(),
    newAdmitted: integer("new_admitted").notNull(),
    newRevision: integer("new_revision").notNull(),
    newUpdatedAt: timestamp("new_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "beta_admission_mutations_action",
      sql`${table.action} IN ('OPEN', 'PAUSE', 'CLOSE', 'ADD_CAPACITY', 'SET_CAPACITY')`,
    ),
    foreignKey({
      columns: [table.actorPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "beta_admission_mutations_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("beta_admission_mutations_request_unique").on(table.requestIdHash),
    index("beta_admission_mutations_created_at_index").on(table.createdAt),
    check(
      "beta_admission_mutations_capacity_nonnegative",
      sql`${table.oldCapacity} >= 0 AND ${table.newCapacity} >= 0`,
    ),
    check(
      "beta_admission_mutations_admitted_within_capacity",
      sql`${table.oldAdmitted} <= ${table.oldCapacity} AND ${table.newAdmitted} <= ${table.newCapacity}`,
    ),
    check(
      "beta_admission_mutations_admitted_nonnegative",
      sql`${table.oldAdmitted} >= 0 AND ${table.newAdmitted} >= 0`,
    ),
    check(
      "beta_admission_mutations_revision_positive",
      sql`${table.oldRevision} > 0 AND ${table.newRevision} > 0`,
    ),
  ],
);
