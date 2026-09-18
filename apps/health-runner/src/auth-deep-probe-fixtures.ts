import type {
  AuthConversationObservation,
  AuthenticatedDeepProbeAdapter,
  AuthProbeStepResult,
  AuthSendObservation,
  AuthSessionIdentityObservation,
  AuthSurfaceObservation,
} from "./auth-deep-probe.js";
import type {
  AuthSessionState,
  AuthSurfaceAuthority,
} from "./auth-session-authority.js";
import type { H3PromptId } from "./h3-contracts.js";

export type AuthFixtureFault =
  | "HEALTHY"
  | "EXPIRED_SESSION"
  | "INVALID_SESSION"
  | "VERIFICATION_REQUIRED"
  | "CAPTCHA"
  | "ACCOUNT_BLOCKED"
  | "ENVIRONMENT_UNAVAILABLE"
  | "WRONG_PROVIDER_ACCOUNT"
  | "WRONG_SURFACE"
  | "WRONG_CONVERSATION"
  | "DUPLICATE_SEND"
  | "SEND_UNCERTAIN"
  | "RESPONSE_ASSOCIATION_FAILURE"
  | "COMPLETION_TIMEOUT"
  | "MISSING_COMPOSER"
  | "MISSING_CODE_SURFACE"
  | "MISSING_COPY_SURFACE"
  | "MISSING_DELIVERY_TARGET";

export type AuthFixtureTrace = Readonly<{
  calls: readonly string[];
  sendCalls: number;
  cleanupCalls: number;
}>;

function result(
  outcome: AuthProbeStepResult["outcome"],
  failureCode?: AuthProbeStepResult["failureCode"],
): AuthProbeStepResult {
  return { outcome, transitionObserved: outcome === "PASS", failureCode };
}

function sessionStateForFault(fault: AuthFixtureFault): AuthSessionState {
  switch (fault) {
    case "EXPIRED_SESSION":
      return "SESSION_EXPIRED";
    case "INVALID_SESSION":
      return "SESSION_INVALID";
    case "VERIFICATION_REQUIRED":
      return "VERIFICATION_REQUIRED";
    case "CAPTCHA":
      return "CAPTCHA_SECURITY_CHECKPOINT";
    case "ACCOUNT_BLOCKED":
      return "ACCOUNT_BLOCKED";
    case "ENVIRONMENT_UNAVAILABLE":
      return "SESSION_ENVIRONMENT_UNAVAILABLE";
    default:
      return "PREPROVISIONED_DEDICATED";
  }
}

/** Synthetic only: no provider request, credentials, cookie, or response text. */
export function createAuthenticatedFixtureAdapter(
  authority: AuthSurfaceAuthority,
  fault: AuthFixtureFault = "HEALTHY",
): Readonly<{
  adapter: AuthenticatedDeepProbeAdapter;
  trace: () => AuthFixtureTrace;
}> {
  const calls: string[] = [];
  let sendCalls = 0;
  let cleanupCalls = 0;
  const record = (name: string): void => {
    calls.push(name);
  };
  const adapter: AuthenticatedDeepProbeAdapter = {
    async identifySession(
      expectedAuthority: AuthSurfaceAuthority,
    ): Promise<AuthSessionIdentityObservation> {
      record("identifySession");
      const state = sessionStateForFault(fault);
      return {
        outcome: state === "PREPROVISIONED_DEDICATED" ? "PASS" : "UNCERTAIN",
        state,
        providerIdentity:
          fault === "WRONG_PROVIDER_ACCOUNT" ||
          expectedAuthority.providerId !== authority.providerId
            ? "WRONG_PROVIDER"
            : "EXPECTED",
        surfaceIdentity:
          fault === "WRONG_SURFACE" ||
          expectedAuthority.surfaceId !== authority.surfaceId
            ? "WRONG_SURFACE"
            : "EXPECTED",
      };
    },
    async identifySurface(
      expectedAuthority: AuthSurfaceAuthority,
    ): Promise<AuthProbeStepResult> {
      record("identifySurface");
      return result(
        fault === "WRONG_SURFACE" ||
          expectedAuthority.surfaceId !== authority.surfaceId
          ? "FAIL"
          : "PASS",
        fault === "WRONG_SURFACE" ||
          expectedAuthority.surfaceId !== authority.surfaceId
          ? "WRONG_SURFACE"
          : undefined,
      );
    },
    async identifyHealthConversation(): Promise<AuthConversationObservation> {
      record("identifyHealthConversation");
      return {
        outcome: fault === "WRONG_CONVERSATION" ? "FAIL" : "PASS",
        identity:
          fault === "WRONG_CONVERSATION"
            ? "ARBITRARY_CONVERSATION"
            : "FIXED_HEALTH_CONVERSATION",
      };
    },
    async identifyComposer(): Promise<AuthProbeStepResult> {
      record("identifyComposer");
      return result(
        fault === "MISSING_COMPOSER" ? "FAIL" : "PASS",
        fault === "MISSING_COMPOSER" ? "COMPOSER_IDENTIFICATION_FAILED" : undefined,
      );
    },
    async insertPackagedPrompt(
      _promptId: H3PromptId,
    ): Promise<AuthProbeStepResult> {
      record("insertPackagedPrompt");
      return result("PASS");
    },
    async sendOnce(): Promise<AuthSendObservation> {
      record("sendOnce");
      sendCalls += 1;
      if (fault === "DUPLICATE_SEND") {
        return { outcome: "PASS", actionCount: 2, transition: "PROVEN" };
      }
      if (fault === "SEND_UNCERTAIN") {
        return { outcome: "UNCERTAIN", actionCount: 1, transition: "UNCERTAIN" };
      }
      return { outcome: "PASS", actionCount: 1, transition: "PROVEN" };
    },
    async observeGeneration(): Promise<AuthProbeStepResult> {
      record("observeGeneration");
      return result("PASS");
    },
    async observeAssociatedResponse(): Promise<
      AuthProbeStepResult & { readonly assistantMessageCountDelta: number }
    > {
      record("observeAssociatedResponse");
      return {
        ...result(
          fault === "RESPONSE_ASSOCIATION_FAILURE" ? "FAIL" : "PASS",
          fault === "RESPONSE_ASSOCIATION_FAILURE"
            ? "RESPONSE_ASSOCIATION_FAILED"
            : undefined,
        ),
        assistantMessageCountDelta:
          fault === "RESPONSE_ASSOCIATION_FAILURE" ? 0 : 1,
      };
    },
    async observeCompletion(): Promise<AuthProbeStepResult> {
      record("observeCompletion");
      return result(
        fault === "COMPLETION_TIMEOUT" ? "FAIL" : "PASS",
        fault === "COMPLETION_TIMEOUT" ? "COMPLETION_TIMEOUT" : undefined,
      );
    },
    async validateSurfaces(): Promise<AuthSurfaceObservation> {
      record("validateSurfaces");
      return {
        outcome: "PASS",
        codeBlockPresent: fault !== "MISSING_CODE_SURFACE",
        nativeCopyPresent: fault !== "MISSING_COPY_SURFACE",
        deliveryTarget:
          fault === "MISSING_DELIVERY_TARGET" ? "FAILED" : "PROVEN",
      };
    },
    async cleanup(): Promise<void> {
      record("cleanup");
      cleanupCalls += 1;
    },
  };
  // Reference the authority in the fixture construction so a fixture cannot
  // accidentally become a provider-neutral selector implementation.
  void authority.strategy.strategyId;
  return Object.freeze({
    adapter,
    trace: () => Object.freeze({ calls: [...calls], sendCalls, cleanupCalls }),
  });
}
