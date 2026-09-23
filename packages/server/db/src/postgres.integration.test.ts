import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserFamilies } from "@product/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime, type DatabaseRuntime } from "./index.js";
import { migrationsFolder, runMigrations } from "./migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required for pnpm test:integration (real PostgreSQL is not optional).",
  );
}

let runtime: DatabaseRuntime;
let p1Directory: string | undefined;

async function resetDatabase(): Promise<void> {
  await runtime.db.execute(sql`DROP SCHEMA public CASCADE`);
  await runtime.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await runtime.db.execute(sql`CREATE SCHEMA public`);
}

async function rejects(statement: ReturnType<typeof sql>): Promise<void> {
  await expect(runtime.db.execute(statement)).rejects.toBeInstanceOf(Error);
}

async function tables(): Promise<string[]> {
  const result = await runtime.db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  return result.rows.map((row) => row.table_name);
}

describe.sequential("P2.1 PostgreSQL persistence integration", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString);
    await runtime.ready();
    p1Directory = await mkdtemp(join(tmpdir(), "p2-1-p1-"));
    await cp(
      join(migrationsFolder, "0000_p1_migration_probe.sql"),
      join(p1Directory, "0000_p1_migration_probe.sql"),
    );
    await mkdir(join(p1Directory, "meta"));
    await writeFile(
      join(p1Directory, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: 1770000000000,
            tag: "0000_p1_migration_probe",
            breakpoints: true,
          },
        ],
      }),
    );
  });

  afterAll(async () => {
    await runtime.close();
    if (p1Directory) await rm(p1Directory, { recursive: true });
  });

  it("migrates empty through P3.3, leaves no P1 probe, and is idempotent", async () => {
    await resetDatabase();
    await runMigrations({ connectionString });
    await runMigrations({ connectionString });
    expect(await tables()).toEqual([
      "account_entitlement_overrides",
      "account_memberships",
      "accounts",
      "adapter_profile_assignment_revisions",
      "adapter_profile_assignments",
      "adapter_profile_revisions",
      "adapter_profiles",
      "admin_principals",
      "admin_role_grants",
      "admin_sessions",
      "ai_adapters",
      "ai_surfaces",
      "ai_variants",
      "audit_events",
      "auth_rate_limit_buckets",
      "beta_admission_mutations",
      "beta_admission_state",
      "beta_admissions",
      "billing_events",
      "billing_reconciliation_jobs",
      "checkout_intents",
      "compatibility_policy_blocked_versions",
      "compatibility_policy_revisions",
      "config_release_compatibility_policies",
      "config_release_feature_rules",
      "config_release_rollout_revisions",
      "config_releases",
      "credential_transfer_requests",
      "device_authorizations",
      "devices",
      "entitlement_definitions",
      "extension_release_browsers",
      "extension_release_contracts",
      "extension_releases",
      "feature_definitions",
      "feature_rule_revisions",
      "feedback_cases",
      "feedback_followups",
      "feedback_retention_config",
      "feedback_signal_events",
      "health_contour_results",
      "health_evidence_references",
      "health_incidents",
      "health_runs",
      "health_suite_revisions",
      "otp_challenges",
      "otp_email_jobs",
      "otp_verify_replays",
      "payments",
      "plan_entitlements",
      "plan_revisions",
      "plans",
      "portal_sessions",
      "price_revisions",
      "price_sale_assignments",
      "prices",
      "refresh_tokens",
      "rollout_revisions",
      "rollouts",
      "sessions",
      "signing_key_events",
      "signing_keys",
      "subscription_transitions",
      "subscriptions",
      "sync_entities",
      "sync_request_receipts",
      "user_identities",
      "users",
    ]);
    const count = await runtime.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS "count" FROM drizzle."__drizzle_migrations"
    `);
    expect(count.rows[0]?.count).toBe("23");
    const browserFamilyRows = await runtime.db.execute<{
      enumlabel: string;
    }>(sql`
      SELECT enum_value.enumlabel
      FROM pg_enum AS enum_value
      INNER JOIN pg_type AS enum_type ON enum_type.oid = enum_value.enumtypid
      INNER JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
      WHERE namespace.nspname = 'public' AND enum_type.typname = 'browser_family'
      ORDER BY enum_value.enumsortorder
    `);
    expect(browserFamilyRows.rows.map((row) => row.enumlabel).sort()).toEqual(
      [...BrowserFamilies].sort(),
    );
    const browserConstraintRows = await runtime.db.execute<{
      conname: string;
      definition: string;
    }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'adapter_profile_assignments_browser_family',
        'health_runs_browser_family'
      )
      ORDER BY conname
    `);
    expect(browserConstraintRows.rows).toHaveLength(2);
    for (const row of browserConstraintRows.rows) {
      for (const family of BrowserFamilies) {
        expect(row.definition).toContain(family);
      }
    }
    const probe = await runtime.db.execute<{ probe: string | null }>(sql`
      SELECT to_regclass('__p1_migration_probe') AS "probe"
    `);
    expect(probe.rows[0]?.probe).toBeNull();
  });

  it("enforces unique hashes, lifecycle checks, foreign keys, and no plaintext secret columns", async () => {
    await runtime.db.execute(
      sql`INSERT INTO users (id) VALUES ('00000000-0000-0000-0000-000000000001')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO accounts (id) VALUES ('00000000-0000-0000-0000-000000000002')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO user_identities (id, user_id, provider, normalized_identifier) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'EMAIL', 'person@example.test')`,
    );
    await rejects(
      sql`INSERT INTO user_identities (user_id, provider, normalized_identifier) VALUES ('00000000-0000-0000-0000-000000000001', 'EMAIL', 'person@example.test')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO portal_sessions (id, user_id, session_token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'portal-hash-a', now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO portal_sessions (user_id, session_token_hash, expires_at) VALUES ('00000000-0000-0000-0000-000000000001', 'portal-hash-a', now() + interval '1 day')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO device_authorizations (id, device_code_hash, user_code_hash, requested_client_type, browser_family, expires_at) VALUES ('00000000-0000-0000-0000-000000000005', 'device-hash-a', 'user-hash-a', 'browser_extension', 'chrome', now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO device_authorizations (device_code_hash, user_code_hash, requested_client_type, browser_family, expires_at) VALUES ('device-hash-a', 'user-hash-b', 'browser_extension', 'chrome', now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO otp_challenges (purpose, normalized_identity_target, verification_hash, attempt_count, max_attempts, expires_at) VALUES ('LOGIN', 'person@example.test', 'otp-hash-a', 2, 1, now() + interval '1 day')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO devices (id, account_id, created_by_user_id, browser_family) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'chrome')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO sessions (id, device_id, account_id, token_family_id) VALUES ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000008')`,
    );
    await rejects(
      sql`INSERT INTO sessions (device_id, account_id, token_family_id) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000008')`,
    );
    await runtime.db.execute(
      sql`INSERT INTO refresh_tokens (id, session_id, token_hash, generation, expires_at) VALUES ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000007', 'refresh-hash-a', 0, now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO refresh_tokens (session_id, token_hash, generation, expires_at) VALUES ('00000000-0000-0000-0000-000000000007', 'refresh-hash-a', 1, now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO refresh_tokens (session_id, token_hash, generation, expires_at) VALUES ('00000000-0000-0000-0000-000000000007', 'refresh-hash-b', -1, now() + interval '1 day')`,
    );
    await rejects(
      sql`INSERT INTO devices (account_id, created_by_user_id, browser_family) VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000001', 'chrome')`,
    );
    await rejects(
      sql`INSERT INTO refresh_tokens (session_id, token_hash, generation, expires_at) VALUES ('00000000-0000-0000-0000-000000000099', 'refresh-hash-c', 1, now() + interval '1 day')`,
    );
    const secretColumns = await runtime.db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
      AND column_name IN ('otp', 'otp_code', 'device_code', 'user_code', 'refresh_token', 'session_token', 'access_token', 'password')
    `);
    expect(secretColumns.rows).toEqual([]);
  });

  it("migrates the accepted P1 state forward to P2.1", async () => {
    await resetDatabase();
    await runMigrations({ connectionString, migrationsDirectory: p1Directory });
    await runMigrations({ connectionString });
    expect(await tables()).toContain("refresh_tokens");
  });
});
