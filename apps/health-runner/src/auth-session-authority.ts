import { z } from "zod";

/**
 * L5B is an additive authenticated layer.  These identifiers deliberately do
 * not reuse the no-session target vocabulary: public reachability and a
 * dedicated technical account are different authorities.
 */
export const AuthProviderIdSchema = z.enum([
  "CHATGPT",
  "ALICE",
  "DEEPSEEK",
  "GROK",
  "CLAUDE",
  "GEMINI",
  "QWEN",
  "KIMI",
]);
export type AuthProviderId = z.infer<typeof AuthProviderIdSchema>;

export const AuthSurfaceIdSchema = z.enum([
  "CHATGPT_STANDARD",
  "CHATGPT_WORK",
  "ALICE_CHAT",
  "DEEPSEEK_CHAT",
  "GROK_WEB",
  "CLAUDE_WEB",
  "GEMINI_WEB",
  "QWEN_STUDIO",
  "KIMI_WEB",
]);
export type AuthSurfaceId = z.infer<typeof AuthSurfaceIdSchema>;

export const AuthCapabilityStatusSchema = z.enum([
  "FOUNDATION_AVAILABLE",
  "AUTOMATABLE_WITH_PROVISIONED_SESSION",
  "SESSION_NOT_PROVISIONED",
  "AUTH_METHOD_UNRESOLVED",
  "PROVIDER_RESTRICTION_REVIEW_REQUIRED",
  "NOT_APPLICABLE",
]);
export type AuthCapabilityStatus = z.infer<typeof AuthCapabilityStatusSchema>;

export const AuthSessionStateSchema = z.enum([
  "NO_SESSION_CONFIGURED",
  "PREPROVISIONED_DEDICATED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "VERIFICATION_REQUIRED",
  "CAPTCHA_SECURITY_CHECKPOINT",
  "ACCOUNT_BLOCKED",
  "SESSION_ENVIRONMENT_UNAVAILABLE",
]);
export type AuthSessionState = z.infer<typeof AuthSessionStateSchema>;

export const AuthSessionSourceTypeSchema = z.enum([
  "NONE",
  "OUT_OF_REPOSITORY_RUNTIME_HANDLE",
]);
export type AuthSessionSourceType = z.infer<typeof AuthSessionSourceTypeSchema>;

const OpaqueReferenceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const AuthSessionReferenceSchema = z
  .object({
    sourceType: z.literal("OUT_OF_REPOSITORY_RUNTIME_HANDLE"),
    state: z.enum([
      "PREPROVISIONED_DEDICATED",
      "SESSION_EXPIRED",
      "SESSION_INVALID",
      "VERIFICATION_REQUIRED",
      "CAPTCHA_SECURITY_CHECKPOINT",
      "ACCOUNT_BLOCKED",
      "SESSION_ENVIRONMENT_UNAVAILABLE",
    ]),
    referenceId: OpaqueReferenceSchema,
    dedicatedTechnicalAccount: z.literal(true),
    personalAccount: z.literal(false),
  })
  .strict();
export type AuthSessionReference = Readonly<
  z.infer<typeof AuthSessionReferenceSchema>
>;

export const AuthSessionSourceSchema = z.discriminatedUnion("sourceType", [
  z
    .object({
      sourceType: z.literal("NONE"),
      state: z.literal("NO_SESSION_CONFIGURED"),
    })
    .strict(),
  AuthSessionReferenceSchema,
]);
export type AuthSessionSource = Readonly<
  z.infer<typeof AuthSessionSourceSchema>
>;

export const AuthConversationStrategySchema = z.enum([
  "FIXED_DEDICATED_HEALTH_CONVERSATION",
  "CONTROLLED_DISPOSABLE_HEALTH_CONVERSATION",
]);
export type AuthConversationStrategy = z.infer<
  typeof AuthConversationStrategySchema
>;

export const AuthProviderStrategySchema = z
  .object({
    strategyId: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    strategyRevision: z.number().int().positive(),
    sessionIdentitySignals: z.array(z.string().min(1).max(256)).min(1).max(8),
    surfaceIdentitySignals: z.array(z.string().min(1).max(256)).min(1).max(8),
    conversationIdentityRule: z.string().min(1).max(512),
    composerStrategy: z.string().min(1).max(256),
    sendStrategy: z.string().min(1).max(256),
    generationStrategy: z.string().min(1).max(256),
    responseAssociationStrategy: z.string().min(1).max(512),
    completionStrategy: z.string().min(1).max(256),
    checkpointSignals: z.array(z.string().min(1).max(256)).min(1).max(8),
  })
  .strict();
export type AuthProviderStrategy = Readonly<
  z.infer<typeof AuthProviderStrategySchema>
>;

export const AuthDeepProbeCapabilitySchema = z
  .object({
    sendAutomatedSafely: z.boolean(),
    generationBusyObservable: z.boolean(),
    associatedResponseProvable: z.boolean(),
    completionProvable: z.boolean(),
    commandCodeSurfaceMeaningful: z.boolean(),
    nativeCopyMeaningful: z.boolean(),
    deliveryTargetMeaningful: z.boolean(),
  })
  .strict();
export type AuthDeepProbeCapability = Readonly<
  z.infer<typeof AuthDeepProbeCapabilitySchema>
>;

export const AuthSurfaceAuthoritySchema = z
  .object({
    providerId: AuthProviderIdSchema,
    surfaceId: AuthSurfaceIdSchema,
    officialWebStartAuthority: z.string().url().max(2_048),
    expectedAuthenticatedOrigins: z.array(z.string().url().max(256)).min(1).max(4),
    loginMechanism: z.string().min(1).max(512),
    dedicatedTechnicalAccountRequired: z.literal(true),
    sessionSourceType: AuthSessionSourceTypeSchema,
    sessionIsolationRequirement: z.string().min(1).max(512),
    conversationStrategy: AuthConversationStrategySchema,
    fixedHealthConversationRequired: z.boolean(),
    controlledDisposableConversationPermitted: z.boolean(),
    capability: AuthDeepProbeCapabilitySchema,
    logoutSemantics: z.string().min(1).max(512),
    checkpointSemantics: z.string().min(1).max(512),
    accountBlockedSemantics: z.string().min(1).max(512),
    invalidSessionSemantics: z.string().min(1).max(512),
    minimumSafeCleanup: z.string().min(1).max(512),
    evidenceLimitations: z.string().min(1).max(512),
    implementationStatus: AuthCapabilityStatusSchema,
    liveReadiness: z.enum(["READY", "BLOCKED_UNTIL_SESSION", "REVIEW_REQUIRED"]),
    strategy: AuthProviderStrategySchema,
  })
  .strict();
export type AuthSurfaceAuthority = Readonly<
  z.infer<typeof AuthSurfaceAuthoritySchema>
>;

const fixedConversation = {
  conversationStrategy: "FIXED_DEDICATED_HEALTH_CONVERSATION" as const,
  fixedHealthConversationRequired: true,
  controlledDisposableConversationPermitted: false,
};

const notProvisioned = {
  sessionSourceType: "OUT_OF_REPOSITORY_RUNTIME_HANDLE" as const,
  implementationStatus: "SESSION_NOT_PROVISIONED" as const,
  liveReadiness: "BLOCKED_UNTIL_SESSION" as const,
};

const safeSessionBoundary =
  "Dedicated technical account only; opaque runtime handle; no personal browser profile or fallback account.";

const noAutomatedSend = {
  sendAutomatedSafely: false,
  generationBusyObservable: true,
  associatedResponseProvable: true,
  completionProvable: true,
  commandCodeSurfaceMeaningful: true,
  nativeCopyMeaningful: true,
  deliveryTargetMeaningful: true,
};

function authority(
  value: Omit<z.input<typeof AuthSurfaceAuthoritySchema>, "dedicatedTechnicalAccountRequired">,
): AuthSurfaceAuthority {
  return Object.freeze(
    AuthSurfaceAuthoritySchema.parse({
      ...value,
      dedicatedTechnicalAccountRequired: true,
    }),
  );
}

/**
 * Complete R1 authority.  Nine surfaces are intentional: ChatGPT has two
 * independently authenticated surfaces, while the remaining seven providers
 * have one explicit web surface each.
 */
export const AUTH_SURFACE_AUTHORITIES: readonly AuthSurfaceAuthority[] =
  Object.freeze([
    authority({
      providerId: "CHATGPT",
      surfaceId: "CHATGPT_STANDARD",
      officialWebStartAuthority: "https://chatgpt.com/",
      expectedAuthenticatedOrigins: ["https://chatgpt.com"],
      loginMechanism: "OpenAI account: password, Google, Microsoft, Apple, or permitted SSO; account identity must be proven.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: {
        ...noAutomatedSend,
        sendAutomatedSafely: true,
      },
      logoutSemantics: "Login redirect or authenticated identity disappearance invalidates the run.",
      checkpointSemantics: "Verification or CAPTCHA is a security blocker; stop without retrying Send.",
      accountBlockedSemantics: "Account or workspace access denial is an auth blocker, not DOM drift.",
      invalidSessionSemantics: "Expired or invalid OpenAI session maps to SESSION_EXPIRED or SESSION_INVALID.",
      minimumSafeCleanup: "Close the isolated context; do not delete or move the fixed conversation.",
      evidenceLimitations: "No full prompt/response archive; Work identity rules do not apply to Standard.",
      ...notProvisioned,
      implementationStatus: "FOUNDATION_AVAILABLE",
      liveReadiness: "BLOCKED_UNTIL_SESSION",
      strategy: {
        strategyId: "CHATGPT_STANDARD_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["OPENAI_AUTHENTICATED_ACCOUNT", "CHATGPT_PROFILE_IDENTITY"],
        surfaceIdentitySignals: ["CHATGPT_STANDARD_SURFACE", "NO_POSITIVE_WORKSPACE_MARKER"],
        conversationIdentityRule: "Dedicated fixed route plus exact conversation identity; arbitrary user chats are forbidden.",
        composerStrategy: "Standard composer profile and editable input ownership.",
        sendStrategy: "Single semantic Send control; no retry primitive.",
        generationStrategy: "Standard busy/stop transition.",
        responseAssociationStrategy: "Assistant-message count and message-id delta associated with the one send.",
        completionStrategy: "Busy-to-idle transition with associated assistant message present.",
        checkpointSignals: ["LOGIN_REDIRECT", "VERIFICATION_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "CHATGPT",
      surfaceId: "CHATGPT_WORK",
      officialWebStartAuthority: "https://chatgpt.com/",
      expectedAuthenticatedOrigins: ["https://chatgpt.com"],
      loginMechanism: "OpenAI account with positive membership in the intended managed workspace; SSO may be required by the tenant.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: true },
      logoutSemantics: "Login redirect or loss of selected workspace identity invalidates the run.",
      checkpointSemantics: "SSO, verification, or CAPTCHA checkpoint stops the run; no bypass.",
      accountBlockedSemantics: "Workspace missing, wrong tenant, or membership denial is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if positive Work identity cannot be proven after account identity.",
      minimumSafeCleanup: "Close isolated context; never infer Work from /c/<uuid>, and never delete/move chats.",
      evidenceLimitations: "URL alone is not Work evidence; model picker interaction is out of scope.",
      ...notProvisioned,
      implementationStatus: "FOUNDATION_AVAILABLE",
      liveReadiness: "BLOCKED_UNTIL_SESSION",
      strategy: {
        strategyId: "CHATGPT_WORK_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["OPENAI_AUTHENTICATED_ACCOUNT", "ACTIVE_WORKSPACE_MEMBERSHIP"],
        surfaceIdentitySignals: ["POSITIVE_WORKSPACE_MARKER", "WORKSPACE_PROFILE_MENU"],
        conversationIdentityRule: "Dedicated fixed Work conversation plus positive workspace identity; URL-only identity is rejected.",
        composerStrategy: "ChatGPT Work composer profile without model-picker interaction.",
        sendStrategy: "Single semantic Send control; no fallback model or second submit.",
        generationStrategy: "Work busy/stop transition scoped to the dedicated response.",
        responseAssociationStrategy: "New assistant message and message identity must follow the exact send in the fixed conversation.",
        completionStrategy: "Work busy-to-idle transition and associated response completion.",
        checkpointSignals: ["LOGIN_REDIRECT", "SSO_CHECKPOINT", "WORKSPACE_NOT_FOUND", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "ALICE",
      surfaceId: "ALICE_CHAT",
      officialWebStartAuthority: "https://alice.yandex.ru/",
      expectedAuthenticatedOrigins: ["https://alice.yandex.ru"],
      loginMechanism: "Yandex ID account authentication; login is required to persist and identify chat history.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: true },
      logoutSemantics: "Yandex login wall or missing active identity invalidates the run.",
      checkpointSemantics: "Yandex verification, CAPTCHA, or security checkpoint stops the run.",
      accountBlockedSemantics: "Yandex account restriction or unavailable Alice access is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if Yandex identity or active-history corroboration disappears.",
      minimumSafeCleanup: "Close isolated context; do not create/delete/archive chats in R1.",
      evidenceLimitations: "Route /chat/<UUID> is necessary but insufficient; active-history corroboration is required.",
      ...notProvisioned,
      implementationStatus: "FOUNDATION_AVAILABLE",
      liveReadiness: "BLOCKED_UNTIL_SESSION",
      strategy: {
        strategyId: "ALICE_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["YANDEX_ID_AUTHENTICATED", "ALICE_HISTORY_IDENTITY"],
        surfaceIdentitySignals: ["ALICE_ORIGIN", "ALICE_CHAT_SURFACE"],
        conversationIdentityRule: "Fixed /chat/<UUID> route plus active-history corroboration; route alone cannot bind identity.",
        composerStrategy: "Alice-specific inputbase-textarea and oknyx control strategy.",
        sendStrategy: "Alice-specific ready control and one-shot submit; no ChatGPT selector reuse.",
        generationStrategy: "Alice-specific stop control and generation state.",
        responseAssociationStrategy: "Alice-owned message role and message-id delta associated with the send.",
        completionStrategy: "Alice stop-to-ready transition with associated response complete.",
        checkpointSignals: ["YANDEX_LOGIN_REDIRECT", "YANDEX_VERIFICATION", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "DEEPSEEK",
      surfaceId: "DEEPSEEK_CHAT",
      officialWebStartAuthority: "https://chat.deepseek.com/",
      expectedAuthenticatedOrigins: ["https://chat.deepseek.com"],
      loginMechanism: "DeepSeek account registration/login using an account-backed web session; exact supported providers must be confirmed from the live first-party surface before provisioning.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "Sign-in page or loss of authenticated account identity invalidates the run.",
      checkpointSemantics: "Security verification, CAPTCHA, or rate/security checkpoint is a blocker.",
      accountBlockedSemantics: "Account restriction or service refusal is separate from product DOM drift.",
      invalidSessionSemantics: "Invalid or expired runtime handle stops before composer interaction.",
      minimumSafeCleanup: "Close isolated context only; no chat lifecycle mutation.",
      evidenceLimitations: "Provider-specific live selectors and account identity signals are not yet verified.",
      ...notProvisioned,
      strategy: {
        strategyId: "DEEPSEEK_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["DEEPSEEK_ACCOUNT_MARKER", "AUTHENTICATED_PROFILE_BOUNDARY"],
        surfaceIdentitySignals: ["DEEPSEEK_CHAT_ORIGIN", "CHAT_APPLICATION_ROOT"],
        conversationIdentityRule: "Fixed dedicated Health conversation only; disposable conversation is not permitted in R1.",
        composerStrategy: "DeepSeek-specific composer root and input ownership to be verified with a dedicated fixture/live session.",
        sendStrategy: "Not live-ready; adapter must fail closed until provider behavior is verified.",
        generationStrategy: "Provider-specific busy state, not borrowed from ChatGPT.",
        responseAssociationStrategy: "Provider-owned message identity and post-send delta.",
        completionStrategy: "Provider-owned busy-to-idle completion marker.",
        checkpointSignals: ["LOGIN_REDIRECT", "SECURITY_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "GROK",
      surfaceId: "GROK_WEB",
      officialWebStartAuthority: "https://grok.com/",
      expectedAuthenticatedOrigins: ["https://grok.com", "https://accounts.x.ai"],
      loginMechanism: "xAI account login; first-party surface documents X, email, Google, and Apple sign-in paths.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "xAI account sign-in surface or missing Grok identity invalidates the run.",
      checkpointSemantics: "xAI/X security checkpoint or CAPTCHA stops without bypass.",
      accountBlockedSemantics: "xAI account or linked X identity restriction is an auth blocker.",
      invalidSessionSemantics: "Session identity must remain bound to the expected xAI/Grok account.",
      minimumSafeCleanup: "Close isolated context only; no connector or subscription interaction.",
      evidenceLimitations: "xAI account/workspace identity and provider-specific selectors require dedicated verification.",
      ...notProvisioned,
      strategy: {
        strategyId: "GROK_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["XAI_ACCOUNT_IDENTITY", "GROK_PROFILE_BOUNDARY"],
        surfaceIdentitySignals: ["GROK_WEB_ORIGIN", "GROK_CHAT_APPLICATION"],
        conversationIdentityRule: "Fixed dedicated Health conversation; no connector, agent, or disposable-chat creation.",
        composerStrategy: "Grok-specific composer and submit ownership to be verified before automation.",
        sendStrategy: "Not live-ready pending provider-specific verification.",
        generationStrategy: "Grok-specific generation indicator.",
        responseAssociationStrategy: "Grok thread/message delta tied to one submit.",
        completionStrategy: "Grok-specific idle/completion state.",
        checkpointSignals: ["XAI_LOGIN_REDIRECT", "X_LOGIN_REDIRECT", "SECURITY_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "CLAUDE",
      surfaceId: "CLAUDE_WEB",
      officialWebStartAuthority: "https://claude.ai/",
      expectedAuthenticatedOrigins: ["https://claude.ai"],
      loginMechanism: "Anthropic Claude web login supports Google, email secure link, and SSO; team/enterprise account selection must be proven.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "Claude login surface or missing selected account invalidates the run.",
      checkpointSemantics: "Email verification, SSO, phone/security checkpoint, or CAPTCHA stops the run.",
      accountBlockedSemantics: "Account suspension or Team/Enterprise access denial is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if account/team identity no longer matches the authority.",
      minimumSafeCleanup: "Close isolated context only; do not create/delete conversations or artifacts.",
      evidenceLimitations: "Team/Enterprise identity, artifacts, and current web controls require provider-specific verification.",
      ...notProvisioned,
      strategy: {
        strategyId: "CLAUDE_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["CLAUDE_ACCOUNT_IDENTITY", "CLAUDE_TEAM_CONTEXT_IF_APPLICABLE"],
        surfaceIdentitySignals: ["CLAUDE_WEB_ORIGIN", "CLAUDE_CHAT_SURFACE"],
        conversationIdentityRule: "Fixed dedicated Health conversation; no arbitrary user chat or artifact mutation.",
        composerStrategy: "Claude-specific composer/editor ownership to be verified before automation.",
        sendStrategy: "Not live-ready pending provider-specific verification.",
        generationStrategy: "Claude-specific streaming/busy state.",
        responseAssociationStrategy: "Claude response block delta tied to the exact one-shot submit.",
        completionStrategy: "Claude stream completion/idle marker.",
        checkpointSignals: ["CLAUDE_LOGIN_REDIRECT", "EMAIL_VERIFICATION", "SSO_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "GEMINI",
      surfaceId: "GEMINI_WEB",
      officialWebStartAuthority: "https://gemini.google.com/",
      expectedAuthenticatedOrigins: ["https://gemini.google.com", "https://accounts.google.com"],
      loginMechanism: "Google Account sign-in; personal, work, and school account access are distinct and may be admin/license controlled.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "Google sign-in or missing Gemini identity invalidates the run.",
      checkpointSemantics: "Google security challenge, account access restriction, or CAPTCHA stops the run.",
      accountBlockedSemantics: "Workspace admin/license/account type restriction is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if the selected Google account or Gemini access context drifts.",
      minimumSafeCleanup: "Close isolated context only; do not access connected apps or account data.",
      evidenceLimitations: "No connected-app, file, or tool access is permitted; Gemini account context needs live proof.",
      ...notProvisioned,
      strategy: {
        strategyId: "GEMINI_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["GOOGLE_ACCOUNT_IDENTITY", "GEMINI_PROFILE_CONTEXT"],
        surfaceIdentitySignals: ["GEMINI_WEB_ORIGIN", "GEMINI_CHAT_SURFACE"],
        conversationIdentityRule: "Fixed dedicated Health conversation; never invoke connected apps or external tools.",
        composerStrategy: "Gemini-specific prompt input and submit ownership to be verified.",
        sendStrategy: "Not live-ready pending Google/Gemini surface verification.",
        generationStrategy: "Gemini-specific response-generation state.",
        responseAssociationStrategy: "Gemini turn/message delta tied to the exact submit.",
        completionStrategy: "Gemini response completion marker.",
        checkpointSignals: ["GOOGLE_LOGIN_REDIRECT", "GOOGLE_SECURITY_CHALLENGE", "ACCOUNT_ACCESS_RESTRICTION", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "QWEN",
      surfaceId: "QWEN_STUDIO",
      officialWebStartAuthority: "https://chat.qwen.ai/",
      expectedAuthenticatedOrigins: ["https://chat.qwen.ai"],
      loginMechanism: "Qwen Studio account login; current first-party surface presents email/password login and sign-up.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "Qwen authentication surface or missing account identity invalidates the run.",
      checkpointSemantics: "Qwen verification, rate/security checkpoint, or CAPTCHA stops the run.",
      accountBlockedSemantics: "Qwen account restriction or unavailable Studio access is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if Qwen account identity is absent or changes.",
      minimumSafeCleanup: "Close isolated context only; no history lifecycle mutation.",
      evidenceLimitations: "Current account identity, conversation controls, and code/copy semantics require dedicated verification.",
      ...notProvisioned,
      strategy: {
        strategyId: "QWEN_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["QWEN_ACCOUNT_IDENTITY", "QWEN_STUDIO_PROFILE"],
        surfaceIdentitySignals: ["QWEN_STUDIO_ORIGIN", "QWEN_CHAT_APPLICATION"],
        conversationIdentityRule: "Fixed dedicated Health conversation; no disposable creation in R1.",
        composerStrategy: "Qwen Studio-specific composer ownership to be verified.",
        sendStrategy: "Not live-ready pending provider-specific verification.",
        generationStrategy: "Qwen-specific generation state.",
        responseAssociationStrategy: "Qwen message delta tied to one submit.",
        completionStrategy: "Qwen completion/idle marker.",
        checkpointSignals: ["QWEN_LOGIN_REDIRECT", "SECURITY_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
    authority({
      providerId: "KIMI",
      surfaceId: "KIMI_WEB",
      officialWebStartAuthority: "https://www.kimi.ai/",
      expectedAuthenticatedOrigins: ["https://www.kimi.ai", "https://kimi.com"],
      loginMechanism: "Kimi web identity varies by regional surface; official help documents Google/phone on kimi.ai and phone/WeChat on kimi.com.",
      sessionIsolationRequirement: safeSessionBoundary,
      ...fixedConversation,
      capability: { ...noAutomatedSend, sendAutomatedSafely: false },
      logoutSemantics: "Kimi login surface or missing selected account identity invalidates the run.",
      checkpointSemantics: "Regional verification, security checkpoint, or CAPTCHA stops the run.",
      accountBlockedSemantics: "Kimi account suspension or regional access restriction is an auth blocker.",
      invalidSessionSemantics: "Session is invalid if regional account identity or selected surface drifts.",
      minimumSafeCleanup: "Close isolated context only; do not delete conversations or invoke tools/agents.",
      evidenceLimitations: "Regional surface and account identity must be selected explicitly; provider controls are not yet live verified.",
      ...notProvisioned,
      strategy: {
        strategyId: "KIMI_AUTH_V1",
        strategyRevision: 1,
        sessionIdentitySignals: ["KIMI_ACCOUNT_IDENTITY", "REGIONAL_SURFACE_IDENTITY"],
        surfaceIdentitySignals: ["KIMI_WEB_ORIGIN", "KIMI_CHAT_SURFACE"],
        conversationIdentityRule: "Fixed dedicated Health conversation; no disposable conversation or agent/tool invocation.",
        composerStrategy: "Kimi-specific input and submit ownership to be verified for the selected regional surface.",
        sendStrategy: "Not live-ready pending regional provider verification.",
        generationStrategy: "Kimi-specific generation state.",
        responseAssociationStrategy: "Kimi turn/message delta tied to one submit.",
        completionStrategy: "Kimi completion marker.",
        checkpointSignals: ["KIMI_LOGIN_REDIRECT", "REGIONAL_VERIFICATION", "SECURITY_CHECKPOINT", "CAPTCHA_SECURITY_CHECKPOINT"],
      },
    }),
  ]);

export const AUTH_SURFACE_AUTHORITY_BY_ID: Readonly<
  Record<AuthSurfaceId, AuthSurfaceAuthority>
> = Object.freeze(
  Object.fromEntries(
    AUTH_SURFACE_AUTHORITIES.map((entry) => [entry.surfaceId, entry]),
  ) as Record<AuthSurfaceId, AuthSurfaceAuthority>,
);

export function getAuthSurfaceAuthority(
  surfaceId: AuthSurfaceId,
): AuthSurfaceAuthority {
  return AUTH_SURFACE_AUTHORITY_BY_ID[surfaceId];
}

export function createNoAuthSessionSource(): AuthSessionSource {
  return Object.freeze(
    AuthSessionSourceSchema.parse({
      sourceType: "NONE",
      state: "NO_SESSION_CONFIGURED",
    }),
  );
}

export function createRuntimeAuthSessionReference(
  referenceId: string,
  state: Exclude<AuthSessionState, "NO_SESSION_CONFIGURED"> =
    "PREPROVISIONED_DEDICATED",
): AuthSessionReference {
  return Object.freeze(
    AuthSessionReferenceSchema.parse({
      sourceType: "OUT_OF_REPOSITORY_RUNTIME_HANDLE",
      state,
      referenceId,
      dedicatedTechnicalAccount: true,
      personalAccount: false,
    }),
  );
}

export function parseAuthSessionSource(input: unknown): AuthSessionSource {
  return Object.freeze(AuthSessionSourceSchema.parse(input));
}
