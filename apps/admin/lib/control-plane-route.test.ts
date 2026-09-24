import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_ALLOWED_TUPLES,
  BFF_ALLOWED_TUPLE_COUNT,
  OTP_ALLOWED_TUPLES,
  allowedRoute,
  controlPlaneOrigin,
} from "./control-plane-route";
import { GET } from "../app/api/control-plane/[...path]/route";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
function materialize(template: string) {
  return template
    .replaceAll("{account_id}", uuid)
    .replaceAll("{device_id}", uuid)
    .replaceAll("{subscription_id}", uuid)
    .replaceAll("{plan_id}", uuid)
    .replaceAll("{plan_revision_id}", uuid)
    .replaceAll("{price_id}", uuid)
    .replaceAll("{price_revision_id}", uuid)
    .replaceAll("{principal_id}", uuid)
    .replaceAll("{adapter_id}", uuid)
    .replaceAll("{surface_id}", uuid)
    .replaceAll("{variant_id}", uuid)
    .replaceAll("{profile_id}", uuid)
    .replaceAll("{assignment_id}", uuid)
    .replaceAll("{revision}", "7")
    .replaceAll("{version}", "0.2.4")
    .replaceAll("{entitlement_key}", "feature.export")
    .replaceAll("{policy_key}", "global")
    .replaceAll("{role}", "ADMIN_OPS");
}

describe("admin BFF exact route boundary", () => {
  it("keeps the exact accepted tuple arithmetic", () => {
    expect(ADMIN_ALLOWED_TUPLES.length).toBe(85);
    expect(OTP_ALLOWED_TUPLES.length).toBe(2);
    expect(ADMIN_ALLOWED_TUPLES.length + OTP_ALLOWED_TUPLES.length).toBe(87);
    expect(BFF_ALLOWED_TUPLE_COUNT).toBe(87);
  });
  it.each(ADMIN_ALLOWED_TUPLES)("allows accepted admin tuple %s", (tuple) => {
    const separator = tuple.indexOf(" ");
    const method = tuple.slice(0, separator);
    const template = tuple.slice(separator + 1);
    expect(allowedRoute(method, materialize(template))).toBe(template);
  });
  it.each(OTP_ALLOWED_TUPLES)("allows dedicated OTP tuple %s", (tuple) => {
    const separator = tuple.indexOf(" ");
    const method = tuple.slice(0, separator);
    const path = tuple.slice(separator + 1);
    expect(allowedRoute(method, path)).toBe(path);
  });
  it.each([
    ["GET", "/v1/admin/future"],
    ["GET", "/v1/admin/compatibility/releases/0.2.4/publish"],
    ["POST", "/v1/admin/compatibility/releases/0.2.4/publish/extra"],
    ["POST", "/v1/admin/compatibility/releases/%2e%2e/publish"],
    ["POST", "/v1/admin/compatibility/releases/../publish"],
    ["POST", `/v1/admin/compatibility/releases/${"1".repeat(65)}/publish`],
    ["POST", "/v1/admin/commercial/plans/future"],
    ["GET", "/v1/bootstrap"],
    ["DELETE", "/v1/admin/me"],
    ["GET", "/v1/admin/accounts/123"],
    ["GET", "/v1/admin/accounts//devices"],
    ["GET", "/v1/admin/accounts/../users"],
    ["GET", "/v1/admin/accounts/%2Fdevices"],
    ["GET", "/v1/admin/accounts/%2e%2e/users"],
    [
      "GET",
      "/v1/admin/ai/profiles/123e4567-e89b-42d3-a456-426614174000/revisions/0",
    ],
    [
      "GET",
      "/v1/admin/ai/profiles/123e4567-e89b-42d3-a456-426614174000/revisions/-1",
    ],
    [
      "GET",
      "/v1/admin/ai/profiles/123e4567-e89b-42d3-a456-426614174000/revisions/nope",
    ],
    ["GET", "/v1/admin/ai/profiles/not-a-uuid"],
    ["GET", "/v1/admin/ai/assignments/not-a-uuid"],
    [
      "GET",
      "/v1/admin/ai/profiles/123e4567-e89b-42d3-a456-426614174000/revisions/%2e%2e",
    ],
    [
      "POST",
      "/v1/admin/accounts/123e4567-e89b-42d3-a456-426614174000/devices/123e4567-e89b-42d3-a456-426614174000/revoke/extra",
    ],
    ["PATCH", "/v1/admin/session"],
  ])("rejects non-accepted route %s %s", (method, path) =>
    expect(allowedRoute(method, path)).toBeUndefined(),
  );
  it.each([
    "rollout/percentage",
    "rollout/pause",
    "rollout/resume",
    "rollout/complete",
  ])("rejects stale nested assignment route %s", (suffix) =>
    expect(
      allowedRoute("POST", `/v1/admin/ai/assignments/${uuid}/${suffix}`),
    ).toBeUndefined(),
  );
  it.each([
    "file:///x",
    "ftp://host",
    "https://user:pass@host",
    "https://host/path",
    "https://host/?q=1",
    "https://host/#hash",
    "/relative",
  ])("rejects unsafe origin %s", (value) =>
    expect(controlPlaneOrigin(value)).toBeUndefined(),
  );
  it("accepts only a root absolute HTTP origin", () =>
    expect(controlPlaneOrigin("http://127.0.0.1:3100")).toBe(
      "http://127.0.0.1:3100",
    ));
});

describe("admin BFF forwarding behavior", () => {
  it("forwards only the three safe request headers and no authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    process.env.CONTROL_PLANE_API_ORIGIN = "http://127.0.0.1:3100";
    const request = new NextRequest(
      "http://admin.test/api/control-plane/v1/admin/me",
      {
        headers: {
          cookie: "pcp_admin_csrf=x",
          "content-type": "application/json",
          "x-csrf-token": "x",
          authorization: "Bearer should-not-forward",
          "x-forwarded-for": "spoof",
        },
      },
    );
    await GET(request, {
      params: Promise.resolve({ path: ["v1", "admin", "me"] }),
    });
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe("pcp_admin_csrf=x");
    expect(headers.get("x-csrf-token")).toBe("x");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    fetchMock.mockRestore();
  });
  it("forwards set-cookie and safe cache headers from upstream", async () => {
    const upstream = new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        pragma: "no-cache",
        "set-cookie": "pcp_admin_csrf=csrf; Path=/",
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);
    const response = await GET(
      new NextRequest("http://admin.test/api/control-plane/v1/admin/me"),
      { params: Promise.resolve({ path: ["v1", "admin", "me"] }) },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("set-cookie")).toContain("pcp_admin_csrf");
    fetchMock.mockRestore();
  });
  it("uses no-store for every upstream request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await GET(
      new NextRequest("http://admin.test/api/control-plane/v1/admin/accounts"),
      { params: Promise.resolve({ path: ["v1", "admin", "accounts"] }) },
    );
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
    fetchMock.mockRestore();
  });
  it("maps upstream network failure to safe 503", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("private upstream detail"));
    const response = await GET(
      new NextRequest("http://admin.test/api/control-plane/v1/admin/me"),
      { params: Promise.resolve({ path: ["v1", "admin", "me"] }) },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private upstream detail");
    fetchMock.mockRestore();
  });
  it("does not call upstream for a disallowed future route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new NextRequest("http://admin.test/api/control-plane/v1/admin/future"),
      { params: Promise.resolve({ path: ["v1", "admin", "future"] }) },
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
  it("does not call upstream for an invalid origin", async () => {
    process.env.CONTROL_PLANE_API_ORIGIN = "https://user:pass@host/path";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new NextRequest("http://admin.test/api/control-plane/v1/admin/me"),
      { params: Promise.resolve({ path: ["v1", "admin", "me"] }) },
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
    process.env.CONTROL_PLANE_API_ORIGIN = "http://127.0.0.1:3100";
  });
});
