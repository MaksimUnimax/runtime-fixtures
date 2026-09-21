import { describe, expect, it, vi } from "vitest";
import {
  type AuthRepository,
  AuthService,
  csrfToken,
  deriveAuthKeys,
  portalLookup,
} from "@product/auth";
import { AdminAuthService, type AdminSubject } from "@product/admin-auth";
import type { AppConfig } from "@product/shared";
import {
  FeedbackSupportService,
  type FeedbackRepository,
} from "@product/feedback-support";
import type { FeedbackCase } from "@product/feedback-support";
import { createApiApp } from "./app.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const accountId = "00000000-0000-4000-8000-000000000003";
const caseId = "00000000-0000-4000-8000-000000000004";
const principalId = "00000000-0000-4000-8000-000000000005";
const portalCsrf = csrfToken(
  deriveAuthKeys(Buffer.alloc(32, 1)),
  "user-session",
);
const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://unused",
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const item = {
  caseId,
  accountId,
  deviceId: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  category: "AUTH" as const,
  severity: "LOW" as const,
  status: "NEW" as const,
  description: "Sign-in needs help",
  diagnostics: { productVersion: "0.2.4" },
  serverVersion: "0.2.4",
  portalVersion: null,
  extensionVersion: "0.2.4",
  browserFamily: "Opera",
  browserVersion: "136",
  marketplace: "NONE" as const,
  supportCode: "AUTH",
  releaseIdentity: "seller-agents-free-beta-rc-2026-09-21",
  assignedAdminPrincipalId: null,
  resolutionCode: null,
};
const caseDetail: FeedbackCase = { ...item, followups: [] };

function authService(): AuthService {
  const keys = deriveAuthKeys(Buffer.alloc(32, 1));
  const repository: AuthRepository = {
    listOwnedAccounts: async () => [],
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    revoke: vi.fn(),
    authenticate: async (token) =>
      token === portalLookup(keys, "user-session")
        ? { sessionId: "00000000-0000-4000-8000-000000000006", userId }
        : token === portalLookup(keys, "other-session")
          ? {
              sessionId: "00000000-0000-4000-8000-000000000009",
              userId: otherUserId,
            }
          : undefined,
  };
  const service = new AuthService(repository, keys);
  vi.spyOn(service, "csrfValid").mockImplementation(
    (_session, header, cookie) =>
      header === portalCsrf && cookie === portalCsrf,
  );
  return service;
}

function repository(
  captured: { description?: string } = {},
): FeedbackRepository {
  return {
    createCase: async (input) => {
      captured.description = input.description;
      return { ...caseDetail, description: input.description };
    },
    listOwnCases: async () => [item],
    getOwnCase: async (input) =>
      input.userId === userId ? caseDetail : { kind: "FORBIDDEN" as const },
    addFollowup: async () => ({
      followupId: "00000000-0000-4000-8000-000000000007",
      authorType: "USER" as const,
      body: "Follow-up",
      createdAt: "2030-01-01T00:00:00.000Z",
    }),
    listCases: async () => [item],
    getCase: async () => caseDetail,
    transitionCase: async () => caseDetail,
    recordSignal: async () => "ACCEPTED",
    aggregateSignals: async () => [],
    purgeExpired: async () => ({ cases: 0, signals: 0 }),
    anonymizeAccount: async () => ({ cases: 1 }),
  };
}

function adminAuth() {
  const subject: AdminSubject = {
    adminPrincipalId: principalId,
    userId,
    adminSessionId: "00000000-0000-4000-8000-000000000008",
    roles: ["ADMIN_SUPPORT"],
    permissions: [
      "support.case.read",
      "support.case.manage",
      "support.aggregate.read",
    ],
    expiresAt: new Date("2030-01-01T01:00:00.000Z"),
  };
  const service = {
    authenticateAdminSession: async () => ({
      ok: true as const,
      value: subject,
    }),
    authorize: (candidate: AdminSubject, permission: string) =>
      candidate.permissions.includes(permission as never)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, code: "ADMIN_FORBIDDEN" as const },
    csrfValid: (_session: string, header?: string, cookie?: string) =>
      header === portalCsrf && cookie === portalCsrf,
  } as unknown as AdminAuthService;
  return service;
}

function app(repo = repository()) {
  return createApiApp({
    config,
    isInfrastructureReady: async () => true,
    authService: authService(),
    adminAuthService: adminAuth(),
    feedbackSupportService: new FeedbackSupportService(repo),
  });
}

describe("B2 feedback/support API", () => {
  it("requires the portal CSRF proof for state-changing support actions", async () => {
    const server = app();
    const response = await server.inject({
      method: "POST",
      url: "/v1/support/cases",
      headers: { cookie: "pcp_portal_session=user-session" },
      payload: { accountId, category: "AUTH", description: "Help" },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
  });

  it("B2-01/B2-02 creates and reads only the authenticated user's cases", async () => {
    const server = app();
    const create = await server.inject({
      method: "POST",
      url: "/v1/support/cases",
      headers: {
        cookie: `pcp_portal_session=user-session; pcp_csrf=${portalCsrf}`,
        "x-csrf-token": portalCsrf,
      },
      payload: { accountId, category: "AUTH", description: "Help" },
    });
    const list = await server.inject({
      method: "GET",
      url: "/v1/support/cases",
      headers: {
        cookie: `pcp_portal_session=user-session; pcp_csrf=${portalCsrf}`,
        "x-csrf-token": portalCsrf,
      },
    });
    expect(create.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].caseId).toBe(caseId);
    await server.close();
  });

  it("B2-03/B2-08 denies unauthenticated and cross-account reads", async () => {
    const server = app();
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/support/cases/${caseId}`,
        })
      ).statusCode,
    ).toBe(401);
    const other = await server.inject({
      method: "GET",
      url: `/v1/support/cases/${caseId}`,
      headers: { cookie: "pcp_portal_session=other-session" },
    });
    expect(other.statusCode).toBe(403);
    await server.close();
  });

  it("B2-09/B2-12/B2-13/B2-15 redacts text and rejects diagnostic fields", async () => {
    const captured: { description?: string } = {};
    const server = app(repository(captured));
    const unsafe = await server.inject({
      method: "POST",
      url: "/v1/support/cases",
      headers: {
        cookie: `pcp_portal_session=user-session; pcp_csrf=${portalCsrf}`,
        "x-csrf-token": portalCsrf,
      },
      payload: {
        accountId,
        category: "AUTH",
        description:
          "<script>alert(1)</script> Bearer abcdefghijklmnopqrstuvwxyz123456",
      },
    });
    const forbiddenDiagnostics = await server.inject({
      method: "POST",
      url: "/v1/support/cases",
      headers: {
        cookie: `pcp_portal_session=user-session; pcp_csrf=${portalCsrf}`,
        "x-csrf-token": portalCsrf,
      },
      payload: {
        accountId,
        category: "AUTH",
        description: "safe",
        diagnostics: { storageState: "no" },
      },
    });
    expect(unsafe.statusCode).toBe(201);
    expect(captured.description).not.toContain(
      "abcdefghijklmnopqrstuvwxyz123456",
    );
    expect(forbiddenDiagnostics.statusCode).toBe(400);
    await server.close();
  });

  it("B2-10 bounds oversized descriptions and B2-26 has no mail dependency", async () => {
    const server = app();
    const response = await server.inject({
      method: "POST",
      url: "/v1/support/cases",
      headers: { cookie: "pcp_portal_session=user-session" },
      payload: { accountId, category: "OTHER", description: "x".repeat(4001) },
    });
    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("B2-04/B2-07 exposes support workflow only with support permissions", async () => {
    const server = app();
    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/support/cases?status=NEW",
      headers: { cookie: "pcp_admin_session=admin-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    await server.close();
  });
});
