import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { BrowserFamily } from "@product/shared";
import type { AuthService } from "@product/auth";
import {
  type DeviceManagementService,
  validExchangeIdempotencyKey,
} from "@product/device-management";
import {
  ApiErrorEnvelopeV1Schema,
  DeviceAuthorizationExchangeBodyV1Schema,
  DeviceAuthorizationExchangeResponseV1Schema,
  DeviceListQueryV1Schema,
  DeviceListResponseV1Schema,
  DeviceRevokeParamsV1Schema,
  DeviceRevokeResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

const sessionCookie = "pcp_portal_session";
const csrfCookie = "pcp_csrf";
function unavailable(): ControlledError {
  return new ControlledError("SERVICE_UNAVAILABLE", "Service unavailable", 503);
}

export function registerDeviceManagementRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  auth: AuthService,
  service: DeviceManagementService,
): void {
  const portal = async (
    request: {
      cookies: Record<string, string | undefined>;
      headers: Record<string, string | string[] | undefined>;
    },
    csrfRequired: boolean,
  ) => {
    const session = request.cookies[sessionCookie];
    const active = session ? await auth.authenticate(session) : undefined;
    if (!active)
      throw new ControlledError(
        "AUTH_SESSION_INVALID",
        "Authentication required",
        401,
      );
    if (csrfRequired) {
      const header = request.headers["x-csrf-token"];
      if (
        !auth.csrfValid(
          session!,
          typeof header === "string" ? header : undefined,
          request.cookies[csrfCookie],
        )
      )
        throw new ControlledError(
          "AUTH_CSRF_INVALID",
          "CSRF validation failed",
          403,
        );
    }
    return active;
  };
  app.post(
    "/v1/device-authorizations/token",
    {
      schema: {
        body: DeviceAuthorizationExchangeBodyV1Schema,
        response: {
          200: DeviceAuthorizationExchangeResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !validExchangeIdempotencyKey(key))
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const body = DeviceAuthorizationExchangeBodyV1Schema.parse(request.body);
      let result;
      try {
        result = await service.exchange(
          body.deviceCode,
          key,
          request.ip,
          request.id,
        );
      } catch {
        throw unavailable();
      }
      if (result.kind === "PENDING") {
        reply.header("retry-after", String(result.retryAfterSeconds));
        throw new ControlledError(
          "DEVICE_AUTH_PENDING",
          "Device authorization pending",
          409,
        );
      }
      if (result.kind === "DEVICE_LIMIT_REACHED")
        throw new ControlledError(
          "DEVICE_LIMIT_REACHED",
          "Device limit reached",
          409,
        );
      if (result.kind === "SUBSCRIPTION_REQUIRED")
        throw new ControlledError(
          "SUBSCRIPTION_REQUIRED",
          "An eligible subscription is required",
          403,
        );
      if (result.kind === "CLOSED")
        throw new ControlledError(
          "DEVICE_AUTH_CLOSED",
          "Device authorization unavailable",
          409,
        );
      if (result.kind === "INVALID")
        throw new ControlledError(
          "DEVICE_AUTH_INVALID",
          "Device authorization invalid",
          401,
        );
      if (result.kind === "RATE_LIMITED") {
        if (result.retryAfterSeconds && result.retryAfterSeconds > 0)
          reply.header("retry-after", String(result.retryAfterSeconds));
        throw new ControlledError(
          "DEVICE_AUTH_RATE_LIMITED",
          "Device authorization rate limited",
          429,
        );
      }
      if (result.kind === "SERVICE_UNAVAILABLE") throw unavailable();
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return reply.send({
        status: "activated",
        deviceId: result.deviceId,
        sessionId: result.sessionId,
        tokenType: "Bearer",
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      });
    },
  );
  app.get(
    "/v1/devices",
    {
      schema: {
        querystring: DeviceListQueryV1Schema,
        response: {
          200: DeviceListResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await portal(request, false);
      const query = DeviceListQueryV1Schema.parse(request.query);
      let result;
      try {
        result = await service.list(
          active.userId,
          query.accountId,
          query.limit,
          query.cursor,
        );
      } catch {
        throw unavailable();
      }
      if (result.kind === "FORBIDDEN")
        throw new ControlledError(
          "DEVICE_FORBIDDEN",
          "Device access forbidden",
          403,
        );
      if (result.kind === "INVALID_CURSOR" || result.kind === "INVALID")
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      if (result.kind !== "ok") throw unavailable();
      reply.header("cache-control", "no-store");
      return reply.send({
        devices: result.devices.map((device) => ({
          ...device,
          browserFamily: device.browserFamily as BrowserFamily,
          createdAt: device.createdAt.toISOString(),
          activatedAt: device.activatedAt?.toISOString() ?? null,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          revokedAt: device.revokedAt?.toISOString() ?? null,
        })),
        nextCursor: result.nextCursor ?? null,
      });
    },
  );
  app.post(
    "/v1/devices/:device_id/revoke",
    {
      schema: {
        params: DeviceRevokeParamsV1Schema,
        response: {
          200: DeviceRevokeResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await portal(request, true);
      if (
        request.body !== undefined &&
        (typeof request.body !== "object" ||
          request.body === null ||
          Object.keys(request.body as object).length !== 0)
      )
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const params = DeviceRevokeParamsV1Schema.parse(request.params);
      let result;
      try {
        result = await service.revoke(
          active.userId,
          params.device_id,
          request.id,
        );
      } catch {
        throw unavailable();
      }
      if (result.kind === "NOT_FOUND")
        throw new ControlledError("DEVICE_NOT_FOUND", "Device not found", 404);
      reply.header("cache-control", "no-store");
      return reply.send({ status: "revoked", deviceId: params.device_id });
    },
  );
}
