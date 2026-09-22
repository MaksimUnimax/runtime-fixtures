import { randomUUID } from "node:crypto";
import {
  MONITORING_DEFAULT_INTERVAL_SECONDS,
  MONITORING_LANES,
  MonitoringLaneSchema,
  MonitoringResultStatusSchema,
  MonitoringRunSourceSchema,
  safeMonitoringResult,
  type MonitoringClock,
  type MonitoringLane,
  type MonitoringLaneState,
  type MonitoringRun,
  type MonitoringRunResult,
  type MonitoringRunSource,
  type MonitoringStartResult,
} from "./contracts.js";
export { MONITORING_LANES } from "./contracts.js";

export interface MonitoringScheduleStore {
  ensureDefaults(now: Date): Promise<void>;
  getState(lane: MonitoringLane): Promise<MonitoringLaneState>;
  setInterval(
    lane: MonitoringLane,
    intervalSeconds: number,
    now: Date,
  ): Promise<MonitoringLaneState>;
  scheduleEarlier(lane: MonitoringLane, retryAt: Date, now: Date): Promise<MonitoringLaneState>;
  startRun(input: {
    lane: MonitoringLane;
    source: MonitoringRunSource;
    now: Date;
    leaseMs: number;
  }): Promise<MonitoringStartResult>;
  finishRun(input: {
    lane: MonitoringLane;
    runId: string;
    now: Date;
    result: MonitoringRunResult;
  }): Promise<MonitoringLaneState>;
  recordNotificationFailure(input: {
    lane: MonitoringLane;
    now: Date;
    error: string;
  }): Promise<void>;
}

type StartRunInput = Parameters<MonitoringScheduleStore["startRun"]>[0];
type FinishRunInput = Parameters<MonitoringScheduleStore["finishRun"]>[0];
type NotificationFailureInput = Parameters<
  MonitoringScheduleStore["recordNotificationFailure"]
>[0];

function cloneState(state: MonitoringLaneState): MonitoringLaneState {
  return {
    ...state,
    nextRunAt: new Date(state.nextRunAt),
    lastRunAt: state.lastRunAt ? new Date(state.lastRunAt) : null,
    activeRun: state.activeRun
      ? {
          ...state.activeRun,
          startedAt: new Date(state.activeRun.startedAt),
          leaseExpiresAt: new Date(state.activeRun.leaseExpiresAt),
        }
      : null,
    lastResult: state.lastResult
      ? {
          ...state.lastResult,
          finishedAt: new Date(state.lastResult.finishedAt),
        }
      : null,
    updatedAt: new Date(state.updatedAt),
  };
}

export class InMemoryMonitoringScheduleStore
  implements MonitoringScheduleStore
{
  private readonly states = new Map<MonitoringLane, MonitoringLaneState>();

  async ensureDefaults(now: Date): Promise<void> {
    for (const lane of MONITORING_LANES) {
      if (this.states.has(lane)) continue;
      this.states.set(lane, {
        lane,
        enabled: true,
        intervalSeconds: MONITORING_DEFAULT_INTERVAL_SECONDS[lane],
        nextRunAt: new Date(
          now.valueOf() + MONITORING_DEFAULT_INTERVAL_SECONDS[lane] * 1000,
        ),
        lastRunAt: null,
        activeRun: null,
        lastResult: null,
        notificationFailureCount: 0,
        lastNotificationError: null,
        updatedAt: new Date(now),
      });
    }
  }

  private state(lane: MonitoringLane): MonitoringLaneState {
    const state = this.states.get(lane);
    if (!state) throw new Error("MONITORING_SCHEDULE_NOT_INITIALIZED");
    return state;
  }

  async getState(lane: MonitoringLane): Promise<MonitoringLaneState> {
    return cloneState(this.state(lane));
  }

  async setInterval(
    lane: MonitoringLane,
    intervalSeconds: number,
    now: Date,
  ): Promise<MonitoringLaneState> {
    const state = this.state(lane);
    state.intervalSeconds = intervalSeconds;
    state.nextRunAt = new Date(now.valueOf() + intervalSeconds * 1000);
    state.updatedAt = new Date(now);
    return cloneState(state);
  }

  async scheduleEarlier(lane: MonitoringLane, retryAt: Date, now: Date) {
    const state = this.state(lane);
    if (retryAt < state.nextRunAt) state.nextRunAt = new Date(retryAt);
    state.updatedAt = new Date(now);
    return cloneState(state);
  }

  async startRun({
    lane,
    source,
    now,
    leaseMs,
  }: StartRunInput): Promise<MonitoringStartResult> {
    const state = this.state(lane);
    if (state.activeRun && state.activeRun.leaseExpiresAt > now) {
      return { kind: "ALREADY_RUNNING", runId: state.activeRun.runId };
    }
    if (source === "SCHEDULED" && (!state.enabled || state.nextRunAt > now))
      return { kind: "NOT_DUE" };
    const run: MonitoringRun = {
      runId: randomUUID(),
      lane,
      source,
      startedAt: new Date(now),
      leaseExpiresAt: new Date(now.valueOf() + leaseMs),
    };
    state.activeRun = { ...run };
    if (source === "SCHEDULED")
      state.nextRunAt = new Date(now.valueOf() + state.intervalSeconds * 1000);
    state.updatedAt = new Date(now);
    return { kind: "STARTED", run };
  }

  async finishRun({
    lane,
    runId,
    now,
    result,
  }: FinishRunInput): Promise<MonitoringLaneState> {
    const state = this.state(lane);
    if (!state.activeRun || state.activeRun.runId !== runId)
      throw new Error("MONITORING_RUN_STALE_OWNER");
    state.lastRunAt = new Date(now);
    state.lastResult = {
      ...safeMonitoringResult(result),
      runId,
      finishedAt: new Date(now),
    };
    state.activeRun = null;
    state.updatedAt = new Date(now);
    return cloneState(state);
  }

  async recordNotificationFailure({
    lane,
    now,
    error,
  }: NotificationFailureInput): Promise<void> {
    const state = this.state(lane);
    state.notificationFailureCount += 1;
    state.lastNotificationError = error.slice(0, 160);
    state.updatedAt = new Date(now);
  }
}

export function createMemoryMonitoringScheduleStore(
  clock: MonitoringClock = { now: () => new Date() },
): InMemoryMonitoringScheduleStore {
  const store = new InMemoryMonitoringScheduleStore();
  void store.ensureDefaults(clock.now());
  return store;
}

export type MonitoringSqlQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type MonitoringSqlRuntime = MonitoringSqlQuery & {
  transaction<T>(
    operation: (query: MonitoringSqlQuery) => Promise<T>,
  ): Promise<T>;
};

type StateRow = {
  lane: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  activeRunId: string | null;
  activeRunSource: string | null;
  activeRunStartedAt: Date | null;
  activeRunLeaseExpiresAt: Date | null;
  lastResult: unknown;
  notificationFailureCount: number;
  lastNotificationError: string | null;
  updatedAt: Date;
};

const stateProjection = `SELECT lane,enabled,interval_seconds AS "intervalSeconds",next_run_at AS "nextRunAt",last_run_at AS "lastRunAt",active_run_id AS "activeRunId",active_run_source AS "activeRunSource",active_run_started_at AS "activeRunStartedAt",active_run_lease_expires_at AS "activeRunLeaseExpiresAt",last_result AS "lastResult",notification_failure_count AS "notificationFailureCount",last_notification_error AS "lastNotificationError",updated_at AS "updatedAt" FROM monitoring_lane_schedules`;

function mapState(row: StateRow): MonitoringLaneState {
  const lane = MonitoringLaneSchema.parse(row.lane);
  const lastResult =
    row.lastResult && typeof row.lastResult === "object"
      ? (row.lastResult as {
          runId: string;
          finishedAt: string | Date;
          status: string;
          code: string | null;
          summary: string;
        })
      : null;
  return {
    lane,
    enabled: row.enabled,
    intervalSeconds: row.intervalSeconds,
    nextRunAt: new Date(row.nextRunAt),
    lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
    activeRun:
      row.activeRunId &&
      row.activeRunStartedAt &&
      row.activeRunLeaseExpiresAt &&
      row.activeRunSource
        ? {
            runId: row.activeRunId,
            source: MonitoringRunSourceSchema.parse(row.activeRunSource),
            startedAt: new Date(row.activeRunStartedAt),
            leaseExpiresAt: new Date(row.activeRunLeaseExpiresAt),
          }
        : null,
    lastResult: lastResult
      ? {
          ...safeMonitoringResult({
            status: MonitoringResultStatusSchema.parse(lastResult.status),
            code: lastResult.code,
            summary: lastResult.summary,
          }),
          runId: lastResult.runId,
          finishedAt: new Date(lastResult.finishedAt),
        }
      : null,
    notificationFailureCount: row.notificationFailureCount,
    lastNotificationError: row.lastNotificationError,
    updatedAt: new Date(row.updatedAt),
  };
}

export function createPostgresMonitoringScheduleStore(
  runtime: MonitoringSqlRuntime,
): MonitoringScheduleStore {
  async function read(
    query: MonitoringSqlQuery,
    lane: MonitoringLane,
    forUpdate = false,
  ): Promise<MonitoringLaneState> {
    const result = await query.query<StateRow>(
      `${stateProjection} WHERE lane=$1${forUpdate ? " FOR UPDATE" : ""}`,
      [lane],
    );
    if (!result.rows[0]) throw new Error("MONITORING_SCHEDULE_NOT_FOUND");
    return mapState(result.rows[0]);
  }
  return {
    async ensureDefaults(now) {
      for (const lane of MONITORING_LANES) {
        const interval = MONITORING_DEFAULT_INTERVAL_SECONDS[lane];
        await runtime.query(
          `INSERT INTO monitoring_lane_schedules(lane,enabled,interval_seconds,next_run_at) VALUES($1,true,$2,$3) ON CONFLICT (lane) DO NOTHING`,
          [lane, interval, new Date(now.valueOf() + interval * 1000)],
        );
      }
    },
    getState: (lane) => read(runtime, lane),
    async setInterval(lane, intervalSeconds, now) {
      const result = await runtime.query<StateRow>(
        `${stateProjection} WHERE lane=$1`,
        [lane],
      );
      if (!result.rows[0]) throw new Error("MONITORING_SCHEDULE_NOT_FOUND");
      const updated = await runtime.query<StateRow>(
        `${stateProjection} WHERE lane=$1`,
        [lane],
      );
      await runtime.query(
        `UPDATE monitoring_lane_schedules SET interval_seconds=$2,next_run_at=$3,updated_at=$4 WHERE lane=$1`,
        [
          lane,
          intervalSeconds,
          new Date(now.valueOf() + intervalSeconds * 1000),
          now,
        ],
      );
      return mapState({
        ...updated.rows[0]!,
        intervalSeconds,
        nextRunAt: new Date(now.valueOf() + intervalSeconds * 1000),
        updatedAt: now,
      });
    },
    async scheduleEarlier(lane, retryAt, now) {
      const current = await read(runtime, lane);
      const nextRunAt = retryAt < current.nextRunAt ? retryAt : current.nextRunAt;
      await runtime.query(`UPDATE monitoring_lane_schedules SET next_run_at=$2,updated_at=$3 WHERE lane=$1`, [lane, nextRunAt, now]);
      return { ...current, nextRunAt: new Date(nextRunAt), updatedAt: new Date(now) };
    },
    async startRun({ lane, source, now, leaseMs }) {
      return runtime.transaction(async (query) => {
        // The lane row is the durable single-flight lock. A transaction alone
        // is not sufficient: without FOR UPDATE, concurrent schedulers can
        // both observe an idle row and overwrite each other's active run.
        const current = await read(query, lane, true);
        if (current.activeRun && current.activeRun.leaseExpiresAt > now)
          return { kind: "ALREADY_RUNNING", runId: current.activeRun.runId };
        if (
          source === "SCHEDULED" &&
          (!current.enabled || current.nextRunAt > now)
        )
          return { kind: "NOT_DUE" };
        const run: MonitoringRun = {
          runId: randomUUID(),
          lane,
          source,
          startedAt: new Date(now),
          leaseExpiresAt: new Date(now.valueOf() + leaseMs),
        };
        const nextRunAt =
          source === "SCHEDULED"
            ? new Date(now.valueOf() + current.intervalSeconds * 1000)
            : current.nextRunAt;
        await query.query(
          `UPDATE monitoring_lane_schedules SET active_run_id=$2,active_run_source=$3,active_run_started_at=$4,active_run_lease_expires_at=$5,next_run_at=$6,updated_at=$7 WHERE lane=$1`,
          [lane, run.runId, source, now, run.leaseExpiresAt, nextRunAt, now],
        );
        return { kind: "STARTED", run };
      });
    },
    async finishRun({ lane, runId, now, result }) {
      const safe = safeMonitoringResult(result);
      const current = await read(runtime, lane);
      if (!current.activeRun || current.activeRun.runId !== runId)
        throw new Error("MONITORING_RUN_STALE_OWNER");
      await runtime.query(
        `UPDATE monitoring_lane_schedules SET last_run_at=$2,active_run_id=NULL,active_run_source=NULL,active_run_started_at=NULL,active_run_lease_expires_at=NULL,last_result=$3::jsonb,updated_at=$2 WHERE lane=$1 AND active_run_id=$4`,
        [
          lane,
          now,
          JSON.stringify({ ...safe, runId, finishedAt: now.toISOString() }),
          runId,
        ],
      );
      return read(runtime, lane);
    },
    async recordNotificationFailure({ lane, now, error }) {
      await runtime.query(
        `UPDATE monitoring_lane_schedules SET notification_failure_count=notification_failure_count+1,last_notification_error=$2,updated_at=$3 WHERE lane=$1`,
        [lane, error.slice(0, 160), now],
      );
    },
  };
}
