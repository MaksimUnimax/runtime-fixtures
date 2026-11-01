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
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accounts } from "./identity";
import { planRevisions, priceRevisions } from "./commercial";

export const subscriptionState = pgEnum("subscription_state", [
  "TRIAL",
  "ACTIVE",
  "GRACE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
  "SUSPENDED",
]);

export const subscriptionTransitionSource = pgEnum(
  "subscription_transition_source",
  ["CHECKOUT", "WEBHOOK", "RECONCILIATION", "JOB", "ADMIN", "SYSTEM"],
);

export const paymentState = pgEnum("payment_state", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "CHARGEBACK",
]);

export const billingEventSource = pgEnum("billing_event_source", [
  "WEBHOOK",
  "RECONCILIATION",
]);

export const billingEventProcessingState = pgEnum(
  "billing_event_processing_state",
  ["VERIFIED", "APPLIED", "IGNORED", "FAILED"],
);

const safeHash = (column: SQLWrapper) => sql`${column} ~ '^[0-9a-f]{64}$'`;

const machineKey = (column: SQLWrapper) =>
  sql`${column} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`;

const nonWhitespace = (column: SQLWrapper) => sql`${column} ~ '[^[:space:]]'`;

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    state: subscriptionState("state").notNull(),
    stateRevision: integer("state_revision").notNull().default(1),
    currentPlanRevisionId: uuid("current_plan_revision_id").notNull(),
    boundPriceRevisionId: uuid("bound_price_revision_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    stateReason: varchar("state_reason", { length: 512 }).notNull(),
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
      name: "subscriptions_account_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.currentPlanRevisionId],
      foreignColumns: [planRevisions.id],
      name: "subscriptions_current_plan_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.boundPriceRevisionId],
      foreignColumns: [priceRevisions.id],
      name: "subscriptions_bound_price_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "subscriptions_state_revision_positive",
      sql`${table.stateRevision} > 0`,
    ),
    check(
      "subscriptions_period_order",
      sql`${table.currentPeriodEnd} > ${table.currentPeriodStart}`,
    ),
    check(
      "subscriptions_started_before_period",
      sql`${table.startedAt} <= ${table.currentPeriodStart}`,
    ),
    check(
      "subscriptions_grace_after_period",
      sql`${table.graceUntil} IS NULL OR ${table.graceUntil} > ${table.currentPeriodEnd}`,
    ),
    check(
      "subscriptions_canceled_after_start",
      sql`${table.canceledAt} IS NULL OR ${table.canceledAt} >= ${table.startedAt}`,
    ),
    check(
      "subscriptions_suspended_after_start",
      sql`${table.suspendedAt} IS NULL OR ${table.suspendedAt} >= ${table.startedAt}`,
    ),
    check(
      "subscriptions_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "subscriptions_state_reason_nonempty",
      sql`char_length(btrim(${table.stateReason})) > 0`,
    ),
    uniqueIndex("subscriptions_one_current_per_account")
      .on(table.accountId)
      .where(sql`${table.state} <> 'EXPIRED'`),
    index("subscriptions_plan_revision_index").on(table.currentPlanRevisionId),
  ],
);

export const subscriptionTransitions = pgTable(
  "subscription_transitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id").notNull(),
    transitionRevision: integer("transition_revision").notNull(),
    fromState: subscriptionState("from_state"),
    toState: subscriptionState("to_state").notNull(),
    source: subscriptionTransitionSource("source").notNull(),
    sourceEventId: varchar("source_event_id", { length: 256 }),
    actorType: varchar("actor_type", { length: 64 }),
    actorId: uuid("actor_id"),
    reason: varchar("reason", { length: 512 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "subscription_transitions_subscription_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("subscription_transitions_subscription_revision_unique").on(
      table.subscriptionId,
      table.transitionRevision,
    ),
    check(
      "subscription_transitions_revision_positive",
      sql`${table.transitionRevision} > 0`,
    ),
    check(
      "subscription_transitions_revision_origin",
      sql`(${table.transitionRevision} = 1 AND ${table.fromState} IS NULL) OR (${table.transitionRevision} > 1 AND ${table.fromState} IS NOT NULL)`,
    ),
    check(
      "subscription_transitions_state_changes",
      sql`${table.fromState} IS NULL OR ${table.fromState} <> ${table.toState}`,
    ),
    check(
      "subscription_transitions_reason_nonempty",
      sql`char_length(btrim(${table.reason})) > 0`,
    ),
    index("subscription_transitions_subscription_index").on(
      table.subscriptionId,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    subscriptionId: uuid("subscription_id"),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerPaymentId: varchar("provider_payment_id", {
      length: 256,
    }).notNull(),
    priceRevisionId: uuid("price_revision_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    state: paymentState("state").notNull(),
    idempotencyKeyHash: varchar("idempotency_key_hash", {
      length: 64,
    }).notNull(),
    requestFingerprintSha256: varchar("request_fingerprint_sha256", {
      length: 64,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "payments_account_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "payments_subscription_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.priceRevisionId],
      foreignColumns: [priceRevisions.id],
      name: "payments_price_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("payments_provider_payment_unique").on(
      table.provider,
      table.providerPaymentId,
    ),
    unique("payments_account_idempotency_unique").on(
      table.accountId,
      table.idempotencyKeyHash,
    ),
    check("payments_provider_format", machineKey(table.provider)),
    check(
      "payments_provider_payment_id_nonempty",
      nonWhitespace(table.providerPaymentId),
    ),
    check(
      "payments_amount_minor_safe_range",
      sql`${table.amountMinor} BETWEEN 0 AND 9007199254740991`,
    ),
    check("payments_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payments_idempotency_hash_format",
      safeHash(table.idempotencyKeyHash),
    ),
    check(
      "payments_request_fingerprint_format",
      safeHash(table.requestFingerprintSha256),
    ),
    check(
      "payments_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "payments_confirmed_after_created",
      sql`${table.confirmedAt} IS NULL OR ${table.confirmedAt} >= ${table.createdAt}`,
    ),
    index("payments_account_index").on(table.accountId),
    index("payments_subscription_index").on(table.subscriptionId),
  ],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull(),
    source: billingEventSource("source").notNull(),
    eventIdentity: varchar("event_identity", { length: 256 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    processingState: billingEventProcessingState("processing_state")
      .notNull()
      .default("VERIFIED"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    paymentId: uuid("payment_id"),
    subscriptionId: uuid("subscription_id"),
    subscriptionTransitionId: uuid("subscription_transition_id"),
    failureCode: varchar("failure_code", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "billing_events_payment_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "billing_events_subscription_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.subscriptionTransitionId],
      foreignColumns: [subscriptionTransitions.id],
      name: "billing_events_subscription_transition_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("billing_events_provider_identity_unique").on(
      table.provider,
      table.eventIdentity,
    ),
    check("billing_events_provider_format", machineKey(table.provider)),
    check(
      "billing_events_event_identity_nonempty",
      nonWhitespace(table.eventIdentity),
    ),
    check("billing_events_event_type_nonempty", nonWhitespace(table.eventType)),
    check(
      "billing_events_payload_sha256_format",
      safeHash(table.payloadSha256),
    ),
    check(
      "billing_events_failure_code_nonempty",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} ~ '[^[:space:]]'`,
    ),
    check(
      "billing_events_verified_after_received",
      sql`${table.verifiedAt} >= ${table.receivedAt}`,
    ),
    check(
      "billing_events_processed_after_verified",
      sql`${table.processedAt} IS NULL OR ${table.processedAt} >= ${table.verifiedAt}`,
    ),
    index("billing_events_payment_index").on(table.paymentId),
    index("billing_events_subscription_index").on(table.subscriptionId),
  ],
);
