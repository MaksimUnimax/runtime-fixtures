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
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => healthIncidents.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    scopeSha256: varchar("scope_sha256", { length: 64 }).notNull(),
    deploymentEnvironment: varchar("deployment_environment", {
      length: 32,
    }).notNull(),
    observationRunId: uuid("observation_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    observationNormalizedStateSha256: varchar(
      "observation_normalized_state_sha256",
      { length: 64 },
    ).notNull(),
    acceptedBaselineRunId: uuid("accepted_baseline_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    acceptedBaselineProfileRevisionId: uuid(
      "accepted_baseline_profile_revision_id",
    )
      .notNull()
      .references(() => adapterProfileRevisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    candidateProfileRevisionId: uuid("candidate_profile_revision_id")
      .notNull()
      .references(() => adapterProfileRevisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
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
    suiteRevisionId: uuid("suite_revision_id")
      .notNull()
      .references(() => healthSuiteRevisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    suiteMachineKey: varchar("suite_machine_key", { length: 64 }).notNull(),
    suiteRevision: integer("suite_revision").notNull(),
    suiteDefinitionSha256: varchar("suite_definition_sha256", {
      length: 64,
    }).notNull(),
    h4EvaluationId: uuid("h4_evaluation_id")
      .notNull()
      .references(() => healthProfileEvaluations.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    h4EvaluationKey: varchar("h4_evaluation_key", { length: 64 }).notNull(),
    installedBehaviorEvidenceSha256: varchar(
      "installed_behavior_evidence_sha256",
      { length: 64 },
    ).notNull(),
    matrixSha256: varchar("matrix_sha256", { length: 64 }).notNull(),
    resultsSha256: varchar("results_sha256", { length: 64 }).notNull(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => adapterProfileAssignments.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    expectedAssignmentRevision: integer(
      "expected_assignment_revision",
    ).notNull(),
    initialPercentageBps: integer("initial_percentage_bps").notNull(),
    rollbackRunId: uuid("rollback_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    rollbackProfileRevisionId: uuid("rollback_profile_revision_id")
      .notNull()
      .references(() => adapterProfileRevisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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
    operatorPrincipalId: uuid("operator_principal_id")
      .notNull()
      .references(() => adminPrincipals.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
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
      table.issuedAt,
    ),
  ],
);

export const monitorProfileRepairOperations = pgTable(
  "monitor_profile_repair_operations",
  {
    id: uuid("id").primaryKey(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => monitorProfileRepairDecisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    repairCaseId: uuid("repair_case_id").notNull(),
    caseRevision: integer("case_revision").notNull(),
    operationKind: varchar("operation_kind", { length: 32 }).notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    actorPrincipalId: uuid("actor_principal_id")
      .notNull()
      .references(() => adminPrincipals.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    admissionTxid: bigint("admission_txid", { mode: "number" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    publishedProfileRevisionId: uuid(
      "published_profile_revision_id",
    ).references(() => adapterProfileRevisions.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    assignmentRevisionId: uuid("assignment_revision_id").references(
      () => adapterProfileAssignmentRevisions.id,
      { onDelete: "restrict", onUpdate: "restrict" },
    ),
    result: jsonb("result"),
  },
  (table) => [
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
      table.startedAt,
    ),
  ],
);
