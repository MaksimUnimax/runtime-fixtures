import { SwaggerSourceFamilySchema } from "@product/monitoring-control";
import type { SwaggerSourceFamily } from "./types.js";

/**
 * A pure transition model for the R16 durable source-family fence rows.
 *
 * It does NOT reserve a monitoring run or make a PostgreSQL transaction.
 * The eventual repository must hold the SWAGGER_API lane lock, then the
 * source-family retry and fence rows in a deterministic order. It must commit
 * the corresponding retry deadline/outcome and this fence in ONE transaction.
 * No provider request is permitted until an ENTERED transition commits.
 */
export type ApiWatchAttemptFence = {
  sourceFamily: SwaggerSourceFamily;
  claimStage: "IDLE" | "CLAIMED" | "ENTERED";
  claimedRunId: string | null;
  /** Persisted original run lease boundary, not a caller's recovery guess. */
  claimedLeaseExpiresAt: Date | null;
  claimedAt: Date | null;
  enteredAt: Date | null;
  outcomeUnknown: boolean;
  updatedAt: Date;
};

export type ApiWatchAttemptLease = {
  runId: string;
  leaseExpiresAt: Date;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTime(date: Date): number {
  if (!(date instanceof Date))
    throw new Error("API_WATCH_RETRY_FENCE_TIME_INVALID");
  // Read the Date internal slot; user-defined valueOf must not forge time.
  let time: number;
  try {
    time = Date.prototype.getTime.call(date);
  } catch {
    throw new Error("API_WATCH_RETRY_FENCE_TIME_INVALID");
  }
  if (!Number.isFinite(time))
    throw new Error("API_WATCH_RETRY_FENCE_TIME_INVALID");
  return time;
}

function verifyFence(state: ApiWatchAttemptFence): void {
  validTime(state.updatedAt);
  if (!SwaggerSourceFamilySchema.safeParse(state.sourceFamily).success)
    throw new Error("API_WATCH_RETRY_FENCE_FAMILY_INVALID");
  if (typeof state.outcomeUnknown !== "boolean")
    throw new Error("API_WATCH_RETRY_FENCE_STATE_INVALID");
  if (
    (state.claimStage === "IDLE" &&
      (state.claimedRunId !== null ||
        state.claimedLeaseExpiresAt !== null ||
        state.claimedAt !== null ||
        state.enteredAt !== null)) ||
    (state.claimStage === "CLAIMED" &&
      (!state.claimedRunId ||
        state.claimedLeaseExpiresAt === null ||
        state.claimedAt === null ||
        state.enteredAt !== null)) ||
    (state.claimStage === "ENTERED" &&
      (!state.claimedRunId ||
        state.claimedLeaseExpiresAt === null ||
        state.claimedAt === null ||
        !(state.enteredAt instanceof Date))) ||
    !["IDLE", "CLAIMED", "ENTERED"].includes(state.claimStage) ||
    (state.outcomeUnknown && state.claimStage !== "IDLE")
  )
    throw new Error("API_WATCH_RETRY_FENCE_STATE_INVALID");
  if (state.claimStage !== "IDLE") {
    if (!UUID.test(state.claimedRunId ?? ""))
      throw new Error("API_WATCH_RETRY_FENCE_RUN_INVALID");
    const claimed = validTime(state.claimedAt!);
    const expiry = validTime(state.claimedLeaseExpiresAt!);
    if (expiry <= claimed || claimed > validTime(state.updatedAt))
      throw new Error("API_WATCH_RETRY_FENCE_TIME_INVALID");
    if (
      state.enteredAt &&
      (validTime(state.enteredAt) < claimed ||
        validTime(state.enteredAt) >= expiry ||
        validTime(state.enteredAt) > validTime(state.updatedAt))
    )
      throw new Error("API_WATCH_RETRY_FENCE_TIME_INVALID");
  }
}

function requireClock(state: ApiWatchAttemptFence, now: Date): void {
  if (validTime(now) < validTime(state.updatedAt))
    throw new Error("API_WATCH_RETRY_FENCE_TIME_REVERSED");
}

function requireLease(
  lease: ApiWatchAttemptLease,
  expectedRunId: string,
  now: Date,
  persistedLeaseExpiresAt?: Date | null,
): void {
  if (!UUID.test(expectedRunId) || lease.runId !== expectedRunId)
    throw new Error("API_WATCH_RETRY_FENCE_STALE_OWNER");
  const offeredExpiry = validTime(lease.leaseExpiresAt);
  if (
    persistedLeaseExpiresAt &&
    offeredExpiry !== validTime(persistedLeaseExpiresAt)
  )
    throw new Error("API_WATCH_RETRY_FENCE_STALE_OWNER");
  if (offeredExpiry <= validTime(now))
    throw new Error("API_WATCH_RETRY_FENCE_LEASE_EXPIRED");
}

function copyFence(state: ApiWatchAttemptFence): ApiWatchAttemptFence {
  return {
    ...state,
    claimedLeaseExpiresAt: state.claimedLeaseExpiresAt
      ? new Date(validTime(state.claimedLeaseExpiresAt))
      : null,
    claimedAt: state.claimedAt ? new Date(validTime(state.claimedAt)) : null,
    enteredAt: state.enteredAt ? new Date(validTime(state.enteredAt)) : null,
    updatedAt: new Date(validTime(state.updatedAt)),
  };
}

export function emptyApiWatchAttemptFence(
  sourceFamily: SwaggerSourceFamily,
  now: Date,
): ApiWatchAttemptFence {
  validTime(now);
  if (!SwaggerSourceFamilySchema.safeParse(sourceFamily).success)
    throw new Error("API_WATCH_RETRY_FENCE_FAMILY_INVALID");
  return {
    sourceFamily,
    claimStage: "IDLE",
    claimedRunId: null,
    claimedLeaseExpiresAt: null,
    claimedAt: null,
    enteredAt: null,
    outcomeUnknown: false,
    updatedAt: new Date(validTime(now)),
  };
}

/** Returns null on a not-yet-due retry; never fabricates an early attempt. */
export function claimDueApiWatchAttempt(input: {
  state: ApiWatchAttemptFence;
  nextRetryAt: Date | null;
  lease: ApiWatchAttemptLease;
  now: Date;
}): ApiWatchAttemptFence | null {
  const { state, nextRetryAt, lease, now } = input;
  verifyFence(state);
  requireClock(state, now);
  if (state.outcomeUnknown)
    throw new Error("API_WATCH_RETRY_OUTCOME_UNKNOWN_NO_RETRY");
  if (state.claimStage !== "IDLE")
    throw new Error("API_WATCH_RETRY_ALREADY_CLAIMED");
  if (nextRetryAt === null || validTime(nextRetryAt) > validTime(now))
    return null;
  requireLease(lease, lease.runId, now);
  return {
    ...copyFence(state),
    claimStage: "CLAIMED",
    claimedRunId: lease.runId,
    claimedLeaseExpiresAt: new Date(validTime(lease.leaseExpiresAt)),
    claimedAt: new Date(validTime(now)),
    enteredAt: null,
    updatedAt: new Date(validTime(now)),
  };
}

/**
 * Call only immediately before actual provider egress, in the SAME database
 * transaction that verifies current active_run_id and its unexpired lease.
 * Once ENTERED persists, a crash has an unknown external request outcome.
 */
export function enterClaimedApiWatchAttempt(input: {
  state: ApiWatchAttemptFence;
  lease: ApiWatchAttemptLease;
  now: Date;
}): ApiWatchAttemptFence {
  const { state, lease, now } = input;
  verifyFence(state);
  requireClock(state, now);
  if (state.claimStage !== "CLAIMED" || !state.claimedRunId)
    throw new Error("API_WATCH_RETRY_NOT_CLAIMED");
  requireLease(lease, state.claimedRunId, now, state.claimedLeaseExpiresAt);
  return {
    ...copyFence(state),
    claimStage: "ENTERED",
    enteredAt: new Date(validTime(now)),
    updatedAt: new Date(validTime(now)),
  };
}

/**
 * Only the exact run that NEVER entered provider egress may return its due
 * retry. The durable next_retry_at must remain unchanged by this operation.
 */
export function releaseUnenteredApiWatchAttempt(input: {
  state: ApiWatchAttemptFence;
  runId: string;
  now: Date;
}): ApiWatchAttemptFence {
  const { state, runId, now } = input;
  verifyFence(state);
  requireClock(state, now);
  if (state.claimStage !== "CLAIMED")
    throw new Error("API_WATCH_RETRY_WAS_ENTERED_OR_NOT_CLAIMED");
  if (state.claimedRunId !== runId)
    throw new Error("API_WATCH_RETRY_FENCE_STALE_OWNER");
  if (validTime(state.claimedLeaseExpiresAt!) <= validTime(now))
    throw new Error("API_WATCH_RETRY_FENCE_LEASE_EXPIRED");
  return {
    ...copyFence(state),
    claimStage: "IDLE",
    claimedRunId: null,
    claimedLeaseExpiresAt: null,
    claimedAt: null,
    enteredAt: null,
    updatedAt: new Date(validTime(now)),
  };
}

/**
 * Called only after the prior lease has expired and the owner is fenced off.
 * Pre-egress claims can return to due; a possibly sent request is quarantined
 * as UNKNOWN and may be resolved only by a separate authorized procedure.
 */
export function expireApiWatchAttemptFence(input: {
  state: ApiWatchAttemptFence;
  priorRunId: string;
  now: Date;
}): ApiWatchAttemptFence {
  const { state, priorRunId, now } = input;
  verifyFence(state);
  requireClock(state, now);
  if (state.claimedRunId !== priorRunId || state.claimStage === "IDLE")
    throw new Error("API_WATCH_RETRY_FENCE_STALE_OWNER");
  // Recovery trusts only the deadline stamped on the persisted claim.
  // The eventual DB consumer must lock the lane and family row first.
  if (validTime(now) < validTime(state.claimedLeaseExpiresAt!))
    throw new Error("API_WATCH_RETRY_FENCE_NOT_EXPIRED");
  return {
    ...copyFence(state),
    claimStage: "IDLE",
    claimedRunId: null,
    claimedLeaseExpiresAt: null,
    claimedAt: null,
    enteredAt: null,
    outcomeUnknown: state.claimStage === "ENTERED",
    updatedAt: new Date(validTime(now)),
  };
}
