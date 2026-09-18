import { z } from "zod";
import { ControlledTargetKeySchema } from "./target-registry.js";

export const H3SurfaceSchema = z.enum([
  "CHATGPT_STANDARD",
  "CHATGPT_WORK",
  "ALICE",
]);
export type H3Surface = z.infer<typeof H3SurfaceSchema>;

export const H3PromptIdSchema = z.literal("BRIDGE_COMMAND_SMOKE_V1");
export type H3PromptId = z.infer<typeof H3PromptIdSchema>;

export const H3BehaviorStepSchema = z.enum([
  "IDENTIFY_SURFACE",
  "IDENTIFY_COMPOSER",
  "INSERT_PROMPT",
  "SEND_ONCE",
  "OBSERVE_BUSY",
  "OBSERVE_RESPONSE",
  "OBSERVE_COMPLETION",
  "VALIDATE_BRIDGE_SURFACES",
  "CLEANUP",
]);
export type H3BehaviorStep = z.infer<typeof H3BehaviorStepSchema>;

export const H3_BEHAVIOR_STEP_ORDER = Object.freeze([
  "IDENTIFY_SURFACE",
  "IDENTIFY_COMPOSER",
  "INSERT_PROMPT",
  "SEND_ONCE",
  "OBSERVE_BUSY",
  "OBSERVE_RESPONSE",
  "OBSERVE_COMPLETION",
  "VALIDATE_BRIDGE_SURFACES",
  "CLEANUP",
] as const satisfies readonly H3BehaviorStep[]);

const PACKAGED_PROMPTS: Readonly<Record<H3PromptId, string>> = Object.freeze({
  BRIDGE_COMMAND_SMOKE_V1:
    "Health check. Reply with exactly one fenced code block containing the single token BRIDGE_HEALTHCHECK_V1. Do not call tools or access external data.",
});

export function getPackagedH3Prompt(promptId: H3PromptId): string {
  return PACKAGED_PROMPTS[H3PromptIdSchema.parse(promptId)];
}

export const H3RunPlanSchema = z
  .object({
    level: z.literal("H3"),
    targetKey: ControlledTargetKeySchema,
    surface: H3SurfaceSchema,
    promptId: H3PromptIdSchema,
    steps: z.array(H3BehaviorStepSchema).length(H3_BEHAVIOR_STEP_ORDER.length),
    stepTimeoutMs: z.number().int().min(250).max(30_000),
    runTimeoutMs: z.number().int().min(1_000).max(120_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.steps.some((step, index) => step !== H3_BEHAVIOR_STEP_ORDER[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "H3 steps must match the packaged behavioral order",
      });
    }
  });
export type H3RunPlan = z.infer<typeof H3RunPlanSchema>;

export function createH3RunPlan(
  targetKey: string,
  surface: H3Surface,
  options: Readonly<{
    promptId?: H3PromptId;
    stepTimeoutMs?: number;
    runTimeoutMs?: number;
  }> = {},
): H3RunPlan {
  return H3RunPlanSchema.parse({
    level: "H3",
    targetKey,
    surface,
    promptId: options.promptId ?? "BRIDGE_COMMAND_SMOKE_V1",
    steps: [...H3_BEHAVIOR_STEP_ORDER],
    stepTimeoutMs: options.stepTimeoutMs ?? 5_000,
    runTimeoutMs: options.runTimeoutMs ?? 60_000,
  });
}

export function parseH3RunPlan(input: unknown): H3RunPlan {
  return H3RunPlanSchema.parse(input);
}
