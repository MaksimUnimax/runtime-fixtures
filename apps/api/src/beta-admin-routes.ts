import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type {
  BetaAdmissionService,
  BetaIdentityInvitation,
  BetaIdentityInvitationMutationResult,
} from "@product/beta-access";
import { normalizeEmail } from "@product/auth";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import {
  ApiErrorEnvelopeV1Schema,
  BetaAdmissionMutationBodyV1Schema,
  BetaAdmissionResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";
import { z } from "zod";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;

const InvitationStatusSchema = z.enum([
  "PENDING",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
]);
const InvitationViewSchema = z
  .object({
    invitationId: z.uuid(),
    status: InvitationStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    consumedAt: z.string().datetime({ offset: true }).nullable(),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
const InvitationMutationResponseSchema = InvitationViewSchema.extend({
  replay: z.boolean(),
}).strict();
const RequestIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const ReasonSchema = z.string().min(1).max(512);
const InvitationCreateBodySchema = z
  .object({
    requestId: RequestIdSchema,
    expectedRevision: z.number().int().min(1),
    email: z.string().min(3).max(320),
    reason: ReasonSchema,
  })
  .strict();
const InvitationRevokeBodySchema = z
  .object({
    requestId: RequestIdSchema,
    reason: ReasonSchema,
  })
  .strict();
const InvitationParamsSchema = z.object({ invitation_id: z.uuid() }).strict();

function invitationView(value: BetaIdentityInvitation) {
  return {
    invitationId: value.id,
    status: value.status,
    createdAt: value.createdAt.toISOString(),
    expiresAt: value.expiresAt.toISOString(),
    consumedAt: value.consumedAt?.toISOString() ?? null,
    revokedAt: value.revokedAt?.toISOString() ?? null,
  };
}

function mutationError(
  result: Exclude<BetaIdentityInvitationMutationResult, { kind: "APPLIED" }>,
): never {
  if (result.kind === "FORBIDDEN")
    throw new ControlledError(
      "ADMIN_FORBIDDEN",
      "Admin authentication failed",
      403,
    );
  if (result.kind === "STALE")
    throw new ControlledError("ADMIN_STATE_STALE", "Admin state is stale", 409);
  if (result.kind === "NOT_FOUND")
    throw new ControlledError(
      "ADMIN_RESOURCE_NOT_FOUND",
      "Admin resource not found",
      404,
    );
  if (result.kind === "CAPACITY_REACHED")
    throw new ControlledError(
      "ADMIN_CONFLICT",
      "No beta capacity remains for a targeted invitation",
      409,
    );
  throw new ControlledError(
    "ADMIN_CONFLICT",
    "Admin operation conflicts with current state",
    409,
  );
}

export function registerBetaAdminRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: BetaAdmissionService,
): void {
  app.get(
    "/v1/admin/beta/admission",
    {
      schema: {
        response: {
          200: BetaAdmissionResponseV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "beta.admission.read");
      try {
        const value = await service.read();
        reply.header("cache-control", "no-store");
        return serialize(value);
      } catch {
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
    },
  );

  app.get(
    "/v1/admin/beta/admission/accounts/:account_id",
    {
      schema: {
        params: z.object({ account_id: z.uuid() }).strict(),
        response: {
          200: z
            .object({
              accountId: z.uuid(),
              admitted: z.boolean(),
            })
            .strict(),
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "beta.admission.read");
      try {
        const { account_id: accountId } = z
          .object({ account_id: z.uuid() })
          .strict()
          .parse(request.params);
        const value = await service.resolve(accountId);
        reply.header("cache-control", "no-store");
        return { accountId, admitted: value.kind === "BETA" };
      } catch (error) {
        if (error instanceof z.ZodError) throw error;
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
    },
  );

  app.get(
    "/v1/admin/beta/invitations/:invitation_id",
    {
      schema: {
        params: InvitationParamsSchema,
        response: {
          200: InvitationViewSchema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "beta.admission.read");
      const { invitation_id: invitationId } = InvitationParamsSchema.parse(
        request.params,
      );
      try {
        const value = await service.readIdentityInvitation(invitationId);
        if (!value)
          throw new ControlledError(
            "ADMIN_RESOURCE_NOT_FOUND",
            "Admin resource not found",
            404,
          );
        reply.header("cache-control", "no-store");
        return invitationView(value);
      } catch (error) {
        if (error instanceof ControlledError) throw error;
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
    },
  );

  app.post(
    "/v1/admin/beta/invitations",
    {
      schema: {
        body: InvitationCreateBodySchema,
        response: {
          200: InvitationMutationResponseSchema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const principal = await guard.requireAdminMutation(
        request,
        "beta.admission.manage",
      );
      const body = InvitationCreateBodySchema.parse(request.body);
      const email = normalizeEmail(body.email);
      if (!email)
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      let result;
      try {
        result = await service.createIdentityInvitation({
          actorPrincipalId: principal.subject.adminPrincipalId,
          requestId: body.requestId,
          correlationId: request.id,
          expectedRevision: body.expectedRevision,
          normalizedIdentityTarget: email,
          reason: body.reason,
        });
      } catch {
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
      if (result.kind !== "APPLIED") mutationError(result);
      reply.header("cache-control", "no-store");
      return { ...invitationView(result.invitation), replay: result.replay };
    },
  );

  app.post(
    "/v1/admin/beta/invitations/:invitation_id/revoke",
    {
      schema: {
        params: InvitationParamsSchema,
        body: InvitationRevokeBodySchema,
        response: {
          200: InvitationMutationResponseSchema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const principal = await guard.requireAdminMutation(
        request,
        "beta.admission.manage",
      );
      const { invitation_id: invitationId } = InvitationParamsSchema.parse(
        request.params,
      );
      const body = InvitationRevokeBodySchema.parse(request.body);
      let result;
      try {
        result = await service.revokeIdentityInvitation({
          actorPrincipalId: principal.subject.adminPrincipalId,
          invitationId,
          requestId: body.requestId,
          correlationId: request.id,
          reason: body.reason,
        });
      } catch {
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
      if (result.kind !== "APPLIED") mutationError(result);
      reply.header("cache-control", "no-store");
      return { ...invitationView(result.invitation), replay: result.replay };
    },
  );

  app.post(
    "/v1/admin/beta/admission",
    {
      schema: {
        body: BetaAdmissionMutationBodyV1Schema,
        response: {
          200: BetaAdmissionResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const principal = await guard.requireAdminMutation(
        request,
        "beta.admission.manage",
      );
      const body = BetaAdmissionMutationBodyV1Schema.parse(request.body);
      let result;
      try {
        result = await service.mutate({
          ...body,
          actorPrincipalId: principal.subject.adminPrincipalId,
          correlationId: request.id,
        });
      } catch {
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
      if (result.kind === "FORBIDDEN")
        throw new ControlledError(
          "ADMIN_FORBIDDEN",
          "Admin authentication failed",
          403,
        );
      if (result.kind === "STALE")
        throw new ControlledError(
          "ADMIN_STATE_STALE",
          "Admin state is stale",
          409,
        );
      if (result.kind === "CONFLICT")
        throw new ControlledError(
          "ADMIN_CONFLICT",
          "Admin operation conflicts with current state",
          409,
        );
      if (result.kind !== "APPLIED")
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      reply.header("cache-control", "no-store");
      return serialize(result.state);
    },
  );
}

function serialize(value: Awaited<ReturnType<BetaAdmissionService["read"]>>) {
  return { ...value, updatedAt: value.updatedAt.toISOString() };
}
