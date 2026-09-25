import { randomUUID } from "node:crypto";
import {
  BillingEventFailureCodeSchema,
  BillingPaymentStatusFoundSchema,
  reconciliationEventIdentity,
  reconciliationPayloadSha256,
  type BillingReconciliationClaim,
  type BillingReconciliationProcessResult,
  type BillingReconciliationRepository,
} from "@product/billing";
import {
  addUtcCalendarInterval,
  type BillingPaymentStatusState,
} from "@product/billing";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
// SQL row shapes are deliberately local to this repository; PostgreSQL aliases are validated by the queries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const eventColumns = `id,provider,event_identity AS "eventIdentity",event_type AS "eventType",payload_sha256 AS "payloadSha256",processing_state AS "processingState",payment_id AS "paymentId",subscription_id AS "subscriptionId",subscription_transition_id AS "subscriptionTransitionId",failure_code AS "failureCode"`;

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("PAYMENT_SUBSCRIPTION_CORRUPTED");
  return n;
}
function dt(value: unknown): Date {
  return value instanceof Date
    ? new Date(value.getTime())
    : new Date(String(value));
}
function eventType(state: BillingPaymentStatusState): string {
  return state === "SUCCEEDED"
    ? "payment.succeeded"
    : state === "FAILED"
      ? "payment.failed"
      : "payment.canceled";
}
function result(
  kind: "APPLIED" | "IGNORED" | "BLOCKED" | "FAILED",
  paymentId: string,
  code?: string,
  billingEventId?: string | null,
): BillingReconciliationProcessResult {
  return {
    kind,
    paymentId,
    ...(code ? { code } : {}),
    ...(billingEventId !== undefined ? { billingEventId } : {}),
  } as BillingReconciliationProcessResult;
}
async function accountLock(q: Query, accountId: string): Promise<boolean> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `p5-subscription-account:${accountId}`,
  ]);
  const row = await q.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
    accountId,
  ]);
  return Boolean(row.rows[0]);
}
async function audit(
  q: Query,
  action: string,
  targetType: string,
  targetId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,$1,$2,$3,$4,'BILLING_RECONCILIATION',$5::jsonb)`,
    [action, targetType, targetId, correlationId, JSON.stringify(metadata)],
  );
}
async function finishJob(
  q: Query,
  paymentId: string,
  leaseToken: string,
  state: "SETTLED" | "BLOCKED" | "READY",
  code: string | null,
  nextAttemptAt: Date | null,
  now: Date,
): Promise<boolean> {
  const updated = await q.query(
    `UPDATE billing_reconciliation_jobs
        SET state=$1,next_attempt_at=$2,lease_token=NULL,lease_until=NULL,last_result_code=$3,updated_at=GREATEST($4,created_at)
      WHERE payment_id=$5 AND state='LEASED' AND lease_token=$6
      RETURNING payment_id`,
    [state, nextAttemptAt, code, now, paymentId, leaseToken],
  );
  return Boolean(updated.rows[0]);
}
async function insertEvent(
  q: Query,
  input: {
    provider: string;
    identity: string;
    type: string;
    payload: string;
    receivedAt: Date;
    paymentId: string;
  },
): Promise<Row> {
  await q.query(
    `INSERT INTO billing_events(provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at)
     VALUES($1,'RECONCILIATION',$2,$3,$4,'VERIFIED',$5,$5) ON CONFLICT(provider,event_identity) DO NOTHING`,
    [
      input.provider,
      input.identity,
      input.type,
      input.payload,
      input.receivedAt,
    ],
  );
  const row = await q.query<Row>(
    `SELECT ${eventColumns} FROM billing_events WHERE provider=$1 AND event_identity=$2 FOR UPDATE`,
    [input.provider, input.identity],
  );
  if (!row.rows[0]) throw new Error("BILLING_EVENT_CLAIM_LOST");
  return row.rows[0];
}
async function terminalize(
  q: Query,
  eventId: string,
  state: "APPLIED" | "IGNORED" | "FAILED",
  processedAt: Date,
  refs: {
    paymentId: string;
    subscriptionId?: string | null;
    transitionId?: string | null;
    code?: string | null;
  },
): Promise<Row> {
  const codeValue = refs.code
    ? BillingEventFailureCodeSchema.parse(refs.code)
    : null;
  const row = await q.query<Row>(
    `UPDATE billing_events SET processing_state=$1,processed_at=$2,payment_id=$3,subscription_id=$4,subscription_transition_id=$5,failure_code=$6 WHERE id=$7 RETURNING ${eventColumns}`,
    [
      state,
      processedAt,
      refs.paymentId,
      refs.subscriptionId ?? null,
      refs.transitionId ?? null,
      codeValue,
      eventId,
    ],
  );
  if (!row.rows[0]) throw new Error("BILLING_EVENT_CLAIM_LOST");
  return row.rows[0];
}
function terminalResult(
  row: Row,
  paymentId: string,
): BillingReconciliationProcessResult {
  return result(
    row.processingState === "APPLIED"
      ? "APPLIED"
      : row.processingState === "IGNORED"
        ? "IGNORED"
        : "FAILED",
    paymentId,
    row.failureCode,
    row.id,
  );
}

export function createP5ReconciliationRepository(
  runtime: DatabaseRuntime,
): BillingReconciliationRepository {
  return {
    async claimDue({ now, leaseMs, batchSize }) {
      if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
        throw new Error("INVALID_LEASE");
      return runtime.transaction(async (q) => {
        const rows = await q.query<Row>(
          `SELECT j.payment_id AS "paymentId",p.provider,p.provider_payment_id AS "providerPaymentId",p.account_id AS "accountId",
                  p.price_revision_id AS "priceRevisionId",p.amount_minor AS "amountMinor",p.currency,p.state AS "paymentState",
                  p.created_at AS "createdAt",j.attempt_count AS "attemptCount"
             FROM billing_reconciliation_jobs j JOIN payments p ON p.id=j.payment_id
            WHERE (j.state='READY' AND j.next_attempt_at <= $1) OR (j.state='LEASED' AND j.lease_until <= $1)
            ORDER BY j.next_attempt_at NULLS FIRST,j.created_at,j.payment_id
            FOR UPDATE OF j SKIP LOCKED LIMIT $2`,
          [now, batchSize],
        );
        const claims: BillingReconciliationClaim[] = [];
        for (const row of rows.rows) {
          const token = randomUUID();
          const updated = await q.query<Row>(
            `UPDATE billing_reconciliation_jobs SET state='LEASED',next_attempt_at=NULL,lease_token=$1,lease_until=$2,attempt_count=attempt_count+1,updated_at=GREATEST($3,created_at)
             WHERE payment_id=$4 AND (state='READY' OR (state='LEASED' AND lease_until <= $3)) RETURNING attempt_count`,
            [token, new Date(now.getTime() + leaseMs), now, row.paymentId],
          );
          if (!updated.rows[0]) continue;
          claims.push({
            paymentId: row.paymentId,
            provider: row.provider,
            providerPaymentId: row.providerPaymentId,
            accountId: row.accountId,
            priceRevisionId: row.priceRevisionId,
            amountMinor: money(row.amountMinor),
            currency: row.currency,
            paymentState: row.paymentState,
            createdAt: dt(row.createdAt),
            attemptCount: Number(updated.rows[0].attempt_count),
            leaseToken: token,
          });
        }
        return claims;
      });
    },
    async reschedule({ paymentId, leaseToken, nextAttemptAt, code }) {
      return runtime.transaction(async (q) => {
        const now = new Date();
        const ok = await finishJob(
          q,
          paymentId,
          leaseToken,
          "READY",
          code,
          nextAttemptAt,
          now,
        );
        return ok
          ? { kind: "RESCHEDULED", code }
          : { kind: "STALE_LEASE", paymentId };
      });
    },
    async blockUnsupported({
      claim,
      processedAt,
      correlationId: _correlationId,
      code,
    }) {
      return runtime.transaction(async (q) => {
        const ok = await finishJob(
          q,
          claim.paymentId,
          claim.leaseToken,
          "BLOCKED",
          code,
          null,
          processedAt,
        );
        return ok
          ? result("BLOCKED", claim.paymentId, code)
          : { kind: "STALE_LEASE", paymentId: claim.paymentId };
      });
    },
    async applyStatus({
      claim,
      status: rawStatus,
      processedAt,
      correlationId,
    }) {
      const status = BillingPaymentStatusFoundSchema.parse(rawStatus);
      return runtime.transaction(async (q) => {
        const job = await q.query<Row>(
          'SELECT payment_id AS "paymentId",state,lease_token AS "leaseToken" FROM billing_reconciliation_jobs WHERE payment_id=$1 FOR UPDATE',
          [claim.paymentId],
        );
        if (
          !job.rows[0] ||
          job.rows[0].state !== "LEASED" ||
          job.rows[0].leaseToken !== claim.leaseToken
        )
          return { kind: "STALE_LEASE", paymentId: claim.paymentId };
        if (status.state === "PENDING") {
          // PENDING is an observation, not a commercial billing event.
          const next = new Date(processedAt.getTime() + 60_000);
          const ok = await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "READY",
            "PROVIDER_PENDING",
            next,
            processedAt,
          );
          return ok
            ? { kind: "RESCHEDULED", code: "PROVIDER_PENDING" }
            : { kind: "STALE_LEASE", paymentId: claim.paymentId };
        }
        const payload = reconciliationPayloadSha256({
          paymentId: claim.paymentId,
          provider: claim.provider,
          providerPaymentId: claim.providerPaymentId,
          state: status.state,
          amountMinor: status.amountMinor,
          currency: status.currency,
          statusAt: status.statusAt,
        });
        const identity = reconciliationEventIdentity({
          paymentId: claim.paymentId,
          attemptCount: claim.attemptCount,
          state: status.state,
          statusAt: status.statusAt,
          normalizedPayloadSha256: payload,
        });
        const event = await insertEvent(q, {
          provider: claim.provider,
          identity,
          type: eventType(status.state),
          payload,
          receivedAt: processedAt,
          paymentId: claim.paymentId,
        });
        if (event.processingState !== "VERIFIED") {
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "SETTLED",
            null,
            null,
            processedAt,
          );
          return terminalResult(event, claim.paymentId);
        }
        if (
          status.amountMinor !== claim.amountMinor ||
          status.currency !== claim.currency
        ) {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: "PAYMENT_TERMS_MISMATCH",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "BLOCKED",
            "PAYMENT_TERMS_MISMATCH",
            null,
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        if (
          status.statusAt.getTime() < claim.createdAt.getTime() ||
          status.statusAt.getTime() > processedAt.getTime()
        ) {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: "EVENT_TIME_INVALID",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "BLOCKED",
            "EVENT_TIME_INVALID",
            null,
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        if (!(await accountLock(q, claim.accountId)))
          throw new Error("ACCOUNT_NOT_FOUND");
        const paymentQuery = await q.query<Row>(
          'SELECT id,account_id AS "accountId",subscription_id AS "subscriptionId",provider,provider_payment_id AS "providerPaymentId",price_revision_id AS "priceRevisionId",amount_minor AS "amountMinor",currency,state,created_at AS "createdAt" FROM payments WHERE id=$1 FOR UPDATE',
          [claim.paymentId],
        );
        const payment = paymentQuery.rows[0];
        if (!payment) throw new Error("PAYMENT_NOT_FOUND");
        const currentState = String(payment.state);
        if (currentState === "REFUNDED" || currentState === "CHARGEBACK") {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: "PAYMENT_STATE_CONFLICT",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "BLOCKED",
            "UNSUPPORTED_PAYMENT_STATE",
            null,
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        if (currentState === "SUCCEEDED" && status.state !== "SUCCEEDED") {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: "PAYMENT_STATE_CONFLICT",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "BLOCKED",
            "PAYMENT_STATE_CONFLICT",
            null,
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        if (currentState === status.state && status.state !== "SUCCEEDED") {
          const ignored = await terminalize(
            q,
            event.id,
            "IGNORED",
            processedAt,
            { paymentId: claim.paymentId },
          );
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "SETTLED",
            null,
            null,
            processedAt,
          );
          return terminalResult(ignored, claim.paymentId);
        }
        if (status.state !== "SUCCEEDED") {
          await q.query(
            "UPDATE payments SET state=$1,updated_at=$2 WHERE id=$3",
            [status.state, processedAt, claim.paymentId],
          );
          await audit(
            q,
            "PAYMENT_RECONCILED",
            "PAYMENT",
            claim.paymentId,
            correlationId,
            {
              paymentId: claim.paymentId,
              provider: claim.provider,
              oldState: currentState,
              newState: status.state,
              subscriptionId: null,
              priceRevisionId: claim.priceRevisionId,
            },
          );
          const applied = await terminalize(
            q,
            event.id,
            "APPLIED",
            processedAt,
            { paymentId: claim.paymentId },
          );
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "SETTLED",
            null,
            null,
            processedAt,
          );
          return terminalResult(applied, claim.paymentId);
        }
        const checkoutQuery = await q.query<Row>(
          `SELECT id,account_id AS "accountId",price_revision_id AS "priceRevisionId",plan_revision_id AS "planRevisionId",provider,state,provider_payment_id AS "providerPaymentId",payment_id AS "paymentId",amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount" FROM checkout_intents WHERE payment_id=$1 FOR UPDATE`,
          [claim.paymentId],
        );
        const checkout = checkoutQuery.rows[0];
        const coherent = Boolean(
          checkout &&
            checkout.state === "READY" &&
            checkout.accountId === claim.accountId &&
            checkout.provider === claim.provider &&
            checkout.providerPaymentId === claim.providerPaymentId &&
            checkout.paymentId === claim.paymentId &&
            checkout.priceRevisionId === claim.priceRevisionId &&
            money(checkout.amountMinor) === claim.amountMinor &&
            checkout.currency === claim.currency,
        );
        if (!checkout || !coherent) {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: checkout ? "CHECKOUT_CORRUPTED" : "CHECKOUT_NOT_FOUND",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "BLOCKED",
            checkout ? "CHECKOUT_CORRUPTED" : "CHECKOUT_NOT_FOUND",
            null,
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        if (payment.subscriptionId) {
          const linked = await q.query<Row>(
            'SELECT id,account_id AS "accountId" FROM subscriptions WHERE id=$1',
            [payment.subscriptionId],
          );
          if (!linked.rows[0] || linked.rows[0].accountId !== claim.accountId) {
            const failed = await terminalize(
              q,
              event.id,
              "FAILED",
              processedAt,
              {
                paymentId: claim.paymentId,
                code: "PAYMENT_SUBSCRIPTION_CORRUPTED",
              },
            );
            await finishJob(
              q,
              claim.paymentId,
              claim.leaseToken,
              "READY",
              "PAYMENT_SUBSCRIPTION_CORRUPTED",
              new Date(processedAt.getTime() + 60_000),
              processedAt,
            );
            return terminalResult(failed, claim.paymentId);
          }
          const ignored = await terminalize(
            q,
            event.id,
            "IGNORED",
            processedAt,
            {
              paymentId: claim.paymentId,
              subscriptionId: payment.subscriptionId,
            },
          );
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "SETTLED",
            null,
            null,
            processedAt,
          );
          return terminalResult(ignored, claim.paymentId);
        }
        const current = await q.query<Row>(
          "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1 FOR UPDATE",
          [claim.accountId],
        );
        if (current.rows[0]) {
          const failed = await terminalize(q, event.id, "FAILED", processedAt, {
            paymentId: claim.paymentId,
            code: "CURRENT_SUBSCRIPTION_CONFLICT",
          });
          await finishJob(
            q,
            claim.paymentId,
            claim.leaseToken,
            "READY",
            "CURRENT_SUBSCRIPTION_CONFLICT",
            new Date(processedAt.getTime() + 60_000),
            processedAt,
          );
          return terminalResult(failed, claim.paymentId);
        }
        const periodEnd = addUtcCalendarInterval(
          status.statusAt,
          checkout.billingIntervalUnit,
          Number(checkout.billingIntervalCount),
        );
        const inserted = await q.query<Row>(
          `INSERT INTO subscriptions(account_id,state,state_revision,current_plan_revision_id,bound_price_revision_id,started_at,current_period_start,current_period_end,grace_until,cancel_at_period_end,canceled_at,suspended_at,state_reason,created_at,updated_at) VALUES($1,'ACTIVE',1,$2,$3,$4,$4,$5,NULL,false,NULL,NULL,'BILLING_RECONCILIATION_SUCCEEDED',$6,$6) RETURNING id`,
          [
            claim.accountId,
            checkout.planRevisionId,
            claim.priceRevisionId,
            status.statusAt,
            periodEnd,
            processedAt,
          ],
        );
        const subscriptionId = inserted.rows[0]?.id;
        if (!subscriptionId) throw new Error("SUBSCRIPTION_CORRUPTED");
        const transition = await q.query<Row>(
          `INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,source_event_id,actor_type,actor_id,reason,occurred_at) VALUES($1,1,NULL,'ACTIVE','RECONCILIATION',$2,'SYSTEM',NULL,'BILLING_RECONCILIATION_SUCCEEDED',$3) RETURNING id`,
          [subscriptionId, identity, status.statusAt],
        );
        await q.query(
          "UPDATE payments SET state='SUCCEEDED',confirmed_at=CASE WHEN state='SUCCEEDED' THEN confirmed_at ELSE $1 END,subscription_id=$2,updated_at=$3 WHERE id=$4",
          [status.statusAt, subscriptionId, processedAt, claim.paymentId],
        );
        await audit(
          q,
          "PAYMENT_RECONCILED",
          "PAYMENT",
          claim.paymentId,
          correlationId,
          {
            paymentId: claim.paymentId,
            provider: claim.provider,
            oldState: currentState,
            newState: "SUCCEEDED",
            subscriptionId,
            priceRevisionId: claim.priceRevisionId,
          },
        );
        await audit(
          q,
          "SUBSCRIPTION_ACTIVATED",
          "SUBSCRIPTION",
          subscriptionId,
          correlationId,
          {
            subscriptionId,
            state: "ACTIVE",
            stateRevision: 1,
            transitionRevision: 1,
          },
        );
        const applied = await terminalize(q, event.id, "APPLIED", processedAt, {
          paymentId: claim.paymentId,
          subscriptionId,
          transitionId: transition.rows[0]?.id,
        });
        await finishJob(
          q,
          claim.paymentId,
          claim.leaseToken,
          "SETTLED",
          null,
          null,
          processedAt,
        );
        return terminalResult(applied, claim.paymentId);
      });
    },
  };
}
