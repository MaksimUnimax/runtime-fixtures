import { SwaggerSourceFamilySchema } from "@product/monitoring-control";
import {
  claimDueApiWatchAttempt,
  enterClaimedApiWatchAttempt,
  expireApiWatchAttemptFence,
  releaseUnenteredApiWatchAttempt,
  type ApiWatchAttemptFence,
} from "./retry-attempt-fence.js";
import type {
  ApiWatchSqlQuery,
  ApiWatchSqlRuntime,
  SwaggerSourceFamily,
} from "./types.js";

/**
 * C03: transactional SOURCE prerequisite for retry-only, per-family ownership.
 *
 * The scheduler has NOT been wired to this repository. It must first commit a
 * trusted ordinary due, a RETRY trigger, and an unexpired lane run reservation.
 * New code must never issue provider egress before enter() has committed.
 * Legacy retry writers still exist and must be migrated atomically before any
 * runtime consumer is enabled. This module does not issue network requests.
 */
type LaneRow = {
  runId: string | null;
  runSource: string | null;
  leaseExpiresAt: Date | null;
  trigger: string | null;
  dueProvenance: string;
  ordinaryNextRunAt: Date | null;
};

type RetryRow = { nextRetryAt: Date | null };

type FenceRow = {
  sourceFamily: string;
  claimStage: ApiWatchAttemptFence["claimStage"];
  claimedRunId: string | null;
  claimedLeaseExpiresAt: Date | null;
  claimedAt: Date | null;
  enteredAt: Date | null;
  outcomeUnknown: boolean;
  updatedAt: Date;
};

function verifiedFamily(value: SwaggerSourceFamily): SwaggerSourceFamily {
  if (!SwaggerSourceFamilySchema.safeParse(value).success)
    throw new Error("API_WATCH_RETRY_FENCE_FAMILY_INVALID");
  return value;
}

function asDate(value: Date | string | null, name: string): Date {
  if (value === null)
    throw new Error("API_WATCH_RETRY_DB_" + name + "_MISSING");
  const date = new Date(value);
  if (!Number.isFinite(Date.prototype.getTime.call(date)))
    throw new Error("API_WATCH_RETRY_DB_" + name + "_INVALID");
  return date;
}

function mapFence(row: FenceRow): ApiWatchAttemptFence {
  return {
    sourceFamily: verifiedFamily(row.sourceFamily as SwaggerSourceFamily),
    claimStage: row.claimStage,
    claimedRunId: row.claimedRunId,
    claimedLeaseExpiresAt: row.claimedLeaseExpiresAt
      ? asDate(row.claimedLeaseExpiresAt, "CLAIM_LEASE")
      : null,
    claimedAt: row.claimedAt ? asDate(row.claimedAt, "CLAIM_TIME") : null,
    enteredAt: row.enteredAt ? asDate(row.enteredAt, "ENTER_TIME") : null,
    outcomeUnknown: row.outcomeUnknown,
    updatedAt: asDate(row.updatedAt, "UPDATED_TIME"),
  };
}

async function lockedContext(
  query: ApiWatchSqlQuery,
  sourceFamily: SwaggerSourceFamily,
) {
  // Uniform lock order across every operation: shared lane, retry, fence.
  // No provider egress or non-DB await inside this critical section.
  const lane = await query.query<LaneRow>(
    `SELECT active_run_id AS "runId",
        active_run_source AS "runSource",
        active_run_lease_expires_at AS "leaseExpiresAt",
        active_run_trigger AS "trigger",
        ordinary_due_provenance AS "dueProvenance",
        ordinary_next_run_at AS "ordinaryNextRunAt"
      FROM monitoring_lane_schedules
      WHERE lane='SWAGGER_API' FOR UPDATE`,
  );
  if (lane.rows.length !== 1) throw new Error("API_WATCH_RETRY_LANE_NOT_FOUND");
  const retry = await query.query<RetryRow>(
    `SELECT next_retry_at AS "nextRetryAt"
       FROM api_watch_retry_state
       WHERE source_family=$1 FOR UPDATE`,
    [sourceFamily],
  );
  const fence = await query.query<FenceRow>(
    `SELECT source_family AS "sourceFamily",
        claim_stage AS "claimStage",
        claimed_run_id AS "claimedRunId",
        claimed_lease_expires_at AS "claimedLeaseExpiresAt",
        claimed_at AS "claimedAt",
        entered_at AS "enteredAt",
        outcome_unknown AS "outcomeUnknown",
        updated_at AS "updatedAt"
      FROM api_watch_family_attempt_fences
      WHERE source_family=$1 FOR UPDATE`,
    [sourceFamily],
  );
  if (fence.rows.length !== 1) throw new Error("API_WATCH_RETRY_FENCE_MISSING");
  // Use the database clock, not caller-supplied clock values or a stale client.
  const clock = await query.query<{ now: Date }>(
    'SELECT clock_timestamp() AS "now"',
  );
  return {
    lane: lane.rows[0]!,
    nextRetryAt: retry.rows[0]?.nextRetryAt ?? null,
    fence: mapFence(fence.rows[0]!),
    now: asDate(clock.rows[0]?.now ?? null, "CLOCK"),
  };
}

function requireActiveRetryLane(
  lane: LaneRow,
  runId: string,
  now: Date,
): { runId: string; leaseExpiresAt: Date } {
  const deadline = lane.leaseExpiresAt
    ? asDate(lane.leaseExpiresAt, "LANE_LEASE")
    : null;
  if (
    lane.runId !== runId ||
    lane.runSource !== "SCHEDULED" ||
    lane.trigger !== "RETRY" ||
    lane.dueProvenance !== "KNOWN" ||
    lane.ordinaryNextRunAt === null ||
    !deadline ||
    Date.prototype.getTime.call(deadline) <= Date.prototype.getTime.call(now)
  )
    throw new Error("API_WATCH_RETRY_LANE_NOT_AUTHORIZED");
  return { runId, leaseExpiresAt: deadline };
}

async function saveFence(
  query: ApiWatchSqlQuery,
  previous: ApiWatchAttemptFence,
  next: ApiWatchAttemptFence,
): Promise<void> {
  const changed = await query.query<{ source_family: string }>(
    `UPDATE api_watch_family_attempt_fences
      SET claim_stage=$2,
          claimed_run_id=$3,
          claimed_lease_expires_at=$4,
          claimed_at=$5,
          entered_at=$6,
          outcome_unknown=$7,
          updated_at=$8
      WHERE source_family=$1
        AND claim_stage=$9
        AND claimed_run_id IS NOT DISTINCT FROM $10::uuid
      RETURNING source_family`,
    [
      previous.sourceFamily,
      next.claimStage,
      next.claimedRunId,
      next.claimedLeaseExpiresAt,
      next.claimedAt,
      next.enteredAt,
      next.outcomeUnknown,
      next.updatedAt,
      previous.claimStage,
      previous.claimedRunId,
    ],
  );
  if (changed.rows.length !== 1)
    throw new Error("API_WATCH_RETRY_FENCE_STALE_WRITER");
}

export function createPostgresApiWatchAttemptFenceRepository(
  runtime: ApiWatchSqlRuntime,
) {
  return {
    async claimDue(sourceFamily: SwaggerSourceFamily, runId: string) {
      verifiedFamily(sourceFamily);
      return runtime.transaction(async (query) => {
        const context = await lockedContext(query, sourceFamily);
        const lease = requireActiveRetryLane(context.lane, runId, context.now);
        const next = claimDueApiWatchAttempt({
          state: context.fence,
          nextRetryAt: context.nextRetryAt,
          lease,
          now: context.now,
        });
        if (!next) return null;
        await saveFence(query, context.fence, next);
        return next;
      });
    },

    /** Commit ENTERED before any caller is allowed to start provider egress. */
    async enter(sourceFamily: SwaggerSourceFamily, runId: string) {
      verifiedFamily(sourceFamily);
      return runtime.transaction(async (query) => {
        const context = await lockedContext(query, sourceFamily);
        const lease = requireActiveRetryLane(context.lane, runId, context.now);
        // A withdrawn/replaced due retry cannot dispatch on a stale claim.
        if (
          !context.nextRetryAt ||
          Date.prototype.getTime.call(context.nextRetryAt) >
            Date.prototype.getTime.call(context.now)
        )
          throw new Error("API_WATCH_RETRY_NO_LONGER_DUE");
        const next = enterClaimedApiWatchAttempt({
          state: context.fence,
          lease,
          now: context.now,
        });
        await saveFence(query, context.fence, next);
        return next;
      });
    },

    /** Explicit cancellation before provider entry only, same owner and lease. */
    async releaseUnentered(sourceFamily: SwaggerSourceFamily, runId: string) {
      verifiedFamily(sourceFamily);
      return runtime.transaction(async (query) => {
        const context = await lockedContext(query, sourceFamily);
        requireActiveRetryLane(context.lane, runId, context.now);
        const next = releaseUnenteredApiWatchAttempt({
          state: context.fence,
          runId,
          now: context.now,
        });
        await saveFence(query, context.fence, next);
        return next;
      });
    },

    /**
     * Recovery after a truly expired lease. ENTERED is quarantined as UNKNOWN;
     * CLAIMED can return to due without consuming next_retry_at.
     */
    async expire(sourceFamily: SwaggerSourceFamily, priorRunId: string) {
      verifiedFamily(sourceFamily);
      return runtime.transaction(async (query) => {
        const context = await lockedContext(query, sourceFamily);
        const activeDeadline = context.lane.leaseExpiresAt;
        if (
          context.lane.runId === priorRunId &&
          activeDeadline &&
          Date.prototype.getTime.call(asDate(activeDeadline, "LANE_LEASE")) >
            Date.prototype.getTime.call(context.now)
        )
          throw new Error("API_WATCH_RETRY_LANE_STILL_ACTIVE");
        const next = expireApiWatchAttemptFence({
          state: context.fence,
          priorRunId,
          now: context.now,
        });
        await saveFence(query, context.fence, next);
        return next;
      });
    },
  };
}
