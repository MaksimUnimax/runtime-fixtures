import { describe, expect, it, vi } from "vitest";
import {
  createIsolatedAuthLifecycleDriver,
  type IsolatedAuthLifecycleOptions,
} from "./isolated-auth-lifecycle.js";

const common: Omit<IsolatedAuthLifecycleOptions, "fetch"> = {
  apiOrigin: "http://127.0.0.1:3100",
  portalOrigin: "http://localhost:3200",
  disposableDatabaseUrl: "postgres://local@127.0.0.1:5432/octoport_e2e",
  identity: { email: "isolated-auth@example.test", disposable: true },
  readOtpFixture: async () => "123456",
};

describe("isolated auth lifecycle driver safety", () => {
  it("accepts bracketed IPv6 loopback origins and databases", () => {
    expect(
      createIsolatedAuthLifecycleDriver({
        ...common,
        apiOrigin: "http://[::1]:3100",
        portalOrigin: "http://[::1]:3200",
        disposableDatabaseUrl:
          "postgres://local@[::1]:5432/octoport_disposable",
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
    expect(() =>
      createIsolatedAuthLifecycleDriver({
        ...common,
        ...override,
        fetch: vi.fn() as unknown as typeof fetch,
      } as IsolatedAuthLifecycleOptions),
    ).toThrow();
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
