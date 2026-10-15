import { randomUUID } from "node:crypto";
import type { DatabaseRuntime } from "../../../../packages/server/db/src/index.js";

// Exact unqualified public-table names observed in the existing C06-compatible
// test fixture resets (17 C tests, DB maintenance and the B-owned source).
// Deny migration journals, other schemas and every non-fixture table.
const APPROVED_TRUNCATE_TARGETS = new Set([
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
  "beta_identity_invitations",
  "billing_events",
  "billing_reconciliation_jobs",
  "checkout_intents",
  "compatibility_policy_blocked_versions",
  "compatibility_policy_revisions",
  "config_release_compatibility_policies",
  "config_release_feature_rules",
  "config_release_rollout_revisions",
  "config_releases",
  "device_authorizations",
  "devices",
  "entitlement_definitions",
  "extension_release_browsers",
  "extension_release_contracts",
  "extension_releases",
  "feature_definitions",
  "feature_rule_revisions",
  "otp_challenges",
  "otp_email_jobs",
  "payments",
  "plan_entitlements",
  "plan_revisions",
  "plans",
  "portal_sessions",
  "price_revisions",
  "price_sale_assignments",
  "prices",
  "refresh_tokens",
  "rollouts",
  "sessions",
  "signing_key_events",
  "signing_keys",
  "subscription_transitions",
  "subscriptions",
  "user_identities",
  "users",
]);

// Full transitive public-table closure observed for the approved targets on
// canonical journal 50. The catalog is re-evaluated before every reset: a new
// referencing table, or any cross-schema dependency, fails closed until this
// list is explicitly reviewed and updated.
const APPROVED_CASCADE_TABLES = new Set([
  "account_entitlement_overrides",
  "account_memberships",
  "accounts",
  "adapter_profile_assignment_revisions",
  "adapter_profile_assignments",
  "adapter_profile_revisions",
  "adapter_profiles",
  "admin_maintenance_grants",
  "admin_principals",
  "admin_role_grants",
  "admin_sessions",
  "ai_adapters",
  "ai_prompt_tree_heads",
  "ai_prompt_tree_publications",
  "ai_surfaces",
  "ai_variants",
  "audit_events",
  "auth_rate_limit_buckets",
  "beta_admission_mutations",
  "beta_admission_state",
  "beta_admissions",
  "beta_identity_invitations",
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
  "feedback_signal_events",
  "health_contour_results",
  "health_evidence_references",
  "health_incidents",
  "health_no_session_evidence_references",
  "health_no_session_observations",
  "health_no_session_run_receipts",
  "health_notification_intents",
  "health_profile_evaluations",
  "health_runs",
  "health_scheduled_runs",
  "monitor_profile_repair_bindings",
  "monitor_profile_repair_decisions",
  "monitor_profile_repair_operations",
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
const TRUNCATE_FIXTURE_SQL =
  /^TRUNCATE ([a-z_][a-z0-9_]*(?:, ?[a-z_][a-z0-9_]*)*)(?: RESTART IDENTITY)? CASCADE$/i;

function allowedTestDatabase(name: string): boolean {
  if (name === "octoport_c_test") return true;
  // Only GitHub's explicitly declared Server CI disposable PostgreSQL is
  // additional to the role-owned C test database. Never admit A, B or Tester.
  return (
    name === "product_control_plane_test" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_REPOSITORY === "MaksimUnimax/runtime-fixtures" &&
    process.env.CI === "true"
  );
}

/**
 * Authorize an existing destructive integration-test fixture reset through the
 * REAL migration 0060 epoch fence. No triggers are disabled, grants changed,
 * or product paths mocked. Only an isolated, directly authenticated superuser
 * on an allowlisted disposable test database may invoke this test-only helper.
 */
export async function resetTransferProtectedTestFixture(
  database: Pick<DatabaseRuntime, "transaction">,
  truncateSql: string,
): Promise<void> {
  const statement = truncateSql.trim().replace(/\s+/g, " ");
  const matched = TRUNCATE_FIXTURE_SQL.exec(statement);
  const targets = matched?.[1]
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    !targets ||
    targets.length > APPROVED_TRUNCATE_TARGETS.size ||
    new Set(targets).size !== targets.length ||
    targets.some((name) => !APPROVED_TRUNCATE_TARGETS.has(name))
  ) {
    throw new Error("TRANSFER_FIXTURE_RESET_SQL_NOT_ALLOWED");
  }
  await database.transaction(async (tx) => {
    const identity = await tx.query<{
      database_name: string;
      direct_session: boolean;
      is_superuser: boolean;
    }>(`SELECT current_database() AS database_name,
       current_user=session_user AS direct_session,
       (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser`);
    const caller = identity.rows[0];
    if (
      identity.rows.length !== 1 ||
      !caller ||
      !allowedTestDatabase(caller.database_name) ||
      caller.direct_session !== true ||
      caller.is_superuser !== true
    ) {
      throw new Error("TRANSFER_FIXTURE_RESET_DATABASE_OR_ROLE_DENIED");
    }
    // Resolve all approved unqualified fixture names against the canonical
    // public schema even if the caller arrived with a custom search_path.
    await tx.query("SET LOCAL search_path=public,pg_temp");
    const cascadeClosure = await tx.query<{
      schema_name: string;
      table_name: string;
    }>(
      `WITH RECURSIVE closure(oid) AS (
         SELECT c.oid
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public'
           AND c.relkind IN ('r','p')
           AND c.relname=ANY($1::text[])
         UNION
         SELECT edge.oid
         FROM closure parent
         JOIN LATERAL (
           SELECT con.conrelid AS oid
           FROM pg_catalog.pg_constraint con
           WHERE con.confrelid=parent.oid AND con.contype='f'
           UNION
           SELECT inh.inhrelid AS oid
           FROM pg_catalog.pg_inherits inh
           WHERE inh.inhparent=parent.oid
         ) edge ON true
       )
       SELECT n.nspname AS schema_name,c.relname AS table_name
       FROM closure x
       JOIN pg_catalog.pg_class c ON c.oid=x.oid
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       ORDER BY n.nspname,c.relname`,
      [targets],
    );
    const closureNames = new Set(
      cascadeClosure.rows
        .filter((row) => row.schema_name === "public")
        .map((row) => row.table_name),
    );
    if (
      targets.some((name) => !closureNames.has(name)) ||
      cascadeClosure.rows.some(
        (row) =>
          row.schema_name !== "public" ||
          !APPROVED_CASCADE_TABLES.has(row.table_name),
      )
    ) {
      throw new Error("TRANSFER_FIXTURE_RESET_CASCADE_SCOPE_DENIED");
    }
    const trigger = await tx.query<{ guard_enabled: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_trigger t
         WHERE t.tgrelid='public.credential_transfer_requests'::regclass
           AND t.tgname='credential_transfer_epoch_guard'
           AND t.tgenabled='A'
           AND NOT t.tgisinternal
       ) AS guard_enabled`,
    );
    if (trigger.rows.length !== 1 || trigger.rows[0]?.guard_enabled !== true) {
      throw new Error("TRANSFER_FIXTURE_RESET_GUARD_NOT_ACTIVE");
    }
    const instance = randomUUID();
    const claims = await tx.query<{
      epoch: string;
      owner_instance_id: string;
    }>(
      "SELECT epoch::text,owner_instance_id::text FROM octoport_transfer_fence.claim_writer($1::uuid)",
      [instance],
    );
    const claim = claims.rows[0];
    if (
      claims.rows.length !== 1 ||
      !claim ||
      claim.owner_instance_id !== instance ||
      !/^[1-9][0-9]*$/.test(claim.epoch)
    ) {
      throw new Error("TRANSFER_FIXTURE_RESET_CLAIM_INVALID");
    }
    const authorizations = await tx.query<{
      epoch: string;
      owner_instance_id: string;
    }>(
      "SELECT epoch::text,owner_instance_id::text FROM octoport_transfer_fence.authorize_writer($1::bigint,$2::uuid)",
      [claim.epoch, instance],
    );
    if (
      authorizations.rows.length !== 1 ||
      authorizations.rows[0]?.epoch !== claim.epoch ||
      authorizations.rows[0]?.owner_instance_id !== instance
    ) {
      throw new Error("TRANSFER_FIXTURE_RESET_AUTHORIZATION_INVALID");
    }
    // This TRUNCATE still fires the installed ENABLE ALWAYS guard in this same
    // transaction. On failure the whole claim and reset roll back together.
    await tx.query(statement);
  });
}
