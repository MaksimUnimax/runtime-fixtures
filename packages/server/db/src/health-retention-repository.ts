import { createHash } from "node:crypto";
import {
  NoSessionObservationResultSchema,
  type NoSessionObservationResult,
} from "@product/health";
import { canonicalizeJson } from "@product/remote-config";
import { createHealthIncidentRepository } from "./health-incident-repository.js";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

// Raw routine payload is no longer replay authority once compact projection,
// real incident processing and graph pins are durable. One maximum scheduler
// attempt timeout is the bounded reconciliation grace for duplicate JSON bytes.
export const NO_SESSION_RAW_PAYLOAD_GRACE_MS = 60 * 60 * 1_000;

// Compact receipt/scheduler identity remains the durable no-replay authority.
// Scheduler max: 8 one-hour attempts plus at most 7 inter-attempt delays capped
// at 24 hours each => <= 176 hours. Eight days leaves a bounded margin.
export const NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS = 8 * 24 * 60 * 60 * 1_000;

// Compatibility alias for already submitted B18 consumers. New code should use
// the explicit raw-payload or replay-receipt constant.
export const NO_SESSION_RETENTION_MIN_AGE_MS =
  NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS;

export type RoutineNoSessionGcCursor = Readonly<{
  completedAt: Date;
  runId: string;
}>;

function assertCutoff(
  before: Date,
  now: Date,
  minimumAgeMs: number,
  errorCode: string,
): void {
  if (
    !(before instanceof Date) ||
    !(now instanceof Date) ||
    !Number.isFinite(before.getTime()) ||
    !Number.isFinite(now.getTime()) ||
    before.getTime() > now.getTime() - minimumAgeMs
  ) {
    throw new Error(errorCode);
  }
}

function assertRawPayloadCutoff(before: Date, now: Date): void {
  assertCutoff(
    before,
    now,
    NO_SESSION_RAW_PAYLOAD_GRACE_MS,
    "HEALTH_RETENTION_RAW_PAYLOAD_CUTOFF_TOO_RECENT",
  );
}

function assertReplayReceiptCutoff(before: Date, now: Date): void {
  assertCutoff(
    before,
    now,
    NO_SESSION_REPLAY_RECEIPT_MIN_AGE_MS,
    "HEALTH_RETENTION_REPLAY_RECEIPT_CUTOFF_TOO_RECENT",
  );
}

export type RoutineNoSessionGcReason =
  | "ELIGIBLE"
  | "ALREADY_PRUNED"
  | "PROJECTION_MISSING"
  | "INCIDENT_PROCESSING_PENDING"
  | "PAYLOAD_MISSING"
  | "SCHEDULER_MISSING"
  | "SCHEDULER_NOT_SUCCEEDED"
  | "SCHEDULER_LINK_MISMATCH"
  | "INCIDENT_PINNED"
  | "NOTIFICATION_PINNED"
  | "ACCEPTED_BASELINE_PINNED"
  | "RECENT_STATE_PINNED";

export type RoutineNoSessionGcInventoryItem = Readonly<{
  runId: string;
  scheduledRunId: string;
  scopeSha256: string;
  completedAt: Date;
  payloadPrunedAt: Date | null;
  reason: RoutineNoSessionGcReason;
}>;

type ProjectionReceipt = Readonly<{
  runId: string;
  scheduledRunId: string;
  scopeSha256: string;
  healthState: string;
  browserFamily: string;
  profileRevisionId: string;
  profileRevision: number;
  completedAt: Date;
}>;

type ScopeStateRow = {
  providerId: string;
  observationSurfaceId: string;
  targetKey: string;
  strategyId: string;
  strategyRevision: number;
  browserFamily: string;
  latestRunId: string;
  latestObservedAt: Date;
  lastAttemptAt: Date;
  lastVerifiedAt: Date | null;
};

const hashJson = (value: unknown) =>
  createHash("sha256").update(canonicalizeJson(value)).digest("hex");

function compactNoSessionState(observation: NoSessionObservationResult) {
  return {
    schemaVersion: "health_no_session_compact_v1",
    classification: observation.classification,
    classificationBasis: observation.classificationBasis,
    surfaceOutcome: observation.surfaceOutcome,
    blocker: observation.blocker,
    navigation: observation.navigation,
    navigationOutcome: observation.navigationEvidence.outcome,
    mainDocumentHttpStatus:
      observation.navigationEvidence.mainDocumentHttpStatus,
    redirectCount: observation.navigationEvidence.redirectCount,
    expectedOriginValid: observation.expectedOriginValid,
    identity: observation.identity,
    publicSurface: observation.publicSurface,
    composer: observation.composer,
    editableInput: observation.editableInput,
    sendControl: observation.sendControl,
    authentication: observation.authentication,
    readiness: observation.readiness,
    elementMetadata: observation.elementMetadata,
    browserMode: {
      authoritativeMode: observation.browserMode.authoritativeMode,
      environmentLimited: observation.browserMode.environmentLimited,
      canonicalObservation: observation.browserMode.canonicalObservation,
    },
  } as const;
}

export function normalizedNoSessionResultSha256(
  observation: NoSessionObservationResult,
): string {
  return hashJson(compactNoSessionState(observation));
}

export async function markNoSessionIncidentProcessed(
  q: DatabaseQuery,
  runId: string,
  processedAt: Date,
): Promise<void> {
  const result = await q.query<{ runId: string }>(
    `UPDATE health_no_session_run_receipts
     SET incident_processed_at=COALESCE(incident_processed_at,$2)
     WHERE run_id=$1
     RETURNING run_id AS "runId"`,
    [runId, processedAt],
  );
  if (!result.rows[0])
    throw new Error("HEALTH_RETENTION_RECEIPT_NOT_FOUND_FOR_INCIDENT_MARK");
}

export function noSessionRetentionScopeSha256(
  receipt: Pick<
    ProjectionReceipt,
    "browserFamily" | "profileRevisionId" | "profileRevision"
  >,
  observation: NoSessionObservationResult,
): string {
  return hashJson({
    schemaVersion: "health_no_session_retention_scope_v1",
    providerId: observation.providerId,
    surfaceId: observation.surfaceId,
    targetKey: observation.targetKey,
    strategyId: observation.strategyId,
    strategyRevision: observation.strategyRevision,
    browserFamily: receipt.browserFamily,
    profileRevisionId: receipt.profileRevisionId,
    profileRevision: receipt.profileRevision,
  });
}

function isAfter(
  at: Date,
  runId: string,
  otherAt: Date,
  otherRunId: string,
): boolean {
  return (
    at.valueOf() > otherAt.valueOf() ||
    (at.valueOf() === otherAt.valueOf() && runId > otherRunId)
  );
}
export async function recordNoSessionCompactStateInTransaction(
  q: DatabaseQuery,
  input: {
    receipt: ProjectionReceipt;
    observation: NoSessionObservationResult;
    projectedAt: Date;
  },
): Promise<string> {
  const { receipt, observation, projectedAt } = input;
  if (observation.classification !== receipt.healthState)
    throw new Error("HEALTH_RETENTION_CLASSIFICATION_MISMATCH");
  const observedAt = new Date(observation.observedAt);
  if (!Number.isFinite(observedAt.valueOf()))
    throw new Error("HEALTH_RETENTION_OBSERVED_AT_INVALID");
  const summary = compactNoSessionState(observation);
  const normalizedResultSha256 = hashJson(summary);
  const retentionScopeSha256 = noSessionRetentionScopeSha256(
    receipt,
    observation,
  );

  await q.query(
    `INSERT INTO health_no_session_scope_states(
      scope_sha256,provider_id,observation_surface_id,target_key,strategy_id,strategy_revision,browser_family,
      latest_run_id,latest_normalized_result_sha256,latest_health_state,latest_classification_basis,
      latest_surface_outcome,latest_blocker,latest_observed_at,last_attempt_at,last_verified_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (scope_sha256) DO NOTHING`,
    [
      retentionScopeSha256,
      observation.providerId,
      observation.surfaceId,
      observation.targetKey,
      observation.strategyId,
      observation.strategyRevision,
      receipt.browserFamily,
      receipt.runId,
      normalizedResultSha256,
      observation.classification,
      observation.classificationBasis,
      observation.surfaceOutcome,
      observation.blocker,
      observedAt,
      receipt.completedAt,
      observation.classification === "UNKNOWN" ? null : observedAt,
    ],
  );

  const stateResult = await q.query<ScopeStateRow>(
    `SELECT provider_id AS "providerId",observation_surface_id AS "observationSurfaceId",
      target_key AS "targetKey",strategy_id AS "strategyId",strategy_revision AS "strategyRevision",
      browser_family AS "browserFamily",latest_run_id AS "latestRunId",
      latest_observed_at AS "latestObservedAt",last_attempt_at AS "lastAttemptAt",
      last_verified_at AS "lastVerifiedAt"
     FROM health_no_session_scope_states WHERE scope_sha256=$1 FOR UPDATE`,
    [retentionScopeSha256],
  );
  const state = stateResult.rows[0];
  if (!state) throw new Error("HEALTH_RETENTION_SCOPE_STATE_MISSING");
  if (
    state.providerId !== observation.providerId ||
    state.observationSurfaceId !== observation.surfaceId ||
    state.targetKey !== observation.targetKey ||
    state.strategyId !== observation.strategyId ||
    state.strategyRevision !== observation.strategyRevision ||
    state.browserFamily !== receipt.browserFamily
  ) {
    throw new Error("HEALTH_RETENTION_SCOPE_IDENTITY_CONFLICT");
  }

  const newest = isAfter(
    observedAt,
    receipt.runId,
    state.latestObservedAt,
    state.latestRunId,
  );
  const lastAttemptAt =
    receipt.completedAt > state.lastAttemptAt
      ? receipt.completedAt
      : state.lastAttemptAt;
  const lastVerifiedAt =
    observation.classification !== "UNKNOWN" &&
    (!state.lastVerifiedAt || observedAt > state.lastVerifiedAt)
      ? observedAt
      : state.lastVerifiedAt;

  await q.query(
    `UPDATE health_no_session_scope_states SET
      latest_run_id=CASE WHEN $2 THEN $3 ELSE latest_run_id END,
      latest_normalized_result_sha256=CASE WHEN $2 THEN $4 ELSE latest_normalized_result_sha256 END,
      latest_health_state=CASE WHEN $2 THEN $5 ELSE latest_health_state END,
      latest_classification_basis=CASE WHEN $2 THEN $6 ELSE latest_classification_basis END,
      latest_surface_outcome=CASE WHEN $2 THEN $7 ELSE latest_surface_outcome END,
      latest_blocker=CASE WHEN $2 THEN $8 ELSE latest_blocker END,
      latest_observed_at=CASE WHEN $2 THEN $9 ELSE latest_observed_at END,
      last_attempt_at=$10,last_verified_at=$11,updated_at=GREATEST(updated_at,$12)
      WHERE scope_sha256=$1`,
    [
      retentionScopeSha256,
      newest,
      receipt.runId,
      normalizedResultSha256,
      observation.classification,
      observation.classificationBasis,
      observation.surfaceOutcome,
      observation.blocker,
      observedAt,
      lastAttemptAt,
      lastVerifiedAt,
      projectedAt,
    ],
  );
  const existing = await q.query<{
    slot: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    latestRunId: string;
  }>(
    `SELECT slot,first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",
       latest_run_id AS "latestRunId"
       FROM health_no_session_recent_states
       WHERE scope_sha256=$1 AND normalized_result_sha256=$2 FOR UPDATE`,
    [retentionScopeSha256, normalizedResultSha256],
  );
  const matching = existing.rows[0];
  if (matching) {
    const replaceLatest = isAfter(
      observedAt,
      receipt.runId,
      matching.lastSeenAt,
      matching.latestRunId,
    );
    await q.query(
      `UPDATE health_no_session_recent_states SET
        first_seen_at=LEAST(first_seen_at,$3),
        last_seen_at=GREATEST(last_seen_at,$3),
        repeat_count=repeat_count+1,
        latest_run_id=CASE WHEN $4 THEN $5 ELSE latest_run_id END,
        health_state=CASE WHEN $4 THEN $6 ELSE health_state END,
        classification_basis=CASE WHEN $4 THEN $7 ELSE classification_basis END,
        surface_outcome=CASE WHEN $4 THEN $8 ELSE surface_outcome END,
        blocker=CASE WHEN $4 THEN $9 ELSE blocker END,
        summary=CASE WHEN $4 THEN $10::jsonb ELSE summary END,
        updated_at=GREATEST(updated_at,$11)
        WHERE scope_sha256=$1 AND normalized_result_sha256=$2`,
      [
        retentionScopeSha256,
        normalizedResultSha256,
        observedAt,
        replaceLatest,
        receipt.runId,
        observation.classification,
        observation.classificationBasis,
        observation.surfaceOutcome,
        observation.blocker,
        JSON.stringify(summary),
        projectedAt,
      ],
    );
  } else {
    const slots = await q.query<{
      slot: number;
      lastSeenAt: Date;
      latestRunId: string;
    }>(
      `SELECT slot,last_seen_at AS "lastSeenAt",latest_run_id AS "latestRunId"
       FROM health_no_session_recent_states
       WHERE scope_sha256=$1 ORDER BY last_seen_at,latest_run_id,slot FOR UPDATE`,
      [retentionScopeSha256],
    );
    const used = new Set(slots.rows.map((row) => row.slot));
    const freeSlot = [1, 2, 3].find((slot) => !used.has(slot));
    if (freeSlot) {
      await q.query(
        `INSERT INTO health_no_session_recent_states(
          scope_sha256,slot,normalized_result_sha256,health_state,classification_basis,
          surface_outcome,blocker,summary,first_seen_at,last_seen_at,repeat_count,latest_run_id
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9,1,$10)`,
        [
          retentionScopeSha256,
          freeSlot,
          normalizedResultSha256,
          observation.classification,
          observation.classificationBasis,
          observation.surfaceOutcome,
          observation.blocker,
          JSON.stringify(summary),
          observedAt,
          receipt.runId,
        ],
      );
    } else {
      const oldest = slots.rows[0];
      if (
        oldest &&
        isAfter(
          observedAt,
          receipt.runId,
          oldest.lastSeenAt,
          oldest.latestRunId,
        )
      ) {
        await q.query(
          `UPDATE health_no_session_recent_states SET
            normalized_result_sha256=$3,health_state=$4,classification_basis=$5,
            surface_outcome=$6,blocker=$7,summary=$8::jsonb,first_seen_at=$9,last_seen_at=$9,
            repeat_count=1,latest_run_id=$10,updated_at=GREATEST(updated_at,$11)
            WHERE scope_sha256=$1 AND slot=$2`,
          [
            retentionScopeSha256,
            oldest.slot,
            normalizedResultSha256,
            observation.classification,
            observation.classificationBasis,
            observation.surfaceOutcome,
            observation.blocker,
            JSON.stringify(summary),
            observedAt,
            receipt.runId,
            projectedAt,
          ],
        );
      }
    }
  }

  const receiptUpdate = await q.query<{ runId: string }>(
    `UPDATE health_no_session_run_receipts SET
      normalized_result_sha256=$2,projection_applied_at=$3
      WHERE run_id=$1 AND normalized_result_sha256 IS NULL AND projection_applied_at IS NULL
      RETURNING run_id AS "runId"`,
    [receipt.runId, normalizedResultSha256, projectedAt],
  );
  if (!receiptUpdate.rows[0]) {
    const prior = await q.query<{ normalizedResultSha256: string | null }>(
      `SELECT normalized_result_sha256 AS "normalizedResultSha256"
       FROM health_no_session_run_receipts WHERE run_id=$1`,
      [receipt.runId],
    );
    if (prior.rows[0]?.normalizedResultSha256 !== normalizedResultSha256)
      throw new Error("HEALTH_RETENTION_RECEIPT_PROJECTION_CONFLICT");
  }
  return normalizedResultSha256;
}
const gcInventorySql = `
  SELECT receipt.run_id AS "runId",receipt.scheduled_run_id AS "scheduledRunId",
    receipt.scope_sha256 AS "scopeSha256",receipt.completed_at AS "completedAt",
    receipt.payload_pruned_at AS "payloadPrunedAt",
    CASE
      WHEN receipt.payload_pruned_at IS NOT NULL THEN 'ALREADY_PRUNED'
      WHEN receipt.projection_applied_at IS NULL THEN 'PROJECTION_MISSING'
      WHEN receipt.incident_processed_at IS NULL THEN 'INCIDENT_PROCESSING_PENDING'
      WHEN run.id IS NULL OR observation.run_id IS NULL THEN 'PAYLOAD_MISSING'
      WHEN scheduled.id IS NULL THEN 'SCHEDULER_MISSING'
      WHEN scheduled.state <> 'SUCCEEDED' THEN 'SCHEDULER_NOT_SUCCEEDED'
      WHEN scheduled.health_run_id IS DISTINCT FROM receipt.run_id THEN 'SCHEDULER_LINK_MISMATCH'
      WHEN EXISTS (
        SELECT 1 FROM health_incidents incident
        WHERE incident.first_seen_run_id=receipt.run_id
           OR incident.latest_seen_run_id=receipt.run_id
           OR incident.last_observed_run_id=receipt.run_id
           OR incident.resolved_by_run_id=receipt.run_id
      ) THEN 'INCIDENT_PINNED'
      WHEN EXISTS (
        SELECT 1 FROM health_notification_intents notification
        WHERE notification.health_run_id=receipt.run_id
      ) THEN 'NOTIFICATION_PINNED'
      WHEN EXISTS (
        SELECT 1 FROM health_no_session_scope_states state
        WHERE state.accepted_baseline_run_id=receipt.run_id
      ) THEN 'ACCEPTED_BASELINE_PINNED'
      WHEN EXISTS (
        SELECT 1 FROM health_no_session_scope_states state
        WHERE state.latest_run_id=receipt.run_id
      ) OR EXISTS (
        SELECT 1 FROM health_no_session_recent_states recent
        WHERE recent.latest_run_id=receipt.run_id
      ) THEN 'RECENT_STATE_PINNED'
      ELSE 'ELIGIBLE'
    END AS reason
  FROM health_no_session_run_receipts receipt
  LEFT JOIN health_runs run ON run.id=receipt.run_id
  LEFT JOIN health_no_session_observations observation ON observation.run_id=receipt.run_id
  LEFT JOIN health_scheduled_runs scheduled ON scheduled.id=receipt.scheduled_run_id
`;

async function oneGcInventory(
  q: DatabaseQuery,
  runId: string,
  before: Date,
): Promise<RoutineNoSessionGcInventoryItem | undefined> {
  const result = await q.query<RoutineNoSessionGcInventoryItem>(
    `${gcInventorySql}
     WHERE receipt.run_id=$1 AND receipt.completed_at <= $2`,
    [runId, before],
  );
  return result.rows[0];
}

async function lockScheduleForRetention(
  q: DatabaseQuery,
  scheduleId: string,
): Promise<void> {
  const result = await q.query<{ id: string }>(
    "SELECT id FROM health_schedules WHERE id=$1 FOR UPDATE",
    [scheduleId],
  );
  if (!result.rows[0]) throw new Error("HEALTH_RETENTION_SCHEDULE_NOT_FOUND");
}

async function advanceScheduleWatermark(
  q: DatabaseQuery,
  input: {
    scheduleId: string;
    scheduleRevision: number;
    dueSlotAt: Date;
    retiredAt: Date;
  },
): Promise<void> {
  const result = await q.query<{ scheduleId: string }>(
    `INSERT INTO health_schedule_retention_watermarks(
      schedule_id,retired_through_revision,retired_through_due_slot_at,retired_at,updated_at
    ) VALUES($1,$2,$3,$4,$4)
    ON CONFLICT (schedule_id) DO UPDATE SET
      retired_through_revision=EXCLUDED.retired_through_revision,
      retired_through_due_slot_at=EXCLUDED.retired_through_due_slot_at,
      retired_at=EXCLUDED.retired_at,
      updated_at=EXCLUDED.updated_at
    WHERE health_schedule_retention_watermarks.retired_through_revision < EXCLUDED.retired_through_revision
       OR (
         health_schedule_retention_watermarks.retired_through_revision = EXCLUDED.retired_through_revision
         AND health_schedule_retention_watermarks.retired_through_due_slot_at < EXCLUDED.retired_through_due_slot_at
       )
    RETURNING schedule_id AS "scheduleId"`,
    [
      input.scheduleId,
      input.scheduleRevision,
      input.dueSlotAt,
      input.retiredAt,
    ],
  );
  if (result.rows[0]) return;
  const existing = await q.query<{
    retiredThroughRevision: number;
    retiredThroughDueSlotAt: Date;
  }>(
    `SELECT retired_through_revision AS "retiredThroughRevision",
      retired_through_due_slot_at AS "retiredThroughDueSlotAt"
      FROM health_schedule_retention_watermarks WHERE schedule_id=$1 FOR SHARE`,
    [input.scheduleId],
  );
  const row = existing.rows[0];
  if (
    !row ||
    row.retiredThroughRevision < input.scheduleRevision ||
    (row.retiredThroughRevision === input.scheduleRevision &&
      row.retiredThroughDueSlotAt < input.dueSlotAt)
  ) {
    throw new Error("HEALTH_RETENTION_WATERMARK_ADVANCE_FAILED");
  }
}

export function createHealthRetentionRepository(
  runtime: DatabaseRuntime,
  options: {
    clock?: () => Date;
  } = {},
) {
  const legacyIncidentProcessor = createHealthIncidentRepository(runtime, {
    emitNotifications: false,
  });
  const clock = options.clock ?? (() => new Date());
  return {
    async listRoutineNoSessionGcInventory(input: {
      before: Date;
      cursor?: RoutineNoSessionGcCursor;
      limit?: number;
    }): Promise<readonly RoutineNoSessionGcInventoryItem[]> {
      const limit = input.limit ?? 500;
      if (!Number.isInteger(limit) || limit < 1 || limit > 5_000)
        throw new Error("HEALTH_RETENTION_LIMIT_INVALID");
      const now = clock();
      assertRawPayloadCutoff(input.before, now);
      if (
        input.cursor &&
        (!(input.cursor.completedAt instanceof Date) ||
          !Number.isFinite(input.cursor.completedAt.getTime()) ||
          typeof input.cursor.runId !== "string")
      ) {
        throw new Error("HEALTH_RETENTION_CURSOR_INVALID");
      }
      const result = input.cursor
        ? await runtime.query<RoutineNoSessionGcInventoryItem>(
            `${gcInventorySql}
             WHERE receipt.completed_at <= $1
               AND (receipt.completed_at,receipt.run_id) > ($2::timestamptz,$3::uuid)
             ORDER BY receipt.completed_at,receipt.run_id LIMIT $4`,
            [input.before, input.cursor.completedAt, input.cursor.runId, limit],
          )
        : await runtime.query<RoutineNoSessionGcInventoryItem>(
            `${gcInventorySql}
             WHERE receipt.completed_at <= $1
             ORDER BY receipt.completed_at,receipt.run_id LIMIT $2`,
            [input.before, limit],
          );
      return result.rows;
    },
    async backfillNoSessionCompactProjection(
      input: {
        limit?: number;
        projectedAt?: Date;
      } = {},
    ): Promise<number> {
      const limit = input.limit ?? 500;
      if (!Number.isInteger(limit) || limit < 1 || limit > 5_000)
        throw new Error("HEALTH_RETENTION_LIMIT_INVALID");
      const candidates = await runtime.query<{ runId: string }>(
        `SELECT run_id AS "runId" FROM health_no_session_run_receipts
         WHERE projection_applied_at IS NULL
         ORDER BY completed_at,run_id LIMIT $1`,
        [limit],
      );
      let applied = 0;
      for (const candidate of candidates.rows) {
        const didApply = await runtime.transaction(async (q) => {
          const locked = await q.query<
            ProjectionReceipt & {
              observation: unknown;
              projectionAppliedAt: Date | null;
            }
          >(
            `SELECT receipt.run_id AS "runId",receipt.scheduled_run_id AS "scheduledRunId",
              receipt.scope_sha256 AS "scopeSha256",receipt.health_state AS "healthState",
              receipt.browser_family AS "browserFamily",
              receipt.profile_revision_id AS "profileRevisionId",
              receipt.profile_revision AS "profileRevision",
              receipt.completed_at AS "completedAt",
              receipt.projection_applied_at AS "projectionAppliedAt",observation.observation
             FROM health_no_session_run_receipts receipt
             JOIN health_no_session_observations observation ON observation.run_id=receipt.run_id
             WHERE receipt.run_id=$1 FOR UPDATE OF receipt`,
            [candidate.runId],
          );
          const row = locked.rows[0];
          if (!row || row.projectionAppliedAt) return false;
          const observation = NoSessionObservationResultSchema.parse(
            row.observation,
          ) as NoSessionObservationResult;
          await recordNoSessionCompactStateInTransaction(q, {
            receipt: row,
            observation,
            projectedAt: input.projectedAt ?? new Date(),
          });
          return true;
        });
        if (didApply) applied += 1;
      }
      return applied;
    },

    async reconcileLegacyNoSessionIncidentProcessing(
      input: {
        limit?: number;
        cursor?: RoutineNoSessionGcCursor;
        processedAt?: Date;
      } = {},
    ): Promise<{
      processed: number;
      cursor: RoutineNoSessionGcCursor | null;
    }> {
      const limit = input.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
        throw new Error("HEALTH_RETENTION_LIMIT_INVALID");
      const values: unknown[] = [];
      let cursorPredicate = "";
      if (input.cursor) {
        if (
          !(input.cursor.completedAt instanceof Date) ||
          !Number.isFinite(input.cursor.completedAt.getTime()) ||
          typeof input.cursor.runId !== "string"
        ) {
          throw new Error("HEALTH_RETENTION_CURSOR_INVALID");
        }
        values.push(input.cursor.completedAt, input.cursor.runId);
        cursorPredicate =
          "AND (receipt.completed_at,receipt.run_id) > ($1::timestamptz,$2::uuid)";
      }
      values.push(limit);
      const limitIndex = values.length;
      const candidates = await runtime.query<{
        runId: string;
        completedAt: Date;
      }>(
        `SELECT receipt.run_id AS "runId",receipt.completed_at AS "completedAt"
         FROM health_no_session_run_receipts receipt
         JOIN health_runs run ON run.id=receipt.run_id
         JOIN health_no_session_observations observation ON observation.run_id=receipt.run_id
         JOIN health_scheduled_runs scheduled ON scheduled.id=receipt.scheduled_run_id
         WHERE receipt.incident_processed_at IS NULL
           AND receipt.projection_applied_at IS NOT NULL
           AND receipt.payload_pruned_at IS NULL
           AND run.run_kind='NO_SESSION_OBSERVATION'
           AND scheduled.state='SUCCEEDED'
           AND scheduled.health_run_id=receipt.run_id
           ${cursorPredicate}
         ORDER BY receipt.completed_at,receipt.run_id
         LIMIT $${limitIndex}`,
        values,
      );
      let processed = 0;
      let cursor: RoutineNoSessionGcCursor | null = input.cursor ?? null;
      for (const candidate of candidates.rows) {
        await legacyIncidentProcessor.processCompletedHealthRun(
          candidate.runId,
        );
        await markNoSessionIncidentProcessed(
          runtime,
          candidate.runId,
          input.processedAt ?? clock(),
        );
        processed += 1;
        cursor = {
          completedAt: candidate.completedAt,
          runId: candidate.runId,
        };
      }
      return { processed, cursor };
    },

    async pruneRoutineNoSessionPayload(input: {
      runId: string;
      before: Date;
    }): Promise<{
      status: "PRUNED" | "BLOCKED";
      reason: RoutineNoSessionGcReason;
    }> {
      const retentionNow = clock();
      assertRawPayloadCutoff(input.before, retentionNow);
      return runtime.transaction(async (q) => {
        const identity = await q.query<{ scheduledRunId: string }>(
          `SELECT scheduled_run_id AS "scheduledRunId"
           FROM health_no_session_run_receipts WHERE run_id=$1`,
          [input.runId],
        );
        const observed = identity.rows[0];
        if (!observed) throw new Error("HEALTH_RETENTION_RECEIPT_NOT_FOUND");
        const scheduledLock = await q.query<{ id: string }>(
          `SELECT id FROM health_scheduled_runs WHERE id=$1 FOR UPDATE`,
          [observed.scheduledRunId],
        );
        if (!scheduledLock.rows[0])
          return { status: "BLOCKED", reason: "SCHEDULER_MISSING" };
        const locked = await q.query<{ runId: string; scheduledRunId: string }>(
          `SELECT run_id AS "runId",scheduled_run_id AS "scheduledRunId"
           FROM health_no_session_run_receipts WHERE run_id=$1 FOR UPDATE`,
          [input.runId],
        );
        const receipt = locked.rows[0];
        if (!receipt) throw new Error("HEALTH_RETENTION_RECEIPT_NOT_FOUND");
        if (receipt.scheduledRunId !== observed.scheduledRunId)
          throw new Error("HEALTH_RETENTION_RECEIPT_IDENTITY_CHANGED");
        const inventory = await oneGcInventory(q, input.runId, input.before);
        if (!inventory) return { status: "BLOCKED", reason: "PAYLOAD_MISSING" };
        if (inventory.reason !== "ELIGIBLE")
          return { status: "BLOCKED", reason: inventory.reason };
        const now = retentionNow;
        const marked = await q.query<{ runId: string }>(
          `UPDATE health_no_session_run_receipts SET payload_pruned_at=$2
           WHERE run_id=$1 AND payload_pruned_at IS NULL RETURNING run_id AS "runId"`,
          [input.runId, now],
        );
        if (!marked.rows[0])
          return { status: "BLOCKED", reason: "ALREADY_PRUNED" };
        const detached = await q.query<{ id: string }>(
          `UPDATE health_scheduled_runs SET health_run_id=NULL,updated_at=GREATEST(updated_at,$3)
           WHERE id=$1 AND state='SUCCEEDED' AND health_run_id=$2
           RETURNING id`,
          [receipt.scheduledRunId, input.runId, now],
        );
        if (!detached.rows[0])
          throw new Error("HEALTH_RETENTION_SCHEDULER_DETACH_FAILED");
        await q.query(
          "DELETE FROM health_no_session_evidence_references WHERE run_id=$1",
          [input.runId],
        );
        const observation = await q.query<{ runId: string }>(
          `DELETE FROM health_no_session_observations WHERE run_id=$1
           RETURNING run_id AS "runId"`,
          [input.runId],
        );
        if (!observation.rows[0])
          throw new Error("HEALTH_RETENTION_OBSERVATION_DELETE_FAILED");
        const run = await q.query<{ id: string }>(
          `DELETE FROM health_runs WHERE id=$1 RETURNING id`,
          [input.runId],
        );
        if (!run.rows[0]) throw new Error("HEALTH_RETENTION_RUN_DELETE_FAILED");
        return { status: "PRUNED", reason: "ELIGIBLE" };
      });
    },

    async retireRoutineNoSessionReceipt(input: {
      runId: string;
      before: Date;
    }): Promise<{
      status: "RETIRED" | "BLOCKED";
      reason:
        | "RETIRED"
        | "ALREADY_RETIRED"
        | "TOO_NEW"
        | "PAYLOAD_NOT_PRUNED"
        | "SCHEDULER_NOT_SUCCEEDED"
        | "SCHEDULER_LINK_PRESENT";
    }> {
      const retentionNow = clock();
      assertReplayReceiptCutoff(input.before, retentionNow);
      return runtime.transaction(async (q) => {
        const identity = await q.query<{
          scheduledRunId: string;
          scheduleId: string;
        }>(
          `SELECT scheduled_run_id AS "scheduledRunId",schedule_id AS "scheduleId"
           FROM health_no_session_run_receipts WHERE run_id=$1`,
          [input.runId],
        );
        const observed = identity.rows[0];
        if (!observed) return { status: "BLOCKED", reason: "ALREADY_RETIRED" };
        await lockScheduleForRetention(q, observed.scheduleId);
        const scheduled = await q.query<{
          state: string;
          healthRunId: string | null;
        }>(
          `SELECT state::text,health_run_id AS "healthRunId"
           FROM health_scheduled_runs WHERE id=$1 FOR UPDATE`,
          [observed.scheduledRunId],
        );
        const receipts = await q.query<{
          scheduledRunId: string;
          scheduleId: string;
          scheduleRevision: number;
          dueSlotAt: Date;
          completedAt: Date;
          payloadPrunedAt: Date | null;
        }>(
          `SELECT scheduled_run_id AS "scheduledRunId",schedule_id AS "scheduleId",
            schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",
            completed_at AS "completedAt",payload_pruned_at AS "payloadPrunedAt"
           FROM health_no_session_run_receipts WHERE run_id=$1 FOR UPDATE`,
          [input.runId],
        );
        const receipt = receipts.rows[0];
        if (!receipt) return { status: "BLOCKED", reason: "ALREADY_RETIRED" };
        if (
          receipt.scheduledRunId !== observed.scheduledRunId ||
          receipt.scheduleId !== observed.scheduleId
        )
          throw new Error("HEALTH_RETENTION_RECEIPT_IDENTITY_CHANGED");
        if (receipt.payloadPrunedAt === null)
          return { status: "BLOCKED", reason: "PAYLOAD_NOT_PRUNED" };
        if (
          receipt.completedAt > input.before ||
          receipt.payloadPrunedAt > input.before
        )
          return { status: "BLOCKED", reason: "TOO_NEW" };
        const scheduledRun = scheduled.rows[0];
        if (!scheduledRun || scheduledRun.state !== "SUCCEEDED")
          return { status: "BLOCKED", reason: "SCHEDULER_NOT_SUCCEEDED" };
        if (scheduledRun.healthRunId !== null)
          return { status: "BLOCKED", reason: "SCHEDULER_LINK_PRESENT" };
        const now = retentionNow;
        await advanceScheduleWatermark(q, {
          scheduleId: receipt.scheduleId,
          scheduleRevision: receipt.scheduleRevision,
          dueSlotAt: receipt.dueSlotAt,
          retiredAt: now,
        });
        const removedReceipt = await q.query<{ runId: string }>(
          `DELETE FROM health_no_session_run_receipts
           WHERE run_id=$1 RETURNING run_id AS "runId"`,
          [input.runId],
        );
        if (!removedReceipt.rows[0])
          throw new Error("HEALTH_RETENTION_RECEIPT_RETIRE_FAILED");
        const removedRun = await q.query<{ id: string }>(
          `DELETE FROM health_scheduled_runs
           WHERE id=$1 AND state='SUCCEEDED' AND health_run_id IS NULL
           RETURNING id`,
          [receipt.scheduledRunId],
        );
        if (!removedRun.rows[0])
          throw new Error("HEALTH_RETENTION_SCHEDULED_RUN_RETIRE_FAILED");
        return { status: "RETIRED", reason: "RETIRED" };
      });
    },

    async retireTerminalScheduledRun(input: {
      scheduledRunId: string;
      before: Date;
    }): Promise<{
      status: "RETIRED" | "BLOCKED";
      reason:
        | "RETIRED"
        | "ALREADY_RETIRED"
        | "TOO_NEW"
        | "NOT_TERMINAL"
        | "PERSISTED_RESULT_PRESENT"
        | "RETRY_PENDING";
    }> {
      const retentionNow = clock();
      assertReplayReceiptCutoff(input.before, retentionNow);
      return runtime.transaction(async (q) => {
        const identity = await q.query<{ scheduleId: string }>(
          `SELECT schedule_id AS "scheduleId"
           FROM health_scheduled_runs WHERE id=$1`,
          [input.scheduledRunId],
        );
        const observed = identity.rows[0];
        if (!observed) return { status: "BLOCKED", reason: "ALREADY_RETIRED" };
        await lockScheduleForRetention(q, observed.scheduleId);
        const result = await q.query<{
          scheduleId: string;
          scheduleRevision: number;
          dueSlotAt: Date;
          state: string;
          finishedAt: Date | null;
          nextAttemptAt: Date | null;
          healthRunId: string | null;
        }>(
          `SELECT schedule_id AS "scheduleId",schedule_revision AS "scheduleRevision",
            due_slot_at AS "dueSlotAt",state::text,finished_at AS "finishedAt",
            next_attempt_at AS "nextAttemptAt",health_run_id AS "healthRunId"
           FROM health_scheduled_runs WHERE id=$1 FOR UPDATE`,
          [input.scheduledRunId],
        );
        const row = result.rows[0];
        if (!row) return { status: "BLOCKED", reason: "ALREADY_RETIRED" };
        if (!row.finishedAt || row.finishedAt > input.before)
          return { status: "BLOCKED", reason: "TOO_NEW" };
        if (row.state !== "FAILED_TERMINAL" && row.state !== "CANCELLED")
          return { status: "BLOCKED", reason: "NOT_TERMINAL" };
        if (row.nextAttemptAt !== null)
          return { status: "BLOCKED", reason: "RETRY_PENDING" };
        if (row.healthRunId !== null)
          return { status: "BLOCKED", reason: "PERSISTED_RESULT_PRESENT" };
        const persisted = await q.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM health_runs
           WHERE scheduled_run_id=$1`,
          [input.scheduledRunId],
        );
        if (persisted.rows[0]?.count !== "0")
          return { status: "BLOCKED", reason: "PERSISTED_RESULT_PRESENT" };
        const receipt = await q.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM health_no_session_run_receipts
           WHERE scheduled_run_id=$1`,
          [input.scheduledRunId],
        );
        if (receipt.rows[0]?.count !== "0")
          return { status: "BLOCKED", reason: "PERSISTED_RESULT_PRESENT" };
        const now = retentionNow;
        await advanceScheduleWatermark(q, {
          scheduleId: row.scheduleId,
          scheduleRevision: row.scheduleRevision,
          dueSlotAt: row.dueSlotAt,
          retiredAt: now,
        });
        const removed = await q.query<{ id: string }>(
          `DELETE FROM health_scheduled_runs
           WHERE id=$1 AND state IN ('FAILED_TERMINAL','CANCELLED')
             AND health_run_id IS NULL AND next_attempt_at IS NULL
           RETURNING id`,
          [input.scheduledRunId],
        );
        if (!removed.rows[0])
          throw new Error("HEALTH_RETENTION_TERMINAL_RETIRE_FAILED");
        return { status: "RETIRED", reason: "RETIRED" };
      });
    },
  };
}
