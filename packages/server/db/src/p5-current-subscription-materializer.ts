import {
  decideSubscriptionLifecycle,
  subscriptionLifecycleJobIdentity,
  type SubscriptionLifecycleDecision,
  type SubscriptionState,
} from "@product/subscriptions";
import type { DatabaseQuery } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
type Row = {
  id: string;
  accountId: string;
  state: SubscriptionState;
  stateRevision: number | string;
  currentPlanRevisionId: string;
  currentPeriodEnd: Date;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
};

type Classified = {
  row: Row;
  decision: SubscriptionLifecycleDecision;
};

export type CurrentSubscriptionMaterialization =
  | { kind: "NONE" }
  | { kind: "CURRENT"; subscriptionId: string; state: SubscriptionState }
  | { kind: "CORRUPTED"; subscriptionId: string };

function revision(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("SUBSCRIPTION_CORRUPTED");
  return parsed;
}

async function classify(
  q: Query,
  input: { accountId: string; at: Date; lockRow: boolean },
): Promise<Classified | null> {
  const found = await q.query<Row>(
    `SELECT id,account_id AS "accountId",state,state_revision AS "stateRevision",
            current_plan_revision_id AS "currentPlanRevisionId",
            current_period_end AS "currentPeriodEnd",grace_until AS "graceUntil",
            cancel_at_period_end AS "cancelAtPeriodEnd"
       FROM subscriptions
      WHERE account_id=$1 AND state <> 'EXPIRED'
      LIMIT 1${input.lockRow ? " FOR UPDATE" : ""}`,
    [input.accountId],
  );
  const row = found.rows[0];
  if (!row) return null;
  let suspendedOrigin: SubscriptionState | null | undefined;
  if (row.state === "SUSPENDED") {
    const history = await q.query<{ fromState: SubscriptionState | null }>(
      `SELECT from_state AS "fromState"
         FROM subscription_transitions
        WHERE subscription_id=$1 AND to_state='SUSPENDED'
        ORDER BY transition_revision DESC LIMIT 1`,
      [row.id],
    );
    suspendedOrigin = history.rows[0]?.fromState ?? null;
  }

  return {
    row,
    decision: decideSubscriptionLifecycle({
      state: row.state,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      currentPeriodEnd: new Date(row.currentPeriodEnd),
      graceUntil: row.graceUntil ? new Date(row.graceUntil) : null,
      suspendedOrigin,
      now: input.at,
    }),
  };
}

/**
 * Read-only preflight view. A due transition to EXPIRED no longer blocks a new
 * checkout even if the 30s lifecycle worker has not materialized it yet.
 * Corrupted or non-expiring/current states stay fail-closed as current.
 */
export async function hasCurrentSubscriptionAt(
  q: Query,
  input: { accountId: string; at: Date },
): Promise<boolean> {
  const classified = await classify(q, { ...input, lockRow: false });
  if (!classified) return false;
  return !(
    classified.decision.kind === "TRANSITION" &&
    classified.decision.toState === "EXPIRED"
  );
}
/**
 * Caller MUST already hold the p5-subscription-account advisory transaction
 * lock. This materializes the same due transition as the shared lifecycle
 * worker before grant/checkout/billing/reconciliation checks the partial
 * current-subscription uniqueness boundary.
 */
export async function materializeDueCurrentSubscriptionLocked(
  q: Query,
  input: { accountId: string; at: Date; correlationId: string },
): Promise<CurrentSubscriptionMaterialization> {
  const classified = await classify(q, { ...input, lockRow: true });
  if (!classified) return { kind: "NONE" };
  const { row, decision } = classified;

  if (decision.kind === "CORRUPTED")
    return { kind: "CORRUPTED", subscriptionId: row.id };
  if (decision.kind === "NOOP")
    return { kind: "CURRENT", subscriptionId: row.id, state: row.state };

  const oldRevision = revision(row.stateRevision);
  const updated = await q.query<{ stateRevision: number | string }>(
    `UPDATE subscriptions
        SET state=$1,state_revision=state_revision+1,state_reason=$2,
            updated_at=GREATEST(updated_at,$3,created_at)
      WHERE id=$4
      RETURNING state_revision AS "stateRevision"`,
    [decision.toState, decision.reason, input.at, row.id],
  );
  const newRevision = revision(updated.rows[0]?.stateRevision ?? 0);
  const next = await q.query<{ revision: number | string }>(
    `SELECT COALESCE(MAX(transition_revision),0)+1 AS revision
       FROM subscription_transitions WHERE subscription_id=$1`,
    [row.id],
  );
  const transitionRevision = revision(next.rows[0]?.revision ?? 0);
  const sourceEventId = subscriptionLifecycleJobIdentity({
    subscriptionId: row.id,
    oldState: row.state,
    oldStateRevision: oldRevision,
    toState: decision.toState,
    dueAt: decision.dueAt,
  });
  await q.query(
    `INSERT INTO subscription_transitions
       (subscription_id,transition_revision,from_state,to_state,source,source_event_id,
        actor_type,actor_id,reason,occurred_at)
     VALUES($1,$2,$3,$4,'SYSTEM',$5,'SYSTEM',NULL,$6,$7)`,
    [
      row.id,
      transitionRevision,
      row.state,
      decision.toState,
      sourceEventId,
      decision.reason,
      decision.dueAt,
    ],
  );
  await q.query(
    `INSERT INTO audit_events
       (actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES('SYSTEM',NULL,$1,'SUBSCRIPTION',$2,$3,'SUBSCRIPTION_LIFECYCLE_INLINE',$4::jsonb)`,
    [
      decision.toState === "EXPIRED"
        ? "SUBSCRIPTION_EXPIRED"
        : "SUBSCRIPTION_GRACE_ENDED",
      row.id,
      input.correlationId,
      JSON.stringify({
        subscriptionId: row.id,
        fromState: row.state,
        toState: decision.toState,
        oldStateRevision: oldRevision,
        newStateRevision: newRevision,
        transitionRevision,
        dueAt: decision.dueAt.toISOString(),
        processedAt: input.at.toISOString(),
        planRevisionId: row.currentPlanRevisionId,
        materialization: "INLINE_BEFORE_MUTATION",
      }),
    ],
  );

  return decision.toState === "EXPIRED"
    ? { kind: "NONE" }
    : { kind: "CURRENT", subscriptionId: row.id, state: decision.toState };
}
