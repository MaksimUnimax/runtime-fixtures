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
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
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
      "health_incidents_last_seen_after_first",
      sql`${table.lastSeenAt} >= ${table.firstSeenAt}`,
    ),
    check(
      "health_incidents_updated_after_created",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
