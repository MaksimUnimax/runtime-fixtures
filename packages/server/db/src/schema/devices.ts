import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  customType,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { BrowserFamilies } from "@product/shared";
import { accounts, users } from "./identity";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const browserFamily = pgEnum("browser_family", BrowserFamilies);
export const deviceAuthorizationStatus = pgEnum("device_authorization_status", [
  "PENDING",
  "APPROVED",
  "DENIED",
  "EXPIRED",
  "EXCHANGED",
]);
export const deviceStatus = pgEnum("device_status", ["ACTIVE", "REVOKED"]);
export const sessionStatus = pgEnum("session_status", [
  "ACTIVE",
  "REVOKED",
  "COMPROMISED",
]);

export const deviceAuthorizations = pgTable(
  "device_authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceCodeHash: varchar("device_code_hash", { length: 512 }).notNull(),
    userCodeHash: varchar("user_code_hash", { length: 512 }).notNull(),
    status: deviceAuthorizationStatus("status").notNull().default("PENDING"),
    requestedClientType: varchar("requested_client_type", {
      length: 64,
    }).notNull(),
    browserFamily: browserFamily("browser_family"),
    browserVersion: varchar("browser_version", { length: 64 }),
    extensionVersion: varchar("extension_version", { length: 64 }),
    deviceLabel: varchar("device_label", { length: 256 }),
    idempotencyKeyHash: varchar("idempotency_key_hash", { length: 128 }),
    requestFingerprint: varchar("request_fingerprint", { length: 128 }),
    startSecretCiphertext: bytea("start_secret_ciphertext"),
    startSecretNonce: bytea("start_secret_nonce"),
    startSecretAuthTag: bytea("start_secret_auth_tag"),
    approvedAccountId: uuid("approved_account_id").references(
      () => accounts.id,
      { onDelete: "restrict", onUpdate: "restrict" },
    ),
    approvedUserId: uuid("approved_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    deniedAt: timestamp("denied_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    exchangedAt: timestamp("exchanged_at", { withTimezone: true }),
    exchangeIdempotencyKeyHash: varchar("exchange_idempotency_key_hash", {
      length: 128,
    }),
    exchangeReplayUntil: timestamp("exchange_replay_until", {
      withTimezone: true,
    }),
    exchangedDeviceId: uuid("exchanged_device_id").references(
      () => devices.id,
      { onDelete: "restrict", onUpdate: "restrict" },
    ),
    exchangedSessionId: uuid("exchanged_session_id").references(
      () => sessions.id,
      { onDelete: "restrict", onUpdate: "restrict" },
    ),
  },
  (table) => [
    unique("device_authorizations_device_code_hash_unique").on(
      table.deviceCodeHash,
    ),
    unique("device_authorizations_user_code_hash_unique").on(
      table.userCodeHash,
    ),
    index("device_authorizations_status_expires_at_index").on(
      table.status,
      table.expiresAt,
    ),
    check(
      "device_authorizations_client_metadata_shape",
      sql`(${table.browserFamily} IS NULL AND ${table.browserVersion} IS NULL AND ${table.extensionVersion} IS NULL) OR (${table.browserFamily} IS NOT NULL AND ${table.extensionVersion} IS NOT NULL)`,
    ),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: deviceStatus("status").notNull().default("ACTIVE"),
    label: varchar("label", { length: 256 }),
    browserFamily: browserFamily("browser_family"),
    browserVersionLastSeen: varchar("browser_version_last_seen", {
      length: 64,
    }),
    extensionVersionLastSeen: varchar("extension_version_last_seen", {
      length: 64,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 256 }),
  },
  (table) => [
    index("devices_account_id_index").on(table.accountId),
    index("devices_account_id_status_index").on(table.accountId, table.status),
    check(
      "devices_client_metadata_shape",
      sql`(${table.browserFamily} IS NULL AND ${table.browserVersionLastSeen} IS NULL AND ${table.extensionVersionLastSeen} IS NULL) OR (${table.browserFamily} IS NOT NULL AND ${table.extensionVersionLastSeen} IS NOT NULL)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: sessionStatus("status").notNull().default("ACTIVE"),
    tokenFamilyId: uuid("token_family_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: varchar("revoke_reason", { length: 256 }),
  },
  (table) => [
    unique("sessions_token_family_id_unique").on(table.tokenFamilyId),
    index("sessions_device_id_index").on(table.deviceId),
    index("sessions_account_id_index").on(table.accountId),
  ],
);
