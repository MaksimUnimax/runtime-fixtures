import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/control-plane/[...path]/route";
import { controlPlane, ControlPlaneError } from "./control-plane";

const origin = "http://127.0.0.1:3100";
const listPath = "/v1/admin/health/targets";
const detailPath = listPath + "/" + "a".repeat(64);
const rawSecret = "SYNTHETIC_PRIVATE_UPSTREAM_CONNECTION_DETAIL";
const previousApiOrigin = process.env.CONTROL_PLANE_API_ORIGIN;
const previousBasePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH;

function installTwoStageRead(upstream: Response | Error) {
  const upstreamCalls: { url: string; options?: RequestInit }[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, options) => {
      const target = String(input);
      if (target.startsWith("/api/control-plane/")) {
        const url = new URL(target, "http://admin.test");
        const path = url.pathname
          .slice("/api/control-plane/".length)
          .split("/");
        return GET(
          new NextRequest(url, {
            method: "GET",
            headers: new Headers(options?.headers),
          }),
          { params: Promise.resolve({ path }) },
        );
      }
      upstreamCalls.push({ url: target, options });
      if (upstream instanceof Error) throw upstream;
      return upstream;
    });
  return { spy, upstreamCalls };
}

function errorEnvelope(code: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: { code, message: "Request not completed" } }),
    { status, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  process.env.CONTROL_PLANE_API_ORIGIN = origin;
  delete process.env.NEXT_PUBLIC_ADMIN_BASE_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousApiOrigin === undefined)
    delete process.env.CONTROL_PLANE_API_ORIGIN;
  else process.env.CONTROL_PLANE_API_ORIGIN = previousApiOrigin;
  if (previousBasePath === undefined)
    delete process.env.NEXT_PUBLIC_ADMIN_BASE_PATH;
  else process.env.NEXT_PUBLIC_ADMIN_BASE_PATH = previousBasePath;
});

describe("Health status contract through same-origin BFF and admin client", () => {
  it.each([
    ["unauthenticated", listPath, 401, "ADMIN_UNAUTHORIZED"],
    ["missing health.read", listPath, 403, "ADMIN_FORBIDDEN"],
    ["actual missing target", detailPath, 404, "ADMIN_RESOURCE_NOT_FOUND"],
    ["absent monitoring reader", listPath, 503, "SERVICE_UNAVAILABLE"],
  ])(
    "preserves %s with original HTTP status and typed code",
    async (_case, path, status, code) => {
      const { spy, upstreamCalls } = installTwoStageRead(
        errorEnvelope(code, status),
      );
      await expect(controlPlane(path)).rejects.toMatchObject({
        code,
        status,
      } satisfies Partial<ControlPlaneError>);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(upstreamCalls.map((call) => call.url)).toEqual([origin + path]);
      expect(upstreamCalls[0]?.options?.cache).toBe("no-store");
      expect(
        new Headers(upstreamCalls[0]?.options?.headers).get("authorization"),
      ).toBeNull();
    },
  );

  it("preserves a successful empty read as genuine empty data", async () => {
    const { spy, upstreamCalls } = installTwoStageRead(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await controlPlane(listPath + "?limit=1")).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(upstreamCalls[0]?.url).toBe(origin + listPath + "?limit=1");
  });

  it("maps a network rejection to safe generic 503", async () => {
    const { spy } = installTwoStageRead(new Error(rawSecret));
    let thrown: unknown;
    try {
      await controlPlane(listPath);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ControlPlaneError);
    expect(thrown).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: "Service unavailable",
    });
    expect(String(thrown)).not.toContain(rawSecret);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never sends a supplied browser bearer credential upstream", async () => {
    const { upstreamCalls } = installTwoStageRead(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await controlPlane(listPath, {
      headers: { Authorization: "Bearer SYNTHETIC_PRIVATE_TOKEN" },
    });
    const sent = new Headers(upstreamCalls[0]?.options?.headers);
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("cookie")).toBeNull();
  });

  it("rejects an invalid target path before upstream lookup", async () => {
    const { spy, upstreamCalls } = installTwoStageRead(
      errorEnvelope("SERVICE_UNAVAILABLE", 503),
    );
    await expect(controlPlane(listPath + "/INVALID")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 404,
    } satisfies Partial<ControlPlaneError>);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(upstreamCalls).toHaveLength(0);
  });
});
