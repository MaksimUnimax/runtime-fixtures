import { sql } from "drizzle-orm";
import {
  uniqueIndex,
  foreignKey,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminPrincipals } from "./admin";
import { accounts, users } from "./identity";
import { devices } from "./devices";

export const feedbackCategory = pgEnum("feedback_category", [
  "INSTALLATION",
  "AUTH",
  "OTP",
  "STORE",
  "OZON",
  "WILDBERRIES",
  "AI",
  "COMMAND",
  "REPORT",
  "FILE_RESULT",
  "SYNC",
  "TRANSFER",
  "BACKUP",
  "BROWSER_COMPAT",
  "SERVER_UNAVAILABLE",
  "VERSION_INCOMPATIBLE",
  "OTHER",
]);
export const feedbackCaseStatus = pgEnum("feedback_case_status", [
  "NEW",
  "TRIAGED",
  "NEEDS_INFO",
  "RESOLVED",
  "CLOSED",
]);
export const feedbackSeverity = pgEnum("feedback_severity", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "BLOCKING",
]);
export const feedbackMarketplace = pgEnum("feedback_marketplace", [
  "NONE",
  "OZON",
  "WILDBERRIES",
]);
export const feedbackSignalEvent = pgEnum("feedback_signal_event", [
  "registration_started",
  "account_created",
  "device_activated",
  "first_store_added",
  "first_start",
  "feedback_case_created",
  "feedback_case_resolved",
  "feedback_case_triaged",
  "feedback_case_closed",
]);

export const feedbackCases = pgTable(
  "feedback_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id"),
    createdByUserId: uuid("created_by_user_id"),
    deviceId: uuid("device_id"),
    category: feedbackCategory("category").notNull(),
    severity: feedbackSeverity("severity").notNull().default("LOW"),
    status: feedbackCaseStatus("status").notNull().default("NEW"),
    description: varchar("description", { length: 4000 }).notNull(),
    diagnostics: jsonb("diagnostics"),
    serverVersion: varchar("server_version", { length: 64 }),
    portalVersion: varchar("portal_version", { length: 64 }),
    extensionVersion: varchar("extension_version", { length: 64 }),
    browserFamily: varchar("browser_family", { length: 64 }),
    browserVersion: varchar("browser_version", { length: 64 }),
    marketplace: feedbackMarketplace("marketplace").notNull().default("NONE"),
    supportCode: varchar("support_code", { length: 128 }),
    releaseIdentity: varchar("release_identity", { length: 128 }),
    assignedAdminPrincipalId: uuid("assigned_admin_principal_id"),
    resolutionCode: varchar("resolution_code", { length: 128 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "feedback_cases_account_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "feedback_cases_created_by_user_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.deviceId],
      foreignColumns: [devices.id],
      name: "feedback_cases_device_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.assignedAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "feedback_cases_admin_principal_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    index("feedback_cases_account_created_index").on(
      table.accountId,
      table.createdAt,
    ),
    index("feedback_cases_status_updated_index").on(
      table.status,
      table.updatedAt,
    ),
    index("feedback_cases_filter_index").on(
      table.category,
      table.extensionVersion,
      table.browserFamily,
      table.marketplace,
    ),
    check(
      "feedback_cases_description_not_blank",
      sql`length(trim(${table.description})) > 0`,
    ),
  ],
);

export const feedbackFollowups = pgTable(
  "feedback_followups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id").notNull(),
    authorType: varchar("author_type", { length: 16 }).notNull(),
    authorUserId: uuid("author_user_id"),
    authorAdminPrincipalId: uuid("author_admin_principal_id"),
    body: varchar("body", { length: 4000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.caseId],
      foreignColumns: [feedbackCases.id],
      name: "feedback_followups_case_fk",
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.authorUserId],
      foreignColumns: [users.id],
      name: "feedback_followups_user_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.authorAdminPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "feedback_followups_admin_fk",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    index("feedback_followups_case_created_index").on(
      table.caseId,
      table.createdAt,
    ),
    check(
      "feedback_followups_author_type_valid",
      sql`${table.authorType} IN ('USER','SUPPORT','ADMIN')`,
    ),
    check(
      "feedback_followups_body_not_blank",
      sql`length(trim(${table.body})) > 0`,
    ),
  ],
);

export const feedbackSignalEvents = pgTable(
  "feedback_signal_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event: feedbackSignalEvent("event").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    accountId: uuid("account_id"),
    deviceId: uuid("device_id"),
    subjectId: uuid("subject_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    productVersion: varchar("product_version", { length: 64 }),
    extensionVersion: varchar("extension_version", { length: 64 }),
    releaseIdentity: varchar("release_identity", { length: 128 }),
    browserFamily: varchar("browser_family", { length: 64 }),
    browserVersion: varchar("browser_version", { length: 64 }),
    marketplace: feedbackMarketplace("marketplace"),
    category: feedbackCategory("category"),
    status: feedbackCaseStatus("status"),
    supportCode: varchar("support_code", { length: 128 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("feedback_signal_events_funnel_filter_index").on(
      table.occurredAt,
      table.event,
      table.accountId,
      table.subjectId,
      table.marketplace,
    ),
    uniqueIndex("feedback_signal_events_account_first_milestone_unique")
      .on(table.accountId, table.event)
      .where(
        sql`${table.accountId} IS NOT NULL AND ${table.event} IN ('registration_started','account_created','device_activated','first_store_added','first_start')`,
      ),
    uniqueIndex("feedback_signal_events_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "feedback_signal_events_account_id_fkey",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.deviceId],
      foreignColumns: [devices.id],
      name: "feedback_signal_events_device_id_fkey",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
    index("feedback_signal_events_aggregate_index").on(
      table.occurredAt,
      table.event,
      table.productVersion,
      table.extensionVersion,
      table.browserFamily,
      table.category,
      table.status,
    ),
  ],
);

export const feedbackRetentionConfig = pgTable(
  "feedback_retention_config",
  {
    id: integer("id").primaryKey(),
    closedCaseDays: integer("closed_case_days").notNull().default(90),
    signalDays: integer("signal_days").notNull().default(180),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("feedback_retention_config_singleton", sql`${table.id} = 1`),
    check(
      "feedback_retention_config_positive",
      sql`${table.closedCaseDays} > 0 AND ${table.signalDays} > 0`,
    ),
  ],
);
