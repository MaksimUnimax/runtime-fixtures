import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { sessions } from "./devices";

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    sessionTokenHash: varchar("session_token_hash", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 256 }),
  },
  (table) => [
    unique("portal_sessions_session_token_hash_unique").on(
      table.sessionTokenHash,
    ),
    index("portal_sessions_user_id_index").on(table.userId),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    tokenHash: varchar("token_hash", { length: 512 }).notNull(),
    generation: integer("generation").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    reuseDetectedAt: timestamp("reuse_detected_at", { withTimezone: true }),
    rotationIdempotencyHash: varchar("rotation_idempotency_hash", {
      length: 128,
    }),
    replayExpiresAt: timestamp("replay_expires_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "refresh_tokens_p2_4_rotation_replay",
      sql`(${table.rotationIdempotencyHash} IS NULL) = (${table.replayExpiresAt} IS NULL)`,
    ),
    unique("refresh_tokens_token_hash_unique").on(table.tokenHash),
    index("refresh_tokens_session_id_index").on(table.sessionId),
    index("refresh_tokens_rotation_replay_index").on(
      table.rotationIdempotencyHash,
      table.replayExpiresAt,
    ),
    unique("refresh_tokens_session_id_generation_unique").on(
      table.sessionId,
      table.generation,
    ),
    foreignKey({
      columns: [table.replacedByTokenId],
      foreignColumns: [table.id],
      name: "refresh_tokens_replaced_by_token_id_refresh_tokens_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "refresh_tokens_generation_nonnegative",
      sql`${table.generation} >= 0`,
    ),
  ],
);
