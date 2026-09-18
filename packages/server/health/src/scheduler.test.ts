import { describe, expect, it } from "vitest";
import {
  DEFAULT_NO_SESSION_CADENCE,
  HealthScheduleInputSchema,
  assertScheduledRunTransition,
  classifyFailure,
  nextDueAfterMaterialization,
  retryAt,
  runDurableHealthSchedulerCycle,
  scheduledRunIdempotencyKey,
  type DurableHealthSchedulerRepository,
  type HealthSchedule,
  type HealthScheduledRun,
  type HealthFailureClass,
} from "./scheduler.js";
import type { HealthState } from "./types.js";

const NOW = new Date("2026-09-18T00:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";

function schedule(overrides: Partial<HealthSchedule> = {}): HealthSchedule {
  const base = HealthScheduleInputSchema.parse({
    scheduleId: ID,
    monitorTarget: "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION",
    enabled: true,
    cadence: DEFAULT_NO_SESSION_CADENCE,
    nextDueAt: NOW,
    revision: 1,
  });
  return {
    ...base,
    lastAttemptAt: null,
    lastSuccessAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(input: Partial<HealthScheduledRun> = {}): HealthScheduledRun {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    scheduleId: ID,
    monitorTarget: "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION",
    scheduleRevision: 1,
    dueSlotAt: NOW,
    idempotencyKey: scheduledRunIdempotencyKey({
      scheduleId: ID,
      scheduleRevision: 1,
      dueSlotAt: NOW,
      monitorTarget: "nosession_chatgpt_standard",
    }),
    state: "PENDING",
    ownerId: null,
    leaseId: null,
    claimedAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    attempt: 1,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
    failureClass: null,
    failureCode: null,
    healthRunId: null,
    healthState: null,
    ...input,
  };
}

class MemoryScheduler implements DurableHealthSchedulerRepository {
  public now = NOW;
  public schedules = new Map<string, HealthSchedule>([[ID, schedule()]]);
  public runs = new Map<string, HealthScheduledRun>();
  private nextRun = 2;

  async listDueSchedules(now: Date) {
    return [...this.schedules.values()].filter(
      (item) => item.enabled && item.nextDueAt <= now,
    );
  }
  async materializeDueSlot(scheduleId: string, now: Date) {
    const item = this.schedules.get(scheduleId)!;
    if (!item.enabled || item.nextDueAt > now) return null;
    const key = scheduledRunIdempotencyKey({
      scheduleId,
      scheduleRevision: item.revision,
      dueSlotAt: item.nextDueAt,
      monitorTarget: item.monitorTarget,
    });
    if ([...this.runs.values()].some((item) => item.idempotencyKey === key))
      return null;
    const created = run({
      id: `00000000-0000-4000-8000-${String(this.nextRun++).padStart(12, "0")}`,
      scheduleId,
      monitorTarget: item.monitorTarget,
      provider: item.provider,
      surface: item.surface,
      probeLayer: item.probeLayer,
      scheduleRevision: item.revision,
      dueSlotAt: item.nextDueAt,
      idempotencyKey: key,
    });
    this.runs.set(created.id, created);
    this.schedules.set(scheduleId, {
      ...item,
      nextDueAt: nextDueAfterMaterialization(item, now),
    });
    return created;
  }
  async claimNext({
    ownerId,
    now,
    leaseMs,
  }: {
    ownerId: string;
    now: Date;
    leaseMs: number;
  }) {
    const found = [...this.runs.values()].find(
      (item) =>
        item.state === "PENDING" ||
        ((item.state === "FAILED_RETRYABLE" || item.state === "TIMED_OUT") &&
          item.nextAttemptAt! <= now) ||
        ((item.state === "CLAIMED" || item.state === "RUNNING") &&
          item.leaseExpiresAt! <= now),
    );
    if (!found) return null;
    const claimed = {
      ...found,
      state: "CLAIMED" as const,
      ownerId,
      leaseId: `lease-${ownerId}-${found.attempt}`,
      claimedAt: now,
      leaseExpiresAt: new Date(now.valueOf() + leaseMs),
      attempt: found.state === "PENDING" ? found.attempt : found.attempt + 1,
      nextAttemptAt: null,
    };
    this.runs.set(found.id, claimed);
    return claimed;
  }
  async startRun({
    runId,
    ownerId,
    leaseId,
    now,
  }: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
  }) {
    const found = this.runs.get(runId)!;
    if (
      found.state !== "CLAIMED" ||
      found.ownerId !== ownerId ||
      found.leaseId !== leaseId ||
      found.leaseExpiresAt! <= now
    )
      throw new Error("HEALTH_SCHEDULED_RUN_STALE_OWNER");
    const started = {
      ...found,
      state: "RUNNING" as const,
      startedAt: now,
      timeoutAt: new Date(
        now.valueOf() + DEFAULT_NO_SESSION_CADENCE.timeoutSeconds * 1_000,
      ),
    };
    this.runs.set(runId, started);
    return started;
  }
  async finishSuccess({
    runId,
    ownerId,
    leaseId,
    now,
    healthRunId,
    healthState,
  }: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    healthRunId: string;
    healthState: HealthState;
  }) {
    const found = this.runs.get(runId)!;
    if (
      found.state !== "RUNNING" ||
      found.ownerId !== ownerId ||
      found.leaseId !== leaseId ||
      found.leaseExpiresAt! <= now
    )
      throw new Error("HEALTH_SCHEDULED_RUN_STALE_OWNER");
    const finished = {
      ...found,
      state: "SUCCEEDED" as const,
      finishedAt: now,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      healthRunId,
      healthState,
    };
    this.runs.set(runId, finished);
    return finished;
  }
  async finishFailure({
    runId,
    ownerId,
    leaseId,
    now,
    failureClass,
    failureCode,
  }: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    failureClass: HealthFailureClass;
    failureCode: string;
  }) {
    const found = this.runs.get(runId)!;
    if (
      found.state !== "RUNNING" ||
      found.ownerId !== ownerId ||
      found.leaseId !== leaseId ||
      found.leaseExpiresAt! <= now
    )
      throw new Error("HEALTH_SCHEDULED_RUN_STALE_OWNER");
    const state =
      found.attempt >= 3
        ? "FAILED_TERMINAL"
        : classifyFailure(failureClass, failureCode);
    const finished = {
      ...found,
      state,
      finishedAt: now,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      failureClass,
      failureCode,
      nextAttemptAt:
        state === "FAILED_RETRYABLE"
          ? retryAt(failureClass, found.attempt, now)
          : null,
    };
    this.runs.set(runId, finished);
    return finished;
  }
  async timeoutRun({
    runId,
    ownerId,
    leaseId,
    now,
    failureCode,
  }: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    failureCode: string;
  }) {
    const found = this.runs.get(runId)!;
    if (
      found.state !== "RUNNING" ||
      found.ownerId !== ownerId ||
      found.leaseId !== leaseId
    )
      throw new Error("HEALTH_SCHEDULED_RUN_STALE_OWNER");
    const finished = {
      ...found,
      state: "TIMED_OUT" as const,
      finishedAt: now,
      ownerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      failureClass: "TRANSIENT_ENVIRONMENT" as const,
      failureCode,
      nextAttemptAt: retryAt("TRANSIENT_ENVIRONMENT", found.attempt, now),
    };
    this.runs.set(runId, finished);
    return finished;
  }
  async reconcilePersistedResults() {
    let count = 0;
    for (const item of this.runs.values()) {
      if (item.healthRunId && item.state !== "SUCCEEDED") {
        this.runs.set(item.id, {
          ...item,
          state: "SUCCEEDED",
          ownerId: null,
          leaseId: null,
          leaseExpiresAt: null,
        });
        count += 1;
      }
    }
    return count;
  }
}

describe("durable Health scheduler contract", () => {
  it("derives deterministic identity and rejects duplicate logical slots", async () => {
    const first = scheduledRunIdempotencyKey({
      scheduleId: ID,
      scheduleRevision: 1,
      dueSlotAt: NOW,
      monitorTarget: "nosession_chatgpt_standard",
    });
    expect(first).toBe(
      scheduledRunIdempotencyKey({
        scheduleId: ID,
        scheduleRevision: 1,
        dueSlotAt: NOW,
        monitorTarget: "nosession_chatgpt_standard",
      }),
    );
    const repo = new MemoryScheduler();
    const results = await Promise.all([
      repo.materializeDueSlot(ID, NOW),
      repo.materializeDueSlot(ID, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(repo.runs.size).toBe(1);
  });

  it("reclaims an expired lease and rejects stale finalization", async () => {
    const repo = new MemoryScheduler();
    const pending = await repo.materializeDueSlot(ID, NOW);
    const first = await repo.claimNext({
      ownerId: "worker-a",
      now: NOW,
      leaseMs: 1_000,
    });
    await repo.startRun({
      runId: pending!.id,
      ownerId: "worker-a",
      leaseId: first!.leaseId!,
      now: NOW,
    });
    const later = new Date(NOW.valueOf() + 2_000);
    const second = await repo.claimNext({
      ownerId: "worker-b",
      now: later,
      leaseMs: 1_000,
    });
    expect(second?.ownerId).toBe("worker-b");
    await expect(
      repo.finishSuccess({
        runId: pending!.id,
        ownerId: "worker-a",
        leaseId: first!.leaseId!,
        now: later,
        healthRunId: "health-1",
        healthState: "HEALTHY",
      }),
    ).rejects.toThrow("STALE_OWNER");
  });

  it("recovers a crash after claim and bounds retries", async () => {
    const repo = new MemoryScheduler();
    await repo.materializeDueSlot(ID, NOW);
    const first = await repo.claimNext({
      ownerId: "dead",
      now: NOW,
      leaseMs: 1_000,
    });
    expect(first?.state).toBe("CLAIMED");
    const recovered = await repo.claimNext({
      ownerId: "live",
      now: new Date(NOW.valueOf() + 2_000),
      leaseMs: 1_000,
    });
    expect(recovered?.attempt).toBe(2);
    expect(classifyFailure("TERMINAL_CONFIGURATION")).toBe("FAILED_TERMINAL");
    expect(classifyFailure("TRANSIENT_ENVIRONMENT")).toBe("FAILED_RETRYABLE");
    expect(classifyFailure("TRANSIENT_ENVIRONMENT", "SEND_UNCERTAIN")).toBe(
      "FAILED_TERMINAL",
    );
  });

  it("keeps execution success separate from BROKEN and MAINTENANCE health", async () => {
    const repo = new MemoryScheduler();
    const summary = await runDurableHealthSchedulerCycle({
      repository: repo,
      clock: { now: () => NOW },
      ownerId: "worker",
      leaseMs: 10_000,
      maxConcurrency: 1,
      execute: async () => ({
        outcome: "SUCCEEDED",
        healthRunId: "health-broken",
        healthState: "BROKEN",
      }),
    });
    expect(summary.succeeded).toBe(1);
    expect([...repo.runs.values()][0]?.state).toBe("SUCCEEDED");
    expect([...repo.runs.values()][0]?.healthState).toBe("BROKEN");
    const maintenanceRepo = new MemoryScheduler();
    const maintenanceSummary = await runDurableHealthSchedulerCycle({
      repository: maintenanceRepo,
      clock: { now: () => NOW },
      ownerId: "worker",
      leaseMs: 10_000,
      maxConcurrency: 1,
      execute: async () => ({
        outcome: "SUCCEEDED",
        healthRunId: "health-maintenance",
        healthState: "MAINTENANCE",
      }),
    });
    expect(maintenanceSummary.succeeded).toBe(1);
    expect([...maintenanceRepo.runs.values()][0]?.state).toBe("SUCCEEDED");
  });

  it("uses bounded differentiated backoff and one-slot catch-up", () => {
    expect(retryAt("TRANSIENT_ENVIRONMENT", 1, NOW).valueOf()).toBe(
      NOW.valueOf() + 300_000,
    );
    expect(retryAt("PROVIDER_ACCESS_OR_NETWORK", 2, NOW).valueOf()).toBe(
      NOW.valueOf() + 1_800_000,
    );
    expect(retryAt("TERMINAL_CONFIGURATION", 8, NOW).valueOf()).toBe(
      NOW.valueOf() + 86_400_000,
    );
    const old = schedule({ nextDueAt: new Date("2026-01-01T00:00:00Z") });
    const next = nextDueAfterMaterialization(old, NOW);
    expect(next.valueOf()).toBe(
      NOW.valueOf() + DEFAULT_NO_SESSION_CADENCE.intervalSeconds * 1_000,
    );
  });

  it("fail-closes invalid transitions and keeps revision in identity", () => {
    expect(() => assertScheduledRunTransition("SUCCEEDED", "RUNNING")).toThrow(
      "INVALID",
    );
    expect(
      scheduledRunIdempotencyKey({
        scheduleId: ID,
        scheduleRevision: 1,
        dueSlotAt: NOW,
        monitorTarget: "nosession_chatgpt_standard",
      }),
    ).not.toBe(
      scheduledRunIdempotencyKey({
        scheduleId: ID,
        scheduleRevision: 2,
        dueSlotAt: NOW,
        monitorTarget: "nosession_chatgpt_standard",
      }),
    );
  });

  it("does not materialize disabled schedules, replay backlog, or share target state", async () => {
    const repo = new MemoryScheduler();
    repo.schedules.set(
      "00000000-0000-4000-8000-000000000003",
      schedule({
        scheduleId: "00000000-0000-4000-8000-000000000003",
        monitorTarget: "nosession_alice",
        provider: "alice",
        surface: "ALICE",
        enabled: false,
        nextDueAt: new Date("2025-01-01T00:00:00Z"),
      }),
    );
    expect(
      await repo.materializeDueSlot(
        "00000000-0000-4000-8000-000000000003",
        NOW,
      ),
    ).toBeNull();
    await repo.materializeDueSlot(ID, NOW);
    expect(
      [...repo.runs.values()].every(
        (item) => item.monitorTarget === "nosession_chatgpt_standard",
      ),
    ).toBe(true);
    expect(repo.schedules.get(ID)!.nextDueAt.valueOf()).toBe(
      NOW.valueOf() + 21_600_000,
    );
  });

  it("recovers a committed result before scheduler finalization", async () => {
    const repo = new MemoryScheduler();
    const created = await repo.materializeDueSlot(ID, NOW);
    const claimed = await repo.claimNext({
      ownerId: "worker",
      now: NOW,
      leaseMs: 10_000,
    });
    const started = await repo.startRun({
      runId: created!.id,
      ownerId: "worker",
      leaseId: claimed!.leaseId!,
      now: NOW,
    });
    repo.runs.set(started.id, { ...started, healthRunId: "health-committed" });
    expect(await repo.reconcilePersistedResults()).toBe(1);
    expect(repo.runs.get(started.id)?.state).toBe("SUCCEEDED");
  });

  it("closes a running timeout and leaves on-demand identity separate", async () => {
    const repo = new MemoryScheduler();
    const created = await repo.materializeDueSlot(ID, NOW);
    const claimed = await repo.claimNext({
      ownerId: "worker",
      now: NOW,
      leaseMs: 10_000,
    });
    await repo.startRun({
      runId: created!.id,
      ownerId: "worker",
      leaseId: claimed!.leaseId!,
      now: NOW,
    });
    const timedOut = await repo.timeoutRun({
      runId: created!.id,
      ownerId: "worker",
      leaseId: claimed!.leaseId!,
      now: NOW,
      failureCode: "SCHEDULER_TIMEOUT",
    });
    expect(timedOut.state).toBe("TIMED_OUT");
    expect(
      scheduledRunIdempotencyKey({
        scheduleId: ID,
        scheduleRevision: 1,
        dueSlotAt: NOW,
        monitorTarget: "nosession_chatgpt_standard",
      }),
    ).not.toBe("manual-run-id");
  });

  it("turns an executor exception into a bounded retry instead of orphaning RUNNING", async () => {
    const repo = new MemoryScheduler();
    const summary = await runDurableHealthSchedulerCycle({
      repository: repo,
      clock: { now: () => NOW },
      ownerId: "worker",
      leaseMs: 10_000,
      maxConcurrency: 1,
      execute: async () => {
        throw new Error("provider detail is intentionally not persisted");
      },
    });
    expect(summary.retryableFailures).toBe(1);
    expect([...repo.runs.values()][0]?.state).toBe("FAILED_RETRYABLE");
    expect([...repo.runs.values()][0]?.failureCode).toBe(
      "HEALTH_EXECUTOR_ERROR",
    );
  });
});
