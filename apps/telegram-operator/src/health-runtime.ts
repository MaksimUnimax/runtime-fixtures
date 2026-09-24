import { randomUUID } from "node:crypto";
import {
  runDurableHealthSchedulerCycle,
  type DurableHealthSchedulerRepository,
  type HealthSchedule,
  type HealthScheduledRun,
  type SchedulerClock,
  type SchedulerCycleSummary,
  type ScheduledExecutionResult,
} from "@product/health";
import {
  createHealthNoSessionCompletionAdapter,
  createHealthSchedulerRepository,
  type DatabaseRuntime,
  type NoSessionHealthCompletionResult,
} from "@product/db";
import {
  ensureNoSessionHealthSchedules,
  getNoSessionTarget,
  runNoSessionAutomaticProbe,
  type NoSessionObservationResult,
  type NoSessionTarget,
} from "@product/health-runner";

export const NO_SESSION_CLASSIFIER_VERSION = "no-session-runtime-v1";
export const NO_SESSION_HEALTH_LEASE_MS = 5 * 60_000;
export const NO_SESSION_HEALTH_MAX_CONCURRENCY = 9;
export const NO_SESSION_HEALTH_WAKE_MS = 60_000;

type SchedulerBootstrapRepository = DurableHealthSchedulerRepository & {
  getSchedule(scheduleId: string): Promise<HealthSchedule | undefined>;
  createSchedule(input: unknown): Promise<HealthSchedule>;
  updateSchedule(input: {
    scheduleId: string;
    enabled: boolean;
    cadence: HealthSchedule["cadence"];
    nextDueAt: Date;
  }): Promise<HealthSchedule>;
};

export type NoSessionCompletionPort = {
  completeScheduledNoSessionHealthRun(
    input: unknown,
  ): Promise<NoSessionHealthCompletionResult>;
};

export type NoSessionProbe = (
  target: NoSessionTarget,
  observedAt: string,
) => Promise<NoSessionObservationResult>;

export type DurableNoSessionHealthRuntimeOptions = {
  repository: SchedulerBootstrapRepository;
  completion: NoSessionCompletionPort;
  clock: SchedulerClock;
  ownerId: string;
  scheduleAuthority?: () => Promise<{
    intervalSeconds: number;
    nextDueAt: Date;
  }>;
  probe?: NoSessionProbe;
  classifierVersion?: string;
  leaseMs?: number;
  maxConcurrency?: number;
  wakeMs?: number;
  onWakeFailure?: () => void;
};

function deterministicPersistenceRejection(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^NO_SESSION_(?:PROVIDER|SURFACE|PROFILE|SCHEDULE|PERSISTENCE|TIMESTAMP|URL|FINAL_ORIGIN|DUPLICATE_EVIDENCE)/.test(
      error.message,
    )
  );
}

export async function executeScheduledNoSessionHealthRun(
  run: HealthScheduledRun,
  options: Pick<
    DurableNoSessionHealthRuntimeOptions,
    "completion" | "clock" | "probe" | "classifierVersion"
  >,
): Promise<ScheduledExecutionResult> {
  if (run.probeLayer !== "NO_SESSION") {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "NO_SESSION_PROBE_LAYER_INVALID",
    };
  }
  const target = getNoSessionTarget(run.monitorTarget);
  if (
    !target ||
    target.providerId !== run.provider ||
    target.surfaceId !== run.surface
  ) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "NO_SESSION_TARGET_AUTHORITY_INVALID",
    };
  }
  if (!run.startedAt) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "NO_SESSION_STARTED_AT_MISSING",
    };
  }

  const probe =
    options.probe ??
    ((candidate: NoSessionTarget, observedAt: string) =>
      runNoSessionAutomaticProbe(candidate, undefined, observedAt));
  const observation = await probe(target, options.clock.now().toISOString());

  try {
    const persisted =
      await options.completion.completeScheduledNoSessionHealthRun({
        scheduledRunId: run.id,
        observation,
        classifierVersion:
          options.classifierVersion ?? NO_SESSION_CLASSIFIER_VERSION,
        startedAt: run.startedAt,
        completedAt: options.clock.now(),
      });
    return {
      outcome: "SUCCEEDED",
      healthRunId: persisted.healthRunId,
      healthState: persisted.healthState,
    };
  } catch (error) {
    if (deterministicPersistenceRejection(error)) {
      return {
        outcome: "FAILED",
        failureClass: "TERMINAL_CONFIGURATION",
        failureCode: "NO_SESSION_PERSISTENCE_REJECTED",
      };
    }
    throw error;
  }
}

export function createDurableNoSessionHealthRuntime(
  options: DurableNoSessionHealthRuntimeOptions,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<SchedulerCycleSummary> | undefined;

  const executeCycle = async (): Promise<SchedulerCycleSummary> => {
    const now = options.clock.now();
    const authority = options.scheduleAuthority
      ? await options.scheduleAuthority()
      : undefined;
    await ensureNoSessionHealthSchedules(
      options.repository,
      authority?.nextDueAt ?? now,
      authority?.intervalSeconds,
    );
    return runDurableHealthSchedulerCycle({
      repository: options.repository,
      clock: options.clock,
      ownerId: options.ownerId,
      leaseMs: options.leaseMs ?? NO_SESSION_HEALTH_LEASE_MS,
      maxConcurrency:
        options.maxConcurrency ?? NO_SESSION_HEALTH_MAX_CONCURRENCY,
      execute: (run) => executeScheduledNoSessionHealthRun(run, options),
    });
  };

  const runScheduledCycle = (): Promise<SchedulerCycleSummary> => {
    if (active) return active;
    const work = executeCycle();
    active = work.finally(() => {
      active = undefined;
    });
    return active;
  };

  return {
    runScheduledCycle,

    async start(): Promise<void> {
      if (timer) return;
      await runScheduledCycle();
      timer = setInterval(() => {
        void runScheduledCycle().catch(() => options.onWakeFailure?.());
      }, options.wakeMs ?? NO_SESSION_HEALTH_WAKE_MS);
      timer.unref?.();
    },

    async stop(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (active) await active.catch(() => undefined);
    },
  };
}

export function createPostgresDurableNoSessionHealthRuntime(
  database: DatabaseRuntime,
  options: {
    clock?: SchedulerClock;
    ownerId?: string;
    scheduleAuthority?: () => Promise<{
      intervalSeconds: number;
      nextDueAt: Date;
    }>;
    probe?: NoSessionProbe;
    classifierVersion?: string;
    wakeMs?: number;
    onWakeFailure?: () => void;
  } = {},
) {
  return createDurableNoSessionHealthRuntime({
    repository: createHealthSchedulerRepository(database),
    completion: createHealthNoSessionCompletionAdapter(database),
    clock: options.clock ?? { now: () => new Date() },
    ownerId:
      options.ownerId ?? `telegram-health:${process.pid}:${randomUUID()}`,
    scheduleAuthority: options.scheduleAuthority,
    probe: options.probe,
    classifierVersion: options.classifierVersion,
    wakeMs: options.wakeMs,
    onWakeFailure: options.onWakeFailure,
  });
}
