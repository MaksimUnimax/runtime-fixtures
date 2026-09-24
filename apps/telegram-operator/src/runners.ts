import type { SchedulerCycleSummary } from "@product/health";
import {
  runNoSessionBatch,
  type NoSessionObservationResult,
} from "@product/health-runner";
import type {
  MonitoringLaneRunner,
  MonitoringNotification,
  MonitoringRunResult,
} from "@product/monitoring-control";

function resultFromNoSessionBatch(
  results: readonly NoSessionObservationResult[],
): MonitoringRunResult {
  const drift = results.find(
    (result) =>
      result.surfaceOutcome === "DRIFT" || result.surfaceOutcome === "BROKEN",
  );
  if (drift)
    return {
      status: "FAILED",
      code: "PROVIDER_SURFACE_DRIFT",
      summary: "No-session monitoring observed a provider surface failure.",
    };
  if (
    results.some(
      (result) =>
        result.surfaceOutcome === "AUTH_REQUIRED" ||
        result.surfaceOutcome === "NOT_OBSERVABLE_WITHOUT_SESSION",
    )
  ) {
    return {
      status: "AUTH_REQUIRED",
      code: "AUTH_REQUIRED",
      summary: "One or more monitored providers require a legitimate session.",
    };
  }
  if (
    results.every(
      (result) =>
        result.surfaceOutcome === "BROWSER_FAILURE" ||
        result.surfaceOutcome === "NETWORK_FAILURE" ||
        result.surfaceOutcome === "UNSUPPORTED_ENVIRONMENT",
    )
  ) {
    return {
      status: "NOT_OBSERVABLE",
      code: "NO_SESSION_NOT_OBSERVABLE",
      summary: "No-session monitoring was bounded by the current environment.",
    };
  }
  return {
    status: "SUCCEEDED",
    code: null,
    summary: `No-session monitoring completed for ${results.length} provider surfaces.`,
  };
}

export const runLlmNoSessionMonitoring: MonitoringLaneRunner = async () => {
  const results = await runNoSessionBatch();
  return resultFromNoSessionBatch(results);
};

export function resultFromDurableHealthCycle(
  summary: SchedulerCycleSummary,
): MonitoringRunResult {
  const failures =
    summary.retryableFailures + summary.terminalFailures + summary.timedOut;
  return {
    status: failures > 0 ? "FAILED" : "SUCCEEDED",
    code: failures > 0 ? "HEALTH_SCHEDULER_EXECUTION_FAILED" : null,
    summary: `Durable Health cycle: materialized=${summary.materialized}, claimed=${summary.claimed}, succeeded=${summary.succeeded}, failed=${failures}, reconciled=${summary.reconciled}.`,
  };
}

export function createLlmMonitoringRunner(
  runScheduledCycle: () => Promise<SchedulerCycleSummary>,
  forcedRunner: MonitoringLaneRunner = runLlmNoSessionMonitoring,
): MonitoringLaneRunner {
  return async (input) =>
    input.source === "FORCED"
      ? forcedRunner(input)
      : resultFromDurableHealthCycle(await runScheduledCycle());
}

export function shouldSendMonitoringNotification(
  notification: MonitoringNotification,
): boolean {
  return !(
    notification.lane === "LLM" &&
    notification.source === "SCHEDULED" &&
    notification.result.code !== "HEALTH_SCHEDULER_EXECUTION_FAILED"
  );
}

export const runSwaggerApiMonitoring: MonitoringLaneRunner = async () => ({
  status: "SOURCE_UNAVAILABLE",
  code: "API_SOURCE_UNAVAILABLE",
  summary:
    "Official API source is unavailable for this bounded monitoring pass.",
});
