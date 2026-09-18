import { z } from "zod";
import {
  NoSessionPageSnapshotSchema,
  type NoSessionAuthState,
  type NoSessionContourState,
  type NoSessionElementMetadata,
  type NoSessionObservationResult,
  type NoSessionPageSnapshot,
} from "./no-session-contracts.js";
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
  ): NoSessionObservationResult;
}

const PROFILES: readonly NoSessionSelectorProfile[] = [
  {
    profileId: "chatgpt-standard-public-v1",
    identitySelectors: [
      '[data-testid="login-button"]',
      '[data-testid="signup-button"]',
      "#prompt-textarea",
    ],
    surfaceSelectors: ["main", '[data-testid="conversation-turn"]'],
    composerSelectors: ["#prompt-textarea", '[contenteditable="true"]'],
    inputSelectors: [
      "#prompt-textarea",
      "textarea",
      '[contenteditable="true"]',
    ],
    sendSelectors: [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
    ],
    authSelectors: [
      '[data-testid="login-button"]',
      '[data-testid="signup-button"]',
    ],
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
    authSelectors: [
      '[data-testid="login-button"]',
      '[data-testid="signup-button"]',
    ],
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
  },
  {
    profileId: "alice-public-v1",
    identitySelectors: [
      '[data-testid="alice-ai"]',
      '[data-testid="alice-chat"]',
      '[aria-label*="Алиса"]',
    ],
    surfaceSelectors: [
      '[data-testid="alice-chat"]',
      '[data-testid="alice-composer"]',
    ],
    composerSelectors: [
      '[data-testid="alice-composer"]',
      '[contenteditable="true"][data-alice]',
    ],
    inputSelectors: [
      "textarea[data-alice]",
      '[contenteditable="true"][data-alice]',
    ],
    sendSelectors: [
      '[data-testid="alice-send"]',
      'button[aria-label*="Отправить"]',
    ],
    authSelectors: [
      '[data-testid="yandex-login"]',
      'a[href*="passport.yandex"]',
    ],
    loginSelectors: [
      '[data-testid="yandex-login"]',
      'a[href*="passport.yandex"]',
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
    authSelectors: ['[data-testid="deepseek-login"]', 'a[href*="/sign_in"]'],
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
  },
  {
    profileId: "grok-public-v1",
    identitySelectors: [
      '[data-testid="grok-logo"]',
      '[data-testid="grok-home"]',
      "[data-grok-surface]",
    ],
    surfaceSelectors: [
      '[data-testid="grok-home"]',
      '[data-testid="grok-composer"]',
    ],
    composerSelectors: [
      '[data-testid="grok-composer"]',
      '[contenteditable="true"][data-grok]',
    ],
    inputSelectors: [
      "textarea[data-grok]",
      '[contenteditable="true"][data-grok]',
    ],
    sendSelectors: ['[data-testid="grok-send"]', 'button[aria-label*="Send"]'],
    authSelectors: ['[data-testid="grok-login"]', 'a[href*="/login"]'],
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
  },
  {
    profileId: "claude-public-v1",
    identitySelectors: [
      '[data-testid="claude-logo"]',
      '[data-testid="claude-home"]',
      "[data-claude-surface]",
    ],
    surfaceSelectors: [
      '[data-testid="claude-home"]',
      '[data-testid="auth-panel"]',
    ],
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
    authSelectors: ['[data-testid="claude-login"]', 'a[href*="/login"]'],
    loginSelectors: ['[data-testid="claude-login"]', 'a[href*="/login"]'],
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
  },
  {
    profileId: "gemini-public-v1",
    identitySelectors: [
      '[data-testid="gemini-logo"]',
      '[data-test-id="bard-chat"]',
      "[data-gemini-surface]",
    ],
    surfaceSelectors: [
      '[data-testid="bard-chat"]',
      '[data-testid="gemini-composer"]',
    ],
    composerSelectors: [
      '[data-testid="gemini-composer"]',
      '[contenteditable="true"][data-gemini]',
    ],
    inputSelectors: [
      "textarea[data-gemini]",
      '[contenteditable="true"][data-gemini]',
    ],
    sendSelectors: [
      '[data-testid="gemini-send"]',
      'button[aria-label*="Submit"]',
    ],
    authSelectors: [
      '[data-testid="google-sign-in"]',
      'a[href*="accounts.google.com"]',
    ],
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
  },
  {
    profileId: "qwen-public-v1",
    identitySelectors: [
      '[data-testid="qwen-logo"]',
      '[data-testid="qwen-studio"]',
      "[data-qwen-surface]",
    ],
    surfaceSelectors: [
      '[data-testid="qwen-studio"]',
      '[data-testid="qwen-composer"]',
    ],
    composerSelectors: [
      '[data-testid="qwen-composer"]',
      '[contenteditable="true"][data-qwen]',
    ],
    inputSelectors: [
      "textarea[data-qwen]",
      '[contenteditable="true"][data-qwen]',
    ],
    sendSelectors: ['[data-testid="qwen-send"]', 'button[aria-label*="Send"]'],
    authSelectors: ['[data-testid="qwen-login"]', 'a[href*="/auth"]'],
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
  },
  {
    profileId: "kimi-public-v1",
    identitySelectors: [
      '[data-testid="kimi-logo"]',
      '[data-testid="kimi-home"]',
      "[data-kimi-surface]",
    ],
    surfaceSelectors: [
      '[data-testid="kimi-home"]',
      '[data-testid="kimi-composer"]',
    ],
    composerSelectors: [
      '[data-testid="kimi-composer"]',
      '[contenteditable="true"][data-kimi]',
    ],
    inputSelectors: [
      "textarea[data-kimi]",
      '[contenteditable="true"][data-kimi]',
    ],
    sendSelectors: ['[data-testid="kimi-send"]', 'button[aria-label*="Send"]'],
    authSelectors: ['[data-testid="kimi-login"]', 'a[href*="/login"]'],
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
  expected: boolean,
  identityProven: boolean,
  authWall: boolean,
): NoSessionContourState {
  if (!expected) return "NOT_EXPECTED";
  if (!identityProven || authWall) return "NOT_PROVABLE";
  return metadata.elementCount > 0 && metadata.visible ? "OBSERVED" : "ABSENT";
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
): NoSessionObservationResult {
  const expectedOriginValid = target.allowedTopLevelOrigins.includes(
    snapshot.finalOrigin,
  );
  const profileMatches = snapshot.profileId === strategy.profile.profileId;
  const identityProven =
    expectedOriginValid && profileMatches && snapshot.identityMarkerCount > 0;
  const identity: NoSessionObservationResult["identity"] = expectedOriginValid
    ? identityProven
      ? "PROVEN"
      : "NOT_PROVEN"
    : "MISMATCH";
  const authWall = snapshot.authWallObserved || snapshot.loginWallObserved;
  const authentication = authenticationState(target, snapshot, identityProven);
  const publicSurface = !expectedOriginValid
    ? "NOT_PROVABLE"
    : snapshot.surfaceMarkerCount > 0
      ? "REACHABLE"
      : "NOT_PROVABLE";
  const composer = contourState(
    snapshot.composer,
    target.publicComposerExpected,
    identityProven,
    authWall,
  );
  const editableInput = contourState(
    snapshot.editableInput,
    target.publicComposerExpected,
    identityProven,
    authWall,
  );
  const sendControl = contourState(
    snapshot.sendControl,
    target.sendControlExpected,
    identityProven,
    authWall,
  );

  let blocker: NoSessionObservationResult["blocker"] = "NONE";
  let classification: NoSessionObservationResult["classification"] = "HEALTHY";
  let classificationBasis: NoSessionObservationResult["classificationBasis"] =
    "PUBLIC_SURFACE_PRIMARY";
  if (!expectedOriginValid) {
    blocker = "ORIGIN_POLICY_VIOLATION";
    classification = "UNKNOWN";
    classificationBasis = "ORIGIN_POLICY_FAILURE";
  } else if (snapshot.maintenanceObserved) {
    blocker = "MAINTENANCE";
    classification = "MAINTENANCE";
    classificationBasis = "MAINTENANCE_SURFACE";
  } else if (snapshot.captchaObserved) {
    blocker = "CAPTCHA_SECURITY_CHECKPOINT";
    classification = "UNKNOWN";
    classificationBasis = "SECURITY_CHECKPOINT";
  } else if (snapshot.securityCheckpointObserved) {
    blocker = "SECURITY_CHECKPOINT";
    classification = "UNKNOWN";
    classificationBasis = "SECURITY_CHECKPOINT";
  } else if (snapshot.accessBlockedObserved) {
    blocker = "ACCESS_BLOCKED";
    classification = "UNKNOWN";
    classificationBasis = "ACCESS_BLOCKED";
  } else if (!identityProven) {
    blocker = "UNEXPECTED_SURFACE";
    classification = "UNKNOWN";
    classificationBasis = "IDENTITY_NOT_PROVEN";
  } else if (authWall) {
    classification = "UNKNOWN";
    classificationBasis = "AUTH_REQUIRED_BOUNDARY";
  } else if (
    (target.publicComposerExpected && composer === "ABSENT") ||
    (target.publicComposerExpected && editableInput === "ABSENT") ||
    (target.sendControlExpected && sendControl === "ABSENT")
  ) {
    classification = "DRIFT";
    classificationBasis = "REQUIRED_CONTOUR_MISSING";
  } else if (publicSurface !== "REACHABLE") {
    classification = "UNKNOWN";
    classificationBasis = "UNEXPECTED_SURFACE";
  }

  return {
    providerId: target.providerId,
    surfaceId: target.surfaceId,
    targetKey: target.targetKey,
    strategyId: target.strategyId,
    strategyRevision: target.strategyRevision,
    browserRuntime,
    navigation: "LOADED",
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
    evaluate: (candidateTarget, snapshot, browserRuntime, observedAt) =>
      commonEvaluate(
        candidateTarget,
        NoSessionPageSnapshotSchema.parse(snapshot),
        strategy,
        browserRuntime,
        observedAt,
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
