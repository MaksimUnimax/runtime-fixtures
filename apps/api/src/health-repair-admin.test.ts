import { describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminAuthRepository,
  type AdminRole,
} from "@product/admin-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";
import type { HealthRepairReadRepository } from "./health-repair-admin.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost/test",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const token = "repair-admin-session";
const scope = "a".repeat(64);

function fixture(role: AdminRole) {
  const repository: AdminAuthRepository = {
    createAdminSession: vi.fn(),
    authenticateAdminSession: vi.fn(async () => ({
      kind: "authenticated" as const,
      subject: {
        adminPrincipalId: "00000000-0000-4000-8000-000000000001",
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
  const service: HealthRepairReadRepository = {
    listCases: vi.fn(async () => ({ items: [], nextCursor: null })),
    getCase: vi.fn(async () => null),
  };
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    healthRepairAdminService: service,
  });
  const csrf = auth.csrf(token);
  return {
    app,
    service,
    headers: {
      cookie: `pcp_admin_session=${token}; pcp_admin_csrf=${csrf}`,
    },
  };
}

describe("S2 repair admin read boundary", () => {
  it("denies unauthenticated repair reads", async () => {
    const f = fixture("ADMIN_OWNER");
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/health/repair-cases?scopeSha256=${scope}`,
    });
    expect(response.statusCode).toBe(401);
    expect(f.service.listCases).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("requires health.read in addition to AI read permissions", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/health/repair-cases?scopeSha256=${scope}`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(f.service.listCases).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("allows ADMIN_OPS bounded read without CSRF", async () => {
    const f = fixture("ADMIN_OPS");
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/health/repair-cases?scopeSha256=${scope}&limit=1`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(f.service.listCases).toHaveBeenCalledWith({
      scopeSha256: scope,
      limit: 1,
      cursor: undefined,
    });
    await f.app.close();
  });

  it("rejects a malformed opaque cursor before DB read", async () => {
    const f = fixture("ADMIN_OPS");
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/health/repair-cases?scopeSha256=${scope}&cursor=not-json`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(400);
    expect(f.service.listCases).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("scopes detail reads and returns 404 for an absent case", async () => {
    const f = fixture("ADMIN_OPS");
    const caseId = "00000000-0000-4000-8000-000000000004";
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/health/repair-cases/${caseId}/2?scopeSha256=${scope}`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(404);
    expect(f.service.getCase).toHaveBeenCalledWith({
      scopeSha256: scope,
      repairCaseId: caseId,
      caseRevision: 2,
    });
    await f.app.close();
  });

  it("does not expose a repair mutation route", async () => {
    const f = fixture("ADMIN_OWNER");
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/admin/health/repair-cases",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(404);
    await f.app.close();
  });
});
