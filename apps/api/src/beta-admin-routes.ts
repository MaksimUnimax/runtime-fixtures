import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import type { BetaAdmissionService } from "@product/beta-access";
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
