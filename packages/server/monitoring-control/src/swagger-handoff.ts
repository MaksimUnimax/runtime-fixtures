import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SwaggerSourceFamilySchema = z.enum([
  "OZON_SELLER",
  "OZON_PERFORMANCE",
  "WILDBERRIES",
]);
export type SwaggerSourceFamily = z.infer<typeof SwaggerSourceFamilySchema>;

export const SwaggerSourceRequestStatusSchema = z.enum([
  "PENDING_OPERATOR_UPLOAD",
  "UPLOAD_RECEIVED",
  "QUARANTINED",
  "VALIDATION_FAILED",
  "DUPLICATE",
  "CANDIDATE_READY",
  "EXPIRED",
  "CANCELLED",
]);
export type SwaggerSourceRequestStatus = z.infer<
  typeof SwaggerSourceRequestStatusSchema
>;

export const OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE =
  "OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE" as const;
export const MAX_SWAGGER_UPLOAD_BYTES = 25 * 1024 * 1024;

export type SwaggerSourceRequest = {
  requestId: string;
  sourceFamily: SwaggerSourceFamily;
  officialUrl: string;
  documentKey: string | null;
  bundleVersion: string | null;
  expectedArtifactType: string;
  createdAt: Date;
  status: SwaggerSourceRequestStatus;
  expiresAt: Date | null;
  blockerReason: string;
};

export type SwaggerArtifact = {
  artifactId: string;
  requestId: string;
  sourceFamily: SwaggerSourceFamily;
  officialUrl: string;
  status: "VALIDATION_FAILED" | "CANDIDATE_READY" | "DUPLICATE";
  quarantineFilename: string;
  originalFilename: string;
  operatorId: string;
  receivedAt: Date;
  sizeBytes: number;
  sha256: string;
  detectedSpecVersion: string | null;
  parserResult: Record<string, unknown>;
  validationResult: Record<string, unknown>;
  authorityState: typeof OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE | null;
};

export type SwaggerUploadInput = {
  requestId: string;
  operatorId: string;
  originalFilename: string;
  bytes: Uint8Array;
  receivedAt?: Date;
  declaredSourceFamily?: SwaggerSourceFamily;
  documentKey?: string;
};

export type SwaggerUploadResult =
  | { kind: "CANDIDATE_READY"; artifact: SwaggerArtifact }
  | { kind: "DUPLICATE"; artifact: SwaggerArtifact }
  | { kind: "REJECTED"; code: string; quarantineFilename?: string };

export type SwaggerUploadValidation =
  | {
      accepted: true;
      parserResult: Record<string, unknown>;
      validationResult: Record<string, unknown>;
      detectedSpecVersion: string;
    }
  | { accepted: false; code: string };

export type SwaggerHandoffService = {
  maxUploadBytes: number;
  listPending(): Promise<SwaggerSourceRequest[]>;
  upload(input: SwaggerUploadInput): Promise<SwaggerUploadResult>;
};

export interface SwaggerSourceStore {
  createRequest(input: {
    requestId?: string;
    sourceFamily: SwaggerSourceFamily;
    officialUrl: string;
    documentKey?: string | null;
    bundleVersion?: string | null;
    expectedArtifactType: string;
    createdAt?: Date;
    expiresAt?: Date | null;
    blockerReason: string;
  }): Promise<SwaggerSourceRequest>;
  getRequest(requestId: string): Promise<SwaggerSourceRequest | undefined>;
  listPending(now: Date): Promise<SwaggerSourceRequest[]>;
  findOpenRequest(
    sourceFamily: SwaggerSourceFamily,
    officialUrl: string,
    now: Date,
    documentKey?: string | null,
  ): Promise<SwaggerSourceRequest | undefined>;
  listArtifacts(requestId: string): Promise<SwaggerArtifact[]>;
  findArtifactByDigest(
    requestId: string,
    sha256: string,
  ): Promise<SwaggerArtifact | undefined>;
  saveArtifact(artifact: SwaggerArtifact): Promise<{
    inserted: boolean;
    artifact: SwaggerArtifact;
  }>;
  setRequestStatus(
    requestId: string,
    status: SwaggerSourceRequestStatus,
    options?: {
      preserveTerminal?: boolean;
      expectedStatuses?: SwaggerSourceRequestStatus[];
    },
  ): Promise<boolean | void>;
}

class SwaggerRequestFinalizedError extends Error {
  constructor() {
    super("SWAGGER_REQUEST_FINALIZED");
  }
}

function cloneRequest(value: SwaggerSourceRequest): SwaggerSourceRequest {
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
  };
}

function cloneArtifact(value: SwaggerArtifact): SwaggerArtifact {
  return {
    ...value,
    receivedAt: new Date(value.receivedAt),
    parserResult: { ...value.parserResult },
    validationResult: { ...value.validationResult },
  };
}

export type InMemorySwaggerSourceState = {
  requests: Map<string, SwaggerSourceRequest>;
  artifacts: Map<string, SwaggerArtifact>;
};

export function createInMemorySwaggerSourceState(): InMemorySwaggerSourceState {
  return { requests: new Map(), artifacts: new Map() };
}

export class InMemorySwaggerSourceStore implements SwaggerSourceStore {
  public constructor(
    private readonly state: InMemorySwaggerSourceState = createInMemorySwaggerSourceState(),
  ) {}

  async createRequest(
    input: Parameters<SwaggerSourceStore["createRequest"]>[0],
  ) {
    const request: SwaggerSourceRequest = {
      requestId: input.requestId ?? randomUUID(),
      sourceFamily: SwaggerSourceFamilySchema.parse(input.sourceFamily),
      officialUrl: input.officialUrl,
      documentKey: input.documentKey ?? null,
      bundleVersion: input.bundleVersion ?? null,
      expectedArtifactType: input.expectedArtifactType,
      createdAt: new Date(input.createdAt ?? new Date()),
      status: "PENDING_OPERATOR_UPLOAD",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      blockerReason: input.blockerReason.slice(0, 500),
    };
    if (this.state.requests.has(request.requestId))
      throw new Error("SWAGGER_REQUEST_ALREADY_EXISTS");
    this.state.requests.set(request.requestId, request);
    return cloneRequest(request);
  }

  async getRequest(requestId: string) {
    const request = this.state.requests.get(requestId);
    return request ? cloneRequest(request) : undefined;
  }

  async listPending(now: Date) {
    const pending: SwaggerSourceRequest[] = [];
    for (const request of this.state.requests.values()) {
      if (
        request.status === "PENDING_OPERATOR_UPLOAD" &&
        request.expiresAt &&
        request.expiresAt <= now
      ) {
        request.status = "EXPIRED";
      }
      if (
        request.status === "PENDING_OPERATOR_UPLOAD" ||
        request.status === "QUARANTINED" ||
        request.status === "VALIDATION_FAILED"
      )
        pending.push(cloneRequest(request));
    }
    return pending.sort(
      (a, b) => a.createdAt.valueOf() - b.createdAt.valueOf(),
    );
  }

  async findOpenRequest(
    sourceFamily: SwaggerSourceFamily,
    officialUrl: string,
    now: Date,
    documentKey?: string | null,
  ) {
    const requests = await this.listPending(now);
    const request = requests.find(
      (candidate) =>
        candidate.sourceFamily === sourceFamily &&
        candidate.officialUrl === officialUrl &&
        (documentKey === undefined || candidate.documentKey === documentKey),
    );
    return request;
  }

  async listArtifacts(requestId: string) {
    return [...this.state.artifacts.values()]
      .filter((artifact) => artifact.requestId === requestId)
      .sort((a, b) => a.receivedAt.valueOf() - b.receivedAt.valueOf())
      .map(cloneArtifact);
  }

  async findArtifactByDigest(requestId: string, sha256: string) {
    const artifact = [...this.state.artifacts.values()].find(
      (candidate) =>
        candidate.requestId === requestId && candidate.sha256 === sha256,
    );
    return artifact ? cloneArtifact(artifact) : undefined;
  }

  async saveArtifact(artifact: SwaggerArtifact) {
    const request = this.state.requests.get(artifact.requestId);
    if (!request) throw new Error("SWAGGER_REQUEST_NOT_FOUND");
    if (["CANCELLED", "EXPIRED"].includes(request.status))
      throw new SwaggerRequestFinalizedError();
    const duplicate = [...this.state.artifacts.values()].find(
      (candidate) =>
        candidate.requestId === artifact.requestId &&
        candidate.sha256 === artifact.sha256,
    );
    if (duplicate)
      return { inserted: false, artifact: cloneArtifact(duplicate) };
    this.state.artifacts.set(artifact.artifactId, cloneArtifact(artifact));
    return { inserted: true, artifact: cloneArtifact(artifact) };
  }

  async setRequestStatus(
    requestId: string,
    status: SwaggerSourceRequestStatus,
    options?: {
      preserveTerminal?: boolean;
      expectedStatuses?: SwaggerSourceRequestStatus[];
    },
  ) {
    const request = this.state.requests.get(requestId);
    if (!request) throw new Error("SWAGGER_REQUEST_NOT_FOUND");
    if (
      options?.preserveTerminal &&
      ["CANCELLED", "EXPIRED"].includes(request.status)
    )
      return false;
    if (
      options?.expectedStatuses &&
      !options.expectedStatuses.includes(request.status)
    )
      return false;
    request.status = status;
    return options?.preserveTerminal || options?.expectedStatuses
      ? true
      : undefined;
  }
}

export type SwaggerSourceSqlQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type SwaggerSourceSqlRuntime = SwaggerSourceSqlQuery & {
  transaction<T>(
    operation: (query: SwaggerSourceSqlQuery) => Promise<T>,
  ): Promise<T>;
};

type RequestRow = {
  requestId: string;
  sourceFamily: string;
  officialUrl: string;
  documentKey: string | null;
  bundleVersion: string | null;
  expectedArtifactType: string;
  createdAt: Date;
  status: string;
  expiresAt: Date | null;
  blockerReason: string;
};
type ArtifactRow = Omit<
  SwaggerArtifact,
  "parserResult" | "validationResult"
> & {
  parserResult: unknown;
  validationResult: unknown;
};

const requestProjection = `SELECT request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",document_key AS "documentKey",bundle_version AS "bundleVersion",expected_artifact_type AS "expectedArtifactType",created_at AS "createdAt",status,expires_at AS "expiresAt",blocker_reason AS "blockerReason" FROM swagger_source_requests`;
const artifactProjection = `SELECT artifact_id AS "artifactId",request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",status,quarantine_filename AS "quarantineFilename",original_filename AS "originalFilename",operator_id AS "operatorId",received_at AS "receivedAt",size_bytes AS "sizeBytes",sha256,detected_spec_version AS "detectedSpecVersion",parser_result AS "parserResult",validation_result AS "validationResult",authority_state AS "authorityState" FROM swagger_source_artifacts`;

function mapRequest(row: RequestRow): SwaggerSourceRequest {
  return {
    requestId: row.requestId,
    sourceFamily: SwaggerSourceFamilySchema.parse(row.sourceFamily),
    officialUrl: row.officialUrl,
    documentKey: row.documentKey,
    bundleVersion: row.bundleVersion,
    expectedArtifactType: row.expectedArtifactType,
    createdAt: new Date(row.createdAt),
    status: SwaggerSourceRequestStatusSchema.parse(row.status),
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    blockerReason: row.blockerReason,
  };
}

function mapArtifact(row: ArtifactRow): SwaggerArtifact {
  return {
    ...row,
    sourceFamily: SwaggerSourceFamilySchema.parse(row.sourceFamily),
    status: z
      .enum(["VALIDATION_FAILED", "CANDIDATE_READY", "DUPLICATE"])
      .parse(row.status),
    parserResult:
      row.parserResult && typeof row.parserResult === "object"
        ? (row.parserResult as Record<string, unknown>)
        : {},
    validationResult:
      row.validationResult && typeof row.validationResult === "object"
        ? (row.validationResult as Record<string, unknown>)
        : {},
    receivedAt: new Date(row.receivedAt),
  };
}

export function createPostgresSwaggerSourceStore(
  runtime: SwaggerSourceSqlRuntime,
): SwaggerSourceStore {
  return {
    async createRequest(input) {
      const requestId = input.requestId ?? randomUUID();
      const inserted = await runtime.query<RequestRow>(
        `${requestProjection} WHERE request_id=$1`,
        [requestId],
      );
      if (inserted.rows[0]) throw new Error("SWAGGER_REQUEST_ALREADY_EXISTS");
      const createdAt = input.createdAt ?? new Date();
      const write = await runtime.query<RequestRow>(
        `INSERT INTO swagger_source_requests(request_id,source_family,official_url,document_key,bundle_version,expected_artifact_type,created_at,status,expires_at,blocker_reason) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING_OPERATOR_UPLOAD',$8,$9) RETURNING request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",document_key AS "documentKey",bundle_version AS "bundleVersion",expected_artifact_type AS "expectedArtifactType",created_at AS "createdAt",status,expires_at AS "expiresAt",blocker_reason AS "blockerReason"`,
        [
          requestId,
          input.sourceFamily,
          input.officialUrl,
          input.documentKey ?? null,
          input.bundleVersion ?? null,
          input.expectedArtifactType,
          createdAt,
          input.expiresAt ?? null,
          input.blockerReason.slice(0, 500),
        ],
      );
      if (!write.rows[0]) throw new Error("SWAGGER_REQUEST_CREATE_FAILED");
      return mapRequest(write.rows[0]);
    },
    async getRequest(requestId) {
      const result = await runtime.query<RequestRow>(
        `${requestProjection} WHERE request_id=$1`,
        [requestId],
      );
      return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
    },
    async listPending(now) {
      await runtime.query(
        `UPDATE swagger_source_requests SET status='EXPIRED' WHERE status='PENDING_OPERATOR_UPLOAD' AND expires_at IS NOT NULL AND expires_at <= $1`,
        [now],
      );
      const result = await runtime.query<RequestRow>(
        `${requestProjection} WHERE status IN ('PENDING_OPERATOR_UPLOAD','QUARANTINED','VALIDATION_FAILED') ORDER BY created_at,request_id`,
      );
      return result.rows.map(mapRequest);
    },
    async findOpenRequest(sourceFamily, officialUrl, now, documentKey) {
      await this.listPending(now);
      const result = await runtime.query<RequestRow>(
        `${requestProjection} WHERE source_family=$1 AND official_url=$2 AND ($3::text IS NULL OR document_key=$3) AND status IN ('PENDING_OPERATOR_UPLOAD','UPLOAD_RECEIVED','QUARANTINED','VALIDATION_FAILED') ORDER BY created_at LIMIT 1`,
        [sourceFamily, officialUrl, documentKey ?? null],
      );
      return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
    },
    async listArtifacts(requestId) {
      const result = await runtime.query<ArtifactRow>(
        `${artifactProjection} WHERE request_id=$1 ORDER BY received_at,artifact_id`,
        [requestId],
      );
      return result.rows.map(mapArtifact);
    },
    async findArtifactByDigest(requestId, sha256) {
      const result = await runtime.query<ArtifactRow>(
        `${artifactProjection} WHERE request_id=$1 AND sha256=$2`,
        [requestId, sha256],
      );
      return result.rows[0] ? mapArtifact(result.rows[0]) : undefined;
    },
    async saveArtifact(artifact) {
      return runtime.transaction(async (query) => {
        const current = await query.query<{ status: string }>(
          `SELECT status FROM swagger_source_requests WHERE request_id=$1 FOR UPDATE`,
          [artifact.requestId],
        );
        if (!current.rows[0]) throw new Error("SWAGGER_REQUEST_NOT_FOUND");
        if (["CANCELLED", "EXPIRED"].includes(current.rows[0].status))
          throw new SwaggerRequestFinalizedError();
        const existing = await query.query<ArtifactRow>(
          `${artifactProjection} WHERE request_id=$1 AND sha256=$2`,
          [artifact.requestId, artifact.sha256],
        );
        if (existing.rows[0])
          return { inserted: false, artifact: mapArtifact(existing.rows[0]) };
        const result = await query.query<ArtifactRow>(
          `INSERT INTO swagger_source_artifacts(artifact_id,request_id,source_family,official_url,status,quarantine_filename,original_filename,operator_id,received_at,size_bytes,sha256,detected_spec_version,parser_result,validation_result,authority_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15) RETURNING artifact_id AS "artifactId",request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",status,quarantine_filename AS "quarantineFilename",original_filename AS "originalFilename",operator_id AS "operatorId",received_at AS "receivedAt",size_bytes AS "sizeBytes",sha256,detected_spec_version AS "detectedSpecVersion",parser_result AS "parserResult",validation_result AS "validationResult",authority_state AS "authorityState"`,
          [
            artifact.artifactId,
            artifact.requestId,
            artifact.sourceFamily,
            artifact.officialUrl,
            artifact.status,
            artifact.quarantineFilename,
            artifact.originalFilename,
            artifact.operatorId,
            artifact.receivedAt,
            artifact.sizeBytes,
            artifact.sha256,
            artifact.detectedSpecVersion,
            JSON.stringify(artifact.parserResult),
            JSON.stringify(artifact.validationResult),
            artifact.authorityState,
          ],
        );
        if (!result.rows[0]) throw new Error("SWAGGER_ARTIFACT_CREATE_FAILED");
        return { inserted: true, artifact: mapArtifact(result.rows[0]) };
      });
    },
    async setRequestStatus(requestId, status, updateOptions) {
      // Evaluate against the current row in the same atomic UPDATE.
      let condition = updateOptions?.preserveTerminal
        ? " AND status NOT IN ('CANCELLED','EXPIRED')"
        : "";
      const values: unknown[] = [requestId, status];
      if (updateOptions?.expectedStatuses) {
        condition += " AND status = ANY($3::text[])";
        values.push(updateOptions.expectedStatuses);
      }
      const guarded = Boolean(
        updateOptions?.preserveTerminal || updateOptions?.expectedStatuses,
      );
      const returning = guarded ? ' RETURNING request_id AS "requestId"' : "";
      const result = await runtime.query(
        `UPDATE swagger_source_requests SET status=$2 WHERE request_id=$1${condition}${returning}`,
        values,
      );
      return guarded ? result.rows.length > 0 : undefined;
    },
  };
}

export function safeOriginalFilename(value: string): string {
  const leaf = [...basename(value)]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? "_" : char;
    })
    .join("");
  return leaf.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 160) || "upload";
}

function acceptedExtension(filename: string): boolean {
  return new Set([".json", ".yaml", ".yml"]).has(
    extname(filename).toLowerCase(),
  );
}

function parseDocument(
  bytes: Uint8Array,
  extension: string,
): {
  value: unknown;
  format: "JSON" | "YAML";
} {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (
    [...text].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
  )
    throw new Error("TEXT_CONTENT_INVALID");
  if (extension === ".json") return { value: JSON.parse(text), format: "JSON" };
  return { value: parseYaml(text), format: "YAML" };
}

function validateRoot(value: unknown): {
  version: string;
  root: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OPENAPI_ROOT_NOT_OBJECT");
  const root = value as Record<string, unknown>;
  if (!root.info || typeof root.info !== "object" || Array.isArray(root.info))
    throw new Error("OPENAPI_INFO_MISSING");
  if (
    !root.paths ||
    typeof root.paths !== "object" ||
    Array.isArray(root.paths)
  )
    throw new Error("OPENAPI_PATHS_MISSING");
  const version =
    typeof root.swagger === "string" && /^2\.\d+(?:\.\d+)?$/.test(root.swagger)
      ? root.swagger
      : typeof root.openapi === "string" &&
          /^3\.\d+(?:\.\d+)?$/.test(root.openapi)
        ? root.openapi
        : null;
  if (!version) throw new Error("OPENAPI_VERSION_MISSING");
  return { version, root };
}

export type ParsedSwaggerDocument = {
  root: Record<string, unknown>;
  format: "JSON" | "YAML";
  version: string;
};

export function parseSwaggerDocument(
  bytes: Uint8Array,
  filename: string,
  maxBytes = MAX_SWAGGER_UPLOAD_BYTES,
): ParsedSwaggerDocument {
  if (bytes.byteLength > maxBytes) throw new Error("UPLOAD_TOO_LARGE");
  const extension = extname(filename).toLowerCase();
  if (!acceptedExtension(filename))
    throw new Error("UNSUPPORTED_ARTIFACT_EXTENSION");
  const parsed = parseDocument(bytes, extension);
  const root = validateRoot(parsed.value);
  return { root: root.root, format: parsed.format, version: root.version };
}

export function validateSwaggerBytes(
  bytes: Uint8Array,
  filename: string,
  maxBytes = MAX_SWAGGER_UPLOAD_BYTES,
): {
  parserResult: Record<string, unknown>;
  validationResult: Record<string, unknown>;
  detectedSpecVersion: string;
  document: ParsedSwaggerDocument;
} {
  const document = parseSwaggerDocument(bytes, filename, maxBytes);
  return {
    parserResult: { parsed: true, format: document.format },
    validationResult: {
      rootObject: true,
      infoObject: true,
      pathsObject: true,
      recognizedVersion: true,
      sourceFamilyCompatibility: "NOT_DETERMINED",
    },
    detectedSpecVersion: document.version,
    document,
  };
}

function quarantineFilenameForRequest(requestId: string): string {
  return `request-${createHash("sha256").update(requestId).digest("hex")}.upload`;
}

// A request accepts one artifact. Keep one stable retry payload when a database
// acknowledgement is uncertain; never delete bytes that a commit may reference.
async function retainQuarantineUpload(
  directory: string,
  requestId: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<string> {
  const filename = quarantineFilenameForRequest(requestId);
  const destination = join(directory, filename);
  const verifyExisting = async () => {
    const stat = await lstat(destination);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== bytes.byteLength
    )
      throw new Error("QUARANTINE_PENDING_UPLOAD_MISMATCH");
    if (
      createHash("sha256")
        .update(await readFile(destination))
        .digest("hex") !== sha256
    )
      throw new Error("QUARANTINE_PENDING_UPLOAD_MISMATCH");
  };
  try {
    await verifyExisting();
    return filename;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(directory, `.${filename}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  let failed = false;
  let failure: unknown;
  try {
    let writingFailed = false;
    let writeFailure: unknown;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      writingFailed = true;
      writeFailure = error;
    }
    try {
      await handle.close();
    } catch (closeError) {
      if (writingFailed)
        throw new AggregateError(
          [writeFailure, closeError],
          "QUARANTINE_WRITE_AND_CLOSE_FAILED",
          { cause: writeFailure },
        );
      throw closeError;
    }
    if (writingFailed) throw writeFailure;
    try {
      // A competing upload may publish first. Never overwrite its payload.
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyExisting();
    }
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await unlink(temporary);
  } catch (cleanupError) {
    if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
      if (failed)
        throw new AggregateError(
          [failure, cleanupError],
          "QUARANTINE_TEMP_CLEANUP_FAILED",
        );
      throw cleanupError;
    }
  }
  if (failed) throw failure;
  return filename;
}

export function createSwaggerHandoffService(options: {
  store: SwaggerSourceStore;
  quarantineDir?: string;
  maxUploadBytes?: number;
  now?: () => Date;
  validateUpload?: (input: {
    bytes: Uint8Array;
    originalFilename: string;
    request: SwaggerSourceRequest;
  }) =>
    | Promise<SwaggerUploadValidation | undefined>
    | SwaggerUploadValidation
    | undefined;
}) {
  const quarantineDir =
    options.quarantineDir ??
    process.env.SWAGGER_QUARANTINE_DIR ??
    join(tmpdir(), "octoport-swagger-quarantine");
  const maxUploadBytes = options.maxUploadBytes ?? MAX_SWAGGER_UPLOAD_BYTES;
  const now = options.now ?? (() => new Date());

  async function listPending() {
    return options.store.listPending(now());
  }

  function rejectFinalizedPayload(
    code = "REQUEST_FINALIZED",
  ): SwaggerUploadResult {
    // The canonical name can be shared by competing invocations. A primary DB
    // reference read and lstat do not grant ownership of its directory entry.
    // Preserve at most the one stable request payload for later reconciliation;
    // only retainQuarantineUpload removes its uniquely owned unpublished temp.
    return { kind: "REJECTED", code };
  }

  async function upload(
    input: SwaggerUploadInput,
  ): Promise<SwaggerUploadResult> {
    const request = await options.store.getRequest(input.requestId);
    if (!request) return { kind: "REJECTED", code: "UNKNOWN_REQUEST" };
    const receivedAt = input.receivedAt ?? now();
    if (request.expiresAt && request.expiresAt <= receivedAt) {
      const expired = await options.store.setRequestStatus(
        request.requestId,
        "EXPIRED",
        {
          preserveTerminal: true,
          expectedStatuses: [
            "PENDING_OPERATOR_UPLOAD",
            "UPLOAD_RECEIVED",
            "QUARANTINED",
          ],
        },
      );
      return rejectFinalizedPayload(
        expired === false ? "REQUEST_FINALIZED" : "REQUEST_EXPIRED",
      );
    }
    if (
      input.declaredSourceFamily &&
      input.declaredSourceFamily !== request.sourceFamily
    )
      return { kind: "REJECTED", code: "SOURCE_FAMILY_MISMATCH" };
    if (
      request.documentKey &&
      request.documentKey !== "WB_OPENAPI_BUNDLE" &&
      input.documentKey !== request.documentKey
    )
      return { kind: "REJECTED", code: "DOCUMENT_KEY_MISMATCH" };
    if (input.bytes.byteLength > maxUploadBytes)
      return { kind: "REJECTED", code: "UPLOAD_TOO_LARGE" };

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const duplicate = await options.store.findArtifactByDigest(
      request.requestId,
      sha256,
    );
    if (duplicate) {
      // A previous save may have committed before its status update failed.
      // The store preserves cancellation/expiry committed after getRequest().
      await options.store.setRequestStatus(
        request.requestId,
        duplicate.status === "CANDIDATE_READY"
          ? "CANDIDATE_READY"
          : "VALIDATION_FAILED",
        { preserveTerminal: true },
      );
      return { kind: "DUPLICATE", artifact: duplicate };
    }
    if (["CANDIDATE_READY", "CANCELLED", "EXPIRED"].includes(request.status)) {
      if (["CANCELLED", "EXPIRED"].includes(request.status))
        return rejectFinalizedPayload();
      return { kind: "REJECTED", code: "REQUEST_FINALIZED" };
    }
    if ((await options.store.listArtifacts(request.requestId)).length > 0)
      return { kind: "REJECTED", code: "REQUEST_ARTIFACT_ALREADY_RECEIVED" };

    await mkdir(quarantineDir, { recursive: true });
    const extension = extname(input.originalFilename).toLowerCase();
    const quarantineFilename = await retainQuarantineUpload(
      quarantineDir,
      request.requestId,
      input.bytes,
      sha256,
    );
    if (
      (await options.store.setRequestStatus(request.requestId, "QUARANTINED", {
        preserveTerminal: true,
        expectedStatuses: [
          "PENDING_OPERATOR_UPLOAD",
          "UPLOAD_RECEIVED",
          "QUARANTINED",
        ],
      })) === false
    ) {
      // A competing upload may have committed while this invocation was
      // retaining the same bytes. Never return its registered request to pending.
      const current = await options.store.getRequest(request.requestId);
      if (current && !["CANCELLED", "EXPIRED"].includes(current.status)) {
        const committed = await options.store.findArtifactByDigest(
          request.requestId,
          sha256,
        );
        if (committed) return { kind: "DUPLICATE", artifact: committed };
      }
      return rejectFinalizedPayload();
    }

    const originalFilename = safeOriginalFilename(input.originalFilename);
    let parserResult: Record<string, unknown> = { parsed: false };
    let validationResult: Record<string, unknown> = {
      sourceFamilyCompatibility: "NOT_DETERMINED",
    };
    let status: SwaggerArtifact["status"] = "VALIDATION_FAILED";
    let detectedSpecVersion: string | null = null;
    let authorityState: SwaggerArtifact["authorityState"] = null;
    try {
      if (!acceptedExtension(input.originalFilename))
        throw new Error("UNSUPPORTED_ARTIFACT_EXTENSION");
      const specialized = await options.validateUpload?.({
        bytes: input.bytes,
        originalFilename: input.originalFilename,
        request,
      });
      if (specialized) {
        if (!specialized.accepted) throw new Error(specialized.code);
        parserResult = specialized.parserResult;
        validationResult = specialized.validationResult;
        detectedSpecVersion = specialized.detectedSpecVersion;
      } else {
        const parsed = parseDocument(input.bytes, extension);
        parserResult = { parsed: true, format: parsed.format };
        const root = validateRoot(parsed.value);
        detectedSpecVersion = root.version;
        validationResult = {
          rootObject: true,
          infoObject: true,
          pathsObject: true,
          recognizedVersion: true,
          sourceFamilyCompatibility: "NOT_DETERMINED",
        };
      }
      status = "CANDIDATE_READY";
      authorityState = OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE;
    } catch (error) {
      parserResult = {
        ...parserResult,
        errorCode:
          error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "INVALID_DOCUMENT",
      };
      validationResult = {
        ...validationResult,
        valid: false,
      };
    }
    const artifact: SwaggerArtifact = {
      artifactId: randomUUID(),
      requestId: request.requestId,
      sourceFamily: request.sourceFamily,
      officialUrl: request.officialUrl,
      status,
      quarantineFilename,
      originalFilename,
      operatorId: input.operatorId,
      receivedAt,
      sizeBytes: input.bytes.byteLength,
      sha256,
      detectedSpecVersion,
      parserResult,
      validationResult,
      authorityState,
    };
    let saved: Awaited<ReturnType<SwaggerSourceStore["saveArtifact"]>>;
    try {
      saved = await options.store.saveArtifact(artifact);
    } catch (error) {
      if (error instanceof SwaggerRequestFinalizedError)
        return rejectFinalizedPayload();
      // An error does not prove rollback. Reconcile against the primary store;
      // if unavailable or absent, retain the stable bytes for the same retry.
      const committed = await options.store
        .findArtifactByDigest(request.requestId, sha256)
        .catch(() => undefined);
      if (!committed) throw error;
      saved = { inserted: false, artifact: committed };
    }
    if (!saved.inserted) {
      if (
        (await options.store.setRequestStatus(
          request.requestId,
          saved.artifact.status === "CANDIDATE_READY"
            ? "CANDIDATE_READY"
            : "VALIDATION_FAILED",
          { preserveTerminal: true },
        )) === false
      )
        return rejectFinalizedPayload();
      return { kind: "DUPLICATE", artifact: saved.artifact };
    }
    if (
      (await options.store.setRequestStatus(
        request.requestId,
        status === "CANDIDATE_READY" ? "CANDIDATE_READY" : "VALIDATION_FAILED",
        { preserveTerminal: true },
      )) === false
    )
      return rejectFinalizedPayload();
    return status === "CANDIDATE_READY"
      ? { kind: "CANDIDATE_READY", artifact: saved.artifact }
      : {
          kind: "REJECTED",
          code: String(parserResult.errorCode ?? "VALIDATION_FAILED"),
          quarantineFilename,
        };
  }

  return {
    maxUploadBytes,
    listPending,
    upload,
  } satisfies SwaggerHandoffService;
}
