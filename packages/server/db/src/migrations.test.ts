import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertMigrationHistory,
  migrationsFolder,
  runMigrations,
} from "./migrations.js";
import type { DatabaseRuntime } from "./index.js";

function createRuntime(
  close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
): DatabaseRuntime {
  return {
    db: {} as DatabaseRuntime["db"],
    ready: vi.fn(),
    close,
    query: vi.fn().mockResolvedValue({ rows: [{ relation: null }] }),
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
      join(migrationsFolder, "0039_s2_tg3_operator_swagger_handoff.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(sql).toContain('CREATE TABLE "swagger_source_requests"');
    expect(sql).toContain('CREATE TABLE "swagger_source_artifacts"');
    expect(sql).toContain("OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE");
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0038_s2_tg2_monitoring_lanes",
      )?.tag,
    ).toBe("0038_s2_tg2_monitoring_lanes");
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0039_s2_tg3_operator_swagger_handoff",
      )?.tag,
    ).toBe("0039_s2_tg3_operator_swagger_handoff");
  });

  it("receipts the forward-only A1/A2/A3 migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0040_s2_api_watch_authority_snapshots.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_authority_records"');
    expect(sql).toContain('CREATE TABLE "api_watch_snapshots"');
    expect(sql).toContain('CREATE TABLE "api_watch_inventories"');
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0040_s2_api_watch_authority_snapshots",
      )?.tag,
    ).toBe("0040_s2_api_watch_authority_snapshots");
  });

  it("receipts the forward-only A4 semantic diff migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0041_s2_api_watch_semantic_diffs.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_semantic_diffs"');
    expect(sql).toContain('CREATE TABLE "api_watch_semantic_diff_operations"');
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0041_s2_api_watch_semantic_diffs",
      )?.tag,
    ).toBe("0041_s2_api_watch_semantic_diffs");
  });

  it("receipts the forward-only A6 report migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0042_s2_api_watch_reports.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_reports"');
    expect(sql).toContain('CREATE TABLE "api_watch_report_sources"');
    expect(
      journal.entries.find((entry) => entry.tag === "0042_s2_api_watch_reports")
        ?.tag,
    ).toBe("0042_s2_api_watch_reports");
  });

  it("receipts the forward-only A7 product crosswalk migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0043_s2_api_watch_product_crosswalk.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_product_crosswalk"');
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0043_s2_api_watch_product_crosswalk",
      )?.tag,
    ).toBe("0043_s2_api_watch_product_crosswalk");
  });

  it("receipts the forward-only A8 incident migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0044_s2_api_watch_incidents.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_incidents"');
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0044_s2_api_watch_incidents",
      )?.tag,
    ).toBe("0044_s2_api_watch_incidents");
  });

  it("receipts the forward-only A9 retry migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0045_s2_api_watch_retry_state.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_retry_state"');
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0045_s2_api_watch_retry_state",
      )?.tag,
    ).toBe("0045_s2_api_watch_retry_state");
  });

  it("receipts the forward-only multi-document source migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0046_s2_api_watch_source_documents.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('CREATE TABLE "api_watch_source_documents"');
    expect(sql).toContain('ADD COLUMN "document_key"');
    expect(sql).toContain(
      'ALTER TABLE "api_watch_snapshots" ADD COLUMN "document_key"',
    );
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0046_s2_api_watch_source_documents",
      )?.tag,
    ).toBe("0046_s2_api_watch_source_documents");
  });

  it("receipts the forward-only WB bundle request migration", async () => {
    const sql = await readFile(
      join(migrationsFolder, "0047_s2_wb_bundle_handoff.sql"),
      "utf8",
    );
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(sql).toContain('ADD COLUMN "bundle_version"');
    expect(
      journal.entries.find((entry) => entry.tag === "0047_s2_wb_bundle_handoff")
        ?.tag,
    ).toBe("0047_s2_wb_bundle_handoff");
  });
});

describe("migration lineage guard", () => {
  it("rejects another branch before invoking the migrator and still closes the connection", async () => {
    const runtime = createRuntime();
    runtime.query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ relation: "drizzle.__drizzle_migrations" }],
      })
      .mockResolvedValueOnce({
        rows: [{ hash: "different-lineage", created_at: "1" }],
      });
    const migrator = vi.fn();
    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator,
      }),
    ).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");
    expect(migrator).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });
  it("rejects an existing application schema when the migration ledger is missing", async () => {
    const runtime = createRuntime();
    runtime.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ relation: null }] })
      .mockResolvedValueOnce({ rows: [{ has_objects: true }] });
    const migrator = vi.fn();

    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator,
      }),
    ).rejects.toThrow("MIGRATION_HISTORY_UNTRACKED");

    expect(migrator).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("rejects an existing application schema when the migration ledger is empty", async () => {
    const runtime = createRuntime();
    runtime.query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ relation: "drizzle.__drizzle_migrations" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ has_objects: true }] });
    const migrator = vi.fn();

    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator,
      }),
    ).rejects.toThrow("MIGRATION_HISTORY_UNTRACKED");

    expect(migrator).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("rejects the observed legacy Stream-2 hybrid sequence before invoking the migrator", async () => {
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const canonical = readMigrationFiles({ migrationsFolder });
    const scheduler = canonical.find(
      (migration) => migration.folderMillis === 1790071001000,
    );
    expect(scheduler).toBeDefined();
    const hybrid = [
      ...canonical.slice(0, 17).map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
      {
        hash: scheduler!.hash,
        created_at: "1789395000000",
      },
      ...canonical.slice(17, 19).map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    ];
    const runtime = createRuntime();
    runtime.query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ relation: "drizzle.__drizzle_migrations" }],
      })
      .mockResolvedValueOnce({ rows: hybrid });
    const migrator = vi.fn();
    await expect(
      runMigrations({
        connectionString: "postgres://example.invalid/test",
        createRuntime: () => runtime,
        migrator,
      }),
    ).rejects.toThrow("MIGRATION_HISTORY_DIVERGED");

    expect(migrator).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("accepts an exact prefix of the canonical migration history", async () => {
    const { readMigrationFiles } = await import("drizzle-orm/migrator");
    const prefix = readMigrationFiles({ migrationsFolder }).slice(0, 23);
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ relation: "drizzle.__drizzle_migrations" }],
      })
      .mockResolvedValueOnce({
        rows: prefix.map((m) => ({
          hash: m.hash,
          created_at: String(m.folderMillis),
        })),
      });
    await expect(
      assertMigrationHistory({ query }, migrationsFolder),
    ).resolves.toBeUndefined();
  });
});
