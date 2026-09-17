import { afterEach, describe, expect, it } from "vitest";
import type { AdminSubject } from "@product/admin-auth";
import { AdminAuthService } from "@product/admin-auth";
import { AdminOpsService, type AdminOpsRepository } from "@product/admin-ops";
import type { PortalSubscriptionRead } from "@product/commercial-access";
import { createApiApp } from "./app.js";
import { generateOpenApiRepresentation } from "./openapi.js";

const token = "admin-token";
const csrf = "valid-admin-csrf";
const accountId = "00000000-0000-4000-8000-000000000004";
const deviceId = "00000000-0000-4000-8000-000000000005";
const principalId = "00000000-0000-4000-8000-000000000006";
const userId = "00000000-0000-4000-8000-000000000007";
const actorId = "00000000-0000-4000-8000-000000000001";
const createdAt = new Date("2026-09-08T10:00:00.000Z");
const updatedAt = new Date("2026-09-08T11:00:00.000Z");

const allPermissions = [
  "account.read",
  "user.read",
  "subscription.read",
  "device.read",
  "device.revoke",
  "admin.audit.read",
  "admin.principal.read",
  "admin.principal.manage",
] as const;

const ownerSubject: AdminSubject = {
  adminPrincipalId: actorId,
  userId: "00000000-0000-4000-8000-000000000002",
  adminSessionId: "00000000-0000-4000-8000-000000000003",
  roles: ["ADMIN_OWNER"],
  permissions: [...allPermissions],
  expiresAt: new Date("2026-09-08T12:00:00.000Z"),
};

const emptySubscription: PortalSubscriptionRead = {
  accountId,
  access: { status: "INELIGIBLE", reason: "NO_CURRENT_SUBSCRIPTION" },
  subscription: null,
  deviceAllowance: {
    maxActive: null,
    activeCount: 0,
    remaining: null,
    overLimit: false,
  },
  billing: {
    purchaseStatus: "UNAVAILABLE",
    reason: "PAYMENT_GO_LIVE_DEFERRED",
  },
};

type RepositoryBehavior = {
  listAccounts?: AdminOpsRepository["listAccounts"];
  listUsers?: AdminOpsRepository["listUsers"];
  listDevices?: AdminOpsRepository["listDevices"];
  listAuditEvents?: AdminOpsRepository["listAuditEvents"];
  listPrincipals?: AdminOpsRepository["listPrincipals"];
  revokeDevice?: AdminOpsRepository["revokeDevice"];
  createPrincipal?: AdminOpsRepository["createPrincipal"];
  grantRole?: AdminOpsRepository["grantRole"];
  revokeRole?: AdminOpsRepository["revokeRole"];
  setPrincipalStatus?: AdminOpsRepository["setPrincipalStatus"];
};

type AppOptions = {
  subject?: AdminSubject;
  repository?: RepositoryBehavior;
  subscription?:
    | PortalSubscriptionRead
    | { kind: "ACCOUNT_NOT_FOUND" }
    | { kind: "SERVICE_UNAVAILABLE" };
  csrfValid?: boolean;
};

function makeRepository(
  behavior: RepositoryBehavior,
  calls: Record<string, number>,
): AdminOpsRepository {
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  return {
    listAccounts: async (input) => {
      count("listAccounts");
      return behavior.listAccounts?.(input) ?? { items: [] };
    },
    listUsers: async (input) => {
      count("listUsers");
      return behavior.listUsers?.(input) ?? { items: [] };
    },
    listDevices: async (input) => {
      count("listDevices");
      return behavior.listDevices?.(input) ?? { items: [] };
    },
    listAuditEvents: async (input) => {
      count("listAuditEvents");
      return behavior.listAuditEvents?.(input) ?? { items: [] };
    },
    listPrincipals: async (input) => {
      count("listPrincipals");
      return behavior.listPrincipals?.(input) ?? { items: [] };
    },
    revokeDevice: async (input) => {
      count("revokeDevice");
      return behavior.revokeDevice?.(input) ?? "NOT_FOUND";
    },
    createPrincipal: async (input) => {
      count("createPrincipal");
      return behavior.createPrincipal?.(input) ?? { kind: "CONFLICT" };
    },
    grantRole: async (input) => {
      count("grantRole");
      return behavior.grantRole?.(input) ?? { kind: "CONFLICT" };
    },
    revokeRole: async (input) => {
      count("revokeRole");
      return behavior.revokeRole?.(input) ?? { kind: "CONFLICT" };
    },
    setPrincipalStatus: async (input) => {
      count("setPrincipalStatus");
      return behavior.setPrincipalStatus?.(input) ?? { kind: "NOT_FOUND" };
    },
  };
}

function makeApp(options: AppOptions = {}) {
  const calls: Record<string, number> = {};
  const subject = options.subject ?? ownerSubject;
  const adminAuth = {
    authenticateAdminSession: async () => ({
      ok: true as const,
      value: subject,
    }),
    authorize: (candidate: AdminSubject, permission: string) =>
      candidate.permissions.includes(permission as never)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, code: "ADMIN_FORBIDDEN" as const },
    csrfValid: () => options.csrfValid ?? false,
  } as unknown as AdminAuthService;
  const repository = makeRepository(options.repository ?? {}, calls);
  const commercialPortal = {
    readAccountSubscription: async () => {
      const result = options.subscription ?? emptySubscription;
      return "kind" in result ? result : { kind: "OK" as const, value: result };
    },
  };
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://unused",
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    adminAuthService: adminAuth,
    adminOpsService: new AdminOpsService(repository, commercialPortal as never),
  });
  return { app, calls };
}

const adminCookie = `pcp_admin_session=${token}`;
const mutationHeaders = {
  cookie: `${adminCookie}; pcp_admin_csrf=${csrf}`,
  "x-csrf-token": csrf,
};
const mutationBody = { expectedRevision: 3, reason: "ticket-123" };
const principal = {
  principalId,
  userId,
  status: "ACTIVE" as const,
  revision: 3,
  roles: ["ADMIN_SUPPORT", "ADMIN_OWNER"] as const,
  createdAt,
  updatedAt,
};

describe("P6.2 admin API boundary", () => {
  const apps: Awaited<ReturnType<typeof makeApp>>["app"][] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  it.each([
    ["GET", "/v1/admin/accounts"],
    ["GET", "/v1/admin/users"],
    ["GET", "/v1/admin/audit-events"],
    ["GET", "/v1/admin/principals"],
    ["GET", `/v1/admin/accounts/${accountId}/devices`],
  ] as const)("rejects unauthenticated read %s %s", async (method, url) => {
    const { app } = makeApp();
    apps.push(app);
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("ADMIN_UNAUTHORIZED");
  });

  it("does not require CSRF for a read", async () => {
    const { app } = makeApp();
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("requires admin CSRF for device revoke", async () => {
    const { app } = makeApp();
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/accounts/${accountId}/devices/${deviceId}/revoke`,
      headers: { cookie: adminCookie },
      payload: { reason: "ticket" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_CSRF_INVALID");
  });

  it("rejects unknown mutation fields strictly", async () => {
    const { app } = makeApp({ csrfValid: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/principals",
      headers: mutationHeaders,
      payload: {
        userId,
        initialRole: "ADMIN_OPS",
        reason: "ticket",
        extra: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a read caller without the exact permission", async () => {
    const { app, calls } = makeApp({
      subject: { ...ownerSubject, permissions: ["user.read"] },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_FORBIDDEN");
    expect(calls.listAccounts ?? 0).toBe(0);
  });

  it("rejects a mutation caller without the exact permission", async () => {
    const { app, calls } = makeApp({
      subject: { ...ownerSubject, permissions: ["admin.principal.read"] },
      csrfValid: true,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/principals",
      headers: mutationHeaders,
      payload: { userId, initialRole: "ADMIN_OPS", reason: "ticket" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_FORBIDDEN");
    expect(calls.createPrincipal ?? 0).toBe(0);
  });

  it("maps a missing subscription account to a safe resource error", async () => {
    const { app } = makeApp({ subscription: { kind: "ACCOUNT_NOT_FOUND" } });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/accounts/${accountId}/subscription`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
    expect(body.error.message).toBe("Admin resource not found");
    expect(JSON.stringify(body)).not.toMatch(
      /SQL|ACCOUNT_NOT_FOUND|accountId/i,
    );
  });

  it("maps principal creation conflict to the controller error contract", async () => {
    const { app, calls } = makeApp({
      repository: { createPrincipal: async () => ({ kind: "CONFLICT" }) },
      csrfValid: true,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/principals",
      headers: mutationHeaders,
      payload: { userId, initialRole: "ADMIN_OPS", reason: "ticket" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ADMIN_CONFLICT");
    expect(calls.createPrincipal).toBe(1);
  });

  it("maps a stale role grant to ADMIN_STATE_STALE", async () => {
    const { app, calls } = makeApp({
      repository: { grantRole: async () => ({ kind: "STALE" }) },
      csrfValid: true,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/principals/${principalId}/roles/ADMIN_OPS/grant`,
      headers: mutationHeaders,
      payload: mutationBody,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ADMIN_STATE_STALE");
    expect(calls.grantRole).toBe(1);
  });

  it("maps last-owner role removal to ADMIN_LAST_OWNER_REQUIRED", async () => {
    const { app, calls } = makeApp({
      repository: { revokeRole: async () => ({ kind: "LAST_OWNER" }) },
      csrfValid: true,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/principals/${principalId}/roles/ADMIN_OWNER/revoke`,
      headers: mutationHeaders,
      payload: mutationBody,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ADMIN_LAST_OWNER_REQUIRED");
    expect(calls.revokeRole).toBe(1);
  });

  it("returns a non-empty account projection without private fields", async () => {
    const { app } = makeApp({
      repository: {
        listAccounts: async () => ({
          items: [
            {
              id: accountId,
              status: "ACTIVE",
              displayName: "Operations account",
              createdAt,
              updatedAt,
            },
          ],
          nextCursor: undefined,
        }),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/accounts",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body).toEqual({
      items: [
        {
          id: accountId,
          status: "ACTIVE",
          displayName: "Operations account",
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "createdAt",
      "displayName",
      "id",
      "status",
      "updatedAt",
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /email|subscription|payment|session|token|auditMetadata/i,
    );
  });

  it("returns non-empty users with only safe, ordered email fields", async () => {
    const firstVerifiedAt = new Date("2026-09-08T09:00:00.000Z");
    const { app } = makeApp({
      repository: {
        listUsers: async () => ({
          items: [
            {
              id: userId,
              status: "ACTIVE",
              emails: [
                { email: "primary@example.test", verifiedAt: firstVerifiedAt },
                { email: "older@example.test", verifiedAt: null },
              ],
              createdAt,
              updatedAt,
            },
          ],
          nextCursor: undefined,
        }),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: userId,
          status: "ACTIVE",
          emails: [
            {
              email: "primary@example.test",
              verifiedAt: firstVerifiedAt.toISOString(),
            },
            { email: "older@example.test", verifiedAt: null },
          ],
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /otp|challenge|portalSession|adminSession|tokenHash|account/i,
    );
  });

  it("returns the non-empty safe subscription projection", async () => {
    const subscription: PortalSubscriptionRead = {
      accountId,
      access: { status: "ELIGIBLE", reason: null },
      subscription: {
        id: "00000000-0000-4000-8000-000000000008",
        accountId,
        state: "ACTIVE",
        stateRevision: 4,
        currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
        graceUntil: null,
        cancelAtPeriodEnd: false,
        plan: {
          planRevisionId: "00000000-0000-4000-8000-000000000009",
          planCode: "PRO",
          planRevision: 2,
          displayName: "Professional",
        },
        price: {
          priceRevisionId: "00000000-0000-4000-8000-00000000000a",
          amountMinor: 1900,
          currency: "USD",
          billingIntervalUnit: "MONTH",
          billingIntervalCount: 1,
        },
      },
      deviceAllowance: {
        maxActive: 3,
        activeCount: 1,
        remaining: 2,
        overLimit: false,
      },
      billing: {
        purchaseStatus: "UNAVAILABLE",
        reason: "PAYMENT_GO_LIVE_DEFERRED",
      },
    };
    const { app } = makeApp({ subscription });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/accounts/${accountId}/subscription`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      accountId,
      access: { status: "ELIGIBLE", reason: null },
      subscription: {
        id: "00000000-0000-4000-8000-000000000008",
        state: "ACTIVE",
        stateRevision: 4,
        plan: {
          planRevisionId: "00000000-0000-4000-8000-000000000009",
          planCode: "PRO",
          planRevision: 2,
          displayName: "Professional",
        },
        price: {
          priceRevisionId: "00000000-0000-4000-8000-00000000000a",
          amountMinor: 1900,
          currency: "USD",
          billingInterval: { unit: "MONTH", count: 1 },
        },
        currentPeriodStart: "2026-09-01T00:00:00.000Z",
        currentPeriodEnd: "2026-10-01T00:00:00.000Z",
        graceUntil: null,
        cancelAtPeriodEnd: false,
      },
      deviceAllowance: {
        maxActive: 3,
        activeCount: 1,
        remaining: 2,
        overLimit: false,
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /provider|paymentHistory|checkout|billingEvent|reconciliation|stateReason|auditReason|safeMetadata/i,
    );
  });

  it("returns non-empty devices without authorization secrets", async () => {
    const { app } = makeApp({
      repository: {
        listDevices: async () => ({
          items: [
            {
              id: deviceId,
              status: "ACTIVE",
              label: "Work browser",
              browserFamily: "chrome",
              browserVersionLastSeen: "140.0",
              extensionVersionLastSeen: "6.2.0",
              createdAt,
              activatedAt: createdAt,
              lastSeenAt: updatedAt,
              revokedAt: null,
            },
          ],
          nextCursor: undefined,
        }),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/accounts/${accountId}/devices`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      items: [
        {
          id: deviceId,
          status: "ACTIVE",
          label: "Work browser",
          browserFamily: "chrome",
          browserVersionLastSeen: "140.0",
          extensionVersionLastSeen: "6.2.0",
          createdAt: createdAt.toISOString(),
          activatedAt: createdAt.toISOString(),
          lastSeenAt: updatedAt.toISOString(),
          revokedAt: null,
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /sessionId|refreshToken|tokenHash|tokenFamily|authorizationSecret/i,
    );
  });

  it("returns non-empty audit events without reason or metadata", async () => {
    const { app } = makeApp({
      repository: {
        listAuditEvents: async () => ({
          items: [
            {
              id: "00000000-0000-4000-8000-00000000000b",
              actorType: "ADMIN_PRINCIPAL",
              actorId,
              action: "DEVICE_REVOKED",
              targetType: "DEVICE",
              targetId: deviceId,
              correlationId: "00000000-0000-4000-8000-00000000000c",
              createdAt,
            },
          ],
          nextCursor: undefined,
        }),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/audit-events",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      items: [
        {
          id: "00000000-0000-4000-8000-00000000000b",
          actorType: "ADMIN_PRINCIPAL",
          actorId,
          action: "DEVICE_REVOKED",
          targetType: "DEVICE",
          targetId: deviceId,
          correlationId: "00000000-0000-4000-8000-00000000000c",
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "action",
      "actorId",
      "actorType",
      "correlationId",
      "createdAt",
      "id",
      "targetId",
      "targetType",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/reason|safeMetadata/i);
  });

  it("returns non-empty principals with sorted roles and no session data", async () => {
    const { app } = makeApp({
      repository: {
        listPrincipals: async () => ({
          items: [
            {
              ...principal,
              roles: ["ADMIN_SUPPORT", "ADMIN_OWNER"],
            },
          ],
          nextCursor: undefined,
        }),
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/principals",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      items: [
        {
          principalId,
          userId,
          status: "ACTIVE",
          revision: 3,
          roles: ["ADMIN_OWNER", "ADMIN_SUPPORT"],
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /email|adminSessionId|sessionTokenHash|sourcePortalSession|csrf/i,
    );
  });

  it("returns the exact safe shape for a successful device revoke", async () => {
    const { app, calls } = makeApp({
      repository: { revokeDevice: async () => "REVOKED" },
      csrfValid: true,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/accounts/${accountId}/devices/${deviceId}/revoke`,
      headers: mutationHeaders,
      payload: { reason: "ticket" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      status: "revoked",
      deviceId,
      idempotent: false,
    });
    expect(calls.revokeDevice).toBe(1);
  });

  it("returns no-store for a principal read", async () => {
    const { app } = makeApp();
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/principals",
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("publishes the exact method tuples", async () => {
    const document = JSON.parse(await generateOpenApiRepresentation()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(
      Object.values(document.paths).reduce(
        (count, path) => count + Object.keys(path).length,
        0,
      ),
    ).toBe(105);
  });
});
