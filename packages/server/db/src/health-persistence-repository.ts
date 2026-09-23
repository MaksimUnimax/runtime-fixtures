import { createHash, randomUUID } from "node:crypto";
import {
  classifyHealth,
  HealthContourResultSchema,
  HealthLevelSchema,
  HealthScopeSchema,
  HealthStateSchema,
  HealthSuiteDefinitionSchema,
  SafeEvidenceReferenceSchema,
  healthSuiteFingerprint,
  validateHealthSuiteDefinition,
  type HealthContourResult,
  type HealthScope,
  type HealthState,
  type HealthSuiteDefinition,
} from "@product/health";
import { canonicalizeJson } from "@product/remote-config";
import type { BrowserFamily } from "@product/shared";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

export type HealthSuiteRevision = {
  id: string;
  machineKey: string;
  revision: number;
  suiteKind: "BASELINE_CONTRACT_FIXTURE";
  definition: HealthSuiteDefinition;
  definitionSha256: string;
  createdAt: Date;
};

export type PersistedHealthRun = {
  id: string;
  suiteRevisionId: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  profileId: string;
  profileRevisionId: string;
  profileRevision: number;
  browserFamily: HealthScope["browserFamily"];
  browserVersion: string;
  extensionVersion: string;
  adapterEngineVersion: string;
  healthLevel: "H0" | "H1" | "H2" | "H3" | "H4" | "H5";
  healthState: HealthState;
  classifierVersion: string;
  scope: HealthScope;
  scopeSha256: string;
  operatorMaintenance: boolean;
  operatorMaintenanceAuthority: string | null;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
};

export type PersistCompletedHealthRunInput = {
  suite: unknown;
  results: readonly unknown[];
  operatorMaintenance: boolean;
  operatorMaintenanceAuthority?: string | null;
  healthLevel: unknown;
  classifierVersion: string;
  startedAt: Date;
  completedAt: Date;
};

type SuiteRow = {
  id: string;
  machineKey: string;
  revision: number;
  suiteKind: "BASELINE_CONTRACT_FIXTURE";
  definition: unknown;
  definitionSha256: string;
  createdAt: Date;
};

type RunRow = {
  id: string;
  suiteRevisionId: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  profileId: string;
  profileRevisionId: string;
  profileRevision: number;
  browserFamily: BrowserFamily;
  browserVersion: string;
  extensionVersion: string;
  adapterEngineVersion: string;
  healthLevel: "H0" | "H1" | "H2" | "H3" | "H4" | "H5";
  healthState: HealthState;
  classifierVersion: string;
  scope: unknown;
  scopeSha256: string;
  operatorMaintenance: boolean;
  operatorMaintenanceAuthority: string | null;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
};

type ContourRow = {
  runId: string;
  contourKey: string;
  result: unknown;
};

type EvidenceRow = {
  evidenceId: string;
  runId: string;
  contourKey: string;
  ruleId: string;
  classification: "METADATA" | "BOUNDED_FRAGMENT" | "SCREENSHOT";
  sha256: string | null;
  sizeBytes: number | null;
  createdAt: Date;
};

function scopeFingerprint(scope: HealthScope): string {
  return createHash("sha256").update(canonicalizeJson(scope)).digest("hex");
}

function mapSuite(row: SuiteRow): HealthSuiteRevision {
  const definition = HealthSuiteDefinitionSchema.parse(row.definition);
  const fingerprint = healthSuiteFingerprint(definition);
  if (
    fingerprint !== row.definitionSha256 ||
    row.machineKey !== definition.machineKey ||
    row.revision !== definition.revision
  ) {
    throw new Error("HEALTH_SUITE_REVISION_CORRUPT");
  }
  return {
    id: row.id,
    machineKey: row.machineKey,
    revision: row.revision,
    suiteKind: row.suiteKind,
    definition,
    definitionSha256: row.definitionSha256,
    createdAt: row.createdAt,
  };
}

function mapRun(row: RunRow): PersistedHealthRun {
  return {
    ...row,
    scope: HealthScopeSchema.parse(row.scope),
    healthLevel: HealthLevelSchema.parse(row.healthLevel),
    healthState: HealthStateSchema.parse(row.healthState),
  };
}

function suiteProjection(): string {
  return `SELECT id,machine_key AS "machineKey",revision,suite_kind AS "suiteKind",definition,definition_sha256 AS "definitionSha256",created_at AS "createdAt" FROM health_suite_revisions`;
}

function runProjection(): string {
  return `SELECT id,suite_revision_id AS "suiteRevisionId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",profile_id AS "profileId",profile_revision_id AS "profileRevisionId",profile_revision AS "profileRevision",browser_family AS "browserFamily",browser_version AS "browserVersion",extension_version AS "extensionVersion",adapter_engine_version AS "adapterEngineVersion",health_level AS "healthLevel",health_state AS "healthState",classifier_version AS "classifierVersion",scope,scope_sha256 AS "scopeSha256",operator_maintenance AS "operatorMaintenance",operator_maintenance_authority AS "operatorMaintenanceAuthority",started_at AS "startedAt",completed_at AS "completedAt",created_at AS "createdAt" FROM health_runs`;
}

async function persistOrReuseSuite(
  q: DatabaseQuery,
  suite: HealthSuiteDefinition,
): Promise<HealthSuiteRevision> {
  const definitionSha256 = healthSuiteFingerprint(suite);
  const result = await q.query<SuiteRow>(
    `INSERT INTO health_suite_revisions(id,machine_key,revision,suite_kind,definition,definition_sha256) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (machine_key,revision) DO NOTHING RETURNING id,machine_key AS "machineKey",revision,suite_kind AS "suiteKind",definition,definition_sha256 AS "definitionSha256",created_at AS "createdAt"`,
    [
      randomUUID(),
      suite.machineKey,
      suite.revision,
      suite.suiteKind,
      JSON.stringify(suite),
      definitionSha256,
    ],
  );
  if (result.rows[0]) return mapSuite(result.rows[0]);
  const existing = await q.query<SuiteRow>(
    `${suiteProjection()} WHERE machine_key=$1 AND revision=$2 FOR UPDATE`,
    [suite.machineKey, suite.revision],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("HEALTH_SUITE_REVISION_PERSIST_FAILED");
  const mapped = mapSuite(row);
  if (
    mapped.definitionSha256 !== definitionSha256 ||
    !canonicalizeJson(mapped.definition).equals(canonicalizeJson(suite))
  ) {
    throw new Error("HEALTH_SUITE_REVISION_CONFLICT");
  }
  return mapped;
}

async function validateP7Scope(
  q: DatabaseQuery,
  scope: HealthScope,
): Promise<string> {
  const result = await q.query<{ id: string; revision: number }>(
    `SELECT r.id,r.revision
       FROM adapter_profile_revisions r
       JOIN adapter_profiles p ON p.id=r.profile_id
       JOIN ai_adapters a ON a.id=r.adapter_id
       JOIN ai_surfaces s ON s.id=r.surface_id AND s.adapter_id=r.adapter_id
       LEFT JOIN ai_variants v ON v.id=r.variant_id AND v.surface_id=r.surface_id
      WHERE r.profile_id=$1 AND r.revision=$2 AND r.adapter_id=$3 AND r.surface_id=$4
        AND r.variant_id IS NOT DISTINCT FROM $5::uuid
        AND a.machine_key=$6 AND s.machine_key=$7
        AND ($5::uuid IS NULL OR v.machine_key=$8)
        AND p.adapter_id=r.adapter_id AND p.surface_id=r.surface_id
        AND p.variant_id IS NOT DISTINCT FROM r.variant_id`,
    [
      scope.profile.id,
      scope.profile.revision,
      scope.adapterFamilyId,
      scope.surfaceId,
      scope.variant?.id ?? null,
      scope.adapterFamilyKey,
      scope.surfaceKey,
      scope.variant?.machineKey ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("P7_PROFILE_HIERARCHY_MISMATCH");
  return row.id;
}

function parseCompletedInput(input: PersistCompletedHealthRunInput) {
  if (!input || typeof input !== "object")
    throw new Error("INVALID_HEALTH_RUN_INPUT");
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "suite",
    "results",
    "operatorMaintenance",
    "operatorMaintenanceAuthority",
    "healthLevel",
    "classifierVersion",
    "startedAt",
    "completedAt",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new Error(`UNSUPPORTED_HEALTH_RUN_FIELD:${key}`);
  }
  if (
    !Array.isArray(value.results) ||
    typeof value.operatorMaintenance !== "boolean"
  ) {
    throw new Error("INVALID_HEALTH_RUN_INPUT");
  }
  if (
    !(value.startedAt instanceof Date) ||
    !(value.completedAt instanceof Date) ||
    Number.isNaN(value.startedAt.valueOf()) ||
    Number.isNaN(value.completedAt.valueOf())
  ) {
    throw new Error("INVALID_HEALTH_RUN_TIMESTAMPS");
  }
  if (value.completedAt < value.startedAt)
    throw new Error("HEALTH_RUN_COMPLETION_BEFORE_START");
  const healthLevel = HealthLevelSchema.parse(value.healthLevel);
  if (
    typeof value.classifierVersion !== "string" ||
    value.classifierVersion.length < 1 ||
    value.classifierVersion.length > 64
  ) {
    throw new Error("INVALID_CLASSIFIER_VERSION");
  }
  const authority = value.operatorMaintenanceAuthority ?? null;
  if (
    authority !== null &&
    (typeof authority !== "string" ||
      authority.length < 1 ||
      authority.length > 128)
  ) {
    throw new Error("INVALID_MAINTENANCE_AUTHORITY");
  }
  return {
    suite: validateHealthSuiteDefinition(value.suite),
    results: value.results.map((result) =>
      HealthContourResultSchema.parse(result),
    ),
    operatorMaintenance: value.operatorMaintenance,
    operatorMaintenanceAuthority: authority,
    healthLevel,
    classifierVersion: value.classifierVersion,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  };
}

export function createHealthPersistenceRepository(runtime: DatabaseRuntime) {
  return {
    async persistHealthSuiteRevision(
      input: unknown,
    ): Promise<HealthSuiteRevision> {
      const suite = validateHealthSuiteDefinition(input);
      return runtime.transaction((q) => persistOrReuseSuite(q, suite));
    },

    async persistCompletedHealthRun(
      rawInput: PersistCompletedHealthRunInput,
    ): Promise<PersistedHealthRun> {
      const input = parseCompletedInput(rawInput);
      const healthState = classifyHealth({
        suite: input.suite,
        results: input.results,
        operatorMaintenance: input.operatorMaintenance,
      });
      const scope = HealthScopeSchema.parse(input.suite.scope);
      const scopeSha256 = scopeFingerprint(scope);
      const evidence = input.results.flatMap((result) => result.evidence);
      const evidenceIds = new Set<string>();
      for (const item of evidence) {
        if (evidenceIds.has(item.evidenceId))
          throw new Error("DUPLICATE_EVIDENCE_REFERENCE");
        evidenceIds.add(item.evidenceId);
      }
      return runtime.transaction(async (q) => {
        const profileRevisionId = await validateP7Scope(q, scope);
        const suiteRevision = await persistOrReuseSuite(q, input.suite);
        const runId = randomUUID();
        const run = await q.query<RunRow>(
          `INSERT INTO health_runs(id,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,operator_maintenance_authority,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21) RETURNING id,suite_revision_id AS "suiteRevisionId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",profile_id AS "profileId",profile_revision_id AS "profileRevisionId",profile_revision AS "profileRevision",browser_family AS "browserFamily",browser_version AS "browserVersion",extension_version AS "extensionVersion",adapter_engine_version AS "adapterEngineVersion",health_level AS "healthLevel",health_state AS "healthState",classifier_version AS "classifierVersion",scope,scope_sha256 AS "scopeSha256",operator_maintenance AS "operatorMaintenance",operator_maintenance_authority AS "operatorMaintenanceAuthority",started_at AS "startedAt",completed_at AS "completedAt",created_at AS "createdAt"`,
          [
            runId,
            suiteRevision.id,
            scope.adapterFamilyId,
            scope.surfaceId,
            scope.variant?.id ?? null,
            scope.profile.id,
            profileRevisionId,
            scope.profile.revision,
            scope.browserFamily,
            scope.browserVersion,
            scope.extensionVersion,
            scope.adapterEngineVersion,
            input.healthLevel,
            healthState,
            input.classifierVersion,
            JSON.stringify(scope),
            scopeSha256,
            input.operatorMaintenance,
            input.operatorMaintenanceAuthority,
            input.startedAt,
            input.completedAt,
          ],
        );
        const runRow = run.rows[0];
        if (!runRow) throw new Error("HEALTH_RUN_PERSIST_FAILED");
        for (const result of input.results) {
          await q.query(
            `INSERT INTO health_contour_results(run_id,contour_key,result) VALUES($1,$2,$3::jsonb)`,
            [runId, result.contourKey, JSON.stringify(result)],
          );
        }
        for (const result of input.results) {
          for (const reference of result.evidence) {
            await q.query(
              `INSERT INTO health_evidence_references(evidence_id,run_id,contour_key,rule_id,classification,sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)`,
              [
                reference.evidenceId,
                runId,
                result.contourKey,
                reference.ruleId,
                reference.classification,
                reference.sha256,
                reference.sizeBytes,
              ],
            );
          }
        }
        return mapRun(runRow);
      });
    },

    async getSuiteRevision(
      machineKey: string,
      revision: number,
    ): Promise<HealthSuiteRevision | undefined> {
      const result = await runtime.query<SuiteRow>(
        `${suiteProjection()} WHERE machine_key=$1 AND revision=$2`,
        [machineKey, revision],
      );
      const row = result.rows[0];
      return row ? mapSuite(row) : undefined;
    },

    async getHealthRun(id: string): Promise<PersistedHealthRun | undefined> {
      const result = await runtime.query<RunRow>(
        `${runProjection()} WHERE id=$1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapRun(row) : undefined;
    },

    async listContourResults(runId: string): Promise<HealthContourResult[]> {
      const result = await runtime.query<ContourRow>(
        `SELECT run_id AS "runId",contour_key AS "contourKey",result FROM health_contour_results WHERE run_id=$1 ORDER BY contour_key`,
        [runId],
      );
      return result.rows.map((row) => {
        const parsed = HealthContourResultSchema.parse(row.result);
        if (parsed.contourKey !== row.contourKey)
          throw new Error("HEALTH_CONTOUR_RESULT_CORRUPT");
        return parsed;
      });
    },

    async listEvidenceReferences(
      runId: string,
      contourKey?: string,
    ): Promise<
      Array<{
        evidenceId: string;
        runId: string;
        contourKey: string;
        ruleId: HealthContourResult["evidence"][number]["ruleId"];
        classification: HealthContourResult["evidence"][number]["classification"];
        sha256: string | null;
        sizeBytes: number | null;
        createdAt: Date;
      }>
    > {
      const result = await runtime.query<EvidenceRow>(
        `SELECT evidence_id AS "evidenceId",run_id AS "runId",contour_key AS "contourKey",rule_id AS "ruleId",classification,sha256,size_bytes AS "sizeBytes",created_at AS "createdAt" FROM health_evidence_references WHERE run_id=$1 AND ($2::text IS NULL OR contour_key=$2) ORDER BY contour_key,evidence_id`,
        [runId, contourKey ?? null],
      );
      return result.rows.map((row) => {
        const parsed = SafeEvidenceReferenceSchema.parse({
          evidenceId: row.evidenceId,
          ruleId: row.ruleId,
          classification: row.classification,
          sha256: row.sha256,
          sizeBytes: row.sizeBytes,
        });
        return {
          ...parsed,
          runId: row.runId,
          contourKey: row.contourKey,
          createdAt: row.createdAt,
        };
      });
    },
  };
}
