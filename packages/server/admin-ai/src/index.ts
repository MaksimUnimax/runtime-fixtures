import { PromptTreeTargetSchema, PromptTreeSaveSchema, PromptTreePublishSchema,
  PromptTreeRollbackSchema, type PromptTreeRepository, type PromptTreeActor } from "./prompt-tree.js";
export * from "./prompt-tree.js";
import {
  AssignmentScopeCommandSchema,
  AssignmentExpectedRevisionSchema,
  AdapterProfileContentV1Schema,
  ProfileCompatibilityConstraintsV1Schema,
  ProfileMutationContextSchema,
  ProfileRevisionStateSchema,
  BrowserFamilySchema,
  AdapterRegistryStatusSchema,
  type Adapter,
  type AdapterProfile,
  type PersistedProfileRevision,
  type Surface,
  type Variant,
  type ProfileLifecycleRepository,
} from "@product/adapter-registry";
import { z } from "zod";

const Uuid = z.uuid();
const Machine = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const Reason = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      v.trim().length > 0 &&
      [...v].every(
        (c) => (c.codePointAt(0) ?? 0) > 31 && c !== "<" && c !== ">",
      ),
    { message: "invalid operator reason" },
  )
  .transform((v) => v.trim());
const Timestamp = z.string().datetime({ offset: true });
const Limit = z.coerce.number().int().min(1).max(100).default(50);
const Cursor = Uuid.optional();
const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Uuid.nullable() }).strict();
const ReadQuery = z.object({ limit: Limit, cursor: Cursor }).strict();
const Status = z.enum(["ACTIVE", "DISABLED"]);

export const AdminAiAdapterQuerySchema = ReadQuery;
export const AdminAiSurfaceQuerySchema = ReadQuery;
export const AdminAiVariantQuerySchema = ReadQuery;
export const AdminAiProfileQuerySchema = ReadQuery.extend({
  adapterId: Uuid.optional(),
  surfaceId: Uuid.optional(),
  variantId: Uuid.optional(),
}).strict();
export const AdminAiRevisionQuerySchema = ReadQuery;
export const AdminAiAssignmentQuerySchema = ReadQuery.extend({
  adapterId: Uuid.optional(),
  surfaceId: Uuid.optional(),
  variantId: Uuid.optional(),
  browserFamily: BrowserFamilySchema.optional(),
  subjectKind: z.enum(["ACCOUNT", "DEVICE"]).optional(),
}).strict();

export const AdminAiCreateAdapterSchema = z
  .object({
    machineKey: Machine,
    displayName: z.string().min(1).max(256),
    description: z.string().max(512),
    reason: Reason,
  })
  .strict();
export const AdminAiCreateSurfaceSchema = z
  .object({
    adapterId: Uuid,
    machineKey: Machine,
    displayName: z.string().min(1).max(256),
    reason: Reason,
  })
  .strict();
export const AdminAiCreateVariantSchema = z
  .object({
    surfaceId: Uuid,
    machineKey: Machine,
    displayName: z.string().min(1).max(256),
    reason: Reason,
  })
  .strict();
export const AdminAiCreateProfileSchema = z
  .object({
    adapterId: Uuid,
    surfaceId: Uuid,
    variantId: Uuid.nullable(),
    machineKey: Machine,
    displayName: z.string().min(1).max(256),
    reason: Reason,
  })
  .strict();
export const AdminAiExpectedUpdatedAtSchema = z
  .object({ expectedUpdatedAt: Timestamp, reason: Reason })
  .strict();
export const AdminAiMetadataSchema = z
  .object({
    expectedUpdatedAt: Timestamp,
    displayName: z.string().min(1).max(256).optional(),
    description: z.string().max(512).optional(),
    reason: Reason,
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.description !== undefined);
export const AdminAiStatusSchema = z
  .object({
    expectedUpdatedAt: Timestamp,
    targetStatus: Status,
    reason: Reason,
  })
  .strict();

export const AdminAiRevisionCreateSchema = z
  .object({ content: z.unknown(), compatibility: z.unknown(), reason: Reason })
  .strict();
export const AdminAiRevisionReplaceSchema = z
  .object({
    expectedContentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    content: z.unknown(),
    compatibility: z.unknown(),
    reason: Reason,
  })
  .strict();
export const AdminAiRevisionCommandSchema = z
  .object({ reason: Reason })
  .strict();
export const AdminAiAssignmentScopeSchema = AssignmentScopeCommandSchema.extend(
  { reason: Reason },
).strict();
export const AdminAiDirectSchema = z
  .object({
    baselineProfileRevisionId: Uuid,
    expectedLatestAssignmentRevision: AssignmentExpectedRevisionSchema,
    reason: Reason,
  })
  .strict();
export const AdminAiRolloutSchema = z
  .object({
    baselineProfileRevisionId: Uuid,
    candidateProfileRevisionId: Uuid,
    percentageBps: z.number().int().min(0).max(10000),
    expectedLatestAssignmentRevision: AssignmentExpectedRevisionSchema,
    reason: Reason,
  })
  .strict();
export const AdminAiAssignmentMutationSchema = z
  .object({
    expectedLatestAssignmentRevision: z.number().int().positive(),
    reason: Reason,
  })
  .strict();
export const AdminAiPercentageSchema = AdminAiAssignmentMutationSchema.extend({
  percentageBps: z.number().int().min(0).max(10000),
}).strict();
export const AdminAiRollbackSchema = AdminAiAssignmentMutationSchema.extend({
  profileRevisionId: Uuid,
}).strict();
export const AdminAiResumeSchema = AdminAiAssignmentMutationSchema.extend({
  percentageBps: z.number().int().min(0).max(10000).optional(),
}).strict();

const dates = { createdAt: Timestamp, updatedAt: Timestamp };
export const AdminAiAdapterSchema = z
  .object({
    id: Uuid,
    machineKey: Machine,
    displayName: z.string(),
    description: z.string(),
    status: AdapterRegistryStatusSchema,
    ...dates,
  })
  .strict();
export const AdminAiSurfaceSchema = z
  .object({
    id: Uuid,
    adapterId: Uuid,
    machineKey: Machine,
    displayName: z.string(),
    status: AdapterRegistryStatusSchema,
    ...dates,
  })
  .strict();
export const AdminAiVariantSchema = z
  .object({
    id: Uuid,
    surfaceId: Uuid,
    machineKey: Machine,
    displayName: z.string(),
    status: AdapterRegistryStatusSchema,
    ...dates,
  })
  .strict();
export const AdminAiProfileSchema = z
  .object({
    id: Uuid,
    adapterId: Uuid,
    surfaceId: Uuid,
    variantId: Uuid.nullable(),
    machineKey: Machine,
    displayName: z.string(),
    status: AdapterRegistryStatusSchema,
    ...dates,
  })
  .strict();
export const AdminAiRevisionSchema = z
  .object({
    id: Uuid,
    profileId: Uuid,
    adapterId: Uuid,
    surfaceId: Uuid,
    variantId: Uuid.nullable(),
    revision: z.number().int().positive(),
    schemaVersion: z.literal("adapter_profile_v1"),
    state: ProfileRevisionStateSchema,
    content: AdapterProfileContentV1Schema,
    compatibility: ProfileCompatibilityConstraintsV1Schema,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: Timestamp,
    publishedAt: Timestamp.nullable(),
  })
  .strict();
export const AdminAiAssignmentSchema = z
  .object({
    id: Uuid,
    adapterId: Uuid,
    surfaceId: Uuid,
    variantId: Uuid.nullable(),
    browserFamily: BrowserFamilySchema,
    subjectKind: z.enum(["ACCOUNT", "DEVICE"]),
    createdAt: Timestamp,
    latest: z
      .object({
        revision: z.number().int().positive(),
        mode: z.enum(["DIRECT", "ROLLOUT", "PAUSED"]),
        baselineProfileRevisionId: Uuid,
        candidateProfileRevisionId: Uuid.nullable(),
        percentageBps: z.number().int().min(0).max(10000),
        createdAt: Timestamp,
      })
      .nullable(),
  })
  .strict();
export const AdminAiAssignmentRevisionSchema = z
  .object({
    id: Uuid,
    assignmentId: Uuid,
    revision: z.number().int().positive(),
    mode: z.enum(["DIRECT", "ROLLOUT", "PAUSED"]),
    baselineProfileRevisionId: Uuid,
    candidateProfileRevisionId: Uuid.nullable(),
    percentageBps: z.number().int().min(0).max(10000),
    createdAt: Timestamp,
  })
  .strict();
export const AdminAiAdaptersResponseSchema = Page(AdminAiAdapterSchema);
export const AdminAiSurfacesResponseSchema = Page(AdminAiSurfaceSchema);
export const AdminAiVariantsResponseSchema = Page(AdminAiVariantSchema);
export const AdminAiProfilesResponseSchema = Page(AdminAiProfileSchema);
export const AdminAiRevisionsResponseSchema = Page(AdminAiRevisionSchema);
export const AdminAiAssignmentsResponseSchema = Page(AdminAiAssignmentSchema);
export const AdminAiAssignmentRevisionsResponseSchema = Page(
  AdminAiAssignmentRevisionSchema,
);

export type AdminAiPage<T> = { items: T[]; nextCursor: string | null };
export type AdminAiRegistryReadRepository = {
  listAdapters(input: z.infer<typeof ReadQuery>): Promise<AdminAiPage<Adapter>>;
  listSurfaces(
    input: { adapterId: string } & z.infer<typeof ReadQuery>,
  ): Promise<AdminAiPage<Surface>>;
  listVariants(
    input: { surfaceId: string } & z.infer<typeof ReadQuery>,
  ): Promise<AdminAiPage<Variant>>;
  listProfiles(
    input: z.infer<typeof AdminAiProfileQuerySchema>,
  ): Promise<AdminAiPage<AdapterProfile>>;
  getProfile(id: string): Promise<AdapterProfile | null>;
  listProfileRevisions(
    input: { profileId: string } & z.infer<typeof ReadQuery>,
  ): Promise<AdminAiPage<AdminAiRevision>>;
  getProfileRevision(input: {
    profileId: string;
    revision: number;
  }): Promise<AdminAiRevision | null>;
  listAssignments(
    input: z.infer<typeof AdminAiAssignmentQuerySchema>,
  ): Promise<AdminAiPage<AdminAiAssignment>>;
  getAssignment(id: string): Promise<AdminAiAssignment | null>;
  listAssignmentRevisions(
    input: { assignmentId: string } & z.infer<typeof ReadQuery>,
  ): Promise<AdminAiPage<AdminAiAssignmentRevision>>;
};
export type AdminAiAssignment = z.infer<typeof AdminAiAssignmentSchema>;
export type AdminAiRevision = z.infer<typeof AdminAiRevisionSchema>;
export type AdminAiAssignmentRevision = z.infer<
  typeof AdminAiAssignmentRevisionSchema
>;

export type AdminAiRegistryCommandRepository = {
  promptTrees?: PromptTreeRepository;
  createAdapter(input: {
    machineKey: string;
    displayName: string;
    description: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Adapter>;
  createSurface(input: {
    adapterId: string;
    machineKey: string;
    displayName: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Surface>;
  createVariant(input: {
    surfaceId: string;
    machineKey: string;
    displayName: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Variant>;
  createProfile(input: {
    adapterId: string;
    surfaceId: string;
    variantId: string | null;
    machineKey: string;
    displayName: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<AdapterProfile>;
  updateAdapter(input: {
    id: string;
    expectedUpdatedAt: Date;
    displayName?: string;
    description?: string;
    targetStatus?: "ACTIVE" | "DISABLED";
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Adapter>;
  updateSurface(input: {
    id: string;
    expectedUpdatedAt: Date;
    displayName?: string;
    targetStatus?: "ACTIVE" | "DISABLED";
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Surface>;
  updateVariant(input: {
    id: string;
    expectedUpdatedAt: Date;
    displayName?: string;
    targetStatus?: "ACTIVE" | "DISABLED";
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<Variant>;
  updateProfile(input: {
    id: string;
    expectedUpdatedAt: Date;
    displayName?: string;
    targetStatus?: "ACTIVE" | "DISABLED";
    actorId: string;
    correlationId: string;
    reason: string;
  }): Promise<AdapterProfile>;
};

export type AdminAiErrorCode =
  | "ADMIN_FORBIDDEN"
  | "ADMIN_RESOURCE_NOT_FOUND"
  | "ADMIN_STATE_STALE"
  | "ADMIN_INVALID_LIFECYCLE"
  | "ADMIN_ASSIGNMENT_TARGET_INELIGIBLE"
  | "ADMIN_INVALID_HIERARCHY_BINDING"
  | "ADMIN_CONFLICT"
  | "INVALID_REQUEST"
  | "SERVICE_UNAVAILABLE";
export class AdminAiError extends Error {
  public constructor(
    public readonly code: AdminAiErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "AdminAiError";
  }
}
function mapError(error: unknown): AdminAiError {
  if (error instanceof AdminAiError) return error;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ADMIN_FORBIDDEN"
  )
    return new AdminAiError("ADMIN_FORBIDDEN");
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NOT_FOUND") || message.includes("not found"))
    return new AdminAiError("ADMIN_RESOURCE_NOT_FOUND");
  if (message.includes("STALE") || message.includes("EXPECTED_REVISION"))
    return new AdminAiError("ADMIN_STATE_STALE");
  if (message.includes("TARGET_INELIGIBLE"))
    return new AdminAiError("ADMIN_ASSIGNMENT_TARGET_INELIGIBLE");
  if (message.includes("HIERARCHY") || message.includes("inactive assignment"))
    return new AdminAiError("ADMIN_INVALID_HIERARCHY_BINDING");
  if (
    message.includes("TRANSITION") ||
    message.includes("ROLLOUT_NOT") ||
    message.includes("NOT_DRAFT") ||
    message.includes("PUBLISHED") ||
    message.includes("ROLLOUT_TARGETS")
  )
    return new AdminAiError("ADMIN_INVALID_LIFECYCLE");
  if (
    message.includes("CONFLICT") ||
    message.includes("unique") ||
    message.includes("duplicate")
  )
    return new AdminAiError("ADMIN_CONFLICT");
  if (message.includes("invalid") || message.includes("INVALID"))
    return new AdminAiError("INVALID_REQUEST");
  return new AdminAiError("SERVICE_UNAVAILABLE");
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapError(error);
  }
}
function ctx(actorId: string, correlationId: string, reason: string) {
  return ProfileMutationContextSchema.parse({
    actorType: "ADMIN",
    actorId,
    correlationId,
    reason,
  });
}
function safeRevision(value: PersistedProfileRevision | AdminAiRevision) {
  const iso = (date: Date | string) =>
    typeof date === "string" ? date : date.toISOString();
  return {
    id: value.id,
    profileId: value.profileId,
    adapterId: value.adapterId,
    surfaceId: value.surfaceId,
    variantId: value.variantId,
    revision: value.revision,
    schemaVersion: value.schemaVersion,
    state: value.state,
    content: value.content,
    compatibility: value.compatibility,
    contentSha256: value.contentSha256,
    createdAt: iso(value.createdAt),
    publishedAt: value.publishedAt ? iso(value.publishedAt) : null,
  };
}
export class AdminAiService {
  public constructor(
    private readonly reads: AdminAiRegistryReadRepository,
    private readonly registry: AdminAiRegistryCommandRepository,
    private readonly lifecycle: ProfileLifecycleRepository,
  ) {}
  private trees(): PromptTreeRepository {
    if (!this.registry.promptTrees) throw new AdminAiError("SERVICE_UNAVAILABLE");
    return this.registry.promptTrees;
  }
  getPromptTree(target: string) {
    return safe(() => this.trees().get(PromptTreeTargetSchema.parse(target)));
  }
  savePromptTree(target: string, input: unknown, actor: Omit<PromptTreeActor, "reason">) {
    return safe(() => this.trees().save(PromptTreeTargetSchema.parse(target), { ...PromptTreeSaveSchema.parse(input), ...actor }));
  }
  publishPromptTree(target: string, input: unknown, actor: Omit<PromptTreeActor, "reason">) {
    return safe(() => this.trees().publish(PromptTreeTargetSchema.parse(target), { ...PromptTreePublishSchema.parse(input), ...actor }));
  }
  rollbackPromptTree(target: string, input: unknown, actor: Omit<PromptTreeActor, "reason">) {
    return safe(() => this.trees().publish(PromptTreeTargetSchema.parse(target), { ...PromptTreeRollbackSchema.parse(input), ...actor }));
  }
  listAdapters(input: z.infer<typeof ReadQuery>) {
    return safe(() => this.reads.listAdapters(input));
  }
  listSurfaces(input: { adapterId: string } & z.infer<typeof ReadQuery>) {
    return safe(() => this.reads.listSurfaces(input));
  }
  listVariants(input: { surfaceId: string } & z.infer<typeof ReadQuery>) {
    return safe(() => this.reads.listVariants(input));
  }
  listProfiles(input: z.infer<typeof AdminAiProfileQuerySchema>) {
    return safe(() => this.reads.listProfiles(input));
  }
  getProfile(id: string) {
    return safe(() => this.reads.getProfile(id));
  }
  listProfileRevisions(
    input: { profileId: string } & z.infer<typeof ReadQuery>,
  ) {
    return safe(() =>
      this.reads.listProfileRevisions(input).then((value) => ({
        items: value.items.map(safeRevision),
        nextCursor: value.nextCursor,
      })),
    );
  }
  getProfileRevision(input: { profileId: string; revision: number }) {
    return safe(() =>
      this.reads
        .getProfileRevision(input)
        .then((value) => (value ? safeRevision(value) : null)),
    );
  }
  listAssignments(input: z.infer<typeof AdminAiAssignmentQuerySchema>) {
    return safe(() => this.reads.listAssignments(input));
  }
  getAssignment(id: string) {
    return safe(() => this.reads.getAssignment(id));
  }
  listAssignmentRevisions(
    input: { assignmentId: string } & z.infer<typeof ReadQuery>,
  ) {
    return safe(() => this.reads.listAssignmentRevisions(input));
  }
  createAdapter(
    input: z.infer<typeof AdminAiCreateAdapterSchema> & {
      actorId: string;
      correlationId: string;
    },
  ) {
    return safe(() => this.registry.createAdapter(input));
  }
  createSurface(
    input: z.infer<typeof AdminAiCreateSurfaceSchema> & {
      actorId: string;
      correlationId: string;
    },
  ) {
    return safe(() => this.registry.createSurface(input));
  }
  createVariant(
    input: z.infer<typeof AdminAiCreateVariantSchema> & {
      actorId: string;
      correlationId: string;
    },
  ) {
    return safe(() => this.registry.createVariant(input));
  }
  createProfile(
    input: z.infer<typeof AdminAiCreateProfileSchema> & {
      actorId: string;
      correlationId: string;
    },
  ) {
    return safe(() => this.registry.createProfile(input));
  }
  updateAdapter(
    input: { id: string } & z.infer<typeof AdminAiMetadataSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateAdapter({
        ...input,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  updateSurface(
    input: { id: string } & z.infer<typeof AdminAiMetadataSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateSurface({
        ...input,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  updateVariant(
    input: { id: string } & z.infer<typeof AdminAiMetadataSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateVariant({
        ...input,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  updateProfile(
    input: { id: string } & z.infer<typeof AdminAiMetadataSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateProfile({
        ...input,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  setAdapterStatus(
    input: { id: string } & z.infer<typeof AdminAiStatusSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateAdapter({
        ...input,
        targetStatus: input.targetStatus,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  setSurfaceStatus(
    input: { id: string } & z.infer<typeof AdminAiStatusSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateSurface({
        ...input,
        targetStatus: input.targetStatus,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  setVariantStatus(
    input: { id: string } & z.infer<typeof AdminAiStatusSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateVariant({
        ...input,
        targetStatus: input.targetStatus,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  setProfileStatus(
    input: { id: string } & z.infer<typeof AdminAiStatusSchema> & {
        actorId: string;
        correlationId: string;
      },
  ) {
    return safe(() =>
      this.registry.updateProfile({
        ...input,
        targetStatus: input.targetStatus,
        expectedUpdatedAt: new Date(input.expectedUpdatedAt),
      }),
    );
  }
  createDraft(input: {
    profileId: string;
    content: unknown;
    compatibility: unknown;
    actorId: string;
    correlationId: string;
    reason: string;
  }) {
    try {
      AdapterProfileContentV1Schema.parse(input.content);
      ProfileCompatibilityConstraintsV1Schema.parse(input.compatibility);
    } catch {
      throw new AdminAiError("INVALID_REQUEST");
    }
    return safe(() =>
      this.lifecycle
        .createDraftProfileRevision({
          ...input,
          context: ctx(input.actorId, input.correlationId, input.reason),
        })
        .then(safeRevision),
    );
  }
  replaceDraft(input: {
    profileId: string;
    revision: number;
    content: unknown;
    compatibility: unknown;
    expectedContentSha256: string;
    actorId: string;
    correlationId: string;
    reason: string;
  }) {
    return safe(() =>
      this.lifecycle
        .updateDraftProfileRevision({
          ...input,
          context: ctx(input.actorId, input.correlationId, input.reason),
        })
        .then(safeRevision),
    );
  }
  candidate(input: {
    profileId: string;
    revision: number;
    actorId: string;
    correlationId: string;
    reason: string;
  }) {
    return safe(() =>
      this.lifecycle
        .markProfileRevisionCandidate({
          ...input,
          context: ctx(input.actorId, input.correlationId, input.reason),
        })
        .then(safeRevision),
    );
  }
  publish(input: {
    profileId: string;
    revision: number;
    actorId: string;
    correlationId: string;
    reason: string;
  }) {
    return safe(() =>
      this.lifecycle
        .publishProfileRevision({
          ...input,
          context: ctx(input.actorId, input.correlationId, input.reason),
        })
        .then(safeRevision),
    );
  }
  retire(input: {
    profileId: string;
    revision: number;
    actorId: string;
    correlationId: string;
    reason: string;
  }) {
    return safe(() =>
      this.lifecycle
        .retireProfileRevision({
          ...input,
          context: ctx(input.actorId, input.correlationId, input.reason),
        })
        .then(safeRevision),
    );
  }
  createAssignment(
    input: z.infer<typeof AdminAiAssignmentScopeSchema> & {
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...scope } = input;
    return safe(() =>
      this.lifecycle
        .createAssignmentScope({
          scope,
          context: ctx(actorId, correlationId, reason),
        })
        .then((value) => ({ id: value.id })),
    );
  }
  direct(
    input: z.infer<typeof AdminAiDirectSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.assignDirect({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  rollout(
    input: z.infer<typeof AdminAiRolloutSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.startRollout({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  percentage(
    input: z.infer<typeof AdminAiPercentageSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.changeRolloutPercentage({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  pause(
    input: z.infer<typeof AdminAiAssignmentMutationSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.pauseProfileRollout({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  resume(
    input: z.infer<typeof AdminAiResumeSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.resumeProfileRollout({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  complete(
    input: z.infer<typeof AdminAiAssignmentMutationSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.completeRollout({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
  rollback(
    input: z.infer<typeof AdminAiRollbackSchema> & {
      assignmentId: string;
      actorId: string;
      correlationId: string;
    },
  ) {
    const { reason, actorId, correlationId, ...command } = input;
    return safe(() =>
      this.lifecycle.rollbackProfileAssignment({
        ...command,
        context: ctx(actorId, correlationId, reason),
      }),
    );
  }
}
