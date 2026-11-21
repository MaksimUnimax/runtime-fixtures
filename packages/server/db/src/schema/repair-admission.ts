import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminPrincipals } from "./admin";
import { adapterProfileRevisions } from "./adapter-registry";
import {
  adapterProfileAssignmentRevisions,
  adapterProfileAssignments,
} from "./assignments";
import {
  healthIncidents,
  healthProfileEvaluations,
  healthRuns,
  healthSuiteRevisions,
} from "./health";

export const monitorProfileRepairBindings = pgTable(
  "monitor_profile_repair_bindings",
  {
    repairCaseId: uuid("repair_case_id").notNull(),
    caseRevision: integer("case_revision").notNull(),
    bindingSha256: varchar("binding_sha256", { length: 64 }).notNull(),
    binding: jsonb("binding").notNull(),
    incidentId: uuid("incident_id").notNull(),
    scopeSha256: varchar("scope_sha256", { length: 64 }).notNull(),
    deploymentEnvironment: varchar("deployment_environment", {
      length: 32,
    }).notNull(),
    observationRunId: uuid("observation_run_id").notNull(),
    observationNormalizedStateSha256: varchar(
      "observation_normalized_state_sha256",
      { length: 64 },
    ).notNull(),
    acceptedBaselineRunId: uuid("accepted_baseline_run_id").notNull(),
    acceptedBaselineProfileRevisionId: uuid(
      "accepted_baseline_profile_revision_id",
    ).notNull(),
    candidateProfileRevisionId: uuid("candidate_profile_revision_id").notNull(),
    testedExtensionVersion: varchar("tested_extension_version", {
      length: 64,
    }).notNull(),
    testedBrowserFamily: varchar("tested_browser_family", {
      length: 32,
    }).notNull(),
    testedBrowserVersion: varchar("tested_browser_version", {
      length: 64,
    }).notNull(),
    testedSourceCommitSha: varchar("tested_source_commit_sha", {
      length: 40,
    }).notNull(),
    testedSourceTreeSha: varchar("tested_source_tree_sha", {
      length: 40,
    }).notNull(),
    testedPackageSha256: varchar("tested_package_sha256", {
      length: 64,
    }).notNull(),
    suiteRevisionId: uuid("suite_revision_id").notNull(),
    suiteMachineKey: varchar("suite_machine_key", { length: 64 }).notNull(),
    suiteRevision: integer("suite_revision").notNull(),
    suiteDefinitionSha256: varchar("suite_definition_sha256", {
      length: 64,
    }).notNull(),
    h4EvaluationId: uuid("h4_evaluation_id").notNull(),
    h4EvaluationKey: varchar("h4_evaluation_key", { length: 64 }).notNull(),
    installedBehaviorEvidenceSha256: varchar(
      "installed_behavior_evidence_sha256",
      { length: 64 },
    ).notNull(),
    matrixSha256: varchar("matrix_sha256", { length: 64 }).notNull(),
    resultsSha256: varchar("results_sha256", { length: 64 }).notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    expectedAssignmentRevision: integer(
      "expected_assignment_revision",
    ).notNull(),
    initialPercentageBps: integer("initial_percentage_bps").notNull(),
    rollbackRunId: uuid("rollback_run_id").notNull(),
    rollbackProfileRevisionId: uuid("rollback_profile_revision_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.incidentId],
      foreignColumns: [healthIncidents.id],
      name: "monitor_profile_repair_bindings_incident_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.observationRunId],
      foreignColumns: [healthRuns.id],
      name: "monitor_profile_repair_bindings_observation_run_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.acceptedBaselineRunId],
      foreignColumns: [healthRuns.id],
      name: "monitor_profile_repair_bindings_baseline_run_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.candidateProfileRevisionId],
      foreignColumns: [adapterProfileRevisions.id],
      name: "monitor_profile_repair_bindings_candidate_revision_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.acceptedBaselineProfileRevisionId],
      foreignColumns: [adapterProfileRevisions.id],
      name: "monitor_profile_repair_bindings_baseline_revision_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.suiteRevisionId],
      foreignColumns: [healthSuiteRevisions.id],
      name: "monitor_profile_repair_bindings_suite_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.h4EvaluationId],
      foreignColumns: [healthProfileEvaluations.id],
      name: "monitor_profile_repair_bindings_h4_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.assignmentId],
      foreignColumns: [adapterProfileAssignments.id],
      name: "monitor_profile_repair_bindings_assignment_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.rollbackRunId],
      foreignColumns: [healthRuns.id],
      name: "monitor_profile_repair_bindings_rollback_run_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.rollbackProfileRevisionId],
      foreignColumns: [adapterProfileRevisions.id],
      name: "monitor_profile_repair_bindings_rollback_revision_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "monitor_profile_repair_bindings_binding_sha",
      sql`${table.bindingSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "monitor_profile_repair_bindings_observation_sha",
      sql`${table.observationNormalizedStateSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "monitor_profile_repair_bindings_external_hashes",
      sql`
    ${table.testedPackageSha256} ~ '^[0-9a-f]{64}$'
    AND ${table.suiteDefinitionSha256} ~ '^[0-9a-f]{64}$'
    AND ${table.h4EvaluationKey} ~ '^[0-9a-f]{64}$'
    AND ${table.installedBehaviorEvidenceSha256} ~ '^[0-9a-f]{64}$'
    AND ${table.matrixSha256} ~ '^[0-9a-f]{64}$'
    AND ${table.resultsSha256} ~ '^[0-9a-f]{64}$'
  `,
    ),
    check(
      "monitor_profile_repair_bindings_git_shas",
      sql`
    ${table.testedSourceCommitSha} ~ '^[0-9a-f]{40}$'
    AND ${table.testedSourceTreeSha} ~ '^[0-9a-f]{40}$'
  `,
    ),
    check(
      "monitor_profile_repair_bindings_environment",
      sql`${table.deploymentEnvironment} IN ('MONITOR_PILOT','OWNER_TEST','PRODUCTION')`,
    ),
    check(
      "monitor_profile_repair_bindings_json_object",
      sql`jsonb_typeof(${table.binding})='object' AND pg_column_size(${table.binding}) <= 32768`,
    ),
    primaryKey({
      columns: [table.repairCaseId, table.caseRevision],
      name: "monitor_profile_repair_bindings_pk",
    }),
    unique("monitor_profile_repair_bindings_hash_unique").on(
      table.bindingSha256,
    ),
    check(
      "monitor_profile_repair_bindings_case_revision_positive",
      sql`${table.caseRevision} > 0`,
    ),
    check(
      "monitor_profile_repair_bindings_assignment_revision_positive",
      sql`${table.expectedAssignmentRevision} > 0`,
    ),
    check(
      "monitor_profile_repair_bindings_percentage_bounds",
      sql`${table.initialPercentageBps} BETWEEN 1 AND 10000`,
    ),
    check(
      "monitor_profile_repair_bindings_scope_sha",
      sql`${table.scopeSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    index("monitor_profile_repair_bindings_candidate_index").on(
      table.candidateProfileRevisionId,
      table.createdAt,
    ),
    index("monitor_profile_repair_bindings_incident_index").on(
      table.incidentId,
      table.createdAt,
    ),
  ],
);
export const monitorProfileRepairDecisions = pgTable(
  "monitor_profile_repair_decisions",
  {
    id: uuid("id").primaryKey(),
    operatorPrincipalId: uuid("operator_principal_id").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    repairCaseId: uuid("repair_case_id").notNull(),
    caseRevision: integer("case_revision").notNull(),
    bindingSha256: varchar("binding_sha256", { length: 64 }).notNull(),
    requestSha256: varchar("request_sha256", { length: 64 }).notNull(),
    request: jsonb("request").notNull(),
    decision: varchar("decision", { length: 16 }).notNull(),
    manualChecklistSha256: varchar("manual_checklist_sha256", {
      length: 64,
    }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.operatorPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "monitor_profile_repair_decisions_operator_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "monitor_profile_repair_decisions_binding_sha",
      sql`${table.bindingSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "monitor_profile_repair_decisions_request_sha",
      sql`${table.requestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "monitor_profile_repair_decisions_checklist_sha",
      sql`${table.manualChecklistSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "monitor_profile_repair_decisions_time_order",
      sql`${table.expiresAt} > ${table.issuedAt} AND (${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.issuedAt})`,
    ),
    check(
      "monitor_profile_repair_decisions_request_object",
      sql`jsonb_typeof(${table.request})='object' AND pg_column_size(${table.request}) <= 8192`,
    ),
    unique("monitor_profile_repair_decisions_principal_idempotency_unique").on(
      table.operatorPrincipalId,
      table.idempotencyKey,
    ),
    foreignKey({
      columns: [table.repairCaseId, table.caseRevision],
      foreignColumns: [
        monitorProfileRepairBindings.repairCaseId,
        monitorProfileRepairBindings.caseRevision,
      ],
      name: "monitor_profile_repair_decisions_binding_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "monitor_profile_repair_decisions_value",
      sql`${table.decision} IN ('APPROVED','REJECTED')`,
    ),
    index("monitor_profile_repair_decisions_case_index").on(
      table.repairCaseId,
      table.caseRevision,
      table.issuedAt.desc().nullsFirst(),
    ),
  ],
);

export const monitorProfileRepairOperations = pgTable(
  "monitor_profile_repair_operations",
  {
    id: uuid("id").primaryKey(),
    approvalId: uuid("approval_id").notNull(),
    repairCaseId: uuid("repair_case_id").notNull(),
    caseRevision: integer("case_revision").notNull(),
    operationKind: varchar("operation_kind", { length: 32 }).notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    actorPrincipalId: uuid("actor_principal_id").notNull(),
    admissionTxid: bigint("admission_txid", { mode: "number" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    publishedProfileRevisionId: uuid("published_profile_revision_id"),
    assignmentRevisionId: uuid("assignment_revision_id"),
    result: jsonb("result"),
  },
  (table) => [
    foreignKey({
      columns: [table.approvalId],
      foreignColumns: [monitorProfileRepairDecisions.id],
      name: "monitor_profile_repair_operations_approval_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.actorPrincipalId],
      foreignColumns: [adminPrincipals.id],
      name: "monitor_profile_repair_operations_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.publishedProfileRevisionId],
      foreignColumns: [adapterProfileRevisions.id],
      name: "monitor_profile_repair_operations_published_revision_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.assignmentRevisionId],
      foreignColumns: [adapterProfileAssignmentRevisions.id],
      name: "monitor_profile_repair_operations_assignment_revision_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "monitor_profile_repair_operations_result_shape",
      sql`
    (${table.state}='IN_PROGRESS' AND ${table.committedAt} IS NULL AND ${table.publishedProfileRevisionId} IS NULL AND ${table.assignmentRevisionId} IS NULL AND ${table.result} IS NULL)
    OR
    (${table.state}='COMMITTED' AND ${table.committedAt} IS NOT NULL AND ${table.publishedProfileRevisionId} IS NOT NULL AND ${table.assignmentRevisionId} IS NOT NULL AND jsonb_typeof(${table.result})='object')
  `,
    ),
    unique("monitor_profile_repair_operations_approval_unique").on(
      table.approvalId,
      table.operationKind,
    ),
    foreignKey({
      columns: [table.repairCaseId, table.caseRevision],
      foreignColumns: [
        monitorProfileRepairBindings.repairCaseId,
        monitorProfileRepairBindings.caseRevision,
      ],
      name: "monitor_profile_repair_operations_binding_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "monitor_profile_repair_operations_kind",
      sql`${table.operationKind} = 'INITIAL_ROLLOUT'`,
    ),
    check(
      "monitor_profile_repair_operations_state",
      sql`${table.state} IN ('IN_PROGRESS','COMMITTED')`,
    ),
    index("monitor_profile_repair_operations_case_index").on(
      table.repairCaseId,
      table.caseRevision,
      table.startedAt.desc().nullsFirst(),
    ),
  ],
);
