import {
  EnvironmentUncertaintyReasonSchema,
  type EnvironmentUncertaintyReason,
  HealthAssertionOutcomeSchema,
  HealthObservationOutcomeSchema,
  HealthObservationStatusSchema,
  BaselineContourKeySchema,
  FallbackQualitySchema,
  PackagedStrategyIdSchema,
} from "@product/health";
import {
  H3SurfaceProfileSchema,
  type H3BridgeSurfaceCheck,
  type H3SurfaceProfile,
} from "./h3-actions.js";
import type { H3PromptId } from "./h3-contracts.js";
import {
  ControlledTargetKeySchema,
  type ControlledTargetKey,
} from "./target-registry.js";
import { z } from "zod";

export const H3StrategyStepOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "UNCERTAIN",
]);
export type H3StrategyStepOutcome = z.infer<typeof H3StrategyStepOutcomeSchema>;

/**
 * Safe, bounded strategy provenance. This is deliberately smaller than a
 * browser observation: it contains only Health-owned vocabulary and no page
 * values, selectors, identifiers, or executable data.
 */
export const H3ContourObservationSchema = z
  .object({
    contourKey: BaselineContourKeySchema,
    observationStatus: HealthObservationStatusSchema,
    primaryStrategyOutcome: HealthObservationOutcomeSchema,
    fallbackStrategyOutcomes: z
      .array(
        z
          .object({
            strategyId: PackagedStrategyIdSchema,
            outcome: HealthObservationOutcomeSchema,
          })
          .strict(),
      )
      .max(8),
    selectedStrategyId: PackagedStrategyIdSchema.nullable(),
    structuralOutcome: HealthAssertionOutcomeSchema,
    behavioralOutcome: HealthAssertionOutcomeSchema,
    fallbackQuality: FallbackQualitySchema,
    environmentStatus: z.enum(["VALID", "UNCERTAIN"]),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
    evidenceKind: z.enum(["NONE", "METADATA", "STATE_TRANSITION_TRACE"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.environmentStatus === "VALID" &&
      value.uncertaintyReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyReason"],
        message: "valid observation cannot have an uncertainty reason",
      });
    }
    if (
      value.environmentStatus === "UNCERTAIN" &&
      value.uncertaintyReason === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyReason"],
        message: "uncertain observation requires a reason",
      });
    }
    if (value.observationStatus !== "PRESENT") {
      if (
        value.primaryStrategyOutcome !== "NOT_ATTEMPTED" ||
        value.fallbackStrategyOutcomes.length > 0 ||
        value.selectedStrategyId !== null ||
        value.structuralOutcome !== "NOT_RUN" ||
        value.behavioralOutcome !== "NOT_RUN" ||
        value.fallbackQuality !== "NOT_APPLICABLE" ||
        value.evidenceKind !== "NONE"
      ) {
        context.addIssue({
          code: "custom",
          path: ["observationStatus"],
          message: "non-present observation cannot contain execution results",
        });
      }
    }
    if (value.fallbackQuality !== "NOT_APPLICABLE") {
      if (
        value.selectedStrategyId === null ||
        !value.fallbackStrategyOutcomes.some(
          (attempt) => attempt.strategyId === value.selectedStrategyId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["fallbackQuality"],
          message: "fallback quality requires a selected fallback result",
        });
      }
    }
  });
export type H3ContourObservation = Readonly<
  z.infer<typeof H3ContourObservationSchema>
>;

export function createH3ContourObservation(
  input: unknown,
): H3ContourObservation {
  return Object.freeze(H3ContourObservationSchema.parse(input));
}

export const H3StrategyStepResultSchema = z
  .object({
    outcome: H3StrategyStepOutcomeSchema,
    markerCount: z.number().int().min(0).max(64).nullable(),
    transitionObserved: z.boolean().nullable(),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
    observations: z.array(H3ContourObservationSchema).max(13).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome !== "UNCERTAIN" && value.uncertaintyReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["uncertaintyReason"],
        message: "only uncertain strategy results may have a reason",
      });
    }
  });
export type H3StrategyStepResult = Readonly<
  z.infer<typeof H3StrategyStepResultSchema>
>;

export const H3StrategyErrorCodeSchema = z.enum([
  "STRATEGY_FAILED",
  "ENVIRONMENT_UNCERTAIN",
]);
export type H3StrategyErrorCode = z.infer<typeof H3StrategyErrorCodeSchema>;

export class H3StrategyError extends Error {
  public readonly code: H3StrategyErrorCode;
  public readonly uncertaintyReason: EnvironmentUncertaintyReason | null;

  public constructor(
    code: H3StrategyErrorCode,
    uncertaintyReason: EnvironmentUncertaintyReason | null = null,
  ) {
    super(code);
    this.name = "H3StrategyError";
    this.code = code;
    this.uncertaintyReason = uncertaintyReason;
  }
}

/**
 * Trusted, locally packaged semantic behavior. It deliberately has no
 * browser primitive, locator, URL, script, or caller-provided text method.
 */
export interface H3SurfaceStrategy {
  readonly surfaceProfile: H3SurfaceProfile;
  readonly targetKey: ControlledTargetKey;
  identifyApprovedSurface(): Promise<H3StrategyStepResult>;
  identifyApprovedComposer(): Promise<H3StrategyStepResult>;
  insertPackagedPrompt(promptId: H3PromptId): Promise<H3StrategyStepResult>;
  sendOnce(): Promise<H3StrategyStepResult>;
  observeBusy(): Promise<H3StrategyStepResult>;
  observeResponse(): Promise<H3StrategyStepResult>;
  observeCompletion(): Promise<H3StrategyStepResult>;
  validateBridgeSurfaces(
    checks: readonly H3BridgeSurfaceCheck[],
  ): Promise<H3StrategyStepResult>;
  cleanup(): Promise<void>;
}

export function validateH3SurfaceStrategy(
  strategy: H3SurfaceStrategy,
): H3SurfaceStrategy {
  H3SurfaceProfileSchema.parse(strategy.surfaceProfile);
  ControlledTargetKeySchema.parse(strategy.targetKey);
  return strategy;
}

export function parseH3StrategyStepResult(
  input: unknown,
): H3StrategyStepResult {
  return Object.freeze(H3StrategyStepResultSchema.parse(input));
}
