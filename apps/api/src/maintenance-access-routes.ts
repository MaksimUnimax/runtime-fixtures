import type {
  MaintenanceCredentialStore,
  MaintenanceCredentialReservation,
} from "./maintenance-credential-file.js";
import { z } from "zod";
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
import type {
  AdminAuthService,
  AdminResult,
  MaintenanceGrant,
} from "@product/admin-auth";
import { MAINTENANCE_PERMISSIONS } from "@product/admin-auth";
import { ApiErrorEnvelopeV1Schema } from "@product/contracts";
import { ControlledError } from "./app.js";
import {
  createAdminRouteGuard,
  ADMIN_SESSION_COOKIE,
} from "./admin-route-guard.js";

const grantSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  permissions: z.array(z.enum(MAINTENANCE_PERMISSIONS)),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
const credentialSchema = z.object({
  token: z.string().max(128),
  expiresAt: z.string().datetime(),
});
function publicGrant(grant: MaintenanceGrant) {
  return {
    id: grant.id,
    label: grant.label,
    permissions: grant.permissions,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
  };
}
function value<T>(result: AdminResult<T>): T {
  if (result.ok) return result.value;
  const status =
    result.code === "SERVICE_UNAVAILABLE"
      ? 503
      : result.code === "ADMIN_FORBIDDEN"
        ? 403
        : 401;
  throw new ControlledError(
    result.code === "SERVICE_UNAVAILABLE" || result.code === "ADMIN_FORBIDDEN"
      ? result.code
      : "ADMIN_UNAUTHORIZED",
    "Maintenance access failed",
    status,
  );
}
const failures = {
  401: ApiErrorEnvelopeV1Schema,
  403: ApiErrorEnvelopeV1Schema,
  503: ApiErrorEnvelopeV1Schema,
};

export function registerMaintenanceAccessRoutes(
  app: Api,
  adminAuth: AdminAuthService,
  credentialStore?: MaintenanceCredentialStore,
): void {
  const guard = createAdminRouteGuard(adminAuth);
  const service = () => {
    if (!adminAuth.maintenance)
      throw new ControlledError(
        "SERVICE_UNAVAILABLE",
        "Maintenance access unavailable",
        503,
      );
    return adminAuth.maintenance;
  };
  app.get(
    "/v1/admin/maintenance-grants",
    {
      schema: {
        response: {
          200: z.object({ grants: z.array(grantSchema) }),
          ...failures,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminPermission(
        request,
        "admin.principal.manage",
      );
      reply.header("cache-control", "no-store");
      return { grants: value(await service().list(subject)).map(publicGrant) };
    },
  );
  app.post(
    "/v1/admin/maintenance-grants",
    {
      schema: {
        body: z
          .object({
            label: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/),
            delivery: z.enum(["download", "server"]).default("download"),
            permissions: z
              .array(z.enum(MAINTENANCE_PERMISSIONS))
              .min(1)
              .max(MAINTENANCE_PERMISSIONS.length),
          })
          .strict(),
        response: {
          200: z.union([
            z.object({ grant: grantSchema, credential: credentialSchema }),
            z.object({
              grant: grantSchema,
              delivery: z.literal("server"),
              saved: z.literal(true),
            }),
          ]),
          ...failures,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        "admin.principal.manage",
      );
      const body = request.body as {
        label: string;
        permissions: string[];
        delivery: "download" | "server";
      };
      const maintenance = service();
      const unavailable = () =>
        new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Server credential could not be saved",
          503,
        );
      let reservation: MaintenanceCredentialReservation | undefined;
      if (body.delivery === "server") {
        if (!credentialStore) throw unavailable();
        try {
          reservation = await credentialStore.reserve();
        } catch {
          throw unavailable();
        }
      }
      let issued: { grant: MaintenanceGrant; token: string } | undefined;
      try {
        issued = value(
          await maintenance.issue(
            subject,
            body.label,
            body.permissions,
            request.id,
          ),
        );
        reply.header("cache-control", "no-store");
        if (reservation) {
          await reservation.publish({
            token: issued.token,
            expiresAt: issued.grant.expiresAt.toISOString(),
            rotatedAt: new Date().toISOString(),
          });
          return {
            grant: publicGrant(issued.grant),
            delivery: "server" as const,
            saved: true as const,
          };
        }
        return {
          grant: publicGrant(issued.grant),
          credential: {
            token: issued.token,
            expiresAt: issued.grant.expiresAt.toISOString(),
          },
        };
      } catch (error) {
        let canDiscard = !issued;
        if (reservation && issued) {
          try {
            canDiscard = (
              await maintenance.revoke(subject, issued.grant.id, request.id)
            ).ok;
          } catch {
            canDiscard = false;
          }
        }
        // Unknown revocation retains the private pending file for explicit
        // recovery. A subsequent issuance cannot overwrite that reservation.
        if (reservation && canDiscard) {
          try {
            await reservation.abort();
          } catch {
            /* Keep private recovery evidence. */
          }
        }
        throw error instanceof ControlledError ? error : unavailable();
      }
    },
  );
  app.delete(
    "/v1/admin/maintenance-grants/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ revoked: z.literal(true) }), ...failures },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        "admin.principal.manage",
      );
      value(
        await service().revoke(
          subject,
          (request.params as { id: string }).id,
          request.id,
        ),
      );
      reply.header("cache-control", "no-store");
      return { revoked: true };
    },
  );
  app.post(
    "/v1/admin/maintenance-credential/rotate",
    {
      schema: {
        body: z
          .object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) })
          .strict(),
        response: { 200: credentialSchema, ...failures },
      },
    },
    async (request, reply) => {
      const authorization = request.headers.authorization;
      if (
        request.cookies[ADMIN_SESSION_COOKIE] ||
        !authorization?.startsWith("Bearer octm_")
      ) {
        throw new ControlledError(
          "ADMIN_UNAUTHORIZED",
          "Maintenance access failed",
          401,
        );
      }
      // The service validates current OR bounded idempotent predecessor credentials.
      // Running the ordinary guard here would break recovery of a lost rotation response.
      const rotated = value(
        await service().rotate(
          authorization.slice(7),
          (request.body as { nonce: string }).nonce,
          request.id,
        ),
      );
      reply.header("cache-control", "no-store");
      return {
        token: rotated.token,
        expiresAt: rotated.expiresAt.toISOString(),
      };
    },
  );
}
