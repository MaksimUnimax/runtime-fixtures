import {
  decideSubscriptionLifecycle,
  subscriptionLifecycleJobIdentity,
  type SubscriptionState,
} from "@product/subscriptions";
import type { DatabaseQuery } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type SubscriptionLifecycleTransitionResult =
  | { kind: "NOOP" }
  | { kind: "CORRUPTED"; subscriptionId: string }
  | {
      kind: "TRANSITIONED";
      subscriptionId: string;
      fromState: SubscriptionState;
      toState: SubscriptionState;
      dueAt: Date;
    };

function date(value: unknown): Date {
  return value instanceof Date
    ? new Date(value.getTime())
    : new Date(String(value));
}

async function lock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function audit(
  q: Query,
  subscriptionId: string,
  correlationId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,$1,'SUBSCRIPTION',$2,$3,'SUBSCRIPTION_LIFECYCLE_JOB',$4::jsonb)`,
    [action, subscriptionId, correlationId, JSON.stringify(metadata)],
  );
}

export async function hasBlockingSubscriptionAt(
  q: Query,
  input: { accountId: string; now: Date },
): Promise<boolean> {
  const found = await q.query<Row>(
    `SELECT id,state,current_period_end AS "currentPeriodEnd",
            grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd"
       FROM subscriptions
      WHERE account_id=$1 AND state <> 'EXPIRED'
      LIMIT 1`,
    [input.accountId],
  );
  const row = found.rows[0];
  if (!row) return false;

  let origin: SubscriptionState | null | undefined;
  if (row.state === "SUSPENDED") {
    const history = await q.query<Row>(
      `SELECT from_state AS "fromState",to_state AS "toState"
         FROM subscription_transitions
        WHERE subscription_id=$1
        ORDER BY transition_revision DESC
        LIMIT 1`,
      [row.id],
    );
    const latest = history.rows[0];
    const legalOrigins: SubscriptionState[] = [
      "TRIAL",
      "ACTIVE",
      "CANCELED",
      "GRACE",
      "PAST_DUE",
    ];
    if (
      !latest ||
      latest.toState !== "SUSPENDED" ||
      !legalOrigins.includes(latest.fromState)
    )
      return true;
    origin = latest.fromState;
  }

  const decision = decideSubscriptionLifecycle({
    state: row.state,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    currentPeriodEnd: date(row.currentPeriodEnd),
    graceUntil: row.graceUntil ? date(row.graceUntil) : null,
    suspendedOrigin: origin,
    now: input.now,
  });
  return !(decision.kind === "TRANSITION" && decision.toState === "EXPIRED");
}

/**
 * Requires the caller's transaction to already hold
 * p5-subscription-account:<accountId>.
 */
export async function transitionDueSubscriptionForAccount(
  q: Query,
  input: {
    accountId: string;
    now: Date;
    correlationId: string;
  },
): Promise<SubscriptionLifecycleTransitionResult> {
  const candidate = await q.query<{ id: string }>(
    "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1",
    [input.accountId],
  );
  const candidateId = candidate.rows[0]?.id;
  if (!candidateId) return { kind: "NOOP" };

  await lock(q, `p5-subscription:${candidateId}`);
  const found = await q.query<Row>(
    `SELECT id,account_id AS "accountId",state,state_revision AS "stateRevision",
            current_plan_revision_id AS "currentPlanRevisionId",
            current_period_end AS "currentPeriodEnd",grace_until AS "graceUntil",
            cancel_at_period_end AS "cancelAtPeriodEnd"
       FROM subscriptions WHERE id=$1 AND account_id=$2 FOR UPDATE`,
    [candidateId, input.accountId],
  );
  const row = found.rows[0];
  if (!row || row.state === "EXPIRED") return { kind: "NOOP" };

  let latest: Row | undefined;
  let origin: SubscriptionState | null | undefined;
  if (row.state === "SUSPENDED") {
    const history = await q.query<Row>(
      `SELECT from_state AS "fromState",to_state AS "toState"
         FROM subscription_transitions WHERE subscription_id=$1
        ORDER BY transition_revision DESC LIMIT 1`,
      [row.id],
    );
    latest = history.rows[0];
    const legalOrigins: SubscriptionState[] = [
      "TRIAL",
      "ACTIVE",
      "CANCELED",
      "GRACE",
      "PAST_DUE",
    ];
    if (
      !latest ||
      latest.toState !== "SUSPENDED" ||
      !legalOrigins.includes(latest.fromState)
    )
      return { kind: "CORRUPTED", subscriptionId: row.id };
    origin = latest.fromState;
  }

  const decision = decideSubscriptionLifecycle({
    state: row.state,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    currentPeriodEnd: date(row.currentPeriodEnd),
    graceUntil: row.graceUntil ? date(row.graceUntil) : null,
    suspendedOrigin: origin,
    now: input.now,
  });
  if (decision.kind === "NOOP") return { kind: "NOOP" };
  if (decision.kind === "CORRUPTED")
    return { kind: "CORRUPTED", subscriptionId: row.id };

  if (row.state !== "SUSPENDED") {
    const history = await q.query<Row>(
      `SELECT from_state AS "fromState",to_state AS "toState"
         FROM subscription_transitions WHERE subscription_id=$1
        ORDER BY transition_revision DESC LIMIT 1`,
      [row.id],
    );
    latest = history.rows[0];
    if (!latest || latest.toState !== row.state)
      return { kind: "CORRUPTED", subscriptionId: row.id };
  }

  const oldRevision = Number(row.stateRevision);
  const sourceEventId = subscriptionLifecycleJobIdentity({
    subscriptionId: row.id,
    oldState: row.state,
    oldStateRevision: oldRevision,
    toState: decision.toState,
    dueAt: decision.dueAt,
  });
  const updated = await q.query<Row>(
    `UPDATE subscriptions SET state=$1,state_revision=state_revision+1,state_reason=$2,
            updated_at=GREATEST($3,created_at)
      WHERE id=$4 RETURNING state_revision AS "stateRevision"`,
    [decision.toState, decision.reason, input.now, row.id],
  );
  const nextTransition = await q.query<Row>(
    `SELECT COALESCE(MAX(transition_revision),0)+1 AS revision
       FROM subscription_transitions WHERE subscription_id=$1`,
    [row.id],
  );
  await q.query(
    `INSERT INTO subscription_transitions
       (subscription_id,transition_revision,from_state,to_state,source,source_event_id,actor_type,actor_id,reason,occurred_at)
     VALUES($1,$2,$3,$4,'JOB',$5,'SYSTEM',NULL,$6,$7)`,
    [
      row.id,
      Number(nextTransition.rows[0]?.revision),
      row.state,
      decision.toState,
      sourceEventId,
      decision.reason,
      decision.dueAt,
    ],
  );
  await audit(
    q,
    row.id,
    input.correlationId,
    decision.toState === "EXPIRED"
      ? "SUBSCRIPTION_EXPIRED"
      : "SUBSCRIPTION_GRACE_ENDED",
    {
      subscriptionId: row.id,
      fromState: row.state,
      toState: decision.toState,
      oldStateRevision: oldRevision,
      newStateRevision: Number(updated.rows[0]?.stateRevision),
      dueAt: decision.dueAt.toISOString(),
      processedAt: input.now.toISOString(),
      planRevisionId: row.currentPlanRevisionId,
    },
  );
  return {
    kind: "TRANSITIONED",
    subscriptionId: row.id,
    fromState: row.state,
    toState: decision.toState,
    dueAt: decision.dueAt,
  };
}
