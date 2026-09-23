import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  adapterProfileRevisions,
  adapterProfiles,
  aiAdapters,
  aiSurfaces,
  aiVariants,
} from "./adapter-registry";

export const healthSuiteKind = pgEnum("health_suite_kind", [
  "BASELINE_CONTRACT_FIXTURE",
]);
export const healthIncidentStatus = pgEnum("health_incident_status", [
  "OPEN",
  "INVESTIGATING",
  "CANDIDATE_FIX",
  "CANDIDATE_PASS",
  "CANARY_ROLLOUT",
  "ROLLOUT",
  "RESOLVED",
  "FALSE_POSITIVE",
  "MAINTENANCE",
]);
export const healthProbeLayer = pgEnum("health_probe_layer", [
  "NO_SESSION",
  "AUTHENTICATED_DEEP",
]);
export const healthScheduledRunState = pgEnum("health_scheduled_run_state", [
  "PENDING",
  "CLAIMED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "TIMED_OUT",
  "CANCELLED",
]);
export const healthFailureClass = pgEnum("health_failure_class", [
  "TRANSIENT_ENVIRONMENT",
  "PROVIDER_ACCESS_OR_NETWORK",
  "BROWSER_UNAVAILABLE",
  "TERMINAL_CONFIGURATION",
  "PROVEN_PRODUCT_DRIFT",
  "MAINTENANCE",
]);
export const healthEvaluationPhase = pgEnum("health_evaluation_phase", [
  "H4_CANDIDATE",
  "H5_CANARY",
  "H5_POST_ROLLOUT",
]);
export const healthEvaluationStatus = pgEnum("health_evaluation_status", [
  "ACTIVE",
  "COMPLETED",
]);
export const healthNotificationEventKind = pgEnum(
  "health_notification_event_kind",
  [
    "INCIDENT_OPENED",
    "INCIDENT_ESCALATED",
    "INCIDENT_RECOVERED",
    "MAINTENANCE_ENTERED",
    "MAINTENANCE_EXITED",
  ],
);
export const healthNotificationSeverity = pgEnum(
  "health_notification_severity",
  ["INFO", "WARNING", "CRITICAL"],
);
export const healthNotificationState = pgEnum("health_notification_state", [
  "PENDING",
  "CLAIMED",
  "DELIVERED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "SUPPRESSED",
]);

const contourKeyCheck = (column: unknown) =>
  sql`${column} IN ('C01_PAGE_IDENTITY', 'C02_CONVERSATION_ROOT', 'C03_COMPOSER_ROOT', 'C04_COMPOSER_INPUT', 'C05_SEND_CONTROL', 'C06_BUSY_STOP_STATE', 'C07_ASSISTANT_MESSAGE', 'C08_MESSAGE_COMPLETION', 'C09_COMMAND_CODE_BLOCK_SURFACE', 'C10_NATIVE_COPY_CONTROL', 'C11_CONVERSATION_IDENTITY', 'C12_DELIVERY_INSERTION_PATH', 'C13_BLOCKING_STATE')`;

export const healthSuiteRevisions = pgTable(
  "health_suite_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineKey: varchar("machine_key", { length: 64 }).notNull(),
    revision: integer("revision").notNull(),
    suiteKind: healthSuiteKind("suite_kind").notNull(),
    definition: jsonb("definition").notNull(),
    definitionSha256: varchar("definition_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_suite_revisions_machine_revision_unique").on(
      table.machineKey,
      table.revision,
    ),
    check(
      "health_suite_revisions_revision_positive",
      sql`${table.revision} > 0`,
    ),
    check(
      "health_suite_revisions_definition_object",
      sql`jsonb_typeof(${table.definition}) = 'object'`,
    ),
    check(
      "health_suite_revisions_definition_checksum_format",
      sql`${table.definitionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const healthRuns = pgTable(
  "health_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    suiteRevisionId: uuid("suite_revision_id")
      .notNull()
      .references(() => healthSuiteRevisions.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    adapterId: uuid("adapter_id")
      .notNull()
      .references(() => aiAdapters.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    surfaceId: uuid("surface_id").notNull(),
    variantId: uuid("variant_id"),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => adapterProfiles.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    profileRevisionId: uuid("profile_revision_id").notNull(),
    profileRevision: integer("profile_revision").notNull(),
    browserFamily: varchar("browser_family", { length: 32 }).notNull(),
    browserVersion: varchar("browser_version", { length: 64 }).notNull(),
    extensionVersion: varchar("extension_version", { length: 64 }).notNull(),
    adapterEngineVersion: varchar("adapter_engine_version", {
      length: 64,
    }).notNull(),
    scheduledRunId: uuid("scheduled_run_id"),
    healthLevel: varchar("health_level", { length: 2 }).notNull(),
    healthState: varchar("health_state", { length: 16 }).notNull(),
    classifierVersion: varchar("classifier_version", { length: 64 }).notNull(),
    scope: jsonb("scope").notNull(),
    scopeSha256: varchar("scope_sha256", { length: 64 }).notNull(),
    operatorMaintenance: boolean("operator_maintenance").notNull(),
    operatorMaintenanceAuthority: varchar("operator_maintenance_authority", {
      length: 128,
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.surfaceId, table.adapterId],
      foreignColumns: [aiSurfaces.id, aiSurfaces.adapterId],
      name: "health_runs_surface_adapter_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.variantId, table.surfaceId],
      foreignColumns: [aiVariants.id, aiVariants.surfaceId],
      name: "health_runs_variant_surface_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [
        table.profileRevisionId,
        table.profileId,
        table.adapterId,
        table.surfaceId,
        table.variantId,
      ],
      foreignColumns: [
        adapterProfileRevisions.id,
        adapterProfileRevisions.profileId,
        adapterProfileRevisions.adapterId,
        adapterProfileRevisions.surfaceId,
        adapterProfileRevisions.variantId,
      ],
      name: "health_runs_profile_revision_hierarchy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "health_runs_profile_revision_positive",
      sql`${table.profileRevision} > 0`,
    ),
    check(
      "health_runs_browser_family",
      sql`${table.browserFamily} IN ('chrome', 'opera', 'yandex_chromium', 'firefox', 'safari')`,
    ),
    check(
      "health_runs_health_level",
      sql`${table.healthLevel} IN ('H0', 'H1', 'H2', 'H3', 'H4', 'H5')`,
    ),
    check(
      "health_runs_health_state",
      sql`${table.healthState} IN ('HEALTHY', 'DRIFT', 'DEGRADED', 'BROKEN', 'UNKNOWN', 'MAINTENANCE')`,
    ),
    check(
      "health_runs_scope_object",
      sql`jsonb_typeof(${table.scope}) = 'object'`,
    ),
    check(
      "health_runs_scope_checksum_format",
      sql`${table.scopeSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_runs_completed_after_started",
      sql`${table.completedAt} >= ${table.startedAt}`,
    ),
    check(
      "health_runs_maintenance_authority",
      sql`NOT ${table.operatorMaintenance} OR ${table.operatorMaintenanceAuthority} IS NOT NULL`,
    ),
    index("health_runs_scope_index").on(table.scopeSha256, table.createdAt),
    unique("health_runs_scheduled_run_unique").on(table.scheduledRunId),
  ],
);

export const healthSchedules = pgTable(
  "health_schedules",
  {
    id: uuid("id").primaryKey(),
    monitorTarget: varchar("monitor_target", { length: 128 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    surface: varchar("surface", { length: 64 }).notNull(),
    probeLayer: healthProbeLayer("probe_layer").notNull(),
    enabled: boolean("enabled").notNull(),
    cadence: jsonb("cadence").notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_schedules_target_revision_unique").on(
      table.monitorTarget,
      table.revision,
    ),
    check(
      "health_schedules_target_format",
      sql`${table.monitorTarget} ~ '^[a-z][a-z0-9_]{0,127}$'`,
    ),
    check(
      "health_schedules_provider_format",
      sql`${table.provider} ~ '^[a-z][a-z0-9_]{0,31}$'`,
    ),
    check(
      "health_schedules_surface_format",
      sql`${table.surface} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check("health_schedules_revision_positive", sql`${table.revision} > 0`),
    check(
      "health_schedules_cadence_object",
      sql`jsonb_typeof(${table.cadence}) = 'object'`,
    ),
  ],
);

export const healthScheduledRuns = pgTable(
  "health_scheduled_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => healthSchedules.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    monitorTarget: varchar("monitor_target", { length: 128 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    surface: varchar("surface", { length: 64 }).notNull(),
    probeLayer: healthProbeLayer("probe_layer").notNull(),
    scheduleRevision: integer("schedule_revision").notNull(),
    dueSlotAt: timestamp("due_slot_at", { withTimezone: true }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    state: healthScheduledRunState("state").notNull(),
    ownerId: varchar("owner_id", { length: 128 }),
    leaseId: uuid("lease_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    attempt: integer("attempt").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    failureClass: healthFailureClass("failure_class"),
    failureCode: varchar("failure_code", { length: 128 }),
    healthRunId: uuid("health_run_id").references(() => healthRuns.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    healthState: varchar("health_state", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_scheduled_runs_idempotency_unique").on(
      table.scheduleId,
      table.scheduleRevision,
      table.dueSlotAt,
      table.monitorTarget,
    ),
    unique("health_scheduled_runs_key_unique").on(table.idempotencyKey),
    unique("health_scheduled_runs_health_run_unique").on(table.healthRunId),
    check(
      "health_scheduled_runs_revision_positive",
      sql`${table.scheduleRevision} > 0`,
    ),
    check("health_scheduled_runs_attempt_positive", sql`${table.attempt} > 0`),
    check(
      "health_scheduled_runs_health_state",
      sql`${table.healthState} IS NULL OR ${table.healthState} IN ('HEALTHY', 'DRIFT', 'DEGRADED', 'BROKEN', 'UNKNOWN', 'MAINTENANCE')`,
    ),
  ],
);

export const healthContourResults = pgTable(
  "health_contour_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    contourKey: varchar("contour_key", { length: 64 }).notNull(),
    result: jsonb("result").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_contour_results_run_contour_unique").on(
      table.runId,
      table.contourKey,
    ),
    check("health_contour_results_key", contourKeyCheck(table.contourKey)),
    check(
      "health_contour_results_object",
      sql`jsonb_typeof(${table.result}) = 'object'`,
    ),
  ],
);

export const healthEvidenceReferences = pgTable(
  "health_evidence_references",
  {
    evidenceId: uuid("evidence_id").primaryKey(),
    runId: uuid("run_id").notNull(),
    contourKey: varchar("contour_key", { length: 64 }).notNull(),
    ruleId: varchar("rule_id", { length: 64 }).notNull(),
    classification: varchar("classification", { length: 32 }).notNull(),
    sha256: varchar("sha256", { length: 64 }),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.contourKey],
      foreignColumns: [
        healthContourResults.runId,
        healthContourResults.contourKey,
      ],
      name: "health_evidence_references_contour_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("health_evidence_references_key", contourKeyCheck(table.contourKey)),
    check(
      "health_evidence_references_rule",
      sql`${table.ruleId} IN ('NO_EVIDENCE', 'SAFE_ELEMENT_METADATA', 'BOUNDED_DOM_FRAGMENT', 'SAFE_SCREENSHOT_REFERENCE', 'STATE_TRANSITION_TRACE')`,
    ),
    check(
      "health_evidence_references_classification",
      sql`${table.classification} IN ('METADATA', 'BOUNDED_FRAGMENT', 'SCREENSHOT')`,
    ),
    check(
      "health_evidence_references_sha256",
      sql`${table.sha256} IS NULL OR ${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_evidence_references_size",
      sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} BETWEEN 0 AND 10000000`,
    ),
  ],
);

export const healthIncidents = pgTable(
  "health_incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeSha256: varchar("scope_sha256", { length: 64 }).notNull(),
    status: healthIncidentStatus("status").notNull(),
    firstSeenRunId: uuid("first_seen_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    latestSeenRunId: uuid("latest_seen_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    rootContourKey: varchar("root_contour_key", { length: 64 }),
    incidentScopeSha256: varchar("incident_scope_sha256", {
      length: 64,
    }).notNull(),
    incidentKeySha256: varchar("incident_key_sha256", {
      length: 64,
    }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastObservedRunId: uuid("last_observed_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    lastObservedAt: timestamp("last_observed_at", {
      withTimezone: true,
    }).notNull(),
    resolvedByRunId: uuid("resolved_by_run_id").references(
      () => healthRuns.id,
      {
        onDelete: "restrict",
        onUpdate: "restrict",
      },
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "health_incidents_scope_checksum_format",
      sql`${table.scopeSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_incidents_root_contour_key",
      sql`${table.rootContourKey} IS NULL OR ${contourKeyCheck(table.rootContourKey)}`,
    ),
    check(
      "health_incidents_incident_scope_checksum_format",
      sql`${table.incidentScopeSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_incidents_key_checksum_format",
      sql`${table.incidentKeySha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_incidents_last_seen_after_first",
      sql`${table.lastSeenAt} >= ${table.firstSeenAt}`,
    ),
    check(
      "health_incidents_observed_after_first",
      sql`${table.lastObservedAt} >= ${table.firstSeenAt}`,
    ),
    check(
      "health_incidents_resolution_pair",
      sql`(${table.resolvedByRunId} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.resolvedByRunId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    check(
      "health_incidents_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const healthNotificationIntents = pgTable(
  "health_notification_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dedupKey: varchar("dedup_key", { length: 256 }).notNull(),
    sourceDomain: varchar("source_domain", { length: 32 }).notNull(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => healthIncidents.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    healthRunId: uuid("health_run_id")
      .notNull()
      .references(() => healthRuns.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    eventKind: healthNotificationEventKind("event_kind").notNull(),
    severity: healthNotificationSeverity("severity").notNull(),
    routeKey: varchar("route_key", { length: 64 }).notNull(),
    state: healthNotificationState("state").notNull(),
    groupCount: integer("group_count").notNull().default(1),
    firstObservedAt: timestamp("first_observed_at", {
      withTimezone: true,
    }).notNull(),
    latestObservedAt: timestamp("latest_observed_at", {
      withTimezone: true,
    }).notNull(),
    cooldownUntil: timestamp("cooldown_until", {
      withTimezone: true,
    }).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimOwner: varchar("claim_owner", { length: 128 }),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    suppressionReason: varchar("suppression_reason", { length: 64 }),
    payload: jsonb("payload").notNull(),
    retentionClass: varchar("retention_class", { length: 64 })
      .notNull()
      .default("OPERATIONAL_DEFAULT"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    providerAdapterKey: varchar("provider_adapter_key", { length: 64 }),
    providerDeliveryId: varchar("provider_delivery_id", { length: 128 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_notification_intents_dedup_key_unique").on(table.dedupKey),
    check(
      "health_notification_intents_source_domain",
      sql`${table.sourceDomain} = 'LLM_HEALTH'`,
    ),
    check(
      "health_notification_intents_route_key",
      sql`${table.routeKey} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      "health_notification_intents_group_count_positive",
      sql`${table.groupCount} > 0`,
    ),
    check(
      "health_notification_intents_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "health_notification_intents_payload_object",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "health_notification_intents_observation_order",
      sql`${table.latestObservedAt} >= ${table.firstObservedAt}`,
    ),
    check(
      "health_notification_intents_delivery_pair",
      sql`(${table.deliveredAt} IS NULL OR ${table.state} = 'DELIVERED')`,
    ),
    check(
      "health_notification_intents_claim_pair",
      sql`(${table.state} <> 'CLAIMED' OR (${table.claimOwner} IS NOT NULL AND ${table.claimToken} IS NOT NULL AND ${table.claimExpiresAt} IS NOT NULL))`,
    ),
    index("health_notification_intents_due_index").on(
      table.state,
      table.nextAttemptAt,
      table.claimExpiresAt,
    ),
    index("health_notification_intents_incident_index").on(
      table.incidentId,
      table.eventKind,
      table.latestObservedAt,
    ),
  ],
);

export const healthProfileEvaluations = pgTable(
  "health_profile_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evaluationKeySha256: varchar("evaluation_key_sha256", {
      length: 64,
    }).notNull(),
    phase: healthEvaluationPhase("phase").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    surface: varchar("surface", { length: 128 }).notNull(),
    target: varchar("target", { length: 128 }).notNull(),
    variant: varchar("variant", { length: 128 }),
    probeLayer: healthProbeLayer("probe_layer").notNull(),
    baselineProfileRevisionId: uuid("baseline_profile_revision_id").notNull(),
    candidateProfileRevisionId: uuid("candidate_profile_revision_id").notNull(),
    suiteMachineKey: varchar("suite_machine_key", { length: 64 }).notNull(),
    suiteRevision: integer("suite_revision").notNull(),
    browserFamily: varchar("browser_family", { length: 32 }).notNull(),
    browserVersion: varchar("browser_version", { length: 64 }).notNull(),
    environmentClass: varchar("environment_class", { length: 128 }).notNull(),
    status: healthEvaluationStatus("status").notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    recommendation: varchar("recommendation", { length: 32 }),
    result: jsonb("result").notNull(),
    firstExecutionId: uuid("first_execution_id").notNull(),
    latestExecutionId: uuid("latest_execution_id").notNull(),
    firstEvaluatedAt: timestamp("first_evaluated_at", {
      withTimezone: true,
    }).notNull(),
    latestEvaluatedAt: timestamp("latest_evaluated_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("health_profile_evaluations_key_unique").on(
      table.evaluationKeySha256,
    ),
    check(
      "health_profile_evaluations_key_format",
      sql`${table.evaluationKeySha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "health_profile_evaluations_suite_revision_positive",
      sql`${table.suiteRevision} > 0`,
    ),
    check(
      "health_profile_evaluations_browser_family",
      sql`${table.browserFamily} IN ('chrome', 'opera', 'yandex_chromium', 'firefox', 'safari')`,
    ),
    check(
      "health_profile_evaluations_result_object",
      sql`jsonb_typeof(${table.result}) = 'object'`,
    ),
    check(
      "health_profile_evaluations_time_order",
      sql`${table.latestEvaluatedAt} >= ${table.firstEvaluatedAt}`,
    ),
    index("health_profile_evaluations_scope_index").on(
      table.provider,
      table.surface,
      table.target,
      table.phase,
    ),
  ],
);
