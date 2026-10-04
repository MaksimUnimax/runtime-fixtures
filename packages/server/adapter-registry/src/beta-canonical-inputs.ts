import { isDeepStrictEqual } from "node:util";
import {
  AdapterProfileContentV1Schema,
  ProfileCompatibilityConstraintsV1Schema,
} from "@product/contracts";
import { z } from "zod";

export const BetaAiProductSurfaceSchema = z.enum([
  "CHATGPT_STANDARD",
  "CHATGPT_WORK",
  "ALICE",
]);
export type BetaAiProductSurface = z.infer<typeof BetaAiProductSurfaceSchema>;

export const BetaAiCanonicalInputStateSchema = z.enum([
  "COMMITTED_BOUNDED_PREDECESSOR",
  "MISSING_CANONICAL_INPUT",
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const CanonicalAdapterSchema = z
  .object({
    machineKey: z.literal("chatgpt"),
    displayName: z.literal("ChatGPT"),
    description: z.literal("STORE-1 Standard reviewer slice"),
  })
  .strict();

const CanonicalSurfaceSchema = z
  .object({
    machineKey: z.literal("web"),
    displayName: z.literal("Web"),
  })
  .strict();

const CanonicalProfileSchema = z
  .object({
    machineKey: z.literal("chatgpt-web-opera-v1"),
    displayName: z.literal("ChatGPT Web Opera"),
    content: AdapterProfileContentV1Schema,
    compatibility: ProfileCompatibilityConstraintsV1Schema,
    contentSha256: z.literal(
      "cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1",
    ),
  })
  .strict();

const CommittedChatGptStandardSchema = z
  .object({
    canonicalInputState: z.literal("COMMITTED_BOUNDED_PREDECESSOR"),
    productSurface: z.literal("CHATGPT_STANDARD"),
    evidence: z
      .object({
        scope: z.literal("STORE1_OPERA_REVIEWER_SLICE"),
        productVersion: z.literal("0.2.11"),
        browserFamily: z.literal("opera"),
        minimumBrowserVersion: z.literal("136"),
        minimumExtensionVersion: z.literal("0.2.7"),
        contractVersion: z.literal("control_plane_v2"),
      })
      .strict(),
    adapter: CanonicalAdapterSchema,
    surface: CanonicalSurfaceSchema,
    variantId: z.null(),
    profile: CanonicalProfileSchema,
  })
  .strict();

const MissingCanonicalInputSchema = z
  .object({
    canonicalInputState: z.literal("MISSING_CANONICAL_INPUT"),
    productSurface: z.enum(["CHATGPT_WORK", "ALICE"]),
    reasonCode: z.literal("PRODUCT_REQUIRED_SOURCE_INPUT_NOT_ACCEPTED"),
  })
  .strict();

export const BetaAiProfileCanonicalInputsSchema = z
  .object({
    schemaVersion: z.literal("beta_ai_profile_canonical_inputs_v1"),
    betaWideCatalogProven: z.literal(false),
    requiredProductSurfaces: z.tuple([
      z.literal("CHATGPT_STANDARD"),
      z.literal("CHATGPT_WORK"),
      z.literal("ALICE"),
    ]),
    canonicalInputs: z
      .object({
        CHATGPT_STANDARD: CommittedChatGptStandardSchema,
        CHATGPT_WORK: MissingCanonicalInputSchema.refine(
          (value) => value.productSurface === "CHATGPT_WORK",
          "CHATGPT_WORK surface mismatch",
        ),
        ALICE: MissingCanonicalInputSchema.refine(
          (value) => value.productSurface === "ALICE",
          "ALICE surface mismatch",
        ),
      })
      .strict(),
    dynamicAuthorityExclusions: z.tuple([
      z.literal("DB_IDENTIFIERS_AND_TIMESTAMPS"),
      z.literal("REGISTRY_STATUS_LIFECYCLE"),
      z.literal("PROFILE_REVISION_ID_NUMBER_STATE_AND_PUBLICATION_PRINCIPALS"),
      z.literal("ACCOUNT_ASSIGNMENT_AND_COHORT_AUTHORITY"),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    const profile = value.canonicalInputs.CHATGPT_STANDARD.profile;
    if (
      !isDeepStrictEqual(
        profile.content,
        BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.profile.content,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["canonicalInputs", "CHATGPT_STANDARD", "profile", "content"],
        message: "canonical profile content differs from accepted source",
      });
    if (
      !isDeepStrictEqual(
        profile.compatibility,
        BETA_CHATGPT_STANDARD_OPERA_INPUT_V1.profile.compatibility,
      )
    )
      context.addIssue({
        code: "custom",
        path: [
          "canonicalInputs",
          "CHATGPT_STANDARD",
          "profile",
          "compatibility",
        ],
        message: "canonical profile compatibility differs from accepted source",
      });
  });

function selector(
  strategy:
    | "conversation_root"
    | "composer_root"
    | "send_control"
    | "assistant_response",
  reference:
    | "conversation-root"
    | "composer-root"
    | "send-control"
    | "assistant-response",
) {
  return {
    strategy,
    primary: { kind: "packaged_selector_reference" as const, reference },
    fallbacks: [],
    timeoutMs: 1000,
    observationMode: "polling" as const,
  };
}

function contour(
  key: "page_identity" | "conversation_root" | "composer_root" | "send_control",
  expectedState: "PRESENT" | "INTERACTIVE",
  strategy:
    | "page_identity"
    | "conversation_root"
    | "composer_root"
    | "send_control",
) {
  return { key, required: true, expectedState, strategy };
}

export const BETA_CHATGPT_STANDARD_OPERA_INPUT_V1 = deepFreeze({
  canonicalInputState: "COMMITTED_BOUNDED_PREDECESSOR",
  productSurface: "CHATGPT_STANDARD",
  evidence: {
    scope: "STORE1_OPERA_REVIEWER_SLICE",
    productVersion: "0.2.11",
    browserFamily: "opera",
    minimumBrowserVersion: "136",
    minimumExtensionVersion: "0.2.7",
    contractVersion: "control_plane_v2",
  },
  adapter: {
    machineKey: "chatgpt",
    displayName: "ChatGPT",
    description: "STORE-1 Standard reviewer slice",
  },
  surface: {
    machineKey: "web",
    displayName: "Web",
  },
  variantId: null,
  profile: {
    machineKey: "chatgpt-web-opera-v1",
    displayName: "ChatGPT Web Opera",
    content: {
      schemaVersion: "adapter_profile_v1",
      page: {
        identityStrategy: "page_identity",
        conversationStrategy: "conversation_root",
        composerStrategy: "composer_root",
      },
      selectors: {
        conversation: selector("conversation_root", "conversation-root"),
        composer: selector("composer_root", "composer-root"),
        send: selector("send_control", "send-control"),
        assistantResponse: selector("assistant_response", "assistant-response"),
      },
      observation: { mode: "polling", intervalMs: 100 },
      contours: [
        contour("page_identity", "PRESENT", "page_identity"),
        contour("conversation_root", "PRESENT", "conversation_root"),
        contour("composer_root", "INTERACTIVE", "composer_root"),
        contour("send_control", "INTERACTIVE", "send_control"),
      ],
    },
    compatibility: {
      schemaVersion: "profile_compatibility_v1",
      contractVersion: "control_plane_v2",
      browserFamilies: ["opera"],
      minimumBrowserVersions: [
        { browserFamily: "opera", minimumVersion: "136" },
      ],
      minimumExtensionVersion: "0.2.7",
    },
    contentSha256:
      "cab55851bd2d571c19de5d44f3f8b3c40ff0ba3eb44e346307a2578894b1b2c1",
  },
} as const);

export const BETA_AI_PROFILE_CANONICAL_INPUTS_V1 = deepFreeze(
  BetaAiProfileCanonicalInputsSchema.parse({
    schemaVersion: "beta_ai_profile_canonical_inputs_v1",
    betaWideCatalogProven: false,
    requiredProductSurfaces: ["CHATGPT_STANDARD", "CHATGPT_WORK", "ALICE"],
    canonicalInputs: {
      CHATGPT_STANDARD: BETA_CHATGPT_STANDARD_OPERA_INPUT_V1,
      CHATGPT_WORK: {
        canonicalInputState: "MISSING_CANONICAL_INPUT",
        productSurface: "CHATGPT_WORK",
        reasonCode: "PRODUCT_REQUIRED_SOURCE_INPUT_NOT_ACCEPTED",
      },
      ALICE: {
        canonicalInputState: "MISSING_CANONICAL_INPUT",
        productSurface: "ALICE",
        reasonCode: "PRODUCT_REQUIRED_SOURCE_INPUT_NOT_ACCEPTED",
      },
    },
    dynamicAuthorityExclusions: [
      "DB_IDENTIFIERS_AND_TIMESTAMPS",
      "REGISTRY_STATUS_LIFECYCLE",
      "PROFILE_REVISION_ID_NUMBER_STATE_AND_PUBLICATION_PRINCIPALS",
      "ACCOUNT_ASSIGNMENT_AND_COHORT_AUTHORITY",
    ],
  }),
);

export type BetaAiProfileCanonicalInputs = z.infer<
  typeof BetaAiProfileCanonicalInputsSchema
>;
