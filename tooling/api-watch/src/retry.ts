import { randomUUID } from "node:crypto";
import type {
  AcquisitionOutcome,
  ApiWatchRetryFailureClass,
  ApiWatchRetryState,
  ApiWatchRetryStore,
  ApiWatchSqlRuntime,
  SwaggerSourceFamily,
} from "./types.js";

function clone(value: ApiWatchRetryState): ApiWatchRetryState {
  return {
    ...value,
    nextRetryAt: value.nextRetryAt ? new Date(value.nextRetryAt) : null,
    lastAttemptAt: new Date(value.lastAttemptAt),
    updatedAt: new Date(value.updatedAt),
  };
}
export class InMemoryApiWatchRetryStore implements ApiWatchRetryStore {
  private readonly states = new Map<SwaggerSourceFamily, ApiWatchRetryState>();
  async get(family: SwaggerSourceFamily) {
    const value = this.states.get(family);
    return value ? clone(value) : undefined;
  }
  async save(value: ApiWatchRetryState) {
    this.states.set(value.sourceFamily, clone(value));
    return clone(value);
  }
  async clear(family: SwaggerSourceFamily) {
    this.states.delete(family);
  }
  async list() {
    return [...this.states.values()]
      .map(clone)
      .sort((a, b) => a.sourceFamily.localeCompare(b.sourceFamily));
  }
}

export function createPostgresApiWatchRetryStore(
  runtime: ApiWatchSqlRuntime,
): ApiWatchRetryStore {
  const projection = `SELECT source_family AS "sourceFamily",failure_episode_id AS "failureEpisodeId",failure_class AS "failureClass",retry_count AS "retryCount",next_retry_at AS "nextRetryAt",last_attempt_at AS "lastAttemptAt",last_result AS "lastResult",updated_at AS "updatedAt" FROM api_watch_retry_state`;
  const map = (row: Record<string, unknown>) =>
    ({
      ...row,
      nextRetryAt: row.nextRetryAt
        ? new Date(row.nextRetryAt as string | Date)
        : null,
      lastAttemptAt: new Date(row.lastAttemptAt as string | Date),
      updatedAt: new Date(row.updatedAt as string | Date),
    }) as unknown as ApiWatchRetryState;
  return {
    async get(family) {
      const result = await runtime.query<Record<string, unknown>>(
        `${projection} WHERE source_family=$1`,
        [family],
      );
      return result.rows[0] ? map(result.rows[0]) : undefined;
    },
    async save(value) {
      await runtime.query(
        `INSERT INTO api_watch_retry_state(source_family,failure_episode_id,failure_class,retry_count,next_retry_at,last_attempt_at,last_result,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (source_family) DO UPDATE SET failure_episode_id=EXCLUDED.failure_episode_id,failure_class=EXCLUDED.failure_class,retry_count=EXCLUDED.retry_count,next_retry_at=EXCLUDED.next_retry_at,last_attempt_at=EXCLUDED.last_attempt_at,last_result=EXCLUDED.last_result,updated_at=EXCLUDED.updated_at`,
        [
          value.sourceFamily,
          value.failureEpisodeId,
          value.failureClass,
          value.retryCount,
          value.nextRetryAt,
          value.lastAttemptAt,
          value.lastResult,
          value.updatedAt,
        ],
      );
      return value;
    },
    async clear(family) {
      await runtime.query(
        `DELETE FROM api_watch_retry_state WHERE source_family=$1`,
        [family],
      );
    },
    async list() {
      const result = await runtime.query<Record<string, unknown>>(
        `${projection} ORDER BY source_family`,
      );
      return result.rows.map(map);
    },
  };
}

export function retryFailureClass(
  outcome: AcquisitionOutcome,
): ApiWatchRetryFailureClass | null {
  if (outcome.kind !== "SOURCE_TEMPORARILY_UNAVAILABLE") return null;
  if (outcome.httpStatus === 429) return "HTTP_429";
  if (outcome.httpStatus !== undefined && outcome.httpStatus >= 500)
    return "HTTP_5XX";
  return /timed out/i.test(outcome.blockerReason) ? "TIMEOUT" : "NETWORK";
}

export async function applyRetryDecision(input: {
  sourceFamily: SwaggerSourceFamily;
  outcome: AcquisitionOutcome;
  store: ApiWatchRetryStore;
  scheduleEarlier?: (retryAt: Date) => Promise<void>;
  now?: Date;
}): Promise<ApiWatchRetryState | undefined> {
  const now = input.now ?? new Date();
  const failureClass = retryFailureClass(input.outcome);
  if (!failureClass) {
    if (input.outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE")
      await input.store.clear(input.sourceFamily);
    return undefined;
  }
  const previous = await input.store.get(input.sourceFamily);
  const retryCount =
    previous?.failureClass === failureClass ? previous.retryCount : 0;
  const max = failureClass === "HTTP_429" ? 1 : 2;
  if (retryCount >= max) {
    const exhausted = previous ?? {
      sourceFamily: input.sourceFamily,
      failureEpisodeId: randomUUID(),
      failureClass,
      retryCount,
      nextRetryAt: null,
      lastAttemptAt: now,
      lastResult: input.outcome.kind,
      updatedAt: now,
    };
    return input.store.save({
      ...exhausted,
      nextRetryAt: null,
      lastAttemptAt: now,
      lastResult: input.outcome.kind,
      updatedAt: now,
    });
  }
  const delayMs =
    failureClass === "HTTP_429"
      ? Math.min(
          6 * 60 * 60 * 1000,
          Math.max(
            5 * 60 * 1000,
            ((input.outcome as { retryAfterSeconds?: number | null })
              .retryAfterSeconds ?? 60 * 60) * 1000,
          ),
        )
      : retryCount === 0
        ? 15 * 60 * 1000
        : 60 * 60 * 1000;
  const nextRetryAt = new Date(now.valueOf() + delayMs);
  const state = await input.store.save({
    sourceFamily: input.sourceFamily,
    failureEpisodeId: previous?.failureEpisodeId ?? randomUUID(),
    failureClass,
    retryCount: retryCount + 1,
    nextRetryAt,
    lastAttemptAt: now,
    lastResult: input.outcome.kind,
    updatedAt: now,
  });
  if (input.scheduleEarlier) await input.scheduleEarlier(nextRetryAt);
  return state;
}
