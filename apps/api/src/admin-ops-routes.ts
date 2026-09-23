import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import type { BrowserFamily } from "@product/shared";
import type { AdminPermission } from "@product/admin-auth";
import type { AdminOpsService } from "@product/admin-ops";
import {
  AdminAccountParamsV1Schema,
  AdminAccountsQueryV1Schema,
  AdminAccountsResponseV1Schema,
  AdminAuditEventsQueryV1Schema,
  AdminAuditEventsResponseV1Schema,
  AdminDeviceParamsV1Schema,
  AdminDeviceQueryV1Schema,
  AdminDeviceRevokeBodyV1Schema,
  AdminDeviceRevokeResponseV1Schema,
  AdminDevicesResponseV1Schema,
  AdminPrincipalCreateBodyV1Schema,
  AdminPrincipalItemV1Schema,
  AdminPrincipalMutationBodyV1Schema,
  AdminPrincipalMutationParamsV1Schema,
  AdminPrincipalRoleParamsV1Schema,
  AdminPrincipalStatusResponseV1Schema,
  AdminPrincipalsQueryV1Schema,
  AdminPrincipalsResponseV1Schema,
  AdminSubscriptionResponseV1Schema,
  AdminUsersQueryV1Schema,
  AdminUsersResponseV1Schema,
  ApiErrorEnvelopeV1Schema,
} from "@product/contracts";
import { ControlledError } from "./app.js";
import type { AdminRouteGuard } from "./admin-route-guard.js";

type Api = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;
const noStore = (reply: { header(name: string, value: string): unknown }) =>
  reply.header("cache-control", "no-store");
const unavailable = () =>
  new ControlledError("SERVICE_UNAVAILABLE", "Service unavailable", 503);
const invalid = () =>
  new ControlledError("INVALID_REQUEST", "Invalid request", 400);
async function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw unavailable();
  }
}
function adminFailure(kind: string): ControlledError {
  if (
    kind === "NOT_FOUND" ||
    kind === "ACCOUNT_NOT_FOUND" ||
    kind === "USER_NOT_FOUND"
  )
    return new ControlledError(
      "ADMIN_RESOURCE_NOT_FOUND",
      "Admin resource not found",
      404,
    );
  if (kind === "STALE")
    return new ControlledError(
      "ADMIN_STATE_STALE",
      "Admin state is stale",
      409,
    );
  if (kind === "LAST_OWNER")
    return new ControlledError(
      "ADMIN_LAST_OWNER_REQUIRED",
      "At least one active admin owner is required",
      409,
    );
  if (
    kind === "CONFLICT" ||
    kind === "USER_INACTIVE" ||
    kind === "USER_UNVERIFIED"
  )
    return new ControlledError(
      "ADMIN_CONFLICT",
      "Admin operation conflicts with current state",
      409,
    );
  if (kind === "FORBIDDEN")
    return new ControlledError(
      "ADMIN_FORBIDDEN",
      "Admin authentication failed",
      403,
    );
  return unavailable();
}
function iso(value: Date): string {
  return value.toISOString();
}
function accountResponse(value: {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}
function userResponse(value: {
  id: string;
  status: "ACTIVE" | "SUSPENDED";
  emails: { email: string; verifiedAt: Date | null }[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    emails: value.emails.map((email) => ({
      ...email,
      verifiedAt: email.verifiedAt ? iso(email.verifiedAt) : null,
    })),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}
function deviceResponse(value: {
  id: string;
  status: "ACTIVE" | "REVOKED";
  label: string | null;
  browserFamily: string;
  browserVersionLastSeen: string | null;
  extensionVersionLastSeen: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    ...value,
    browserFamily: value.browserFamily as BrowserFamily,
    createdAt: iso(value.createdAt),
    activatedAt: value.activatedAt ? iso(value.activatedAt) : null,
    lastSeenAt: value.lastSeenAt ? iso(value.lastSeenAt) : null,
    revokedAt: value.revokedAt ? iso(value.revokedAt) : null,
  };
}
function principalResponse(value: {
  principalId: string;
  userId: string;
  status: "ACTIVE" | "SUSPENDED";
  revision: number;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...value,
    roles: [...value.roles].sort(),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}
function auditResponse(value: {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  correlationId: string;
  createdAt: Date;
}) {
  return { ...value, createdAt: iso(value.createdAt) };
}
function responseSchema(permission: AdminPermission) {
  return permission;
}

export function registerAdminOpsRoutes(
  app: Api,
  guard: AdminRouteGuard,
  service: AdminOpsService,
): void {
  app.get(
    "/v1/admin/accounts",
    {
      schema: {
        querystring: AdminAccountsQueryV1Schema,
        response: {
          200: AdminAccountsResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        responseSchema("account.read"),
      );
      const result = await invoke(() =>
        service.listAccounts(AdminAccountsQueryV1Schema.parse(request.query)),
      );
      if ("kind" in result) throw invalid();
      noStore(reply);
      return {
        items: result.items.map(accountResponse),
        nextCursor: result.nextCursor ?? null,
      };
    },
  );
  app.get(
    "/v1/admin/users",
    {
      schema: {
        querystring: AdminUsersQueryV1Schema,
        response: {
          200: AdminUsersResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(request, responseSchema("user.read"));
      const result = await invoke(() =>
        service.listUsers(AdminUsersQueryV1Schema.parse(request.query)),
      );
      if ("kind" in result) throw invalid();
      noStore(reply);
      return {
        items: result.items.map(userResponse),
        nextCursor: result.nextCursor ?? null,
      };
    },
  );
  app.get(
    "/v1/admin/accounts/:account_id/subscription",
    {
      schema: {
        params: AdminAccountParamsV1Schema,
        response: {
          200: AdminSubscriptionResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        responseSchema("subscription.read"),
      );
      const params = AdminAccountParamsV1Schema.parse(request.params);
      const result = await invoke(() =>
        service.readSubscription(params.account_id),
      );
      if (result.kind === "ACCOUNT_NOT_FOUND")
        throw adminFailure("ACCOUNT_NOT_FOUND");
      if (result.kind !== "OK") throw unavailable();
      noStore(reply);
      const value = result.value;
      return {
        accountId: value.accountId,
        access: value.access,
        subscription: value.subscription
          ? {
              id: value.subscription.id,
              state: value.subscription.state,
              stateRevision: value.subscription.stateRevision,
              plan: value.subscription.plan,
              price: value.subscription.price
                ? {
                    priceRevisionId: value.subscription.price.priceRevisionId,
                    amountMinor: value.subscription.price.amountMinor,
                    currency: value.subscription.price.currency,
                    billingInterval: {
                      unit: value.subscription.price.billingIntervalUnit,
                      count: value.subscription.price.billingIntervalCount,
                    },
                  }
                : null,
              currentPeriodStart: iso(value.subscription.currentPeriodStart),
              currentPeriodEnd: iso(value.subscription.currentPeriodEnd),
              graceUntil: value.subscription.graceUntil
                ? iso(value.subscription.graceUntil)
                : null,
              cancelAtPeriodEnd: value.subscription.cancelAtPeriodEnd,
            }
          : null,
        deviceAllowance: value.deviceAllowance,
      };
    },
  );
  app.get(
    "/v1/admin/accounts/:account_id/devices",
    {
      schema: {
        params: AdminAccountParamsV1Schema,
        querystring: AdminDeviceQueryV1Schema,
        response: {
          200: AdminDevicesResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        responseSchema("device.read"),
      );
      const params = AdminAccountParamsV1Schema.parse(request.params);
      const query = AdminDeviceQueryV1Schema.parse(request.query);
      const result = await invoke(() =>
        service.listDevices({ accountId: params.account_id, ...query }),
      );
      if ("kind" in result) {
        if (result.kind === "INVALID" || result.kind === "INVALID_CURSOR")
          throw invalid();
        if (result.kind === "ACCOUNT_NOT_FOUND")
          throw adminFailure(result.kind);
        throw unavailable();
      }
      noStore(reply);
      return {
        items: result.items.map(deviceResponse),
        nextCursor: result.nextCursor ?? null,
      };
    },
  );
  app.post(
    "/v1/admin/accounts/:account_id/devices/:device_id/revoke",
    {
      schema: {
        params: AdminDeviceParamsV1Schema,
        body: AdminDeviceRevokeBodyV1Schema,
        response: {
          200: AdminDeviceRevokeResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        responseSchema("device.revoke"),
      );
      const params = AdminDeviceParamsV1Schema.parse(request.params);
      const body = AdminDeviceRevokeBodyV1Schema.parse(request.body);
      const result = await invoke(() =>
        service.revokeDevice({
          accountId: params.account_id,
          deviceId: params.device_id,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
          reason: body.reason,
        }),
      );
      if (result === "FORBIDDEN") throw adminFailure(result);
      if (result === "NOT_FOUND") throw adminFailure(result);
      noStore(reply);
      return {
        status: "revoked" as const,
        deviceId: params.device_id,
        idempotent: result === "ALREADY_REVOKED",
      };
    },
  );
  app.get(
    "/v1/admin/audit-events",
    {
      schema: {
        querystring: AdminAuditEventsQueryV1Schema,
        response: {
          200: AdminAuditEventsResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        responseSchema("admin.audit.read"),
      );
      const result = await invoke(() =>
        service.listAuditEvents(
          AdminAuditEventsQueryV1Schema.parse(request.query),
        ),
      );
      if ("kind" in result) throw invalid();
      noStore(reply);
      return {
        items: result.items.map(auditResponse),
        nextCursor: result.nextCursor ?? null,
      };
    },
  );
  app.get(
    "/v1/admin/principals",
    {
      schema: {
        querystring: AdminPrincipalsQueryV1Schema,
        response: {
          200: AdminPrincipalsResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      await guard.requireAdminPermission(
        request,
        responseSchema("admin.principal.read"),
      );
      const result = await invoke(() =>
        service.listPrincipals(
          AdminPrincipalsQueryV1Schema.parse(request.query),
        ),
      );
      if ("kind" in result) throw invalid();
      noStore(reply);
      return {
        items: result.items.map(principalResponse),
        nextCursor: result.nextCursor ?? null,
      };
    },
  );
  app.post(
    "/v1/admin/principals",
    {
      schema: {
        body: AdminPrincipalCreateBodyV1Schema,
        response: {
          200: AdminPrincipalItemV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        responseSchema("admin.principal.manage"),
      );
      const body = AdminPrincipalCreateBodyV1Schema.parse(request.body);
      const result = await invoke(() =>
        service.createPrincipal({
          ...body,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      if (result.kind !== "OK") throw adminFailure(result.kind);
      noStore(reply);
      return principalResponse(result.principal);
    },
  );
  app.post(
    "/v1/admin/principals/:principal_id/roles/:role/grant",
    {
      schema: {
        params: AdminPrincipalRoleParamsV1Schema,
        body: AdminPrincipalMutationBodyV1Schema,
        response: {
          200: AdminPrincipalItemV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        responseSchema("admin.principal.manage"),
      );
      const params = AdminPrincipalRoleParamsV1Schema.parse(request.params);
      const body = AdminPrincipalMutationBodyV1Schema.parse(request.body);
      const result = await invoke(() =>
        service.grantRole({
          principalId: params.principal_id,
          role: params.role,
          ...body,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      if (result.kind !== "OK") throw adminFailure(result.kind);
      noStore(reply);
      return principalResponse(result.principal);
    },
  );
  app.post(
    "/v1/admin/principals/:principal_id/roles/:role/revoke",
    {
      schema: {
        params: AdminPrincipalRoleParamsV1Schema,
        body: AdminPrincipalMutationBodyV1Schema,
        response: {
          200: AdminPrincipalItemV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) => {
      const { subject } = await guard.requireAdminMutation(
        request,
        responseSchema("admin.principal.manage"),
      );
      const params = AdminPrincipalRoleParamsV1Schema.parse(request.params);
      const body = AdminPrincipalMutationBodyV1Schema.parse(request.body);
      const result = await invoke(() =>
        service.revokeRole({
          principalId: params.principal_id,
          role: params.role,
          ...body,
          actorId: subject.adminPrincipalId,
          correlationId: request.id,
        }),
      );
      if (result.kind !== "OK") throw adminFailure(result.kind);
      noStore(reply);
      return principalResponse(result.principal);
    },
  );
  for (const [path, status] of [
    ["/v1/admin/principals/:principal_id/suspend", "SUSPENDED"],
    ["/v1/admin/principals/:principal_id/restore", "ACTIVE"],
  ] as const) {
    app.post(
      path,
      {
        schema: {
          params: AdminPrincipalMutationParamsV1Schema,
          body: AdminPrincipalMutationBodyV1Schema,
          response: {
            200: AdminPrincipalStatusResponseV1Schema,
            400: ApiErrorEnvelopeV1Schema,
            401: ApiErrorEnvelopeV1Schema,
            403: ApiErrorEnvelopeV1Schema,
            409: ApiErrorEnvelopeV1Schema,
            503: ApiErrorEnvelopeV1Schema,
          },
        },
      },
      async (request, reply) => {
        const { subject } = await guard.requireAdminMutation(
          request,
          responseSchema("admin.principal.manage"),
        );
        const params = AdminPrincipalMutationParamsV1Schema.parse(
          request.params,
        );
        const body = AdminPrincipalMutationBodyV1Schema.parse(request.body);
        const result = await invoke(() =>
          service.setPrincipalStatus({
            principalId: params.principal_id,
            status,
            ...body,
            actorId: subject.adminPrincipalId,
            correlationId: request.id,
          }),
        );
        if (result.kind !== "OK") throw adminFailure(result.kind);
        noStore(reply);
        return {
          changed: result.changed,
          principal: principalResponse(result.principal),
        };
      },
    );
  }
}
