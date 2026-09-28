import { z } from "zod";
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import { ApiErrorEnvelopeV1Schema } from "@product/contracts";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import { ControlledError } from "./app.js";
import type {
  MonitorProfileRepairReadCursor,
  MonitorProfileRepairReadItem,
  MonitorProfileRepairReadPage,
} from "@product/db";

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

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const caseState = z.enum([
  "PENDING_APPROVAL",
  "REJECTED",
  "APPROVAL_REVOKED",
  "APPROVAL_NOT_YET_VALID",
  "APPROVAL_EXPIRED",
  "APPROVAL_STALE",
  "APPROVAL_CURRENT",
  "APPLY_IN_PROGRESS",
  "APPLIED",
]);
const staleReason = z.enum([
  "BINDING_INVALID",
  "BINDING_HASH_INVALID",
  "PROFILE_IDENTITY_CHANGED",
  "OBSERVATION_PROOF_INVALID",
  "OBSERVATION_BINDING_CHANGED",
  "CURRENT_OBSERVATION_MISSING",
  "CURRENT_OBSERVATION_CHANGED",
  "INCIDENT_SCOPE_CHANGED",
  "INCIDENT_NOT_ACTIVE",
  "CANDIDATE_STATE_CHANGED",
  "BASELINE_OR_ROLLBACK_NOT_PUBLISHED",
  "SUITE_CHANGED",
  "H4_CHANGED",
  "ASSIGNMENT_CHANGED",
  "APPROVAL_BINDING_CHANGED",
]);
const nullableUuid = z.uuid().nullable();
export const HealthRepairCaseSchema = z
  .object({
    repairCaseId: z.uuid(),
    caseRevision: z.number().int().min(1),
    bindingSha256: sha256,
    scopeSha256: sha256,
    createdAt: z.string(),
    caseState,
    staleReasons: z.array(staleReason),
    executionAuthority: z.literal(false),
    incident: z
      .object({
        id: z.uuid(),
        status: z.string(),
        scopeSha256: sha256,
        firstSeenRunId: z.uuid(),
        latestSeenRunId: z.uuid(),
        lastObservedRunId: z.uuid(),
        resolvedByRunId: nullableUuid,
        resolvedAt: z.string().nullable(),
      })
      .strict(),
    observation: z
      .object({
        runId: z.uuid(),
        normalizedStateSha256: sha256,
        currentNormalizedStateSha256: sha256.nullable(),
        currentHealthState: z.string().nullable(),
        currentRunId: nullableUuid,
      })
      .strict(),
    candidate: z
      .object({
        profileId: z.uuid(),
        profileRevisionId: z.uuid(),
        revision: z.number().int().min(1),
        contentSha256: sha256,
        state: z.string(),
      })
      .strict(),
    acceptedBaselineProfileRevisionId: z.uuid(),
    rollbackProfileRevisionId: z.uuid(),
    testedExtension: z
      .object({
        version: z.string(),
        browserFamily: z.string(),
        browserVersion: z.string(),
        sourceCommitSha: z.string().regex(/^[0-9a-f]{40}$/),
        sourceTreeSha: z.string().regex(/^[0-9a-f]{40}$/),
        packageSha256: sha256,
      })
      .strict(),
    testEvidence: z
      .object({
        suiteRevisionId: z.uuid(),
        suiteMachineKey: z.string(),
        suiteRevision: z.number().int().min(1),
        suiteDefinitionSha256: sha256,
        h4EvaluationId: z.uuid(),
        h4EvaluationKey: z.string(),
        h4Status: z.string().nullable(),
        h4Outcome: z.string().nullable(),
        installedBehaviorEvidenceSha256: sha256,
        matrixSha256: sha256,
        resultsSha256: sha256,
      })
      .strict(),
    assignment: z
      .object({
        id: z.uuid(),
        expectedRevision: z.number().int().min(0),
        initialPercentageBps: z.number().int().min(0).max(10_000),
        currentRevision: z.number().int().min(0).nullable(),
        currentRevisionId: nullableUuid,
        currentMode: z.string().nullable(),
        currentBaselineProfileRevisionId: nullableUuid,
        currentCandidateProfileRevisionId: nullableUuid,
        currentPercentageBps: z.number().int().min(0).max(10_000).nullable(),
      })
      .strict(),
    decision: z
      .object({
        id: z.uuid(),
        operatorPrincipalId: z.uuid(),
        decision: z.enum(["APPROVED", "REJECTED"]),
        bindingSha256: sha256,
        requestSha256: sha256,
        manualChecklistSha256: sha256,
        issuedAt: z.string(),
        expiresAt: z.string(),
        revokedAt: z.string().nullable(),
        state: z.enum([
          "NONE",
          "REJECTED",
          "REVOKED",
          "NOT_YET_VALID",
          "EXPIRED",
          "STALE_APPROVED",
          "CURRENT_APPROVED",
        ]),
      })
      .strict()
      .nullable(),
    operation: z
      .object({
        id: z.uuid(),
        approvalId: z.uuid(),
        kind: z.string(),
        state: z.enum(["IN_PROGRESS", "COMMITTED"]),
        actorPrincipalId: z.uuid(),
        admissionTxid: z.number().int().min(0),
        startedAt: z.string(),
        committedAt: z.string().nullable(),
        publishedProfileRevisionId: nullableUuid,
        assignmentRevisionId: nullableUuid,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const HealthRepairCasePageSchema = z
  .object({
    items: z.array(HealthRepairCaseSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const HealthRepairCaseQuerySchema = z
  .object({
    scopeSha256: sha256,
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

export const HealthRepairCaseParamsSchema = z
  .object({
    caseId: z.uuid(),
    revision: z.coerce.number().int().min(1),
  })
  .strict();

const cursorSchema = z
  .object({
    createdAt: z.string(),
    repairCaseId: z.uuid(),
    caseRevision: z.number().int().min(1),
  })
  .strict();

export type HealthRepairReadRepository = Readonly<{
  listCases(input: {
    scopeSha256: string;
    limit?: number;
    cursor?: MonitorProfileRepairReadCursor;
  }): Promise<MonitorProfileRepairReadPage>;
  getCase(input: {
    scopeSha256: string;
    repairCaseId: string;
    caseRevision: number;
  }): Promise<MonitorProfileRepairReadItem | null>;
}>;

export function encodeHealthRepairCursor(
  value: MonitorProfileRepairReadPage["nextCursor"],
): string | null {
  if (!value) return null;
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeHealthRepairCursor(
  value: string | undefined,
): MonitorProfileRepairReadCursor | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("HEALTH_REPAIR_CURSOR_INVALID");
  }
  const cursor = cursorSchema.safeParse(parsed);
  if (!cursor.success) throw new Error("HEALTH_REPAIR_CURSOR_INVALID");
  const createdAt = new Date(cursor.data.createdAt);
  if (!Number.isFinite(createdAt.valueOf()))
    throw new Error("HEALTH_REPAIR_CURSOR_INVALID");
  return {
    createdAt,
    repairCaseId: cursor.data.repairCaseId,
    caseRevision: cursor.data.caseRevision,
  };
}

export const HealthRepairScopeQuerySchema = z
  .object({
    scopeSha256: sha256,
  })
  .strict();

function noStore(reply: { header(name: string, value: string): unknown }) {
  reply.header("cache-control", "no-store");
}

function invalidRequest(): ControlledError {
  return new ControlledError("INVALID_REQUEST", "Invalid repair cursor", 400);
}

function repairNotFound(): ControlledError {
  return new ControlledError(
    "ADMIN_RESOURCE_NOT_FOUND",
    "Repair case not found",
    404,
  );
}

async function repairRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ControlledError(
      "SERVICE_UNAVAILABLE",
      "Service unavailable",
      503,
    );
  }
}

async function requireRepairRead(
  guard: AdminRouteGuard,
  request: Parameters<AdminRouteGuard["requireAdminPermission"]>[0],
) {
  await guard.requireAdminPermission(request, "health.read");
  await guard.requireAdminPermission(request, "ai.profile.read");
  await guard.requireAdminPermission(request, "ai.assignment.read");
}

export function registerHealthRepairAdminRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: HealthRepairReadRepository,
): void {
  app.get(
    "/v1/admin/health/repair-cases",
    {
      schema: {
        querystring: HealthRepairCaseQuerySchema,
        response: { 200: HealthRepairCasePageSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requireRepairRead(guard, request);
      const query = HealthRepairCaseQuerySchema.parse(request.query);
      let cursor: MonitorProfileRepairReadCursor | undefined;
      try {
        cursor = decodeHealthRepairCursor(query.cursor);
      } catch {
        throw invalidRequest();
      }
      const result = await repairRead(() =>
        service.listCases({
          scopeSha256: query.scopeSha256,
          limit: query.limit,
          cursor,
        }),
      );
      noStore(reply);
      return HealthRepairCasePageSchema.parse({
        items: result.items,
        nextCursor: encodeHealthRepairCursor(result.nextCursor),
      });
    },
  );
  app.get(
    "/v1/admin/health/repair-cases/:caseId/:revision",
    {
      schema: {
        params: HealthRepairCaseParamsSchema,
        querystring: HealthRepairScopeQuerySchema,
        response: { 200: HealthRepairCaseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requireRepairRead(guard, request);
      const p = HealthRepairCaseParamsSchema.parse(request.params);
      const q = HealthRepairScopeQuerySchema.parse(request.query);
      const value = await repairRead(() =>
        service.getCase({
          scopeSha256: q.scopeSha256,
          repairCaseId: p.caseId,
          caseRevision: p.revision,
        }),
      );
      if (!value) throw repairNotFound();
      noStore(reply);
      return HealthRepairCaseSchema.parse(value);
    },
  );
}
