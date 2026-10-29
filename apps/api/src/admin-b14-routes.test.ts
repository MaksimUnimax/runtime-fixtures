import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  permissionsForRoles,
  type AdminPermission,
  type AdminSubject,
} from "@product/admin-auth";
import {
  AdminOpsService,
  type AdminOpsRepository,
  type AdminPrincipal,
} from "@product/admin-ops";
import type { PortalSubscriptionRead } from "@product/commercial-access";
import { createApiApp } from "./app.js";

// Actual Fastify validation, routing and response serialization with fake
// authentication/repositories. These are HTTP boundary regressions, not
// evidence of PostgreSQL transactions, normal OTP or installed behavior.
const actorId = "00000000-0000-4000-8000-000000000101";
const principalId = "00000000-0000-4000-8000-000000000102";
const userId = "00000000-0000-4000-8000-000000000103";
const accountId = "00000000-0000-4000-8000-000000000104";
const deviceId = "00000000-0000-4000-8000-000000000105";
const beta = "ADMIN_BETA_OPERATOR" as const;
const at = new Date("2026-10-29T00:00:00.000Z");
const headers = {
  cookie: "pcp_admin_session=b14-test-session; pcp_admin_csrf=b14-test-csrf",
  "x-csrf-token": "b14-test-csrf",
};

function principal(overrides: Partial<AdminPrincipal> = {}): AdminPrincipal {
  return {
    principalId,
    userId,
    status: "ACTIVE",
    revision: 7,
    roles: [beta],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const apps: ReturnType<typeof createApiApp>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function fixture(
  options: {
    repository?: Partial<AdminOpsRepository>;
    subscription?: PortalSubscriptionRead;
    principal?: AdminPrincipal;
  } = {},
) {
  const current = options.principal ?? principal();
  const repository: AdminOpsRepository = {
    listAccounts: vi.fn(async () => ({ items: [] })),
    listUsers: vi.fn(async () => ({ items: [] })),
    listDevices: vi.fn(async () => ({ items: [] })),
    listAuditEvents: vi.fn(async () => ({ items: [] })),
    listPrincipals: vi.fn(async () => ({ items: [current] })),
    revokeDevice: vi.fn(async () => "REVOKED" as const),
    createPrincipal: vi.fn(async () => ({
      kind: "OK" as const,
      principal: { ...current, revision: 1 },
    })),
    grantRole: vi.fn(async () => ({
      kind: "OK" as const,
      principal: { ...current, revision: 8 },
    })),
    revokeRole: vi.fn(async () => ({
      kind: "OK" as const,
      principal: { ...current, revision: 8, roles: [] },
    })),
    setPrincipalStatus: vi.fn(
      async (
        input: Parameters<AdminOpsRepository["setPrincipalStatus"]>[0],
      ) => ({
        kind: "OK" as const,
        changed: true as const,
        revokedSessionCount: 0,
        principal: { ...current, revision: 8, status: input.status },
      }),
    ),
    ...options.repository,
  };
  const subject: AdminSubject = {
    adminPrincipalId: actorId,
    userId,
    adminSessionId: "00000000-0000-4000-8000-000000000106",
    roles: ["ADMIN_OWNER"],
    permissions: permissionsForRoles(["ADMIN_OWNER"]),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };
  const auth = {
    authenticateAdminSession: async () => ({
      ok: true as const,
      value: subject,
    }),
    authorize: (candidate: AdminSubject, permission: AdminPermission) =>
      candidate.permissions.includes(permission)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, code: "ADMIN_FORBIDDEN" as const },
    csrfValid: (token: string, header?: string, cookie?: string) =>
      token === "b14-test-session" &&
      header === "b14-test-csrf" &&
      cookie === "b14-test-csrf",
  } as unknown as AdminAuthService;
  const subscription: PortalSubscriptionRead = options.subscription ?? {
    accountId,
    accessBasis: "NONE",
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
  const commercial = {
    readAccountSubscription: async () => ({
      kind: "OK" as const,
      value: subscription,
    }),
  };
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://unused-b14-http-fixture",
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    adminOpsService: new AdminOpsService(repository, commercial as never),
  });
  apps.push(app);
  return { app, repository };
}

describe("B14 actual HTTP boundary with fake dependencies", () => {
  it.each(["", `?role=${beta}`])(
    "serializes an existing Beta principal and accepts its filter: %s",
    async (query) => {
      const { app, repository } = fixture();
      const response = await app.inject({
        method: "GET",
        url: `/v1/admin/principals${query}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        items: [{ principalId, roles: [beta] }],
        nextCursor: null,
      });
      if (query)
        expect(repository.listPrincipals).toHaveBeenCalledWith(
          expect.objectContaining({ role: beta }),
        );
    },
  );

  it("accepts a Beta initial role and serializes the created principal", async () => {
    const { app, repository } = fixture();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/principals",
      headers,
      payload: { userId, initialRole: beta, reason: "  B14 creation  " },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ revision: 1, roles: [beta] });
    expect(repository.createPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        initialRole: beta,
        actorId,
        reason: "B14 creation",
      }),
    );
  });

  it.each(["grant", "revoke"] as const)(
    "accepts the Beta role in a %s path",
    async (operation) => {
      const { app, repository } = fixture();
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/principals/${principalId}/roles/${beta}/${operation}`,
        headers,
        payload: { expectedRevision: 7, reason: "B14 Beta role change" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        principalId,
        revision: 8,
        roles: operation === "grant" ? [beta] : [],
      });
      expect(
        operation === "grant" ? repository.grantRole : repository.revokeRole,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ role: beta, expectedRevision: 7, actorId }),
      );
    },
  );

  it.each(["grant", "revoke"] as const)(
    "serializes %s of another role on an existing Beta principal",
    async (operation) => {
      const result = principal({
        revision: 8,
        roles: operation === "grant" ? [beta, "ADMIN_OPS"] : [beta],
      });
      const { app, repository } = fixture({
        repository: {
          grantRole: vi.fn(async () => ({
            kind: "OK" as const,
            principal: result,
          })),
          revokeRole: vi.fn(async () => ({
            kind: "OK" as const,
            principal: result,
          })),
        },
      });
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/principals/${principalId}/roles/ADMIN_OPS/${operation}`,
        headers,
        payload: { expectedRevision: 7, reason: "B14 existing Beta" },
      });
      // The fake repository has already returned its changed state. A
      // serialization failure must not masquerade as a failed mutation.
      expect(
        operation === "grant" ? repository.grantRole : repository.revokeRole,
      ).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        revision: 8,
        roles: result.roles,
      });
    },
  );

  it.each([
    ["suspend", "SUSPENDED"],
    ["restore", "ACTIVE"],
  ] as const)(
    "serializes the response after %s of a Beta principal",
    async (operation, status) => {
      const { app, repository } = fixture();
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/principals/${principalId}/${operation}`,
        headers,
        payload: { expectedRevision: 7, reason: "B14 existing Beta status" },
      });
      expect(repository.setPrincipalStatus).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        changed: true,
        principal: { principalId, status, revision: 8, roles: [beta] },
      });
    },
  );

  it.each([0x85, 0x9f, 0x61c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069])(
    "rejects audit reason control U+%s before the repository is called",
    async (code) => {
      const { app, repository } = fixture({
        principal: principal({ roles: ["ADMIN_SUPPORT"] }),
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/principals",
        headers,
        payload: {
          userId,
          initialRole: "ADMIN_SUPPORT",
          reason: `before${String.fromCodePoint(code)}after`,
        },
      });
      expect(repository.createPrincipal).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
    },
  );

  it.each([
    [`/v1/admin/principals/${principalId}/roles/ADMIN_OPS/grant`, "grantRole"],
    [
      `/v1/admin/principals/${principalId}/roles/ADMIN_OPS/revoke`,
      "revokeRole",
    ],
    [`/v1/admin/principals/${principalId}/suspend`, "setPrincipalStatus"],
    [`/v1/admin/principals/${principalId}/restore`, "setPrincipalStatus"],
    [
      `/v1/admin/accounts/${accountId}/devices/${deviceId}/revoke`,
      "revokeDevice",
    ],
  ] as const)(
    "rejects bidi reason on %s before invoking %s",
    async (url, method) => {
      const { app, repository } = fixture({
        principal: principal({ roles: ["ADMIN_SUPPORT"] }),
      });
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload: {
          ...(method === "revokeDevice" ? {} : { expectedRevision: 7 }),
          reason: "before\u202eafter",
        },
      });
      expect(repository[method]).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(400);
    },
  );

  it("preserves ordinary Unicode and trims a valid operator reason", async () => {
    const { app, repository } = fixture({
      repository: {
        createPrincipal: vi.fn(async () => ({
          kind: "OK" as const,
          principal: principal({ revision: 1, roles: ["ADMIN_SUPPORT"] }),
        })),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/principals",
      headers,
      payload: {
        userId,
        initialRole: "ADMIN_SUPPORT",
        reason: "  Проверено — 確認済み  ",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.createPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Проверено — 確認済み" }),
    );
  });

  it.each(["BETA", "COMMERCIAL", "NONE"] as const)(
    "preserves the authoritative %s accessBasis in the safe account response",
    async (accessBasis) => {
      const { app } = fixture({
        subscription: {
          accountId,
          accessBasis,
          access:
            accessBasis === "NONE"
              ? { status: "INELIGIBLE", reason: "NO_CURRENT_SUBSCRIPTION" }
              : { status: "ELIGIBLE", reason: null },
          subscription:
            accessBasis === "COMMERCIAL"
              ? {
                  id: "00000000-0000-4000-8000-000000000107",
                  accountId,
                  state: "ACTIVE",
                  stateRevision: 1,
                  currentPeriodStart: at,
                  currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
                  graceUntil: null,
                  cancelAtPeriodEnd: false,
                  plan: {
                    planRevisionId: "00000000-0000-4000-8000-000000000108",
                    planCode: "B14_PLAN",
                    planRevision: 1,
                    displayName: "B14 plan",
                  },
                  price: null,
                }
              : null,
          deviceAllowance: {
            maxActive: accessBasis === "COMMERCIAL" ? 3 : null,
            activeCount: 1,
            remaining: accessBasis === "COMMERCIAL" ? 2 : null,
            overLimit: false,
          },
          billing: {
            purchaseStatus: "UNAVAILABLE",
            reason: "PAYMENT_GO_LIVE_DEFERRED",
          },
        },
      });
      const response = await app.inject({
        method: "GET",
        url: `/v1/admin/accounts/${accountId}/subscription`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toMatchObject({ accountId, accessBasis });
      expect(response.json()).not.toHaveProperty("billing");
      if (accessBasis === "BETA")
        expect(response.json()).toMatchObject({
          access: { status: "ELIGIBLE", reason: null },
          subscription: null,
        });
    },
  );
});
