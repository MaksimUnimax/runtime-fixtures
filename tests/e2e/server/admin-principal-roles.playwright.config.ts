import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Isolated UI regression run: no API harness, database reset or portal server.
// The same spec also runs under the full server Playwright configuration.
const adminPort = process.env.E2E_ADMIN_PORT ?? "3432";
process.env.E2E_ADMIN_PORT = adminPort;

export default defineConfig({
  testDir: ".",
  testMatch: ["admin-principal-roles.spec.ts", "admin-b14-safety.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 240_000,
  reporter: "line",
  webServer: {
    cwd: resolve(__dirname, "../../.."),
    command: `pnpm --filter @product/admin exec next dev --hostname 127.0.0.1 --port ${adminPort}`,
    url: `http://127.0.0.1:${adminPort}/principals`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_ADMIN_BASE_PATH: "",
      CONTROL_PLANE_API_ORIGIN: "http://127.0.0.1:1",
      DATABASE_URL: "",
    },
  },
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
    ...(process.env.E2E_CHROMIUM_EXECUTABLE_PATH
      ? {
          launchOptions: {
            executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH,
          },
        }
      : {}),
  },
});
