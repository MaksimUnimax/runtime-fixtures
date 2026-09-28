import { MonitorProfileRepairBindingV1Schema } from "@product/contracts";
import {
  NoSessionObservationResultSchema,
  monitorProfileRepairBindingSha256,
} from "@product/health";
import {
  noSessionRetentionScopeSha256,
  normalizedNoSessionResultSha256,
} from "./health-retention-repository.js";
import type { DatabaseRuntime } from "./index.js";

export type MonitorProfileRepairReadCursor = Readonly<{
  createdAt: Date;
  repairCaseId: string;
  caseRevision: number;
}>;

export type MonitorProfileRepairReadStaleReason =
  | "BINDING_INVALID"
  | "BINDING_HASH_INVALID"
  | "PROFILE_IDENTITY_CHANGED"
  | "OBSERVATION_PROOF_INVALID"
  | "OBSERVATION_BINDING_CHANGED"
  | "CURRENT_OBSERVATION_MISSING"
  | "CURRENT_OBSERVATION_CHANGED"
  | "INCIDENT_SCOPE_CHANGED"
  | "INCIDENT_NOT_ACTIVE"
  | "CANDIDATE_STATE_CHANGED"
  | "BASELINE_OR_ROLLBACK_NOT_PUBLISHED"
  | "SUITE_CHANGED"
  | "H4_CHANGED"
  | "ASSIGNMENT_CHANGED"
  | "APPROVAL_BINDING_CHANGED";

export type MonitorProfileRepairDecisionState =
  | "NONE"
  | "REJECTED"
  | "REVOKED"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "STALE_APPROVED"
  | "CURRENT_APPROVED";

export type MonitorProfileRepairCaseState =
  | "PENDING_APPROVAL"
  | "REJECTED"
  | "APPROVAL_REVOKED"
  | "APPROVAL_NOT_YET_VALID"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_STALE"
  | "APPROVAL_CURRENT"
  | "APPLY_IN_PROGRESS"
  | "APPLIED";

export type MonitorProfileRepairReadItem = Readonly<{
  repairCaseId: string;
  caseRevision: number;
  bindingSha256: string;
  scopeSha256: string;
  createdAt: string;
  caseState: MonitorProfileRepairCaseState;
  staleReasons: readonly MonitorProfileRepairReadStaleReason[];
  executionAuthority: false;
  incident: {
    id: string;
    status: string;
    scopeSha256: string;
    firstSeenRunId: string;
    latestSeenRunId: string;
    lastObservedRunId: string;
    resolvedByRunId: string | null;
    resolvedAt: string | null;
  };
  observation: {
    runId: string;
    normalizedStateSha256: string;
    currentNormalizedStateSha256: string | null;
    currentHealthState: string | null;
    currentRunId: string | null;
  };
  candidate: {
    profileId: string;
    profileRevisionId: string;
    revision: number;
    contentSha256: string;
    state: string;
  };
  acceptedBaselineProfileRevisionId: string;
  rollbackProfileRevisionId: string;
  testedExtension: {
    version: string;
    browserFamily: string;
    browserVersion: string;
    sourceCommitSha: string;
    sourceTreeSha: string;
    packageSha256: string;
  };
  testEvidence: {
    suiteRevisionId: string;
    suiteMachineKey: string;
    suiteRevision: number;
    suiteDefinitionSha256: string;
    h4EvaluationId: string;
    h4EvaluationKey: string;
    h4Status: string | null;
    h4Outcome: string | null;
    installedBehaviorEvidenceSha256: string;
    matrixSha256: string;
    resultsSha256: string;
  };
  assignment: {
    id: string;
    expectedRevision: number;
    initialPercentageBps: number;
    currentRevision: number | null;
    currentRevisionId: string | null;
    currentMode: string | null;
    currentBaselineProfileRevisionId: string | null;
    currentCandidateProfileRevisionId: string | null;
    currentPercentageBps: number | null;
  };
  decision: null | {
    id: string;
    operatorPrincipalId: string;
    decision: "APPROVED" | "REJECTED";
    bindingSha256: string;
    requestSha256: string;
    manualChecklistSha256: string;
    issuedAt: string;
    expiresAt: string;
    revokedAt: string | null;
    state: MonitorProfileRepairDecisionState;
  };
  operation: null | {
    id: string;
    approvalId: string;
    kind: string;
    state: "IN_PROGRESS" | "COMMITTED";
    actorPrincipalId: string;
    admissionTxid: number;
    startedAt: string;
    committedAt: string | null;
    publishedProfileRevisionId: string | null;
    assignmentRevisionId: string | null;
  };
}>;

export type MonitorProfileRepairReadPage = Readonly<{
  items: readonly MonitorProfileRepairReadItem[];
  nextCursor: null | {
    createdAt: string;
    repairCaseId: string;
    caseRevision: number;
  };
}>;

type CaseRow = {
  repairCaseId: string;
  caseRevision: number;
  bindingSha256: string;
  binding: unknown;
  scopeSha256: string;
  createdAt: Date;
  incidentId: string;
  incidentStatus: string;
  incidentScopeSha256: string;
  firstSeenRunId: string;
  latestSeenRunId: string;
  lastObservedRunId: string;
  resolvedByRunId: string | null;
  resolvedAt: Date | null;
  observationRunId: string;
  observationNormalizedStateSha256: string;
  observationRunScopeSha256: string;
  observationRunBrowserFamily: string;
  observationRunProfileRevisionId: string;
  observationRunProfileRevision: number;
  observationPayload: unknown;
  observationReceiptNormalizedStateSha256: string | null;
  acceptedBaselineProfileRevisionId: string;
  baselineProfileState: string;
  candidateProfileRevisionId: string;
  candidateProfileId: string;
  candidateRevision: number;
  candidateContentSha256: string;
  candidateProfileState: string;
  rollbackProfileRevisionId: string;
  rollbackProfileState: string;
  testedExtensionVersion: string;
  testedBrowserFamily: string;
  testedBrowserVersion: string;
  testedSourceCommitSha: string;
  testedSourceTreeSha: string;
  testedPackageSha256: string;
  suiteRevisionId: string;
  suiteMachineKey: string;
  suiteRevision: number;
  suiteDefinitionSha256: string;
  currentSuiteDefinitionSha256: string | null;
  h4EvaluationId: string;
  h4EvaluationKey: string;
  installedBehaviorEvidenceSha256: string;
  matrixSha256: string;
  resultsSha256: string;
  h4CurrentKey: string | null;
  h4Phase: string | null;
  h4Provider: string | null;
  h4Surface: string | null;
  h4Target: string | null;
  h4ProbeLayer: string | null;
  h4Status: string | null;
  h4Outcome: string | null;
  h4BaselineProfileRevisionId: string | null;
  h4CandidateProfileRevisionId: string | null;
  h4SuiteMachineKey: string | null;
  h4SuiteRevision: number | null;
  h4BrowserFamily: string | null;
  h4BrowserVersion: string | null;
  assignmentId: string;
  expectedAssignmentRevision: number;
  initialPercentageBps: number;
  currentAssignmentRevisionId: string | null;
  currentAssignmentRevision: number | null;
  currentAssignmentMode: string | null;
  currentAssignmentBaselineProfileRevisionId: string | null;
  currentAssignmentCandidateProfileRevisionId: string | null;
  currentAssignmentPercentageBps: number | null;
  decisionId: string | null;
  decisionOperatorPrincipalId: string | null;
  decisionValue: "APPROVED" | "REJECTED" | null;
  decisionBindingSha256: string | null;
  decisionRequestSha256: string | null;
  decisionChecklistSha256: string | null;
  decisionIssuedAt: Date | null;
  decisionExpiresAt: Date | null;
  decisionRevokedAt: Date | null;
  operationId: string | null;
  operationApprovalId: string | null;
  operationKind: string | null;
  operationState: "IN_PROGRESS" | "COMMITTED" | null;
  operationActorPrincipalId: string | null;
  operationAdmissionTxid: number | null;
  operationStartedAt: Date | null;
  operationCommittedAt: Date | null;
  operationPublishedProfileRevisionId: string | null;
  operationAssignmentRevisionId: string | null;
};

type ScopeStateRow = {
  scopeSha256: string;
  latestRunId: string;
  latestNormalizedResultSha256: string;
  latestHealthState: string;
};

const CASE_SELECT = `
SELECT
  binding.repair_case_id AS "repairCaseId",
  binding.case_revision AS "caseRevision",
  binding.binding_sha256 AS "bindingSha256",
  binding.binding,
  binding.scope_sha256 AS "scopeSha256",
  binding.created_at AS "createdAt",
  incident.id AS "incidentId",
  incident.status::text AS "incidentStatus",
  incident.scope_sha256 AS "incidentScopeSha256",
  incident.first_seen_run_id AS "firstSeenRunId",
  incident.latest_seen_run_id AS "latestSeenRunId",
  incident.last_observed_run_id AS "lastObservedRunId",
  incident.resolved_by_run_id AS "resolvedByRunId",
  incident.resolved_at AS "resolvedAt",
  binding.observation_run_id AS "observationRunId",
  binding.observation_normalized_state_sha256 AS "observationNormalizedStateSha256",
  observation_run.scope_sha256 AS "observationRunScopeSha256",
  observation_run.browser_family AS "observationRunBrowserFamily",
  observation_run.profile_revision_id AS "observationRunProfileRevisionId",
  observation_run.profile_revision AS "observationRunProfileRevision",
  observation.observation AS "observationPayload",
  receipt.normalized_result_sha256 AS "observationReceiptNormalizedStateSha256",
  binding.accepted_baseline_profile_revision_id AS "acceptedBaselineProfileRevisionId",
  baseline_profile.state::text AS "baselineProfileState",
  binding.candidate_profile_revision_id AS "candidateProfileRevisionId",
  candidate_profile.profile_id AS "candidateProfileId",
  candidate_profile.revision AS "candidateRevision",
  candidate_profile.content_sha256 AS "candidateContentSha256",
  candidate_profile.state::text AS "candidateProfileState",
  binding.rollback_profile_revision_id AS "rollbackProfileRevisionId",
  rollback_profile.state::text AS "rollbackProfileState",
  binding.tested_extension_version AS "testedExtensionVersion",
  binding.tested_browser_family AS "testedBrowserFamily",
  binding.tested_browser_version AS "testedBrowserVersion",
  binding.tested_source_commit_sha AS "testedSourceCommitSha",
  binding.tested_source_tree_sha AS "testedSourceTreeSha",
  binding.tested_package_sha256 AS "testedPackageSha256",
  binding.suite_revision_id AS "suiteRevisionId",
  binding.suite_machine_key AS "suiteMachineKey",
  binding.suite_revision AS "suiteRevision",
  binding.suite_definition_sha256 AS "suiteDefinitionSha256",
  suite.definition_sha256 AS "currentSuiteDefinitionSha256",
  binding.h4_evaluation_id AS "h4EvaluationId",
  binding.h4_evaluation_key AS "h4EvaluationKey",
  binding.installed_behavior_evidence_sha256 AS "installedBehaviorEvidenceSha256",
  binding.matrix_sha256 AS "matrixSha256",
  binding.results_sha256 AS "resultsSha256",
  h4.evaluation_key_sha256 AS "h4CurrentKey",
  h4.phase::text AS "h4Phase",
  h4.provider AS "h4Provider",
  h4.surface AS "h4Surface",
  h4.target AS "h4Target",
  h4.probe_layer::text AS "h4ProbeLayer",
  h4.status::text AS "h4Status",
  h4.outcome::text AS "h4Outcome",
  h4.baseline_profile_revision_id AS "h4BaselineProfileRevisionId",
  h4.candidate_profile_revision_id AS "h4CandidateProfileRevisionId",
  h4.suite_machine_key AS "h4SuiteMachineKey",
  h4.suite_revision AS "h4SuiteRevision",
  h4.browser_family AS "h4BrowserFamily",
  h4.browser_version AS "h4BrowserVersion",
  binding.assignment_id AS "assignmentId",
  binding.expected_assignment_revision AS "expectedAssignmentRevision",
  binding.initial_percentage_bps AS "initialPercentageBps",
  assignment_current.id AS "currentAssignmentRevisionId",
  assignment_current.revision AS "currentAssignmentRevision",
  assignment_current.mode::text AS "currentAssignmentMode",
  assignment_current.baseline_profile_revision_id AS "currentAssignmentBaselineProfileRevisionId",
  assignment_current.candidate_profile_revision_id AS "currentAssignmentCandidateProfileRevisionId",
  assignment_current.percentage_bps AS "currentAssignmentPercentageBps",
  decision.id AS "decisionId",
  decision.operator_principal_id AS "decisionOperatorPrincipalId",
  decision.decision::text AS "decisionValue",
  decision.binding_sha256 AS "decisionBindingSha256",
  decision.request_sha256 AS "decisionRequestSha256",
  decision.manual_checklist_sha256 AS "decisionChecklistSha256",
  decision.issued_at AS "decisionIssuedAt",
  decision.expires_at AS "decisionExpiresAt",
  decision.revoked_at AS "decisionRevokedAt",
  operation.id AS "operationId",
  operation.approval_id AS "operationApprovalId",
  operation.operation_kind AS "operationKind",
  operation.state::text AS "operationState",
  operation.actor_principal_id AS "operationActorPrincipalId",
  operation.admission_txid AS "operationAdmissionTxid",
  operation.started_at AS "operationStartedAt",
  operation.committed_at AS "operationCommittedAt",
  operation.published_profile_revision_id AS "operationPublishedProfileRevisionId",
  operation.assignment_revision_id AS "operationAssignmentRevisionId"
FROM monitor_profile_repair_bindings binding
JOIN health_incidents incident ON incident.id=binding.incident_id
JOIN health_runs observation_run ON observation_run.id=binding.observation_run_id
JOIN health_no_session_observations observation ON observation.run_id=binding.observation_run_id
LEFT JOIN health_no_session_run_receipts receipt ON receipt.run_id=binding.observation_run_id
JOIN adapter_profile_revisions baseline_profile
  ON baseline_profile.id=binding.accepted_baseline_profile_revision_id
JOIN adapter_profile_revisions candidate_profile
  ON candidate_profile.id=binding.candidate_profile_revision_id
JOIN adapter_profile_revisions rollback_profile
  ON rollback_profile.id=binding.rollback_profile_revision_id
LEFT JOIN health_suite_revisions suite ON suite.id=binding.suite_revision_id
LEFT JOIN health_profile_evaluations h4 ON h4.id=binding.h4_evaluation_id
LEFT JOIN LATERAL (
  SELECT revision_row.id,revision_row.revision,revision_row.mode,
    revision_row.baseline_profile_revision_id,revision_row.candidate_profile_revision_id,
    revision_row.percentage_bps
  FROM adapter_profile_assignment_revisions revision_row
  WHERE revision_row.assignment_id=binding.assignment_id
  ORDER BY revision_row.revision DESC
  LIMIT 1
) assignment_current ON true
LEFT JOIN LATERAL (
  SELECT operation_row.id,operation_row.approval_id,operation_row.operation_kind,
    operation_row.state,operation_row.actor_principal_id,operation_row.admission_txid,
    operation_row.started_at,
    operation_row.committed_at,operation_row.published_profile_revision_id,
    operation_row.assignment_revision_id
  FROM monitor_profile_repair_operations operation_row
  WHERE operation_row.repair_case_id=binding.repair_case_id
    AND operation_row.case_revision=binding.case_revision
  ORDER BY operation_row.started_at DESC,operation_row.id DESC
  LIMIT 1
) operation ON true
LEFT JOIN LATERAL (
  SELECT decision_row.id,decision_row.operator_principal_id,decision_row.decision,
    decision_row.binding_sha256,decision_row.request_sha256,
    decision_row.manual_checklist_sha256,decision_row.issued_at,
    decision_row.expires_at,decision_row.revoked_at
  FROM monitor_profile_repair_decisions decision_row
  WHERE decision_row.repair_case_id=binding.repair_case_id
    AND decision_row.case_revision=binding.case_revision
  ORDER BY
    CASE WHEN decision_row.id=operation.approval_id THEN 0 ELSE 1 END,
    decision_row.issued_at DESC,decision_row.id DESC
  LIMIT 1
) decision ON true
`;

function assertScopeSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value))
    throw new Error("MONITOR_PROFILE_REPAIR_READ_SCOPE_INVALID");
}

function assertUuid(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("MONITOR_PROFILE_REPAIR_READ_ID_INVALID");
}

function assertCursor(
  cursor: MonitorProfileRepairReadCursor | undefined,
): void {
  if (!cursor) return;
  if (
    !(cursor.createdAt instanceof Date) ||
    !Number.isFinite(cursor.createdAt.getTime()) ||
    !Number.isInteger(cursor.caseRevision) ||
    cursor.caseRevision < 1
  )
    throw new Error("MONITOR_PROFILE_REPAIR_READ_CURSOR_INVALID");
  assertUuid(cursor.repairCaseId);
}

function decisionState(
  row: CaseRow,
  now: Date,
  stale: readonly MonitorProfileRepairReadStaleReason[],
): MonitorProfileRepairDecisionState {
  if (!row.decisionId || !row.decisionValue) return "NONE";
  if (row.decisionValue === "REJECTED") return "REJECTED";
  if (row.decisionRevokedAt) return "REVOKED";
  if (row.decisionIssuedAt && now < row.decisionIssuedAt)
    return "NOT_YET_VALID";
  if (row.decisionExpiresAt && now >= row.decisionExpiresAt) return "EXPIRED";
  if (stale.length > 0 || row.decisionBindingSha256 !== row.bindingSha256)
    return "STALE_APPROVED";
  return "CURRENT_APPROVED";
}

function caseState(
  row: CaseRow,
  currentDecisionState: MonitorProfileRepairDecisionState,
): MonitorProfileRepairCaseState {
  if (row.operationState === "COMMITTED") return "APPLIED";
  if (row.operationState === "IN_PROGRESS") return "APPLY_IN_PROGRESS";
  switch (currentDecisionState) {
    case "NONE":
      return "PENDING_APPROVAL";
    case "REJECTED":
      return "REJECTED";
    case "REVOKED":
      return "APPROVAL_REVOKED";
    case "NOT_YET_VALID":
      return "APPROVAL_NOT_YET_VALID";
    case "EXPIRED":
      return "APPROVAL_EXPIRED";
    case "STALE_APPROVED":
      return "APPROVAL_STALE";
    case "CURRENT_APPROVED":
      return "APPROVAL_CURRENT";
  }
}

function staleReasonsFor(
  row: CaseRow,
  currentState: ScopeStateRow | undefined,
): MonitorProfileRepairReadStaleReason[] {
  const stale = new Set<MonitorProfileRepairReadStaleReason>();
  const binding = MonitorProfileRepairBindingV1Schema.safeParse(row.binding);
  if (!binding.success) {
    stale.add("BINDING_INVALID");
  } else {
    if (monitorProfileRepairBindingSha256(binding.data) !== row.bindingSha256)
      stale.add("BINDING_HASH_INVALID");
    if (
      binding.data.candidate.profileId !== row.candidateProfileId ||
      binding.data.candidate.profileRevisionId !==
        row.candidateProfileRevisionId ||
      binding.data.candidate.revision !== row.candidateRevision ||
      binding.data.candidate.contentSha256 !== row.candidateContentSha256 ||
      binding.data.acceptedBaseline.profile.profileRevisionId !==
        row.acceptedBaselineProfileRevisionId ||
      binding.data.rollback.profile.profileRevisionId !==
        row.rollbackProfileRevisionId
    ) {
      stale.add("PROFILE_IDENTITY_CHANGED");
    }
  }

  const parsedObservation = NoSessionObservationResultSchema.safeParse(
    row.observationPayload,
  );
  if (!parsedObservation.success) {
    stale.add("OBSERVATION_PROOF_INVALID");
  } else {
    const pinnedFingerprint =
      row.observationReceiptNormalizedStateSha256 ??
      normalizedNoSessionResultSha256(parsedObservation.data);
    if (
      row.observationRunScopeSha256 !== row.scopeSha256 ||
      pinnedFingerprint !== row.observationNormalizedStateSha256
    ) {
      stale.add("OBSERVATION_BINDING_CHANGED");
    }
    if (!currentState) {
      stale.add("CURRENT_OBSERVATION_MISSING");
    } else if (
      currentState.latestHealthState === "UNKNOWN" ||
      currentState.latestNormalizedResultSha256 !==
        row.observationNormalizedStateSha256
    ) {
      stale.add("CURRENT_OBSERVATION_CHANGED");
    }

    if (
      row.h4CurrentKey !== row.h4EvaluationKey ||
      row.h4Phase !== "H4_CANDIDATE" ||
      row.h4Provider !== parsedObservation.data.providerId ||
      row.h4Surface !== parsedObservation.data.surfaceId ||
      row.h4Target !== parsedObservation.data.targetKey ||
      row.h4ProbeLayer !== "NO_SESSION" ||
      row.h4Status !== "COMPLETED" ||
      row.h4Outcome !== "PASS" ||
      row.h4BaselineProfileRevisionId !==
        row.acceptedBaselineProfileRevisionId ||
      row.h4CandidateProfileRevisionId !== row.candidateProfileRevisionId ||
      row.h4SuiteMachineKey !== row.suiteMachineKey ||
      row.h4SuiteRevision !== row.suiteRevision ||
      row.h4BrowserFamily !== row.testedBrowserFamily ||
      row.h4BrowserVersion !== row.testedBrowserVersion
    ) {
      stale.add("H4_CHANGED");
    }
  }

  if (row.incidentScopeSha256 !== row.scopeSha256)
    stale.add("INCIDENT_SCOPE_CHANGED");
  if (
    row.incidentStatus === "RESOLVED" ||
    row.incidentStatus === "FALSE_POSITIVE"
  )
    stale.add("INCIDENT_NOT_ACTIVE");

  const expectedCandidateState =
    row.operationState === "COMMITTED" ? "PUBLISHED" : "CANDIDATE";
  if (row.candidateProfileState !== expectedCandidateState)
    stale.add("CANDIDATE_STATE_CHANGED");
  if (
    row.baselineProfileState !== "PUBLISHED" ||
    row.rollbackProfileState !== "PUBLISHED"
  )
    stale.add("BASELINE_OR_ROLLBACK_NOT_PUBLISHED");
  if (row.currentSuiteDefinitionSha256 !== row.suiteDefinitionSha256)
    stale.add("SUITE_CHANGED");

  if (row.operationState === "COMMITTED") {
    if (
      !row.operationAssignmentRevisionId ||
      row.currentAssignmentRevisionId !== row.operationAssignmentRevisionId
    )
      stale.add("ASSIGNMENT_CHANGED");
  } else if (
    row.currentAssignmentRevision !== row.expectedAssignmentRevision ||
    row.currentAssignmentMode !== "DIRECT" ||
    row.currentAssignmentBaselineProfileRevisionId !==
      row.acceptedBaselineProfileRevisionId ||
    row.currentAssignmentCandidateProfileRevisionId !== null ||
    row.currentAssignmentPercentageBps !== 0
  ) {
    stale.add("ASSIGNMENT_CHANGED");
  }

  if (
    row.decisionId &&
    row.decisionBindingSha256 !== null &&
    row.decisionBindingSha256 !== row.bindingSha256
  )
    stale.add("APPROVAL_BINDING_CHANGED");

  return [...stale].sort();
}

function retentionScopeFor(row: CaseRow): string | null {
  const observation = NoSessionObservationResultSchema.safeParse(
    row.observationPayload,
  );
  if (!observation.success) return null;
  return noSessionRetentionScopeSha256(
    {
      browserFamily: row.observationRunBrowserFamily,
      profileRevisionId: row.observationRunProfileRevisionId,
      profileRevision: row.observationRunProfileRevision,
    },
    observation.data,
  );
}

async function currentStatesFor(
  runtime: DatabaseRuntime,
  rows: readonly CaseRow[],
): Promise<Map<string, ScopeStateRow>> {
  const scopes = [
    ...new Set(
      rows
        .map((row) => retentionScopeFor(row))
        .filter((value): value is string => value !== null),
    ),
  ];
  if (scopes.length === 0) return new Map();
  const result = await runtime.query<ScopeStateRow>(
    `SELECT scope_sha256 AS "scopeSha256",latest_run_id AS "latestRunId",
      latest_normalized_result_sha256 AS "latestNormalizedResultSha256",
      latest_health_state AS "latestHealthState"
     FROM health_no_session_scope_states
     WHERE scope_sha256=ANY($1::text[])`,
    [scopes],
  );
  return new Map(result.rows.map((row) => [row.scopeSha256, row]));
}

function mapRow(
  row: CaseRow,
  currentState: ScopeStateRow | undefined,
  now: Date,
): MonitorProfileRepairReadItem {
  const staleReasons = staleReasonsFor(row, currentState);
  const currentDecisionState = decisionState(row, now, staleReasons);
  const currentCaseState = caseState(row, currentDecisionState);

  return {
    repairCaseId: row.repairCaseId,
    caseRevision: row.caseRevision,
    bindingSha256: row.bindingSha256,
    scopeSha256: row.scopeSha256,
    createdAt: row.createdAt.toISOString(),
    caseState: currentCaseState,
    staleReasons,
    executionAuthority: false,
    incident: {
      id: row.incidentId,
      status: row.incidentStatus,
      scopeSha256: row.incidentScopeSha256,
      firstSeenRunId: row.firstSeenRunId,
      latestSeenRunId: row.latestSeenRunId,
      lastObservedRunId: row.lastObservedRunId,
      resolvedByRunId: row.resolvedByRunId,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    },
    observation: {
      runId: row.observationRunId,
      normalizedStateSha256: row.observationNormalizedStateSha256,
      currentNormalizedStateSha256:
        currentState?.latestNormalizedResultSha256 ?? null,
      currentHealthState: currentState?.latestHealthState ?? null,
      currentRunId: currentState?.latestRunId ?? null,
    },
    candidate: {
      profileId: row.candidateProfileId,
      profileRevisionId: row.candidateProfileRevisionId,
      revision: row.candidateRevision,
      contentSha256: row.candidateContentSha256,
      state: row.candidateProfileState,
    },
    acceptedBaselineProfileRevisionId: row.acceptedBaselineProfileRevisionId,
    rollbackProfileRevisionId: row.rollbackProfileRevisionId,
    testedExtension: {
      version: row.testedExtensionVersion,
      browserFamily: row.testedBrowserFamily,
      browserVersion: row.testedBrowserVersion,
      sourceCommitSha: row.testedSourceCommitSha,
      sourceTreeSha: row.testedSourceTreeSha,
      packageSha256: row.testedPackageSha256,
    },
    testEvidence: {
      suiteRevisionId: row.suiteRevisionId,
      suiteMachineKey: row.suiteMachineKey,
      suiteRevision: row.suiteRevision,
      suiteDefinitionSha256: row.suiteDefinitionSha256,
      h4EvaluationId: row.h4EvaluationId,
      h4EvaluationKey: row.h4EvaluationKey,
      h4Status: row.h4Status,
      h4Outcome: row.h4Outcome,
      installedBehaviorEvidenceSha256: row.installedBehaviorEvidenceSha256,
      matrixSha256: row.matrixSha256,
      resultsSha256: row.resultsSha256,
    },
    assignment: {
      id: row.assignmentId,
      expectedRevision: row.expectedAssignmentRevision,
      initialPercentageBps: row.initialPercentageBps,
      currentRevision: row.currentAssignmentRevision,
      currentRevisionId: row.currentAssignmentRevisionId,
      currentMode: row.currentAssignmentMode,
      currentBaselineProfileRevisionId:
        row.currentAssignmentBaselineProfileRevisionId,
      currentCandidateProfileRevisionId:
        row.currentAssignmentCandidateProfileRevisionId,
      currentPercentageBps: row.currentAssignmentPercentageBps,
    },
    decision:
      row.decisionId &&
      row.decisionOperatorPrincipalId &&
      row.decisionValue &&
      row.decisionBindingSha256 &&
      row.decisionRequestSha256 &&
      row.decisionChecklistSha256 &&
      row.decisionIssuedAt &&
      row.decisionExpiresAt
        ? {
            id: row.decisionId,
            operatorPrincipalId: row.decisionOperatorPrincipalId,
            decision: row.decisionValue,
            bindingSha256: row.decisionBindingSha256,
            requestSha256: row.decisionRequestSha256,
            manualChecklistSha256: row.decisionChecklistSha256,
            issuedAt: row.decisionIssuedAt.toISOString(),
            expiresAt: row.decisionExpiresAt.toISOString(),
            revokedAt: row.decisionRevokedAt?.toISOString() ?? null,
            state: currentDecisionState,
          }
        : null,
    operation:
      row.operationId &&
      row.operationApprovalId &&
      row.operationKind &&
      row.operationState &&
      row.operationActorPrincipalId &&
      row.operationAdmissionTxid !== null &&
      row.operationStartedAt
        ? {
            id: row.operationId,
            approvalId: row.operationApprovalId,
            kind: row.operationKind,
            state: row.operationState,
            actorPrincipalId: row.operationActorPrincipalId,
            admissionTxid: row.operationAdmissionTxid,
            startedAt: row.operationStartedAt.toISOString(),
            committedAt: row.operationCommittedAt?.toISOString() ?? null,
            publishedProfileRevisionId: row.operationPublishedProfileRevisionId,
            assignmentRevisionId: row.operationAssignmentRevisionId,
          }
        : null,
  };
}

function assertClock(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("MONITOR_PROFILE_REPAIR_READ_CLOCK_INVALID");
}

async function hydrateRows(
  runtime: DatabaseRuntime,
  rows: readonly CaseRow[],
  now: Date,
): Promise<MonitorProfileRepairReadItem[]> {
  const states = await currentStatesFor(runtime, rows);
  return rows.map((row) => {
    const retentionScope = retentionScopeFor(row);
    return mapRow(
      row,
      retentionScope ? states.get(retentionScope) : undefined,
      now,
    );
  });
}

export function createMonitorProfileRepairReadRepository(
  runtime: DatabaseRuntime,
  options: { clock?: () => Date } = {},
) {
  const clock = options.clock ?? (() => new Date());

  return {
    async listCases(input: {
      scopeSha256: string;
      limit?: number;
      cursor?: MonitorProfileRepairReadCursor;
    }): Promise<MonitorProfileRepairReadPage> {
      assertScopeSha256(input.scopeSha256);
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("MONITOR_PROFILE_REPAIR_READ_LIMIT_INVALID");
      assertCursor(input.cursor);

      const result = await runtime.query<CaseRow>(
        `${CASE_SELECT}
         WHERE binding.scope_sha256=$1
           AND (
             $2::timestamptz IS NULL
             OR (binding.created_at,binding.repair_case_id,binding.case_revision)
                < ($2::timestamptz,$3::uuid,$4::integer)
           )
         ORDER BY binding.created_at DESC,binding.repair_case_id DESC,
           binding.case_revision DESC
         LIMIT $5`,
        [
          input.scopeSha256,
          input.cursor?.createdAt ?? null,
          input.cursor?.repairCaseId ?? null,
          input.cursor?.caseRevision ?? null,
          limit + 1,
        ],
      );
      const pageRows = result.rows.slice(0, limit);
      const now = clock();
      assertClock(now);
      const items = await hydrateRows(runtime, pageRows, now);
      const last = pageRows.at(-1);
      return {
        items,
        nextCursor:
          result.rows.length > limit && last
            ? {
                createdAt: last.createdAt.toISOString(),
                repairCaseId: last.repairCaseId,
                caseRevision: last.caseRevision,
              }
            : null,
      };
    },

    async getCase(input: {
      scopeSha256: string;
      repairCaseId: string;
      caseRevision: number;
    }): Promise<MonitorProfileRepairReadItem | null> {
      assertScopeSha256(input.scopeSha256);
      assertUuid(input.repairCaseId);
      if (!Number.isInteger(input.caseRevision) || input.caseRevision < 1)
        throw new Error("MONITOR_PROFILE_REPAIR_READ_REVISION_INVALID");

      const result = await runtime.query<CaseRow>(
        `${CASE_SELECT}
         WHERE binding.scope_sha256=$1
           AND binding.repair_case_id=$2
           AND binding.case_revision=$3
         LIMIT 1`,
        [input.scopeSha256, input.repairCaseId, input.caseRevision],
      );
      const row = result.rows[0];
      if (!row) return null;
      const now = clock();
      assertClock(now);
      const [item] = await hydrateRows(runtime, [row], now);
      return item ?? null;
    },
  };
}
