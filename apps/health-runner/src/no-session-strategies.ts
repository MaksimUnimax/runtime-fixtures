import { z } from "zod";
import {
  NoSessionBrowserModeMetadataSchema,
  NoSessionPageSnapshotSchema,
  type NoSessionAuthState,
  type NoSessionContourState,
  type NoSessionElementMetadata,
  type NoSessionObservationResult,
  type NoSessionPageSnapshot,
} from "./no-session-contracts.js";
import type { NoSessionNavigationResult } from "./no-session-browser-driver.js";
import {
  type NoSessionTarget,
  NO_SESSION_TARGETS,
} from "./no-session-target-authority.js";

export const NoSessionSelectorProfileSchema = z
  .object({
    profileId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    identitySelectors: z.array(z.string().min(1).max(256)).min(1).max(8),
    surfaceSelectors: z.array(z.string().min(1).max(256)).min(1).max(8),
    composerSelectors: z.array(z.string().min(1).max(256)).max(8),
    inputSelectors: z.array(z.string().min(1).max(256)).max(8),
    sendSelectors: z.array(z.string().min(1).max(256)).max(8),
    authSelectors: z.array(z.string().min(1).max(256)).max(8),
    loginSelectors: z.array(z.string().min(1).max(256)).max(8),
    securitySelectors: z.array(z.string().min(1).max(256)).max(8),
    captchaSelectors: z.array(z.string().min(1).max(256)).max(8),
    blockedSelectors: z.array(z.string().min(1).max(256)).max(8),
    maintenanceSelectors: z.array(z.string().min(1).max(256)).max(8),
    unsupportedSelectors: z.array(z.string().min(1).max(256)).max(8),
    hydrationSelectors: z.array(z.string().min(1).max(256)).max(8),
    providerTitleTokens: z.array(z.string().min(1).max(64)).max(4),
    securityTitleTokens: z.array(z.string().min(1).max(64)).max(4),
    blockedTitleTokens: z.array(z.string().min(1).max(64)).max(4),
    unsupportedTitleTokens: z.array(z.string().min(1).max(64)).max(4),
  })
  .strict();
export type NoSessionSelectorProfile = Readonly<
  z.infer<typeof NoSessionSelectorProfileSchema>
>;

export interface NoSessionProviderStrategy {
  readonly providerId: NoSessionTarget["providerId"];
  readonly surfaceId: NoSessionTarget["surfaceId"];
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly profile: NoSessionSelectorProfile;
  evaluate(
    target: NoSessionTarget,
    snapshot: NoSessionPageSnapshot,
    browserRuntime: NoSessionObservationResult["browserRuntime"],
    observedAt: string,
    navigation?: NoSessionNavigationResult,
  ): NoSessionObservationResult;
}

const PROFILES: readonly NoSessionSelectorProfile[] = [
  {
    profileId: "chatgpt-standard-public-v1",
    identitySelectors: [
      '[aria-label="ChatGPT logo"]',
      'main[aria-label="ChatGPT"]',
      '[data-testid="login-button"]',
      '[data-testid="signup-button"]',
      "#prompt-textarea",
    ],
    surfaceSelectors: ["main", '[data-testid="conversation-turn"]'],
    composerSelectors: [
      'textarea[aria-label="Chat with ChatGPT"]',
      "#prompt-textarea",
      '[contenteditable="true"]',
    ],
    inputSelectors: [
      'textarea[aria-label="Chat with ChatGPT"]',
      "#prompt-textarea",
      "textarea",
      '[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]',
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
    ],
    authSelectors: [],
    loginSelectors: [
      '[aria-label="Log in or sign up"]',
      '[data-testid="login-button"]',
      'a[href*="/auth/login"]',
    ],
    securitySelectors: [
      '[data-testid="cf-challenge"]',
      '[data-testid="security-check"]',
    ],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="access-denied"]',
      '[data-testid="blocked"]',
    ],
    maintenanceSelectors: [
      '[data-testid="maintenance"]',
      '[data-testid="status-page"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      "main",
      "#prompt-textarea",
      '[contenteditable="true"]',
    ],
    providerTitleTokens: ["chatgpt", "openai"],
    securityTitleTokens: ["just a moment", "checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "chatgpt-work-public-v1",
    identitySelectors: [
      '[data-testid="workspace-switcher"]',
      '[data-testid="team-workspace"]',
      "[data-workspace-id]",
    ],
    surfaceSelectors: [
      "main[data-workspace]",
      '[data-testid="workspace-chat"]',
    ],
    composerSelectors: [
      "#prompt-textarea",
      '[contenteditable="true"][data-workspace]',
    ],
    inputSelectors: [
      "#prompt-textarea",
      '[contenteditable="true"][data-workspace]',
    ],
    sendSelectors: [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
    ],
    authSelectors: [],
    loginSelectors: ['[data-testid="login-button"]', 'a[href*="/auth/login"]'],
    securitySelectors: [
      '[data-testid="cf-challenge"]',
      '[data-testid="security-check"]',
    ],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="access-denied"]',
      '[data-testid="blocked"]',
    ],
    maintenanceSelectors: [
      '[data-testid="maintenance"]',
      '[data-testid="status-page"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      "main[data-workspace]",
      '[data-testid="workspace-chat"]',
    ],
    providerTitleTokens: ["chatgpt", "openai"],
    securityTitleTokens: ["just a moment", "checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "alice-public-v1",
    identitySelectors: [
      '[aria-label="Алиса AI"]',
      '[data-testid="alice-chat"]',
      '[data-testid="main-page"]',
    ],
    surfaceSelectors: [
      '[data-testid="alice-chat"]',
      '[data-testid="alice-composer"]',
    ],
    composerSelectors: [
      '[data-testid="standalone-input"]',
      '[data-testid="standalone-input-field"]',
    ],
    inputSelectors: ['[data-testid="inputbase-textarea"]', "textarea"],
    sendSelectors: [
      '[data-testid="input-controls-root"]',
      '[data-testid="alice-send"]',
    ],
    authSelectors: [],
    loginSelectors: [
      '[data-testid="chat-list-login-button"]',
      'button[aria-label="Яндекс ID"]',
    ],
    securitySelectors: ['[data-testid="yandex-checkpoint"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="access-denied"]',
      '[data-testid="alice-blocked"]',
    ],
    maintenanceSelectors: [
      '[data-testid="maintenance"]',
      '[data-testid="alice-maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      '[data-testid="alice-chat"]',
      '[data-testid="main-page"]',
      '[data-testid="standalone-input"]',
    ],
    providerTitleTokens: ["алиса", "alice", "яндекс"],
    securityTitleTokens: ["проверка"],
    blockedTitleTokens: ["доступ запрещен", "access denied"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "deepseek-public-v1",
    identitySelectors: [
      '[data-testid="deepseek-logo"]',
      '[data-testid="deepseek-chat"]',
      '[class*="deepseek"]',
    ],
    surfaceSelectors: [
      '[data-testid="deepseek-chat"]',
      '[data-testid="auth-panel"]',
    ],
    composerSelectors: [
      '[data-testid="deepseek-composer"]',
      "textarea[data-deepseek]",
    ],
    inputSelectors: [
      "textarea[data-deepseek]",
      '[contenteditable="true"][data-deepseek]',
    ],
    sendSelectors: [
      '[data-testid="deepseek-send"]',
      'button[aria-label*="Send"]',
    ],
    authSelectors: [],
    loginSelectors: ['[data-testid="deepseek-login"]', 'a[href*="/sign_in"]'],
    securitySelectors: ['[data-testid="deepseek-security-check"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="deepseek-blocked"]',
      '[data-testid="access-denied"]',
    ],
    maintenanceSelectors: [
      '[data-testid="deepseek-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      '[data-testid="deepseek-chat"]',
      '[data-testid="auth-panel"]',
    ],
    providerTitleTokens: ["deepseek"],
    securityTitleTokens: ["security check", "checking your browser"],
    blockedTitleTokens: ["error", "access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "grok-public-v1",
    identitySelectors: [
      '[aria-label="Home page"]',
      '[data-testid="drop-container"]',
      '[data-testid="chat-submit"]',
    ],
    surfaceSelectors: [
      '[data-testid="drop-container"]',
      '[aria-label="Conversation attachments"]',
    ],
    composerSelectors: [
      'textarea[aria-label="Ask Grok anything"]',
      '[data-testid="drop-container"] textarea',
    ],
    inputSelectors: [
      'textarea[aria-label="Ask Grok anything"]',
      '[data-testid="drop-container"] textarea',
    ],
    sendSelectors: [
      '[data-testid="chat-submit"]',
      'button[aria-label="Submit"]',
    ],
    authSelectors: [],
    loginSelectors: ['[data-testid="grok-login"]', 'a[href*="/login"]'],
    securitySelectors: ['[data-testid="grok-security-check"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="grok-blocked"]',
      '[data-testid="access-denied"]',
    ],
    maintenanceSelectors: [
      '[data-testid="grok-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      '[data-testid="drop-container"]',
      'textarea[aria-label="Ask Grok anything"]',
    ],
    providerTitleTokens: ["grok", "xai"],
    securityTitleTokens: ["just a moment", "checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "claude-public-v1",
    identitySelectors: [
      'a[href*="claude.ai"]',
      'a[href*="/login"]',
      '[data-testid="claude-login"]',
      '[data-testid="login"]',
      '[data-testid="sign-in"]',
      '[data-testid="claude-logo"]',
    ],
    surfaceSelectors: ['a[href*="claude.ai"]', '[data-testid="auth-panel"]'],
    composerSelectors: [
      '[data-testid="claude-composer"]',
      '[contenteditable="true"][data-claude]',
    ],
    inputSelectors: [
      "textarea[data-claude]",
      '[contenteditable="true"][data-claude]',
    ],
    sendSelectors: [
      '[data-testid="claude-send"]',
      'button[aria-label*="Send"]',
    ],
    authSelectors: [],
    loginSelectors: [
      '[data-testid="claude-login"]',
      '[data-testid="login"]',
      '[data-testid="sign-in"]',
      'a[href*="/login"]',
      'button[aria-label*="Sign in"]',
    ],
    securitySelectors: ['[data-testid="claude-security-check"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="claude-blocked"]',
      '[data-testid="access-denied"]',
    ],
    maintenanceSelectors: [
      '[data-testid="claude-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: ['a[href*="claude.ai"]', '[data-testid="auth-panel"]'],
    providerTitleTokens: ["claude", "anthropic"],
    securityTitleTokens: ["just a moment", "checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "gemini-public-v1",
    identitySelectors: [
      '[data-test-id="chat-app"]',
      '[data-test-id="mavatar-sign-in-button"]',
      '[data-test-id="bard-chat"]',
    ],
    surfaceSelectors: [
      '[data-test-id="chat-app"]',
      '[data-test-id="textarea-inner"]',
    ],
    composerSelectors: [
      '[role="textbox"][aria-label="Enter a prompt for Gemini"]',
      '[data-test-id="textarea-inner"]',
    ],
    inputSelectors: [
      '[role="textbox"][aria-label="Enter a prompt for Gemini"]',
      '[data-test-id="textarea-inner"] [contenteditable="true"]',
    ],
    sendSelectors: [
      '[data-testid="gemini-send"]',
      'button[aria-label*="Submit"]',
    ],
    authSelectors: [],
    loginSelectors: [
      '[data-testid="google-sign-in"]',
      'a[href*="accounts.google.com"]',
    ],
    securitySelectors: ['[data-testid="google-security-check"]'],
    captchaSelectors: ['iframe[src*="recaptcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="access-denied"]',
      '[data-testid="gemini-blocked"]',
    ],
    maintenanceSelectors: [
      '[data-testid="gemini-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      '[data-test-id="chat-app"]',
      '[data-test-id="textarea-inner"]',
      '[data-test-id="mavatar-sign-in-button"]',
    ],
    providerTitleTokens: ["gemini", "bard", "google"],
    securityTitleTokens: ["checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
  {
    profileId: "qwen-public-v1",
    identitySelectors: [
      '[aria-label="New Chat"]',
      '[aria-label="Select Model"]',
      '[aria-label="Qwen Studio"]',
      '[data-testid="qwen-studio"]',
    ],
    surfaceSelectors: ["main", "textarea"],
    composerSelectors: ["textarea", '[role="textbox"]'],
    inputSelectors: ["textarea", '[role="textbox"]'],
    sendSelectors: ['button[aria-label="Send"]', 'svg[aria-label="Send"]'],
    authSelectors: [],
    loginSelectors: ['[data-testid="qwen-login"]', 'a[href*="/auth"]'],
    securitySelectors: ['[data-testid="qwen-security-check"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="qwen-blocked"]',
      '[data-testid="access-denied"]',
    ],
    maintenanceSelectors: [
      '[data-testid="qwen-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [
      '[data-testid="unsupported-system"]',
      '[data-testid="system-not-supported"]',
      '[aria-label="System not supported"]',
    ],
    hydrationSelectors: ["main", '[aria-label="New Chat"]', "textarea"],
    providerTitleTokens: ["qwen", "通义"],
    securityTitleTokens: ["checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [
      "current system does not support",
      "system does not support",
      "not supported",
    ],
  },
  {
    profileId: "kimi-public-v1",
    identitySelectors: [
      '[data-testid="sidebar-new-chat"]',
      '[data-testid="chat-editor"]',
      '[aria-label="新建会话"]',
    ],
    surfaceSelectors: [
      '[data-testid="chat-editor"]',
      '[data-testid="sidebar-new-chat"]',
    ],
    composerSelectors: ['[data-testid="chat-editor"]', '[role="textbox"]'],
    inputSelectors: [
      '[role="textbox"]',
      '[data-testid="chat-editor"] [contenteditable="true"]',
    ],
    sendSelectors: [],
    authSelectors: [],
    loginSelectors: ['[data-testid="kimi-login"]', 'a[href*="/login"]'],
    securitySelectors: ['[data-testid="kimi-security-check"]'],
    captchaSelectors: ['iframe[src*="captcha"]', '[data-testid="captcha"]'],
    blockedSelectors: [
      '[data-testid="kimi-blocked"]',
      '[data-testid="access-denied"]',
    ],
    maintenanceSelectors: [
      '[data-testid="kimi-maintenance"]',
      '[data-testid="maintenance"]',
    ],
    unsupportedSelectors: [],
    hydrationSelectors: [
      '[data-testid="chat-editor"]',
      '[data-testid="sidebar-new-chat"]',
      '[role="textbox"]',
    ],
    providerTitleTokens: ["kimi", "moonshot"],
    securityTitleTokens: ["just a moment", "checking your browser"],
    blockedTitleTokens: ["access denied", "forbidden"],
    unsupportedTitleTokens: [],
  },
].map((profile) =>
  Object.freeze(NoSessionSelectorProfileSchema.parse(profile)),
);

function profileFor(target: NoSessionTarget): NoSessionSelectorProfile {
  const profile = PROFILES.find(
    (candidate) => candidate.profileId === target.strategyId,
  );
  if (!profile) throw new Error("NO_SESSION_STRATEGY_PROFILE_NOT_REGISTERED");
  return profile;
}

function emptyElementMetadata(): NoSessionElementMetadata {
  return {
    elementCount: 0,
    visible: false,
    editable: false,
    actionable: false,
  };
}

function contourState(
  metadata: NoSessionElementMetadata,
  expectation: NoSessionTarget["capabilityExpectation"]["publicComposer"],
  identityProven: boolean,
  authWall: boolean,
): NoSessionContourState {
  if (expectation === "NOT_EXPECTED") return "NOT_EXPECTED";
  if (expectation === "NOT_OBSERVABLE_WITHOUT_SESSION") return "NOT_PROVABLE";
  if (!identityProven || authWall) return "NOT_PROVABLE";
  if (metadata.elementCount > 0 && metadata.visible) return "OBSERVED";
  return expectation === "OPTIONAL_OR_REGION_DEPENDENT"
    ? "NOT_EXPECTED"
    : "ABSENT";
}

function authenticationState(
  target: NoSessionTarget,
  snapshot: NoSessionPageSnapshot,
  identityProven: boolean,
): NoSessionAuthState {
  if (snapshot.loginWallObserved) return "LOGIN_REQUIRED";
  if (snapshot.authWallObserved) return "AUTH_REQUIRED";
  if (!identityProven) return "NOT_PROVABLE";
  return "NOT_REQUIRED";
}

function commonEvaluate(
  target: NoSessionTarget,
  snapshot: NoSessionPageSnapshot,
  strategy: NoSessionProviderStrategy,
  browserRuntime: NoSessionObservationResult["browserRuntime"],
  observedAt: string,
  navigation: NoSessionNavigationResult,
): NoSessionObservationResult {
  const expectedOriginValid = target.allowedTopLevelOrigins.includes(
    snapshot.finalOrigin,
  );
  const profileMatches = snapshot.profileId === strategy.profile.profileId;
  const identityProven =
    expectedOriginValid &&
    profileMatches &&
    (snapshot.identityMarkerCount > 0 ||
      ((target.surfaceId === "QWEN" || target.surfaceId === "CLAUDE") &&
        snapshot.providerTitleObserved));
  const identity: NoSessionObservationResult["identity"] = expectedOriginValid
    ? identityProven
      ? "PROVEN"
      : "NOT_PROVEN"
    : "MISMATCH";
  const authWall = snapshot.authWallObserved;
  const authentication = authenticationState(target, snapshot, identityProven);
  const publicSurface = !expectedOriginValid
    ? "NOT_PROVABLE"
    : snapshot.surfaceMarkerCount > 0
      ? "REACHABLE"
      : "NOT_PROVABLE";
  const composer = contourState(
    snapshot.composer,
    target.capabilityExpectation.publicComposer,
    identityProven,
    authWall,
  );
  const editableInput = contourState(
    snapshot.editableInput,
    target.capabilityExpectation.editableInput,
    identityProven,
    authWall,
  );
  const sendControl = contourState(
    snapshot.sendControl,
    target.capabilityExpectation.sendControl,
    identityProven,
    authWall,
  );

  let blocker: NoSessionObservationResult["blocker"] = "NONE";
  let classification: NoSessionObservationResult["classification"] = "HEALTHY";
  let classificationBasis: NoSessionObservationResult["classificationBasis"] =
    "PUBLIC_SURFACE_PRIMARY";
  let surfaceOutcome: NoSessionObservationResult["surfaceOutcome"] =
    "PUBLIC_INTERACTIVE";
  const normalClaudeLoginSurface =
    target.surfaceId === "CLAUDE" &&
    identityProven &&
    snapshot.loginWallObserved &&
    (() => {
      try {
        return new URL(navigation.finalUrl).pathname.startsWith("/login");
      } catch {
        return false;
      }
    })();
  if (
    navigation.mainDocumentHttpStatus !== null &&
    navigation.mainDocumentHttpStatus >= 500
  ) {
    blocker = "NETWORK_FAILURE";
    classification = "UNKNOWN";
    classificationBasis = "NETWORK_FAILURE";
    surfaceOutcome = "NETWORK_FAILURE";
  } else if (!expectedOriginValid) {
    blocker = "ORIGIN_POLICY_VIOLATION";
    classification = "UNKNOWN";
    classificationBasis = "ORIGIN_POLICY_FAILURE";
    surfaceOutcome = "IDENTITY_NOT_PROVEN";
  } else if (snapshot.maintenanceObserved) {
    blocker = "MAINTENANCE";
    classification = "MAINTENANCE";
    classificationBasis = "MAINTENANCE_SURFACE";
    surfaceOutcome = "MAINTENANCE";
  } else if (normalClaudeLoginSurface) {
    classification = "HEALTHY";
    classificationBasis = "PUBLIC_SURFACE_PRIMARY";
    surfaceOutcome = "AUTH_REQUIRED";
  } else if (
    snapshot.unsupportedEnvironmentObserved ||
    snapshot.unsupportedTitleObserved
  ) {
    blocker = "UNSUPPORTED_ENVIRONMENT";
    classification = "UNKNOWN";
    classificationBasis = "ENVIRONMENT_SUPPORT_BOUNDARY";
    surfaceOutcome = "UNSUPPORTED_ENVIRONMENT";
  } else if (snapshot.captchaObserved) {
    blocker = "CAPTCHA_SECURITY_CHECKPOINT";
    classification = "UNKNOWN";
    classificationBasis = "SECURITY_CHECKPOINT";
    surfaceOutcome = "SECURITY_CHECKPOINT";
  } else if (snapshot.securityCheckpointObserved) {
    blocker = "SECURITY_CHECKPOINT";
    classification = "UNKNOWN";
    classificationBasis = "SECURITY_CHECKPOINT";
    surfaceOutcome = "SECURITY_CHECKPOINT";
  } else if (snapshot.securityTitleObserved) {
    blocker = "SECURITY_CHECKPOINT";
    classification = "UNKNOWN";
    classificationBasis = "SECURITY_CHECKPOINT";
    surfaceOutcome = "SECURITY_CHECKPOINT";
  } else if (snapshot.accessBlockedObserved) {
    blocker = "ACCESS_BLOCKED";
    classification = "UNKNOWN";
    classificationBasis = "ACCESS_BLOCKED";
    surfaceOutcome = "ACCESS_BLOCKED";
  } else if (snapshot.blockedTitleObserved) {
    blocker = "ACCESS_BLOCKED";
    classification = "UNKNOWN";
    classificationBasis = "ACCESS_BLOCKED";
    surfaceOutcome = "ACCESS_BLOCKED";
  } else if (
    navigation.mainDocumentHttpStatus !== null &&
    navigation.mainDocumentHttpStatus >= 400
  ) {
    blocker = "ACCESS_BLOCKED";
    classification = "UNKNOWN";
    classificationBasis = "ACCESS_BLOCKED";
    surfaceOutcome = "ACCESS_BLOCKED";
  } else if (!identityProven) {
    if (target.surfaceId === "CHATGPT_WORK") {
      classification = "UNKNOWN";
      classificationBasis = "NOT_OBSERVABLE_WITHOUT_SESSION";
      surfaceOutcome = "NOT_OBSERVABLE_WITHOUT_SESSION";
    } else {
      blocker = "UNEXPECTED_SURFACE";
      classification = "UNKNOWN";
      classificationBasis = "IDENTITY_NOT_PROVEN";
      surfaceOutcome = "IDENTITY_NOT_PROVEN";
    }
  } else if (authWall) {
    classification = "UNKNOWN";
    classificationBasis = "AUTH_REQUIRED_BOUNDARY";
    surfaceOutcome = "AUTH_REQUIRED";
  } else if (
    snapshot.loginWallObserved &&
    composer !== "OBSERVED" &&
    editableInput !== "OBSERVED"
  ) {
    classification = "UNKNOWN";
    classificationBasis = "AUTH_REQUIRED_BOUNDARY";
    surfaceOutcome = "AUTH_REQUIRED";
  } else if (
    (target.capabilityExpectation.publicComposer === "EXPECTED" &&
      composer === "ABSENT") ||
    (target.capabilityExpectation.editableInput === "EXPECTED" &&
      editableInput === "ABSENT") ||
    (target.capabilityExpectation.sendControl === "EXPECTED" &&
      sendControl === "ABSENT")
  ) {
    classification = "DRIFT";
    classificationBasis = "REQUIRED_CONTOUR_MISSING";
    surfaceOutcome = "DRIFT";
  } else if (publicSurface !== "REACHABLE") {
    classification = "UNKNOWN";
    classificationBasis =
      target.capabilityExpectation.publicLanding ===
      "OPTIONAL_OR_REGION_DEPENDENT"
        ? "REGION_OR_ELIGIBILITY_BOUNDARY"
        : "UNEXPECTED_SURFACE";
    surfaceOutcome =
      classificationBasis === "REGION_OR_ELIGIBILITY_BOUNDARY"
        ? "REGION_OR_ELIGIBILITY_RESTRICTED"
        : "IDENTITY_NOT_PROVEN";
  } else if (
    composer === "OBSERVED" ||
    editableInput === "OBSERVED" ||
    sendControl === "OBSERVED"
  ) {
    surfaceOutcome = "PUBLIC_INTERACTIVE";
  } else {
    surfaceOutcome = "PUBLIC_LANDING";
  }

  const mode = browserRuntime.headless
    ? ("HEADLESS_DIAGNOSTIC" as const)
    : ("HEADED" as const);
  return {
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId: target.strategyId,
    strategyRevision: target.strategyRevision,
    browserRuntime,
    browserMode: NoSessionBrowserModeMetadataSchema.parse({
      canonicalMode: mode,
      authoritativeMode: mode,
      diagnosticMode: null,
      fallbackAttempted: false,
      fallbackReason: "NOT_REQUIRED",
      headedInfrastructure: browserRuntime.headless
        ? "NOT_CHECKED"
        : "AVAILABLE",
      environmentLimited: browserRuntime.headless,
      canonicalObservation: {
        mode,
        identity,
        blocker,
        classification,
        surfaceOutcome,
      },
      diagnosticObservation: null,
    }),
    navigation: "LOADED",
    navigationEvidence: {
      requestedStartUrl: navigation.requestedStartUrl,
      finalUrl: navigation.finalUrl,
      finalOrigin: navigation.finalOrigin,
      mainDocumentHttpStatus: navigation.mainDocumentHttpStatus,
      redirectCount: navigation.redirectCount,
      outcome: navigation.outcome,
    },
    finalOrigin: snapshot.finalOrigin,
    expectedOriginValid,
    identity,
    publicSurface,
    composer,
    editableInput,
    sendControl,
    authentication,
    blocker,
    classification,
    classificationBasis,
    surfaceOutcome,
    readiness: snapshot.readiness,
    elementMetadata: {
      composer:
        identityProven && !authWall
          ? snapshot.composer
          : emptyElementMetadata(),
      editableInput:
        identityProven && !authWall
          ? snapshot.editableInput
          : emptyElementMetadata(),
      sendControl:
        identityProven && !authWall
          ? snapshot.sendControl
          : emptyElementMetadata(),
    },
    noInteraction: true,
    observedAt,
    evidence: [],
  };
}

function strategyFor(target: NoSessionTarget): NoSessionProviderStrategy {
  const profile = profileFor(target);
  const strategy: NoSessionProviderStrategy = {
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    strategyId: target.strategyId,
    strategyRevision: target.strategyRevision,
    profile,
    evaluate: (
      candidateTarget,
      snapshot,
      browserRuntime,
      observedAt,
      navigation,
    ) =>
      commonEvaluate(
        candidateTarget,
        NoSessionPageSnapshotSchema.parse(snapshot),
        strategy,
        browserRuntime,
        observedAt,
        navigation ?? {
          requestedStartUrl: candidateTarget.startUrl,
          finalUrl: snapshot.finalOrigin,
          finalOrigin: snapshot.finalOrigin,
          mainDocumentHttpStatus: null,
          redirectCount: 0,
          outcome: "LOADED",
        },
      ),
  };
  return Object.freeze(strategy);
}

export const NO_SESSION_STRATEGIES: readonly NoSessionProviderStrategy[] =
  Object.freeze(NO_SESSION_TARGETS.map(strategyFor));

export function getNoSessionStrategy(
  surfaceId: NoSessionTarget["surfaceId"],
): NoSessionProviderStrategy {
  const strategy = NO_SESSION_STRATEGIES.find(
    (candidate) => candidate.surfaceId === surfaceId,
  );
  if (!strategy) throw new Error("NO_SESSION_STRATEGY_NOT_REGISTERED");
  return strategy;
}

export function assertNoSessionStrategySeparation(): void {
  const profiles = NO_SESSION_STRATEGIES.map(
    (strategy) => strategy.profile.profileId,
  );
  if (new Set(profiles).size !== profiles.length)
    throw new Error("DUPLICATE_NO_SESSION_PROFILE");
  const identities = NO_SESSION_STRATEGIES.map((strategy) =>
    strategy.profile.identitySelectors.join("|"),
  );
  if (new Set(identities).size !== identities.length)
    throw new Error("DUPLICATE_NO_SESSION_IDENTITY_PROFILE");
}
