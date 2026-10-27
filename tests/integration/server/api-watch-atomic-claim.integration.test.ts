import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createPostgresApiWatchAttemptFenceRepository } from "../../../tooling/api-watch/src/retry-attempt-repository.js";
import type { ApiWatchSqlRuntime } from "../../../tooling/api-watch/src/types.js";

/**
 * PostgreSQL-only source proof. All mutations are to an isolated scratch
 * schema of an explicitly allowlisted local disposable test database.
 * No marketplace URL or credential is accessed.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("C03_R40_DISPOSABLE_DATABASE_REQUIRED");
const url = new URL(connectionString);
const allowed = new Set([
  "product_control_plane_test",
  "octoport_a_test",
  "octoport_b_test",
  "octoport_c_test",
]);
const dbName = decodeURIComponent(url.pathname.slice(1));
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  url.search !== "" ||
  url.hash !== "" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !allowed.has(dbName)
)
  throw new Error("C03_R40_DISPOSABLE_DATABASE_REQUIRED");

const schema = "c03_claim_" + randomUUID().replaceAll("-", "");
const runtime = createDatabaseRuntime(connectionString);
const runA = "11111111-1111-4111-8111-111111111111";
const runB = "22222222-2222-4222-8222-222222222222";
let schemaCreated = false;

const scoped: ApiWatchSqlRuntime = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => runtime.query<T>(sql, params),
  transaction: (operation) =>
    runtime.transaction(async (tx) => {
      // Constrain each transaction to our unique temporary namespace.
      await tx.query(`SET LOCAL search_path TO "${schema}"`);
      return operation(tx);
    }),
};
const repository = createPostgresApiWatchAttemptFenceRepository(scoped);

async function seedDueRetry() {
  const clock = await runtime.query<{ now: Date }>(
    'SELECT clock_timestamp() AS "now"',
  );
  const now = clock.rows[0]?.now;
  if (!(now instanceof Date)) throw new Error("C03_R40_PG_CLOCK_MISSING");
  const expires = new Date(now.getTime() + 15 * 60_000);
  await runtime.query(
    `INSERT INTO "${schema}".monitoring_lane_schedules
      (lane, active_run_id, active_run_source, active_run_lease_expires_at,
       active_run_trigger, ordinary_due_provenance, ordinary_next_run_at)
     VALUES ('SWAGGER_API', $1, 'SCHEDULED', $2, 'RETRY', 'KNOWN', $3)`,
    [runA, expires, new Date(now.getTime() + 6 * 3_600_000)],
  );
  await runtime.query(
    `INSERT INTO "${schema}".api_watch_retry_state
      (source_family,next_retry_at) VALUES ('OZON_SELLER',$1)`,
    [new Date(now.getTime() - 30_000)],
  );
  await runtime.query(
    `INSERT INTO "${schema}".api_watch_family_attempt_fences (source_family)
     VALUES ('OZON_SELLER'),('OZON_PERFORMANCE'),('WILDBERRIES')`,
  );
}

async function fence(family = "OZON_SELLER") {
  const rows = await runtime.query<{
    claim_stage: string;
    claimed_run_id: string | null;
    outcome_unknown: boolean;
    entered_at: Date | null;
  }>(
    `SELECT claim_stage,claimed_run_id,outcome_unknown,entered_at
     FROM "${schema}".api_watch_family_attempt_fences WHERE source_family=$1`,
    [family],
  );
  return rows.rows[0]!;
}

async function retryDeadline() {
  const rows = await runtime.query<{ next_retry_at: Date | null }>(
    `SELECT next_retry_at FROM "${schema}".api_watch_retry_state
       WHERE source_family='OZON_SELLER'`,
  );
  return rows.rows[0]!.next_retry_at;
}

describe.sequential(
  "C03 physical PostgreSQL atomic source-family claim",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      const identity = await runtime.query<{ db: string }>(
        "SELECT current_database() AS db",
      );
      if (identity.rows[0]?.db !== dbName)
        throw new Error("C03_R40_DISPOSABLE_IDENTITY_CHANGED");
      await runMigrations({ connectionString });
      await runtime.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      await runtime.query(
        `CREATE TABLE "${schema}".monitoring_lane_schedules (
        lane varchar(16) PRIMARY KEY,
        active_run_id uuid,
        active_run_source varchar(16),
        active_run_lease_expires_at timestamptz,
        active_run_trigger varchar(16),
        ordinary_due_provenance varchar(16),
        ordinary_next_run_at timestamptz
      )`,
      );
      await runtime.query(
        `CREATE TABLE "${schema}".api_watch_retry_state (
        source_family varchar(32) PRIMARY KEY,
        next_retry_at timestamptz
      )`,
      );
      await runtime.query(
        `CREATE TABLE "${schema}".api_watch_family_attempt_fences
        (LIKE public.api_watch_family_attempt_fences INCLUDING ALL)`,
      );
    }, 120000);

    beforeEach(async () => {
      await runtime.query(
        `TRUNCATE TABLE "${schema}".api_watch_family_attempt_fences,
       "${schema}".api_watch_retry_state,
       "${schema}".monitoring_lane_schedules`,
      );
      await seedDueRetry();
    });

    afterAll(async () => {
      try {
        if (schemaCreated)
          await runtime.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await runtime.close();
      }
    });

    it("claims exactly one due family under the verified scheduled retry lease", async () => {
      const previousDue = await retryDeadline();
      const claimed = await repository.claimDue("OZON_SELLER", runA);
      expect(claimed?.claimStage).toBe("CLAIMED");
      expect(claimed?.claimedRunId).toBe(runA);
      expect((await fence()).claim_stage).toBe("CLAIMED");
      expect((await fence("WILDBERRIES")).claim_stage).toBe("IDLE");
      expect((await fence("OZON_PERFORMANCE")).claim_stage).toBe("IDLE");
      expect(await retryDeadline()).toEqual(previousDue);
    });

    it("serializes two concurrent claims on the same lane and family row", async () => {
      const decisions = await Promise.allSettled([
        repository.claimDue("OZON_SELLER", runA),
        repository.claimDue("OZON_SELLER", runA),
      ]);
      expect(decisions.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(decisions.filter((x) => x.status === "rejected")).toHaveLength(1);
      const rejected = decisions.find((x) => x.status === "rejected");
      expect(rejected && "reason" in rejected && rejected.reason.message).toBe(
        "API_WATCH_RETRY_ALREADY_CLAIMED",
      );
      expect((await fence()).claim_stage).toBe("CLAIMED");
    });

    it("refuses stale provider entry and commits ENTERED for the exact owner", async () => {
      await repository.claimDue("OZON_SELLER", runA);
      await expect(repository.enter("OZON_SELLER", runB)).rejects.toThrow(
        "API_WATCH_RETRY_LANE_NOT_AUTHORIZED",
      );
      expect((await fence()).entered_at).toBeNull();
      const entered = await repository.enter("OZON_SELLER", runA);
      expect(entered.claimStage).toBe("ENTERED");
      expect((await fence()).entered_at).toBeInstanceOf(Date);
      await expect(
        repository.releaseUnentered("OZON_SELLER", runA),
      ).rejects.toThrow("API_WATCH_RETRY_WAS_ENTERED_OR_NOT_CLAIMED");
    });

    it("releases only an unentered claim and preserves due retry authority", async () => {
      const previousDue = await retryDeadline();
      await repository.claimDue("OZON_SELLER", runA);
      const released = await repository.releaseUnentered("OZON_SELLER", runA);
      expect(released.claimStage).toBe("IDLE");
      expect((await fence()).outcome_unknown).toBe(false);
      expect(await retryDeadline()).toEqual(previousDue);
      expect((await repository.claimDue("OZON_SELLER", runA))?.claimStage).toBe(
        "CLAIMED",
      );
    });

    it("rejects an untrusted ordinary due and missing RETRY trigger", async () => {
      await runtime.query(
        `UPDATE "${schema}".monitoring_lane_schedules
       SET ordinary_due_provenance='UNKNOWN',ordinary_next_run_at=NULL`,
      );
      await expect(repository.claimDue("OZON_SELLER", runA)).rejects.toThrow(
        "API_WATCH_RETRY_LANE_NOT_AUTHORIZED",
      );
      await runtime.query(
        `UPDATE "${schema}".monitoring_lane_schedules
       SET ordinary_due_provenance='KNOWN',ordinary_next_run_at=now()+interval '6 hours',
           active_run_trigger=NULL`,
      );
      await expect(repository.claimDue("OZON_SELLER", runA)).rejects.toThrow(
        "API_WATCH_RETRY_LANE_NOT_AUTHORIZED",
      );
      expect((await fence()).claim_stage).toBe("IDLE");
    });

    it.each(["CLAIMED", "ENTERED"] as const)(
      "recovers expired %s without replaying a possibly entered provider request",
      async (stage) => {
        const dbClock = await runtime.query<{ now: Date }>(
          'SELECT clock_timestamp() AS "now"',
        );
        const now = dbClock.rows[0]?.now.getTime();
        if (typeof now !== "number" || !Number.isFinite(now))
          throw new Error("C03_R40_PG_CLOCK_MISSING");
        await runtime.query(
          `UPDATE "${schema}".monitoring_lane_schedules
         SET active_run_lease_expires_at=$1`,
          [new Date(now - 10 * 60_000)],
        );
        await runtime.query(
          `UPDATE "${schema}".api_watch_family_attempt_fences
           SET claim_stage=$1,claimed_run_id=$2,
               claimed_at=$3,claimed_lease_expires_at=$4,
               entered_at=$5,updated_at=$6`,
          [
            stage,
            runA,
            new Date(now - 20 * 60_000),
            new Date(now - 10 * 60_000),
            stage === "ENTERED" ? new Date(now - 19 * 60_000) : null,
            new Date(now - 8 * 60_000),
          ],
        );
        const due = await retryDeadline();
        const recovered = await repository.expire("OZON_SELLER", runA);
        expect(recovered.claimStage).toBe("IDLE");
        expect(recovered.outcomeUnknown).toBe(stage === "ENTERED");
        expect((await fence()).outcome_unknown).toBe(stage === "ENTERED");
        expect(await retryDeadline()).toEqual(due);
        await runtime.query(
          `UPDATE "${schema}".monitoring_lane_schedules
         SET active_run_id=$1,active_run_lease_expires_at=now()+interval '15 minutes'`,
          [runB],
        );
        if (stage === "ENTERED")
          await expect(
            repository.claimDue("OZON_SELLER", runB),
          ).rejects.toThrow("API_WATCH_RETRY_OUTCOME_UNKNOWN_NO_RETRY");
        else
          expect(
            (await repository.claimDue("OZON_SELLER", runB))?.claimStage,
          ).toBe("CLAIMED");
      },
    );
  },
);
