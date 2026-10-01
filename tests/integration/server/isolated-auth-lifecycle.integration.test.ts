import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  AuthService,
  deriveAuthKeys,
} from "../../../packages/server/auth/src/index.js";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
} from "../../../packages/server/device-auth/src/index.js";
import {
  DeviceManagementService,
  type DeviceLimitResolver,
} from "../../../packages/server/device-management/src/index.js";
import {
  createAuthRepository,
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  createDeviceManagementRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createEphemeralAccessTokenSigningKey } from "../../../packages/server/extension-auth/src/index.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import {
  createIsolatedAuthLifecycleDriver,
  validateIsolatedDatabaseUrl,
} from "../../../tooling/server/isolated-auth-lifecycle.js";

const identity = {
  email: "isolated-auth@example.test",
  disposable: true,
} as const;
const otpFixture = "123456";
const root = Buffer.alloc(32, 7);
const signingKey = createEphemeralAccessTokenSigningKey("isolated-auth-test");

function disposableDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw)
    throw new Error(
      "DATABASE_URL must be supplied by the supervised test runner",
    );
  // Validate the exact registry target before DB connection, migrations or TRUNCATE.
  return validateIsolatedDatabaseUrl(raw);
}

const connectionString = disposableDatabaseUrl();
const config: AppConfig = {
  environment: "test",
  databaseUrl: connectionString,
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 0,
  workerReadyDelayMs: 0,
};
const limits: DeviceLimitResolver = {
  resolve: async () => ({ maxActive: 2, source: "ISOLATED_TEST" }),
};
let db: DatabaseRuntime;
let app: ReturnType<typeof createApiApp>;
let deviceNow = new Date();
const exchangeCalls: Array<{ deviceCode: string; key: string | null }> = [];

async function clear(): Promise<void> {
  await db.query(
    "TRUNCATE audit_events,auth_rate_limit_buckets,refresh_tokens,sessions,devices,device_authorizations,otp_email_jobs,otp_challenges,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
  );
  await db.query(
    "UPDATE beta_admission_state SET mode='OPEN',capacity=100000,admitted=0,revision=1 WHERE id=1",
  );
  exchangeCalls.length = 0;
}

function localFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const incoming = new URL(String(input));
    const path = incoming.pathname.replace(/^\/api\/control-plane/, "");
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const payload = typeof init.body === "string" ? init.body : undefined;
    if (path === "/v1/device-authorizations/token" && payload) {
      const body = JSON.parse(payload) as { deviceCode: string };
      exchangeCalls.push({
        deviceCode: body.deviceCode,
        key: new Headers(init.headers).get("idempotency-key"),
      });
    }
    const response = await app.inject({
      method: (init.method ?? "GET") as "GET" | "POST",
      url: `${path}${incoming.search}`,
      headers,
      ...(payload === undefined ? {} : { payload }),
      remoteAddress: "127.0.0.1",
    });
    const outputHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      if (name === "set-cookie") {
        for (const cookie of Array.isArray(value) ? value : [value])
          outputHeaders.append(name, String(cookie));
      } else if (Array.isArray(value)) {
        for (const item of value) outputHeaders.append(name, String(item));
      } else {
        outputHeaders.set(name, String(value));
      }
    }
    return new Response(response.statusCode === 204 ? null : response.body, {
      status: response.statusCode,
      headers: outputHeaders,
    });
  };
}

describe.sequential(
  "isolated auth lifecycle real PostgreSQL/API integration",
  () => {
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString);
      await db.ready();
      await runMigrations({ connectionString });
      const auth = new AuthService(
        createAuthRepository(db),
        deriveAuthKeys(root),
        () => new Date(),
        () => otpFixture,
      );
      const deviceAuthorization = new DeviceAuthorizationService(
        createDeviceAuthorizationRepository(db),
        deriveDeviceAuthKeys(root),
        () => deviceNow,
      );
      const deviceManagement = new DeviceManagementService(
        createDeviceManagementRepository(db),
        root,
        signingKey,
        limits,
        () => deviceNow,
      );
      app = createApiApp({
        config,
        isInfrastructureReady: async () => true,
        authService: auth,
        deviceAuthorizationService: deviceAuthorization,
        deviceManagementService: deviceManagement,
      });
      await app.ready();
    });

    beforeEach(async () => {
      deviceNow = new Date();
      await clear();
    });

    afterAll(async () => {
      if (app) await app.close();
      if (db) await db.close();
    });

    it("drives ordinary OTP, portal approval, exchange, cancellation, and revoke APIs", async () => {
      const driver = createIsolatedAuthLifecycleDriver({
        apiOrigin: "http://127.0.0.1:3100",
        portalOrigin: "http://127.0.0.1:3200",
        disposableDatabaseUrl: connectionString,
        identity,
        readOtpFixture: async ({ email, challengeId }) => {
          expect(email).toBe(identity.email);
          expect(challengeId).toMatch(/^[0-9a-f-]{36}$/i);
          return otpFixture;
        },
        fetch: localFetch(),
      });

      await driver.login();
      const [account] = await driver.listAccounts();
      expect(account?.status).toBe("ACTIVE");
      const device = await driver.startDevice({
        browserFamily: "chrome",
        extensionVersion: "1.0.0",
        deviceLabel: "isolated auth lifecycle fixture",
      });
      expect(await driver.exchangeDevice(device.deviceCode)).toMatchObject({
        kind: "pending",
      });
      await driver.previewDevice(device.authorizationId);
      await driver.approveDevice(
        device.authorizationId,
        String(account?.id),
        device.userCode,
      );
      const exchange = await driver.exchangeDevice(device.deviceCode);
      expect(exchange.kind).toBe("activated");
      if (exchange.kind !== "activated") throw new Error("expected activation");
      await driver.revokeDevice(exchange.token.deviceId);
      const revoked = await db.query<{ status: string }>(
        "SELECT status FROM devices WHERE id=$1",
        [exchange.token.deviceId],
      );
      expect(revoked.rows[0]?.status).toBe("REVOKED");

      const canceled = await driver.startDevice({
        browserFamily: "firefox",
        extensionVersion: "1.0.0",
      });
      await driver.cancelDevice(canceled.authorizationId, canceled.userCode);
      expect(await driver.exchangeDevice(canceled.deviceCode)).toEqual({
        kind: "closed",
        code: "DEVICE_AUTH_CLOSED",
      });

      // Only this request is born in the past; ordinary approval must use current time.
      // The repository expires it through its real clock and unchanged product TTL.
      deviceNow = new Date("2020-01-01T00:00:00.000Z");
      const expired = await driver.startDevice({
        browserFamily: "chrome",
        extensionVersion: "1.0.0",
      });
      expect(
        await createDeviceAuthorizationRepository(db).expireDue(
          100,
          "isolated-auth-expiry-test",
        ),
      ).toBe(1);
      expect(
        await driver.observeExpiredDevice(expired, new Date(expired.expiresAt)),
      ).toEqual({ kind: "closed", code: "DEVICE_AUTH_CLOSED" });
      await driver.logout();

      const keys = exchangeCalls
        .filter((call) => call.deviceCode === device.deviceCode)
        .map((call) => call.key);
      expect(keys.length).toBeGreaterThan(1);
      expect(new Set(keys).size).toBe(1);
    });
  },
);
