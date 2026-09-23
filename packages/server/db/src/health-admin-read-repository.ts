/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  HealthAdminEvaluationQuerySchema,
  HealthAdminIncidentQuerySchema,
  HealthAdminRecommendationQuerySchema,
  HealthAdminTargetDetailSchema,
  HealthAdminTargetQuerySchema,
  HealthAdminEvaluationDetailSchema,
  HealthIncidentSummarySchema,
  HealthRecommendationSchema,
  type HealthAdminEvaluationQuery,
  type HealthAdminPage,
  type HealthAdminReadRepository,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";

type Row = Record<string, any>;
const iso = (value: unknown): string | null =>
  value == null ? null : new Date(String(value)).toISOString();
const page = <T>(
  items: T[],
  limit: number,
  _cursor: string | null,
): HealthAdminPage<T> => ({
  items,
  nextCursor:
    items.length === limit
      ? String(
          (items[items.length - 1] as Row).targetId ??
            (items[items.length - 1] as Row).id,
        )
      : null,
});

const targetBase = `
WITH latest AS (
  SELECT DISTINCT ON (r.scope_sha256)
    r.id AS run_id,r.scope_sha256 AS target_id,r.adapter_id,r.surface_id,r.variant_id,
    r.profile_revision_id,r.profile_revision,r.browser_family,r.browser_version,
    r.extension_version,r.adapter_engine_version,r.health_level,r.health_state,
    r.scope,r.completed_at,r.scheduled_run_id,r.suite_revision_id,
    a.machine_key AS provider,s.machine_key AS surface,
    COALESCE(v.machine_key,'default') AS variant,
    sr.state AS scheduler_state,
    COALESCE(sr.probe_layer::text, r.scope->>'monitoringLayer', 'NO_SESSION') AS monitoring_layer,
    hs.machine_key AS suite_machine_key
  FROM health_runs r
  JOIN ai_adapters a ON a.id=r.adapter_id
  JOIN ai_surfaces s ON s.id=r.surface_id AND s.adapter_id=r.adapter_id
  LEFT JOIN ai_variants v ON v.id=r.variant_id AND v.surface_id=r.surface_id
  LEFT JOIN health_scheduled_runs sr ON sr.id=r.scheduled_run_id
  LEFT JOIN health_suite_revisions hs ON hs.id=r.suite_revision_id
  ORDER BY r.scope_sha256,r.completed_at DESC,r.id DESC
), current_assignment AS (
  SELECT DISTINCT ON (a.adapter_id,a.surface_id,a.variant_id,a.browser_family)
    a.adapter_id,a.surface_id,a.variant_id,a.browser_family,
    ar.baseline_profile_revision_id,ar.candidate_profile_revision_id,ar.mode
  FROM adapter_profile_assignments a
  JOIN adapter_profile_assignment_revisions ar ON ar.assignment_id=a.id
  ORDER BY a.adapter_id,a.surface_id,a.variant_id,a.browser_family,ar.revision DESC
)
SELECT l.*,
  ca.baseline_profile_revision_id,
  ca.candidate_profile_revision_id,
  ca.mode AS assignment_mode,
  b.revision AS baseline_revision,b.state AS baseline_state,b.content_sha256 AS baseline_sha,
  c.revision AS candidate_revision,c.state AS candidate_state,c.content_sha256 AS candidate_sha,
  (SELECT max(r2.completed_at) FROM health_runs r2 WHERE r2.scope_sha256=l.target_id AND r2.scheduled_run_id IS NOT NULL) AS latest_successful_run_at,
  (SELECT i.id FROM health_incidents i WHERE i.scope_sha256=l.target_id AND i.status IN ('OPEN','INVESTIGATING','CANDIDATE_FIX','CANDIDATE_PASS','CANARY_ROLLOUT','ROLLOUT','MAINTENANCE') ORDER BY i.last_observed_at DESC,i.id DESC LIMIT 1) AS active_incident_id,
  h4.outcome AS h4_outcome,h5.result AS h5_result,h5.outcome AS h5_outcome,h5.recommendation AS h5_recommendation,
  h4.id AS h4_id,h5.id AS h5_id
FROM latest l
LEFT JOIN current_assignment ca ON ca.adapter_id=l.adapter_id AND ca.surface_id=l.surface_id AND ca.variant_id IS NOT DISTINCT FROM l.variant_id AND ca.browser_family=l.browser_family
LEFT JOIN adapter_profile_revisions b ON b.id=COALESCE(ca.baseline_profile_revision_id,l.profile_revision_id)
LEFT JOIN adapter_profile_revisions c ON c.id=ca.candidate_profile_revision_id
LEFT JOIN LATERAL (
  SELECT e.id,e.outcome FROM health_profile_evaluations e
  WHERE e.provider=l.provider AND e.surface=l.surface AND e.target=l.variant AND e.variant IS NOT DISTINCT FROM NULLIF(l.variant,'default')
    AND e.browser_family=l.browser_family AND e.phase='H4_CANDIDATE'
    AND (ca.candidate_profile_revision_id IS NULL OR e.candidate_profile_revision_id=ca.candidate_profile_revision_id)
  ORDER BY e.latest_evaluated_at DESC,e.id DESC LIMIT 1
) h4 ON true
LEFT JOIN LATERAL (
  SELECT e.id,e.result,e.outcome,e.recommendation FROM health_profile_evaluations e
  WHERE e.provider=l.provider AND e.surface=l.surface AND e.target=l.variant AND e.variant IS NOT DISTINCT FROM NULLIF(l.variant,'default')
    AND e.browser_family=l.browser_family AND e.phase IN ('H5_CANARY','H5_POST_ROLLOUT')
    AND (ca.candidate_profile_revision_id IS NULL OR e.candidate_profile_revision_id=ca.candidate_profile_revision_id OR e.candidate_profile_revision_id=ca.baseline_profile_revision_id)
  ORDER BY e.latest_evaluated_at DESC,e.id DESC LIMIT 1
) h5 ON true`;

function recommendation(value: unknown): string | null {
  switch (value) {
    case "CONTINUE":
      return "NO_RESTRICTION_SIGNAL";
    case "HOLD":
      return "ADVISORY_HOLD";
    case "RESTRICT":
      return "SCOPED_RESTRICTION_RECOMMENDED";
    case "ROLLBACK_RECOMMENDED":
      return "ROLLBACK_RECOMMENDED";
    case "INCONCLUSIVE":
      return "INCONCLUSIVE";
    default:
      return null;
  }
}

function evidence(result: unknown) {
  if (!result || typeof result !== "object") return [];
  const value = result as Row;
  const list = Array.isArray(value.evidenceReferences)
    ? value.evidenceReferences
    : Array.isArray(value.h4Comparison?.evidenceReferences)
      ? value.h4Comparison.evidenceReferences
      : [];
  return list.slice(0, 32);
}

function mapEvaluation(row: Row, currentProfileRevisionId?: string | null) {
  const result = row.result && typeof row.result === "object" ? row.result : {};
  const comparison = result.comparison ?? result.h4Comparison;
  const mapped = {
    id: String(row.id),
    evaluationKey: String(row.evaluationKey),
    phase: row.phase,
    provider: String(row.provider),
    surface: String(row.surface),
    variant: String(row.variant ?? "default"),
    target: String(row.target),
    monitoringLayer: row.probeLayer,
    browserFamily: row.browserFamily,
    browserVersion: String(row.browserVersion),
    environmentClass: String(row.environmentClass),
    baselineProfileRevisionId: String(row.baselineProfileRevisionId),
    candidateProfileRevisionId: String(row.candidateProfileRevisionId),
    outcome: row.outcome,
    recommendation: row.recommendation ?? null,
    postRolloutOutcome:
      row.phase === "H5_POST_ROLLOUT" ? (result.outcome ?? null) : null,
    comparability: comparison
      ? comparison.matrixDecision === "INCONCLUSIVE"
        ? "NOT_COMPARABLE"
        : "COMPARABLE"
      : "NOT_APPLICABLE",
    decisiveContours: (comparison?.decisiveContours ?? []).slice(0, 13),
    evidenceReferences: evidence(result),
    currentAuthority:
      currentProfileRevisionId == null ||
      String(row.candidateProfileRevisionId) === currentProfileRevisionId,
    firstEvaluatedAt: iso(row.firstEvaluatedAt),
    latestEvaluatedAt: iso(row.latestEvaluatedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    incidentId: row.incidentId ?? null,
    recommendationView: row.recommendation
      ? {
          recommendation: recommendation(row.recommendation),
          sourceRecommendation: row.recommendation,
          reasonCode: `H5_${row.recommendation}`,
          severity: null,
          evaluationId: row.id,
          evaluationKey: row.evaluationKey,
          incidentId: row.incidentId ?? null,
          profileRevisionId: row.candidateProfileRevisionId,
          provider: row.provider,
          surface: row.surface,
          variant: row.variant ?? "default",
          browserFamily: row.browserFamily,
          browserVersionScope: row.browserVersion,
          monitoringLayer: row.probeLayer,
          evidenceReferences: evidence(result),
          issuedAt: iso(row.latestEvaluatedAt),
          evaluationRevision: Number(row.suiteRevision),
          freshnessAuthority: `${row.evaluationKey}:${row.suiteRevision}`,
          executionAuthority: false,
        }
      : null,
  };
  return HealthAdminEvaluationDetailSchema.parse(mapped);
}

async function evaluationRows(
  runtime: DatabaseRuntime,
  input: HealthAdminEvaluationQuery,
  id?: string,
  recommendationsOnly = false,
) {
  const phasePredicate = recommendationsOnly
    ? "phase IN ('H5_CANARY','H5_POST_ROLLOUT') AND $4::text IS NULL"
    : "($4::text IS NULL OR phase::text=$4)";
  const result = await runtime.query<Row>(
    `SELECT id,evaluation_key_sha256 AS "evaluationKey",phase,provider,surface,target,variant,probe_layer AS "probeLayer",baseline_profile_revision_id AS "baselineProfileRevisionId",candidate_profile_revision_id AS "candidateProfileRevisionId",suite_machine_key AS "suiteMachineKey",suite_revision AS "suiteRevision",browser_family AS "browserFamily",browser_version AS "browserVersion",environment_class AS "environmentClass",outcome,recommendation,result,first_evaluated_at AS "firstEvaluatedAt",latest_evaluated_at AS "latestEvaluatedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM health_profile_evaluations WHERE ($1::uuid IS NULL OR id=$1) AND ($2::text IS NULL OR provider=$2) AND ($3::text IS NULL OR surface=$3) AND ${phasePredicate} AND ($5::uuid IS NULL OR baseline_profile_revision_id=$5 OR candidate_profile_revision_id=$5) AND ($6::text IS NULL OR browser_family=$6) AND ($7::uuid IS NULL OR id>$7::uuid) ORDER BY id LIMIT $8`,
    [
      id ?? null,
      input.provider ?? null,
      input.surface ?? null,
      input.phase ?? null,
      input.profileRevisionId ?? null,
      input.browserFamily ?? null,
      input.cursor ?? null,
      input.limit,
    ],
  );
  return result.rows;
}

export function createHealthAdminReadRepository(
  runtime: DatabaseRuntime,
): HealthAdminReadRepository {
  const repo: HealthAdminReadRepository = {
    async listTargets(raw) {
      const input = HealthAdminTargetQuerySchema.parse(raw);
      const result = await runtime.query<Row>(
        `${targetBase} WHERE ($1::text IS NULL OR l.provider=$1) AND ($2::text IS NULL OR l.surface=$2) AND ($3::text IS NULL OR l.health_state=$3) AND ($4::text IS NULL OR l.browser_family=$4) AND ($5::boolean=false OR EXISTS (SELECT 1 FROM health_incidents ai WHERE ai.scope_sha256=l.target_id AND ai.status IN ('OPEN','INVESTIGATING','CANDIDATE_FIX','CANDIDATE_PASS','CANARY_ROLLOUT','ROLLOUT','MAINTENANCE'))) AND ($6::text IS NULL OR l.target_id>$6) ORDER BY l.target_id LIMIT $7`,
        [
          input.provider ?? null,
          input.surface ?? null,
          input.healthState ?? null,
          input.browserFamily ?? null,
          input.activeOnly,
          input.cursor ?? null,
          input.limit,
        ],
      );
      // The list projection is already complete for summary fields. Detail
      // hydration is reserved for one target so a bounded page does not turn
      // into an N+1 evidence/evaluation query fan-out.
      const items = result.rows.map(mapTarget);
      return page(items, input.limit, input.cursor ?? null);
    },
    async getTarget(targetId) {
      if (!/^[0-9a-f]{64}$/.test(targetId)) return null;
      const result = await runtime.query<Row>(
        `${targetBase} WHERE l.target_id=$1`,
        [targetId],
      );
      return result.rows[0] ? hydrateTarget(runtime, result.rows[0]) : null;
    },
    async listIncidents(raw) {
      const input = HealthAdminIncidentQuerySchema.parse(raw);
      const result = await runtime.query<Row>(
        `SELECT i.id,i.status,i.root_contour_key AS "rootContourKey",i.first_seen_run_id AS "firstSeenRunId",i.latest_seen_run_id AS "latestSeenRunId",i.last_observed_run_id AS "lastObservedRunId",i.first_seen_at AS "firstSeenAt",i.last_seen_at AS "lastSeenAt",i.last_observed_at AS "lastObservedAt",i.resolved_by_run_id AS "resolvedByRunId",i.resolved_at AS "resolvedAt",a.machine_key AS provider,s.machine_key AS surface,COALESCE(v.machine_key,'default') AS variant,r.browser_family AS "browserFamily" FROM health_incidents i JOIN health_runs r ON r.id=i.last_observed_run_id JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id LEFT JOIN ai_variants v ON v.id=r.variant_id WHERE ($1::text IS NULL OR a.machine_key=$1) AND ($2::text IS NULL OR s.machine_key=$2) AND ($3::text IS NULL OR i.status::text=$3) AND ($4::boolean=false OR i.status IN ('OPEN','INVESTIGATING','CANDIDATE_FIX','CANDIDATE_PASS','CANARY_ROLLOUT','ROLLOUT','MAINTENANCE')) AND ($5::uuid IS NULL OR i.id>$5::uuid) ORDER BY i.id LIMIT $6`,
        [
          input.provider ?? null,
          input.surface ?? null,
          input.incidentStatus ?? null,
          input.activeOnly,
          input.cursor ?? null,
          input.limit,
        ],
      );
      const items = result.rows.map(mapIncident);
      return page(items, input.limit, input.cursor ?? null);
    },
    async getIncident(id) {
      const result = await runtime.query<Row>(
        `SELECT i.id,i.status,i.root_contour_key AS "rootContourKey",i.first_seen_run_id AS "firstSeenRunId",i.latest_seen_run_id AS "latestSeenRunId",i.last_observed_run_id AS "lastObservedRunId",i.first_seen_at AS "firstSeenAt",i.last_seen_at AS "lastSeenAt",i.last_observed_at AS "lastObservedAt",i.resolved_by_run_id AS "resolvedByRunId",i.resolved_at AS "resolvedAt",a.machine_key AS provider,s.machine_key AS surface,COALESCE(v.machine_key,'default') AS variant,r.browser_family AS "browserFamily" FROM health_incidents i JOIN health_runs r ON r.id=i.last_observed_run_id JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id LEFT JOIN ai_variants v ON v.id=r.variant_id WHERE i.id=$1`,
        [id],
      );
      return result.rows[0] ? mapIncident(result.rows[0]) : null;
    },
    async listEvaluations(raw) {
      const input = HealthAdminEvaluationQuerySchema.parse(raw);
      const rows = await evaluationRows(runtime, input);
      const items = rows.map((row) => mapEvaluation(row));
      return page(items, input.limit, input.cursor ?? null);
    },
    async getEvaluation(id) {
      const rows = await evaluationRows(
        runtime,
        { limit: 1, cursor: undefined },
        id,
      );
      return rows[0] ? mapEvaluation(rows[0]) : null;
    },
    async listRecommendations(raw) {
      const input = HealthAdminRecommendationQuerySchema.parse(raw);
      const rows = await evaluationRows(
        runtime,
        {
          ...input,
        },
        undefined,
        true,
      );
      const items = rows
        .filter((row) => row.recommendation)
        .map((row) => mapEvaluation(row).recommendationView!)
        .map((value) => HealthRecommendationSchema.parse(value));
      return page(items, input.limit, input.cursor ?? null);
    },
  };
  return repo;
}

function mapIncident(row: Row) {
  return HealthIncidentSummarySchema.parse({
    id: row.id,
    provider: row.provider,
    surface: row.surface,
    variant: row.variant ?? "default",
    browserFamily: row.browserFamily,
    status: row.status,
    rootContourKey: row.rootContourKey ?? null,
    firstSeenRunId: row.firstSeenRunId,
    latestSeenRunId: row.latestSeenRunId,
    lastObservedRunId: row.lastObservedRunId,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    lastObservedAt: iso(row.lastObservedAt),
    resolvedByRunId: row.resolvedByRunId ?? null,
    resolvedAt: iso(row.resolvedAt),
  });
}

function mapTarget(row: Row) {
  const h5Outcome = row.h5_result?.outcome ?? row.h5_outcome ?? null;
  const recommendationValue = recommendation(row.h5_recommendation);
  return HealthAdminTargetDetailSchema.parse({
    targetId: row.target_id,
    provider: row.provider,
    surface: row.surface,
    variant: row.variant,
    monitoringLayer: row.monitoring_layer ?? "NO_SESSION",
    browserFamily: row.browser_family,
    browserVersion: row.browser_version,
    latestHealthState: row.health_state ?? null,
    latestObservationAt: iso(row.completed_at),
    latestSuccessfulRunAt: iso(row.latest_successful_run_at),
    latestSchedulerState: row.scheduler_state ?? null,
    activeIncidentId: row.active_incident_id ?? null,
    baselineProfileRevisionId:
      row.baseline_profile_revision_id ?? row.profile_revision_id ?? null,
    candidateProfileRevisionId: row.candidate_profile_revision_id ?? null,
    candidateState: row.candidate_profile_revision_id
      ? "CANDIDATE_PRESENT"
      : "NO_CANDIDATE",
    latestH4Result: row.h4_outcome ?? null,
    latestH5Result: h5Outcome,
    recommendation: recommendationValue,
    healthSuiteMachineKey: row.suite_machine_key ?? null,
    healthSuiteRevision: row.scope?.healthSuite?.revision ?? null,
    extensionVersion: row.extension_version ?? null,
    adapterEngineVersion: row.adapter_engine_version ?? null,
    baselineProfile: row.baseline_revision
      ? {
          id: row.baseline_profile_revision_id ?? row.profile_revision_id,
          revision: Number(row.baseline_revision),
          state: row.baseline_state,
          contentSha256: row.baseline_sha,
          role: "CURRENT_BASELINE",
        }
      : null,
    candidateProfile: row.candidate_revision
      ? {
          id: row.candidate_profile_revision_id,
          revision: Number(row.candidate_revision),
          state: row.candidate_state,
          contentSha256: row.candidate_sha,
          role: "CANDIDATE",
        }
      : null,
    contourStatuses: [],
    evidenceReferences: [],
    activeIncident: null,
    evaluations: [],
    healthRecommendation: null,
  });
}

async function hydrateTarget(runtime: DatabaseRuntime, row: Row) {
  const target = mapTarget(row);
  const incident = row.active_incident_id
    ? await runtime.query<Row>(
        `SELECT i.id,i.status,i.root_contour_key AS "rootContourKey",i.first_seen_run_id AS "firstSeenRunId",i.latest_seen_run_id AS "latestSeenRunId",i.last_observed_run_id AS "lastObservedRunId",i.first_seen_at AS "firstSeenAt",i.last_seen_at AS "lastSeenAt",i.last_observed_at AS "lastObservedAt",i.resolved_by_run_id AS "resolvedByRunId",i.resolved_at AS "resolvedAt",a.machine_key AS provider,s.machine_key AS surface,COALESCE(v.machine_key,'default') AS variant,r.browser_family AS "browserFamily" FROM health_incidents i JOIN health_runs r ON r.id=i.last_observed_run_id JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id LEFT JOIN ai_variants v ON v.id=r.variant_id WHERE i.id=$1`,
        [row.active_incident_id],
      )
    : { rows: [] };
  const rows = await evaluationRows(runtime, {
    limit: 20,
    cursor: undefined,
    provider: row.provider,
    surface: row.surface,
    browserFamily: row.browser_family,
  });
  const evaluations = rows
    .filter(
      (value) =>
        value.target === row.variant &&
        (value.variant ?? "default") === row.variant,
    )
    .map((value) =>
      mapEvaluation(
        value,
        row.candidate_profile_revision_id ?? row.profile_revision_id,
      ),
    );
  const evidenceRows = await runtime.query<Row>(
    `SELECT evidence_id AS "evidenceId",rule_id AS "ruleId",classification,sha256,size_bytes AS "sizeBytes" FROM health_evidence_references WHERE run_id=$1 ORDER BY contour_key,evidence_id LIMIT 32`,
    [row.run_id],
  );
  const contourRows = await runtime.query<Row>(
    `SELECT contour_key AS "contourKey",result FROM health_contour_results WHERE run_id=$1 ORDER BY contour_key LIMIT 13`,
    [row.run_id],
  );
  const latestRecommendation =
    evaluations
      .filter((value) => value.currentAuthority && value.recommendationView)
      .sort((left, right) =>
        right.latestEvaluatedAt.localeCompare(left.latestEvaluatedAt),
      )[0]?.recommendationView ?? null;
  return HealthAdminTargetDetailSchema.parse({
    ...target,
    contourStatuses: contourRows.rows.map((value) => ({
      contourKey: value.contourKey,
      outcome: value.result?.outcome ?? "UNKNOWN",
    })),
    evidenceReferences: evidenceRows.rows,
    activeIncident: incident.rows[0] ? mapIncident(incident.rows[0]) : null,
    evaluations,
    healthRecommendation: latestRecommendation,
  });
}
