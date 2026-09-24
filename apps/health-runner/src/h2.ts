import {
  BASELINE_HEALTH_SUITE,
  BaselineContourKeySchema,
  EnvironmentUncertaintyReasonSchema,
  PackagedStrategyIdSchema,
  StructuralAssertionIdSchema,
  BrowserRuntimeMetadataSchema,
  type BaselineContourKey,
  type EnvironmentUncertaintyReason,
  type PackagedStrategyId,
  type StructuralAssertionId,
} from "@product/health";
import { z } from "zod";
import { BrowserDriverError, type BrowserDriver } from "./browser-driver.js";
import type { SafeStructuralObservation } from "./strategies.js";
import { ControlledTargetKeySchema } from "./target-registry.js";

export { BrowserRuntimeMetadataSchema } from "@product/health";
export type { BrowserRuntimeMetadata } from "@product/health";

const IsoTimestampSchema = z.string().datetime({ offset: true });

const H2ProbeContourSchema = z
  .object({
    contourKey: BaselineContourKeySchema,
    primaryStrategyId: PackagedStrategyIdSchema,
    fallbackStrategyIds: z
      .array(PackagedStrategyIdSchema)
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate H2 fallback strategy",
      }),
    structuralAssertionIds: z
      .array(StructuralAssertionIdSchema)
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate H2 structural assertion",
      }),
    timeoutMs: z.number().int().min(250).max(30_000),
  })
  .strict();
export type H2ProbeContour = z.infer<typeof H2ProbeContourSchema>;

export const H2StructuralProbePlanSchema = z
  .object({
    level: z.literal("H2"),
    targetKey: ControlledTargetKeySchema,
    contours: z.array(H2ProbeContourSchema).min(1).max(13),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    const definitions = new Map(
      BASELINE_HEALTH_SUITE.contours.map((contour) => [contour.key, contour]),
    );
    for (const [index, contour] of value.contours.entries()) {
      if (seen.has(contour.contourKey)) {
        context.addIssue({
          code: "custom",
          path: ["contours", index, "contourKey"],
          message: "duplicate H2 contour",
        });
      }
      seen.add(contour.contourKey);
      const definition = definitions.get(contour.contourKey);
      if (!definition) continue;
      if (
        definition.primaryStrategyId !== contour.primaryStrategyId ||
        definition.fallbackStrategyIds.length !==
          contour.fallbackStrategyIds.length ||
        definition.fallbackStrategyIds.some(
          (strategyId, strategyIndex) =>
            strategyId !== contour.fallbackStrategyIds[strategyIndex],
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["contours", index],
          message: "H2 strategy order does not match packaged contour",
        });
      }
      if (contour.fallbackStrategyIds.includes(contour.primaryStrategyId)) {
        context.addIssue({
          code: "custom",
          path: ["contours", index, "fallbackStrategyIds"],
          message: "H2 primary strategy cannot be a fallback",
        });
      }
      for (const assertionId of contour.structuralAssertionIds) {
        if (!definition.structuralAssertionIds.includes(assertionId)) {
          context.addIssue({
            code: "custom",
            path: ["contours", index, "structuralAssertionIds"],
            message: "H2 assertion is not packaged for the contour",
          });
        }
      }
    }
  });
export type H2StructuralProbePlan = z.infer<typeof H2StructuralProbePlanSchema>;

export const H2AttemptSchema = z
  .object({
    strategyId: PackagedStrategyIdSchema,
    outcome: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
    durationMs: z.number().int().min(0).max(30_000),
    metadata: z
      .object({
        elementCount: z.number().int().min(0).max(64),
        tag: z.string().max(64).nullable(),
        role: z.string().max(64).nullable(),
        type: z.string().max(64).nullable(),
        ariaLabelPresent: z.boolean(),
        stableDataKind: z.string().max(64).nullable(),
        visible: z.boolean(),
        editable: z.boolean(),
        actionable: z.boolean(),
        relationship: z.literal("BOUNDED_PACKAGED_TARGET"),
        blockingState: EnvironmentUncertaintyReasonSchema.nullable(),
      })
      .strict(),
    uncertaintyReason: EnvironmentUncertaintyReasonSchema.nullable(),
  })
  .strict();
export type H2Attempt = z.infer<typeof H2AttemptSchema>;

export const H2StructuralObservationSchema = z
  .object({
    contourKey: BaselineContourKeySchema,
    primaryAttempt: H2AttemptSchema,
    fallbackAttempts: z.array(H2AttemptSchema).max(8),
    selectedStrategyId: PackagedStrategyIdSchema.nullable(),
    structuralAssertions: z
      .array(
        z
          .object({
            assertionId: StructuralAssertionIdSchema,
            outcome: z.enum(["PASS", "FAIL", "UNCERTAIN", "NOT_RUN"]),
          })
          .strict(),
      )
      .max(8),
    durationMs: z.number().int().min(0).max(30_000),
    environmentUncertainty: EnvironmentUncertaintyReasonSchema.nullable(),
  })
  .strict();
export type H2StructuralObservation = z.infer<
  typeof H2StructuralObservationSchema
>;

export const H2ExecutionErrorSchema = z.enum([
  "CONTROLLED_TARGET_NOT_REGISTERED",
  "UNSAFE_TOP_LEVEL_REDIRECT",
  "NAVIGATION_FAILED",
  "OBSERVATION_TIMEOUT",
  "OBSERVATION_FAILED",
]);
export type H2ExecutionError = z.infer<typeof H2ExecutionErrorSchema>;

export const H2StructuralSmokeReportSchema = z
  .object({
    level: z.literal("H2"),
    targetKey: ControlledTargetKeySchema,
    browserRuntime: BrowserRuntimeMetadataSchema,
    startedAt: IsoTimestampSchema,
    completedAt: IsoTimestampSchema,
    observations: z.array(H2StructuralObservationSchema).max(13),
    environmentUncertainty: EnvironmentUncertaintyReasonSchema.nullable(),
    executionError: H2ExecutionErrorSchema.nullable(),
  })
  .strict();
export type H2StructuralSmokeReport = z.infer<
  typeof H2StructuralSmokeReportSchema
>;

const DEFAULT_CONTOURS = BASELINE_HEALTH_SUITE.contours.map(
  (contour) => contour.key,
);

export function createH2ProbePlan(
  targetKey: string,
  contourKeys: readonly BaselineContourKey[] = DEFAULT_CONTOURS,
): H2StructuralProbePlan {
  const selected = new Set(contourKeys);
  const contours = BASELINE_HEALTH_SUITE.contours
    .filter((contour) => selected.has(contour.key))
    .map((contour) => ({
      contourKey: contour.key,
      primaryStrategyId: contour.primaryStrategyId,
      fallbackStrategyIds: [...contour.fallbackStrategyIds],
      structuralAssertionIds: [...contour.structuralAssertionIds],
      timeoutMs: Math.min(5_000, contour.timeoutMs),
    }));
  return parseH2ProbePlan({ level: "H2", targetKey, contours });
}

export function parseH2ProbePlan(input: unknown): H2StructuralProbePlan {
  return H2StructuralProbePlanSchema.parse(input);
}

function attemptFrom(
  strategyId: PackagedStrategyId,
  durationMs: number,
  result: SafeStructuralObservation,
): H2Attempt {
  return H2AttemptSchema.parse({
    strategyId,
    outcome: result.outcome,
    durationMs: Math.min(30_000, Math.max(0, Math.round(durationMs))),
    metadata: result.metadata,
    uncertaintyReason: result.uncertaintyReason,
  });
}

function assertionOutcome(
  assertionId: StructuralAssertionId,
  result: SafeStructuralObservation,
): "PASS" | "FAIL" | "UNCERTAIN" {
  if (result.outcome === "UNCERTAIN") return "UNCERTAIN";
  if (result.outcome !== "PASS") return "FAIL";
  const metadata = result.metadata;
  switch (assertionId) {
    case "VISIBLE":
      return metadata.visible ? "PASS" : "FAIL";
    case "UNIQUE_ACTIVE_TARGET":
      return metadata.elementCount === 1 ? "PASS" : "FAIL";
    case "EDITABLE":
      return metadata.editable ? "PASS" : "FAIL";
    case "ACTIONABLE":
      return metadata.actionable ? "PASS" : "FAIL";
    case "BLOCKER_CLASSIFIED":
      return metadata.blockingState === null ? "PASS" : "UNCERTAIN";
    default:
      return "PASS";
  }
}

function safeErrorCode(error: unknown): H2ExecutionError | null {
  if (!(error instanceof BrowserDriverError)) return "OBSERVATION_FAILED";
  if (error.code === "CONTROLLED_TARGET_NOT_REGISTERED")
    return "CONTROLLED_TARGET_NOT_REGISTERED";
  if (error.code === "UNSAFE_TOP_LEVEL_REDIRECT")
    return "UNSAFE_TOP_LEVEL_REDIRECT";
  if (error.code === "NAVIGATION_FAILED") return "NAVIGATION_FAILED";
  if (error.code === "OBSERVATION_TIMEOUT") return "OBSERVATION_TIMEOUT";
  if (error.code === "OBSERVATION_FAILED") return "OBSERVATION_FAILED";
  return null;
}

function uncertaintyFor(error: unknown): EnvironmentUncertaintyReason | null {
  if (!(error instanceof BrowserDriverError)) return null;
  if (error.code === "CONTROLLED_BROWSER_UNAVAILABLE")
    return "CONTROLLED_BROWSER_UNAVAILABLE";
  if (error.code === "NAVIGATION_FAILED")
    return "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY";
  if (error.code === "OBSERVATION_TIMEOUT")
    return "CONTROLLED_BROWSER_UNAVAILABLE";
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new BrowserDriverError("OBSERVATION_TIMEOUT")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runH2StructuralSmoke(
  driver: BrowserDriver,
  rawPlan: unknown,
): Promise<H2StructuralSmokeReport> {
  const plan = parseH2ProbePlan(rawPlan);
  const startedAt = new Date().toISOString();
  const observations: H2StructuralObservation[] = [];
  let browserRuntime = driver.getRuntimeMetadata();
  let environmentUncertainty: EnvironmentUncertaintyReason | null = null;
  let executionError: H2ExecutionError | null = null;
  try {
    await driver.start();
    browserRuntime = driver.getRuntimeMetadata();
    await driver.open(plan.targetKey);
    for (const contour of plan.contours) {
      const contourStarted = Date.now();
      const attempts: H2Attempt[] = [];
      let selected: H2Attempt | undefined;
      for (const strategyId of [
        contour.primaryStrategyId,
        ...contour.fallbackStrategyIds,
      ]) {
        const attemptStarted = Date.now();
        let result: SafeStructuralObservation;
        try {
          result = await withTimeout(
            driver.observeStrategy(strategyId, contour.timeoutMs),
            contour.timeoutMs,
          );
        } catch (error) {
          const errorUncertainty = uncertaintyFor(error);
          if (errorUncertainty) environmentUncertainty = errorUncertainty;
          throw error;
        }
        const attempt = attemptFrom(
          strategyId,
          Date.now() - attemptStarted,
          result,
        );
        attempts.push(attempt);
        if (result.uncertaintyReason) {
          environmentUncertainty = result.uncertaintyReason;
          break;
        }
        if (result.outcome === "PASS") {
          selected = attempt;
          break;
        }
      }
      const primaryAttempt = attempts[0];
      if (!primaryAttempt) throw new Error("H2_PRIMARY_ATTEMPT_MISSING");
      const fallbackAttempts = attempts.slice(1);
      const selectedResult = selected
        ? {
            outcome: selected.outcome,
            metadata: selected.metadata,
            uncertaintyReason: selected.uncertaintyReason,
          }
        : {
            outcome: primaryAttempt.outcome,
            metadata: primaryAttempt.metadata,
            uncertaintyReason: primaryAttempt.uncertaintyReason,
          };
      observations.push(
        H2StructuralObservationSchema.parse({
          contourKey: contour.contourKey,
          primaryAttempt,
          fallbackAttempts,
          selectedStrategyId: selected?.strategyId ?? null,
          structuralAssertions: contour.structuralAssertionIds.map(
            (assertionId) => ({
              assertionId,
              outcome: assertionOutcome(assertionId, selectedResult),
            }),
          ),
          durationMs: Math.min(
            30_000,
            Math.max(0, Date.now() - contourStarted),
          ),
          environmentUncertainty: selectedResult.uncertaintyReason ?? null,
        }),
      );
      if (selectedResult.uncertaintyReason) break;
    }
  } catch (error) {
    executionError = safeErrorCode(error);
    environmentUncertainty ??= uncertaintyFor(error);
  } finally {
    await driver.closeOrPersist();
  }
  return H2StructuralSmokeReportSchema.parse({
    level: "H2",
    targetKey: plan.targetKey,
    browserRuntime,
    startedAt,
    completedAt: new Date().toISOString(),
    observations,
    environmentUncertainty,
    executionError,
  });
}
