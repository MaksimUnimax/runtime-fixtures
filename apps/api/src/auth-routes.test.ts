import { describe, expect, it, vi } from "vitest";
import {
  AuthService,
  deriveAuthKeys,
  type AuthRepository,
} from "@product/auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost/test",
  logLevel: "info",
  apiPort: 3000,
  workerReadyDelayMs: 0,
};
function appFor(
  repository: AuthRepository,
  environment: AppConfig["environment"] = "test",
) {
  return createApiApp({
    config: { ...config, environment },
    isInfrastructureReady: async () => true,
    authService: new AuthService(
      repository,
      deriveAuthKeys(Buffer.alloc(32, 9)),
      () => new Date("2030-01-01T00:00:00Z"),
      () => "012345",
    ),
  });
}
function repository(): AuthRepository {
  return {
    listOwnedAccounts: vi.fn(async () => []),
    requestOtp: vi.fn(async (input) => ({
      ok: true as const,
      value: { challengeId: input.challengeId, expiresAt: input.expiresAt },
    })),
    verifyOtp: vi.fn(async (input) => ({
      ok: true as const,
      value: { sessionToken: "", expiresAt: input.expiresAt },
    })),
    authenticate: vi.fn(async () => ({ sessionId: "session", userId: "user" })),
    revoke: vi.fn(async () => "revoked" as const),
  };
}
describe("P2.2 auth HTTP contracts", () => {
  it("API-REQ accepts only valid request bodies, is no-store, and never calls provider", async () => {
    const repo = repository(),
      app = appFor(repo);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: " User+tag@Example.test " },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers["cache-control"]).toContain("no-store");
    expect(accepted.json()).toMatchObject({
      status: "accepted",
      challengeId: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(Object.keys(accepted.json())).toEqual([
      "status",
      "challengeId",
      "expiresAt",
    ]);
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { email: "bad" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_REQUEST");
    await app.close();
  });
  it("API-VERIFY sets safe cookies but never returns secrets", async () => {
    const app = appFor(repository(), "production");
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        challengeId: "00000000-0000-4000-8000-000000000001",
        code: "012345",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "authenticated",
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(response.json())).not.toMatch(/csrf|token/i);
    const cookies = response.headers["set-cookie"] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/Path=\/; HttpOnly; Secure; SameSite=Strict/);
    expect(cookies[1]).toMatch(/Path=\/; Secure; SameSite=Strict/);
    expect(cookies[1]).not.toMatch(/HttpOnly/);
    expect(cookies.join("\n")).not.toMatch(/Domain=/);
    await app.close();
  });
  it("B04 keeps validation failures non-cacheable with the public error envelope", async () => {
    const app = appFor(repository());
    try {
      const invalidRequest = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        payload: { email: "invalid" },
      });
      expect(invalidRequest.statusCode).toBe(400);
      expect(invalidRequest.headers["cache-control"]).toContain("no-store");
      const invalidVerify = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        headers: { "idempotency-key": "invalid key with spaces" },
        payload: {
          challengeId: "00000000-0000-4000-8000-000000000001",
          code: "012345",
        },
      });
      expect(invalidVerify.statusCode).toBe(400);
      expect(invalidVerify.json().error.code).toBe("INVALID_REQUEST");
      expect(invalidVerify.headers["cache-control"]).toContain("no-store");
      expect(invalidVerify.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
  it("B04 keeps a rejected OTP response non-cacheable without cookies", async () => {
    const repo = repository();
    vi.mocked(repo.verifyOtp).mockResolvedValue({
      ok: false,
      code: "AUTH_OTP_INVALID",
    });
    const app = appFor(repo);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: {
          challengeId: "00000000-0000-4000-8000-000000000001",
          code: "012345",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("AUTH_OTP_INVALID");
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
  it("B04 bounds both cookie lifetimes by remaining session time and seven days", async () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      for (const [remainingMs, expectedSeconds] of [
        [90_500, 90],
        [8 * 24 * 60 * 60 * 1_000, 7 * 24 * 60 * 60],
      ] as const) {
        const repo = repository();
        const expiresAt = new Date(now + remainingMs);
        vi.mocked(repo.verifyOtp).mockResolvedValue({
          ok: true,
          value: {
            sessionToken: "synthetic-unused-repository-token",
            expiresAt,
          },
        });
        const app = appFor(repo);
        try {
          const response = await app.inject({
            method: "POST",
            url: "/v1/auth/otp/verify",
            payload: {
              challengeId: "00000000-0000-4000-8000-000000000001",
              code: "012345",
            },
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().expiresAt).toBe(expiresAt.toISOString());
          const cookies = response.headers["set-cookie"] as string[];
          expect(cookies).toHaveLength(2);
          for (const cookie of cookies) {
            expect(cookie).toMatch(
              new RegExp(`Max-Age=${expectedSeconds}(?:;|$)`),
            );
          }
          expect(response.headers["cache-control"]).toContain("no-store");
        } finally {
          await app.close();
        }
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("B04 rejects non-positive or invalid remaining lifetime before setting cookies", async () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      for (const expiry of [now, now - 1_000, Number.NaN]) {
        const repo = repository();
        vi.mocked(repo.verifyOtp).mockResolvedValue({
          ok: true,
          value: {
            sessionToken: "synthetic-unused-repository-token",
            expiresAt: new Date(expiry),
          },
        });
        const app = appFor(repo);
        try {
          const response = await app.inject({
            method: "POST",
            url: "/v1/auth/otp/verify",
            payload: {
              challengeId: "00000000-0000-4000-8000-000000000001",
              code: "012345",
            },
          });
          expect(response.statusCode).toBe(401);
          expect(response.json().error.code).toBe("AUTH_OTP_INVALID");
          expect(response.headers["set-cookie"]).toBeUndefined();
          expect(response.headers["cache-control"]).toContain("no-store");
        } finally {
          await app.close();
        }
      }
    } finally {
      clock.mockRestore();
    }
  });
  it("API-LOGOUT enforces CSRF without revoking on failure and is idempotent", async () => {
    const repo = repository(),
      app = appFor(repo);
    const missing = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
    });
    expect(missing.statusCode).toBe(204);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie: "pcp_portal_session=token" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("AUTH_CSRF_INVALID");
    expect(repo.revoke).not.toHaveBeenCalled();
    const csrf = new AuthService(
      repo,
      deriveAuthKeys(Buffer.alloc(32, 9)),
    ).csrf("token");
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        cookie: `pcp_portal_session=token; pcp_csrf=${csrf}`,
        "x-csrf-token": csrf,
      },
    });
    expect(accepted.statusCode).toBe(204);
    expect(repo.revoke).toHaveBeenCalledOnce();
    await app.close();
  });
});
