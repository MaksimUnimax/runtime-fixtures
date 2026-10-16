import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AuthService } from "@product/auth";
import { normalizeEmail } from "@product/auth";
import {
  ApiErrorEnvelopeV1Schema,
  OtpRequestBodyV1Schema,
  OtpRequestResponseV1Schema,
  OtpVerifyBodyV1Schema,
  OtpVerifyResponseV1Schema,
} from "@product/contracts";
import { validOtpVerifyIdempotencyKey } from "@product/auth";
import { ControlledError } from "./app.js";

const sessionCookie = "pcp_portal_session",
  csrfCookie = "pcp_csrf";
export function registerAuthRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  auth: AuthService,
  production: boolean,
): void {
  const error = (
    code:
      | "AUTH_RATE_LIMITED"
      | "AUTH_OTP_INVALID"
      | "AUTH_LOGIN_DENIED"
      | "AUTH_CSRF_INVALID"
      | "BETA_CLOSED"
      | "BETA_CAPACITY_REACHED",
  ) =>
    new ControlledError(
      code,
      code === "AUTH_RATE_LIMITED"
        ? "Authentication rate limited"
        : code === "BETA_CLOSED"
          ? "Beta registration is currently closed. If you already have an account, sign in."
          : code === "BETA_CAPACITY_REACHED"
            ? "Beta registration is currently full. If you already have an account, sign in."
            : "Authentication failed",
      code === "AUTH_RATE_LIMITED"
        ? 429
        : code === "AUTH_LOGIN_DENIED" ||
            code === "AUTH_CSRF_INVALID" ||
            code === "BETA_CLOSED" ||
            code === "BETA_CAPACITY_REACHED"
          ? 403
          : 401,
    );
  app.post(
    "/v1/auth/otp/request",
    {
      schema: {
        body: OtpRequestBodyV1Schema,
        response: {
          202: OtpRequestResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const body = OtpRequestBodyV1Schema.parse(request.body);
      if (!normalizeEmail(body.email))
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const result = await auth.requestOtp(body.email, request.ip, request.id);
      if (!result.ok) throw error(result.code);
      reply.header("cache-control", "no-store");
      return reply.status(202).send({
        status: "accepted",
        challengeId: result.value.challengeId,
        expiresAt: result.value.expiresAt.toISOString(),
      });
    },
  );
  app.post(
    "/v1/auth/otp/verify",
    {
      schema: {
        body: OtpVerifyBodyV1Schema,
        response: {
          200: OtpVerifyResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const body = OtpVerifyBodyV1Schema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      if (
        idempotencyKey !== undefined &&
        (typeof idempotencyKey !== "string" ||
          !validOtpVerifyIdempotencyKey(idempotencyKey))
      )
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      const result = await auth.verifyOtp(
        body.challengeId,
        body.code,
        request.ip,
        request.id,
        typeof idempotencyKey === "string" ? idempotencyKey : undefined,
      );
      if (!result.ok) throw error(result.code);
      // An idempotent OTP replay must never extend the original session.
      // Keep both browser cookie lifetimes within the stored session expiry.
      const remainingCookieSeconds = Math.min(
        7 * 24 * 60 * 60,
        Math.floor((result.value.expiresAt.getTime() - Date.now()) / 1_000),
      );
      if (
        !Number.isFinite(remainingCookieSeconds) ||
        remainingCookieSeconds <= 0
      )
        throw error("AUTH_OTP_INVALID");
      const options = {
        path: "/",
        sameSite: "strict" as const,
        secure: production,
      };
      reply.setCookie(sessionCookie, result.value.sessionToken, {
        ...options,
        httpOnly: true,
        maxAge: remainingCookieSeconds,
      });
      reply.setCookie(csrfCookie, auth.csrf(result.value.sessionToken), {
        ...options,
        httpOnly: false,
        maxAge: remainingCookieSeconds,
      });
      reply.header("cache-control", "no-store");
      return {
        status: "authenticated" as const,
        expiresAt: result.value.expiresAt.toISOString(),
      };
    },
  );
  app.post("/v1/auth/logout", async (request, reply) => {
    const session = request.cookies[sessionCookie];
    const clear = () => {
      reply.clearCookie(sessionCookie, {
        path: "/",
        sameSite: "strict",
        secure: production,
      });
      reply.clearCookie(csrfCookie, {
        path: "/",
        sameSite: "strict",
        secure: production,
      });
    };
    if (!session) {
      clear();
      return reply.status(204).send();
    }
    const active = await auth.authenticate(session);
    if (!active) {
      clear();
      return reply.status(204).send();
    }
    const header = request.headers["x-csrf-token"];
    const csrf = typeof header === "string" ? header : undefined;
    if (!auth.csrfValid(session, csrf, request.cookies[csrfCookie]))
      throw error("AUTH_CSRF_INVALID");
    await auth.revoke(session, request.id);
    clear();
    return reply.status(204).send();
  });
}
