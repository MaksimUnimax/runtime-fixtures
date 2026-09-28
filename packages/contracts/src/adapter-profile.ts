import { BrowserFamilies, SemVerV1Schema } from "@product/shared";
import { z } from "zod";

// Canonical browser-safe profile schemas. Keep v1 parsing and signed bytes stable.
export const BrowserFamilySchema = z.enum(BrowserFamilies);
export const ProfileSchemaVersionSchema = z.literal("adapter_profile_v1");
export const CompatibilitySchemaVersionSchema = z.literal(
  "profile_compatibility_v1",
);
export const ProfileCompatibilityContractVersionSchema = z.enum([
  "control_plane_v1",
  "control_plane_v2",
]);

const SelectorReferenceSchema = z.enum([
  "page-root",
  "conversation-root",
  "composer-root",
  "send-control",
  "assistant-response",
  "busy-control",
  "copy-control",
]);
const AccessibilityRoleSchema = z.enum([
  "main",
  "article",
  "textbox",
  "button",
  "status",
]);
export const StrategyNameSchema = z.enum([
  "page_identity",
  "conversation_root",
  "composer_root",
  "send_control",
  "assistant_response",
  "busy_state",
  "copy_control",
]);
export const ObservationModeSchema = z.enum(["mutation_observer", "polling"]);
export const ContourKeySchema = z.enum([
  "page_identity",
  "conversation_root",
  "composer_root",
  "send_control",
  "busy_state",
  "assistant_response",
  "copy_control",
]);
const ExpectedContourStateSchema = z.enum([
  "PRESENT",
  "INTERACTIVE",
  "COMPLETES",
]);

const SelectorPrimitiveSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("accessibility_role_name"),
      role: AccessibilityRoleSchema,
      reference: SelectorReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("packaged_selector_reference"),
      reference: SelectorReferenceSchema,
    })
    .strict(),
]);

const SelectorPlanSchema = z
  .object({
    strategy: StrategyNameSchema,
    primary: SelectorPrimitiveSchema,
    fallbacks: z.array(SelectorPrimitiveSchema).max(3),
    timeoutMs: z.number().int().min(250).max(30_000),
    observationMode: ObservationModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observationMode === "polling" && value.timeoutMs < 500) {
      context.addIssue({
        code: "custom",
        path: ["timeoutMs"],
        message: "polling timeout is too short",
      });
    }
  });

export const ProfileCompatibilityConstraintsV1Schema = z
  .object({
    schemaVersion: CompatibilitySchemaVersionSchema,
    contractVersion: ProfileCompatibilityContractVersionSchema,
    browserFamilies: z
      .array(BrowserFamilySchema)
      .min(1)
      .max(BrowserFamilies.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "duplicate browser family",
      }),
    minimumBrowserVersions: z
      .array(
        z
          .object({
            browserFamily: BrowserFamilySchema,
            minimumVersion: z
              .string()
              .min(1)
              .max(64)
              .regex(/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/),
          })
          .strict(),
      )
      .max(BrowserFamilies.length)
      .refine(
        (values) =>
          new Set(values.map((value) => value.browserFamily)).size ===
          values.length,
        { message: "duplicate browser version scope" },
      ),
    minimumExtensionVersion: SemVerV1Schema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const entry of value.minimumBrowserVersions) {
      if (!value.browserFamilies.includes(entry.browserFamily)) {
        context.addIssue({
          code: "custom",
          path: ["minimumBrowserVersions"],
          message: "browser version scope is not enabled",
        });
      }
    }
  });

export const AdapterProfileContentV1Schema = z
  .object({
    schemaVersion: ProfileSchemaVersionSchema,
    page: z
      .object({
        identityStrategy: z.literal("page_identity"),
        conversationStrategy: z.literal("conversation_root"),
        composerStrategy: z.literal("composer_root"),
      })
      .strict(),
    selectors: z
      .object({
        conversation: SelectorPlanSchema,
        composer: SelectorPlanSchema,
        send: SelectorPlanSchema,
        assistantResponse: SelectorPlanSchema,
      })
      .strict(),
    observation: z
      .object({
        mode: ObservationModeSchema,
        intervalMs: z.number().int().min(100).max(5_000),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.mode === "mutation_observer" && value.intervalMs !== 100) {
          context.addIssue({
            code: "custom",
            path: ["intervalMs"],
            message: "mutation observer uses the fixed packaged interval",
          });
        }
      }),
    contours: z
      .array(
        z
          .object({
            key: ContourKeySchema,
            required: z.boolean(),
            expectedState: ExpectedContourStateSchema,
            strategy: StrategyNameSchema,
          })
          .strict(),
      )
      .min(4)
      .max(7)
      .refine(
        (values) =>
          new Set(values.map((value) => value.key)).size === values.length,
        { message: "duplicate contour" },
      ),
  })
  .strict();

export type AdapterProfileContentV1 = z.infer<
  typeof AdapterProfileContentV1Schema
>;
export type ProfileCompatibilityContractVersion = z.infer<
  typeof ProfileCompatibilityContractVersionSchema
>;
export type ProfileCompatibilityConstraintsV1 = z.infer<
  typeof ProfileCompatibilityConstraintsV1Schema
>;
