import { createHash, randomUUID } from "node:crypto";
import {
  BASELINE_HEALTH_SUITE,
  BaselineContourKeySchema,
  ExpectedTransitionIdSchema,
  FallbackQualitySchema,
  HealthAssertionOutcomeSchema,
  HealthContourResultSchema,
  HealthObservationOutcomeSchema,
  HealthObservationStatusSchema,
  HealthBrowserFamilySchema,
  HealthClassificationResultSchema,
  HealthSuiteDefinitionSchema,
  PackagedStrategyIdSchema,
  EnvironmentUncertaintyReasonSchema,
  classifyHealthDetailed,
  type HealthContourResult,
  type HealthSuiteDefinition,
} from "@product/health";
import { canonicalizeJson } from "@product/remote-config";
import { z } from "zod";
import {
  H3ExecutionResultSchema,
  H3_PACKAGED_TARGET_BY_SURFACE,
  type H3ExecutionResult,
} from "./h3-engine.js";
import {
  H3ContourObservationSchema,
  type H3ContourObservation,
} from "./h3-strategy.js";
import { H3BehaviorStepSchema, H3SurfaceSchema } from "./h3-contracts.js";
import { ControlledTargetKeySchema } from "./target-registry.js";
import type { H3SafeEvidenceEvent } from "./evidence-sanitizer.js";
import { BrowserRuntimeMetadataSchema as RunnerBrowserRuntimeMetadataSchema } from "./h2.js";
const IsoTimestampSchema = z.string().datetime({ offset: true });

/**
 * This is the only B5 input that may cross from the H3 runner into Health
 * persistence. It is intentionally separate from the browser observation
 * object: only the already-validated H3 result and approved runtime metadata
 * are accepted, and the returned command contains only Health-owned fields.
 */
export const H3HealthPersistenceContextSchema = z
  .object({
    suite: HealthSuiteDefinitionSchema,
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    browserRuntime: RunnerBrowserRuntimeMetadataSchema,
    operatorMaintenance: z.boolean().default(false),
    operatorMaintenanceAuthority: z.string().min(1).max(128).nullable(),
    classifierVersion: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt",
      });
    }
    if (
      value.browserRuntime.family !== value.suite.scope.browserFamily ||
      value.browserRuntime.browserVersion !== value.suite.scope.browserVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["browserRuntime"],
        message: "runtime metadata does not match Health scope",
      });
    }
  });
export type H3HealthPersistenceContext = z.input<
  typeof H3HealthPersistenceContextSchema
>;

export const H3HealthPersistenceCommandSchema = z
  .object({
    suite: HealthSuiteDefinitionSchema,
    results: z
      .array(HealthContourResultSchema)
      .length(BASELINE_HEALTH_SUITE.contours.length),
    operatorMaintenance: z.boolean(),
    operatorMaintenanceAuthority: z.string().min(1).max(128).nullable(),
    healthLevel: z.literal("H3"),
    classifierVersion: z.string().min(1).max(64),
    startedAt: z.date(),
    completedAt: z.date(),
  })
  .strict();
export type H3HealthPersistenceCommand = z.infer<
  typeof H3HealthPersistenceCommandSchema
>;

const R1_MAX_ARTIFACT_BYTES = 4_096;
const R1_MAX_ARTIFACTS = 13;
const R1EvidenceRuleSchema = z.enum([
  "SAFE_ELEMENT_METADATA",
  "STATE_TRANSITION_TRACE",
]);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const FallbackStrategyOutcomeSchema = z
  .object({
    strategyId: PackagedStrategyIdSchema,
    outcome: HealthObservationOutcomeSchema,
  })
  .strict();

const SafeArtifactCommonSchema = z.object({
  schemaVersion: z.literal(1),
  targetKey: ControlledTargetKeySchema,
  surface: H3SurfaceSchema,
  contourKey: BaselineContourKeySchema,
});

export const H3SafeMetadataArtifactPayloadSchema =
  SafeArtifactCommonSchema.extend({
    kind: z.literal("SAFE_ELEMENT_METADATA"),
    healthStep: H3BehaviorStepSchema.nullable(),
    observationStatus: HealthObservationStatusSchema,
    primaryStrategyId: PackagedStrategyIdSchema,
    primaryStrategyOutcome: HealthObservationOutcomeSchema,
    selectedStrategyId: PackagedStrategyIdSchema.nullable(),
    fallbackStrategyOutcomes: z.array(FallbackStrategyOutcomeSchema).max(8),
    fallbackQuality: FallbackQualitySchema,
    structuralOutcome: HealthAssertionOutcomeSchema,
    behavioralOutcome: HealthAssertionOutcomeSchema,
    environmentStatus: z.enum(["VALID", "UNCERTAIN"]),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
    markerCount: z.number().int().min(0).max(64).nullable(),
  }).strict();
export type H3SafeMetadataArtifactPayload = z.infer<
  typeof H3SafeMetadataArtifactPayloadSchema
>;

export const H3StateTransitionArtifactPayloadSchema =
  SafeArtifactCommonSchema.extend({
    kind: z.literal("STATE_TRANSITION_TRACE"),
    healthStep: H3BehaviorStepSchema,
    eventOutcome: z.enum(["PASS", "FAIL", "UNCERTAIN", "NOT_RUN"]),
    durationMs: z.number().int().min(0).max(120_000),
    transitionObserved: z.boolean().nullable(),
    expectedTransitionIds: z.array(ExpectedTransitionIdSchema).max(6),
    strategyId: PackagedStrategyIdSchema,
    strategyOutcome: HealthObservationOutcomeSchema,
    environmentStatus: z.enum(["VALID", "UNCERTAIN"]),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
  }).strict();
export type H3StateTransitionArtifactPayload = z.infer<
  typeof H3StateTransitionArtifactPayloadSchema
>;

export const H3SafeEvidenceArtifactPayloadSchema = z.discriminatedUnion(
  "kind",
  [H3SafeMetadataArtifactPayloadSchema, H3StateTransitionArtifactPayloadSchema],
);
export type H3SafeEvidenceArtifactPayload = z.infer<
  typeof H3SafeEvidenceArtifactPayloadSchema
>;

export const H3SafeEvidenceArtifactSchema = z
  .object({
    evidenceId: z.uuid(),
    contourKey: BaselineContourKeySchema,
    ruleId: R1EvidenceRuleSchema,
    classification: z.literal("METADATA"),
    sha256: Sha256Schema,
    sizeBytes: z.number().int().min(0).max(R1_MAX_ARTIFACT_BYTES),
    payload: H3SafeEvidenceArtifactPayloadSchema,
  })
  .strict();
export type H3SafeEvidenceArtifact = Readonly<
  z.infer<typeof H3SafeEvidenceArtifactSchema>
>;

export const H3HealthEvidenceSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    targetKey: ControlledTargetKeySchema,
    surface: H3SurfaceSchema,
    surfaceKey: z.string().min(1).max(64),
    browserFamily: HealthBrowserFamilySchema,
    browserVersion: z.string().min(1).max(64),
    sessionKind: z.literal("EPHEMERAL_CONTROLLED"),
    profileRevision: z.number().int().positive(),
    healthSuiteMachineKey: z.string().min(1).max(128),
    healthSuiteRevision: z.number().int().positive(),
    classifierVersion: z.string().min(1).max(64),
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
  })
  .strict();
export type H3HealthEvidenceSummary = Readonly<
  z.infer<typeof H3HealthEvidenceSummarySchema>
>;

export const H3HealthEvidencePackageSchema = z
  .object({
    persistenceCommand: H3HealthPersistenceCommandSchema,
    classification: HealthClassificationResultSchema,
    summary: H3HealthEvidenceSummarySchema,
    artifacts: z.array(H3SafeEvidenceArtifactSchema).max(R1_MAX_ARTIFACTS),
  })
  .strict();
export type H3HealthEvidencePackage = Readonly<
  Omit<z.infer<typeof H3HealthEvidencePackageSchema>, "artifacts">
> & { readonly artifacts: readonly H3SafeEvidenceArtifact[] };

type ObservationSource = Readonly<{
  observation: H3ContourObservation;
  event: H3SafeEvidenceEvent | null;
}>;

function observationForContour(
  execution: H3ExecutionResult,
  contourKey: HealthContourResult["contourKey"],
): ObservationSource | null {
  const matches = execution.events.flatMap((event) =>
    event.observations
      .filter((observation) => observation.contourKey === contourKey)
      .map((observation) => ({
        observation: H3ContourObservationSchema.parse(observation),
        event,
      })),
  );
  if (matches.length > 1) throw new Error("DUPLICATE_H3_CONTOUR_OBSERVATION");
  return matches[0] ?? null;
}

function contourObservation(
  execution: H3ExecutionResult,
  contour: HealthSuiteDefinition["contours"][number],
): ObservationSource | null {
  const source = observationForContour(execution, contour.key);
  const environmentUncertainty = execution.environmentUncertainty;
  if (source) return source;
  if (contour.key !== "C13_BLOCKING_STATE") return null;
  const fallbackObservation =
    environmentUncertainty === null
      ? H3ContourObservationSchema.parse({
          contourKey: contour.key,
          observationStatus: "PRESENT",
          primaryStrategyOutcome: "PASS",
          fallbackStrategyOutcomes: [],
          selectedStrategyId: contour.primaryStrategyId,
          structuralOutcome: "PASS",
          behavioralOutcome: "PASS",
          fallbackQuality: "NOT_APPLICABLE",
          environmentStatus: "VALID",
          uncertaintyReason: null,
          evidenceKind: "METADATA",
        })
      : H3ContourObservationSchema.parse({
          contourKey: contour.key,
          observationStatus: "PRESENT",
          primaryStrategyOutcome: "UNCERTAIN",
          fallbackStrategyOutcomes: [],
          selectedStrategyId: null,
          structuralOutcome: "UNCERTAIN",
          behavioralOutcome: "UNCERTAIN",
          fallbackQuality: "NOT_APPLICABLE",
          environmentStatus: "UNCERTAIN",
          uncertaintyReason: environmentUncertainty,
          evidenceKind: "NONE",
        });
  return { observation: fallbackObservation, event: null };
}

function contourResult(
  execution: H3ExecutionResult,
  contour: HealthSuiteDefinition["contours"][number],
): HealthContourResult {
  const source = contourObservation(execution, contour);
  const observation = source?.observation ?? null;
  const present = observation?.observationStatus === "PRESENT";
  return HealthContourResultSchema.parse({
    contourKey: contour.key,
    required: contour.required,
    failureSeverity: contour.failureSeverity,
    observationStatus: present ? "PRESENT" : "NOT_OBSERVED",
    primaryStrategyId: contour.primaryStrategyId,
    primaryStrategyOutcome: present
      ? observation.primaryStrategyOutcome
      : "NOT_ATTEMPTED",
    fallbackStrategyOutcomes: present
      ? observation.fallbackStrategyOutcomes
      : [],
    selectedStrategyId: present ? observation.selectedStrategyId : null,
    structuralOutcome: present ? observation.structuralOutcome : "NOT_RUN",
    behavioralOutcome: present ? observation.behavioralOutcome : "NOT_RUN",
    fallbackQuality: present ? observation.fallbackQuality : "NOT_APPLICABLE",
    environmentStatus: present ? observation.environmentStatus : "VALID",
    uncertaintyReason: present ? observation.uncertaintyReason : null,
    evidence: [],
  });
}

function selectedStrategyOutcome(
  result: HealthContourResult,
): HealthContourResult["primaryStrategyOutcome"] {
  if (
    result.selectedStrategyId !== null &&
    result.selectedStrategyId !== result.primaryStrategyId
  ) {
    return (
      result.fallbackStrategyOutcomes.find(
        (attempt) => attempt.strategyId === result.selectedStrategyId,
      )?.outcome ?? result.primaryStrategyOutcome
    );
  }
  return result.primaryStrategyOutcome;
}

function artifactFor(
  execution: H3ExecutionResult,
  contour: HealthSuiteDefinition["contours"][number],
  result: HealthContourResult,
  source: ObservationSource,
): H3SafeEvidenceArtifact | null {
  const observation = source.observation;
  const ruleId =
    observation.evidenceKind === "METADATA"
      ? "SAFE_ELEMENT_METADATA"
      : observation.evidenceKind === "STATE_TRANSITION_TRACE"
        ? "STATE_TRANSITION_TRACE"
        : null;
  if (!ruleId || !contour.safeEvidenceRuleIds.includes(ruleId)) return null;
  const common = {
    schemaVersion: 1 as const,
    targetKey: execution.targetKey,
    surface: execution.surfaceProfile.surface,
    contourKey: contour.key,
  };
  const payload =
    ruleId === "SAFE_ELEMENT_METADATA"
      ? H3SafeMetadataArtifactPayloadSchema.parse({
          ...common,
          kind: "SAFE_ELEMENT_METADATA",
          healthStep: source.event?.step ?? null,
          observationStatus: result.observationStatus,
          primaryStrategyId: result.primaryStrategyId,
          primaryStrategyOutcome: result.primaryStrategyOutcome,
          selectedStrategyId: result.selectedStrategyId,
          fallbackStrategyOutcomes: result.fallbackStrategyOutcomes,
          fallbackQuality: result.fallbackQuality,
          structuralOutcome: result.structuralOutcome,
          behavioralOutcome: result.behavioralOutcome,
          environmentStatus: result.environmentStatus,
          uncertaintyReason: result.uncertaintyReason,
          markerCount: source.event?.markerCount ?? null,
        })
      : source.event === null
        ? boundedPackageError("H3_TRANSITION_ARTIFACT_EVENT_MISSING")
        : H3StateTransitionArtifactPayloadSchema.parse({
            ...common,
            kind: "STATE_TRANSITION_TRACE",
            healthStep: source.event.step,
            eventOutcome: source.event.outcome,
            durationMs: source.event.durationMs,
            transitionObserved: source.event.transitionObserved,
            expectedTransitionIds: contour.expectedTransitionIds,
            strategyId: result.selectedStrategyId ?? result.primaryStrategyId,
            strategyOutcome: selectedStrategyOutcome(result),
            environmentStatus: result.environmentStatus,
            uncertaintyReason: result.uncertaintyReason,
          });
  const bytes = canonicalizeJson(payload);
  if (bytes.byteLength > R1_MAX_ARTIFACT_BYTES) {
    throw new Error("H3_SAFE_ARTIFACT_SIZE_LIMIT");
  }
  return H3SafeEvidenceArtifactSchema.parse({
    evidenceId: randomUUID(),
    contourKey: contour.key,
    ruleId,
    classification: "METADATA",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    payload,
  });
}

function persistenceCommandFor(
  context: z.infer<typeof H3HealthPersistenceContextSchema>,
  results: readonly HealthContourResult[],
): H3HealthPersistenceCommand {
  return H3HealthPersistenceCommandSchema.parse({
    suite: context.suite,
    results,
    operatorMaintenance: context.operatorMaintenance,
    operatorMaintenanceAuthority: context.operatorMaintenanceAuthority,
    healthLevel: "H3",
    classifierVersion: context.classifierVersion,
    startedAt: new Date(context.startedAt),
    completedAt: new Date(context.completedAt),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function boundedPackageError(code: string): never {
  throw new Error(code);
}

function assertPackageIntegrity(
  pkg: z.infer<typeof H3HealthEvidencePackageSchema>,
): void {
  const expectedClassification = classifyHealthDetailed({
    suite: pkg.persistenceCommand.suite,
    results: pkg.persistenceCommand.results,
    operatorMaintenance: pkg.persistenceCommand.operatorMaintenance,
  });
  if (
    canonicalizeJson(expectedClassification).compare(
      canonicalizeJson(pkg.classification),
    ) !== 0
  ) {
    boundedPackageError("H3_EVIDENCE_CLASSIFICATION_MISMATCH");
  }
  const contourDefinitions = new Map(
    pkg.persistenceCommand.suite.contours.map((contour) => [
      contour.key,
      contour,
    ]),
  );
  const artifactsById = new Map<string, H3SafeEvidenceArtifact>();
  for (const artifact of pkg.artifacts) {
    if (artifactsById.has(artifact.evidenceId)) {
      boundedPackageError("H3_EVIDENCE_DUPLICATE_ARTIFACT_ID");
    }
    artifactsById.set(artifact.evidenceId, artifact);
    const contour = contourDefinitions.get(artifact.contourKey);
    if (!contour || !contour.safeEvidenceRuleIds.includes(artifact.ruleId)) {
      boundedPackageError("H3_EVIDENCE_RULE_CONTOUR_MISMATCH");
    }
    if (artifact.payload.contourKey !== artifact.contourKey) {
      boundedPackageError("H3_EVIDENCE_PAYLOAD_CONTOUR_MISMATCH");
    }
    if (
      artifact.payload.targetKey !== pkg.summary.targetKey ||
      artifact.payload.surface !== pkg.summary.surface
    ) {
      boundedPackageError("H3_EVIDENCE_PAYLOAD_SCOPE_MISMATCH");
    }
    if (
      (artifact.ruleId === "SAFE_ELEMENT_METADATA" &&
        artifact.payload.kind !== "SAFE_ELEMENT_METADATA") ||
      (artifact.ruleId === "STATE_TRANSITION_TRACE" &&
        artifact.payload.kind !== "STATE_TRANSITION_TRACE")
    ) {
      boundedPackageError("H3_EVIDENCE_ARTIFACT_TYPE_MISMATCH");
    }
    const bytes = canonicalizeJson(artifact.payload);
    if (
      artifact.sha256 !== createHash("sha256").update(bytes).digest("hex") ||
      artifact.sizeBytes !== bytes.byteLength
    ) {
      boundedPackageError("H3_EVIDENCE_HASH_SIZE_MISMATCH");
    }
  }
  const referencedIds = new Set<string>();
  for (const result of pkg.persistenceCommand.results) {
    for (const reference of result.evidence) {
      if (referencedIds.has(reference.evidenceId)) {
        boundedPackageError("H3_EVIDENCE_DUPLICATE_REFERENCE_ID");
      }
      referencedIds.add(reference.evidenceId);
      const artifact = artifactsById.get(reference.evidenceId);
      if (!artifact) boundedPackageError("H3_EVIDENCE_ORPHAN_REFERENCE");
      if (
        reference.ruleId !== artifact.ruleId ||
        reference.classification !== artifact.classification ||
        reference.sha256 !== artifact.sha256 ||
        reference.sizeBytes !== artifact.sizeBytes ||
        result.contourKey !== artifact.contourKey
      ) {
        boundedPackageError("H3_EVIDENCE_REFERENCE_ARTIFACT_MISMATCH");
      }
    }
  }
  if (referencedIds.size !== artifactsById.size) {
    boundedPackageError("H3_EVIDENCE_ORPHAN_ARTIFACT");
  }
}

export function validateH3HealthEvidencePackage(
  input: unknown,
): H3HealthEvidencePackage {
  const parsed = H3HealthEvidencePackageSchema.parse(input);
  assertPackageIntegrity(parsed);
  return deepFreeze(parsed) as H3HealthEvidencePackage;
}

function executionScopeMismatch(execution: H3ExecutionResult): string {
  switch (execution.surfaceProfile.surface) {
    case "CHATGPT_STANDARD":
      return "H3_STANDARD_HEALTH_SCOPE_MISMATCH";
    case "CHATGPT_WORK":
      return "H3_WORK_HEALTH_SCOPE_MISMATCH";
    case "ALICE":
      return "H3_ALICE_HEALTH_SCOPE_MISMATCH";
  }
}

function assertExecutionContextScope(
  execution: H3ExecutionResult,
  context: z.infer<typeof H3HealthPersistenceContextSchema>,
): void {
  const expectedSurfaceKey =
    execution.surfaceProfile.surface === "CHATGPT_STANDARD"
      ? "standard"
      : execution.surfaceProfile.surface === "CHATGPT_WORK"
        ? "work"
        : "alice";
  if (context.suite.scope.surfaceKey !== expectedSurfaceKey) {
    throw new Error(executionScopeMismatch(execution));
  }
  if (
    execution.targetKey !==
    H3_PACKAGED_TARGET_BY_SURFACE[execution.surfaceProfile.surface]
  ) {
    throw new Error("H3_TARGET_SCOPE_MISMATCH");
  }
  if (
    execution.surfaceProfile.profileRevision !==
    context.suite.scope.profile.revision
  ) {
    throw new Error("H3_PROFILE_REVISION_SCOPE_MISMATCH");
  }
}

/**
 * Canonical H3 capture boundary. It returns Health persistence plus bounded,
 * in-process safe artifacts. No artifact bytes are written to the database,
 * filesystem, logs, or an external store by this API.
 */
export function createH3HealthEvidencePackage(
  rawExecution: unknown,
  rawContext: H3HealthPersistenceContext,
): H3HealthEvidencePackage {
  const execution = H3ExecutionResultSchema.parse(rawExecution);
  const context = H3HealthPersistenceContextSchema.parse(rawContext);
  assertExecutionContextScope(execution, context);

  const sources = new Map(
    context.suite.contours.map((contour) => [
      contour.key,
      contourObservation(execution, contour),
    ]),
  );
  const withoutEvidence = context.suite.contours.map((contour) =>
    contourResult(execution, contour),
  );
  const artifacts: H3SafeEvidenceArtifact[] = [];
  const results = withoutEvidence.map((result) => {
    const contour = context.suite.contours.find(
      (definition) => definition.key === result.contourKey,
    );
    const source = sources.get(result.contourKey);
    if (!contour || !source || result.observationStatus !== "PRESENT") {
      return result;
    }
    const artifact = artifactFor(execution, contour, result, source);
    if (!artifact) return result;
    artifacts.push(artifact);
    return HealthContourResultSchema.parse({
      ...result,
      evidence: [
        {
          evidenceId: artifact.evidenceId,
          ruleId: artifact.ruleId,
          classification: artifact.classification,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        },
      ],
    });
  });
  if (artifacts.length > R1_MAX_ARTIFACTS) {
    boundedPackageError("H3_SAFE_ARTIFACT_COUNT_LIMIT");
  }
  const persistenceCommand = persistenceCommandFor(context, results);
  const classification = classifyHealthDetailed({
    suite: persistenceCommand.suite,
    results: persistenceCommand.results,
    operatorMaintenance: persistenceCommand.operatorMaintenance,
  });
  return validateH3HealthEvidencePackage({
    persistenceCommand,
    classification,
    summary: {
      schemaVersion: 1,
      runId: randomUUID(),
      targetKey: execution.targetKey,
      surface: execution.surfaceProfile.surface,
      surfaceKey: context.suite.scope.surfaceKey,
      browserFamily: context.suite.scope.browserFamily,
      browserVersion: context.suite.scope.browserVersion,
      sessionKind: context.browserRuntime.sessionKind,
      profileRevision: context.suite.scope.profile.revision,
      healthSuiteMachineKey: context.suite.machineKey,
      healthSuiteRevision: context.suite.revision,
      classifierVersion: context.classifierVersion,
      startedAt: context.startedAt,
      completedAt: context.completedAt,
    },
    artifacts,
  });
}

export function createH3HealthPersistenceCommand(
  rawExecution: unknown,
  rawContext: H3HealthPersistenceContext,
): H3HealthPersistenceCommand {
  return createH3HealthEvidencePackage(rawExecution, rawContext)
    .persistenceCommand;
}

export type { H3ExecutionResult };
