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

function sqlRow(activeRunId: string | null) {
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
      ? new Date(now.valueOf() + 10000)
      : null,
    lastResult: activeRunId
      ? null
      : { ...result, runId: oldRun, finishedAt: now.toISOString() },
    notificationFailureCount: 0,
    lastNotificationError: null,
    updatedAt: now,
  };
}

function simulateConditionalWrite(
  affected: boolean,
  options?: { expiredWithoutTakeover?: boolean },
) {
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
      if (statement.startsWith("SELECT"))
        return { rows: [sqlRow(visibleActiveRun)] as unknown as T[] };
      if (
        statement.startsWith(
          "UPDATE monitoring_lane_schedules SET last_run_at=",
        )
      ) {
        expect(values[3]).toBe(oldRun);
        // Simulate ownership moving to a replacement run immediately
        // around this write. RETURNING still describes this exact UPDATE.
        visibleActiveRun = replacement;
        // The old implementation ignored lease expiration. In the test the
        // underlying row still has the same run ID, but its lease is expired.
        if (options?.expiredWithoutTakeover)
          return {
            rows: (statement.includes("active_run_lease_expires_at>$2")
              ? []
              : [sqlRow(null)]) as unknown as T[],
          };
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
    expect(fixture.sqlTexts).toHaveLength(1);
    expect(fixture.visibleActiveRun).toBe(replacement);
    expect(fixture.sqlTexts[0]).toContain("AND active_run_id=$4");
    expect(fixture.sqlTexts[0]).toContain("RETURNING lane,");
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
    expect(fixture.sqlTexts).toHaveLength(1);
  });

  it("rejects an expired lease even without a replacement run", async () => {
    const fixture = simulateConditionalWrite(true, {
      expiredWithoutTakeover: true,
    });
    const store = createPostgresMonitoringScheduleStore(fixture.runtime);
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId: oldRun,
        now: new Date(now.valueOf() + 10001),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    expect(fixture.sqlTexts).toHaveLength(1);
    expect(fixture.sqlTexts[0]).toContain("active_run_lease_expires_at>$2");
  });

  it("the in-memory store also rejects an expired unchanged lease", async () => {
    const store = new InMemoryMonitoringScheduleStore();
    await store.ensureDefaults(now);
    const started = await store.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now,
      leaseMs: 1000,
    });
    if (started.kind !== "STARTED") throw new Error("TEST_START_FAILED");
    await expect(
      store.finishRun({
        lane: "SWAGGER_API",
        runId: started.run.runId,
        now: new Date(now.valueOf() + 1001),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const current = await store.getState("SWAGGER_API");
    expect(current.activeRun?.runId).toBe(started.run.runId);
    expect(current.lastResult).toBeNull();
  });
});
