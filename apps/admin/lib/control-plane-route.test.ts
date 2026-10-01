import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_ALLOWED_TUPLES,
  BFF_ALLOWED_TUPLE_COUNT,
  OTP_ALLOWED_TUPLES,
  allowedRoute,
  controlPlaneOrigin,
} from "./control-plane-route";
import { GET, POST } from "../app/api/control-plane/[...path]/route";

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
    .replaceAll("{repair_case_id}", uuid)
    .replaceAll("{support_case_id}", uuid)
    .replaceAll("{notification_id}", uuid)
    .replaceAll("{health_incident_id}", uuid)
    .replaceAll("{health_target_id}", "a".repeat(64))
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
    expect(ADMIN_ALLOWED_TUPLES.length).toBe(102);
    expect(OTP_ALLOWED_TUPLES.length).toBe(2);
    expect(ADMIN_ALLOWED_TUPLES.length + OTP_ALLOWED_TUPLES.length).toBe(104);
    expect(BFF_ALLOWED_TUPLE_COUNT).toBe(104);
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
    "123E4567-E89B-42D3-A456-426614174000",
    "123e4567-e89b-62d3-a456-426614174000",
    "123e4567-e89b-82d3-a456-426614174000",
    "00000000-0000-0000-0000-000000000000",
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
  ])("matches the z.uuid API boundary for %s", (apiId) => {
    expect(allowedRoute("GET", `/v1/admin/health/notifications/${apiId}`)).toBe(
      "/v1/admin/health/notifications/{notification_id}",
    );
    expect(allowedRoute("GET", `/v1/admin/health/incidents/${apiId}`)).toBe(
      "/v1/admin/health/incidents/{health_incident_id}",
    );
    expect(
      allowedRoute("GET", `/v1/admin/health/repair-cases/${apiId}/1`),
    ).toBe("/v1/admin/health/repair-cases/{repair_case_id}/{revision}");
    expect(allowedRoute("GET", `/v1/admin/support/cases/${apiId}`)).toBe(
      "/v1/admin/support/cases/{support_case_id}",
    );
    expect(
      allowedRoute("POST", `/v1/admin/support/cases/${apiId}/status`),
    ).toBe("/v1/admin/support/cases/{support_case_id}/status");
    expect(
      allowedRoute("POST", `/v1/admin/support/cases/${apiId}/followups`),
    ).toBe("/v1/admin/support/cases/{support_case_id}/followups");
  });

  it("matches the Health target API lower-hex identity boundary", () => {
    const targetId = "a".repeat(64);
    expect(allowedRoute("GET", `/v1/admin/health/targets/${targetId}`)).toBe(
      "/v1/admin/health/targets/{health_target_id}",
    );
    expect(
      allowedRoute("GET", `/v1/admin/health/targets/${"A".repeat(64)}`),
    ).toBeUndefined();
    expect(
      allowedRoute("GET", `/v1/admin/health/targets/${"a".repeat(63)}`),
    ).toBeUndefined();
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
    ["GET", "/v1/admin/support/cases/not-a-uuid"],
    ["GET", "/v1/admin/support/cases/123e4567-e89b-92d3-a456-426614174000"],
    ["GET", "/v1/admin/support/cases/123e4567-e89b-42d3-c456-426614174000"],
    ["GET", `/v1/admin/support/cases/${uuid}/extra`],
    ["POST", "/v1/admin/support/cases"],
    ["GET", `/v1/admin/support/cases/${uuid}/status`],
    ["GET", `/v1/admin/support/cases/${uuid}/followups`],
    ["POST", "/v1/admin/support/aggregates"],
    ["POST", "/v1/admin/support/funnels"],
    ["DELETE", `/v1/admin/support/cases/${uuid}`],
    ["GET", `/v1/admin/beta/admission/accounts/${uuid}`],
    ["GET", "/v1/admin/beta/admission/extra"],
    ["POST", "/v1/admin/beta/admission/extra"],
    ["DELETE", "/v1/admin/beta/admission"],
    ["GET", "/v1/admin/health/incidents"],
    ["GET", "/v1/admin/health/evaluations"],
    ["GET", "/v1/admin/health/recommendations"],
    ["GET", `/v1/admin/health/incidents/${uuid}/extra`],
    ["POST", `/v1/admin/health/incidents/${uuid}`],
    ["POST", "/v1/admin/health/targets"],
    ["GET", `/v1/admin/health/targets/${"a".repeat(64)}/extra`],
    ["POST", "/v1/admin/health/diagnostics/summary"],
    ["GET", "/v1/admin/health/diagnostics/summary/extra"],
    ["GET", "/v1/admin/health/notifications/not-a-uuid"],
    [
      "GET",
      "/v1/admin/health/notifications/123e4567-e89b-92d3-a456-426614174000",
    ],
    [
      "GET",
      "/v1/admin/health/notifications/123e4567-e89b-42d3-c456-426614174000",
    ],
    ["GET", `/v1/admin/health/notifications/${uuid}/extra`],
    ["POST", "/v1/admin/health/notifications"],
    ["POST", `/v1/admin/health/notifications/${uuid}`],
    ["DELETE", `/v1/admin/health/notifications/${uuid}`],
    ["GET", "/v1/admin/health/repair-cases/not-a-uuid/1"],
    ["GET", `/v1/admin/health/repair-cases/${uuid}/0`],
    ["GET", `/v1/admin/health/repair-cases/${uuid}/nope`],
    ["POST", "/v1/admin/health/repair-cases"],
    ["POST", `/v1/admin/health/repair-cases/${uuid}/1`],
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
  it("forwards an allowed beta mutation with CSRF but never Authorization", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    process.env.CONTROL_PLANE_API_ORIGIN = "http://127.0.0.1:3100";
    const response = await POST(
      new NextRequest(
        "http://admin.test/api/control-plane/v1/admin/beta/admission",
        {
          method: "POST",
          headers: {
            cookie: "pcp_admin_csrf=session",
            "content-type": "application/json",
            "x-csrf-token": "csrf",
            authorization: "Bearer should-not-forward",
          },
          body: JSON.stringify({ mode: "OPEN" }),
        },
      ),
      {
        params: Promise.resolve({
          path: ["v1", "admin", "beta", "admission"],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3100/v1/admin/beta/admission",
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe("pcp_admin_csrf=session");
    expect(headers.get("x-csrf-token")).toBe("csrf");
    expect(headers.get("authorization")).toBeNull();
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
      JSON.stringify({ mode: "OPEN" }),
    );
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

  it("blocks notification mutations before any upstream request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new NextRequest(
        "http://admin.test/api/control-plane/v1/admin/health/notifications",
        { method: "POST", body: "{}" },
      ),
      {
        params: Promise.resolve({
          path: ["v1", "admin", "health", "notifications"],
        }),
      },
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
