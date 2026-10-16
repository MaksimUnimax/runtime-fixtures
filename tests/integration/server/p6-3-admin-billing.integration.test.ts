import { resetTransferProtectedTestFixture } from "./helpers/credential-transfer-fixture-reset.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabaseRuntime,
  createP6AdminBillingRepository,
  createP6AdminSubscriptionCommandAdapter,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import type { AdminRole } from "../../../packages/server/admin-auth/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P6.3 integration tests");

let db: DatabaseRuntime;
const now = new Date("2026-09-08T12:00:00.000Z");
const actorId = "00000000-0000-4000-8000-000000000001";
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const future = new Date("2027-01-01T00:00:00.000Z");
const later = new Date("2027-02-01T00:00:00.000Z");
const createdAt = new Date("2020-01-01T00:00:00.000Z");

async function clean() {
  await resetTransferProtectedTestFixture(
    db,
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_revisions,prices,plan_revisions,plans,admin_role_grants,admin_principals,audit_events,account_memberships,accounts,user_identities,users CASCADE",
  );
}
async function fixture(role: AdminRole = "ADMIN_OWNER", principalId = actorId) {
  const accountId = randomUUID();
  const userId = randomUUID();
  await q(
    "INSERT INTO users(id,status,created_at,updated_at) VALUES($1,'ACTIVE',$2,$2)",
    [userId, createdAt],
  );
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at,created_at,updated_at) VALUES($1,'EMAIL',$2,$3,$3,$3)",
    [userId, `${userId}@example.test`, createdAt],
  );
  await q(
    "INSERT INTO accounts(id,status,created_at,updated_at) VALUES($1,'ACTIVE',$2,$2)",
    [accountId, createdAt],
  );
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role,created_at) VALUES($1,$2,'OWNER',$3)",
    [accountId, userId, createdAt],
  );
  await q(
    "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
    [principalId, userId, createdAt],
  );
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_at) VALUES($1,$2,$3)",
    [principalId, role, createdAt],
  );
  const planId = randomUUID();
  const planRevisionId = randomUUID();
  await q(
    "INSERT INTO plans(id,code,status,created_at,updated_at) VALUES($1,$2,'ACTIVE',$3,$3)",
    [planId, `p63-${planId.replaceAll("-", "")}`, createdAt],
  );
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,published_at,created_at) VALUES($1,$2,1,'PUBLISHED','P6.3 Plan','P6.3 Plan',$3,$3)",
    [planRevisionId, planId, createdAt],
  );
  const draftPlanRevisionId = randomUUID();
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description,created_at) VALUES($1,$2,2,'DRAFT','P6.3 Draft','P6.3 Draft',$3)",
    [draftPlanRevisionId, planId, createdAt],
  );
  const priceId = randomUUID();
  const priceRevisionId = randomUUID();
  await q(
    "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status,created_at,updated_at) VALUES($1,$2,$3,'global','direct','ACTIVE',$4,$4)",
    [priceId, planId, `price-${priceId.replaceAll("-", "")}`, createdAt],
  );
  await q(
    "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at,created_at) VALUES($1,$2,$3,1,'PUBLISHED',1990,'RUB','MONTH',1,$4,$4,$4)",
    [priceRevisionId, priceId, planRevisionId, createdAt],
  );
  return {
    accountId,
    planRevisionId,
    draftPlanRevisionId,
    priceRevisionId,
    actorId: principalId,
    repo: createP6AdminSubscriptionCommandAdapter(db),
    reads: createP6AdminBillingRepository(db),
  };
}
async function addSubscription(
  f: Awaited<ReturnType<typeof fixture>>,
  state = "ACTIVE",
  end = future,
) {
  const id = randomUUID();
  await q(
    "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,bound_price_revision_id,started_at,current_period_start,current_period_end,grace_until,cancel_at_period_end,canceled_at,suspended_at,state_reason,created_at,updated_at) VALUES($1,$2,$3,1,$4,NULL,$5,$5,$6,NULL,false,NULL,NULL,'fixture',$5,$5)",
    [id, f.accountId, state, f.planRevisionId, createdAt, end],
  );
  await q(
    "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,actor_type,actor_id,reason,occurred_at) VALUES($1,1,NULL,$2,'SYSTEM','SYSTEM',NULL,'fixture',$3)",
    [id, state, now],
  );
  return id;
}
async function addPayment(
  f: Awaited<ReturnType<typeof fixture>>,
  accountId = f.accountId,
  index = 0,
) {
  const id = randomUUID();
  await q(
    "INSERT INTO payments(id,account_id,subscription_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256,created_at,updated_at,confirmed_at) VALUES($1,$2,NULL,'simulator',$3,$4,1990,'RUB','PENDING',$5,$6,$7,$7,NULL)",
    [
      id,
      accountId,
      `payment-${id}`,
      f.priceRevisionId,
      "a".repeat(63) + String((index % 10) + 1),
      "b".repeat(63) + String((index % 10) + 1),
      new Date(now.getTime() + index),
    ],
  );
  return id;
}
async function addEvent(input: {
  source: "WEBHOOK" | "RECONCILIATION";
  identity: string;
  type: string;
  paymentId?: string;
  subscriptionId?: string;
}) {
  const inserted = await q<{ id: string }>(
    "INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at,created_at) VALUES('simulator',$1,$2,$3,$4,'VERIFIED',$5,$5,$5) RETURNING id",
    [input.source, input.identity, input.type, "c".repeat(64), now],
  );
  if (input.paymentId || input.subscriptionId)
    await q(
      "UPDATE billing_events SET processing_state='APPLIED',processed_at=$2,payment_id=$3,subscription_id=$4 WHERE id=$1",
      [
        inserted.rows[0]!.id,
        now,
        input.paymentId ?? null,
        input.subscriptionId ?? null,
      ],
    );
  return inserted.rows[0]!.id;
}
async function auditCount(accountId: string) {
  const result = await q<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_events WHERE target_id IN (SELECT id FROM subscriptions WHERE account_id=$1)",
    [accountId],
  );
  return Number(result.rows[0]!.count);
}
async function adminCommand(
  f: Awaited<ReturnType<typeof fixture>>,
  operation: "grant" | "extend" | "suspend" | "restore",
  subscriptionId?: string,
  expectedStateRevision = 1,
) {
  const input = {
    accountId: f.accountId,
    actorId: f.actorId,
    correlationId: `p63-${randomUUID()}`,
    reason: "support ticket",
    planRevisionId: f.planRevisionId,
    currentPeriodEnd: future,
    subscriptionId: subscriptionId ?? randomUUID(),
    expectedStateRevision,
    newCurrentPeriodEnd: later,
  };
  return f.repo[operation](input as never);
}

describe.sequential(
  "P6.3 admin subscription and billing operations on real PostgreSQL",
  () => {
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString);
      await db.ready();
      await runMigrations({ connectionString });
    });
    beforeEach(clean);
    afterAll(async () => db.close());

    describe("A transaction-time authorization", () => {
      it("allows ADMIN_OWNER grant", async () => {
        const f = await fixture();
        expect((await adminCommand(f, "grant")).kind).toBe("OK");
      });
      it("allows ADMIN_OPS grant", async () => {
        const f = await fixture("ADMIN_OPS");
        expect((await adminCommand(f, "grant")).kind).toBe("OK");
      });
      it("denies ADMIN_SUPPORT grant", async () => {
        const f = await fixture("ADMIN_SUPPORT");
        expect((await adminCommand(f, "grant")).kind).toBe("ADMIN_FORBIDDEN");
      });
      it("denies ADMIN_BILLING_READONLY grant", async () => {
        const f = await fixture("ADMIN_BILLING_READONLY");
        expect((await adminCommand(f, "grant")).kind).toBe("ADMIN_FORBIDDEN");
      });
      it("denies a role revoked after session authority was observed", async () => {
        const f = await fixture("ADMIN_OPS");
        await q(
          "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
          [actorId, now],
        );
        expect((await adminCommand(f, "grant")).kind).toBe("ADMIN_FORBIDDEN");
      });
      it("denies a principal suspended after session authority was observed", async () => {
        const f = await fixture();
        await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [
          actorId,
        ]);
        expect((await adminCommand(f, "grant")).kind).toBe("ADMIN_FORBIDDEN");
      });
      it("authorization denial leaves subscription and audit state unchanged", async () => {
        const f = await fixture("ADMIN_SUPPORT");
        const before = await q(
          "SELECT count(*)::text AS count FROM subscriptions",
        );
        await adminCommand(f, "grant");
        expect(
          (await q("SELECT count(*)::text AS count FROM subscriptions"))
            .rows[0]!.count,
        ).toBe(before.rows[0]!.count);
        expect(await auditCount(f.accountId)).toBe(0);
      });
      it("role revoke and command race has one serialized authority result", async () => {
        const f = await fixture();
        const command = adminCommand(f, "grant");
        const revoke = db.transaction(async (tx) => {
          await tx.query(
            "SELECT id FROM admin_principals WHERE id=$1 FOR UPDATE",
            [actorId],
          );
          await tx.query(
            "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1 AND revoked_at IS NULL",
            [actorId, now],
          );
        });
        const [result] = await Promise.all([command, revoke]);
        expect(["OK", "ADMIN_FORBIDDEN"]).toContain(result.kind);
        const current = await q(
          "SELECT count(*)::text AS count FROM subscriptions",
        );
        expect(Number(current.rows[0]!.count)).toBe(
          result.kind === "OK" ? 1 : 0,
        );
      });
    });

    describe("B grant", () => {
      it("creates an active administrative subscription", async () => {
        const f = await fixture();
        const r = await adminCommand(f, "grant");
        expect(r.kind).toBe("OK");
        if (r.kind === "OK") expect(r.value.state).toBe("ACTIVE");
      });
      it("rejects a missing account", async () => {
        const f = await fixture();
        const r = await f.repo.grant({
          accountId: randomUUID(),
          actorId,
          correlationId: "missing-account",
          reason: "ticket",
          planRevisionId: f.planRevisionId,
          currentPeriodEnd: future,
        } as never);
        expect(r).toEqual({ kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" });
      });
      it("requires a published plan revision", async () => {
        const f = await fixture();
        const r = await f.repo.grant({
          accountId: f.accountId,
          actorId,
          correlationId: "draft-plan",
          reason: "ticket",
          planRevisionId: f.draftPlanRevisionId,
          currentPeriodEnd: future,
        } as never);
        expect(r).toEqual({
          kind: "REJECTED",
          code: "PLAN_REVISION_NOT_PUBLISHED",
        });
      });
      it("rejects a missing plan revision", async () => {
        const f = await fixture();
        const r = await f.repo.grant({
          accountId: f.accountId,
          actorId,
          correlationId: "missing-plan",
          reason: "ticket",
          planRevisionId: randomUUID(),
          currentPeriodEnd: future,
        } as never);
        expect(r).toEqual({
          kind: "REJECTED",
          code: "PLAN_REVISION_NOT_FOUND",
        });
      });
      it("rejects an existing current subscription", async () => {
        const f = await fixture();
        await addSubscription(f);
        expect((await adminCommand(f, "grant")).kind).toBe("REJECTED");
      });
      it("rejects an ended grant period", async () => {
        const f = await fixture();
        expect(
          (
            await f.repo.grant({
              accountId: f.accountId,
              actorId,
              correlationId: "ended",
              reason: "ticket",
              planRevisionId: f.planRevisionId,
              currentPeriodEnd: new Date("2020-01-01T00:00:00Z"),
            } as never)
          ).kind,
        ).toBe("REJECTED");
      });
      it("starts at state revision one", async () => {
        const f = await fixture();
        const r = await adminCommand(f, "grant");
        expect(r.kind === "OK" ? r.value.stateRevision : 0).toBe(1);
      });
      it("leaves bound price revision null", async () => {
        const f = await fixture();
        const idResult = await adminCommand(f, "grant");
        expect(idResult.kind).toBe("OK");
        const row = await q(
          "SELECT bound_price_revision_id AS value FROM subscriptions WHERE account_id=$1",
          [f.accountId],
        );
        expect(row.rows[0]!.value).toBeNull();
      });
      it("does not create a payment", async () => {
        const f = await fixture();
        await adminCommand(f, "grant");
        expect(
          (await q("SELECT count(*)::text AS count FROM payments")).rows[0]!
            .count,
        ).toBe("0");
      });
      it("does not create checkout", async () => {
        const f = await fixture();
        await adminCommand(f, "grant");
        expect(
          (await q("SELECT count(*)::text AS count FROM checkout_intents"))
            .rows[0]!.count,
        ).toBe("0");
      });
      it("writes the exact ADMIN grant audit", async () => {
        const f = await fixture();
        await adminCommand(f, "grant");
        const row = await q<{
          actor_type: string;
          actor_id: string;
          action: string;
        }>(
          "SELECT actor_type,actor_id,action FROM audit_events WHERE target_type='SUBSCRIPTION'",
        );
        expect(row.rows[0]).toMatchObject({
          actor_type: "ADMIN",
          actor_id: actorId,
          action: "SUBSCRIPTION_GRANTED",
        });
      });
      it("rolls back grant and audit together on audit failure", async () => {
        const f = await fixture();
        await q(
          "CREATE OR REPLACE FUNCTION p63_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$",
        );
        await q(
          "CREATE TRIGGER p63_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p63_fail_audit()",
        );
        await expect(adminCommand(f, "grant")).rejects.toBeInstanceOf(Error);
        await q("DROP TRIGGER p63_audit_failure ON audit_events");
        await q("DROP FUNCTION p63_fail_audit()");
        expect(
          (await q("SELECT count(*)::text AS count FROM subscriptions"))
            .rows[0]!.count,
        ).toBe("0");
      });
    });

    describe("C extend", () => {
      it("extends a current subscription", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await adminCommand(f, "extend", id);
        expect(r.kind).toBe("OK");
      });
      it("rejects a stale revision", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        expect((await adminCommand(f, "extend", id, 9)).kind).toBe("REJECTED");
      });
      it("rejects a non-forward period", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await f.repo.extend({
          accountId: f.accountId,
          actorId,
          correlationId: "not-forward",
          reason: "ticket",
          subscriptionId: id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: future,
        } as never);
        expect(r).toEqual({
          kind: "REJECTED",
          code: "SUBSCRIPTION_PERIOD_NOT_EXTENDED",
        });
      });
      it("rejects crossing a grace window", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "GRACE", future);
        await q("UPDATE subscriptions SET grace_until=$2 WHERE id=$1", [
          id,
          later,
        ]);
        expect(
          (
            await f.repo.extend({
              accountId: f.accountId,
              actorId,
              correlationId: "grace",
              reason: "ticket",
              subscriptionId: id,
              expectedStateRevision: 1,
              newCurrentPeriodEnd: later,
            } as never)
          ).kind,
        ).toBe("REJECTED");
      });
      it("rejects an expired subscription", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "EXPIRED", future);
        expect((await adminCommand(f, "extend", id)).kind).toBe("REJECTED");
      });
      it("increments revision exactly once", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await adminCommand(f, "extend", id);
        expect(r.kind === "OK" ? r.value.stateRevision : 0).toBe(2);
      });
      it("does not invent a transition row", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "extend", id);
        expect(
          (
            await q(
              "SELECT count(*)::text AS count FROM subscription_transitions WHERE subscription_id=$1",
              [id],
            )
          ).rows[0]!.count,
        ).toBe("1");
      });
      it("writes the exact ADMIN extension audit", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "extend", id);
        expect(
          (await q("SELECT action FROM audit_events WHERE target_id=$1", [id]))
            .rows[0]!.action,
        ).toBe("SUBSCRIPTION_EXTENDED");
      });
      it("rejects an account and subscription mismatch", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const id = await addSubscription(f);
        const r = await other.repo.extend({
          accountId: other.accountId,
          actorId: other.actorId,
          correlationId: "mismatch",
          reason: "ticket",
          subscriptionId: id,
          expectedStateRevision: 1,
          newCurrentPeriodEnd: later,
        } as never);
        expect(r).toEqual({ kind: "ADMIN_RESOURCE_NOT_FOUND" });
        expect(await auditCount(f.accountId)).toBe(0);
      });
      it("preserves plan and state during extension", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await adminCommand(f, "extend", id);
        expect(
          r.kind === "OK" ? [r.value.currentPlanRevisionId, r.value.state] : [],
        ).toEqual([f.planRevisionId, "ACTIVE"]);
      });
    });

    describe("D suspend", () => {
      it("suspends ACTIVE", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        expect((await adminCommand(f, "suspend", id)).kind).toBe("OK");
      });
      it("suspends GRACE", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "GRACE", future);
        await q("UPDATE subscriptions SET grace_until=$2 WHERE id=$1", [
          id,
          later,
        ]);
        expect((await adminCommand(f, "suspend", id)).kind).toBe("OK");
      });
      it("suspends CANCELED", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "CANCELED");
        await q(
          "UPDATE subscriptions SET cancel_at_period_end=true WHERE id=$1",
          [id],
        );
        expect((await adminCommand(f, "suspend", id)).kind).toBe("OK");
      });
      it("already suspended is changed false", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "SUSPENDED");
        const r = await adminCommand(f, "suspend", id);
        expect(r.kind === "OK" ? r.changed : true).toBe(false);
      });
      it("rejects EXPIRED", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "EXPIRED");
        expect((await adminCommand(f, "suspend", id)).kind).toBe("REJECTED");
      });
      it("increments revision once", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await adminCommand(f, "suspend", id);
        expect(r.kind === "OK" ? r.value.stateRevision : 0).toBe(2);
      });
      it("writes one ADMIN transition", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        const row = await q(
          "SELECT source,actor_type FROM subscription_transitions WHERE subscription_id=$1 AND transition_revision=2",
          [id],
        );
        expect(row.rows[0]).toMatchObject({
          source: "ADMIN",
          actor_type: "ADMIN",
        });
      });
      it("writes the exact suspend audit", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        expect(
          (await q("SELECT action FROM audit_events WHERE target_id=$1", [id]))
            .rows[0]!.action,
        ).toBe("SUBSCRIPTION_SUSPENDED");
      });
    });

    describe("E restore", () => {
      it("restores an ACTIVE suspension origin", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        expect((await adminCommand(f, "restore", id, 2)).kind).toBe("OK");
      });
      it("restores a GRACE origin", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "GRACE", future);
        await q("UPDATE subscriptions SET grace_until=$2 WHERE id=$1", [
          id,
          later,
        ]);
        await adminCommand(f, "suspend", id);
        expect((await adminCommand(f, "restore", id, 2)).kind).toBe("OK");
      });
      it("rejects an expired period origin", async () => {
        const f = await fixture();
        const id = await addSubscription(
          f,
          "ACTIVE",
          new Date("2020-02-01T00:00:00Z"),
        );
        await q(
          "UPDATE subscriptions SET state='SUSPENDED',suspended_at=$2,state_revision=2 WHERE id=$1",
          [id, now],
        );
        await q(
          "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,actor_type,actor_id,reason,occurred_at) VALUES($1,2,'ACTIVE','SUSPENDED','ADMIN','ADMIN',$2,'ticket',$3)",
          [id, actorId, now],
        );
        expect((await adminCommand(f, "restore", id, 2)).kind).toBe("REJECTED");
      });
      it("rejects an expired grace origin", async () => {
        const f = await fixture();
        const id = await addSubscription(
          f,
          "GRACE",
          new Date("2020-02-01T00:00:00Z"),
        );
        await q(
          "UPDATE subscriptions SET grace_until=$2,state='SUSPENDED',suspended_at=$3,state_revision=2 WHERE id=$1",
          [id, new Date("2020-03-01T00:00:00Z"), now],
        );
        await q(
          "INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,actor_type,actor_id,reason,occurred_at) VALUES($1,2,'GRACE','SUSPENDED','ADMIN','ADMIN',$2,'ticket',$3)",
          [id, actorId, now],
        );
        expect((await adminCommand(f, "restore", id, 2)).kind).toBe("REJECTED");
      });
      it("rejects missing restore origin", async () => {
        const f = await fixture();
        const id = await addSubscription(f, "SUSPENDED");
        expect((await adminCommand(f, "restore", id)).kind).toBe("REJECTED");
      });
      it("rejects a non-suspended subscription", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        expect((await adminCommand(f, "restore", id)).kind).toBe("REJECTED");
      });
      it("rejects stale restore revision", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        expect((await adminCommand(f, "restore", id, 1)).kind).toBe("REJECTED");
      });
      it("increments revision and uses the origin target", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        const r = await adminCommand(f, "restore", id, 2);
        expect(
          r.kind === "OK" ? [r.value.stateRevision, r.value.state] : [],
        ).toEqual([3, "ACTIVE"]);
      });
      it("writes the exact restore audit", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        await adminCommand(f, "restore", id, 2);
        expect(
          (
            await q(
              "SELECT action FROM audit_events WHERE target_id=$1 ORDER BY created_at DESC",
              [id],
            )
          ).rows[0]!.action,
        ).toBe("SUBSCRIPTION_RESTORED");
      });
    });

    describe("F account-scoped billing reads", () => {
      it("returns an empty payment page", async () => {
        const f = await fixture();
        expect(
          (await f.reads.listPayments({ accountId: f.accountId, limit: 50 }))
            .items,
        ).toEqual([]);
      });
      it("returns non-empty payments", async () => {
        const f = await fixture();
        await addPayment(f);
        const r = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 50,
        });
        expect("kind" in r ? r.kind : r.items.length).toBe(1);
      });
      it("rejects a missing payment account", async () => {
        const f = await fixture();
        expect(
          (await f.reads.listPayments({ accountId: randomUUID(), limit: 50 }))
            .kind,
        ).toBe("ACCOUNT_NOT_FOUND");
      });
      it("paginates payments by createdAt and id", async () => {
        const f = await fixture();
        await addPayment(f, f.accountId, 0);
        await addPayment(f, f.accountId, 1);
        await addPayment(f, f.accountId, 2);
        const first = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 2,
        });
        expect("kind" in first ? first.kind : first.nextCursor).toBeTruthy();
        const second = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 2,
          cursor: first.nextCursor,
        });
        expect("kind" in second ? second.kind : second.items).toHaveLength(1);
      });
      it("scopes a payment cursor to its account", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const id = await addPayment(f);
        expect(
          (
            await other.reads.listPayments({
              accountId: other.accountId,
              limit: 1,
              cursor: id,
            })
          ).kind,
        ).toBe("INVALID_CURSOR");
      });
      it("omits payment provider identity", async () => {
        const f = await fixture();
        await addPayment(f);
        const r = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 1,
        });
        expect(JSON.stringify(r)).not.toContain("providerPaymentId");
      });
      it("omits payment idempotency hash", async () => {
        const f = await fixture();
        await addPayment(f);
        const r = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 1,
        });
        expect(JSON.stringify(r)).not.toContain("idempotencyKeyHash");
      });
      it("returns events linked by payment", async () => {
        const f = await fixture();
        const paymentId = await addPayment(f);
        await addEvent({
          source: "WEBHOOK",
          identity: "evt-payment",
          type: "payment.succeeded",
          paymentId,
        });
        const r = await f.reads.listEvents({
          accountId: f.accountId,
          limit: 1,
        });
        expect("kind" in r ? r.kind : r.items[0]!.paymentId).toBe(paymentId);
      });
      it("returns events linked by subscription", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await addEvent({
          source: "RECONCILIATION",
          identity: "evt-sub",
          type: "payment.failed",
          subscriptionId: id,
        });
        const r = await f.reads.listEvents({
          accountId: f.accountId,
          limit: 1,
        });
        expect("kind" in r ? r.kind : r.items[0]!.subscriptionId).toBe(id);
      });
      it("fails closed when the database rejects cross-account event links", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const paymentId = await addPayment(f);
        const subId = await addSubscription(other);
        await expect(
          addEvent({
            source: "WEBHOOK",
            identity: "evt-cross",
            type: "payment.succeeded",
            paymentId,
            subscriptionId: subId,
          }),
        ).rejects.toBeInstanceOf(Error);
      });
      it("does not return unlinked events", async () => {
        const f = await fixture();
        await addEvent({
          source: "WEBHOOK",
          identity: "evt-unlinked",
          type: "payment.failed",
        });
        const r = await f.reads.listEvents({
          accountId: f.accountId,
          limit: 1,
        });
        expect("kind" in r ? r.kind : r.items).toHaveLength(0);
      });
      it("scopes an event cursor to its account", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const id = await addPayment(other);
        await addEvent({
          source: "WEBHOOK",
          identity: "evt-cursor",
          type: "payment.failed",
          paymentId: id,
        });
        expect(
          (
            await f.reads.listEvents({
              accountId: f.accountId,
              limit: 1,
              cursor: id,
            })
          ).kind,
        ).toBe("INVALID_CURSOR");
      });
      it("omits event identity and payload hash", async () => {
        const f = await fixture();
        const p = await addPayment(f);
        await addEvent({
          source: "WEBHOOK",
          identity: "evt-private",
          type: "payment.failed",
          paymentId: p,
        });
        const r = await f.reads.listEvents({
          accountId: f.accountId,
          limit: 1,
        });
        expect(JSON.stringify(r)).not.toContain("evt-private");
        expect(JSON.stringify(r)).not.toContain("payloadSha256");
      });
      it("returns an empty reconciliation page", async () => {
        const f = await fixture();
        expect(
          (
            await f.reads.listReconciliationJobs({
              accountId: f.accountId,
              limit: 50,
            })
          ).items,
        ).toEqual([]);
      });
      it("returns non-empty reconciliation jobs", async () => {
        const f = await fixture();
        const p = await addPayment(f);
        await q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,lease_token,lease_until,attempt_count,last_result_code,created_at,updated_at) VALUES($1,'LEASED',NULL,$2,$3,2,'PROVIDER_PENDING',$3,$3)",
          [p, randomUUID(), now],
        );
        const r = await f.reads.listReconciliationJobs({
          accountId: f.accountId,
          limit: 1,
        });
        expect("kind" in r ? r.kind : r.items[0]!.paymentId).toBe(p);
      });
      it("scopes a reconciliation cursor to its account", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const p = await addPayment(other);
        await q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,attempt_count,created_at,updated_at) VALUES($1,'READY',$2,0,$2,$2)",
          [p, now],
        );
        expect(
          (
            await f.reads.listReconciliationJobs({
              accountId: f.accountId,
              limit: 1,
              cursor: p,
            })
          ).kind,
        ).toBe("INVALID_CURSOR");
      });
      it("orders reconciliation by updatedAt and paymentId", async () => {
        const f = await fixture();
        const p1 = await addPayment(f, f.accountId, 0);
        const p2 = await addPayment(f, f.accountId, 1);
        await q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,attempt_count,created_at,updated_at) VALUES($1,'READY',$3,0,$3,$3),($2,'BLOCKED',NULL,1,$4,$4)",
          [p1, p2, now, later],
        );
        const r = await f.reads.listReconciliationJobs({
          accountId: f.accountId,
          limit: 2,
        });
        expect("kind" in r ? r.kind : r.items[0]!.paymentId).toBe(p2);
      });
      it("omits reconciliation lease token", async () => {
        const f = await fixture();
        const p = await addPayment(f);
        await q(
          "INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,lease_token,lease_until,attempt_count,created_at,updated_at) VALUES($1,'LEASED',NULL,$2,$3,1,$3,$3)",
          [p, randomUUID(), now],
        );
        const r = await f.reads.listReconciliationJobs({
          accountId: f.accountId,
          limit: 1,
        });
        expect(JSON.stringify(r)).not.toContain("leaseToken");
      });
    });

    describe("G concurrency and shared-regression checks", () => {
      it("two extensions with one expected revision yield one success and one stale", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const [a, b] = await Promise.all([
          adminCommand(f, "extend", id),
          adminCommand(f, "extend", id),
        ]);
        expect([a.kind, b.kind].sort()).toEqual(["OK", "REJECTED"]);
      });
      it("grant race on one account yields one current subscription", async () => {
        const f = await fixture();
        const [a, b] = await Promise.all([
          adminCommand(f, "grant"),
          adminCommand(f, "grant"),
        ]);
        expect([a.kind, b.kind].sort()).toEqual(["OK", "REJECTED"]);
        expect(
          (
            await q(
              "SELECT count(*)::text AS count FROM subscriptions WHERE account_id=$1",
              [f.accountId],
            )
          ).rows[0]!.count,
        ).toBe("1");
      });
      it("admin context actor is preserved on every subscription audit", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        await adminCommand(f, "suspend", id);
        const row = await q(
          "SELECT actor_type,actor_id,source FROM subscription_transitions WHERE subscription_id=$1 AND transition_revision=2",
          [id],
        );
        expect(row.rows[0]).toMatchObject({
          actor_type: "ADMIN",
          actor_id: actorId,
          source: "ADMIN",
        });
      });
      it("account mismatch does not change subscription state", async () => {
        const f = await fixture();
        const other = await fixture("ADMIN_OWNER", randomUUID());
        const id = await addSubscription(f);
        await other.repo.suspend({
          accountId: other.accountId,
          actorId: other.actorId,
          correlationId: "mismatch-state",
          reason: "ticket",
          subscriptionId: id,
          expectedStateRevision: 1,
        } as never);
        expect(
          (
            await q(
              "SELECT state,state_revision FROM subscriptions WHERE id=$1",
              [id],
            )
          ).rows[0],
        ).toMatchObject({ state: "ACTIVE", state_revision: 1 });
      });
      it("current subscription remains immutable through read composition", async () => {
        const f = await fixture();
        const id = await addSubscription(f);
        const r = await f.reads.listPayments({
          accountId: f.accountId,
          limit: 1,
        });
        expect("kind" in r ? r.kind : r.items).toEqual([]);
        expect(
          (await q("SELECT id FROM subscriptions WHERE id=$1", [id])).rows,
        ).toHaveLength(1);
      });
      it("billing reads never create audit rows", async () => {
        const f = await fixture();
        await addPayment(f);
        const before = (
          await q("SELECT count(*)::text AS count FROM audit_events")
        ).rows[0]!.count;
        await f.reads.listPayments({ accountId: f.accountId, limit: 1 });
        await f.reads.listEvents({ accountId: f.accountId, limit: 1 });
        await f.reads.listReconciliationJobs({
          accountId: f.accountId,
          limit: 1,
        });
        expect(
          (await q("SELECT count(*)::text AS count FROM audit_events")).rows[0]!
            .count,
        ).toBe(before);
      });
      it("shared P6.2 actor authorization still denies a suspended principal", async () => {
        const f = await fixture();
        await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [
          actorId,
        ]);
        expect((await adminCommand(f, "grant")).kind).toBe("ADMIN_FORBIDDEN");
      });
    });
  },
);
