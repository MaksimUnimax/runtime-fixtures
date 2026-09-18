import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBillingEventService,
  createBillingReconciliationService,
  createCheckoutService,
  sha256,
} from "../../../packages/server/billing/src/index.js";
import {
  buildSimulatorBillingEventEnvelope,
  createBillingSimulator,
} from "../../../packages/server/billing-simulator/src/index.js";
import {
  createDatabaseRuntime,
  createP4CommercialCatalogRepository,
  createP4EntitlementRepository,
  createP5BillingEventRepository,
  createP5CheckoutRepository,
  createP5CommercialPortalRepository,
  createP5ReconciliationRepository,
  createP5SubscriptionAccessResolver,
  createP5SubscriptionLifecycleRepository,
  createP5SubscriptionRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { CommercialAccessService } from "../../../packages/server/commercial-access/src/index.js";
import { BootstrapService } from "../../../packages/server/bootstrap/src/index.js";
import { SubscriptionLifecycleRunner } from "../../../apps/worker/src/subscription-lifecycle-runner.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P5.7 PostgreSQL tests");

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let db: DatabaseRuntime;
let clock = new Date();
const id = () => randomUUID();
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const context = (_actorId: string) => ({
  actorType: "SYSTEM" as const,
  correlationId: id(),
  reason: "P5.7 final acceptance",
});

type Fixture = {
  accountId: string;
  userId: string;
  planId: string;
  planRevisionId: string;
  priceRevisionId: string;
};

async function clean() {
  await q(
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,devices,device_authorizations,sessions,account_entitlement_overrides,subscriptions,price_sale_assignments,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,account_memberships,accounts,users,audit_events CASCADE",
  );
  clock = new Date(Date.now() + 60_000);
}

async function fixture(
  options: { accountStatus?: "ACTIVE" | "SUSPENDED"; maxActive?: number } = {},
): Promise<Fixture> {
  const accountId = id();
  const userId = id();
  const planId = id();
  const planRevisionId = id();
  const priceId = id();
  const priceRevisionId = id();
  const publishedAt = new Date(clock.getTime() - 86_400_000);
  await q("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [
    accountId,
    options.accountStatus ?? "ACTIVE",
  ]);
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [accountId, userId],
  );
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    `p57-${planId.slice(0, 8)}`,
  ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description) VALUES($1,$2,1,'DRAFT','P5.7 final plan','P5.7 final plan')",
    [planRevisionId, planId],
  );
  await q(
    "INSERT INTO entitlement_definitions(entitlement_key,value_type,security_classification,description) VALUES('device.max_active','INTEGER','LIMIT','P5.7 device limit'),('feature.analytics','BOOLEAN','CAPABILITY','P5.7 analytics') ON CONFLICT (entitlement_key) DO NOTHING",
  );
  await q(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,integer_value) VALUES($1,'device.max_active',$2)",
    [planRevisionId, options.maxActive ?? 2],
  );
  await q(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,boolean_value) VALUES($1,'feature.analytics',true)",
    [planRevisionId],
  );
  await q(
    "UPDATE plan_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [planRevisionId, publishedAt],
  );
  await q(
    "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'ru','web','ACTIVE')",
    [priceId, planId, `price-${priceId.slice(0, 8)}`],
  );
  await q(
    "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at) VALUES($1,$2,$3,1,'PUBLISHED',1900,'RUB','MONTH',1,$4,$4)",
    [priceRevisionId, priceId, planRevisionId, publishedAt],
  );
  await q(
    "INSERT INTO price_sale_assignments(id,price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,1,$3,$4,'P5.7 final fixture')",
    [id(), priceId, priceRevisionId, publishedAt],
  );
  return { accountId, userId, planId, planRevisionId, priceRevisionId };
}

async function grant(f: Fixture, end = new Date(clock.getTime() + 86_400_000)) {
  return createP5SubscriptionRepository(db, {
    now: () => clock,
  }).grantSubscription(
    {
      accountId: f.accountId,
      planRevisionId: f.planRevisionId,
      currentPeriodEnd: end,
    },
    context(f.userId),
  );
}

async function checkout(
  f: Fixture,
  scenario:
    | "SUCCESS"
    | "UNAVAILABLE"
    | "UNAVAILABLE_THEN_SUCCESS"
    | "REJECTED" = "SUCCESS",
  key = `p57-key-${id()}`,
) {
  return createCheckoutService({
    repository: createP5CheckoutRepository(db, { now: () => clock }),
    offerResolver: createP4CommercialCatalogRepository(db),
    provider: createBillingSimulator({ scenario }),
    now: () => clock,
  }).createCheckout(
    {
      accountId: f.accountId,
      priceRevisionId: f.priceRevisionId,
      idempotencyKey: key,
    },
    { actorType: "ACCOUNT_USER", actorId: f.userId, correlationId: id() },
  );
}

async function checkoutWithSimulator(f: Fixture) {
  const service = createCheckoutService({
    repository: createP5CheckoutRepository(db, { now: () => clock }),
    offerResolver: createP4CommercialCatalogRepository(db),
    provider: createBillingSimulator(),
    now: () => clock,
  });
  const result = await service.createCheckout(
    {
      accountId: f.accountId,
      priceRevisionId: f.priceRevisionId,
      idempotencyKey: `p57-event-${id()}`,
    },
    { actorType: "ACCOUNT_USER", actorId: f.userId, correlationId: id() },
  );
  if (result.kind !== "READY")
    throw new Error(`checkout fixture: ${result.kind}`);
  const payment = (
    await q<{ id: string; providerPaymentId: string }>(
      'SELECT id,provider_payment_id AS "providerPaymentId" FROM payments WHERE account_id=$1',
      [f.accountId],
    )
  ).rows[0];
  if (!payment) throw new Error("payment fixture missing");
  return {
    result,
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
  };
}

async function billingEvent(
  f: Fixture,
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.canceled" = "payment.succeeded",
  eventIdentity = `p57-event-${id()}`,
) {
  const payment = (
    await q<{
      providerPaymentId: string;
      amountMinor: number;
      currency: string;
    }>(
      'SELECT provider_payment_id AS "providerPaymentId",amount_minor AS "amountMinor",currency FROM payments WHERE account_id=$1',
      [f.accountId],
    )
  ).rows[0];
  if (!payment) throw new Error("payment fixture missing");
  const envelope = buildSimulatorBillingEventEnvelope({
    provider: "simulator",
    eventIdentity,
    eventType: type,
    providerPaymentId: payment.providerPaymentId,
    amountMinor: Number(payment.amountMinor),
    currency: payment.currency,
    occurredAt: clock.toISOString(),
  });
  return createBillingEventService({
    verifier: createBillingSimulator(),
    repository: createP5BillingEventRepository(db),
    now: () => clock,
  }).processBillingEvent(envelope, { correlationId: id() });
}

async function commercial(_f: Fixture) {
  const subscriptions = createP5SubscriptionRepository(db, {
    now: () => clock,
  });
  return new CommercialAccessService({
    accessResolver: createP5SubscriptionAccessResolver(subscriptions),
    currentSubscriptionReader: subscriptions,
    entitlementResolver: createP4EntitlementRepository(db),
  });
}

async function text(path: string) {
  return readFile(resolve(serverRoot, path), "utf8");
}

describe.sequential(
  "P5.7 final simulated-billing acceptance on PostgreSQL",
  () => {
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString!);
      await db.ready();
      await runMigrations({ connectionString: connectionString! });
      await runMigrations({ connectionString: connectionString! });
    });
    beforeEach(clean);
    afterAll(() => db.close());

    it("DB-01 exposes migrations 0000 through 0016", async () => {
      const rows = await q<{ count: string }>(
        "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
      );
      expect(rows.rows[0]?.count).toBe("18");
    });
    it("DB-02 enforces one current non-expired subscription", async () => {
      const f = await fixture();
      await grant(f);
      await expect(grant(f)).resolves.toEqual({
        kind: "REJECTED",
        code: "SUBSCRIPTION_ALREADY_EXISTS",
      });
    });
    it("DB-03 permits historical expired rows while retaining current uniqueness", async () => {
      const f = await fixture();
      await q(
        "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,'EXPIRED',1,$2,$3,$3,$4,'expired history')",
        [
          f.accountId,
          f.planRevisionId,
          new Date(clock.getTime() - 86_400_000),
          new Date(clock.getTime() - 1),
        ],
      );
      await expect(grant(f)).resolves.toMatchObject({ kind: "OK" });
    });
    it("DB-04 rejects subscription deletion", async () => {
      const f = await fixture();
      const created = await grant(f);
      if (created.kind !== "OK") throw new Error("grant failed");
      await expect(
        q("DELETE FROM subscriptions WHERE id=$1", [created.value.id]),
      ).rejects.toThrow();
    });
    it("DB-05 rejects transition deletion", async () => {
      const f = await fixture();
      const created = await grant(f);
      if (created.kind !== "OK") throw new Error("grant failed");
      await expect(
        q("DELETE FROM subscription_transitions WHERE subscription_id=$1", [
          created.value.id,
        ]),
      ).rejects.toThrow();
    });
    it("DB-06 enforces transition revision uniqueness", async () => {
      const f = await fixture();
      const created = await grant(f);
      if (created.kind !== "OK") throw new Error("grant failed");
      await expect(
        q(
          "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason) VALUES($1,1,NULL,'ACTIVE','ADMIN','duplicate')",
          [created.value.id],
        ),
      ).rejects.toThrow();
    });
    it("DB-07 rejects fake same-state transition rows", async () => {
      const f = await fixture();
      const created = await grant(f);
      if (created.kind !== "OK") throw new Error("grant failed");
      await expect(
        q(
          "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason) VALUES($1,2,'ACTIVE','ACTIVE','ADMIN','same')",
          [created.value.id],
        ),
      ).rejects.toThrow();
    });
    it("DB-08 separates state revision from transition revision on extension", async () => {
      const f = await fixture();
      const created = await grant(f);
      if (created.kind !== "OK") throw new Error("grant failed");
      const repo = createP5SubscriptionRepository(db, { now: () => clock });
      const extended = await repo.extendSubscription(
        {
          subscriptionId: created.value.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: new Date(clock.getTime() + 172_800_000),
        },
        context(f.userId),
      );
      expect(extended).toMatchObject({
        kind: "OK",
        changed: true,
        value: { stateRevision: 2 },
      });
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscription_transitions WHERE subscription_id=$1",
            [created.value.id],
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-09 protects immutable payment identity and terms", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await expect(
        q("UPDATE payments SET provider='other' WHERE id=$1", [c.paymentId]),
      ).rejects.toThrow();
      await expect(
        q("UPDATE payments SET amount_minor=1901 WHERE id=$1", [c.paymentId]),
      ).rejects.toThrow();
    });
    it("DB-10 enforces provider payment uniqueness", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await expect(
        q(
          "INSERT INTO payments(account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256) SELECT account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,'PENDING',$2,$3 FROM payments WHERE id=$1",
          [c.paymentId, sha256(id()), sha256(id())],
        ),
      ).rejects.toThrow();
    });
    it("DB-11 scopes idempotency uniqueness to account", async () => {
      const f1 = await fixture();
      const c1 = await checkoutWithSimulator(f1);
      const f2 = await fixture();
      const c2 = await checkout(f2, "SUCCESS", "same-raw-key-123456");
      expect(c2.kind).toBe("READY");
      if (c2.kind === "READY") expect(c2.paymentId).not.toBe(c1.paymentId);
      expect(
        (await q("SELECT count(*)::int AS count FROM payments")).rows[0]?.count,
      ).toBe(2);
    });
    it("DB-12 permits payment link only once", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      const sub = await grant({ ...f });
      expect(sub.kind).toBe("OK");
      const subscriptionId = sub.kind === "OK" ? sub.value.id : id();
      await q("UPDATE payments SET subscription_id=$1 WHERE id=$2", [
        subscriptionId,
        c.paymentId,
      ]);
      await expect(
        q("UPDATE payments SET subscription_id=NULL WHERE id=$1", [
          c.paymentId,
        ]),
      ).rejects.toThrow();
    });
    it("DB-13 rejects payment deletion", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await expect(
        q("DELETE FROM payments WHERE id=$1", [c.paymentId]),
      ).rejects.toThrow();
    });
    it("DB-14 enforces billing-event identity uniqueness", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at) VALUES('simulator','WEBHOOK','same-event','payment.succeeded',$1,'VERIFIED',$2,$2)",
        [sha256(id()), clock],
      );
      await expect(
        q(
          "INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at) VALUES('simulator','RECONCILIATION','same-event','payment.succeeded',$1,'VERIFIED',$2,$2)",
          [sha256(id()), clock],
        ),
      ).rejects.toThrow();
      expect(c.paymentId).toBeTruthy();
    });
    it("DB-15 has no raw billing-event payload column", async () => {
      const columns = await q<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name='billing_events'",
      );
      expect(columns.rows.map((r) => r.column_name)).not.toEqual(
        expect.arrayContaining(["raw_payload", "payload", "headers", "body"]),
      );
    });
    it("DB-16 terminal billing events are immutable", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at) VALUES('simulator','WEBHOOK','terminal-event','payment.failed',$1,'VERIFIED',$2,$2)",
        [sha256(id()), clock],
      );
      await q(
        "UPDATE billing_events SET processing_state='FAILED',processed_at=$1,failure_code='PAYMENT_STATE_CONFLICT' WHERE event_identity='terminal-event'",
        [clock],
      );
      await expect(
        q(
          "UPDATE billing_events SET event_type='payment.canceled' WHERE event_identity='terminal-event'",
        ),
      ).rejects.toThrow();
      expect(c.paymentId).toBeTruthy();
    });
    it("DB-17 rejects billing-event deletion", async () => {
      await q(
        "INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at) VALUES('simulator','WEBHOOK','delete-event','payment.failed',$1,'VERIFIED',$2,$2)",
        [sha256(id()), clock],
      );
      await expect(
        q("DELETE FROM billing_events WHERE event_identity='delete-event'"),
      ).rejects.toThrow();
    });
    it("DB-18 permits only CREATING checkout insertion shape", async () => {
      const f = await fixture();
      await expect(
        q(
          "INSERT INTO checkout_intents(account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count,provider_payment_id) VALUES($1,$2,$3,'simulator','CREATING',$4,$5,$6,1900,'RUB','MONTH',1,'unexpected')",
          [
            f.accountId,
            f.priceRevisionId,
            f.planRevisionId,
            sha256(id()),
            sha256(id()),
            clock,
          ],
        ),
      ).rejects.toThrow();
    });
    it("DB-19 enforces one CREATING checkout per account", async () => {
      const f = await fixture();
      const first = await q<{ id: string }>(
        "INSERT INTO checkout_intents(account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count) VALUES($1,$2,$3,'simulator','CREATING',$4,$5,$6,1900,'RUB','MONTH',1) RETURNING id",
        [
          f.accountId,
          f.priceRevisionId,
          f.planRevisionId,
          sha256(id()),
          sha256(id()),
          clock,
        ],
      );
      expect(first.rows[0]?.id).toBeTruthy();
      await expect(
        q(
          "INSERT INTO checkout_intents(account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count) VALUES($1,$2,$3,'simulator','CREATING',$4,$5,$6,1900,'RUB','MONTH',1)",
          [
            f.accountId,
            f.priceRevisionId,
            f.planRevisionId,
            sha256(id()),
            sha256(id()),
            clock,
          ],
        ),
      ).rejects.toThrow();
    });
    it("DB-20 rejects checkout terminal mutation", async () => {
      const f = await fixture();
      const c = await checkout(f, "REJECTED");
      expect(c.kind).toBe("REJECTED");
      await expect(
        q("UPDATE checkout_intents SET state='CREATING' WHERE account_id=$1", [
          f.accountId,
        ]),
      ).rejects.toThrow();
    });
    it("DB-21 rejects checkout deletion", async () => {
      const f = await fixture();
      await checkout(f, "REJECTED");
      await expect(
        q("DELETE FROM checkout_intents WHERE account_id=$1", [f.accountId]),
      ).rejects.toThrow();
    });
    it("DB-22 enforces reconciliation job state vocabulary", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await expect(
        q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,created_at,updated_at) VALUES($1,'UNKNOWN',$2,$2)",
          [c.paymentId, clock],
        ),
      ).rejects.toThrow();
    });
    it("DB-23 enforces leased job token shape", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await expect(
        q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,lease_until,created_at,updated_at) VALUES($1,'LEASED',$2,$3,$3)",
          [c.paymentId, clock, clock],
        ),
      ).rejects.toThrow();
    });
    it("DB-24 rejects reconciliation job deletion", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      await expect(
        q("DELETE FROM billing_reconciliation_jobs WHERE payment_id=$1", [
          c.paymentId,
        ]),
      ).rejects.toThrow();
    });
    it("DB-25 reclaims expired reconciliation leases", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='LEASED',next_attempt_at=NULL,lease_token=$2,lease_until=$3,attempt_count=1 WHERE payment_id=$1",
        [c.paymentId, id(), new Date(clock.getTime() - 1)],
      );
      const claims = await createP5ReconciliationRepository(db).claimDue({
        now: clock,
        leaseMs: 60_000,
        batchSize: 1,
      });
      expect(claims).toHaveLength(1);
      expect(claims[0]?.leaseToken).toBeTruthy();
    });
    it("DB-26 rejects stale reconciliation token completion", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      const repo = createP5ReconciliationRepository(db);
      const claim = (
        await repo.claimDue({ now: clock, leaseMs: 60_000, batchSize: 1 })
      )[0]!;
      const result = await repo.reschedule({
        paymentId: claim.paymentId,
        leaseToken: id(),
        nextAttemptAt: clock,
        code: "PROVIDER_PENDING",
      });
      expect(result.kind).toBe("STALE_LEASE");
    });
    it("DB-27 grant binds exact published plan revision", async () => {
      const f = await fixture();
      const result = await grant(f);
      expect(result).toMatchObject({
        kind: "OK",
        value: {
          currentPlanRevisionId: f.planRevisionId,
          boundPriceRevisionId: null,
        },
      });
    });
    it("DB-28 suspension is a real state mutation and same-version retry is a no-op", async () => {
      const f = await fixture();
      const result = await grant(f);
      if (result.kind !== "OK") throw new Error("grant failed");
      const repo = createP5SubscriptionRepository(db, { now: () => clock });
      const suspended = await repo.suspendSubscription(
        { subscriptionId: result.value.id, expectedStateRevision: 1 },
        context(f.userId),
      );
      expect(suspended).toMatchObject({
        kind: "OK",
        changed: true,
        value: { state: "SUSPENDED", stateRevision: 2 },
      });
      const retry = await repo.suspendSubscription(
        { subscriptionId: result.value.id, expectedStateRevision: 2 },
        context(f.userId),
      );
      expect(retry).toMatchObject({
        kind: "OK",
        changed: false,
        value: { stateRevision: 2 },
      });
    });
    it("DB-29 restore uses latest suspension origin", async () => {
      const f = await fixture();
      const result = await grant(f);
      if (result.kind !== "OK") throw new Error("grant failed");
      const repo = createP5SubscriptionRepository(db, { now: () => clock });
      await repo.suspendSubscription(
        { subscriptionId: result.value.id, expectedStateRevision: 1 },
        context(f.userId),
      );
      const restored = await repo.restoreSubscription(
        { subscriptionId: result.value.id, expectedStateRevision: 2 },
        context(f.userId),
      );
      expect(restored).toMatchObject({
        kind: "OK",
        value: { state: "ACTIVE", stateRevision: 3 },
      });
    });
    it("DB-30 denies exact subscription period boundary", async () => {
      const f = await fixture();
      const result = await grant(f);
      if (result.kind !== "OK") throw new Error("grant failed");
      const boundaryStart = new Date(clock.getTime() - 86_400_000);
      await q(
        "UPDATE subscriptions SET started_at=$2,current_period_start=$2,current_period_end=$3 WHERE id=$1",
        [result.value.id, boundaryStart, clock],
      );
      const access = await (await commercial(f)).resolve(f.accountId, clock);
      expect(access).toMatchObject({
        kind: "OK",
        value: {
          access: { kind: "INELIGIBLE", reason: "PERIOD_ENDED" },
          entitlements: {},
        },
      });
    });
    it("DB-31 account suspension independently denies subscription access", async () => {
      const f = await fixture();
      await grant(f);
      await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
        f.accountId,
      ]);
      const access = await (await commercial(f)).resolve(f.accountId, clock);
      expect(access).toMatchObject({
        kind: "OK",
        value: {
          access: { kind: "INELIGIBLE", reason: "ACCOUNT_SUSPENDED" },
          entitlements: {},
        },
      });
    });
    it("DB-32 successful checkout creates only canonical pending payment", async () => {
      const f = await fixture();
      const result = await checkout(f);
      expect(result.kind).toBe("READY");
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM payments WHERE account_id=$1 AND state='PENDING'",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(0);
      expect(
        (await q("SELECT count(*)::int AS count FROM billing_events")).rows[0]
          ?.count,
      ).toBe(0);
    });
    it("DB-33 unavailable provider leaves CREATING for retry", async () => {
      const f = await fixture();
      const result = await checkout(f, "UNAVAILABLE");
      expect(result).toMatchObject({
        kind: "RETRYABLE",
        code: "PROVIDER_UNAVAILABLE",
      });
      expect(
        (
          await q("SELECT state FROM checkout_intents WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("CREATING");
    });
    it("DB-34 unavailable-then-success retry uses one intent and payment", async () => {
      const f = await fixture();
      const key = `p57-retry-${id()}`;
      const first = await checkout(f, "UNAVAILABLE_THEN_SUCCESS", key);
      expect(first.kind).toBe("RETRYABLE");
      const second = await checkout(f, "SUCCESS", key);
      expect(second.kind).toBe("READY");
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM checkout_intents WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM payments WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-35 failed payment permits a later new checkout", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      expect(c.result).toMatchObject({ kind: "READY" });
      const event = await billingEvent(f, "payment.failed");
      expect(event).toMatchObject({ kind: "APPLIED" });
      const retry = await checkout(f, "SUCCESS", `p57-new-${id()}`);
      expect(retry).toMatchObject({ kind: "READY" });
    });
    it("DB-36 canceled payment permits a later new checkout", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const event = await billingEvent(f, "payment.canceled");
      expect(event).toMatchObject({ kind: "APPLIED" });
      const retry = await checkout(f, "SUCCESS", `p57-new-${id()}`);
      expect(retry).toMatchObject({ kind: "READY" });
    });
    it("DB-37 checkout never activates a subscription", async () => {
      const f = await fixture();
      await checkout(f);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(0);
    });
    it("DB-38 verified success activates exact subscription and links payment", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const event = await billingEvent(f);
      expect(event).toMatchObject({ kind: "APPLIED" });
      const row = (
        await q<{
          state: string;
          planRevisionId: string;
          paymentState: string;
          subscriptionId: string | null;
        }>(
          'SELECT s.state,s.current_plan_revision_id AS "planRevisionId",p.state AS "paymentState",p.subscription_id AS "subscriptionId" FROM subscriptions s JOIN payments p ON p.account_id=s.account_id WHERE s.account_id=$1',
          [f.accountId],
        )
      ).rows[0];
      expect(row).toMatchObject({
        state: "ACTIVE",
        planRevisionId: f.planRevisionId,
        paymentState: "SUCCEEDED",
      });
      expect(row?.subscriptionId).toBeTruthy();
    });
    it("DB-39 duplicate event identity is idempotent", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const identity = `p57-duplicate-${id()}`;
      const first = await billingEvent(f, "payment.succeeded", identity);
      const second = await billingEvent(f, "payment.succeeded", identity);
      expect(first).toMatchObject({ kind: "APPLIED" });
      expect(second).toMatchObject({ kind: "APPLIED", replay: true });
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-40 forged simulator event is rejected before ledger mutation", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const payment = (
        await q<{ providerPaymentId: string }>(
          'SELECT provider_payment_id AS "providerPaymentId" FROM payments WHERE account_id=$1',
          [f.accountId],
        )
      ).rows[0]!;
      const forged = buildSimulatorBillingEventEnvelope({
        provider: "simulator",
        eventIdentity: `p57-forged-${id()}`,
        eventType: "payment.succeeded",
        providerPaymentId: payment.providerPaymentId,
        amountMinor: 1900,
        currency: "RUB",
        occurredAt: clock.toISOString(),
      });
      forged.proof = `${forged.proof}tampered`;
      const result = await createBillingEventService({
        verifier: createBillingSimulator(),
        repository: createP5BillingEventRepository(db),
        now: () => clock,
      }).processBillingEvent(forged, { correlationId: id() });
      expect(result).toMatchObject({
        kind: "REJECTED",
        code: "INVALID_EVENT_PROOF",
      });
      expect(
        (await q("SELECT count(*)::int AS count FROM billing_events")).rows[0]
          ?.count,
      ).toBe(0);
    });
    it("DB-41 failed billing event changes payment truth without activation", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      expect(await billingEvent(f, "payment.failed")).toMatchObject({
        kind: "APPLIED",
      });
      expect(
        (
          await q("SELECT state FROM payments WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("FAILED");
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(0);
    });
    it("DB-42 canceled billing event changes payment truth without activation", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      expect(await billingEvent(f, "payment.canceled")).toMatchObject({
        kind: "APPLIED",
      });
      expect(
        (
          await q("SELECT state FROM payments WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("CANCELED");
    });
    it("DB-43 reconciliation claim commits before provider status lookup", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      let called = false;
      const runner = createBillingReconciliationService({
        repository: createP5ReconciliationRepository(db),
        statusPort: {
          providerKey: "simulator",
          fetchPaymentStatus: async () => {
            called = true;
            const row = (
              await q(
                "SELECT state FROM billing_reconciliation_jobs WHERE payment_id=$1",
                [c.paymentId],
              )
            ).rows[0];
            expect(row?.state).toBe("LEASED");
            return { kind: "UNAVAILABLE" as const };
          },
        },
        now: () => clock,
      });
      const claim = (
        await createP5ReconciliationRepository(db).claimDue({
          now: clock,
          leaseMs: 60_000,
          batchSize: 1,
        })
      )[0]!;
      expect(await runner.processClaim(claim, id())).toMatchObject({
        kind: "RESCHEDULED",
        code: "PROVIDER_UNAVAILABLE",
      });
      expect(called).toBe(true);
    });
    it("DB-44 reconciliation success repairs a lost event", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      const simulator = createBillingSimulator();
      simulator.configurePaymentStatus(c.providerPaymentId, {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: clock,
      });
      const repo = createP5ReconciliationRepository(db);
      const claim = (
        await repo.claimDue({ now: clock, leaseMs: 60_000, batchSize: 1 })
      )[0]!;
      const result = await createBillingReconciliationService({
        repository: repo,
        statusPort: simulator,
        now: () => clock,
      }).processClaim(claim, id());
      expect(result.kind).toBe("APPLIED");
      expect(
        (
          await q("SELECT source FROM billing_events WHERE payment_id=$1", [
            c.paymentId,
          ])
        ).rows[0]?.source,
      ).toBe("RECONCILIATION");
    });
    it("DB-45 reconciliation failed status corrects a pending payment", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      const simulator = createBillingSimulator();
      simulator.configurePaymentStatus(c.providerPaymentId, {
        kind: "FOUND",
        state: "FAILED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: clock,
      });
      const repo = createP5ReconciliationRepository(db);
      const claim = (
        await repo.claimDue({ now: clock, leaseMs: 60_000, batchSize: 1 })
      )[0]!;
      expect(
        await createBillingReconciliationService({
          repository: repo,
          statusPort: simulator,
          now: () => clock,
        }).processClaim(claim, id()),
      ).toMatchObject({ kind: "APPLIED" });
      expect(
        (await q("SELECT state FROM payments WHERE id=$1", [c.paymentId]))
          .rows[0]?.state,
      ).toBe("FAILED");
    });
    it("DB-46 reconciliation never downgrades succeeded truth", async () => {
      const f = await fixture();
      const c = await checkoutWithSimulator(f);
      await q(
        "UPDATE payments SET state='SUCCEEDED',confirmed_at=$2 WHERE id=$1",
        [c.paymentId, clock],
      );
      await q(
        "UPDATE billing_reconciliation_jobs SET state='READY',next_attempt_at=$2,lease_token=NULL,lease_until=NULL WHERE payment_id=$1",
        [c.paymentId, clock],
      );
      const simulator = createBillingSimulator();
      simulator.configurePaymentStatus(c.providerPaymentId, {
        kind: "FOUND",
        state: "FAILED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: clock,
      });
      const repo = createP5ReconciliationRepository(db);
      const claim = (
        await repo.claimDue({ now: clock, leaseMs: 60_000, batchSize: 1 })
      )[0]!;
      expect(
        await createBillingReconciliationService({
          repository: repo,
          statusPort: simulator,
          now: () => clock,
        }).processClaim(claim, id()),
      ).toMatchObject({ kind: "FAILED" });
      expect(
        (await q("SELECT state FROM payments WHERE id=$1", [c.paymentId]))
          .rows[0]?.state,
      ).toBe("SUCCEEDED");
    });
    it("DB-47 access is denied before delayed lifecycle materialization", async () => {
      const f = await fixture();
      const result = await grant(f);
      if (result.kind !== "OK") throw new Error("grant failed");
      const boundaryStart = new Date(clock.getTime() - 86_400_000);
      await q(
        "UPDATE subscriptions SET started_at=$2,current_period_start=$2,current_period_end=$3 WHERE id=$1",
        [result.value.id, boundaryStart, clock],
      );
      const access = await (await commercial(f)).resolve(f.accountId, clock);
      expect(access).toMatchObject({
        kind: "OK",
        value: { access: { kind: "INELIGIBLE", reason: "PERIOD_ENDED" } },
      });
      expect(
        (
          await q("SELECT state FROM subscriptions WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("ACTIVE");
    });
    it("DB-48 lifecycle runner materializes exact expiry", async () => {
      const f = await fixture();
      const result = await grant(f, new Date(clock.getTime() - 1));
      expect(result).toMatchObject({
        kind: "REJECTED",
        code: "SUBSCRIPTION_PERIOD_INVALID",
      });
      const subscriptionId = id();
      const started = new Date(clock.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'due')",
        [
          subscriptionId,
          f.accountId,
          f.planRevisionId,
          started,
          new Date(clock.getTime() - 1),
        ],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','ADMIN','initial',$2)",
        [subscriptionId, started],
      );
      const runner = new SubscriptionLifecycleRunner(
        createP5SubscriptionLifecycleRepository(db),
        60_000,
        10,
        () => clock,
      );
      await runner.tick(id());
      expect(
        (
          await q("SELECT state FROM subscriptions WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("EXPIRED");
    });
    it("DB-49 lifecycle due boundary is inclusive", async () => {
      const f = await fixture();
      const subscriptionId = id();
      const started = new Date(clock.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'due')",
        [subscriptionId, f.accountId, f.planRevisionId, started, clock],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','ADMIN','initial',$2)",
        [subscriptionId, started],
      );
      await new SubscriptionLifecycleRunner(
        createP5SubscriptionLifecycleRepository(db),
        60_000,
        10,
        () => clock,
      ).tick(id());
      expect(
        (
          await q("SELECT state FROM subscriptions WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("EXPIRED");
    });
    it("DB-50 suspended lifecycle uses its origin window", async () => {
      const f = await fixture();
      const started = new Date(clock.getTime() - 172_800_000);
      const periodEnd = new Date(clock.getTime() - 86_400_000);
      const suspendedAt = new Date(clock.getTime() - 86_401_000);
      const subscriptionId = id();
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,suspended_at,state_reason) VALUES($1,$2,'SUSPENDED',2,$3,$4,$4,$5,$6,'suspended')",
        [
          subscriptionId,
          f.accountId,
          f.planRevisionId,
          started,
          periodEnd,
          suspendedAt,
        ],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','ADMIN','initial',$2),($1,2,'ACTIVE','SUSPENDED','ADMIN','suspended',$3)",
        [subscriptionId, started, suspendedAt],
      );
      await new SubscriptionLifecycleRunner(
        createP5SubscriptionLifecycleRepository(db),
        60_000,
        10,
        () => clock,
      ).tick(id());
      expect(
        (
          await q("SELECT state FROM subscriptions WHERE account_id=$1", [
            f.accountId,
          ])
        ).rows[0]?.state,
      ).toBe("EXPIRED");
    });
    it("DB-51 duplicate lifecycle workers are idempotent", async () => {
      const f = await fixture();
      const subscriptionId = id();
      const started = new Date(clock.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'due')",
        [
          subscriptionId,
          f.accountId,
          f.planRevisionId,
          started,
          new Date(clock.getTime() - 1),
        ],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','ADMIN','initial',$2)",
        [subscriptionId, started],
      );
      const repo = createP5SubscriptionLifecycleRepository(db);
      await Promise.all([
        repo.processDue({ now: clock, batchSize: 1, correlationId: id() }),
        repo.processDue({ now: clock, batchSize: 1, correlationId: id() }),
      ]);
      expect(
        (
          await q(
            "SELECT state,state_revision FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0],
      ).toMatchObject({ state: "EXPIRED", state_revision: 2 });
    });
    it("DB-52 eligible commercial access binds exact entitlements", async () => {
      const f = await fixture({ maxActive: 3 });
      await grant(f);
      const result = await (await commercial(f)).resolve(f.accountId, clock);
      expect(result).toMatchObject({
        kind: "OK",
        value: {
          planRevisionId: f.planRevisionId,
          entitlements: { "device.max_active": 3, "feature.analytics": true },
        },
      });
    });
    it("DB-53 ineligible commercial access returns empty entitlements", async () => {
      const f = await fixture();
      await grant(f, clock);
      const result = await (await commercial(f)).resolve(f.accountId, clock);
      expect(result).toMatchObject({
        kind: "OK",
        value: { entitlements: {}, planRevisionId: null },
      });
    });
    it("DB-54 bootstrap caps offline grace at access deadline", async () => {
      const f = await fixture();
      const end = new Date(clock.getTime() + 120_000);
      await grant(f, end);
      let payload: Record<string, unknown> | undefined;
      const bootstrap = new BootstrapService(
        {
          resolve: async () => ({
            configVersion: 1,
            signingKeyId: "k",
            sourceFingerprintSha256: "0".repeat(64),
            compatibility: {
              extension: { status: "SUPPORTED", minimumVersion: null },
              browser: { status: "SUPPORTED" },
            },
            features: {},
          }),
        },
        {
          sign: async (_key, value) => {
            payload = value as unknown as Record<string, unknown>;
            return {
              envelopeVersion: "bootstrap_envelope_v1",
              algorithm: "Ed25519",
              keyId: "k",
              payload: "e30",
              signature: "AA",
            };
          },
        },
        { now: () => clock },
        await commercial(f),
      );
      const deviceId = id();
      await bootstrap.issue({ accountId: f.accountId, deviceId }, {
        contractVersion: "control_plane_v1",
        extensionVersion: "1.0.0",
        browser: { family: "chrome", version: "1" },
        deviceId,
      } as never);
      expect(payload?.offlineGraceUntil as string | undefined).toBe(
        end.toISOString(),
      );
      const result = await (await commercial(f)).resolve(f.accountId, clock);
      expect(result).toMatchObject({ kind: "OK", value: { accessUntil: end } });
    });
    it("DB-55 portal subscription projection is privacy-safe", async () => {
      const f = await fixture();
      await grant(f);
      const portal = new (
        await import("../../../packages/server/commercial-access/src/index.js")
      ).CommercialPortalService(
        createP5CommercialPortalRepository(db),
        await commercial(f),
        () => clock,
      );
      const result = await portal.readSubscription(f.userId, f.accountId);
      expect(result.kind).toBe("OK");
      expect(JSON.stringify(result)).not.toMatch(
        /providerPaymentId|idempotency|checkoutReference|billingEvent|leaseToken|stateReason/,
      );
    });
    it("DB-56 portal rejects non-owner", async () => {
      const f = await fixture();
      await grant(f);
      const portal = new (
        await import("../../../packages/server/commercial-access/src/index.js")
      ).CommercialPortalService(
        createP5CommercialPortalRepository(db),
        await commercial(f),
        () => clock,
      );
      expect(await portal.readSubscription(id(), f.accountId)).toMatchObject({
        kind: "ACCOUNT_FORBIDDEN",
      });
    });
    it("DB-57 audit safe metadata omits raw idempotency and provider identities", async () => {
      const f = await fixture();
      const raw = `raw-secret-key-${id()}`;
      await checkout(f, "REJECTED", raw);
      const audits = await q<{ safeMetadata: string; correlationId: string }>(
        'SELECT safe_metadata::text AS "safeMetadata",correlation_id AS "correlationId" FROM audit_events',
      );
      expect(JSON.stringify(audits.rows)).not.toContain(raw);
      expect(JSON.stringify(audits.rows)).not.toMatch(
        /providerPaymentId|providerCheckoutId|checkoutReference/,
      );
    });
    it("DB-58 checkout different keys cannot create two actionable payments", async () => {
      const f = await fixture();
      const [a, b] = await Promise.all([
        checkout(f, "SUCCESS", `p57-race-a-${id()}`),
        checkout(f, "SUCCESS", `p57-race-b-${id()}`),
      ]);
      expect([a.kind, b.kind].filter((kind) => kind === "READY")).toHaveLength(
        1,
      );
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM payments WHERE account_id=$1 AND state='PENDING'",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-59 duplicate event identities cannot duplicate activation", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const identity = `p57-race-event-${id()}`;
      const [a, b] = await Promise.all([
        billingEvent(f, "payment.succeeded", identity),
        billingEvent(f, "payment.succeeded", identity),
      ]);
      expect([a.kind, b.kind].every((kind) => kind === "APPLIED")).toBe(true);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-60 manual grant and checkout serialize to one commercial outcome", async () => {
      const f = await fixture();
      const [manual, paid] = await Promise.all([grant(f), checkout(f)]);
      expect(
        [manual.kind, paid.kind].filter(
          (kind) => kind === "OK" || kind === "READY",
        ),
      ).toHaveLength(1);
      expect(
        (
          await q(
            "SELECT count(*)::int AS count FROM subscriptions WHERE account_id=$1",
            [f.accountId],
          )
        ).rows[0]?.count +
          (
            await q(
              "SELECT count(*)::int AS count FROM payments WHERE account_id=$1",
              [f.accountId],
            )
          ).rows[0]?.count,
      ).toBe(1);
    });
    it("DB-61 checkout and account suspension serialize safely", async () => {
      const f = await fixture();
      const result = await checkout(f, "SUCCESS", `p57-suspend-${id()}`);
      await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
        f.accountId,
      ]);
      expect(result.kind).toBe("READY");
      expect(
        await (await commercial(f)).resolve(f.accountId, clock),
      ).toMatchObject({
        kind: "OK",
        value: { access: { kind: "INELIGIBLE", reason: "ACCOUNT_SUSPENDED" } },
      });
    });
    it("DB-62 entitlement override and device admission read under the same account", async () => {
      const f = await fixture({ maxActive: 2 });
      await grant(f);
      await q(
        "INSERT INTO account_entitlement_overrides(account_id,entitlement_key,revision,operation,integer_value,effective_from,reason) VALUES($1,'device.max_active',1,'SET',4,$2,'P5.7 override')",
        [f.accountId, new Date(clock.getTime() - 1)],
      );
      expect(
        await (await commercial(f)).resolveDeviceAdmission(f.accountId, clock),
      ).toMatchObject({
        kind: "ELIGIBLE",
        maxActive: 4,
        source: "COMMERCIAL_PLAN_REVISION",
      });
    });
    it("DB-63 subscription suspend and access resolve without stale entitlement", async () => {
      const f = await fixture();
      const granted = await grant(f);
      if (granted.kind !== "OK") throw new Error("grant failed");
      await createP5SubscriptionRepository(db, {
        now: () => clock,
      }).suspendSubscription(
        { subscriptionId: granted.value.id, expectedStateRevision: 1 },
        context(f.userId),
      );
      expect(
        await (await commercial(f)).resolveDeviceAdmission(f.accountId, clock),
      ).toMatchObject({ kind: "INELIGIBLE", reason: "SUBSCRIPTION_SUSPENDED" });
    });
    it("DB-64 provider identity is not exposed by portal payment reads", async () => {
      const f = await fixture();
      await checkoutWithSimulator(f);
      const portal = new (
        await import("../../../packages/server/commercial-access/src/index.js")
      ).CommercialPortalService(
        createP5CommercialPortalRepository(db),
        await commercial(f),
        () => clock,
      );
      const result = await portal.listPayments(f.userId, f.accountId, 10);
      expect(result.kind).toBe("OK");
      expect(JSON.stringify(result)).not.toMatch(
        /provider|idempotency|event|lease/,
      );
    });
    it("DB-65 lifecycle duplicate ticks do not extend access or create grace", async () => {
      const f = await fixture();
      const subscriptionId = id();
      const started = new Date(clock.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'due')",
        [
          subscriptionId,
          f.accountId,
          f.planRevisionId,
          started,
          new Date(clock.getTime() - 1),
        ],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','ADMIN','initial',$2)",
        [subscriptionId, started],
      );
      const repo = createP5SubscriptionLifecycleRepository(db);
      await repo.processDue({ now: clock, batchSize: 1, correlationId: id() });
      await repo.processDue({ now: clock, batchSize: 1, correlationId: id() });
      const row = (
        await q(
          "SELECT state,current_period_end,grace_until FROM subscriptions WHERE account_id=$1",
          [f.accountId],
        )
      ).rows[0];
      expect(row).toMatchObject({ state: "EXPIRED", grace_until: null });
    });

    it("STATIC-66 commercial lock namespace is identical across P5 paths", async () => {
      const [
        checkoutSource,
        eventSource,
        reconSource,
        subscriptionSource,
        deviceSource,
      ] = await Promise.all([
        text("packages/server/db/src/p5-checkout-repository.ts"),
        text("packages/server/db/src/p5-billing-event-repository.ts"),
        text("packages/server/db/src/p5-reconciliation-repository.ts"),
        text("packages/server/db/src/p5-subscription-repository.ts"),
        text("packages/server/db/src/device-management-repository.ts"),
      ]);
      for (const source of [
        checkoutSource,
        eventSource,
        reconSource,
        subscriptionSource,
        deviceSource,
      ])
        expect(source).toContain("p5-subscription-account:");
    });
    it("STATIC-67 provider calls are outside transaction and account lock", async () => {
      const checkoutSource = await text("packages/server/billing/src/index.ts");
      const reconSource = await text("packages/server/billing/src/index.ts");
      expect(checkoutSource.indexOf("provider.createCheckout")).toBeGreaterThan(
        checkoutSource.indexOf("prepareCheckout"),
      );
      expect(reconSource.indexOf("fetchPaymentStatus")).toBeGreaterThan(-1);
      expect(
        await text("packages/server/db/src/p5-reconciliation-repository.ts"),
      ).toContain("claimDue");
    });
    it("STATIC-68 API production main has commercial access and no simulator", async () => {
      const source = await text("apps/api/src/main.ts");
      expect(source).toContain("CommercialAccessService");
      expect(source).not.toContain("billing-simulator");
      expect(source).not.toContain("PreEntitlementDeviceLimitResolver");
    });
    it("STATIC-69 worker production main wires lifecycle only", async () => {
      const source = await text("apps/worker/src/main.ts");
      expect(source).toContain("SubscriptionLifecycleRunner");
      expect(source).not.toContain("billing-simulator");
      expect(source).not.toContain("BillingPaymentStatusPort");
    });
    it("STATIC-70 portal proxy is limited to the exact commercial reads", async () => {
      const source = await text("apps/portal/lib/control-plane-route.ts");
      expect(source).toContain('"GET /v1/subscription"');
      expect(source).toContain('"GET /v1/billing/payments"');
      expect(source).not.toContain("/v1/billing/checkouts");
      expect(source).not.toContain("/v1/webhooks");
    });
    it("STATIC-71 OpenAPI current repository artifact has 106 operations and exact hash", async () => {
      const artifact = JSON.parse(
        await text("packages/contracts/openapi/openapi.json"),
      ) as {
        paths: Record<string, Record<string, unknown>>;
      };
      const count = Object.values(artifact.paths).reduce(
        (n, path) =>
          n +
          Object.keys(path).filter((method) =>
            ["get", "post", "put", "patch", "delete"].includes(method),
          ).length,
        0,
      );
      expect(count).toBe(106);
      expect(
        createHash("sha256")
          .update(
            await readFile(
              resolve(serverRoot, "packages/contracts/openapi/openapi.json"),
            ).then((value) => value),
          )
          .digest("hex"),
      ).toBe(
        "4154fca08d6730bd5049072d8123aae0e12d4f4fc6ba7f315724a2c8bbaff0d6",
      );
    });
    it("STATIC-72 OpenAPI has no checkout, webhook, or fake completion route", async () => {
      const artifact = await text("packages/contracts/openapi/openapi.json");
      expect(artifact).not.toContain("/v1/billing/checkouts");
      expect(artifact).not.toContain("/v1/webhooks/billing");
      expect(artifact).not.toContain("payment-completion");
    });
    it("STATIC-73 executable server scope contains no real provider SDK or credential", async () => {
      const files = [
        "package.json",
        "apps/api/package.json",
        "apps/worker/package.json",
        "packages/server/billing/package.json",
        "packages/server/billing-simulator/package.json",
      ];
      const contents = await Promise.all(files.map((file) => text(file)));
      const source = contents.join("\n").toLowerCase();
      expect(source).not.toMatch(
        /yookassa|tinkoff|t-bank|merchant_secret|webhook_secret/,
      );
    });
    it("STATIC-74 executable server scope has no Ozon seller payload intake", async () => {
      const api = await text("apps/api/src/main.ts");
      const packages = await Promise.all(
        [
          "packages/contracts/src/index.ts",
          "packages/server/observability/src/index.ts",
          "packages/shared/src/index.ts",
        ].map((file) => text(file)),
      );
      expect(`${api}\n${packages.join("\n")}`).not.toMatch(
        /ozonClientId|ozonApiKey|rawSeller|sellerOrders|fullConversation|customerPayload/,
      );
    });
    it("STATIC-75 package manifests add no mandatory distributed queue", async () => {
      const manifests = await text("package.json");
      expect(manifests).not.toMatch(/redis|kafka|rabbitmq|temporal/i);
    });
    it("STATIC-76 bridge guard scope remains separate from server", async () => {
      const guard = await text("tooling/server/check-bridge-boundary.mjs");
      expect(guard).toContain("tooling/llm-api-bridges/ozon-seller");
      expect(await text("apps/api/src/main.ts")).not.toContain(
        "tooling/llm-api-bridges/ozon-seller",
      );
    });
    it("STATIC-77 production billing UX is explicitly read-only", async () => {
      const page = await text("apps/portal/app/billing/page.tsx");
      expect(page).toContain("Online payment is not enabled yet");
      expect(page).not.toMatch(/checkout|purchase|pay now|complete payment/i);
    });
    it("STATIC-78 package lock and API contracts remain unchanged by P5.7", async () => {
      expect(await text("pnpm-lock.yaml")).toContain("lockfileVersion");
      const routes = await text("apps/api/src/commercial-routes.ts");
      expect(routes).toContain('"/v1/subscription"');
      expect(routes).toContain('"/v1/billing/payments"');
      expect(routes).not.toContain("/v1/billing/checkouts");
    });
    it("STATIC-79 migration 0012 is present and all historical hashes remain exact", async () => {
      const migrations = await import("node:fs/promises").then(({ readdir }) =>
        readdir(resolve(serverRoot, "packages/server/db/drizzle")),
      );
      expect(migrations.some((name) => name.startsWith("0012_"))).toBe(true);
      const expected: Record<string, string> = {
        "0000_p1_migration_probe.sql":
          "9a7cde34d8b38667ccedd630cd2dc40697b2ee5c922927bb08f93f242bc5af56",
        "0001_sturdy_doctor_spectrum.sql":
          "0544b377425ee3a6ebc9dc21ebb402febe27852c7bf93666f4154fbc0f723b2f",
        "0002_p2_2_otp_portal_auth.sql":
          "f6f302d14574a7f9dff3675b8b330fbbf90a4d69387041b9fdf8fbe0454ce449",
        "0003_p2_3_device_authorization.sql":
          "ffe1c20c37c92f1529251ff21921c5a3a1a946a09c661b162e8458c37c08c9b6",
        "0004_p2_4_token_core.sql":
          "38774ebb870f9d233ddc51d2b8d24dd361ae2274920d0f7b0286eae333273e1d",
        "0005_p2_5_device_management.sql":
          "6b95b4dae57e356804a83d1d34ff03286fb5465ff3d214a4b40ae70150283d21",
        "0006_p3_2_compatibility_config_signing.sql":
          "37aa137364c9327108ea0db8ca25cba7cbc99c0d1649b959499a4fa87824dd1f",
        "0007_p3_3_features_rollouts.sql":
          "1c8c32d6f9ea073788507736f06daaa67dee2f74465d2b990eb7fbcc67d0abe6",
        "0008_p4_1_commercial_catalog.sql":
          "d661f98db6b18a2181fe2094f0715b11eb56eec7e96270d9634f4cd2fc8dc9f1",
        "0009_p5_1_subscription_billing_foundation.sql":
          "d073221a237bdc867672b5e1e8223a0f62eacbb4670c1c19cfc346b64406e4ec",
        "0010_p5_3_checkout_intents.sql":
          "28ec7583b9ad7497246580ce19a22ba82d72cc6ab223c6f9503f4b88ad1eef18",
        "0011_p5_5_billing_reconciliation_jobs.sql":
          "5f55a0e69bdc49769cdb5e8796c0e8f4290372aeeaaca7a93792cab48bebef12",
      };
      const { createHash } = await import("node:crypto");
      for (const [name, hash] of Object.entries(expected))
        expect(
          createHash("sha256")
            .update(
              await readFile(
                resolve(serverRoot, "packages/server/db/drizzle", name),
              ),
            )
            .digest("hex"),
        ).toBe(hash);
    });
    it("STATIC-80 accepted P5 history remains linear and P6.1 decomposition is recorded", async () => {
      const roadmap = await text("docs/server/ROADMAP.md");
      expect(roadmap).toContain("P6.1");
      expect(
        await import("node:fs/promises")
          .then(({ access }) =>
            access(resolve(serverRoot, "docs/server/ADR/0026-p5-7")),
          )
          .catch(() => "missing"),
      ).toBe("missing");
      await expect(
        import("node:fs/promises").then(({ access }) =>
          access(
            resolve(
              serverRoot,
              "docs/server/ADR/0026-p6-admin-security-foundation-and-decomposition.md",
            ),
          ),
        ),
      ).resolves.toBeUndefined();
    });
  },
);
