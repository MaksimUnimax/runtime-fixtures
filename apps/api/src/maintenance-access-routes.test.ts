import { describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  MaintenanceAccessService,
  deriveAdminAuthKeys,
  adminSessionLookup,
  type AdminAuthRepository,
  type MaintenanceRepository,
  type MaintenanceGrant,
} from "@product/admin-auth";
import {
  AuthService,
  deriveAuthKeys,
  type AuthRepository,
} from "@product/auth";
import { createApiApp } from "./app.js";
import { createAdminRouteGuard } from "./admin-route-guard.js";

const now = new Date("2030-01-01T00:00:00Z");
function fixture() {
  const keys = deriveAdminAuthKeys(Buffer.alloc(32, 9));
  const humanToken = "human-test-credential";
  const subject = {
    adminPrincipalId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    adminSessionId: "00000000-0000-4000-8000-000000000003",
    roles: ["ADMIN_OWNER" as const],
    expiresAt: new Date(now.getTime() + 30 * 60_000),
  };
  let grant: MaintenanceGrant | null = null;
  let hash = "";
  const repository: MaintenanceRepository = {
    issue: vi.fn(async (input) => {
      hash = input.tokenHash;
      grant = {
        id: input.id,
        label: input.label,
        adminPrincipalId: subject.adminPrincipalId,
        userId: subject.userId,
        sourceAdminSessionId: subject.adminSessionId,
        createdAt: now,
        expiresAt: input.expiresAt,
        permissions: input.permissions,
        revokedAt: null,
      };
      return grant;
    }),
    authenticate: vi.fn(async (id, tokenHash) =>
      grant && grant.id === id && hash === tokenHash && !grant.revokedAt
        ? grant
        : null,
    ),
    rotate: vi.fn(async () => null),
    list: vi.fn(async () => (grant ? [grant] : [])),
    revoke: vi.fn(async () => {
      if (grant) grant.revokedAt = now;
      return !!grant;
    }),
  };
  const adminRepository: AdminAuthRepository = {
    createAdminSession: vi.fn(async () => ({ kind: "forbidden" as const })),
    authenticateAdminSession: vi.fn(async (tokenHash) =>
      tokenHash === adminSessionLookup(keys, humanToken)
        ? { kind: "authenticated" as const, subject }
        : { kind: "unauthorized" as const },
    ),
    revokeAdminSession: vi.fn(async () => "revoked" as const),
    bootstrapOwner: vi.fn(async () => ({ kind: "closed" as const })),
  };
  const portalRepository: AuthRepository = {
    listOwnedAccounts: vi.fn(async () => []),
    requestOtp: vi.fn(async () => ({
      ok: false as const,
      code: "AUTH_RATE_LIMITED" as const,
    })),
    verifyOtp: vi.fn(async () => ({
      ok: false as const,
      code: "AUTH_OTP_INVALID" as const,
    })),
    authenticate: vi.fn(async () => undefined),
    revoke: vi.fn(async () => "revoked" as const),
  };
  const admin = new AdminAuthService(
    adminRepository,
    keys,
    () => now,
    undefined,
    new MaintenanceAccessService(repository, () => now),
  );
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://test:test@localhost/test",
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    authService: new AuthService(
      portalRepository,
      deriveAuthKeys(Buffer.alloc(32, 8)),
      () => now,
    ),
    adminAuthService: admin,
  });
  const guard = createAdminRouteGuard(admin);
  app.post("/test-maintenance-write", async (request) => {
    await guard.requireAdminMutation(request, "compatibility.manage");
    return { allowed: true };
  });
  app.post("/test-principal-write", async (request) => {
    await guard.requireAdminMutation(request, "admin.principal.manage");
    return { allowed: true };
  });
  const csrf = admin.csrf(humanToken);
  const headers = {
    cookie: "pcp_admin_session=" + humanToken + "; pcp_admin_csrf=" + csrf,
    "x-csrf-token": csrf,
  };
  return { app, headers, repository };
}
async function issue(f: ReturnType<typeof fixture>) {
  const response = await f.app.inject({
    method: "POST",
    url: "/v1/admin/maintenance-grants",
    headers: f.headers,
    payload: { label: "Controller", permissions: ["compatibility.manage"] },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return response.json() as {
    credential: { token: string };
    grant: { id: string };
  };
}
describe("maintenance HTTP authority boundary", () => {
  it("requires an admin session and CSRF for initial issuance; a portal cookie is insufficient", async () => {
    const f = fixture();
    try {
      for (const headers of [
        {},
        { cookie: "pcp_portal_session=ordinary" },
        { cookie: f.headers.cookie },
      ]) {
        const response = await f.app.inject({
          method: "POST",
          url: "/v1/admin/maintenance-grants",
          headers,
          payload: {
            label: "Controller",
            permissions: ["compatibility.manage"],
          },
        });
        expect([401, 403]).toContain(response.statusCode);
      }
      expect(f.repository.issue).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it("accepts a scoped bearer without browser cookies and denies privilege expansion", async () => {
    const f = fixture();
    try {
      const issued = await issue(f);
      const headers = { authorization: "Bearer " + issued.credential.token };
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/test-maintenance-write",
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/test-principal-write",
            headers,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/v1/admin/maintenance-grants",
            headers,
            payload: {
              label: "Another",
              permissions: ["compatibility.manage"],
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            method: "DELETE",
            url: "/v1/admin/session",
            headers,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await f.app.close();
    }
  });
  it("rejects mixed cookie and bearer authority and invalid bearer credentials", async () => {
    const f = fixture();
    try {
      const issued = await issue(f);
      for (const headers of [
        { ...f.headers, authorization: "Bearer " + issued.credential.token },
        { authorization: "Bearer invalid" },
      ]) {
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/test-maintenance-write",
              headers,
            })
          ).statusCode,
        ).toBe(401);
      }
    } finally {
      await f.app.close();
    }
  });
  it("lists no credential material and revocation rejects subsequent requests", async () => {
    const f = fixture();
    try {
      const issued = await issue(f);
      const listed = await f.app.inject({
        method: "GET",
        url: "/v1/admin/maintenance-grants",
        headers: f.headers,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain(issued.credential.token);
      expect(listed.body).not.toMatch(
        /tokenHash|token_hash|sourceAdminSessionId/,
      );
      expect(
        (
          await f.app.inject({
            method: "DELETE",
            url: "/v1/admin/maintenance-grants/" + issued.grant.id,
            headers: f.headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/test-maintenance-write",
            headers: { authorization: "Bearer " + issued.credential.token },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await f.app.close();
    }
  });
});
