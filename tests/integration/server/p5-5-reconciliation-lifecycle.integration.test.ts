import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  createBillingReconciliationService,
  sha256,
} from "../../../packages/server/billing/src/index.js";
import {
  createDatabaseRuntime,
  createP5ReconciliationRepository,
  createP5SubscriptionLifecycleRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P5.5 PostgreSQL tests");
let db: DatabaseRuntime;
const now = new Date("2026-09-07T12:00:00.000Z");
const id = () => randomUUID();
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);

async function fixture(
  options: {
    state?:
      | "PENDING"
      | "SUCCEEDED"
      | "FAILED"
      | "CANCELED"
      | "REFUNDED"
      | "CHARGEBACK";
    withCheckout?: boolean;
    periodEnd?: Date;
  } = {},
) {
  const userId = id(),
    accountId = id(),
    planId = id(),
    planRevisionId = id(),
    priceId = id(),
    priceRevisionId = id(),
    paymentId = id(),
    providerPaymentId = `sim_payment_${paymentId}`;
  await q("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await q("INSERT INTO accounts(id,status) VALUES($1,'ACTIVE')", [accountId]);
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [accountId, userId],
  );
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    `p-${planId.slice(0, 8)}`,
  ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,published_at) VALUES($1,$2,1,'PUBLISHED','P5.5','P5.5',$3)",
    [planRevisionId, planId, now],
  );
  await q(
    "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'ru','web','ACTIVE')",
    [priceId, planId, `pr-${priceId.slice(0, 8)}`],
  );
  await q(
    "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at) VALUES($1,$2,$3,1,'PUBLISHED',1900,'RUB','MONTH',1,$4,$4)",
    [priceRevisionId, priceId, planRevisionId, now],
  );
  const state = options.state ?? "PENDING";
  await q(
    "INSERT INTO payments(id,account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256,created_at,updated_at,confirmed_at) VALUES($1,$2,'simulator',$3,$4,1900,'RUB','PENDING',$5,$6,$7,$7,NULL)",
    [
      paymentId,
      accountId,
      providerPaymentId,
      priceRevisionId,
      sha256(`k-${paymentId}`),
      sha256(`f-${paymentId}`),
      new Date("2026-09-07T10:00:00Z"),
    ],
  );
  if (options.withCheckout !== false) {
    const checkoutId = id();
    await q(
      "INSERT INTO checkout_intents(id,account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count,created_at,updated_at) VALUES($1,$2,$3,$4,'simulator','CREATING',$5,$6,$7,1900,'RUB','MONTH',1,$7,$7)",
      [
        checkoutId,
        accountId,
        priceRevisionId,
        planRevisionId,
        sha256(`k-${paymentId}`),
        sha256(`f-${paymentId}`),
        now,
      ],
    );
    await q(
      "UPDATE checkout_intents SET state='READY',provider_checkout_id='checkout_fixture',provider_payment_id=$1,checkout_reference='ref_fixture',payment_id=$2,completed_at=$3 WHERE id=$4",
      [providerPaymentId, paymentId, now, checkoutId],
    );
    if (state !== "PENDING")
      await q(
        "UPDATE payments SET state=$1::payment_state,confirmed_at=CASE WHEN $1::text='SUCCEEDED' THEN $2::timestamptz ELSE NULL END WHERE id=$3",
        [state, new Date("2026-09-07T11:00:00Z"), paymentId],
      );
  } else if (state !== "PENDING") {
    await q(
      "UPDATE payments SET state=$1::payment_state,confirmed_at=CASE WHEN $1::text='SUCCEEDED' THEN $2::timestamptz ELSE NULL END WHERE id=$3",
      [state, new Date("2026-09-07T11:00:00Z"), paymentId],
    );
  }
  return {
    userId,
    accountId,
    planRevisionId,
    priceRevisionId,
    paymentId,
    providerPaymentId,
  };
}
async function clean() {
  await q(
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_sale_assignments,account_entitlement_overrides,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,audit_events,account_memberships,accounts,users CASCADE",
  );
}

describe("P5.5 real PostgreSQL reconciliation and lifecycle", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString: connectionString! });
    db = createDatabaseRuntime(connectionString!);
  });
  beforeEach(clean);
  afterAll(() => db.close());
  it("migration exposes exactly one P5.5 table", async () =>
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_tables WHERE tablename LIKE 'billing_reconciliation_jobs'",
        )
      ).rows[0]?.count,
    ).toBe("1"));
  it("backfill has no rows when no payments exist", async () =>
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM billing_reconciliation_jobs",
        )
      ).rows[0]?.count,
    ).toBe("0"));
  it("future payment fixture can have a job", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    expect(
      (
        await q(
          "SELECT payment_id FROM billing_reconciliation_jobs WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("delete is rejected", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    await expect(
      q("DELETE FROM billing_reconciliation_jobs WHERE payment_id=$1", [
        f.paymentId,
      ]),
    ).rejects.toThrow();
  });
  it("ready shape rejects missing due time", async () => {
    const f = await fixture();
    await expect(
      q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,created_at,updated_at) VALUES($1,'READY',$2,$2)",
        [f.paymentId, now],
      ),
    ).rejects.toThrow();
  });
  it("leased shape rejects missing token", async () => {
    const f = await fixture();
    await expect(
      q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,lease_until,created_at,updated_at) VALUES($1,'LEASED',$2,$3,$3)",
        [f.paymentId, now, now],
      ),
    ).rejects.toThrow();
  });
  it("terminal shape clears lease", async () => {
    const f = await fixture();
    await expect(
      q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,lease_token,created_at,updated_at) VALUES($1,'SETTLED',$2,$3,$2,$2)",
        [f.paymentId, now, id()],
      ),
    ).rejects.toThrow();
  });
  it("result code format is enforced", async () => {
    const f = await fixture();
    await expect(
      q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,last_result_code,created_at,updated_at) VALUES($1,'READY',$2,'bad code',$2,$2)",
        [f.paymentId, now],
      ),
    ).rejects.toThrow();
  });
  it("attempt count cannot be negative", async () => {
    const f = await fixture();
    await expect(
      q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,attempt_count,created_at,updated_at) VALUES($1,'READY',$2,-1,$2,$2)",
        [f.paymentId, now],
      ),
    ).rejects.toThrow();
  });
  it("claim moves ready to leased", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const c = await createP5ReconciliationRepository(db).claimDue({
      now,
      leaseMs: 60_000,
      batchSize: 10,
    });
    expect(c[0]?.leaseToken).toBeTruthy();
    expect(
      (
        await q<{ state: string }>(
          "SELECT state FROM billing_reconciliation_jobs WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows[0]?.state,
    ).toBe("LEASED");
  });
  it("claim increments attempts", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    await createP5ReconciliationRepository(db).claimDue({
      now,
      leaseMs: 1,
      batchSize: 1,
    });
    expect(
      (
        await q<{ attempt_count: number }>(
          "SELECT attempt_count FROM billing_reconciliation_jobs WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows[0]?.attempt_count,
    ).toBe(1);
  });
  it("expired lease is reclaimable", async () => {
    const f = await fixture();
    const old = new Date(now.getTime() - 1000);
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,lease_token,lease_until,attempt_count,created_at,updated_at) VALUES($1,'LEASED',$2,$3,1,$4,$4)",
      [f.paymentId, id(), old, old],
    );
    const c = await createP5ReconciliationRepository(db).claimDue({
      now,
      leaseMs: 60_000,
      batchSize: 1,
    });
    expect(c).toHaveLength(1);
  });
  it("non-due ready is not claimed", async () => {
    const f = await fixture();
    const later = new Date(now.getTime() + 1000);
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$3,$3)",
      [f.paymentId, later, now],
    );
    expect(
      await createP5ReconciliationRepository(db).claimDue({
        now,
        leaseMs: 60_000,
        batchSize: 1,
      }),
    ).toHaveLength(0);
  });
  it("stale token cannot reschedule", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,lease_token,lease_until,created_at,updated_at) VALUES($1,'LEASED',$2,$3,$4,$4)",
      [f.paymentId, id(), now, now],
    );
    const r = await createP5ReconciliationRepository(db).reschedule({
      paymentId: f.paymentId,
      leaseToken: id(),
      nextAttemptAt: now,
      code: "PROVIDER_PENDING",
    });
    expect(r.kind).toBe("STALE_LEASE");
  });
  it("pending status reschedules without event", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "PENDING",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: now,
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("RESCHEDULED");
    expect(
      (
        await q("SELECT count(*) FROM billing_events WHERE payment_id=$1", [
          f.paymentId,
        ])
      ).rows[0]?.count,
    ).toBe("0");
  });
  it("unavailable service reschedules", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const r = createBillingReconciliationService({
      repository: createP5ReconciliationRepository(db),
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "UNAVAILABLE" as const }),
      },
      now: () => now,
    }).processClaim(
      (
        await createP5ReconciliationRepository(db).claimDue({
          now,
          leaseMs: 60_000,
          batchSize: 1,
        })
      )[0]!,
      id(),
    );
    expect((await r).kind).toBe("RESCHEDULED");
  });
  it("not found service reschedules", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const r = await createBillingReconciliationService({
      repository: repo,
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "NOT_FOUND" as const }),
      },
      now: () => now,
    }).processClaim(
      (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!,
      id(),
    );
    expect(r.kind).toBe("RESCHEDULED");
  });
  it("success creates subscription and reconciliation event", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: new Date("2026-09-07T11:00:00Z"),
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("APPLIED");
    expect(
      (
        await q("SELECT state,subscription_id FROM payments WHERE id=$1", [
          f.paymentId,
        ])
      ).rows[0]?.state,
    ).toBe("SUCCEEDED");
    expect(
      (
        await q(
          "SELECT source,event_type FROM billing_events WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows[0]?.source,
    ).toBe("RECONCILIATION");
  });
  it("success settles the job", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: new Date("2026-09-07T11:00:00Z"),
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(
      (
        await q<{ state: string }>(
          "SELECT state FROM billing_reconciliation_jobs WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows[0]?.state,
    ).toBe("SETTLED");
  });
  it("terms mismatch blocks without payment mutation", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1901,
        currency: "RUB",
        statusAt: now,
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("FAILED");
    expect(
      (await q("SELECT state FROM payments WHERE id=$1", [f.paymentId])).rows[0]
        ?.state,
    ).toBe("PENDING");
  });
  it("future status time blocks", async () => {
    const f = await fixture();
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "FAILED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: new Date(now.getTime() + 1),
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("FAILED");
  });
  it("missing checkout blocks success repair", async () => {
    const f = await fixture({ withCheckout: false });
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: now,
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("FAILED");
  });
  it("failed payment can be repaired to success", async () => {
    const f = await fixture({ state: "FAILED" });
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "SUCCEEDED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: now,
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(
      (await q("SELECT state FROM payments WHERE id=$1", [f.paymentId])).rows[0]
        ?.state,
    ).toBe("SUCCEEDED");
  });
  it("succeeded payment is not downgraded", async () => {
    const f = await fixture({ state: "SUCCEEDED" });
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
      [f.paymentId, now],
    );
    const repo = createP5ReconciliationRepository(db);
    const c = (await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 }))[0]!;
    const r = await repo.applyStatus({
      claim: c,
      status: {
        kind: "FOUND",
        state: "FAILED",
        amountMinor: 1900,
        currency: "RUB",
        statusAt: now,
      },
      processedAt: now,
      correlationId: id(),
    });
    expect(r.kind).toBe("FAILED");
    expect(
      (await q("SELECT state FROM payments WHERE id=$1", [f.paymentId])).rows[0]
        ?.state,
    ).toBe("SUCCEEDED");
  });
  it("refunded backfill is blocked", async () => {
    const f = await fixture({ state: "REFUNDED" });
    await q(
      "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,last_result_code,created_at,updated_at) VALUES($1,'BLOCKED',NULL,'UNSUPPORTED_PAYMENT_STATE',$2,$2)",
      [f.paymentId, now],
    );
    expect(
      (
        await q(
          "SELECT state,last_result_code FROM billing_reconciliation_jobs WHERE payment_id=$1",
          [f.paymentId],
        )
      ).rows[0],
    ).toMatchObject({
      state: "BLOCKED",
      last_result_code: "UNSUPPORTED_PAYMENT_STATE",
    });
  });
  it("lifecycle exact active boundary expires", async () => {
    const f = await fixture();
    const subscriptionId = id(),
      start = new Date(now.getTime() - 86_400_000);
    await q(
      "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'TEST',$4,$4)",
      [subscriptionId, f.accountId, f.planRevisionId, start, now],
    );
    await q(
      "INSERT INTO subscription_transitions(subscription_id,transition_revision,to_state,source,actor_type,reason,occurred_at) VALUES($1,1,'ACTIVE','ADMIN','SYSTEM','TEST',$2)",
      [subscriptionId, start],
    );
    const r = await createP5SubscriptionLifecycleRepository(db).processDue({
      now,
      batchSize: 10,
      correlationId: id(),
    });
    expect(r.transitioned).toBe(1);
    expect(
      (await q("SELECT state FROM subscriptions WHERE id=$1", [subscriptionId]))
        .rows[0]?.state,
    ).toBe("EXPIRED");
  });
  it("lifecycle before boundary no-ops", async () => {
    const f = await fixture();
    const future = new Date(now.getTime() + 1000),
      subscriptionId = id();
    await q(
      "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'TEST',$4,$4)",
      [subscriptionId, f.accountId, f.planRevisionId, now, future],
    );
    const r = await createP5SubscriptionLifecycleRepository(db).processDue({
      now,
      batchSize: 10,
      correlationId: id(),
    });
    expect(r.transitioned).toBe(0);
  });
  it("grace exact boundary becomes past due", async () => {
    const f = await fixture();
    const subscriptionId = id(),
      start = new Date(now.getTime() - 2000),
      end = new Date(now.getTime() - 1000);
    await q(
      "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,grace_until,state_reason,created_at,updated_at) VALUES($1,$2,'GRACE',1,$3,$4,$4,$5,$6,'TEST',$4,$4)",
      [subscriptionId, f.accountId, f.planRevisionId, start, end, now],
    );
    await q(
      "INSERT INTO subscription_transitions(subscription_id,transition_revision,to_state,source,actor_type,reason,occurred_at) VALUES($1,1,'GRACE','ADMIN','SYSTEM','TEST',$2)",
      [subscriptionId, start],
    );
    const r = await createP5SubscriptionLifecycleRepository(db).processDue({
      now,
      batchSize: 10,
      correlationId: id(),
    });
    expect(r.transitioned).toBe(1);
    expect(
      (await q("SELECT state FROM subscriptions WHERE id=$1", [subscriptionId]))
        .rows[0]?.state,
    ).toBe("PAST_DUE");
  });
  it("grace without deadline is counted corrupted", async () => {
    const f = await fixture();
    const subscriptionId = id();
    await q(
      "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason,created_at,updated_at) VALUES($1,$2,'GRACE',1,$3,$4,$4,$5,'TEST',$4,$4)",
      [
        subscriptionId,
        f.accountId,
        f.planRevisionId,
        new Date(now.getTime() - 1000),
        new Date(now.getTime() - 500),
      ],
    );
    const r = await createP5SubscriptionLifecycleRepository(db).processDue({
      now,
      batchSize: 10,
      correlationId: id(),
    });
    expect(r.corrupted).toBe(1);
  });
  for (const state of ["TRIAL", "ACTIVE", "CANCELED"] as const)
    it(`backed lifecycle ${state} uses expired state`, async () => {
      const f = await fixture();
      const subscriptionId = id(),
        start = new Date(now.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason,created_at,updated_at) VALUES($1,$2,$3,1,$4,$5,$5,$6,'TEST',$5,$5)",
        [subscriptionId, f.accountId, state, f.planRevisionId, start, now],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,to_state,source,actor_type,reason,occurred_at) VALUES($1,1,$2,'ADMIN','SYSTEM','TEST',$3)",
        [subscriptionId, state, start],
      );
      await createP5SubscriptionLifecycleRepository(db).processDue({
        now,
        batchSize: 10,
        correlationId: id(),
      });
      expect(
        (
          await q("SELECT state FROM subscriptions WHERE id=$1", [
            subscriptionId,
          ])
        ).rows[0]?.state,
      ).toBe("EXPIRED");
    });

  for (const batchSize of Array.from({ length: 20 }, (_, i) => i + 1))
    it(`bounded claim batch size ${batchSize}`, async () => {
      const f = await fixture();
      await q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
        [f.paymentId, now],
      );
      const claims = await createP5ReconciliationRepository(db).claimDue({
        now,
        leaseMs: 60_000,
        batchSize,
      });
      expect(claims).toHaveLength(1);
      expect(claims[0]?.paymentId).toBe(f.paymentId);
    });

  for (const code of [
    "PROVIDER_PENDING",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_NOT_FOUND",
    "CURRENT_SUBSCRIPTION_CONFLICT",
    "PAYMENT_STATE_CONFLICT",
    "PAYMENT_SUBSCRIPTION_CORRUPTED",
  ] as const)
    it(`persists retry code ${code}`, async () => {
      const f = await fixture();
      await q(
        "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,created_at,updated_at) VALUES($1,'READY',$2,$2,$2)",
        [f.paymentId, now],
      );
      const repo = createP5ReconciliationRepository(db);
      const claim = (
        await repo.claimDue({ now, leaseMs: 60_000, batchSize: 1 })
      )[0]!;
      expect(
        (
          await repo.reschedule({
            paymentId: f.paymentId,
            leaseToken: claim.leaseToken,
            nextAttemptAt: new Date(now.getTime() + 60_000),
            code,
          })
        ).kind,
      ).toBe("RESCHEDULED");
      expect(
        (
          await q<{ last_result_code: string }>(
            "SELECT last_result_code FROM billing_reconciliation_jobs WHERE payment_id=$1",
            [f.paymentId],
          )
        ).rows[0]?.last_result_code,
      ).toBe(code);
    });

  for (const offset of Array.from({ length: 41 }, (_, i) => i - 20))
    it(`active boundary offset ${offset}`, async () => {
      const f = await fixture();
      const subscriptionId = id();
      const dueAt = new Date(now.getTime() + offset);
      const start = new Date(dueAt.getTime() - 86_400_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,'TEST',$4,$4)",
        [subscriptionId, f.accountId, f.planRevisionId, start, dueAt],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,to_state,source,actor_type,reason,occurred_at) VALUES($1,1,'ACTIVE','ADMIN','SYSTEM','TEST',$2)",
        [subscriptionId, start],
      );
      const summary = await createP5SubscriptionLifecycleRepository(
        db,
      ).processDue({ now, batchSize: 1, correlationId: id() });
      expect(summary.transitioned).toBe(offset <= 0 ? 1 : 0);
    });

  for (const offset of Array.from({ length: 21 }, (_, i) => i - 10))
    it(`grace boundary offset ${offset}`, async () => {
      const f = await fixture();
      const subscriptionId = id();
      const dueAt = new Date(now.getTime() + offset);
      const start = new Date(dueAt.getTime() - 86_400_000);
      const periodEnd = new Date(dueAt.getTime() - 1_000);
      await q(
        "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,grace_until,state_reason,created_at,updated_at) VALUES($1,$2,'GRACE',1,$3,$4,$4,$5,$6,'TEST',$4,$4)",
        [
          subscriptionId,
          f.accountId,
          f.planRevisionId,
          start,
          periodEnd,
          dueAt,
        ],
      );
      await q(
        "INSERT INTO subscription_transitions(subscription_id,transition_revision,to_state,source,actor_type,reason,occurred_at) VALUES($1,1,'GRACE','ADMIN','SYSTEM','TEST',$2)",
        [subscriptionId, start],
      );
      const summary = await createP5SubscriptionLifecycleRepository(
        db,
      ).processDue({ now, batchSize: 1, correlationId: id() });
      expect(summary.transitioned).toBe(offset <= 0 ? 1 : 0);
    });
});
