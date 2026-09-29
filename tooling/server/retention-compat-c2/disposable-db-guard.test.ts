import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertBRetentionCompatDisposableDatabaseUrl,
  B_RETENTION_COMPAT_DISPOSABLE_DATABASE,
} from "./disposable-db-guard.ts";

describe("c2 retention compatibility disposable database guard", () => {
  it("accepts only the role-owned B disposable database identity", () => {
    expect(B_RETENTION_COMPAT_DISPOSABLE_DATABASE).toEqual({
      port: "15542",
      role: "octoport_test",
      database: "octoport_b_test",
    });
    expect(
      assertBRetentionCompatDisposableDatabaseUrl(
        "postgresql://octoport_test:fixture@127.0.0.1:15542/octoport_b_test",
      ),
    ).toBe(
      "postgresql://octoport_test:fixture@127.0.0.1:15542/octoport_b_test",
    );
    expect(
      assertBRetentionCompatDisposableDatabaseUrl(
        "postgresql://octoport_test:fixture@localhost:15542/octoport_b_test",
      ),
    ).toContain("localhost:15542/octoport_b_test");
  });

  it.each([
    ["missing", undefined, "DATABASE_URL_REQUIRED"],
    ["blank", "   ", "DATABASE_URL_REQUIRED"],
    ["invalid", "not-a-url", "DATABASE_URL_INVALID"],
    [
      "wrong scheme",
      "https://octoport_test:fixture@127.0.0.1:15542/octoport_b_test",
      "DATABASE_URL_SCHEME_INVALID",
    ],
    [
      "non-loopback",
      "postgresql://octoport_test:fixture@10.0.0.8:15542/octoport_b_test",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
    [
      "monitor pilot",
      "postgresql://monitor_role:fixture@127.0.0.1:5432/octoport_monitor_pilot",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
    [
      "product-shaped database",
      "postgresql://octoport_test:fixture@127.0.0.1:15542/octoport_product",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
    [
      "wrong B port",
      "postgresql://octoport_test:fixture@127.0.0.1:5432/octoport_b_test",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
    [
      "wrong role",
      "postgresql://product_role:fixture@127.0.0.1:15542/octoport_b_test",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
    [
      "URL options",
      "postgresql://octoport_test:fixture@127.0.0.1:15542/octoport_b_test?sslmode=require",
      "DATABASE_URL_NOT_B_DISPOSABLE",
    ],
  ])("rejects %s identity before setup", (_name, value, code) => {
    expect(() => assertBRetentionCompatDisposableDatabaseUrl(value)).toThrow(
      code,
    );
  });

  it("runs the executable identity guard before runtime creation and DROP SCHEMA", () => {
    const source = readFileSync(new URL("./setup.ts", import.meta.url), "utf8");
    const guard = source.indexOf(
      "const connectionString = assertBRetentionCompatDisposableDatabaseUrl(",
    );
    const runtime = source.indexOf(
      "const runtime = createDatabaseRuntime(connectionString);",
    );
    const destructive = source.indexOf(
      'await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");',
    );

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(runtime).toBeGreaterThan(guard);
    expect(destructive).toBeGreaterThan(runtime);
  });
});
