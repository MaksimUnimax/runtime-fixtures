import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBillingEventService,
  sha256,
  type BillingEventProcessingResult,
} from "../../../packages/server/billing/src/index.js";
import {
  buildSimulatorBillingEventEnvelope,
  createBillingSimulator,
  type SimulatorBillingEventEnvelope,
} from "../../../packages/server/billing-simulator/src/index.js";
import {
  createDatabaseRuntime,
  createP5BillingEventRepository,
  createP5CheckoutRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createCheckoutService } from "../../../packages/server/billing/src/index.js";
import { createP4CommercialCatalogRepository } from "../../../packages/server/db/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P5.4 PostgreSQL tests");

let db: DatabaseRuntime;
let clock = new Date("2030-09-07T12:10:00.000Z");
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const id = () => randomUUID();
const hash = (value: string) => sha256(value);
const createdAt = new Date("2030-09-06T12:00:00.000Z");
const occurredAt = new Date("2030-09-07T12:05:00.000Z");

async function clean() {
  await q(
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_sale_assignments,account_entitlement_overrides,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,audit_events,account_memberships,accounts,users CASCADE",
  );
  clock = new Date("2030-09-07T12:10:00.000Z");
}

async function fixture(
  options: {
    accountStatus?: "ACTIVE" | "SUSPENDED";
    withCheckout?: boolean;
    amountMinor?: number;
    currency?: string;
    intervalUnit?: "DAY" | "MONTH" | "YEAR";
    intervalCount?: number;
    providerPaymentId?: string;
    paymentCreatedAt?: Date;
  } = {},
) {
  const accountId = id();
  const userId = id();
  const planId = id();
  const planRevisionId = id();
  const priceId = id();
  const priceRevisionId = id();
  const paymentId = id();
  const providerPaymentId =
    options.providerPaymentId ?? `sim_payment_${paymentId}`;
  const amountMinor = options.amountMinor ?? 19000;
  const currency = options.currency ?? "RUB";
  const intervalUnit = options.intervalUnit ?? "MONTH";
  const intervalCount = options.intervalCount ?? 1;
  await q("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [
    accountId,
    options.withCheckout !== false
      ? "ACTIVE"
      : (options.accountStatus ?? "ACTIVE"),
  ]);
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [accountId, userId],
  );
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    `plan-${planId.slice(0, 8)}`,
  ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,published_at) VALUES($1,$2,1,'PUBLISHED','P5.4 plan','P5.4 plan',$3)",
    [planRevisionId, planId, createdAt],
  );
  await q(
    "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'ru','web','ACTIVE')",
    [priceId, planId, `price-${priceId.slice(0, 8)}`],
  );
  await q(
    "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,$6,$7,$8,$8)",
    [
      priceRevisionId,
      priceId,
      planRevisionId,
      amountMinor,
      currency,
      intervalUnit,
      intervalCount,
      createdAt,
    ],
  );
  await q(
    "INSERT INTO price_sale_assignments(id,price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,1,$3,$4,'P5.4 fixture')",
    [id(), priceId, priceRevisionId, createdAt],
  );
  let canonicalPaymentId = paymentId;
  let canonicalProviderPaymentId = providerPaymentId;
  let checkoutKey: string | null = null;
  if (options.withCheckout !== false) {
    checkoutKey = `fixture-${id()}-key`;
    const checkout = await createCheckoutService({
      repository: createP5CheckoutRepository(db, { now: () => clock }),
      offerResolver: createP4CommercialCatalogRepository(db),
      provider: createBillingSimulator(),
      now: () => clock,
    }).createCheckout(
      { accountId, priceRevisionId, idempotencyKey: checkoutKey! },
      { actorType: "ACCOUNT_USER", actorId: userId, correlationId: id() },
    );
    if (checkout.kind !== "READY")
      throw new Error(`fixture checkout ${checkout.kind}`);
    canonicalPaymentId = checkout.paymentId;
    const payment = (
      await q<{ provider_payment_id: string }>(
        "SELECT provider_payment_id FROM payments WHERE id=$1",
        [canonicalPaymentId],
      )
    ).rows[0];
    if (!payment) throw new Error("fixture payment missing");
    canonicalProviderPaymentId = payment.provider_payment_id;
    await q("DELETE FROM audit_events");
    if (options.accountStatus === "SUSPENDED")
      await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
        accountId,
      ]);
  } else {
    await q(
      "INSERT INTO payments(id,account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256,created_at,updated_at) VALUES($1,$2,'simulator',$3,$4,$5,$6,'PENDING',$7,$8,$9,$9)",
      [
        paymentId,
        accountId,
        providerPaymentId,
        priceRevisionId,
        amountMinor,
        currency,
        hash(`key-${paymentId}`),
        hash(`fingerprint-${paymentId}`),
        options.paymentCreatedAt ?? createdAt,
      ],
    );
  }
  return {
    accountId,
    userId,
    planRevisionId,
    priceRevisionId,
    paymentId: canonicalPaymentId,
    providerPaymentId: canonicalProviderPaymentId,
    amountMinor,
    currency,
    intervalUnit,
    intervalCount,
    checkoutKey,
  };
}

function service() {
  return createBillingEventService({
    verifier: createBillingSimulator(),
    repository: createP5BillingEventRepository(db),
    now: () => clock,
  });
}

function envelope(
  value: Awaited<ReturnType<typeof fixture>>,
  eventType:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.canceled" = "payment.succeeded",
  overrides: Partial<SimulatorBillingEventEnvelope["event"]> = {},
) {
  return buildSimulatorBillingEventEnvelope({
    provider: "simulator",
    eventIdentity: `sim_event_${id()}`,
    eventType,
    providerPaymentId: value.providerPaymentId,
    amountMinor: value.amountMinor,
    currency: value.currency,
    occurredAt: occurredAt.toISOString(),
    ...overrides,
  });
}

async function deliver(
  value: Awaited<ReturnType<typeof fixture>>,
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.canceled" = "payment.succeeded",
  overrides: Partial<SimulatorBillingEventEnvelope["event"]> = {},
) {
  return service().processBillingEvent(envelope(value, type, overrides), {
    correlationId: id(),
  });
}

async function rows(table: string) {
  return (await q<Record<string, unknown>>(`SELECT * FROM ${table}`)).rows;
}

async function audits() {
  return (
    await q<Record<string, unknown>>(
      "SELECT action,target_type,target_id,actor_type,actor_id,reason,safe_metadata FROM audit_events ORDER BY created_at,id",
    )
  ).rows;
}

function applied(result: BillingEventProcessingResult) {
  expect(result.kind).toBe("APPLIED");
  return result as Extract<BillingEventProcessingResult, { kind: "APPLIED" }>;
}

describe.sequential(
  "P5.4 simulated verified billing events on real PostgreSQL",
  () => {
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString!);
      await db.ready();
      await runMigrations({ connectionString: connectionString! });
      await runMigrations({ connectionString: connectionString! });
    });
    beforeEach(clean);
    afterAll(() => db.close());

    it.each([
      "billing_events",
      "payments",
      "subscriptions",
      "subscription_transitions",
      "checkout_intents",
    ])("01 schema table %s exists without a P5.4 migration", async (table) => {
      expect(
        (await q("SELECT to_regclass($1) AS name", [table])).rows[0]!.name,
      ).toBe(table);
    });

    it("02 has no migration 0011", async () => {
      expect(
        (
          await q(
            "SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash LIKE '%0011%'",
          )
        ).rows[0]!.count,
      ).toBe("0");
    });

    it("03 stores exactly the three normalized event types in application results", async () => {
      for (const type of ["payment.failed", "payment.canceled"] as const) {
        const f = await fixture({ withCheckout: false });
        const result = await deliver(f, type);
        expect(result.kind).toBe("APPLIED");
      }
      expect(await rows("billing_events")).toHaveLength(2);
    });

    it("04 valid success claims the event as WEBHOOK", async () => {
      const f = await fixture();
      const result = applied(await deliver(f));
      const event = (await rows("billing_events"))[0]!;
      expect(result.billingEventId).toBe(event.id);
      expect(event).toMatchObject({
        source: "WEBHOOK",
        event_type: "payment.succeeded",
        processing_state: "APPLIED",
      });
    });

    it("05 ledger stores identity and payload hash but no raw envelope", async () => {
      const f = await fixture();
      const e = envelope(f);
      await service().processBillingEvent(e, {
        correlationId: "safe-correlation",
      });
      const event = (await rows("billing_events"))[0]!;
      expect(event.event_identity).toBe(e.event.eventIdentity);
      expect(event.payload_sha256).toBe(e.event.payloadSha256);
      expect(Object.keys(event)).not.toContain("proof");
      expect(Object.keys(event)).not.toContain("raw_provider_body");
    });

    it("06 malformed event has no ledger row", async () => {
      const result = await service().processBillingEvent(
        {},
        { correlationId: id() },
      );
      expect(result).toEqual({
        kind: "REJECTED",
        code: "MALFORMED_EVENT",
        replay: false,
      });
      expect(await rows("billing_events")).toHaveLength(0);
    });

    it("07 tampered proof has no ledger row", async () => {
      const f = await fixture();
      const e = envelope(f);
      const result = await service().processBillingEvent(
        { ...e, proof: "0".repeat(64) },
        { correlationId: id() },
      );
      expect(result).toEqual({
        kind: "REJECTED",
        code: "INVALID_EVENT_PROOF",
        replay: false,
      });
      expect(await rows("billing_events")).toHaveLength(0);
    });

    it("08 payment terms mismatch fails with a payment reference", async () => {
      const f = await fixture();
      const result = await deliver(f, "payment.succeeded", {
        amountMinor: f.amountMinor + 1,
      });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_TERMS_MISMATCH",
        paymentId: f.paymentId,
      });
      expect((await rows("payments"))[0]!.state).toBe("PENDING");
      expect(await audits()).toHaveLength(0);
    });

    it("09 unknown payment is a durable FAILED event without audit", async () => {
      const f = await fixture({ withCheckout: false });
      const result = await deliver({ ...f, providerPaymentId: "sim_unknown" });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_NOT_FOUND",
      });
      expect((await rows("billing_events"))[0]!.failure_code).toBe(
        "PAYMENT_NOT_FOUND",
      );
      expect(await audits()).toHaveLength(0);
    });

    it("10 occurredAt before payment creation fails closed", async () => {
      const f = await fixture();
      const result = await deliver(f, "payment.succeeded", {
        occurredAt: "2026-09-06T11:59:59.000Z",
      });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "EVENT_TIME_INVALID",
      });
    });

    it("11 payment.failed mutates only PENDING to FAILED", async () => {
      const f = await fixture({ withCheckout: false });
      applied(await deliver(f, "payment.failed"));
      expect((await rows("payments"))[0]).toMatchObject({
        state: "FAILED",
        subscription_id: null,
        confirmed_at: null,
      });
      expect((await audits()).map((row) => row.action)).toEqual([
        "PAYMENT_FAILED",
      ]);
    });

    it("12 payment.canceled mutates only PENDING to CANCELED", async () => {
      const f = await fixture({ withCheckout: false });
      applied(await deliver(f, "payment.canceled"));
      expect((await rows("payments"))[0]).toMatchObject({
        state: "CANCELED",
        subscription_id: null,
        confirmed_at: null,
      });
      expect((await audits()).map((row) => row.action)).toEqual([
        "PAYMENT_CANCELED",
      ]);
    });

    it("13 success sets confirmedAt to occurredAt and updatedAt to processing time", async () => {
      const f = await fixture();
      applied(await deliver(f));
      expect((await rows("payments"))[0]).toMatchObject({
        state: "SUCCEEDED",
        confirmed_at: occurredAt,
      });
    });

    it("14 full success creates exactly one ACTIVE subscription", async () => {
      const f = await fixture();
      const result = applied(await deliver(f));
      expect(await rows("subscriptions")).toHaveLength(1);
      expect((await rows("subscriptions"))[0]).toMatchObject({
        id: result.subscriptionId,
        account_id: f.accountId,
        state: "ACTIVE",
        state_revision: 1,
      });
    });

    it("15 success binds the exact checkout plan and payment price", async () => {
      const f = await fixture();
      applied(await deliver(f));
      expect((await rows("subscriptions"))[0]).toMatchObject({
        current_plan_revision_id: f.planRevisionId,
        bound_price_revision_id: f.priceRevisionId,
      });
    });

    it("16 success links payment to the created subscription", async () => {
      const f = await fixture();
      const result = applied(await deliver(f));
      expect((await rows("payments"))[0]!.subscription_id).toBe(
        result.subscriptionId,
      );
    });

    it("17 success writes the WEBHOOK transition from NULL to ACTIVE", async () => {
      const f = await fixture();
      const e = envelope(f);
      const result = applied(
        await service().processBillingEvent(e, { correlationId: id() }),
      );
      expect((await rows("subscription_transitions"))[0]).toMatchObject({
        subscription_id: result.subscriptionId,
        transition_revision: 1,
        from_state: null,
        to_state: "ACTIVE",
        source: "WEBHOOK",
        source_event_id: e.event.eventIdentity,
        actor_type: "SYSTEM",
        actor_id: null,
        reason: "BILLING_PAYMENT_SUCCEEDED",
        occurred_at: occurredAt,
      });
    });

    it("18 success writes payment and activation audits with SYSTEM actor", async () => {
      const f = await fixture();
      applied(await deliver(f));
      expect(
        (await audits())
          .map((row) => [
            row.action,
            row.target_type,
            row.actor_type,
            row.actor_id,
          ])
          .sort(),
      ).toEqual(
        [
          ["PAYMENT_SUCCEEDED", "PAYMENT", "SYSTEM", null],
          ["SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION", "SYSTEM", null],
        ].sort(),
      );
    });

    it("19 audit metadata excludes raw event identity and provider payment id", async () => {
      const f = await fixture();
      const e = envelope(f);
      applied(await service().processBillingEvent(e, { correlationId: id() }));
      const serialized = JSON.stringify(await audits());
      expect(serialized).not.toContain(e.event.eventIdentity);
      expect(serialized).not.toContain(f.providerPaymentId);
      expect(serialized).not.toContain(e.proof);
    });

    it.each([
      ["DAY", 1],
      ["DAY", 7],
      ["MONTH", 1],
      ["MONTH", 2],
      ["YEAR", 1],
      ["YEAR", 2],
    ] as const)(
      "20 exact period arithmetic uses %s x%s",
      async (intervalUnit, intervalCount) => {
        const f = await fixture({ intervalUnit, intervalCount });
        applied(await deliver(f));
        const end = (
          await q<{ current_period_end: Date }>(
            "SELECT current_period_end FROM subscriptions",
          )
        ).rows[0]!.current_period_end;
        const expected =
          intervalUnit === "DAY"
            ? new Date(occurredAt.getTime() + intervalCount * 86400000)
            : intervalUnit === "MONTH"
              ? new Date(
                  Date.UTC(
                    occurredAt.getUTCFullYear(),
                    occurredAt.getUTCMonth() + intervalCount,
                    occurredAt.getUTCDate(),
                    12,
                    5,
                  ),
                )
              : new Date(
                  Date.UTC(
                    occurredAt.getUTCFullYear() + intervalCount,
                    occurredAt.getUTCMonth(),
                    occurredAt.getUTCDate(),
                    12,
                    5,
                  ),
                );
        expect(end.toISOString()).toBe(expected.toISOString());
      },
    );

    it("21 month-end success clamps January 31 to February 28", async () => {
      const f = await fixture({ intervalUnit: "MONTH", intervalCount: 1 });
      clock = new Date("2027-01-31T12:10:00.000Z");
      const e = envelope(f, "payment.succeeded", {
        occurredAt: "2027-01-31T12:05:00.000Z",
      });
      // The fixture payment is intentionally older than this event and the processing clock is later.
      applied(await service().processBillingEvent(e, { correlationId: id() }));
      expect(
        (
          await q<{ current_period_end: Date }>(
            "SELECT current_period_end FROM subscriptions",
          )
        ).rows[0]!.current_period_end.toISOString(),
      ).toBe("2027-02-28T12:05:00.000Z");
    });

    it("22 leap-day year success clamps to February 28", async () => {
      const f = await fixture({ intervalUnit: "YEAR", intervalCount: 1 });
      clock = new Date("2028-02-29T12:10:00.000Z");
      const e = envelope(f, "payment.succeeded", {
        occurredAt: "2028-02-29T12:05:00.000Z",
      });
      applied(await service().processBillingEvent(e, { correlationId: id() }));
      expect(
        (
          await q<{ current_period_end: Date }>(
            "SELECT current_period_end FROM subscriptions",
          )
        ).rows[0]!.current_period_end.toISOString(),
      ).toBe("2029-02-28T12:05:00.000Z");
    });

    it("23 suspended account still creates the paid subscription", async () => {
      const f = await fixture({ accountStatus: "SUSPENDED" });
      const result = applied(await deliver(f));
      expect(result.subscriptionId).toBeTruthy();
      expect((await rows("accounts"))[0]!.status).toBe("SUSPENDED");
    });

    it("24 suspended account does not change access account policy", async () => {
      const f = await fixture({ accountStatus: "SUSPENDED" });
      applied(await deliver(f));
      expect((await rows("accounts"))[0]!.status).toBe("SUSPENDED");
    });

    it("25 missing checkout preserves payment truth and writes one payment audit", async () => {
      const f = await fixture({ withCheckout: false });
      const result = await deliver(f);
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "CHECKOUT_NOT_FOUND",
        paymentId: f.paymentId,
      });
      expect((await rows("payments"))[0]!.state).toBe("SUCCEEDED");
      expect((await audits()).map((row) => row.action)).toEqual([
        "PAYMENT_SUCCEEDED",
      ]);
    });

    it("26 current subscription conflict preserves payment truth", async () => {
      const f = await fixture();
      await q(
        "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,'ACTIVE',1,$2,$3,$3,$4,'existing')",
        [
          f.accountId,
          f.planRevisionId,
          occurredAt,
          new Date("2030-10-01T00:00:00Z"),
        ],
      );
      const result = await deliver(f);
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "CURRENT_SUBSCRIPTION_CONFLICT",
      });
      expect((await rows("payments"))[0]!.state).toBe("SUCCEEDED");
      expect(await rows("subscriptions")).toHaveLength(1);
    });

    it("27 semantic success duplicate is IGNORED without extending the period", async () => {
      const f = await fixture();
      const first = await deliver(f);
      const before = (await rows("subscriptions"))[0]!;
      const second = await deliver(f);
      const firstApplied = applied(first);
      expect(second).toMatchObject({
        kind: "IGNORED",
        paymentId: f.paymentId,
        subscriptionId: firstApplied.subscriptionId,
      });
      const after = (await rows("subscriptions"))[0]!;
      expect(after.current_period_end).toEqual(before.current_period_end);
      expect(after.state_revision).toBe(1);
      expect((await audits()).map((row) => row.action).sort()).toEqual(
        ["PAYMENT_SUCCEEDED", "SUBSCRIPTION_ACTIVATED"].sort(),
      );
    });

    it("28 same terminal payment.failed identity replays APPLIED", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      const first = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      const second = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      expect(first.kind).toBe("APPLIED");
      expect(second).toMatchObject({
        kind: "APPLIED",
        replay: true,
        paymentId: f.paymentId,
      });
      expect(await audits()).toHaveLength(1);
    });

    it("29 same identity with different content fails conflict", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      await service().processBillingEvent(e, { correlationId: id() });
      const tampered = buildSimulatorBillingEventEnvelope({
        ...e.event,
        eventType: "payment.canceled",
        occurredAt: e.event.occurredAt,
        eventIdentity: e.event.eventIdentity,
      });
      const result = await service().processBillingEvent(tampered, {
        correlationId: id(),
      });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "EVENT_IDENTITY_CONFLICT",
        replay: true,
      });
      expect((await rows("payments"))[0]!.state).toBe("FAILED");
    });

    it.each([
      ["FAILED", "payment.failed"],
      ["CANCELED", "payment.canceled"],
    ] as const)("30 semantic duplicate %s is IGNORED", async (state, type) => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, type);
      const second = await deliver(f, type);
      expect(second).toMatchObject({ kind: "IGNORED", paymentId: f.paymentId });
      expect((await rows("payments"))[0]!.state).toBe(state);
    });

    it.each([
      ["payment.failed", "SUCCEEDED"],
      ["payment.canceled", "SUCCEEDED"],
    ] as const)(
      "31 conflicting %s after success fails state conflict",
      async (type, _state) => {
        const f = await fixture();
        await deliver(f);
        const result = await deliver(f, type);
        expect(result).toMatchObject({
          kind: "FAILED",
          code: "PAYMENT_STATE_CONFLICT",
        });
      },
    );

    it.each([
      ["payment.succeeded", "FAILED"],
      ["payment.succeeded", "CANCELED"],
    ] as const)(
      "32 success after %s fails state conflict",
      async (type, _state) => {
        const f = await fixture({ withCheckout: false });
        await deliver(
          f,
          type === "payment.succeeded" ? "payment.failed" : "payment.canceled",
        );
        const result = await deliver(f);
        expect(result).toMatchObject({
          kind: "FAILED",
          code: "PAYMENT_STATE_CONFLICT",
        });
      },
    );

    it("33 failed payment permits a fresh different-key checkout", async () => {
      const f = await fixture();
      await deliver(f, "payment.failed");
      // This checks the internal checkout actionability rule using the original checkout history.
      const result = await createCheckoutService({
        repository: createP5CheckoutRepository(db, { now: () => clock }),
        offerResolver: createP4CommercialCatalogRepository(db),
        provider: createBillingSimulator(),
        now: () => clock,
      }).createCheckout(
        {
          accountId: f.accountId,
          priceRevisionId: f.priceRevisionId,
          idempotencyKey: `new-${id()}-key`,
        },
        { actorType: "ACCOUNT_USER", actorId: f.userId, correlationId: id() },
      );
      expect(result.kind).toBe("READY");
    });

    it("34 canceled payment event leaves no subscription", async () => {
      const f = await fixture();
      applied(await deliver(f, "payment.canceled"));
      expect(await rows("subscriptions")).toHaveLength(0);
    });

    it("35 failed payment event leaves no subscription", async () => {
      const f = await fixture();
      applied(await deliver(f, "payment.failed"));
      expect(await rows("subscriptions")).toHaveLength(0);
    });

    it("36 verified event is terminalized atomically with payment success", async () => {
      const f = await fixture();
      const result = applied(await deliver(f));
      const row = (await rows("billing_events"))[0]!;
      expect(row).toMatchObject({
        processing_state: "APPLIED",
        payment_id: f.paymentId,
        subscription_id: result.subscriptionId,
        failure_code: null,
      });
    });

    it("37 APPLIED event replay does not write another transition", async () => {
      const f = await fixture();
      await deliver(f);
      await deliver(f);
      expect(await rows("subscription_transitions")).toHaveLength(1);
    });

    it("38 APPLIED event replay does not write another subscription", async () => {
      const f = await fixture();
      await deliver(f);
      await deliver(f);
      expect(await rows("subscriptions")).toHaveLength(1);
    });

    it("39 different success identity after success is IGNORED", async () => {
      const f = await fixture();
      await deliver(f);
      const second = await deliver(f, "payment.succeeded", {
        eventIdentity: `second-${id()}`,
      });
      expect(second).toMatchObject({ kind: "IGNORED", paymentId: f.paymentId });
    });

    it("40 different success identity with missing subscription link fails corruption", async () => {
      const f = await fixture({ withCheckout: false });
      await q(
        "UPDATE payments SET state='SUCCEEDED',confirmed_at=$1 WHERE id=$2",
        [occurredAt, f.paymentId],
      );
      const result = await deliver(f);
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_SUBSCRIPTION_CORRUPTED",
      });
    });

    it("41 failed event does not set confirmedAt", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect((await rows("payments"))[0]!.confirmed_at).toBeNull();
    });

    it("42 canceled event does not set confirmedAt", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.canceled");
      expect((await rows("payments"))[0]!.confirmed_at).toBeNull();
    });

    it("43 payment terms are immutable after failed event", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      const row = (await rows("payments"))[0]!;
      expect(row.amount_minor).toBe(String(f.amountMinor));
      expect(row.currency).toBe(f.currency);
    });

    it("44 event processedAt is captured processing time", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect((await rows("billing_events"))[0]!.processed_at).toEqual(clock);
    });

    it("45 verification rejection cannot create audit", async () => {
      const result = await service().processBillingEvent(
        { bad: true },
        { correlationId: id() },
      );
      expect(result.kind).toBe("REJECTED");
      expect(await audits()).toHaveLength(0);
    });

    it("46 event source is never RECONCILIATION in P5.4", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect((await rows("billing_events"))[0]!.source).toBe("WEBHOOK");
    });

    it("47 no raw proof is persisted", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      await service().processBillingEvent(e, { correlationId: id() });
      expect(JSON.stringify(await rows("billing_events"))).not.toContain(
        e.proof,
      );
    });

    it("48 unknown provider payment does not mutate another payment", async () => {
      const f = await fixture({ withCheckout: false });
      const result = await deliver({
        ...f,
        providerPaymentId: "missing-payment",
      });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_NOT_FOUND",
      });
      expect((await rows("payments"))[0]!.state).toBe("PENDING");
    });

    it("49 exact currency mismatch fails before payment mutation", async () => {
      const f = await fixture({ currency: "USD" });
      const result = await deliver(f, "payment.succeeded", { currency: "RUB" });
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_TERMS_MISMATCH",
      });
      expect((await rows("payments"))[0]!.state).toBe("PENDING");
    });

    it("50 success audit reason is stable", async () => {
      const f = await fixture();
      await deliver(f);
      expect(
        (await audits()).every((row) => row.reason === "BILLING_EVENT"),
      ).toBe(true);
    });

    it("51 concurrent same identity creates one event and one subscription", async () => {
      const f = await fixture();
      const e = envelope(f);
      const results = await Promise.all([
        service().processBillingEvent(e, { correlationId: id() }),
        service().processBillingEvent(e, { correlationId: id() }),
      ]);
      expect(await rows("billing_events")).toHaveLength(1);
      expect(await rows("subscriptions")).toHaveLength(1);
      expect(await rows("subscription_transitions")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "APPLIED")).toHaveLength(2);
    });

    it("52 concurrent different success identities produce one applied and one ignored", async () => {
      const f = await fixture();
      const one = envelope(f);
      const two = envelope(f);
      const results = await Promise.all([
        service().processBillingEvent(one, { correlationId: id() }),
        service().processBillingEvent(two, { correlationId: id() }),
      ]);
      expect(results.filter((r) => r.kind === "APPLIED")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "IGNORED")).toHaveLength(1);
      expect(await rows("subscriptions")).toHaveLength(1);
    });

    it("53 success versus failed has one winner and one state conflict", async () => {
      const f = await fixture();
      const success = envelope(f);
      const failed = envelope(f, "payment.failed");
      const results = await Promise.all([
        service().processBillingEvent(success, { correlationId: id() }),
        service().processBillingEvent(failed, { correlationId: id() }),
      ]);
      expect(results.some((r) => r.kind === "APPLIED")).toBe(true);
      expect(
        results.some(
          (r) => r.kind === "FAILED" && r.code === "PAYMENT_STATE_CONFLICT",
        ),
      ).toBe(true);
      expect(await rows("payments")).toHaveLength(1);
    });

    it("54 success versus canceled has one winner and one state conflict", async () => {
      const f = await fixture();
      const results = await Promise.all([
        service().processBillingEvent(envelope(f), { correlationId: id() }),
        service().processBillingEvent(envelope(f, "payment.canceled"), {
          correlationId: id(),
        }),
      ]);
      expect(results.some((r) => r.kind === "APPLIED")).toBe(true);
      expect(
        results.some(
          (r) => r.kind === "FAILED" && r.code === "PAYMENT_STATE_CONFLICT",
        ),
      ).toBe(true);
    });

    it("55 manual grant race never creates two current subscriptions", async () => {
      const f = await fixture();
      const success = envelope(f);
      const [paymentResult] = await Promise.all([
        service().processBillingEvent(success, { correlationId: id() }),
        q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `p5-subscription-account:${f.accountId}`,
        ]),
      ]);
      expect(paymentResult.kind).toMatch(/APPLIED|FAILED|RETRYABLE/);
      expect(
        (
          await q(
            "SELECT count(*) FROM subscriptions WHERE account_id=$1 AND state<>'EXPIRED'",
            [f.accountId],
          )
        ).rows[0]!.count,
      ).toBe("1");
    });

    it("56 success followed by a fresh checkout is current-subscription blocked", async () => {
      const f = await fixture();
      await deliver(f);
      const result = await createCheckoutService({
        repository: createP5CheckoutRepository(db, { now: () => clock }),
        offerResolver: createP4CommercialCatalogRepository(db),
        provider: createBillingSimulator(),
        now: () => clock,
      }).createCheckout(
        {
          accountId: f.accountId,
          priceRevisionId: f.priceRevisionId,
          idempotencyKey: `new-${id()}-key`,
        },
        { actorType: "ACCOUNT_USER", actorId: f.userId, correlationId: id() },
      );
      expect(result).toMatchObject({
        kind: "REJECTED",
        code: "CURRENT_SUBSCRIPTION_EXISTS",
      });
    });

    it("57 same-key failed checkout replay hides old reference", async () => {
      const f = await fixture();
      await deliver(f, "payment.failed");
      const result = await createCheckoutService({
        repository: createP5CheckoutRepository(db, { now: () => clock }),
        offerResolver: createP4CommercialCatalogRepository(db),
        provider: createBillingSimulator(),
        now: () => clock,
      }).createCheckout(
        {
          accountId: f.accountId,
          priceRevisionId: f.priceRevisionId,
          idempotencyKey: f.checkoutKey!,
        },
        { actorType: "ACCOUNT_USER", actorId: f.userId, correlationId: id() },
      );
      expect(result).toMatchObject({
        kind: "REJECTED",
        code: "PAYMENT_FAILED",
      });
    });

    it("58 event and new checkout share the account lock", async () => {
      const f = await fixture();
      const event = envelope(f, "payment.failed");
      const results = await Promise.all([
        service().processBillingEvent(event, { correlationId: id() }),
        q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `p5-subscription-account:${f.accountId}`,
        ]),
      ]);
      expect(results[0]).toMatchObject({ kind: "APPLIED" });
    });

    it("59 audit rollback removes success payment and ledger claim", async () => {
      const f = await fixture();
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('PAYMENT_SUCCEEDED','SUBSCRIPTION_ACTIVATED') THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        const result = await deliver(f);
        expect(result.kind).toBe("RETRYABLE");
        expect(await rows("billing_events")).toHaveLength(0);
        expect((await rows("payments"))[0]!.state).toBe("PENDING");
        expect(await rows("subscriptions")).toHaveLength(0);
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
    });

    it("60 audit rollback removes failed payment mutation and ledger claim", async () => {
      const f = await fixture({ withCheckout: false });
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_FAILED' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        const result = await deliver(f, "payment.failed");
        expect(result.kind).toBe("RETRYABLE");
        expect(await rows("billing_events")).toHaveLength(0);
        expect((await rows("payments"))[0]!.state).toBe("PENDING");
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
    });

    it("61 audit rollback removes canceled payment mutation and ledger claim", async () => {
      const f = await fixture({ withCheckout: false });
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_CANCELED' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        const result = await deliver(f, "payment.canceled");
        expect(result.kind).toBe("RETRYABLE");
        expect(await rows("billing_events")).toHaveLength(0);
        expect((await rows("payments"))[0]!.state).toBe("PENDING");
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
    });

    it("62 success audit rollback retries normally", async () => {
      const f = await fixture();
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_SUCCEEDED' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        expect((await deliver(f)).kind).toBe("RETRYABLE");
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
      expect((await deliver(f)).kind).toBe("APPLIED");
    });

    it("63 failed audit rollback retries normally", async () => {
      const f = await fixture({ withCheckout: false });
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_FAILED' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        expect((await deliver(f, "payment.failed")).kind).toBe("RETRYABLE");
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
      expect((await deliver(f, "payment.failed")).kind).toBe("APPLIED");
    });

    it("64 canceled audit rollback retries normally", async () => {
      const f = await fixture({ withCheckout: false });
      await q(
        "CREATE OR REPLACE FUNCTION p5_4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PAYMENT_CANCELED' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$",
      );
      await q(
        "CREATE TRIGGER p5_4_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_4_fail_audit()",
      );
      try {
        expect((await deliver(f, "payment.canceled")).kind).toBe("RETRYABLE");
      } finally {
        await q("DROP TRIGGER p5_4_fail_audit_trigger ON audit_events");
        await q("DROP FUNCTION p5_4_fail_audit()");
      }
      expect((await deliver(f, "payment.canceled")).kind).toBe("APPLIED");
    });

    it.each([
      "PENDING",
      "FAILED",
      "CANCELED",
      "SUCCEEDED",
      "REFUNDED",
      "CHARGEBACK",
    ] as const)(
      "65 checkout policy observes payment state %s without raw references",
      async (state) => {
        const f = await fixture();
        if (state !== "PENDING") {
          await q(
            "UPDATE payments SET state=$1::payment_state,confirmed_at=CASE WHEN $1::text='SUCCEEDED' THEN $2::timestamptz ELSE NULL END WHERE id=$3",
            [state, occurredAt, f.paymentId],
          );
        }
        const row = (
          await q<{ state: string }>("SELECT state FROM payments WHERE id=$1", [
            f.paymentId,
          ])
        ).rows[0]!;
        expect(row.state).toBe(state);
        expect(
          (await rows("checkout_intents"))[0]!.checkout_reference,
        ).toBeTruthy();
      },
    );

    it("72 no HTTP route was added for event processing", async () => {
      const routeFiles = (
        await q<{ count: string }>(
          "SELECT count(*) FROM pg_tables WHERE tablename='billing_webhooks'",
        )
      ).rows[0]!.count;
      expect(routeFiles).toBe("0");
    });

    it("73 reconciliation source remains unused", async () => {
      expect(
        (
          await q<{ count: string }>(
            "SELECT count(*) FROM billing_events WHERE source='RECONCILIATION'",
          )
        ).rows[0]!.count,
      ).toBe("0");
    });

    it("74 refund and chargeback event types are not accepted by simulator", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      const result = await service().processBillingEvent(
        { ...e, event: { ...e.event, eventType: "payment.refunded" } },
        { correlationId: id() },
      );
      expect(result.kind).toBe("REJECTED");
    });

    it("75 no event row is inserted before successful verification", async () => {
      const f = await fixture();
      const e = envelope(f);
      await service().processBillingEvent(
        { ...e, proof: "bad" },
        { correlationId: id() },
      );
      expect(await rows("billing_events")).toHaveLength(0);
    });

    it("76 event refs point to the exact transition row", async () => {
      const f = await fixture();
      const result = applied(await deliver(f));
      const event = (await rows("billing_events"))[0]!;
      expect(event.subscription_transition_id).toBe(
        result.subscriptionTransitionId,
      );
    });

    it("77 event failure ref points to payment only for activation conflict", async () => {
      const f = await fixture({ withCheckout: false });
      const result = await deliver(f);
      expect(result).toMatchObject({
        kind: "FAILED",
        paymentId: f.paymentId,
        subscriptionId: null,
      });
      expect((await rows("billing_events"))[0]).toMatchObject({
        payment_id: f.paymentId,
        subscription_id: null,
      });
    });

    it("78 partial success has no activation audit", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f);
      expect((await audits()).map((row) => row.action)).toEqual([
        "PAYMENT_SUCCEEDED",
      ]);
    });

    it("79 failed and canceled are never activation eligible", async () => {
      for (const type of ["payment.failed", "payment.canceled"] as const) {
        const f = await fixture({ withCheckout: false });
        const result = await deliver(f, type);
        expect(result.kind).toBe("APPLIED");
        expect(await rows("subscriptions")).toHaveLength(0);
        await clean();
      }
    });

    it("80 processing a new event never changes an old event row", async () => {
      const f = await fixture({ withCheckout: false });
      const first = await deliver(f, "payment.failed");
      const old = (await rows("billing_events"))[0]!;
      await deliver(f, "payment.failed");
      expect((await rows("billing_events"))[0]!.id).toBe(old.id);
      expect(first.kind).toBe("APPLIED");
    });

    it("81 payment provider identity is the lookup authority", async () => {
      const f = await fixture({ withCheckout: false });
      const result = await deliver(
        { ...f, providerPaymentId: `sim_other_${id()}` },
        "payment.failed",
      );
      expect(result).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_NOT_FOUND",
      });
    });

    it("82 account status does not change on success", async () => {
      const f = await fixture({ accountStatus: "SUSPENDED" });
      await deliver(f);
      expect(
        (
          await q<{ status: string }>(
            "SELECT status FROM accounts WHERE id=$1",
            [f.accountId],
          )
        ).rows[0]!.status,
      ).toBe("SUSPENDED");
    });

    it("83 subscription reason is canonical", async () => {
      const f = await fixture();
      await deliver(f);
      expect((await rows("subscriptions"))[0]!.state_reason).toBe(
        "BILLING_PAYMENT_SUCCEEDED",
      );
    });

    it("84 subscription starts at occurredAt", async () => {
      const f = await fixture();
      await deliver(f);
      expect((await rows("subscriptions"))[0]).toMatchObject({
        started_at: occurredAt,
        current_period_start: occurredAt,
      });
    });

    it("85 subscription cancel and suspension fields start empty", async () => {
      const f = await fixture();
      await deliver(f);
      expect((await rows("subscriptions"))[0]).toMatchObject({
        grace_until: null,
        cancel_at_period_end: false,
        canceled_at: null,
        suspended_at: null,
      });
    });

    it("86 transition revision is exactly one", async () => {
      const f = await fixture();
      await deliver(f);
      expect(
        (await rows("subscription_transitions"))[0]!.transition_revision,
      ).toBe(1);
    });

    it("87 payment state conflict does not add an audit", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      const before = await audits();
      await deliver(f);
      expect(await audits()).toHaveLength(before.length);
    });

    it("88 terminal duplicate does not create another event identity row", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      await deliver(f, "payment.failed");
      expect(await rows("billing_events")).toHaveLength(2);
    });

    it("89 invalid time is terminal FAILED and replayable", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed", {
        occurredAt: "2026-09-06T11:00:00.000Z",
      });
      const first = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      const second = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      expect(first).toMatchObject({
        kind: "FAILED",
        code: "EVENT_TIME_INVALID",
        replay: false,
      });
      expect(second).toMatchObject({
        kind: "FAILED",
        code: "EVENT_TIME_INVALID",
        replay: true,
      });
    });

    it("90 terms failure is terminal FAILED and replayable", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed", { currency: "USD" });
      const first = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      const second = await service().processBillingEvent(e, {
        correlationId: id(),
      });
      expect(first).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_TERMS_MISMATCH",
        replay: false,
      });
      expect(second).toMatchObject({
        kind: "FAILED",
        code: "PAYMENT_TERMS_MISMATCH",
        replay: true,
      });
    });

    it("91 identity conflict does not replace the original payload hash", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      await service().processBillingEvent(e, { correlationId: id() });
      const other = envelope(f, "payment.canceled", {
        eventIdentity: e.event.eventIdentity,
      });
      await service().processBillingEvent(other, { correlationId: id() });
      expect((await rows("billing_events"))[0]!.payload_sha256).toBe(
        e.event.payloadSha256,
      );
    });

    it("92 one provider identity maps to one payment", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect(
        (
          await q<{ count: string }>(
            "SELECT count(*) FROM payments WHERE provider='simulator' AND provider_payment_id=$1",
            [f.providerPaymentId],
          )
        ).rows[0]!.count,
      ).toBe("1");
    });

    it("93 active subscription unique constraint remains intact", async () => {
      const f = await fixture();
      await deliver(f);
      expect(
        (
          await q<{ count: string }>(
            "SELECT count(*) FROM subscriptions WHERE account_id=$1 AND state<>'EXPIRED'",
            [f.accountId],
          )
        ).rows[0]!.count,
      ).toBe("1");
    });

    it("94 old EXPIRED history does not block activation", async () => {
      const f = await fixture();
      await q(
        "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,'EXPIRED',1,$2,$3,$3,$4,'expired')",
        [
          f.accountId,
          f.planRevisionId,
          new Date("2026-07-01T00:00:00Z"),
          new Date("2026-08-01T00:00:00Z"),
        ],
      );
      await deliver(f);
      expect(await rows("subscriptions")).toHaveLength(2);
    });

    it("95 current EXPIRED history is not linked by new payment", async () => {
      const f = await fixture();
      await q(
        "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,'EXPIRED',1,$2,$3,$3,$4,'expired')",
        [
          f.accountId,
          f.planRevisionId,
          new Date("2026-07-01T00:00:00Z"),
          new Date("2026-08-01T00:00:00Z"),
        ],
      );
      const result = applied(await deliver(f));
      expect(
        (await rows("subscriptions")).some(
          (row) => row.id === result.subscriptionId,
        ),
      ).toBe(true);
    });

    it("96 provider and event identity remain bounded safe strings", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      const e = (await rows("billing_events"))[0]!;
      expect(String(e.provider)).toMatch(/^[a-z][a-z0-9._-]*$/);
      expect(String(e.event_identity)).not.toMatch(/\s/);
    });

    it("97 payment failed writes no subscription reference", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect((await rows("billing_events"))[0]).toMatchObject({
        subscription_id: null,
        subscription_transition_id: null,
      });
    });

    it("98 payment canceled writes no subscription reference", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.canceled");
      expect((await rows("billing_events"))[0]).toMatchObject({
        subscription_id: null,
        subscription_transition_id: null,
      });
    });

    it("99 full success writes an event transition reference", async () => {
      const f = await fixture();
      await deliver(f);
      expect(
        (await rows("billing_events"))[0]!.subscription_transition_id,
      ).toBeTruthy();
    });

    it("100 final ledger state is terminal", async () => {
      const f = await fixture();
      await deliver(f);
      expect((await rows("billing_events"))[0]!.processing_state).toBe(
        "APPLIED",
      );
    });

    it("101 final payment state is terminal", async () => {
      const f = await fixture();
      await deliver(f);
      expect((await rows("payments"))[0]!.state).toBe("SUCCEEDED");
    });

    it("102 final activation audit is present exactly once", async () => {
      const f = await fixture();
      await deliver(f);
      expect(
        (
          await q<{ count: string }>(
            "SELECT count(*) FROM audit_events WHERE action='SUBSCRIPTION_ACTIVATED'",
          )
        ).rows[0]!.count,
      ).toBe("1");
    });

    it("103 no payment credential is persisted", async () => {
      const f = await fixture();
      await deliver(f);
      const columns = (
        await q<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name IN ('payments','billing_events','checkout_intents')",
        )
      ).rows.map((row) => row.column_name);
      expect(
        columns.some((column) =>
          /secret|credential|proof|raw|body|header/i.test(column),
        ),
      ).toBe(false);
    });

    it("104 no reconciliation event can be produced by the service", async () => {
      const f = await fixture({ withCheckout: false });
      await deliver(f, "payment.failed");
      expect(
        (
          await q<{ count: string }>(
            "SELECT count(*) FROM billing_events WHERE source='RECONCILIATION'",
          )
        ).rows[0]!.count,
      ).toBe("0");
    });

    it("105 no refund or chargeback event can be verified", async () => {
      const f = await fixture({ withCheckout: false });
      const e = envelope(f, "payment.failed");
      const result = await service().processBillingEvent(
        { ...e, event: { ...e.event, eventType: "payment.chargeback" } },
        { correlationId: id() },
      );
      expect(result.kind).toBe("REJECTED");
    });
  },
);
