import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "@product/auth";
import type { DeviceManagementService } from "@product/device-management";
import type { ExtensionAuthService } from "@product/extension-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost:5432/test",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const deviceCode = "D".repeat(43),
  key = "I".repeat(16);
const deviceId = "550e8400-e29b-41d4-a716-446655440000";
const sessionId = "650e8400-e29b-41d4-a716-446655440000";
function fixture(
  exchange: unknown = {
    kind: "ACTIVATED",
    deviceId,
    sessionId,
    refreshToken: "R".repeat(43),
    accessToken: "jwt",
    accessTokenExpiresAt: new Date("2026-09-03T12:15:00.000Z"),
    refreshTokenExpiresAt: new Date("2026-10-03T12:00:00.000Z"),
    replay: false,
  },
) {
  const service = {
    exchange: vi.fn().mockResolvedValue(exchange),
    list: vi
      .fn()
      .mockResolvedValue({ kind: "ok", devices: [], nextCursor: undefined }),
    forgetCurrentClientMetadata: vi
      .fn()
      .mockResolvedValue({ kind: "CLEARED", deviceId }),
    revoke: vi.fn().mockResolvedValue({ kind: "REVOKED" }),
  };
  const auth = {
    authenticate: vi.fn().mockResolvedValue({
      userId: "750e8400-e29b-41d4-a716-446655440000",
      sessionId,
    }),
    csrfValid: vi.fn().mockReturnValue(true),
  };
  return {
    app: createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceManagementService: service as unknown as DeviceManagementService,
    }),
    service,
    auth,
  };
}
describe("P2.5 device management Fastify boundary", () => {
  it("exchanges only the explicit credential projection and maps closed states", async () => {
    const { app, service } = fixture();
    const response = await app.inject({
      method: "POST",
      url: "/v1/device-authorizations/token",
      headers: { "idempotency-key": key },
      payload: { deviceCode },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(Object.keys(response.json()).sort()).toEqual([
      "accessToken",
      "accessTokenExpiresAt",
      "deviceId",
      "refreshToken",
      "refreshTokenExpiresAt",
      "sessionId",
      "status",
      "tokenType",
    ]);
    expect(service.exchange).toHaveBeenCalledWith(
      deviceCode,
      key,
      "127.0.0.1",
      expect.any(String),
    );
    await app.close();
    for (const [result, status, code] of [
      [{ kind: "PENDING", retryAfterSeconds: 5 }, 409, "DEVICE_AUTH_PENDING"],
      [{ kind: "DEVICE_LIMIT_REACHED" }, 409, "DEVICE_LIMIT_REACHED"],
      [{ kind: "CLOSED" }, 409, "DEVICE_AUTH_CLOSED"],
      [{ kind: "INVALID" }, 401, "DEVICE_AUTH_INVALID"],
      [
        { kind: "RATE_LIMITED", retryAfterSeconds: 1 },
        429,
        "DEVICE_AUTH_RATE_LIMITED",
      ],
      [{ kind: "SERVICE_UNAVAILABLE" }, 503, "SERVICE_UNAVAILABLE"],
    ] as const) {
      const f = fixture(result);
      const r = await f.app.inject({
        method: "POST",
        url: "/v1/device-authorizations/token",
        headers: { "idempotency-key": key },
        payload: { deviceCode },
      });
      expect(r.statusCode).toBe(status);
      expect(r.json().error.code).toBe(code);
      await f.app.close();
    }
  });
  it("rejects invalid exchange input before calling the service", async () => {
    const { app, service } = fixture();
    for (const request of [
      { headers: {}, payload: { deviceCode } },
      { headers: { "idempotency-key": "short" }, payload: { deviceCode } },
      { headers: { "idempotency-key": key }, payload: { deviceCode: "bad" } },
      {
        headers: { "idempotency-key": key },
        payload: { deviceCode, extra: true },
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/device-authorizations/token",
        ...request,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.exchange).not.toHaveBeenCalled();
    await app.close();
  });
  it("projects PRESENT metadata compatibly and omits legacy fields for WITHHELD devices", async () => {
    const { app, service } = fixture();
    service.list.mockResolvedValueOnce({
      kind: "ok",
      devices: [
        {
          id: deviceId,
          status: "ACTIVE",
          label: "present",
          clientMetadata: {
            state: "PRESENT",
            browserFamily: "opera",
            browserVersion: "136.0",
            extensionVersion: "0.2.4",
          },
          createdAt: new Date("2026-09-25T00:00:00.000Z"),
          activatedAt: null,
          lastSeenAt: null,
          revokedAt: null,
        },
        {
          id: "750e8400-e29b-41d4-a716-446655440001",
          status: "ACTIVE",
          label: null,
          clientMetadata: { state: "WITHHELD" },
          createdAt: new Date("2026-09-25T00:00:01.000Z"),
          activatedAt: null,
          lastSeenAt: null,
          revokedAt: null,
        },
      ],
      nextCursor: undefined,
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/devices?accountId=${deviceId}`,
      headers: { cookie: "pcp_portal_session=session" },
    });
    expect(response.statusCode).toBe(200);
    const [present, withheld] = response.json().devices;
    expect(present).toMatchObject({
      clientMetadata: {
        state: "PRESENT",
        browserFamily: "opera",
        browserVersion: "136.0",
        extensionVersion: "0.2.4",
      },
      browserFamily: "opera",
      browserVersionLastSeen: "136.0",
      extensionVersionLastSeen: "0.2.4",
    });
    expect(withheld.clientMetadata).toEqual({ state: "WITHHELD" });
    expect(withheld).not.toHaveProperty("browserFamily");
    expect(withheld).not.toHaveProperty("browserVersionLastSeen");
    expect(withheld).not.toHaveProperty("extensionVersionLastSeen");
    await app.close();
  });

  it("clears only current authenticated device metadata with an empty body", async () => {
    const f = fixture();
    await f.app.close();
    const principal = {
      accountId: "850e8400-e29b-41d4-a716-446655440000",
      deviceId,
      sessionId,
    };
    const extensionAuth = {
      authenticateAccess: vi
        .fn()
        .mockResolvedValue({ ok: true, value: principal }),
    };
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: f.auth as unknown as AuthService,
      deviceManagementService: f.service as unknown as DeviceManagementService,
      extensionAuthService: extensionAuth as unknown as ExtensionAuthService,
    });
    const missing = await app.inject({
      method: "POST",
      url: "/v1/devices/current/client-metadata/forget",
    });
    expect(missing.statusCode).toBe(401);
    const body = await app.inject({
      method: "POST",
      url: "/v1/devices/current/client-metadata/forget",
      headers: { authorization: "Bearer access" },
      payload: {},
    });
    expect(body.statusCode).toBe(400);
    const success = await app.inject({
      method: "POST",
      url: "/v1/devices/current/client-metadata/forget",
      headers: { authorization: "Bearer access" },
    });
    expect(success.statusCode).toBe(200);
    expect(success.headers["cache-control"]).toBe("no-store");
    expect(success.headers.pragma).toBe("no-cache");
    expect(success.json()).toEqual({ status: "cleared", deviceId });
    expect(f.service.forgetCurrentClientMetadata).toHaveBeenCalledWith(
      principal,
      expect.any(String),
    );
    f.service.forgetCurrentClientMetadata.mockResolvedValueOnce({
      kind: "UNAUTHORIZED",
    });
    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/devices/current/client-metadata/forget",
      headers: { authorization: "Bearer access" },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe("DEVICE_MISMATCH");
    await app.close();
  });

  it("requires portal auth for list and CSRF for revoke", async () => {
    const { app, auth } = fixture();
    auth.authenticate.mockResolvedValueOnce(undefined);
    expect(
      (await app.inject(`/v1/devices?accountId=${deviceId}`)).statusCode,
    ).toBe(401);
    auth.authenticate.mockReset().mockResolvedValue({
      userId: "750e8400-e29b-41d4-a716-446655440000",
      sessionId,
    });
    auth.csrfValid.mockReturnValueOnce(false);
    const response = await app.inject({
      method: "POST",
      url: `/v1/devices/${deviceId}/revoke`,
      headers: { cookie: "pcp_portal_session=session" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AUTH_CSRF_INVALID");
    await app.close();
  });
});
