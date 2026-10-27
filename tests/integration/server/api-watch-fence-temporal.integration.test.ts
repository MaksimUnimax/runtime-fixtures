import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "@product/db";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

// This is a disposable-PG integration test only. It does not touch live DB.
// The migration adds 0062 to public in the allowlisted isolated test database;
// adversarial rows are confined to an independent schema and removed afterward.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const connection = new URL(connectionString);
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
