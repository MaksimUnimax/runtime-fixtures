import { describe, expect, it, vi } from "vitest";
import {
  AuthService,
  deriveAuthKeys,
  csrfToken,
  portalLookup,
  type AuthRepository,
} from "@product/auth";
import type { AdminAuthService, AdminSubject } from "@product/admin-auth";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackCase,
  type FeedbackRepository,
  type FeedbackRole,
} from "@product/feedback-support";
import { createApiApp } from "./app.js";

const userId = "00000000-0000-4000-8000-000000000001";
const caseId = "00000000-0000-4000-8000-000000000002";
const principalId = "00000000-0000-4000-8000-000000000003";
const keys = deriveAuthKeys(Buffer.alloc(32, 1));
const csrf = csrfToken(keys, "synthetic-session");
const item: FeedbackCase = {
  caseId,
  accountId: "00000000-0000-4000-8000-000000000004",
  deviceId: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  category: "OTHER",
  severity: "LOW",
  status: "NEW",
  description: "Synthetic case",
  diagnostics: null,
  serverVersion: null,
  portalVersion: null,
  extensionVersion: null,
  browserFamily: null,
  browserVersion: null,
  marketplace: "NONE",
  supportCode: null,
  releaseIdentity: null,
  assignedAdminPrincipalId: null,
  resolutionCode: null,
  followups: [],
};
function redactedLength(length: number): string {
  const synthetic = "token=x";
  return (
    "a".repeat(length - sanitizeFeedbackText(synthetic).length - 1) +
    " " +
    synthetic
  );
}
function fixture(
  actor: FeedbackRole,
  permissions: AdminSubject["permissions"] = ["support.case.manage"],
) {
  const getOwnCase = vi.fn<FeedbackRepository["getOwnCase"]>(async () => item);
  const addFollowup = vi.fn<FeedbackRepository["addFollowup"]>(
    async (input) => {
      // Model only the existing varchar(4000) constraint; no database is contacted.
      if ([...input.body].length > 4000)
        throw new Error("SYNTHETIC_PERSISTENCE_LENGTH_REJECTED");
      return {
        followupId: "00000000-0000-4000-8000-000000000005",
        authorType: input.actorType,
        body: input.body,
        createdAt: "2030-01-01T00:00:00.000Z",
      };
    },
  );
  const repository = {
    getOwnCase,
    addFollowup,
  } as unknown as FeedbackRepository;
  const authRepository: AuthRepository = {
    listOwnedAccounts: async () => [],
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(),
    revoke: vi.fn(),
    authenticate: async (token) =>
      token === portalLookup(keys, "synthetic-session")
        ? { sessionId: "00000000-0000-4000-8000-000000000006", userId }
        : undefined,
  };
  const auth = new AuthService(authRepository, keys);
  const subject: AdminSubject = {
    adminPrincipalId: principalId,
    userId,
    adminSessionId: "00000000-0000-4000-8000-000000000007",
    roles: actor === "ADMIN" ? ["ADMIN_OWNER"] : ["ADMIN_SUPPORT"],
    permissions,
    expiresAt: new Date("2030-01-01T01:00:00.000Z"),
  };
  const adminAuth = {
    authenticateAdminSession: async () => ({
      ok: true as const,
      value: subject,
    }),
    authorize: (candidate: AdminSubject, permission: string) =>
      candidate.permissions.includes(permission as never)
        ? { ok: true as const, value: true as const }
        : { ok: false as const, code: "ADMIN_FORBIDDEN" as const },
    csrfValid: (_session: string, header?: string, cookie?: string) =>
      header === csrf && cookie === csrf,
  } as unknown as AdminAuthService;
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://unused",
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    authService: auth,
    adminAuthService: adminAuth,
    feedbackSupportService: new FeedbackSupportService(repository),
  });
  const url =
    actor === "USER"
      ? `/v1/support/cases/${caseId}/followups`
      : `/v1/admin/support/cases/${caseId}/followups`;
  const headers = {
    cookie: `${actor === "USER" ? "pcp_portal_session" : "pcp_admin_session"}=synthetic-session; ${actor === "USER" ? "pcp_csrf" : "pcp_admin_csrf"}=${csrf}`,
    "x-csrf-token": csrf,
  };
  return { app, url, headers, getOwnCase, addFollowup };
}

describe.each(["USER", "SUPPORT", "ADMIN"] as const)(
  "real HTTP followup length boundary for %s",
  (actor) => {
    it.each([
      ["redaction", redactedLength(4001)],
      ["NFC normalization", "\u0344".repeat(2001)],
    ])(
      "returns a controlled400 for %s expansion without repository calls",
      async (_label, description) => {
        expect(description.length).toBeLessThanOrEqual(4000);
        const { app, url, headers, getOwnCase, addFollowup } = fixture(actor);
        try {
          const response = await app.inject({
            method: "POST",
            url,
            headers,
            payload: { description },
          });
          expect(response.statusCode).toBe(400);
          expect(response.json().error.code).toBe("INVALID_REQUEST");
          expect(response.body).not.toContain(
            "SYNTHETIC_PERSISTENCE_LENGTH_REJECTED",
          );
          expect(getOwnCase).not.toHaveBeenCalled();
          expect(addFollowup).not.toHaveBeenCalled();
        } finally {
          await app.close();
        }
      },
    );
    it.each(["a".repeat(4000), redactedLength(4000)])(
      "persists exactly4000 sanitized characters without truncation",
      async (description) => {
        const { app, url, headers, addFollowup } = fixture(actor);
        try {
          const response = await app.inject({
            method: "POST",
            url,
            headers,
            payload: { description },
          });
          expect(response.statusCode).toBe(201);
          expect(response.headers["cache-control"]).toBe("no-store");
          expect(response.json().followup.body).toBe(
            sanitizeFeedbackText(description),
          );
          expect(response.json().followup.body).toHaveLength(4000);
          expect(response.json().followup.authorType).toBe(actor);
          expect(addFollowup).toHaveBeenCalledTimes(1);
        } finally {
          await app.close();
        }
      },
    );
    it("retains missing-session401", async () => {
      const { app, url, addFollowup } = fixture(actor);
      try {
        const response = await app.inject({
          method: "POST",
          url,
          payload: { description: "ordinary text" },
        });
        expect(response.statusCode).toBe(401);
        expect(addFollowup).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
    it("retains CSRF403 before repository access", async () => {
      const { app, url, headers, addFollowup } = fixture(actor);
      try {
        const response = await app.inject({
          method: "POST",
          url,
          headers: { cookie: headers.cookie },
          payload: { description: "ordinary text" },
        });
        expect(response.statusCode).toBe(403);
        expect(addFollowup).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
    it("retains rate-limit429", async () => {
      const { app, url, headers, addFollowup } = fixture(actor);
      addFollowup.mockResolvedValue({ kind: "RATE_LIMITED" });
      try {
        const response = await app.inject({
          method: "POST",
          url,
          headers,
          payload: { description: "ordinary text" },
        });
        expect(response.statusCode).toBe(429);
        expect(response.json().error.code).toBe("SUPPORT_CASE_RATE_LIMITED");
      } finally {
        await app.close();
      }
    });
  },
);

it("keeps user ownership403", async () => {
  const { app, url, headers, getOwnCase, addFollowup } = fixture("USER");
  getOwnCase.mockResolvedValue({ kind: "FORBIDDEN" });
  try {
    const response = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { description: "ordinary text" },
    });
    expect(response.statusCode).toBe(403);
    expect(addFollowup).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it("keeps admin permission403", async () => {
  const { app, url, headers, addFollowup } = fixture("SUPPORT", []);
  try {
    const response = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { description: "ordinary text" },
    });
    expect(response.statusCode).toBe(403);
    expect(addFollowup).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
