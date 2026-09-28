import { describe, expect, it, vi } from "vitest";
import {
  BASELINE_HEALTH_SUITE,
  type HealthScheduledRun,
  type HealthScope,
} from "@product/health";
import {
  H3ExecutionResultSchema,
  type BrowserRuntimeMetadata,
  type DedicatedHealthSessionRegistry,
  type DedicatedHealthSessionTargetKey,
} from "@product/health-runner";
import {
  createAuthenticatedDeepCycleRuntimeProvider,
  type AuthenticatedDeepBrowserSession,
  type AuthenticatedDeepRuntimePorts,
} from "./authenticated-deep-runtime.js";

const startedAt = new Date("2026-09-27T17:00:00.000Z");
const completedAt = new Date("2026-09-27T17:00:05.000Z");
const registry = Object.freeze({}) as DedicatedHealthSessionRegistry;

function deepRun(
  changes: Partial<HealthScheduledRun> = {},
): HealthScheduledRun {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    scheduleId: "00000000-0000-4000-8000-000000000102",
    monitorTarget: "authdeep_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "AUTHENTICATED_DEEP",
    scheduleRevision: 1,
    dueSlotAt: startedAt,
    idempotencyKey: "b".repeat(64),
    state: "RUNNING",
    ownerId: "deep-worker",
    leaseId: "00000000-0000-4000-8000-000000000103",
    claimedAt: startedAt,
    leaseExpiresAt: new Date("2026-09-27T17:05:00.000Z"),
    timeoutAt: new Date("2026-09-27T17:03:00.000Z"),
    attempt: 1,
    startedAt,
    finishedAt: null,
    nextAttemptAt: null,
    failureClass: null,
    failureCode: null,
    healthRunId: null,
    healthState: null,
    ...changes,
  };
}

const browserRuntime: BrowserRuntimeMetadata = {
  family: "chrome",
  browserName: "chromium",
  browserVersion: "154.0.0.0",
  headless: true,
  sessionKind: "EPHEMERAL_CONTROLLED",
};

function resolvedScope(surfaceKey = "standard", revision = 2): HealthScope {
  return {
    ...BASELINE_HEALTH_SUITE.scope,
    adapterFamilyKey: "chatgpt",
    surfaceKey,
    browserFamily: "chrome",
    browserVersion: browserRuntime.browserVersion,
    extensionVersion: "0.2.5",
    adapterEngineVersion: "0.1.0",
    profile: {
      ...BASELINE_HEALTH_SUITE.scope.profile,
      revision,
    },
  };
}

function passExecution() {
  return H3ExecutionResultSchema.parse({
    level: "H3",
    targetKey: "chatgpt_standard_health",
    surfaceProfile: {
      surface: "CHATGPT_STANDARD",
      profileId: "CHATGPT_STANDARD_H3_V2",
      profileRevision: 2,
    },
    outcome: "PASS",
    completedSteps: [],
    events: [],
    durationMs: 100,
    failureCode: null,
    failureStep: null,
    cleanupOutcome: "PASS",
    cleanupFailureCode: null,
    environmentUncertainty: null,
  });
}

function ports(overrides: Partial<AuthenticatedDeepRuntimePorts> = {}) {
  const session: AuthenticatedDeepBrowserSession = {
    start: vi.fn(async () => browserRuntime),
    runH3: vi.fn(async () => passExecution()),
    close: vi.fn(async () => undefined),
  };
  const base: AuthenticatedDeepRuntimePorts = {
    loadRegistry: vi.fn(async () => registry),
    listTargetKeys: vi.fn((): readonly DedicatedHealthSessionTargetKey[] => [
      "chatgpt_standard_health",
    ]),
    createBrowserSession: vi.fn(() => session),
    resolveScope: vi.fn(async () => resolvedScope()),
    persistCompletedHealthRun: vi.fn(async () => ({
      healthRunId: "00000000-0000-4000-8000-000000000104",
      healthState: "HEALTHY" as const,
    })),
  };
  return {
    session,
    value: { ...base, ...overrides } as AuthenticatedDeepRuntimePorts,
  };
}

describe("authenticated deep production composition", () => {
  it("keeps missing config as strict no-runtime without reading sessions", async () => {
    const configured = ports();
    const prepare = createAuthenticatedDeepCycleRuntimeProvider(
      undefined,
      configured.value,
      { now: () => completedAt },
    );
    expect(await prepare()).toBeNull();
    expect(configured.value.loadRegistry).not.toHaveBeenCalled();
    expect(configured.value.createBrowserSession).not.toHaveBeenCalled();
  });
  it("filters configured session authority to exact ChatGPT deep targets", async () => {
    const configured = ports({
      listTargetKeys: vi.fn((): readonly DedicatedHealthSessionTargetKey[] => [
        "chatgpt_standard_health",
        "alice_health",
        "chatgpt_work_health",
      ]),
    });
    const runtime = await createAuthenticatedDeepCycleRuntimeProvider(
      "/private/dedicated.json",
      configured.value,
      { now: () => completedAt },
    )();

    expect(runtime?.configuredTargetKeys).toEqual([
      "chatgpt_standard_health",
      "chatgpt_work_health",
    ]);
    expect(configured.value.loadRegistry).toHaveBeenCalledWith(
      "/private/dedicated.json",
    );
  });

  it("fails closed on B13 authority rejection before H3 and always closes browser", async () => {
    const events: string[] = [];
    const session: AuthenticatedDeepBrowserSession = {
      start: vi.fn(async () => {
        events.push("browser:start");
        return browserRuntime;
      }),
      runH3: vi.fn(async () => {
        events.push("h3");
        return passExecution();
      }),
      close: vi.fn(async () => {
        events.push("browser:close");
      }),
    };
    const configured = ports({
      createBrowserSession: vi.fn(() => session),
      resolveScope: vi.fn(async () => {
        events.push("scope");
        throw new Error("AUTHENTICATED_DEEP_PROFILE_AUTHORITY_NOT_FOUND");
      }),
    });
    const runtime = await createAuthenticatedDeepCycleRuntimeProvider(
      "/private/dedicated.json",
      configured.value,
      { now: () => completedAt },
    )();
    const result = await runtime!.execute(deepRun());

    expect(result).toEqual({
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "AUTHENTICATED_DEEP_SCOPE_UNAVAILABLE",
    });
    expect(events).toEqual(["browser:start", "scope", "browser:close"]);
    expect(session.runH3).not.toHaveBeenCalled();
    expect(configured.value.persistCompletedHealthRun).not.toHaveBeenCalled();
  });
  it("runs one exact H3 after scope authority and persists the scheduled identity once", async () => {
    const events: string[] = [];
    const session: AuthenticatedDeepBrowserSession = {
      start: vi.fn(async () => {
        events.push("browser:start");
        return browserRuntime;
      }),
      runH3: vi.fn(async (input) => {
        events.push("h3");
        expect(input).toEqual({
          targetKey: "chatgpt_standard_health",
          surface: "CHATGPT_STANDARD",
        });
        return passExecution();
      }),
      close: vi.fn(async () => {
        events.push("browser:close");
      }),
    };
    const configured = ports({
      createBrowserSession: vi.fn(() => session),
      resolveScope: vi.fn(async (input) => {
        events.push("scope");
        expect(input).toMatchObject({
          surface: "CHATGPT_STANDARD",
          browserFamily: "chrome",
          browserVersion: "154.0.0.0",
          extensionVersion: "0.2.5",
          adapterEngineVersion: "0.1.0",
          healthSuite: {
            machineKey: BASELINE_HEALTH_SUITE.machineKey,
            revision: BASELINE_HEALTH_SUITE.revision,
          },
        });
        return resolvedScope();
      }),
      persistCompletedHealthRun: vi.fn(async (input) => {
        events.push("persist");
        expect(input).toMatchObject({
          scheduledRunId: deepRun().id,
          healthLevel: "H3",
          startedAt,
          completedAt,
        });
        return {
          healthRunId: "00000000-0000-4000-8000-000000000104",
          healthState: "HEALTHY" as const,
        };
      }),
    });
    const runtime = await createAuthenticatedDeepCycleRuntimeProvider(
      "/private/dedicated.json",
      configured.value,
      { now: () => completedAt },
    )();
    const result = await runtime!.execute(deepRun());

    expect(result).toEqual({
      outcome: "SUCCEEDED",
      healthRunId: "00000000-0000-4000-8000-000000000104",
      healthState: "HEALTHY",
    });
    expect(events).toEqual([
      "browser:start",
      "scope",
      "h3",
      "persist",
      "browser:close",
    ]);
    expect(session.runH3).toHaveBeenCalledTimes(1);
    expect(configured.value.persistCompletedHealthRun).toHaveBeenCalledTimes(1);
  });
  it("keeps exactly one H3 when the production persistence port fails after its commit boundary", async () => {
    const committedHealthRunId = "00000000-0000-4000-8000-000000000105";
    let committed: string | null = null;
    let incidentAttempts = 0;
    const configured = ports({
      persistCompletedHealthRun: vi.fn(async () => {
        committed = committedHealthRunId;
        incidentAttempts += 1;
        throw new Error("incident processor unavailable after health commit");
      }),
    });
    const runtime = await createAuthenticatedDeepCycleRuntimeProvider(
      "/private/dedicated.json",
      configured.value,
      { now: () => completedAt },
    )();

    expect(await runtime!.execute(deepRun())).toEqual({
      outcome: "FAILED",
      failureClass: "TRANSIENT_ENVIRONMENT",
      failureCode: "AUTHENTICATED_DEEP_PERSISTENCE_REJECTED",
    });
    expect(committed).toBe(committedHealthRunId);
    expect(incidentAttempts).toBe(1);
    expect(configured.session.runH3).toHaveBeenCalledTimes(1);
    expect(configured.value.persistCompletedHealthRun).toHaveBeenCalledTimes(1);
    expect(configured.session.close).toHaveBeenCalledTimes(1);
  });

  it("returns browser-unavailable before scope or H3 when dedicated launch fails", async () => {
    const session: AuthenticatedDeepBrowserSession = {
      start: vi.fn(async () => {
        throw new Error("browser unavailable");
      }),
      runH3: vi.fn(async () => passExecution()),
      close: vi.fn(async () => undefined),
    };
    const configured = ports({
      createBrowserSession: vi.fn(() => session),
    });
    const runtime = await createAuthenticatedDeepCycleRuntimeProvider(
      "/private/dedicated.json",
      configured.value,
      { now: () => completedAt },
    )();
    const result = await runtime!.execute(deepRun());

    expect(result).toEqual({
      outcome: "FAILED",
      failureClass: "BROWSER_UNAVAILABLE",
      failureCode: "AUTHENTICATED_DEEP_BROWSER_UNAVAILABLE",
    });
    expect(configured.value.resolveScope).not.toHaveBeenCalled();
    expect(session.runH3).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
