import { z } from "zod";
import source from "./ai-release-scope.v1.json";

// Bundled product availability only. This descriptor never grants account,
// profile, provider, Health, Work, publication or offline execution authority.
export const AiReleaseScopeV1Schema = z
  .object({
    schemaVersion: z.literal("ai_release_scope_v1"),
    releaseId: z.literal("alice_first_v1"),
    revision: z.literal(1),
    enabledAi: z.tuple([
      z
        .object({
          family: z.literal("alice"),
          surface: z.literal("web"),
          variant: z.null(),
        })
        .strict(),
    ]),
    retainedAiFamilies: z.tuple([
      z.literal("chatgpt"),
      z.literal("alice"),
      z.literal("qwen"),
      z.literal("kimi"),
      z.literal("grok"),
      z.literal("gemini"),
      z.literal("claude"),
      z.literal("deepseek"),
    ]),
    executionAuthority: z.literal(false),
  })
  .strict();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export const AI_RELEASE_SCOPE_V1 = deepFreeze(
  AiReleaseScopeV1Schema.parse(source),
);
export const AI_RELEASE_SCOPE_SHA256 =
  "10c20b39daec4d0a9733173222167ea7a56da2a128bbc182132591c8e5596261" as const;
export const AiReleaseScopeBundleV1Schema = z
  .object({
    descriptor: AiReleaseScopeV1Schema,
    sha256: z.literal(AI_RELEASE_SCOPE_SHA256),
  })
  .strict();
export const AI_RELEASE_SCOPE_BUNDLE_V1 = deepFreeze({
  descriptor: AI_RELEASE_SCOPE_V1,
  sha256: AI_RELEASE_SCOPE_SHA256,
});

const DetectedReleaseAiSchema = z
  .object({
    family: z.string(),
    surface: z.string(),
    variant: z.string().nullable(),
  })
  .strict();
export function isAiEnabledInReleaseV1(value: unknown): boolean {
  const parsed = DetectedReleaseAiSchema.safeParse(value);
  return (
    parsed.success &&
    AI_RELEASE_SCOPE_V1.enabledAi.some(
      (ai) =>
        ai.family === parsed.data.family &&
        ai.surface === parsed.data.surface &&
        ai.variant === parsed.data.variant,
    )
  );
}
export function isAiPermissionEnabledInReleaseV1(key: string): boolean {
  return AI_RELEASE_SCOPE_V1.enabledAi.some((ai) => key === `ai.${ai.family}`);
}
