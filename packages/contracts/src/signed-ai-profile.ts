import { z } from "zod";
import { StableMachineIdentifierV1Schema } from "@product/shared";
import {
  AdapterProfileContentV1Schema,
  ProfileCompatibilityConstraintsV1Schema,
} from "./adapter-profile.js";

// Internal extension transport only. Parsing does not verify a signature or grant work.
const ProtocolSchema = z.literal("signed_ai_profile_consumer_v1");
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const SignedAiProfileScopeV1Schema = z
  .object({
    family: z.enum(["chatgpt", "alice"]),
    surface: z.literal("web"),
    variant: z.null(),
  })
  .strict();

export const SignedAiProfileIdentityV1Schema = z
  .object({
    profileKey: StableMachineIdentifierV1Schema,
    revision: z.number().int().positive(),
    scopeVariant: z.null(),
    contentSha256: DigestSchema,
  })
  .strict();

export const SignedAiProfileAuthorityV1Schema = z
  .object({
    authGeneration: z.number().int().positive(),
    bootstrapSnapshotSha256: DigestSchema,
  })
  .strict();

const ConsumerContentSchema = AdapterProfileContentV1Schema.superRefine(
  (content, context) => {
    const expected = {
      conversation: {
        strategy: "conversation_root",
        reference: "conversation-root",
      },
      composer: { strategy: "composer_root", reference: "composer-root" },
      send: { strategy: "send_control", reference: "send-control" },
      assistantResponse: {
        strategy: "assistant_response",
        reference: "assistant-response",
      },
    } as const;
    for (const slot of Object.keys(expected) as (keyof typeof expected)[]) {
      const plan = content.selectors[slot];
      if (plan.strategy !== expected[slot].strategy) {
        context.addIssue({
          code: "custom",
          path: ["selectors", slot, "strategy"],
          message: "selector strategy does not match its consumer slot",
        });
      }
      if (plan.primary.reference !== expected[slot].reference) {
        context.addIssue({
          code: "custom",
          path: ["selectors", slot, "primary", "reference"],
          message: "selector reference does not match its consumer slot",
        });
      }
      plan.fallbacks.forEach((primitive, index) => {
        if (primitive.reference !== expected[slot].reference) {
          context.addIssue({
            code: "custom",
            path: ["selectors", slot, "fallbacks", index, "reference"],
            message: "fallback reference does not match its consumer slot",
          });
        }
      });
    }
    content.contours.forEach((contour, index) => {
      if (contour.key !== contour.strategy) {
        context.addIssue({
          code: "custom",
          path: ["contours", index, "strategy"],
          message: "contour strategy does not match its key",
        });
      }
    });
  },
);

export const SignedAiProfileMaterialV1Schema =
  SignedAiProfileIdentityV1Schema.extend({
    schemaVersion: z.literal("adapter_profile_v1"),
    content: ConsumerContentSchema,
    // The existing contentSha256 covers BOTH content and compatibility.
    compatibility: ProfileCompatibilityConstraintsV1Schema,
  }).strict();

export const SignedAiProfileRequestV1Schema = z
  .object({
    messageType: z.literal("OZ_REQUEST_SIGNED_AI_PROFILE"),
    protocolVersion: ProtocolSchema,
    requestId: z.uuid(),
    ai: SignedAiProfileScopeV1Schema,
  })
  .strict();

const responseBase = {
  messageType: z.literal("OZ_SIGNED_AI_PROFILE"),
  protocolVersion: ProtocolSchema,
  requestId: z.uuid(),
  ai: SignedAiProfileScopeV1Schema,
};

export const SignedAiProfileUnavailableReasonV1Schema = z.enum([
  "NO_VERIFIED_AUTHORITY",
  "WORK_NOT_ALLOWED",
  "AI_SCOPE_MISMATCH",
  "PROFILE_UNSUPPORTED",
  "AUTHORITY_CHANGED",
]);

export const SignedAiProfileResponseV1Schema = z.discriminatedUnion("status", [
  z
    .object({
      ...responseBase,
      status: z.literal("AVAILABLE"),
      authority: SignedAiProfileAuthorityV1Schema,
      profile: SignedAiProfileMaterialV1Schema,
    })
    .strict(),
  z
    .object({
      ...responseBase,
      status: z.literal("UNAVAILABLE"),
      reason: SignedAiProfileUnavailableReasonV1Schema,
    })
    .strict(),
]);

const receiptBase = {
  messageType: z.literal("OZ_SIGNED_AI_PROFILE_RECEIPT"),
  protocolVersion: ProtocolSchema,
  requestId: z.uuid(),
  ai: SignedAiProfileScopeV1Schema,
};
export const SignedAiProfileReceiptV1Schema = z.discriminatedUnion("status", [
  z
    .object({
      ...receiptBase,
      status: z.literal("APPLIED"),
      authority: SignedAiProfileAuthorityV1Schema,
      profile: SignedAiProfileIdentityV1Schema,
    })
    .strict(),
  z
    .object({
      ...receiptBase,
      status: z.literal("DEFERRED"),
      authority: SignedAiProfileAuthorityV1Schema,
      profile: SignedAiProfileIdentityV1Schema,
      reason: z.literal("WORK_IN_FLIGHT"),
    })
    .strict(),
  z
    .object({
      ...receiptBase,
      status: z.literal("CLEARED"),
      reason: SignedAiProfileUnavailableReasonV1Schema,
    })
    .strict(),
  z
    .object({
      ...receiptBase,
      status: z.literal("REJECTED"),
      reason: z.enum(["INVALID_PROFILE", "STALE_REQUEST", "AI_SCOPE_MISMATCH"]),
    })
    .strict(),
]);

export type SignedAiProfileRequestV1 = z.infer<
  typeof SignedAiProfileRequestV1Schema
>;
export type SignedAiProfileResponseV1 = z.infer<
  typeof SignedAiProfileResponseV1Schema
>;
export type SignedAiProfileReceiptV1 = z.infer<
  typeof SignedAiProfileReceiptV1Schema
>;
export type SignedAiProfileMaterialV1 = z.infer<
  typeof SignedAiProfileMaterialV1Schema
>;
