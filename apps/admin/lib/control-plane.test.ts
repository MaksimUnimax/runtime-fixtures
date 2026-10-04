import { describe, expect, it, vi } from "vitest";
import { controlPlane, ControlPlaneError } from "./control-plane";

function cookies(value: string) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: value },
  });
}
function response(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("narrow browser control-plane client", () => {
  it("uses portal CSRF only for elevation", async () => {
    cookies("pcp_csrf=portal; pcp_admin_csrf=admin");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/session", { method: "POST" });
    expect(
      new Headers(call.mock.calls[0]?.[1]?.headers).get("x-csrf-token"),
    ).toBe("portal");
    call.mockRestore();
  });
  it("uses admin CSRF for admin logout, never the portal value", async () => {
    cookies("pcp_csrf=portal; pcp_admin_csrf=admin");
    const call = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(undefined, 204));
    await controlPlane("/v1/admin/session", { method: "DELETE" });
    expect(
      new Headers(call.mock.calls[0]?.[1]?.headers).get("x-csrf-token"),
    ).toBe("admin");
    call.mockRestore();
  });
  it("uses admin CSRF for admin mutations", async () => {
    cookies("pcp_csrf=portal; pcp_admin_csrf=admin");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/principals", { method: "POST", body: "{}" });
    expect(
      new Headers(call.mock.calls[0]?.[1]?.headers).get("x-csrf-token"),
    ).toBe("admin");
    call.mockRestore();
  });
  it("does not attach CSRF to OTP request", async () => {
    cookies("pcp_csrf=portal; pcp_admin_csrf=admin");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/auth/otp/request", { method: "POST", body: "{}" });
    expect(
      new Headers(call.mock.calls[0]?.[1]?.headers).has("x-csrf-token"),
    ).toBe(false);
    call.mockRestore();
  });
  it("does not attach CSRF to reads", async () => {
    cookies("pcp_csrf=portal; pcp_admin_csrf=admin");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/me");
    expect(
      new Headers(call.mock.calls[0]?.[1]?.headers).has("x-csrf-token"),
    ).toBe(false);
    call.mockRestore();
  });
  it("rejects arbitrary browser URLs", async () => {
    await expect(
      controlPlane("https://evil.test/v1/admin/me"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("uses same-origin BFF URL", async () => {
    cookies("");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/me");
    expect(call.mock.calls[0]?.[0]).toBe("/api/control-plane/v1/admin/me");
    call.mockRestore();
  });
  it("uses the mounted admin BFF path when built for /admin", async () => {
    cookies("");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH", "/admin");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    try {
      await controlPlane("/v1/admin/me");
      expect(call.mock.calls[0]?.[0]).toBe(
        "/admin/api/control-plane/v1/admin/me",
      );
      expect(call.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
    } finally {
      call.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("always requests no-store", async () => {
    cookies("");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/me");
    expect(call.mock.calls[0]?.[1]?.cache).toBe("no-store");
    call.mockRestore();
  });
  it("maps 401 envelope code without exposing raw response", async () => {
    cookies("");
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        {
          error: {
            code: "ADMIN_UNAUTHORIZED",
            message: "Admin authentication failed",
          },
        },
        401,
      ),
    );
    await expect(controlPlane("/v1/admin/me")).rejects.toMatchObject({
      code: "ADMIN_UNAUTHORIZED",
      status: 401,
    });
    call.mockRestore();
  });
  it("maps stale state to a typed error", async () => {
    cookies("");
    const call = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        response(
          { error: { code: "ADMIN_STATE_STALE", message: "stale" } },
          409,
        ),
      );
    await expect(
      controlPlane("/v1/admin/accounts/x/subscription/y/suspend", {
        method: "POST",
      }),
    ).rejects.toBeInstanceOf(ControlPlaneError);
    call.mockRestore();
  });
  it("maps a network failure to service unavailable", async () => {
    cookies("");
    const call = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("secret upstream"));
    await expect(controlPlane("/v1/admin/me")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
    call.mockRestore();
  });
  it("does not read authorization or session-token cookies", async () => {
    cookies(
      "pcp_portal_session=secret; pcp_admin_session=secret; pcp_csrf=csrf",
    );
    const call = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}));
    await controlPlane("/v1/admin/me");
    const headers = new Headers(call.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBeNull();
    call.mockRestore();
  });
  it("does not retry a failed mutation", async () => {
    cookies("pcp_admin_csrf=admin");
    const call = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ error: { code: "ADMIN_CONFLICT" } }, 409));
    await expect(
      controlPlane("/v1/admin/principals", { method: "POST" }),
    ).rejects.toBeTruthy();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockRestore();
  });
});
