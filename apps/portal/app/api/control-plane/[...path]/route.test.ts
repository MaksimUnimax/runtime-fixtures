import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route.js";
import {
  allowedRoute,
  controlPlaneOrigin,
} from "../../../../lib/control-plane-route.js";
import config from "../../../../next.config.js";
import * as responseConsumer from "@product/contracts/account-code-http-response";
import { readFileSync } from "node:fs";

describe("ACW1 connected GET proxy DATA", () => {
  const id = "11112233-4455-4677-8899-aabbccddeeff";
  const other = "22112233-4455-4677-8899-aabbccddeeff";
  const operationId = "77112233-4455-4677-8899-aabbccddeeff";
  const fixture = JSON.parse(readFileSync(new URL("../../../../../../packages/contracts/src/account-code-wire.fixture.json", import.meta.url), "utf8"));
  // Public structural fixture only, not authority/MAC verification.
  const payload = { profile:"ACW1", kind:"write", keyVersion:1, operation:"issue", operationId,
    accountId:id, baseRevision:0, portalBinding:fixture.positive.P03.portalBinding, issuedAt:0, notAfter:600000 };
  const canon = (x: Record<string, unknown>) => JSON.stringify(x, Object.keys(x).sort());
  const permit = { profile:"ACW1", metadata:{accountId:id,codeRevision:0,state:"ABSENT",createdAt:null},
    writePermit:{operationId,ticket:Buffer.from(canon(payload)).toString("base64url")+"."+Buffer.alloc(32).toString("base64url"),issuedAt:0,notAfter:600000} };
  const context = () => ({ params:Promise.resolve({path:["v1","accounts",id,"connection-code"]}) });
  const request = (query="?action=issue", method="GET") => new NextRequest(
    "https://portal.example.test/api/control-plane/v1/accounts/"+id+"/connection-code"+query,
    {method,headers:{cookie:"public_session=synthetic","x-unapproved-header":"__PUBLIC_MARKER__"}},
  );
  afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
  function upstream(raw: Uint8Array, headers: Record<string,string> = {}) {
    return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(raw);c.close();}}),{
      status:200,headers:{"content-type":"application/json","cache-control":"public,max-age=9999",...headers},
    });
  }
  it("calls the real metadata consumer from the existing GET entry and overrides cache headers", async () => {
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");
    const spy=vi.spyOn(responseConsumer,"consumeAcw1HttpMetadataResponse");
    const fetcher=vi.fn(async()=>upstream(new TextEncoder().encode(JSON.stringify(permit)),{"set-cookie":"public_upstream=synthetic; Path=/"}));
    vi.stubGlobal("fetch",fetcher);
    const response=await GET(request(),context());
    expect(response.status).toBe(200);expect(await response.json()).toEqual(permit);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual(["public_upstream=synthetic; Path=/"]);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("issue");expect(spy.mock.calls[0]?.[3]).toEqual({accountId:id});
  });
  it.each(["", "?action=issue&action=rotate", "?action=issue&debug=x"])("rejects query before upstream %s",async(query)=>{
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");const f=vi.fn();vi.stubGlobal("fetch",f);
    const r=await GET(request(query),context());expect(r.status).toBe(404);expect(r.headers.get("cache-control")).toBe("no-store");expect(f).not.toHaveBeenCalled();
  });
  it("keeps POST/attempts unexposed",async()=>{
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");const f=vi.fn();vi.stubGlobal("fetch",f);
    const r=await POST(request("?action=issue","POST"),context());expect(r.status).toBe(404);expect(r.headers.get("cache-control")).toBe("no-store");expect(f).not.toHaveBeenCalled();
  });
  it.each([
    () => JSON.stringify({...permit,metadata:{...permit.metadata,accountId:other}}),
    () => JSON.stringify({...permit,debug:"__PUBLIC_MARKER__"}),
    () => JSON.stringify(permit).replace('"codeRevision":0','"codeRevision":-0'),
    () => JSON.stringify(permit).slice(0,-1)+',"profile":"ACW1"}',
    () => "\ufeff"+JSON.stringify(permit),
  ])("returns bounded fixed fallback for raw/schema/context failures",async(raw)=>{
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");vi.stubGlobal("fetch",vi.fn(async()=>upstream(new TextEncoder().encode(raw()))));
    const r=await GET(request(),context());expect(r.status).toBe(503);expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({error:{code:"SERVICE_UNAVAILABLE",message:"Service unavailable"}});
  });
  it.each([16384,16385])("bounds raw full-response bytes at %s",async(size)=>{
    const raw=JSON.stringify(permit);vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");
    vi.stubGlobal("fetch",vi.fn(async()=>upstream(new TextEncoder().encode(" ".repeat(size-Buffer.byteLength(raw))+raw))));
    const r=await GET(request(),context());expect(r.status).toBe(size===16384?200:503);expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("does not reflect fetch exception or retry",async()=>{
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN","https://upstream.invalid");const f=vi.fn(async()=>{throw new Error("__PUBLIC_MARKER__");});vi.stubGlobal("fetch",f);
    const r=await GET(request(),context());expect(r.status).toBe(503);expect(await r.text()).not.toContain("__PUBLIC_MARKER__");expect(f).toHaveBeenCalledTimes(1);expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("portal control-plane BFF boundary", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
    ["GET", `/v1/support/cases/${id}`],
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
    ["DELETE", "/v1/support/cases"],
    ["POST", "/v1/support/cases/admin"],
  ])("rejects %s %s", (method, path) =>
    expect(allowedRoute(method, path)).toBeUndefined(),
  );

  it("forwards only the original session to same-case support detail and preserves upstream denial", async () => {
    vi.stubEnv("CONTROL_PLANE_API_ORIGIN", "https://api.example.test");
    const downstream = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const cookie = new Headers(init?.headers).get("cookie");
        if (cookie !== "pcp_portal_session=synthetic-user-session") {
          return Response.json(
            { error: { code: "AUTH_SESSION_INVALID" } },
            { status: 401 },
          );
        }
        return Response.json(
          {
            caseId: id,
            status: "TRIAGED",
            followups: [
              {
                followupId: "00000000-0000-4000-8000-000000000005",
                authorType: "SUPPORT",
                body: "Synthetic support response",
                createdAt: "2030-01-01T00:00:00.000Z",
              },
            ],
          },
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", downstream);
    const path = `/v1/support/cases/${id}`;
    const url = `https://portal.example.test/api/control-plane${path}`;
    const context = {
      params: Promise.resolve({ path: ["v1", "support", "cases", id] }),
    };
    const authorized = await GET(
      new NextRequest(url, {
        headers: {
          cookie: "pcp_portal_session=synthetic-user-session",
          "x-unapproved-header": "must-not-pass",
        },
      }),
      context,
    );
    expect(authorized.status).toBe(200);
    expect((await authorized.json()).caseId).toBe(id);
    expect(downstream).toHaveBeenCalledTimes(1);
    const [target, init] = downstream.mock.calls[0]!;
    expect(target).toBe(`https://api.example.test${path}`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("cookie")).toBe(
      "pcp_portal_session=synthetic-user-session",
    );
    expect(headers.has("x-unapproved-header")).toBe(false);
    const denied = await GET(new NextRequest(url), context);
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe("AUTH_SESSION_INVALID");
    const [, deniedInit] = downstream.mock.calls[1]!;
    expect(new Headers(deniedInit?.headers).has("cookie")).toBe(false);
    expect(downstream).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "POST"])(
    "forwards support cases through the real %s handler",
    async (method) => {
      vi.stubEnv("CONTROL_PLANE_API_ORIGIN", "https://api.example.test");
      const payload = {
        subject: "Synthetic feedback",
        message: "Fixture only",
      };
      const downstream = vi.fn(async () =>
        Response.json({ cases: [] }, { status: method === "POST" ? 201 : 200 }),
      );
      vi.stubGlobal("fetch", downstream);
      const request = new NextRequest(
        "https://portal.example.test/api/control-plane/v1/support/cases?limit=10",
        {
          method,
          headers: {
            "content-type": "application/json",
            cookie: "pcp_session=fixture",
            "x-csrf-token": "fixture-csrf",
            "idempotency-key": "fixture-support",
          },
          ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
        },
      );
      const response = await (method === "GET" ? GET : POST)(request, {
        params: Promise.resolve({ path: ["v1", "support", "cases"] }),
      });
      expect(response.status).toBe(method === "POST" ? 201 : 200);
      expect(downstream).toHaveBeenCalledTimes(1);
      const [url, init] = downstream.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("https://api.example.test/v1/support/cases?limit=10");
      expect(init.method).toBe(method);
      expect(new Headers(init.headers).get("cookie")).toBe(
        "pcp_session=fixture",
      );
      expect(new Headers(init.headers).get("x-csrf-token")).toBe(
        "fixture-csrf",
      );
      expect(new Headers(init.headers).get("idempotency-key")).toBe(
        "fixture-support",
      );
      if (method === "POST")
        expect(
          JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer)),
        ).toEqual(payload);
      else expect(init.body).toBeUndefined();
    },
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
