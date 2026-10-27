import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accounts, users } from "./identity";

export const accountConnectionCredentials = pgTable(
  "account_connection_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    verifierHash: varchar("verifier_hash", { length: 128 }).notNull(),
    generation: integer("generation").notNull(),
    issueOperationHash: varchar("issue_operation_hash", {
      length: 128,
    }).notNull(),
    issueRequestFingerprint: varchar("issue_request_fingerprint", {
      length: 128,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: varchar("revocation_reason", { length: 32 }),
  },
  (table) => [
    unique("account_connection_credentials_verifier_unique").on(
      table.verifierHash,
    ),
    unique("account_connection_credentials_account_generation_unique").on(
      table.accountId,
      table.generation,
    ),
    unique("account_connection_credentials_account_operation_unique").on(
      table.accountId,
      table.issueOperationHash,
    ),
    unique("account_connection_credentials_id_account_unique").on(
      table.id,
      table.accountId,
    ),
    uniqueIndex("account_connection_credentials_one_active")
      .on(table.accountId)
      .where(sql.raw("revoked_at IS NULL")),
    check(
      "account_connection_credentials_generation_positive",
      sql.raw("generation > 0"),
    ),
    check(
      "account_connection_credentials_revocation_shape",
      sql.raw(
        "(revoked_at IS NULL AND revocation_reason IS NULL) OR (revoked_at >= created_at AND revocation_reason IS NOT NULL)",
      ),
    ),
  ],
);
