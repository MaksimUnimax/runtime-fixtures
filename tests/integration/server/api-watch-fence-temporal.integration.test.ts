import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import {
  migrationsFolder,
  runMigrations,
} from "../../../packages/server/db/src/migrations.js";

// This is a disposable-PG integration test only. It does not touch live DB.
// The migration adds 0062 to public in the allowlisted isolated test database;
// adversarial rows are confined to an independent schema and removed afterward.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
function assertUnambiguousDisposablePgUrl(url: URL): void {
  // node-postgres may honor URI query parameters that override host,
  // database, port or libpq options. Reject the whole query surface before
  // opening any PG connection, rather than trusting URL.hostname alone.
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("C03_RETRY_FENCE_DISPOSABLE_URI_OVERRIDE_FORBIDDEN");
}
const connection = new URL(connectionString);
assertUnambiguousDisposablePgUrl(connection);
const allowed = new Set([
  "product_control_plane_test",
  "octoport_a_test",
  "octoport_b_test",
  "octoport_c_test",
]);
const dbName = decodeURIComponent(connection.pathname.slice(1));
if (
  !["localhost", "127.0.0.1"].includes(connection.hostname) ||
  !allowed.has(dbName)
)
  throw new Error("C03_RETRY_FENCE_DISPOSABLE_DATABASE_REQUIRED");

const schema = "c03_fence_" + randomUUID().replaceAll("-", "");
const runtime = createDatabaseRuntime(connectionString);
const runId = "11111111-1111-4111-8111-111111111111";
const epoch = new Date("2026-10-26T00:00:00.000Z").getTime();
const at = (seconds: number) => new Date(epoch + 1000 * seconds);
let created = false;

async function insertEntered(
  family: "WILDBERRIES" | "OZON_SELLER" | "OZON_PERFORMANCE",
  enteredAt: Date,
  leaseExpiresAt: Date | null = at(900),
) {
  return runtime.query(
    `INSERT INTO "${schema}".api_watch_family_attempt_fences
      (source_family, claim_stage, claimed_run_id,
       claimed_at, claimed_lease_expires_at, entered_at, updated_at)
     VALUES ($1, 'ENTERED', $2, $3, $4, $5, $6)`,
    [family, runId, at(1), leaseExpiresAt, enteredAt, at(902)],
  );
}

/**
 * Execute the UNMODIFIED 0062 SQL statements physically inside a fresh
 * schema containing only the legacy columns read by this migration.
 * This is a migration backfill/quarantine proof, not a live DB upgrade.
 */
async function proveLegacy0062(input: {
  pendingRetry: boolean;
  activeSwaggerRun: boolean;
}) {
  const scratch = "c03_upgrade_" + randomUUID().replaceAll("-", "");
  let created = false;
  try {
    await runtime.query(`CREATE SCHEMA "${scratch}"`);
    created = true;
    await runtime.query(
      `CREATE TABLE "${scratch}".monitoring_lane_schedules (
        lane varchar(16) PRIMARY KEY,
        next_run_at timestamp with time zone NOT NULL,
        active_run_id uuid
      )`,
    );
    await runtime.query(
      `CREATE TABLE "${scratch}".api_watch_retry_state (
        source_family varchar(32) PRIMARY KEY,
        next_retry_at timestamp with time zone
      )`,
    );
    await runtime.query(
      `INSERT INTO "${scratch}".monitoring_lane_schedules
       (lane,next_run_at,active_run_id) VALUES ('SWAGGER_API',$1,$2)`,
      [at(600), input.activeSwaggerRun ? runId : null],
    );
    await runtime.query(
      `INSERT INTO "${scratch}".api_watch_retry_state
       (source_family,next_retry_at) VALUES ('OZON_SELLER',$1)`,
      [input.pendingRetry ? at(120) : null],
    );

    const original = await readFile(
      join(migrationsFolder, "0062_api_watch_retry_provenance_fence.sql"),
      "utf8",
    );
    const statements = original
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean);
    if (statements.length !== 6)
      throw new Error("C03_0062_STATEMENT_COUNT_MISMATCH");

    // SET LOCAL belongs to THIS transaction only; it cannot leak a modified
    // search_path to the shared Pg pool when the transaction ends.
    await runtime.transaction(async (tx) => {
      await tx.query(`SET LOCAL search_path TO "${scratch}"`);
      for (const statement of statements) await tx.query(statement);
    });

    const fences = await runtime.query<{
      source_family: string;
      claim_stage: string;
      outcome_unknown: boolean;
      claimed_run_id: string | null;
    }>(
      `SELECT source_family,claim_stage,outcome_unknown,claimed_run_id
       FROM "${scratch}".api_watch_family_attempt_fences
       ORDER BY source_family`,
    );
    const schedules = await runtime.query<{
      next_run_at: Date;
      ordinary_next_run_at: Date | null;
      ordinary_due_provenance: string;
      active_run_id: string | null;
    }>(
      `SELECT next_run_at,ordinary_next_run_at,ordinary_due_provenance,active_run_id
       FROM "${scratch}".monitoring_lane_schedules WHERE lane='SWAGGER_API'`,
    );
    const retries = await runtime.query<{ next_retry_at: Date | null }>(
      `SELECT next_retry_at FROM "${scratch}".api_watch_retry_state
       WHERE source_family='OZON_SELLER'`,
    );
    return {
      fences: fences.rows,
      schedule: schedules.rows[0],
      retry: retries.rows[0],
    };
  } finally {
    if (created) await runtime.query(`DROP SCHEMA "${scratch}" CASCADE`);
  }
}

describe.sequential(
  "C03 physical PostgreSQL 0062 ENTERED lease constraint",
  () => {
    beforeAll(async () => {
      await runtime.ready();
      const identity = await runtime.query<{ db: string }>(
        "SELECT current_database() AS db",
      );
      if (identity.rows[0]?.db !== dbName)
        throw new Error("C03_RETRY_FENCE_DB_IDENTITY_MISMATCH");
      await runMigrations({ connectionString });
      const actual = await runtime.query<{ reg: string | null }>(
        "SELECT to_regclass('public.api_watch_family_attempt_fences')::text AS reg",
      );
      if (actual.rows[0]?.reg !== "api_watch_family_attempt_fences")
        throw new Error("C03_RETRY_FENCE_0062_MIGRATION_NOT_PRESENT");
      await runtime.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await runtime.query(
        `CREATE TABLE "${schema}".api_watch_family_attempt_fences
       (LIKE public.api_watch_family_attempt_fences INCLUDING ALL)`,
      );
    }, 120000);

    afterAll(async () => {
      try {
        if (created) await runtime.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await runtime.close();
      }
    });

    it.each([
      "host=remote.test",
      "port=6432",
      "dbname=production",
      "options=-csearch_path=public",
      "service=external",
    ])(
      "rejects driver URL override %s before opening PostgreSQL",
      (override) => {
        const unsafe = new URL(connectionString);
        unsafe.search = "?" + override;
        expect(() => assertUnambiguousDisposablePgUrl(unsafe)).toThrow(
          "C03_RETRY_FENCE_DISPOSABLE_URI_OVERRIDE_FORBIDDEN",
        );
      },
    );

    it("physically quarantines only pending legacy family retry without fabricating ordinary due", async () => {
      const upgraded = await proveLegacy0062({
        pendingRetry: true,
        activeSwaggerRun: false,
      });
      expect(upgraded.fences).toEqual([
        {
          source_family: "OZON_PERFORMANCE",
          claim_stage: "IDLE",
          outcome_unknown: false,
          claimed_run_id: null,
        },
        {
          source_family: "OZON_SELLER",
          claim_stage: "IDLE",
          outcome_unknown: true,
          claimed_run_id: null,
        },
        {
          source_family: "WILDBERRIES",
          claim_stage: "IDLE",
          outcome_unknown: false,
          claimed_run_id: null,
        },
      ]);
      expect(upgraded.schedule?.next_run_at).toEqual(at(600));
      expect(upgraded.schedule?.ordinary_next_run_at).toBeNull();
      expect(upgraded.schedule?.ordinary_due_provenance).toBe("UNKNOWN");
      expect(upgraded.schedule?.active_run_id).toBeNull();
      expect(upgraded.retry?.next_retry_at).toEqual(at(120));
    });

    it("physically quarantines every source family when a legacy Swagger run is in-flight", async () => {
      const upgraded = await proveLegacy0062({
        pendingRetry: false,
        activeSwaggerRun: true,
      });
      expect(upgraded.fences).toEqual([
        {
          source_family: "OZON_PERFORMANCE",
          claim_stage: "IDLE",
          outcome_unknown: true,
          claimed_run_id: null,
        },
        {
          source_family: "OZON_SELLER",
          claim_stage: "IDLE",
          outcome_unknown: true,
          claimed_run_id: null,
        },
        {
          source_family: "WILDBERRIES",
          claim_stage: "IDLE",
          outcome_unknown: true,
          claimed_run_id: null,
        },
      ]);
      expect(upgraded.schedule?.next_run_at).toEqual(at(600));
      expect(upgraded.schedule?.ordinary_next_run_at).toBeNull();
      expect(upgraded.schedule?.ordinary_due_provenance).toBe("UNKNOWN");
      expect(upgraded.schedule?.active_run_id).toBe(runId);
      expect(upgraded.retry?.next_retry_at).toBeNull();
    });

    it("accepts a real ENTERED time strictly before its persisted lease expiry", async () => {
      const inserted = await insertEntered("WILDBERRIES", at(899));
      expect(inserted.rows).toEqual([]);
      const confirmed = await runtime.query<{ entered_at: Date }>(
        `SELECT entered_at FROM "${schema}".api_watch_family_attempt_fences
       WHERE source_family = 'WILDBERRIES'`,
      );
      expect(confirmed.rows).toHaveLength(1);
      expect(confirmed.rows[0]?.entered_at).toEqual(at(899));
    });

    it.each([900, 901])(
      "rejects ENTERED at %i seconds: at or after claimed lease expiry",
      async (seconds) => {
        await expect(
          insertEntered("OZON_SELLER", at(seconds)),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "api_watch_family_claim_temporal_order_check",
        });
      },
    );

    it("rejects ENTERED with a missing lease, including SQL three-valued NULL", async () => {
      await expect(
        insertEntered("OZON_PERFORMANCE", at(2), null),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "api_watch_family_claim_stage_check",
      });
    });
  },
);
