import type {
  SwaggerArtifact,
  SwaggerSourceFamily,
  SwaggerSourceRequest,
  SwaggerSourceStore,
} from "@product/monitoring-control";

export {
  OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE,
  SwaggerSourceFamilySchema,
  SwaggerSourceRequestStatusSchema,
} from "@product/monitoring-control";
export type {
  SwaggerArtifact,
  SwaggerSourceFamily,
  SwaggerSourceRequest,
  SwaggerSourceStore,
} from "@product/monitoring-control";

export const API_WATCH_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const API_WATCH_TIMEOUT_MS = 20_000;
export const API_WATCH_MAX_REDIRECTS = 3;

export type AcquisitionMode = "AUTOMATIC" | "OPERATOR_SUPPLIED";
export type ExpectedArtifactType = "JSON" | "YAML" | "YML";
export type AcquisitionPolicy =
  | "SOURCE_URL_AUTHORITY_MISSING"
  | "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED";
export type OperatorAcceptancePolicy = "REVIEW_REQUIRED" | "DETERMINISTIC";

export type SourceRegistryEntry = {
  sourceFamily: SwaggerSourceFamily;
  officialUrl: string | null;
  expectedArtifactTypes: readonly ExpectedArtifactType[];
  maximumBytes: number;
  acquisitionPolicy: AcquisitionPolicy;
  operatorAcceptancePolicy: OperatorAcceptancePolicy;
  acceptedHosts?: readonly string[];
};

export type SourceRegistry = {
  get(sourceFamily: SwaggerSourceFamily): SourceRegistryEntry;
  list(): readonly SourceRegistryEntry[];
};

export type AcquisitionOutcome =
  | {
      kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE";
      sourceFamily: SwaggerSourceFamily;
      officialUrl: string;
      bytes: Uint8Array;
      sha256: string;
      sizeBytes: number;
      specVersion: string;
      artifactType: ExpectedArtifactType;
      finalUrl: string;
      parserResult: Record<string, unknown>;
      validationResult: Record<string, unknown>;
    }
  | {
      kind:
        | "OPERATOR_SOURCE_REQUIRED"
        | "SOURCE_TEMPORARILY_UNAVAILABLE"
        | "SOURCE_URL_AUTHORITY_MISSING"
        | "INVALID_OFFICIAL_SOURCE_RESPONSE";
      sourceFamily: SwaggerSourceFamily;
      officialUrl: string | null;
      blockerReason: string;
      httpStatus?: number;
    };

export type AuthorityStatus =
  | "AUTHORITY_ACCEPTED"
  | "AUTHORITY_REVIEW_REQUIRED"
  | "AUTHORITY_REJECTED"
  | "AUTHORITY_BLOCKED";

export type AuthorityRecord = {
  recordId: string;
  sourceFamily: SwaggerSourceFamily;
  officialUrl: string | null;
  acquisitionMode: AcquisitionMode;
  authorityStatus: AuthorityStatus;
  sha256: string | null;
  sizeBytes: number | null;
  specVersion: string | null;
  acquiredAt: Date | null;
  validatedAt: Date;
  operatorRequestId: string | null;
  artifactExtension: string | null;
  safeProvenance: Record<string, unknown>;
  failureClassification: string | null;
};

export type AuthorityRecordInput = Omit<AuthorityRecord, "recordId"> & {
  recordId?: string;
};

export type SnapshotMetadata = {
  snapshotId: string;
  sourceFamily: SwaggerSourceFamily;
  sha256: string;
  sizeBytes: number;
  specVersion: string;
  officialUrl: string;
  acquisitionMode: AcquisitionMode;
  createdAt: Date;
  authorityRecordId: string;
  artifactPath: string;
};

export type OperationInventoryItem = {
  sourceFamily: SwaggerSourceFamily;
  snapshotSha256: string;
  identity: string;
  method: string;
  path: string;
  operationId: string | null;
  tags: string[];
  deprecated: boolean;
  summaryHash: string | null;
  securitySchemeReferences: string[];
  requestBodyPresent: boolean;
  parameterCount: number;
  responseStatusKeys: string[];
};

export type OperationInventory = {
  sourceFamily: SwaggerSourceFamily;
  snapshotSha256: string;
  pathCount: number;
  operationCount: number;
  operationsByMethod: Record<string, number>;
  deprecatedCount: number;
  operationIdPresentCount: number;
  operationIdMissingCount: number;
  operations: OperationInventoryItem[];
};

export type ApiWatchSqlQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type ApiWatchSqlRuntime = ApiWatchSqlQuery & {
  transaction<T>(operation: (query: ApiWatchSqlQuery) => Promise<T>): Promise<T>;
};

export interface ApiWatchStore {
  saveAuthorityRecord(input: AuthorityRecordInput): Promise<AuthorityRecord>;
  listAuthorityRecords(): Promise<AuthorityRecord[]>;
  findAuthorityRecord(recordId: string): Promise<AuthorityRecord | undefined>;
  saveSnapshot(metadata: SnapshotMetadata): Promise<SnapshotMetadata>;
  listSnapshots(): Promise<SnapshotMetadata[]>;
  saveInventory(inventory: OperationInventory): Promise<void>;
  findInventory(
    sourceFamily: SwaggerSourceFamily,
    snapshotSha256: string,
  ): Promise<OperationInventory | undefined>;
}

export type OperatorCandidateReview =
  | { kind: "AUTHORITY_ACCEPTED"; record: AuthorityRecord }
  | { kind: "AUTHORITY_REVIEW_REQUIRED"; record: AuthorityRecord }
  | { kind: "AUTHORITY_REJECTED"; reason: string }
  | { kind: "AUTHORITY_BLOCKED"; reason: string };

export type AuthorityPassResult = {
  outcomes: AcquisitionOutcome[];
  records: AuthorityRecord[];
};

export type ApiWatchRunner = () => Promise<AuthorityPassResult>;

export type ApiWatchDependencies = {
  registry: SourceRegistry;
  store: ApiWatchStore;
  pendingStore: SwaggerSourceStore;
  fetcher?: typeof fetch;
  clock?: () => Date;
  quarantineDir?: string;
};

export type _TypeOnlyGuards = {
  artifact: SwaggerArtifact;
  request: SwaggerSourceRequest;
};
