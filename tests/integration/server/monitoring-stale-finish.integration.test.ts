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
    const replacement = requiredRunId(
      await storeB.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(12),
        leaseMs: 5000,
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
    const replacement = requiredRunId(
      await storeB.startRun({
        lane: "SWAGGER_API",
        source: "FORCED",
        now: at(32),
        leaseMs: 5000,
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
});
