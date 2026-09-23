import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./index.js";
import { migrationsFolder, runMigrations } from "./migrations.js";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const runtime = createDatabaseRuntime(connectionString);
describe.sequential("canonical product and monitoring migration intake", () => {
  beforeAll(() => runtime.ready());
  afterAll(() => runtime.close());
  it("upgrades the preserved 23-entry product prefix without losing rows", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    const directory = await mkdtemp(join(tmpdir(), "octoport-prefix-"));
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as { entries: Array<{ tag: string }> };
      journal.entries = journal.entries.slice(0, 23);
      await mkdir(join(directory, "meta"));
      await writeFile(
        join(directory, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      for (const entry of journal.entries)
        await cp(
          join(migrationsFolder, entry.tag + ".sql"),
          join(directory, entry.tag + ".sql"),
        );
      await runMigrations({ connectionString, migrationsDirectory: directory });
      const id = "10000000-0000-4000-8000-000000000001";
      await runtime.query("INSERT INTO users(id) VALUES($1)", [id]);
      await runMigrations({ connectionString });
      expect(
        (await runtime.query("SELECT id FROM users WHERE id=$1", [id])).rows,
      ).toEqual([{ id }]);
      expect(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
          )
        ).rows,
      ).toEqual([{ count: 38 }]);
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('swagger_source_requests')::text AS name",
          )
        ).rows[0]?.name,
      ).toBe("swagger_source_requests");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects divergent applied history before changing schema or migration rows", async () => {
    await runtime.query(
      "UPDATE drizzle.__drizzle_migrations SET hash='legacy-stream2-history' WHERE id=(SELECT max(id) FROM drizzle.__drizzle_migrations)",
    );
    const before = (
      await runtime.query(
        "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    try {
      await expect(runMigrations({ connectionString })).rejects.toThrow(
        "MIGRATION_HISTORY_DIVERGED",
      );
      expect(
        (
          await runtime.query(
            "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
          )
        ).rows,
      ).toEqual(before);
      expect(
        (await runtime.query("SELECT count(*)::int AS count FROM users")).rows,
      ).toEqual([{ count: 1 }]);
    } finally {
      await runtime.query(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
      );
    }
  });
});
