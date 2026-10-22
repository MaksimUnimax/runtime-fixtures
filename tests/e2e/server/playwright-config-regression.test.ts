import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import shippedPlaywrightConfig from "./playwright.config.js";

const webServers = Array.isArray(shippedPlaywrightConfig.webServer)
  ? shippedPlaywrightConfig.webServer
  : shippedPlaywrightConfig.webServer
    ? [shippedPlaywrightConfig.webServer]
    : [];
const migrationServer = webServers.find((server) =>
  server.command.includes("pnpm db:migrate"),
);
const workspaceCwd = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

it("keeps the shipped Playwright migration command at the workspace root", () => {
  expect(migrationServer).toBeDefined();
  expect(migrationServer?.cwd).toBe(workspaceCwd);
  expect(existsSync(resolve(workspaceCwd, "package.json"))).toBe(true);

  const packageJson = JSON.parse(
    readFileSync(resolve(workspaceCwd, "package.json"), "utf8"),
  ) as { scripts?: { [name: string]: string } };
  expect(packageJson.scripts?.["db:migrate"]).toBe(
    "pnpm --filter @product/db db:migrate",
  );
  expect(
    webServers.filter((server) => server.command.includes("db:migrate")),
  ).toHaveLength(1);
  expect(webServers.every((server) => server.cwd === workspaceCwd)).toBe(true);
  expect(webServers.some((server) => /\bcd\b/.test(server.command))).toBe(
    false,
  );

  console.log("PLAYWRIGHT_DB_MIGRATE_CWD_HAS_PACKAGE_MANIFEST = YES");
  console.log("PLAYWRIGHT_DB_MIGRATE_SCRIPT_RESOLVES = YES");
  console.log("TEMPORARY_CWD_CORRECTION_REQUIRED = NO");
});

it("makes startup diagnostics attributable without loosening E2E readiness", () => {
  expect(webServers).toHaveLength(3);
  expect(webServers.map((server) => server.name)).toEqual([
    "e2e-api",
    "e2e-portal",
    "e2e-admin",
  ]);
  expect(webServers.every((server) => server.stdout === "pipe")).toBe(true);
  expect(webServers.every((server) => server.timeout === 60_000)).toBe(true);
  expect(
    webServers.every((server) => server.reuseExistingServer === false),
  ).toBe(true);
});
