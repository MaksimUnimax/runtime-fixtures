import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import type { FeedbackSupportService } from "@product/feedback-support";
import {
  ApiErrorEnvelopeV1Schema,
  FeedbackAdminCasesQueryV1Schema,
  FeedbackAdminCasesResponseV1Schema,
  FeedbackAggregateQueryV1Schema,
  FeedbackAggregateResponseV1Schema,
  FeedbackCaseDetailResponseV1Schema,
  FeedbackCaseParamsV1Schema,
  FeedbackFollowupBodyV1Schema,
  FeedbackFollowupResponseV1Schema,
  FeedbackStatusBodyV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const noStore = (reply: { header(name: string, value: string): unknown }) =>
  reply.header("cache-control", "no-store");
function failure(code: string): ControlledError {
  if (code === "NOT_FOUND")
    return new ControlledError(
      "SUPPORT_CASE_NOT_FOUND",
      "Support case is not available",
      404,
    );
  if (code === "INVALID_TRANSITION")
    return new ControlledError(
      "SUPPORT_CASE_INVALID_TRANSITION",
      "Support case transition is not allowed",
      409,
    );
  if (code === "RATE_LIMITED")
    return new ControlledError(
      "SUPPORT_CASE_RATE_LIMITED",
      "Support rate limit reached",
      429,
    );
  if (code === "FORBIDDEN")
    return new ControlledError(
      "SUPPORT_CASE_FORBIDDEN",
      "Support case is not available",
      403,
    );
  return new ControlledError("INVALID_REQUEST", "Invalid support request", 400);
}

export function registerAdminFeedbackRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: FeedbackSupportService,
): void {
  app.get(
    "/v1/admin/support/cases",
    {
      schema: {
        querystring: FeedbackAdminCasesQueryV1Schema,
        response: {
          200: FeedbackAdminCasesResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "support.case.read");
      const query = FeedbackAdminCasesQueryV1Schema.parse(request.query);
      noStore(reply);
      return { items: await service.listCases(query) };
    },
  );
  app.get(
    "/v1/admin/support/cases/:case_id",
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
      await guard.requireAdminPermission(request, "support.case.read");
      const { case_id: caseId } = FeedbackCaseParamsV1Schema.parse(
        request.params,
      );
      const result = await service.getCase(caseId);
      if (!result) throw failure("NOT_FOUND");
      noStore(reply);
      return result;
    },
  );
  app.post(
    "/v1/admin/support/cases/:case_id/status",
    {
      schema: {
        params: FeedbackCaseParamsV1Schema,
        body: FeedbackStatusBodyV1Schema,
        response: {
          200: FeedbackCaseDetailResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const authenticated = await guard.requireAdminMutation(
        request,
        "support.case.manage",
      );
      const { case_id: caseId } = FeedbackCaseParamsV1Schema.parse(
        request.params,
      );
      const result = await service.transitionCase(
        authenticated.subject.roles.includes("ADMIN_OWNER")
          ? "ADMIN"
          : "SUPPORT",
        authenticated.subject.adminPrincipalId,
        caseId,
        request.body,
        request.id,
      );
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      return result.value;
    },
  );
  app.post(
    "/v1/admin/support/cases/:case_id/followups",
    {
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
      const authenticated = await guard.requireAdminMutation(
        request,
        "support.case.manage",
      );
      const { case_id: caseId } = FeedbackCaseParamsV1Schema.parse(
        request.params,
      );
      const result = await service.addAdminFollowup(
        authenticated.subject.roles.includes("ADMIN_OWNER")
          ? "ADMIN"
          : "SUPPORT",
        authenticated.subject.adminPrincipalId,
        caseId,
        request.body,
        request.id,
      );
      if (!result.ok) throw failure(result.code);
      noStore(reply);
      return reply.status(201).send({ followup: result.value });
    },
  );
  app.get(
    "/v1/admin/support/aggregates",
    {
      schema: {
        querystring: FeedbackAggregateQueryV1Schema,
        response: {
          200: FeedbackAggregateResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "support.aggregate.read");
      const query = FeedbackAggregateQueryV1Schema.parse(request.query);
      noStore(reply);
      return { items: await service.aggregateSignals(query) };
    },
  );
}
