import { randomUUID } from "node:crypto";
import {
  assertCredentialTransferFenceRuntime,
  createCredentialTransferEpochFence,
  createDatabaseRuntime,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";

/** Disposable, empty shadow tables only. Never changes product rows or grants. */
export async function proveCredentialTransferSchemaResolution(
  connectionString: string,
  expectedDatabase: Parameters<typeof createCredentialTransferTestAuthority>[1],
) {
  const administrator = createDatabaseRuntime(connectionString);
  const schema = `c06_r12_shadow_${randomUUID().replaceAll("-", "")}`;
  const checks: { name: string; passed: boolean; detail: unknown }[] = [];
  let authority:
    | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
    | undefined;
  let fence: ReturnType<typeof createCredentialTransferEpochFence> | undefined;
  let created = false;
  let failure: unknown;
  const cleanupErrors: unknown[] = [];
  const record = (name: string, passed: boolean, detail: unknown = null) => {
    checks.push({ name, passed, detail });
  };
  try {
    await administrator.ready();
    authority = await createCredentialTransferTestAuthority(
      administrator,
      expectedDatabase,
    );
    const role = authority.role;
    const fresh = await administrator.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_catalog.pg_namespace WHERE nspname=$1",
      [schema],
    );
    if (fresh.rows[0]?.n !== "0")
      throw new Error("SHADOW_SCHEMA_ALREADY_EXISTS");
    await administrator.transaction(async (tx) => {
      await tx.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${role}`);
      await tx.query(
        `CREATE TABLE ${schema}.credential_transfer_requests (LIKE public.credential_transfer_requests INCLUDING ALL)`,
      );
      await tx.query(
        `CREATE TABLE ${schema}.devices (LIKE public.devices INCLUDING ALL)`,
      );
      await tx.query(
        `GRANT SELECT,UPDATE ON ${schema}.credential_transfer_requests TO ${role}`,
      );
      await tx.query(`GRANT SELECT ON ${schema}.devices TO ${role}`);
    });
    created = true;
    // Emulates a connection/session search_path, NOT a changed login or real
    // deployment. Entry functions remain explicitly schema-qualified.
    const inSession = <T>(action: (tx: DatabaseQuery) => Promise<T>) =>
      administrator.transaction(async (tx) => {
        await tx.query("SET LOCAL statement_timeout='4000ms'");
        await tx.query(`SET LOCAL SESSION AUTHORIZATION ${role}`);
        await tx.query(
          `SET LOCAL search_path=${schema},public,pg_catalog,pg_temp`,
        );
        return action(tx);
      });
    const runtime: DatabaseRuntime = {
      ...administrator,
      query: (text, values) => inSession((tx) => tx.query(text, values)),
      transaction: inSession,
    };
    const control = await runtime.query<{ shadow: boolean }>(
      `SELECT pg_catalog.to_regclass('credential_transfer_requests')=pg_catalog.to_regclass('${schema}.credential_transfer_requests') AS shadow`,
    );
    record(
      "adversarial_path_control_resolves_empty_shadow",
      control.rows[0]?.shadow === true,
    );
    await assertCredentialTransferFenceRuntime(runtime);
    record("baseline_role_and_catalog_admission_succeeds", true);
    fence = createCredentialTransferEpochFence(runtime, randomUUID());
    await fence.claim();
    record("qualified_epoch_election_succeeds", true);
    const bound = await fence.fencedTransaction((tx) =>
      tx.query<{
        request_is_public: boolean;
        devices_is_public: boolean;
        path: string;
      }>(`SELECT
      pg_catalog.to_regclass('credential_transfer_requests')=pg_catalog.to_regclass('public.credential_transfer_requests') AS request_is_public,
      pg_catalog.to_regclass('devices')=pg_catalog.to_regclass('public.devices') AS devices_is_public,
      pg_catalog.current_setting('search_path') AS path`),
    );
    record(
      "fenced_request_resolves_the_guarded_public_table",
      bound.rows[0]?.request_is_public === true,
      bound.rows[0]?.path,
    );
    record(
      "fenced_device_check_resolves_the_real_public_table",
      bound.rows[0]?.devices_is_public === true,
      bound.rows[0]?.path,
    );
    record(
      "fenced_search_path_is_canonical",
      bound.rows[0]?.path === "pg_catalog, public, pg_temp",
      bound.rows[0]?.path,
    );
    // This zero-row DML has no business side effect; the table-level guard still
    // runs when the canonical table is correctly resolved.
    await fence.fencedTransaction((tx) =>
      tx.query(
        "UPDATE credential_transfer_requests SET revision=revision WHERE false",
      ),
    );
    record("zero_row_statement_completes_without_product_changes", true);
    const next = await runtime.query<{ shadow: boolean }>(
      `SELECT pg_catalog.to_regclass('credential_transfer_requests')=pg_catalog.to_regclass('${schema}.credential_transfer_requests') AS shadow`,
    );
    record(
      "separate_unfenced_connection_context_remains_unmodified",
      next.rows[0]?.shadow === true,
    );
  } catch (error) {
    failure = error;
  }
  fence?.deactivate();
  if (created) {
    try {
      await administrator.query(`DROP SCHEMA ${schema} CASCADE`);
      const remaining = await administrator.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_catalog.pg_namespace WHERE nspname=$1",
        [schema],
      );
      record("only_owned_shadow_schema_removed", remaining.rows[0]?.n === "0");
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await authority?.dispose();
    if (authority) {
      const remaining = await administrator.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_catalog.pg_roles WHERE rolname=$1",
        [authority.role],
      );
      record("owned_test_role_removed", remaining.rows[0]?.n === "0");
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const context = await administrator.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM octoport_transfer_fence.authorized_transactions",
    );
    record("private_transaction_context_empty", context.rows[0]?.n === "0");
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await administrator.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  const passed = checks.filter((check) => check.passed).length;
  return {
    kind: "C06_R12_NATIVE_SCHEMA_RESOLUTION",
    verdict:
      !failure && cleanupErrors.length === 0 && passed === checks.length
        ? "PASS_SCOPED_CANONICAL_TRANSACTION_SCHEMA"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed,
    checks,
    error:
      failure instanceof Error
        ? failure.message
        : failure === undefined
          ? null
          : "UNKNOWN",
    cleanupErrors: cleanupErrors.map((error) =>
      error instanceof Error ? error.message : "UNKNOWN",
    ),
    limits: [
      "Disposable SESSION AUTHORIZATION adapter, not actual runtime LOGIN",
      "Only empty owned shadow tables, no product row mutation",
      "Does not close original four P1, restore, pooler or delayed network response gates",
    ],
  };
}
