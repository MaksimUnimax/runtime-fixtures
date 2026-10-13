import { randomUUID } from "node:crypto";
import {
  createDatabaseRuntime,
  createCredentialTransferEpochFence,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferApiAdmission } from "../../../apps/api/src/credential-transfer-admission.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";

/** Real catalog grants and real API admission; never provisions a LOGIN. */
export async function proveCredentialTransferRequiredGrants(
  connectionString: string,
) {
  const expectedDatabase = requireI1DisposableDatabase(connectionString);
  const administrator = createDatabaseRuntime(connectionString);
  const checks: { name: string; passed: boolean }[] = [];
  const failureTypes: string[] = [];
  const observations: {
    missing: string;
    rejected: boolean;
    electionChanged: boolean;
  }[] = [];
  const cleanup: Record<string, boolean> = {};
  let authority:
    | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
    | undefined;
  let role: string | undefined;
  const check = (name: string, passed: boolean) =>
    checks.push({ name, passed });
  async function epoch(): Promise<string> {
    const result = await administrator.query<{ epoch: string }>(
      "SELECT epoch::text FROM octoport_transfer_fence.writer_epoch WHERE singleton_id=1",
    );
    if (result.rows.length !== 1) throw new Error("EPOCH_ROW_MISSING");
    return result.rows[0]!.epoch;
  }
  try {
    authority = await createCredentialTransferTestAuthority(
      administrator,
      expectedDatabase,
    );
    const testAuthority = authority;
    role = testAuthority.role;
    if (!/^c06_test_[0-9a-f]{32}$/.test(role))
      throw new Error("INVALID_OWN_TEST_ROLE");
    const ownRole = role;
    const runtime: DatabaseRuntime = {
      ...administrator,
      query: (text, values) =>
        testAuthority.unguardedTransaction((tx) => tx.query(text, values)),
      transaction: (action) => testAuthority.unguardedTransaction(action),
    };
    function admission() {
      return createCredentialTransferApiAdmission(
        runtime,
        createCredentialTransferEpochFence(runtime, randomUUID()),
      );
    }
    const positive = admission();
    try {
      await positive.start();
      check("full_repository_grants_admit", positive.isReady());
    } finally {
      positive.stop();
    }
    const cases = [
      { table: "public.credential_transfer_requests", revoked: ["SELECT"] },
      { table: "public.credential_transfer_requests", revoked: ["INSERT"] },
      { table: "public.credential_transfer_requests", revoked: ["UPDATE"] },
      { table: "public.credential_transfer_requests", revoked: ["DELETE"] },
      { table: "public.devices", revoked: ["SELECT"] },
      // PostgreSQL's comma-separated privilege inquiry means ANY, not ALL.
      {
        table: "public.credential_transfer_requests",
        revoked: ["INSERT", "UPDATE", "DELETE"],
      },
    ];
    for (const item of cases) {
      const label = `${item.table}:${item.revoked.join("+")}`;
      const before = await epoch();
      const current = admission();
      let revoked = false;
      try {
        await administrator.query(
          `REVOKE ${item.revoked.join(",")} ON ${item.table} FROM ${ownRole}`,
        );
        revoked = true;
        for (const privilege of item.revoked) {
          const value = await administrator.query<{ allowed: boolean }>(
            "SELECT pg_catalog.has_table_privilege($1,$2,$3) AS allowed",
            [ownRole, item.table, privilege],
          );
          check(
            `${label}:missing_${privilege}_confirmed`,
            value.rows[0]?.allowed === false,
          );
        }
        if (item.revoked.length > 1) {
          const combined = await administrator.query<{ allowed: boolean }>(
            "SELECT pg_catalog.has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",
            [ownRole, item.table],
          );
          check(
            `${label}:any_privilege_is_not_all`,
            combined.rows[0]?.allowed === true,
          );
        }
        let rejected = false;
        try {
          await current.start();
        } catch (error) {
          rejected =
            error instanceof Error &&
            error.message === "TRANSFER_FENCE_RUNTIME_UNSAFE_OR_UNPROVISIONED";
          if (!rejected)
            failureTypes.push(
              error instanceof Error ? error.name : typeof error,
            );
        }
        const changed = (await epoch()) !== before;
        observations.push({
          missing: label,
          rejected,
          electionChanged: changed,
        });
        check(`${label}:admission_rejected`, rejected);
        check(`${label}:not_ready`, !current.isReady());
        check(`${label}:no_epoch_election`, !changed);
        for (const privilege of item.revoked) {
          const value = await administrator.query<{ allowed: boolean }>(
            "SELECT pg_catalog.has_table_privilege($1,$2,$3) AS allowed",
            [ownRole, item.table, privilege],
          );
          check(
            `${label}:no_self_grant_${privilege}`,
            value.rows[0]?.allowed === false,
          );
        }
      } finally {
        current.stop();
        // Restore only our temporary role, even after a negative control fails.
        if (revoked)
          await administrator.query(
            `GRANT ${item.revoked.join(",")} ON ${item.table} TO ${ownRole}`,
          );
      }
      const restored = admission();
      try {
        await restored.start();
        check(
          `${label}:fresh_admission_after_explicit_grant_restore`,
          restored.isReady(),
        );
      } finally {
        restored.stop();
      }
    }
  } catch (error) {
    failureTypes.push(error instanceof Error ? error.name : typeof error);
  } finally {
    if (authority) {
      try {
        await authority.dispose();
        cleanup.authority_disposed = true;
      } catch (error) {
        cleanup.authority_disposed = false;
        failureTypes.push(error instanceof Error ? error.name : typeof error);
      }
    } else {
      cleanup.authority_disposed = false;
    }
    if (role) {
      try {
        const result = await administrator.query<{ count: string }>(
          "SELECT count(*)::text FROM pg_roles WHERE rolname=$1",
          [role],
        );
        cleanup.own_role_absent = result.rows[0]?.count === "0";
      } catch {
        cleanup.own_role_absent = false;
      }
    }
    try {
      await administrator.close();
      cleanup.administrator_closed = true;
    } catch {
      cleanup.administrator_closed = false;
    }
  }
  const passed = checks.filter((item) => item.passed).length;
  return {
    kind: "C06_REQUIRED_REPOSITORY_GRANTS",
    verdict:
      failureTypes.length === 0 &&
      observations.length === 6 &&
      passed === checks.length &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_REQUIRED_REPOSITORY_GRANTS"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed,
    checks,
    observations,
    cleanup,
    failureTypes,
    limitations: [
      "Existing disposable database and explicit SESSION AUTHORIZATION test adapter, not genuine restricted LOGIN.",
      "Only temporary role grants change; no public grant, schema, password, HBA, live or owner state change.",
      "Does not accept complete old binary, production, partition, restore or all original P1 conditions.",
    ],
  };
}
