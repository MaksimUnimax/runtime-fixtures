import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "@product/auth";
import type { ConnectionCodeService } from "@product/device-management";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";
const accountId = "10000000-0000-4000-8000-000000000001",
  deviceId = "10000000-0000-4000-8000-000000000002",
  sessionId = "10000000-0000-4000-8000-000000000003",
  userId = "10000000-0000-4000-8000-000000000004";
const now = new Date(),
  code = "octo1_" + Buffer.alloc(32, 19).toString("base64url");
const credential = {
  credentialId: "10000000-0000-4000-8000-000000000005",
  generation: 1,
  createdAt: now,
  active: true,
};
const headers = {
  cookie: "pcp_portal_session=synthetic-session; pcp_csrf=synthetic-csrf",
  "x-csrf-token": "synthetic-csrf",
  "idempotency-key": "synthetic-operation-123456",
};
const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://fixture@localhost:5432/test",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 0,
  workerReadyDelayMs: 0,
};
function fixture() {
  const auth = {
    authenticate: vi
      .fn()
      .mockResolvedValue({ sessionId, userId, createdAt: now }),
    csrfValid: vi.fn().mockReturnValue(true),
  };
  const service = {
    status: vi.fn().mockResolvedValue({ kind: "ok", credential }),
    issue: vi.fn().mockResolvedValue({
      kind: "CREATED",
      code,
      credential,
      revokedDevices: 0,
    }),
    exchange: vi.fn().mockResolvedValue({
      kind: "ACTIVATED",
      accountId,
      deviceId,
      sessionId,
      accessToken: "synthetic-jwt",
      refreshToken: "R".repeat(43),
      accessTokenExpiresAt: now,
      refreshTokenExpiresAt: now,
      replay: false,
    }),
    listTransferDevices: vi.fn().mockResolvedValue({
      kind: "ok",
      devices: [
        {
          deviceId,
          label: "Second browser",
          createdAt: now,
          approvedAt: null,
        },
      ],
    }),
    approveTransfer: vi
      .fn()
      .mockResolvedValue({ kind: "APPROVED", deviceId, approvedAt: now }),
  };
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    authService: auth as unknown as AuthService,
    connectionCodeService: service as unknown as ConnectionCodeService,
  });
  return { app, auth, service };
}
describe("connection code Fastify boundaries", () => {
  it("enrolls directly without portal cookies and returns explicit method/account, no private receipt", async () => {
    const f = fixture();
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes/exchange",
      headers: { "idempotency-key": headers["idempotency-key"] },
      payload: { code },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(r.json()).toMatchObject({
      authenticationMethod: "ACCOUNT_CONNECTION_CODE",
      accountId,
      deviceId,
      sessionId,
    });
    expect(r.json()).not.toHaveProperty("replay");
    expect(r.body).not.toContain(code);
    expect(f.auth.authenticate).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("refuses caller-selected account/user/session and missing idempotency before exchange", async () => {
    const f = fixture();
    for (const payload of [
      { code, accountId },
      { code, userId },
      { code, sessionId },
      { code, deviceLabel: "bad\nlabel" },
    ]) {
      const r = await f.app.inject({
        method: "POST",
        url: "/v1/connection-codes/exchange",
        headers,
        payload,
      });
      expect(r.statusCode).toBe(400);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body).not.toContain(code);
    }
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes/exchange",
      payload: { code },
    });
    expect(r.statusCode).toBe(400);
    expect(f.service.exchange).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("issues only under authenticated portal + CSRF, passing server session freshness", async () => {
    const f = fixture(),
      payload = { accountId, expectedGeneration: 0, mode: "CREATE" };
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes",
      headers,
      payload,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "created", code });
    expect(f.service.issue).toHaveBeenCalledWith(
      { ...payload, idempotencyKey: headers["idempotency-key"] },
      { userId, sessionId, authenticatedAt: now },
      expect.any(String),
    );
    f.auth.csrfValid.mockReturnValue(false);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/connection-codes",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    f.auth.authenticate.mockResolvedValue(undefined);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/connection-codes",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(f.service.issue).toHaveBeenCalledTimes(1);
    await f.app.close();
  });
  it("unknown issue retry reveals no code; response has no-store", async () => {
    const f = fixture();
    f.service.issue.mockResolvedValue({ kind: "ALREADY_ISSUED", credential });
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes",
      headers,
      payload: { accountId, expectedGeneration: 0, mode: "CREATE" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      status: "already_issued",
      credential: { ...credential, createdAt: now.toISOString() },
    });
    expect(r.headers["cache-control"]).toBe("no-store");
    await f.app.close();
  });
  it("preserves stale, conflict, rate and unknown outcomes without success or automatic retry", async () => {
    for (const [kind, status, machine] of [
      ["CLOSED", 401, "CONNECTION_CODE_CLOSED"],
      ["CONFLICT", 409, "CONNECTION_CODE_CONFLICT"],
      ["RATE_LIMITED", 429, "CONNECTION_CODE_RATE_LIMITED"],
      ["DEVICE_LIMIT_REACHED", 409, "DEVICE_LIMIT_REACHED"],
      ["SUBSCRIPTION_REQUIRED", 403, "SUBSCRIPTION_REQUIRED"],
      ["SERVICE_UNAVAILABLE", 503, "SERVICE_UNAVAILABLE"],
    ] as const) {
      const f = fixture();
      f.service.exchange.mockResolvedValue({ kind, retryAfterSeconds: 17 });
      const r = await f.app.inject({
        method: "POST",
        url: "/v1/connection-codes/exchange",
        headers,
        payload: { code },
      });
      expect(r.statusCode).toBe(status);
      expect(r.json().error.code).toBe(machine);
      expect(r.headers["cache-control"]).toBe("no-store");
      if (kind === "RATE_LIMITED") expect(r.headers["retry-after"]).toBe("17");
      expect(f.service.exchange).toHaveBeenCalledTimes(1);
      await f.app.close();
    }
    const f = fixture();
    f.service.exchange.mockRejectedValue(new Error("synthetic-private-detail"));
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes/exchange",
      headers,
      payload: { code },
    });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain("synthetic-private-detail");
    expect(f.service.exchange).toHaveBeenCalledTimes(1);
    await f.app.close();
  });
  it("requires explicit fresh owner confirmation for key transfer and preserves unavailable device", async () => {
    const f = fixture(),
      payload = { accountId, deviceId };
    const r = await f.app.inject({
      method: "POST",
      url: "/v1/connection-codes/devices/approve-transfer",
      headers,
      payload,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("approved");
    f.service.approveTransfer.mockResolvedValue({ kind: "REAUTH_REQUIRED" });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/connection-codes/devices/approve-transfer",
          headers,
          payload,
        })
      ).json().error.code,
    ).toBe("CONNECTION_REAUTH_REQUIRED");
    f.service.approveTransfer.mockResolvedValue({ kind: "NOT_FOUND" });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/connection-codes/devices/approve-transfer",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(404);
    await f.app.close();
  });
  it("lists only owner-visible status/approval projection; never a saved code", async () => {
    const f = fixture();
    for (const url of [
      "/v1/connection-codes",
      "/v1/connection-codes/devices",
    ]) {
      const r = await f.app.inject({
        method: "GET",
        url: url + "?accountId=" + accountId,
        headers,
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain(code);
      expect(r.headers["cache-control"]).toBe("no-store");
    }
    await f.app.close();
  });
});
