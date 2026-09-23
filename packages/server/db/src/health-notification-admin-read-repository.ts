import {
  HealthIncidentSummarySchema,
  HealthNotificationAdminQuerySchema,
  HealthNotificationIntentDetailSchema,
  HealthNotificationIntentSummarySchema,
  type HealthNotificationAdminQuery,
  type HealthNotificationIntentDetail,
  type HealthNotificationIntentSummary,
  type HealthNotificationAdminReadRepository,
} from "@product/health";
import type { DatabaseRuntime } from "./index.js";

type Row = Record<string, unknown>;

const iso = (value: unknown): string => new Date(String(value)).toISOString();

function cursorValue(input: HealthNotificationAdminQuery): {
  createdAt: Date | null;
  id: string | null;
} {
  if (!input.cursor) return { createdAt: null, id: null };
  const [createdAt, id] = input.cursor.split("~", 2);
  if (!createdAt || !id) throw new Error("INVALID_NOTIFICATION_CURSOR");
  return { createdAt: new Date(createdAt), id };
}

function nextCursor(items: HealthNotificationIntentSummary[], limit: number) {
  if (items.length !== limit) return null;
  const last = items[items.length - 1]!;
  return `${last.createdAt}~${last.id}`;
}

function providerSink(value: unknown, lastErrorCode: unknown) {
  if (value === "deterministic-test-sink") return "DETERMINISTIC_TEST_SINK";
  if (value === "disabled-sink" || lastErrorCode === "DISABLED_ROUTE")
    return "DISABLED_SINK";
  return null;
}

function providerResultCode(
  state: unknown,
  lastErrorCode: unknown,
): HealthNotificationIntentSummary["lastProviderResultCode"] {
  if (state === "DELIVERED") return "DELIVERED";
  switch (lastErrorCode) {
    case "TRANSIENT_PROVIDER_FAILURE":
    case "RATE_LIMIT":
    case "CONFIGURATION_ERROR":
    case "PERMANENT_PROVIDER_REJECTION":
    case "DISABLED_ROUTE":
      return lastErrorCode;
    case null:
    case undefined:
      return null;
    default:
      return "UNKNOWN";
  }
}

function suppressionReason(
  value: unknown,
): HealthNotificationIntentSummary["suppressionReason"] {
  switch (value) {
    case "COOLDOWN":
    case "MAINTENANCE_ENTERED":
    case "DISABLED_ROUTE":
      return value;
    case null:
    case undefined:
      return null;
    default:
      return "OTHER";
  }
}

function mapSummary(row: Row): HealthNotificationIntentSummary {
  return HealthNotificationIntentSummarySchema.parse({
    id: row.id,
    sourceDomain: "LLM_HEALTH",
    incidentId: row.incidentId,
    eventKind: row.eventKind,
    severity: row.severity,
    state: row.state,
    routeKey: row.routeKey,
    groupCount: Number(row.groupCount),
    attemptCount: Number(row.attemptCount),
    nextAttemptAt: iso(row.nextAttemptAt),
    deliveredAt: row.deliveredAt == null ? null : iso(row.deliveredAt),
    suppressionReason: suppressionReason(row.suppressionReason),
    firstObservedAt: iso(row.firstObservedAt),
    latestObservedAt: iso(row.latestObservedAt),
    cooldownUntil: iso(row.cooldownUntil),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    lastProviderResultCode: providerResultCode(row.state, row.lastErrorCode),
    providerSink: providerSink(row.providerAdapterKey, row.lastErrorCode),
    provider: row.provider,
    surface: row.surface,
  });
}

function mapIncident(row: Row) {
  return HealthIncidentSummarySchema.parse({
    id: row.incidentId,
    provider: row.incidentProvider,
    surface: row.incidentSurface,
    variant: row.incidentVariant ?? "default",
    browserFamily: row.incidentBrowserFamily,
    status: row.incidentStatus,
    rootContourKey: row.incidentRootContourKey ?? null,
    firstSeenRunId: row.firstSeenRunId,
    latestSeenRunId: row.latestSeenRunId,
    lastObservedRunId: row.lastObservedRunId,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    lastObservedAt: iso(row.lastObservedAt),
    resolvedByRunId: row.resolvedByRunId ?? null,
    resolvedAt: row.resolvedAt == null ? null : iso(row.resolvedAt),
  });
}

const notificationBase = `
  SELECT
    n.id,n.incident_id AS "incidentId",n.health_run_id AS "healthRunId",
    n.event_kind AS "eventKind",n.severity,n.route_key AS "routeKey",n.state,
    n.group_count AS "groupCount",n.first_observed_at AS "firstObservedAt",
    n.latest_observed_at AS "latestObservedAt",n.cooldown_until AS "cooldownUntil",
    n.next_attempt_at AS "nextAttemptAt",n.attempt_count AS "attemptCount",
    n.claim_expires_at AS "claimExpiresAt",n.last_error_code AS "lastErrorCode",
    n.suppression_reason AS "suppressionReason",n.retention_class AS "retentionClass",
    n.expires_at AS "expiresAt",n.provider_adapter_key AS "providerAdapterKey",
    n.delivered_at AS "deliveredAt",n.created_at AS "createdAt",n.updated_at AS "updatedAt",
    source_a.machine_key AS provider,source_s.machine_key AS surface,
    COALESCE(source_v.machine_key,'default') AS variant,
    source_r.health_state AS "healthState",source_r.health_level AS "healthLevel",
    source_r.browser_family AS "browserFamily",source_r.browser_version AS "browserVersion",
    i.status AS "incidentStatus",i.root_contour_key AS "incidentRootContourKey",
    i.first_seen_run_id AS "firstSeenRunId",i.latest_seen_run_id AS "latestSeenRunId",
    i.last_observed_run_id AS "lastObservedRunId",i.first_seen_at AS "firstSeenAt",
    i.last_seen_at AS "lastSeenAt",i.last_observed_at AS "lastObservedAt",
    i.resolved_by_run_id AS "resolvedByRunId",i.resolved_at AS "resolvedAt",
    incident_a.machine_key AS "incidentProvider",
    incident_s.machine_key AS "incidentSurface",
    COALESCE(incident_v.machine_key,'default') AS "incidentVariant",
    incident_r.browser_family AS "incidentBrowserFamily"
  FROM health_notification_intents n
  JOIN health_incidents i ON i.id=n.incident_id
  JOIN health_runs source_r ON source_r.id=n.health_run_id
  JOIN ai_adapters source_a ON source_a.id=source_r.adapter_id
  JOIN ai_surfaces source_s ON source_s.id=source_r.surface_id
  LEFT JOIN ai_variants source_v ON source_v.id=source_r.variant_id
  JOIN health_runs incident_r ON incident_r.id=i.last_observed_run_id
  JOIN ai_adapters incident_a ON incident_a.id=incident_r.adapter_id
  JOIN ai_surfaces incident_s ON incident_s.id=incident_r.surface_id
  LEFT JOIN ai_variants incident_v ON incident_v.id=incident_r.variant_id
  WHERE n.source_domain='LLM_HEALTH'`;

export function createHealthNotificationAdminReadRepository(
  runtime: DatabaseRuntime,
): HealthNotificationAdminReadRepository {
  return {
    async listNotifications(raw) {
      const input = HealthNotificationAdminQuerySchema.parse(raw);
      const cursor = cursorValue(input);
      const result = await runtime.query<Row>(
        `${notificationBase}
          AND ($1::timestamptz IS NULL OR (n.created_at,n.id) < ($1,$2::uuid))
          AND ($3::text IS NULL OR n.state::text=$3)
          AND ($4::text IS NULL OR n.event_kind::text=$4)
          AND ($5::text IS NULL OR n.severity::text=$5)
          AND ($6::uuid IS NULL OR n.incident_id=$6)
          AND ($7::text IS NULL OR source_a.machine_key=$7)
          AND ($8::text IS NULL OR source_s.machine_key=$8)
          AND ($9::text IS NULL OR n.route_key=$9)
        ORDER BY n.created_at DESC,n.id DESC
        LIMIT $10`,
        [
          cursor.createdAt,
          cursor.id,
          input.state ?? null,
          input.eventKind ?? null,
          input.severity ?? null,
          input.incidentId ?? null,
          input.provider ?? null,
          input.surface ?? null,
          input.routeKey ?? null,
          input.limit,
        ],
      );
      const items = result.rows.map(mapSummary);
      return { items, nextCursor: nextCursor(items, input.limit) };
    },

    async getNotification(id): Promise<HealthNotificationIntentDetail | null> {
      const result = await runtime.query<Row>(
        `${notificationBase} AND n.id=$1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      const evidence = await runtime.query<Row>(
        `SELECT evidence_id AS "evidenceId",rule_id AS "ruleId",classification,sha256,size_bytes AS "sizeBytes"
         FROM health_evidence_references
         WHERE run_id=$1
         ORDER BY contour_key,evidence_id
         LIMIT 32`,
        [row.healthRunId],
      );
      const summary = mapSummary(row);
      return HealthNotificationIntentDetailSchema.parse({
        ...summary,
        dedupIdentity: {
          scheme: "LLM_HEALTH_V1",
          eventKind: row.eventKind,
          severity: row.severity,
        },
        claim: {
          state: row.claimExpiresAt ? "CLAIMED" : "UNCLAIMED",
          leaseExpiresAt:
            row.claimExpiresAt == null ? null : iso(row.claimExpiresAt),
          attempt: Number(row.attemptCount),
        },
        sourceHealth: {
          healthRunId: row.healthRunId,
          healthState: row.healthState,
          healthLevel: row.healthLevel,
          browserFamily: row.browserFamily,
          browserVersion: row.browserVersion,
          variant: row.variant,
        },
        incident: mapIncident(row),
        evidenceReferences: evidence.rows,
        retention: {
          retentionClass: row.retentionClass,
          expiresAt: row.expiresAt == null ? null : iso(row.expiresAt),
        },
      });
    },
  };
}
