import { randomUUID } from "node:crypto";
import type {
  ApiWatchIncident,
  ApiWatchIncidentEvent,
  ApiWatchIncidentNotifier,
  ApiWatchIncidentStore,
  ApiWatchImpactSeverity,
  ApiWatchReport,
  ApiWatchSqlRuntime,
  ProductCrosswalkRow,
  SwaggerSourceFamily,
} from "./types.js";

function copy(value: ApiWatchIncident): ApiWatchIncident {
  return { ...value, firstSeenAt: new Date(value.firstSeenAt), lastSeenAt: new Date(value.lastSeenAt), resolvedAt: value.resolvedAt ? new Date(value.resolvedAt) : null };
}
export function incidentKey(type: ApiWatchIncident["incidentType"], sourceFamily: SwaggerSourceFamily | null, operationIdentity: string | null): string {
  return `${type}:${sourceFamily ?? "GLOBAL"}:${operationIdentity ?? "SOURCE"}`;
}

export class InMemoryApiWatchIncidentStore implements ApiWatchIncidentStore {
  private readonly incidents = new Map<string, ApiWatchIncident>();
  async observe(input: Omit<ApiWatchIncident, "incidentId" | "occurrenceCount" | "state" | "resolvedAt">) {
    const existing = this.incidents.get(input.incidentKey);
    if (existing) {
      const next = { ...existing, ...input, lastSeenAt: new Date(input.lastSeenAt), occurrenceCount: existing.occurrenceCount + 1, state: "OPEN" as const, resolvedAt: null };
      this.incidents.set(input.incidentKey, next);
      return { incident: copy(next), opened: existing.state !== "OPEN" };
    }
    const created: ApiWatchIncident = { ...input, incidentId: randomUUID(), occurrenceCount: 1, state: "OPEN", resolvedAt: null };
    this.incidents.set(input.incidentKey, created);
    return { incident: copy(created), opened: true };
  }
  async resolve(key: string, at: Date) {
    const current = this.incidents.get(key);
    if (!current || current.state !== "OPEN") return undefined;
    const next = { ...current, state: "RESOLVED" as const, resolvedAt: new Date(at), lastSeenAt: new Date(at) };
    this.incidents.set(key, next);
    return copy(next);
  }
  async listOpen() { return [...this.incidents.values()].filter((x) => x.state === "OPEN").sort((a, b) => a.incidentKey.localeCompare(b.incidentKey)).map(copy); }
  async find(key: string) { const value = this.incidents.get(key); return value ? copy(value) : undefined; }
}

export function createPostgresApiWatchIncidentStore(runtime: ApiWatchSqlRuntime): ApiWatchIncidentStore {
  const projection = `SELECT incident_id AS "incidentId",incident_key AS "incidentKey",incident_type AS "incidentType",source_family AS "sourceFamily",operation_identity AS "operationIdentity",first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt",resolved_at AS "resolvedAt",occurrence_count AS "occurrenceCount",severity,latest_report_id AS "latestReportId",latest_diff_sha256 AS "latestDiffSha256",safe_summary_code AS "safeSummaryCode",state FROM api_watch_incidents`;
  const map = (row: Record<string, unknown>) => ({ ...row, firstSeenAt: new Date(row.firstSeenAt as string | Date), lastSeenAt: new Date(row.lastSeenAt as string | Date), resolvedAt: row.resolvedAt ? new Date(row.resolvedAt as string | Date) : null }) as unknown as ApiWatchIncident;
  return {
    async observe(input) {
      const current = await runtime.query<Record<string, unknown>>(`${projection} WHERE incident_key=$1`, [input.incidentKey]);
      const row = current.rows[0];
      const opened = !row || row.state !== "OPEN";
      const incidentId = row?.incidentId ?? randomUUID();
      await runtime.query(`INSERT INTO api_watch_incidents(incident_id,incident_key,incident_type,source_family,operation_identity,first_seen_at,last_seen_at,resolved_at,occurrence_count,severity,latest_report_id,latest_diff_sha256,safe_summary_code,state) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,'OPEN') ON CONFLICT (incident_key) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,resolved_at=NULL,occurrence_count=api_watch_incidents.occurrence_count+1,severity=EXCLUDED.severity,latest_report_id=EXCLUDED.latest_report_id,latest_diff_sha256=EXCLUDED.latest_diff_sha256,safe_summary_code=EXCLUDED.safe_summary_code,state='OPEN'`, [incidentId, input.incidentKey, input.incidentType, input.sourceFamily, input.operationIdentity, input.firstSeenAt, input.lastSeenAt, row ? Number(row.occurrenceCount) + 1 : 1, input.severity, input.latestReportId, input.latestDiffSha256, input.safeSummaryCode]);
      const saved = await runtime.query<Record<string, unknown>>(`${projection} WHERE incident_key=$1`, [input.incidentKey]);
      return { incident: map(saved.rows[0]!), opened };
    },
    async resolve(key, at) {
      await runtime.query(`UPDATE api_watch_incidents SET state='RESOLVED',resolved_at=$2,last_seen_at=$2 WHERE incident_key=$1 AND state='OPEN'`, [key, at]);
      const result = await runtime.query<Record<string, unknown>>(`${projection} WHERE incident_key=$1`, [key]);
      return result.rows[0] ? map(result.rows[0]) : undefined;
    },
    async listOpen() { const result = await runtime.query<Record<string, unknown>>(`${projection} WHERE state='OPEN' ORDER BY incident_key`); return result.rows.map(map); },
    async find(key) { const result = await runtime.query<Record<string, unknown>>(`${projection} WHERE incident_key=$1`, [key]); return result.rows[0] ? map(result.rows[0]) : undefined; },
  };
}

async function observeAndNotify(store: ApiWatchIncidentStore, notifier: ApiWatchIncidentNotifier | undefined, input: Omit<ApiWatchIncident, "incidentId" | "occurrenceCount" | "state" | "resolvedAt">) {
  const result = await store.observe(input);
  if (result.opened && notifier) await notifier({ kind: "OPENED", incident: result.incident });
  return result.incident;
}

function incidentInput(type: ApiWatchIncident["incidentType"], family: SwaggerSourceFamily | null, operationIdentity: string | null, report: ApiWatchReport, severity: ApiWatchImpactSeverity, summary: string, now: Date, diff: string | null) {
  return { incidentKey: incidentKey(type, family, operationIdentity), incidentType: type, sourceFamily: family, operationIdentity, firstSeenAt: now, lastSeenAt: now, severity, latestReportId: report.reportId, latestDiffSha256: diff, safeSummaryCode: summary };
}

export async function evaluateApiWatchIncidents(input: { report: ApiWatchReport; crosswalkRows?: ProductCrosswalkRow[]; store: ApiWatchIncidentStore; notifier?: ApiWatchIncidentNotifier; now?: Date }) {
  const now = input.now ?? new Date();
  const activeKeys = new Set<string>();
  for (const source of input.report.sources) {
    if (source.blockerCode === "SOURCE_URL_AUTHORITY_MISSING" || source.acquisitionOutcome === "SOURCE_URL_AUTHORITY_MISSING") {
      const value = await observeAndNotify(input.store, input.notifier, incidentInput("SOURCE_AUTHORITY_BLOCKED", source.sourceFamily, null, input.report, "BLOCKING_RISK", "SOURCE_URL_AUTHORITY_MISSING", now, null));
      activeKeys.add(value.incidentKey);
    }
  }
  if (input.report.state === "FAILED") {
    const value = await observeAndNotify(input.store, input.notifier, incidentInput("WATCH_RUN_FAILED", null, null, input.report, "BLOCKING_RISK", "WATCH_RUN_FAILED", now, null));
    activeKeys.add(value.incidentKey);
  }
  for (const row of input.crosswalkRows ?? []) {
    if (row.reviewState === "NO_ACTION") continue;
    const type = row.crosswalkState === "AMBIGUOUS_RUNTIME_MAPPING" ? "RUNTIME_MAPPING_AMBIGUOUS" : row.crosswalkState === "SOURCE_ONLY" ? "RUNTIME_OPERATION_STALE" : row.reviewState === "BLOCKING_RISK" ? "API_CHANGE_BLOCKING" : "API_CHANGE_REVIEW_REQUIRED";
    const severity = row.reviewState === "BLOCKING_RISK" ? "BLOCKING_RISK" : "REVIEW_REQUIRED";
    const value = await observeAndNotify(input.store, input.notifier, incidentInput(type, row.sourceFamily, row.sourceIdentity, input.report, severity, type, now, row.diffSha256));
    activeKeys.add(value.incidentKey);
  }
  if (input.report.state === "COMPLETED") {
    for (const open of await input.store.listOpen()) {
      if (activeKeys.has(open.incidentKey)) continue;
      if (open.incidentType === "WATCH_RUN_FAILED" || open.incidentType === "API_CHANGE_BLOCKING" || open.incidentType === "API_CHANGE_REVIEW_REQUIRED" || open.incidentType === "RUNTIME_OPERATION_STALE" || open.incidentType === "RUNTIME_MAPPING_AMBIGUOUS") {
        const resolved = await input.store.resolve(open.incidentKey, now);
        if (resolved && input.notifier) await input.notifier({ kind: "RESOLVED", incident: resolved });
      }
    }
  }
  return input.store.listOpen();
}

export function safeIncidentNotification(event: ApiWatchIncidentEvent): string {
  const incident = event.incident;
  return `${event.kind === "OPENED" ? "API-watch incident" : "API-watch incident resolved"}: ${incident.sourceFamily ?? "GLOBAL"} ${incident.incidentType} ${incident.severity} ${incident.safeSummaryCode} report=${incident.latestReportId}`;
}
