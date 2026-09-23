import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /health-(h2|standard-h3|dedicated-session)\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
