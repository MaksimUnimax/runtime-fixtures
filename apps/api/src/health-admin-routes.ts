import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import {
  HealthAdminEvaluationQuerySchema,
  HealthAdminEvaluationDetailSchema,
  HealthAdminIncidentQuerySchema,
  HealthIncidentSummarySchema,
  HealthAdminRecommendationQuerySchema,
  HealthAdminTargetDetailSchema,
  HealthAdminTargetQuerySchema,
  HealthAdminTargetSummarySchema,
  HealthRecommendationSchema,
  type HealthAdminReadRepository,
} from "@product/health";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import { ControlledError } from "./app.js";
import { ApiErrorEnvelopeV1Schema } from "@product/contracts";
import { z } from "zod";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const errors = {
  400: ApiErrorEnvelopeV1Schema,
  401: ApiErrorEnvelopeV1Schema,
  403: ApiErrorEnvelopeV1Schema,
  404: ApiErrorEnvelopeV1Schema,
  503: ApiErrorEnvelopeV1Schema,
};
const page = <T extends z.ZodType>(item: T) =>
  z
    .object({ items: z.array(item), nextCursor: z.string().nullable() })
    .strict();
const params = z
  .object({ target_id: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
const uuidParams = z.object({ id: z.uuid() }).strict();

function unavailable(): never {
  throw new ControlledError("SERVICE_UNAVAILABLE", "Service unavailable", 503);
}
function notFound(): never {
  throw new ControlledError(
    "ADMIN_RESOURCE_NOT_FOUND",
    "Health resource not found",
    404,
  );
}
async function read<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ControlledError) throw error;
    unavailable();
  }
}
function noStore(reply: { header(name: string, value: string): unknown }) {
  reply.header("cache-control", "no-store");
}
function targetSummary(
  value: Awaited<ReturnType<HealthAdminReadRepository["getTarget"]>>,
) {
  if (!value) return null;
  return HealthAdminTargetSummarySchema.parse({
    targetId: value.targetId,
    provider: value.provider,
    surface: value.surface,
    variant: value.variant,
    monitoringLayer: value.monitoringLayer,
    browserFamily: value.browserFamily,
    browserVersion: value.browserVersion,
    latestHealthState: value.latestHealthState,
    latestObservationAt: value.latestObservationAt,
    latestSuccessfulRunAt: value.latestSuccessfulRunAt,
    latestSchedulerState: value.latestSchedulerState,
    activeIncidentId: value.activeIncidentId,
    baselineProfileRevisionId: value.baselineProfileRevisionId,
    candidateProfileRevisionId: value.candidateProfileRevisionId,
    candidateState: value.candidateState,
    latestH4Result: value.latestH4Result,
    latestH5Result: value.latestH5Result,
    recommendation: value.recommendation,
  });
}

export function registerHealthAdminRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: HealthAdminReadRepository,
): void {
  app.get(
    "/v1/admin/health/targets",
    {
      schema: {
        querystring: HealthAdminTargetQuerySchema,
        response: { 200: page(HealthAdminTargetSummarySchema), ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const result = await read(() =>
        service.listTargets(HealthAdminTargetQuerySchema.parse(request.query)),
      );
      noStore(reply);
      return {
        items: result.items.map((item) => targetSummary(item)!),
        nextCursor: result.nextCursor,
      };
    },
  );
  app.get(
    "/v1/admin/health/targets/:target_id",
    {
      schema: {
        params,
        response: { 200: HealthAdminTargetDetailSchema, ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const value = await read(() =>
        service.getTarget(params.parse(request.params).target_id),
      );
      if (!value) notFound();
      noStore(reply);
      return value;
    },
  );
  app.get(
    "/v1/admin/health/incidents",
    {
      schema: {
        querystring: HealthAdminIncidentQuerySchema,
        response: { 200: page(HealthIncidentSummarySchema), ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const result = await read(() =>
        service.listIncidents(
          HealthAdminIncidentQuerySchema.parse(request.query),
        ),
      );
      noStore(reply);
      return result;
    },
  );
  app.get(
    "/v1/admin/health/incidents/:id",
    {
      schema: {
        params: uuidParams,
        response: { 200: HealthIncidentSummarySchema, ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const value = await read(() =>
        service.getIncident(uuidParams.parse(request.params).id),
      );
      if (!value) notFound();
      noStore(reply);
      return value;
    },
  );
  app.get(
    "/v1/admin/health/evaluations",
    {
      schema: {
        querystring: HealthAdminEvaluationQuerySchema,
        response: { 200: page(HealthAdminEvaluationDetailSchema), ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const result = await read(() =>
        service.listEvaluations(
          HealthAdminEvaluationQuerySchema.parse(request.query),
        ),
      );
      noStore(reply);
      return result;
    },
  );
  app.get(
    "/v1/admin/health/evaluations/:id",
    {
      schema: {
        params: uuidParams,
        response: { 200: HealthAdminEvaluationDetailSchema, ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const value = await read(() =>
        service.getEvaluation(uuidParams.parse(request.params).id),
      );
      if (!value) notFound();
      noStore(reply);
      return value;
    },
  );
  app.get(
    "/v1/admin/health/recommendations",
    {
      schema: {
        querystring: HealthAdminRecommendationQuerySchema,
        response: { 200: page(HealthRecommendationSchema), ...errors },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, "health.read");
      const result = await read(() =>
        service.listRecommendations(
          HealthAdminRecommendationQuerySchema.parse(request.query),
        ),
      );
      noStore(reply);
      return result;
    },
  );
}
