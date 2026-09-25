import {
  BillingEventContextSchema,
  BillingEventFailureCodeSchema,
  VerifiedBillingEventSchema,
  addUtcCalendarInterval,
  type BillingEventApplicationRepository,
  type BillingEventProcessingResult,
  type BillingEventFailureCode,
  type BillingEventType,
  type BillingEventContext,
  type VerifiedBillingEvent,
} from "@product/billing";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
type PaymentState =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "CHARGEBACK";

type PaymentRow = {
  id: string;
  accountId: string;
  subscriptionId: string | null;
  provider: string;
  providerPaymentId: string;
  priceRevisionId: string;
  amountMinor: number | string;
  currency: string;
  state: PaymentState;
  createdAt: Date;
};

type BillingEventRow = {
  id: string;
  provider: string;
  eventIdentity: string;
  eventType: string;
  payloadSha256: string;
  processingState: "VERIFIED" | "APPLIED" | "IGNORED" | "FAILED";
  paymentId: string | null;
  subscriptionId: string | null;
  subscriptionTransitionId: string | null;
  failureCode: string | null;
};

type CheckoutRow = {
  id: string;
  accountId: string;
  priceRevisionId: string;
  planRevisionId: string;
  provider: string;
  state: "CREATING" | "READY" | "FAILED";
  providerPaymentId: string | null;
  paymentId: string | null;
  amountMinor: number | string;
  currency: string;
  billingIntervalUnit: "DAY" | "MONTH" | "YEAR";
  billingIntervalCount: number;
};

function money(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("PAYMENT_SUBSCRIPTION_CORRUPTED");
  return parsed;
}

function code(value: string): BillingEventFailureCode {
  return BillingEventFailureCodeSchema.parse(value);
}

function resultFromTerminal(
  row: BillingEventRow,
  replay: boolean,
): BillingEventProcessingResult {
  if (row.processingState === "APPLIED")
    return {
      kind: "APPLIED",
      replay,
      billingEventId: row.id,
      paymentId: row.paymentId,
      subscriptionId: row.subscriptionId,
      subscriptionTransitionId: row.subscriptionTransitionId,
    };
  if (row.processingState === "IGNORED")
    return {
      kind: "IGNORED",
      replay,
      billingEventId: row.id,
      paymentId: row.paymentId,
      subscriptionId: row.subscriptionId,
    };
  return {
    kind: "FAILED",
    replay,
    billingEventId: row.id,
    code: code(row.failureCode ?? "CHECKOUT_CORRUPTED"),
    paymentId: row.paymentId,
    subscriptionId: row.subscriptionId,
  };
}

const eventColumns = `id,provider,event_identity AS "eventIdentity",event_type AS "eventType",
  payload_sha256 AS "payloadSha256",processing_state AS "processingState",
  payment_id AS "paymentId",subscription_id AS "subscriptionId",
  subscription_transition_id AS "subscriptionTransitionId",failure_code AS "failureCode"`;

async function lockAccount(q: Query, accountId: string): Promise<boolean> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `p5-subscription-account:${accountId}`,
  ]);
  const result = await q.query<{ id: string }>(
    "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
    [accountId],
  );
  return Boolean(result.rows[0]);
}

async function audit(
  q: Query,
  context: BillingEventContext,
  action:
    | "PAYMENT_SUCCEEDED"
    | "PAYMENT_FAILED"
    | "PAYMENT_CANCELED"
    | "SUBSCRIPTION_ACTIVATED",
  targetType: "PAYMENT" | "SUBSCRIPTION",
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES('SYSTEM',NULL,$1,$2,$3,$4,'BILLING_EVENT',$5::jsonb)",
    [
      action,
      targetType,
      targetId,
      context.correlationId,
      JSON.stringify(metadata),
    ],
  );
}

async function terminalize(
  q: Query,
  eventId: string,
  state: "APPLIED" | "IGNORED" | "FAILED",
  processedAt: Date,
  refs: {
    paymentId?: string | null;
    subscriptionId?: string | null;
    subscriptionTransitionId?: string | null;
    failureCode?: BillingEventFailureCode | null;
  },
): Promise<BillingEventRow> {
  const updated = await q.query<BillingEventRow>(
    `UPDATE billing_events
        SET processing_state=$1,processed_at=$2,payment_id=$3,subscription_id=$4,
            subscription_transition_id=$5,failure_code=$6
      WHERE id=$7
      RETURNING ${eventColumns}`,
    [
      state,
      processedAt,
      refs.paymentId ?? null,
      refs.subscriptionId ?? null,
      refs.subscriptionTransitionId ?? null,
      refs.failureCode ?? null,
      eventId,
    ],
  );
  if (!updated.rows[0]) throw new Error("BILLING_EVENT_CLAIM_LOST");
  if (refs.paymentId) {
    const retryable = new Set([
      "CURRENT_SUBSCRIPTION_CONFLICT",
      "PAYMENT_STATE_CONFLICT",
      "PAYMENT_SUBSCRIPTION_CORRUPTED",
    ]);
    if (state === "FAILED" && retryable.has(refs.failureCode ?? "")) {
      await q.query(
        `UPDATE billing_reconciliation_jobs
            SET state='READY',next_attempt_at=GREATEST(CURRENT_TIMESTAMP,created_at),lease_token=NULL,lease_until=NULL,
                last_result_code=$1,updated_at=GREATEST(CURRENT_TIMESTAMP,created_at)
          WHERE payment_id=$2 AND state IN ('READY','LEASED')`,
        [refs.failureCode, refs.paymentId],
      );
    } else {
      await q.query(
        `UPDATE billing_reconciliation_jobs
            SET state=$1,next_attempt_at=NULL,lease_token=NULL,lease_until=NULL,
                last_result_code=$2,updated_at=GREATEST(CURRENT_TIMESTAMP,created_at)
          WHERE payment_id=$3 AND state IN ('READY','LEASED')`,
        [
          state === "FAILED" ? "BLOCKED" : "SETTLED",
          state === "FAILED" ? refs.failureCode : null,
          refs.paymentId,
        ],
      );
    }
  }
  return updated.rows[0];
}

async function findPayment(
  q: Query,
  event: VerifiedBillingEvent,
  lock: boolean,
): Promise<PaymentRow | undefined> {
  const result = await q.query<PaymentRow>(
    `SELECT id,account_id AS "accountId",subscription_id AS "subscriptionId",provider,
            provider_payment_id AS "providerPaymentId",price_revision_id AS "priceRevisionId",
            amount_minor AS "amountMinor",currency,state,created_at AS "createdAt"
       FROM payments WHERE provider=$1 AND provider_payment_id=$2${lock ? " FOR UPDATE" : ""}`,
    [event.provider, event.providerPaymentId],
  );
  return result.rows[0];
}

async function findCheckout(
  q: Query,
  paymentId: string,
): Promise<CheckoutRow | undefined> {
  const result = await q.query<CheckoutRow>(
    `SELECT id,account_id AS "accountId",price_revision_id AS "priceRevisionId",
            plan_revision_id AS "planRevisionId",provider,state,
            provider_payment_id AS "providerPaymentId",payment_id AS "paymentId",
            amount_minor AS "amountMinor",currency,
            billing_interval_unit AS "billingIntervalUnit",
            billing_interval_count AS "billingIntervalCount"
       FROM checkout_intents WHERE payment_id=$1 FOR UPDATE`,
    [paymentId],
  );
  return result.rows[0];
}

function eventState(type: BillingEventType): PaymentState {
  if (type === "payment.succeeded") return "SUCCEEDED";
  if (type === "payment.failed") return "FAILED";
  return "CANCELED";
}

export function createP5BillingEventRepository(
  runtime: DatabaseRuntime,
): BillingEventApplicationRepository {
  return {
    async applyVerifiedBillingEvent(
      input,
    ): Promise<BillingEventProcessingResult> {
      const event = VerifiedBillingEventSchema.parse(input.event);
      const context = BillingEventContextSchema.parse(input.context);
      return runtime.transaction(async (q) => {
        const inserted = await q.query<BillingEventRow>(
          `INSERT INTO billing_events
             (provider,source,event_identity,event_type,payload_sha256,processing_state,received_at,verified_at)
           VALUES($1,'WEBHOOK',$2,$3,$4,'VERIFIED',$5,$6)
           ON CONFLICT(provider,event_identity) DO NOTHING
           RETURNING ${eventColumns}`,
          [
            event.provider,
            event.eventIdentity,
            event.eventType,
            event.payloadSha256,
            input.receivedAt,
            input.verifiedAt,
          ],
        );
        const claimed = inserted.rows[0];
        const lockedResult = await q.query<BillingEventRow>(
          `SELECT ${eventColumns} FROM billing_events
            WHERE provider=$1 AND event_identity=$2 FOR UPDATE`,
          [event.provider, event.eventIdentity],
        );
        const ledger = lockedResult.rows[0];
        if (!ledger) throw new Error("BILLING_EVENT_CLAIM_LOST");
        if (
          ledger.eventType !== event.eventType ||
          ledger.payloadSha256 !== event.payloadSha256
        )
          return {
            kind: "FAILED",
            replay: true,
            billingEventId: ledger.id,
            code: "EVENT_IDENTITY_CONFLICT",
            paymentId: ledger.paymentId,
            subscriptionId: ledger.subscriptionId,
          };
        if (ledger.processingState !== "VERIFIED")
          return resultFromTerminal(ledger, !claimed);

        const paymentIdentity = await findPayment(q, event, false);
        if (!paymentIdentity) {
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              failureCode: "PAYMENT_NOT_FOUND",
            },
          );
          return resultFromTerminal(failed, false);
        }
        if (
          money(paymentIdentity.amountMinor) !== event.amountMinor ||
          paymentIdentity.currency !== event.currency
        ) {
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              paymentId: paymentIdentity.id,
              failureCode: "PAYMENT_TERMS_MISMATCH",
            },
          );
          return resultFromTerminal(failed, false);
        }
        if (
          event.occurredAt.getTime() < paymentIdentity.createdAt.getTime() ||
          event.occurredAt.getTime() > input.receivedAt.getTime()
        ) {
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              paymentId: paymentIdentity.id,
              failureCode: "EVENT_TIME_INVALID",
            },
          );
          return resultFromTerminal(failed, false);
        }

        if (!(await lockAccount(q, paymentIdentity.accountId)))
          throw new Error("ACCOUNT_NOT_FOUND");
        const payment = await findPayment(q, event, true);
        if (!payment) throw new Error("PAYMENT_NOT_FOUND");
        const desiredState = eventState(event.eventType);

        if (payment.state !== "PENDING") {
          if (payment.state === desiredState && desiredState !== "SUCCEEDED") {
            const ignored = await terminalize(
              q,
              ledger.id,
              "IGNORED",
              input.receivedAt,
              {
                paymentId: payment.id,
              },
            );
            return resultFromTerminal(ignored, false);
          }
          if (payment.state === "SUCCEEDED" && desiredState === "SUCCEEDED") {
            if (!payment.subscriptionId) {
              const failed = await terminalize(
                q,
                ledger.id,
                "FAILED",
                input.receivedAt,
                {
                  paymentId: payment.id,
                  failureCode: "PAYMENT_SUBSCRIPTION_CORRUPTED",
                },
              );
              return resultFromTerminal(failed, false);
            }
            const linked = await q.query<{ id: string }>(
              "SELECT id FROM subscriptions WHERE id=$1 AND account_id=$2",
              [payment.subscriptionId, payment.accountId],
            );
            if (!linked.rows[0]) {
              const failed = await terminalize(
                q,
                ledger.id,
                "FAILED",
                input.receivedAt,
                {
                  paymentId: payment.id,
                  failureCode: "PAYMENT_SUBSCRIPTION_CORRUPTED",
                },
              );
              return resultFromTerminal(failed, false);
            }
            const ignored = await terminalize(
              q,
              ledger.id,
              "IGNORED",
              input.receivedAt,
              {
                paymentId: payment.id,
                subscriptionId: payment.subscriptionId,
              },
            );
            return resultFromTerminal(ignored, false);
          }
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              paymentId: payment.id,
              failureCode: "PAYMENT_STATE_CONFLICT",
            },
          );
          return resultFromTerminal(failed, false);
        }

        if (desiredState !== "SUCCEEDED") {
          const updated = await q.query<{ stateRevision: number }>(
            'UPDATE payments SET state=$1,updated_at=$2 WHERE id=$3 RETURNING 1 AS "stateRevision"',
            [desiredState, input.receivedAt, payment.id],
          );
          if (!updated.rows[0]) throw new Error("PAYMENT_NOT_FOUND");
          await audit(
            q,
            context,
            desiredState === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_CANCELED",
            "PAYMENT",
            payment.id,
            {
              provider: event.provider,
              paymentId: payment.id,
              fromState: "PENDING",
              toState: desiredState,
            },
          );
          const applied = await terminalize(
            q,
            ledger.id,
            "APPLIED",
            input.receivedAt,
            {
              paymentId: payment.id,
            },
          );
          return resultFromTerminal(applied, false);
        }

        await q.query(
          "UPDATE payments SET state='SUCCEEDED',confirmed_at=$1,updated_at=$2 WHERE id=$3",
          [event.occurredAt, input.receivedAt, payment.id],
        );
        await audit(q, context, "PAYMENT_SUCCEEDED", "PAYMENT", payment.id, {
          provider: event.provider,
          paymentId: payment.id,
          fromState: "PENDING",
          toState: "SUCCEEDED",
        });

        const checkout = await findCheckout(q, payment.id);
        const coherentCheckout = Boolean(
          checkout &&
            checkout.state === "READY" &&
            checkout.accountId === payment.accountId &&
            checkout.provider === event.provider &&
            checkout.providerPaymentId === event.providerPaymentId &&
            checkout.paymentId === payment.id &&
            checkout.priceRevisionId === payment.priceRevisionId &&
            money(checkout.amountMinor) === event.amountMinor &&
            checkout.currency === event.currency,
        );
        if (!checkout || !coherentCheckout) {
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              paymentId: payment.id,
              failureCode: checkout
                ? "CHECKOUT_CORRUPTED"
                : "CHECKOUT_NOT_FOUND",
            },
          );
          return resultFromTerminal(failed, false);
        }

        const current = await q.query<{ id: string }>(
          "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1 FOR UPDATE",
          [payment.accountId],
        );
        if (current.rows[0]) {
          const failed = await terminalize(
            q,
            ledger.id,
            "FAILED",
            input.receivedAt,
            {
              paymentId: payment.id,
              failureCode: "CURRENT_SUBSCRIPTION_CONFLICT",
            },
          );
          return resultFromTerminal(failed, false);
        }

        const periodEnd = addUtcCalendarInterval(
          event.occurredAt,
          checkout.billingIntervalUnit,
          checkout.billingIntervalCount,
        );
        const subscription = await q.query<{ id: string }>(
          `INSERT INTO subscriptions
             (account_id,state,state_revision,current_plan_revision_id,bound_price_revision_id,
              started_at,current_period_start,current_period_end,grace_until,cancel_at_period_end,
              canceled_at,suspended_at,state_reason,created_at,updated_at)
           VALUES($1,'ACTIVE',1,$2,$3,$4,$4,$5,NULL,false,NULL,NULL,'BILLING_PAYMENT_SUCCEEDED',$6,$6)
           RETURNING id`,
          [
            payment.accountId,
            checkout.planRevisionId,
            payment.priceRevisionId,
            event.occurredAt,
            periodEnd,
            input.receivedAt,
          ],
        );
        const subscriptionId = subscription.rows[0]?.id;
        if (!subscriptionId) throw new Error("SUBSCRIPTION_CORRUPTED");
        const transition = await q.query<{ id: string }>(
          `INSERT INTO subscription_transitions
             (subscription_id,transition_revision,from_state,to_state,source,source_event_id,
              actor_type,actor_id,reason,occurred_at)
           VALUES($1,1,NULL,'ACTIVE','WEBHOOK',$2,'SYSTEM',NULL,'BILLING_PAYMENT_SUCCEEDED',$3)
           RETURNING id`,
          [subscriptionId, event.eventIdentity, event.occurredAt],
        );
        const transitionId = transition.rows[0]?.id;
        if (!transitionId) throw new Error("SUBSCRIPTION_CORRUPTED");
        await q.query(
          "UPDATE payments SET subscription_id=$1,updated_at=$2 WHERE id=$3 AND subscription_id IS NULL",
          [subscriptionId, input.receivedAt, payment.id],
        );
        await audit(
          q,
          context,
          "SUBSCRIPTION_ACTIVATED",
          "SUBSCRIPTION",
          subscriptionId,
          {
            provider: event.provider,
            subscriptionId,
            state: "ACTIVE",
            stateRevision: 1,
            transitionRevision: 1,
          },
        );
        const applied = await terminalize(
          q,
          ledger.id,
          "APPLIED",
          input.receivedAt,
          {
            paymentId: payment.id,
            subscriptionId,
            subscriptionTransitionId: transitionId,
          },
        );
        return resultFromTerminal(applied, false);
      });
    },
  };
}
