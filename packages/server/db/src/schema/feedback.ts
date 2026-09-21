import { sql } from "drizzle-orm";
import {
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
]);

export const feedbackCases = pgTable(
  "feedback_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    deviceId: uuid("device_id").references(() => devices.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
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
    assignedAdminPrincipalId: uuid("assigned_admin_principal_id").references(
      () => adminPrincipals.id,
      { onDelete: "set null", onUpdate: "restrict" },
    ),
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
    caseId: uuid("case_id")
      .notNull()
      .references(() => feedbackCases.id, {
        onDelete: "cascade",
        onUpdate: "restrict",
      }),
    authorType: varchar("author_type", { length: 16 }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "restrict",
    }),
    authorAdminPrincipalId: uuid("author_admin_principal_id").references(
      () => adminPrincipals.id,
      { onDelete: "set null", onUpdate: "restrict" },
    ),
    body: varchar("body", { length: 4000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
    productVersion: varchar("product_version", { length: 64 }),
    extensionVersion: varchar("extension_version", { length: 64 }),
    browserFamily: varchar("browser_family", { length: 64 }),
    category: feedbackCategory("category"),
    status: feedbackCaseStatus("status"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
