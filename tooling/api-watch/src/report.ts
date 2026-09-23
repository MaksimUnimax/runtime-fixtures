import { randomUUID } from "node:crypto";
import type {
  ApiWatchReport,
  ApiWatchReportSourceOutcome,
  ApiWatchReportState,
  ApiWatchReportStore,
  ApiWatchReportSource,
  ApiWatchSqlRuntime,
  ApiWatchSqlQuery,
  ApiWatchImpactSeverity,
} from "./types.js";

const TERMINAL_STATES = new Set<ApiWatchReportState>([
  "COMPLETED",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
]);

const TRANSITIONS: Record<ApiWatchReportState, readonly ApiWatchReportState[]> =
  {
    CREATED: ["RUNNING"],
    RUNNING: ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"],
    COMPLETED: [],
    PARTIAL: [],
    BLOCKED: [],
    FAILED: [],
  };

function emptyReport(input: {
  reportId?: string;
  runSource: ApiWatchReportSource;
  createdAt: Date;
}): ApiWatchReport {
  return {
    reportId: input.reportId ?? randomUUID(),
    runSource: input.runSource,
    createdAt: new Date(input.createdAt),
    startedAt: null,
    completedAt: null,
    state: "CREATED",
    sources: [],
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    blockingRiskCount: 0,
    reviewRequiredCount: 0,
    unknownCount: 0,
    noPolicyImpactCount: 0,
    overallImpactSeverity: null,
  };
}

function cloneReport(report: ApiWatchReport): ApiWatchReport {
  return {
    ...report,
    createdAt: new Date(report.createdAt),
    startedAt: report.startedAt ? new Date(report.startedAt) : null,
    completedAt: report.completedAt ? new Date(report.completedAt) : null,
    sources: JSON.parse(
      JSON.stringify(report.sources),
    ) as ApiWatchReportSourceOutcome[],
  };
}

function transition(
  report: ApiWatchReport,
  input: Parameters<ApiWatchReportStore["transitionReport"]>[0],
): ApiWatchReport {
  if (!TRANSITIONS[report.state].includes(input.state))
    throw new Error("REPORT_TERMINAL_OR_INVALID_TRANSITION");
  const next = cloneReport(report);
  next.state = input.state;
  if (input.state === "RUNNING") next.startedAt = new Date(input.at);
  if (TERMINAL_STATES.has(input.state)) next.completedAt = new Date(input.at);
  if (input.sources) next.sources = JSON.parse(JSON.stringify(input.sources));
  if (input.counts) Object.assign(next, input.counts);
  return next;
}

export type InMemoryApiWatchReportState = Map<string, ApiWatchReport>;

export function createInMemoryApiWatchReportState(): InMemoryApiWatchReportState {
  return new Map();
}

export class InMemoryApiWatchReportStore implements ApiWatchReportStore {
  public constructor(
    private readonly reports: InMemoryApiWatchReportState = createInMemoryApiWatchReportState(),
  ) {}

  async createReport(
    input: Parameters<ApiWatchReportStore["createReport"]>[0],
  ) {
    const report = emptyReport(input);
    if (this.reports.has(report.reportId))
      throw new Error("REPORT_ALREADY_EXISTS");
    this.reports.set(report.reportId, report);
    return cloneReport(report);
  }

  async getReport(reportId: string) {
    const report = this.reports.get(reportId);
    return report ? cloneReport(report) : undefined;
  }

  async transitionReport(
    input: Parameters<ApiWatchReportStore["transitionReport"]>[0],
  ) {
    const report = this.reports.get(input.reportId);
    if (!report) throw new Error("REPORT_NOT_FOUND");
    const next = transition(report, input);
    this.reports.set(input.reportId, next);
    return cloneReport(next);
  }
}

type ReportRow = {
  reportId: string;
  runSource: ApiWatchReportSource;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  state: ApiWatchReportState;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  blockingRiskCount: number;
  reviewRequiredCount: number;
  unknownCount: number;
  noPolicyImpactCount: number;
  overallImpactSeverity: ApiWatchImpactSeverity | null;
};

type ReportSourceRow = ApiWatchReportSourceOutcome & { reportId: string };

const reportProjection = `SELECT report_id AS "reportId",run_source AS "runSource",created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt",state,added_count AS "addedCount",removed_count AS "removedCount",changed_count AS "changedCount",unchanged_count AS "unchangedCount",blocking_risk_count AS "blockingRiskCount",review_required_count AS "reviewRequiredCount",unknown_count AS "unknownCount",no_policy_impact_count AS "noPolicyImpactCount",overall_impact_severity AS "overallImpactSeverity" FROM api_watch_reports`;

async function readReport(
  query: ApiWatchSqlQuery,
  reportId: string,
): Promise<ApiWatchReport | undefined> {
  const result = await query.query<ReportRow>(
    `${reportProjection} WHERE report_id=$1`,
    [reportId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const sources = await query.query<ReportSourceRow>(
    `SELECT report_id AS "reportId",source_family AS "sourceFamily",acquisition_outcome AS "acquisitionOutcome",authority_status AS "authorityStatus",snapshot_sha256 AS "snapshotSha256",inventory_operation_count AS "inventoryOperationCount",base_snapshot_sha256 AS "baseSnapshotSha256",diff_sha256 AS "diffSha256",impact_severity AS "impactSeverity",blocker_code AS "blockerCode",error_code AS "errorCode",change_mode AS "changeMode",added_count AS "addedCount",removed_count AS "removedCount",changed_count AS "changedCount",unchanged_count AS "unchangedCount",blocking_risk_count AS "blockingRiskCount",review_required_count AS "reviewRequiredCount",unknown_count AS "unknownCount",no_policy_impact_count AS "noPolicyImpactCount" FROM api_watch_report_sources WHERE report_id=$1 ORDER BY source_family`,
    [reportId],
  );
  return {
    ...row,
    sources: sources.rows.map(({ reportId: _reportId, ...source }) => source),
  };
}

export function createPostgresApiWatchReportStore(
  runtime: ApiWatchSqlRuntime,
): ApiWatchReportStore {
  return {
    async createReport(input) {
      const report = emptyReport(input);
      const result = await runtime.query<ReportRow>(
        `INSERT INTO api_watch_reports(report_id,run_source,created_at,state,added_count,removed_count,changed_count,unchanged_count,blocking_risk_count,review_required_count,unknown_count,no_policy_impact_count) VALUES($1,$2,$3,'CREATED',0,0,0,0,0,0,0,0) RETURNING report_id AS "reportId",run_source AS "runSource",created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt",state,added_count AS "addedCount",removed_count AS "removedCount",changed_count AS "changedCount",unchanged_count AS "unchangedCount",blocking_risk_count AS "blockingRiskCount",review_required_count AS "reviewRequiredCount",unknown_count AS "unknownCount",no_policy_impact_count AS "noPolicyImpactCount",overall_impact_severity AS "overallImpactSeverity"`,
        [report.reportId, report.runSource, report.createdAt],
      );
      if (!result.rows[0]) throw new Error("REPORT_CREATE_FAILED");
      return (await readReport(runtime, report.reportId)) ?? report;
    },
    async getReport(reportId) {
      return readReport(runtime, reportId);
    },
    async transitionReport(input) {
      return runtime.transaction(async (query) => {
        const current = await readReport(query, input.reportId);
        if (!current) throw new Error("REPORT_NOT_FOUND");
        const next = transition(current, input);
        const counts = next;
        await query.query(
          `UPDATE api_watch_reports SET state=$2,started_at=$3,completed_at=$4,added_count=$5,removed_count=$6,changed_count=$7,unchanged_count=$8,blocking_risk_count=$9,review_required_count=$10,unknown_count=$11,no_policy_impact_count=$12,overall_impact_severity=$13 WHERE report_id=$1`,
          [
            next.reportId,
            next.state,
            next.startedAt,
            next.completedAt,
            counts.addedCount,
            counts.removedCount,
            counts.changedCount,
            counts.unchangedCount,
            counts.blockingRiskCount,
            counts.reviewRequiredCount,
            counts.unknownCount,
            counts.noPolicyImpactCount,
            counts.overallImpactSeverity,
          ],
        );
        if (input.sources) {
          for (const source of input.sources)
            await query.query(
              `INSERT INTO api_watch_report_sources(report_id,source_family,acquisition_outcome,authority_status,snapshot_sha256,inventory_operation_count,base_snapshot_sha256,diff_sha256,impact_severity,blocker_code,error_code,change_mode,added_count,removed_count,changed_count,unchanged_count,blocking_risk_count,review_required_count,unknown_count,no_policy_impact_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (report_id,source_family) DO UPDATE SET acquisition_outcome=EXCLUDED.acquisition_outcome,authority_status=EXCLUDED.authority_status,snapshot_sha256=EXCLUDED.snapshot_sha256,inventory_operation_count=EXCLUDED.inventory_operation_count,base_snapshot_sha256=EXCLUDED.base_snapshot_sha256,diff_sha256=EXCLUDED.diff_sha256,impact_severity=EXCLUDED.impact_severity,blocker_code=EXCLUDED.blocker_code,error_code=EXCLUDED.error_code,change_mode=EXCLUDED.change_mode,added_count=EXCLUDED.added_count,removed_count=EXCLUDED.removed_count,changed_count=EXCLUDED.changed_count,unchanged_count=EXCLUDED.unchanged_count,blocking_risk_count=EXCLUDED.blocking_risk_count,review_required_count=EXCLUDED.review_required_count,unknown_count=EXCLUDED.unknown_count,no_policy_impact_count=EXCLUDED.no_policy_impact_count`,
              [
                next.reportId,
                source.sourceFamily,
                source.acquisitionOutcome,
                source.authorityStatus,
                source.snapshotSha256,
                source.inventoryOperationCount,
                source.baseSnapshotSha256,
                source.diffSha256,
                source.impactSeverity,
                source.blockerCode,
                source.errorCode,
                source.changeMode,
                source.addedCount,
                source.removedCount,
                source.changedCount,
                source.unchangedCount,
                source.blockingRiskCount,
                source.reviewRequiredCount,
                source.unknownCount,
                source.noPolicyImpactCount,
              ],
            );
        }
        return next;
      });
    },
  };
}
