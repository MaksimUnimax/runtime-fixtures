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

  it("upgrades the observed 22-entry owner-test prefix to current0051 without losing rows", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    const directory = await mkdtemp(join(tmpdir(), "octoport-prefix22-"));
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as {
        entries: Array<{ tag: string; when: number }>;
      };
      const currentCount = journal.entries.length;
      const currentLatest = journal.entries.at(-1);
      expect(currentCount).toBe(40);
      expect(currentLatest).toMatchObject({
        tag: "0051_firefox_privacy_neutral_device_metadata",
        when: 1790071018000,
      });

      const prefix = { ...journal, entries: journal.entries.slice(0, 22) };
      await mkdir(join(directory, "meta"));
      await writeFile(
        join(directory, "meta/_journal.json"),
        JSON.stringify(prefix),
      );
      for (const entry of prefix.entries)
        await cp(
          join(migrationsFolder, entry.tag + ".sql"),
          join(directory, entry.tag + ".sql"),
        );

      await runMigrations({ connectionString, migrationsDirectory: directory });
      const id = "10000000-0000-4000-8000-000000000022";
      await runtime.query("INSERT INTO users(id) VALUES($1)", [id]);

      const before = await runtime.query<{
        hash: string;
        created_at: string;
      }>(
        "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
      );
      expect(before.rows).toHaveLength(22);

      await runMigrations({ connectionString });

      expect(
        (await runtime.query("SELECT id FROM users WHERE id=$1", [id])).rows,
      ).toEqual([{ id }]);
      expect(
        (
          await runtime.query(
            "SELECT count(*)::int AS count,max(created_at)::text AS latest FROM drizzle.__drizzle_migrations",
          )
        ).rows,
      ).toEqual([{ count: 40, latest: "1790071018000" }]);
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('swagger_source_requests')::text AS name",
          )
        ).rows[0]?.name,
      ).toBe("swagger_source_requests");
      expect(
        (
          await runtime.query(
            "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='devices' AND column_name='browser_family'",
          )
        ).rows,
      ).toEqual([{ is_nullable: "YES" }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      ).toEqual([{ count: 40 }]);
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
  it("rejects untracked application objects before creating migration history", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    await runtime.query("CREATE TABLE untracked_probe(id integer PRIMARY KEY)");
    try {
      await expect(runMigrations({ connectionString })).rejects.toThrow(
        "MIGRATION_HISTORY_UNTRACKED",
      );
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
          )
        ).rows[0]?.name,
      ).toBeNull();
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('public.untracked_probe')::text AS name",
          )
        ).rows[0]?.name,
      ).toBe("untracked_probe");
    } finally {
      await runtime.query(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
      );
    }
  });

  it("rejects an untracked enum-only schema before creating migration history", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    await runtime.query("CREATE TYPE untracked_state AS ENUM ('ACTIVE')");
    try {
      await expect(runMigrations({ connectionString })).rejects.toThrow(
        "MIGRATION_HISTORY_UNTRACKED",
      );
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
          )
        ).rows[0]?.name,
      ).toBeNull();
      expect(
        (
          await runtime.query(
            "SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='untracked_state') AS present",
          )
        ).rows[0]?.present,
      ).toBe(true);
    } finally {
      await runtime.query(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
      );
    }
  });

  it("rejects an untracked function-only schema before creating migration history", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    await runtime.query(
      "CREATE FUNCTION untracked_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    );
    try {
      await expect(runMigrations({ connectionString })).rejects.toThrow(
        "MIGRATION_HISTORY_UNTRACKED",
      );
      expect(
        (
          await runtime.query(
            "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name",
          )
        ).rows[0]?.name,
      ).toBeNull();
      expect(
        (
          await runtime.query(
            "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='untracked_probe') AS present",
          )
        ).rows[0]?.present,
      ).toBe(true);
    } finally {
      await runtime.query(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
      );
    }
  });

  it("rejects the observed historical hybrid lineage without mutating it", async () => {
    await runtime.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
    );
    const root = await mkdtemp(join(tmpdir(), "octoport-hybrid-"));
    const legacyDirectory = join(root, "legacy");
    const productDirectory = join(root, "product");
    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      ) as {
        version: string;
        dialect: string;
        entries: Array<{
          idx: number;
          version: string;
          when: number;
          tag: string;
          breakpoints: boolean;
        }>;
      };
      const writeJournal = async (
        directory: string,
        entries: typeof journal.entries,
      ) => {
        await mkdir(join(directory, "meta"), { recursive: true });
        await writeFile(
          join(directory, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries }),
        );
      };
      const productPrefix = journal.entries.slice(0, 17);
      const scheduler = journal.entries.find(
        (entry) => entry.tag === "0034_s2_l6_durable_health_scheduler",
      );
      if (!scheduler) throw new Error("canonical scheduler migration missing");
      const legacyScheduler = {
        ...scheduler,
        idx: 17,
        when: 1789395000000,
        tag: "0017_s2_l6_durable_health_scheduler",
      };

      await writeJournal(legacyDirectory, [...productPrefix, legacyScheduler]);
      for (const entry of productPrefix) {
        await cp(
          join(migrationsFolder, entry.tag + ".sql"),
          join(legacyDirectory, entry.tag + ".sql"),
        );
      }
      await cp(
        join(migrationsFolder, scheduler.tag + ".sql"),
        join(legacyDirectory, legacyScheduler.tag + ".sql"),
      );
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(runtime.db, { migrationsFolder: legacyDirectory });

      const productWithI1AndTransfer = journal.entries.slice(0, 19);
      await writeJournal(productDirectory, productWithI1AndTransfer);
      for (const entry of productWithI1AndTransfer) {
        await cp(
          join(migrationsFolder, entry.tag + ".sql"),
          join(productDirectory, entry.tag + ".sql"),
        );
      }
      await migrate(runtime.db, { migrationsFolder: productDirectory });

      const id = "10000000-0000-4000-8000-000000000002";
      await runtime.query("INSERT INTO users(id) VALUES($1)", [id]);
      const before = (
        await runtime.query(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
        )
      ).rows;
      expect(before).toHaveLength(20);

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
        (await runtime.query("SELECT id FROM users WHERE id=$1", [id])).rows,
      ).toEqual([{ id }]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await runtime.query(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public",
      );
    }
  });
});
