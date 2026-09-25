import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AuthService } from "@product/auth";
import {
  DeviceAuthorizationService,
  validIdempotencyKey,
  type DeviceAuthorizationStartInput,
  type DeviceAuthFailure,
} from "@product/device-auth";
import {
  ApiErrorEnvelopeV1Schema,
  DeviceAuthorizationApproveBodyV1Schema,
  DeviceAuthorizationApprovedResponseV1Schema,
  DeviceAuthorizationDenyBodyV1Schema,
  DeviceAuthorizationDeniedResponseV1Schema,
  DeviceAuthorizationParamsV1Schema,
  DeviceAuthorizationStartBodyV1Schema,
  DeviceAuthorizationStartResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

const sessionCookie = "pcp_portal_session",
  csrfCookie = "pcp_csrf";
function error(code: DeviceAuthFailure): ControlledError {
  const status =
    code === "SERVICE_UNAVAILABLE"
      ? 503
      : code === "DEVICE_AUTH_RATE_LIMITED"
        ? 429
        : code === "DEVICE_AUTH_INVALID"
          ? 401
          : code === "DEVICE_AUTH_FORBIDDEN"
            ? 403
            : 409;
  return new ControlledError(
    code,
    code === "SERVICE_UNAVAILABLE"
      ? "Service temporarily unavailable"
      : code === "DEVICE_AUTH_RATE_LIMITED"
        ? "Device authorization rate limited"
        : "Device authorization unavailable",
    status,
  );
}
export function registerDeviceAuthorizationRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  auth: AuthService,
  service: DeviceAuthorizationService,
): void {
  app.post(
    "/v1/device-authorizations",
    {
      schema: {
        body: DeviceAuthorizationStartBodyV1Schema,
        response: {
          201: DeviceAuthorizationStartResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !validIdempotencyKey(key))
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const body = DeviceAuthorizationStartBodyV1Schema.parse(request.body);
      const startInput: DeviceAuthorizationStartInput =
        body.browserFamily === undefined
          ? {
              clientType: body.clientType,
              ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
            }
          : {
              clientType: body.clientType,
              browserFamily: body.browserFamily,
              ...(body.browserVersion
                ? { browserVersion: body.browserVersion }
                : {}),
              extensionVersion: body.extensionVersion!,
              ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
            };
      const result = await service.start(
        startInput,
        key,
        request.ip,
        request.id,
      );
      if (!result.ok) throw error(result.code);
      reply.header("cache-control", "no-store");
      return reply.status(201).send({
        ...result.value,
        expiresAt: result.value.expiresAt.toISOString(),
      });
    },
  );
  const principal = async (request: {
    cookies: Record<string, string | undefined>;
    headers: Record<string, string | string[] | undefined>;
    id: string;
  }) => {
    const session = request.cookies[sessionCookie];
    const active = session ? await auth.authenticate(session) : undefined;
    if (!session || !active)
      throw new ControlledError(
        "AUTH_SESSION_INVALID",
        "Authentication required",
        401,
      );
    const csrf = request.headers["x-csrf-token"];
    if (
      !auth.csrfValid(
        session,
        typeof csrf === "string" ? csrf : undefined,
        request.cookies[csrfCookie],
      )
    )
      throw new ControlledError(
        "AUTH_CSRF_INVALID",
        "CSRF validation failed",
        403,
      );
    return active;
  };
  app.post(
    "/v1/device-authorizations/:id/approve",
    {
      schema: {
        params: DeviceAuthorizationParamsV1Schema,
        body: DeviceAuthorizationApproveBodyV1Schema,
        response: {
          200: DeviceAuthorizationApprovedResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal(request);
      const body = DeviceAuthorizationApproveBodyV1Schema.parse(request.body);
      const id = (request.params as { id: string }).id;
      const result = await service.approve(
        id,
        body.accountId,
        body.userCode,
        active.userId,
        request.ip,
        request.id,
      );
      if (!result.ok) throw error(result.code);
      reply.header("cache-control", "no-store");
      return reply.send({
        status: "approved",
        authorizationId: result.value.record.id,
        expiresAt: result.value.record.expiresAt.toISOString(),
      });
    },
  );
  app.post(
    "/v1/device-authorizations/:id/deny",
    {
      schema: {
        params: DeviceAuthorizationParamsV1Schema,
        body: DeviceAuthorizationDenyBodyV1Schema,
        response: {
          200: DeviceAuthorizationDeniedResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal(request);
      const body = DeviceAuthorizationDenyBodyV1Schema.parse(request.body);
      const id = (request.params as { id: string }).id;
      const result = await service.deny(
        id,
        body.userCode,
        active.userId,
        request.ip,
        request.id,
      );
      if (!result.ok) throw error(result.code);
      reply.header("cache-control", "no-store");
      return reply.send({
        status: "denied",
        authorizationId: result.value.record.id,
      });
    },
  );
}
