import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  integer,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accounts } from "./identity";
import { devices } from "./devices";

export const transferRequestState = pgEnum("transfer_request_state", [
  "REQUESTED",
  "SOURCE_SEEN",
  "PACKET_AVAILABLE_EPHEMERAL",
  "DELIVERED_TO_RECIPIENT",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
]);

export const credentialTransferRequests = pgTable(
  "credential_transfer_requests",
  {
    requestId: uuid("request_id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    recipientDeviceId: uuid("recipient_device_id")
      .notNull()
      .references(() => devices.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    sourceDeviceId: uuid("source_device_id").references(() => devices.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    recipientPublicKeySpki: varchar("recipient_public_key_spki", {
      length: 2048,
    }).notNull(),
    selectedStoreIds: varchar("selected_store_ids", { length: 128 })
      .array()
      .notNull(),
    state: transferRequestState("state").notNull().default("REQUESTED"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("credential_transfer_requests_account_state_expiry_index").on(
      table.accountId,
      table.state,
      table.expiresAt,
    ),
    index("credential_transfer_requests_source_state_expiry_index").on(
      table.sourceDeviceId,
      table.state,
      table.expiresAt,
    ),
    check(
      "credential_transfer_requests_selected_store_ids_bounded",
      sql`cardinality(${table.selectedStoreIds}) <= 16`,
    ),
    check(
      "credential_transfer_requests_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "credential_transfer_requests_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);
