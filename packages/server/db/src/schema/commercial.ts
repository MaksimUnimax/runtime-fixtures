import { sql, type SQLWrapper } from "drizzle-orm";
import {
  foreignKey,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accounts } from "./identity";

export const planStatus = pgEnum("plan_status", [
  "DRAFT",
  "ACTIVE",
  "HIDDEN",
  "ARCHIVED",
]);
export const planRevisionState = pgEnum("plan_revision_state", [
  "DRAFT",
  "PUBLISHED",
]);
export const entitlementValueType = pgEnum("entitlement_value_type", [
  "BOOLEAN",
  "INTEGER",
]);
export const entitlementSecurityClassification = pgEnum(
  "entitlement_security_classification",
  ["CAPABILITY", "LIMIT"],
);
export const entitlementOverrideOperation = pgEnum(
  "entitlement_override_operation",
  ["SET", "CLEAR"],
);
export const priceStatus = pgEnum("price_status", [
  "DRAFT",
  "ACTIVE",
  "HIDDEN",
  "ARCHIVED",
]);
export const priceRevisionState = pgEnum("price_revision_state", [
  "DRAFT",
  "PUBLISHED",
]);
export const billingIntervalUnit = pgEnum("billing_interval_unit", [
  "DAY",
  "MONTH",
  "YEAR",
]);

const stableMachineIdentifier = (column: SQLWrapper) =>
  sql`${column} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`;

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    status: planStatus("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("plans_code_unique").on(table.code),
    check("plans_code_format", stableMachineIdentifier(table.code)),
  ],
);

export const planRevisions = pgTable(
  "plan_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id").notNull(),
    revision: integer("revision").notNull(),
    state: planRevisionState("state").notNull().default("DRAFT"),
    displayName: varchar("display_name", { length: 256 }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.planId],
      foreignColumns: [plans.id],
      name: "plan_revisions_plan_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("plan_revisions_plan_id_revision_unique").on(
      table.planId,
      table.revision,
    ),
    check("plan_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "plan_revisions_publication_state_time",
      sql`(${table.state} = 'DRAFT' AND ${table.publishedAt} IS NULL) OR (${table.state} = 'PUBLISHED' AND ${table.publishedAt} IS NOT NULL)`,
    ),
    check(
      "plan_revisions_description_bounded",
      sql`char_length(${table.description}) <= 4000`,
    ),
  ],
);

export const entitlementDefinitions = pgTable(
  "entitlement_definitions",
  {
    entitlementKey: varchar("entitlement_key", { length: 128 }).primaryKey(),
    valueType: entitlementValueType("value_type").notNull(),
    securityClassification: entitlementSecurityClassification(
      "security_classification",
    ).notNull(),
    description: varchar("description", { length: 512 }).notNull(),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "entitlement_definitions_key_format",
      stableMachineIdentifier(table.entitlementKey),
    ),
    check(
      "entitlement_definitions_type_classification",
      sql`(${table.securityClassification} = 'CAPABILITY' AND ${table.valueType} = 'BOOLEAN') OR (${table.securityClassification} = 'LIMIT' AND ${table.valueType} = 'INTEGER')`,
    ),
  ],
);

export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planRevisionId: uuid("plan_revision_id").notNull(),
    entitlementKey: varchar("entitlement_key", { length: 128 }).notNull(),
    booleanValue: boolean("boolean_value"),
    integerValue: bigint("integer_value", { mode: "number" }),
  },
  (table) => [
    foreignKey({
      columns: [table.planRevisionId],
      foreignColumns: [planRevisions.id],
      name: "plan_entitlements_plan_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.entitlementKey],
      foreignColumns: [entitlementDefinitions.entitlementKey],
      name: "plan_entitlements_entitlement_key_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    primaryKey({
      name: "plan_entitlements_pk",
      columns: [table.planRevisionId, table.entitlementKey],
    }),
    check(
      "plan_entitlements_exactly_one_value",
      sql`(${table.booleanValue} IS NOT NULL)::integer + (${table.integerValue} IS NOT NULL)::integer = 1`,
    ),
    check(
      "plan_entitlements_integer_safe_range",
      sql`${table.integerValue} IS NULL OR ${table.integerValue} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    index("plan_entitlements_entitlement_key_index").on(table.entitlementKey),
  ],
);

export const accountEntitlementOverrides = pgTable(
  "account_entitlement_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    entitlementKey: varchar("entitlement_key", { length: 128 }).notNull(),
    revision: integer("revision").notNull(),
    operation: entitlementOverrideOperation("operation").notNull(),
    booleanValue: boolean("boolean_value"),
    integerValue: bigint("integer_value", { mode: "number" }),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reason: varchar("reason", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "account_entitlement_overrides_account_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.entitlementKey],
      foreignColumns: [entitlementDefinitions.entitlementKey],
      name: "account_entitlement_overrides_entitlement_key_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("account_entitlement_overrides_account_key_revision_unique").on(
      table.accountId,
      table.entitlementKey,
      table.revision,
    ),
    check(
      "account_entitlement_overrides_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "account_entitlement_overrides_effective_window",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.effectiveFrom}`,
    ),
    check(
      "account_entitlement_overrides_reason_safe",
      sql`char_length(btrim(${table.reason})) > 0 AND ${table.reason} !~ '[<>[:cntrl:]]'`,
    ),
    check(
      "account_entitlement_overrides_exactly_one_value_for_set",
      sql`${table.operation} = 'CLEAR' OR ((${table.booleanValue} IS NOT NULL)::integer + (${table.integerValue} IS NOT NULL)::integer = 1)`,
    ),
    check(
      "account_entitlement_overrides_clear_has_no_value",
      sql`${table.operation} <> 'CLEAR' OR (${table.booleanValue} IS NULL AND ${table.integerValue} IS NULL)`,
    ),
    check(
      "account_entitlement_overrides_integer_safe_range",
      sql`${table.integerValue} IS NULL OR ${table.integerValue} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    index("account_entitlement_overrides_lookup_index").on(
      table.accountId,
      table.entitlementKey,
      table.effectiveFrom,
      table.expiresAt,
    ),
  ],
);

export const prices = pgTable(
  "prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    marketKey: varchar("market_key", { length: 64 }).notNull(),
    channelKey: varchar("channel_key", { length: 64 }).notNull(),
    status: priceStatus("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.planId],
      foreignColumns: [plans.id],
      name: "prices_plan_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("prices_code_unique").on(table.code),
    check("prices_code_format", stableMachineIdentifier(table.code)),
    check("prices_market_key_format", stableMachineIdentifier(table.marketKey)),
    check(
      "prices_channel_key_format",
      stableMachineIdentifier(table.channelKey),
    ),
  ],
);

export const priceRevisions = pgTable(
  "price_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    priceId: uuid("price_id").notNull(),
    planRevisionId: uuid("plan_revision_id").notNull(),
    revision: integer("revision").notNull(),
    state: priceRevisionState("state").notNull().default("DRAFT"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    billingIntervalUnit: billingIntervalUnit("billing_interval_unit").notNull(),
    billingIntervalCount: integer("billing_interval_count").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.priceId],
      foreignColumns: [prices.id],
      name: "price_revisions_price_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.planRevisionId],
      foreignColumns: [planRevisions.id],
      name: "price_revisions_plan_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("price_revisions_price_id_revision_unique").on(
      table.priceId,
      table.revision,
    ),
    check("price_revisions_revision_positive", sql`${table.revision} > 0`),
    check(
      "price_revisions_publication_state_time",
      sql`(${table.state} = 'DRAFT' AND ${table.publishedAt} IS NULL) OR (${table.state} = 'PUBLISHED' AND ${table.publishedAt} IS NOT NULL)`,
    ),
    check(
      "price_revisions_amount_minor_safe_range",
      sql`${table.amountMinor} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "price_revisions_currency_format",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "price_revisions_interval_count_range",
      sql`${table.billingIntervalCount} BETWEEN 1 AND 1200`,
    ),
    check(
      "price_revisions_effective_window",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    index("price_revisions_plan_revision_id_index").on(table.planRevisionId),
  ],
);

export const priceSaleAssignments = pgTable(
  "price_sale_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    priceId: uuid("price_id").notNull(),
    assignmentRevision: integer("assignment_revision").notNull(),
    selectedPriceRevisionId: uuid("selected_price_revision_id"),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    reason: varchar("reason", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.priceId],
      foreignColumns: [prices.id],
      name: "price_sale_assignments_price_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.selectedPriceRevisionId],
      foreignColumns: [priceRevisions.id],
      name: "price_sale_assignments_selected_price_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("price_sale_assignments_price_id_revision_unique").on(
      table.priceId,
      table.assignmentRevision,
    ),
    check(
      "price_sale_assignments_revision_positive",
      sql`${table.assignmentRevision} > 0`,
    ),
    check(
      "price_sale_assignments_reason_safe",
      sql`char_length(btrim(${table.reason})) > 0 AND ${table.reason} !~ '[<>[:cntrl:]]'`,
    ),
    index("price_sale_assignments_resolution_index").on(
      table.priceId,
      table.effectiveFrom,
      table.assignmentRevision,
    ),
  ],
);
