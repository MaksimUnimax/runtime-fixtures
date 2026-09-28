import { createHash, randomUUID } from "node:crypto";
import {
  MAX_PROFILE_REPAIR_APPROVAL_AGE_MS,
  MonitorProfileRepairApprovalV1Schema,
  MonitorProfileRepairBindingV1Schema,
  MonitorProfileRepairDecisionRequestV1Schema,
  type MonitorProfileRepairApprovalV1,
  type MonitorProfileRepairBindingV1,
  type MonitorProfileRepairDecisionRequestV1,
} from "@product/contracts";
import {
  NoSessionObservationResultSchema,
  checkProfileRepairApprovalBinding,
  monitorProfileRepairBindingSha256,
} from "@product/health";
import { canonicalizeJson } from "@product/remote-config";
import { authorizeAdminMutationInTransaction } from "./admin-mutation-authorization.js";
import {
  publishProfileRevisionInTransaction,
  startProfileRolloutInTransaction,
} from "./p7-profile-lifecycle-repository.js";
import {
  noSessionRetentionScopeSha256,
  normalizedNoSessionResultSha256,
} from "./health-retention-repository.js";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

const hashJson = (value: unknown) =>
  createHash("sha256").update(canonicalizeJson(value)).digest("hex");

export type MonitorProfileRepairTrustedEvidence = Readonly<{
  deploymentEnvironment: MonitorProfileRepairBindingV1["deploymentEnvironment"];
  testedExtension: MonitorProfileRepairBindingV1["testedExtension"];
  extensionAccepted: boolean;
  h4EnvironmentClass: string;
  installedBehaviorEvidenceSha256: string;
  installedBehaviorPassed: boolean;
  matrixSha256: string;
  matrixPassed: boolean;
  resultsSha256: string;
  resultsPassed: boolean;
  latestObservationNormalizedStateSha256: string;
  latestObservationFresh: boolean;
  rollbackUsable: boolean;
}>;

export type MonitorProfileRepairEvidenceResolver = (input: {
  binding: MonitorProfileRepairBindingV1;
  phase: "REGISTER" | "APPLY";
}) => Promise<MonitorProfileRepairTrustedEvidence>;

type BindingRow = {
  repairCaseId: string;
  caseRevision: number;
  bindingSha256: string;
  binding: unknown;
  incidentId: string;
  observationRunId: string;
  acceptedBaselineRunId: string;
  acceptedBaselineProfileRevisionId: string;
  candidateProfileRevisionId: string;
  suiteRevisionId: string;
  h4EvaluationId: string;
  assignmentId: string;
  expectedAssignmentRevision: number;
  rollbackRunId: string;
  rollbackProfileRevisionId: string;
};

type ProfileRow = {
  id: string;
  profileId: string;
  revision: number;
  state: "DRAFT" | "CANDIDATE" | "PUBLISHED" | "RETIRED";
  contentSha256: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  compatibility: unknown;
};

type HealthRunRow = {
  id: string;
  runKind: string;
  healthState: string;
  scopeSha256: string;
  profileRevisionId: string;
  profileRevision: number;
  browserFamily: string;
  browserVersion: string;
  completedAt: Date;
};

type IncidentRow = {
  id: string;
  scopeSha256: string;
  status: string;
  firstSeenRunId: string;
  latestSeenRunId: string;
  lastObservedRunId: string;
  resolvedByRunId: string | null;
};

type AssignmentRow = {
  id: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  browserFamily: string;
};

type AssignmentRevisionRow = {
  id: string;
  revision: number;
  mode: string;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
};

type H4Row = {
  id: string;
  evaluationKeySha256: string;
  phase: string;
  provider: string;
  surface: string;
  target: string;
  probeLayer: string;
  status: string;
  outcome: string;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string;
  suiteMachineKey: string;
  suiteRevision: number;
  browserFamily: string;
  browserVersion: string;
  environmentClass: string;
};

type SuiteRow = {
  id: string;
  machineKey: string;
  revision: number;
  definitionSha256: string;
};

type DecisionRow = {
  id: string;
  operatorPrincipalId: string;
  idempotencyKey: string;
  repairCaseId: string;
  caseRevision: number;
  bindingSha256: string;
  requestSha256: string;
  decision: "APPROVED" | "REJECTED";
  manualChecklistSha256: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

type OperationRow = {
  id: string;
  approvalId: string;
  repairCaseId: string;
  caseRevision: number;
  state: "IN_PROGRESS" | "COMMITTED";
  actorPrincipalId: string;
  result: unknown | null;
};
function approvalFromRow(row: DecisionRow): MonitorProfileRepairApprovalV1 {
  return MonitorProfileRepairApprovalV1Schema.parse({
    schemaVersion: "monitor_profile_repair_approval_v1",
    idempotencyKey: row.idempotencyKey,
    id: row.id,
    repairCaseId: row.repairCaseId,
    caseRevision: row.caseRevision,
    bindingSha256: row.bindingSha256,
    decision: row.decision,
    operatorPrincipalId: row.operatorPrincipalId,
    manualChecklistSha256: row.manualChecklistSha256,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}

async function loadBinding(
  q: DatabaseQuery,
  repairCaseId: string,
  caseRevision: number,
  lock: boolean,
): Promise<BindingRow> {
  const result = await q.query<BindingRow>(
    `SELECT repair_case_id AS "repairCaseId",case_revision AS "caseRevision",
      binding_sha256 AS "bindingSha256",binding,incident_id AS "incidentId",
      observation_run_id AS "observationRunId",
      accepted_baseline_run_id AS "acceptedBaselineRunId",
      accepted_baseline_profile_revision_id AS "acceptedBaselineProfileRevisionId",
      candidate_profile_revision_id AS "candidateProfileRevisionId",
      suite_revision_id AS "suiteRevisionId",h4_evaluation_id AS "h4EvaluationId",
      assignment_id AS "assignmentId",
      expected_assignment_revision AS "expectedAssignmentRevision",
      rollback_run_id AS "rollbackRunId",
      rollback_profile_revision_id AS "rollbackProfileRevisionId"
     FROM monitor_profile_repair_bindings
     WHERE repair_case_id=$1 AND case_revision=$2${lock ? " FOR UPDATE" : ""}`,
    [repairCaseId, caseRevision],
  );
  const row = result.rows[0];
  if (!row) throw new Error("MONITOR_PROFILE_REPAIR_BINDING_NOT_FOUND");
  return row;
}

async function loadProfiles(
  q: DatabaseQuery,
  ids: readonly string[],
  lock: boolean,
): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids)].sort();
  const result = await q.query<ProfileRow>(
    `SELECT id,profile_id AS "profileId",revision,state,
      content_sha256 AS "contentSha256",adapter_id AS "adapterId",
      surface_id AS "surfaceId",variant_id AS "variantId",
      compatibility_constraints AS compatibility
     FROM adapter_profile_revisions
     WHERE id=ANY($1::uuid[])
     ORDER BY id${lock ? " FOR UPDATE" : ""}`,
    [unique],
  );
  if (result.rows.length !== unique.length)
    throw new Error("MONITOR_PROFILE_REPAIR_PROFILE_AUTHORITY_MISSING");
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function loadRuns(
  q: DatabaseQuery,
  ids: readonly string[],
): Promise<Map<string, HealthRunRow>> {
  const unique = [...new Set(ids)].sort();
  const result = await q.query<HealthRunRow>(
    `SELECT id,run_kind AS "runKind",health_state AS "healthState",
      scope_sha256 AS "scopeSha256",profile_revision_id AS "profileRevisionId",
      profile_revision AS "profileRevision",browser_family AS "browserFamily",
      browser_version AS "browserVersion",
      completed_at AS "completedAt"
     FROM health_runs WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,
    [unique],
  );
  if (result.rows.length !== unique.length)
    throw new Error("MONITOR_PROFILE_REPAIR_RUN_AUTHORITY_MISSING");
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function loadLatestAssignment(
  q: DatabaseQuery,
  assignmentId: string,
): Promise<{ assignment: AssignmentRow; latest: AssignmentRevisionRow }> {
  const assignment = await q.query<AssignmentRow>(
    `SELECT id,adapter_id AS "adapterId",surface_id AS "surfaceId",
      variant_id AS "variantId",browser_family AS "browserFamily"
     FROM adapter_profile_assignments WHERE id=$1 FOR UPDATE`,
    [assignmentId],
  );
  if (!assignment.rows[0])
    throw new Error("MONITOR_PROFILE_REPAIR_ASSIGNMENT_NOT_FOUND");
  const latest = await q.query<AssignmentRevisionRow>(
    `SELECT id,revision,mode,
      baseline_profile_revision_id AS "baselineProfileRevisionId",
      candidate_profile_revision_id AS "candidateProfileRevisionId",
      percentage_bps AS "percentageBps"
     FROM adapter_profile_assignment_revisions
     WHERE assignment_id=$1 ORDER BY revision DESC LIMIT 1`,
    [assignmentId],
  );
  if (!latest.rows[0])
    throw new Error("MONITOR_PROFILE_REPAIR_ASSIGNMENT_REVISION_NOT_FOUND");
  return { assignment: assignment.rows[0], latest: latest.rows[0] };
}
async function rebuildAndValidateBinding(
  q: DatabaseQuery,
  binding: MonitorProfileRepairBindingV1,
  evidence: MonitorProfileRepairTrustedEvidence,
  options: {
    candidateState: "CANDIDATE" | "PUBLISHED";
    phase: "REGISTER" | "APPLY";
  },
): Promise<{
  currentBinding: MonitorProfileRepairBindingV1;
  suiteRevisionId: string;
  h4EvaluationId: string;
}> {
  if (
    !evidence.extensionAccepted ||
    !evidence.installedBehaviorPassed ||
    !evidence.matrixPassed ||
    !evidence.resultsPassed ||
    !evidence.latestObservationFresh ||
    !evidence.rollbackUsable
  ) {
    throw new Error("MONITOR_PROFILE_REPAIR_TRUSTED_EVIDENCE_NOT_CURRENT");
  }

  const profileRows = await loadProfiles(
    q,
    [
      binding.acceptedBaseline.profile.profileRevisionId,
      binding.candidate.profileRevisionId,
      binding.rollback.profile.profileRevisionId,
    ],
    true,
  );
  const baselineProfile = profileRows.get(
    binding.acceptedBaseline.profile.profileRevisionId,
  )!;
  const candidateProfile = profileRows.get(
    binding.candidate.profileRevisionId,
  )!;
  const rollbackProfile = profileRows.get(
    binding.rollback.profile.profileRevisionId,
  )!;

  for (const [name, expected, actual] of [
    ["baseline", binding.acceptedBaseline.profile, baselineProfile],
    ["candidate", binding.candidate, candidateProfile],
    ["rollback", binding.rollback.profile, rollbackProfile],
  ] as const) {
    if (
      actual.profileId !== expected.profileId ||
      actual.revision !== expected.revision ||
      actual.contentSha256 !== expected.contentSha256
    ) {
      throw new Error(
        `MONITOR_PROFILE_REPAIR_${name.toUpperCase()}_PROFILE_CHANGED`,
      );
    }
  }
  if (candidateProfile.state !== options.candidateState)
    throw new Error("MONITOR_PROFILE_REPAIR_CANDIDATE_STATE_CHANGED");
  if (
    baselineProfile.state !== "PUBLISHED" ||
    rollbackProfile.state !== "PUBLISHED"
  )
    throw new Error(
      "MONITOR_PROFILE_REPAIR_BASELINE_OR_ROLLBACK_NOT_PUBLISHED",
    );
  if (
    candidateProfile.profileId !== baselineProfile.profileId ||
    candidateProfile.profileId !== rollbackProfile.profileId
  )
    throw new Error("MONITOR_PROFILE_REPAIR_PROFILE_IDENTITY_MISMATCH");

  const runs = await loadRuns(q, [
    binding.observation.runId,
    binding.acceptedBaseline.acceptedRunId,
    binding.rollback.acceptedRunId,
  ]);
  const observationRun = runs.get(binding.observation.runId)!;
  const baselineRun = runs.get(binding.acceptedBaseline.acceptedRunId)!;
  const rollbackRun = runs.get(binding.rollback.acceptedRunId)!;
  if (observationRun.runKind !== "NO_SESSION_OBSERVATION")
    throw new Error("MONITOR_PROFILE_REPAIR_OBSERVATION_KIND_UNSUPPORTED");
  if (observationRun.scopeSha256 !== binding.scopeSha256)
    throw new Error("MONITOR_PROFILE_REPAIR_SCOPE_CHANGED");
  if (
    baselineRun.healthState !== "HEALTHY" ||
    baselineRun.profileRevisionId !== baselineProfile.id
  )
    throw new Error("MONITOR_PROFILE_REPAIR_BASELINE_NOT_HEALTHY");
  if (
    rollbackRun.healthState !== "HEALTHY" ||
    rollbackRun.profileRevisionId !== rollbackProfile.id
  )
    throw new Error("MONITOR_PROFILE_REPAIR_ROLLBACK_NOT_HEALTHY");

  const observation = await q.query<{
    observation: unknown;
    normalizedResultSha256: string | null;
  }>(
    `SELECT o.observation,
      receipt.normalized_result_sha256 AS "normalizedResultSha256"
     FROM health_no_session_observations o
     JOIN health_no_session_run_receipts receipt ON receipt.run_id=o.run_id
     WHERE o.run_id=$1 FOR SHARE OF o,receipt`,
    [observationRun.id],
  );
  const observationRow = observation.rows[0];
  if (!observationRow)
    throw new Error("MONITOR_PROFILE_REPAIR_OBSERVATION_PROOF_MISSING");
  const parsedObservation = NoSessionObservationResultSchema.parse(
    observationRow.observation,
  );
  const pinnedFingerprint =
    observationRow.normalizedResultSha256 ??
    normalizedNoSessionResultSha256(parsedObservation);
  if (pinnedFingerprint !== binding.observation.normalizedStateSha256)
    throw new Error("MONITOR_PROFILE_REPAIR_OBSERVATION_BINDING_CHANGED");
  const retentionScope = noSessionRetentionScopeSha256(
    {
      browserFamily: observationRun.browserFamily,
      profileRevisionId: observationRun.profileRevisionId,
      profileRevision: observationRun.profileRevision,
    },
    parsedObservation,
  );
  const currentState = await q.query<{
    latestNormalizedResultSha256: string;
    latestHealthState: string;
  }>(
    `SELECT latest_normalized_result_sha256 AS "latestNormalizedResultSha256",
      latest_health_state AS "latestHealthState"
     FROM health_no_session_scope_states WHERE scope_sha256=$1 FOR SHARE`,
    [retentionScope],
  );
  const current = currentState.rows[0];
  if (!current)
    throw new Error("MONITOR_PROFILE_REPAIR_CURRENT_OBSERVATION_MISSING");
  if (
    current.latestHealthState === "UNKNOWN" ||
    current.latestNormalizedResultSha256 !==
      binding.observation.normalizedStateSha256 ||
    evidence.latestObservationNormalizedStateSha256 !==
      current.latestNormalizedResultSha256
  ) {
    throw new Error("MONITOR_PROFILE_REPAIR_CURRENT_OBSERVATION_CHANGED");
  }

  const incident = await q.query<IncidentRow>(
    `SELECT id,scope_sha256 AS "scopeSha256",status,
      first_seen_run_id AS "firstSeenRunId",
      latest_seen_run_id AS "latestSeenRunId",
      last_observed_run_id AS "lastObservedRunId",
      resolved_by_run_id AS "resolvedByRunId"
     FROM health_incidents WHERE id=$1 FOR UPDATE`,
    [binding.incidentId],
  );
  const currentIncident = incident.rows[0];
  if (!currentIncident)
    throw new Error("MONITOR_PROFILE_REPAIR_INCIDENT_NOT_FOUND");
  if (
    currentIncident.status === "RESOLVED" ||
    currentIncident.status === "FALSE_POSITIVE"
  )
    throw new Error("MONITOR_PROFILE_REPAIR_INCIDENT_NOT_ACTIVE");
  if (currentIncident.scopeSha256 !== binding.scopeSha256)
    throw new Error("MONITOR_PROFILE_REPAIR_INCIDENT_SCOPE_CHANGED");
  if (
    options.phase === "REGISTER" &&
    ![
      currentIncident.firstSeenRunId,
      currentIncident.latestSeenRunId,
      currentIncident.lastObservedRunId,
      currentIncident.resolvedByRunId,
    ].includes(binding.observation.runId)
  )
    throw new Error("MONITOR_PROFILE_REPAIR_INCIDENT_OBSERVATION_MISMATCH");

  const suite = await q.query<SuiteRow>(
    `SELECT id,machine_key AS "machineKey",revision,
      definition_sha256 AS "definitionSha256"
     FROM health_suite_revisions
     WHERE machine_key=$1 AND revision=$2 FOR SHARE`,
    [binding.suite.machineKey, binding.suite.revision],
  );
  const suiteRow = suite.rows[0];
  if (!suiteRow || suiteRow.definitionSha256 !== binding.suite.definitionSha256)
    throw new Error("MONITOR_PROFILE_REPAIR_SUITE_CHANGED");

  const h4 = await q.query<H4Row>(
    `SELECT id,evaluation_key_sha256 AS "evaluationKeySha256",phase,
      provider,surface,target,probe_layer AS "probeLayer",status,outcome,
      baseline_profile_revision_id AS "baselineProfileRevisionId",
      candidate_profile_revision_id AS "candidateProfileRevisionId",
      suite_machine_key AS "suiteMachineKey",suite_revision AS "suiteRevision",
      browser_family AS "browserFamily",browser_version AS "browserVersion",
      environment_class AS "environmentClass"
     FROM health_profile_evaluations
     WHERE evaluation_key_sha256=$1 FOR SHARE`,
    [binding.validation.h4EvaluationKey],
  );
  const h4Row = h4.rows[0];
  if (
    !h4Row ||
    h4Row.phase !== "H4_CANDIDATE" ||
    h4Row.provider !== parsedObservation.providerId ||
    h4Row.surface !== parsedObservation.surfaceId ||
    h4Row.target !== parsedObservation.targetKey ||
    h4Row.probeLayer !== "NO_SESSION" ||
    h4Row.status !== "COMPLETED" ||
    h4Row.outcome !== "PASS" ||
    h4Row.baselineProfileRevisionId !== baselineProfile.id ||
    h4Row.candidateProfileRevisionId !== candidateProfile.id ||
    h4Row.suiteMachineKey !== binding.suite.machineKey ||
    h4Row.suiteRevision !== binding.suite.revision ||
    h4Row.browserFamily !== binding.testedExtension.browserFamily ||
    h4Row.browserVersion !== binding.testedExtension.browserVersion ||
    h4Row.environmentClass !== evidence.h4EnvironmentClass
  )
    throw new Error("MONITOR_PROFILE_REPAIR_H4_AUTHORITY_CHANGED");

  const { assignment, latest } = await loadLatestAssignment(
    q,
    binding.assignment.id,
  );
  if (
    latest.revision !== binding.assignment.expectedRevision ||
    latest.mode !== "DIRECT" ||
    latest.baselineProfileRevisionId !== baselineProfile.id ||
    latest.candidateProfileRevisionId !== null ||
    latest.percentageBps !== 0 ||
    assignment.browserFamily !== binding.testedExtension.browserFamily ||
    assignment.adapterId !== candidateProfile.adapterId ||
    assignment.surfaceId !== candidateProfile.surfaceId ||
    assignment.variantId !== candidateProfile.variantId
  )
    throw new Error("MONITOR_PROFILE_REPAIR_ASSIGNMENT_CHANGED");

  const currentBinding = MonitorProfileRepairBindingV1Schema.parse({
    schemaVersion: "monitor_profile_repair_binding_v1",
    repairCaseId: binding.repairCaseId,
    caseRevision: binding.caseRevision,
    incidentId: currentIncident.id,
    scopeSha256: observationRun.scopeSha256,
    deploymentEnvironment: evidence.deploymentEnvironment,
    observation: {
      runId: observationRun.id,
      normalizedStateSha256: pinnedFingerprint,
    },
    acceptedBaseline: {
      acceptedRunId: baselineRun.id,
      profile: {
        profileId: baselineProfile.profileId,
        profileRevisionId: baselineProfile.id,
        revision: baselineProfile.revision,
        contentSha256: baselineProfile.contentSha256,
      },
    },
    candidate: {
      profileId: candidateProfile.profileId,
      profileRevisionId: candidateProfile.id,
      revision: candidateProfile.revision,
      contentSha256: candidateProfile.contentSha256,
    },
    testedExtension: evidence.testedExtension,
    suite: {
      machineKey: suiteRow.machineKey,
      revision: suiteRow.revision,
      definitionSha256: suiteRow.definitionSha256,
    },
    validation: {
      h4EvaluationKey: h4Row.evaluationKeySha256,
      installedBehaviorEvidenceSha256: evidence.installedBehaviorEvidenceSha256,
      matrixSha256: evidence.matrixSha256,
      resultsSha256: evidence.resultsSha256,
    },
    assignment: {
      id: assignment.id,
      expectedRevision: latest.revision,
      initialPercentageBps: binding.assignment.initialPercentageBps,
    },
    rollback: {
      acceptedRunId: rollbackRun.id,
      profile: {
        profileId: rollbackProfile.profileId,
        profileRevisionId: rollbackProfile.id,
        revision: rollbackProfile.revision,
        contentSha256: rollbackProfile.contentSha256,
      },
    },
  });

  return {
    currentBinding,
    suiteRevisionId: suiteRow.id,
    h4EvaluationId: h4Row.id,
  };
}
function assertExternalEvidenceMatchesBinding(
  binding: MonitorProfileRepairBindingV1,
  evidence: MonitorProfileRepairTrustedEvidence,
): void {
  if (
    evidence.deploymentEnvironment !== binding.deploymentEnvironment ||
    hashJson(evidence.testedExtension) !== hashJson(binding.testedExtension) ||
    evidence.installedBehaviorEvidenceSha256 !==
      binding.validation.installedBehaviorEvidenceSha256 ||
    evidence.matrixSha256 !== binding.validation.matrixSha256 ||
    evidence.resultsSha256 !== binding.validation.resultsSha256
  ) {
    throw new Error("MONITOR_PROFILE_REPAIR_EXTERNAL_EVIDENCE_CHANGED");
  }
}

async function insertAudit(
  q: DatabaseQuery,
  input: {
    actorPrincipalId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO audit_events(
      actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      input.actorPrincipalId ? "ADMIN" : "SYSTEM",
      input.actorPrincipalId,
      input.action,
      input.targetType,
      input.targetId,
      randomUUID(),
      "monitor profile repair admission",
      JSON.stringify(input.metadata),
    ],
  );
}

export function createMonitorProfileRepairAdmissionRepository(
  runtime: DatabaseRuntime,
  options: {
    evidenceResolver?: MonitorProfileRepairEvidenceResolver;
    clock?: () => Date;
    approvalLifetimeMs?: number;
  } = {},
) {
  const evidenceResolver = options.evidenceResolver;
  const clock = options.clock ?? (() => new Date());
  const approvalLifetimeMs =
    options.approvalLifetimeMs ?? MAX_PROFILE_REPAIR_APPROVAL_AGE_MS;
  if (
    !Number.isInteger(approvalLifetimeMs) ||
    approvalLifetimeMs <= 0 ||
    approvalLifetimeMs > MAX_PROFILE_REPAIR_APPROVAL_AGE_MS
  )
    throw new Error("MONITOR_PROFILE_REPAIR_APPROVAL_LIFETIME_INVALID");

  const trustedEvidence = async (
    binding: MonitorProfileRepairBindingV1,
    phase: "REGISTER" | "APPLY",
  ) => {
    if (!evidenceResolver)
      throw new Error("MONITOR_PROFILE_REPAIR_EVIDENCE_RESOLVER_REQUIRED");
    const evidence = await evidenceResolver({ binding, phase });
    assertExternalEvidenceMatchesBinding(binding, evidence);
    return evidence;
  };

  return {
    async registerCandidate(input: { binding: unknown }): Promise<{
      bindingSha256: string;
      binding: MonitorProfileRepairBindingV1;
    }> {
      const binding = MonitorProfileRepairBindingV1Schema.parse(input.binding);
      const bindingSha256 = monitorProfileRepairBindingSha256(binding);

      return runtime.transaction(async (q) => {
        const existing = await q.query<{
          bindingSha256: string;
          binding: unknown;
        }>(
          `SELECT binding_sha256 AS "bindingSha256",binding
           FROM monitor_profile_repair_bindings
           WHERE repair_case_id=$1 AND case_revision=$2 FOR UPDATE`,
          [binding.repairCaseId, binding.caseRevision],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].bindingSha256 !== bindingSha256)
            throw new Error("MONITOR_PROFILE_REPAIR_REGISTRATION_CONFLICT");
          return {
            bindingSha256,
            binding: MonitorProfileRepairBindingV1Schema.parse(
              existing.rows[0].binding,
            ),
          };
        }

        const evidence = await trustedEvidence(binding, "REGISTER");
        const rebuilt = await rebuildAndValidateBinding(q, binding, evidence, {
          candidateState: "CANDIDATE",
          phase: "REGISTER",
        });
        if (
          monitorProfileRepairBindingSha256(rebuilt.currentBinding) !==
          bindingSha256
        )
          throw new Error("MONITOR_PROFILE_REPAIR_BINDING_NOT_CURRENT");

        await q.query(
          `INSERT INTO monitor_profile_repair_bindings(
            repair_case_id,case_revision,binding_sha256,binding,incident_id,scope_sha256,
            deployment_environment,observation_run_id,observation_normalized_state_sha256,
            accepted_baseline_run_id,accepted_baseline_profile_revision_id,
            candidate_profile_revision_id,tested_extension_version,tested_browser_family,
            tested_browser_version,tested_source_commit_sha,tested_source_tree_sha,
            tested_package_sha256,suite_revision_id,suite_machine_key,suite_revision,
            suite_definition_sha256,h4_evaluation_id,h4_evaluation_key,
            installed_behavior_evidence_sha256,matrix_sha256,results_sha256,assignment_id,
            expected_assignment_revision,initial_percentage_bps,rollback_run_id,
            rollback_profile_revision_id
          ) VALUES(
            $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
            $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32
          )`,
          [
            binding.repairCaseId,
            binding.caseRevision,
            bindingSha256,
            JSON.stringify(binding),
            binding.incidentId,
            binding.scopeSha256,
            binding.deploymentEnvironment,
            binding.observation.runId,
            binding.observation.normalizedStateSha256,
            binding.acceptedBaseline.acceptedRunId,
            binding.acceptedBaseline.profile.profileRevisionId,
            binding.candidate.profileRevisionId,
            binding.testedExtension.version,
            binding.testedExtension.browserFamily,
            binding.testedExtension.browserVersion,
            binding.testedExtension.sourceCommitSha,
            binding.testedExtension.sourceTreeSha,
            binding.testedExtension.packageSha256,
            rebuilt.suiteRevisionId,
            binding.suite.machineKey,
            binding.suite.revision,
            binding.suite.definitionSha256,
            rebuilt.h4EvaluationId,
            binding.validation.h4EvaluationKey,
            binding.validation.installedBehaviorEvidenceSha256,
            binding.validation.matrixSha256,
            binding.validation.resultsSha256,
            binding.assignment.id,
            binding.assignment.expectedRevision,
            binding.assignment.initialPercentageBps,
            binding.rollback.acceptedRunId,
            binding.rollback.profile.profileRevisionId,
          ],
        );
        await insertAudit(q, {
          actorPrincipalId: null,
          action: "MONITOR_PROFILE_REPAIR_REGISTERED",
          targetType: "MONITOR_PROFILE_REPAIR",
          targetId: binding.repairCaseId,
          metadata: { caseRevision: binding.caseRevision, bindingSha256 },
        });
        return { bindingSha256, binding };
      });
    },
    async recordDecision(input: {
      request: unknown;
      operatorPrincipalId: string;
    }): Promise<MonitorProfileRepairApprovalV1> {
      const request = MonitorProfileRepairDecisionRequestV1Schema.parse(
        input.request,
      ) as MonitorProfileRepairDecisionRequestV1;
      const requestSha256 = hashJson(request);

      return runtime.transaction(async (q) => {
        const existing = await q.query<DecisionRow>(
          `SELECT id,operator_principal_id AS "operatorPrincipalId",
            idempotency_key AS "idempotencyKey",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",binding_sha256 AS "bindingSha256",
            request_sha256 AS "requestSha256",decision,
            manual_checklist_sha256 AS "manualChecklistSha256",
            issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"
           FROM monitor_profile_repair_decisions
           WHERE operator_principal_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [input.operatorPrincipalId, request.idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].requestSha256 !== requestSha256)
            throw new Error(
              "MONITOR_PROFILE_REPAIR_DECISION_IDEMPOTENCY_CONFLICT",
            );
          return approvalFromRow(existing.rows[0]);
        }

        const binding = await loadBinding(
          q,
          request.repairCaseId,
          request.expectedCaseRevision,
          true,
        );
        if (binding.bindingSha256 !== request.expectedBindingSha256)
          throw new Error("MONITOR_PROFILE_REPAIR_DECISION_BINDING_CHANGED");

        await authorizeAdminMutationInTransaction(
          q,
          input.operatorPrincipalId,
          "ai.profile.manage",
        );
        await authorizeAdminMutationInTransaction(
          q,
          input.operatorPrincipalId,
          "ai.assignment.manage",
        );

        const issuedAt = clock();
        if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime()))
          throw new Error("MONITOR_PROFILE_REPAIR_CLOCK_INVALID");
        const expiresAt = new Date(issuedAt.getTime() + approvalLifetimeMs);
        const id = randomUUID();
        const result = await q.query<DecisionRow>(
          `INSERT INTO monitor_profile_repair_decisions(
            id,operator_principal_id,idempotency_key,repair_case_id,case_revision,
            binding_sha256,request_sha256,request,decision,manual_checklist_sha256,
            issued_at,expires_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
          RETURNING id,operator_principal_id AS "operatorPrincipalId",
            idempotency_key AS "idempotencyKey",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",binding_sha256 AS "bindingSha256",
            request_sha256 AS "requestSha256",decision,
            manual_checklist_sha256 AS "manualChecklistSha256",
            issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"`,
          [
            id,
            input.operatorPrincipalId,
            request.idempotencyKey,
            request.repairCaseId,
            request.expectedCaseRevision,
            request.expectedBindingSha256,
            requestSha256,
            JSON.stringify(request),
            request.decision,
            request.manualCheck.checklistSha256,
            issuedAt,
            expiresAt,
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new Error("MONITOR_PROFILE_REPAIR_DECISION_INSERT_FAILED");
        await insertAudit(q, {
          actorPrincipalId: input.operatorPrincipalId,
          action: "MONITOR_PROFILE_REPAIR_DECIDED",
          targetType: "MONITOR_PROFILE_REPAIR",
          targetId: request.repairCaseId,
          metadata: {
            caseRevision: request.expectedCaseRevision,
            approvalId: row.id,
            decision: row.decision,
            bindingSha256: row.bindingSha256,
          },
        });
        return approvalFromRow(row);
      });
    },

    async revokeDecision(input: {
      approvalId: string;
      actorPrincipalId: string;
    }): Promise<MonitorProfileRepairApprovalV1> {
      return runtime.transaction(async (q) => {
        await authorizeAdminMutationInTransaction(
          q,
          input.actorPrincipalId,
          "ai.profile.manage",
        );
        await authorizeAdminMutationInTransaction(
          q,
          input.actorPrincipalId,
          "ai.assignment.manage",
        );
        const existing = await q.query<DecisionRow>(
          `SELECT id,operator_principal_id AS "operatorPrincipalId",
            idempotency_key AS "idempotencyKey",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",binding_sha256 AS "bindingSha256",
            request_sha256 AS "requestSha256",decision,
            manual_checklist_sha256 AS "manualChecklistSha256",
            issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"
           FROM monitor_profile_repair_decisions WHERE id=$1 FOR UPDATE`,
          [input.approvalId],
        );
        const row = existing.rows[0];
        if (!row) throw new Error("MONITOR_PROFILE_REPAIR_APPROVAL_NOT_FOUND");
        if (row.revokedAt) return approvalFromRow(row);
        const revokedAt = clock();
        const updated = await q.query<DecisionRow>(
          `UPDATE monitor_profile_repair_decisions SET revoked_at=$2 WHERE id=$1
           RETURNING id,operator_principal_id AS "operatorPrincipalId",
            idempotency_key AS "idempotencyKey",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",binding_sha256 AS "bindingSha256",
            request_sha256 AS "requestSha256",decision,
            manual_checklist_sha256 AS "manualChecklistSha256",
            issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"`,
          [row.id, revokedAt],
        );
        await insertAudit(q, {
          actorPrincipalId: input.actorPrincipalId,
          action: "MONITOR_PROFILE_REPAIR_APPROVAL_REVOKED",
          targetType: "MONITOR_PROFILE_REPAIR_APPROVAL",
          targetId: row.id,
          metadata: {
            repairCaseId: row.repairCaseId,
            caseRevision: row.caseRevision,
          },
        });
        return approvalFromRow(updated.rows[0]!);
      });
    },
    async applyInitialRollout(input: {
      repairCaseId: string;
      caseRevision: number;
      approvalId: string;
      actorPrincipalId: string;
    }): Promise<{
      operationId: string;
      repairCaseId: string;
      caseRevision: number;
      approvalId: string;
      bindingSha256: string;
      publishedProfileRevisionId: string;
      assignmentRevisionId: string;
      assignmentRevision: number;
      percentageBps: number;
    }> {
      return runtime.transaction(async (q) => {
        const bindingRow = await loadBinding(
          q,
          input.repairCaseId,
          input.caseRevision,
          true,
        );
        const binding = MonitorProfileRepairBindingV1Schema.parse(
          bindingRow.binding,
        );

        const existingOperation = await q.query<OperationRow>(
          `SELECT id,approval_id AS "approvalId",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",state,actor_principal_id AS "actorPrincipalId",
            result
           FROM monitor_profile_repair_operations
           WHERE approval_id=$1 AND operation_kind='INITIAL_ROLLOUT'
           FOR UPDATE`,
          [input.approvalId],
        );
        const prior = existingOperation.rows[0];
        if (prior) {
          if (
            prior.repairCaseId !== input.repairCaseId ||
            prior.caseRevision !== input.caseRevision ||
            prior.actorPrincipalId !== input.actorPrincipalId
          )
            throw new Error("MONITOR_PROFILE_REPAIR_OPERATION_CONFLICT");
          if (prior.state !== "COMMITTED" || !prior.result)
            throw new Error("MONITOR_PROFILE_REPAIR_OPERATION_INCOMPLETE");
          return prior.result as {
            operationId: string;
            repairCaseId: string;
            caseRevision: number;
            approvalId: string;
            bindingSha256: string;
            publishedProfileRevisionId: string;
            assignmentRevisionId: string;
            assignmentRevision: number;
            percentageBps: number;
          };
        }

        // Keep the mutable admin-principal lock order consistent with revokeDecision:
        // principal authority first, then the decision row. The binding row is already
        // locked above and is immutable after registration.
        await authorizeAdminMutationInTransaction(
          q,
          input.actorPrincipalId,
          "ai.profile.manage",
        );
        await authorizeAdminMutationInTransaction(
          q,
          input.actorPrincipalId,
          "ai.assignment.manage",
        );

        const approvalResult = await q.query<DecisionRow>(
          `SELECT id,operator_principal_id AS "operatorPrincipalId",
            idempotency_key AS "idempotencyKey",repair_case_id AS "repairCaseId",
            case_revision AS "caseRevision",binding_sha256 AS "bindingSha256",
            request_sha256 AS "requestSha256",decision,
            manual_checklist_sha256 AS "manualChecklistSha256",
            issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt"
           FROM monitor_profile_repair_decisions WHERE id=$1 FOR UPDATE`,
          [input.approvalId],
        );
        const decision = approvalResult.rows[0];
        if (!decision)
          throw new Error("MONITOR_PROFILE_REPAIR_APPROVAL_NOT_FOUND");
        if (
          decision.operatorPrincipalId !== input.actorPrincipalId ||
          decision.repairCaseId !== input.repairCaseId ||
          decision.caseRevision !== input.caseRevision
        )
          throw new Error("MONITOR_PROFILE_REPAIR_APPROVAL_CASE_MISMATCH");

        const evidence = await trustedEvidence(binding, "APPLY");
        const rebuilt = await rebuildAndValidateBinding(q, binding, evidence, {
          candidateState: "CANDIDATE",
          phase: "APPLY",
        });
        const currentBindingSha256 = monitorProfileRepairBindingSha256(
          rebuilt.currentBinding,
        );
        if (
          currentBindingSha256 !== bindingRow.bindingSha256 ||
          currentBindingSha256 !== decision.bindingSha256
        )
          throw new Error("MONITOR_PROFILE_REPAIR_BINDING_CHANGED");

        const now = clock();
        const approval = approvalFromRow(decision);
        const approvalCheck = checkProfileRepairApprovalBinding({
          currentBinding: rebuilt.currentBinding,
          approval,
          now,
        });
        if (approvalCheck.status !== "CURRENT")
          throw new Error(
            `MONITOR_PROFILE_REPAIR_APPROVAL_${approvalCheck.reason}`,
          );

        const operationId = randomUUID();
        await q.query(
          `INSERT INTO monitor_profile_repair_operations(
            id,approval_id,repair_case_id,case_revision,operation_kind,state,
            actor_principal_id,admission_txid,started_at
          ) VALUES($1,$2,$3,$4,'INITIAL_ROLLOUT','IN_PROGRESS',$5,txid_current(),$6)`,
          [
            operationId,
            decision.id,
            binding.repairCaseId,
            binding.caseRevision,
            input.actorPrincipalId,
            now,
          ],
        );
        await q.query(
          "SELECT set_config('octoport.repair_operation_id',$1,true)",
          [operationId],
        );

        const context = {
          actorType: "ADMIN" as const,
          actorId: input.actorPrincipalId,
          correlationId: operationId,
          reason: "approved monitor profile repair initial rollout",
        };
        const published = await publishProfileRevisionInTransaction(q, {
          profileId: binding.candidate.profileId,
          revision: binding.candidate.revision,
          context,
        });
        const assignment = await startProfileRolloutInTransaction(q, {
          assignmentId: binding.assignment.id,
          baselineProfileRevisionId:
            binding.acceptedBaseline.profile.profileRevisionId,
          candidateProfileRevisionId: binding.candidate.profileRevisionId,
          percentageBps: binding.assignment.initialPercentageBps,
          expectedLatestAssignmentRevision: binding.assignment.expectedRevision,
          context,
        });

        const result = {
          operationId,
          repairCaseId: binding.repairCaseId,
          caseRevision: binding.caseRevision,
          approvalId: decision.id,
          bindingSha256: currentBindingSha256,
          publishedProfileRevisionId: published.id,
          assignmentRevisionId: assignment.id,
          assignmentRevision: assignment.revision,
          percentageBps: assignment.percentageBps,
        };
        const committed = await q.query<{ id: string }>(
          `UPDATE monitor_profile_repair_operations SET
            state='COMMITTED',committed_at=$2,published_profile_revision_id=$3,
            assignment_revision_id=$4,result=$5::jsonb
           WHERE id=$1 AND state='IN_PROGRESS'
           RETURNING id`,
          [
            operationId,
            now,
            published.id,
            assignment.id,
            JSON.stringify(result),
          ],
        );
        if (!committed.rows[0])
          throw new Error("MONITOR_PROFILE_REPAIR_OPERATION_COMMIT_FAILED");
        await insertAudit(q, {
          actorPrincipalId: input.actorPrincipalId,
          action: "MONITOR_PROFILE_REPAIR_INITIAL_ROLLOUT_APPLIED",
          targetType: "MONITOR_PROFILE_REPAIR",
          targetId: binding.repairCaseId,
          metadata: {
            caseRevision: binding.caseRevision,
            approvalId: decision.id,
            operationId,
            assignmentRevision: assignment.revision,
            percentageBps: assignment.percentageBps,
          },
        });
        return result;
      });
    },
  };
}
