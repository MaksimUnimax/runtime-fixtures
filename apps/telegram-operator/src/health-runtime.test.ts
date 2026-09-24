import { describe, expect, it, vi } from "vitest";
import type { HealthScheduledRun } from "@product/health";
import type {
  NoSessionObservationResult,
  NoSessionTarget,
} from "@product/health-runner";
import {
  executeScheduledNoSessionHealthRun,
  NO_SESSION_CLASSIFIER_VERSION,
} from "./health-runtime.js";

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
