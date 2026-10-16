import { resetTransferProtectedTestFixture } from "./helpers/credential-transfer-fixture-reset.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is required for P2.7 PostgreSQL audit tests.");

let db: DatabaseRuntime;

describe.sequential("P2.7 transactional security audit regressions", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(url!);
    await db.ready();
    await runMigrations({ connectionString: url! });
  });
  beforeEach(async () => {
    await resetTransferProtectedTestFixture(
      db,
      "TRUNCATE audit_events,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
    );
  });
  afterAll(async () => db.close());

  it("AUD-P2-001 rolls back portal logout when the required audit insert fails", async () => {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      lookup = "p2-7-hash";
    await db.query("INSERT INTO users(id) VALUES($1)", [userId]);
    await db.query(
      "INSERT INTO portal_sessions(id,user_id,session_token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [sessionId, userId, lookup],
    );
    await db.query(`CREATE OR REPLACE FUNCTION p2_7_fail_logout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'PORTAL_SESSION_REVOKED' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END;
    $$`);
    await db.query(`CREATE TRIGGER p2_7_fail_logout_audit BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION p2_7_fail_logout_audit()`);
    try {
      await expect(
        createAuthRepository(db).revoke(lookup, "p2-7-forced-audit-failure"),
      ).rejects.toThrow("forced audit failure");
      expect(
        (
          await db.query<{
            revoked_at: Date | null;
            revoke_reason: string | null;
          }>(
            "SELECT revoked_at,revoke_reason FROM portal_sessions WHERE id=$1",
            [sessionId],
          )
        ).rows[0],
      ).toMatchObject({ revoked_at: null, revoke_reason: null });
      expect(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM audit_events WHERE action='PORTAL_SESSION_REVOKED' AND target_id=$1",
            [sessionId],
          )
        ).rows[0]?.count,
      ).toBe("0");
    } finally {
      await db.query(
        "DROP TRIGGER IF EXISTS p2_7_fail_logout_audit ON audit_events",
      );
      await db.query("DROP FUNCTION IF EXISTS p2_7_fail_logout_audit()");
    }
  });
});
