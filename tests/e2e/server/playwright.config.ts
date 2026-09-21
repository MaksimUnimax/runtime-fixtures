import { defineConfig } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";

const serverWorkspaceCwd = resolve(__dirname, "../../..");
const e2eApiPort = process.env.E2E_API_PORT ?? "3100";
const e2ePortalPort = process.env.E2E_PORTAL_PORT ?? "3200";
const e2eAdminPort = process.env.E2E_ADMIN_PORT ?? "3300";

// Per-run only: the private half is passed to the disposable API process via
// its environment and is never persisted or exposed by the test API.
const e2eConfigSigningPairs =
  process.env.TEST_WORKER_INDEX === undefined
    ? [
        { keyId: "e2e-config-k1", pair: generateKeyPairSync("ed25519") },
        { keyId: "e2e-config-k2", pair: generateKeyPairSync("ed25519") },
      ]
    : [];
const e2eConfigSigningRingJson =
  e2eConfigSigningPairs.length > 0
    ? JSON.stringify({
        version: 1,
        keys: e2eConfigSigningPairs.map(({ keyId, pair }) => ({
          keyId,
          privateKeyPemB64: Buffer.from(
            pair.privateKey.export({ format: "pem", type: "pkcs8" }),
          ).toString("base64"),
        })),
      })
    : undefined;
// Workers receive only public verification material; the private ring exists
// solely in the disposable API web-server process environment.
if (e2eConfigSigningPairs.length > 0) {
  process.env.CONFIG_SIGNING_PUBLIC_KEY_RING_JSON = JSON.stringify(
    e2eConfigSigningPairs.map(({ keyId, pair }) => ({
      keyId,
      publicKeySpkiDerB64: pair.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    })),
  );
}
if (process.env.CONFIG_SIGNING_PUBLIC_KEY_RING_JSON === undefined)
  throw new Error(
    "CONFIG_SIGNING_PUBLIC_KEY_RING_JSON is unavailable for this Playwright run",
  );

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "line",
  globalSetup: "./support/global-setup.ts",
  webServer: [
    {
      cwd: serverWorkspaceCwd,
      command:
        "pnpm db:migrate && pnpm --filter @product/api exec tsx ../../tests/e2e/server/support/api-harness.ts",
      url: `http://127.0.0.1:${e2eApiPort}/health/ready`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PRODUCT_CONTROL_PLANE_E2E: "1",
        NODE_ENV: "test",
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        API_PORT: e2eApiPort,
        LOG_LEVEL: "warn",
        ...(e2eConfigSigningRingJson
          ? { CONFIG_SIGNING_KEY_RING_JSON: e2eConfigSigningRingJson }
          : {}),
      },
    },
    {
      cwd: serverWorkspaceCwd,
      command: `pnpm --filter @product/portal exec next dev --hostname 127.0.0.1 --port ${e2ePortalPort}`,
      url: `http://127.0.0.1:${e2ePortalPort}/login`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${e2eApiPort}`,
      },
    },
    {
      cwd: serverWorkspaceCwd,
      command: `pnpm --filter @product/admin exec next dev --hostname 127.0.0.1 --port ${e2eAdminPort}`,
      url: `http://127.0.0.1:${e2eAdminPort}/login`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        CONTROL_PLANE_API_ORIGIN: `http://127.0.0.1:${e2eApiPort}`,
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${e2ePortalPort}`,
    browserName: "chromium",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
