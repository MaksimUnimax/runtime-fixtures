import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "health-alice-h3.spec.ts",
    "health-standard-h3.spec.ts",
    "health-work-h3.spec.ts",
    "health-dedicated-session.spec.ts",
    "health-h2.spec.ts",
  ],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
