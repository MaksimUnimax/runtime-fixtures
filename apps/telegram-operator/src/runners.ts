import {
  runNoSessionBatch,
  type NoSessionObservationResult,
} from "@product/health-runner";
import type {
  MonitoringLaneRunner,
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

export const runSwaggerApiMonitoring: MonitoringLaneRunner = async () => ({
  status: "SOURCE_UNAVAILABLE",
  code: "API_SOURCE_UNAVAILABLE",
  summary:
    "Official API source is unavailable for this bounded monitoring pass.",
});
