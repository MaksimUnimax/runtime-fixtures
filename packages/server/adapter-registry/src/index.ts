import { createHash } from "node:crypto";
import { canonicalizeJson } from "@product/remote-config";
import { selectRolloutCandidateV1 } from "@product/remote-config";
import { BrowserFamilies, SemVerV1Schema } from "@product/shared";
import { z } from "zod";

const MACHINE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROFILE_BYTES = 65_536;

export const AdapterKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(MACHINE_KEY_PATTERN);
export const SurfaceKeySchema = AdapterKeySchema;
export const VariantKeySchema = AdapterKeySchema;
export const ProfileKeySchema = AdapterKeySchema;
export const AdapterRegistryStatusSchema = z.enum([
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);
export const ProfileRevisionStateSchema = z.enum([
  "DRAFT",
  "CANDIDATE",
  "PUBLISHED",
  "RETIRED",
]);
export const BrowserFamilySchema = z.enum(BrowserFamilies);
export const ProfileSchemaVersionSchema = z.literal("adapter_profile_v1");
export const CompatibilitySchemaVersionSchema = z.literal(
  "profile_compatibility_v1",
);

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
    contractVersion: z.literal("control_plane_v1"),
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
export type ProfileCompatibilityConstraintsV1 = z.infer<
  typeof ProfileCompatibilityConstraintsV1Schema
>;
export type ProfileRevisionState = z.infer<typeof ProfileRevisionStateSchema>;

export const AdapterSchema = z
  .object({
    id: z.uuid(),
    machineKey: AdapterKeySchema,
    displayName: z.string().min(1).max(256),
    description: z.string().max(512),
    status: AdapterRegistryStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export const SurfaceSchema = z
  .object({
    id: z.uuid(),
    adapterId: z.uuid(),
    machineKey: SurfaceKeySchema,
    displayName: z.string().min(1).max(256),
    status: AdapterRegistryStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export const VariantSchema = z
  .object({
    id: z.uuid(),
    surfaceId: z.uuid(),
    machineKey: VariantKeySchema,
    displayName: z.string().min(1).max(256),
    status: AdapterRegistryStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export const AdapterProfileSchema = z
  .object({
    id: z.uuid(),
    adapterId: z.uuid(),
    surfaceId: z.uuid(),
    variantId: z.uuid().nullable(),
    machineKey: ProfileKeySchema,
    displayName: z.string().min(1).max(256),
    status: AdapterRegistryStatusSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

const profileRevisionLifecycleInvariant = (
  value: { state: ProfileRevisionState; publishedAt: Date | null },
  context: z.RefinementCtx,
) => {
  const published = value.state === "PUBLISHED" || value.state === "RETIRED";
  if (published !== (value.publishedAt !== null)) {
    context.addIssue({
      code: "custom",
      path: ["publishedAt"],
      message: "publication timestamp does not match lifecycle state",
    });
  }
};

const profileRevisionFields = {
  id: z.uuid(),
  profileId: z.uuid(),
  adapterId: z.uuid(),
  surfaceId: z.uuid(),
  variantId: z.uuid().nullable(),
  revision: z.number().int().positive(),
  schemaVersion: ProfileSchemaVersionSchema,
  state: ProfileRevisionStateSchema,
  content: AdapterProfileContentV1Schema,
  compatibility: ProfileCompatibilityConstraintsV1Schema,
  createdAt: z.date(),
  publishedAt: z.date().nullable(),
  createdByAdminPrincipalId: z.uuid().nullable(),
  publishedByAdminPrincipalId: z.uuid().nullable(),
};

export const ProfileRevisionCreateInputSchema = z
  .object(profileRevisionFields)
  .strict()
  .superRefine(profileRevisionLifecycleInvariant);

export const PersistedProfileRevisionSchema = z
  .object({
    ...profileRevisionFields,
    contentSha256: z.string().regex(SHA256_PATTERN),
  })
  .strict()
  .superRefine(profileRevisionLifecycleInvariant);
export const ProfileRevisionInputSchema = ProfileRevisionCreateInputSchema;
export type Adapter = z.infer<typeof AdapterSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type AdapterProfile = z.infer<typeof AdapterProfileSchema>;
export type ProfileRevisionCreateInput = z.infer<
  typeof ProfileRevisionCreateInputSchema
>;
export type PersistedProfileRevision = z.infer<
  typeof PersistedProfileRevisionSchema
>;
export type ProfileRevisionInput = ProfileRevisionCreateInput;

export interface AdapterRegistryCatalogRepository {
  findAdapter(id: string): Promise<Adapter | undefined>;
  findSurface(id: string): Promise<Surface | undefined>;
  findVariant(id: string): Promise<Variant | undefined>;
  findProfile(id: string): Promise<AdapterProfile | undefined>;
  findProfileRevision(
    profileId: string,
    revision: number,
  ): Promise<PersistedProfileRevision | undefined>;
}

export function validateProfileContent(input: {
  content: unknown;
  compatibility: unknown;
}): {
  content: AdapterProfileContentV1;
  compatibility: ProfileCompatibilityConstraintsV1;
  contentSha256: string;
} {
  const content = AdapterProfileContentV1Schema.parse(input.content);
  const compatibility = ProfileCompatibilityConstraintsV1Schema.parse(
    input.compatibility,
  );
  const canonical = canonicalizeJson({ content, compatibility });
  if (canonical.byteLength > MAX_PROFILE_BYTES)
    throw new Error("PROFILE_CONTENT_TOO_LARGE");
  return {
    content,
    compatibility,
    contentSha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

export const PROFILE_MAX_SERIALIZED_BYTES = MAX_PROFILE_BYTES;

export function assertProfileRevisionTransition(
  from: ProfileRevisionState,
  to: ProfileRevisionState,
): void {
  const allowed =
    from === to ||
    (from === "DRAFT" && to === "CANDIDATE") ||
    (from === "CANDIDATE" && to === "PUBLISHED") ||
    (from === "PUBLISHED" && to === "RETIRED");
  if (!allowed) throw new Error("INVALID_PROFILE_REVISION_TRANSITION");
}

export function profileRevisionFingerprint(input: {
  content: unknown;
  compatibility: unknown;
}): string {
  return validateProfileContent(input).contentSha256;
}

export const ProfileMutationContextSchema = z.discriminatedUnion("actorType", [
  z
    .object({
      actorType: z.literal("SYSTEM"),
      actorId: z.uuid().optional(),
      correlationId: z.string().min(1).max(128),
      reason: z.string().min(1).max(512),
    })
    .strict(),
  z
    .object({
      actorType: z.literal("ADMIN"),
      actorId: z.uuid(),
      correlationId: z.string().min(1).max(128),
      reason: z.string().min(1).max(512),
    })
    .strict(),
]);
export type ProfileMutationContext = z.infer<
  typeof ProfileMutationContextSchema
>;
export const AssignmentSubjectKindSchema = z.enum(["ACCOUNT", "DEVICE"]);
export const AssignmentModeSchema = z.enum(["DIRECT", "ROLLOUT", "PAUSED"]);
export type AssignmentSubjectKind = z.infer<typeof AssignmentSubjectKindSchema>;
export type AssignmentMode = z.infer<typeof AssignmentModeSchema>;
export const P7_PROFILE_ROLLOUT_KEY = "ai.profile.assignment" as const;
const AssignmentPercentageSchema = z.number().int().min(0).max(10000);
export const AssignmentScopeCommandSchema = z
  .object({
    adapterId: z.uuid(),
    surfaceId: z.uuid(),
    variantId: z.uuid().nullable(),
    browserFamily: BrowserFamilySchema,
    subjectKind: AssignmentSubjectKindSchema,
  })
  .strict();
export type AssignmentScopeCommand = z.infer<
  typeof AssignmentScopeCommandSchema
>;
export const AssignmentExpectedRevisionSchema = z
  .number()
  .int()
  .positive()
  .nullable();
export const RolloutCommandSchema = z
  .object({
    assignmentId: z.uuid(),
    baselineProfileRevisionId: z.uuid(),
    candidateProfileRevisionId: z.uuid(),
    percentageBps: AssignmentPercentageSchema,
    expectedLatestAssignmentRevision: AssignmentExpectedRevisionSchema,
  })
  .strict();
export const DirectAssignmentCommandSchema = z
  .object({
    assignmentId: z.uuid(),
    baselineProfileRevisionId: z.uuid(),
    expectedLatestAssignmentRevision: AssignmentExpectedRevisionSchema,
  })
  .strict();
export const AssignmentMutationCommandSchema = z
  .object({
    assignmentId: z.uuid(),
    expectedLatestAssignmentRevision: z.number().int().positive(),
  })
  .strict();
export const ChangeRolloutPercentageCommandSchema =
  AssignmentMutationCommandSchema.extend({
    percentageBps: AssignmentPercentageSchema,
  }).strict();
export const RollbackAssignmentCommandSchema =
  AssignmentMutationCommandSchema.extend({
    profileRevisionId: z.uuid(),
  }).strict();
export type RolloutCommand = z.infer<typeof RolloutCommandSchema>;
export type DirectAssignmentCommand = z.infer<
  typeof DirectAssignmentCommandSchema
>;
export type AssignmentMutationCommand = z.infer<
  typeof AssignmentMutationCommandSchema
>;
export type ChangeRolloutPercentageCommand = z.infer<
  typeof ChangeRolloutPercentageCommandSchema
>;
export type RollbackAssignmentCommand = z.infer<
  typeof RollbackAssignmentCommandSchema
>;
export function selectAssignedProfileRevision(input: {
  mode: AssignmentMode;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
  cohortSeed: Buffer;
  subjectKind: AssignmentSubjectKind;
  subjectId: string;
}): string {
  AssignmentModeSchema.parse(input.mode);
  AssignmentPercentageSchema.parse(input.percentageBps);
  if (input.mode !== "ROLLOUT" || !input.candidateProfileRevisionId)
    return input.baselineProfileRevisionId;
  return selectRolloutCandidateV1({
    state: "ACTIVE",
    percentageBps: input.percentageBps,
    rolloutKey: P7_PROFILE_ROLLOUT_KEY,
    cohortSeed: input.cohortSeed,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
  })
    ? input.candidateProfileRevisionId
    : input.baselineProfileRevisionId;
}
export interface ProfileLifecycleRepository {
  createDraftProfileRevision(input: {
    profileId: string;
    content: unknown;
    compatibility: unknown;
    context: ProfileMutationContext;
  }): Promise<PersistedProfileRevision>;
  updateDraftProfileRevision(input: {
    profileId: string;
    revision: number;
    content: unknown;
    compatibility: unknown;
    expectedContentSha256: string;
    context: ProfileMutationContext;
  }): Promise<PersistedProfileRevision>;
  markProfileRevisionCandidate(input: {
    profileId: string;
    revision: number;
    context: ProfileMutationContext;
  }): Promise<PersistedProfileRevision>;
  publishProfileRevision(input: {
    profileId: string;
    revision: number;
    context: ProfileMutationContext;
  }): Promise<PersistedProfileRevision>;
  retireProfileRevision(input: {
    profileId: string;
    revision: number;
    context: ProfileMutationContext;
  }): Promise<PersistedProfileRevision>;
  createAssignmentScope(input: {
    scope: AssignmentScopeCommand;
    context: ProfileMutationContext;
  }): Promise<{ id: string; cohortSeed: Buffer }>;
  assignDirect(
    input: DirectAssignmentCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
  startRollout(
    input: RolloutCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
  changeRolloutPercentage(
    input: ChangeRolloutPercentageCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
  pauseProfileRollout(
    input: AssignmentMutationCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
  resumeProfileRollout(
    input: AssignmentMutationCommand & {
      context: ProfileMutationContext;
      percentageBps?: number;
    },
  ): Promise<unknown>;
  completeRollout(
    input: AssignmentMutationCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
  rollbackProfileAssignment(
    input: RollbackAssignmentCommand & { context: ProfileMutationContext },
  ): Promise<unknown>;
}
