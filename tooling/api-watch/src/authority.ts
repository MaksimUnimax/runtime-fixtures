import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE,
  parseSwaggerDocument,
  SwaggerSourceFamilySchema,
  type SwaggerArtifact,
  type SwaggerSourceFamily,
  type SwaggerSourceStore,
} from "@product/monitoring-control";
import type {
  ApiWatchSqlRuntime,
  ApiWatchStore,
  AuthorityPassResult,
  AuthorityRecord,
  AuthorityRecordInput,
  AuthorityStatus,
  OperatorCandidateReview,
  SemanticDiff,
  SemanticDiffOperation,
  SourceRegistry,
} from "./types.js";
import { runDocumentAuthorityPass } from "./source-set.js";
import {
  WB_BUNDLE_DOCUMENT_KEY,
  WB_BUNDLE_OFFICIAL_URL,
  WB_BUNDLE_VERSION,
  validateWbBundle,
} from "./wb-bundle.js";

function cloneRecord(record: AuthorityRecord): AuthorityRecord {
  return {
    ...record,
    acquiredAt: record.acquiredAt ? new Date(record.acquiredAt) : null,
    validatedAt: new Date(record.validatedAt),
    safeProvenance: { ...record.safeProvenance },
  };
}

function cloneSnapshot<T extends { createdAt: Date }>(value: T): T {
  return { ...value, createdAt: new Date(value.createdAt) };
}

function cloneSemanticDiff(diff: SemanticDiff): SemanticDiff {
  return {
    ...diff,
    createdAt: new Date(diff.createdAt),
    methodCountsBefore: { ...diff.methodCountsBefore },
    methodCountsAfter: { ...diff.methodCountsAfter },
    operations: JSON.parse(
      JSON.stringify(diff.operations),
    ) as SemanticDiffOperation[],
  };
}

export type InMemoryApiWatchState = {
  authorities: Map<string, AuthorityRecord>;
  snapshots: Map<string, import("./types.js").SnapshotMetadata>;
  inventories: Map<string, import("./types.js").OperationInventory>;
  diffs: Map<string, SemanticDiff>;
};

export function createInMemoryApiWatchState(): InMemoryApiWatchState {
  return {
    authorities: new Map(),
    snapshots: new Map(),
    inventories: new Map(),
    diffs: new Map(),
  };
}

export class InMemoryApiWatchStore implements ApiWatchStore {
  public constructor(
    private readonly state: InMemoryApiWatchState = createInMemoryApiWatchState(),
  ) {}

  async saveAuthorityRecord(
    input: AuthorityRecordInput,
  ): Promise<AuthorityRecord> {
    const record: AuthorityRecord = {
      ...input,
      recordId: input.recordId ?? randomUUID(),
      safeProvenance: { ...input.safeProvenance },
    };
    this.state.authorities.set(record.recordId, record);
    return cloneRecord(record);
  }

  async listAuthorityRecords() {
    return [...this.state.authorities.values()]
      .sort((a, b) => a.validatedAt.valueOf() - b.validatedAt.valueOf())
      .map(cloneRecord);
  }

  async findAuthorityRecord(recordId: string) {
    const record = this.state.authorities.get(recordId);
    return record ? cloneRecord(record) : undefined;
  }

  async saveSnapshot(metadata: import("./types.js").SnapshotMetadata) {
    const key = `${metadata.sourceFamily}:${metadata.sha256}`;
    const existing = this.state.snapshots.get(key);
    if (existing) return cloneSnapshot(existing);
    this.state.snapshots.set(key, { ...metadata });
    return cloneSnapshot(metadata);
  }

  async listSnapshots() {
    return [...this.state.snapshots.values()].map(cloneSnapshot);
  }

  async saveInventory(inventory: import("./types.js").OperationInventory) {
    this.state.inventories.set(
      `${inventory.sourceFamily}:${inventory.snapshotSha256}`,
      JSON.parse(
        JSON.stringify(inventory),
      ) as import("./types.js").OperationInventory,
    );
  }

  async findInventory(
    sourceFamily: SwaggerSourceFamily,
    snapshotSha256: string,
  ) {
    const inventory = this.state.inventories.get(
      `${sourceFamily}:${snapshotSha256}`,
    );
    return inventory
      ? (JSON.parse(
          JSON.stringify(inventory),
        ) as import("./types.js").OperationInventory)
      : undefined;
  }

  async saveSemanticDiff(diff: SemanticDiff): Promise<SemanticDiff> {
    const key = `${diff.sourceFamily}:${diff.baseSnapshotSha256}:${diff.targetSnapshotSha256}:${diff.diffSha256}`;
    const existing = this.state.diffs.get(key);
    if (existing) return cloneSemanticDiff(existing);
    this.state.diffs.set(key, cloneSemanticDiff(diff));
    return cloneSemanticDiff(diff);
  }

  async findSemanticDiff(
    sourceFamily: SwaggerSourceFamily,
    baseSnapshotSha256: string,
    targetSnapshotSha256: string,
    diffSha256: string,
  ): Promise<SemanticDiff | undefined> {
    const diff = this.state.diffs.get(
      `${sourceFamily}:${baseSnapshotSha256}:${targetSnapshotSha256}:${diffSha256}`,
    );
    return diff ? cloneSemanticDiff(diff) : undefined;
  }
}

type AuthorityRow = {
  recordId: string;
  sourceFamily: string;
  officialUrl: string | null;
  acquisitionMode: string;
  authorityStatus: string;
  sha256: string | null;
  sizeBytes: number | null;
  specVersion: string | null;
  acquiredAt: Date | null;
  validatedAt: Date;
  operatorRequestId: string | null;
  artifactExtension: string | null;
  safeProvenance: unknown;
  failureClassification: string | null;
};

const authorityProjection = `SELECT record_id AS "recordId",source_family AS "sourceFamily",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",authority_status AS "authorityStatus",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",acquired_at AS "acquiredAt",validated_at AS "validatedAt",operator_request_id AS "operatorRequestId",artifact_extension AS "artifactExtension",safe_provenance AS "safeProvenance",failure_classification AS "failureClassification" FROM api_watch_authority_records`;

function mapAuthority(row: AuthorityRow): AuthorityRecord {
  return {
    ...row,
    sourceFamily: SwaggerSourceFamilySchema.parse(row.sourceFamily),
    acquisitionMode: row.acquisitionMode as AuthorityRecord["acquisitionMode"],
    authorityStatus: row.authorityStatus as AuthorityStatus,
    safeProvenance:
      row.safeProvenance && typeof row.safeProvenance === "object"
        ? (row.safeProvenance as Record<string, unknown>)
        : {},
  };
}

export function createPostgresApiWatchStore(
  runtime: ApiWatchSqlRuntime,
): ApiWatchStore {
  return {
    async saveAuthorityRecord(input) {
      const recordId = input.recordId ?? randomUUID();
      const result = await runtime.query<AuthorityRow>(
        `INSERT INTO api_watch_authority_records(record_id,source_family,official_url,acquisition_mode,authority_status,sha256,size_bytes,spec_version,acquired_at,validated_at,operator_request_id,artifact_extension,safe_provenance,failure_classification) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING record_id AS "recordId",source_family AS "sourceFamily",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",authority_status AS "authorityStatus",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",acquired_at AS "acquiredAt",validated_at AS "validatedAt",operator_request_id AS "operatorRequestId",artifact_extension AS "artifactExtension",safe_provenance AS "safeProvenance",failure_classification AS "failureClassification"`,
        [
          recordId,
          input.sourceFamily,
          input.officialUrl,
          input.acquisitionMode,
          input.authorityStatus,
          input.sha256,
          input.sizeBytes,
          input.specVersion,
          input.acquiredAt,
          input.validatedAt,
          input.operatorRequestId,
          input.artifactExtension,
          JSON.stringify(input.safeProvenance),
          input.failureClassification,
        ],
      );
      if (!result.rows[0])
        throw new Error("API_WATCH_AUTHORITY_RECORD_CREATE_FAILED");
      return mapAuthority(result.rows[0]);
    },
    async listAuthorityRecords() {
      const result = await runtime.query<AuthorityRow>(
        `${authorityProjection} ORDER BY validated_at,record_id`,
      );
      return result.rows.map(mapAuthority);
    },
    async findAuthorityRecord(recordId) {
      const result = await runtime.query<AuthorityRow>(
        `${authorityProjection} WHERE record_id=$1`,
        [recordId],
      );
      return result.rows[0] ? mapAuthority(result.rows[0]) : undefined;
    },
    async saveSnapshot(metadata) {
      const existing = await runtime.query<Record<string, unknown>>(
        `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey" FROM api_watch_snapshots WHERE source_family=$1 AND sha256=$2`,
        [metadata.sourceFamily, metadata.sha256],
      );
      if (existing.rows[0]) return existing.rows[0] as never as typeof metadata;
      const result = await runtime.query<Record<string, unknown>>(
        `INSERT INTO api_watch_snapshots(snapshot_id,source_family,sha256,size_bytes,spec_version,official_url,acquisition_mode,created_at,authority_record_id,artifact_path,document_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey"`,
        [
          metadata.snapshotId,
          metadata.sourceFamily,
          metadata.sha256,
          metadata.sizeBytes,
          metadata.specVersion,
          metadata.officialUrl,
          metadata.acquisitionMode,
          metadata.createdAt,
          metadata.authorityRecordId,
          metadata.artifactPath,
          metadata.documentKey ?? null,
        ],
      );
      if (!result.rows[0]) throw new Error("API_WATCH_SNAPSHOT_CREATE_FAILED");
      return result.rows[0] as never as typeof metadata;
    },
    async listSnapshots() {
      const result = await runtime.query<Record<string, unknown>>(
        `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey" FROM api_watch_snapshots ORDER BY created_at,snapshot_id`,
      );
      return result.rows as never as import("./types.js").SnapshotMetadata[];
    },
    async saveInventory(inventory) {
      await runtime.query(
        `INSERT INTO api_watch_inventories(source_family,snapshot_sha256,path_count,operation_count,deprecated_count,operation_id_present_count,operation_id_missing_count,operations_by_method,inventory) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT (source_family,snapshot_sha256) DO UPDATE SET path_count=EXCLUDED.path_count,operation_count=EXCLUDED.operation_count,deprecated_count=EXCLUDED.deprecated_count,operation_id_present_count=EXCLUDED.operation_id_present_count,operation_id_missing_count=EXCLUDED.operation_id_missing_count,operations_by_method=EXCLUDED.operations_by_method,inventory=EXCLUDED.inventory`,
        [
          inventory.sourceFamily,
          inventory.snapshotSha256,
          inventory.pathCount,
          inventory.operationCount,
          inventory.deprecatedCount,
          inventory.operationIdPresentCount,
          inventory.operationIdMissingCount,
          JSON.stringify(inventory.operationsByMethod),
          JSON.stringify(inventory),
        ],
      );
    },
    async findInventory(sourceFamily, snapshotSha256) {
      const result = await runtime.query<{ inventory: unknown }>(
        `SELECT inventory FROM api_watch_inventories WHERE source_family=$1 AND snapshot_sha256=$2`,
        [sourceFamily, snapshotSha256],
      );
      return result.rows[0]?.inventory as
        | import("./types.js").OperationInventory
        | undefined;
    },
    async saveSemanticDiff(diff) {
      const existing = await this.findSemanticDiff(
        diff.sourceFamily,
        diff.baseSnapshotSha256,
        diff.targetSnapshotSha256,
        diff.diffSha256,
      );
      if (existing) return existing;
      await runtime.transaction(async (query) => {
        await query.query(
          `INSERT INTO api_watch_semantic_diffs(diff_id,source_family,base_snapshot_sha256,target_snapshot_sha256,diff_sha256,created_at,base_path_count,target_path_count,base_operation_count,target_operation_count,added_count,removed_count,changed_count,unchanged_count,method_counts_before,method_counts_after,deprecated_before,deprecated_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18) ON CONFLICT (source_family,base_snapshot_sha256,target_snapshot_sha256,diff_sha256) DO NOTHING`,
          [
            diff.diffId,
            diff.sourceFamily,
            diff.baseSnapshotSha256,
            diff.targetSnapshotSha256,
            diff.diffSha256,
            diff.createdAt,
            diff.basePathCount,
            diff.targetPathCount,
            diff.baseOperationCount,
            diff.targetOperationCount,
            diff.addedCount,
            diff.removedCount,
            diff.changedCount,
            diff.unchangedCount,
            JSON.stringify(diff.methodCountsBefore),
            JSON.stringify(diff.methodCountsAfter),
            diff.deprecatedBefore,
            diff.deprecatedAfter,
          ],
        );
        for (const operation of diff.operations)
          await query.query(
            `INSERT INTO api_watch_semantic_diff_operations(diff_id,identity,source_family,method,path,state,before_operation,after_operation,deltas) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) ON CONFLICT (diff_id,identity) DO NOTHING`,
            [
              diff.diffId,
              operation.identity,
              operation.sourceFamily,
              operation.method,
              operation.path,
              operation.state,
              JSON.stringify(operation.before),
              JSON.stringify(operation.after),
              JSON.stringify(operation.deltas),
            ],
          );
      });
      return diff;
    },
    async findSemanticDiff(
      sourceFamily,
      baseSnapshotSha256,
      targetSnapshotSha256,
      diffSha256,
    ) {
      const summary = await runtime.query<Record<string, unknown>>(
        `SELECT diff_id AS "diffId",source_family AS "sourceFamily",base_snapshot_sha256 AS "baseSnapshotSha256",target_snapshot_sha256 AS "targetSnapshotSha256",diff_sha256 AS "diffSha256",created_at AS "createdAt",base_path_count AS "basePathCount",target_path_count AS "targetPathCount",base_operation_count AS "baseOperationCount",target_operation_count AS "targetOperationCount",added_count AS "addedCount",removed_count AS "removedCount",changed_count AS "changedCount",unchanged_count AS "unchangedCount",method_counts_before AS "methodCountsBefore",method_counts_after AS "methodCountsAfter",deprecated_before AS "deprecatedBefore",deprecated_after AS "deprecatedAfter" FROM api_watch_semantic_diffs WHERE source_family=$1 AND base_snapshot_sha256=$2 AND target_snapshot_sha256=$3 AND diff_sha256=$4`,
        [sourceFamily, baseSnapshotSha256, targetSnapshotSha256, diffSha256],
      );
      const row = summary.rows[0];
      if (!row) return undefined;
      const operations = await runtime.query<Record<string, unknown>>(
        `SELECT identity,source_family AS "sourceFamily",method,path,state,before_operation AS "before",after_operation AS "after",deltas FROM api_watch_semantic_diff_operations WHERE diff_id=$1 ORDER BY source_family,path,method,identity`,
        [row.diffId],
      );
      return {
        ...(row as unknown as Omit<SemanticDiff, "operations" | "createdAt">),
        createdAt: new Date(row.createdAt as string | Date),
        methodCountsBefore: row.methodCountsBefore as Record<string, number>,
        methodCountsAfter: row.methodCountsAfter as Record<string, number>,
        operations: operations.rows as unknown as SemanticDiffOperation[],
      };
    },
  };
}

export async function runAuthorityPass(input: {
  registry: SourceRegistry;
  store: ApiWatchStore;
  pendingStore: SwaggerSourceStore;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<AuthorityPassResult> {
  const pass = await runDocumentAuthorityPass(input);
  return { outcomes: pass.outcomes, records: pass.records };
}

function invalidCandidate(reason: string): OperatorCandidateReview {
  return { kind: "AUTHORITY_REJECTED", reason };
}

function candidatePath(root: string, artifact: SwaggerArtifact): string {
  const filename = basename(artifact.quarantineFilename);
  const path = resolve(root, filename);
  if (
    path !== resolve(root, filename) ||
    filename !== artifact.quarantineFilename
  )
    throw new Error("QUARANTINE_PATH_INVALID");
  return path;
}

export async function evaluateOperatorCandidate(input: {
  requestId: string;
  registry: SourceRegistry;
  pendingStore: SwaggerSourceStore;
  store: ApiWatchStore;
  quarantineDir: string;
  now?: () => Date;
}): Promise<OperatorCandidateReview> {
  const now = input.now ?? (() => new Date());
  const request = await input.pendingStore.getRequest(input.requestId);
  if (!request) return invalidCandidate("PENDING_REQUEST_NOT_FOUND");
  if (request.status === "CANCELLED" || request.status === "EXPIRED")
    return invalidCandidate("PENDING_REQUEST_FINALIZED");
  const entry = input.registry.get(request.sourceFamily);
  const isWbBundle =
    request.sourceFamily === "WILDBERRIES" &&
    request.documentKey === WB_BUNDLE_DOCUMENT_KEY;
  if (isWbBundle) {
    if (
      request.officialUrl !== WB_BUNDLE_OFFICIAL_URL ||
      request.bundleVersion !== WB_BUNDLE_VERSION
    )
      return invalidCandidate("WB_BUNDLE_REQUEST_METADATA_INVALID");
  }
  const registeredDocument = request.documentKey
    ? entry.documents?.find(
        (document) => document.documentKey === request.documentKey,
      )
    : undefined;
  const currentOfficialUrl =
    registeredDocument?.officialUrl ?? entry.officialUrl;
  if (request.documentKey && !registeredDocument && !isWbBundle)
    return invalidCandidate("DOCUMENT_KEY_NOT_CURRENT_AUTHORITY");
  if (!currentOfficialUrl && !isWbBundle)
    return {
      kind: "AUTHORITY_BLOCKED",
      reason: "SOURCE_URL_AUTHORITY_MISSING",
    };
  if (!isWbBundle && request.officialUrl !== currentOfficialUrl)
    return invalidCandidate("PENDING_URL_NOT_CURRENT_AUTHORITY");
  const candidates = (
    await input.pendingStore.listArtifacts(request.requestId)
  ).filter((artifact) => artifact.status === "CANDIDATE_READY");
  const candidate = candidates[0];
  if (!candidate) return invalidCandidate("CANDIDATE_NOT_READY");
  if (candidate.requestId !== request.requestId)
    return invalidCandidate("REQUEST_ID_MISMATCH");
  if (candidate.sourceFamily !== request.sourceFamily)
    return invalidCandidate("SOURCE_FAMILY_MISMATCH");
  if (candidate.officialUrl !== request.officialUrl)
    return invalidCandidate("OFFICIAL_URL_MISMATCH");
  if (candidate.authorityState !== OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE)
    return invalidCandidate("CANDIDATE_STATE_INVALID");
  let bytes: Uint8Array;
  try {
    bytes = await readFile(candidatePath(input.quarantineDir, candidate));
  } catch {
    return invalidCandidate("CANDIDATE_BYTES_UNAVAILABLE");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== candidate.sha256)
    return invalidCandidate("CANDIDATE_DIGEST_MISMATCH");
  if (bytes.byteLength !== candidate.sizeBytes)
    return invalidCandidate("CANDIDATE_SIZE_MISMATCH");
  if (isWbBundle) {
    let bundle: ReturnType<typeof validateWbBundle>;
    try {
      bundle = validateWbBundle(bytes, candidate.originalFilename);
    } catch (error) {
      return invalidCandidate(
        error instanceof Error ? error.message : "WB_BUNDLE_INVALID",
      );
    }
    const records: AuthorityRecord[] = [];
    for (const document of bundle.documents) {
      records.push(
        await input.store.saveAuthorityRecord({
          sourceFamily: "WILDBERRIES",
          officialUrl: document.officialUrl,
          acquisitionMode: "OPERATOR_SUPPLIED",
          authorityStatus: "AUTHORITY_ACCEPTED",
          sha256: document.sha256,
          sizeBytes: document.byteLength,
          specVersion: document.specVersion,
          acquiredAt: candidate.receivedAt,
          validatedAt: now(),
          operatorRequestId: request.requestId,
          artifactExtension: ".yaml",
          safeProvenance: {
            bundleArtifactId: candidate.artifactId,
            bundleVersion: bundle.bundleVersion,
            documentKey: document.documentKey,
            familyManifestSha256: bundle.familyManifestSha256,
            outerBundleSha256: bundle.outerSha256,
          },
          failureClassification: null,
        }),
      );
    }
    return {
      kind: "AUTHORITY_ACCEPTED",
      record: records[0]!,
      records,
      familyManifestSha256: bundle.familyManifestSha256,
      documentKeys: records.map((record) =>
        String(record.safeProvenance.documentKey),
      ),
    };
  }
  if (
    candidate.parserResult.parsed !== true ||
    candidate.validationResult.recognizedVersion !== true
  )
    return invalidCandidate("CANDIDATE_VALIDATION_INVALID");
  let parsed: ReturnType<typeof parseSwaggerDocument>;
  try {
    parsed = parseSwaggerDocument(bytes, candidate.originalFilename);
  } catch {
    return invalidCandidate("CANDIDATE_REPARSE_FAILED");
  }
  const record = await input.store.saveAuthorityRecord({
    sourceFamily: request.sourceFamily,
    officialUrl: request.officialUrl,
    acquisitionMode: "OPERATOR_SUPPLIED",
    authorityStatus:
      entry.operatorAcceptancePolicy === "DETERMINISTIC"
        ? "AUTHORITY_ACCEPTED"
        : "AUTHORITY_REVIEW_REQUIRED",
    sha256: candidate.sha256,
    sizeBytes: candidate.sizeBytes,
    specVersion: parsed.version,
    acquiredAt: candidate.receivedAt,
    validatedAt: now(),
    operatorRequestId: request.requestId,
    artifactExtension: candidate.originalFilename.slice(
      candidate.originalFilename.lastIndexOf("."),
    ),
    safeProvenance: {
      candidateArtifactId: candidate.artifactId,
      ...(request.documentKey ? { documentKey: request.documentKey } : {}),
    },
    failureClassification: null,
  });
  return record.authorityStatus === "AUTHORITY_ACCEPTED"
    ? { kind: "AUTHORITY_ACCEPTED", record }
    : { kind: "AUTHORITY_REVIEW_REQUIRED", record };
}
