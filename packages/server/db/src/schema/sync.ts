import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accounts } from "./identity";

export const syncEntities = pgTable(
  "sync_entities",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    serverRevision: integer("server_revision").notNull().default(0),
    state: jsonb("state").notNull(),
    installationId: uuid("installation_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("sync_entities_account_entity_unique").on(
      table.accountId,
      table.entityId,
    ),
    index("sync_entities_account_updated_index").on(
      table.accountId,
      table.updatedAt,
    ),
    check(
      "sync_entities_revision_nonnegative",
      sql`${table.serverRevision} >= 0`,
    ),
    check(
      "sync_entities_state_bounded",
      sql`octet_length(${table.state}::text) <= 4096`,
    ),
  ],
);

export const syncRequestReceipts = pgTable(
  "sync_request_receipts",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    installationId: uuid("installation_id").notNull(),
    requestId: uuid("request_id").notNull(),
    entityId: varchar("entity_id", { length: 128 }).notNull(),
    mutationId: varchar("mutation_id", { length: 320 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    serverRevision: integer("server_revision").notNull(),
    serverState: jsonb("server_state"),
    code: varchar("code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("sync_request_receipts_account_installation_request_unique").on(
      table.accountId,
      table.installationId,
      table.requestId,
    ),
    index("sync_request_receipts_account_entity_index").on(
      table.accountId,
      table.entityId,
    ),
    check(
      "sync_request_receipts_state_bounded",
      sql`${table.serverState} IS NULL OR octet_length(${table.serverState}::text) <= 4096`,
    ),
  ],
);
