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
  HealthDiagnosticsReadRepository,
  HealthDiagnosticsSummary,
  HealthDiagnosticsBreakdown,
  HealthDiagnosticsStateCount,
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
  diagnosticsService: HealthDiagnosticsReadRepository;
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
  const diagnosticsService: HealthDiagnosticsReadRepository = {
    getSummary: vi.fn(
      async () =>
        ({
          generatedAt: "2030-01-01T00:00:00.000Z",
          window: "24h",
          windowStart: "2029-12-31T00:00:00.000Z",
          windowEnd: "2030-01-01T00:00:00.000Z",
          latestHealthObservationAt: null,
          stale: true,
          currentTargets: [],
          stateCounts: [
            "HEALTHY",
            "DRIFT",
            "DEGRADED",
            "BROKEN",
            "UNKNOWN",
            "MAINTENANCE",
          ].map((state) => ({
            state,
            count: 0,
          })) as unknown as HealthDiagnosticsStateCount[],
          productQualityCounts: ["HEALTHY", "DRIFT", "DEGRADED", "BROKEN"].map(
            (state) => ({ state, count: 0 }),
          ) as unknown as HealthDiagnosticsStateCount[],
          environmentCounts: ["UNKNOWN", "MAINTENANCE"].map((state) => ({
            state,
            count: 0,
          })) as unknown as HealthDiagnosticsStateCount[],
          activeIncidentCount: 0,
          notification: {
            pending: 0,
            claimed: 0,
            retryableFailures: 0,
            terminalFailures: 0,
            suppressed: 0,
            delivered: 0,
            oldestPendingAt: null,
            nextRetryAt: null,
            recentRecoveryNotifications: 0,
            recentEscalationNotifications: 0,
          },
          scheduler: {
            latestSuccessfulScheduledRunAt: null,
            latestFailedScheduledExecutionAt: null,
            overdueDueTargetCount: 0,
            retryingExecutionCount: 0,
          },
        }) as unknown as HealthDiagnosticsSummary,
    ),
    getBreakdown: vi.fn(
      async () =>
        ({
          generatedAt: "2030-01-01T00:00:00.000Z",
          window: "24h",
          windowStart: "2029-12-31T00:00:00.000Z",
          windowEnd: "2030-01-01T00:00:00.000Z",
          providerSurface: [],
          browsers: [],
          profiles: [],
          incidentRoots: [],
        }) as unknown as HealthDiagnosticsBreakdown,
    ),
  };
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    healthAdminService: service,
    healthNotificationAdminService: notificationService,
    healthDiagnosticsService: diagnosticsService,
  });
  const csrf = auth.csrf(token);
  return {
    app,
    service,
    notificationService,
    diagnosticsService,
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

  it("allows bounded diagnostics to ADMIN_OPS and denies support and unauthenticated callers", async () => {
    const ops = fixture("ADMIN_OPS");
    const allowed = await ops.app.inject({
      method: "GET",
      url: "/v1/admin/health/diagnostics/summary?window=24h",
      headers: ops.headers,
    });
    expect(allowed.statusCode).toBe(200);
    expect(ops.diagnosticsService.getSummary).toHaveBeenCalledWith({
      window: "24h",
    });
    await ops.app.close();

    const support = fixture("ADMIN_SUPPORT");
    const denied = await support.app.inject({
      method: "GET",
      url: "/v1/admin/health/diagnostics/summary",
      headers: support.headers,
    });
    expect(denied.statusCode).toBe(403);
    expect(support.diagnosticsService.getSummary).not.toHaveBeenCalled();
    await support.app.close();

    const anonymous = fixture("ADMIN_OPS");
    const unauthenticated = await anonymous.app.inject({
      method: "GET",
      url: "/v1/admin/health/diagnostics/breakdown",
    });
    expect(unauthenticated.statusCode).toBe(401);
    await anonymous.app.close();
  });

  it("rejects unsupported diagnostic windows and exposes no write routes", async () => {
    const f = fixture("ADMIN_OPS");
    const invalid = await f.app.inject({
      method: "GET",
      url: "/v1/admin/health/diagnostics/summary?window=all",
      headers: f.headers,
    });
    expect(invalid.statusCode).toBe(400);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
      expect(
        (
          await f.app.inject({
            method,
            url: "/v1/admin/health/diagnostics/summary",
            headers: f.headers,
          })
        ).statusCode,
      ).toBe(404);
    }
    await f.app.close();
  });
});
