import { operatorPipelineConsumed } from "./operator-receipt.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE,
  parseSwaggerDocument,
  parseSwaggerSizeBytes,
  SwaggerSourceFamilySchema,
  type SwaggerArtifact,
  type SwaggerSourceFamily,
  type SwaggerSourceStore,
} from "@product/monitoring-control";
import type {
  ApiWatchSqlRuntime,
  ApiWatchSqlQuery,
  ApiWatchStore,
  ApiWatchReportStore,
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
  authorityRecordSequence,
  nextAuthorityRecordSequence,
  compareAuthorityRecordOrder,
} from "./authority-order.js";
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

function authorityIdentity(record: AuthorityRecordInput): string {
  return JSON.stringify([
    record.sourceFamily,
    record.officialUrl,
    record.acquisitionMode,
    record.authorityStatus,
    record.sha256,
    record.sizeBytes,
    record.specVersion,
    record.operatorRequestId,
    record.artifactExtension,
    record.failureClassification,
    record.acquiredAt?.toISOString() ?? null,
    Object.entries(record.safeProvenance)
      .filter(([key]) => key !== "authorityRecordSequence")
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
function assertSameAuthority(
  existing: AuthorityRecord,
  input: AuthorityRecordInput,
): void {
  if (authorityIdentity(existing) !== authorityIdentity(input))
    throw new Error("API_WATCH_AUTHORITY_IDENTITY_COLLISION");
}

export class InMemoryApiWatchStore implements ApiWatchStore {
  public constructor(
    private readonly state: InMemoryApiWatchState = createInMemoryApiWatchState(),
  ) {}

  async saveAuthorityRecord(
    input: AuthorityRecordInput,
  ): Promise<AuthorityRecord> {
    return (await this.saveAuthorityRecords([input]))[0]!;
  }

  async saveAuthorityRecords(
    inputs: AuthorityRecordInput[],
  ): Promise<AuthorityRecord[]> {
    let sequence = [...this.state.authorities.values()].reduce(
      (latest, prior) => Math.max(latest, authorityRecordSequence(prior)),
      0,
    );
    const records = inputs.map((input) => {
      const existing = input.recordId
        ? this.state.authorities.get(input.recordId)
        : undefined;
      if (existing) {
        assertSameAuthority(existing, input);
        return existing;
      }
      sequence = nextAuthorityRecordSequence(sequence);
      return {
        ...input,
        recordId: input.recordId ?? randomUUID(),
        safeProvenance: {
          ...input.safeProvenance,
          authorityRecordSequence: sequence,
        },
      };
    });
    // Validate and construct every row before publishing any family member.
    for (const record of records)
      this.state.authorities.set(record.recordId, record);
    return records.map(cloneRecord);
  }

  async listAuthorityRecords() {
    return [...this.state.authorities.values()]
      .sort(compareAuthorityRecordOrder)
      .map(cloneRecord);
  }

  async findAuthorityRecord(recordId: string) {
    const record = this.state.authorities.get(recordId);
    return record ? cloneRecord(record) : undefined;
  }

  async saveSnapshot(metadata: import("./types.js").SnapshotMetadata) {
    const key = JSON.stringify([
      metadata.sourceFamily,
      metadata.documentKey ?? null,
      metadata.sha256,
    ]);
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
  sizeBytes: number | string | null;
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
    sizeBytes:
      row.sizeBytes === null ? null : parseSwaggerSizeBytes(row.sizeBytes),
    sourceFamily: SwaggerSourceFamilySchema.parse(row.sourceFamily),
    acquisitionMode: row.acquisitionMode as AuthorityRecord["acquisitionMode"],
    authorityStatus: row.authorityStatus as AuthorityStatus,
    safeProvenance:
      row.safeProvenance && typeof row.safeProvenance === "object"
        ? (row.safeProvenance as Record<string, unknown>)
        : {},
  };
}

async function persistAuthorityRecord(
  transaction: ApiWatchSqlQuery,
  input: AuthorityRecordInput,
): Promise<AuthorityRecord> {
  const recordId = input.recordId ?? randomUUID();
  // Serialize the next provenance order with its insert across store
  // instances. This uses the existing schema and preserves validatedAt.
  await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "api-watch:authority-record-sequence-v1",
  ]);
  const prior = await transaction.query<AuthorityRow>(
    authorityProjection + " WHERE record_id=$1",
    [recordId],
  );
  if (prior.rows[0]) {
    const existing = mapAuthority(prior.rows[0]);
    assertSameAuthority(existing, input);
    return existing;
  }
  const latest = await transaction.query<{ sequence: string }>(
    "SELECT COALESCE(MAX((safe_provenance->>'authorityRecordSequence')::bigint),0)::text AS sequence FROM api_watch_authority_records",
  );
  if (!latest.rows[0])
    throw new Error("API_WATCH_AUTHORITY_SEQUENCE_READ_FAILED");
  const sequence = nextAuthorityRecordSequence(Number(latest.rows[0].sequence));
  const result = await transaction.query<AuthorityRow>(
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
      JSON.stringify({
        ...input.safeProvenance,
        authorityRecordSequence: sequence,
      }),
      input.failureClassification,
    ],
  );
  if (!result.rows[0])
    throw new Error("API_WATCH_AUTHORITY_RECORD_CREATE_FAILED");
  return mapAuthority(result.rows[0]);
}

function mapSnapshot(
  row: Record<string, unknown>,
): import("./types.js").SnapshotMetadata {
  return {
    ...(row as unknown as import("./types.js").SnapshotMetadata),
    sizeBytes: parseSwaggerSizeBytes(row.sizeBytes),
    createdAt: new Date(row.createdAt as Date | string),
  };
}

export function createPostgresApiWatchStore(
  runtime: ApiWatchSqlRuntime,
): ApiWatchStore {
  return {
    async saveAuthorityRecord(input) {
      return runtime.transaction((query) =>
        persistAuthorityRecord(query, input),
      );
    },
    async saveAuthorityRecords(inputs) {
      return runtime.transaction(async (query) => {
        const records: AuthorityRecord[] = [];
        for (const input of inputs)
          records.push(await persistAuthorityRecord(query, input));
        return records;
      });
    },
    async listAuthorityRecords() {
      const result = await runtime.query<AuthorityRow>(
        `${authorityProjection} ORDER BY validated_at,record_id`,
      );
      return result.rows.map(mapAuthority).sort(compareAuthorityRecordOrder);
    },
    async findAuthorityRecord(recordId) {
      const result = await runtime.query<AuthorityRow>(
        `${authorityProjection} WHERE record_id=$1`,
        [recordId],
      );
      return result.rows[0] ? mapAuthority(result.rows[0]) : undefined;
    },
    async saveSnapshot(metadata) {
      const findExisting = () =>
        runtime.query<Record<string, unknown>>(
          `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey" FROM api_watch_snapshots WHERE source_family=$1 AND document_key IS NOT DISTINCT FROM $2 AND sha256=$3`,
          [
            metadata.sourceFamily,
            metadata.documentKey ?? null,
            metadata.sha256,
          ],
        );
      const existing = await findExisting();
      if (existing.rows[0]) return mapSnapshot(existing.rows[0]);
      const result = await runtime.query<Record<string, unknown>>(
        `INSERT INTO api_watch_snapshots(snapshot_id,source_family,sha256,size_bytes,spec_version,official_url,acquisition_mode,created_at,authority_record_id,artifact_path,document_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey"`,
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
      if (result.rows[0]) return mapSnapshot(result.rows[0]);
      // The competing complete pipeline may publish the same immutable snapshot
      // after our pre-read. Keep its provenance; never update an accepted row.
      const committed = await findExisting();
      if (committed.rows[0]) return mapSnapshot(committed.rows[0]);
      throw new Error("API_WATCH_SNAPSHOT_CREATE_FAILED");
    },
    async listSnapshots() {
      const result = await runtime.query<Record<string, unknown>>(
        `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath",document_key AS "documentKey" FROM api_watch_snapshots ORDER BY created_at,snapshot_id`,
      );
      return result.rows.map(mapSnapshot);
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
  skipOperatorBlocked?: boolean;
  quarantineDir?: string;
  reportStore?: ApiWatchReportStore;
}): Promise<AuthorityPassResult> {
  const ready = await input.pendingStore.listReadyRequests();
  const request = ready.find(
    (request) =>
      request.sourceFamily === "WILDBERRIES" &&
      request.documentKey === WB_BUNDLE_DOCUMENT_KEY &&
      input.registry
        .list()
        .some(
          (entry) =>
            entry.sourceFamily === "WILDBERRIES" &&
            entry.documents?.length === 13,
        ),
  );
  const quarantineDir =
    input.quarantineDir ??
    process.env.SWAGGER_QUARANTINE_DIR ??
    "/var/lib/octoport/api-watch/quarantine";
  let operator: AuthorityPassResult | undefined;
  const artifact = request
    ? (await input.pendingStore.listArtifacts(request.requestId)).find(
        (candidate) => candidate.status === "CANDIDATE_READY",
      )
    : undefined;
  // Consider only the newest ready generation. Never fall back to older bytes
  // after its receipt proves that the full report pipeline finished.
  if (
    request &&
    artifact &&
    !(await operatorPipelineConsumed({ ...input, artifact, quarantineDir }))
  ) {
    const review = await evaluateOperatorCandidate({
      ...input,
      requestId: request.requestId,
      quarantineDir,
    });
    if (
      review.kind === "AUTHORITY_ACCEPTED" &&
      review.outcomes &&
      review.records
    ) {
      operator = {
        outcomes: review.outcomes,
        records: review.records,
        operatorCandidate: {
          artifact: {
            artifactId: artifact.artifactId,
            requestId: artifact.requestId,
            sha256: artifact.sha256,
          },
          records: review.records,
        },
      };
    }
  }
  const registry = operator
    ? {
        get: input.registry.get.bind(input.registry),
        list: () =>
          input.registry
            .list()
            .filter((entry) => entry.sourceFamily !== "WILDBERRIES"),
      }
    : input.registry;
  const pass = await runDocumentAuthorityPass({ ...input, registry });
  return {
    ...(operator?.operatorCandidate
      ? { operatorCandidate: operator.operatorCandidate }
      : {}),
    outcomes: [...pass.outcomes, ...(operator?.outcomes ?? [])],
    records: [...pass.records, ...(operator?.records ?? [])],
  };
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

function operatorAuthorityId(artifactId: string, documentKey: string): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([artifactId, documentKey]))
    .digest("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-5" +
    hex.slice(13, 16) +
    "-8" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
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
    if (
      bundle.documents.some(
        (document) =>
          !entry.documents?.some(
            (current) =>
              current.documentKey === document.documentKey &&
              current.officialUrl === document.officialUrl,
          ),
      )
    )
      return invalidCandidate("WB_BUNDLE_REGISTRY_MISMATCH");
    const recordInputs: AuthorityRecordInput[] = [];
    for (const document of bundle.documents) {
      recordInputs.push({
        recordId: operatorAuthorityId(
          candidate.artifactId,
          document.documentKey,
        ),
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
      });
    }
    const records = await input.store.saveAuthorityRecords(recordInputs);
    return {
      kind: "AUTHORITY_ACCEPTED",
      record: records[0]!,
      records,
      outcomes: bundle.documents.map((document) => ({
        kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" as const,
        sourceFamily: "WILDBERRIES" as const,
        documentKey: document.documentKey,
        officialUrl: document.officialUrl,
        finalUrl: document.officialUrl,
        bytes: new TextEncoder().encode(document.content),
        sha256: document.sha256,
        sizeBytes: document.byteLength,
        specVersion: document.specVersion,
        artifactType: "YAML" as const,
        parserResult: { parsed: true },
        validationResult: { recognizedVersion: true },
      })),
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
