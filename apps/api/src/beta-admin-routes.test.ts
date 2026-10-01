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
  const invitation = {
    id: "00000000-0000-4000-8000-000000000010",
    status: "PENDING" as const,
    createdAt: new Date("2030-01-01T00:00:00.000Z"),
    expiresAt: new Date("2030-01-02T00:00:00.000Z"),
    consumedAt: null,
    revokedAt: null,
  };
  const service = {
    resolve: vi.fn(async () => ({ kind: "BETA" as const })),
    read: vi.fn(async () => state),
    mutate: vi.fn(async () => ({
      kind: "APPLIED" as const,
      replay: false,
      state,
    })),
    readIdentityInvitation: vi.fn(async () => invitation),
    createIdentityInvitation: vi.fn(async () => ({
      kind: "APPLIED" as const,
      replay: false,
      invitation,
    })),
    revokeIdentityInvitation: vi.fn(async () => ({
      kind: "APPLIED" as const,
      replay: false,
      invitation: {
        ...invitation,
        status: "REVOKED" as const,
        revokedAt: new Date("2030-01-01T00:05:00.000Z"),
      },
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

  it.each(["ADMIN_OWNER", "ADMIN_BETA_OPERATOR"] as const)(
    "%s can create and revoke a targeted invitation through CSRF-protected manage routes",
    async (role) => {
      const f = fixture(role);
      const created = await f.app.inject({
        method: "POST",
        url: "/v1/admin/beta/invitations",
        headers: f.headers,
        payload: {
          requestId: "targeted-invite-request-0001",
          expectedRevision: 1,
          email: "Reviewer.User@Example.Test",
          reason: "reviewer acceptance",
        },
      });
      expect(created.statusCode).toBe(200);
      expect(created.headers["cache-control"]).toBe("no-store");
      expect(created.json()).toEqual({
        invitationId: "00000000-0000-4000-8000-000000000010",
        status: "PENDING",
        createdAt: "2030-01-01T00:00:00.000Z",
        expiresAt: "2030-01-02T00:00:00.000Z",
        consumedAt: null,
        revokedAt: null,
        replay: false,
      });
      expect(JSON.stringify(created.json())).not.toContain("example.test");
      expect(f.service.createIdentityInvitation).toHaveBeenCalledWith({
        actorPrincipalId: principalId,
        requestId: "targeted-invite-request-0001",
        correlationId: expect.any(String),
        expectedRevision: 1,
        normalizedIdentityTarget: "reviewer.user@example.test",
        reason: "reviewer acceptance",
      });

      const revoked = await f.app.inject({
        method: "POST",
        url: "/v1/admin/beta/invitations/00000000-0000-4000-8000-000000000010/revoke",
        headers: f.headers,
        payload: {
          requestId: "targeted-revoke-request-0001",
          reason: "reviewer no longer required",
        },
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({
        invitationId: "00000000-0000-4000-8000-000000000010",
        status: "REVOKED",
        replay: false,
      });
      expect(f.service.revokeIdentityInvitation).toHaveBeenCalledWith({
        actorPrincipalId: principalId,
        invitationId: "00000000-0000-4000-8000-000000000010",
        requestId: "targeted-revoke-request-0001",
        correlationId: expect.any(String),
        reason: "reviewer no longer required",
      });
      await f.app.close();
    },
  );

  it("requires CSRF before targeted invitation creation reaches the service", async () => {
    const f = fixture("ADMIN_BETA_OPERATOR");
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/admin/beta/invitations",
      headers: { cookie: f.headers.cookie },
      payload: {
        requestId: "targeted-invite-no-csrf-0001",
        expectedRevision: 1,
        email: "reviewer@example.test",
        reason: "must not reach service",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_CSRF_INVALID");
    expect(f.service.createIdentityInvitation).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("support can read a targeted invitation but cannot create or revoke one", async () => {
    const f = fixture("ADMIN_SUPPORT");
    const read = await f.app.inject({
      method: "GET",
      url: "/v1/admin/beta/invitations/00000000-0000-4000-8000-000000000010",
      headers: f.headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      invitationId: "00000000-0000-4000-8000-000000000010",
      status: "PENDING",
    });
    expect(JSON.stringify(read.json())).not.toContain("example.test");

    const create = await f.app.inject({
      method: "POST",
      url: "/v1/admin/beta/invitations",
      headers: f.headers,
      payload: {
        requestId: "targeted-support-create-0001",
        expectedRevision: 1,
        email: "reviewer@example.test",
        reason: "forbidden",
      },
    });
    const revoke = await f.app.inject({
      method: "POST",
      url: "/v1/admin/beta/invitations/00000000-0000-4000-8000-000000000010/revoke",
      headers: f.headers,
      payload: {
        requestId: "targeted-support-revoke-0001",
        reason: "forbidden",
      },
    });
    expect(create.statusCode).toBe(403);
    expect(revoke.statusCode).toBe(403);
    expect(f.service.createIdentityInvitation).not.toHaveBeenCalled();
    expect(f.service.revokeIdentityInvitation).not.toHaveBeenCalled();
    await f.app.close();
  });

  it("maps a missing targeted invitation to the ordinary admin 404 envelope", async () => {
    const f = fixture("ADMIN_SUPPORT");
    vi.mocked(f.service.readIdentityInvitation).mockResolvedValueOnce(null);
    const response = await f.app.inject({
      method: "GET",
      url: "/v1/admin/beta/invitations/00000000-0000-4000-8000-000000000099",
      headers: f.headers,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
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
