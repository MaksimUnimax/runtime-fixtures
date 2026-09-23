/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  HealthDiagnosticsBreakdownSchema,
  HealthDiagnosticsQuerySchema,
  HealthDiagnosticsSummarySchema,
  type HealthDiagnosticsBreakdown,
  type HealthDiagnosticsQuery,
  type HealthDiagnosticsReadRepository,
  type HealthDiagnosticsStateCount,
  type HealthDiagnosticsSummary,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";

type Row = Record<string, any>;
const WINDOWS = {
  "1h": 60,
  "24h": 1_440,
  "7d": 10_080,
  "30d": 43_200,
} as const;
const STATES = [
  "HEALTHY",
  "DRIFT",
  "DEGRADED",
  "BROKEN",
  "UNKNOWN",
  "MAINTENANCE",
] as const;
const ACTIVE = [
  "OPEN",
  "INVESTIGATING",
  "CANDIDATE_FIX",
  "CANDIDATE_PASS",
  "CANARY_ROLLOUT",
  "ROLLOUT",
  "MAINTENANCE",
];

function windowBounds(
  window: HealthDiagnosticsQuery["window"],
  now = new Date(),
) {
  const end = new Date(now);
  const start = new Date(end.valueOf() - WINDOWS[window] * 60_000);
  const floor = new Date(end.valueOf() - WINDOWS["30d"] * 60_000);
  return { start, end, floor };
}

function values(input: HealthDiagnosticsQuery, now: Date) {
  const bounds = windowBounds(input.window, now);
  return [
    bounds.start,
    bounds.end,
    input.provider ?? null,
    input.surface ?? null,
    input.browserFamily ?? null,
    input.browserVersion ?? null,
    input.profileRevisionId ?? null,
    input.healthState ?? null,
    input.incidentStatus ?? null,
    bounds.floor,
  ];
}

const runFilters = `
  AND ($3::text IS NULL OR a.machine_key=$3)
  AND ($4::text IS NULL OR s.machine_key=$4)
  AND ($5::text IS NULL OR r.browser_family=$5)
  AND ($6::text IS NULL OR r.browser_version=$6)
  AND ($7::uuid IS NULL OR r.profile_revision_id=$7)
  AND ($8::text IS NULL OR r.health_state=$8)`;

const incidentFilters = `
  AND ($3::text IS NULL OR ia.machine_key=$3)
  AND ($4::text IS NULL OR isf.machine_key=$4)
  AND ($5::text IS NULL OR ir.browser_family=$5)
  AND ($6::text IS NULL OR ir.browser_version=$6)
  AND ($7::uuid IS NULL OR ir.profile_revision_id=$7)
  AND ($9::text IS NULL OR i.status::text=$9)`;

function iso(value: unknown): string | null {
  return value == null ? null : new Date(String(value)).toISOString();
}

function counts(rows: Row[]): HealthDiagnosticsStateCount[] {
  const map = new Map(
    rows.map((row) => [String(row.state), Number(row.count)]),
  );
  return STATES.map((state) => ({ state, count: map.get(state) ?? 0 }));
}

function parseQuery(raw: HealthDiagnosticsQuery): HealthDiagnosticsQuery {
  return HealthDiagnosticsQuerySchema.parse(raw);
}

export function createHealthDiagnosticsReadRepository(
  runtime: DatabaseRuntime,
  clock: () => Date = () => new Date(),
): HealthDiagnosticsReadRepository {
  return {
    async getSummary(raw) {
      const input = parseQuery(raw);
      const now = clock();
      const bounds = windowBounds(input.window, now);
      const args = values(input, now);
      const [targets, stateRows, incidents, notifications, scheduler] =
        await Promise.all([
          runtime
            .query<Row>(
              `WITH latest AS (
             SELECT DISTINCT ON (r.scope_sha256)
               r.scope_sha256 AS "targetId",a.machine_key AS provider,s.machine_key AS surface,
               COALESCE(v.machine_key,'default') AS variant,COALESCE(sr.probe_layer::text,r.scope->>'monitoringLayer','NO_SESSION') AS "monitoringLayer",
               r.browser_family AS "browserFamily",r.browser_version AS "browserVersion",
               r.health_state AS "latestHealthState",r.completed_at AS "latestCompletedRunAt",
               r.scope_sha256,r.profile_revision_id,r.adapter_id,r.surface_id,r.variant_id
             FROM health_runs r
             JOIN ai_adapters a ON a.id=r.adapter_id
             JOIN ai_surfaces s ON s.id=r.surface_id AND s.adapter_id=r.adapter_id
             LEFT JOIN ai_variants v ON v.id=r.variant_id AND v.surface_id=r.surface_id
             LEFT JOIN health_scheduled_runs sr ON sr.health_run_id=r.id
             WHERE r.completed_at >= LEAST($10::timestamptz,$1::timestamptz) AND r.completed_at < $2 ${runFilters}
             ORDER BY r.scope_sha256,r.completed_at DESC,r.id DESC
           ),
           healthy AS (
             SELECT r.scope_sha256,max(r.completed_at) AS "latestHealthyAt"
             FROM health_runs r JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id
             WHERE r.completed_at >= LEAST($10::timestamptz,$1::timestamptz) AND r.completed_at < $2 AND r.health_state='HEALTHY' ${runFilters}
             GROUP BY r.scope_sha256
           ),
           active_incidents AS (
             SELECT scope_sha256,count(*)::int AS count,max(last_observed_at) AS observed_at
             FROM health_incidents WHERE status::text = ANY($11::text[])
               AND ($9::text IS NULL OR status::text=$9)
             GROUP BY scope_sha256
           ),
           current_assignment AS (
             SELECT DISTINCT ON (a.adapter_id,a.surface_id,a.variant_id,a.browser_family)
               a.adapter_id,a.surface_id,a.variant_id,a.browser_family,
               ar.baseline_profile_revision_id,ar.candidate_profile_revision_id
             FROM adapter_profile_assignments a
             JOIN adapter_profile_assignment_revisions ar ON ar.assignment_id=a.id
             ORDER BY a.adapter_id,a.surface_id,a.variant_id,a.browser_family,ar.revision DESC
           )
           SELECT l.*,h."latestHealthyAt",COALESCE(ai.count,0) AS "activeIncidentCount",
             COALESCE(ca.baseline_profile_revision_id,l.profile_revision_id) AS "baselineProfileRevisionId",
             b.content_sha256 AS "baselineProfileContentSha256",
             ca.candidate_profile_revision_id AS "candidateProfileRevisionId",
             (SELECT i.root_contour_key FROM health_incidents i WHERE i.scope_sha256=l.scope_sha256
               AND i.status::text = ANY($11::text[]) AND ($9::text IS NULL OR i.status::text=$9)
               ORDER BY i.last_observed_at DESC,i.id DESC LIMIT 1) AS "latestIncidentRoot",
             (SELECT n.state FROM health_notification_intents n JOIN health_incidents ni ON ni.id=n.incident_id
               WHERE ni.scope_sha256=l.scope_sha256 ORDER BY n.updated_at DESC,n.id DESC LIMIT 1) AS "latestNotificationState"
           FROM latest l LEFT JOIN healthy h ON h.scope_sha256=l.scope_sha256
             LEFT JOIN active_incidents ai ON ai.scope_sha256=l.scope_sha256
             LEFT JOIN current_assignment ca ON ca.adapter_id=l.adapter_id AND ca.surface_id=l.surface_id
               AND ca.variant_id IS NOT DISTINCT FROM l.variant_id AND ca.browser_family=l."browserFamily"
             LEFT JOIN adapter_profile_revisions b ON b.id=COALESCE(ca.baseline_profile_revision_id,l.profile_revision_id)
           ORDER BY l.provider,l.surface,l.variant,l."browserFamily",l."browserVersion"
           LIMIT 50`,
              [...args, ACTIVE],
            )
            .catch((error) => {
              throw new Error(`diagnostics targets: ${String(error)}`);
            }),
          runtime
            .query<Row>(
              `SELECT r.health_state AS state,count(*)::int AS count
           FROM health_runs r JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id
           WHERE r.completed_at >= $1 AND r.completed_at < $2 ${runFilters}
           GROUP BY r.health_state ORDER BY r.health_state`,
              args.slice(0, 8),
            )
            .catch((error) => {
              throw new Error(`diagnostics states: ${String(error)}`);
            }),
          runtime.query<Row>(
            `SELECT count(*) FILTER (WHERE i.status::text = ANY($11::text[]))::int AS active,
             max(i.last_observed_at) FILTER (WHERE i.status::text = ANY($11::text[])) AS "latestActiveAt"
           FROM health_incidents i JOIN health_runs ir ON ir.id=i.last_observed_run_id
           JOIN ai_adapters ia ON ia.id=ir.adapter_id JOIN ai_surfaces isf ON isf.id=ir.surface_id
           WHERE i.first_seen_at < $2 AND COALESCE(i.resolved_at,i.last_observed_at) >= $1
             AND $10::timestamptz IS NOT NULL AND ($8::text IS NULL OR ir.health_state=$8) ${incidentFilters}`,
            [...args, ACTIVE],
          ),
          runtime.query<Row>(
            `SELECT
             count(*) FILTER (WHERE n.state='PENDING')::int AS pending,
             count(*) FILTER (WHERE n.state='CLAIMED')::int AS claimed,
             count(*) FILTER (WHERE n.state='FAILED_RETRYABLE')::int AS retryable,
             count(*) FILTER (WHERE n.state='FAILED_TERMINAL')::int AS terminal,
             count(*) FILTER (WHERE n.state='SUPPRESSED')::int AS suppressed,
             count(*) FILTER (WHERE n.state='DELIVERED')::int AS delivered,
             min(n.created_at) FILTER (WHERE n.state='PENDING') AS "oldestPendingAt",
             min(n.next_attempt_at) FILTER (WHERE n.state IN ('PENDING','FAILED_RETRYABLE')) AS "nextRetryAt",
             count(*) FILTER (WHERE n.event_kind='INCIDENT_RECOVERED')::int AS recovered,
             count(*) FILTER (WHERE n.event_kind='INCIDENT_ESCALATED')::int AS escalated
           FROM health_notification_intents n JOIN health_incidents ni ON ni.id=n.incident_id
           JOIN health_runs nr ON nr.id=ni.last_observed_run_id JOIN ai_adapters na ON na.id=nr.adapter_id
           JOIN ai_surfaces ns ON ns.id=nr.surface_id
           WHERE n.source_domain='LLM_HEALTH' AND n.created_at >= $1 AND n.created_at < $2
             AND ($3::text IS NULL OR na.machine_key=$3) AND ($4::text IS NULL OR ns.machine_key=$4)`,
            args.slice(0, 4),
          ),
          runtime.query<Row>(
            `SELECT
             max(finished_at) FILTER (WHERE state='SUCCEEDED') AS "latestSuccessfulScheduledRunAt",
             max(finished_at) FILTER (WHERE state IN ('FAILED_RETRYABLE','FAILED_TERMINAL','TIMED_OUT')) AS "latestFailedScheduledExecutionAt",
             count(*) FILTER (WHERE state='FAILED_RETRYABLE')::int AS "retryingExecutionCount",
             (SELECT count(*)::int FROM health_schedules hs WHERE hs.enabled AND hs.next_due_at < $2
               AND ($3::text IS NULL OR hs.provider=$3) AND ($4::text IS NULL OR hs.surface=$4)) AS "overdueDueTargetCount"
           FROM health_scheduled_runs
           WHERE due_slot_at >= $1 AND due_slot_at < $2
             AND ($3::text IS NULL OR provider=$3) AND ($4::text IS NULL OR surface=$4)`,
            args.slice(0, 4),
          ),
        ]);
      const targetItems = targets.rows.map((row) => ({
        targetId: row.targetId,
        provider: row.provider,
        surface: row.surface,
        variant: row.variant,
        monitoringLayer: row.monitoringLayer ?? "NO_SESSION",
        browserFamily: row.browserFamily ?? null,
        browserVersion: row.browserVersion ?? null,
        observationStatus: (row.latestCompletedRunAt == null
          ? "NO_DATA"
          : new Date(String(row.latestCompletedRunAt)) < bounds.start
            ? "NO_RECENT_RUN"
            : "OBSERVED") as "OBSERVED" | "NO_RECENT_RUN" | "NO_DATA",
        latestHealthState: row.latestHealthState ?? null,
        latestCompletedRunAt: iso(row.latestCompletedRunAt),
        latestHealthyAt: iso(row.latestHealthyAt),
        activeIncidentCount: Number(row.activeIncidentCount),
        latestIncidentRoot: row.latestIncidentRoot ?? null,
        baselineProfileRevisionId: row.baselineProfileRevisionId ?? null,
        baselineProfileContentSha256: row.baselineProfileContentSha256 ?? null,
        candidateProfileRevisionId: row.candidateProfileRevisionId ?? null,
        latestNotificationState: row.latestNotificationState ?? null,
      }));
      const stateCounts = counts(stateRows.rows);
      const incident = incidents.rows[0] ?? {};
      const notification = notifications.rows[0] ?? {};
      const schedule = scheduler.rows[0] ?? {};
      const latest = targetItems.reduce<string | null>(
        (value, row) =>
          !value ||
          (row.latestCompletedRunAt && row.latestCompletedRunAt > value)
            ? row.latestCompletedRunAt
            : value,
        null,
      );
      const result: HealthDiagnosticsSummary = {
        generatedAt: now.toISOString(),
        window: input.window,
        windowStart: bounds.start.toISOString(),
        windowEnd: bounds.end.toISOString(),
        latestHealthObservationAt: latest,
        stale: latest == null || latest < bounds.start.toISOString(),
        currentTargets: targetItems,
        stateCounts,
        productQualityCounts: stateCounts.filter(({ state }) =>
          ["HEALTHY", "DRIFT", "DEGRADED", "BROKEN"].includes(state),
        ),
        environmentCounts: stateCounts.filter(({ state }) =>
          ["UNKNOWN", "MAINTENANCE"].includes(state),
        ),
        activeIncidentCount: Number(incident.active ?? 0),
        notification: {
          pending: Number(notification.pending ?? 0),
          claimed: Number(notification.claimed ?? 0),
          retryableFailures: Number(notification.retryable ?? 0),
          terminalFailures: Number(notification.terminal ?? 0),
          suppressed: Number(notification.suppressed ?? 0),
          delivered: Number(notification.delivered ?? 0),
          oldestPendingAt: iso(notification.oldestPendingAt),
          nextRetryAt: iso(notification.nextRetryAt),
          recentRecoveryNotifications: Number(notification.recovered ?? 0),
          recentEscalationNotifications: Number(notification.escalated ?? 0),
        },
        scheduler: {
          latestSuccessfulScheduledRunAt: iso(
            schedule.latestSuccessfulScheduledRunAt,
          ),
          latestFailedScheduledExecutionAt: iso(
            schedule.latestFailedScheduledExecutionAt,
          ),
          overdueDueTargetCount: Number(schedule.overdueDueTargetCount ?? 0),
          retryingExecutionCount: Number(schedule.retryingExecutionCount ?? 0),
        },
      };
      return HealthDiagnosticsSummarySchema.parse(result);
    },

    async getBreakdown(raw) {
      const input = parseQuery(raw);
      const now = clock();
      const bounds = windowBounds(input.window, now);
      const args = values(input, now);
      const [providerSurface, browsers, profiles, incidentRoots] =
        await Promise.all([
          runtime.query<Row>(
            `SELECT a.machine_key AS provider,s.machine_key AS surface,COALESCE(v.machine_key,'default') AS variant,
             count(*)::int AS count,count(DISTINCT i.id)::int AS "incidentCount"
           FROM health_runs r JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id
           LEFT JOIN ai_variants v ON v.id=r.variant_id LEFT JOIN health_incidents i ON i.scope_sha256=r.scope_sha256
             AND i.status::text = ANY($11::text[]) AND ($9::text IS NULL OR i.status::text=$9)
           WHERE r.completed_at >= GREATEST($1::timestamptz,$10::timestamptz) AND r.completed_at < $2 ${runFilters}
           GROUP BY a.machine_key,s.machine_key,COALESCE(v.machine_key,'default') ORDER BY count DESC,provider,surface,variant LIMIT 100`,
            [...args, ACTIVE],
          ),
          runtime.query<Row>(
            `SELECT r.browser_family AS "browserFamily",r.browser_version AS "browserVersion",'OBSERVED' AS coverage,
             count(*)::int AS count,count(*) FILTER (WHERE r.health_state='UNKNOWN')::int AS "unknownCount"
           FROM health_runs r JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id
           WHERE r.completed_at >= $1 AND r.completed_at < $2 ${runFilters}
           GROUP BY r.browser_family,r.browser_version ORDER BY count DESC,"browserFamily","browserVersion" LIMIT 100`,
            args.slice(0, 8),
          ),
          runtime.query<Row>(
            `SELECT r.profile_revision_id AS "profileRevisionId",p.content_sha256 AS "profileContentSha256",
             count(*)::int AS count,count(DISTINCT i.id)::int AS "incidentCount",r.health_state AS state,
             count(DISTINCT e.id) FILTER (WHERE e.phase='H4_CANDIDATE')::int AS "h4Evaluations",
             count(DISTINCT e.id) FILTER (WHERE e.phase IN ('H5_CANARY','H5_POST_ROLLOUT'))::int AS "h5Evaluations",
             jsonb_agg(DISTINCT jsonb_build_object('state',r.health_state,'count',1)) AS states
           FROM health_runs r JOIN ai_adapters a ON a.id=r.adapter_id JOIN ai_surfaces s ON s.id=r.surface_id
           JOIN adapter_profile_revisions p ON p.id=r.profile_revision_id
           LEFT JOIN health_incidents i ON i.scope_sha256=r.scope_sha256 AND i.status::text = ANY($11::text[])
             AND ($9::text IS NULL OR i.status::text=$9)
           LEFT JOIN health_profile_evaluations e ON e.candidate_profile_revision_id=r.profile_revision_id OR e.baseline_profile_revision_id=r.profile_revision_id
           WHERE r.completed_at >= GREATEST($1::timestamptz,$10::timestamptz) AND r.completed_at < $2 ${runFilters}
           GROUP BY r.profile_revision_id,p.content_sha256,r.health_state ORDER BY count DESC LIMIT 100`,
            [...args, ACTIVE],
          ),
          runtime.query<Row>(
            `SELECT i.root_contour_key AS "rootContourKey",i.status,ia.machine_key AS provider,isf.machine_key AS surface,
             count(*) FILTER (WHERE i.status::text = ANY($11::text[]))::int AS "activeCount",
             count(*) FILTER (WHERE i.first_seen_at >= $1 AND i.first_seen_at < $2)::int AS "newCount",
             count(*) FILTER (WHERE i.resolved_at >= $1 AND i.resolved_at < $2)::int AS "resolvedCount",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(i.resolved_at,i.last_observed_at)-i.first_seen_at))) AS "medianDurationSeconds",
             min(i.first_seen_at) FILTER (WHERE i.status::text = ANY($11::text[])) AS "oldestActiveAt"
           FROM health_incidents i JOIN health_runs ir ON ir.id=i.last_observed_run_id
           JOIN ai_adapters ia ON ia.id=ir.adapter_id JOIN ai_surfaces isf ON isf.id=ir.surface_id
           WHERE i.first_seen_at < $2 AND COALESCE(i.resolved_at,i.last_observed_at) >= $1
             AND $10::timestamptz IS NOT NULL AND ($8::text IS NULL OR ir.health_state=$8) ${incidentFilters}
           GROUP BY i.root_contour_key,i.status,ia.machine_key,isf.machine_key ORDER BY "activeCount" DESC,"newCount" DESC LIMIT 100`,
            [...args, ACTIVE],
          ),
        ]);
      const result: HealthDiagnosticsBreakdown = {
        generatedAt: now.toISOString(),
        window: input.window,
        windowStart: bounds.start.toISOString(),
        windowEnd: bounds.end.toISOString(),
        providerSurface: providerSurface.rows.map((row) => ({
          provider: row.provider,
          surface: row.surface,
          variant: row.variant,
          count: Number(row.count),
          incidentCount: Number(row.incidentCount),
        })),
        browsers: browsers.rows.map((row) => ({
          browserFamily: row.browserFamily,
          browserVersion: row.browserVersion,
          coverage: "OBSERVED",
          count: Number(row.count),
          unknownCount: Number(row.unknownCount),
        })),
        profiles: Array.from(
          profiles.rows
            .reduce((map, row) => {
              const current = map.get(String(row.profileRevisionId)) ?? {
                profileRevisionId: row.profileRevisionId,
                profileContentSha256: row.profileContentSha256,
                count: 0,
                incidentCount: 0,
                healthStates: [] as Array<{
                  state: (typeof STATES)[number];
                  count: number;
                }>,
                h4Evaluations: 0,
                h5Evaluations: 0,
              };
              current.count += Number(row.count);
              current.incidentCount = Math.max(
                current.incidentCount,
                Number(row.incidentCount),
              );
              current.healthStates.push({
                state: row.state,
                count: Number(row.count),
              });
              current.h4Evaluations = Math.max(
                current.h4Evaluations,
                Number(row.h4Evaluations),
              );
              current.h5Evaluations = Math.max(
                current.h5Evaluations,
                Number(row.h5Evaluations),
              );
              map.set(String(row.profileRevisionId), current);
              return map;
            }, new Map<string, any>())
            .values(),
        ),
        incidentRoots: incidentRoots.rows.map((row) => ({
          rootContourKey: row.rootContourKey ?? null,
          status: row.status,
          provider: row.provider,
          surface: row.surface,
          activeCount: Number(row.activeCount),
          newCount: Number(row.newCount),
          resolvedCount: Number(row.resolvedCount),
          medianDurationSeconds:
            row.medianDurationSeconds == null
              ? null
              : Number(row.medianDurationSeconds),
          oldestActiveAt: iso(row.oldestActiveAt),
        })),
      };
      return HealthDiagnosticsBreakdownSchema.parse(result);
    },
  };
}
