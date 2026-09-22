import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { migrationsFolder, runMigrations } from "./migrations.js";
import type { DatabaseRuntime } from "./index.js";

function createRuntime(
  close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
): DatabaseRuntime {
  return {
    db: {} as DatabaseRuntime["db"],
    ready: vi.fn(),
    close,
    query: vi.fn(),
    transaction: vi.fn(),
  };
}

describe("runMigrations", () => {
  it("uses the supplied Drizzle migrator with the deterministic migration directory and closes on success", async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const runtime = createRuntime(close);
    const migrator = vi.fn().mockResolvedValue(undefined);

    await runMigrations({
      connectionString: "postgres://example.invalid/test",
      createRuntime: () => runtime,
      migrator,
    });

    expect(migrator).toHaveBeenCalledWith(runtime.db, { migrationsFolder });
    expect(close).toHaveBeenCalledOnce();
    expect(migrationsFolder).toMatch(/packages\/server\/db\/drizzle$/);
  });

  it("closes resources and propagates migration failures", async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const runtime = createRuntime(close);
    const failure = new Error("migration failed");

    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toThrow(failure);

    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves a migration failure when resource cleanup also fails", async () => {
    const runtime = createRuntime(
      vi.fn<() => Promise<void>>().mockRejectedValue(new Error("close failed")),
    );
    const failure = new Error("migration failed");

    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toThrow(failure);
  });
});

describe("Stream-2 migration receipts", () => {
  it("keeps TG2 and TG3 migrations forward-only and journaled", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0024_s2_tg3_operator_swagger_handoff.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(sql).toContain('CREATE TABLE "swagger_source_requests"');
    expect(sql).toContain('CREATE TABLE "swagger_source_artifacts"');
    expect(sql).toContain("OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE");
    expect(journal.entries.at(-5)?.tag).toBe("0023_s2_tg2_monitoring_lanes");
    expect(journal.entries.at(-4)?.tag).toBe(
      "0024_s2_tg3_operator_swagger_handoff",
    );
  });

  it("receipts the forward-only A1/A2/A3 migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0025_s2_api_watch_authority_snapshots.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_authority_records"');
    expect(sql).toContain('CREATE TABLE "api_watch_snapshots"');
    expect(sql).toContain('CREATE TABLE "api_watch_inventories"');
    expect(journal.entries.at(-3)?.tag).toBe(
      "0025_s2_api_watch_authority_snapshots",
    );
  });

  it("receipts the forward-only A4 semantic diff migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0026_s2_api_watch_semantic_diffs.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_semantic_diffs"');
    expect(sql).toContain('CREATE TABLE "api_watch_semantic_diff_operations"');
    expect(journal.entries.at(-2)?.tag).toBe(
      "0026_s2_api_watch_semantic_diffs",
    );
  });

  it("receipts the forward-only A6 report migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0027_s2_api_watch_reports.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_reports"');
    expect(sql).toContain('CREATE TABLE "api_watch_report_sources"');
    expect(journal.entries.at(-1)?.tag).toBe("0027_s2_api_watch_reports");
  });
});
