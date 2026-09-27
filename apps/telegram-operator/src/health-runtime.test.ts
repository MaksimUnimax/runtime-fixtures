import { describe, expect, it, vi } from "vitest";
import type { HealthScheduledRun } from "@product/health";
import { BASELINE_HEALTH_SUITE, classifyHealth } from "@product/health";
import type {
  NoSessionObservationResult,
  NoSessionTarget,
} from "@product/health-runner";
import {
  executeScheduledAuthenticatedDeepHealthRun,
  executeScheduledNoSessionHealthRun,
  NO_SESSION_CLASSIFIER_VERSION,
  NO_SESSION_HEALTH_WAKE_MS,
  type AuthenticatedDeepPersistencePort,
} from "./health-runtime.js";
import { H3ExecutionResultSchema } from "@product/health-runner";

const startedAt = new Date("2026-09-24T12:00:00.000Z");
const completedAt = new Date("2026-09-24T12:00:01.000Z");

function run(changes: Partial<HealthScheduledRun> = {}): HealthScheduledRun {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    scheduleId: "00000000-0000-4000-8000-000000000002",
    monitorTarget: "nosession_chatgpt_standard",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
    probeLayer: "NO_SESSION",
    scheduleRevision: 1,
    dueSlotAt: startedAt,
    idempotencyKey: "a".repeat(64),
    state: "RUNNING",
    ownerId: "worker",
    leaseId: "00000000-0000-4000-8000-000000000003",
    claimedAt: startedAt,
    leaseExpiresAt: new Date("2026-09-24T12:05:00.000Z"),
    timeoutAt: new Date("2026-09-24T12:03:00.000Z"),
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

const observation = {
  providerId: "chatgpt",
  surfaceId: "CHATGPT_STANDARD",
  targetKey: "nosession_chatgpt_standard",
  classification: "BROKEN",
} as unknown as NoSessionObservationResult;

describe("C04 scheduled no-session executor", () => {
  it("persists a bounded observation and returns the persisted Health identity", async () => {
    const completion = {
      completeScheduledNoSessionHealthRun: vi.fn(async (input: unknown) => {
        expect(input).toMatchObject({
          scheduledRunId: run().id,
          observation,
          classifierVersion: NO_SESSION_CLASSIFIER_VERSION,
          startedAt,
          completedAt,
        });
        return {
          scheduledRunId: run().id,
          healthRunId: "00000000-0000-4000-8000-000000000004",
          healthState: "BROKEN" as const,
          incident: {
            runId: "00000000-0000-4000-8000-000000000004",
            action: "OPENED" as const,
            incidentIds: ["00000000-0000-4000-8000-000000000005"],
          },
        };
      }),
    };
    const probe = vi.fn(
      async (_target: NoSessionTarget, observedAt: string) => {
        expect(observedAt).toBe(completedAt.toISOString());
        return observation;
      },
    );

    const result = await executeScheduledNoSessionHealthRun(run(), {
      completion,
      clock: { now: () => completedAt },
      probe,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(
      completion.completeScheduledNoSessionHealthRun,
    ).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      outcome: "SUCCEEDED",
      healthRunId: "00000000-0000-4000-8000-000000000004",
      healthState: "BROKEN",
    });
  });

  it("fails closed before probing for a mismatched scheduled authority", async () => {
    const completion = {
      completeScheduledNoSessionHealthRun: vi.fn(),
    };
    const probe = vi.fn();

    const result = await executeScheduledNoSessionHealthRun(
      run({ provider: "alice" }),
      {
        completion,
        clock: { now: () => completedAt },
        probe,
      },
    );

    expect(result).toEqual({
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "NO_SESSION_TARGET_AUTHORITY_INVALID",
    });
    expect(probe).not.toHaveBeenCalled();
    expect(
      completion.completeScheduledNoSessionHealthRun,
    ).not.toHaveBeenCalled();
  });

  it("maps deterministic persistence rejection to terminal configuration", async () => {
    const completion = {
      completeScheduledNoSessionHealthRun: vi.fn(async () => {
        throw new Error("NO_SESSION_PROFILE_AUTHORITY_NOT_FOUND");
      }),
    };

    const result = await executeScheduledNoSessionHealthRun(run(), {
      completion,
      clock: { now: () => completedAt },
      probe: async () => observation,
    });

    expect(result).toEqual({
      outcome: "FAILED",
      failureClass: "TERMINAL_CONFIGURATION",
      failureCode: "NO_SESSION_PERSISTENCE_REJECTED",
    });
  });

  it("rethrows unexpected persistence failure so the durable scheduler applies bounded retry", async () => {
    const completion = {
      completeScheduledNoSessionHealthRun: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };

    await expect(
      executeScheduledNoSessionHealthRun(run(), {
        completion,
        clock: { now: () => completedAt },
        probe: async () => observation,
      }),
    ).rejects.toThrow("database unavailable");
  });
});

describe("scheduled authenticated-deep executor", () => {
  it("keeps the durable wake cadence separate from the deep schedule interval", async () => {
    const { AUTHENTICATED_DEEP_INTERVAL_SECONDS } = await import(
      "@product/health-runner"
    );
    expect(AUTHENTICATED_DEEP_INTERVAL_SECONDS).toBe(5_400);
    expect(NO_SESSION_HEALTH_WAKE_MS).toBe(60_000);
  });
  const deepRun = run({
    monitorTarget: "authdeep_chatgpt_standard",
    probeLayer: "AUTHENTICATED_DEEP",
    provider: "chatgpt",
    surface: "CHATGPT_STANDARD",
  });
  const context = {
    suite: {
      ...BASELINE_HEALTH_SUITE,
      scope: {
        ...BASELINE_HEALTH_SUITE.scope,
        surfaceKey: "standard",
        profile: { ...BASELINE_HEALTH_SUITE.scope.profile, revision: 2 },
      },
    },
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    browserRuntime: {
      family: "chrome" as const,
      browserName: "chromium",
      browserVersion: "120.0.0.0",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED" as const,
    },
    operatorMaintenance: false,
    operatorMaintenanceAuthority: null,
    classifierVersion: "test-v1",
  };
  const execution = (
    uncertainty:
      | "LOGIN_EXPIRED"
      | "VERIFICATION_CHECKPOINT"
      | "CONTROLLED_BROWSER_UNAVAILABLE"
      | null = null,
  ) =>
    H3ExecutionResultSchema.parse({
      level: "H3",
      targetKey: "chatgpt_standard_health",
      surfaceProfile: {
        surface: "CHATGPT_STANDARD",
        profileId: "CHATGPT_STANDARD_H3_V2",
        profileRevision: 2,
      },
      outcome: uncertainty ? "UNCERTAIN" : "PASS",
      completedSteps: [],
      events: [],
      durationMs: 100,
      failureCode:
        uncertainty === "LOGIN_EXPIRED"
          ? "LOGIN_REQUIRED"
          : uncertainty === "VERIFICATION_CHECKPOINT"
            ? "VERIFICATION_CHECKPOINT"
            : uncertainty
              ? "CONTROLLED_BROWSER_UNAVAILABLE"
              : null,
      failureStep: null,
      cleanupOutcome: "PASS",
      cleanupFailureCode: null,
      environmentUncertainty: uncertainty,
    });
  const options = (
    executeH3 = vi.fn(async () => execution()),
    persistCompletedHealthRun = vi.fn<
      AuthenticatedDeepPersistencePort["persistCompletedHealthRun"]
    >(async () => ({
      healthRunId: "health-1",
      healthState: "HEALTHY",
    })),
  ) => ({
    session: { targetKey: "chatgpt_standard_health" },
    resolvePersistenceContext: vi.fn(async () => context),
    executeH3,
    persistence: { persistCompletedHealthRun },
  });

  it("rejects non-deep runs and fails closed when resolver or dedicated session is missing", async () => {
    const invalid = options();
    expect(
      (await executeScheduledAuthenticatedDeepHealthRun(run(), invalid))
        .outcome,
    ).toBe("FAILED");
    expect(invalid.executeH3).not.toHaveBeenCalled();
    const missing = options();
    expect(
      (
        await executeScheduledAuthenticatedDeepHealthRun(deepRun, {
          ...missing,
          session: undefined,
        })
      ).outcome,
    ).toBe("FAILED");
    expect(missing.executeH3).not.toHaveBeenCalled();
    const noResolver = options();
    expect(
      (
        await executeScheduledAuthenticatedDeepHealthRun(deepRun, {
          ...noResolver,
          resolvePersistenceContext: undefined,
        })
      ).outcome,
    ).toBe("FAILED");
    expect(noResolver.executeH3).not.toHaveBeenCalled();
  });

  it("persists the safe materialized command once with scheduledRunId", async () => {
    const configured = options();
    const persist = configured.persistence.persistCompletedHealthRun;
    const result = await executeScheduledAuthenticatedDeepHealthRun(
      deepRun,
      configured,
    );
    expect(configured.executeH3).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledRunId: deepRun.id,
        healthLevel: "H3",
      }),
    );
    expect(result).toEqual({
      outcome: "SUCCEEDED",
      healthRunId: "health-1",
      healthState: "HEALTHY",
    });
  });

  it.each([
    "LOGIN_EXPIRED",
    "VERIFICATION_CHECKPOINT",
    "CONTROLLED_BROWSER_UNAVAILABLE",
  ] as const)(
    "retains %s as Health UNKNOWN uncertainty rather than scheduler product drift",
    async (reason) => {
      let command: unknown;
      const persistUnknown = vi.fn<
        AuthenticatedDeepPersistencePort["persistCompletedHealthRun"]
      >(async (input) => {
        const { scheduledRunId, ...healthCommand } = input;
        command = { scheduledRunId, healthCommand };
        return {
          healthRunId: "health-unknown",
          healthState: "UNKNOWN",
        };
      });
      const configured = options(
        vi.fn(async () => execution(reason)),
        persistUnknown,
      );
      const result = await executeScheduledAuthenticatedDeepHealthRun(
        deepRun,
        configured,
      );
      expect(result).toMatchObject({
        outcome: "SUCCEEDED",
        healthState: "UNKNOWN",
      });
      expect(command).toMatchObject({ scheduledRunId: deepRun.id });
      const { suite, results, operatorMaintenance } = (
        command as {
          healthCommand: {
            suite: unknown;
            results: unknown[];
            operatorMaintenance: boolean;
          };
        }
      ).healthCommand;
      expect(classifyHealth({ suite, results, operatorMaintenance })).toBe(
        "UNKNOWN",
      );
      expect(configured.executeH3).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds persistence rejection without rerunning H3", async () => {
    const persistRejected = vi.fn<
      AuthenticatedDeepPersistencePort["persistCompletedHealthRun"]
    >(async () => {
      throw new Error("rejected");
    });
    const configured = options(undefined, persistRejected);
    expect(
      await executeScheduledAuthenticatedDeepHealthRun(deepRun, configured),
    ).toEqual({
      outcome: "FAILED",
      failureClass: "TRANSIENT_ENVIRONMENT",
      failureCode: "AUTHENTICATED_DEEP_PERSISTENCE_REJECTED",
    });
    expect(configured.executeH3).toHaveBeenCalledTimes(1);
  });
});
