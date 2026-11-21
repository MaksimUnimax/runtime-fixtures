import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AdminAccountParamsV1Schema,
  AdminDeviceParamsV1Schema,
  AdminPrincipalMutationParamsV1Schema,
  AdminPrincipalRoleParamsV1Schema,
  AdminSubscriptionResourceParamsV1Schema,
} from "../../../packages/contracts/src/index";
import { GET, POST } from "../app/api/control-plane/[...path]/route";
import { ADMIN_ALLOWED_TUPLES, allowedRoute } from "./control-plane-route";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const identitySlot = /\{(?:account|device|subscription|principal)_id\}/g;
const tuples = ADMIN_ALLOWED_TUPLES.filter((tuple) =>
  /\{(?:account|device|subscription|principal)_id\}/.test(tuple),
);
const accepted = [
  ...Array.from({ length: 8 }, (_, index) =>
    uuid.replace("42d3", `${index + 1}2d3`),
  ),
  uuid.toUpperCase(),
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
];
const rejected = [
  "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
  "ffffffff-ffff-ffff-ffff-fffffffffffF",
  uuid.replace("42d3", "92d3"),
  uuid.replace("42d3", "02d3"),
  uuid.replace("a456", "c456"),
  uuid.replace("a456", "7456"),
  uuid + "0",
  uuid.slice(1),
  " " + uuid,
  uuid + "\n",
  uuid.replace("e89b", "e89g"),
  "%2f" + uuid,
  uuid + "/..",
  uuid + "\\extra",
  "..",
];

function materialize(template: string, id: string) {
  return template
    .replace(identitySlot, id)
    .replace("{entitlement_key}", "b14.allowed_feature")
    .replace("{role}", "ADMIN_SUPPORT");
}

function wireAccepts(id: string) {
  const results = [
    AdminAccountParamsV1Schema.safeParse({ account_id: id }),
    AdminDeviceParamsV1Schema.safeParse({ account_id: id, device_id: id }),
    AdminPrincipalMutationParamsV1Schema.safeParse({ principal_id: id }),
    AdminPrincipalRoleParamsV1Schema.safeParse({
      principal_id: id,
      role: "ADMIN_SUPPORT",
    }),
    AdminSubscriptionResourceParamsV1Schema.safeParse({
      account_id: id,
      subscription_id: id,
    }),
  ];
  return results.map((result) => result.success);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("B14 existing identity routes agree with current wire UUIDs", () => {
  it.each(accepted)(
    "accepts the wire UUID %s across every affected tuple",
    (id) => {
      expect(wireAccepts(id)).toEqual([true, true, true, true, true]);
      expect(tuples.length).toBeGreaterThan(0);
      for (const tuple of tuples) {
        const [method, template] = tuple.split(" ") as [string, string];
        expect(allowedRoute(method, materialize(template, id)), tuple).toBe(
          template,
        );
      }
    },
  );

  it.each(rejected)(
    "rejects invalid UUID %j at each identity position",
    (id) => {
      expect(wireAccepts(id)).toEqual([false, false, false, false, false]);
      for (const tuple of tuples) {
        const [method, template] = tuple.split(" ") as [string, string];
        for (const slot of template.match(identitySlot) ?? []) {
          const path = materialize(template.replace(slot, id), uuid);
          expect(
            allowedRoute(method, path),
            `${tuple} ${slot}`,
          ).toBeUndefined();
        }
      }
    },
  );

  it("retains exact methods, extra-segment and encoded-path rejections", () => {
    for (const tuple of tuples) {
      const [method, template] = tuple.split(" ") as [string, string];
      const path = materialize(template, uuid.toUpperCase());
      expect(allowedRoute("PATCH", path)).toBeUndefined();
      expect(allowedRoute(method, `${path}/extra`)).toBeUndefined();
      expect(
        allowedRoute(method, path.replace("/v1/", "/v1//")),
      ).toBeUndefined();
      expect(
        allowedRoute(method, path.replace(uuid.toUpperCase(), "%2F")),
      ).toBeUndefined();
    }
    expect(
      allowedRoute("GET", `/v1/admin/accounts/${uuid}/stores`),
    ).toBeUndefined(); // The proposed stores DTO is not agreed or wired.
  });

  it("forwards an accepted v7 account GET through the actual BFF", async () => {
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN", "http://b14-upstream.test");
    const id = uuid.replace("42d3", "72d3");
    const path = `/v1/admin/accounts/${id}/devices`;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    const response = await GET(
      new NextRequest(`http://admin.test/api/control-plane${path}?limit=50`),
      { params: Promise.resolve({ path: path.slice(1).split("/") }) },
    );
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `http://b14-upstream.test${path}?limit=50`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("preserves an upstream authorization denial after uppercase UUID forwarding", async () => {
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN", "http://b14-upstream.test");
    const path = `/v1/admin/principals/${uuid.toUpperCase()}/suspend`;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ error: { code: "ADMIN_FORBIDDEN" } }, { status: 403 }),
      );
    const response = await POST(
      new NextRequest(`http://admin.test/api/control-plane${path}`, {
        method: "POST",
        headers: {
          cookie: "pcp_admin_csrf=synthetic-b14",
          "x-csrf-token": "synthetic-b14",
          authorization: "Bearer must-not-forward",
          "content-type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: 7, reason: "synthetic B14" }),
      }),
      { params: Promise.resolve({ path: path.slice(1).split("/") }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ADMIN_FORBIDDEN" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBe("pcp_admin_csrf=synthetic-b14");
    expect(headers.get("x-csrf-token")).toBe("synthetic-b14");
  });
});
