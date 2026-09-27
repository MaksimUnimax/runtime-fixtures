import {
  BASELINE_HEALTH_SUITE,
  HealthSuiteDefinitionSchema,
  type HealthScheduledRun,
  type HealthScope,
  type HealthState,
  type ScheduledExecutionResult,
  type SchedulerClock,
} from "@product/health";
import {
  createHealthAuthenticatedDeepScopeRepository,
  createHealthIncidentRepository,
  createHealthPersistenceRepository,
  type DatabaseRuntime,
} from "@product/db";
import {
  AUTHENTICATED_DEEP_RUNTIME_AUTHORITY,
  AUTHENTICATED_DEEP_TARGETS,
  createDedicatedHealthChromeBrowserDriver,
  createDedicatedWorkHealthChromeBrowserDriver,
  createH3RunPlan,
  createPackagedStandardH3TargetRegistry,
  createPackagedWorkH3TargetRegistry,
  listDedicatedHealthSessionTargetKeys,
  loadDedicatedHealthSessionRegistry,
  runH3BehavioralSmoke,
  type BrowserRuntimeMetadata,
  type DedicatedHealthSessionRegistry,
  type DedicatedHealthSessionTargetKey,
  type H3ExecutionResult,
  type H3Surface,
} from "@product/health-runner";
import {
  AUTHENTICATED_DEEP_CLASSIFIER_VERSION,
  executeScheduledAuthenticatedDeepHealthRun,
  type AuthenticatedDeepCycleRuntime,
  type AuthenticatedDeepPersistencePort,
} from "./health-runtime.js";

const DEEP_TARGET_KEYS = new Set([
  "chatgpt_standard_health",
  "chatgpt_work_health",
]);

type SupportedDeepTargetKey = "chatgpt_standard_health" | "chatgpt_work_health";

export interface AuthenticatedDeepBrowserSession {
  start(): Promise<BrowserRuntimeMetadata>;
  runH3(input: {
    targetKey: SupportedDeepTargetKey;
    surface: H3Surface;
  }): Promise<H3ExecutionResult>;
  close(): Promise<void>;
}

export type AuthenticatedDeepRuntimePorts = Readonly<{
  loadRegistry(path: string): Promise<DedicatedHealthSessionRegistry>;
  listTargetKeys(
    registry: DedicatedHealthSessionRegistry,
  ): readonly DedicatedHealthSessionTargetKey[];
  createBrowserSession(
    registry: DedicatedHealthSessionRegistry,
    targetKey: SupportedDeepTargetKey,
  ): AuthenticatedDeepBrowserSession;
  resolveScope(input: {
    surface: "CHATGPT_STANDARD" | "CHATGPT_WORK";
    browserFamily: "chrome";
    browserVersion: string;
    extensionVersion: string;
    adapterEngineVersion: string;
    healthSuite: { machineKey: string; revision: number };
  }): Promise<HealthScope>;
  persistCompletedHealthRun(
    input: Parameters<
      AuthenticatedDeepPersistencePort["persistCompletedHealthRun"]
    >[0],
  ): Promise<{ healthRunId: string; healthState: HealthState }>;
}>;

function exactTarget(run: HealthScheduledRun) {
  return Object.values(AUTHENTICATED_DEEP_TARGETS).find(
    (candidate) =>
      candidate.monitorTarget === run.monitorTarget &&
      candidate.provider === run.provider &&
      candidate.surface === run.surface,
  );
}

function isSupportedTargetKey(value: string): value is SupportedDeepTargetKey {
  return DEEP_TARGET_KEYS.has(value);
}
function suiteForScope(scope: HealthScope) {
  return HealthSuiteDefinitionSchema.parse({
    ...BASELINE_HEALTH_SUITE,
    scope,
  });
}

function deterministicScopeFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^AUTHENTICATED_DEEP_[A-Z0-9_]+$/.test(error.message)
  );
}

async function executeOneDeepRun(
  run: HealthScheduledRun,
  registry: DedicatedHealthSessionRegistry,
  configuredTargetKeys: ReadonlySet<string>,
  ports: AuthenticatedDeepRuntimePorts,
  clock: SchedulerClock,
): Promise<ScheduledExecutionResult> {
  const target = exactTarget(run);
  if (!target || !isSupportedTargetKey(target.targetKey)) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_TARGET_AUTHORITY_INVALID",
    };
  }
  if (!configuredTargetKeys.has(target.targetKey)) {
    return {
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_DEPENDENCY_UNAVAILABLE",
    };
  }
  const browser = ports.createBrowserSession(registry, target.targetKey);
  try {
    let browserRuntime: BrowserRuntimeMetadata;
    try {
      browserRuntime = await browser.start();
    } catch {
      return {
        outcome: "FAILED",
        failureClass: "BROWSER_UNAVAILABLE",
        failureCode: "AUTHENTICATED_DEEP_BROWSER_UNAVAILABLE",
      };
    }

    let scope: HealthScope;
    try {
      scope = await ports.resolveScope({
        surface: target.surface,
        browserFamily: "chrome",
        browserVersion: browserRuntime.browserVersion,
        extensionVersion: AUTHENTICATED_DEEP_RUNTIME_AUTHORITY.extensionVersion,
        adapterEngineVersion:
          AUTHENTICATED_DEEP_RUNTIME_AUTHORITY.adapterEngineVersion,
        healthSuite: {
          machineKey: BASELINE_HEALTH_SUITE.machineKey,
          revision: BASELINE_HEALTH_SUITE.revision,
        },
      });
    } catch (error) {
      if (deterministicScopeFailure(error)) {
        return {
          outcome: "FAILED",
          failureClass: "TERMINAL_CONFIGURATION",
          failureCode: "AUTHENTICATED_DEEP_SCOPE_UNAVAILABLE",
        };
      }
      throw error;
    }
    const persistenceContext = {
      suite: suiteForScope(scope),
      browserRuntime,
      operatorMaintenance: false,
      operatorMaintenanceAuthority: null,
      classifierVersion: AUTHENTICATED_DEEP_CLASSIFIER_VERSION,
    };

    return await executeScheduledAuthenticatedDeepHealthRun(run, {
      session: { targetKey: target.targetKey },
      resolvePersistenceContext: async () => persistenceContext,
      executeH3: async ({ targetKey, surface }) =>
        browser.runH3({
          targetKey: targetKey as SupportedDeepTargetKey,
          surface,
        }),
      persistence: {
        persistCompletedHealthRun: ports.persistCompletedHealthRun,
      },
      clock,
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export function createAuthenticatedDeepCycleRuntimeProvider(
  configPath: string | undefined,
  ports: AuthenticatedDeepRuntimePorts,
  clock: SchedulerClock = { now: () => new Date() },
): () => Promise<AuthenticatedDeepCycleRuntime | null> {
  const boundedPath = configPath?.trim() || undefined;
  if (!boundedPath) return async () => null;

  return async () => {
    const registry = await ports.loadRegistry(boundedPath);
    const configuredTargetKeys = ports
      .listTargetKeys(registry)
      .filter((targetKey): targetKey is SupportedDeepTargetKey =>
        isSupportedTargetKey(targetKey),
      );
    const configured = new Set(configuredTargetKeys);
    return Object.freeze({
      configuredTargetKeys: Object.freeze([...configuredTargetKeys]),
      execute: (run: HealthScheduledRun) =>
        executeOneDeepRun(run, registry, configured, ports, clock),
    });
  };
}

function productionBrowserSession(
  registry: DedicatedHealthSessionRegistry,
  targetKey: SupportedDeepTargetKey,
): AuthenticatedDeepBrowserSession {
  const driver =
    targetKey === "chatgpt_standard_health"
      ? createDedicatedHealthChromeBrowserDriver(
          createPackagedStandardH3TargetRegistry(),
          registry,
          targetKey,
        )
      : createDedicatedWorkHealthChromeBrowserDriver(
          createPackagedWorkH3TargetRegistry(),
          registry,
          targetKey,
        );

  return {
    async start() {
      await driver.start();
      return driver.getRuntimeMetadata();
    },
    async runH3(input) {
      await driver.open(input.targetKey);
      const strategy =
        input.surface === "CHATGPT_STANDARD"
          ? driver.createChatGPTStandardH3Strategy()
          : driver.createChatGPTWorkH3Strategy();
      return runH3BehavioralSmoke(
        strategy,
        createH3RunPlan(input.targetKey, input.surface),
      );
    },
    close: () => driver.closeOrPersist(),
  };
}
export function createPostgresAuthenticatedDeepCycleRuntimeProvider(
  database: DatabaseRuntime,
  configPath: string | undefined,
  options: { clock?: SchedulerClock } = {},
): () => Promise<AuthenticatedDeepCycleRuntime | null> {
  const scope = createHealthAuthenticatedDeepScopeRepository(database);
  const persistence = createHealthPersistenceRepository(database);
  const incidents = createHealthIncidentRepository(database);

  return createAuthenticatedDeepCycleRuntimeProvider(
    configPath,
    {
      loadRegistry: loadDedicatedHealthSessionRegistry,
      listTargetKeys: listDedicatedHealthSessionTargetKeys,
      createBrowserSession: productionBrowserSession,
      resolveScope: (input) => scope.resolveAuthenticatedDeepHealthScope(input),
      async persistCompletedHealthRun(input) {
        const persisted = await persistence.persistCompletedHealthRun(input);
        await incidents.processCompletedHealthRun(persisted.id);
        return {
          healthRunId: persisted.id,
          healthState: persisted.healthState,
        };
      },
    },
    options.clock,
  );
}
