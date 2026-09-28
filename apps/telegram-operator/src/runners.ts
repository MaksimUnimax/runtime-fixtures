import type { SchedulerCycleSummary } from "@product/health";
import {
  runNoSessionBatch,
  type NoSessionObservationResult,
} from "@product/health-runner";
import type {
  MonitoringCoverage,
  MonitoringLaneRunner,
  MonitoringNotification,
  MonitoringRunResult,
} from "@product/monitoring-control";

const observedNoSessionOutcomes = new Set([
  "PUBLIC_INTERACTIVE",
  "PUBLIC_LANDING",
  "DRIFT",
  "BROKEN",
  "MAINTENANCE",
]);

export function coverageFromNoSessionBatch(
  results: readonly NoSessionObservationResult[],
): MonitoringCoverage | undefined {
  if (results.length === 0) return undefined;
  const tested = new Set<string>();
  const unverified = new Set<string>();
  let observedAt = results[0]!.observedAt;
  for (const result of results) {
    if (new Date(result.observedAt).valueOf() > new Date(observedAt).valueOf())
      observedAt = result.observedAt;
    if (observedNoSessionOutcomes.has(result.surfaceOutcome))
      tested.add(result.surfaceId);
    else unverified.add(result.surfaceId);
  }
  for (const target of tested) unverified.delete(target);
  return {
    observedAt,
    checkDepth: "PUBLIC_NO_SESSION",
    testedTargets: [...tested].sort(),
    unverifiedTargets: [...unverified].sort(),
    comparisonState: "NOT_APPLICABLE",
    changeSeverity: results.some(
      (result) =>
        result.surfaceOutcome === "DRIFT" || result.surfaceOutcome === "BROKEN",
    )
      ? "REVIEW_REQUIRED"
      : null,
  };
}

export function resultFromNoSessionBatch(
  results: readonly NoSessionObservationResult[],
): MonitoringRunResult {
  const coverage = coverageFromNoSessionBatch(results);
  const drift = results.find(
    (result) =>
      result.surfaceOutcome === "DRIFT" || result.surfaceOutcome === "BROKEN",
  );
  if (drift)
    return {
      status: "FAILED",
      code: "PROVIDER_SURFACE_DRIFT",
      summary: "No-session monitoring observed a provider surface failure.",
      ...(coverage ? { coverage } : {}),
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
      ...(coverage ? { coverage } : {}),
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
      ...(coverage ? { coverage } : {}),
    };
  }
  return {
    status: "SUCCEEDED",
    code: null,
    summary: `No-session monitoring completed for ${results.length} provider surfaces.`,
    ...(coverage ? { coverage } : {}),
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
    coverage: {
      observedAt: null,
      checkDepth: "SCHEDULED_EXECUTION",
      testedTargets: [],
      unverifiedTargets: [],
      comparisonState: "NOT_APPLICABLE",
      changeSeverity: null,
    },
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
