import { describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminAuthRepository,
  type AdminRole,
} from "@product/admin-auth";
import type { BetaAdmissionService } from "@product/beta-access";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const principalId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const token = "admin-session-token";
const state = {
  mode: "CLOSED" as const,
  capacity: 0,
  admitted: 0,
  remaining: 0,
  revision: 1,
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
};
const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost/test",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};

function fixture(role: AdminRole) {
  const repository: AdminAuthRepository = {
    createAdminSession: vi.fn(),
    authenticateAdminSession: vi.fn(async () => ({
      kind: "authenticated" as const,
      subject: {
        adminPrincipalId: principalId,
        userId,
        adminSessionId: sessionId,
        roles: [role],
        expiresAt: new Date("2030-01-01T00:30:00Z"),
      },
    })),
    revokeAdminSession: vi.fn(async () => "revoked" as const),
    bootstrapOwner: vi.fn(),
  };
  const adminAuth = new AdminAuthService(
    repository,
    deriveAdminAuthKeys(Buffer.alloc(32, 9)),
    () => new Date("2030-01-01T00:00:00Z"),
  );
  const service = {
    resolve: vi.fn(async () => ({ kind: "BETA" as const })),
    read: vi.fn(async () => state),
    mutate: vi.fn(async () => ({
      kind: "APPLIED" as const,
      replay: false,
      state,
    })),
  } as unknown as BetaAdmissionService;
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: adminAuth,
    betaAdmissionService: service,
  });
  const csrf = adminAuth.csrf(token);
  return {
    app,
    service,
    headers: {
      cookie: `pcp_admin_session=${token}; pcp_admin_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  };
}

const mutation = {
  requestId: "beta-route-request",
  expectedRevision: 1,
  action: "OPEN",
  reason: "route acceptance",
};

describe("S1.1 beta admin route authorization", () => {
  it.each(["ADMIN_OWNER", "ADMIN_BETA_OPERATOR"] as const)(
    "%s can read and mutate beta admission",
    async (role) => {
      const f = fixture(role);
      const read = await f.app.inject({
        method: "GET",
        url: "/v1/admin/beta/admission",
        headers: f.headers,
      });
      const write = await f.app.inject({
        method: "POST",
        url: "/v1/admin/beta/admission",
        headers: f.headers,
        payload: mutation,
      });
      expect(read.statusCode).toBe(200);
      expect(write.statusCode).toBe(200);
      expect(f.service.mutate).toHaveBeenCalledOnce();
      await f.app.close();
    },
  );

  it("reads one account admission without opening or mutating beta", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const accountId = "00000000-0000-4000-8000-000000000004";
    const response = await f.app.inject({
      method: "GET",
      url: `/v1/admin/beta/admission/accounts/${accountId}`,
      headers: f.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ accountId, admitted: true });
    expect(f.service.resolve).toHaveBeenCalledWith(accountId);
    expect(f.service.mutate).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("support can read beta admission but cannot mutate it", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const read = await f.app.inject({
      method: "GET",
      url: "/v1/admin/beta/admission",
      headers: f.headers,
    });
    const write = await f.app.inject({
      method: "POST",
      url: "/v1/admin/beta/admission",
      headers: f.headers,
      payload: mutation,
    });
    expect(read.statusCode).toBe(200);
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe("ADMIN_FORBIDDEN");
    expect(f.service.mutate).not.toHaveBeenCalled();
    await f.app.close();
  });

  it.each(["ADMIN_OPS", "ADMIN_BILLING_READONLY"] as const)(
    "%s cannot mutate beta admission implicitly",
    async (role) => {
      const f = fixture(role);
      const write = await f.app.inject({
        method: "POST",
        url: "/v1/admin/beta/admission",
        headers: f.headers,
        payload: mutation,
      });
      expect(write.statusCode).toBe(403);
      expect(f.service.mutate).not.toHaveBeenCalled();
      await f.app.close();
    },
  );
});
