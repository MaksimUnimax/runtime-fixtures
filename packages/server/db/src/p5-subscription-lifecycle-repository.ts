import {
  decideSubscriptionLifecycle,
  subscriptionLifecycleJobIdentity,
  type SubscriptionState,
} from "@product/subscriptions";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Query = Pick<DatabaseQuery, "query">;
// SQL row shapes are deliberately local to this repository; PostgreSQL aliases are validated by the queries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type SubscriptionLifecycleProcessSummary = {
  scanned: number;
  transitioned: number;
  corrupted: number;
};
export interface SubscriptionLifecycleJobRepository {
  processDue(input: {
    now: Date;
    batchSize: number;
    correlationId: string;
  }): Promise<SubscriptionLifecycleProcessSummary>;
}
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
  action: string,
  id: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES('SYSTEM',NULL,$1,'SUBSCRIPTION',$2,$3,'SUBSCRIPTION_LIFECYCLE_JOB',$4::jsonb)`,
    [action, id, correlationId, JSON.stringify(metadata)],
  );
}
export function createP5SubscriptionLifecycleRepository(
  runtime: DatabaseRuntime,
): SubscriptionLifecycleJobRepository {
  return {
    async processDue({ now, batchSize, correlationId }) {
      const candidates = await runtime.query<Row>(
        `SELECT id,account_id AS "accountId" FROM subscriptions
          WHERE state IN ('TRIAL','ACTIVE','CANCELED') AND current_period_end <= $1
             OR state='GRACE' AND (grace_until IS NULL OR grace_until <= $1)
             OR state='SUSPENDED' AND (current_period_end <= $1 OR grace_until <= $1)
          ORDER BY updated_at,id LIMIT $2`,
        [now, batchSize],
      );
      let transitioned = 0;
      let corrupted = 0;
      for (const candidate of candidates.rows) {
        const outcome = await runtime.transaction(async (q) => {
          await lock(q, `p5-subscription-account:${candidate.accountId}`);
          await lock(q, `p5-subscription:${candidate.id}`);
          const found = await q.query<Row>(
            `SELECT id,account_id AS "accountId",state,state_revision AS "stateRevision",current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",current_period_end AS "currentPeriodEnd",grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",updated_at AS "updatedAt" FROM subscriptions WHERE id=$1 FOR UPDATE`,
            [candidate.id],
          );
          const row = found.rows[0];
          if (!row || row.state === "EXPIRED") return "noop";
          let origin: SubscriptionState | null | undefined;
          if (row.state === "SUSPENDED") {
            const history = await q.query<Row>(
              `SELECT from_state AS "fromState" FROM subscription_transitions WHERE subscription_id=$1 AND to_state='SUSPENDED' ORDER BY transition_revision DESC LIMIT 1`,
              [row.id],
            );
            origin = history.rows[0]?.fromState ?? null;
          }
          const decision = decideSubscriptionLifecycle({
            state: row.state,
            cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
            currentPeriodEnd: date(row.currentPeriodEnd),
            graceUntil: row.graceUntil ? date(row.graceUntil) : null,
            suspendedOrigin: origin,
            now,
          });
          if (decision.kind === "NOOP") return "noop";
          if (decision.kind === "CORRUPTED") return "corrupt";
          const oldRevision = Number(row.stateRevision);
          const sourceEventId = subscriptionLifecycleJobIdentity({
            subscriptionId: row.id,
            oldState: row.state,
            oldStateRevision: oldRevision,
            toState: decision.toState,
            dueAt: decision.dueAt,
          });
          const updated = await q.query<Row>(
            `UPDATE subscriptions SET state=$1,state_revision=state_revision+1,state_reason=$2,updated_at=GREATEST($3,created_at) WHERE id=$4 RETURNING state_revision AS "stateRevision"`,
            [decision.toState, decision.reason, now, row.id],
          );
          const nextTransition = await q.query<Row>(
            `SELECT COALESCE(MAX(transition_revision),0)+1 AS revision FROM subscription_transitions WHERE subscription_id=$1`,
            [row.id],
          );
          await q.query(
            `INSERT INTO subscription_transitions(subscription_id,transition_revision,from_state,to_state,source,source_event_id,actor_type,actor_id,reason,occurred_at) VALUES($1,$2,$3,$4,'JOB',$5,'SYSTEM',NULL,$6,$7)`,
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
            decision.toState === "EXPIRED"
              ? "SUBSCRIPTION_EXPIRED"
              : "SUBSCRIPTION_GRACE_ENDED",
            row.id,
            correlationId,
            {
              subscriptionId: row.id,
              fromState: row.state,
              toState: decision.toState,
              oldStateRevision: oldRevision,
              newStateRevision: Number(updated.rows[0]?.stateRevision),
              dueAt: decision.dueAt.toISOString(),
              processedAt: now.toISOString(),
              planRevisionId: row.currentPlanRevisionId,
            },
          );
          return "transition";
        });
        if (outcome === "transition") transitioned++;
        if (outcome === "corrupt") corrupted++;
      }
      return { scanned: candidates.rows.length, transitioned, corrupted };
    },
  };
}
