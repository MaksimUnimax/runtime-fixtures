import { describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminAuthRepository,
  type AdminRole,
} from "@product/admin-auth";
import type {
  HealthAdminReadRepository,
  HealthNotificationAdminReadRepository,
} from "@product/health";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost/test",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const principalId = "00000000-0000-4000-8000-000000000001";
const token = "health-admin-session";

function fixture(role: AdminRole): {
  app: ReturnType<typeof createApiApp>;
  headers: Record<string, string>;
  service: HealthAdminReadRepository;
  notificationService: HealthNotificationAdminReadRepository;
} {
  const repository: AdminAuthRepository = {
    createAdminSession: vi.fn(),
    authenticateAdminSession: vi.fn(async () => ({
      kind: "authenticated" as const,
      subject: {
        adminPrincipalId: principalId,
        userId: "00000000-0000-4000-8000-000000000002",
        adminSessionId: "00000000-0000-4000-8000-000000000003",
        roles: [role],
        expiresAt: new Date("2030-01-01T00:30:00Z"),
      },
    })),
    revokeAdminSession: vi.fn(async () => "revoked" as const),
    bootstrapOwner: vi.fn(),
  };
  const auth = new AdminAuthService(
    repository,
    deriveAdminAuthKeys(Buffer.alloc(32, 4)),
    () => new Date("2030-01-01T00:00:00Z"),
  );
  const service: HealthAdminReadRepository = {
    listTargets: vi.fn(async () => ({ items: [], nextCursor: null })),
    getTarget: vi.fn(async () => null),
    listIncidents: vi.fn(async () => ({ items: [], nextCursor: null })),
    getIncident: vi.fn(async () => null),
    listEvaluations: vi.fn(async () => ({ items: [], nextCursor: null })),
    getEvaluation: vi.fn(async () => null),
    listRecommendations: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const notificationService: HealthNotificationAdminReadRepository = {
    listNotifications: vi.fn(async () => ({ items: [], nextCursor: null })),
    getNotification: vi.fn(async () => null),
  };
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    healthAdminService: service,
    healthNotificationAdminService: notificationService,
  });
  const csrf = auth.csrf(token);
  return {
    app,
    service,
    notificationService,
    headers: { cookie: `pcp_admin_session=${token}; pcp_admin_csrf=${csrf}` },
  };
}

describe("S2-L7 Health admin route security", () => {
  it("denies unauthenticated Health reads", async () => {
    const f = fixture("ADMIN_OWNER");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/targets",
    });
    expect(response.statusCode).toBe(401);
    await f.app.close();
  });
  it("denies an ordinary admin role without health.read", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/targets",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(f.service.listTargets).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("allows an authorized owner read without CSRF and does not expose mutation routes", async () => {
    const f = fixture("ADMIN_OWNER");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/targets?limit=1",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(f.service.listTargets).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
    const mutation = await f.app.inject({
      method: "POST",
      url: "/v1/admin/health/targets",
      headers: f.headers,
    });
    expect(mutation.statusCode).toBe(404);
    await f.app.close();
  });

  it.each(["ADMIN_OWNER", "ADMIN_OPS"] as const)(
    "allows %s to list notification intents",
    async (role) => {
      const f = fixture(role);
      const response = await f.app.inject({
        method: "GET",
        url: "/v1/admin/health/notifications?limit=1",
        headers: f.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(f.notificationService.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      );
      await f.app.close();
    },
  );

  it("denies support notification reads before the repository", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/notifications",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(f.notificationService.listNotifications).not.toHaveBeenCalled();
    await f.app.close();
  });

  it.each([
    "ADMIN_SUPPORT",
    "ADMIN_BILLING_READONLY",
    "ADMIN_BETA_OPERATOR",
  ] as const)("denies %s notification reads", async (role) => {
    const f = fixture(role);
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/notifications",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(f.notificationService.listNotifications).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("rejects notification limits above the Health admin maximum", async () => {
    const f = fixture("ADMIN_OPS");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/notifications?limit=51",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(f.notificationService.listNotifications).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("rejects malformed notification cursors", async () => {
    const f = fixture("ADMIN_OPS");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/notifications?cursor=not-a-cursor",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(f.notificationService.listNotifications).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("does not expose notification mutation methods or routes", async () => {
    const f = fixture("ADMIN_OPS");
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      const response = await f.app.inject({
        method,
        url: "/v1/admin/health/notifications",
        headers: f.headers,
      });
      expect(response.statusCode).toBe(404);
    }
    expect(f.notificationService).not.toHaveProperty("claimDue");
    expect(f.notificationService).not.toHaveProperty("markDelivered");
    expect(f.notificationService).not.toHaveProperty("failClaim");
    await f.app.close();
  });

  it("returns missing notification details using standard not-found behavior", async () => {
    const f = fixture("ADMIN_OPS");
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/notifications/00000000-0000-4000-8000-000000000000",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(404);
    expect(f.notificationService.getNotification).toHaveBeenCalled();
    await f.app.close();
  });
});
