import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accountConnectionCredentials } from "./connection-codes";
import { devices, sessions } from "./devices";

/** A durable enrollment receipt also prevents a late unknown attempt becoming a second device. */
export const connectionExchangeReceipts = pgTable(
  "connection_exchange_receipts",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => accountConnectionCredentials.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    operationHash: varchar("operation_hash", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", {
      length: 128,
    }).notNull(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    replayUntil: timestamp("replay_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "connection_exchange_receipts_pkey",
      columns: [table.credentialId, table.operationHash],
    }),
    unique("connection_exchange_receipts_device_unique").on(table.deviceId),
    unique("connection_exchange_receipts_session_unique").on(table.sessionId),
    index("connection_exchange_receipts_replay_until_index").on(
      table.replayUntil,
    ),
    check(
      "connection_exchange_receipts_replay_after_creation",
      sql.raw("replay_until > created_at"),
    ),
  ],
);
