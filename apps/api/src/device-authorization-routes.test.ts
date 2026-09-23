import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "@product/auth";
import type { DeviceAuthorizationService } from "@product/device-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://test:test@localhost:5432/test",
  logLevel: "info",
  apiPort: 3000,
  workerReadyDelayMs: 0,
};
const id = "550e8400-e29b-41d4-a716-446655440000";
const expiresAt = new Date("2026-09-03T00:10:00.000Z");
const body = {
  clientType: "browser_extension",
  browserFamily: "chrome",
  extensionVersion: "1.0",
};

function dependencies(
  result: unknown = {
    ok: true,
    value: {
      status: "pending",
      authorizationId: id,
      deviceCode: "A".repeat(43),
      userCode: "ABCD-EFGH",
      expiresAt,
    },
  },
) {
  const service = {
    start: vi.fn().mockResolvedValue(result),
    approve: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { record: { id, expiresAt } } }),
    deny: vi.fn().mockResolvedValue({ ok: true, value: { record: { id } } }),
  };
  const auth = {
    authenticate: vi
      .fn()
      .mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000002" }),
    csrfValid: vi.fn().mockReturnValue(true),
  };
  return { service, auth };
}

describe("device authorization Fastify boundary", () => {
  it("API-START-01..08 returns the exact secret response only for a valid header/body", async () => {
    const { service, auth } = dependencies();
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    const success = await app.inject({
      method: "POST",
      url: "/v1/device-authorizations",
      headers: { "idempotency-key": "A".repeat(16) },
      payload: body,
    });
    expect(success.statusCode).toBe(201);
    expect(success.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(success.json()).sort()).toEqual([
      "authorizationId",
      "deviceCode",
      "expiresAt",
      "status",
      "userCode",
    ]);
    expect(success.json().status).toBe("pending");
    expect(success.json().deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(success.json().userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const headers of [{}, { "idempotency-key": "short" }]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/device-authorizations",
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
    }
    await app.close();
  });

  it("accepts every modeled product browser family at the public authorization boundary", async () => {
    const { service, auth } = dependencies();
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    for (const [index, browserFamily] of [
      "chrome",
      "opera",
      "yandex_chromium",
      "firefox",
      "safari",
    ].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/device-authorizations",
        headers: { "idempotency-key": String(index + 1).repeat(16) },
        payload: { ...body, browserFamily },
      });
      expect(response.statusCode).toBe(201);
    }
    expect(service.start).toHaveBeenCalledTimes(5);
    await app.close();
  });

  it("API-START-14..16 maps safe service failures without leaking request secrets", async () => {
    for (const [code, status] of [
      ["SERVICE_UNAVAILABLE", 503],
      ["DEVICE_AUTH_IDEMPOTENCY_CONFLICT", 409],
      ["DEVICE_AUTH_CLOSED", 409],
      ["DEVICE_AUTH_RATE_LIMITED", 429],
    ] as const) {
      const { service, auth } = dependencies({ ok: false, code });
      const app = createApiApp({
        config,
        isInfrastructureReady: async () => true,
        authService: auth as unknown as AuthService,
        deviceAuthorizationService:
          service as unknown as DeviceAuthorizationService,
      });
      const response = await app.inject({
        method: "POST",
        url: "/v1/device-authorizations",
        headers: { "idempotency-key": "A".repeat(16) },
        payload: body,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error).toMatchObject({
        code,
        correlationId: expect.any(String),
      });
      expect(JSON.stringify(response.json())).not.toContain("A".repeat(16));
      await app.close();
    }
  });

  it("API-START-09..13 rejects invalid and unapproved public input", async () => {
    const { service, auth } = dependencies();
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    for (const payload of [
      { ...body, clientType: "mobile" },
      { ...body, browserFamily: "edge" },
      { clientType: "browser_extension", browserFamily: "chrome" },
      { ...body, extensionVersion: "x".repeat(65) },
      { ...body, deviceLabel: "<script>" },
      { ...body, unexpected: "ambiguous" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/device-authorizations",
        headers: { "idempotency-key": "A".repeat(16) },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
    }
    expect(service.start).not.toHaveBeenCalled();
    await app.close();
  });

  it("API-START-17 preserves the socket peer identity rather than X-Forwarded-For", async () => {
    const { service, auth } = dependencies();
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    for (const forwarded of ["198.51.100.1", "203.0.113.99"]) {
      await app.inject({
        method: "POST",
        url: "/v1/device-authorizations",
        headers: {
          "idempotency-key": "A".repeat(15) + forwarded.length,
          "x-forwarded-for": forwarded,
        },
        payload: body,
      });
    }
    expect(service.start.mock.calls[0]?.[2]).toBe(
      service.start.mock.calls[1]?.[2],
    );
    await app.close();
  });

  it("API portal foundation enforces session then CSRF and emits no approval/deny secret", async () => {
    const { service, auth } = dependencies();
    auth.authenticate.mockResolvedValueOnce(undefined);
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    const missing = await app.inject({
      method: "POST",
      url: `/v1/device-authorizations/${id}/approve`,
      payload: { accountId: id, userCode: "ABCD-EFGH" },
    });
    expect(missing.statusCode).toBe(401);
    await app.close();
    const second = dependencies();
    const csrfApp = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: second.auth as unknown as AuthService,
      deviceAuthorizationService:
        second.service as unknown as DeviceAuthorizationService,
    });
    second.auth.csrfValid.mockReturnValueOnce(false);
    const csrf = await csrfApp.inject({
      method: "POST",
      url: `/v1/device-authorizations/${id}/approve`,
      headers: { cookie: "pcp_portal_session=s" },
      payload: { accountId: id, userCode: "ABCD-EFGH" },
    });
    expect(csrf.statusCode).toBe(403);
    const approve = await csrfApp.inject({
      method: "POST",
      url: `/v1/device-authorizations/${id}/approve`,
      headers: {
        cookie: "pcp_portal_session=s; pcp_csrf=c",
        "x-csrf-token": "c",
      },
      payload: { accountId: id, userCode: "ABCD-EFGH" },
    });
    expect(approve.statusCode).toBe(200);
    expect(Object.keys(approve.json()).sort()).toEqual([
      "authorizationId",
      "expiresAt",
      "status",
    ]);
    await csrfApp.close();
  });

  it("API-PORTAL-01..18 applies session/CSRF to both actions and maps safe contracts", async () => {
    const { service, auth } = dependencies();
    const app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      authService: auth as unknown as AuthService,
      deviceAuthorizationService:
        service as unknown as DeviceAuthorizationService,
    });
    const secureHeaders = {
      cookie: "pcp_portal_session=session; pcp_csrf=csrf",
      "x-csrf-token": "csrf",
    };
    auth.csrfValid.mockReturnValue(false);
    for (const action of ["approve", "deny"] as const) {
      for (const headers of [
        {},
        { cookie: "pcp_portal_session=session" },
        { ...secureHeaders, "x-csrf-token": "wrong" },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/v1/device-authorizations/${id}/${action}`,
          headers,
          payload:
            action === "approve"
              ? { accountId: id, userCode: "ABCD-EFGH" }
              : { userCode: "ABCD-EFGH" },
        });
        expect([401, 403]).toContain(response.statusCode);
        expect(response.json().error.code).toMatch(
          /^AUTH_(SESSION|CSRF)_INVALID$/,
        );
      }
    }
    auth.csrfValid.mockReturnValue(true);
    // Valid authentication with malformed path/body is a contract failure, not a service call.
    for (const request of [
      {
        url: "/v1/device-authorizations/not-a-uuid/approve",
        payload: { accountId: id, userCode: "ABCD-EFGH" },
      },
      {
        url: `/v1/device-authorizations/${id}/approve`,
        payload: { accountId: "bad", userCode: "ABCD-EFGH" },
      },
      {
        url: `/v1/device-authorizations/${id}/deny`,
        payload: { userCode: "bad", extra: "no" },
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        ...request,
        headers: secureHeaders,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
    }
    service.approve.mockResolvedValueOnce({
      ok: false,
      code: "DEVICE_AUTH_FORBIDDEN",
    });
    service.approve.mockResolvedValueOnce({
      ok: false,
      code: "DEVICE_AUTH_STATE_CONFLICT",
    });
    service.deny.mockResolvedValueOnce({
      ok: false,
      code: "DEVICE_AUTH_INVALID",
    });
    service.deny.mockResolvedValueOnce({
      ok: false,
      code: "DEVICE_AUTH_CLOSED",
    });
    for (const [action, expected] of [
      ["approve", 403],
      ["approve", 409],
      ["deny", 401],
      ["deny", 409],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/device-authorizations/${id}/${action}`,
        headers: secureHeaders,
        payload:
          action === "approve"
            ? { accountId: id, userCode: "ABCD-EFGH" }
            : { userCode: "ABCD-EFGH" },
      });
      expect(response.statusCode).toBe(expected);
      expect(Object.keys(response.json())).toEqual(["error"]);
    }
    const denied = await app.inject({
      method: "POST",
      url: `/v1/device-authorizations/${id}/deny`,
      headers: secureHeaders,
      payload: { userCode: "ABCD-EFGH" },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(denied.json()).sort()).toEqual([
      "authorizationId",
      "status",
    ]);
    await app.close();
  });
});
