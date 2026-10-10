import { PromptTreeTargetSchema, PromptTreeSaveSchema, PromptTreePublishSchema,
  PromptTreeRollbackSchema, PromptTreeStateSchema } from "@product/admin-ai";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import {
  AdminAiAdapterQuerySchema,
  AdminAiAdapterSchema,
  AdminAiAdaptersResponseSchema,
  AdminAiAssignmentQuerySchema,
  AdminAiAssignmentRevisionsResponseSchema,
  AdminAiAssignmentScopeSchema,
  AdminAiAssignmentMutationSchema,
  AdminAiAssignmentSchema,
  AdminAiAssignmentsResponseSchema,
  AdminAiCreateAdapterSchema,
  AdminAiCreateProfileSchema,
  AdminAiCreateSurfaceSchema,
  AdminAiCreateVariantSchema,
  AdminAiDirectSchema,
  AdminAiMetadataSchema,
  AdminAiPercentageSchema,
  AdminAiProfileQuerySchema,
  AdminAiProfileSchema,
  AdminAiProfilesResponseSchema,
  AdminAiRevisionCommandSchema,
  AdminAiRevisionCreateSchema,
  AdminAiRevisionReplaceSchema,
  AdminAiRevisionQuerySchema,
  AdminAiRevisionSchema,
  AdminAiRevisionsResponseSchema,
  AdminAiResumeSchema,
  AdminAiRollbackSchema,
  AdminAiRolloutSchema,
  AdminAiStatusSchema,
  AdminAiSurfaceQuerySchema,
  AdminAiSurfaceSchema,
  AdminAiSurfacesResponseSchema,
  AdminAiVariantQuerySchema,
  AdminAiVariantSchema,
  AdminAiVariantsResponseSchema,
  AdminAiError,
  type AdminAiService,
} from "@product/admin-ai";
import type { AdminPermission } from "@product/admin-auth";
import { ApiErrorEnvelopeV1Schema } from "@product/contracts";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import { ControlledError } from "./app.js";
import { z } from "zod";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const noStore = (reply: { header(name: string, value: string): unknown }) =>
  reply.header("cache-control", "no-store");
const response = (body: z.ZodType) => ({
  response: {
    200: body,
    400: ApiErrorEnvelopeV1Schema,
    401: ApiErrorEnvelopeV1Schema,
    403: ApiErrorEnvelopeV1Schema,
    404: ApiErrorEnvelopeV1Schema,
    409: ApiErrorEnvelopeV1Schema,
    422: ApiErrorEnvelopeV1Schema,
    503: ApiErrorEnvelopeV1Schema,
  },
});
type RouteParams = {
  adapter_id: string;
  surface_id: string;
  variant_id: string;
  profile_id: string;
  assignment_id: string;
  [key: string]: string;
};
const params = (name: string) =>
  z.object({ [name]: z.uuid() }).strict() as unknown as z.ZodType<RouteParams>;
const revisionParams = z
  .object({
    profile_id: z.uuid(),
    revision: z.coerce.number().int().positive(),
  })
  .strict() as z.ZodType<{ profile_id: string; revision: number }>;
const mutationResponse = z
  .object({
    revision: z.number().int().positive(),
    mode: z.enum(["DIRECT", "ROLLOUT", "PAUSED"]),
    baselineProfileRevisionId: z.uuid(),
    candidateProfileRevisionId: z.uuid().nullable(),
    percentageBps: z.number().int().min(0).max(10000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const createdAssignmentResponse = z.object({ id: z.uuid() }).strict();

function failure(error: unknown): ControlledError {
  const code =
    error instanceof AdminAiError ? error.code : "SERVICE_UNAVAILABLE";
  if (code === "ADMIN_FORBIDDEN")
    return new ControlledError(
      "ADMIN_FORBIDDEN",
      "Admin authentication failed",
      403,
    );
  if (code === "ADMIN_RESOURCE_NOT_FOUND")
    return new ControlledError(
      "ADMIN_RESOURCE_NOT_FOUND",
      "Admin resource not found",
      404,
    );
  if (code === "ADMIN_STATE_STALE")
    return new ControlledError(
      "ADMIN_STATE_STALE",
      "Admin state is stale",
      409,
    );
  if (code === "ADMIN_INVALID_LIFECYCLE")
    return new ControlledError(
      "ADMIN_INVALID_LIFECYCLE",
      "Profile lifecycle transition is invalid",
      409,
    );
  if (code === "ADMIN_ASSIGNMENT_TARGET_INELIGIBLE")
    return new ControlledError(
      "ADMIN_ASSIGNMENT_TARGET_INELIGIBLE",
      "Assignment target is not eligible",
      409,
    );
  if (code === "ADMIN_INVALID_HIERARCHY_BINDING")
    return new ControlledError(
      "ADMIN_INVALID_HIERARCHY_BINDING",
      "AI hierarchy binding is invalid",
      422,
    );
  if (code === "ADMIN_CONFLICT")
    return new ControlledError(
      "ADMIN_CONFLICT",
      "Admin operation conflicts with current state",
      409,
    );
  if (code === "INVALID_REQUEST")
    return new ControlledError("INVALID_REQUEST", "Invalid request", 400);
  return new ControlledError("SERVICE_UNAVAILABLE", "Service unavailable", 503);
}
async function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw failure(error);
  }
}
function isoEntity<T extends { createdAt: Date; updatedAt: Date }>(value: T) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
function revision(value: unknown) {
  const row = value as {
    revision: number;
    mode: string;
    baselineProfileRevisionId: string;
    candidateProfileRevisionId: string | null;
    percentageBps: number;
    createdAt: Date;
  };
  return {
    revision: row.revision,
    mode: row.mode,
    baselineProfileRevisionId: row.baselineProfileRevisionId,
    candidateProfileRevisionId: row.candidateProfileRevisionId,
    percentageBps: row.percentageBps,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  };
}
function permission(value: AdminPermission): AdminPermission {
  return value;
}

export function registerAdminAiRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: AdminAiService,
): void {
  const treeParams = z.object({ target: PromptTreeTargetSchema }).strict();
  app.get("/v1/admin/ai/prompt-trees/:target", { schema: { params: treeParams, ...response(PromptTreeStateSchema) } }, async (request, reply) => {
    await guard.requireAdminPermission(request, permission("ai.registry.read"));
    const { target } = treeParams.parse(request.params);
    const value = await invoke(() => service.getPromptTree(target));
    if (!value) throw new ControlledError("ADMIN_RESOURCE_NOT_FOUND", "AI tree not found", 404);
    noStore(reply); return value;
  });
  const mutations = [
    ["draft", PromptTreeSaveSchema, (t: string, b: unknown, a: {actorId:string;correlationId:string}) => service.savePromptTree(t,b,a)],
    ["publish", PromptTreePublishSchema, (t: string, b: unknown, a: {actorId:string;correlationId:string}) => service.publishPromptTree(t,b,a)],
    ["rollback", PromptTreeRollbackSchema, (t: string, b: unknown, a: {actorId:string;correlationId:string}) => service.rollbackPromptTree(t,b,a)],
  ] as const;
  for (const [action, schema, perform] of mutations) app.post(`/v1/admin/ai/prompt-trees/:target/${action}`,
    { schema: { params: treeParams, body: schema, ...response(PromptTreeStateSchema) } }, async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(request, permission("ai.registry.manage"));
      const { target } = treeParams.parse(request.params);
      const value = await invoke(() => perform(target, schema.parse(request.body), {actorId:subject.adminPrincipalId,correlationId:request.id}));
      noStore(reply); return value;
    });
  app.get(
    "/v1/admin/ai/registry/adapters",
    {
      schema: {
        querystring: AdminAiAdapterQuerySchema,
        ...response(AdminAiAdaptersResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.registry.read"),
      );
      const value = await invoke(() =>
        service.listAdapters(AdminAiAdapterQuerySchema.parse(request.query)),
      );
      noStore(reply);
      return {
        items: value.items.map(isoEntity),
        nextCursor: value.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/ai/registry/adapters/:adapter_id/surfaces",
    {
      schema: {
        params: params("adapter_id"),
        querystring: AdminAiSurfaceQuerySchema,
        ...response(AdminAiSurfacesResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.registry.read"),
      );
      const p = params("adapter_id").parse(request.params);
      const q = AdminAiSurfaceQuerySchema.parse(request.query);
      const value = await invoke(() =>
        service.listSurfaces({ adapterId: p.adapter_id!, ...q }),
      );
      noStore(reply);
      return {
        items: value.items.map(isoEntity),
        nextCursor: value.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/ai/registry/surfaces/:surface_id/variants",
    {
      schema: {
        params: params("surface_id"),
        querystring: AdminAiVariantQuerySchema,
        ...response(AdminAiVariantsResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.registry.read"),
      );
      const p = params("surface_id").parse(request.params);
      const q = AdminAiVariantQuerySchema.parse(request.query);
      const value = await invoke(() =>
        service.listVariants({ surfaceId: p.surface_id!, ...q }),
      );
      noStore(reply);
      return {
        items: value.items.map(isoEntity),
        nextCursor: value.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/ai/profiles",
    {
      schema: {
        querystring: AdminAiProfileQuerySchema,
        ...response(AdminAiProfilesResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.profile.read"),
      );
      const value = await invoke(() =>
        service.listProfiles(AdminAiProfileQuerySchema.parse(request.query)),
      );
      noStore(reply);
      return {
        items: value.items.map(isoEntity),
        nextCursor: value.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/ai/profiles/:profile_id",
    {
      schema: {
        params: params("profile_id"),
        ...response(AdminAiProfileSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.profile.read"),
      );
      const p = params("profile_id").parse(request.params);
      const value = await invoke(() => service.getProfile(p.profile_id!));
      if (!value)
        throw new ControlledError(
          "ADMIN_RESOURCE_NOT_FOUND",
          "Admin resource not found",
          404,
        );
      noStore(reply);
      return isoEntity(value);
    },
  );
  app.get(
    "/v1/admin/ai/profiles/:profile_id/revisions",
    {
      schema: {
        params: params("profile_id"),
        querystring: AdminAiRevisionQuerySchema,
        ...response(AdminAiRevisionsResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.profile.read"),
      );
      const p = params("profile_id").parse(request.params);
      const q = AdminAiRevisionQuerySchema.parse(request.query);
      const value = await invoke(() =>
        service.listProfileRevisions({ profileId: p.profile_id!, ...q }),
      );
      noStore(reply);
      return {
        items: value.items.map((v) => ({
          ...v,
          createdAt: v.createdAt,
          publishedAt: v.publishedAt,
        })),
        nextCursor: value.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/ai/profiles/:profile_id/revisions/:revision",
    { schema: { params: revisionParams, ...response(AdminAiRevisionSchema) } },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.profile.read"),
      );
      const p = revisionParams.parse(request.params);
      const value = await invoke(() =>
        service.getProfileRevision({
          profileId: p.profile_id!,
          revision: p.revision,
        }),
      );
      if (!value)
        throw new ControlledError(
          "ADMIN_RESOURCE_NOT_FOUND",
          "Admin resource not found",
          404,
        );
      noStore(reply);
      return value;
    },
  );
  app.get(
    "/v1/admin/ai/assignments",
    {
      schema: {
        querystring: AdminAiAssignmentQuerySchema,
        ...response(AdminAiAssignmentsResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.assignment.read"),
      );
      const value = await invoke(() =>
        service.listAssignments(
          AdminAiAssignmentQuerySchema.parse(request.query),
        ),
      );
      noStore(reply);
      return { items: value.items, nextCursor: value.nextCursor };
    },
  );
  app.get(
    "/v1/admin/ai/assignments/:assignment_id",
    {
      schema: {
        params: params("assignment_id"),
        ...response(AdminAiAssignmentSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.assignment.read"),
      );
      const p = params("assignment_id").parse(request.params);
      const value = await invoke(() => service.getAssignment(p.assignment_id!));
      if (!value)
        throw new ControlledError(
          "ADMIN_RESOURCE_NOT_FOUND",
          "Admin resource not found",
          404,
        );
      noStore(reply);
      return value;
    },
  );
  app.get(
    "/v1/admin/ai/assignments/:assignment_id/revisions",
    {
      schema: {
        params: params("assignment_id"),
        querystring: AdminAiRevisionQuerySchema,
        ...response(AdminAiAssignmentRevisionsResponseSchema),
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        permission("ai.assignment.read"),
      );
      const p = params("assignment_id").parse(request.params);
      const q = AdminAiRevisionQuerySchema.parse(request.query);
      const value = await invoke(() =>
        service.listAssignmentRevisions({
          assignmentId: p.assignment_id!,
          ...q,
        }),
      );
      noStore(reply);
      return { items: value.items, nextCursor: value.nextCursor };
    },
  );

  app.post(
    "/v1/admin/ai/registry/adapters",
    {
      schema: {
        body: AdminAiCreateAdapterSchema,
        ...response(AdminAiAdapterSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.registry.manage"),
      );
      const b = AdminAiCreateAdapterSchema.parse(request.body);
      const value = await invoke(() =>
        service.createAdapter({
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return isoEntity(value);
    },
  );
  app.post(
    "/v1/admin/ai/registry/surfaces",
    {
      schema: {
        body: AdminAiCreateSurfaceSchema,
        ...response(AdminAiSurfaceSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.registry.manage"),
      );
      const b = AdminAiCreateSurfaceSchema.parse(request.body);
      const value = await invoke(() =>
        service.createSurface({
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return isoEntity(value);
    },
  );
  app.post(
    "/v1/admin/ai/registry/variants",
    {
      schema: {
        body: AdminAiCreateVariantSchema,
        ...response(AdminAiVariantSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.registry.manage"),
      );
      const b = AdminAiCreateVariantSchema.parse(request.body);
      const value = await invoke(() =>
        service.createVariant({
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return isoEntity(value);
    },
  );
  app.post(
    "/v1/admin/ai/profiles",
    {
      schema: {
        body: AdminAiCreateProfileSchema,
        ...response(AdminAiProfileSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.profile.manage"),
      );
      const b = AdminAiCreateProfileSchema.parse(request.body);
      const value = await invoke(() =>
        service.createProfile({
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return isoEntity(value);
    },
  );

  const registerMetadata = (
    path: string,
    schema: z.ZodType,
    p: string,
    required: AdminPermission,
    operation: (
      service: AdminAiService,
      id: string,
      body: any,
      actorId: string,
      correlationId: string,
    ) => Promise<unknown>,
    output: z.ZodType,
  ) => {
    app.post(
      path,
      { schema: { params: params(p), body: schema, ...response(output) } },
      async (request, reply) => {
        const { subject } = await guard.requireAdminMutation(
          request,
          permission(required),
        );
        const pathValue = params(p).parse(request.params);
        const body = schema.parse(request.body);
        const value = await invoke(() =>
          operation(
            service,
            pathValue[p]!,
            body,
            subject.adminPrincipalId,
            request.id,
          ),
        );
        noStore(reply);
        return isoEntity(value as { createdAt: Date; updatedAt: Date });
      },
    );
  };
  registerMetadata(
    "/v1/admin/ai/registry/adapters/:adapter_id/metadata",
    AdminAiMetadataSchema,
    "adapter_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.updateAdapter({ id, ...b, actorId, correlationId }),
    AdminAiAdapterSchema,
  );
  registerMetadata(
    "/v1/admin/ai/registry/surfaces/:surface_id/metadata",
    AdminAiMetadataSchema.omit({ description: true }),
    "surface_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.updateSurface({ id, ...b, actorId, correlationId }),
    AdminAiSurfaceSchema,
  );
  registerMetadata(
    "/v1/admin/ai/registry/variants/:variant_id/metadata",
    AdminAiMetadataSchema.omit({ description: true }),
    "variant_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.updateVariant({ id, ...b, actorId, correlationId }),
    AdminAiVariantSchema,
  );
  registerMetadata(
    "/v1/admin/ai/profiles/:profile_id/metadata",
    AdminAiMetadataSchema.omit({ description: true }),
    "profile_id",
    "ai.profile.manage",
    (s, id, b, actorId, correlationId) =>
      s.updateProfile({ id, ...b, actorId, correlationId }),
    AdminAiProfileSchema,
  );
  const registerStatus = (
    path: string,
    p: string,
    required: AdminPermission,
    operation: (
      service: AdminAiService,
      id: string,
      body: any,
      actorId: string,
      correlationId: string,
    ) => Promise<unknown>,
    output: z.ZodType,
  ) => {
    app.post(
      path,
      {
        schema: {
          params: params(p),
          body: AdminAiStatusSchema,
          ...response(output),
        },
      },
      async (request, reply) => {
        const { subject } = await guard.requireAdminMutation(
          request,
          permission(required),
        );
        const pathValue = params(p).parse(request.params);
        const body = AdminAiStatusSchema.parse(request.body);
        const value = await invoke(() =>
          operation(
            service,
            pathValue[p]!,
            body,
            subject.adminPrincipalId,
            request.id,
          ),
        );
        noStore(reply);
        return isoEntity(value as { createdAt: Date; updatedAt: Date });
      },
    );
  };
  registerStatus(
    "/v1/admin/ai/registry/adapters/:adapter_id/status",
    "adapter_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.setAdapterStatus({ id, ...b, actorId, correlationId }),
    AdminAiAdapterSchema,
  );
  registerStatus(
    "/v1/admin/ai/registry/surfaces/:surface_id/status",
    "surface_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.setSurfaceStatus({ id, ...b, actorId, correlationId }),
    AdminAiSurfaceSchema,
  );
  registerStatus(
    "/v1/admin/ai/registry/variants/:variant_id/status",
    "variant_id",
    "ai.registry.manage",
    (s, id, b, actorId, correlationId) =>
      s.setVariantStatus({ id, ...b, actorId, correlationId }),
    AdminAiVariantSchema,
  );
  registerStatus(
    "/v1/admin/ai/profiles/:profile_id/status",
    "profile_id",
    "ai.profile.manage",
    (s, id, b, actorId, correlationId) =>
      s.setProfileStatus({ id, ...b, actorId, correlationId }),
    AdminAiProfileSchema,
  );

  app.post(
    "/v1/admin/ai/profiles/:profile_id/revisions",
    {
      schema: {
        params: params("profile_id"),
        body: AdminAiRevisionCreateSchema,
        ...response(AdminAiRevisionSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.profile.manage"),
      );
      const p = params("profile_id").parse(request.params);
      const b = AdminAiRevisionCreateSchema.parse(request.body);
      const value = await invoke(() =>
        service.createDraft({
          profileId: p.profile_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return value;
    },
  );
  app.post(
    "/v1/admin/ai/profiles/:profile_id/revisions/:revision/replace",
    {
      schema: {
        params: revisionParams,
        body: AdminAiRevisionReplaceSchema,
        ...response(AdminAiRevisionSchema),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.profile.manage"),
      );
      const p = revisionParams.parse(request.params);
      const b = AdminAiRevisionReplaceSchema.parse(request.body);
      const value = await invoke(() =>
        service.replaceDraft({
          profileId: p.profile_id,
          revision: p.revision,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return value;
    },
  );
  for (const [suffix, operation] of [
    ["candidate", "candidate"],
    ["publish", "publish"],
    ["retire", "retire"],
  ] as const)
    app.post(
      `/v1/admin/ai/profiles/:profile_id/revisions/:revision/${suffix}`,
      {
        schema: {
          params: revisionParams,
          body: AdminAiRevisionCommandSchema,
          ...response(AdminAiRevisionSchema),
        },
      },
      async (request, reply) => {
        const { subject } = await guard.requireAdminMutation(
          request,
          permission("ai.profile.manage"),
        );
        const p = revisionParams.parse(request.params);
        const b = AdminAiRevisionCommandSchema.parse(request.body);
        const value = await invoke(() =>
          service[operation]({
            profileId: p.profile_id,
            revision: p.revision,
            ...b,
            actorId: subject.adminPrincipalId,
            correlationId: request.id,
          }),
        );
        noStore(reply);
        return value;
      },
    );

  app.post(
    "/v1/admin/ai/assignments",
    {
      schema: {
        body: AdminAiAssignmentScopeSchema,
        ...response(createdAssignmentResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const b = AdminAiAssignmentScopeSchema.parse(request.body);
      const value = await invoke(() =>
        service.createAssignment({
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return value;
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/direct",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiDirectSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiDirectSchema.parse(request.body);
      const value = await invoke(() =>
        service.direct({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/rollout",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiRolloutSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiRolloutSchema.parse(request.body);
      const value = await invoke(() =>
        service.rollout({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/percentage",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiPercentageSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiPercentageSchema.parse(request.body);
      const value = await invoke(() =>
        service.percentage({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/pause",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiAssignmentMutationSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiAssignmentMutationSchema.parse(request.body);
      const value = await invoke(() =>
        service.pause({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/resume",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiResumeSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiResumeSchema.parse(request.body);
      const value = await invoke(() =>
        service.resume({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/complete",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiAssignmentMutationSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiAssignmentMutationSchema.parse(request.body);
      const value = await invoke(() =>
        service.complete({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
  app.post(
    "/v1/admin/ai/assignments/:assignment_id/rollback",
    {
      schema: {
        params: params("assignment_id"),
        body: AdminAiRollbackSchema,
        ...response(mutationResponse),
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        permission("ai.assignment.manage"),
      );
      const p = params("assignment_id").parse(request.params);
      const b = AdminAiRollbackSchema.parse(request.body);
      const value = await invoke(() =>
        service.rollback({
          assignmentId: p.assignment_id,
          ...b,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      noStore(reply);
      return revision(value);
    },
  );
}
