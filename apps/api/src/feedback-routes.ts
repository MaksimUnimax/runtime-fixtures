import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AuthService } from "@product/auth";
import {
  ApiErrorEnvelopeV1Schema,
  FeedbackCaseDetailResponseV1Schema,
  FeedbackCaseListResponseV1Schema,
  FeedbackCaseParamsV1Schema,
  FeedbackCreateBodyV1Schema,
  FeedbackCreatedResponseV1Schema,
  FeedbackFollowupBodyV1Schema,
  FeedbackFollowupResponseV1Schema,
  FeedbackOwnCasesQueryV1Schema,
  FeedbackSignalBodyV1Schema,
  FeedbackSignalResponseV1Schema,
} from "@product/contracts";
import type { FeedbackSupportService } from "@product/feedback-support";
import { ControlledError } from "./app.js";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;

function failure(code: string): ControlledError {
  if (code === "RATE_LIMITED")
    return new ControlledError(
      "SUPPORT_CASE_RATE_LIMITED",
      "Feedback rate limit reached",
      429,
    );
  if (code === "ACCOUNT_FORBIDDEN" || code === "FORBIDDEN")
    return new ControlledError(
      "SUPPORT_CASE_FORBIDDEN",
      "Support case is not available",
      403,
    );
  if (code === "NOT_FOUND")
    return new ControlledError(
      "SUPPORT_CASE_NOT_FOUND",
      "Support case is not available",
      404,
    );
  return new ControlledError("INVALID_REQUEST", "Invalid support request", 400);
}

export function registerFeedbackRoutes(
  app: Api,
  auth: AuthService,
  service: FeedbackSupportService,
): void {
  const principal = async (request: {
    cookies: Record<string, string | undefined>;
    headers?: Record<string, string | string[] | undefined>;
    mutation?: boolean;
  }) => {
    const session = request.cookies.pcp_portal_session;
    const active = session ? await auth.authenticate(session) : undefined;
    if (!session || !active)
      throw new ControlledError(
        "AUTH_SESSION_INVALID",
        "Authentication required",
        401,
      );
    if (request.mutation) {
      const header = request.headers?.["x-csrf-token"];
      if (
        !auth.csrfValid(
          session,
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
    return active;
  };
  const noStore = (reply: { header(name: string, value: string): unknown }) =>
    reply.header("cache-control", "no-store");

  app.post(
    "/v1/support/cases",
    {
      bodyLimit: 12_000,
      schema: {
        body: FeedbackCreateBodyV1Schema,
        response: {
          201: FeedbackCreatedResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal({
        cookies: request.cookies,
        headers: request.headers,
        mutation: true,
      });
      const result = await service.createCase(
        active.userId,
        request.body,
        request.id,
      );
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      const { followups, ...caseItem } = result.value;
      void followups;
      return reply.status(201).send({ case: caseItem });
    },
  );

  app.get(
    "/v1/support/cases",
    {
      schema: {
        querystring: FeedbackOwnCasesQueryV1Schema,
        response: {
          200: FeedbackCaseListResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal(request);
      const query = FeedbackOwnCasesQueryV1Schema.parse(request.query);
      noStore(reply);
      return {
        items: await service.listOwnCases({
          userId: active.userId,
          status: query.status,
        }),
      };
    },
  );

  app.get(
    "/v1/support/cases/:case_id",
    {
      schema: {
        params: FeedbackCaseParamsV1Schema,
        response: {
          200: FeedbackCaseDetailResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal(request);
      const params = FeedbackCaseParamsV1Schema.parse(request.params);
      const result = await service.getOwnCase({
        userId: active.userId,
        caseId: params.case_id,
      });
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      return result.value;
    },
  );

  app.post(
    "/v1/support/cases/:case_id/followups",
    {
      bodyLimit: 8_000,
      schema: {
        params: FeedbackCaseParamsV1Schema,
        body: FeedbackFollowupBodyV1Schema,
        response: {
          201: FeedbackFollowupResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal({
        cookies: request.cookies,
        headers: request.headers,
        mutation: true,
      });
      const params = FeedbackCaseParamsV1Schema.parse(request.params);
      const result = await service.addUserFollowup(
        active.userId,
        params.case_id,
        request.body,
        request.id,
      );
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      return reply.status(201).send({ followup: result.value });
    },
  );

  app.post(
    "/v1/support/signals",
    {
      bodyLimit: 4_000,
      schema: {
        body: FeedbackSignalBodyV1Schema,
        response: {
          202: FeedbackSignalResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          429: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const active = await principal({
        cookies: request.cookies,
        headers: request.headers,
        mutation: true,
      });
      const result = await service.recordSignal(
        active.userId,
        request.body,
        request.id,
      );
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      return reply.status(202).send(result.value);
    },
  );
}
