import { createHash } from "node:crypto";
import { z } from "zod";
import type { HealthState } from "./types.js";

export const HealthProbeLayerSchema = z.enum([
  "NO_SESSION",
  "AUTHENTICATED_DEEP",
]);
export type HealthProbeLayer = z.infer<typeof HealthProbeLayerSchema>;

export const HealthScheduledRunStateSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "TIMED_OUT",
  "CANCELLED",
]);
export type HealthScheduledRunState = z.infer<
  typeof HealthScheduledRunStateSchema
>;

export const HealthFailureClassSchema = z.enum([
  "TRANSIENT_ENVIRONMENT",
  "PROVIDER_ACCESS_OR_NETWORK",
  "BROWSER_UNAVAILABLE",
  "TERMINAL_CONFIGURATION",
  "PROVEN_PRODUCT_DRIFT",
  "MAINTENANCE",
]);
export type HealthFailureClass = z.infer<typeof HealthFailureClassSchema>;

export const HealthScheduleCadenceSchema = z
  .object({
    intervalSeconds: z.number().int().min(3_600).max(604_800),
    timeoutSeconds: z.number().int().min(30).max(3_600),
    maxAttempts: z.number().int().min(1).max(8),
    retryPolicyVersion: z.literal("health-retry-v1"),
  })
  .strict();
export type HealthScheduleCadence = z.infer<typeof HealthScheduleCadenceSchema>;

export const HealthScheduleInputSchema = z
  .object({
    scheduleId: z.uuid(),
    monitorTarget: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    surface: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    probeLayer: HealthProbeLayerSchema,
    enabled: z.boolean(),
    cadence: HealthScheduleCadenceSchema,
    nextDueAt: z.date(),
    revision: z.number().int().positive(),
  })
  .strict();
export type HealthScheduleInput = z.infer<typeof HealthScheduleInputSchema>;

export type HealthSchedule = HealthScheduleInput & {
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type HealthScheduledRun = {
  readonly id: string;
  readonly scheduleId: string;
  readonly monitorTarget: string;
  readonly provider: string;
  readonly surface: string;
  readonly probeLayer: HealthProbeLayer;
  readonly scheduleRevision: number;
  readonly dueSlotAt: Date;
  readonly idempotencyKey: string;
  readonly state: HealthScheduledRunState;
  readonly ownerId: string | null;
  readonly leaseId: string | null;
  readonly claimedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly timeoutAt: Date | null;
  readonly attempt: number;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly failureClass: HealthFailureClass | null;
  readonly failureCode: string | null;
  readonly healthRunId: string | null;
  readonly healthState: HealthState | null;
};

export type SchedulerClock = { now(): Date };

export const DEFAULT_NO_SESSION_CADENCE: HealthScheduleCadence = Object.freeze({
  intervalSeconds: 21_600,
  timeoutSeconds: 180,
  maxAttempts: 3,
  retryPolicyVersion: "health-retry-v1",
});

const FAILURE_BACKOFF_SECONDS: Record<HealthFailureClass, number> = {
  TRANSIENT_ENVIRONMENT: 300,
  PROVIDER_ACCESS_OR_NETWORK: 900,
  BROWSER_UNAVAILABLE: 600,
  TERMINAL_CONFIGURATION: 86_400,
  PROVEN_PRODUCT_DRIFT: 21_600,
  MAINTENANCE: 3_600,
};

export function scheduledRunIdempotencyKey(input: {
  scheduleId: string;
  scheduleRevision: number;
  dueSlotAt: Date;
  monitorTarget: string;
}): string {
  const source = [
    input.scheduleId,
    String(input.scheduleRevision),
    input.dueSlotAt.toISOString(),
    input.monitorTarget,
  ].join("|");
  return createHash("sha256").update(source).digest("hex");
}

export function nextDueAfterMaterialization(
  schedule: Pick<HealthSchedule, "nextDueAt" | "cadence">,
  now: Date,
): Date {
  const nominal = new Date(
    schedule.nextDueAt.valueOf() + schedule.cadence.intervalSeconds * 1_000,
  );
  // One wake creates one slot only. Downtime never expands into an unbounded
  // backlog; the following wake starts a fresh current interval.
  return nominal > now
    ? nominal
    : new Date(now.valueOf() + schedule.cadence.intervalSeconds * 1_000);
}

export function retryAt(
  failureClass: HealthFailureClass,
  attempt: number,
  now: Date,
  jitterSeconds = 0,
): Date {
  const base = FAILURE_BACKOFF_SECONDS[failureClass];
  const multiplier = Math.min(2 ** Math.max(0, attempt - 1), 16);
  const seconds = Math.min(
    base * multiplier + Math.max(0, jitterSeconds),
    86_400,
  );
  return new Date(now.valueOf() + seconds * 1_000);
}

const transitions: Record<
  HealthScheduledRunState,
  readonly HealthScheduledRunState[]
> = {
  PENDING: ["CLAIMED", "CANCELLED"],
  CLAIMED: [
    "RUNNING",
    "CLAIMED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL",
    "TIMED_OUT",
    "CANCELLED",
  ],
  RUNNING: [
    "SUCCEEDED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL",
    "TIMED_OUT",
    "CLAIMED",
    "CANCELLED",
  ],
  SUCCEEDED: [],
  FAILED_RETRYABLE: ["CLAIMED", "CANCELLED"],
  FAILED_TERMINAL: [],
  TIMED_OUT: ["CLAIMED"],
  CANCELLED: [],
};

export function assertScheduledRunTransition(
  from: HealthScheduledRunState,
  to: HealthScheduledRunState,
): void {
  if (!transitions[from].includes(to)) {
    throw new Error(`INVALID_HEALTH_SCHEDULED_RUN_TRANSITION:${from}->${to}`);
  }
}

export function classifyFailure(
  failureClass: HealthFailureClass,
  failureCode?: string,
): "FAILED_RETRYABLE" | "FAILED_TERMINAL" {
  return failureCode === "SEND_UNCERTAIN" ||
    failureClass === "TERMINAL_CONFIGURATION" ||
    failureClass === "PROVEN_PRODUCT_DRIFT"
    ? "FAILED_TERMINAL"
    : "FAILED_RETRYABLE";
}

export type ScheduledExecutionResult =
  | {
      outcome: "SUCCEEDED";
      healthRunId: string;
      healthState: HealthState;
    }
  | {
      outcome: "FAILED";
      failureClass: HealthFailureClass;
      failureCode: string;
    };

export interface DurableHealthSchedulerRepository {
  listDueSchedules(now: Date): Promise<readonly HealthSchedule[]>;
  materializeDueSlot(
    scheduleId: string,
    now: Date,
  ): Promise<HealthScheduledRun | null>;
  claimNext(input: {
    ownerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<HealthScheduledRun | null>;
  startRun(input: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
  }): Promise<HealthScheduledRun>;
  finishSuccess(input: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    healthRunId: string;
    healthState: HealthState;
  }): Promise<HealthScheduledRun>;
  finishFailure(input: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    failureClass: HealthFailureClass;
    failureCode: string;
  }): Promise<HealthScheduledRun>;
  timeoutRun(input: {
    runId: string;
    ownerId: string;
    leaseId: string;
    now: Date;
    failureCode: string;
  }): Promise<HealthScheduledRun>;
  reconcilePersistedResults(now: Date): Promise<number>;
}

export type DurableHealthSchedulerOptions = {
  repository: DurableHealthSchedulerRepository;
  clock: SchedulerClock;
  ownerId: string;
  leaseMs: number;
  maxConcurrency: number;
  execute: (run: HealthScheduledRun) => Promise<ScheduledExecutionResult>;
};

export type SchedulerCycleSummary = {
  materialized: number;
  claimed: number;
  succeeded: number;
  retryableFailures: number;
  terminalFailures: number;
  timedOut: number;
  reconciled: number;
};

export async function runDurableHealthSchedulerCycle(
  options: DurableHealthSchedulerOptions,
): Promise<SchedulerCycleSummary> {
  const now = options.clock.now();
  const due = await options.repository.listDueSchedules(now);
  let materialized = 0;
  for (const schedule of due) {
    if (await options.repository.materializeDueSlot(schedule.scheduleId, now)) {
      materialized += 1;
    }
  }
  let claimed = 0;
  let succeeded = 0;
  let retryableFailures = 0;
  let terminalFailures = 0;
  let timedOut = 0;
  for (let index = 0; index < options.maxConcurrency; index += 1) {
    const claim = await options.repository.claimNext({
      ownerId: options.ownerId,
      now,
      leaseMs: options.leaseMs,
    });
    if (!claim || !claim.leaseId) break;
    claimed += 1;
    const started = await options.repository.startRun({
      runId: claim.id,
      ownerId: options.ownerId,
      leaseId: claim.leaseId,
      now,
    });
    const timeoutAt = started.timeoutAt;
    if (timeoutAt && timeoutAt <= now) {
      await options.repository.timeoutRun({
        runId: started.id,
        ownerId: options.ownerId,
        leaseId: claim.leaseId,
        now,
        failureCode: "SCHEDULER_TIMEOUT",
      });
      timedOut += 1;
      continue;
    }
    let result: ScheduledExecutionResult | null;
    try {
      result = timeoutAt
        ? await Promise.race([
            options.execute(started),
            new Promise<never>((_, reject) => {
              const delay = Math.max(
                0,
                timeoutAt.valueOf() - options.clock.now().valueOf(),
              );
              setTimeout(
                () => reject(new Error("HEALTH_SCHEDULED_RUN_TIMEOUT")),
                delay,
              ).unref?.();
            }),
          ]).catch((error: unknown) => {
            if (
              error instanceof Error &&
              error.message === "HEALTH_SCHEDULED_RUN_TIMEOUT"
            ) {
              return null;
            }
            throw error;
          })
        : await options.execute(started);
    } catch {
      const failed = await options.repository.finishFailure({
        runId: started.id,
        ownerId: options.ownerId,
        leaseId: claim.leaseId,
        now: options.clock.now(),
        failureClass: "TRANSIENT_ENVIRONMENT",
        failureCode: "HEALTH_EXECUTOR_ERROR",
      });
      if (failed.state === "FAILED_TERMINAL") terminalFailures += 1;
      else retryableFailures += 1;
      continue;
    }
    if (!result) {
      await options.repository.timeoutRun({
        runId: started.id,
        ownerId: options.ownerId,
        leaseId: claim.leaseId,
        now: options.clock.now(),
        failureCode: "SCHEDULER_TIMEOUT",
      });
      timedOut += 1;
      continue;
    }
    if (result.outcome === "SUCCEEDED") {
      await options.repository.finishSuccess({
        runId: started.id,
        ownerId: options.ownerId,
        leaseId: claim.leaseId,
        now: options.clock.now(),
        healthRunId: result.healthRunId,
        healthState: result.healthState,
      });
      succeeded += 1;
    } else {
      const finished = await options.repository.finishFailure({
        runId: started.id,
        ownerId: options.ownerId,
        leaseId: claim.leaseId,
        now: options.clock.now(),
        failureClass: result.failureClass,
        failureCode: result.failureCode,
      });
      if (finished.state === "FAILED_TERMINAL") terminalFailures += 1;
      else retryableFailures += 1;
    }
  }
  const reconciled = await options.repository.reconcilePersistedResults(
    options.clock.now(),
  );
  return {
    materialized,
    claimed,
    succeeded,
    retryableFailures,
    terminalFailures,
    timedOut,
    reconciled,
  };
}
