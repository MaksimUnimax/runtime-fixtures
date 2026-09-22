import type {
  MonitoringLaneRunner,
  MonitoringRunResult,
} from "@product/monitoring-control";
import { evaluateOperatorCandidate, runAuthorityPass } from "./authority.js";
import type { ApiWatchDependencies, AuthorityPassResult } from "./types.js";

function resultFromAuthorityPass(
  pass: AuthorityPassResult,
): MonitoringRunResult {
  if (
    pass.outcomes.some(
      (outcome) => outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
    )
  )
    return {
      status: "SUCCEEDED",
      code: "API_SOURCE_CANDIDATE_ACQUIRED",
      summary: `API-watch completed ${pass.outcomes.length} source-family checks.`,
    };
  if (
    pass.outcomes.some((outcome) => outcome.kind === "OPERATOR_SOURCE_REQUIRED")
  )
    return {
      status: "SOURCE_UNAVAILABLE",
      code: "OPERATOR_SOURCE_REQUIRED",
      summary:
        "API-watch created or retained a bounded operator source request.",
    };
  if (
    pass.outcomes.some(
      (outcome) => outcome.kind === "SOURCE_TEMPORARILY_UNAVAILABLE",
    )
  )
    return {
      status: "NOT_OBSERVABLE",
      code: "API_SOURCE_TEMPORARILY_UNAVAILABLE",
      summary: "API-watch encountered a bounded transient source condition.",
    };
  if (
    pass.outcomes.every(
      (outcome) => outcome.kind === "SOURCE_URL_AUTHORITY_MISSING",
    )
  )
    return {
      status: "NOT_OBSERVABLE",
      code: "SOURCE_URL_AUTHORITY_MISSING",
      summary:
        "API-watch has no accepted official URL authority for the monitored families.",
    };
  return {
    status: "FAILED",
    code: "INVALID_OFFICIAL_SOURCE_RESPONSE",
    summary: "API-watch rejected one or more official source responses safely.",
  };
}

export function createApiWatchRunner(
  dependencies: ApiWatchDependencies,
): MonitoringLaneRunner {
  return async () => {
    const pass = await runAuthorityPass(dependencies);
    return resultFromAuthorityPass(pass);
  };
}

export function createApiWatchRuntime(dependencies: ApiWatchDependencies) {
  return {
    runAuthorityPass: () => runAuthorityPass(dependencies),
    evaluateOperatorCandidate: (requestId: string) =>
      evaluateOperatorCandidate({
        requestId,
        registry: dependencies.registry,
        pendingStore: dependencies.pendingStore,
        store: dependencies.store,
        quarantineDir:
          dependencies.quarantineDir ??
          process.env.SWAGGER_QUARANTINE_DIR ??
          "/var/lib/octoport/api-watch/quarantine",
        now: dependencies.clock,
      }),
  };
}
