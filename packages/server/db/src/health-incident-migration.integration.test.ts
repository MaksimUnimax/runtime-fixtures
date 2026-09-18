import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./index.js";
import { migrationsFolder, runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const runtime = createDatabaseRuntime(connectionString);
const ids = {
  adapter: "b8000000-0000-4000-8000-000000000001",
  surface: "b8000000-0000-4000-8000-000000000002",
  profile: "b8000000-0000-4000-8000-000000000003",
  profileRevision: "b8000000-0000-4000-8000-000000000004",
  suite: "b8000000-0000-4000-8000-000000000005",
  run: "b8000000-0000-4000-8000-000000000006",
  incident: "b8000000-0000-4000-8000-000000000007",
};

async function reset(): Promise<void> {
  await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
  await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runtime.query("CREATE SCHEMA public");
}

async function installOldJournal(): Promise<string> {
  const directory = await mkdtemp("/tmp/s2l6-old-migrations-");
  const entries = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const oldEntries = entries.entries.slice(0, 18);
  await mkdir(join(directory, "meta"));
  await writeFile(
    join(directory, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: oldEntries,
    }),
  );
  for (const file of await readdir(migrationsFolder)) {
    if (file.endsWith(".sql") && !file.startsWith("0020_")) {
      await cp(join(migrationsFolder, file), join(directory, file));
    }
  }
  await runMigrations({
    connectionString: connectionString!,
    migrationsDirectory: directory,
  });
  return directory;
}

async function seedOldIncident(duplicate = false): Promise<void> {
  await runtime.query(
    `INSERT INTO ai_adapters(id,machine_key,display_name) VALUES($1,'migration_fixture','Migration fixture')`,
    [ids.adapter],
  );
  await runtime.query(
    `INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES($1,$2,'migration_surface','Migration surface')`,
    [ids.surface, ids.adapter],
  );
  await runtime.query(
    `INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES($1,$2,$3,'migration_profile','Migration profile')`,
    [ids.profile, ids.adapter, ids.surface],
  );
  await runtime.query(
    `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,revision,schema_version,state,content,compatibility_constraints,content_sha256) VALUES($1,$2,$3,$4,1,'adapter_profile_v1','DRAFT','{}'::jsonb,'{}'::jsonb,$5)`,
    [
      ids.profileRevision,
      ids.profile,
      ids.adapter,
      ids.surface,
      "0".repeat(64),
    ],
  );
  await runtime.query(
    `INSERT INTO health_suite_revisions(id,machine_key,revision,suite_kind,definition,definition_sha256) VALUES($1,'migration_fixture',1,'BASELINE_CONTRACT_FIXTURE','{}'::jsonb,$2)`,
    [ids.suite, "0".repeat(64)],
  );
  const scope = {
    adapterFamilyId: ids.adapter,
    adapterFamilyKey: "migration_fixture",
    surfaceId: ids.surface,
    surfaceKey: "migration_surface",
    variant: null,
    browserFamily: "chrome",
    browserVersion: "120.0",
    extensionVersion: "1.0.0",
    adapterEngineVersion: "1.0.0",
    profile: { id: ids.profile, revision: 1 },
    healthSuite: { machineKey: "migration_fixture", revision: 1 },
  };
  await runtime.query(
    `INSERT INTO health_runs(id,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,started_at,completed_at) VALUES($1,$2,$3,$4,NULL,$5,$6,1,'chrome','120.0','1.0.0','1.0.0','H3','BROKEN','migration-fixture-v1',$7::jsonb,$8,false,$9,$10)`,
    [
      ids.run,
      ids.suite,
      ids.adapter,
      ids.surface,
      ids.profile,
      ids.profileRevision,
      JSON.stringify(scope),
      "1".repeat(64),
      new Date("2026-09-18T00:00:00Z"),
      new Date("2026-09-18T00:00:01Z"),
    ],
  );
  const insert = `INSERT INTO health_incidents(scope_sha256,status,first_seen_run_id,latest_seen_run_id,root_contour_key,first_seen_at,last_seen_at) VALUES($1,'OPEN',$2,$2,'C05_SEND_CONTROL',$3,$3)`;
  await runtime.query(insert, [
    "1".repeat(64),
    ids.run,
    new Date("2026-09-18T00:00:01Z"),
  ]);
  if (duplicate) {
    await runtime.query(insert, [
      "1".repeat(64),
      ids.run,
      new Date("2026-09-18T00:00:01Z"),
    ]);
  }
}

describe.sequential("S2-L6 incident migration safety", () => {
  beforeAll(() => runtime.ready());
  afterAll(() => runtime.close());

  it("preserves an old-schema incident and its run FKs", async () => {
    await reset();
    const oldDirectory = await installOldJournal();
    try {
      await seedOldIncident();
      await runMigrations({ connectionString });
      const result = await runtime.query<{
        status: string;
        firstSeenRunId: string;
        latestSeenRunId: string;
        resolvedAt: Date | null;
      }>(
        `SELECT status,first_seen_run_id AS "firstSeenRunId",latest_seen_run_id AS "latestSeenRunId",resolved_at AS "resolvedAt" FROM health_incidents WHERE id=$1`,
        [ids.incident],
      );
      // The fixture uses the old default-generated id; identify the only row.
      const row = await runtime.query<{
        status: string;
        firstSeenRunId: string;
        latestSeenRunId: string;
        resolvedAt: Date | null;
      }>(
        `SELECT status,first_seen_run_id AS "firstSeenRunId",latest_seen_run_id AS "latestSeenRunId",resolved_at AS "resolvedAt" FROM health_incidents`,
      );
      expect(result.rows).toHaveLength(0);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]).toMatchObject({
        status: "OPEN",
        firstSeenRunId: ids.run,
        latestSeenRunId: ids.run,
        resolvedAt: null,
      });
      expect(
        await runtime.query(`SELECT count(*)::int AS count FROM health_runs`),
      ).toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await rm(oldDirectory, { recursive: true, force: true });
    }
  });

  it("fails safely when pre-lifecycle active duplicates would violate the new authority", async () => {
    await reset();
    const oldDirectory = await installOldJournal();
    try {
      await seedOldIncident(true);
      await expect(runMigrations({ connectionString })).rejects.toThrow();
    } finally {
      await rm(oldDirectory, { recursive: true, force: true });
    }
  });
});
