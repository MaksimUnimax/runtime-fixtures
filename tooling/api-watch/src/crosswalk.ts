import { randomUUID } from "node:crypto";
import type {
  ApiWatchSqlRuntime,
  ProductCrosswalkRow,
  ProductCrosswalkStore,
} from "./types.js";

function clone(row: ProductCrosswalkRow): ProductCrosswalkRow {
  return { ...row, createdAt: new Date(row.createdAt) };
}

export class InMemoryProductCrosswalkStore implements ProductCrosswalkStore {
  private readonly rows = new Map<string, ProductCrosswalkRow>();
  async saveRows(rows: ProductCrosswalkRow[]) {
    for (const row of rows) this.rows.set(row.crosswalkId, { ...row, crosswalkId: row.crosswalkId || randomUUID() });
    return rows.map((row) => clone(this.rows.get(row.crosswalkId)!));
  }
  async listRows(reportId: string) {
    return [...this.rows.values()].filter((row) => row.reportId === reportId).sort((a, b) => a.sourceIdentity.localeCompare(b.sourceIdentity)).map(clone);
  }
}

export function createPostgresProductCrosswalkStore(runtime: ApiWatchSqlRuntime): ProductCrosswalkStore {
  return {
    async saveRows(rows) {
      for (const row of rows)
        await runtime.query(
          `INSERT INTO api_watch_product_crosswalk(crosswalk_id,report_id,source_family,source_identity,runtime_alias,crosswalk_state,review_state,execution_enabled,impact_severity,diff_sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (crosswalk_id) DO UPDATE SET review_state=EXCLUDED.review_state,execution_enabled=EXCLUDED.execution_enabled,impact_severity=EXCLUDED.impact_severity,diff_sha256=EXCLUDED.diff_sha256`,
          [row.crosswalkId, row.reportId, row.sourceFamily, row.sourceIdentity, row.runtimeAlias, row.crosswalkState, row.reviewState, row.executionEnabled, row.impactSeverity, row.diffSha256, row.createdAt],
        );
      return rows;
    },
    async listRows(reportId) {
      const result = await runtime.query<Record<string, unknown>>(
        `SELECT crosswalk_id AS "crosswalkId",report_id AS "reportId",source_family AS "sourceFamily",source_identity AS "sourceIdentity",runtime_alias AS "runtimeAlias",crosswalk_state AS "crosswalkState",review_state AS "reviewState",execution_enabled AS "executionEnabled",impact_severity AS "impactSeverity",diff_sha256 AS "diffSha256",created_at AS "createdAt" FROM api_watch_product_crosswalk WHERE report_id=$1 ORDER BY source_family,source_identity`,
        [reportId],
      );
      return result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt as string | Date) }) as unknown as ProductCrosswalkRow);
    },
  };
}
