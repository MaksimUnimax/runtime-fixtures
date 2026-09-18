import { randomUUID } from "node:crypto";
import {
  BASELINE_HEALTH_SUITE,
  HealthContourResultSchema,
  HealthSuiteDefinitionSchema,
  type HealthContourResult,
  type HealthSuiteDefinition,
} from "@product/health";
import { z } from "zod";
import {
  H3ExecutionResultSchema,
  type H3ExecutionResult,
} from "./h3-engine.js";
import {
  H3ContourObservationSchema,
  type H3ContourObservation,
} from "./h3-strategy.js";
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

function evidenceFor(
  contour: HealthSuiteDefinition["contours"][number],
  observation: H3ContourObservation,
) {
  const ruleId =
    observation.evidenceKind === "METADATA"
      ? "SAFE_ELEMENT_METADATA"
      : observation.evidenceKind === "STATE_TRANSITION_TRACE"
        ? "STATE_TRANSITION_TRACE"
        : null;
  if (!ruleId || !contour.safeEvidenceRuleIds.includes(ruleId)) return [];
  return [
    {
      evidenceId: randomUUID(),
      ruleId,
      classification: "METADATA",
      sha256: null,
      sizeBytes: null,
    } as const,
  ];
}

function observationForContour(
  execution: H3ExecutionResult,
  contourKey: HealthContourResult["contourKey"],
): H3ContourObservation | null {
  const observations = execution.events.flatMap((event) => event.observations);
  const matches = observations.filter(
    (observation) => observation.contourKey === contourKey,
  );
  if (matches.length > 1) throw new Error("DUPLICATE_H3_CONTOUR_OBSERVATION");
  return matches[0] ? H3ContourObservationSchema.parse(matches[0]) : null;
}

function contourResult(
  execution: H3ExecutionResult,
  contour: HealthSuiteDefinition["contours"][number],
): HealthContourResult {
  const observation = observationForContour(execution, contour.key);
  const environmentUncertainty = execution.environmentUncertainty;
  const fallbackObservation =
    contour.key === "C13_BLOCKING_STATE" && !observation
      ? H3ContourObservationSchema.parse({
          contourKey: contour.key,
          observationStatus: "PRESENT",
          primaryStrategyOutcome:
            environmentUncertainty === null ? "PASS" : "UNCERTAIN",
          fallbackStrategyOutcomes: [],
          selectedStrategyId:
            environmentUncertainty === null ? contour.primaryStrategyId : null,
          structuralOutcome:
            environmentUncertainty === null ? "PASS" : "UNCERTAIN",
          behavioralOutcome:
            environmentUncertainty === null ? "PASS" : "UNCERTAIN",
          fallbackQuality: "NOT_APPLICABLE",
          environmentStatus:
            environmentUncertainty === null ? "VALID" : "UNCERTAIN",
          uncertaintyReason: environmentUncertainty,
          evidenceKind: environmentUncertainty === null ? "METADATA" : "NONE",
        })
      : observation;
  const present = fallbackObservation?.observationStatus === "PRESENT";
  const parsed = HealthContourResultSchema.parse({
    contourKey: contour.key,
    required: contour.required,
    failureSeverity: contour.failureSeverity,
    observationStatus: present ? "PRESENT" : "NOT_OBSERVED",
    primaryStrategyId: contour.primaryStrategyId,
    primaryStrategyOutcome: present
      ? fallbackObservation.primaryStrategyOutcome
      : "NOT_ATTEMPTED",
    fallbackStrategyOutcomes: present
      ? fallbackObservation.fallbackStrategyOutcomes
      : [],
    selectedStrategyId: present ? fallbackObservation.selectedStrategyId : null,
    structuralOutcome: present
      ? fallbackObservation.structuralOutcome
      : "NOT_RUN",
    behavioralOutcome: present
      ? fallbackObservation.behavioralOutcome
      : "NOT_RUN",
    fallbackQuality: present
      ? fallbackObservation.fallbackQuality
      : "NOT_APPLICABLE",
    environmentStatus: present
      ? fallbackObservation.environmentStatus
      : "VALID",
    uncertaintyReason: present ? fallbackObservation.uncertaintyReason : null,
    evidence: present ? evidenceFor(contour, fallbackObservation) : [],
  });
  return parsed;
}

/**
 * Capture-boundary sanitizer and Health mapper for B5. The source is parsed
 * strictly before any field is selected. No prompt, response, DOM, route,
 * project, conversation, storage, token, or arbitrary error field is read.
 */
export function createH3HealthPersistenceCommand(
  rawExecution: unknown,
  rawContext: H3HealthPersistenceContext,
): H3HealthPersistenceCommand {
  const execution = H3ExecutionResultSchema.parse(rawExecution);
  const context = H3HealthPersistenceContextSchema.parse(rawContext);
  if (
    execution.surfaceProfile.surface === "CHATGPT_STANDARD" &&
    context.suite.scope.surfaceKey !== "standard"
  ) {
    throw new Error("H3_STANDARD_HEALTH_SCOPE_MISMATCH");
  }
  if (
    execution.surfaceProfile.surface === "CHATGPT_WORK" &&
    context.suite.scope.surfaceKey !== "work"
  ) {
    throw new Error("H3_WORK_HEALTH_SCOPE_MISMATCH");
  }
  if (
    execution.surfaceProfile.profileRevision !==
    context.suite.scope.profile.revision
  ) {
    throw new Error("H3_PROFILE_REVISION_SCOPE_MISMATCH");
  }
  const results = context.suite.contours.map((contour) =>
    contourResult(execution, contour),
  );
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

export type { H3ExecutionResult };
