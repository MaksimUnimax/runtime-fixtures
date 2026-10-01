import { describe, expect, it, vi } from "vitest";
import {
  createIsolatedAuthLifecycleDriver,
  validateIsolatedDatabaseUrl,
  type IsolatedAuthLifecycleOptions,
} from "./isolated-auth-lifecycle.js";

const common: Omit<IsolatedAuthLifecycleOptions, "fetch"> = {
  apiOrigin: "http://127.0.0.1:3100",
  portalOrigin: "http://localhost:3200",
  disposableDatabaseUrl: "postgres://local@127.0.0.1:15542/octoport_b_test",
  identity: { email: "isolated-auth@example.test", disposable: true },
  readOtpFixture: async () => "123456",
};

describe("isolated auth lifecycle driver safety", () => {
  it("accepts bracketed IPv6 loopback origins and a registered database", () => {
    expect(
      createIsolatedAuthLifecycleDriver({
        ...common,
        apiOrigin: "http://[::1]:3100",
        portalOrigin: "http://[::1]:3200",
        disposableDatabaseUrl: "postgres://local@[::1]:15542/octoport_b_test",
        fetch: vi.fn() as unknown as typeof fetch,
      }),
    ).toBeDefined();
  });

  it.each([
    ["apiOrigin", { apiOrigin: "https://api.example.test" }],
    ["portalOrigin", { portalOrigin: "http://192.168.1.5:3200" }],
    ["database", { disposableDatabaseUrl: "postgres://db.example.test/live" }],
    ["database name", { disposableDatabaseUrl: "postgres://localhost/live" }],
    ["identity", { identity: { email: "owner@example.com", disposable: true } }],
    ["identity marker", { identity: { email: "e2e@example.test", disposable: false } }],
  ])("rejects unsafe %s configuration before a request", (_name, override) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(() =>
      createIsolatedAuthLifecycleDriver({
        ...common,
        ...override,
        fetch: fetcher,
      } as IsolatedAuthLifecycleOptions),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "postgres://local@127.0.0.1:15541/octoport_a_test",
    "postgresql://local@localhost:15542/octoport_b_test",
    "postgres://local@[::1]:15543/octoport_c_test",
  ])("accepts the exact supervisor fixture target %s", (url) => {
    expect(validateIsolatedDatabaseUrl(url)).toBe(new URL(url).toString());
  });

  it.each([
    "postgres://local@127.0.0.1:15542/octoport_b_test?host=nonloopback.invalid",
    "postgres://local@127.0.0.1:15542/octoport_b_test?%68ost=nonloopback.invalid",
    "postgres://local@127.0.0.1:15542/octoport_b_test?host=%2Ftmp",
    "postgres://local@127.0.0.1:15542/octoport_b_test?port=5432",
    "postgres://local@127.0.0.1:15542/octoport_b_test?dbname=live",
    "postgres://local@127.0.0.1:15542/octoport_b_test?sslmode=require",
    "postgres://local@127.0.0.1:15542/octoport_b_test#fixture",
    "postgres://local@127.0.0.1:15542/latest",
    "postgres://local@127.0.0.1:15542/other_disposable",
    "postgres://local@127.0.0.1:5432/octoport_b_test",
    "postgres://local@127.0.0.1:15541/octoport_b_test",
    "postgres://local@127.0.0.1/octoport_b_test",
    "postgres://local@nonloopback.invalid:15542/octoport_b_test",
    "postgres://local@127.0.0.1:15542/octoport_%62_test",
  ])("rejects DB overrides and unregistered targets before I/O: %s", (url) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(() => validateIsolatedDatabaseUrl(url)).toThrow("registered loopback");
    expect(() =>
      createIsolatedAuthLifecycleDriver({
        ...common,
        disposableDatabaseUrl: url,
        fetch: fetcher,
      }),
    ).toThrow("registered loopback");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the injected OTP fixture to return a six-digit code", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ challengeId: "challenge", expiresAt: "soon" }),
        { status: 202 },
      ),
    ) as unknown as typeof fetch;
    const driver = createIsolatedAuthLifecycleDriver({
      ...common,
      readOtpFixture: async () => "from-log",
      fetch: fetcher,
    });
    await expect(driver.login()).rejects.toThrow("six-digit code");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

const validToken = {
  status: "activated",
  deviceId: "12345678-1234-4234-8234-123456789abc",
  sessionId: "abcdef12-1234-4234-8234-123456789abc",
  tokenType: "Bearer",
  accessToken: "synthetic-access-token",
  accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  refreshToken: "r".repeat(43),
  refreshTokenExpiresAt: "2030-01-02T00:00:00.000Z",
} as const;

function exchangeDriver(body: string) {
  const fetcher = vi.fn(async () => new Response(body, { status: 200 }));
  return {
    driver: createIsolatedAuthLifecycleDriver({ ...common, fetch: fetcher }),
    fetcher,
  };
}

describe("isolated auth token response evidence", () => {
  it("accepts a complete token response under the product contract", async () => {
    const { driver } = exchangeDriver(JSON.stringify(validToken));
    await expect(driver.exchangeDevice("fixture-device-code")).resolves.toEqual({
      kind: "activated",
      token: validToken,
    });
  });

  it.each(["not JSON", "<html>not an API response</html>", ""])(
    "rejects malformed HTTP 200 bodies instead of reporting activation",
    async (body) => {
      const { driver, fetcher } = exchangeDriver(body);
      await expect(driver.exchangeDevice("fixture-device-code")).rejects.toThrow(
        "invalid JSON response",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    [],
    {},
    { ...validToken, status: "pending" },
    { ...validToken, deviceId: "not-a-device-id" },
    { ...validToken, sessionId: null },
    { ...validToken, tokenType: "Basic" },
    { ...validToken, accessToken: "" },
    { ...validToken, accessTokenExpiresAt: "not-a-timestamp" },
    { ...validToken, refreshToken: "too-short" },
    { ...validToken, refreshTokenExpiresAt: undefined },
  ].map((body) => ({ body })))(
    "rejects invalid token contracts without false activation",
    async ({ body }) => {
      const { driver } = exchangeDriver(JSON.stringify(body));
      await expect(driver.exchangeDevice("fixture-device-code")).rejects.toThrow(
        "invalid token response",
      );
    },
  );

  it("preserves pending, activation and stable exchange idempotency", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "DEVICE_AUTH_PENDING" } }), {
          status: 409,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(validToken), { status: 200 }));
    const driver = createIsolatedAuthLifecycleDriver({ ...common, fetch: fetcher });
    expect(await driver.exchangeDevice("fixture-device-code")).toEqual({
      kind: "pending",
      retryAfter: "2",
    });
    expect(await driver.exchangeDevice("fixture-device-code")).toEqual({
      kind: "activated",
      token: validToken,
    });
    const keys = fetcher.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get("idempotency-key"),
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(keys[1]).toBe(keys[0]);
  });

  it("preserves closed and failed API outcomes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "DEVICE_AUTH_CLOSED" } }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const driver = createIsolatedAuthLifecycleDriver({ ...common, fetch: fetcher });
    expect(await driver.exchangeDevice("fixture-device-code")).toEqual({
      kind: "closed",
      code: "DEVICE_AUTH_CLOSED",
    });
    expect(await driver.exchangeDevice("fixture-device-code")).toEqual({
      kind: "failed",
      status: 503,
      code: "UNKNOWN_ERROR",
    });
  });
});
