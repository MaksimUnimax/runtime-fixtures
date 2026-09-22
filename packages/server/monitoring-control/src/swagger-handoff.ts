import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
};

export type SwaggerUploadResult =
  | { kind: "CANDIDATE_READY"; artifact: SwaggerArtifact }
  | { kind: "DUPLICATE"; artifact: SwaggerArtifact }
  | { kind: "REJECTED"; code: string; quarantineFilename?: string };

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
    expectedArtifactType: string;
    createdAt?: Date;
    expiresAt?: Date | null;
    blockerReason: string;
  }): Promise<SwaggerSourceRequest>;
  getRequest(requestId: string): Promise<SwaggerSourceRequest | undefined>;
  listPending(now: Date): Promise<SwaggerSourceRequest[]>;
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
  ): Promise<void>;
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
    const duplicate = await this.findArtifactByDigest(
      artifact.requestId,
      artifact.sha256,
    );
    if (duplicate) return { inserted: false, artifact: duplicate };
    this.state.artifacts.set(artifact.artifactId, cloneArtifact(artifact));
    return { inserted: true, artifact: cloneArtifact(artifact) };
  }

  async setRequestStatus(
    requestId: string,
    status: SwaggerSourceRequestStatus,
  ) {
    const request = this.state.requests.get(requestId);
    if (!request) throw new Error("SWAGGER_REQUEST_NOT_FOUND");
    request.status = status;
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

const requestProjection = `SELECT request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",expected_artifact_type AS "expectedArtifactType",created_at AS "createdAt",status,expires_at AS "expiresAt",blocker_reason AS "blockerReason" FROM swagger_source_requests`;
const artifactProjection = `SELECT artifact_id AS "artifactId",request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",status,quarantine_filename AS "quarantineFilename",original_filename AS "originalFilename",operator_id AS "operatorId",received_at AS "receivedAt",size_bytes AS "sizeBytes",sha256,detected_spec_version AS "detectedSpecVersion",parser_result AS "parserResult",validation_result AS "validationResult",authority_state AS "authorityState" FROM swagger_source_artifacts`;

function mapRequest(row: RequestRow): SwaggerSourceRequest {
  return {
    requestId: row.requestId,
    sourceFamily: SwaggerSourceFamilySchema.parse(row.sourceFamily),
    officialUrl: row.officialUrl,
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
        `INSERT INTO swagger_source_requests(request_id,source_family,official_url,expected_artifact_type,created_at,status,expires_at,blocker_reason) VALUES($1,$2,$3,$4,$5,'PENDING_OPERATOR_UPLOAD',$6,$7) RETURNING request_id AS "requestId",source_family AS "sourceFamily",official_url AS "officialUrl",expected_artifact_type AS "expectedArtifactType",created_at AS "createdAt",status,expires_at AS "expiresAt",blocker_reason AS "blockerReason"`,
        [
          requestId,
          input.sourceFamily,
          input.officialUrl,
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
      const existing = await this.findArtifactByDigest(
        artifact.requestId,
        artifact.sha256,
      );
      if (existing) return { inserted: false, artifact: existing };
      const result = await runtime.query<ArtifactRow>(
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
    },
    async setRequestStatus(requestId, status) {
      await runtime.query(
        `UPDATE swagger_source_requests SET status=$2 WHERE request_id=$1`,
        [requestId, status],
      );
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

export function createSwaggerHandoffService(options: {
  store: SwaggerSourceStore;
  quarantineDir?: string;
  maxUploadBytes?: number;
  now?: () => Date;
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

  async function upload(
    input: SwaggerUploadInput,
  ): Promise<SwaggerUploadResult> {
    const request = await options.store.getRequest(input.requestId);
    if (!request) return { kind: "REJECTED", code: "UNKNOWN_REQUEST" };
    const receivedAt = input.receivedAt ?? now();
    if (request.expiresAt && request.expiresAt <= receivedAt) {
      await options.store.setRequestStatus(request.requestId, "EXPIRED");
      return { kind: "REJECTED", code: "REQUEST_EXPIRED" };
    }
    if (
      input.declaredSourceFamily &&
      input.declaredSourceFamily !== request.sourceFamily
    )
      return { kind: "REJECTED", code: "SOURCE_FAMILY_MISMATCH" };
    if (input.bytes.byteLength > maxUploadBytes)
      return { kind: "REJECTED", code: "UPLOAD_TOO_LARGE" };

    await mkdir(quarantineDir, { recursive: true });
    const extension = extname(input.originalFilename).toLowerCase();
    const quarantineFilename = `${randomUUID()}${extension || ".upload"}`;
    await writeFile(join(quarantineDir, quarantineFilename), input.bytes, {
      flag: "wx",
    });
    await options.store.setRequestStatus(request.requestId, "QUARANTINED");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const duplicate = await options.store.findArtifactByDigest(
      request.requestId,
      sha256,
    );
    if (duplicate) return { kind: "DUPLICATE", artifact: duplicate };
    if (["CANDIDATE_READY", "CANCELLED", "EXPIRED"].includes(request.status))
      return {
        kind: "REJECTED",
        code: "REQUEST_FINALIZED",
        quarantineFilename,
      };
    if (
      await options.store
        .listArtifacts(request.requestId)
        .then((items) => items.length > 0)
    )
      return {
        kind: "REJECTED",
        code: "REQUEST_ARTIFACT_ALREADY_RECEIVED",
        quarantineFilename,
      };

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
      status = "CANDIDATE_READY";
      authorityState = OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE;
    } catch (error) {
      parserResult = {
        ...parserResult,
        errorCode:
          error instanceof Error &&
          /^(?:UNSUPPORTED_ARTIFACT_EXTENSION|OPENAPI_[A-Z_]+|TEXT_CONTENT_INVALID)$/.test(
            error.message,
          )
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
    const saved = await options.store.saveArtifact(artifact);
    if (!saved.inserted) return { kind: "DUPLICATE", artifact: saved.artifact };
    await options.store.setRequestStatus(
      request.requestId,
      status === "CANDIDATE_READY" ? "CANDIDATE_READY" : "VALIDATION_FAILED",
    );
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
