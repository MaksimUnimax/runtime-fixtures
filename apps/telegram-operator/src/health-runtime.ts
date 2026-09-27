import { randomUUID } from "node:crypto";
import {
  runDurableHealthSchedulerCycle,
  type DurableHealthSchedulerRepository,
  type HealthSchedule,
  type HealthScheduledRun,
  type SchedulerClock,
  type SchedulerCycleSummary,
  type ScheduledExecutionResult,
  type HealthState,
} from "@product/health";
import {
  createHealthNoSessionCompletionAdapter,
  createHealthSchedulerRepository,
  type DatabaseRuntime,
  type NoSessionHealthCompletionResult,
} from "@product/db";
import {
  ensureAuthenticatedDeepHealthSchedules,
  ensureNoSessionHealthSchedules,
  getNoSessionTarget,
  runNoSessionAutomaticProbe,
  type NoSessionObservationResult,
  type NoSessionTarget,
  AUTHENTICATED_DEEP_TARGETS,
  createH3HealthEvidencePackage,
  materializeH3HealthPersistenceCommand,
  type H3ExecutionResult,
  type H3HealthPersistenceContext,
  type H3HealthPersistenceCommand,
  type H3PromptId,
  type H3Surface,
} from "@product/health-runner";

export const NO_SESSION_CLASSIFIER_VERSION = "no-session-runtime-v1";
export const NO_SESSION_HEALTH_LEASE_MS = 5 * 60_000;
export const NO_SESSION_HEALTH_MAX_CONCURRENCY = 9;
export const NO_SESSION_HEALTH_WAKE_MS = 60_000;
export const AUTHENTICATED_DEEP_CLASSIFIER_VERSION = "authenticated-deep-v1";

export type AuthenticatedDeepPersistenceContext = Omit<
  H3HealthPersistenceContext,
  "startedAt" | "completedAt"
>;

export type AuthenticatedDeepPersistenceContextResolver = (
  run: HealthScheduledRun,
  surface: H3Surface,
) => Promise<AuthenticatedDeepPersistenceContext | null>;

export type AuthenticatedDeepH3Runner = (input: {
  targetKey: string;
  surface: H3Surface;
  promptId: H3PromptId;
}) => Promise<H3ExecutionResult>;

export type AuthenticatedDeepPersistencePort = {
  persistCompletedHealthRun(
    input: H3HealthPersistenceCommand & {
      scheduledRunId: string;
    },
  ): Promise<{ healthRunId: string; healthState: HealthState }>;
};

export type DedicatedDeepSession = Readonly<{
  targetKey: string;
}>;

/** One scheduled deep run: one H3 invocation, safe package, one persistence call. */
export async function executeScheduledAuthenticatedDeepHealthRun(
  run: HealthScheduledRun,
  options: {
    session?: DedicatedDeepSession;
    resolvePersistenceContext?: AuthenticatedDeepPersistenceContextResolver;
    executeH3?: AuthenticatedDeepH3Runner;
    persistence?: AuthenticatedDeepPersistencePort;
    classifierVersion?: string;
    clock?: SchedulerClock;
  },
): Promise<ScheduledExecutionResult> {
  if (run.probeLayer !== "AUTHENTICATED_DEEP") {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_PROBE_LAYER_INVALID",
    };
  }
  const target = Object.values(AUTHENTICATED_DEEP_TARGETS).find(
    (candidate) => candidate.monitorTarget === run.monitorTarget,
  );
  if (
    !target ||
    target.provider !== run.provider ||
    target.surface !== run.surface
  ) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_TARGET_AUTHORITY_INVALID",
    };
  }
  if (
    options.session?.targetKey !== target.targetKey ||
    !options.resolvePersistenceContext ||
    !options.executeH3 ||
    !options.persistence ||
    !run.startedAt
  ) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_DEPENDENCY_UNAVAILABLE",
    };
  }
  const context = await options.resolvePersistenceContext(
    run,
    target.surface as H3Surface,
  );
  if (!context) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_SCOPE_UNAVAILABLE",
    };
  }
  // The packaged target key and surface are fixed by authority, never by input data.
  const rawExecution = await options.executeH3({
    targetKey: target.targetKey,
    surface: target.surface as H3Surface,
    promptId: "BRIDGE_COMMAND_SMOKE_V1",
  });
  const failureUncertainty =
    rawExecution.failureCode === "LOGIN_REQUIRED"
      ? "LOGIN_EXPIRED"
      : rawExecution.failureCode === "VERIFICATION_CHECKPOINT"
        ? "VERIFICATION_CHECKPOINT"
        : rawExecution.failureCode === "CONTROLLED_BROWSER_UNAVAILABLE"
          ? "CONTROLLED_BROWSER_UNAVAILABLE"
          : null;
  const execution =
    failureUncertainty && !rawExecution.environmentUncertainty
      ? { ...rawExecution, environmentUncertainty: failureUncertainty }
      : rawExecution;
  const completedAt = (options.clock ?? { now: () => new Date() }).now();
  let command: H3HealthPersistenceCommand;
  try {
    const evidencePackage = createH3HealthEvidencePackage(execution, {
      ...context,
      startedAt: run.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      classifierVersion:
        options.classifierVersion ?? AUTHENTICATED_DEEP_CLASSIFIER_VERSION,
    });
    command = materializeH3HealthPersistenceCommand(evidencePackage);
  } catch {
    return {
      outcome: "FAILED",
      failureClass: "TRANSIENT_ENVIRONMENT",
      failureCode: "AUTHENTICATED_DEEP_POST_SEND_MATERIALIZATION_REJECTED",
    };
  }
  try {
    const persisted = await options.persistence.persistCompletedHealthRun({
      ...command,
      scheduledRunId: run.id,
    });
    return {
      outcome: "SUCCEEDED",
      healthRunId: persisted.healthRunId,
      healthState: persisted.healthState,
    };
  } catch {
    return {
      outcome: "FAILED",
      failureClass: "TRANSIENT_ENVIRONMENT",
      failureCode: "AUTHENTICATED_DEEP_PERSISTENCE_REJECTED",
    };
  }
}

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

export type AuthenticatedDeepCycleRuntime = Readonly<{
  configuredTargetKeys: readonly string[];
  execute(run: HealthScheduledRun): Promise<ScheduledExecutionResult>;
}>;

export type DurableNoSessionHealthRuntimeOptions = {
  repository: SchedulerBootstrapRepository;
  completion: NoSessionCompletionPort;
  clock: SchedulerClock;
  ownerId: string;
  scheduleAuthority?: () => Promise<{
    intervalSeconds: number;
    nextDueAt: Date;
  }>;
  authorityPreflight?: () => Promise<void>;
  prepareAuthenticatedDeep?: () => Promise<AuthenticatedDeepCycleRuntime | null>;
  onAuthenticatedDeepUnavailable?: () => void;
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
    await options.authorityPreflight?.();
    const now = options.clock.now();
    const authority = options.scheduleAuthority
      ? await options.scheduleAuthority()
      : undefined;
    await ensureNoSessionHealthSchedules(
      options.repository,
      authority?.nextDueAt ?? now,
      authority?.intervalSeconds,
    );

    let authenticatedDeep: AuthenticatedDeepCycleRuntime | null = null;
    if (options.prepareAuthenticatedDeep) {
      try {
        authenticatedDeep = await options.prepareAuthenticatedDeep();
      } catch {
        options.onAuthenticatedDeepUnavailable?.();
      }
    }
    await ensureAuthenticatedDeepHealthSchedules(
      options.repository,
      now,
      authenticatedDeep?.configuredTargetKeys ?? [],
    );

    return runDurableHealthSchedulerCycle({
      repository: options.repository,
      clock: options.clock,
      ownerId: options.ownerId,
      leaseMs: options.leaseMs ?? NO_SESSION_HEALTH_LEASE_MS,
      maxConcurrency:
        options.maxConcurrency ?? NO_SESSION_HEALTH_MAX_CONCURRENCY,
      execute: (run) => {
        if (run.probeLayer === "AUTHENTICATED_DEEP") {
          if (!authenticatedDeep) {
            return Promise.resolve({
              outcome: "FAILED",
              failureClass: "TERMINAL_CONFIGURATION",
              failureCode: "AUTHENTICATED_DEEP_DEPENDENCY_UNAVAILABLE",
            } satisfies ScheduledExecutionResult);
          }
          return authenticatedDeep.execute(run);
        }
        return executeScheduledNoSessionHealthRun(run, options);
      },
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
    authorityPreflight?: () => Promise<void>;
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
    authorityPreflight: options.authorityPreflight,
    probe: options.probe,
    classifierVersion: options.classifierVersion,
    wakeMs: options.wakeMs,
    onWakeFailure: options.onWakeFailure,
  });
}
