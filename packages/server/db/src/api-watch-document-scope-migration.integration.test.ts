import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";
import { migrationsFolder, runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

let runtime: DatabaseRuntime;
let prefix0054Directory = "";

async function resetDatabase() {
  await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
  await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await runtime.query("CREATE SCHEMA public");
}

async function makePrefix0054Directory() {
  prefix0054Directory = await mkdtemp(
    join(tmpdir(), "api-watch-document-scope-0054-"),
  );
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
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
  expect(journal.entries.at(-1)?.tag).toBe(
    "0055_api_watch_document_scope_persistence",
  );
  const prefix = {
    ...journal,
    entries: journal.entries.slice(0, -1),
  };
  await mkdir(join(prefix0054Directory, "meta"), { recursive: true });
  await writeFile(
    join(prefix0054Directory, "meta", "_journal.json"),
    JSON.stringify(prefix, null, 2) + "\n",
  );
  for (const entry of prefix.entries)
    await cp(
      join(migrationsFolder, entry.tag + ".sql"),
      join(prefix0054Directory, entry.tag + ".sql"),
    );
}

async function seedReport(reportId: string) {
  await runtime.query(
    `INSERT INTO api_watch_reports(report_id,run_source,created_at,state)
     VALUES($1,'SCHEDULED','2026-09-29T09:35:00.000Z','COMPLETED')`,
    [reportId],
  );
}

async function insertCrosswalk(input: {
  id: string;
  reportId: string;
  documentKey?: string | null;
}) {
  const documentKey = input.documentKey ?? null;
  await runtime.query(
    `INSERT INTO api_watch_product_crosswalk(
       crosswalk_id,report_id,source_family,source_identity,runtime_alias,
       crosswalk_state,review_state,execution_enabled,impact_severity,
       diff_sha256,created_at,document_key
     ) VALUES(
       $1,$2,'WILDBERRIES','GET:/api/v3/orders',NULL,
       'SOURCE_ONLY','REVIEW_REQUIRED',NULL,'REVIEW_REQUIRED',
       $3,'2026-09-29T09:35:01.000Z',$4
     )`,
    [input.id, input.reportId, "a".repeat(64), documentKey],
  );
}

async function insertIncident(input: {
  id: string;
  key: string;
  reportId: string;
  documentKey?: string | null;
}) {
  const documentKey = input.documentKey ?? null;
  await runtime.query(
    `INSERT INTO api_watch_incidents(
       incident_id,incident_key,incident_type,source_family,operation_identity,
       first_seen_at,last_seen_at,resolved_at,occurrence_count,severity,
       latest_report_id,latest_diff_sha256,safe_summary_code,state,document_key
     ) VALUES(
       $1,$2,'API_CHANGE_REVIEW_REQUIRED','WILDBERRIES','GET:/api/v3/orders',
       '2026-09-29T09:35:02.000Z','2026-09-29T09:35:02.000Z',NULL,1,
       'REVIEW_REQUIRED',$3,$4,'API_CHANGE_REVIEW_REQUIRED','OPEN',$5
     )`,
    [input.id, input.key, input.reportId, "b".repeat(64), documentKey],
  );
}

async function documentColumns() {
  return runtime.query<{
    table_name: string;
    is_nullable: string;
    data_type: string;
    character_maximum_length: number;
  }>(
    `SELECT table_name,is_nullable,data_type,character_maximum_length
       FROM information_schema.columns
      WHERE table_schema='public'
        AND column_name='document_key'
        AND table_name IN ('api_watch_product_crosswalk','api_watch_incidents')
      ORDER BY table_name`,
  );
}

describe.sequential("API-watch document scope migration 0055", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString);
    await runtime.ready();
    await makePrefix0054Directory();
  });

  afterAll(async () => {
    await runtime.close();
    if (prefix0054Directory)
      await rm(prefix0054Directory, { recursive: true, force: true });
  });

  it("fresh migration exposes nullable document scope and round-trips explicit keys", async () => {
    await resetDatabase();
    await runMigrations({ connectionString });

    const migrationCount = await runtime.query<{
      count: string;
      latest: string;
    }>(
      `SELECT count(*)::text AS count,max(created_at)::text AS latest
         FROM drizzle."__drizzle_migrations"`,
    );
    expect(migrationCount.rows).toEqual([
      { count: "44", latest: "1790674500000" },
    ]);

    expect((await documentColumns()).rows).toEqual([
      {
        table_name: "api_watch_incidents",
        is_nullable: "YES",
        data_type: "character varying",
        character_maximum_length: 128,
      },
      {
        table_name: "api_watch_product_crosswalk",
        is_nullable: "YES",
        data_type: "character varying",
        character_maximum_length: 128,
      },
    ]);

    await seedReport("report-fresh-document");
    await insertCrosswalk({
      id: "crosswalk-fresh-document",
      reportId: "report-fresh-document",
      documentKey: "wb-content-v3",
    });
    await insertIncident({
      id: "incident-fresh-document",
      key: "API_CHANGE_REVIEW_REQUIRED:WILDBERRIES:GET:/api/v3/orders:wb-content-v3",
      reportId: "report-fresh-document",
      documentKey: "wb-content-v3",
    });

    const rows = await runtime.query<{
      crosswalk_document_key: string | null;
      incident_document_key: string | null;
    }>(
      `SELECT
         (SELECT document_key FROM api_watch_product_crosswalk
           WHERE crosswalk_id='crosswalk-fresh-document') AS crosswalk_document_key,
         (SELECT document_key FROM api_watch_incidents
           WHERE incident_id='incident-fresh-document') AS incident_document_key`,
    );
    expect(rows.rows).toEqual([
      {
        crosswalk_document_key: "wb-content-v3",
        incident_document_key: "wb-content-v3",
      },
    ]);

    await expect(
      runtime.query(
        `UPDATE api_watch_product_crosswalk
            SET document_key='   '
          WHERE crosswalk_id='crosswalk-fresh-document'`,
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      runtime.query(
        `UPDATE api_watch_incidents
            SET document_key=''
          WHERE incident_id='incident-fresh-document'`,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("upgrades exact canonical 0054 prefix preserving legacy NULL and accepting explicit scope", async () => {
    await resetDatabase();
    await runMigrations({
      connectionString,
      migrationsDirectory: prefix0054Directory,
    });

    expect(
      (
        await runtime.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM drizzle."__drizzle_migrations"`,
        )
      ).rows,
    ).toEqual([{ count: "43" }]);
    expect((await documentColumns()).rows).toEqual([]);

    await seedReport("report-legacy-document");
    await runtime.query(
      `INSERT INTO api_watch_product_crosswalk(
         crosswalk_id,report_id,source_family,source_identity,runtime_alias,
         crosswalk_state,review_state,execution_enabled,impact_severity,
         diff_sha256,created_at
       ) VALUES(
         'crosswalk-legacy-document','report-legacy-document','WILDBERRIES',
         'GET:/api/v3/orders',NULL,'SOURCE_ONLY','REVIEW_REQUIRED',NULL,
         'REVIEW_REQUIRED',$1,'2026-09-29T09:35:03.000Z'
       )`,
      ["c".repeat(64)],
    );
    await runtime.query(
      `INSERT INTO api_watch_incidents(
         incident_id,incident_key,incident_type,source_family,operation_identity,
         first_seen_at,last_seen_at,resolved_at,occurrence_count,severity,
         latest_report_id,latest_diff_sha256,safe_summary_code,state
       ) VALUES(
         'incident-legacy-document',
         'API_CHANGE_REVIEW_REQUIRED:WILDBERRIES:GET:/api/v3/orders',
         'API_CHANGE_REVIEW_REQUIRED','WILDBERRIES','GET:/api/v3/orders',
         '2026-09-29T09:35:04.000Z','2026-09-29T09:35:04.000Z',NULL,1,
         'REVIEW_REQUIRED','report-legacy-document',$1,
         'API_CHANGE_REVIEW_REQUIRED','OPEN'
       )`,
      ["d".repeat(64)],
    );

    await runMigrations({ connectionString });

    const legacy = await runtime.query<{
      crosswalk_document_key: string | null;
      incident_document_key: string | null;
    }>(
      `SELECT
         (SELECT document_key FROM api_watch_product_crosswalk
           WHERE crosswalk_id='crosswalk-legacy-document') AS crosswalk_document_key,
         (SELECT document_key FROM api_watch_incidents
           WHERE incident_id='incident-legacy-document') AS incident_document_key`,
    );
    expect(legacy.rows).toEqual([
      { crosswalk_document_key: null, incident_document_key: null },
    ]);

    await insertCrosswalk({
      id: "crosswalk-upgraded-document",
      reportId: "report-legacy-document",
      documentKey: "wb-content-v3",
    });
    await insertIncident({
      id: "incident-upgraded-document",
      key: "API_CHANGE_BLOCKING:WILDBERRIES:GET:/api/v3/orders:wb-content-v3",
      reportId: "report-legacy-document",
      documentKey: "wb-content-v3",
    });

    const scoped = await runtime.query<{
      crosswalk_document_key: string | null;
      incident_document_key: string | null;
    }>(
      `SELECT
         (SELECT document_key FROM api_watch_product_crosswalk
           WHERE crosswalk_id='crosswalk-upgraded-document') AS crosswalk_document_key,
         (SELECT document_key FROM api_watch_incidents
           WHERE incident_id='incident-upgraded-document') AS incident_document_key`,
    );
    expect(scoped.rows).toEqual([
      {
        crosswalk_document_key: "wb-content-v3",
        incident_document_key: "wb-content-v3",
      },
    ]);

    expect(
      (
        await runtime.query<{ count: string; latest: string }>(
          `SELECT count(*)::text AS count,max(created_at)::text AS latest
             FROM drizzle."__drizzle_migrations"`,
        )
      ).rows,
    ).toEqual([{ count: "44", latest: "1790674500000" }]);
  });
});
