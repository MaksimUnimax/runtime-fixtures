import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AuthService } from "@product/auth";
import type { DeviceAuthorizationService } from "@product/device-auth";
import {
  ApiErrorEnvelopeV1Schema,
  DeviceAuthorizationPreviewParamsV1Schema,
  DeviceAuthorizationPreviewResponseV1Schema,
  OwnedAccountsResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

export function registerPortalSupportRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  auth: AuthService,
  deviceAuth: DeviceAuthorizationService,
): void {
  const principal = async (request: {
    cookies: Record<string, string | undefined>;
  }) => {
    const session = request.cookies.pcp_portal_session;
    const active = session ? await auth.authenticate(session) : undefined;
    if (!active)
      throw new ControlledError(
        "AUTH_SESSION_INVALID",
        "Authentication required",
        401,
      );
    return active;
  };
  app.get(
    "/v1/accounts",
    {
      schema: {
        response: {
          200: OwnedAccountsResponseV1Schema,
          401: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal(request);
      reply.header("cache-control", "no-store");
      return { accounts: await auth.listOwnedAccounts(active.userId) };
    },
  );
  app.get(
    "/v1/device-authorizations/:id",
    {
      schema: {
        params: DeviceAuthorizationPreviewParamsV1Schema,
        response: {
          200: DeviceAuthorizationPreviewResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await principal(request);
      const id = (request.params as { id: string }).id;
      const preview = await deviceAuth.previewPendingAuthorization(id);
      if (!preview)
        throw new ControlledError(
          "DEVICE_AUTH_INVALID",
          "Device authorization unavailable",
          404,
        );
      reply.header("cache-control", "no-store");
      const common = {
        status: "pending" as const,
        authorizationId: preview.id,
        clientType: "browser_extension" as const,
        clientMetadata: preview.clientMetadata,
        deviceLabel: preview.deviceLabel,
        expiresAt: preview.expiresAt.toISOString(),
      };
      return preview.clientMetadata.state === "PRESENT"
        ? {
            ...common,
            browserFamily: preview.clientMetadata.browserFamily,
            browserVersion: preview.clientMetadata.browserVersion,
            extensionVersion: preview.clientMetadata.extensionVersion,
          }
        : common;
    },
  );
}
