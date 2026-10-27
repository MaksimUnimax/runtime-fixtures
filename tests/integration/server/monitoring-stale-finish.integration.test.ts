import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createPostgresMonitoringScheduleStore } from "../../../packages/server/monitoring-control/src/store.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const connection = new URL(connectionString);
const allowedDatabases = new Set([
  "product_control_plane_test",
  "octoport_a_test",
  "octoport_b_test",
  "octoport_c_test",
]);
if (
  !["127.0.0.1", "localhost"].includes(connection.hostname) ||
  !allowedDatabases.has(decodeURIComponent(connection.pathname.slice(1)))
)
  throw new Error("C03_STALE_FINISH_DISPOSABLE_DATABASE_REQUIRED");

const schema = "c03_finish_" + randomUUID().replaceAll("-", "");
const admin = createDatabaseRuntime(connectionString);
const scopedUrl = new URL(connectionString);
scopedUrl.searchParams.set(
  "options",
  (scopedUrl.searchParams.get("options") ?? "") +
    " -csearch_path=" +
    schema +
    ",public",
);
const workerA = createDatabaseRuntime(scopedUrl.toString());
const workerB = createDatabaseRuntime(scopedUrl.toString());
const storeA = createPostgresMonitoringScheduleStore(workerA);
const storeB = createPostgresMonitoringScheduleStore(workerB);
const baseTime = new Date("2026-10-26T00:00:00.000Z");
const at = (seconds: number) => new Date(baseTime.valueOf() + seconds * 1000);
const result = {
  status: "SUCCEEDED" as const,
  code: null,
  summary: "synthetic monitoring finish",
};
let created = false;

async function expireActiveLease(runId: string): Promise<void> {
  // Synthetic time passage in the isolated disposable schema, without sleeps.
  const changed = await workerB.query<{ activeRunId: string }>(
    `UPDATE monitoring_lane_schedules
      SET active_run_lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE lane='SWAGGER_API' AND active_run_id=$1
      RETURNING active_run_id AS "activeRunId"`,
    [runId],
  );
  expect(changed.rows).toHaveLength(1);
  expect(changed.rows[0]?.activeRunId).toBe(runId);
}

function requiredRunId(
  start: Awaited<ReturnType<typeof storeA.startRun>>,
): string {
  if (start.kind !== "STARTED") throw new Error("C03_EXPECTED_STARTED");
  return start.run.runId;
}

describe.sequential("C03 PostgreSQL stale finish ownership", () => {
  beforeAll(async () => {
    await admin.ready();
    const identity = await admin.query<{ db: string }>(
      "SELECT current_database() AS db",
    );
    if (
      identity.rows[0]?.db !== decodeURIComponent(connection.pathname.slice(1))
    )
      throw new Error("C03_DATABASE_IDENTITY_MISMATCH");
    await runMigrations({ connectionString });
    await admin.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    await admin.query(
      'CREATE TABLE "' +
        schema +
        '".monitoring_lane_schedules (LIKE public.monitoring_lane_schedules INCLUDING ALL)',
    );
    await Promise.all([workerA.ready(), workerB.ready()]);
    for (const worker of [workerA, workerB]) {
      const active = await worker.query<{ schema: string }>(
        "SELECT current_schema() AS schema",
      );
      if (active.rows[0]?.schema !== schema)
        throw new Error("C03_SCHEMA_ISOLATION_FAILED");
    }
    await storeA.ensureDefaults(baseTime);
  }, 120000);

  afterAll(async () => {
    await Promise.allSettled([workerA.close(), workerB.close()]);
    if (created) await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.close();
  });

  it("rejects an expired old owner after a new connection takes its lease", async () => {
    const first = requiredRunId(
      await storeA.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(10),
        leaseMs: 1000,
      }),
    );
    await expireActiveLease(first);
    const replacement = requiredRunId(
      await storeB.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(12),
        leaseMs: 60000,
      }),
    );
    expect(replacement).not.toBe(first);
    await expect(
      storeA.finishRun({
        lane: "SWAGGER_API",
        runId: first,
        now: at(13),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const stillActive = await storeB.getState("SWAGGER_API");
    expect(stillActive.activeRun?.runId).toBe(replacement);
    expect(stillActive.lastResult).toBeNull();
    const finished = await storeB.finishRun({
      lane: "SWAGGER_API",
      runId: replacement,
      now: at(14),
      result,
    });
    expect(finished.activeRun).toBeNull();
    expect(finished.lastResult?.runId).toBe(replacement);
    expect((await storeA.getState("LLM")).lastResult).toBeNull();
  });

  it("serializes simultaneous old and valid finishes across separate connections", async () => {
    const first = requiredRunId(
      await storeA.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(30),
        leaseMs: 1000,
      }),
    );
    await expireActiveLease(first);
    const replacement = requiredRunId(
      await storeB.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(32),
        leaseMs: 60000,
      }),
    );
    const [stale, current] = await Promise.allSettled([
      storeA.finishRun({
        lane: "SWAGGER_API",
        runId: first,
        now: at(33),
        result,
      }),
      storeB.finishRun({
        lane: "SWAGGER_API",
        runId: replacement,
        now: at(33),
        result,
      }),
    ]);
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected")
      expect((stale.reason as Error).message).toBe(
        "MONITORING_RUN_STALE_OWNER",
      );
    expect(current.status).toBe("fulfilled");
    if (current.status === "fulfilled")
      expect(current.value.lastResult?.runId).toBe(replacement);
    const durable = await storeA.getState("SWAGGER_API");
    expect(durable.activeRun).toBeNull();
    expect(durable.lastResult?.runId).toBe(replacement);
  });
  it("uses PostgreSQL clock for completion metadata even with backdated caller time", async () => {
    const started = await storeA.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now: at(39),
      leaseMs: 60000,
    });
    const runId = requiredRunId(started);
    const clockBefore = await workerB.query<{ now: Date }>(
      'SELECT clock_timestamp() AS "now"',
    );
    const completed = await storeA.finishRun({
      lane: "SWAGGER_API",
      runId,
      now: new Date("2000-01-01T00:00:00.000Z"),
      result,
    });
    const clockAfter = await workerB.query<{ now: Date }>(
      'SELECT clock_timestamp() AS "now"',
    );
    expect(completed.activeRun).toBeNull();
    expect(completed.lastResult?.runId).toBe(runId);
    if (!completed.lastRunAt || !completed.lastResult)
      throw new Error("C03_MISSING_COMPLETION_METADATA");
    const earliest = clockBefore.rows[0]!.now.getTime();
    const latest = clockAfter.rows[0]!.now.getTime();
    for (const time of [
      completed.lastRunAt,
      completed.lastResult.finishedAt,
      completed.updatedAt,
    ]) {
      expect(time.getTime()).toBeGreaterThanOrEqual(earliest);
      expect(time.getTime()).toBeLessThanOrEqual(latest);
    }
    const persisted = await storeB.getState("SWAGGER_API");
    expect(persisted.lastRunAt).toEqual(completed.lastRunAt);
    expect(persisted.lastResult?.finishedAt).toEqual(
      completed.lastResult.finishedAt,
    );
    expect(persisted.updatedAt).toEqual(completed.updatedAt);
    expect(completed.lastRunAt).toEqual(completed.lastResult.finishedAt);
    expect(completed.updatedAt).toEqual(completed.lastRunAt);
  });

  it("rejects an expired owner without a replacement on physical PostgreSQL", async () => {
    const beforeDb = await workerB.query<{ now: Date }>(
      'SELECT clock_timestamp() AS "now"',
    );
    const begun = await storeA.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now: at(45), // deliberately backdated to test clock authority
      leaseMs: 60000,
    });
    const runId = requiredRunId(begun);
    const afterDb = await workerB.query<{ now: Date }>(
      'SELECT clock_timestamp() AS "now"',
    );
    if (begun.kind !== "STARTED") throw new Error("C03_EXPECTED_STARTED");
    expect(begun.run.startedAt.getTime()).toBeGreaterThanOrEqual(
      beforeDb.rows[0]!.now.getTime(),
    );
    expect(begun.run.startedAt.getTime()).toBeLessThanOrEqual(
      afterDb.rows[0]!.now.getTime(),
    );
    expect(
      begun.run.leaseExpiresAt.getTime() - begun.run.startedAt.getTime(),
    ).toBe(60000);
    const before = await storeB.getState("SWAGGER_API");
    expect(before.activeRun?.runId).toBe(runId);
    await expireActiveLease(runId);
    await expect(
      storeA.finishRun({
        lane: "SWAGGER_API",
        runId,
        now: at(46),
        result,
      }),
    ).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const after = await storeB.getState("SWAGGER_API");
    expect(after.activeRun?.runId).toBe(runId);
    expect(after.lastResult).toEqual(before.lastResult);
    expect(after.lastRunAt).toEqual(before.lastRunAt);
  });
  it("rejects a finish that waited on the row lock beyond lease expiry", async () => {
    const start = await storeA.startRun({
      lane: "SWAGGER_API",
      source: "FORCED",
      now: at(50),
      leaseMs: 1600,
    });
    const runId = requiredRunId(start);
    let lockAcquired!: () => void;
    let lockFailed!: (reason: unknown) => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve, reject) => {
      lockAcquired = resolve;
      lockFailed = reject;
    });
    const permitRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = workerB.transaction(async (query) => {
      const row = await query.query<{ activeRunId: string }>(
        'SELECT active_run_id AS "activeRunId" FROM monitoring_lane_schedules WHERE lane=$1 FOR UPDATE',
        ["SWAGGER_API"],
      );
      expect(row.rows[0]?.activeRunId).toBe(runId);
      lockAcquired();
      await permitRelease;
    });
    // If acquiring the lane row itself fails, reject the readiness barrier,
    // rather than waiting until the test's timeout with a pending promise.
    void holder.catch(lockFailed);
    let pending: ReturnType<typeof storeA.finishRun> | null = null;
    try {
      // Readiness and the blocked completion are both covered by cleanup.
      await locked;
      pending = storeA.finishRun({
        lane: "SWAGGER_API",
        runId,
        now: at(51),
        result,
      });
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // Finish must be blocked by the holder while its lease expires.
      await new Promise((resolve) => setTimeout(resolve, 1900));
      expect(settled).toBe(false);
    } finally {
      releaseLock();
      await holder;
    }
    if (!pending) throw new Error("C03_LOCK_TEST_MISSING_PENDING_FINISH");
    await expect(pending).rejects.toThrow("MONITORING_RUN_STALE_OWNER");
    const after = await storeB.getState("SWAGGER_API");
    expect(after.activeRun?.runId).toBe(runId);
    expect(after.lastResult?.runId).not.toBe(runId);
  }, 12000);
});
