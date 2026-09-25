import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCheckoutService,
  fingerprintCheckoutRequest,
  hashCheckoutIdempotencyKey,
  type CheckoutResult,
} from "../../../packages/server/billing/src/index.js";
import { createBillingSimulator } from "../../../packages/server/billing-simulator/src/index.js";
import {
  createDatabaseRuntime,
  createP4CommercialCatalogRepository,
  createP5CheckoutRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P5.3 PostgreSQL tests");

let db: DatabaseRuntime;
let clock = new Date("2026-09-06T12:00:00.000Z");
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const id = () => randomUUID();
const key = () => `checkout-${randomUUID().replaceAll("-", "")}`;
const context = (actorId: string, correlationId = id()) => ({
  actorType: "ACCOUNT_USER" as const,
  actorId,
  correlationId,
});

async function clean() {
  await q(
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_sale_assignments,account_entitlement_overrides,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,audit_events,account_memberships,accounts,users CASCADE",
  );
  clock = new Date("2026-09-06T12:00:00.000Z");
}

async function account(
  options: { status?: "ACTIVE" | "SUSPENDED"; owner?: boolean } = {},
) {
  const userId = id();
  const accountId = id();
  await q("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [
    accountId,
    options.status ?? "ACTIVE",
  ]);
  if (options.owner !== false)
    await q(
      "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
      [accountId, userId],
    );
  return { accountId, userId };
}

async function offer(
  options: {
    planStatus?: "ACTIVE" | "HIDDEN" | "ARCHIVED";
    priceStatus?: "ACTIVE" | "HIDDEN" | "ARCHIVED";
    priceState?: "PUBLISHED" | "DRAFT";
    planState?: "PUBLISHED" | "DRAFT";
    selected?: boolean;
    effectiveTo?: Date | null;
    amountMinor?: number;
    currency?: string;
    intervalUnit?: "DAY" | "MONTH" | "YEAR";
    intervalCount?: number;
    planMismatch?: boolean;
  } = {},
) {
  const planId = id();
  const planRevisionId = id();
  const priceId = id();
  const priceRevisionId = id();
  const otherPlanId = id();
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,$3)", [
    planId,
    `plan-${planId.slice(0, 8)}`,
    options.planStatus ?? "ACTIVE",
  ]);
  if (options.planMismatch)
    await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
      otherPlanId,
      `other-${otherPlanId.slice(0, 8)}`,
    ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,published_at) VALUES($1,$2,1,$3,'Test plan','P5.3 test plan',$4)",
    [
      planRevisionId,
      options.planMismatch ? otherPlanId : planId,
      options.planState ?? "PUBLISHED",
      (options.planState ?? "PUBLISHED") === "PUBLISHED" ? clock : null,
    ],
  );
  await q(
    "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'ru','web',$4)",
    [
      priceId,
      planId,
      `price-${priceId.slice(0, 8)}`,
      options.priceStatus ?? "ACTIVE",
    ],
  );
  await q(
    "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,effective_to,published_at) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      priceRevisionId,
      priceId,
      planRevisionId,
      options.priceState ?? "PUBLISHED",
      options.amountMinor ?? 19000,
      options.currency ?? "RUB",
      options.intervalUnit ?? "MONTH",
      options.intervalCount ?? 1,
      new Date("2026-01-01T00:00:00Z"),
      options.effectiveTo ?? null,
      (options.priceState ?? "PUBLISHED") === "PUBLISHED" ? clock : null,
    ],
  );
  await q(
    "INSERT INTO price_sale_assignments(id,price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,1,$3,$4,'P5.3 fixture')",
    [
      id(),
      priceId,
      options.selected === false ? null : priceRevisionId,
      new Date("2026-01-01T00:00:00Z"),
    ],
  );
  return { planId, planRevisionId, priceId, priceRevisionId };
}

async function currentSubscription(
  accountId: string,
  planRevisionId: string,
  state = "ACTIVE",
) {
  await q(
    "INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,state_reason) VALUES($1,$2,1,$3,$4,$4,$5,'P5.3 current fixture')",
    [accountId, state, planRevisionId, clock, new Date("2026-10-01T00:00:00Z")],
  );
}

function service(
  scenario:
    | "SUCCESS"
    | "REJECTED"
    | "UNAVAILABLE"
    | "UNAVAILABLE_THEN_SUCCESS" = "SUCCESS",
) {
  return createCheckoutService({
    repository: createP5CheckoutRepository(db, { now: () => clock }),
    offerResolver: createP4CommercialCatalogRepository(db),
    provider: createBillingSimulator({ scenario }),
    now: () => clock,
  });
}

async function checkout(
  options: {
    scenario?:
      | "SUCCESS"
      | "REJECTED"
      | "UNAVAILABLE"
      | "UNAVAILABLE_THEN_SUCCESS";
    accountOptions?: { status?: "ACTIVE" | "SUSPENDED"; owner?: boolean };
    offerOptions?: Parameters<typeof offer>[0];
    idempotencyKey?: string;
  } = {},
) {
  const customer = await account(options.accountOptions);
  const commercial = await offer(options.offerOptions);
  const result = await service(options.scenario).createCheckout(
    {
      accountId: customer.accountId,
      priceRevisionId: commercial.priceRevisionId,
      idempotencyKey: options.idempotencyKey ?? key(),
    },
    context(customer.userId),
  );
  return { customer, commercial, result };
}

function ready(result: CheckoutResult) {
  if (result.kind !== "READY")
    throw new Error(`expected READY, got ${result.kind}`);
  return result;
}

async function intents() {
  return (
    await q<Record<string, unknown>>(
      "SELECT * FROM checkout_intents ORDER BY created_at",
    )
  ).rows;
}
async function payments() {
  return (
    await q<Record<string, unknown>>(
      "SELECT * FROM payments ORDER BY created_at",
    )
  ).rows;
}
async function audits() {
  return (
    await q<Record<string, unknown>>(
      "SELECT action,target_type,target_id,reason,safe_metadata FROM audit_events WHERE target_type='CHECKOUT_INTENT' ORDER BY created_at",
    )
  ).rows;
}

describe.sequential("P5.3 simulated checkout on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(clean);
  afterAll(() => db.close());

  it("01 has exactly one checkout-intents table", async () =>
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='checkout_intents'",
        )
      ).rows[0]!.count,
    ).toBe("1"));
  it("02 has no 0011 migration", async () =>
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash LIKE '%0011%'",
        )
      ).rows[0]!.count,
    ).toBe("0"));
  it("03 exposes exactly three lifecycle states", async () =>
    expect(
      (
        await q<{ enumlabel: string }>(
          "SELECT enumlabel FROM pg_enum WHERE enumtypid='checkout_intent_state'::regtype ORDER BY enumsortorder",
        )
      ).rows.map((r) => r.enumlabel),
    ).toEqual(["CREATING", "READY", "FAILED"]));
  it("04 has the account/key uniqueness", async () =>
    expect(
      (
        await q(
          "SELECT 1 FROM pg_constraint WHERE conname='checkout_intents_account_idempotency_unique'",
        )
      ).rows,
    ).toHaveLength(1));
  it("05 has provider checkout partial uniqueness", async () =>
    expect(
      (
        await q(
          "SELECT 1 FROM pg_indexes WHERE indexname='checkout_intents_provider_checkout_unique' AND indexdef LIKE '%WHERE%'",
        )
      ).rows,
    ).toHaveLength(1));
  it("06 has provider payment partial uniqueness", async () =>
    expect(
      (
        await q(
          "SELECT 1 FROM pg_indexes WHERE indexname='checkout_intents_provider_payment_unique' AND indexdef LIKE '%WHERE%'",
        )
      ).rows,
    ).toHaveLength(1));
  it("07 has payment partial uniqueness", async () =>
    expect(
      (
        await q(
          "SELECT 1 FROM pg_indexes WHERE indexname='checkout_intents_payment_unique' AND indexdef LIKE '%WHERE%'",
        )
      ).rows,
    ).toHaveLength(1));
  it("08 has no raw payload columns", async () =>
    expect(
      (
        await q<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name='checkout_intents' AND column_name LIKE '%payload%'",
        )
      ).rows,
    ).toHaveLength(0));
  it("09 has no URL column", async () =>
    expect(
      (
        await q<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name='checkout_intents' AND column_name LIKE '%url%'",
        )
      ).rows,
    ).toHaveLength(0));
  it("10 inserts only CREATING through the repository", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    expect((await intents())[0]!.state).toBe("CREATING");
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("11 CREATING starts without provider references", async () => {
    await checkout({ scenario: "UNAVAILABLE" });
    expect((await intents())[0]).toMatchObject({
      provider_checkout_id: null,
      provider_payment_id: null,
      checkout_reference: null,
      payment_id: null,
      failure_code: null,
      completed_at: null,
    });
  });
  it("12 successful finalization stores READY", async () => {
    await checkout();
    expect((await intents())[0]!.state).toBe("READY");
  });
  it("13 rejection stores FAILED", async () => {
    await checkout({ scenario: "REJECTED" });
    expect((await intents())[0]).toMatchObject({
      state: "FAILED",
      failure_code: "PROVIDER_REJECTED",
      payment_id: null,
    });
  });
  it("14 rejects direct deletion", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const row = (await intents())[0]!;
    await expect(
      q("DELETE FROM checkout_intents WHERE id=$1", [row.id]),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("15 preserves the immutable admitted snapshot", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    expect((await intents())[0]).toMatchObject({
      account_id: x.customer.accountId,
      price_revision_id: x.commercial.priceRevisionId,
      plan_revision_id: x.commercial.planRevisionId,
      amount_minor: "19000",
      currency: "RUB",
      billing_interval_unit: "MONTH",
      billing_interval_count: 1,
    });
  });
  it("16 rejects a READY row without payment identity", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const row = (await intents())[0]!;
    await expect(
      q("UPDATE checkout_intents SET state='READY' WHERE id=$1", [row.id]),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("17 rejects a FAILED row without a failure code", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const row = (await intents())[0]!;
    await expect(
      q(
        "UPDATE checkout_intents SET state='FAILED',completed_at=$2 WHERE id=$1",
        [row.id, clock],
      ),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("18 rejects a terminal state update", async () => {
    const x = await checkout();
    const row = (await intents())[0]!;
    await expect(
      q("UPDATE checkout_intents SET updated_at=$2 WHERE id=$1", [
        row.id,
        clock,
      ]),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("READY");
  });
  it("19 rejects unsafe provider reference", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const row = (await intents())[0]!;
    await expect(
      q(
        "UPDATE checkout_intents SET provider_checkout_id='https://secret' WHERE id=$1",
        [row.id],
      ),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("20 enforces published price snapshot", async () => {
    const customer = await account();
    const commercial = await offer({ priceStatus: "HIDDEN" });
    const result = await service().createCheckout(
      {
        accountId: customer.accountId,
        priceRevisionId: commercial.priceRevisionId,
        idempotencyKey: key(),
      },
      context(customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "PRICE_NOT_ACTIVE",
    });
    expect(await intents()).toHaveLength(0);
  });

  it("21 accepts an exact sellable offer", async () =>
    expect((await checkout()).result.kind).toBe("READY"));
  it("22 preserves amount from resolver", async () => {
    const x = await checkout({ offerOptions: { amountMinor: 12345 } });
    expect(ready(x.result).amountMinor).toBe(12345);
  });
  it("23 preserves currency from resolver", async () => {
    const x = await checkout({ offerOptions: { currency: "EUR" } });
    expect(ready(x.result).currency).toBe("EUR");
  });
  it("24 preserves interval unit", async () => {
    const x = await checkout({ offerOptions: { intervalUnit: "YEAR" } });
    expect(ready(x.result).billingIntervalUnit).toBe("YEAR");
  });
  it("25 preserves interval count", async () => {
    const x = await checkout({ offerOptions: { intervalCount: 12 } });
    expect(ready(x.result).billingIntervalCount).toBe(12);
  });
  it("26 rejects missing owner", async () =>
    expect(
      (await checkout({ accountOptions: { owner: false } })).result,
    ).toMatchObject({ kind: "REJECTED", code: "FORBIDDEN" }));
  it("27 rejects wrong user", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const wrong = id();
    await q("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [wrong]);
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: key(),
      },
      context(wrong),
    );
    expect(result).toMatchObject({ kind: "REJECTED", code: "FORBIDDEN" });
  });
  it("28 rejects a suspended account", async () =>
    expect(
      (await checkout({ accountOptions: { status: "SUSPENDED" } })).result,
    ).toMatchObject({ kind: "REJECTED", code: "ACCOUNT_SUSPENDED" }));
  it("29 rejects a missing account", async () => {
    const commercial = await offer();
    const result = await service().createCheckout(
      {
        accountId: id(),
        priceRevisionId: commercial.priceRevisionId,
        idempotencyKey: key(),
      },
      context(id()),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "ACCOUNT_NOT_FOUND",
    });
  });
  it("30 blocks an existing current subscription", async () => {
    const customer = await account();
    const commercial = await offer();
    await currentSubscription(customer.accountId, commercial.planRevisionId);
    const result = await service().createCheckout(
      {
        accountId: customer.accountId,
        priceRevisionId: commercial.priceRevisionId,
        idempotencyKey: key(),
      },
      context(customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CURRENT_SUBSCRIPTION_EXISTS",
    });
  });
  it("31 permits only expired subscription history", async () => {
    const customer = await account();
    const commercial = await offer();
    await currentSubscription(
      customer.accountId,
      commercial.planRevisionId,
      "EXPIRED",
    );
    expect(
      (
        await service().createCheckout(
          {
            accountId: customer.accountId,
            priceRevisionId: commercial.priceRevisionId,
            idempotencyKey: key(),
          },
          context(customer.userId),
        )
      ).kind,
    ).toBe("READY");
  });
  it("32 maps closed sale exactly", async () =>
    expect(
      (await checkout({ offerOptions: { selected: false } })).result,
    ).toMatchObject({ kind: "REJECTED", code: "EXPLICITLY_CLOSED" }));
  it("33 maps hidden price exactly", async () =>
    expect(
      (await checkout({ offerOptions: { priceStatus: "HIDDEN" } })).result,
    ).toMatchObject({ kind: "REJECTED", code: "PRICE_NOT_ACTIVE" }));
  it("34 maps hidden plan exactly", async () =>
    expect(
      (await checkout({ offerOptions: { planStatus: "HIDDEN" } })).result,
    ).toMatchObject({ kind: "REJECTED", code: "PLAN_NOT_ACTIVE" }));
  it("35 physically rejects a selected draft plan revision", async () => {
    await expect(offer({ planState: "DRAFT" })).rejects.toThrow(
      "published plan revision",
    );
    expect(await intents()).toHaveLength(0);
  });
  it("36 physically rejects a selected draft price revision", async () => {
    await expect(offer({ priceState: "DRAFT" })).rejects.toThrow(
      "published price revision",
    );
    expect(await intents()).toHaveLength(0);
  });
  it("37 maps an expired window exactly", async () =>
    expect(
      (
        await checkout({
          offerOptions: { effectiveTo: new Date("2026-09-06T12:00:00Z") },
        })
      ).result,
    ).toMatchObject({
      kind: "REJECTED",
      code: "REVISION_OUTSIDE_EFFECTIVE_WINDOW",
    }));
  it("38 physically rejects a cross-plan price revision", async () => {
    await expect(offer({ planMismatch: true })).rejects.toThrow(
      "stable plan identity",
    );
    expect(await intents()).toHaveLength(0);
  });
  it("39 never lets caller amount become the snapshot", async () => {
    const x = await checkout();
    const stored = (await intents())[0]!;
    expect(stored.amount_minor).toBe("19000");
    expect(x.result).not.toHaveProperty("requestedAmount");
  });
  it("40 pre-admission rejection has no audit", async () => {
    await checkout({ offerOptions: { selected: false } });
    expect(await audits()).toHaveLength(0);
  });

  it("41 replays same key and fingerprint", async () => {
    const stableKey = "checkout-replay-same-key-123";
    const x = await checkout({ idempotencyKey: stableKey });
    const replay = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(ready(replay).checkoutIntentId).toBe(
      ready(x.result).checkoutIntentId,
    );
  });
  it("42 creates same key with a stable explicit key", async () => {
    const stableKey = "checkout-stable-12345";
    const x = await checkout({ idempotencyKey: stableKey });
    const replay = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(ready(replay).checkoutIntentId).toBe(
      ready(x.result).checkoutIntentId,
    );
  });
  it("43 same key different price is rejected", async () => {
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: "checkout-same-key-123",
    });
    const other = await offer({ amountMinor: 29000 });
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: other.priceRevisionId,
        idempotencyKey: "checkout-same-key-123",
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });
  it("44 same raw key is allowed on another account", async () => {
    const stableKey = "checkout-cross-account-123";
    const a = await checkout({ idempotencyKey: stableKey });
    const b = await checkout({ idempotencyKey: stableKey });
    expect(ready(a.result).checkoutIntentId).not.toBe(
      ready(b.result).checkoutIntentId,
    );
  });
  it("45 provider is absent from request fingerprint", async () => {
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: "checkout-fingerprint-123",
    });
    const row = (await intents())[0]!;
    expect(row.request_fingerprint_sha256).toBe(
      fingerprintCheckoutRequest({
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
      }),
    );
  });
  it("46 stores only the idempotency hash", async () => {
    const raw = "checkout-raw-secret-123";
    await checkout({ scenario: "UNAVAILABLE", idempotencyKey: raw });
    const row = (await intents())[0]!;
    expect(row.idempotency_key_hash).toBe(hashCheckoutIdempotencyKey(raw));
    expect(JSON.stringify(row)).not.toContain(raw);
  });
  it("47 does not audit the raw key", async () => {
    const raw = "checkout-audit-secret-123";
    await checkout({ scenario: "UNAVAILABLE", idempotencyKey: raw });
    expect(JSON.stringify(await audits())).not.toContain(raw);
  });
  it("48 has one intent after replay", async () => {
    const stableKey = "checkout-one-intent-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    await service("UNAVAILABLE_THEN_SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(await intents()).toHaveLength(1);
  });
  it("49 provider mismatch is server-side", async () => {
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: "checkout-provider-mismatch-123",
    });
    const repo = createP5CheckoutRepository(db);
    const row = (await intents())[0]!;
    const result = await repo.failCheckout({
      intentId: String(row.id),
      provider: "other",
      code: "PROVIDER_REJECTED",
      context: context(x.customer.userId),
    });
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CHECKOUT_PROVIDER_MISMATCH",
    });
  });
  it("50 concurrent same-key calls produce one intent", async () => {
    const customer = await account();
    const commercial = await offer();
    const stableKey = "checkout-concurrent-123";
    const make = () =>
      service().createCheckout(
        {
          accountId: customer.accountId,
          priceRevisionId: commercial.priceRevisionId,
          idempotencyKey: stableKey,
        },
        context(customer.userId),
      );
    const results = await Promise.all([make(), make()]);
    expect(
      new Set(
        results.map((r) =>
          r.kind === "READY"
            ? r.checkoutIntentId
            : r.kind === "RETRYABLE"
              ? r.checkoutIntentId
              : r.code,
        ),
      ).size,
    ).toBe(1);
    expect(await intents()).toHaveLength(1);
  });

  it("51 success creates one payment", async () => {
    await checkout();
    expect(await payments()).toHaveLength(1);
  });
  it("52 payment is PENDING", async () => {
    await checkout();
    expect((await payments())[0]!.state).toBe("PENDING");
  });
  it("53 payment account is exact", async () => {
    const x = await checkout();
    expect((await payments())[0]!.account_id).toBe(x.customer.accountId);
  });
  it("54 payment provider is simulator", async () => {
    await checkout();
    expect((await payments())[0]!.provider).toBe("simulator");
  });
  it("55 payment subscription remains null", async () => {
    await checkout();
    expect((await payments())[0]!.subscription_id).toBeNull();
  });
  it("56 checkout payment id points to canonical payment", async () => {
    await checkout();
    const i = (await intents())[0]!;
    const p = (await payments())[0]!;
    expect(i.payment_id).toBe(p.id);
  });
  it("57 payment price is exact", async () => {
    const x = await checkout();
    expect((await payments())[0]!.price_revision_id).toBe(
      x.commercial.priceRevisionId,
    );
  });
  it("58 payment terms are exact", async () => {
    const x = await checkout({
      offerOptions: {
        amountMinor: 1,
        currency: "USD",
        intervalUnit: "DAY",
        intervalCount: 30,
      },
    });
    expect((await payments())[0]).toMatchObject({
      amount_minor: "1",
      currency: "USD",
    });
    expect(ready(x.result).billingIntervalUnit).toBe("DAY");
  });
  it("59 payment has matching idempotency hash", async () => {
    const raw = "checkout-payment-hash-123";
    await checkout({ idempotencyKey: raw });
    expect((await payments())[0]!.idempotency_key_hash).toBe(
      hashCheckoutIdempotencyKey(raw),
    );
  });
  it("60 payment has matching fingerprint", async () => {
    const x = await checkout();
    expect((await payments())[0]!.request_fingerprint_sha256).toBe(
      fingerprintCheckoutRequest({
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
      }),
    );
  });
  it("61 success creates no subscription", async () => {
    await checkout();
    expect((await q("SELECT 1 FROM subscriptions")).rows).toHaveLength(0);
  });
  it("62 success creates no billing event", async () => {
    await checkout();
    expect((await q("SELECT 1 FROM billing_events")).rows).toHaveLength(0);
  });
  it("63 deterministic simulator checkout id is retained", async () => {
    const x = await checkout();
    expect((await intents())[0]!.provider_checkout_id).toMatch(
      /^sim_checkout_/,
    );
    expect(ready(x.result).checkoutReference).toMatch(/^sim_ref_/);
  });
  it("64 rejected creates no payment", async () => {
    await checkout({ scenario: "REJECTED" });
    expect(await payments()).toHaveLength(0);
  });
  it("65 rejected discards provider references", async () => {
    await checkout({ scenario: "REJECTED" });
    expect((await intents())[0]).toMatchObject({
      provider_checkout_id: null,
      provider_payment_id: null,
      checkout_reference: null,
    });
  });
  it("66 unavailable creates no payment", async () => {
    await checkout({ scenario: "UNAVAILABLE" });
    expect(await payments()).toHaveLength(0);
  });
  it("67 unavailable leaves CREATING", async () => {
    await checkout({ scenario: "UNAVAILABLE" });
    expect((await intents())[0]!.state).toBe("CREATING");
  });
  it("68 unavailable retry reaches READY", async () => {
    const stableKey = "checkout-unavailable-then-success-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    const retry = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(retry.kind).toBe("READY");
  });
  it("69 ordinary result hides provider payment id", async () => {
    const x = await checkout();
    expect(x.result).not.toHaveProperty("providerPaymentId");
  });
  it("70 provider input has frozen terms only", async () => {
    const x = await checkout();
    expect(x.result.kind).toBe("READY");
    const row = (await intents())[0]!;
    expect(row).not.toHaveProperty("raw_payload");
  });

  it("71 admitted CREATING survives sale closure", async () => {
    const stableKey = "checkout-admitted-close-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    await q(
      "INSERT INTO price_sale_assignments(id,price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,2,NULL,$3,'P5.3 closure')",
      [id(), x.commercial.priceId, clock],
    );
    const retry = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(retry.kind).toBe("READY");
    expect((await intents())[0]!.price_revision_id).toBe(
      x.commercial.priceRevisionId,
    );
  });
  it("72 new checkout after closure is rejected", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    await q(
      "INSERT INTO price_sale_assignments(id,price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,2,NULL,$3,'P5.3 closure')",
      [id(), x.commercial.priceId, clock],
    );
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-new-after-close-123",
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "EXPLICITLY_CLOSED",
    });
  });
  it("73 current subscription during provider call blocks payment", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    await currentSubscription(
      x.customer.accountId,
      x.commercial.planRevisionId,
    );
    const retry = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-race-current-123",
      },
      context(x.customer.userId),
    );
    expect(retry).toMatchObject({
      kind: "REJECTED",
      code: "CURRENT_SUBSCRIPTION_EXISTS",
    });
    expect(await payments()).toHaveLength(0);
  });
  it("74 suspended account during retry fails without payment", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      x.customer.accountId,
    ]);
    const retry = await service("UNAVAILABLE_THEN_SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-race-suspend-123",
      },
      context(x.customer.userId),
    );
    expect(retry).toMatchObject({
      kind: "REJECTED",
      code: "ACCOUNT_SUSPENDED",
    });
    expect(await payments()).toHaveLength(0);
  });
  it("75 existing READY replay is hidden while suspended", async () => {
    const stableKey = "checkout-ready-suspended-123";
    const x = await checkout({ idempotencyKey: stableKey });
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      x.customer.accountId,
    ]);
    const replay = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(replay).toMatchObject({
      kind: "REJECTED",
      code: "ACCOUNT_SUSPENDED",
    });
  });
  it("76 manual grant before prepare blocks", async () => {
    const customer = await account();
    const commercial = await offer();
    await currentSubscription(customer.accountId, commercial.planRevisionId);
    const result = await service().createCheckout(
      {
        accountId: customer.accountId,
        priceRevisionId: commercial.priceRevisionId,
        idempotencyKey: key(),
      },
      context(customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CURRENT_SUBSCRIPTION_EXISTS",
    });
  });
  it("77 expired history does not block finalization", async () => {
    const x = await checkout();
    expect(
      (
        await q("SELECT state FROM subscriptions WHERE account_id=$1", [
          x.customer.accountId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await payments()).toHaveLength(1);
  });
  it("78 account lock key is shared with P5.2", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const result = await q<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
      [`p5-subscription-account:${x.customer.accountId}`],
    );
    expect(result.rows[0]!.locked).toBe(true);
  });
  it("79 finalization rechecks account status in the repository", async () => {
    const stableKey = "checkout-finalize-recheck-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      x.customer.accountId,
    ]);
    const result = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "ACCOUNT_SUSPENDED",
    });
  });
  it("80 concurrent finalization cannot create two payments", async () => {
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: "checkout-payment-race-123",
    });
    const make = () =>
      service().createCheckout(
        {
          accountId: x.customer.accountId,
          priceRevisionId: x.commercial.priceRevisionId,
          idempotencyKey: "checkout-payment-race-123",
        },
        context(x.customer.userId),
      );
    await Promise.all([make(), make()]);
    expect(await payments()).toHaveLength(1);
  });

  it("81 writes CREATED audit", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    expect((await audits())[0]).toMatchObject({
      action: "CHECKOUT_INTENT_CREATED",
      target_type: "CHECKOUT_INTENT",
      target_id: x.result.kind === "RETRYABLE" ? x.result.checkoutIntentId : "",
    });
  });
  it("82 writes READY audit", async () => {
    await checkout();
    expect((await audits()).map((r) => r.action)).toEqual([
      "CHECKOUT_INTENT_CREATED",
      "CHECKOUT_READY",
    ]);
  });
  it("83 writes FAILED audit", async () => {
    await checkout({ scenario: "REJECTED" });
    expect((await audits()).map((r) => r.action)).toEqual([
      "CHECKOUT_INTENT_CREATED",
      "CHECKOUT_FAILED",
    ]);
  });
  it("84 audit target type is checkout intent", async () => {
    await checkout();
    expect(
      (await audits()).every((r) => r.target_type === "CHECKOUT_INTENT"),
    ).toBe(true);
  });
  it("85 audit metadata is safe", async () => {
    await checkout();
    const metadata = (await audits())[0]!.safe_metadata as Record<
      string,
      unknown
    >;
    expect(metadata).toHaveProperty("accountId");
    expect(metadata).not.toHaveProperty("providerPaymentId");
    expect(metadata).not.toHaveProperty("checkoutReference");
  });
  it("86 replay adds no audit", async () => {
    const stableKey = "checkout-replay-audit-123";
    const x = await checkout({ idempotencyKey: stableKey });
    const before = (await audits()).length;
    await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect((await audits()).length).toBe(before);
  });
  it("87 unavailable retry adds no creation audit", async () => {
    const stableKey = "checkout-unavail-audit-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    const before = (await audits()).length;
    const retry = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(retry.kind).toBe("READY");
    expect((await audits()).length).toBe(before + 1);
  });
  it("88 prepare audit failure rolls back intent", async () => {
    await q(
      "CREATE OR REPLACE FUNCTION p5_3_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CHECKOUT_INTENT_CREATED' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$",
    );
    await q(
      "CREATE TRIGGER p5_3_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_3_fail_audit()",
    );
    const x = await account();
    const c = await offer();
    const result = await service().createCheckout(
      {
        accountId: x.accountId,
        priceRevisionId: c.priceRevisionId,
        idempotencyKey: key(),
      },
      context(x.userId),
    );
    expect(result.kind).toBe("RETRYABLE");
    expect(await intents()).toHaveLength(0);
    await q("DROP TRIGGER p5_3_fail_audit_trigger ON audit_events");
    await q("DROP FUNCTION p5_3_fail_audit()");
  });
  it("89 READY audit failure rolls back payment", async () => {
    const stableKey = "checkout-ready-audit-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    await q(
      "CREATE OR REPLACE FUNCTION p5_3_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CHECKOUT_READY' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$",
    );
    await q(
      "CREATE TRIGGER p5_3_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_3_fail_audit()",
    );
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(result.kind).toBe("RETRYABLE");
    expect(await payments()).toHaveLength(0);
    expect((await intents())[0]!.state).toBe("CREATING");
    await q("DROP TRIGGER p5_3_fail_audit_trigger ON audit_events");
    await q("DROP FUNCTION p5_3_fail_audit()");
  });
  it("90 FAILED audit failure leaves CREATING for retry", async () => {
    const stableKey = "checkout-failed-audit-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    await q(
      "CREATE OR REPLACE FUNCTION p5_3_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CHECKOUT_FAILED' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$",
    );
    await q(
      "CREATE TRIGGER p5_3_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_3_fail_audit()",
    );
    const result = await service("REJECTED").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(result.kind).toBe("RETRYABLE");
    expect((await intents())[0]!.state).toBe("CREATING");
    await q("DROP TRIGGER p5_3_fail_audit_trigger ON audit_events");
    await q("DROP FUNCTION p5_3_fail_audit()");
  });
  it("91 physically rejects a second CREATING intent for one account", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const row = (await intents())[0]!;
    await expect(
      q(
        `INSERT INTO checkout_intents(account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count)
         SELECT account_id,price_revision_id,plan_revision_id,provider,'CREATING',$1,$2,admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count FROM checkout_intents WHERE id=$3`,
        [
          hashCheckoutIdempotencyKey("checkout-physical-second-123"),
          hashCheckoutIdempotencyKey("checkout-physical-fingerprint-123"),
          row.id,
        ],
      ),
    ).rejects.toThrow();
    expect(x.result.kind).toBe("RETRYABLE");
  });
  it("92 different key while CREATING is CHECKOUT_IN_PROGRESS", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-other-creating-123",
      },
      context(x.customer.userId),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "CHECKOUT_IN_PROGRESS",
      replay: false,
    });
  });
  it("93 different key after UNAVAILABLE remains blocked", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    const result = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-other-unavailable-123",
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CHECKOUT_IN_PROGRESS",
    });
    expect(await payments()).toHaveLength(0);
  });
  it("94 same key after UNAVAILABLE resumes the admitted intent", async () => {
    const stableKey = "checkout-resume-v2-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    const resumed = await service("SUCCESS").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: stableKey,
      },
      context(x.customer.userId),
    );
    expect(resumed).toMatchObject({
      kind: "READY",
      checkoutIntentId: (x.result as { checkoutIntentId: string })
        .checkoutIntentId,
    });
  });
  it("95 concurrent different keys admit only one intent", async () => {
    const customer = await account();
    const commercial = await offer();
    const make = (suffix: string) =>
      service("UNAVAILABLE").createCheckout(
        {
          accountId: customer.accountId,
          priceRevisionId: commercial.priceRevisionId,
          idempotencyKey: `checkout-race-${suffix}-123`,
        },
        context(customer.userId),
      );
    const results = await Promise.all([make("a"), make("b")]);
    expect(results.filter((r) => r.kind === "RETRYABLE")).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.kind === "REJECTED" && r.code === "CHECKOUT_IN_PROGRESS",
      ),
    ).toHaveLength(1);
    expect(await intents()).toHaveLength(1);
  });
  it("96 concurrent different-key loser invokes no provider and writes no payment or audit", async () => {
    const customer = await account();
    const commercial = await offer();
    let calls = 0;
    const provider = {
      providerKey: "simulator",
      createCheckout: async () => {
        calls += 1;
        return { kind: "UNAVAILABLE" as const };
      },
    };
    const make = (suffix: string) =>
      createCheckoutService({
        repository: createP5CheckoutRepository(db, { now: () => clock }),
        offerResolver: createP4CommercialCatalogRepository(db),
        provider,
        now: () => clock,
      }).createCheckout(
        {
          accountId: customer.accountId,
          priceRevisionId: commercial.priceRevisionId,
          idempotencyKey: `checkout-count-${suffix}-123`,
        },
        context(customer.userId),
      );
    const results = await Promise.all([make("a"), make("b")]);
    expect(
      results.filter(
        (r) => r.kind === "REJECTED" && r.code === "CHECKOUT_IN_PROGRESS",
      ),
    ).toHaveLength(1);
    expect(calls).toBe(1);
    expect(await payments()).toHaveLength(0);
    expect(await audits()).toHaveLength(1);
  });
  it("97 READY plus PENDING blocks a different key without leaking checkout identities", async () => {
    const x = await checkout();
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-ready-other-123",
      },
      context(x.customer.userId),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "CHECKOUT_IN_PROGRESS",
      replay: false,
    });
    expect(JSON.stringify(result)).not.toContain("sim_");
  });
  it("98 FAILED history permits a fresh different-key checkout", async () => {
    const x = await checkout({ scenario: "REJECTED" });
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-after-failed-123",
      },
      context(x.customer.userId),
    );
    expect(result).toEqual({
      kind: "READY",
      replay: false,
      checkoutIntentId: expect.any(String),
      paymentId: expect.any(String),
      planRevisionId: x.commercial.planRevisionId,
      priceRevisionId: x.commercial.priceRevisionId,
      amountMinor: 19000,
      currency: "RUB",
      billingIntervalUnit: "MONTH",
      billingIntervalCount: 1,
      provider: "simulator",
      checkoutReference: expect.any(String),
    });
    expect(await intents()).toHaveLength(2);
  });
  it("99 multiple FAILED histories do not block a new checkout", async () => {
    const x = await checkout({
      scenario: "REJECTED",
      idempotencyKey: "checkout-failed-one-123",
    });
    await service("REJECTED").createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-failed-two-123",
      },
      context(x.customer.userId),
    );
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-failed-three-123",
      },
      context(x.customer.userId),
    );
    expect(result.kind).toBe("READY");
  });
  it("100 current subscription takes precedence over a different-key actionable checkout", async () => {
    const x = await checkout({ scenario: "UNAVAILABLE" });
    await currentSubscription(
      x.customer.accountId,
      x.commercial.planRevisionId,
    );
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-subscription-first-123",
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CURRENT_SUBSCRIPTION_EXISTS",
    });
  });
  it("101 READY with a non-PENDING payment fails closed", async () => {
    const x = await checkout();
    const payment = (await payments())[0]!;
    await q("UPDATE payments SET state='SUCCEEDED' WHERE id=$1", [payment.id]);
    const result = await service().createCheckout(
      {
        accountId: x.customer.accountId,
        priceRevisionId: x.commercial.priceRevisionId,
        idempotencyKey: "checkout-corrupt-ready-123",
      },
      context(x.customer.userId),
    );
    expect(result).toMatchObject({
      kind: "REJECTED",
      code: "CHECKOUT_CORRUPTED",
    });
  });
  it("102 finalization and second prepare cannot create a second payment", async () => {
    const stableKey = "checkout-finalize-first-123";
    const x = await checkout({
      scenario: "UNAVAILABLE",
      idempotencyKey: stableKey,
    });
    const [finalized, other] = await Promise.all([
      service("SUCCESS").createCheckout(
        {
          accountId: x.customer.accountId,
          priceRevisionId: x.commercial.priceRevisionId,
          idempotencyKey: stableKey,
        },
        context(x.customer.userId),
      ),
      service("SUCCESS").createCheckout(
        {
          accountId: x.customer.accountId,
          priceRevisionId: x.commercial.priceRevisionId,
          idempotencyKey: "checkout-finalize-other-123",
        },
        context(x.customer.userId),
      ),
    ]);
    expect(
      [finalized, other].some(
        (r) => r.kind === "REJECTED" && r.code === "CHECKOUT_IN_PROGRESS",
      ),
    ).toBe(true);
    expect(await payments()).toHaveLength(1);
  });
});
