import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { transitionDueSubscriptionForAccount } from "./p5-subscription-lifecycle-transition.js";

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
async function lock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
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
          const result = await transitionDueSubscriptionForAccount(q, {
            accountId: candidate.accountId,
            now,
            correlationId,
          });
          return result.kind;
        });
        if (outcome === "TRANSITIONED") transitioned++;
        if (outcome === "CORRUPTED") corrupted++;
      }
      return { scanned: candidates.rows.length, transitioned, corrupted };
    },
  };
}
