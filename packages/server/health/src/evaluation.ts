import { createHash, randomUUID } from "node:crypto";
import { PersistedProfileRevisionSchema } from "@product/adapter-registry";
import { canonicalizeJson } from "@product/remote-config";
import { z } from "zod";
import { BrowserFamilies } from "@product/shared";
import {
  BaselineContourKeySchema,
  HealthContourResultSchema,
  HealthStateSchema,
  SafeEvidenceReferenceSchema,
  type HealthContourResult,
  type HealthState,
} from "./types.js";
import { validateH0ProfileCandidate, type H0ValidationEvidence } from "./h0.js";

export const EvaluationPhaseSchema = z.enum([
  "H4_CANDIDATE",
  "H5_CANARY",
  "H5_POST_ROLLOUT",
]);
export type EvaluationPhase = z.infer<typeof EvaluationPhaseSchema>;

export const EvaluationMonitoringLayerSchema = z.enum([
  "NO_SESSION",
  "AUTHENTICATED_DEEP",
]);
export type EvaluationMonitoringLayer = z.infer<
  typeof EvaluationMonitoringLayerSchema
>;

export const EvaluationOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "INCONCLUSIVE",
  "ENVIRONMENT_BLOCKED",
  "INVALID_CANDIDATE",
  "NOT_APPLICABLE",
]);
export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

export const H5RecommendationSchema = z.enum([
  "CONTINUE",
  "HOLD",
  "RESTRICT",
  "ROLLBACK_RECOMMENDED",
  "INCONCLUSIVE",
]);
export type H5Recommendation = z.infer<typeof H5RecommendationSchema>;

export const H5PostRolloutOutcomeSchema = z.enum([
  "STABLE",
  "REGRESSION",
  "RECOVERED",
  "INCONCLUSIVE",
]);
export type H5PostRolloutOutcome = z.infer<typeof H5PostRolloutOutcomeSchema>;

export const CandidateReadinessSchema = z.enum([
  "PROFILE_CANDIDATE_AVAILABLE",
  "NO_PRODUCT_PROFILE_AUTHORITY",
  "CANDIDATE_NOT_PRESENT",
  "NOT_OBSERVABLE_IN_THIS_LAYER",
  "SESSION_REQUIRED_FOR_DEEP_EVALUATION",
]);
export type CandidateReadiness = z.infer<typeof CandidateReadinessSchema>;

const RevisionReferenceSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    schemaVersion: z.literal("adapter_profile_v1"),
  })
  .strict();
export type RevisionReference = z.infer<typeof RevisionReferenceSchema>;

export const EvaluationIdentitySchema = z
  .object({
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    target: z.string().min(1).max(128),
    variant: z.string().min(1).max(128).nullable(),
    monitoringLayer: EvaluationMonitoringLayerSchema,
    baselineProfileRevisionId: z.uuid(),
    candidateProfileRevisionId: z.uuid(),
    healthSuiteMachineKey: z.string().min(1).max(64),
    healthSuiteRevision: z.number().int().positive(),
    phase: EvaluationPhaseSchema,
    browserFamily: z.enum(BrowserFamilies),
    browserVersion: z.string().min(1).max(64),
    environmentClass: z.string().min(1).max(128),
  })
  .strict();
export type EvaluationIdentity = z.infer<typeof EvaluationIdentitySchema>;

export const EvaluationObservationScopeSchema = z
  .object({
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    target: z.string().min(1).max(128),
    variant: z.string().min(1).max(128).nullable(),
    monitoringLayer: EvaluationMonitoringLayerSchema,
    browserFamily: z.enum(BrowserFamilies),
    browserVersion: z.string().min(1).max(64),
    environmentClass: z.string().min(1).max(128),
    healthSuiteMachineKey: z.string().min(1).max(64),
    healthSuiteRevision: z.number().int().positive(),
    profileRevisionId: z.uuid(),
  })
  .strict();
export type EvaluationObservationScope = z.infer<
  typeof EvaluationObservationScopeSchema
>;

export const HealthRunSnapshotSchema = z
  .object({
    executionId: z.uuid(),
    scope: EvaluationObservationScopeSchema,
    state: HealthStateSchema,
    operatorMaintenance: z.boolean(),
    contours: z.array(HealthContourResultSchema).max(13),
    evidence: z.array(SafeEvidenceReferenceSchema).max(104),
    evaluatedAt: z.date(),
  })
  .strict();
export type HealthRunSnapshot = z.infer<typeof HealthRunSnapshotSchema>;

export const H4EvaluationPolicySchema = z
  .object({
    requiredSuccessfulComparableExecutions: z.number().int().min(1).max(8),
    maximumEnvironmentInconclusiveExecutions: z.number().int().min(0).max(8),
    maximumRegressionExecutions: z.number().int().min(0).max(8),
  })
  .strict();
export type H4EvaluationPolicy = z.infer<typeof H4EvaluationPolicySchema>;

export const DEFAULT_H4_EVALUATION_POLICY: H4EvaluationPolicy = {
  requiredSuccessfulComparableExecutions: 1,
  maximumEnvironmentInconclusiveExecutions: 0,
  maximumRegressionExecutions: 0,
};

export const H4ComparisonSchema = z
  .object({
    baselineState: HealthStateSchema,
    candidateState: HealthStateSchema,
    matrixDecision: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
    contourRegressions: z
      .array(
        z
          .object({
            contourKey: BaselineContourKeySchema,
            baselineOutcome: z.enum([
              "PASS",
              "DRIFT",
              "DEGRADED",
              "BROKEN",
              "UNKNOWN",
            ]),
            candidateOutcome: z.enum([
              "PASS",
              "DRIFT",
              "DEGRADED",
              "BROKEN",
              "UNKNOWN",
            ]),
            severity: z.enum(["CORE", "IMPORTANT_NON_CORE"]),
            reason: z.string().min(1).max(256),
          })
          .strict(),
      )
      .max(13),
    decisiveContours: z.array(BaselineContourKeySchema).max(13),
    evidenceReferences: z.array(SafeEvidenceReferenceSchema).max(208),
  })
  .strict();
export type H4Comparison = z.infer<typeof H4ComparisonSchema>;

export const H4EvaluationResultSchema = z
  .object({
    evaluationKey: z.string().regex(/^[0-9a-f]{64}$/),
    identity: EvaluationIdentitySchema,
    outcome: EvaluationOutcomeSchema,
    baseline: HealthRunSnapshotSchema,
    candidate: HealthRunSnapshotSchema,
    comparison: H4ComparisonSchema.nullable(),
    candidateRevision: RevisionReferenceSchema,
    suiteAuthority: z
      .object({ machineKey: z.string(), revision: z.number().int().positive() })
      .strict(),
    environmentAuthority: z.string().min(1).max(128),
    changedDeclarativeFieldPaths: z.array(z.string().min(1).max(256)).max(64),
    decisiveReason: z.string().min(1).max(512),
    evaluatedAt: z.date(),
    executionIds: z.array(z.uuid()).min(1).max(16),
  })
  .strict();
export type H4EvaluationResult = z.infer<typeof H4EvaluationResultSchema>;

export const AvailabilityRestrictionSignalSchema = z
  .object({
    signalId: z.uuid(),
    provider: z.string().min(1).max(64),
    surface: z.string().min(1).max(128),
    profileRevisionId: z.uuid(),
    browserFamily: z.enum(BrowserFamilies),
    browserVersionRange: z.string().min(1).max(128),
    browserVersionScope: z.string().min(1).max(128),
    target: z.string().min(1).max(128),
    monitoringLayer: EvaluationMonitoringLayerSchema,
    reasonCode: z.string().min(1).max(128),
    reason: z.string().min(1).max(512),
    evaluationId: z.string().regex(/^[0-9a-f]{64}$/),
    evaluationRevision: z.number().int().positive(),
    freshnessAuthority: z.string().min(1).max(256),
    evaluationKey: z.string().regex(/^[0-9a-f]{64}$/),
    incidentReference: z.string().min(1).max(128).nullable(),
    severity: z.enum(["IMPORTANT_NON_CORE", "CORE"]),
    recommendation: z.literal("RESTRICT"),
    evidenceReferences: z.array(SafeEvidenceReferenceSchema).max(32),
    issuedAt: z.date(),
    executionAuthority: z.literal(false),
  })
  .strict();
export type AvailabilityRestrictionSignal = z.infer<
  typeof AvailabilityRestrictionSignalSchema
>;

export const H5EvaluationResultSchema = z
  .object({
    evaluationKey: z.string().regex(/^[0-9a-f]{64}$/),
    identity: EvaluationIdentitySchema,
    phase: z.enum(["H5_CANARY", "H5_POST_ROLLOUT"]),
    outcome: z.union([
      H5PostRolloutOutcomeSchema,
      z.literal("CANARY_ASSESSMENT"),
    ]),
    recommendation: H5RecommendationSchema,
    h4Comparison: H4ComparisonSchema.nullable(),
    evidenceReferences: z.array(SafeEvidenceReferenceSchema).max(208),
    executionIds: z.array(z.uuid()).min(1).max(16),
    executionAuthority: z.literal(false),
    evaluatedAt: z.date(),
  })
  .strict();
export type H5EvaluationResult = z.infer<typeof H5EvaluationResultSchema>;

export const H4ExecutionAssessmentSchema = z
  .object({
    outcome: EvaluationOutcomeSchema,
    evaluatedAt: z.date(),
  })
  .strict();
export type H4ExecutionAssessment = z.infer<typeof H4ExecutionAssessmentSchema>;

function evaluationKey(identity: EvaluationIdentity): string {
  return createHash("sha256").update(canonicalizeJson(identity)).digest("hex");
}

function parseIdentity(input: unknown): EvaluationIdentity {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const copy = { ...(input as Record<string, unknown>) };
    delete copy.evaluationKey;
    return EvaluationIdentitySchema.parse(copy);
  }
  return EvaluationIdentitySchema.parse(input);
}

function comparable(
  identity: EvaluationIdentity,
  baseline: HealthRunSnapshot,
  candidate: HealthRunSnapshot,
): boolean {
  const expected = {
    provider: identity.provider,
    surface: identity.surface,
    target: identity.target,
    variant: identity.variant,
    monitoringLayer: identity.monitoringLayer,
    browserFamily: identity.browserFamily,
    browserVersion: identity.browserVersion,
    environmentClass: identity.environmentClass,
    healthSuiteMachineKey: identity.healthSuiteMachineKey,
    healthSuiteRevision: identity.healthSuiteRevision,
  };
  const same = (scope: EvaluationObservationScope) =>
    JSON.stringify({ ...scope, profileRevisionId: undefined }) ===
    JSON.stringify({ ...expected, profileRevisionId: undefined });
  return (
    same(baseline.scope) &&
    same(candidate.scope) &&
    baseline.scope.profileRevisionId === identity.baselineProfileRevisionId &&
    candidate.scope.profileRevisionId === identity.candidateProfileRevisionId
  );
}

type ContourOutcome = "PASS" | "DRIFT" | "DEGRADED" | "BROKEN" | "UNKNOWN";
const contourRank: Record<ContourOutcome, number> = {
  PASS: 0,
  DRIFT: 1,
  DEGRADED: 2,
  BROKEN: 3,
  UNKNOWN: 4,
};

function contourOutcome(
  result: HealthContourResult | undefined,
): ContourOutcome {
  if (!result || result.environmentStatus === "UNCERTAIN") return "UNKNOWN";
  if (result.observationStatus !== "PRESENT")
    return result.required && result.failureSeverity === "CORE"
      ? "BROKEN"
      : "DEGRADED";
  if (
    result.primaryStrategyOutcome === "PASS" &&
    result.structuralOutcome === "PASS" &&
    result.behavioralOutcome === "PASS"
  )
    return "PASS";
  if (
    result.selectedStrategyId !== null &&
    result.selectedStrategyId !== result.primaryStrategyId &&
    result.fallbackQuality === "APPROVED_EQUIVALENT" &&
    result.fallbackStrategyOutcomes.some(
      (attempt) =>
        attempt.strategyId === result.selectedStrategyId &&
        attempt.outcome === "PASS",
    ) &&
    result.structuralOutcome === "PASS" &&
    result.behavioralOutcome === "PASS"
  )
    return "DRIFT";
  if (result.required && result.failureSeverity === "CORE") return "BROKEN";
  return "DEGRADED";
}

const states: readonly HealthState[] = [
  "HEALTHY",
  "DRIFT",
  "DEGRADED",
  "BROKEN",
  "UNKNOWN",
  "MAINTENANCE",
];
export type H4MatrixDecision = "PASS" | "FAIL" | "INCONCLUSIVE";
export type H4ComparisonMatrix = {
  readonly [baseline in HealthState]: Readonly<{
    [candidate in HealthState]: H4MatrixDecision;
  }>;
};
export const H4_COMPARISON_MATRIX: H4ComparisonMatrix = Object.fromEntries(
  states.map((baseline) => [
    baseline,
    Object.fromEntries(
      states.map((candidate) => {
        if (
          baseline === "MAINTENANCE" ||
          candidate === "MAINTENANCE" ||
          baseline === "UNKNOWN" ||
          candidate === "UNKNOWN"
        )
          return [candidate, "INCONCLUSIVE"];
        if (baseline === "HEALTHY")
          return [candidate, candidate === "HEALTHY" ? "PASS" : "FAIL"];
        if (candidate === "HEALTHY") return [candidate, "PASS"];
        if (baseline === "DRIFT")
          return [candidate, candidate === "DRIFT" ? "INCONCLUSIVE" : "FAIL"];
        if (baseline === "DEGRADED") return [candidate, "INCONCLUSIVE"];
        return [candidate, "INCONCLUSIVE"];
      }),
    ),
  ]),
) as H4ComparisonMatrix;

function makeComparison(
  baseline: HealthRunSnapshot,
  candidate: HealthRunSnapshot,
): H4Comparison {
  const matrixDecision = H4_COMPARISON_MATRIX[baseline.state][candidate.state];
  const baselineByKey = new Map(
    baseline.contours.map((item) => [item.contourKey, item]),
  );
  const candidateByKey = new Map(
    candidate.contours.map((item) => [item.contourKey, item]),
  );
  const contourRegressions: H4Comparison["contourRegressions"] = [];
  const decisiveContours = new Set<HealthContourResult["contourKey"]>();
  for (const key of new Set([
    ...baselineByKey.keys(),
    ...candidateByKey.keys(),
  ])) {
    const before = contourOutcome(baselineByKey.get(key));
    const after = contourOutcome(candidateByKey.get(key));
    if (contourRank[after] > contourRank[before]) {
      const result = candidateByKey.get(key) ?? baselineByKey.get(key);
      const severity = result?.failureSeverity ?? "CORE";
      contourRegressions.push({
        contourKey: key,
        baselineOutcome: before,
        candidateOutcome: after,
        severity,
        reason: "candidate contour is worse than baseline",
      });
      decisiveContours.add(key);
    }
  }
  return H4ComparisonSchema.parse({
    baselineState: baseline.state,
    candidateState: candidate.state,
    matrixDecision,
    contourRegressions,
    decisiveContours: [...decisiveContours],
    evidenceReferences: [...baseline.evidence, ...candidate.evidence].slice(
      0,
      208,
    ),
  });
}

function revisionReference(evidence: H0ValidationEvidence): RevisionReference {
  return {
    id: evidence.profileRevisionId,
    revision: evidence.revision,
    contentSha256: evidence.contentSha256,
    schemaVersion: evidence.schemaVersion,
  };
}

function validateCandidateReference(
  identity: EvaluationIdentity,
  candidateProfile: unknown,
): { evidence: H0ValidationEvidence; reference: RevisionReference } {
  const parsed = PersistedProfileRevisionSchema.parse(candidateProfile);
  const evidence = validateH0ProfileCandidate(parsed);
  if (evidence.profileRevisionId !== identity.candidateProfileRevisionId)
    throw new Error("H4_CANDIDATE_REVISION_ID_MISMATCH");
  return { evidence, reference: revisionReference(evidence) };
}

export function makeEvaluationIdentity(
  input: unknown,
): EvaluationIdentity & { evaluationKey: string } {
  const identity = parseIdentity(input);
  return { ...identity, evaluationKey: evaluationKey(identity) };
}

export function evaluateH4Candidate(input: {
  identity: unknown;
  candidateProfile: unknown;
  baseline: unknown;
  candidate: unknown;
  changedDeclarativeFieldPaths?: readonly string[];
  readiness?: CandidateReadiness;
}): H4EvaluationResult {
  const identity = parseIdentity(input.identity);
  if (identity.phase !== "H4_CANDIDATE") throw new Error("H4_PHASE_REQUIRED");
  const baseline = HealthRunSnapshotSchema.parse(input.baseline);
  const candidate = HealthRunSnapshotSchema.parse(input.candidate);
  const key = evaluationKey(identity);
  if (input.readiness && input.readiness !== "PROFILE_CANDIDATE_AVAILABLE") {
    return result(
      key,
      identity,
      baseline,
      candidate,
      {
        id: identity.candidateProfileRevisionId,
        revision: 1,
        contentSha256: "0".repeat(64),
        schemaVersion: "adapter_profile_v1",
      },
      null,
      "NOT_APPLICABLE",
      input.readiness,
      input.changedDeclarativeFieldPaths,
    );
  }
  let candidateRevision: RevisionReference;
  try {
    candidateRevision = validateCandidateReference(
      identity,
      input.candidateProfile,
    ).reference;
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.slice(0, 256)
        : "INVALID_CANDIDATE";
    return H4EvaluationResultSchema.parse({
      evaluationKey: key,
      identity,
      outcome: "INVALID_CANDIDATE",
      baseline,
      candidate,
      comparison: null,
      candidateRevision: {
        id: identity.candidateProfileRevisionId,
        revision: 1,
        contentSha256: "0".repeat(64),
        schemaVersion: "adapter_profile_v1",
      },
      suiteAuthority: {
        machineKey: identity.healthSuiteMachineKey,
        revision: identity.healthSuiteRevision,
      },
      environmentAuthority: identity.environmentClass,
      changedDeclarativeFieldPaths: [
        ...(input.changedDeclarativeFieldPaths ?? []),
      ],
      decisiveReason: code,
      evaluatedAt: candidate.evaluatedAt,
      executionIds: [baseline.executionId, candidate.executionId],
    });
  }
  if (baseline.operatorMaintenance || candidate.operatorMaintenance)
    return result(
      key,
      identity,
      baseline,
      candidate,
      candidateRevision,
      null,
      "INCONCLUSIVE",
      "maintenance is not candidate quality",
      input.changedDeclarativeFieldPaths,
    );
  if (!comparable(identity, baseline, candidate))
    return result(
      key,
      identity,
      baseline,
      candidate,
      candidateRevision,
      null,
      "INCONCLUSIVE",
      "baseline and candidate observations are not comparable",
      input.changedDeclarativeFieldPaths,
    );
  if (
    (baseline.state === "UNKNOWN" || candidate.state === "UNKNOWN") &&
    [...baseline.contours, ...candidate.contours].some(
      (contour) => contour.environmentStatus === "UNCERTAIN",
    )
  )
    return result(
      key,
      identity,
      baseline,
      candidate,
      candidateRevision,
      null,
      "ENVIRONMENT_BLOCKED",
      "environment uncertainty prevents candidate comparison",
      input.changedDeclarativeFieldPaths,
    );
  const comparison = makeComparison(baseline, candidate);
  const outcome =
    comparison.contourRegressions.length > 0
      ? "FAIL"
      : comparison.matrixDecision === "PASS"
        ? "PASS"
        : comparison.matrixDecision === "FAIL"
          ? "FAIL"
          : "INCONCLUSIVE";
  return result(
    key,
    identity,
    baseline,
    candidate,
    candidateRevision,
    comparison,
    outcome,
    outcome === "PASS"
      ? "candidate is no worse on every comparable contour"
      : outcome === "FAIL"
        ? "candidate regression proven by state or contour comparison"
        : "comparability or environment evidence is insufficient",
    input.changedDeclarativeFieldPaths,
  );
}

function result(
  key: string,
  identity: EvaluationIdentity,
  baseline: HealthRunSnapshot,
  candidate: HealthRunSnapshot,
  candidateRevision: RevisionReference,
  comparison: H4Comparison | null,
  outcome: EvaluationOutcome,
  decisiveReason: string,
  changedDeclarativeFieldPaths: readonly string[] | undefined,
): H4EvaluationResult {
  return H4EvaluationResultSchema.parse({
    evaluationKey: key,
    identity,
    outcome,
    baseline,
    candidate,
    comparison,
    candidateRevision,
    suiteAuthority: {
      machineKey: identity.healthSuiteMachineKey,
      revision: identity.healthSuiteRevision,
    },
    environmentAuthority: identity.environmentClass,
    changedDeclarativeFieldPaths: [...(changedDeclarativeFieldPaths ?? [])],
    decisiveReason,
    evaluatedAt: candidate.evaluatedAt,
    executionIds: [baseline.executionId, candidate.executionId],
  });
}

export function aggregateH4Executions(
  assessments: readonly H4ExecutionAssessment[],
  policy: H4EvaluationPolicy = DEFAULT_H4_EVALUATION_POLICY,
): EvaluationOutcome {
  const parsedPolicy = H4EvaluationPolicySchema.parse(policy);
  const parsed = assessments.map((assessment) =>
    H4ExecutionAssessmentSchema.parse(assessment),
  );
  const regressions = parsed.filter((item) => item.outcome === "FAIL").length;
  const inconclusive = parsed.filter(
    (item) =>
      item.outcome === "INCONCLUSIVE" || item.outcome === "ENVIRONMENT_BLOCKED",
  ).length;
  const passes = parsed.filter((item) => item.outcome === "PASS").length;
  if (regressions > parsedPolicy.maximumRegressionExecutions) return "FAIL";
  if (inconclusive > parsedPolicy.maximumEnvironmentInconclusiveExecutions)
    return "INCONCLUSIVE";
  return passes >= parsedPolicy.requiredSuccessfulComparableExecutions
    ? "PASS"
    : "INCONCLUSIVE";
}

export function evaluateH5(input: {
  identity: unknown;
  candidateProfileState: "CANDIDATE" | "PUBLISHED";
  baseline: unknown;
  candidate: unknown;
  incidentReference?: string | null;
}): H5EvaluationResult {
  const identity = parseIdentity(input.identity);
  if (identity.phase === "H4_CANDIDATE") throw new Error("H5_PHASE_REQUIRED");
  if (input.candidateProfileState !== "PUBLISHED")
    throw new Error("H5_REQUIRES_PRODUCT_OWNED_PUBLISHED_PROFILE");
  const baseline = HealthRunSnapshotSchema.parse(input.baseline);
  const candidate = HealthRunSnapshotSchema.parse(input.candidate);
  const key = evaluationKey(identity);
  if (
    baseline.operatorMaintenance ||
    candidate.operatorMaintenance ||
    !comparable(identity, baseline, candidate)
  ) {
    return h5Result(
      key,
      identity,
      identity.phase,
      "INCONCLUSIVE",
      "INCONCLUSIVE",
      baseline,
      candidate,
    );
  }
  const comparison = makeComparison(baseline, candidate);
  const evidenceReferences = comparison.evidenceReferences;
  if (identity.phase === "H5_POST_ROLLOUT") {
    const outcome: H5PostRolloutOutcome =
      comparison.matrixDecision === "INCONCLUSIVE"
        ? "INCONCLUSIVE"
        : candidate.state === "HEALTHY" && baseline.state !== "HEALTHY"
          ? "RECOVERED"
          : comparison.matrixDecision === "PASS"
            ? "STABLE"
            : "REGRESSION";
    return h5Result(
      key,
      identity,
      identity.phase,
      outcome,
      outcome === "INCONCLUSIVE"
        ? "INCONCLUSIVE"
        : outcome === "REGRESSION"
          ? "RESTRICT"
          : "CONTINUE",
      baseline,
      candidate,
      comparison,
      evidenceReferences,
    );
  }
  const hasCoreRegression = comparison.contourRegressions.some(
    (regression) => regression.severity === "CORE",
  );
  const recommendation: H5Recommendation =
    comparison.matrixDecision === "INCONCLUSIVE"
      ? "INCONCLUSIVE"
      : candidate.state === "BROKEN" || hasCoreRegression
        ? "ROLLBACK_RECOMMENDED"
        : candidate.state === "DEGRADED" ||
            comparison.contourRegressions.length > 0
          ? "RESTRICT"
          : candidate.state === "DRIFT"
            ? "HOLD"
            : "CONTINUE";
  return h5Result(
    key,
    identity,
    identity.phase,
    "CANARY_ASSESSMENT",
    recommendation,
    baseline,
    candidate,
    comparison,
    evidenceReferences,
  );
}

function h5Result(
  evaluationKeyValue: string,
  identity: EvaluationIdentity,
  phase: "H5_CANARY" | "H5_POST_ROLLOUT",
  outcome: H5PostRolloutOutcome | "CANARY_ASSESSMENT",
  recommendation: H5Recommendation,
  baseline: HealthRunSnapshot,
  candidate: HealthRunSnapshot,
  comparison: H4Comparison | null = null,
  evidenceReferences: readonly z.infer<
    typeof SafeEvidenceReferenceSchema
  >[] = [],
): H5EvaluationResult {
  return H5EvaluationResultSchema.parse({
    evaluationKey: evaluationKeyValue,
    identity,
    phase,
    outcome,
    recommendation,
    h4Comparison: comparison,
    evidenceReferences,
    executionIds: [baseline.executionId, candidate.executionId],
    executionAuthority: false,
    evaluatedAt: candidate.evaluatedAt,
  });
}

export function createAvailabilityRestrictionSignal(input: {
  evaluation: H5EvaluationResult;
  incidentReference?: string | null;
  target: string;
  browserVersionRange: string;
}): AvailabilityRestrictionSignal | null {
  if (input.evaluation.recommendation !== "RESTRICT") return null;
  if (input.browserVersionRange !== input.evaluation.identity.browserVersion)
    throw new Error("HEALTH_SIGNAL_SCOPE_WIDENING");
  const comparison = input.evaluation.h4Comparison;
  const decisive = comparison?.contourRegressions[0];
  if (!decisive) return null;
  return AvailabilityRestrictionSignalSchema.parse({
    signalId: randomUUID(),
    provider: input.evaluation.identity.provider,
    surface: input.evaluation.identity.surface,
    profileRevisionId: input.evaluation.identity.candidateProfileRevisionId,
    browserFamily: input.evaluation.identity.browserFamily,
    browserVersionRange: input.browserVersionRange,
    browserVersionScope: input.browserVersionRange,
    target: input.target,
    monitoringLayer: input.evaluation.identity.monitoringLayer,
    reasonCode: decisive.contourKey,
    reason: decisive.reason,
    evaluationId: input.evaluation.evaluationKey,
    evaluationRevision: input.evaluation.identity.healthSuiteRevision,
    freshnessAuthority: `${input.evaluation.evaluationKey}:${input.evaluation.identity.healthSuiteRevision}`,
    evaluationKey: input.evaluation.evaluationKey,
    incidentReference: input.incidentReference ?? null,
    severity: decisive.severity,
    recommendation: "RESTRICT",
    evidenceReferences: input.evaluation.evidenceReferences.slice(0, 32),
    issuedAt: input.evaluation.evaluatedAt,
    executionAuthority: false,
  });
}

export function assertSignalAppliesTo(input: {
  signal: AvailabilityRestrictionSignal;
  provider: string;
  surface: string;
  profileRevisionId: string;
  browserFamily: import("@product/shared").BrowserFamily;
}): void {
  if (
    input.signal.provider !== input.provider ||
    input.signal.surface !== input.surface ||
    input.signal.profileRevisionId !== input.profileRevisionId ||
    input.signal.browserFamily !== input.browserFamily
  )
    throw new Error("STALE_OR_MISSCOPED_HEALTH_SIGNAL");
}
