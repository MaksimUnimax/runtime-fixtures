import { rateLimitClientIp } from "./rate-limit-client-ip.js";
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { ExtensionAuthService } from "@product/extension-auth";
import {
  ApiErrorEnvelopeV1Schema,
  RefreshRequestBodyV1Schema,
  RefreshResponseV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

const idempotencyKey = /^[A-Za-z0-9._:-]{16,128}$/;

export function registerRefreshRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  auth: ExtensionAuthService,
): void {
  app.post(
    "/v1/auth/refresh",
    {
      schema: {
        body: RefreshRequestBodyV1Schema,
        response: {
          200: RefreshResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const header = request.headers["idempotency-key"];
      const key = typeof header === "string" ? header : undefined;
      if (!key || !idempotencyKey.test(key))
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const body = RefreshRequestBodyV1Schema.parse(request.body);
      let result;
      try {
        result = await auth.refresh(
          body.refreshToken,
          key,
          request.id,
          rateLimitClientIp(request),
        );
      } catch {
        throw new ControlledError(
          "SERVICE_UNAVAILABLE",
          "Service unavailable",
          503,
        );
      }
      if (!result.ok) {
        if (result.code === "EXTENSION_AUTH_RATE_LIMITED")
          if (result.retryAfterSeconds)
            reply.header("retry-after", String(result.retryAfterSeconds));
        if (result.code === "EXTENSION_AUTH_RATE_LIMITED")
          throw new ControlledError(
            "AUTH_RATE_LIMITED",
            "Authentication rate limited",
            429,
          );
        if (result.code === "SERVICE_UNAVAILABLE")
          throw new ControlledError(
            "SERVICE_UNAVAILABLE",
            "Service unavailable",
            503,
          );
        throw new ControlledError(
          "AUTH_REFRESH_INVALID",
          "Authentication failed",
          401,
        );
      }
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return reply.status(200).send({
        tokenType: "Bearer",
        accessToken: result.value.accessToken,
        accessTokenExpiresAt: result.value.accessTokenExpiresAt.toISOString(),
        refreshToken: result.value.refreshToken,
        refreshTokenExpiresAt: result.value.expiresAt.toISOString(),
      });
    },
  );
}
