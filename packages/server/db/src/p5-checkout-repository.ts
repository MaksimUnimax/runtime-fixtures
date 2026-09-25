import {
  CheckoutContextSchema,
  CheckoutFailureCodeSchema,
  ProviderCheckoutResultSchema,
  type CheckoutAccountObservation,
  type CheckoutFinalizeResult,
  type CheckoutInspection,
  type CheckoutIntent,
  type CheckoutPrepareInput,
  type CheckoutPrepareResult,
  type CheckoutRepository,
  type CheckoutFailureCode,
} from "@product/billing";
import type { BillingIntervalUnit } from "@product/billing";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
type Row = {
  id: string;
  accountId: string;
  priceRevisionId: string;
  planRevisionId: string;
  provider: string;
  state: "CREATING" | "READY" | "FAILED";
  idempotencyKeyHash: string;
  requestFingerprintSha256: string;
  admittedAt: Date;
  amountMinor: number | string;
  currency: string;
  billingIntervalUnit: BillingIntervalUnit;
  billingIntervalCount: number;
  providerCheckoutId: string | null;
  providerPaymentId: string | null;
  checkoutReference: string | null;
  paymentId: string | null;
  paymentState:
    | "PENDING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "REFUNDED"
    | "CHARGEBACK"
    | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

function amount(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("CHECKOUT_CORRUPTED");
  return result;
}

function failure(value: string | null): CheckoutFailureCode | null {
  if (value === null) return null;
  const result = CheckoutFailureCodeSchema.safeParse(value);
  return result.success ? result.data : null;
}

function snapshot(row: Row): CheckoutIntent {
  return {
    id: row.id,
    accountId: row.accountId,
    priceRevisionId: row.priceRevisionId,
    planRevisionId: row.planRevisionId,
    provider: row.provider,
    state: row.state,
    idempotencyKeyHash: row.idempotencyKeyHash,
    requestFingerprintSha256: row.requestFingerprintSha256,
    admittedAt: row.admittedAt,
    amountMinor: amount(row.amountMinor),
    currency: row.currency,
    billingIntervalUnit: row.billingIntervalUnit,
    billingIntervalCount: row.billingIntervalCount,
    providerCheckoutId: row.providerCheckoutId,
    providerPaymentId: row.providerPaymentId,
    checkoutReference: row.checkoutReference,
    paymentId: row.paymentId,
    paymentState: row.paymentState ?? null,
    failureCode: failure(row.failureCode),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

const intentColumns = `i.id,i.account_id AS "accountId",i.price_revision_id AS "priceRevisionId",
  i.plan_revision_id AS "planRevisionId",i.provider,i.state,i.idempotency_key_hash AS "idempotencyKeyHash",
  i.request_fingerprint_sha256 AS "requestFingerprintSha256",i.admitted_at AS "admittedAt",
  i.amount_minor AS "amountMinor",i.currency,i.billing_interval_unit AS "billingIntervalUnit",
  i.billing_interval_count AS "billingIntervalCount",i.provider_checkout_id AS "providerCheckoutId",
  i.provider_payment_id AS "providerPaymentId",i.checkout_reference AS "checkoutReference",
  i.payment_id AS "paymentId",p.state AS "paymentState",i.failure_code AS "failureCode",i.created_at AS "createdAt",
  i.updated_at AS "updatedAt",i.completed_at AS "completedAt"`;

const intentReturningColumns = `id,account_id AS "accountId",price_revision_id AS "priceRevisionId",
  plan_revision_id AS "planRevisionId",provider,state,idempotency_key_hash AS "idempotencyKeyHash",
  request_fingerprint_sha256 AS "requestFingerprintSha256",admitted_at AS "admittedAt",
  amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",
  billing_interval_count AS "billingIntervalCount",provider_checkout_id AS "providerCheckoutId",
  provider_payment_id AS "providerPaymentId",checkout_reference AS "checkoutReference",
  payment_id AS "paymentId",NULL::payment_state AS "paymentState",failure_code AS "failureCode",created_at AS "createdAt",
  updated_at AS "updatedAt",completed_at AS "completedAt"`;

const intentFrom = `checkout_intents i LEFT JOIN payments p ON p.id=i.payment_id`;

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

async function accountPolicy(
  q: Query,
  accountId: string,
  actorId: string,
): Promise<CheckoutAccountObservation> {
  const account = await q.query<{ status: "ACTIVE" | "SUSPENDED" }>(
    "SELECT status FROM accounts WHERE id=$1",
    [accountId],
  );
  if (!account.rows[0])
    return {
      accountExists: false,
      owner: false,
      accountStatus: null,
      hasCurrentSubscription: false,
    };
  const member = await q.query<{ userId: string }>(
    "SELECT user_id AS \"userId\" FROM account_memberships WHERE account_id=$1 AND user_id=$2 AND role='OWNER'",
    [accountId, actorId],
  );
  const current = await q.query<{ id: string }>(
    "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1",
    [accountId],
  );
  return {
    accountExists: true,
    owner: Boolean(member.rows[0]),
    accountStatus: account.rows[0].status,
    hasCurrentSubscription: Boolean(current.rows[0]),
  };
}

async function loadIntent(
  q: Query,
  accountId: string,
  hash: string,
  lock = false,
): Promise<CheckoutIntent | null> {
  const result = await q.query<Row>(
    `SELECT ${intentColumns} FROM ${intentFrom} WHERE i.account_id=$1 AND i.idempotency_key_hash=$2${lock ? " FOR UPDATE OF i" : ""}`,
    [accountId, hash],
  );
  return result.rows[0] ? snapshot(result.rows[0]) : null;
}

/**
 * This runs only while the account advisory lock is held.  READY cannot be
 * indexed as actionable: P5.4 will decide whether terminal payment states can
 * admit a later checkout.  Until then an unexpected relation is fail-closed.
 */
async function otherActionableIntent(
  q: Query,
  accountId: string,
  idempotencyKeyHash: string,
): Promise<"CHECKOUT_IN_PROGRESS" | "CHECKOUT_CORRUPTED" | null> {
  const result = await q.query<{
    state: Row["state"];
    paymentState: string | null;
    paymentId: string | null;
  }>(
    `SELECT i.state,i.payment_id AS "paymentId",p.state AS "paymentState"
       FROM checkout_intents i
       LEFT JOIN payments p ON p.id=i.payment_id
      WHERE i.account_id=$1 AND i.idempotency_key_hash <> $2
        AND i.state IN ('CREATING','READY')
      FOR UPDATE OF i`,
    [accountId, idempotencyKeyHash],
  );
  for (const row of result.rows) {
    if (row.state === "CREATING") return "CHECKOUT_IN_PROGRESS";
    if (!row.paymentId || !row.paymentState) return "CHECKOUT_CORRUPTED";
    if (row.paymentState === "PENDING") return "CHECKOUT_IN_PROGRESS";
    if (row.paymentState === "FAILED" || row.paymentState === "CANCELED")
      continue;
    return "CHECKOUT_CORRUPTED";
  }
  return null;
}

async function audit(
  q: Query,
  context: {
    actorType: "ACCOUNT_USER";
    actorId: string;
    correlationId: string;
  },
  action: "CHECKOUT_INTENT_CREATED" | "CHECKOUT_READY" | "CHECKOUT_FAILED",
  intentId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,$2,$3,'CHECKOUT_INTENT',$4,$5,NULL,$6::jsonb)",
    [
      context.actorType,
      context.actorId,
      action,
      intentId,
      context.correlationId,
      JSON.stringify(metadata),
    ],
  );
}

async function terminalFailure(
  q: Query,
  intent: CheckoutIntent,
  code: CheckoutFailureCode,
  context: {
    actorType: "ACCOUNT_USER";
    actorId: string;
    correlationId: string;
  },
  completedAt: Date,
): Promise<CheckoutFinalizeResult> {
  if (intent.state !== "CREATING") {
    return intent.state === "READY"
      ? { kind: "READY", intent }
      : {
          kind: "FAILED",
          intent,
          code: intent.failureCode ?? "CHECKOUT_CORRUPTED",
        };
  }
  const updated = await q.query<Row>(
    `UPDATE checkout_intents SET state='FAILED',failure_code=$1,updated_at=GREATEST(CURRENT_TIMESTAMP,$2),completed_at=GREATEST(CURRENT_TIMESTAMP,$2) WHERE id=$3 RETURNING ${intentReturningColumns}`,
    [code, completedAt, intent.id],
  );
  const next = snapshot(updated.rows[0]!);
  await audit(q, context, "CHECKOUT_FAILED", next.id, {
    accountId: next.accountId,
    planRevisionId: next.planRevisionId,
    priceRevisionId: next.priceRevisionId,
    provider: next.provider,
    state: next.state,
    paymentId: null,
    failureCode: code,
  });
  return { kind: "FAILED", intent: next, code };
}

export type P5CheckoutRepositoryOptions = { now?: () => Date };

export function createP5CheckoutRepository(
  runtime: DatabaseRuntime,
  options: P5CheckoutRepositoryOptions = {},
): CheckoutRepository {
  const now = options.now ?? (() => new Date());
  return {
    async inspectCheckout({
      accountId,
      actorId,
      idempotencyKeyHash,
    }): Promise<CheckoutInspection> {
      return runtime.transaction(async (q) => {
        const account = await accountPolicy(q, accountId, actorId);
        const intent =
          account.accountExists && account.owner
            ? await loadIntent(q, accountId, idempotencyKeyHash)
            : null;
        return { account, intent };
      });
    },

    async prepareCheckout(
      input: CheckoutPrepareInput,
    ): Promise<CheckoutPrepareResult> {
      const context = CheckoutContextSchema.parse(input.context);
      return runtime.transaction(async (q) => {
        if (!(await lockAccount(q, input.accountId)))
          return { kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" };
        const account = await accountPolicy(q, input.accountId, input.actorId);
        const existing = await loadIntent(
          q,
          input.accountId,
          input.idempotencyKeyHash,
          true,
        );
        if (existing) {
          if (
            existing.requestFingerprintSha256 !== input.requestFingerprintSha256
          )
            return { kind: "REJECTED", code: "IDEMPOTENCY_KEY_REUSED" };
          if (existing.provider !== input.provider)
            return { kind: "REJECTED", code: "CHECKOUT_PROVIDER_MISMATCH" };
          const blocked = !account.accountExists
            ? "ACCOUNT_NOT_FOUND"
            : !account.owner
              ? "FORBIDDEN"
              : account.accountStatus === "SUSPENDED"
                ? "ACCOUNT_SUSPENDED"
                : account.hasCurrentSubscription
                  ? "CURRENT_SUBSCRIPTION_EXISTS"
                  : null;
          if (blocked && existing.state === "CREATING") {
            const terminal = await terminalFailure(
              q,
              existing,
              blocked,
              context,
              now(),
            );
            return terminal.kind === "FAILED"
              ? { kind: "EXISTING", intent: terminal.intent }
              : { kind: "EXISTING", intent: existing };
          }
          return { kind: "EXISTING", intent: existing };
        }
        if (!account.accountExists)
          return { kind: "REJECTED", code: "ACCOUNT_NOT_FOUND" };
        if (!account.owner) return { kind: "REJECTED", code: "FORBIDDEN" };
        if (account.accountStatus === "SUSPENDED")
          return { kind: "REJECTED", code: "ACCOUNT_SUSPENDED" };
        if (account.hasCurrentSubscription)
          return { kind: "REJECTED", code: "CURRENT_SUBSCRIPTION_EXISTS" };
        const actionable = await otherActionableIntent(
          q,
          input.accountId,
          input.idempotencyKeyHash,
        );
        if (actionable) return { kind: "REJECTED", code: actionable };
        const inserted = await q.query<Row>(
          `INSERT INTO checkout_intents
             (account_id,price_revision_id,plan_revision_id,provider,state,idempotency_key_hash,request_fingerprint_sha256,
              admitted_at,amount_minor,currency,billing_interval_unit,billing_interval_count)
           VALUES($1,$2,$3,$4,'CREATING',$5,$6,$7,$8,$9,$10,$11)
           RETURNING ${intentReturningColumns}`,
          [
            input.accountId,
            input.offer.priceRevisionId,
            input.offer.planRevisionId,
            input.provider,
            input.idempotencyKeyHash,
            input.requestFingerprintSha256,
            input.admittedAt,
            input.offer.amountMinor,
            input.offer.currency,
            input.offer.billingIntervalUnit,
            input.offer.billingIntervalCount,
          ],
        );
        const intent = snapshot(inserted.rows[0]!);
        await audit(q, context, "CHECKOUT_INTENT_CREATED", intent.id, {
          accountId: intent.accountId,
          planRevisionId: intent.planRevisionId,
          priceRevisionId: intent.priceRevisionId,
          provider: intent.provider,
          state: intent.state,
        });
        return { kind: "CREATED", intent };
      });
    },

    async finalizeCheckout({
      intentId,
      provider,
      context: rawContext,
      result: rawResult,
    }): Promise<CheckoutFinalizeResult> {
      const context = CheckoutContextSchema.parse(rawContext);
      const result = ProviderCheckoutResultSchema.parse(rawResult);
      return runtime.transaction(async (q) => {
        const found = await q.query<Row>(
          `SELECT account_id AS "accountId" FROM checkout_intents WHERE id=$1`,
          [intentId],
        );
        const accountId = found.rows[0]?.accountId;
        if (!accountId || !(await lockAccount(q, accountId)))
          return { kind: "REJECTED", code: "CHECKOUT_CORRUPTED" };
        const lockedResult = await q.query<Row>(
          `SELECT ${intentColumns} FROM ${intentFrom} WHERE i.id=$1 FOR UPDATE OF i`,
          [intentId],
        );
        const locked = snapshot(lockedResult.rows[0]!);
        if (locked.state !== "CREATING")
          return locked.state === "READY"
            ? { kind: "READY", intent: locked }
            : {
                kind: "FAILED",
                intent: locked,
                code: locked.failureCode ?? "CHECKOUT_CORRUPTED",
              };
        const account = await q.query<{ status: "ACTIVE" | "SUSPENDED" }>(
          "SELECT status FROM accounts WHERE id=$1 FOR UPDATE",
          [locked.accountId],
        );
        if (!account.rows[0])
          return { kind: "REJECTED", code: "CHECKOUT_CORRUPTED" };
        if (locked.provider !== provider)
          return { kind: "REJECTED", code: "CHECKOUT_PROVIDER_MISMATCH" };
        if (result.kind === "CREATED") {
          if (account.rows[0].status === "SUSPENDED")
            return await terminalFailure(
              q,
              locked,
              "ACCOUNT_SUSPENDED",
              context,
              now(),
            );
          const subscription = await q.query<{ id: string }>(
            "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1",
            [locked.accountId],
          );
          if (subscription.rows[0])
            return await terminalFailure(
              q,
              locked,
              "CURRENT_SUBSCRIPTION_EXISTS",
              context,
              now(),
            );
          const payment = await q.query<{ id: string }>(
            `INSERT INTO payments
               (account_id,subscription_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256)
             VALUES($1,NULL,$2,$3,$4,$5,$6,'PENDING',$7,$8) RETURNING id`,
            [
              locked.accountId,
              locked.provider,
              result.providerPaymentId,
              locked.priceRevisionId,
              locked.amountMinor,
              locked.currency,
              locked.idempotencyKeyHash,
              locked.requestFingerprintSha256,
            ],
          );
          await q.query(
            `INSERT INTO billing_reconciliation_jobs(payment_id,state,next_attempt_at,attempt_count,created_at,updated_at)
             VALUES($1,'READY',$2,0,$2,$2)`,
            [payment.rows[0]!.id, now()],
          );
          const updated = await q.query<Row>(
            `UPDATE checkout_intents SET state='READY',provider_checkout_id=$1,provider_payment_id=$2,checkout_reference=$3,payment_id=$4,updated_at=GREATEST(CURRENT_TIMESTAMP,$5),completed_at=GREATEST(CURRENT_TIMESTAMP,$5) WHERE id=$6 RETURNING ${intentReturningColumns}`,
            [
              result.providerCheckoutId,
              result.providerPaymentId,
              result.checkoutReference,
              payment.rows[0]!.id,
              now(),
              intentId,
            ],
          );
          const ready = snapshot(updated.rows[0]!);
          await audit(q, context, "CHECKOUT_READY", ready.id, {
            accountId: ready.accountId,
            planRevisionId: ready.planRevisionId,
            priceRevisionId: ready.priceRevisionId,
            provider: ready.provider,
            state: ready.state,
            paymentId: ready.paymentId,
          });
          return { kind: "READY", intent: ready };
        }
        return await terminalFailure(
          q,
          locked,
          "PROVIDER_REJECTED",
          context,
          now(),
        );
      });
    },

    async failCheckout({
      intentId,
      provider,
      context: rawContext,
      code,
    }): Promise<CheckoutFinalizeResult> {
      const context = CheckoutContextSchema.parse(rawContext);
      const checkedCode = CheckoutFailureCodeSchema.parse(code);
      return runtime.transaction(async (q) => {
        const row = await q.query<Row>(
          `SELECT account_id AS "accountId" FROM checkout_intents WHERE id=$1`,
          [intentId],
        );
        const accountId = row.rows[0]?.accountId;
        if (!accountId || !(await lockAccount(q, accountId)))
          return { kind: "REJECTED", code: "CHECKOUT_CORRUPTED" };
        const lockedRow = await q.query<Row>(
          `SELECT ${intentColumns} FROM ${intentFrom} WHERE i.id=$1 FOR UPDATE OF i`,
          [intentId],
        );
        const locked = snapshot(lockedRow.rows[0]!);
        if (locked.provider !== provider)
          return { kind: "REJECTED", code: "CHECKOUT_PROVIDER_MISMATCH" };
        return terminalFailure(q, locked, checkedCode, context, now());
      });
    },
  };
}
