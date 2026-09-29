import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabaseRuntime } from "../../../packages/server/db/src/index.ts";
import {
  migrationsFolder,
  runMigrations,
} from "../../../packages/server/db/src/migrations.ts";
import { initializeMonitorPilotAuthorityForTest } from "../monitor-pilot-authority.ts";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  process.env.VITEST = "true";
  const runtime = createDatabaseRuntime(connectionString);
  await runtime.ready();
  const directory = await mkdtemp(join(tmpdir(), "b-compat-0052-"));
  try {
    await cp(migrationsFolder, directory, { recursive: true });
    await rm(join(directory, "0053_monitor_profile_repair_admission.sql"), {
      force: true,
    });
    await rm(join(directory, "0054_api_watch_product_baselines.sql"), {
      force: true,
    });
    const journalPath = join(directory, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: unknown[];
    };
    journal.entries = journal.entries.slice(0, 41);
    await writeFile(journalPath, JSON.stringify(journal, null, 2) + "\n");
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({
      connectionString,
      migrationsDirectory: directory,
    });
    const identity = await runtime.query<{
      databaseName: string;
      databaseRole: string;
    }>(
      'SELECT current_database() AS "databaseName",current_user AS "databaseRole"',
    );
    await initializeMonitorPilotAuthorityForTest(runtime, {
      expectedDatabaseName: identity.rows[0]!.databaseName,
      expectedDatabaseRole: identity.rows[0]!.databaseRole,
    });
    const state = await runtime.query<Record<string, string | null>>(`SELECT
    (SELECT count(*)::text FROM drizzle."__drizzle_migrations") AS migrations,
    to_regclass('health_no_session_run_receipts')::text AS receipts,
    to_regclass('monitor_profile_repair_bindings')::text AS repair,
    to_regclass('api_watch_product_baselines')::text AS "apiBaseline"`);
    console.log(
      "SETUP_RESULT=" +
        JSON.stringify({
          ...state.rows[0],
          databaseName: identity.rows[0]!.databaseName,
          databaseRole: identity.rows[0]!.databaseRole,
        }),
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
