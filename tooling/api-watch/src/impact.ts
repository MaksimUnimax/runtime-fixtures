import type {
  ApiWatchImpact,
  ApiWatchImpactOperation,
  ApiWatchImpactSeverity,
  DiffField,
  SemanticDiff,
  SemanticDiffOperation,
} from "./types.js";

const SEVERITY_RANK: Record<ApiWatchImpactSeverity, number> = {
  NO_POLICY_IMPACT: 0,
  UNKNOWN: 1,
  REVIEW_REQUIRED: 2,
  BLOCKING_RISK: 3,
};

function highest(
  current: ApiWatchImpactSeverity,
  candidate: ApiWatchImpactSeverity,
): ApiWatchImpactSeverity {
  return SEVERITY_RANK[candidate] > SEVERITY_RANK[current]
    ? candidate
    : current;
}

function changedImpact(operation: SemanticDiffOperation): {
  severity: ApiWatchImpactSeverity;
  reasons: string[];
} {
  let severity: ApiWatchImpactSeverity = "NO_POLICY_IMPACT";
  const reasons: string[] = [];
  for (const delta of operation.deltas) {
    const field = delta.field as DiffField | string;
    let fieldSeverity: ApiWatchImpactSeverity;
    let reason: string;
    switch (field) {
      case "securitySchemeReferences":
        fieldSeverity = "BLOCKING_RISK";
        reason = "SECURITY_REFERENCE_CHANGED";
        break;
      case "securityRequirementsSha256":
        fieldSeverity = "BLOCKING_RISK";
        reason = "SECURITY_REQUIREMENTS_CHANGED";
        break;
      case "requestBodyPresent":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "REQUEST_BODY_PRESENCE_CHANGED";
        break;
      case "requestSchemaSha256":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "REQUEST_SCHEMA_CHANGED";
        break;
      case "parameterCount":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "PARAMETER_COUNT_CHANGED";
        break;
      case "parameterSchemaSha256":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "PARAMETER_SCHEMA_CHANGED";
        break;
      case "responseSchemaSha256":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "RESPONSE_SCHEMA_CHANGED";
        break;
      case "responseStatusKeys":
        fieldSeverity = "REVIEW_REQUIRED";
        reason =
          Array.isArray(delta.before) &&
          Array.isArray(delta.after) &&
          delta.before.some(
            (status) => !(delta.after as unknown[]).includes(status),
          )
            ? "RESPONSE_STATUS_REMOVED"
            : "RESPONSE_STATUS_ADDED";
        break;
      case "deprecated":
        fieldSeverity = "REVIEW_REQUIRED";
        reason = "DEPRECATED_FLAG_CHANGED";
        break;
      case "operationId":
      case "tags":
      case "summaryHash":
        fieldSeverity = "NO_POLICY_IMPACT";
        reason = `${field.toUpperCase()}_ONLY_CHANGE`;
        break;
      default:
        fieldSeverity = "UNKNOWN";
        reason = "UNCLASSIFIABLE_A4_DELTA";
        break;
    }
    severity = highest(severity, fieldSeverity);
    reasons.push(reason);
  }
  return { severity, reasons: [...new Set(reasons)].sort() };
}

function classifyOperation(
  operation: SemanticDiffOperation,
): ApiWatchImpactOperation | null {
  if (operation.state === "UNCHANGED") return null;
  let severity: ApiWatchImpactSeverity;
  let reasons: string[];
  if (operation.state === "REMOVED") {
    severity = "BLOCKING_RISK";
    reasons = ["OPERATION_REMOVED"];
  } else if (operation.state === "ADDED") {
    severity = "REVIEW_REQUIRED";
    reasons = ["OPERATION_ADDED"];
  } else {
    ({ severity, reasons } = changedImpact(operation));
  }
  return {
    identity: operation.identity,
    state: operation.state,
    severity,
    readPolicyCandidate:
      severity === "NO_POLICY_IMPACT" ? "NONE" : "REVIEW_REQUIRED",
    reasons,
  };
}

export function classifyApiImpact(diff: SemanticDiff): ApiWatchImpact {
  const operations = diff.operations
    .map(classifyOperation)
    .filter(
      (operation): operation is ApiWatchImpactOperation => operation !== null,
    )
    .sort((a, b) => a.identity.localeCompare(b.identity));
  const counts = {
    blockingRiskCount: operations.filter(
      (operation) => operation.severity === "BLOCKING_RISK",
    ).length,
    reviewRequiredCount: operations.filter(
      (operation) => operation.severity === "REVIEW_REQUIRED",
    ).length,
    unknownCount: operations.filter(
      (operation) => operation.severity === "UNKNOWN",
    ).length,
    noPolicyImpactCount: operations.filter(
      (operation) => operation.severity === "NO_POLICY_IMPACT",
    ).length,
  };
  const overallSeverity = operations.reduce<ApiWatchImpactSeverity>(
    (current, operation) => highest(current, operation.severity),
    "NO_POLICY_IMPACT",
  );
  return { diffId: diff.diffId, operations, ...counts, overallSeverity };
}
