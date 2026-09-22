import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE,
  parseSwaggerDocument,
  SwaggerSourceFamilySchema,
  type SwaggerArtifact,
  type SwaggerSourceFamily,
  type SwaggerSourceRequest,
  type SwaggerSourceStore,
} from "@product/monitoring-control";
import type {
  AcquisitionOutcome,
  ApiWatchSqlRuntime,
  ApiWatchStore,
  AuthorityPassResult,
  AuthorityRecord,
  AuthorityRecordInput,
  AuthorityStatus,
  OperatorCandidateReview,
  SourceRegistry,
  SourceRegistryEntry,
} from "./types.js";
import { acquireOfficialSource } from "./acquire.js";

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

export type InMemoryApiWatchState = {
  authorities: Map<string, AuthorityRecord>;
  snapshots: Map<string, import("./types.js").SnapshotMetadata>;
  inventories: Map<string, import("./types.js").OperationInventory>;
};

export function createInMemoryApiWatchState(): InMemoryApiWatchState {
  return {
    authorities: new Map(),
    snapshots: new Map(),
    inventories: new Map(),
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
        `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath" FROM api_watch_snapshots WHERE source_family=$1 AND sha256=$2`,
        [metadata.sourceFamily, metadata.sha256],
      );
      if (existing.rows[0]) return existing.rows[0] as never as typeof metadata;
      const result = await runtime.query<Record<string, unknown>>(
        `INSERT INTO api_watch_snapshots(snapshot_id,source_family,sha256,size_bytes,spec_version,official_url,acquisition_mode,created_at,authority_record_id,artifact_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath"`,
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
        ],
      );
      if (!result.rows[0]) throw new Error("API_WATCH_SNAPSHOT_CREATE_FAILED");
      return result.rows[0] as never as typeof metadata;
    },
    async listSnapshots() {
      const result = await runtime.query<Record<string, unknown>>(
        `SELECT snapshot_id AS "snapshotId",source_family AS "sourceFamily",sha256,size_bytes AS "sizeBytes",spec_version AS "specVersion",official_url AS "officialUrl",acquisition_mode AS "acquisitionMode",created_at AS "createdAt",authority_record_id AS "authorityRecordId",artifact_path AS "artifactPath" FROM api_watch_snapshots ORDER BY created_at,snapshot_id`,
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
  };
}

function authorityFromOutcome(
  outcome: AcquisitionOutcome,
  now: Date,
): AuthorityRecordInput {
  const accepted = outcome.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE";
  return {
    sourceFamily: outcome.sourceFamily,
    officialUrl: outcome.officialUrl,
    acquisitionMode: "AUTOMATIC",
    authorityStatus: accepted
      ? "AUTHORITY_ACCEPTED"
      : outcome.kind === "INVALID_OFFICIAL_SOURCE_RESPONSE"
        ? "AUTHORITY_REJECTED"
        : "AUTHORITY_BLOCKED",
    sha256: accepted ? outcome.sha256 : null,
    sizeBytes: accepted ? outcome.sizeBytes : null,
    specVersion: accepted ? outcome.specVersion : null,
    acquiredAt: accepted ? now : null,
    validatedAt: now,
    operatorRequestId: null,
    artifactExtension: accepted
      ? `.${outcome.artifactType.toLowerCase()}`
      : null,
    safeProvenance: accepted
      ? { finalUrl: outcome.finalUrl, redirectPolicy: "accepted-host-set" }
      : {},
    failureClassification: accepted ? null : outcome.kind,
  };
}

export async function runAuthorityPass(input: {
  registry: SourceRegistry;
  store: ApiWatchStore;
  pendingStore: SwaggerSourceStore;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<AuthorityPassResult> {
  const now = input.now ?? (() => new Date());
  const outcomes: AcquisitionOutcome[] = [];
  const records: AuthorityRecord[] = [];
  for (const entry of input.registry.list()) {
    const outcome = await acquireOfficialSource({
      entry,
      fetcher: input.fetcher,
    });
    outcomes.push(outcome);
    if (outcome.kind === "OPERATOR_SOURCE_REQUIRED" && entry.officialUrl) {
      const existing = await input.pendingStore.findOpenRequest(
        entry.sourceFamily,
        entry.officialUrl,
        now(),
      );
      if (!existing)
        await input.pendingStore.createRequest({
          sourceFamily: entry.sourceFamily,
          officialUrl: entry.officialUrl,
          expectedArtifactType: entry.expectedArtifactTypes.join(","),
          createdAt: now(),
          blockerReason: outcome.blockerReason,
        });
    }
    const record = await input.store.saveAuthorityRecord(
      authorityFromOutcome(outcome, now()),
    );
    records.push(record);
  }
  return { outcomes, records };
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
  if (!entry.officialUrl)
    return {
      kind: "AUTHORITY_BLOCKED",
      reason: "SOURCE_URL_AUTHORITY_MISSING",
    };
  if (request.officialUrl !== entry.officialUrl)
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
    safeProvenance: { candidateArtifactId: candidate.artifactId },
    failureClassification: null,
  });
  return record.authorityStatus === "AUTHORITY_ACCEPTED"
    ? { kind: "AUTHORITY_ACCEPTED", record }
    : { kind: "AUTHORITY_REVIEW_REQUIRED", record };
}
