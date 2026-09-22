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
      retryAfterSeconds?: number | null;
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

export type DiffOperationState = "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";

export type DiffField =
  | "deprecated"
  | "operationId"
  | "parameterCount"
  | "requestBodyPresent"
  | "responseStatusKeys"
  | "securitySchemeReferences"
  | "summaryHash"
  | "tags";

export type DiffFieldDelta = {
  field: DiffField;
  before: unknown;
  after: unknown;
};

export type SemanticOperation = {
  identity: string;
  sourceFamily: SwaggerSourceFamily;
  method: string;
  path: string;
  operationId: string | null;
  deprecated: boolean;
  tags: string[];
  summaryHash: string | null;
  securitySchemeReferences: string[];
  requestBodyPresent: boolean;
  parameterCount: number;
  responseStatusKeys: string[];
};

export type SemanticDiffOperation = {
  identity: string;
  sourceFamily: SwaggerSourceFamily;
  method: string;
  path: string;
  state: DiffOperationState;
  before: SemanticOperation | null;
  after: SemanticOperation | null;
  deltas: DiffFieldDelta[];
};

export type SemanticDiff = {
  diffId: string;
  sourceFamily: SwaggerSourceFamily;
  baseSnapshotSha256: string;
  targetSnapshotSha256: string;
  diffSha256: string;
  createdAt: Date;
  basePathCount: number;
  targetPathCount: number;
  baseOperationCount: number;
  targetOperationCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  methodCountsBefore: Record<string, number>;
  methodCountsAfter: Record<string, number>;
  deprecatedBefore: number;
  deprecatedAfter: number;
  operations: SemanticDiffOperation[];
};

export type ApiWatchImpactSeverity =
  | "BLOCKING_RISK"
  | "REVIEW_REQUIRED"
  | "UNKNOWN"
  | "NO_POLICY_IMPACT";

export type ReadPolicyCandidate = "NONE" | "REVIEW_REQUIRED";

export type ApiWatchImpactOperation = {
  identity: string;
  state: DiffOperationState;
  severity: ApiWatchImpactSeverity;
  readPolicyCandidate: ReadPolicyCandidate;
  reasons: string[];
};

export type ApiWatchImpact = {
  diffId: string;
  operations: ApiWatchImpactOperation[];
  blockingRiskCount: number;
  reviewRequiredCount: number;
  unknownCount: number;
  noPolicyImpactCount: number;
  overallSeverity: ApiWatchImpactSeverity;
};

export type ApiWatchReportState =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "BLOCKED"
  | "FAILED";

export type ApiWatchReportSource = "SCHEDULED" | "FORCED";

export type ApiWatchReportSourceOutcome = {
  sourceFamily: SwaggerSourceFamily;
  acquisitionOutcome: string;
  authorityStatus: AuthorityStatus | null;
  snapshotSha256: string | null;
  inventoryOperationCount: number | null;
  baseSnapshotSha256: string | null;
  diffSha256: string | null;
  impactSeverity: ApiWatchImpactSeverity | null;
  blockerCode: string | null;
  errorCode: string | null;
  changeMode: "NO_CHANGE" | "FIRST_SNAPSHOT" | "CHANGED" | null;
  addedCount: number | null;
  removedCount: number | null;
  changedCount: number | null;
  unchangedCount: number | null;
  blockingRiskCount: number | null;
  reviewRequiredCount: number | null;
  unknownCount: number | null;
  noPolicyImpactCount: number | null;
};

export type ApiWatchReport = {
  reportId: string;
  runSource: ApiWatchReportSource;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  state: ApiWatchReportState;
  sources: ApiWatchReportSourceOutcome[];
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

export type ApiWatchSqlQuery = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};
export type ApiWatchSqlRuntime = ApiWatchSqlQuery & {
  transaction<T>(
    operation: (query: ApiWatchSqlQuery) => Promise<T>,
  ): Promise<T>;
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
  saveSemanticDiff(diff: SemanticDiff): Promise<SemanticDiff>;
  findSemanticDiff(
    sourceFamily: SwaggerSourceFamily,
    baseSnapshotSha256: string,
    targetSnapshotSha256: string,
    diffSha256: string,
  ): Promise<SemanticDiff | undefined>;
}

export interface ApiWatchReportStore {
  createReport(input: {
    reportId?: string;
    runSource: ApiWatchReportSource;
    createdAt: Date;
  }): Promise<ApiWatchReport>;
  getReport(reportId: string): Promise<ApiWatchReport | undefined>;
  transitionReport(input: {
    reportId: string;
    state: ApiWatchReportState;
    at: Date;
    sources?: ApiWatchReportSourceOutcome[];
    counts?: Partial<
      Pick<
        ApiWatchReport,
        | "addedCount"
        | "removedCount"
        | "changedCount"
        | "unchangedCount"
        | "blockingRiskCount"
        | "reviewRequiredCount"
        | "unknownCount"
        | "noPolicyImpactCount"
        | "overallImpactSeverity"
      >
    >;
  }): Promise<ApiWatchReport>;
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
  snapshotRoot?: string;
  reportStore?: ApiWatchReportStore;
  crosswalkStore?: ProductCrosswalkStore;
  incidentStore?: ApiWatchIncidentStore;
  incidentNotifier?: ApiWatchIncidentNotifier;
  retryStore?: ApiWatchRetryStore;
  scheduleEarlier?: (retryAt: Date) => Promise<void>;
};

export type ProductRegistryEntry = {
  sourceFamily: SwaggerSourceFamily;
  runtimeAlias: string;
  method: string;
  normalizedPath: string;
  executionEnabled: boolean;
  effect: string;
  privacyClass: string;
  runtimeSafetyClass: string | null;
  workflowRole: string | null;
  entitlementKey: string | null;
  currentness: string | null;
  blockedReason: string | null;
  providerMetadata: Record<string, unknown>;
};

export type CrosswalkState =
  | "MAPPED_ENABLED"
  | "MAPPED_DISABLED"
  | "SOURCE_ONLY"
  | "RUNTIME_ONLY"
  | "AMBIGUOUS_RUNTIME_MAPPING";
export type CrosswalkReviewState =
  | "NO_ACTION"
  | "REVIEW_REQUIRED"
  | "BLOCKING_RISK";
export type ProductCrosswalkRow = {
  crosswalkId: string;
  reportId: string;
  sourceFamily: SwaggerSourceFamily;
  sourceIdentity: string;
  runtimeAlias: string | null;
  crosswalkState: CrosswalkState;
  reviewState: CrosswalkReviewState;
  executionEnabled: boolean | null;
  impactSeverity: ApiWatchImpactSeverity | null;
  diffSha256: string | null;
  createdAt: Date;
};

export interface ProductCrosswalkStore {
  saveRows(rows: ProductCrosswalkRow[]): Promise<ProductCrosswalkRow[]>;
  listRows(reportId: string): Promise<ProductCrosswalkRow[]>;
}

export type ApiWatchIncidentType =
  | "SOURCE_AUTHORITY_BLOCKED"
  | "API_CHANGE_BLOCKING"
  | "API_CHANGE_REVIEW_REQUIRED"
  | "RUNTIME_OPERATION_STALE"
  | "RUNTIME_MAPPING_AMBIGUOUS"
  | "WATCH_RUN_FAILED";
export type ApiWatchIncidentState = "OPEN" | "RESOLVED";
export type ApiWatchIncident = {
  incidentId: string;
  incidentKey: string;
  incidentType: ApiWatchIncidentType;
  sourceFamily: SwaggerSourceFamily | null;
  operationIdentity: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrenceCount: number;
  severity: ApiWatchImpactSeverity;
  latestReportId: string;
  latestDiffSha256: string | null;
  safeSummaryCode: string;
  state: ApiWatchIncidentState;
};
export type ApiWatchIncidentEvent =
  | { kind: "OPENED"; incident: ApiWatchIncident }
  | { kind: "RESOLVED"; incident: ApiWatchIncident };
export interface ApiWatchIncidentStore {
  observe(input: Omit<ApiWatchIncident, "incidentId" | "occurrenceCount" | "state" | "resolvedAt">): Promise<{ incident: ApiWatchIncident; opened: boolean }>;
  resolve(incidentKey: string, at: Date): Promise<ApiWatchIncident | undefined>;
  listOpen(): Promise<ApiWatchIncident[]>;
  find(incidentKey: string): Promise<ApiWatchIncident | undefined>;
}
export type ApiWatchIncidentNotifier = (event: ApiWatchIncidentEvent) => Promise<void>;

export type ApiWatchRetryFailureClass = "NETWORK" | "TIMEOUT" | "HTTP_5XX" | "HTTP_429";
export type ApiWatchRetryState = {
  sourceFamily: SwaggerSourceFamily;
  failureEpisodeId: string;
  failureClass: ApiWatchRetryFailureClass;
  retryCount: number;
  nextRetryAt: Date | null;
  lastAttemptAt: Date;
  lastResult: string;
  updatedAt: Date;
};
export interface ApiWatchRetryStore {
  get(sourceFamily: SwaggerSourceFamily): Promise<ApiWatchRetryState | undefined>;
  save(state: ApiWatchRetryState): Promise<ApiWatchRetryState>;
  clear(sourceFamily: SwaggerSourceFamily): Promise<void>;
  list(): Promise<ApiWatchRetryState[]>;
}

export type _TypeOnlyGuards = {
  artifact: SwaggerArtifact;
  request: SwaggerSourceRequest;
};
