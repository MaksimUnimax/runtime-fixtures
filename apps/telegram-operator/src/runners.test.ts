import { describe, expect, it, vi } from "vitest";
import type { NoSessionObservationResult } from "@product/health-runner";
import type { MonitoringNotification } from "@product/monitoring-control";
import {
  createLlmMonitoringRunner,
  resultFromDurableHealthCycle,
  resultFromNoSessionBatch,
  shouldSendMonitoringNotification,
} from "./runners.js";

const successfulCycle = {
  materialized: 9,
  claimed: 9,
  succeeded: 9,
  retryableFailures: 0,
  terminalFailures: 0,
  timedOut: 0,
  reconciled: 0,
};

function observation(
  surfaceId: NoSessionObservationResult["surfaceId"],
  surfaceOutcome: NoSessionObservationResult["surfaceOutcome"],
  observedAt = "2026-09-28T10:00:00.000Z",
): NoSessionObservationResult {
  // Only the fields read by the pure result formatter are needed here.
  // Use real production enum values, not out-of-contract lower-case labels.
  return {
    surfaceId,
    surfaceOutcome,
    observedAt,
  } as NoSessionObservationResult;
}

describe("C04 durable LLM lane composition", () => {
  it("uses durable Health only for scheduled LLM runs", async () => {
    const scheduled = vi.fn(async () => successfulCycle);
    const forced = vi.fn(async () => ({
      status: "AUTH_REQUIRED" as const,
      code: "AUTH_REQUIRED",
      summary: "forced",
    }));
    const runner = createLlmMonitoringRunner(scheduled, forced);

    const result = await runner({
      lane: "LLM",
      runId: "00000000-0000-4000-8000-000000000001",
      source: "SCHEDULED",
    });

    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(forced).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "SUCCEEDED", code: null });
  });

  it("keeps forced /llm_run on the existing on-demand runner", async () => {
    const scheduled = vi.fn(async () => successfulCycle);
    const forced = vi.fn(async () => ({
      status: "NOT_OBSERVABLE" as const,
      code: "FORCED_FIXTURE",
      summary: "forced",
    }));
    const runner = createLlmMonitoringRunner(scheduled, forced);

    const result = await runner({
      lane: "LLM",
      runId: "00000000-0000-4000-8000-000000000002",
      source: "FORCED",
    });

    expect(forced).toHaveBeenCalledTimes(1);
    expect(scheduled).not.toHaveBeenCalled();
    expect(result.code).toBe("FORCED_FIXTURE");
  });

  it("surfaces scheduler execution failures without duplicating Health incidents", () => {
    expect(
      resultFromDurableHealthCycle({
        ...successfulCycle,
        succeeded: 8,
        retryableFailures: 1,
      }),
    ).toMatchObject({
      status: "FAILED",
      code: "HEALTH_SCHEDULER_EXECUTION_FAILED",
      coverage: {
        observedAt: null,
        checkDepth: "SCHEDULED_EXECUTION",
        testedTargets: [],
        unverifiedTargets: [],
        comparisonState: "NOT_APPLICABLE",
        changeSeverity: null,
      },
    });
  });

  it("records exact public no-session coverage without treating auth-limited surfaces as tested", () => {
    expect(
      resultFromNoSessionBatch([
        observation(
          "CHATGPT_STANDARD",
          "PUBLIC_INTERACTIVE",
          "2026-09-28T10:00:00.000Z",
        ),
        observation(
          "CHATGPT_WORK",
          "AUTH_REQUIRED",
          "2026-09-28T10:00:01.000Z",
        ),
        observation("GEMINI", "DRIFT", "2026-09-28T10:00:02.000Z"),
      ]),
    ).toMatchObject({
      status: "FAILED",
      code: "PROVIDER_SURFACE_DRIFT",
      coverage: {
        observedAt: "2026-09-28T10:00:02.000Z",
        checkDepth: "PUBLIC_NO_SESSION",
        testedTargets: ["CHATGPT_STANDARD", "GEMINI"],
        unverifiedTargets: ["CHATGPT_WORK"],
        comparisonState: "NOT_APPLICABLE",
        changeSeverity: "REVIEW_REQUIRED",
      },
    });
  });

  it.each([
    "SECURITY_CHECKPOINT",
    "ACCESS_BLOCKED",
    "REGION_OR_ELIGIBILITY_RESTRICTED",
    "IDENTITY_NOT_PROVEN",
  ] as const)(
    "does not report an all-unverified %s guest surface as SUCCESS",
    (surfaceOutcome) => {
      const result = resultFromNoSessionBatch([
        observation("CHATGPT_STANDARD", surfaceOutcome),
      ]);
      expect(result).toMatchObject({
        status: "NOT_OBSERVABLE",
        code: "NO_SESSION_NOT_OBSERVABLE",
        coverage: {
          checkDepth: "PUBLIC_NO_SESSION",
          testedTargets: [],
          unverifiedTargets: ["CHATGPT_STANDARD"],
          comparisonState: "NOT_APPLICABLE",
        },
      });
      expect(result.summary).not.toContain("completed");
    },
  );

  it("keeps partial observed-plus-region-restricted coverage non-successful", () => {
    const result = resultFromNoSessionBatch([
      observation("CHATGPT_STANDARD", "PUBLIC_INTERACTIVE"),
      observation("DEEPSEEK", "REGION_OR_ELIGIBILITY_RESTRICTED"),
    ]);
    expect(result).toMatchObject({
      status: "NOT_OBSERVABLE",
      code: "NO_SESSION_NOT_OBSERVABLE",
      coverage: {
        testedTargets: ["CHATGPT_STANDARD"],
        unverifiedTargets: ["DEEPSEEK"],
      },
    });
  });

  it("retains SUCCEEDED when every guest surface is genuinely observed", () => {
    expect(
      resultFromNoSessionBatch([
        observation("CHATGPT_STANDARD", "PUBLIC_INTERACTIVE"),
        observation("GEMINI", "PUBLIC_LANDING"),
      ]),
    ).toMatchObject({
      status: "SUCCEEDED",
      code: null,
      coverage: {
        testedTargets: ["CHATGPT_STANDARD", "GEMINI"],
        unverifiedTargets: [],
      },
    });
  });

  it("suppresses ordinary scheduled LLM TG2 notifications but preserves forced, failure and Swagger notifications", () => {
    const notification = (
      changes: Partial<MonitoringNotification>,
    ): MonitoringNotification => ({
      lane: "LLM",
      runId: "00000000-0000-4000-8000-000000000003",
      source: "SCHEDULED",
      result: {
        status: "SUCCEEDED",
        code: null,
        summary: "safe",
      },
      ...changes,
    });

    expect(shouldSendMonitoringNotification(notification({}))).toBe(false);
    expect(
      shouldSendMonitoringNotification(
        notification({
          result: {
            status: "FAILED",
            code: "HEALTH_SCHEDULER_EXECUTION_FAILED",
            summary: "safe",
          },
        }),
      ),
    ).toBe(true);
    expect(
      shouldSendMonitoringNotification(notification({ source: "FORCED" })),
    ).toBe(true);
    expect(
      shouldSendMonitoringNotification(notification({ lane: "SWAGGER_API" })),
    ).toBe(true);
  });
});
