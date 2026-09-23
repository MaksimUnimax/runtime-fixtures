import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";
import type * as schema from "./schema.js";

export const migrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

export type DatabaseMigrator = (
  database: NodePgDatabase<typeof schema>,
  config: MigrationConfig,
) => Promise<void>;

export interface RunMigrationsOptions {
  connectionString: string;
  createRuntime?: (connectionString: string) => DatabaseRuntime;
  migrator?: DatabaseMigrator;
  migrationsDirectory?: string;
}

async function assertNoUntrackedApplicationObjects(
  runtime: Pick<DatabaseRuntime, "query">,
): Promise<void> {
  const objects = await runtime.query<{ has_objects: boolean }>(
    "SELECT EXISTS (" +
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
      "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') " +
      "UNION ALL " +
      "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace " +
      "WHERE n.nspname='public' " +
      "UNION ALL " +
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace " +
      "WHERE n.nspname='public'" +
      ") AS has_objects",
  );
  if (objects.rows[0]?.has_objects) {
    throw new Error(
      "MIGRATION_HISTORY_UNTRACKED; existing application objects require explicit reconciliation",
    );
  }
}

/** Reject a different migration lineage before Drizzle can silently skip older timestamps. */
export async function assertMigrationHistory(
  runtime: Pick<DatabaseRuntime, "query">,
  directory: string,
): Promise<void> {
  const exists = await runtime.query<{ relation: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
  );
  if (!exists.rows[0]?.relation) {
    await assertNoUntrackedApplicationObjects(runtime);
    return;
  }
  const applied = await runtime.query<{ hash: string; created_at: string }>(
    "SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
  );
  if (applied.rows.length === 0) {
    await assertNoUntrackedApplicationObjects(runtime);
    return;
  }
  const expected = readMigrationFiles({ migrationsFolder: directory });
  for (const [index, row] of applied.rows.entries()) {
    const migration = expected[index];
    if (
      !migration ||
      row.hash !== migration.hash ||
      row.created_at !== String(migration.folderMillis)
    ) {
      throw new Error(
        `MIGRATION_HISTORY_DIVERGED at applied position ${index}; reconcile this database lineage before migration`,
      );
    }
  }
}

export async function runMigrations({
  connectionString,
  createRuntime = createDatabaseRuntime,
  migrator = drizzleMigrate,
  migrationsDirectory = migrationsFolder,
}: RunMigrationsOptions): Promise<void> {
  const runtime = createRuntime(connectionString);
  let migrationFailure: unknown;
  try {
    await assertMigrationHistory(runtime, migrationsDirectory);
    await migrator(runtime.db, { migrationsFolder: migrationsDirectory });
  } catch (error) {
    migrationFailure = error;
  }

  try {
    await runtime.close();
  } catch (closeError) {
    if (migrationFailure === undefined) throw closeError;
  }

  if (migrationFailure !== undefined) throw migrationFailure;
}
