import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@product/shared";
import type { ConnectionCodeService } from "@product/device-management";
import { createApiApp } from "./app.js";
import {
  loadRateLimitIpSource,
  rateLimitClientIp,
  type RateLimitIpSource,
} from "./rate-limit-client-ip.js";

const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://fixture@localhost:5432/test",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const apps: ReturnType<typeof createApiApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function fixture(source?: RateLimitIpSource) {
  const exchange = vi.fn().mockResolvedValue({
    kind: "ACTIVATED",
    accountId: "10000000-0000-4000-8000-000000000001",
    deviceId: "10000000-0000-4000-8000-000000000002",
    sessionId: "10000000-0000-4000-8000-000000000003",
    accessToken: "fixture-access-token",
    refreshToken: "R".repeat(43),
    accessTokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
    refreshTokenExpiresAt: new Date("2030-01-02T00:00:00Z"),
  });
  const app = createApiApp({
    config,
    rateLimitIpSource: source,
    isInfrastructureReady: async () => true,
    connectionCodeService: { exchange } as unknown as ConnectionCodeService,
  });
  apps.push(app);
  app.get("/fixture/client-ip", async (request) => ({
    bucket: rateLimitClientIp(request),
    ip: request.ip,
    protocol: request.protocol,
    hostname: request.hostname,
  }));
  return { app, exchange };
}

describe("explicit rate-limit IP source", () => {
  it("defaults to socket and rejects an unrecognized deployment mode", () => {
    expect(loadRateLimitIpSource(undefined)).toBe("socket");
    expect(loadRateLimitIpSource("socket")).toBe("socket");
    expect(loadRateLimitIpSource("loopback-x-real-ip")).toBe(
      "loopback-x-real-ip",
    );
    for (const value of ["", "true", "1", "all", " loopback-x-real-ip"])
      expect(() => loadRateLimitIpSource(value)).toThrow(
        "API_RATE_LIMIT_IP_SOURCE_INVALID",
      );
  });
  it("keeps socket-only behavior by default even behind loopback", async () => {
    const { app } = fixture();
    const r = await app.inject({
      url: "/fixture/client-ip",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-real-ip": "192.0.2.10",
        "x-forwarded-for": "198.51.100.11",
      },
    });
    expect(r.json().bucket).toBe("127.0.0.1");
  });
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts exactly one IP from the explicit local proxy %s",
    async (peer) => {
      const { app } = fixture("loopback-x-real-ip");
      const r = await app.inject({
        url: "/fixture/client-ip",
        remoteAddress: peer,
        headers: {
          "x-real-ip": "192.0.2.10",
          "x-forwarded-for": "198.51.100.11",
        },
      });
      expect(r.json().bucket).toBe("192.0.2.10");
      expect(r.json().ip).toBe(peer);
    },
  );
  it.each(["203.0.113.8", "10.0.0.1", "127.0.0.2", "2001:db8::2"])(
    "ignores forwarded identity from untrusted peer %s",
    async (peer) => {
      const { app } = fixture("loopback-x-real-ip");
      const r = await app.inject({
        url: "/fixture/client-ip",
        remoteAddress: peer,
        headers: {
          "x-real-ip": "192.0.2.10",
          "x-forwarded-for": "198.51.100.11",
        },
      });
      expect(r.json().bucket).toBe(peer);
    },
  );
  it.each([
    undefined,
    "",
    "not-an-ip",
    "192.0.2.10, 192.0.2.11",
    "192.0.2.10:80",
    "[2001:db8::1]",
    "fe80::1%eth0",
    "192.000.002.010",
  ])(
    "does not allow invalid X-Real-IP %s to choose a bucket",
    async (value) => {
      const { app } = fixture("loopback-x-real-ip");
      const r = await app.inject({
        url: "/fixture/client-ip",
        remoteAddress: "127.0.0.1",
        headers: value === undefined ? {} : { "x-real-ip": value },
      });
      expect(r.json().bucket).toBe("127.0.0.1");
    },
  );
  it("rejects duplicate X-Real-IP values", async () => {
    const { app } = fixture("loopback-x-real-ip");
    const r = await app.inject({
      url: "/fixture/client-ip",
      remoteAddress: "127.0.0.1",
      headers: { "x-real-ip": ["192.0.2.10", "192.0.2.11"] },
    });
    expect(r.json().bucket).toBe("127.0.0.1");
  });
  it("canonicalizes IPv6 without trusting forwarded Host or protocol", async () => {
    const { app } = fixture("loopback-x-real-ip");
    for (const ip of ["2001:DB8:0:0:0:0:0:1", "2001:db8::1"]) {
      const r = await app.inject({
        url: "/fixture/client-ip",
        remoteAddress: "127.0.0.1",
        headers: {
          host: "api.fixture",
          "x-real-ip": ip,
          "x-forwarded-host": "evil.invalid",
          "x-forwarded-proto": "https",
        },
      });
      expect(r.json()).toEqual({
        bucket: "2001:db8::1",
        ip: "127.0.0.1",
        hostname: "api.fixture",
        protocol: "http",
      });
    }
  });
  it("does not leak proxy mode to another app instance", async () => {
    const trusted = fixture("loopback-x-real-ip"),
      direct = fixture();
    const options = {
      url: "/fixture/client-ip",
      remoteAddress: "127.0.0.1",
      headers: { "x-real-ip": "192.0.2.10" },
    };
    expect((await trusted.app.inject(options)).json().bucket).toBe(
      "192.0.2.10",
    );
    expect((await direct.app.inject(options)).json().bucket).toBe("127.0.0.1");
  });
  it("passes separate client buckets to the actual account-code route and ignores spoofed chains", async () => {
    const { app, exchange } = fixture("loopback-x-real-ip");
    for (const [client, chain] of [
      ["192.0.2.10", "203.0.113.1"],
      ["192.0.2.11", "203.0.113.1"],
      ["192.0.2.10", "203.0.113.99"],
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/connection-codes/exchange",
        remoteAddress: "127.0.0.1",
        headers: {
          "idempotency-key": "fixture-ip-123456789",
          "x-real-ip": client!,
          "x-forwarded-for": chain!,
        },
        payload: {
          code: "octo1_" + Buffer.alloc(32, 19).toString("base64url"),
        },
      });
      expect(r.statusCode).toBe(200);
    }
    expect(exchange.mock.calls.map((call) => call[1])).toEqual([
      "192.0.2.10",
      "192.0.2.11",
      "192.0.2.10",
    ]);
  });
});
