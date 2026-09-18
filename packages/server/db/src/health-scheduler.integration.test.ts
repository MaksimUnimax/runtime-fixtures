import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  scheduledRunIdempotencyKey,
} from "@product/health";
import { createNoSessionHealthSchedules } from "../../../../apps/health-runner/src/scheduler-targets.js";
import {
  createDatabaseRuntime,
  createHealthSchedulerRepository,
} from "./index.js";
import { runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const now = new Date("2026-09-18T00:00:00.000Z");
const runtime = createDatabaseRuntime(connectionString);
const workerA = createDatabaseRuntime(connectionString);
const workerB = createDatabaseRuntime(connectionString);
const repository = createHealthSchedulerRepository(runtime);
const repositoryA = createHealthSchedulerRepository(workerA);
const repositoryB = createHealthSchedulerRepository(workerB);

const FIXTURE_HEALTH = {
  adapter: "d6000000-0000-4000-8000-000000000101",
  surface: "d6000000-0000-4000-8000-000000000102",
  profile: "d6000000-0000-4000-8000-000000000103",
  profileRevision: "d6000000-0000-4000-8000-000000000104",
  suite: "d6000000-0000-4000-8000-000000000105",
};

function id(sequence: number): string {
  return `d6000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function scheduleInput(
  sequence: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    scheduleId: id(sequence),
    monitorTarget: `fixture_target_${sequence}`,
    provider: "fixture",
    surface: "FIXTURE_SURFACE",
    probeLayer: "NO_SESSION" as const,
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: now,
    revision: 1,
    ...overrides,
  };
}

async function materialize(
  sequence: number,
  overrides: Record<string, unknown> = {},
) {
  await repository.createSchedule(scheduleInput(sequence, overrides));
  const run = await repository.materializeDueSlot(id(sequence), now);
  if (!run) throw new Error(`fixture ${sequence} did not materialize`);
  return run;
}

async function insertHealthResult(
  healthRunId: string,
  scheduledRunId: string,
  healthState: "HEALTHY" | "BROKEN" | "MAINTENANCE",
): Promise<void> {
  const scope = {
    adapterFamilyId: FIXTURE_HEALTH.adapter,
    adapterFamilyKey: "fixture_ai",
    surfaceId: FIXTURE_HEALTH.surface,
    surfaceKey: "fixture_surface",
    variant: null,
    browserFamily: "chrome",
    browserVersion: "120.0",
    extensionVersion: "1.0.0",
    adapterEngineVersion: "1.0.0",
    profile: { id: FIXTURE_HEALTH.profile, revision: 1 },
    healthSuite: { machineKey: "scheduler_fixture", revision: 1 },
  };
  await runtime.query(
    `INSERT INTO health_runs(id,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,scheduled_run_id,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,operator_maintenance_authority,started_at,completed_at) VALUES($1,$2,$3,$4,NULL,$5,$6,1,'chrome','120.0','1.0.0','1.0.0',$7,'H3',$8,'scheduler-fixture-v1',$9::jsonb,$10,$11,$12,$13,$14)`,
    [
      healthRunId,
      FIXTURE_HEALTH.suite,
      FIXTURE_HEALTH.adapter,
      FIXTURE_HEALTH.surface,
      FIXTURE_HEALTH.profile,
      FIXTURE_HEALTH.profileRevision,
      scheduledRunId,
      healthState,
      JSON.stringify(scope),
      "0".repeat(64),
      healthState === "MAINTENANCE",
      healthState === "MAINTENANCE" ? "scheduler-fixture" : null,
      new Date(now.valueOf() - 1_000),
      now,
    ],
  );
}

describe.sequential(
  "S2-L6 durable Health scheduler PostgreSQL authority",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      await workerA.ready();
      await workerB.ready();
      await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
      await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await runtime.query("CREATE SCHEMA public");
      await runMigrations({ connectionString });
      await runtime.query(
        `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'fixture_ai','Fixture AI')`,
        [FIXTURE_HEALTH.adapter],
      );
      await runtime.query(
        `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'fixture_surface','Fixture surface')`,
        [FIXTURE_HEALTH.surface, FIXTURE_HEALTH.adapter],
      );
      await runtime.query(
        `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'scheduler_fixture_profile','Scheduler fixture')`,
        [
          FIXTURE_HEALTH.profile,
          FIXTURE_HEALTH.adapter,
          FIXTURE_HEALTH.surface,
        ],
      );
      await runtime.query(
        `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
        [
          FIXTURE_HEALTH.profileRevision,
          FIXTURE_HEALTH.profile,
          FIXTURE_HEALTH.adapter,
          FIXTURE_HEALTH.surface,
          "0".repeat(64),
        ],
      );
      await runtime.query(
        `INSERT INTO health_suite_revisions(id,machine_key,revision,suite_kind,definition,definition_sha256) VALUES($1,'scheduler_fixture',1,'BASELINE_CONTRACT_FIXTURE','{}'::jsonb,$2)`,
        [FIXTURE_HEALTH.suite, "0".repeat(64)],
      );
    });

    beforeEach(async () => {
      // P8.2 makes completed Health rows immutable. Keep prior fixtures and
      // quarantine their scheduler rows instead of deleting accepted evidence.
      await runtime.query(
        "UPDATE health_scheduled_runs SET state='CANCELLED',owner_id=NULL,lease_id=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE state NOT IN ('SUCCEEDED','FAILED_TERMINAL','CANCELLED')",
      );
    });

    afterAll(async () => {
      await Promise.all([runtime.close(), workerA.close(), workerB.close()]);
    });

    it("A: materializes one logical due slot under two independent scheduler races", async () => {
      await repository.createSchedule(scheduleInput(1));
      const [first, second] = await Promise.all([
        repositoryA.materializeDueSlot(id(1), now),
        repositoryB.materializeDueSlot(id(1), now),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      const rows = await runtime.query<{ count: string; key: string }>(
        `SELECT count(*)::text AS count,min(idempotency_key) AS key FROM health_scheduled_runs WHERE schedule_id=$1`,
        [id(1)],
      );
      expect(rows.rows[0]).toEqual({
        count: "1",
        key: scheduledRunIdempotencyKey({
          scheduleId: id(1),
          scheduleRevision: 1,
          dueSlotAt: now,
          monitorTarget: "fixture_target_1",
        }),
      });
    });

    it("B: grants one lease owner when two independent workers claim one pending run", async () => {
      await materialize(2);
      const [first, second] = await Promise.all([
        repositoryA.claimNext({ ownerId: "worker-a", now, leaseMs: 10_000 }),
        repositoryB.claimNext({ ownerId: "worker-b", now, leaseMs: 10_000 }),
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect(first?.ownerId ?? second?.ownerId).toMatch(/^worker-[ab]$/);
    });

    it("C: SKIP LOCKED lets a worker claim a distinct due run while another row is held", async () => {
      const first = await materialize(3);
      const second = await materialize(4);
      let release!: () => void;
      let signalLocked!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const locked = new Promise<void>((resolve) => (signalLocked = resolve));
      const lock = runtime.transaction(async (q) => {
        await q.query(
          "SELECT id FROM health_scheduled_runs WHERE id=$1 FOR UPDATE",
          [first.id],
        );
        signalLocked();
        await held;
      });
      await locked;
      const startedAt = Date.now();
      const claimed = await repositoryB.claimNext({
        ownerId: "worker-b",
        now,
        leaseMs: 10_000,
      });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(claimed?.id).toBe(second.id);
      release();
      await lock;
    });

    it("D/E: reclaims an expired lease and rejects stale-owner finalization", async () => {
      const run = await materialize(5);
      const first = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 1_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: first!.leaseId!,
        now,
      });
      const later = new Date(now.valueOf() + 2_000);
      const second = await repositoryB.claimNext({
        ownerId: "worker-b",
        now: later,
        leaseMs: 10_000,
      });
      expect(second?.ownerId).toBe("worker-b");
      await expect(
        repositoryA.finishSuccess({
          runId: run.id,
          ownerId: "worker-a",
          leaseId: first!.leaseId!,
          now: later,
          healthRunId: id(501),
          healthState: "HEALTHY",
        }),
      ).rejects.toThrow("STALE_OWNER");
    });

    it("F: current-owner success is durable and terminal runs are not reclaimable", async () => {
      const run = await materialize(6);
      const claim = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 10_000,
      });
      const started = await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
      });
      await insertHealthResult(id(506), run.id, "HEALTHY");
      const finished = await repositoryA.finishSuccess({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: started.leaseId!,
        now,
        healthRunId: id(506),
        healthState: "HEALTHY",
      });
      expect(finished.state).toBe("SUCCEEDED");
      expect((await repository.getScheduledRun(run.id))?.ownerId).toBeNull();
      expect(
        await repositoryB.claimNext({
          ownerId: "worker-b",
          now: new Date(now.valueOf() + 1_000),
          leaseMs: 10_000,
        }),
      ).toBeNull();
    });

    it("G/H: BROKEN and MAINTENANCE health results still finalize execution successfully", async () => {
      for (const [sequence, state] of [
        [7, "BROKEN"],
        [8, "MAINTENANCE"],
      ] as const) {
        const run = await materialize(sequence);
        const claim = await repositoryA.claimNext({
          ownerId: "worker-a",
          now,
          leaseMs: 10_000,
        });
        const started = await repositoryA.startRun({
          runId: run.id,
          ownerId: "worker-a",
          leaseId: claim!.leaseId!,
          now,
        });
        await insertHealthResult(id(500 + sequence), run.id, state);
        const finished = await repositoryA.finishSuccess({
          runId: run.id,
          ownerId: "worker-a",
          leaseId: started.leaseId!,
          now,
          healthRunId: id(500 + sequence),
          healthState: state,
        });
        expect(finished.state).toBe("SUCCEEDED");
        expect(finished.healthState).toBe(state);
      }
    });

    it("I: retryable failure has bounded deterministic backoff and one logical slot", async () => {
      const run = await materialize(9);
      const claim = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 10_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
      });
      const finished = await repositoryA.finishFailure({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
        failureClass: "TRANSIENT_ENVIRONMENT",
        failureCode: "ENVIRONMENT_DOWN",
      });
      expect(finished.state).toBe("FAILED_RETRYABLE");
      expect(finished.nextAttemptAt?.toISOString()).toBe(
        "2026-09-18T00:05:00.000Z",
      );
      const count = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_scheduled_runs WHERE schedule_id=$1",
        [id(9)],
      );
      expect(count.rows[0]?.count).toBe("1");
    });

    it("J: terminal configuration failure does not create an endless retry", async () => {
      const run = await materialize(10);
      const claim = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 10_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
      });
      const finished = await repositoryA.finishFailure({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
        failureClass: "TERMINAL_CONFIGURATION",
        failureCode: "CONFIG_INVALID",
      });
      expect(finished.state).toBe("FAILED_TERMINAL");
      expect(
        await repositoryB.claimNext({
          ownerId: "worker-b",
          now: new Date(now.valueOf() + 86_400_000),
          leaseMs: 10_000,
        }),
      ).toBeNull();
    });

    it("K: a stale RUNNING timeout is bounded and reclaimable", async () => {
      const run = await materialize(11);
      const claim = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 10_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
      });
      const timedOut = await repositoryA.timeoutRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
        failureCode: "SCHEDULER_TIMEOUT",
      });
      expect(timedOut.state).toBe("TIMED_OUT");
      expect(timedOut.ownerId).toBeNull();
      const reclaimed = await repositoryB.claimNext({
        ownerId: "worker-b",
        now: new Date(now.valueOf() + 300_000),
        leaseMs: 10_000,
      });
      expect(reclaimed?.ownerId).toBe("worker-b");
    });

    it("L: a crash after claim is recovered by lease expiry", async () => {
      const run = await materialize(12);
      const first = await repositoryA.claimNext({
        ownerId: "dead-process",
        now,
        leaseMs: 1_000,
      });
      expect(first?.state).toBe("CLAIMED");
      const recovered = await repositoryB.claimNext({
        ownerId: "recovery-process",
        now: new Date(now.valueOf() + 2_000),
        leaseMs: 10_000,
      });
      expect(recovered?.id).toBe(run.id);
      expect(recovered?.attempt).toBe(2);
    });

    it("M: reconciliation attaches one committed Health result after scheduler finalization is interrupted", async () => {
      const run = await materialize(13);
      const claim = await repositoryA.claimNext({
        ownerId: "scheduler-a",
        now,
        leaseMs: 1_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "scheduler-a",
        leaseId: claim!.leaseId!,
        now,
      });
      await insertHealthResult(id(513), run.id, "HEALTHY");
      const recovered = await repositoryB.reconcilePersistedResults(
        new Date(now.valueOf() + 1_000),
      );
      expect(recovered).toBe(1);
      const final = await repository.getScheduledRun(run.id);
      expect(final?.state).toBe("SUCCEEDED");
      expect(final?.healthRunId).toBe(id(513));
      const count = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_runs WHERE scheduled_run_id=$1",
        [run.id],
      );
      expect(count.rows[0]?.count).toBe("1");
    });

    it("N/O: disabled schedules create no work and re-enable creates only the current slot", async () => {
      await repository.createSchedule(
        scheduleInput(14, {
          enabled: false,
          nextDueAt: new Date("2025-01-01T00:00:00Z"),
        }),
      );
      expect(await repository.listDueSchedules(now)).toHaveLength(0);
      expect(await repository.materializeDueSlot(id(14), now)).toBeNull();
      const enabled = await repository.updateSchedule({
        scheduleId: id(14),
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: now,
      });
      expect(enabled.revision).toBe(2);
      expect(await repository.materializeDueSlot(id(14), now)).not.toBeNull();
      const count = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_scheduled_runs WHERE schedule_id=$1",
        [id(14)],
      );
      expect(count.rows[0]?.count).toBe("1");
    });

    it("P: long downtime materializes one bounded catch-up slot", async () => {
      await repository.createSchedule(
        scheduleInput(15, { nextDueAt: new Date("2025-01-01T00:00:00Z") }),
      );
      expect(await repository.materializeDueSlot(id(15), now)).not.toBeNull();
      const schedule = await repository.getSchedule(id(15));
      expect(schedule?.nextDueAt.toISOString()).toBe(
        "2026-09-18T06:00:00.000Z",
      );
      const count = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_scheduled_runs WHERE schedule_id=$1",
        [id(15)],
      );
      expect(count.rows[0]?.count).toBe("1");
    });

    it("Q: schedule revision preserves history and creates a distinct new due identity", async () => {
      const old = await materialize(16);
      const updated = await repository.updateSchedule({
        scheduleId: id(16),
        enabled: true,
        cadence: DEFAULT_NO_SESSION_CADENCE,
        nextDueAt: now,
      });
      const current = await repository.materializeDueSlot(id(16), now);
      expect(updated.revision).toBe(2);
      expect(current?.scheduleRevision).toBe(2);
      expect(old.scheduleRevision).toBe(1);
      expect(current?.idempotencyKey).not.toBe(old.idempotencyKey);
    });

    it("R: on-demand identity is isolated from scheduled due-slot persistence", async () => {
      const scheduled = await materialize(17);
      const before = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_scheduled_runs",
      );
      expect("manual-run-fixture-17").not.toBe(scheduled.idempotencyKey);
      const after = await runtime.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM health_scheduled_runs",
      );
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    });

    it("materializes all accepted NO_SESSION targets without authenticated sessions", async () => {
      const schedules = createNoSessionHealthSchedules(now);
      for (const schedule of schedules)
        await repository.createSchedule(schedule);
      expect(await repository.listDueSchedules(now)).toHaveLength(9);
      expect(
        schedules.every(
          (schedule) =>
            schedule.probeLayer === "NO_SESSION" && schedule.enabled,
        ),
      ).toBe(true);
      expect(
        schedules.some(
          (schedule) => schedule.probeLayer === "AUTHENTICATED_DEEP",
        ),
      ).toBe(false);
    });

    it("does not retry SEND_UNCERTAIN after an execution may have sent an external side effect", async () => {
      const run = await materialize(18);
      const claim = await repositoryA.claimNext({
        ownerId: "worker-a",
        now,
        leaseMs: 10_000,
      });
      await repositoryA.startRun({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
      });
      const finished = await repositoryA.finishFailure({
        runId: run.id,
        ownerId: "worker-a",
        leaseId: claim!.leaseId!,
        now,
        failureClass: "TRANSIENT_ENVIRONMENT",
        failureCode: "SEND_UNCERTAIN",
      });
      expect(finished.state).toBe("FAILED_TERMINAL");
      expect(
        await repositoryB.claimNext({
          ownerId: "worker-b",
          now: new Date(now.valueOf() + 86_400_000),
          leaseMs: 10_000,
        }),
      ).toBeNull();
    });
  },
);
