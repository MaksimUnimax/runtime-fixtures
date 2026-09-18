import { z } from "zod";
import {
  H3BehaviorStepSchema,
  type H3BehaviorStep,
  type H3Surface,
  type H3RunPlan,
  parseH3RunPlan,
} from "./h3-contracts.js";
import {
  H3SurfaceProfileSchema,
  compileH3PackagedActions,
  getPackagedH3Profile,
  parseH3SurfaceProfile,
  type H3BridgeSurfaceCheck,
  type H3PackagedAction,
  type H3PackagedActionSequence,
  type H3SurfaceProfile,
} from "./h3-actions.js";
import {
  H3SafeEvidenceEventSchema,
  sanitizeH3EvidenceEvent,
  type H3SafeEvidenceEvent,
} from "./evidence-sanitizer.js";
import {
  H3StrategyError,
  H3StrategyStepResultSchema,
  type H3StrategyStepResult,
  type H3SurfaceStrategy,
  validateH3SurfaceStrategy,
} from "./h3-strategy.js";
import {
  EnvironmentUncertaintyReasonSchema,
  type EnvironmentUncertaintyReason,
} from "@product/health";
import {
  ControlledTargetKeySchema,
  type ControlledTargetKey,
} from "./target-registry.js";

export const H3_PACKAGED_TARGET_BY_SURFACE = Object.freeze({
  CHATGPT_STANDARD: "chatgpt_standard_health",
  CHATGPT_WORK: "chatgpt_work_health",
} satisfies Readonly<Record<H3Surface, ControlledTargetKey>>);

export function getPackagedH3Target(surface: H3Surface): ControlledTargetKey {
  return H3_PACKAGED_TARGET_BY_SURFACE[surface];
}

export const H3ExecutionFailureCodeSchema = z.enum([
  "TARGET_SURFACE_MISMATCH",
  "STRATEGY_PROFILE_MISMATCH",
  "STRATEGY_NOT_REGISTERED",
  "SURFACE_IDENTIFICATION_FAILED",
  "COMPOSER_IDENTIFICATION_FAILED",
  "PROMPT_INSERTION_FAILED",
  "SEND_FAILED",
  "SEND_UNCERTAIN",
  "BUSY_OBSERVATION_FAILED",
  "RESPONSE_OBSERVATION_FAILED",
  "COMPLETION_OBSERVATION_FAILED",
  "BUSY_TIMEOUT",
  "RESPONSE_TIMEOUT",
  "COMPLETION_TIMEOUT",
  "BRIDGE_SURFACE_VALIDATION_FAILED",
  "STEP_TIMEOUT",
  "RUN_TIMEOUT",
  "CONTROLLED_BROWSER_UNAVAILABLE",
  "LOGIN_REQUIRED",
  "VERIFICATION_CHECKPOINT",
  "ACCOUNT_BLOCKED",
  "NETWORK_FAILURE_BEFORE_IDENTITY",
  "STRATEGY_FAILED",
  "CLEANUP_FAILED",
]);
export type H3ExecutionFailureCode = z.infer<
  typeof H3ExecutionFailureCodeSchema
>;

export const H3ExecutionOutcomeSchema = z.enum(["PASS", "FAIL", "UNCERTAIN"]);
export type H3ExecutionOutcome = z.infer<typeof H3ExecutionOutcomeSchema>;

export const H3CleanupOutcomeSchema = z.enum(["PASS", "FAIL"]);
export type H3CleanupOutcome = z.infer<typeof H3CleanupOutcomeSchema>;

export const H3ExecutionResultSchema = z
  .object({
    level: z.literal("H3"),
    targetKey: ControlledTargetKeySchema,
    surfaceProfile: H3SurfaceProfileSchema,
    outcome: H3ExecutionOutcomeSchema,
    completedSteps: z.array(H3BehaviorStepSchema).max(9),
    events: z.array(H3SafeEvidenceEventSchema).max(9),
    durationMs: z.number().int().min(0).max(120_000),
    failureCode: H3ExecutionFailureCodeSchema.nullable(),
    failureStep: H3BehaviorStepSchema.nullable(),
    cleanupOutcome: H3CleanupOutcomeSchema,
    cleanupFailureCode: z.literal("CLEANUP_FAILED").nullable(),
    environmentUncertainty: EnvironmentUncertaintyReasonSchema.nullable(),
  })
  .strict();
export type H3ExecutionResult = Readonly<
  Omit<z.infer<typeof H3ExecutionResultSchema>, "completedSteps" | "events"> & {
    readonly completedSteps: readonly H3BehaviorStep[];
    readonly events: readonly H3SafeEvidenceEvent[];
  }
>;

export interface H3Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CLOCK: H3Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type H3ExecutionOptions = Readonly<{ clock?: H3Clock }>;

export class H3EngineInputError extends Error {
  public readonly code:
    | "TARGET_SURFACE_MISMATCH"
    | "STRATEGY_PROFILE_MISMATCH"
    | "STRATEGY_NOT_REGISTERED";

  public constructor(
    code:
      | "TARGET_SURFACE_MISMATCH"
      | "STRATEGY_PROFILE_MISMATCH"
      | "STRATEGY_NOT_REGISTERED",
  ) {
    super(code);
    this.name = "H3EngineInputError";
    this.code = code;
  }
}

type H3TimedFailureCode = "STEP_TIMEOUT" | "RUN_TIMEOUT";

class H3TimedFailure extends Error {
  public constructor(public readonly code: H3TimedFailureCode) {
    super(code);
    this.name = "H3TimedFailure";
  }
}

class H3ActionFailure extends Error {
  public constructor(
    public readonly code: H3ExecutionFailureCode,
    public readonly uncertaintyReason: EnvironmentUncertaintyReason | null,
    public readonly uncertain: boolean,
  ) {
    super(code);
    this.name = "H3ActionFailure";
  }
}

type H3Failure = Readonly<{
  code: H3ExecutionFailureCode;
  step: H3BehaviorStep;
  uncertaintyReason: EnvironmentUncertaintyReason | null;
  uncertain: boolean;
}>;

function assertNever(value: never): never {
  throw new Error(`UNHANDLED_PACKAGED_H3_ACTION:${String(value)}`);
}

function actionFailureCode(
  action: Exclude<H3PackagedAction, { kind: "CLEANUP" }>,
): H3ExecutionFailureCode {
  switch (action.kind) {
    case "IDENTIFY_SURFACE":
      return "SURFACE_IDENTIFICATION_FAILED";
    case "IDENTIFY_COMPOSER":
      return "COMPOSER_IDENTIFICATION_FAILED";
    case "INSERT_PROMPT":
      return "PROMPT_INSERTION_FAILED";
    case "SEND_ONCE":
      return "SEND_FAILED";
    case "OBSERVE_BUSY":
      return "BUSY_OBSERVATION_FAILED";
    case "OBSERVE_RESPONSE":
      return "RESPONSE_OBSERVATION_FAILED";
    case "OBSERVE_COMPLETION":
      return "COMPLETION_OBSERVATION_FAILED";
    case "VALIDATE_BRIDGE_SURFACES":
      return "BRIDGE_SURFACE_VALIDATION_FAILED";
    default:
      return assertNever(action);
  }
}

function uncertaintyFailureCode(
  reason: EnvironmentUncertaintyReason,
): H3ExecutionFailureCode {
  switch (reason) {
    case "LOGIN_EXPIRED":
      return "LOGIN_REQUIRED";
    case "VERIFICATION_CHECKPOINT":
    case "CAPTCHA_SECURITY_CHECKPOINT":
      return "VERIFICATION_CHECKPOINT";
    case "ACCOUNT_BLOCKED":
      return "ACCOUNT_BLOCKED";
    case "NETWORK_FAILURE_BEFORE_PAGE_IDENTITY":
      return "NETWORK_FAILURE_BEFORE_IDENTITY";
    case "CONTROLLED_BROWSER_UNAVAILABLE":
      return "CONTROLLED_BROWSER_UNAVAILABLE";
    default:
      return assertNever(reason);
  }
}

function clampDuration(durationMs: number): number {
  return Math.min(120_000, Math.max(0, Math.round(durationMs)));
}

function stepEvent(
  step: H3BehaviorStep,
  outcome: H3SafeEvidenceEvent["outcome"],
  durationMs: number,
  result: H3StrategyStepResult | null,
): H3SafeEvidenceEvent {
  return sanitizeH3EvidenceEvent({
    step,
    outcome,
    durationMs: clampDuration(durationMs),
    markerCount: result?.markerCount ?? null,
    transitionObserved: result?.transitionObserved ?? null,
    observations: result?.observations ?? [],
  });
}

function resultFailure(
  action: Exclude<H3PackagedAction, { kind: "CLEANUP" }>,
  result: H3StrategyStepResult,
): H3ActionFailure | null {
  if (result.outcome === "PASS") return null;
  if (result.outcome === "UNCERTAIN" && result.uncertaintyReason !== null) {
    return new H3ActionFailure(
      uncertaintyFailureCode(result.uncertaintyReason),
      result.uncertaintyReason,
      true,
    );
  }
  if (result.outcome === "UNCERTAIN") {
    return new H3ActionFailure(
      action.kind === "SEND_ONCE"
        ? "SEND_UNCERTAIN"
        : actionFailureCode(action),
      null,
      true,
    );
  }
  return new H3ActionFailure(actionFailureCode(action), null, false);
}

function normalizeFailure(
  action: Exclude<H3PackagedAction, { kind: "CLEANUP" }>,
  error: unknown,
): H3Failure {
  if (error instanceof H3ActionFailure) {
    return {
      code: error.code,
      step: action.kind,
      uncertaintyReason: error.uncertaintyReason,
      uncertain: error.uncertain,
    };
  }
  if (error instanceof H3TimedFailure) {
    return {
      code:
        error.code === "RUN_TIMEOUT"
          ? "RUN_TIMEOUT"
          : action.kind === "OBSERVE_BUSY"
            ? "BUSY_TIMEOUT"
            : action.kind === "OBSERVE_RESPONSE"
              ? "RESPONSE_TIMEOUT"
              : action.kind === "OBSERVE_COMPLETION"
                ? "COMPLETION_TIMEOUT"
                : "STEP_TIMEOUT",
      step: action.kind,
      uncertaintyReason: null,
      uncertain: false,
    };
  }
  if (error instanceof H3StrategyError) {
    return {
      code:
        error.code === "ENVIRONMENT_UNCERTAIN" &&
        error.uncertaintyReason !== null
          ? uncertaintyFailureCode(error.uncertaintyReason)
          : actionFailureCode(action),
      step: action.kind,
      uncertaintyReason: error.uncertaintyReason,
      uncertain: error.code === "ENVIRONMENT_UNCERTAIN",
    };
  }
  return {
    code: actionFailureCode(action),
    step: action.kind,
    uncertaintyReason: null,
    uncertain: false,
  };
}

async function runWithTimeout<T>(
  operation: () => Promise<T>,
  stepTimeoutMs: number,
  deadlineMs: number,
  clock: H3Clock,
  allowExpiredBudget: boolean,
): Promise<T> {
  const remainingMs = deadlineMs - clock.now();
  if (remainingMs <= 0 && !allowExpiredBudget) {
    throw new H3TimedFailure("RUN_TIMEOUT");
  }
  const timeoutMs = Math.max(0, Math.min(stepTimeoutMs, remainingMs));
  const timeoutCode: H3TimedFailureCode =
    remainingMs <= stepTimeoutMs ? "RUN_TIMEOUT" : "STEP_TIMEOUT";
  const operationPromise = operation();
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(() => {
      reject(new H3TimedFailure(timeoutCode));
    }, timeoutMs);
    operationPromise.then(
      (value) => {
        clock.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clock.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function validatePlanAndStrategy(
  rawPlan: unknown,
  strategy: H3SurfaceStrategy,
): {
  plan: H3RunPlan;
  actions: H3PackagedActionSequence;
  profile: H3SurfaceProfile;
} {
  const plan = parseH3RunPlan(rawPlan);
  const actions = compileH3PackagedActions(plan);
  const profile = getPackagedH3Profile(plan.surface);
  validateH3SurfaceStrategy(strategy);
  const expectedTarget = getPackagedH3Target(plan.surface);
  if (
    plan.targetKey !== expectedTarget ||
    strategy.targetKey !== expectedTarget
  ) {
    throw new H3EngineInputError("TARGET_SURFACE_MISMATCH");
  }
  const parsedStrategyProfile = parseH3SurfaceProfile(strategy.surfaceProfile);
  if (
    parsedStrategyProfile.surface !== profile.surface ||
    parsedStrategyProfile.profileId !== profile.profileId ||
    parsedStrategyProfile.profileRevision !== profile.profileRevision
  ) {
    throw new H3EngineInputError("STRATEGY_PROFILE_MISMATCH");
  }
  return { plan, actions, profile };
}

export class H3SurfaceStrategyRegistry {
  readonly #strategies: readonly H3SurfaceStrategy[];

  public constructor(strategies: readonly H3SurfaceStrategy[]) {
    const validated = strategies.map((strategy) => {
      validateH3SurfaceStrategy(strategy);
      const profile = parseH3SurfaceProfile(strategy.surfaceProfile);
      const expectedTarget = getPackagedH3Target(profile.surface);
      if (strategy.targetKey !== expectedTarget) {
        throw new H3EngineInputError("TARGET_SURFACE_MISMATCH");
      }
      return strategy;
    });
    const identities = validated.map(
      (strategy) =>
        `${strategy.targetKey}:${strategy.surfaceProfile.profileId}@${strategy.surfaceProfile.profileRevision}`,
    );
    if (new Set(identities).size !== identities.length) {
      throw new H3EngineInputError("STRATEGY_NOT_REGISTERED");
    }
    this.#strategies = Object.freeze(validated.slice());
  }

  public resolve(surface: H3Surface, targetKey: string): H3SurfaceStrategy {
    const expectedTarget = getPackagedH3Target(surface);
    ControlledTargetKeySchema.parse(targetKey);
    if (targetKey !== expectedTarget) {
      throw new H3EngineInputError("TARGET_SURFACE_MISMATCH");
    }
    const profile = getPackagedH3Profile(surface);
    const strategy = this.#strategies.find(
      (candidate) =>
        candidate.targetKey === targetKey &&
        candidate.surfaceProfile.surface === profile.surface &&
        candidate.surfaceProfile.profileId === profile.profileId &&
        candidate.surfaceProfile.profileRevision === profile.profileRevision,
    );
    if (!strategy) throw new H3EngineInputError("STRATEGY_NOT_REGISTERED");
    return strategy;
  }
}

export async function runH3BehavioralSmoke(
  strategy: H3SurfaceStrategy,
  rawPlan: unknown,
  options: H3ExecutionOptions = {},
): Promise<H3ExecutionResult> {
  const { plan, actions, profile } = validatePlanAndStrategy(rawPlan, strategy);
  const clock = options.clock ?? SYSTEM_CLOCK;
  const startedAt = clock.now();
  const deadlineMs = startedAt + plan.runTimeoutMs;
  const completedSteps: H3BehaviorStep[] = [];
  const events: H3SafeEvidenceEvent[] = [];
  let primaryFailure: H3Failure | null = null;
  let cleanupFailure: H3Failure | null = null;
  let cleanupAttempted = false;
  let sendInvoked = false;
  const cleanupAction = actions.at(-1);
  if (!cleanupAction || cleanupAction.kind !== "CLEANUP") {
    throw new Error("INVALID_PACKAGED_H3_ACTION_SEQUENCE");
  }

  const runSemanticAction = async (
    action: Exclude<H3PackagedAction, { kind: "CLEANUP" }>,
  ): Promise<void> => {
    const actionStartedAt = clock.now();
    let result: H3StrategyStepResult | null = null;
    try {
      const operation = (): Promise<H3StrategyStepResult> => {
        switch (action.kind) {
          case "IDENTIFY_SURFACE":
            return strategy.identifyApprovedSurface();
          case "IDENTIFY_COMPOSER":
            return strategy.identifyApprovedComposer();
          case "INSERT_PROMPT":
            return strategy.insertPackagedPrompt(action.promptId);
          case "SEND_ONCE":
            if (sendInvoked)
              throw new H3ActionFailure("SEND_FAILED", null, false);
            sendInvoked = true;
            return strategy.sendOnce();
          case "OBSERVE_BUSY":
            return strategy.observeBusy();
          case "OBSERVE_RESPONSE":
            return strategy.observeResponse();
          case "OBSERVE_COMPLETION":
            return strategy.observeCompletion();
          case "VALIDATE_BRIDGE_SURFACES":
            return strategy.validateBridgeSurfaces(action.checks);
          default:
            return assertNever(action);
        }
      };
      result = H3StrategyStepResultSchema.parse(
        await runWithTimeout(
          operation,
          plan.stepTimeoutMs,
          deadlineMs,
          clock,
          false,
        ),
      );
      const failure = resultFailure(action, result);
      if (failure) throw failure;
      if (clock.now() > deadlineMs) throw new H3TimedFailure("RUN_TIMEOUT");
      events.push(
        stepEvent(action.kind, "PASS", clock.now() - actionStartedAt, result),
      );
      completedSteps.push(action.kind);
    } catch (error) {
      const failure = normalizeFailure(action, error);
      events.push(
        stepEvent(
          action.kind,
          failure.uncertain ? "UNCERTAIN" : "FAIL",
          clock.now() - actionStartedAt,
          result,
        ),
      );
      throw failure;
    }
  };

  const attemptCleanup = async (): Promise<void> => {
    cleanupAttempted = true;
    const cleanupStartedAt = clock.now();
    try {
      await runWithTimeout(
        () => strategy.cleanup().then(() => undefined),
        plan.stepTimeoutMs,
        deadlineMs,
        clock,
        true,
      );
      events.push(
        stepEvent("CLEANUP", "PASS", clock.now() - cleanupStartedAt, null),
      );
      completedSteps.push("CLEANUP");
    } catch {
      cleanupFailure = {
        code: "CLEANUP_FAILED",
        step: "CLEANUP",
        uncertaintyReason: null,
        uncertain: false,
      };
      events.push(
        stepEvent("CLEANUP", "FAIL", clock.now() - cleanupStartedAt, null),
      );
    }
  };

  try {
    for (const action of actions) {
      if (action.kind === "CLEANUP") {
        await attemptCleanup();
      } else {
        await runSemanticAction(action);
      }
    }
  } catch (error) {
    if ("code" in (error as object) && "step" in (error as object)) {
      primaryFailure = error as H3Failure;
    } else {
      primaryFailure = {
        code: "STRATEGY_FAILED",
        step: "IDENTIFY_SURFACE",
        uncertaintyReason: null,
        uncertain: false,
      };
    }
  } finally {
    if (!cleanupAttempted) await attemptCleanup();
  }

  const failure = primaryFailure ?? cleanupFailure;
  const outcome: H3ExecutionOutcome =
    failure === null ? "PASS" : failure.uncertain ? "UNCERTAIN" : "FAIL";
  const parsedResult = H3ExecutionResultSchema.parse({
    level: "H3",
    targetKey: plan.targetKey,
    surfaceProfile: profile,
    outcome,
    completedSteps,
    events,
    durationMs: clampDuration(clock.now() - startedAt),
    failureCode: failure?.code ?? null,
    failureStep: failure?.step ?? null,
    cleanupOutcome: cleanupFailure === null ? "PASS" : "FAIL",
    cleanupFailureCode: cleanupFailure === null ? null : "CLEANUP_FAILED",
    environmentUncertainty: primaryFailure?.uncertaintyReason ?? null,
  });
  return Object.freeze({
    ...parsedResult,
    completedSteps: Object.freeze(parsedResult.completedSteps),
    events: Object.freeze(parsedResult.events),
  });
}

export async function runH3BehavioralSmokeFromRegistry(
  registry: H3SurfaceStrategyRegistry,
  rawPlan: unknown,
  options: H3ExecutionOptions = {},
): Promise<H3ExecutionResult> {
  const plan = parseH3RunPlan(rawPlan);
  const strategy = registry.resolve(plan.surface, plan.targetKey);
  return runH3BehavioralSmoke(strategy, plan, options);
}

export type {
  H3BridgeSurfaceCheck,
  H3PackagedAction,
  H3PackagedActionSequence,
  H3SurfaceProfile,
};
