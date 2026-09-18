import { z } from "zod";
import {
  AuthProviderIdSchema,
  AuthSessionSourceSchema,
  AuthSessionStateSchema,
  AuthSurfaceAuthoritySchema,
  type AuthSessionSource,
  type AuthSessionState,
  type AuthSurfaceAuthority,
} from "./auth-session-authority.js";
import { H3PromptIdSchema, getPackagedH3Prompt, type H3PromptId } from "./h3-contracts.js";

export const AuthProbeStepOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "UNCERTAIN",
]);
export type AuthProbeStepOutcome = z.infer<typeof AuthProbeStepOutcomeSchema>;

export const AuthProbeFailureCodeSchema = z.enum([
  "SESSION_NOT_PROVISIONED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "VERIFICATION_REQUIRED",
  "CAPTCHA_SECURITY_CHECKPOINT",
  "ACCOUNT_BLOCKED",
  "SESSION_ENVIRONMENT_UNAVAILABLE",
  "PROVIDER_NOT_LIVE_READY",
  "WRONG_PROVIDER_ACCOUNT",
  "WRONG_SURFACE",
  "SURFACE_IDENTITY_FAILED",
  "WRONG_CONVERSATION",
  "CONVERSATION_IDENTITY_FAILED",
  "COMPOSER_IDENTIFICATION_FAILED",
  "PROMPT_INSERTION_FAILED",
  "SEND_NOT_ACTIONABLE",
  "SEND_COUNT_NOT_ONE",
  "SEND_UNCERTAIN",
  "BUSY_OBSERVATION_FAILED",
  "RESPONSE_ASSOCIATION_FAILED",
  "COMPLETION_TIMEOUT",
  "COMMAND_SURFACE_FAILED",
  "COPY_SURFACE_FAILED",
  "DELIVERY_TARGET_FAILED",
  "CLEANUP_FAILED",
]);
export type AuthProbeFailureCode = z.infer<typeof AuthProbeFailureCodeSchema>;

export const AuthProbeClassificationSchema = z.enum([
  "HEALTHY",
  "DRIFT",
  "DEGRADED",
  "BROKEN",
  "UNKNOWN",
  "MAINTENANCE",
]);
export type AuthProbeClassification = z.infer<
  typeof AuthProbeClassificationSchema
>;

export const AuthProbeClassificationBasisSchema = z.enum([
  "AUTHENTICATED_DEEP_PROBE_PASS",
  "AUTH_SESSION_NOT_PROVISIONED",
  "AUTH_SESSION_BLOCKED",
  "AUTH_PROVIDER_NOT_LIVE_READY",
  "AUTH_PROVIDER_IDENTITY_MISMATCH",
  "AUTH_CONVERSATION_IDENTITY_MISMATCH",
  "AUTH_REQUIRED_SURFACE_FAILURE",
  "AUTH_OPTIONAL_SURFACE_FAILURE",
  "AUTH_SEND_ASSOCIATION_FAILURE",
]);
export type AuthProbeClassificationBasis = z.infer<
  typeof AuthProbeClassificationBasisSchema
>;

export const AuthProbeEvidenceSchema = z
  .object({
    promptId: H3PromptIdSchema,
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    promptInserted: z.boolean(),
    sendTransition: z.enum(["NOT_ATTEMPTED", "PROVEN", "UNCERTAIN"]),
    sendActionCount: z.number().int().min(0).max(1),
    responseAssociation: z.enum(["NOT_ATTEMPTED", "PROVEN", "FAILED"]),
    completion: z.enum(["NOT_ATTEMPTED", "PROVEN", "FAILED"]),
    codeBlockPresent: z.boolean(),
    nativeCopyPresent: z.boolean(),
    deliveryTarget: z.enum(["NOT_APPLICABLE", "PROVEN", "FAILED"]),
    assistantMessageCountDelta: z.number().int().min(0).max(2),
    transitionTrace: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(16),
  })
  .strict();
export type AuthProbeEvidence = Readonly<z.infer<typeof AuthProbeEvidenceSchema>>;

export const AuthProbeResultSchema = z
  .object({
    providerId: AuthProviderIdSchema,
    surfaceId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    strategyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    sessionState: AuthSessionStateSchema,
    executionOutcome: z.enum(["PASS", "FAIL", "BLOCKED", "UNCERTAIN"]),
    classification: AuthProbeClassificationSchema,
    classificationBasis: AuthProbeClassificationBasisSchema,
    failureCode: AuthProbeFailureCodeSchema.nullable(),
    completedSteps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(16),
    sendActionCount: z.number().int().min(0).max(1),
    evidence: AuthProbeEvidenceSchema,
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AuthProbeResult = Readonly<z.infer<typeof AuthProbeResultSchema>>;

export type AuthProbeStepResult = Readonly<{
  outcome: AuthProbeStepOutcome;
  transitionObserved: boolean | null;
  failureCode?: AuthProbeFailureCode;
}>;

export type AuthSessionIdentityObservation = Readonly<{
  outcome: AuthProbeStepOutcome;
  state: AuthSessionState;
  providerIdentity: "EXPECTED" | "WRONG_PROVIDER" | "NOT_PROVEN";
  surfaceIdentity: "EXPECTED" | "WRONG_SURFACE" | "NOT_PROVEN";
}>;

export type AuthConversationObservation = Readonly<{
  outcome: AuthProbeStepOutcome;
  identity: "FIXED_HEALTH_CONVERSATION" | "ARBITRARY_CONVERSATION" | "NOT_PROVEN";
}>;

export type AuthSurfaceObservation = Readonly<{
  outcome: AuthProbeStepOutcome;
  codeBlockPresent: boolean;
  nativeCopyPresent: boolean;
  deliveryTarget: "NOT_APPLICABLE" | "PROVEN" | "FAILED";
}>;

export type AuthSendObservation = Readonly<{
  outcome: AuthProbeStepOutcome;
  actionCount: 0 | 1 | 2;
  transition: "NOT_ATTEMPTED" | "PROVEN" | "UNCERTAIN";
}>;

/** Provider-specific browser code implements this interface; the shell owns order and safety. */
export interface AuthenticatedDeepProbeAdapter {
  identifySession(
    authority: AuthSurfaceAuthority,
  ): Promise<AuthSessionIdentityObservation>;
  identifySurface(authority: AuthSurfaceAuthority): Promise<AuthProbeStepResult>;
  identifyHealthConversation(
    authority: AuthSurfaceAuthority,
  ): Promise<AuthConversationObservation>;
  identifyComposer(authority: AuthSurfaceAuthority): Promise<AuthProbeStepResult>;
  insertPackagedPrompt(
    promptId: H3PromptId,
    authority: AuthSurfaceAuthority,
  ): Promise<AuthProbeStepResult>;
  sendOnce(authority: AuthSurfaceAuthority): Promise<AuthSendObservation>;
  observeGeneration(authority: AuthSurfaceAuthority): Promise<AuthProbeStepResult>;
  observeAssociatedResponse(
    authority: AuthSurfaceAuthority,
  ): Promise<AuthProbeStepResult & { readonly assistantMessageCountDelta: number }>;
  observeCompletion(authority: AuthSurfaceAuthority): Promise<AuthProbeStepResult>;
  validateSurfaces(authority: AuthSurfaceAuthority): Promise<AuthSurfaceObservation>;
  cleanup(): Promise<void>;
}

const HEALTH_PROMPT_SHA256 =
  "84f4e0cb8ebb9b5e7f7f9dce492a5837564e80060dfbc59a2e899f4c17673332";

const STEP = Object.freeze({
  SESSION: "IDENTIFY_SESSION",
  SURFACE: "IDENTIFY_SURFACE",
  CONVERSATION: "IDENTIFY_HEALTH_CONVERSATION",
  COMPOSER: "IDENTIFY_COMPOSER",
  INSERT: "INSERT_PACKAGED_PROMPT",
  SEND: "SEND_ONCE",
  GENERATION: "OBSERVE_GENERATION",
  RESPONSE: "OBSERVE_ASSOCIATED_RESPONSE",
  COMPLETION: "OBSERVE_COMPLETION",
  SURFACES: "VALIDATE_SURFACES",
  CLEANUP: "CLEANUP",
} as const);

const emptyEvidence = (promptId: H3PromptId): AuthProbeEvidence =>
  AuthProbeEvidenceSchema.parse({
    promptId,
    promptHash: HEALTH_PROMPT_SHA256,
    promptInserted: false,
    sendTransition: "NOT_ATTEMPTED",
    sendActionCount: 0,
    responseAssociation: "NOT_ATTEMPTED",
    completion: "NOT_ATTEMPTED",
    codeBlockPresent: false,
    nativeCopyPresent: false,
    deliveryTarget: "NOT_APPLICABLE",
    assistantMessageCountDelta: 0,
    transitionTrace: [],
  });

function failureFromSession(state: AuthSessionState): AuthProbeFailureCode {
  switch (state) {
    case "NO_SESSION_CONFIGURED":
      return "SESSION_NOT_PROVISIONED";
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "SESSION_INVALID":
      return "SESSION_INVALID";
    case "VERIFICATION_REQUIRED":
      return "VERIFICATION_REQUIRED";
    case "CAPTCHA_SECURITY_CHECKPOINT":
      return "CAPTCHA_SECURITY_CHECKPOINT";
    case "ACCOUNT_BLOCKED":
      return "ACCOUNT_BLOCKED";
    case "SESSION_ENVIRONMENT_UNAVAILABLE":
      return "SESSION_ENVIRONMENT_UNAVAILABLE";
    case "PREPROVISIONED_DEDICATED":
      throw new Error("PREPROVISIONED_SESSION_HAS_NO_SESSION_FAILURE");
  }
}

function sessionClassification(
  state: AuthSessionState,
): AuthProbeClassificationBasis {
  return state === "NO_SESSION_CONFIGURED"
    ? "AUTH_SESSION_NOT_PROVISIONED"
    : "AUTH_SESSION_BLOCKED";
}

function baseResult(
  authority: AuthSurfaceAuthority,
  sessionState: AuthSessionState,
  promptId: H3PromptId,
  observedAt: string,
  failureCode: AuthProbeFailureCode,
): AuthProbeResult {
  return AuthProbeResultSchema.parse({
    providerId: authority.providerId,
    surfaceId: authority.surfaceId,
    strategyId: authority.strategy.strategyId,
    sessionState,
    executionOutcome: sessionState === "NO_SESSION_CONFIGURED" ? "BLOCKED" : "UNCERTAIN",
    classification: "UNKNOWN",
    classificationBasis:
      failureCode === "PROVIDER_NOT_LIVE_READY"
        ? "AUTH_PROVIDER_NOT_LIVE_READY"
        : sessionClassification(sessionState),
    failureCode,
    completedSteps: [],
    sendActionCount: 0,
    evidence: emptyEvidence(promptId),
    observedAt,
  });
}

function resultForFailure(
  authority: AuthSurfaceAuthority,
  sessionState: AuthSessionState,
  promptId: H3PromptId,
  observedAt: string,
  failureCode: AuthProbeFailureCode,
  completedSteps: readonly string[],
  evidence: AuthProbeEvidence,
  basis: AuthProbeClassificationBasis,
): AuthProbeResult {
  const authFailure = [
    "SESSION_NOT_PROVISIONED",
    "SESSION_EXPIRED",
    "SESSION_INVALID",
    "VERIFICATION_REQUIRED",
    "CAPTCHA_SECURITY_CHECKPOINT",
    "ACCOUNT_BLOCKED",
    "SESSION_ENVIRONMENT_UNAVAILABLE",
    "PROVIDER_NOT_LIVE_READY",
  ].includes(failureCode);
  const identityFailure = [
    "WRONG_PROVIDER_ACCOUNT",
    "WRONG_SURFACE",
    "SURFACE_IDENTITY_FAILED",
    "WRONG_CONVERSATION",
    "CONVERSATION_IDENTITY_FAILED",
  ].includes(failureCode);
  return AuthProbeResultSchema.parse({
    providerId: authority.providerId,
    surfaceId: authority.surfaceId,
    strategyId: authority.strategy.strategyId,
    sessionState,
    executionOutcome: authFailure ? "BLOCKED" : "FAIL",
    classification: authFailure
      ? "UNKNOWN"
      : identityFailure
        ? "DRIFT"
        : basis === "AUTH_OPTIONAL_SURFACE_FAILURE"
          ? "DEGRADED"
          : "BROKEN",
    classificationBasis: basis,
    failureCode,
    completedSteps: [...completedSteps],
    sendActionCount: evidence.sendActionCount,
    evidence,
    observedAt,
  });
}

export type AuthenticatedDeepProbeOptions = Readonly<{
  promptId?: H3PromptId;
  observedAt?: string;
}>;

/**
 * One provider-neutral sequence.  The adapter owns provider DOM details; this
 * function owns ordering, exact-one Send, fail-closed behavior, evidence
 * bounds, and cleanup.
 */
export async function runAuthenticatedDeepProbe(
  authority: AuthSurfaceAuthority,
  source: AuthSessionSource,
  adapter: AuthenticatedDeepProbeAdapter,
  options: AuthenticatedDeepProbeOptions = {},
): Promise<AuthProbeResult> {
  const parsedAuthority = AuthSurfaceAuthoritySchema.parse(authority);
  const parsedSource = AuthSessionSourceSchema.parse(source);
  const promptId = H3PromptIdSchema.parse(
    options.promptId ?? "BRIDGE_COMMAND_SMOKE_V1",
  );
  // Validates the accepted packaged prompt without exposing its text to the
  // adapter or to evidence.
  getPackagedH3Prompt(promptId);
  const observedAt = options.observedAt ?? new Date().toISOString();
  const completedSteps: string[] = [];
  let evidence = emptyEvidence(promptId);
  let sendActionCount = 0;

  if (parsedSource.sourceType === "NONE") {
    return baseResult(
      parsedAuthority,
      "NO_SESSION_CONFIGURED",
      promptId,
      observedAt,
      "SESSION_NOT_PROVISIONED",
    );
  }
  if (
    parsedSource.state !== "PREPROVISIONED_DEDICATED" ||
    !parsedSource.dedicatedTechnicalAccount ||
    parsedSource.personalAccount
  ) {
    return baseResult(
      parsedAuthority,
      parsedSource.state,
      promptId,
      observedAt,
      failureFromSession(parsedSource.state),
    );
  }

  const finish = async (result: AuthProbeResult): Promise<AuthProbeResult> => {
    try {
      await adapter.cleanup();
      return result;
    } catch {
      return AuthProbeResultSchema.parse({
        ...result,
        executionOutcome: "FAIL",
        classification: "BROKEN",
        classificationBasis: "AUTH_REQUIRED_SURFACE_FAILURE",
        failureCode: "CLEANUP_FAILED",
      });
    }
  };

  try {
    const session = await adapter.identifySession(parsedAuthority);
    if (session.state !== "PREPROVISIONED_DEDICATED") {
      return await finish(
        resultForFailure(
          parsedAuthority,
          session.state,
          promptId,
          observedAt,
          failureFromSession(session.state),
          completedSteps,
          evidence,
          sessionClassification(session.state),
        ),
      );
    }
    completedSteps.push(STEP.SESSION);
    if (session.providerIdentity === "WRONG_PROVIDER") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "WRONG_PROVIDER_ACCOUNT", completedSteps, evidence, "AUTH_PROVIDER_IDENTITY_MISMATCH"));
    }
    if (session.surfaceIdentity === "WRONG_SURFACE") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "WRONG_SURFACE", completedSteps, evidence, "AUTH_PROVIDER_IDENTITY_MISMATCH"));
    }
    if (session.providerIdentity !== "EXPECTED" || session.surfaceIdentity !== "EXPECTED") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "SESSION_INVALID", completedSteps, evidence, "AUTH_PROVIDER_IDENTITY_MISMATCH"));
    }
    if (
      !parsedAuthority.capability.sendAutomatedSafely ||
      (parsedAuthority.implementationStatus !== "FOUNDATION_AVAILABLE" &&
        parsedAuthority.implementationStatus !==
          "AUTOMATABLE_WITH_PROVISIONED_SESSION")
    ) {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "PROVIDER_NOT_LIVE_READY", completedSteps, evidence, "AUTH_PROVIDER_NOT_LIVE_READY"));
    }

    const surface = await adapter.identifySurface(parsedAuthority);
    if (surface.outcome !== "PASS") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, surface.failureCode ?? "SURFACE_IDENTITY_FAILED", completedSteps, evidence, "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.SURFACE);

    const conversation = await adapter.identifyHealthConversation(parsedAuthority);
    if (conversation.outcome !== "PASS" || conversation.identity !== "FIXED_HEALTH_CONVERSATION") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, conversation.identity === "ARBITRARY_CONVERSATION" ? "WRONG_CONVERSATION" : "CONVERSATION_IDENTITY_FAILED", completedSteps, evidence, "AUTH_CONVERSATION_IDENTITY_MISMATCH"));
    }
    completedSteps.push(STEP.CONVERSATION);

    const composer = await adapter.identifyComposer(parsedAuthority);
    if (composer.outcome !== "PASS") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, composer.failureCode ?? "COMPOSER_IDENTIFICATION_FAILED", completedSteps, evidence, "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.COMPOSER);

    const inserted = await adapter.insertPackagedPrompt(promptId, parsedAuthority);
    if (inserted.outcome !== "PASS") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, inserted.failureCode ?? "PROMPT_INSERTION_FAILED", completedSteps, evidence, "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.INSERT);
    evidence = AuthProbeEvidenceSchema.parse({ ...evidence, promptInserted: true });

    const sent = await adapter.sendOnce(parsedAuthority);
    sendActionCount += 1;
    if (sent.actionCount !== 1) {
      evidence = AuthProbeEvidenceSchema.parse({ ...evidence, sendActionCount: 0 });
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "SEND_COUNT_NOT_ONE", completedSteps, evidence, "AUTH_SEND_ASSOCIATION_FAILURE"));
    }
    evidence = AuthProbeEvidenceSchema.parse({
      ...evidence,
      sendTransition: sent.transition,
      sendActionCount: 1,
      transitionTrace: [...evidence.transitionTrace, "PROMPT_INSERTED", "SEND_ISSUED"],
    });
    if (sent.outcome !== "PASS" || sent.transition !== "PROVEN") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, sent.transition === "UNCERTAIN" ? "SEND_UNCERTAIN" : "SEND_NOT_ACTIONABLE", completedSteps, evidence, "AUTH_SEND_ASSOCIATION_FAILURE"));
    }
    completedSteps.push(STEP.SEND);

    const generation = await adapter.observeGeneration(parsedAuthority);
    if (generation.outcome !== "PASS") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, generation.failureCode ?? "BUSY_OBSERVATION_FAILED", completedSteps, evidence, "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.GENERATION);
    evidence = AuthProbeEvidenceSchema.parse({ ...evidence, transitionTrace: [...evidence.transitionTrace, "SEND_TO_BUSY"] });

    const response = await adapter.observeAssociatedResponse(parsedAuthority);
    if (response.outcome !== "PASS" || response.assistantMessageCountDelta !== 1) {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "RESPONSE_ASSOCIATION_FAILED", completedSteps, AuthProbeEvidenceSchema.parse({ ...evidence, responseAssociation: "FAILED" }), "AUTH_SEND_ASSOCIATION_FAILURE"));
    }
    completedSteps.push(STEP.RESPONSE);
    evidence = AuthProbeEvidenceSchema.parse({ ...evidence, responseAssociation: "PROVEN", assistantMessageCountDelta: 1, transitionTrace: [...evidence.transitionTrace, "ASSISTANT_ASSOCIATED"] });

    const completion = await adapter.observeCompletion(parsedAuthority);
    if (completion.outcome !== "PASS") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, completion.failureCode ?? "COMPLETION_TIMEOUT", completedSteps, AuthProbeEvidenceSchema.parse({ ...evidence, completion: "FAILED" }), "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.COMPLETION);
    evidence = AuthProbeEvidenceSchema.parse({ ...evidence, completion: "PROVEN", transitionTrace: [...evidence.transitionTrace, "BUSY_TO_IDLE"] });

    const surfaces = await adapter.validateSurfaces(parsedAuthority);
    const capability = parsedAuthority.capability;
    if (capability.commandCodeSurfaceMeaningful && !surfaces.codeBlockPresent) {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "COMMAND_SURFACE_FAILED", completedSteps, AuthProbeEvidenceSchema.parse({ ...evidence, codeBlockPresent: false }), "AUTH_REQUIRED_SURFACE_FAILURE"));
    }
    if (capability.nativeCopyMeaningful && !surfaces.nativeCopyPresent) {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "COPY_SURFACE_FAILED", completedSteps, AuthProbeEvidenceSchema.parse({ ...evidence, codeBlockPresent: surfaces.codeBlockPresent, nativeCopyPresent: false }), "AUTH_OPTIONAL_SURFACE_FAILURE"));
    }
    if (capability.deliveryTargetMeaningful && surfaces.deliveryTarget === "FAILED") {
      return await finish(resultForFailure(parsedAuthority, session.state, promptId, observedAt, "DELIVERY_TARGET_FAILED", completedSteps, AuthProbeEvidenceSchema.parse({ ...evidence, codeBlockPresent: surfaces.codeBlockPresent, nativeCopyPresent: surfaces.nativeCopyPresent, deliveryTarget: "FAILED" }), "AUTH_OPTIONAL_SURFACE_FAILURE"));
    }
    completedSteps.push(STEP.SURFACES);
    evidence = AuthProbeEvidenceSchema.parse({ ...evidence, codeBlockPresent: surfaces.codeBlockPresent, nativeCopyPresent: surfaces.nativeCopyPresent, deliveryTarget: surfaces.deliveryTarget, transitionTrace: [...evidence.transitionTrace, "SURFACES_VALIDATED"] });
    return await finish(AuthProbeResultSchema.parse({
      providerId: parsedAuthority.providerId,
      surfaceId: parsedAuthority.surfaceId,
      strategyId: parsedAuthority.strategy.strategyId,
      sessionState: "PREPROVISIONED_DEDICATED",
      executionOutcome: "PASS",
      classification: "HEALTHY",
      classificationBasis: "AUTHENTICATED_DEEP_PROBE_PASS",
      failureCode: null,
      completedSteps,
      sendActionCount,
      evidence,
      observedAt,
    }));
  } catch {
    return await finish(resultForFailure(parsedAuthority, "PREPROVISIONED_DEDICATED", promptId, observedAt, "SEND_UNCERTAIN", completedSteps, evidence, "AUTH_SEND_ASSOCIATION_FAILURE"));
  }
}
