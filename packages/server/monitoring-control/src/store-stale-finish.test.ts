import { describe, expect, it } from "vitest";
import {
  createPostgresMonitoringScheduleStore,
  InMemoryMonitoringScheduleStore,
  type MonitoringSqlQuery,
  type MonitoringSqlRuntime,
} from "./store.js";

const oldRun = "11111111-1111-4111-8111-111111111111";
const replacement = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-26T00:00:00.000Z");
const result = {
  status: "SUCCEEDED" as const,
  code: null,
  summary: "synthetic successful monitoring",
};

function sqlRow(activeRunId: string | null, expiredAtLock = false) {
  return {
    lane: "SWAGGER_API",
    enabled: true,
    intervalSeconds: 21600,
    nextRunAt: new Date(now.valueOf() + 21600 * 1000),
    lastRunAt: activeRunId ? null : now,
    activeRunId,
    activeRunSource: activeRunId ? "SCHEDULED" : null,
    activeRunStartedAt: activeRunId ? new Date(now.valueOf() - 5000) : null,
    activeRunLeaseExpiresAt: activeRunId
      ? new Date(now.valueOf() + (expiredAtLock ? -10000 : 10000))
      : null,
    lastResult: activeRunId
      ? null
      : { ...result, runId: oldRun, finishedAt: now.toISOString() },
    notificationFailureCount: 0,
    lastNotificationError: null,
    updatedAt: now,
  };
}

function simulateConditionalWrite(affected: boolean, expiredAtLock = false) {
  const sqlTexts: string[] = [];
  const params: unknown[][] = [];
  // Another scheduler may take over after the old owner's conditional
  // completion attempt. A later SELECT must not be treated as its receipt.
  let visibleActiveRun = oldRun;
  const runtime: MonitoringSqlRuntime = {
    async query<T extends Record<string, unknown>>(
      statement: string,
      values: unknown[] = [],
    ) {
      sqlTexts.push(statement);
      params.push(values);
      if (statement === 'SELECT clock_timestamp() AS "now"')
        return { rows: [{ now }] as unknown as T[] };
      if (statement.startsWith("SELECT"))
        return {
          rows: [sqlRow(visibleActiveRun, expiredAtLock)] as unknown as T[],
        };
      if (statement.startsWith("UPDATE monitoring_lane_schedules")) {
        expect(values[3]).toBe(oldRun);
        // Simulate ownership moving to a replacement run immediately
        // around this write. RETURNING still describes this exact UPDATE.
        visibleActiveRun = replacement;
        return {
          rows: (affected ? [sqlRow(null)] : []) as unknown as T[],
        };
      }
      throw new Error("SYNTHETIC_SQL_NOT_EXPECTED");
    },
    async transaction<T>(operation: (query: MonitoringSqlQuery) => Promise<T>) {
      return operation(this);
    },
  };
  return {
    runtime,
    sqlTexts,
    params,
    get visibleActiveRun() {
      return visibleActiveRun;
    },
  };
}

describe("C03 PostgreSQL monitor completion stale owner fencing", () => {
  it("updates scheduled retry deadline atomically without reading a stale snapshot", async () => {
    const statements: string[] = [];
    const timestamp = new Date(now.valueOf() + 30_000);
    const earlier = new Date(now.valueOf() + 12_000);
    const mock: MonitoringSqlRuntime = {
      async query<T extends Record<string, unknown>>(
        statement: string,
        values: unknown[] = [],
      ) {
        statements.push(statement);
        expect(statement).toContain("next_run_at=LEAST(next_run_at,$2)");
        expect(statement).toContain("RETURNING lane,");
        expect(values).toEqual(["SWAGGER_API", earlier, timestamp]);
        // Return the actual row from the atomic write, not a stale pre-write read.
        return {
          rows: [
            { ...sqlRow(null), nextRunAt: earlier, updatedAt: timestamp },
          ] as unknown as T[],
        };
      },
      async transaction<T>(
        callback: (query: MonitoringSqlQuery) => Promise<T>,
      ) {
        return callback(this);
      },
    };
    const current = await createPostgresMonitoringScheduleStore(
      mock,
    ).scheduleEarlier("SWAGGER_API", earlier, timestamp);
    expect(statements).toHaveLength(1);
    expect(current.nextRunAt).toEqual(earlier);
    expect(current.updatedAt).toEqual(timestamp);
  });

  it("rejects an expired owner without a takeover in memory", async () => {
    const store = new InMemoryMonitoringScheduleStore();
    await store.ensureDefaults(now);
    const started = await store.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now,
      leaseMs: 1000,
    });
    expect(started.kind).toBe("STARTED");
    if (started.kind !== "STARTED") throw new Error("EXPECTED_STARTED");
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId: started.run.runId,
        now: new Date(now.valueOf() + 1000),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const retained = await store.getState("SWAGGER_API");
    expect(retained.activeRun?.runId).toBe(started.run.runId);
    expect(retained.lastResult).toBeNull();
  });

  it("requires a nonexpired lease in the atomic PostgreSQL completion", async () => {
    const fixture = simulateConditionalWrite(false);
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId: oldRun,
        now,
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(fixture.sqlTexts).toHaveLength(3);
    expect(fixture.sqlTexts[0]).toContain("FOR UPDATE");
    expect(fixture.sqlTexts[1]).toBe('SELECT clock_timestamp() AS "now"');
    expect(fixture.sqlTexts[2]).toMatch(
      /AND active_run_id=\$4\s+AND active_run_lease_expires_at>clock_timestamp\(\)/,
    );
  });

  it("rejects stale owner if its conditional update affected no row", async () => {
    const fixture = simulateConditionalWrite(false);
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId: oldRun,
        now,
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(fixture.sqlTexts).toHaveLength(3);
    expect(fixture.visibleActiveRun).toBe(replacement);
    expect(fixture.sqlTexts[2]).toContain("AND active_run_id=$4");
    expect(fixture.sqlTexts[2]).toContain("RETURNING lane,");
  });

  it("uses PostgreSQL clock for completion metadata rather than caller timestamp", async () => {
    const fixture = simulateConditionalWrite(true);
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    await store.finishRun({
      lane: "SWAGGER_API",
      runId: oldRun,
      now: new Date("2000-01-01T00:00:00.000Z"),
      result,
    });
    expect(fixture.sqlTexts).toHaveLength(3);
    expect(fixture.sqlTexts[0]).toContain("FOR UPDATE");
    expect(fixture.sqlTexts[1]).toBe('SELECT clock_timestamp() AS "now"');
    expect(fixture.sqlTexts[2]).toContain("last_run_at=$2");
    expect(fixture.sqlTexts[2]).toContain("updated_at=$2");
    expect(fixture.sqlTexts[2]).toContain(
      "last_result=jsonb_set($3::jsonb,'{finishedAt}',to_jsonb($2::timestamptz),true)",
    );
    expect(fixture.params[2]).toHaveLength(4);
    expect(fixture.params[2]?.[1]).toEqual(now);
    expect(fixture.params[2]?.[3]).toBe(oldRun);
    expect(JSON.parse(fixture.params[2]?.[2] as string)).toEqual({
      ...result,
      runId: oldRun,
    });
  });

  it("returns the exact written row without reading a replacement run", async () => {
    const fixture = simulateConditionalWrite(true);
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    const confirmed = await store.finishRun({
      lane: "SWAGGER_API",
      runId: oldRun,
      now,
      result,
    });
    expect(confirmed.activeRun).toBeNull();
    expect(confirmed.lastResult?.runId).toBe(oldRun);
    expect(confirmed.lastResult?.status).toBe("SUCCEEDED");
    expect(fixture.visibleActiveRun).toBe(replacement);
    expect(fixture.sqlTexts).toHaveLength(3);
  });

  it("rejects an expired lease after the lane row is locked, without writing", async () => {
    const fixture = simulateConditionalWrite(true, true);
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    await expect(
      store.finishRun({ lane: "SWAGGER_API", runId: oldRun, now, result }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(fixture.sqlTexts).toHaveLength(2);
    expect(fixture.sqlTexts[0]).toContain("FOR UPDATE");
    expect(fixture.sqlTexts[1]).toBe('SELECT clock_timestamp() AS "now"');
    expect(fixture.visibleActiveRun).toBe(oldRun);
  });
});
