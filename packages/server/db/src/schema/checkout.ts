import { sql, type SQLWrapper } from "drizzle-orm";
import {
  foreignKey,
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
  bigint,
} from "drizzle-orm/pg-core";
import { accounts } from "./identity";
import {
  planRevisions,
  priceRevisions,
  billingIntervalUnit,
} from "./commercial";
import { payments } from "./billing";

export const checkoutIntentState = pgEnum("checkout_intent_state", [
  "CREATING",
  "READY",
  "FAILED",
]);

const hash = (column: SQLWrapper) => sql`${column} ~ '^[0-9a-f]{64}$'`;
const machineKey = (column: SQLWrapper) =>
  sql`${column} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`;

export const checkoutIntents = pgTable(
  "checkout_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    priceRevisionId: uuid("price_revision_id").notNull(),
    planRevisionId: uuid("plan_revision_id").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    state: checkoutIntentState("state").notNull(),
    idempotencyKeyHash: varchar("idempotency_key_hash", {
      length: 64,
    }).notNull(),
    requestFingerprintSha256: varchar("request_fingerprint_sha256", {
      length: 64,
    }).notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    billingIntervalUnit: billingIntervalUnit("billing_interval_unit").notNull(),
    billingIntervalCount: integer("billing_interval_count").notNull(),
    providerCheckoutId: varchar("provider_checkout_id", { length: 256 }),
    providerPaymentId: varchar("provider_payment_id", { length: 256 }),
    checkoutReference: varchar("checkout_reference", { length: 256 }),
    paymentId: uuid("payment_id"),
    failureCode: varchar("failure_code", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.accountId],
      foreignColumns: [accounts.id],
      name: "checkout_intents_account_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.priceRevisionId],
      foreignColumns: [priceRevisions.id],
      name: "checkout_intents_price_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.planRevisionId],
      foreignColumns: [planRevisions.id],
      name: "checkout_intents_plan_revision_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "checkout_intents_payment_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("checkout_intents_account_idempotency_unique").on(
      table.accountId,
      table.idempotencyKeyHash,
    ),
    uniqueIndex("checkout_intents_provider_checkout_unique")
      .on(table.provider, table.providerCheckoutId)
      .where(sql`${table.providerCheckoutId} IS NOT NULL`),
    uniqueIndex("checkout_intents_provider_payment_unique")
      .on(table.provider, table.providerPaymentId)
      .where(sql`${table.providerPaymentId} IS NOT NULL`),
    uniqueIndex("checkout_intents_payment_unique")
      .on(table.paymentId)
      .where(sql`${table.paymentId} IS NOT NULL`),
    uniqueIndex("checkout_intents_one_creating_per_account_unique")
      .on(table.accountId)
      .where(sql`${table.state} = 'CREATING'`),
    check("checkout_intents_provider_format", machineKey(table.provider)),
    check(
      "checkout_intents_idempotency_hash_format",
      hash(table.idempotencyKeyHash),
    ),
    check(
      "checkout_intents_request_fingerprint_format",
      hash(table.requestFingerprintSha256),
    ),
    check(
      "checkout_intents_amount_minor_safe_range",
      sql`${table.amountMinor} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "checkout_intents_currency_format",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "checkout_intents_interval_count_range",
      sql`${table.billingIntervalCount} BETWEEN 1 AND 1200`,
    ),
    check(
      "checkout_intents_provider_checkout_opaque",
      sql`${table.providerCheckoutId} IS NULL OR (${table.providerCheckoutId} ~ '^[A-Za-z0-9._:-]+$' AND ${table.providerCheckoutId} !~* '^https?:')`,
    ),
    check(
      "checkout_intents_provider_payment_opaque",
      sql`${table.providerPaymentId} IS NULL OR (${table.providerPaymentId} ~ '^[A-Za-z0-9._:-]+$' AND ${table.providerPaymentId} !~* '^https?:')`,
    ),
    check(
      "checkout_intents_reference_opaque",
      sql`${table.checkoutReference} IS NULL OR (${table.checkoutReference} ~ '^[A-Za-z0-9._:-]+$' AND ${table.checkoutReference} !~* '^https?:')`,
    ),
    check(
      "checkout_intents_failure_code_safe",
      sql`${table.failureCode} IS NULL OR ${table.failureCode} ~ '^[A-Z][A-Z0-9_]{0,127}$'`,
    ),
    check(
      "checkout_intents_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "checkout_intents_completed_after_admitted",
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.admittedAt}`,
    ),
    index("checkout_intents_account_index").on(table.accountId),
    index("checkout_intents_price_revision_index").on(table.priceRevisionId),
  ],
);
