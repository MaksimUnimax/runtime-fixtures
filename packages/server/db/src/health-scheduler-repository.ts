import { randomUUID } from "node:crypto";
import {
  HealthFailureClassSchema,
  HealthProbeLayerSchema,
  HealthScheduleCadenceSchema,
  HealthScheduleInputSchema,
  HealthScheduledRunStateSchema,
  HealthStateSchema,
  assertScheduledRunTransition,
  classifyFailure,
  nextDueAfterMaterialization,
  retryAt,
  scheduledRunIdempotencyKey,
  type DurableHealthSchedulerRepository,
  type HealthSchedule,
  type HealthScheduleCadence,
  type HealthScheduledRun,
} from "@product/health";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type ScheduleRow = {
  id: string;
  monitorTarget: string;
  provider: string;
  surface: string;
  probeLayer: string;
  enabled: boolean;
  cadence: unknown;
  nextDueAt: Date;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduledRunRow = {
  id: string;
  scheduleId: string;
  monitorTarget: string;
  provider: string;
  surface: string;
  probeLayer: string;
  scheduleRevision: number;
  dueSlotAt: Date;
  idempotencyKey: string;
  state: string;
  ownerId: string | null;
  leaseId: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  timeoutAt: Date | null;
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  nextAttemptAt: Date | null;
  failureClass: string | null;
  failureCode: string | null;
  healthRunId: string | null;
  healthState: string | null;
};

const scheduleProjection = `SELECT id,monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",enabled,cadence,next_due_at AS "nextDueAt",last_attempt_at AS "lastAttemptAt",last_success_at AS "lastSuccessAt",revision,created_at AS "createdAt",updated_at AS "updatedAt" FROM health_schedules`;
const runProjection = `SELECT id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",timeout_at AS "timeoutAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState" FROM health_scheduled_runs`;

function cadence(value: unknown): HealthScheduleCadence {
  return HealthScheduleCadenceSchema.parse(value);
}

function mapSchedule(row: ScheduleRow): HealthSchedule {
  return {
    scheduleId: row.id,
    monitorTarget: row.monitorTarget,
    provider: row.provider,
    surface: row.surface,
    probeLayer: HealthProbeLayerSchema.parse(row.probeLayer),
    enabled: row.enabled,
    cadence: cadence(row.cadence),
    nextDueAt: row.nextDueAt,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRun(row: ScheduledRunRow): HealthScheduledRun {
  return {
    ...row,
    timeoutAt: row.timeoutAt ?? null,
    probeLayer: HealthProbeLayerSchema.parse(row.probeLayer),
    state: HealthScheduledRunStateSchema.parse(row.state),
    failureClass: row.failureClass
      ? HealthFailureClassSchema.parse(row.failureClass)
      : null,
    healthState: row.healthState
      ? HealthStateSchema.parse(row.healthState)
      : null,
  };
}

async function oneRun(
  q: DatabaseQuery,
  id: string,
): Promise<HealthScheduledRun> {
  const result = await q.query<ScheduledRunRow>(
    `${runProjection} WHERE id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("HEALTH_SCHEDULED_RUN_NOT_FOUND");
  return mapRun(row);
}

function staleOwner(): never {
  throw new Error("HEALTH_SCHEDULED_RUN_STALE_OWNER");
}

export function createHealthSchedulerRepository(runtime: DatabaseRuntime) {
  const repository: DurableHealthSchedulerRepository & {
    createSchedule(input: unknown): Promise<HealthSchedule>;
    getSchedule(scheduleId: string): Promise<HealthSchedule | undefined>;
    listSchedules(): Promise<readonly HealthSchedule[]>;
    updateSchedule(input: {
      scheduleId: string;
      enabled: boolean;
      cadence: HealthScheduleCadence;
      nextDueAt: Date;
      monitorTarget?: string;
      provider?: string;
      surface?: string;
      probeLayer?: "NO_SESSION" | "AUTHENTICATED_DEEP";
    }): Promise<HealthSchedule>;
    getScheduledRun(runId: string): Promise<HealthScheduledRun | undefined>;
  } = {
    async createSchedule(rawInput) {
      const input = HealthScheduleInputSchema.parse(rawInput);
      const row = await runtime.query<ScheduleRow>(
        `${scheduleProjection} WHERE id=$1`,
        [input.scheduleId],
      );
      if (row.rows[0]) throw new Error("HEALTH_SCHEDULE_ALREADY_EXISTS");
      const result = await runtime.query<ScheduleRow>(
        `INSERT INTO health_schedules(id,monitor_target,provider,surface,probe_layer,enabled,cadence,next_due_at,revision) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id,monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",enabled,cadence,next_due_at AS "nextDueAt",last_attempt_at AS "lastAttemptAt",last_success_at AS "lastSuccessAt",revision,created_at AS "createdAt",updated_at AS "updatedAt"`,
        [
          input.scheduleId,
          input.monitorTarget,
          input.provider,
          input.surface,
          input.probeLayer,
          input.enabled,
          JSON.stringify(input.cadence),
          input.nextDueAt,
          input.revision,
        ],
      );
      const created = result.rows[0];
      if (!created) throw new Error("HEALTH_SCHEDULE_CREATE_FAILED");
      return mapSchedule(created);
    },

    async getSchedule(scheduleId) {
      const result = await runtime.query<ScheduleRow>(
        `${scheduleProjection} WHERE id=$1`,
        [scheduleId],
      );
      return result.rows[0] ? mapSchedule(result.rows[0]) : undefined;
    },

    async listSchedules() {
      const result = await runtime.query<ScheduleRow>(
        `${scheduleProjection} ORDER BY monitor_target`,
      );
      return result.rows.map(mapSchedule);
    },

    async updateSchedule(input) {
      HealthScheduleCadenceSchema.parse(input.cadence);
      return runtime.transaction(async (q) => {
        const current = await q.query<ScheduleRow>(
          `${scheduleProjection} WHERE id=$1 FOR UPDATE`,
          [input.scheduleId],
        );
        const existing = current.rows[0];
        if (!existing) throw new Error("HEALTH_SCHEDULE_NOT_FOUND");
        const candidate = HealthScheduleInputSchema.parse({
          scheduleId: existing.id,
          monitorTarget: input.monitorTarget ?? existing.monitorTarget,
          provider: input.provider ?? existing.provider,
          surface: input.surface ?? existing.surface,
          probeLayer: input.probeLayer ?? existing.probeLayer,
          enabled: input.enabled,
          cadence: input.cadence,
          nextDueAt: input.nextDueAt,
          revision: existing.revision + 1,
        });
        const result = await q.query<ScheduleRow>(
          `UPDATE health_schedules SET monitor_target=$2,provider=$3,surface=$4,probe_layer=$5,enabled=$6,cadence=$7::jsonb,next_due_at=$8,revision=$9,updated_at=$10 WHERE id=$1 RETURNING id,monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",enabled,cadence,next_due_at AS "nextDueAt",last_attempt_at AS "lastAttemptAt",last_success_at AS "lastSuccessAt",revision,created_at AS "createdAt",updated_at AS "updatedAt"`,
          [
            candidate.scheduleId,
            candidate.monitorTarget,
            candidate.provider,
            candidate.surface,
            candidate.probeLayer,
            candidate.enabled,
            JSON.stringify(candidate.cadence),
            candidate.nextDueAt,
            candidate.revision,
            new Date(),
          ],
        );
        const updated = result.rows[0];
        if (!updated) throw new Error("HEALTH_SCHEDULE_UPDATE_FAILED");
        return mapSchedule(updated);
      });
    },

    async listDueSchedules(now) {
      const result = await runtime.query<ScheduleRow>(
        `${scheduleProjection} WHERE enabled=true AND next_due_at <= $1 ORDER BY next_due_at,monitor_target`,
        [now],
      );
      return result.rows.map(mapSchedule);
    },

    async materializeDueSlot(scheduleId, now) {
      return runtime.transaction(async (q) => {
        const locked = await q.query<ScheduleRow>(
          `${scheduleProjection} WHERE id=$1 FOR UPDATE`,
          [scheduleId],
        );
        const row = locked.rows[0];
        if (!row) throw new Error("HEALTH_SCHEDULE_NOT_FOUND");
        const schedule = mapSchedule(row);
        if (!schedule.enabled || schedule.nextDueAt > now) return null;
        const dueSlotAt = schedule.nextDueAt;
        const idempotencyKey = scheduledRunIdempotencyKey({
          scheduleId: schedule.scheduleId,
          scheduleRevision: schedule.revision,
          dueSlotAt,
          monitorTarget: schedule.monitorTarget,
        });
        const inserted = await q.query<ScheduledRunRow>(
          `INSERT INTO health_scheduled_runs(schedule_id,monitor_target,provider,surface,probe_layer,schedule_revision,due_slot_at,idempotency_key,state,attempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',1) ON CONFLICT (schedule_id,schedule_revision,due_slot_at,monitor_target) DO NOTHING RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [
            schedule.scheduleId,
            schedule.monitorTarget,
            schedule.provider,
            schedule.surface,
            schedule.probeLayer,
            schedule.revision,
            dueSlotAt,
            idempotencyKey,
          ],
        );
        const nextDueAt = nextDueAfterMaterialization(schedule, now);
        await q.query(
          `UPDATE health_schedules SET next_due_at=$2,updated_at=$3 WHERE id=$1 AND revision=$4`,
          [schedule.scheduleId, nextDueAt, now, schedule.revision],
        );
        const materialized = inserted.rows[0];
        return materialized ? mapRun(materialized) : null;
      });
    },

    async claimNext({ ownerId, now, leaseMs }) {
      return runtime.transaction(async (q) => {
        await q.query(
          `UPDATE health_scheduled_runs r SET state='TIMED_OUT',finished_at=$1,updated_at=$1,lease_id=NULL,owner_id=NULL,lease_expires_at=NULL,failure_class='TRANSIENT_ENVIRONMENT',failure_code='LEASE_EXPIRED_MAX_ATTEMPTS' FROM health_schedules s WHERE r.schedule_id=s.id AND r.state IN ('CLAIMED','RUNNING') AND r.lease_expires_at <= $1 AND r.attempt >= (s.cadence->>'maxAttempts')::integer`,
          [now],
        );
        const candidate = await q.query<ScheduledRunRow>(
          `SELECT r.id,r.schedule_id AS "scheduleId",r.monitor_target AS "monitorTarget",r.provider,r.surface,r.probe_layer AS "probeLayer",r.schedule_revision AS "scheduleRevision",r.due_slot_at AS "dueSlotAt",r.idempotency_key AS "idempotencyKey",r.state,r.owner_id AS "ownerId",r.lease_id AS "leaseId",r.claimed_at AS "claimedAt",r.lease_expires_at AS "leaseExpiresAt",r.attempt,r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.next_attempt_at AS "nextAttemptAt",r.failure_class AS "failureClass",r.failure_code AS "failureCode",r.health_run_id AS "healthRunId",r.health_state AS "healthState" FROM health_scheduled_runs r JOIN health_schedules s ON s.id=r.schedule_id WHERE (r.state='PENDING' AND r.attempt <= (s.cadence->>'maxAttempts')::integer) OR (r.state IN ('FAILED_RETRYABLE','TIMED_OUT') AND r.next_attempt_at <= $1 AND r.attempt < (s.cadence->>'maxAttempts')::integer) OR (r.state IN ('CLAIMED','RUNNING') AND r.lease_expires_at <= $1 AND r.attempt < (s.cadence->>'maxAttempts')::integer) ORDER BY r.due_slot_at,r.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          [now],
        );
        const row = candidate.rows[0];
        if (!row) return null;
        assertScheduledRunTransition(mapRun(row).state, "CLAIMED");
        const leaseId = randomUUID();
        const updated = await q.query<ScheduledRunRow>(
          `UPDATE health_scheduled_runs SET state='CLAIMED',owner_id=$2,lease_id=$3,claimed_at=$4,lease_expires_at=$5,attempt=CASE WHEN state='PENDING' THEN attempt ELSE attempt+1 END,next_attempt_at=NULL,updated_at=$4 WHERE id=$1 RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [row.id, ownerId, leaseId, now, new Date(now.valueOf() + leaseMs)],
        );
        await q.query(
          `UPDATE health_schedules SET last_attempt_at=$2,updated_at=$2 WHERE id=$1`,
          [row.scheduleId, now],
        );
        return updated.rows[0] ? mapRun(updated.rows[0]) : null;
      });
    },

    async startRun({ runId, ownerId, leaseId, now }) {
      return runtime.transaction(async (q) => {
        const current = await oneRun(q, runId);
        if (current.ownerId !== ownerId || current.leaseId !== leaseId)
          return staleOwner();
        assertScheduledRunTransition(current.state, "RUNNING");
        const scheduleResult = await q.query<{ cadence: unknown }>(
          `SELECT cadence FROM health_schedules WHERE id=$1`,
          [current.scheduleId],
        );
        const timeoutAt = new Date(
          now.valueOf() +
            cadence(scheduleResult.rows[0]?.cadence).timeoutSeconds * 1_000,
        );
        const result = await q.query<ScheduledRunRow>(
          `UPDATE health_scheduled_runs SET state='RUNNING',started_at=$4,timeout_at=$5,updated_at=$4 WHERE id=$1 AND state='CLAIMED' AND owner_id=$2 AND lease_id=$3 AND lease_expires_at > $4 RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",timeout_at AS "timeoutAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [runId, ownerId, leaseId, now, timeoutAt],
        );
        if (!result.rows[0]) return staleOwner();
        return mapRun(result.rows[0]);
      });
    },

    async finishSuccess({
      runId,
      ownerId,
      leaseId,
      now,
      healthRunId,
      healthState,
    }) {
      HealthStateSchema.parse(healthState);
      return runtime.transaction(async (q) => {
        const current = await oneRun(q, runId);
        if (current.ownerId !== ownerId || current.leaseId !== leaseId)
          return staleOwner();
        assertScheduledRunTransition(current.state, "SUCCEEDED");
        const result = await q.query<ScheduledRunRow>(
          `UPDATE health_scheduled_runs SET state='SUCCEEDED',finished_at=$4,lease_id=NULL,owner_id=NULL,lease_expires_at=NULL,health_run_id=$5,health_state=$6,updated_at=$4 WHERE id=$1 AND state='RUNNING' AND owner_id=$2 AND lease_id=$3 AND lease_expires_at > $4 RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [runId, ownerId, leaseId, now, healthRunId, healthState],
        );
        if (!result.rows[0]) return staleOwner();
        await q.query(
          `UPDATE health_schedules SET last_success_at=$2,updated_at=$2 WHERE id=$1`,
          [current.scheduleId, now],
        );
        return mapRun(result.rows[0]);
      });
    },

    async finishFailure({
      runId,
      ownerId,
      leaseId,
      now,
      failureClass,
      failureCode,
    }) {
      HealthFailureClassSchema.parse(failureClass);
      return runtime.transaction(async (q) => {
        const current = await oneRun(q, runId);
        if (current.ownerId !== ownerId || current.leaseId !== leaseId)
          return staleOwner();
        const scheduleResult = await q.query<{ cadence: unknown }>(
          `SELECT cadence FROM health_schedules WHERE id=$1`,
          [current.scheduleId],
        );
        const scheduleCadence = cadence(scheduleResult.rows[0]?.cadence);
        const nextState =
          current.attempt >= scheduleCadence.maxAttempts
            ? "FAILED_TERMINAL"
            : classifyFailure(failureClass, failureCode);
        assertScheduledRunTransition(current.state, nextState);
        const nextAttemptAt =
          nextState === "FAILED_RETRYABLE"
            ? retryAt(failureClass, current.attempt, now)
            : null;
        const result = await q.query<ScheduledRunRow>(
          `UPDATE health_scheduled_runs SET state=$4::health_scheduled_run_state,finished_at=$5,lease_id=NULL,owner_id=NULL,lease_expires_at=NULL,next_attempt_at=$6,failure_class=$7::health_failure_class,failure_code=$8,updated_at=$5 WHERE id=$1 AND state='RUNNING' AND owner_id=$2 AND lease_id=$3 AND lease_expires_at > $5 RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [
            runId,
            ownerId,
            leaseId,
            nextState,
            now,
            nextAttemptAt,
            failureClass,
            failureCode,
          ],
        );
        if (!result.rows[0]) return staleOwner();
        return mapRun(result.rows[0]);
      });
    },

    async timeoutRun({ runId, ownerId, leaseId, now, failureCode }) {
      return runtime.transaction(async (q) => {
        const current = await oneRun(q, runId);
        if (current.ownerId !== ownerId || current.leaseId !== leaseId)
          return staleOwner();
        assertScheduledRunTransition(current.state, "TIMED_OUT");
        const result = await q.query<ScheduledRunRow>(
          `UPDATE health_scheduled_runs SET state='TIMED_OUT',finished_at=$4,lease_id=NULL,owner_id=NULL,lease_expires_at=NULL,next_attempt_at=$5,failure_class='TRANSIENT_ENVIRONMENT',failure_code=$6,updated_at=$4 WHERE id=$1 AND state='RUNNING' AND owner_id=$2 AND lease_id=$3 AND lease_expires_at > $4 RETURNING id,schedule_id AS "scheduleId",monitor_target AS "monitorTarget",provider,surface,probe_layer AS "probeLayer",schedule_revision AS "scheduleRevision",due_slot_at AS "dueSlotAt",idempotency_key AS "idempotencyKey",state,owner_id AS "ownerId",lease_id AS "leaseId",claimed_at AS "claimedAt",lease_expires_at AS "leaseExpiresAt",attempt,started_at AS "startedAt",finished_at AS "finishedAt",next_attempt_at AS "nextAttemptAt",failure_class AS "failureClass",failure_code AS "failureCode",health_run_id AS "healthRunId",health_state AS "healthState"`,
          [
            runId,
            ownerId,
            leaseId,
            now,
            retryAt("TRANSIENT_ENVIRONMENT", current.attempt, now),
            failureCode,
          ],
        );
        if (!result.rows[0]) return staleOwner();
        return mapRun(result.rows[0]);
      });
    },

    async reconcilePersistedResults(now) {
      const result = await runtime.query<{ count: string }>(
        `WITH recovered AS (UPDATE health_scheduled_runs r SET state='SUCCEEDED',finished_at=$1,lease_id=NULL,owner_id=NULL,lease_expires_at=NULL,health_run_id=h.id,health_state=h.health_state,updated_at=$1 FROM health_runs h WHERE h.scheduled_run_id=r.id AND r.state IN ('CLAIMED','RUNNING','TIMED_OUT','FAILED_RETRYABLE') AND r.health_run_id IS NULL RETURNING r.schedule_id) UPDATE health_schedules s SET last_success_at=$1,updated_at=$1 FROM recovered WHERE s.id=recovered.schedule_id RETURNING 1`,
        [now],
      );
      return Number(result.rows.length);
    },

    async getScheduledRun(runId) {
      const result = await runtime.query<ScheduledRunRow>(
        `${runProjection} WHERE id=$1`,
        [runId],
      );
      return result.rows[0] ? mapRun(result.rows[0]) : undefined;
    },
  };
  return repository;
}
