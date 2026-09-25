/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import { computeP4PlanRevisionContentFingerprintV1 } from "@product/plans";
import type { ApiErrorCodeV1 } from "@product/contracts";
import type { AdminCommercialService } from "@product/admin-commercial";
import {
  AdminCommercialPlanQuerySchema,
  AdminCommercialPriceQuerySchema,
  AdminCommercialDefinitionQuerySchema,
  AdminCommercialOverrideQuerySchema,
  AdminCompatibilityQuerySchema,
  AdminConfigReleaseReadQuerySchema,
  PlanCreateBodySchema,
  PlanDraftBodySchema,
  PlanUpdateBodySchema,
  PlanEntitlementSetBodySchema,
  PlanEntitlementRemoveBodySchema,
  PlanPublishBodySchema,
  PlanStatusBodySchema,
  PriceCreateBodySchema,
  PriceDraftBodySchema,
  PriceUpdateBodySchema,
  PricePublishBodySchema,
  PriceStatusBodySchema,
  PriceAssignmentBodySchema,
  DefinitionCreateBodySchema,
  DefinitionDescriptionBodySchema,
  DefinitionDeprecateBodySchema,
  OverrideSetBodySchema,
  OverrideClearBodySchema,
  CompatibilityPublishBodySchema,
  ConfigReleasePublishBodySchema,
  ExtensionReleasePublishBodySchema,
} from "@product/admin-commercial";
import type { AdminPermission } from "@product/admin-auth";
import type { AdminRouteGuard } from "./admin-route-guard.js";
import { ControlledError } from "./app.js";
import { z } from "zod";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const response = {
  response: {
    200: z.object({}).passthrough(),
    400: z.object({}).passthrough(),
    401: z.object({}).passthrough(),
    403: z.object({}).passthrough(),
    404: z.object({}).passthrough(),
    409: z.object({}).passthrough(),
    503: z.object({}).passthrough(),
  },
};
const p = (name: string) => ({
  params: z.object({ [name]: z.uuid() }).strict(),
});
const two = (a: string, b: string) => ({
  params: z.object({ [a]: z.uuid(), [b]: z.uuid() }).strict(),
});
const entitlementPath = (account_id: string, entitlement_key: string) => ({
  params: z
    .object({ [account_id]: z.uuid(), [entitlement_key]: z.string() })
    .strict(),
});
const policyPath = { params: z.object({ policy_key: z.string() }).strict() };
type AdminCommercialDomainFailureCode =
  | "PLAN_NOT_FOUND"
  | "PLAN_CODE_CONFLICT"
  | "PLAN_ARCHIVED"
  | "PLAN_STATUS_STALE"
  | "PLAN_STATUS_TRANSITION_INVALID"
  | "PLAN_PUBLISHED_REVISION_REQUIRED"
  | "PLAN_REVISION_NOT_FOUND"
  | "PLAN_REVISION_NOT_DRAFT"
  | "PLAN_DRAFT_STALE"
  | "ENTITLEMENT_DEFINITION_NOT_FOUND"
  | "ENTITLEMENT_DEFINITION_CONFLICT"
  | "ENTITLEMENT_DEFINITION_STALE"
  | "ENTITLEMENT_DEPRECATED"
  | "ENTITLEMENT_TYPE_MISMATCH"
  | "PRICE_NOT_FOUND"
  | "PRICE_CODE_CONFLICT"
  | "PRICE_ARCHIVED"
  | "PRICE_PLAN_NOT_FOUND"
  | "PRICE_PLAN_ARCHIVED"
  | "PRICE_STATUS_STALE"
  | "PRICE_STATUS_TRANSITION_INVALID"
  | "PRICE_PUBLISHED_REVISION_REQUIRED"
  | "PRICE_REVISION_NOT_FOUND"
  | "PRICE_REVISION_NOT_DRAFT"
  | "PRICE_DRAFT_STALE"
  | "PRICE_PLAN_REVISION_NOT_FOUND"
  | "PRICE_PLAN_REVISION_PLAN_MISMATCH"
  | "PRICE_PLAN_REVISION_NOT_PUBLISHED"
  | "PRICE_ASSIGNMENT_STALE"
  | "PRICE_ASSIGNMENT_OUTSIDE_REVISION_WINDOW"
  | "PRICE_ASSIGNMENT_REVISION_NOT_PUBLISHED"
  | "PRICE_SALE_ASSIGNMENT_NOT_FOUND"
  | "PRICE_SALE_CLOSED"
  | "PRICE_REVISION_EXPIRED"
  | "PRICE_NOT_ACTIVE"
  | "PLAN_NOT_ACTIVE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE"
  | "PLAN_REVISION_NOT_PUBLISHED";
type AdminCommercialFailureCode =
  | AdminCommercialDomainFailureCode
  | "ADMIN_FORBIDDEN"
  | "INVALID_CURSOR"
  | "NO_PLAN_BINDING"
  | "NOT_FOUND";
type PublicAdminFailure = {
  code: Extract<
    ApiErrorCodeV1,
    | "ADMIN_RESOURCE_NOT_FOUND"
    | "ADMIN_STATE_STALE"
    | "ADMIN_CONFLICT"
    | "ADMIN_FORBIDDEN"
    | "INVALID_REQUEST"
  >;
  statusCode: 400 | 403 | 404 | 409;
  message: string;
};

export function mapAdminCommercialFailure(
  code: AdminCommercialFailureCode,
): PublicAdminFailure {
  switch (code) {
    case "PLAN_NOT_FOUND":
    case "PLAN_REVISION_NOT_FOUND":
    case "ENTITLEMENT_DEFINITION_NOT_FOUND":
    case "PRICE_NOT_FOUND":
    case "PRICE_PLAN_NOT_FOUND":
    case "PRICE_REVISION_NOT_FOUND":
    case "PRICE_PLAN_REVISION_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
    case "NOT_FOUND":
      return {
        code: "ADMIN_RESOURCE_NOT_FOUND",
        statusCode: 404,
        message: "Admin resource not found",
      };
    case "PLAN_STATUS_STALE":
    case "PLAN_DRAFT_STALE":
    case "ENTITLEMENT_DEFINITION_STALE":
    case "PRICE_STATUS_STALE":
    case "PRICE_DRAFT_STALE":
    case "PRICE_ASSIGNMENT_STALE":
    case "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE":
      return {
        code: "ADMIN_STATE_STALE",
        statusCode: 409,
        message: "Admin state is stale",
      };
    case "ADMIN_FORBIDDEN":
      return {
        code: "ADMIN_FORBIDDEN",
        statusCode: 403,
        message: "Admin authentication failed",
      };
    case "INVALID_CURSOR":
      return {
        code: "INVALID_REQUEST",
        statusCode: 400,
        message: "Invalid request",
      };
    case "NO_PLAN_BINDING":
    case "PLAN_CODE_CONFLICT":
    case "PLAN_ARCHIVED":
    case "PLAN_STATUS_TRANSITION_INVALID":
    case "PLAN_PUBLISHED_REVISION_REQUIRED":
    case "PLAN_REVISION_NOT_DRAFT":
    case "ENTITLEMENT_DEFINITION_CONFLICT":
    case "ENTITLEMENT_DEPRECATED":
    case "ENTITLEMENT_TYPE_MISMATCH":
    case "PRICE_CODE_CONFLICT":
    case "PRICE_ARCHIVED":
    case "PRICE_PLAN_ARCHIVED":
    case "PRICE_STATUS_TRANSITION_INVALID":
    case "PRICE_PUBLISHED_REVISION_REQUIRED":
    case "PRICE_REVISION_NOT_DRAFT":
    case "PRICE_PLAN_REVISION_PLAN_MISMATCH":
    case "PRICE_PLAN_REVISION_NOT_PUBLISHED":
    case "PRICE_ASSIGNMENT_OUTSIDE_REVISION_WINDOW":
    case "PRICE_ASSIGNMENT_REVISION_NOT_PUBLISHED":
    case "PRICE_SALE_ASSIGNMENT_NOT_FOUND":
    case "PRICE_SALE_CLOSED":
    case "PRICE_REVISION_EXPIRED":
    case "PRICE_NOT_ACTIVE":
    case "PLAN_NOT_ACTIVE":
    case "PLAN_REVISION_NOT_PUBLISHED":
      return {
        code: "ADMIN_CONFLICT",
        statusCode: 409,
        message: "Admin operation conflicts with current state",
      };
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

function fail(code: AdminCommercialFailureCode, _legacyStatus?: number): never {
  const mapped = mapAdminCommercialFailure(code);
  throw new ControlledError(mapped.code, mapped.message, mapped.statusCode);
}
async function invoke<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof ControlledError) throw e;
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "ADMIN_FORBIDDEN"
    )
      fail("ADMIN_FORBIDDEN", 403);
    throw new ControlledError(
      "SERVICE_UNAVAILABLE",
      "Service unavailable",
      503,
    );
  }
}
const ctx = (
  subject: { adminPrincipalId: string },
  request: { id: string },
  reason: string,
) => ({ actorId: subject.adminPrincipalId, correlationId: request.id, reason });
function checkResult<T>(
  result:
    | { kind: "OK"; changed: boolean; value: T }
    | { kind: "REJECTED"; code: AdminCommercialDomainFailureCode },
): {
  status: "applied";
  changed: boolean;
  value?: T;
} {
  if (result.kind === "REJECTED") fail(result.code);
  return {
    status: "applied",
    changed: result.changed ?? true,
    value: result.value,
  };
}
function planFingerprint(revision: any, planId: string) {
  return computeP4PlanRevisionContentFingerprintV1({
    planRevisionId: revision.id,
    planId,
    revision: revision.revision,
    displayName: revision.displayName,
    description: revision.description,
    entitlements: revision.entitlements,
  });
}
function safePlan(plan: any) {
  return {
    ...plan,
    revisions: plan.revisions.map((r: any) => ({
      ...r,
      contentFingerprintSha256: planFingerprint(r, plan.id),
    })),
  };
}
function safePrice(price: any) {
  return {
    ...price,
    saleAssignments: price.saleAssignments.map((a: any) => {
      const safe = { ...a };
      delete safe.reason;
      return safe;
    }),
  };
}
function safeOverridePage(page: any) {
  return {
    ...page,
    items: page.items.map((item: any) => {
      const safe = { ...item };
      delete safe.reason;
      return safe;
    }),
  };
}
function pageResult<T>(result: T | { kind: "INVALID_CURSOR" }): T {
  if (result && typeof result === "object" && "kind" in result)
    fail("INVALID_CURSOR", 400);
  return result as T;
}

export function registerAdminCommercialRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: AdminCommercialService,
): void {
  const get = (
    path: string,
    permission: AdminPermission,
    schema: any,
    work: (request: any) => Promise<unknown>,
  ) =>
    app.get(
      path,
      { schema: { ...schema, ...response } },
      async (request, reply) => {
        await guard.requireAdminPermission(request, permission);
        const result = await invoke(() => work(request));
        reply.header("cache-control", "no-store");
        return result;
      },
    );
  const post = (
    path: string,
    permission: AdminPermission,
    schema: any,
    work: (
      request: any,
      subject: { adminPrincipalId: string },
    ) => Promise<unknown>,
  ) =>
    app.post(
      path,
      { schema: { ...schema, ...response } },
      async (request, reply) => {
        const { subject } = await guard.requireAdminMutation(
          request,
          permission,
        );
        const result = await invoke(() => work(request, subject));
        reply.header("cache-control", "no-store");
        return result;
      },
    );
  get(
    "/v1/admin/commercial/plans",
    "plan.read",
    { querystring: AdminCommercialPlanQuerySchema },
    async (r) =>
      pageResult(
        await service.listPlans(AdminCommercialPlanQuerySchema.parse(r.query)),
      ),
  );
  get(
    "/v1/admin/commercial/plans/:plan_id",
    "plan.read",
    p("plan_id"),
    async (r) => {
      const v = await service.getPlan(r.params.plan_id);
      if (!v) fail("PLAN_NOT_FOUND", 404);
      return safePlan(v);
    },
  );
  get(
    "/v1/admin/commercial/prices",
    "price.read",
    { querystring: AdminCommercialPriceQuerySchema },
    async (r) =>
      pageResult(
        await service.listPrices(
          AdminCommercialPriceQuerySchema.parse(r.query),
        ),
      ),
  );
  get(
    "/v1/admin/commercial/prices/:price_id",
    "price.read",
    p("price_id"),
    async (r) => {
      const v = await service.getPrice(r.params.price_id);
      if (!v) fail("PRICE_NOT_FOUND", 404);
      return safePrice(v);
    },
  );
  get(
    "/v1/admin/commercial/entitlements/definitions",
    "entitlement.read",
    { querystring: AdminCommercialDefinitionQuerySchema },
    async (r) =>
      pageResult(
        await service.listDefinitions(
          AdminCommercialDefinitionQuerySchema.parse(r.query),
        ),
      ),
  );
  get(
    "/v1/admin/accounts/:account_id/entitlement-overrides",
    "entitlement.read",
    { ...p("account_id"), querystring: AdminCommercialOverrideQuerySchema },
    async (r) => {
      const v = await service.listOverrides({
        accountId: r.params.account_id,
        ...AdminCommercialOverrideQuerySchema.parse(r.query),
      });
      if ("kind" in v) fail(v.kind, v.kind === "ACCOUNT_NOT_FOUND" ? 404 : 400);
      return safeOverridePage(v);
    },
  );
  get(
    "/v1/admin/accounts/:account_id/entitlements/:entitlement_key",
    "entitlement.read",
    entitlementPath("account_id", "entitlement_key"),
    async (r) => {
      const v = await service.resolveEffective({
        accountId: r.params.account_id,
        entitlementKey: r.params.entitlement_key,
        at: new Date(),
      });
      if ("kind" in v) fail(v.kind, v.kind === "NO_PLAN_BINDING" ? 409 : 404);
      return v;
    },
  );
  get(
    "/v1/admin/compatibility/policies",
    "compatibility.read",
    { querystring: AdminCompatibilityQuerySchema },
    async (r) =>
      pageResult(
        await service.listCompatibility(
          AdminCompatibilityQuerySchema.parse(r.query),
        ),
      ),
  );
  get(
    "/v1/admin/compatibility/releases/:version",
    "compatibility.read",
    { params: z.object({ version: z.string().min(1).max(64) }).strict() },
    async (r) => {
      const value = await service.getExtensionRelease(r.params.version);
      if (!value) fail("NOT_FOUND", 404);
      return value;
    },
  );
  get(
    "/v1/admin/compatibility/config-releases/latest",
    "compatibility.read",
    { querystring: AdminConfigReleaseReadQuerySchema },
    async (r) => {
      const query = AdminConfigReleaseReadQuerySchema.parse(r.query);
      const value = await service.getLatestConfigRelease(query.contractVersion);
      if (!value) fail("NOT_FOUND", 404);
      return value;
    },
  );

  post(
    "/v1/admin/commercial/plans",
    "plan.manage",
    { body: PlanCreateBodySchema },
    async (r, s) =>
      checkResult(
        await service.createPlan({
          ...PlanCreateBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/plans/:plan_id/revisions",
    "plan.manage",
    { ...p("plan_id"), body: PlanDraftBodySchema },
    async (r, s) =>
      checkResult(
        await service.createPlanRevision({
          planId: r.params.plan_id,
          ...PlanDraftBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  const planRevision = async (
    serviceCall: () => Promise<any>,
    serviceRead: () => Promise<any>,
    planId: string,
  ) => {
    const plan = await serviceRead();
    if (!plan || !plan.revisions.some((r: any) => r.id === planId))
      fail("PLAN_REVISION_NOT_FOUND", 404);
    return serviceCall();
  };
  post(
    "/v1/admin/commercial/plans/:plan_id/revisions/:plan_revision_id/update",
    "plan.manage",
    { ...two("plan_id", "plan_revision_id"), body: PlanUpdateBodySchema },
    async (r, s) =>
      checkResult(
        await planRevision(
          () =>
            service.updatePlanRevision({
              planRevisionId: r.params.plan_revision_id,
              ...PlanUpdateBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          () => service.getPlan(r.params.plan_id),
          r.params.plan_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/plans/:plan_id/revisions/:plan_revision_id/entitlements/:entitlement_key/set",
    "plan.manage",
    {
      params: z
        .object({
          plan_id: z.uuid(),
          plan_revision_id: z.uuid(),
          entitlement_key: z.string(),
        })
        .strict(),
      body: PlanEntitlementSetBodySchema,
    },
    async (r, s) =>
      checkResult(
        await planRevision(
          () =>
            service.setPlanEntitlement({
              planRevisionId: r.params.plan_revision_id,
              entitlementKey: r.params.entitlement_key,
              ...PlanEntitlementSetBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          () => service.getPlan(r.params.plan_id),
          r.params.plan_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/plans/:plan_id/revisions/:plan_revision_id/entitlements/:entitlement_key/remove",
    "plan.manage",
    {
      params: z
        .object({
          plan_id: z.uuid(),
          plan_revision_id: z.uuid(),
          entitlement_key: z.string(),
        })
        .strict(),
      body: PlanEntitlementRemoveBodySchema,
    },
    async (r, s) =>
      checkResult(
        await planRevision(
          () =>
            service.removePlanEntitlement({
              planRevisionId: r.params.plan_revision_id,
              entitlementKey: r.params.entitlement_key,
              ...PlanEntitlementRemoveBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          () => service.getPlan(r.params.plan_id),
          r.params.plan_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/plans/:plan_id/revisions/:plan_revision_id/publish",
    "plan.manage",
    { ...two("plan_id", "plan_revision_id"), body: PlanPublishBodySchema },
    async (r, s) =>
      checkResult(
        await planRevision(
          () =>
            service.publishPlanRevision({
              planRevisionId: r.params.plan_revision_id,
              ...PlanPublishBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          () => service.getPlan(r.params.plan_id),
          r.params.plan_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/plans/:plan_id/status",
    "plan.manage",
    { ...p("plan_id"), body: PlanStatusBodySchema },
    async (r, s) =>
      checkResult(
        await service.changePlanStatus({
          planId: r.params.plan_id,
          ...PlanStatusBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/prices",
    "price.manage",
    { body: PriceCreateBodySchema },
    async (r, s) =>
      checkResult(
        await service.createPrice({
          ...PriceCreateBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/prices/:price_id/revisions",
    "price.manage",
    { ...p("price_id"), body: PriceDraftBodySchema },
    async (r, s) =>
      checkResult(
        await service.createPriceRevision({
          priceId: r.params.price_id,
          ...PriceDraftBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  const priceRevision = async (
    serviceCall: () => Promise<any>,
    priceId: string,
    revisionId: string,
  ) => {
    const price = await service.getPrice(priceId);
    if (!price || !price.revisions.some((r: any) => r.id === revisionId))
      fail("PRICE_REVISION_NOT_FOUND", 404);
    return serviceCall();
  };
  post(
    "/v1/admin/commercial/prices/:price_id/revisions/:price_revision_id/update",
    "price.manage",
    { ...two("price_id", "price_revision_id"), body: PriceUpdateBodySchema },
    async (r, s) =>
      checkResult(
        await priceRevision(
          () =>
            service.updatePriceRevision({
              priceRevisionId: r.params.price_revision_id,
              ...PriceUpdateBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          r.params.price_id,
          r.params.price_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/prices/:price_id/revisions/:price_revision_id/publish",
    "price.manage",
    { ...two("price_id", "price_revision_id"), body: PricePublishBodySchema },
    async (r, s) =>
      checkResult(
        await priceRevision(
          () =>
            service.publishPriceRevision({
              priceRevisionId: r.params.price_revision_id,
              ...PricePublishBodySchema.parse(r.body),
              ...ctx(s, r, r.body.reason),
            }),
          r.params.price_id,
          r.params.price_revision_id,
        ),
      ),
  );
  post(
    "/v1/admin/commercial/prices/:price_id/status",
    "price.manage",
    { ...p("price_id"), body: PriceStatusBodySchema },
    async (r, s) =>
      checkResult(
        await service.changePriceStatus({
          priceId: r.params.price_id,
          ...PriceStatusBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/prices/:price_id/sale-assignments",
    "price.manage",
    { ...p("price_id"), body: PriceAssignmentBodySchema },
    async (r, s) =>
      checkResult(
        await service.assignPrice({
          priceId: r.params.price_id,
          ...PriceAssignmentBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/entitlements/definitions",
    "plan.manage",
    { body: DefinitionCreateBodySchema },
    async (r, s) =>
      checkResult(
        await service.createDefinition({
          ...DefinitionCreateBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/entitlements/definitions/:entitlement_key/description",
    "plan.manage",
    {
      params: z.object({ entitlement_key: z.string() }).strict(),
      body: DefinitionDescriptionBodySchema,
    },
    async (r, s) =>
      checkResult(
        await service.updateDefinition({
          entitlementKey: r.params.entitlement_key,
          ...DefinitionDescriptionBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/commercial/entitlements/definitions/:entitlement_key/deprecate",
    "plan.manage",
    {
      params: z.object({ entitlement_key: z.string() }).strict(),
      body: DefinitionDeprecateBodySchema,
    },
    async (r, s) =>
      checkResult(
        await service.deprecateDefinition({
          entitlementKey: r.params.entitlement_key,
          ...DefinitionDeprecateBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/accounts/:account_id/entitlement-overrides/:entitlement_key/set",
    "entitlement.override",
    {
      params: entitlementPath("account_id", "entitlement_key").params,
      body: OverrideSetBodySchema,
    },
    async (r, s) =>
      checkResult(
        await service.setOverride({
          accountId: r.params.account_id,
          entitlementKey: r.params.entitlement_key,
          ...OverrideSetBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/accounts/:account_id/entitlement-overrides/:entitlement_key/clear",
    "entitlement.override",
    {
      params: entitlementPath("account_id", "entitlement_key").params,
      body: OverrideClearBodySchema,
    },
    async (r, s) =>
      checkResult(
        await service.clearOverride({
          accountId: r.params.account_id,
          entitlementKey: r.params.entitlement_key,
          ...OverrideClearBodySchema.parse(r.body),
          ...ctx(s, r, r.body.reason),
        }),
      ),
  );
  post(
    "/v1/admin/compatibility/config-releases/publish",
    "compatibility.manage",
    { body: ConfigReleasePublishBodySchema },
    async (r, s) => {
      const body = ConfigReleasePublishBodySchema.parse(r.body);
      try {
        return await service.publishConfigRelease({
          ...body,
          ...ctx(s, r, body.reason),
        });
      } catch (e) {
        const message =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "";
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: unknown }).code)
            : "";
        if (
          message === "P3_CONFIG_BASE_NOT_FOUND" ||
          message === "P3_SIGNING_KEY_NOT_FOUND" ||
          message === "P3_POLICY_SOURCE_MISSING" ||
          message === "P3_FEATURE_RULE_SOURCE_MISSING" ||
          message === "P3_ROLLOUT_SOURCE_MISSING"
        )
          throw new ControlledError(
            "ADMIN_RESOURCE_NOT_FOUND",
            "Admin resource not found",
            404,
          );
        if (
          message === "P3_CONFIG_BASE_STALE" ||
          message === "P3_CONFIG_BASE_INVALID" ||
          message === "P3_CONFIG_LINK_NO_CHANGE" ||
          message.startsWith("P3_SIGNING_KEY_") ||
          message.startsWith("P3_POLICY_SOURCE_") ||
          message.startsWith("P3_FEATURE_RULE_SOURCE_") ||
          message.startsWith("P3_ROLLOUT_SOURCE_") ||
          code === "23505"
        )
          throw new ControlledError(
            "ADMIN_CONFLICT",
            "Admin operation conflicts with current state",
            409,
          );
        throw e;
      }
    },
  );
  post(
    "/v1/admin/compatibility/policies/:policy_key/publish",
    "compatibility.manage",
    { ...policyPath, body: CompatibilityPublishBodySchema },
    async (r, s) => {
      const body = CompatibilityPublishBodySchema.parse(r.body);
      const revision = await service.publishCompatibility({
        policyKey: r.params.policy_key,
        ...body,
        ...ctx(s, r, body.reason),
      });
      return {
        ...revision,
        blockedVersions: [...body.blockedVersions].sort(),
        linkedConfigVersions: [],
        activationStatus: "REVISION_PUBLISHED_NOT_AUTO_ACTIVATED" as const,
      };
    },
  );
  post(
    "/v1/admin/compatibility/releases/:version/publish",
    "compatibility.manage",
    {
      params: z.object({ version: z.string() }).strict(),
      body: ExtensionReleasePublishBodySchema,
    },
    async (r, s) => {
      const body = ExtensionReleasePublishBodySchema.parse(r.body);
      if (r.params.version !== body.version)
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      try {
        return await service.publishExtensionRelease({
          ...body,
          ...ctx(s, r, body.reason),
        });
      } catch (e) {
        if (
          e &&
          typeof e === "object" &&
          "code" in e &&
          (e as { code?: string }).code === "23505"
        )
          throw new ControlledError(
            "ADMIN_CONFLICT",
            "Admin operation conflicts with current state",
            409,
          );
        throw e;
      }
    },
  );
}
