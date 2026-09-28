import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

export const API_WATCH_PRODUCT_BASELINE_SOURCE_FAMILIES = [
  "OZON_SELLER",
  "OZON_PERFORMANCE",
  "WILDBERRIES",
] as const;

export type ApiWatchProductBaselineSourceFamily =
  (typeof API_WATCH_PRODUCT_BASELINE_SOURCE_FAMILIES)[number];

export interface ApiWatchProductBaselineScope {
  sourceFamily: ApiWatchProductBaselineSourceFamily;
  documentKey: string | null;
}

export interface ApiWatchProductBaseline extends ApiWatchProductBaselineScope {
  baselineId: string;
  snapshotId: string;
  snapshotSha256: string;
  snapshotSpecVersion: string;
  revision: number;
  acceptedAt: Date;
  acceptedBy: string;
  acceptanceReference: string;
}

export interface AcceptApiWatchProductBaselineInput
  extends ApiWatchProductBaselineScope {
  snapshotId: string;
  expectedRevision: number | null;
  acceptedAt: Date;
  acceptedBy: string;
  acceptanceReference: string;
}

export interface ApiWatchProductBaselineRepository {
  read(
    scope: ApiWatchProductBaselineScope,
  ): Promise<ApiWatchProductBaseline | undefined>;
  accept(
    input: AcceptApiWatchProductBaselineInput,
  ): Promise<ApiWatchProductBaseline>;
}

type BaselineRow = {
  baseline_id: string;
  source_family: ApiWatchProductBaselineSourceFamily;
  document_key: string | null;
  snapshot_id: string;
  snapshot_sha256: string;
  snapshot_spec_version: string;
  revision: number | string;
  accepted_at: Date | string;
  accepted_by: string;
  acceptance_reference: string;
};

type SnapshotScopeRow = {
  snapshot_id: string;
  source_family: ApiWatchProductBaselineSourceFamily;
  document_key: string | null;
};

const sourceFamilies = new Set<string>(
  API_WATCH_PRODUCT_BASELINE_SOURCE_FAMILIES,
);

function requireText(value: string, maxLength: number, code: string): void {
  if (!value || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(code);
  }
}

function validateScope(scope: ApiWatchProductBaselineScope): void {
  if (!sourceFamilies.has(scope.sourceFamily)) {
    throw new Error("API_WATCH_PRODUCT_BASELINE_SOURCE_FAMILY_INVALID");
  }
  if (scope.documentKey !== null) {
    requireText(
      scope.documentKey,
      128,
      "API_WATCH_PRODUCT_BASELINE_DOCUMENT_KEY_INVALID",
    );
  }
}

function validateAcceptInput(input: AcceptApiWatchProductBaselineInput): void {
  validateScope(input);
  requireText(
    input.snapshotId,
    160,
    "API_WATCH_PRODUCT_BASELINE_SNAPSHOT_ID_INVALID",
  );
  requireText(
    input.acceptedBy,
    128,
    "API_WATCH_PRODUCT_BASELINE_ACCEPTED_BY_INVALID",
  );
  requireText(
    input.acceptanceReference,
    256,
    "API_WATCH_PRODUCT_BASELINE_ACCEPTANCE_REFERENCE_INVALID",
  );
  if (
    input.expectedRevision !== null &&
    (!Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1)
  ) {
    throw new Error("API_WATCH_PRODUCT_BASELINE_EXPECTED_REVISION_INVALID");
  }
  if (
    !(input.acceptedAt instanceof Date) ||
    !Number.isFinite(input.acceptedAt.valueOf())
  ) {
    throw new Error("API_WATCH_PRODUCT_BASELINE_ACCEPTED_AT_INVALID");
  }
}

function mapBaseline(row: BaselineRow): ApiWatchProductBaseline {
  return {
    baselineId: row.baseline_id,
    sourceFamily: row.source_family,
    documentKey: row.document_key,
    snapshotId: row.snapshot_id,
    snapshotSha256: row.snapshot_sha256,
    snapshotSpecVersion: row.snapshot_spec_version,
    revision: Number(row.revision),
    acceptedAt: new Date(row.accepted_at),
    acceptedBy: row.accepted_by,
    acceptanceReference: row.acceptance_reference,
  };
}

async function readBaseline(
  query: DatabaseQuery,
  scope: ApiWatchProductBaselineScope,
  lock = false,
): Promise<ApiWatchProductBaseline | undefined> {
  const result = await query.query<BaselineRow>(
    `SELECT baseline.baseline_id,baseline.source_family,baseline.document_key,baseline.snapshot_id,
            snapshot.sha256 AS snapshot_sha256,snapshot.spec_version AS snapshot_spec_version,
            baseline.revision,baseline.accepted_at,baseline.accepted_by,baseline.acceptance_reference
       FROM api_watch_product_baselines baseline
       JOIN api_watch_snapshots snapshot ON snapshot.snapshot_id=baseline.snapshot_id
      WHERE baseline.source_family=$1
        AND baseline.document_key IS NOT DISTINCT FROM $2
      ${lock ? "FOR UPDATE OF baseline" : ""}`,
    [scope.sourceFamily, scope.documentKey],
  );
  return result.rows[0] ? mapBaseline(result.rows[0]) : undefined;
}

function scopeMatches(
  snapshot: SnapshotScopeRow,
  input: ApiWatchProductBaselineScope,
): boolean {
  return (
    snapshot.source_family === input.sourceFamily &&
    snapshot.document_key === input.documentKey
  );
}

export function createApiWatchProductBaselineRepository(
  runtime: DatabaseRuntime,
): ApiWatchProductBaselineRepository {
  return {
    async read(scope) {
      validateScope(scope);
      return readBaseline(runtime, scope);
    },

    async accept(input) {
      validateAcceptInput(input);
      return runtime.transaction(async (tx) => {
        const snapshotResult = await tx.query<SnapshotScopeRow>(
          `SELECT snapshot_id,source_family,document_key
             FROM api_watch_snapshots
            WHERE snapshot_id=$1
            FOR SHARE`,
          [input.snapshotId],
        );
        const snapshot = snapshotResult.rows[0];
        if (!snapshot) {
          throw new Error("API_WATCH_PRODUCT_BASELINE_SNAPSHOT_NOT_FOUND");
        }
        if (!scopeMatches(snapshot, input)) {
          throw new Error("API_WATCH_PRODUCT_BASELINE_SCOPE_MISMATCH");
        }

        const current = await readBaseline(tx, input, true);
        if (!current) {
          if (input.expectedRevision !== null) {
            throw new Error("API_WATCH_PRODUCT_BASELINE_REVISION_MISMATCH");
          }
          const inserted = await tx.query<{ baseline_id: string }>(
            `INSERT INTO api_watch_product_baselines(
               baseline_id,source_family,document_key,snapshot_id,revision,
               accepted_at,accepted_by,acceptance_reference
             ) VALUES(gen_random_uuid(),$1,$2,$3,1,$4,$5,$6)
             ON CONFLICT DO NOTHING
             RETURNING baseline_id`,
            [
              input.sourceFamily,
              input.documentKey,
              input.snapshotId,
              input.acceptedAt,
              input.acceptedBy,
              input.acceptanceReference,
            ],
          );
          const baselineId = inserted.rows[0]?.baseline_id;
          if (!baselineId) {
            throw new Error("API_WATCH_PRODUCT_BASELINE_REVISION_MISMATCH");
          }
          await tx.query(
            `INSERT INTO api_watch_product_baseline_revisions(
               baseline_id,revision,source_family,document_key,previous_snapshot_id,
               snapshot_id,accepted_at,accepted_by,acceptance_reference
             ) VALUES($1,1,$2,$3,NULL,$4,$5,$6,$7)`,
            [
              baselineId,
              input.sourceFamily,
              input.documentKey,
              input.snapshotId,
              input.acceptedAt,
              input.acceptedBy,
              input.acceptanceReference,
            ],
          );
          const created = await readBaseline(tx, input);
          if (!created) {
            throw new Error("API_WATCH_PRODUCT_BASELINE_CREATE_FAILED");
          }
          return created;
        }

        if (input.expectedRevision !== current.revision) {
          throw new Error("API_WATCH_PRODUCT_BASELINE_REVISION_MISMATCH");
        }

        const updated = await tx.query<{ revision: number | string }>(
          `UPDATE api_watch_product_baselines
              SET snapshot_id=$2,revision=revision+1,accepted_at=$3,
                  accepted_by=$4,acceptance_reference=$5
            WHERE baseline_id=$1 AND revision=$6
            RETURNING revision`,
          [
            current.baselineId,
            input.snapshotId,
            input.acceptedAt,
            input.acceptedBy,
            input.acceptanceReference,
            input.expectedRevision,
          ],
        );
        const nextRevision = Number(updated.rows[0]?.revision);
        if (!Number.isSafeInteger(nextRevision)) {
          throw new Error("API_WATCH_PRODUCT_BASELINE_REVISION_MISMATCH");
        }

        await tx.query(
          `INSERT INTO api_watch_product_baseline_revisions(
             baseline_id,revision,source_family,document_key,previous_snapshot_id,
             snapshot_id,accepted_at,accepted_by,acceptance_reference
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            current.baselineId,
            nextRevision,
            input.sourceFamily,
            input.documentKey,
            current.snapshotId,
            input.snapshotId,
            input.acceptedAt,
            input.acceptedBy,
            input.acceptanceReference,
          ],
        );

        const next = await readBaseline(tx, input);
        if (!next) {
          throw new Error("API_WATCH_PRODUCT_BASELINE_UPDATE_FAILED");
        }
        return next;
      });
    },
  };
}
