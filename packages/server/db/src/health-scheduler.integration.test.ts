import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  scheduledRunIdempotencyKey,
} from "@product/health";
import {
  createDatabaseRuntime,
  createHealthSchedulerRepository,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const IDS = {
  schedule: "d6000000-0000-4000-8000-000000000001",
};
const now = new Date("2026-09-18T00:00:00.000Z");
const runtime = createDatabaseRuntime(connectionString);
const repository = createHealthSchedulerRepository(runtime);

function input(nextDueAt = now) {
  return {
    scheduleId: IDS.schedule,
    monitorTarget: "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION" as const,
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt,
    revision: 1,
  };
}

describe.sequential(
  "S2-L6 durable Health scheduler PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
    });

    afterAll(async () => runtime.close());

    it("materializes a due slot once under concurrent scheduler races", async () => {
      await repository.createSchedule(input());
      const [first, second] = await Promise.all([
        repository.materializeDueSlot(IDS.schedule, now),
        repository.materializeDueSlot(IDS.schedule, now),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      const rows = await runtime.query<{ count: string; key: string }>(
        `SELECT count(*)::text AS count,min(idempotency_key) AS key FROM health_scheduled_runs WHERE schedule_id=$1`,
        [IDS.schedule],
      );
      expect(rows.rows[0]?.count).toBe("1");
      expect(rows.rows[0]?.key).toBe(
        scheduledRunIdempotencyKey({
          scheduleId: IDS.schedule,
          scheduleRevision: 1,
          dueSlotAt: now,
          monitorTarget: "nosession_chatgpt_standard",
        }),
      );
    });

    it("claims with a lease, rejects stale ownership, and reclaims after expiry", async () => {
      const claim = await repository.claimNext({
        ownerId: "scheduler-a",
        now,
        leaseMs: 1_000,
      });
      expect(claim?.state).toBe("CLAIMED");
      const started = await repository.startRun({
        runId: claim!.id,
        ownerId: "scheduler-a",
        leaseId: claim!.leaseId!,
        now,
      });
      expect(started.state).toBe("RUNNING");
      const later = new Date(now.valueOf() + 2_000);
      const recovered = await repository.claimNext({
        ownerId: "scheduler-b",
        now: later,
        leaseMs: 1_000,
      });
      expect(recovered?.ownerId).toBe("scheduler-b");
      await expect(
        repository.finishSuccess({
          runId: claim!.id,
          ownerId: "scheduler-a",
          leaseId: claim!.leaseId!,
          now: later,
          healthRunId: "d6000000-0000-4000-8000-000000000010",
          healthState: "HEALTHY",
        }),
      ).rejects.toThrow("STALE_OWNER");
    });

    it("increments schedule revision without replaying the old due slot", async () => {
      const updated = await repository.updateSchedule({
        scheduleId: IDS.schedule,
        enabled: false,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: new Date("2026-09-19T00:00:00.000Z"),
      });
      expect(updated.revision).toBe(2);
      expect(
        await repository.materializeDueSlot(IDS.schedule, laterDate()),
      ).toBeNull();
      const rows = await runtime.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM health_scheduled_runs WHERE schedule_id=$1`,
        [IDS.schedule],
      );
      expect(rows.rows[0]?.count).toBe("1");
    });
  },
);

function laterDate(): Date {
  return new Date("2026-09-20T00:00:00.000Z");
}
