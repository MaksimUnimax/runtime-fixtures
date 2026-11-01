import { rateLimitClientIp } from "./rate-limit-client-ip.js";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AuthService } from "@product/auth";
import {
  type ConnectionCodeService,
  type ConnectionPortalPrincipal,
  validConnectionOperationKey,
} from "@product/device-management";
import {
  ApiErrorEnvelopeV1Schema,
  ConnectionCodeStatusQueryV1Schema,
  ConnectionCodeStatusV1Schema,
  ConnectionCodeIssueBodyV1Schema,
  ConnectionCodeIssueResponseV1Schema,
  ConnectionCodeExchangeBodyV1Schema,
  ConnectionCodeExchangeResponseV1Schema,
  ConnectionTransferDevicesV1Schema,
  ConnectionTransferApprovalBodyV1Schema,
  ConnectionTransferApprovalResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const failures = {
  400: ApiErrorEnvelopeV1Schema,
  401: ApiErrorEnvelopeV1Schema,
  403: ApiErrorEnvelopeV1Schema,
  404: ApiErrorEnvelopeV1Schema,
  409: ApiErrorEnvelopeV1Schema,
  429: ApiErrorEnvelopeV1Schema,
  503: ApiErrorEnvelopeV1Schema,
};
const unavailable = () =>
  new ControlledError("SERVICE_UNAVAILABLE", "Connection unavailable", 503);
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw unavailable();
  }
}
function error(
  result: { kind: string; retryAfterSeconds?: number },
  reply: FastifyReply,
): never {
  switch (result.kind) {
    case "INVALID":
      throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
    case "CLOSED":
      throw new ControlledError(
        "CONNECTION_CODE_CLOSED",
        "Connection code unavailable",
        401,
      );
    case "CONFLICT":
      throw new ControlledError(
        "CONNECTION_CODE_CONFLICT",
        "Connection operation conflicts with its saved state",
        409,
      );
    case "REAUTH_REQUIRED":
      throw new ControlledError(
        "CONNECTION_REAUTH_REQUIRED",
        "Confirm your email again",
        403,
      );
    case "FORBIDDEN":
    case "forbidden":
      throw new ControlledError(
        "ACCOUNT_FORBIDDEN",
        "Account access forbidden",
        403,
      );
    case "NOT_FOUND":
      throw new ControlledError("DEVICE_NOT_FOUND", "Device unavailable", 404);
    case "DEVICE_LIMIT_REACHED":
      throw new ControlledError(
        "DEVICE_LIMIT_REACHED",
        "Device limit reached",
        409,
      );
    case "SUBSCRIPTION_REQUIRED":
      throw new ControlledError(
        "SUBSCRIPTION_REQUIRED",
        "An eligible subscription is required",
        403,
      );
    case "RATE_LIMITED":
      if (result.retryAfterSeconds)
        reply.header("retry-after", String(result.retryAfterSeconds));
      throw new ControlledError(
        "CONNECTION_CODE_RATE_LIMITED",
        "Connection request rate limited",
        429,
      );
    default:
      throw unavailable();
  }
}
function operationKey(request: FastifyRequest) {
  const key = request.headers["idempotency-key"];
  if (!validConnectionOperationKey(key))
    throw new ControlledError(
      "INVALID_REQUEST",
      "Idempotency key required",
      400,
    );
  return key;
}
export function registerConnectionCodeRoutes(
  app: App,
  auth: AuthService,
  service: ConnectionCodeService,
): void {
  const noStore = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
  };
  const portal = async (
    request: FastifyRequest,
    csrfRequired: boolean,
  ): Promise<ConnectionPortalPrincipal> => {
    const token = request.cookies.pcp_portal_session;
    const active = token
      ? await guarded(() => auth.authenticate(token))
      : undefined;
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
          token!,
          typeof header === "string" ? header : undefined,
          request.cookies.pcp_csrf,
        )
      )
        throw new ControlledError(
          "AUTH_CSRF_INVALID",
          "CSRF validation failed",
          403,
        );
    }
    if (
      !(active.createdAt instanceof Date) ||
      !Number.isFinite(active.createdAt.getTime())
    )
      throw unavailable();
    return {
      userId: active.userId,
      sessionId: active.sessionId,
      authenticatedAt: active.createdAt,
    };
  };
  app.get(
    "/v1/connection-codes",
    {
      onRequest: noStore,
      schema: {
        querystring: ConnectionCodeStatusQueryV1Schema,
        response: { 200: ConnectionCodeStatusV1Schema, ...failures },
      },
    },
    async (request, reply) => {
      const principal = await portal(request, false);
      const { accountId } = ConnectionCodeStatusQueryV1Schema.parse(
        request.query,
      );
      const result = await guarded(() => service.status(accountId, principal));
      if (result.kind !== "ok") return error(result, reply);
      return {
        credential: result.credential && {
          ...result.credential,
          createdAt: result.credential.createdAt.toISOString(),
        },
      };
    },
  );
  app.post(
    "/v1/connection-codes",
    {
      onRequest: noStore,
      schema: {
        body: ConnectionCodeIssueBodyV1Schema,
        response: { 200: ConnectionCodeIssueResponseV1Schema, ...failures },
      },
    },
    async (request, reply) => {
      const principal = await portal(request, true);
      const input = ConnectionCodeIssueBodyV1Schema.parse(request.body);
      const key = operationKey(request);
      const result = await guarded(() =>
        service.issue({ ...input, idempotencyKey: key }, principal, request.id),
      );
      if (result.kind !== "CREATED" && result.kind !== "ALREADY_ISSUED")
        return error(result, reply);
      const credential = {
        ...result.credential,
        createdAt: result.credential.createdAt.toISOString(),
      };
      return result.kind === "CREATED"
        ? {
            status: "created",
            code: result.code,
            credential,
            revokedDevices: result.revokedDevices,
          }
        : { status: "already_issued", credential };
    },
  );
  app.post(
    "/v1/connection-codes/exchange",
    {
      onRequest: noStore,
      schema: {
        body: ConnectionCodeExchangeBodyV1Schema,
        response: { 200: ConnectionCodeExchangeResponseV1Schema, ...failures },
      },
    },
    async (request, reply) => {
      const input = ConnectionCodeExchangeBodyV1Schema.parse(request.body);
      const key = operationKey(request);
      const result = await guarded(() =>
        service.exchange(
          { ...input, idempotencyKey: key },
          rateLimitClientIp(request),
          request.id,
        ),
      );
      if (result.kind !== "ACTIVATED") return error(result, reply);
      return {
        status: "activated",
        authenticationMethod: "ACCOUNT_CONNECTION_CODE",
        accountId: result.accountId,
        deviceId: result.deviceId,
        sessionId: result.sessionId,
        tokenType: "Bearer",
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      };
    },
  );
  app.get(
    "/v1/connection-codes/devices",
    {
      onRequest: noStore,
      schema: {
        querystring: ConnectionCodeStatusQueryV1Schema,
        response: { 200: ConnectionTransferDevicesV1Schema, ...failures },
      },
    },
    async (request, reply) => {
      const principal = await portal(request, false);
      const { accountId } = ConnectionCodeStatusQueryV1Schema.parse(
        request.query,
      );
      const result = await guarded(() =>
        service.listTransferDevices(accountId, principal),
      );
      if (result.kind !== "ok") return error(result, reply);
      return {
        devices: result.devices.map((device) => ({
          ...device,
          createdAt: device.createdAt.toISOString(),
          approvedAt: device.approvedAt?.toISOString() ?? null,
        })),
      };
    },
  );
  app.post(
    "/v1/connection-codes/devices/approve-transfer",
    {
      onRequest: noStore,
      schema: {
        body: ConnectionTransferApprovalBodyV1Schema,
        response: {
          200: ConnectionTransferApprovalResponseV1Schema,
          ...failures,
        },
      },
    },
    async (request, reply) => {
      const principal = await portal(request, true);
      const input = ConnectionTransferApprovalBodyV1Schema.parse(request.body);
      const result = await guarded(() =>
        service.approveTransfer(input, principal, request.id),
      );
      if (result.kind !== "APPROVED") return error(result, reply);
      return {
        status: "approved",
        deviceId: result.deviceId,
        approvedAt: result.approvedAt.toISOString(),
      };
    },
  );
}
