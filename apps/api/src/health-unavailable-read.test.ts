import { describe, expect, it, vi } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminAuthRepository,
  type AdminRole,
} from "@product/admin-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";
import { createUnavailableHealthReadDependencies } from "./health-unavailable-read.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://fixture:fixture@localhost/fixture",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const authToken = "synthetic-health-route-token";
const sha256 = "a".repeat(64);
const uuid = "11111111-1111-4111-8111-111111111111";

function fixture(role: AdminRole) {
  const repository: AdminAuthRepository = {
    createAdminSession: vi.fn(),
    authenticateAdminSession: vi.fn(async () => ({
      kind: "authenticated" as const,
      subject: {
        adminPrincipalId: uuid,
        userId: "22222222-2222-4222-8222-222222222222",
        adminSessionId: "33333333-3333-4333-8333-333333333333",
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
  const absent = createUnavailableHealthReadDependencies();
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    ...absent,
  });
  return {
    app,
    absent,
    auth,
    cookie: { cookie: `pcp_admin_session=${authToken}` },
  };
}

describe("Health monitor reader missing: authorization and failure separation", () => {
  it("preserves 401 before revealing an unavailable Health read route", async () => {
    const f = fixture("ADMIN_OWNER");
    try {
      const response = await f.app.inject({
        method: "GET",
        url: "/v1/admin/health/targets",
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("ADMIN_UNAUTHORIZED");
    } finally {
      await f.app.close();
    }
  });

  it("preserves 403 for an authenticated admin without health.read", async () => {
    const f = fixture("ADMIN_SUPPORT");
    try {
      const response = await f.app.inject({
        method: "GET",
        url: "/v1/admin/health/targets",
        headers: f.cookie,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("ADMIN_FORBIDDEN");
    } finally {
      await f.app.close();
    }
  });

  it("denies unauthenticated repair-case reads before the monitor status", async () => {
    const f = fixture("ADMIN_OWNER");
    try {
      const response = await f.app.inject({
        method: "GET",
        url: `/v1/admin/health/repair-cases?scopeSha256=${sha256}`,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("ADMIN_UNAUTHORIZED");
    } finally {
      await f.app.close();
    }
  });

  it.each([
    {
      denied: "health.read",
      visited: ["health.read"],
    },
    {
      denied: "ai.profile.read",
      visited: ["health.read", "ai.profile.read"],
    },
    {
      denied: "ai.assignment.read",
      visited: ["health.read", "ai.profile.read", "ai.assignment.read"],
    },
  ] as const)(
    "enforces repair-case permission $denied before the unavailable read",
    async ({ denied, visited }) => {
      const f = fixture("ADMIN_OWNER");
      const original = f.auth.authorize.bind(f.auth);
      const seen: string[] = [];
      const spy = vi
        .spyOn(f.auth, "authorize")
        .mockImplementation((subject, permission) => {
          seen.push(permission);
          if (permission === denied)
            return { ok: false, code: "ADMIN_FORBIDDEN" };
          return original(subject, permission);
        });
      try {
        const response = await f.app.inject({
          method: "GET",
          url: `/v1/admin/health/repair-cases?scopeSha256=${sha256}`,
          headers: f.cookie,
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("ADMIN_FORBIDDEN");
        expect(response.body).not.toContain("Health monitoring is unavailable");
        expect(seen).toEqual(visited);
      } finally {
        spy.mockRestore();
        await f.app.close();
      }
    },
  );

  it.each([
    "/v1/admin/health/targets?limit=1",
    `/v1/admin/health/targets/${sha256}`,
    "/v1/admin/health/incidents",
    `/v1/admin/health/incidents/${uuid}`,
    "/v1/admin/health/evaluations",
    `/v1/admin/health/evaluations/${uuid}`,
    "/v1/admin/health/recommendations",
    "/v1/admin/health/notifications",
    `/v1/admin/health/notifications/${uuid}`,
    "/v1/admin/health/diagnostics/summary?window=24h",
    "/v1/admin/health/diagnostics/breakdown?window=24h",
    `/v1/admin/health/repair-cases?scopeSha256=${sha256}&limit=1`,
    `/v1/admin/health/repair-cases/${uuid}/1?scopeSha256=${sha256}`,
  ])("reports a typed 503, never a fake result, for %s", async (url) => {
    const f = fixture("ADMIN_OWNER");
    try {
      const response = await f.app.inject({
        method: "GET",
        url,
        headers: f.cookie,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toMatch(
        /HEALTHY|postgres:|fixture:fixture|secret|sql/i,
      );
    } finally {
      await f.app.close();
    }
  });

  it("does not register an unauthenticated Health 503 catch-all or a write", async () => {
    const f = fixture("ADMIN_OWNER");
    try {
      for (const method of ["GET", "POST"] as const) {
        const response = await f.app.inject({
          method,
          url: "/v1/admin/health/unknown-health-capability",
          headers: f.cookie,
        });
        expect(response.statusCode).toBe(404);
      }
      for (const url of [
        "/v1/admin/health/targets",
        "/v1/admin/health/repair-cases",
      ]) {
        const mutation = await f.app.inject({
          method: "POST",
          url,
          headers: f.cookie,
        });
        expect(mutation.statusCode).toBe(404);
      }
    } finally {
      await f.app.close();
    }
  });

  it("does not misclassify missing real resources or successful empty reads", async () => {
    const f = fixture("ADMIN_OWNER");
    try {
      const valid = createApiApp({
        config,
        isInfrastructureReady: async () => true,
        adminAuthService: f.auth,
        ...f.absent,
        healthAdminService: {
          ...f.absent.healthAdminService,
          listTargets: async () => ({ items: [], nextCursor: null }),
          getTarget: async () => null,
          listIncidents: async () => ({ items: [], nextCursor: null }),
        },
      });
      try {
        const empty = await valid.inject({
          method: "GET",
          url: "/v1/admin/health/targets?limit=1",
          headers: f.cookie,
        });
        expect(empty.statusCode).toBe(200);
        expect(empty.json()).toEqual({ items: [], nextCursor: null });
        const missing = await valid.inject({
          method: "GET",
          url: `/v1/admin/health/targets/${sha256}`,
          headers: f.cookie,
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.json().error.code).toBe("ADMIN_RESOURCE_NOT_FOUND");
      } finally {
        await valid.close();
      }
    } finally {
      await f.app.close();
    }
  });

  it("keeps configured monitor-reader failures at sanitized typed 503", async () => {
    const f = fixture("ADMIN_OWNER");
    try {
      const failing = createApiApp({
        config,
        isInfrastructureReady: async () => true,
        adminAuthService: f.auth,
        ...f.absent,
        healthAdminService: {
          ...f.absent.healthAdminService,
          listTargets: async () => {
            throw new Error(
              "private synthetic URI: postgres://fixture:fixture@localhost/db",
            );
          },
        },
      });
      try {
        const response = await failing.inject({
          method: "GET",
          url: "/v1/admin/health/targets",
          headers: f.cookie,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe("SERVICE_UNAVAILABLE");
        expect(response.body).not.toContain("fixture:fixture");
      } finally {
        await failing.close();
      }
    } finally {
      await f.app.close();
    }
  });
});
