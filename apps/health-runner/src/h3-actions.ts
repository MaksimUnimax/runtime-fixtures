import { z } from "zod";
import {
  H3_BEHAVIOR_STEP_ORDER,
  H3PromptIdSchema,
  H3SurfaceSchema,
  parseH3RunPlan,
  type H3Surface,
  type H3RunPlan,
} from "./h3-contracts.js";

const H3ProfileShape = {
  surface: H3SurfaceSchema,
  profileId: z.enum(["CHATGPT_STANDARD_H3_V2", "CHATGPT_WORK_H3_V1"]),
  profileRevision: z.union([z.literal(1), z.literal(2)]),
} as const;

export const H3SurfaceProfileSchema = z
  .discriminatedUnion("surface", [
    z
      .object({
        ...H3ProfileShape,
        surface: z.literal("CHATGPT_STANDARD"),
        profileId: z.literal("CHATGPT_STANDARD_H3_V2"),
        profileRevision: z.literal(2),
      })
      .strict(),
    z
      .object({
        ...H3ProfileShape,
        surface: z.literal("CHATGPT_WORK"),
        profileId: z.literal("CHATGPT_WORK_H3_V1"),
        profileRevision: z.literal(1),
      })
      .strict(),
  ])
  .readonly();
export type H3SurfaceProfile = z.infer<typeof H3SurfaceProfileSchema>;

const H3PackagedActionBase = {
  surfaceProfile: H3SurfaceProfileSchema,
} as const;

const H3PackagedActionSchemas = [
  z
    .object({
      kind: z.literal("IDENTIFY_SURFACE"),
      ...H3PackagedActionBase,
    })
    .strict(),
  z
    .object({
      kind: z.literal("IDENTIFY_COMPOSER"),
      ...H3PackagedActionBase,
    })
    .strict(),
  z
    .object({
      kind: z.literal("INSERT_PROMPT"),
      ...H3PackagedActionBase,
      promptId: H3PromptIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("SEND_ONCE"),
      ...H3PackagedActionBase,
      sendMode: z.literal("SINGLE_IRREVERSIBLE"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("OBSERVE_BUSY"),
      ...H3PackagedActionBase,
      observation: z.literal("BUSY_GENERATION_TRANSITION"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("OBSERVE_RESPONSE"),
      ...H3PackagedActionBase,
      observation: z.literal("ASSISTANT_RESPONSE_ASSOCIATION"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("OBSERVE_COMPLETION"),
      ...H3PackagedActionBase,
      observation: z.literal("COMPLETION_IDLE_TRANSITION"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("VALIDATE_BRIDGE_SURFACES"),
      ...H3PackagedActionBase,
      checks: z
        .tuple([
          z.literal("COMMAND_CODE_BLOCK_SURFACE"),
          z.literal("NATIVE_COPY_CONTROL"),
          z.literal("CONVERSATION_IDENTITY"),
          z.literal("DELIVERY_INSERTION_PATH"),
        ])
        .readonly(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("CLEANUP"),
      ...H3PackagedActionBase,
      cleanupMode: z.literal("EPHEMERAL_SESSION_CLOSE"),
    })
    .strict(),
] as const;

export const H3PackagedActionSchema = z
  .discriminatedUnion("kind", H3PackagedActionSchemas)
  .readonly();
export type H3PackagedAction = z.infer<typeof H3PackagedActionSchema>;

export type H3BridgeSurfaceCheck = Extract<
  H3PackagedAction,
  { kind: "VALIDATE_BRIDGE_SURFACES" }
>["checks"][number];

export const H3_PACKAGED_ACTION_KIND_ORDER = H3_BEHAVIOR_STEP_ORDER;

export type H3PackagedActionSequence = readonly [
  Extract<H3PackagedAction, { kind: "IDENTIFY_SURFACE" }>,
  Extract<H3PackagedAction, { kind: "IDENTIFY_COMPOSER" }>,
  Extract<H3PackagedAction, { kind: "INSERT_PROMPT" }>,
  Extract<H3PackagedAction, { kind: "SEND_ONCE" }>,
  Extract<H3PackagedAction, { kind: "OBSERVE_BUSY" }>,
  Extract<H3PackagedAction, { kind: "OBSERVE_RESPONSE" }>,
  Extract<H3PackagedAction, { kind: "OBSERVE_COMPLETION" }>,
  Extract<H3PackagedAction, { kind: "VALIDATE_BRIDGE_SURFACES" }>,
  Extract<H3PackagedAction, { kind: "CLEANUP" }>,
];

const PACKAGED_H3_PROFILES: Readonly<Record<H3Surface, H3SurfaceProfile>> =
  Object.freeze({
    CHATGPT_STANDARD: Object.freeze({
      surface: "CHATGPT_STANDARD",
      profileId: "CHATGPT_STANDARD_H3_V2",
      profileRevision: 2,
    }),
    CHATGPT_WORK: Object.freeze({
      surface: "CHATGPT_WORK",
      profileId: "CHATGPT_WORK_H3_V1",
      profileRevision: 1,
    }),
  });

export function getPackagedH3Profile(surface: H3Surface): H3SurfaceProfile {
  return H3SurfaceProfileSchema.parse(PACKAGED_H3_PROFILES[surface]);
}

export function parseH3SurfaceProfile(input: unknown): H3SurfaceProfile {
  return H3SurfaceProfileSchema.parse(input);
}

export function parseH3PackagedAction(input: unknown): H3PackagedAction {
  return H3PackagedActionSchema.parse(input);
}

function freezeAction(action: H3PackagedAction): H3PackagedAction {
  if (action.kind === "VALIDATE_BRIDGE_SURFACES") {
    return Object.freeze({
      ...action,
      checks: Object.freeze(action.checks),
    });
  }
  return Object.freeze(action);
}

function freezeSequence(
  actions: readonly H3PackagedAction[],
): H3PackagedActionSequence {
  if (
    actions.length !== H3_BEHAVIOR_STEP_ORDER.length ||
    actions.some(
      (action, index) => action.kind !== H3_BEHAVIOR_STEP_ORDER[index],
    ) ||
    actions.filter((action) => action.kind === "SEND_ONCE").length !== 1 ||
    actions.at(-1)?.kind !== "CLEANUP"
  ) {
    throw new Error("INVALID_PACKAGED_H3_ACTION_SEQUENCE");
  }
  return Object.freeze(actions) as H3PackagedActionSequence;
}

export function compileH3PackagedActions(
  input: unknown,
): H3PackagedActionSequence {
  const plan: H3RunPlan = parseH3RunPlan(input);
  const surfaceProfile = getPackagedH3Profile(plan.surface);
  const actions: H3PackagedAction[] = [
    freezeAction({
      kind: "IDENTIFY_SURFACE",
      surfaceProfile,
    }),
    freezeAction({
      kind: "IDENTIFY_COMPOSER",
      surfaceProfile,
    }),
    freezeAction({
      kind: "INSERT_PROMPT",
      surfaceProfile,
      promptId: plan.promptId,
    }),
    freezeAction({
      kind: "SEND_ONCE",
      surfaceProfile,
      sendMode: "SINGLE_IRREVERSIBLE",
    }),
    freezeAction({
      kind: "OBSERVE_BUSY",
      surfaceProfile,
      observation: "BUSY_GENERATION_TRANSITION",
    }),
    freezeAction({
      kind: "OBSERVE_RESPONSE",
      surfaceProfile,
      observation: "ASSISTANT_RESPONSE_ASSOCIATION",
    }),
    freezeAction({
      kind: "OBSERVE_COMPLETION",
      surfaceProfile,
      observation: "COMPLETION_IDLE_TRANSITION",
    }),
    freezeAction({
      kind: "VALIDATE_BRIDGE_SURFACES",
      surfaceProfile,
      checks: [
        "COMMAND_CODE_BLOCK_SURFACE",
        "NATIVE_COPY_CONTROL",
        "CONVERSATION_IDENTITY",
        "DELIVERY_INSERTION_PATH",
      ],
    }),
    freezeAction({
      kind: "CLEANUP",
      surfaceProfile,
      cleanupMode: "EPHEMERAL_SESSION_CLOSE",
    }),
  ];
  return freezeSequence(actions);
}
