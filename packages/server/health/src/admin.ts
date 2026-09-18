import { z } from "zod";
import {
  EvaluationPhaseSchema,
  EvaluationOutcomeSchema,
  H5RecommendationSchema,
  type H5EvaluationResult,
} from "./evaluation.js";
import {
  BaselineContourKeySchema,
  HealthBrowserFamilySchema,
  HealthLevelSchema,
  HealthStateSchema,
  SafeEvidenceReferenceSchema,
} from "./types.js";

const Timestamp = z.string().datetime({ offset: true });
const Uuid = z.uuid();
const Cursor = z.string().min(1).max(128).optional();
const Limit = z.coerce.number().int().min(1).max(50).default(25);
const OptionalText = z.string().min(1).max(128).optional();

export const HealthNotificationEventKindSchema = z.enum([
  "INCIDENT_OPENED",
  "INCIDENT_ESCALATED",
  "INCIDENT_RECOVERED",
  "MAINTENANCE_ENTERED",
  "MAINTENANCE_EXITED",
]);
export const HealthNotificationSeveritySchema = z.enum([
  "INFO",
  "WARNING",
  "CRITICAL",
]);
export const HealthNotificationStateSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "DELIVERED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "SUPPRESSED",
]);
export const HealthNotificationProviderResultCodeSchema = z.enum([
  "DELIVERED",
  "TRANSIENT_PROVIDER_FAILURE",
  "RATE_LIMIT",
  "CONFIGURATION_ERROR",
  "PERMANENT_PROVIDER_REJECTION",
  "DISABLED_ROUTE",
  "UNKNOWN",
]);
export const HealthNotificationSuppressionReasonSchema = z.enum([
  "COOLDOWN",
  "MAINTENANCE_ENTERED",
  "DISABLED_ROUTE",
  "OTHER",
]);
export const HealthNotificationSinkSchema = z.enum([
  "DETERMINISTIC_TEST_SINK",
  "DISABLED_SINK",
]);
export const HealthNotificationCursorSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

export const HealthAdminTargetQuerySchema = z
  .object({
    limit: Limit,
    cursor: Cursor,
    provider: OptionalText,
    surface: OptionalText,
    healthState: HealthStateSchema.optional(),
    browserFamily: HealthBrowserFamilySchema.optional(),
    activeOnly: z.coerce.boolean().default(false),
  })
  .strict();
export type HealthAdminTargetQuery = z.infer<
  typeof HealthAdminTargetQuerySchema
>;

export const HealthAdminIncidentQuerySchema = z
  .object({
    limit: Limit,
    cursor: Cursor,
    provider: OptionalText,
    surface: OptionalText,
    incidentStatus: z
      .enum([
        "OPEN",
        "INVESTIGATING",
        "CANDIDATE_FIX",
        "CANDIDATE_PASS",
        "CANARY_ROLLOUT",
        "ROLLOUT",
        "RESOLVED",
        "FALSE_POSITIVE",
        "MAINTENANCE",
      ])
      .optional(),
    activeOnly: z.coerce.boolean().default(false),
  })
  .strict();
export type HealthAdminIncidentQuery = z.infer<
  typeof HealthAdminIncidentQuerySchema
>;

export const HealthAdminEvaluationQuerySchema = z
  .object({
    limit: Limit,
    cursor: Cursor,
    provider: OptionalText,
    surface: OptionalText,
    phase: EvaluationPhaseSchema.optional(),
    profileRevisionId: Uuid.optional(),
    browserFamily: HealthBrowserFamilySchema.optional(),
  })
  .strict();
export type HealthAdminEvaluationQuery = z.infer<
  typeof HealthAdminEvaluationQuerySchema
>;

export const HealthAdminRecommendationQuerySchema = z
  .object({
    limit: Limit,
    cursor: Cursor,
    provider: OptionalText,
    surface: OptionalText,
    profileRevisionId: Uuid.optional(),
    browserFamily: HealthBrowserFamilySchema.optional(),
  })
  .strict();
export type HealthAdminRecommendationQuery = z.infer<
  typeof HealthAdminRecommendationQuerySchema
>;

export const HealthNotificationAdminQuerySchema = z
  .object({
    limit: Limit,
    cursor: HealthNotificationCursorSchema.optional(),
    state: HealthNotificationStateSchema.optional(),
    eventKind: HealthNotificationEventKindSchema.optional(),
    severity: HealthNotificationSeveritySchema.optional(),
    incidentId: Uuid.optional(),
    provider: OptionalText,
    surface: OptionalText,
    routeKey: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .optional(),
  })
  .strict();
export type HealthNotificationAdminQuery = z.infer<
  typeof HealthNotificationAdminQuerySchema
>;

export const HealthAvailabilityRecommendationSchema = z.enum([
  "NO_RESTRICTION_SIGNAL",
  "ADVISORY_HOLD",
  "SCOPED_RESTRICTION_RECOMMENDED",
  "ROLLBACK_RECOMMENDED",
  "INCONCLUSIVE",
  "STALE",
]);
export type HealthAvailabilityRecommendation = z.infer<
  typeof HealthAvailabilityRecommendationSchema
>;

export const HealthAdminEvidenceReferenceSchema = SafeEvidenceReferenceSchema;
export const HealthAdminProfileRevisionSchema = z
  .object({
    id: Uuid,
    revision: z.number().int().positive(),
    state: z.enum(["DRAFT", "CANDIDATE", "PUBLISHED", "RETIRED"]),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    role: z.enum(["CURRENT_BASELINE", "CANDIDATE", "NONE"]),
  })
  .strict();

export const HealthProfileEvaluationSummarySchema = z
  .object({
    id: Uuid,
    evaluationKey: z.string().regex(/^[0-9a-f]{64}$/),
    phase: EvaluationPhaseSchema,
    baselineProfileRevisionId: Uuid,
    candidateProfileRevisionId: Uuid,
    outcome: EvaluationOutcomeSchema,
    recommendation: H5RecommendationSchema.nullable(),
    postRolloutOutcome: z
      .enum(["STABLE", "REGRESSION", "RECOVERED", "INCONCLUSIVE"])
      .nullable(),
    comparability: z.enum(["COMPARABLE", "NOT_COMPARABLE", "NOT_APPLICABLE"]),
    decisiveContours: z.array(BaselineContourKeySchema).max(13),
    evidenceReferences: z.array(HealthAdminEvidenceReferenceSchema).max(32),
    currentAuthority: z.boolean(),
    firstEvaluatedAt: Timestamp,
    latestEvaluatedAt: Timestamp,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict();
export type HealthProfileEvaluationSummary = z.infer<
  typeof HealthProfileEvaluationSummarySchema
>;

export const HealthIncidentSummarySchema = z
  .object({
    id: Uuid,
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    variant: z.string().min(1).max(128),
    browserFamily: HealthBrowserFamilySchema,
    status: z.enum([
      "OPEN",
      "INVESTIGATING",
      "CANDIDATE_FIX",
      "CANDIDATE_PASS",
      "CANARY_ROLLOUT",
      "ROLLOUT",
      "RESOLVED",
      "FALSE_POSITIVE",
      "MAINTENANCE",
    ]),
    rootContourKey: BaselineContourKeySchema.nullable(),
    firstSeenRunId: Uuid,
    latestSeenRunId: Uuid,
    lastObservedRunId: Uuid,
    firstSeenAt: Timestamp,
    lastSeenAt: Timestamp,
    lastObservedAt: Timestamp,
    resolvedByRunId: Uuid.nullable(),
    resolvedAt: Timestamp.nullable(),
  })
  .strict();
export type HealthIncidentSummary = z.infer<typeof HealthIncidentSummarySchema>;

export const HealthRecommendationSchema = z
  .object({
    recommendation: HealthAvailabilityRecommendationSchema,
    sourceRecommendation: H5RecommendationSchema.nullable(),
    reasonCode: z.string().min(1).max(128),
    severity: z.enum(["IMPORTANT_NON_CORE", "CORE"]).nullable(),
    evaluationId: Uuid.nullable(),
    evaluationKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    incidentId: Uuid.nullable(),
    profileRevisionId: Uuid.nullable(),
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    variant: z.string().min(1).max(128),
    browserFamily: HealthBrowserFamilySchema,
    browserVersionScope: z.string().min(1).max(64),
    monitoringLayer: z.enum(["NO_SESSION", "AUTHENTICATED_DEEP"]),
    evidenceReferences: z.array(HealthAdminEvidenceReferenceSchema).max(32),
    issuedAt: Timestamp.nullable(),
    evaluationRevision: z.number().int().positive().nullable(),
    freshnessAuthority: z.string().min(1).max(256).nullable(),
    executionAuthority: z.literal(false),
  })
  .strict();
export type HealthRecommendation = z.infer<typeof HealthRecommendationSchema>;

const HealthNotificationSummaryFields = {
  id: Uuid,
  sourceDomain: z.literal("LLM_HEALTH"),
  incidentId: Uuid,
  eventKind: HealthNotificationEventKindSchema,
  severity: HealthNotificationSeveritySchema,
  state: HealthNotificationStateSchema,
  routeKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  groupCount: z.number().int().positive(),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: Timestamp,
  deliveredAt: Timestamp.nullable(),
  suppressionReason: HealthNotificationSuppressionReasonSchema.nullable(),
  firstObservedAt: Timestamp,
  latestObservedAt: Timestamp,
  cooldownUntil: Timestamp,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  lastProviderResultCode: HealthNotificationProviderResultCodeSchema.nullable(),
  providerSink: HealthNotificationSinkSchema.nullable(),
  provider: z.string().min(1).max(64),
  surface: z.string().min(1).max(128),
};

export const HealthNotificationIntentSummarySchema = z
  .object(HealthNotificationSummaryFields)
  .strict();
export type HealthNotificationIntentSummary = z.infer<
  typeof HealthNotificationIntentSummarySchema
>;

export const HealthNotificationIntentDetailSchema =
  HealthNotificationIntentSummarySchema.extend({
    dedupIdentity: z
      .object({
        scheme: z.literal("LLM_HEALTH_V1"),
        eventKind: HealthNotificationEventKindSchema,
        severity: HealthNotificationSeveritySchema,
      })
      .strict(),
    claim: z
      .object({
        state: z.enum(["CLAIMED", "UNCLAIMED"]),
        leaseExpiresAt: Timestamp.nullable(),
        attempt: z.number().int().nonnegative(),
      })
      .strict(),
    sourceHealth: z
      .object({
        healthRunId: Uuid,
        healthState: HealthStateSchema,
        healthLevel: HealthLevelSchema,
        browserFamily: HealthBrowserFamilySchema,
        browserVersion: z.string().min(1).max(64),
        variant: z.string().min(1).max(128),
      })
      .strict(),
    incident: HealthIncidentSummarySchema,
    evidenceReferences: z.array(HealthAdminEvidenceReferenceSchema).max(32),
    retention: z
      .object({
        retentionClass: z.string().min(1).max(64),
        expiresAt: Timestamp.nullable(),
      })
      .strict(),
  }).strict();
export type HealthNotificationIntentDetail = z.infer<
  typeof HealthNotificationIntentDetailSchema
>;

export type HealthNotificationAdminReadRepository = {
  listNotifications(
    input: HealthNotificationAdminQuery,
  ): Promise<HealthAdminPage<HealthNotificationIntentSummary>>;
  getNotification(id: string): Promise<HealthNotificationIntentDetail | null>;
};

export const HealthAdminTargetSummarySchema = z
  .object({
    targetId: z.string().regex(/^[0-9a-f]{64}$/),
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    variant: z.string().min(1).max(128),
    monitoringLayer: z.enum(["NO_SESSION", "AUTHENTICATED_DEEP"]),
    browserFamily: HealthBrowserFamilySchema,
    browserVersion: z.string().min(1).max(64),
    latestHealthState: HealthStateSchema.nullable(),
    latestObservationAt: Timestamp.nullable(),
    latestSuccessfulRunAt: Timestamp.nullable(),
    latestSchedulerState: z
      .enum([
        "PENDING",
        "CLAIMED",
        "RUNNING",
        "SUCCEEDED",
        "FAILED_RETRYABLE",
        "FAILED_TERMINAL",
        "TIMED_OUT",
        "CANCELLED",
      ])
      .nullable(),
    activeIncidentId: Uuid.nullable(),
    baselineProfileRevisionId: Uuid.nullable(),
    candidateProfileRevisionId: Uuid.nullable(),
    candidateState: z.enum(["CANDIDATE_PRESENT", "NO_CANDIDATE"]),
    latestH4Result: EvaluationOutcomeSchema.nullable(),
    latestH5Result: z
      .union([
        EvaluationOutcomeSchema,
        z.enum(["CANARY_ASSESSMENT", "STABLE", "REGRESSION", "RECOVERED"]),
      ])
      .nullable(),
    recommendation: HealthAvailabilityRecommendationSchema.nullable(),
  })
  .strict();
export type HealthAdminTargetSummary = z.infer<
  typeof HealthAdminTargetSummarySchema
>;

export const HealthAdminTargetDetailSchema =
  HealthAdminTargetSummarySchema.extend({
    healthSuiteMachineKey: z.string().min(1).max(64).nullable(),
    healthSuiteRevision: z.number().int().positive().nullable(),
    extensionVersion: z.string().min(1).max(64).nullable(),
    adapterEngineVersion: z.string().min(1).max(64).nullable(),
    baselineProfile: HealthAdminProfileRevisionSchema.nullable(),
    candidateProfile: HealthAdminProfileRevisionSchema.nullable(),
    contourStatuses: z
      .array(
        z
          .object({
            contourKey: BaselineContourKeySchema,
            outcome: z.enum(["PASS", "DRIFT", "DEGRADED", "BROKEN", "UNKNOWN"]),
          })
          .strict(),
      )
      .max(13),
    evidenceReferences: z.array(HealthAdminEvidenceReferenceSchema).max(32),
    activeIncident: HealthIncidentSummarySchema.nullable(),
    evaluations: z.array(HealthProfileEvaluationSummarySchema).max(20),
    healthRecommendation: HealthRecommendationSchema.nullable(),
  }).strict();
export type HealthAdminTargetDetail = z.infer<
  typeof HealthAdminTargetDetailSchema
>;

export const HealthAdminEvaluationDetailSchema =
  HealthProfileEvaluationSummarySchema.extend({
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    variant: z.string().min(1).max(128),
    target: z.string().min(1).max(128),
    monitoringLayer: z.enum(["NO_SESSION", "AUTHENTICATED_DEEP"]),
    browserFamily: HealthBrowserFamilySchema,
    browserVersion: z.string().min(1).max(64),
    environmentClass: z.string().min(1).max(128),
    incidentId: Uuid.nullable(),
    recommendationView: HealthRecommendationSchema.nullable(),
  }).strict();
export type HealthAdminEvaluationDetail = z.infer<
  typeof HealthAdminEvaluationDetailSchema
>;

export type HealthAdminPage<T> = { items: T[]; nextCursor: string | null };

export type HealthAdminReadRepository = {
  listTargets(
    input: HealthAdminTargetQuery,
  ): Promise<HealthAdminPage<HealthAdminTargetDetail>>;
  getTarget(targetId: string): Promise<HealthAdminTargetDetail | null>;
  listIncidents(
    input: HealthAdminIncidentQuery,
  ): Promise<HealthAdminPage<HealthIncidentSummary>>;
  getIncident(id: string): Promise<HealthIncidentSummary | null>;
  listEvaluations(
    input: HealthAdminEvaluationQuery,
  ): Promise<HealthAdminPage<HealthAdminEvaluationDetail>>;
  getEvaluation(id: string): Promise<HealthAdminEvaluationDetail | null>;
  listRecommendations(
    input: HealthAdminRecommendationQuery,
  ): Promise<HealthAdminPage<HealthRecommendation>>;
};

export function createHealthAdminReadService(
  repository: HealthAdminReadRepository,
): HealthAdminReadRepository {
  return {
    async listTargets(input) {
      return HealthAdminPageSchema(HealthAdminTargetDetailSchema).parse(
        await repository.listTargets(HealthAdminTargetQuerySchema.parse(input)),
      );
    },
    async getTarget(targetId) {
      const value = await repository.getTarget(targetId);
      return value ? HealthAdminTargetDetailSchema.parse(value) : null;
    },
    async listIncidents(input) {
      return HealthAdminPageSchema(HealthIncidentSummarySchema).parse(
        await repository.listIncidents(
          HealthAdminIncidentQuerySchema.parse(input),
        ),
      );
    },
    async getIncident(id) {
      const value = await repository.getIncident(id);
      return value ? HealthIncidentSummarySchema.parse(value) : null;
    },
    async listEvaluations(input) {
      return HealthAdminPageSchema(HealthAdminEvaluationDetailSchema).parse(
        await repository.listEvaluations(
          HealthAdminEvaluationQuerySchema.parse(input),
        ),
      );
    },
    async getEvaluation(id) {
      const value = await repository.getEvaluation(id);
      return value ? HealthAdminEvaluationDetailSchema.parse(value) : null;
    },
    async listRecommendations(input) {
      return HealthAdminPageSchema(HealthRecommendationSchema).parse(
        await repository.listRecommendations(
          HealthAdminRecommendationQuerySchema.parse(input),
        ),
      );
    },
  };
}

function HealthAdminPageSchema<T extends z.ZodType>(item: T) {
  return z
    .object({ items: z.array(item), nextCursor: z.string().nullable() })
    .strict();
}

export type HealthAvailabilityReaderInput = {
  provider: string;
  surface: string;
  variant: string;
  profileRevisionId: string;
  browserFamily: "chrome" | "yandex_chromium";
  browserVersion: string;
  monitoringLayer: "NO_SESSION" | "AUTHENTICATED_DEEP";
  evaluation: H5EvaluationResult;
  evaluationId: string;
  incidentId?: string | null;
};

export function deriveHealthAvailabilityRecommendation(
  input: HealthAvailabilityReaderInput,
): HealthRecommendation {
  const evaluation = input.evaluation;
  const identity = evaluation.identity;
  const scopeMatches =
    identity.provider === input.provider &&
    identity.surface === input.surface &&
    identity.variant === input.variant &&
    identity.candidateProfileRevisionId === input.profileRevisionId &&
    identity.browserFamily === input.browserFamily &&
    identity.browserVersion === input.browserVersion &&
    identity.monitoringLayer === input.monitoringLayer;
  const stale = !scopeMatches;
  const source = evaluation.recommendation;
  const recommendation: HealthAvailabilityRecommendation = stale
    ? "STALE"
    : source === "CONTINUE"
      ? "NO_RESTRICTION_SIGNAL"
      : source === "HOLD"
        ? "ADVISORY_HOLD"
        : source === "RESTRICT"
          ? "SCOPED_RESTRICTION_RECOMMENDED"
          : source === "ROLLBACK_RECOMMENDED"
            ? "ROLLBACK_RECOMMENDED"
            : "INCONCLUSIVE";
  const evidence = evaluation.evidenceReferences.slice(0, 32);
  return HealthRecommendationSchema.parse({
    recommendation,
    sourceRecommendation: source,
    reasonCode: stale ? "STALE_EVALUATION_SCOPE" : `H5_${source}`,
    severity: null,
    evaluationId: Uuid.parse(input.evaluationId),
    evaluationKey: evaluation.evaluationKey,
    incidentId: input.incidentId ?? null,
    profileRevisionId: input.profileRevisionId,
    provider: input.provider,
    surface: input.surface,
    variant: input.variant,
    browserFamily: input.browserFamily,
    browserVersionScope: input.browserVersion,
    monitoringLayer: input.monitoringLayer,
    evidenceReferences: evidence,
    issuedAt: evaluation.evaluatedAt.toISOString(),
    evaluationRevision: identity.healthSuiteRevision,
    freshnessAuthority: `${evaluation.evaluationKey}:${identity.healthSuiteRevision}`,
    executionAuthority: false,
  });
}
