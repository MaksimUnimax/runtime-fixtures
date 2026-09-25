import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createDatabaseRuntime,
  createP5SubscriptionAccessResolver,
  createP5SubscriptionRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import {
  SubscriptionPlanRevisionBindingAdapter,
  type SubscriptionCommandResult,
  type SubscriptionMutationContext,
  type SubscriptionState,
} from "../../../packages/server/subscriptions/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");

let db: DatabaseRuntime;
let clock = new Date("2026-09-06T12:00:00.000Z");
const repository = () =>
  createP5SubscriptionRepository(db, { now: () => clock });
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const date = (value: string) => new Date(value);
const future = date("2026-10-01T00:00:00.000Z");
const later = date("2026-11-01T00:00:00.000Z");
const code = (prefix: string) =>
  `${prefix}-${randomUUID().replaceAll("-", "")}`;
const context = (
  reason = "P5.2 integration command",
): SubscriptionMutationContext => ({
  actorType: "SYSTEM",
  correlationId: randomUUID(),
  reason,
});

function value<T>(result: SubscriptionCommandResult): T {
  if (result.kind !== "OK")
    throw new Error(`expected OK, received ${result.code}`);
  return result.value as T;
}

async function clean() {
  await q(
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_sale_assignments,account_entitlement_overrides,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,audit_events",
  );
  clock = date("2026-09-06T12:00:00.000Z");
}

async function account(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const id = randomUUID();
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [id, status]);
  return id;
}

async function planRevision(state: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  const planId = randomUUID();
  const revisionId = randomUUID();
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    code("p52"),
  ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,published_at) VALUES($1,$2,1,$3,'P5.2 test plan','P5.2 integration plan',$4)",
    [
      revisionId,
      planId,
      state,
      state === "PUBLISHED" ? date("2026-09-01T00:00:00.000Z") : null,
    ],
  );
  return revisionId;
}

async function grantFixture(
  options: {
    accountStatus?: "ACTIVE" | "SUSPENDED";
    planState?: "PUBLISHED" | "DRAFT";
    end?: Date;
  } = {},
) {
  const accountId = await account(options.accountStatus);
  const planRevisionId = await planRevision(options.planState);
  const result = await repository().grantSubscription(
    { accountId, planRevisionId, currentPeriodEnd: options.end ?? future },
    context("grant fixture"),
  );
  return {
    accountId,
    planRevisionId,
    subscription: value<{ id: string }>(result),
  };
}

async function subscriptionRow(id: string) {
  return (
    await q<Record<string, unknown>>(
      "SELECT * FROM subscriptions WHERE id=$1",
      [id],
    )
  ).rows[0];
}

async function transitionRows(id: string) {
  return (
    await q<Record<string, unknown>>(
      "SELECT transition_revision,from_state,to_state FROM subscription_transitions WHERE subscription_id=$1 ORDER BY transition_revision",
      [id],
    )
  ).rows;
}

async function auditRows(id: string) {
  return (
    await q<Record<string, unknown>>(
      "SELECT action,reason,safe_metadata FROM audit_events WHERE target_type='SUBSCRIPTION' AND target_id=$1 ORDER BY created_at",
      [id],
    )
  ).rows;
}

async function seedState(
  id: string,
  state:
    | Exclude<SubscriptionState, "ACTIVE" | "EXPIRED" | "SUSPENDED">
    | "CANCELED",
) {
  await q(
    "UPDATE subscriptions SET state=$1,state_revision=2,grace_until=$2,cancel_at_period_end=$3 WHERE id=$4",
    [
      state,
      state === "GRACE" ? date("2026-10-15T00:00:00.000Z") : null,
      state === "CANCELED",
      id,
    ],
  );
  await q(
    "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,actor_type,reason,occurred_at) VALUES($1,2,'ACTIVE',$2,'SYSTEM','SYSTEM','seed state',$3)",
    [id, state, clock],
  );
}

async function failAudit(action: string) {
  await q(
    "CREATE OR REPLACE FUNCTION p5_2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = $fn$" +
      action +
      "$fn$ THEN RAISE EXCEPTION 'injected P5.2 audit failure'; END IF; RETURN NEW; END $$",
  );
  await q(
    "CREATE TRIGGER p5_2_fail_audit_trigger BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p5_2_fail_audit()",
  );
}

async function clearFailAudit() {
  await q("DROP TRIGGER IF EXISTS p5_2_fail_audit_trigger ON audit_events");
  await q("DROP FUNCTION IF EXISTS p5_2_fail_audit()");
}

describe.sequential("P5.2 subscription lifecycle on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(clean);
  afterEach(clearFailAudit);
  afterAll(() => db.close());

  it("01 grants a manual ACTIVE subscription", async () => {
    const fixture = await grantFixture();
    expect((await subscriptionRow(fixture.subscription.id))?.state).toBe(
      "ACTIVE",
    );
  });
  it("02 leaves manual bound price null", async () => {
    const fixture = await grantFixture();
    expect(
      (await subscriptionRow(fixture.subscription.id))?.bound_price_revision_id,
    ).toBeNull();
  });
  it("03 writes the exact initial transition", async () => {
    const fixture = await grantFixture();
    expect(await transitionRows(fixture.subscription.id)).toMatchObject([
      { transition_revision: 1, from_state: null, to_state: "ACTIVE" },
    ]);
  });
  it("04 writes the exact grant audit", async () => {
    const fixture = await grantFixture();
    expect(await auditRows(fixture.subscription.id)).toMatchObject([
      { action: "SUBSCRIPTION_GRANTED", reason: "grant fixture" },
    ]);
  });
  it("05 keeps grant metadata safe", async () => {
    const fixture = await grantFixture();
    const metadata = (await auditRows(fixture.subscription.id))[0]
      ?.safe_metadata as Record<string, unknown>;
    expect(metadata).toMatchObject({
      accountId: fixture.accountId,
      planRevisionId: fixture.planRevisionId,
      boundPriceRevisionId: null,
      toState: "ACTIVE",
    });
    expect(metadata).not.toHaveProperty("reason");
  });
  it("06 grants to an active account", async () => {
    const fixture = await grantFixture({ accountStatus: "ACTIVE" });
    expect(fixture.subscription.id).toBeTruthy();
  });
  it("07 stores a grant to a suspended account", async () => {
    const fixture = await grantFixture({ accountStatus: "SUSPENDED" });
    expect((await subscriptionRow(fixture.subscription.id))?.account_id).toBe(
      fixture.accountId,
    );
  });
  it("08 rejects a missing account", async () => {
    const result = await repository().grantSubscription(
      {
        accountId: randomUUID(),
        planRevisionId: await planRevision(),
        currentPeriodEnd: future,
      },
      context(),
    );
    expect(result).toEqual({ kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" });
  });
  it("09 rejects a missing plan revision", async () => {
    const result = await repository().grantSubscription(
      {
        accountId: await account(),
        planRevisionId: randomUUID(),
        currentPeriodEnd: future,
      },
      context(),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_FOUND",
    });
  });
  it("10 rejects a draft plan revision", async () => {
    const result = await repository().grantSubscription(
      {
        accountId: await account(),
        planRevisionId: await planRevision("DRAFT"),
        currentPeriodEnd: future,
      },
      context(),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "PLAN_REVISION_NOT_PUBLISHED",
    });
  });
  it("11 rejects period end equal to captured now", async () => {
    const result = await repository().grantSubscription(
      {
        accountId: await account(),
        planRevisionId: await planRevision(),
        currentPeriodEnd: clock,
      },
      context(),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "SUBSCRIPTION_PERIOD_INVALID",
    });
  });
  it("12 rejects period end before captured now", async () => {
    const result = await repository().grantSubscription(
      {
        accountId: await account(),
        planRevisionId: await planRevision(),
        currentPeriodEnd: date("2026-09-01"),
      },
      context(),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "SUBSCRIPTION_PERIOD_INVALID",
    });
  });
  it("13 rejects a second current subscription", async () => {
    const fixture = await grantFixture();
    const result = await repository().grantSubscription(
      {
        accountId: fixture.accountId,
        planRevisionId: await planRevision(),
        currentPeriodEnd: future,
      },
      context(),
    );
    expect(result).toEqual({
      kind: "REJECTED",
      code: "SUBSCRIPTION_ALREADY_EXISTS",
    });
  });
  it("14 permits a new grant after expired history", async () => {
    const fixture = await grantFixture();
    await q("UPDATE subscriptions SET state='EXPIRED' WHERE id=$1", [
      fixture.subscription.id,
    ]);
    const result = await repository().grantSubscription(
      {
        accountId: fixture.accountId,
        planRevisionId: await planRevision(),
        currentPeriodEnd: future,
      },
      context(),
    );
    expect(result.kind).toBe("OK");
  });
  it("15 serializes concurrent grants per account", async () => {
    const accountId = await account();
    const a = await planRevision();
    const b = await planRevision();
    const results = await Promise.all([
      repository().grantSubscription(
        { accountId, planRevisionId: a, currentPeriodEnd: future },
        context(),
      ),
      repository().grantSubscription(
        { accountId, planRevisionId: b, currentPeriodEnd: future },
        context(),
      ),
    ]);
    expect(results.filter((result) => result.kind === "OK")).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.kind === "REJECTED" &&
          result.code === "SUBSCRIPTION_ALREADY_EXISTS",
      ),
    ).toHaveLength(1);
  });
  it("16 rolls back grant and transition on audit failure", async () => {
    const accountId = await account();
    const planRevisionId = await planRevision();
    await failAudit("SUBSCRIPTION_GRANTED");
    await expect(
      repository().grantSubscription(
        { accountId, planRevisionId, currentPeriodEnd: future },
        context(),
      ),
    ).rejects.toThrow("injected P5.2");
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM subscriptions",
        )
      ).rows[0]?.count,
    ).toBe("0");
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM subscription_transitions",
        )
      ).rows[0]?.count,
    ).toBe("0");
  });

  it("17 extends an ACTIVE period forward", async () => {
    const fixture = await grantFixture();
    const result = await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context("extend"),
    );
    expect(result).toMatchObject({
      kind: "OK",
      changed: true,
      value: { stateRevision: 2, currentPeriodEnd: later },
    });
  });
  it("18 preserves state on extension", async () => {
    const fixture = await grantFixture();
    const result = value<{ state: string }>(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: later,
        },
        context(),
      ),
    );
    expect(result.state).toBe("ACTIVE");
  });
  it("19 does not add a transition for extension", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    expect(await transitionRows(fixture.subscription.id)).toHaveLength(1);
  });
  it("20 audits extension with bounded metadata", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context("extension reason"),
    );
    const audit = (await auditRows(fixture.subscription.id))[1]!;
    expect(audit).toMatchObject({
      action: "SUBSCRIPTION_EXTENDED",
      reason: "extension reason",
    });
    expect(audit.safe_metadata).toMatchObject({
      oldStateRevision: 1,
      newStateRevision: 2,
    });
  });
  it("21 rejects a stale extension", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: date("2027-01-01"),
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_STATE_STALE" });
  });
  it("22 checks stale before invalid extension semantics", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: clock,
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_STATE_STALE" });
  });
  it("23 rejects equal extension end", async () => {
    const fixture = await grantFixture();
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: future,
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_NOT_EXTENDED" });
  });
  it("24 rejects earlier extension end", async () => {
    const fixture = await grantFixture();
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: date("2026-09-07"),
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_NOT_EXTENDED" });
  });
  it("25 rejects extension of EXPIRED", async () => {
    const fixture = await grantFixture();
    await q("UPDATE subscriptions SET state='EXPIRED' WHERE id=$1", [
      fixture.subscription.id,
    ]);
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: later,
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_ENDED" });
  });
  it("26 rejects an extension crossing graceUntil", async () => {
    const fixture = await grantFixture();
    await q(
      "UPDATE subscriptions SET state='GRACE',grace_until=$1,state_revision=2 WHERE id=$2",
      [date("2026-10-15"), fixture.subscription.id],
    );
    expect(
      await repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 2,
          newCurrentPeriodEnd: date("2026-10-20"),
        },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_GRACE_WINDOW_CONFLICT" });
  });
  it("27 extends SUSPENDED without changing state", async () => {
    const fixture = await grantFixture();
    const suspended = value<{ id: string }>(
      await repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    );
    const result = value<{ state: string; stateRevision: number }>(
      await repository().extendSubscription(
        {
          subscriptionId: suspended.id,
          expectedStateRevision: 2,
          newCurrentPeriodEnd: later,
        },
        context(),
      ),
    );
    expect(result).toMatchObject({ state: "SUSPENDED", stateRevision: 3 });
  });
  it("28 preserves plan price and reason on extension", async () => {
    const fixture = await grantFixture();
    const before = await subscriptionRow(fixture.subscription.id);
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    const after = await subscriptionRow(fixture.subscription.id);
    expect(after).toMatchObject({
      current_plan_revision_id: before?.current_plan_revision_id,
      bound_price_revision_id: null,
      state_reason: before?.state_reason,
      canceled_at: null,
      suspended_at: null,
      cancel_at_period_end: false,
    });
  });
  it("29 rolls back extension on audit failure", async () => {
    const fixture = await grantFixture();
    await failAudit("SUBSCRIPTION_EXTENDED");
    await expect(
      repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: later,
        },
        context(),
      ),
    ).rejects.toThrow("injected P5.2");
    expect(await subscriptionRow(fixture.subscription.id)).toMatchObject({
      state_revision: 1,
      current_period_end: future,
    });
  });

  for (const [index, state] of (
    ["TRIAL", "ACTIVE", "GRACE", "PAST_DUE", "CANCELED"] as const
  ).entries()) {
    it(`30-${index} suspends from ${state}`, async () => {
      const fixture = await grantFixture();
      if (state === "ACTIVE") {
        // grant already starts in ACTIVE
      } else await seedState(fixture.subscription.id, state);
      const expected = state === "ACTIVE" ? 1 : 2;
      const result = await repository().suspendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: expected,
        },
        context("suspend origin"),
      );
      expect(result).toMatchObject({
        kind: "OK",
        changed: true,
        value: { state: "SUSPENDED", stateRevision: expected + 1 },
      });
    });
  }
  it("36 rejects suspend from EXPIRED", async () => {
    const fixture = await grantFixture();
    await q("UPDATE subscriptions SET state='EXPIRED' WHERE id=$1", [
      fixture.subscription.id,
    ]);
    expect(
      await repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ).toEqual({
      kind: "REJECTED",
      code: "SUBSCRIPTION_STATE_TRANSITION_INVALID",
    });
  });
  it("37 makes current-version suspend idempotent", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    expect(
      await repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
    ).toMatchObject({ kind: "OK", changed: false });
  });
  it("38 creates no audit or transition for suspend no-op", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    expect(await transitionRows(fixture.subscription.id)).toHaveLength(2);
    expect(await auditRows(fixture.subscription.id)).toHaveLength(2);
  });
  it("39 checks stale before suspended no-op", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    expect(
      await repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_STATE_STALE" });
  });
  it("40 records suspension timestamp and reason", async () => {
    const fixture = await grantFixture();
    const result = value<{ suspendedAt: Date }>(
      await repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context("manual suspension"),
      ),
    );
    expect(result.suspendedAt).toEqual(clock);
    expect((await subscriptionRow(fixture.subscription.id))?.state_reason).toBe(
      "manual suspension",
    );
  });
  it("41 allocates transition revision independently", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    expect(await transitionRows(fixture.subscription.id)).toEqual([
      { transition_revision: 1, from_state: null, to_state: "ACTIVE" },
      { transition_revision: 2, from_state: "ACTIVE", to_state: "SUSPENDED" },
    ]);
  });
  it("42 serializes concurrent suspend calls", async () => {
    const fixture = await grantFixture();
    const results = await Promise.all([
      repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
      repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ]);
    expect(
      results.filter((result) => result.kind === "OK" && result.changed),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.kind === "REJECTED" &&
          result.code === "SUBSCRIPTION_STATE_STALE",
      ),
    ).toHaveLength(1);
  });
  it("43 rolls back suspension on audit failure", async () => {
    const fixture = await grantFixture();
    await failAudit("SUBSCRIPTION_SUSPENDED");
    await expect(
      repository().suspendSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ).rejects.toThrow("injected P5.2");
    expect(await subscriptionRow(fixture.subscription.id)).toMatchObject({
      state: "ACTIVE",
      state_revision: 1,
      suspended_at: null,
    });
    expect(await transitionRows(fixture.subscription.id)).toHaveLength(1);
  });

  for (const [index, state] of (
    ["ACTIVE", "TRIAL", "GRACE", "PAST_DUE", "CANCELED"] as const
  ).entries()) {
    it(`44-${index} restores exact ${state} origin`, async () => {
      const fixture = await grantFixture();
      if (state !== "ACTIVE") await seedState(fixture.subscription.id, state);
      const expected = state === "ACTIVE" ? 1 : 2;
      await repository().suspendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: expected,
        },
        context(),
      );
      const result = await repository().restoreSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: expected + 1,
        },
        context("restore origin"),
      );
      expect(result).toMatchObject({
        kind: "OK",
        value: { state, stateRevision: expected + 2, suspendedAt: null },
      });
    });
  }
  it("50 does not accept a caller-supplied restore target", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    const result = await repository().restoreSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 2,
      } as never,
      context(),
    );
    expect(result).toMatchObject({ kind: "OK", value: { state: "ACTIVE" } });
  });
  it("51 uses the latest real suspension transition as authority", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    await repository().restoreSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
      context(),
    );
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 4 },
        context(),
      ),
    ).toMatchObject({ kind: "OK", value: { state: "ACTIVE" } });
  });
  it("52 extends while suspended and then restores", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 2,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
        context(),
      ),
    ).toMatchObject({
      kind: "OK",
      value: { state: "ACTIVE", currentPeriodEnd: later },
    });
  });
  it("53 rejects ACTIVE restore at exact period end", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    clock = future;
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_ENDED" });
  });
  it("54 rejects TRIAL restore after period end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "TRIAL");
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    clock = later;
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_ENDED" });
  });
  it("55 rejects GRACE restore at exact grace end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "GRACE");
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    clock = date("2026-10-15");
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_GRACE_ENDED" });
  });
  it("56 permits PAST_DUE restore after period end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "PAST_DUE");
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    clock = later;
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
        context(),
      ),
    ).toMatchObject({ kind: "OK", value: { state: "PAST_DUE" } });
  });
  it("57 rejects CANCELED restore at period end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "CANCELED");
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    clock = future;
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_PERIOD_ENDED" });
  });
  it("58 rejects restore when not suspended", async () => {
    const fixture = await grantFixture();
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_NOT_SUSPENDED" });
  });
  it("59 fails closed without a suspension transition", async () => {
    const fixture = await grantFixture();
    await q(
      "UPDATE subscriptions SET state='SUSPENDED',state_revision=2 WHERE id=$1",
      [fixture.subscription.id],
    );
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
    ).toEqual({
      kind: "REJECTED",
      code: "SUBSCRIPTION_RESTORE_ORIGIN_NOT_FOUND",
    });
  });
  it("60 rejects stale restore", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    expect(
      await repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
        context(),
      ),
    ).toEqual({ kind: "REJECTED", code: "SUBSCRIPTION_STATE_STALE" });
  });
  it("61 serializes concurrent restore calls", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    const results = await Promise.all([
      repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
      repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
    ]);
    expect(
      results.filter((result) => result.kind === "OK" && result.changed),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.kind === "REJECTED" &&
          result.code === "SUBSCRIPTION_STATE_STALE",
      ),
    ).toHaveLength(1);
  });
  it("62 rolls back restore on audit failure", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    await failAudit("SUBSCRIPTION_RESTORED");
    await expect(
      repository().restoreSubscription(
        { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
        context(),
      ),
    ).rejects.toThrow("injected P5.2");
    expect(await subscriptionRow(fixture.subscription.id)).toMatchObject({
      state: "SUSPENDED",
      state_revision: 2,
    });
  });

  it("63 reads no current subscription for a missing account", async () => {
    expect(await repository().getCurrentSubscription(randomUUID())).toBeNull();
  });
  it("64 reads a safe current snapshot", async () => {
    const fixture = await grantFixture();
    const current = await repository().getCurrentSubscription(
      fixture.accountId,
    );
    expect(current).toMatchObject({
      id: fixture.subscription.id,
      state: "ACTIVE",
      boundPriceRevisionId: null,
    });
    expect(current).not.toHaveProperty("stateReason");
  });
  it("65 excludes expired history from current reader", async () => {
    const fixture = await grantFixture();
    await q("UPDATE subscriptions SET state='EXPIRED' WHERE id=$1", [
      fixture.subscription.id,
    ]);
    expect(
      await repository().getCurrentSubscription(fixture.accountId),
    ).toBeNull();
  });
  it("66 returns ACCOUNT_NOT_FOUND from access resolver", async () => {
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        randomUUID(),
        clock,
      ),
    ).toEqual({ kind: "ACCOUNT_NOT_FOUND" });
  });
  it("67 denies suspended account without mutating subscription", async () => {
    const fixture = await grantFixture({ accountStatus: "SUSPENDED" });
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "ACCOUNT_SUSPENDED" });
    expect((await subscriptionRow(fixture.subscription.id))?.state).toBe(
      "ACTIVE",
    );
  });
  it("68 allows TRIAL before period end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "TRIAL");
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toMatchObject({ kind: "ELIGIBLE", state: "TRIAL" });
  });
  it("69 denies TRIAL at exact period end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "TRIAL");
    clock = future;
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "PERIOD_ENDED" });
  });
  it("70 allows ACTIVE before period end", async () => {
    const fixture = await grantFixture();
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toMatchObject({
      kind: "ELIGIBLE",
      planRevisionId: fixture.planRevisionId,
    });
  });
  it("71 denies ACTIVE at exact period end", async () => {
    const fixture = await grantFixture();
    clock = future;
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "PERIOD_ENDED" });
  });
  it("72 allows GRACE before graceUntil", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "GRACE");
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toMatchObject({ kind: "ELIGIBLE", state: "GRACE" });
  });
  it("73 denies GRACE at exact graceUntil", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "GRACE");
    clock = date("2026-10-15");
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "GRACE_ENDED" });
  });
  it("74 fails closed for malformed GRACE", async () => {
    const fixture = await grantFixture();
    await q(
      "UPDATE subscriptions SET state='GRACE',state_revision=2 WHERE id=$1",
      [fixture.subscription.id],
    );
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "SUBSCRIPTION_CORRUPTED" });
  });
  it("75 denies PAST_DUE", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "PAST_DUE");
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "PAST_DUE" });
  });
  it("76 allows remaining CANCELED access", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "CANCELED");
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toMatchObject({ kind: "ELIGIBLE", state: "CANCELED" });
  });
  it("77 denies CANCELED without cancel-at-period-end", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "CANCELED");
    await q("UPDATE subscriptions SET cancel_at_period_end=false WHERE id=$1", [
      fixture.subscription.id,
    ]);
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "CANCELED" });
  });
  it("78 denies SUSPENDED and EXPIRED", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "SUBSCRIPTION_SUSPENDED" });
    await q("UPDATE subscriptions SET state='EXPIRED' WHERE id=$1", [
      fixture.subscription.id,
    ]);
    expect(
      await createP5SubscriptionAccessResolver(repository()).resolve(
        fixture.accountId,
        clock,
      ),
    ).toEqual({ kind: "INELIGIBLE", reason: "SUBSCRIPTION_EXPIRED" });
  });
  it("79 returns exact plan and price fields when eligible", async () => {
    const fixture = await grantFixture();
    const result = await createP5SubscriptionAccessResolver(
      repository(),
    ).resolve(fixture.accountId, clock);
    expect(result).toMatchObject({
      kind: "ELIGIBLE",
      planRevisionId: fixture.planRevisionId,
      boundPriceRevisionId: null,
      currentPeriodEnd: future,
      graceUntil: null,
    });
  });

  it("80 binds eligible ACTIVE to the exact plan revision", async () => {
    const fixture = await grantFixture();
    const binding = new SubscriptionPlanRevisionBindingAdapter(
      createP5SubscriptionAccessResolver(repository()),
      () => clock,
    );
    await expect(binding.resolve(fixture.accountId)).resolves.toEqual({
      planRevisionId: fixture.planRevisionId,
      source: "ELIGIBLE_SUBSCRIPTION",
    });
  });
  it("81 binds eligible GRACE to the exact plan revision", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "GRACE");
    const binding = new SubscriptionPlanRevisionBindingAdapter(
      createP5SubscriptionAccessResolver(repository()),
      () => clock,
    );
    await expect(binding.resolve(fixture.accountId)).resolves.toEqual({
      planRevisionId: fixture.planRevisionId,
      source: "ELIGIBLE_SUBSCRIPTION",
    });
  });
  it("82 binds remaining CANCELED access", async () => {
    const fixture = await grantFixture();
    await seedState(fixture.subscription.id, "CANCELED");
    const binding = new SubscriptionPlanRevisionBindingAdapter(
      createP5SubscriptionAccessResolver(repository()),
      () => clock,
    );
    await expect(binding.resolve(fixture.accountId)).resolves.toMatchObject({
      planRevisionId: fixture.planRevisionId,
      source: "ELIGIBLE_SUBSCRIPTION",
    });
  });
  it.each([
    ["SUSPENDED account", "account"],
    ["PAST_DUE subscription", "past_due"],
    ["SUSPENDED subscription", "suspended"],
    ["no subscription", "none"],
  ])("83-%s binding returns null", async (_label, kind) => {
    const fixture =
      kind === "account"
        ? await grantFixture({ accountStatus: "SUSPENDED" })
        : kind === "none"
          ? {
              accountId: await account(),
              planRevisionId: await planRevision(),
              subscription: { id: "" },
            }
          : await grantFixture();
    if (kind === "past_due" || kind === "suspended")
      await (kind === "past_due"
        ? seedState(fixture.subscription.id, "PAST_DUE")
        : repository().suspendSubscription(
            {
              subscriptionId: fixture.subscription.id,
              expectedStateRevision: 1,
            },
            context(),
          ));
    const binding = new SubscriptionPlanRevisionBindingAdapter(
      createP5SubscriptionAccessResolver(repository()),
      () => clock,
    );
    await expect(binding.resolve(fixture.accountId)).resolves.toBeNull();
  });
  it("84 returns null for stale ended ACTIVE binding", async () => {
    const fixture = await grantFixture();
    clock = future;
    const binding = new SubscriptionPlanRevisionBindingAdapter(
      createP5SubscriptionAccessResolver(repository()),
      () => clock,
    );
    await expect(binding.resolve(fixture.accountId)).resolves.toBeNull();
  });
  it("85 performs no audit on reads", async () => {
    const fixture = await grantFixture();
    const before = await auditRows(fixture.subscription.id);
    await repository().getCurrentSubscription(fixture.accountId);
    await createP5SubscriptionAccessResolver(repository()).resolve(
      fixture.accountId,
      clock,
    );
    expect(await auditRows(fixture.subscription.id)).toHaveLength(
      before.length,
    );
  });

  it("86 counts grant extend suspend revisions distinctly", async () => {
    const fixture = await grantFixture();
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: later,
      },
      context(),
    );
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    expect(await subscriptionRow(fixture.subscription.id)).toMatchObject({
      state_revision: 3,
    });
    expect(await transitionRows(fixture.subscription.id)).toHaveLength(2);
  });
  it("87 allocates monotonic transition revision after restore and suspend", async () => {
    const fixture = await grantFixture();
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 1 },
      context(),
    );
    await repository().restoreSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 2 },
      context(),
    );
    await repository().suspendSubscription(
      { subscriptionId: fixture.subscription.id, expectedStateRevision: 3 },
      context(),
    );
    expect(await transitionRows(fixture.subscription.id)).toMatchObject([
      { transition_revision: 1 },
      { transition_revision: 2 },
      { transition_revision: 3 },
      { transition_revision: 4 },
    ]);
  });
  it("88 rejected mutation creates no audit", async () => {
    const fixture = await grantFixture();
    const before = (await auditRows(fixture.subscription.id)).length;
    await repository().extendSubscription(
      {
        subscriptionId: fixture.subscription.id,
        expectedStateRevision: 1,
        newCurrentPeriodEnd: future,
      },
      context(),
    );
    expect((await auditRows(fixture.subscription.id)).length).toBe(before);
  });
  it("89 concurrent extensions have one winner and no lost update", async () => {
    const fixture = await grantFixture();
    const results = await Promise.all([
      repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: later,
        },
        context(),
      ),
      repository().extendSubscription(
        {
          subscriptionId: fixture.subscription.id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: date("2026-12-01"),
        },
        context(),
      ),
    ]);
    expect(results.filter((result) => result.kind === "OK")).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.kind === "REJECTED" &&
          result.code === "SUBSCRIPTION_STATE_STALE",
      ),
    ).toHaveLength(1);
    expect(
      (await subscriptionRow(fixture.subscription.id))?.state_revision,
    ).toBe(2);
  });
});
