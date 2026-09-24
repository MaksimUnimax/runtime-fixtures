import { describe, expect, it, vi } from "vitest";
import type { MonitoringNotification } from "@product/monitoring-control";
import {
  createLlmMonitoringRunner,
  resultFromDurableHealthCycle,
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
