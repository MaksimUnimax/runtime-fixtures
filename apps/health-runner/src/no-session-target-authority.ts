import { z } from "zod";
import {
  NoSessionProviderIdSchema,
  NoSessionSurfaceIdSchema,
  type NoSessionProviderId,
  type NoSessionSurfaceId,
} from "./no-session-contracts.js";

const NoSessionAuthExpectationSchema = z.enum([
  "PUBLIC_POSSIBLE",
  "AUTH_MAY_BE_REQUIRED",
  "AUTH_REQUIRED_FOR_DEEP_INTERACTION",
]);

export const NoSessionTargetSchema = z
  .object({
    providerId: NoSessionProviderIdSchema,
    surfaceId: NoSessionSurfaceIdSchema,
    targetKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    startUrl: z.string().url().max(2_048),
    allowedTopLevelOrigins: z.array(z.string().url().max(256)).min(1).max(3),
    redirectPolicy: z.literal("SAME_ORIGIN_ONLY"),
    strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    strategyRevision: z.number().int().positive(),
    navigationTimeoutMs: z.number().int().min(250).max(30_000),
    publicComposerExpected: z.boolean(),
    sendControlExpected: z.boolean(),
    authenticationExpectation: NoSessionAuthExpectationSchema,
    identityRequirement: z.literal("ORIGIN_AND_PROVIDER_SURFACE_SIGNAL"),
    officialProvenance: z
      .object({
        provider: z.string().min(1).max(128),
        sourceUrl: z.string().url().max(2_048),
        observationDate: z.string().date(),
        observationNote: z.string().min(1).max(512),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    let start: URL;
    try {
      start = new URL(value.startUrl);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["startUrl"],
        message: "invalid start URL",
      });
      return;
    }
    const origins = value.allowedTopLevelOrigins.map(
      (origin) => new URL(origin).origin,
    );
    if (
      new Set(origins).size !== origins.length ||
      !origins.includes(start.origin)
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedTopLevelOrigins"],
        message: "start URL origin is not in the allowlist",
      });
    }
  });
export type NoSessionTarget = Readonly<z.infer<typeof NoSessionTargetSchema>>;

const observedAt = "2026-09-18";

const TARGETS: readonly NoSessionTarget[] = [
  {
    providerId: "chatgpt",
    surfaceId: "CHATGPT_STANDARD",
    targetKey: "nosession_chatgpt_standard",
    startUrl: "https://chatgpt.com/",
    allowedTopLevelOrigins: ["https://chatgpt.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "chatgpt-standard-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "PUBLIC_POSSIBLE",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "OpenAI",
      sourceUrl: "https://help.openai.com/en/articles/9125172",
      observationDate: observedAt,
      observationNote:
        "OpenAI Help identifies chatgpt.com as the ChatGPT web surface.",
    },
  },
  {
    providerId: "chatgpt",
    surfaceId: "CHATGPT_WORK",
    targetKey: "nosession_chatgpt_work",
    startUrl: "https://chatgpt.com/",
    allowedTopLevelOrigins: ["https://chatgpt.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "chatgpt-work-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "AUTH_REQUIRED_FOR_DEEP_INTERACTION",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "OpenAI",
      sourceUrl: "https://help.openai.com/en/articles/9125172",
      observationDate: observedAt,
      observationNote:
        "The Work surface shares the official ChatGPT origin; Work identity must be positively observed and is never inferred from URL shape.",
    },
  },
  {
    providerId: "alice",
    surfaceId: "ALICE",
    targetKey: "nosession_alice",
    startUrl: "https://alice.yandex.ru/",
    allowedTopLevelOrigins: ["https://alice.yandex.ru"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "alice-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "AUTH_MAY_BE_REQUIRED",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "Yandex",
      sourceUrl: "https://alice.yandex.ru/about",
      observationDate: observedAt,
      observationNote:
        "Yandex identifies alice.yandex.ru as the Alice AI site; authenticated conversation routes are outside this no-session target.",
    },
  },
  {
    providerId: "deepseek",
    surfaceId: "DEEPSEEK",
    targetKey: "nosession_deepseek",
    startUrl: "https://chat.deepseek.com/",
    allowedTopLevelOrigins: ["https://chat.deepseek.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "deepseek-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: false,
    sendControlExpected: false,
    authenticationExpectation: "AUTH_REQUIRED_FOR_DEEP_INTERACTION",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "DeepSeek",
      sourceUrl: "https://www.deepseek.com/en/",
      observationDate: observedAt,
      observationNote:
        "DeepSeek first-party site links its DeepSeek Web product; the chat origin is constrained to chat.deepseek.com.",
    },
  },
  {
    providerId: "grok",
    surfaceId: "GROK",
    targetKey: "nosession_grok",
    startUrl: "https://grok.com/",
    allowedTopLevelOrigins: ["https://grok.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "grok-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "AUTH_MAY_BE_REQUIRED",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "xAI",
      sourceUrl: "https://grok.com/",
      observationDate: observedAt,
      observationNote:
        "The xAI-owned Grok web surface is monitored at grok.com with same-origin redirects only.",
    },
  },
  {
    providerId: "claude",
    surfaceId: "CLAUDE",
    targetKey: "nosession_claude",
    startUrl: "https://claude.ai/",
    allowedTopLevelOrigins: ["https://claude.ai"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "claude-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: false,
    sendControlExpected: false,
    authenticationExpectation: "AUTH_REQUIRED_FOR_DEEP_INTERACTION",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "Anthropic",
      sourceUrl: "https://www.anthropic.com/claude",
      observationDate: observedAt,
      observationNote:
        "Anthropic's official Claude product documentation identifies claude.ai as the web app surface.",
    },
  },
  {
    providerId: "gemini",
    surfaceId: "GEMINI",
    targetKey: "nosession_gemini",
    startUrl: "https://gemini.google.com/",
    allowedTopLevelOrigins: ["https://gemini.google.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "gemini-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "PUBLIC_POSSIBLE",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "Google",
      sourceUrl: "https://support.google.com/gemini/answer/13275745",
      observationDate: observedAt,
      observationNote:
        "Google's Gemini Apps Help identifies gemini.google.com and documents signed-out feature variation.",
    },
  },
  {
    providerId: "qwen",
    surfaceId: "QWEN",
    targetKey: "nosession_qwen",
    startUrl: "https://chat.qwen.ai/chat",
    allowedTopLevelOrigins: ["https://chat.qwen.ai"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "qwen-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "AUTH_MAY_BE_REQUIRED",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "Qwen",
      sourceUrl: "https://qwen.ai/qwenchat",
      observationDate: observedAt,
      observationNote:
        "Qwen's first-party product page links Try Qwen Studio; the monitored chat start surface is chat.qwen.ai/chat.",
    },
  },
  {
    providerId: "kimi",
    surfaceId: "KIMI",
    targetKey: "nosession_kimi",
    startUrl: "https://www.kimi.com/",
    allowedTopLevelOrigins: ["https://www.kimi.com"],
    redirectPolicy: "SAME_ORIGIN_ONLY",
    strategyId: "kimi-public-v1",
    strategyRevision: 1,
    navigationTimeoutMs: 15_000,
    publicComposerExpected: true,
    sendControlExpected: true,
    authenticationExpectation: "AUTH_MAY_BE_REQUIRED",
    identityRequirement: "ORIGIN_AND_PROVIDER_SURFACE_SIGNAL",
    officialProvenance: {
      provider: "Moonshot AI",
      sourceUrl: "https://www.kimi.com/",
      observationDate: observedAt,
      observationNote:
        "The official Kimi web surface is monitored at www.kimi.com; no alternate origin is permitted by this target.",
    },
  },
].map((target) => Object.freeze(NoSessionTargetSchema.parse(target)));

export const NO_SESSION_TARGETS = Object.freeze(TARGETS);
export const NO_SESSION_PROVIDER_IDS = Object.freeze(
  NoSessionProviderIdSchema.options,
);
export const NO_SESSION_SURFACE_IDS = Object.freeze(
  NoSessionSurfaceIdSchema.options,
);

export function getNoSessionTarget(
  targetKey: string,
): NoSessionTarget | undefined {
  return NO_SESSION_TARGETS.find((target) => target.targetKey === targetKey);
}

export function getNoSessionTargetForSurface(
  surfaceId: NoSessionSurfaceId,
): NoSessionTarget {
  const target = NO_SESSION_TARGETS.find(
    (candidate) => candidate.surfaceId === surfaceId,
  );
  if (!target) throw new Error("NO_SESSION_SURFACE_NOT_REGISTERED");
  return target;
}

export function targetsForProvider(
  providerId: NoSessionProviderId,
): readonly NoSessionTarget[] {
  return NO_SESSION_TARGETS.filter(
    (target) => target.providerId === providerId,
  );
}
