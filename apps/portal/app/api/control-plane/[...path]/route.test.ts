import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route.js";
import {
  allowedRoute,
  controlPlaneOrigin,
} from "../../../../lib/control-plane-route.js";
import config from "../../../../next.config.js";

describe("portal control-plane BFF boundary", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards only approved auth headers including the exact idempotency key", async () => {
    const environment = process.env as Record<string, string | undefined>;
    const priorOrigin = environment.CONTROL_PLANE_API_ORIGIN;
    environment.CONTROL_PLANE_API_ORIGIN = "https://api.example.test";

    const downstream = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", downstream);

    const context = {
      params: Promise.resolve({ path: ["v1", "auth", "otp", "verify"] }),
    };
    try {
      const first = new NextRequest(
        "https://portal.example.test/api/control-plane/v1/auth/otp/verify",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "pcp_session=session-value; pcp_csrf=csrf-cookie",
            "x-csrf-token": "csrf-header",
            "idempotency-key": "otp-verify-key",
            "x-unapproved-header": "must-not-pass",
          },
          body: JSON.stringify({ code: "123456" }),
        },
      );
      expect((await POST(first, context)).status).toBe(200);

      const second = new NextRequest(
        "https://portal.example.test/api/control-plane/v1/auth/otp/verify",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "pcp_session=session-value; pcp_csrf=csrf-cookie",
            "x-csrf-token": "csrf-header",
            "x-unapproved-header": "must-not-pass",
          },
          body: JSON.stringify({ code: "654321" }),
        },
      );
      expect((await POST(second, context)).status).toBe(200);

      expect(downstream).toHaveBeenCalledTimes(2);
      const firstHeaders = new Headers(
        (downstream.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
      );
      expect(firstHeaders.get("content-type")).toBe("application/json");
      expect(firstHeaders.get("cookie")).toBe(
        "pcp_session=session-value; pcp_csrf=csrf-cookie",
      );
      expect(firstHeaders.get("x-csrf-token")).toBe("csrf-header");
      expect(firstHeaders.get("idempotency-key")).toBe("otp-verify-key");
      expect(firstHeaders.has("x-unapproved-header")).toBe(false);

      const secondHeaders = new Headers(
        (downstream.mock.calls[1]?.[1] as RequestInit | undefined)?.headers,
      );
      expect(secondHeaders.has("idempotency-key")).toBe(false);
      expect(secondHeaders.has("x-unapproved-header")).toBe(false);
    } finally {
      environment.CONTROL_PLANE_API_ORIGIN = priorOrigin;
    }
  });

  it.each([
    ["POST", "/v1/auth/otp/request"],
    ["POST", "/v1/auth/otp/verify"],
    ["POST", "/v1/auth/logout"],
    ["GET", "/v1/accounts"],
    ["GET", `/v1/device-authorizations/${id}`],
    ["POST", `/v1/device-authorizations/${id}/approve`],
    ["POST", `/v1/device-authorizations/${id}/deny`],
    ["GET", "/v1/devices"],
    ["POST", `/v1/devices/${id}/revoke`],
    ["GET", "/v1/subscription"],
    ["GET", "/v1/billing/payments"],
  ])("allows %s %s", (method, path) =>
    expect(allowedRoute(method, path)).toBeTruthy(),
  );
  it.each([
    ["POST", "/v1/device-authorizations"],
    ["POST", "/v1/device-authorizations/token"],
    ["POST", "/v1/auth/refresh"],
    ["GET", "/v1/bootstrap"],
    ["DELETE", "/v1/accounts"],
    ["GET", "/v1/anything"],
    ["GET", "/v1/devices/else"],
    ["POST", "/v1/billing/checkouts"],
    ["POST", "/v1/billing/events"],
  ])("rejects %s %s", (method, path) =>
    expect(allowedRoute(method, path)).toBeUndefined(),
  );
  it("accepts only a root absolute http(s) origin", () => {
    expect(controlPlaneOrigin("https://api.example.test")).toBe(
      "https://api.example.test",
    );
    for (const value of [
      "file:///x",
      "ftp://x",
      "javascript:x",
      "https://u:p@x",
      "https://x/a",
      "https://x/?q=1",
      "https://x/#x",
      "/relative",
    ])
      expect(controlPlaneOrigin(value)).toBeUndefined();
  });
});

describe("portal response security headers", () => {
  it("sets the P2 production HTML security baseline and disables powered-by", async () => {
    const environment = process.env as Record<string, string | undefined>;
    const prior = environment.NODE_ENV;
    environment.NODE_ENV = "production";
    try {
      const routes = await config.headers?.();
      const headers = new Map(
        routes?.[0]?.headers.map((header) => [
          header.key.toLowerCase(),
          header.value,
        ]),
      );
      const csp = headers.get("content-security-policy");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBeTruthy();
      expect(headers.get("permissions-policy")).toBeTruthy();
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("strict-transport-security")).toContain("max-age=");
      expect(config.poweredByHeader).toBe(false);
    } finally {
      environment.NODE_ENV = prior;
    }
  });
});
