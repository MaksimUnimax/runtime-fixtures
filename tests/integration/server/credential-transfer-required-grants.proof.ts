import { randomUUID } from "node:crypto";
import {
  createDatabaseRuntime,
  createCredentialTransferEpochFence,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferApiAdmission } from "../../../apps/api/src/credential-transfer-admission.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";

/** Real catalog grants and real API admission; temporary LOGIN capability has no credential and is exercised only through SESSION AUTHORIZATION. */
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
  const excessObservations: {
    excess: string;
    rejected: boolean;
    electionChanged: boolean;
  }[] = [];
  let membershipObservation:
    | { rejected: boolean; electionChanged: boolean; setOption: boolean }
    | undefined;
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

    const excessCases: {
      label: string;
      grant: string;
      revoke: string;
      verifySql: string;
      verifyValues: unknown[];
    }[] = [
      {
        label: "writer_epoch:SELECT",
        grant: `GRANT SELECT ON octoport_transfer_fence.writer_epoch TO ${ownRole}`,
        revoke: `REVOKE SELECT ON octoport_transfer_fence.writer_epoch FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_table_privilege($1,'octoport_transfer_fence.writer_epoch','SELECT') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "writer_epoch:MAINTAIN",
        grant: `GRANT MAINTAIN ON octoport_transfer_fence.writer_epoch TO ${ownRole}`,
        revoke: `REVOKE MAINTAIN ON octoport_transfer_fence.writer_epoch FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_table_privilege($1,'octoport_transfer_fence.writer_epoch','MAINTAIN') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "writer_epoch.column:SELECT",
        grant: `GRANT SELECT(singleton_id) ON octoport_transfer_fence.writer_epoch TO ${ownRole}`,
        revoke: `REVOKE SELECT(singleton_id) ON octoport_transfer_fence.writer_epoch FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_column_privilege($1,'octoport_transfer_fence.writer_epoch','singleton_id','SELECT') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "authorized_transactions:SELECT",
        grant: `GRANT SELECT ON octoport_transfer_fence.authorized_transactions TO ${ownRole}`,
        revoke: `REVOKE SELECT ON octoport_transfer_fence.authorized_transactions FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_table_privilege($1,'octoport_transfer_fence.authorized_transactions','SELECT') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "credential_transfer_requests:MAINTAIN",
        grant: `GRANT MAINTAIN ON public.credential_transfer_requests TO ${ownRole}`,
        revoke: `REVOKE MAINTAIN ON public.credential_transfer_requests FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_table_privilege($1,'public.credential_transfer_requests','MAINTAIN') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "credential_transfer_requests.column:REFERENCES",
        grant: `GRANT REFERENCES(request_id) ON public.credential_transfer_requests TO ${ownRole}`,
        revoke: `REVOKE REFERENCES(request_id) ON public.credential_transfer_requests FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_column_privilege($1,'public.credential_transfer_requests','request_id','REFERENCES') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "devices:UPDATE",
        grant: `GRANT UPDATE ON public.devices TO ${ownRole}`,
        revoke: `REVOKE UPDATE ON public.devices FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_table_privilege($1,'public.devices','UPDATE') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "public_schema:CREATE",
        grant: `GRANT CREATE ON SCHEMA public TO ${ownRole}`,
        revoke: `REVOKE CREATE ON SCHEMA public FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_schema_privilege($1,'public','CREATE') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "fence_schema:CREATE",
        grant: `GRANT CREATE ON SCHEMA octoport_transfer_fence TO ${ownRole}`,
        revoke: `REVOKE CREATE ON SCHEMA octoport_transfer_fence FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_schema_privilege($1,'octoport_transfer_fence','CREATE') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "guard_transfer_statement:EXECUTE",
        grant: `GRANT EXECUTE ON FUNCTION octoport_transfer_fence.guard_transfer_statement() TO ${ownRole}`,
        revoke: `REVOKE EXECUTE ON FUNCTION octoport_transfer_fence.guard_transfer_statement() FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_function_privilege($1,'octoport_transfer_fence.guard_transfer_statement()','EXECUTE') AS allowed",
        verifyValues: [ownRole],
      },
      {
        label: "clear_transaction_authorization:EXECUTE",
        grant: `GRANT EXECUTE ON FUNCTION octoport_transfer_fence.clear_transaction_authorization() TO ${ownRole}`,
        revoke: `REVOKE EXECUTE ON FUNCTION octoport_transfer_fence.clear_transaction_authorization() FROM ${ownRole}`,
        verifySql:
          "SELECT pg_catalog.has_function_privilege($1,'octoport_transfer_fence.clear_transaction_authorization()','EXECUTE') AS allowed",
        verifyValues: [ownRole],
      },
    ];
    for (const item of excessCases) {
      const before = await epoch();
      const current = admission();
      let granted = false;
      try {
        await administrator.query(item.grant);
        granted = true;
        const effective = await administrator.query<{ allowed: boolean }>(
          item.verifySql,
          item.verifyValues,
        );
        check(
          `${item.label}:excess_privilege_effective`,
          effective.rows[0]?.allowed === true,
        );
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
        excessObservations.push({
          excess: item.label,
          rejected,
          electionChanged: changed,
        });
        check(`${item.label}:admission_rejected`, rejected);
        check(`${item.label}:not_ready`, !current.isReady());
        check(`${item.label}:no_epoch_election`, !changed);
      } finally {
        current.stop();
        if (granted) await administrator.query(item.revoke);
      }
      const removed = await administrator.query<{ allowed: boolean }>(
        item.verifySql,
        item.verifyValues,
      );
      check(
        `${item.label}:excess_privilege_removed`,
        removed.rows[0]?.allowed === false,
      );
      const restored = admission();
      try {
        await restored.start();
        check(
          `${item.label}:fresh_admission_after_excess_revoke`,
          restored.isReady(),
        );
      } finally {
        restored.stop();
      }
    }

    const membershipRole = `c06_parent_${randomUUID().replaceAll("-", "")}`;
    const ancestorRole = `c06_ancestor_${randomUUID().replaceAll("-", "")}`;
    const membershipBefore = await epoch();
    const membershipAdmission = admission();
    let parentCreated = false;
    let ancestorCreated = false;
    let membershipGranted = false;
    let ancestorGranted = false;
    try {
      await administrator.query(
        `CREATE ROLE ${membershipRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      parentCreated = true;
      await administrator.query(
        `CREATE ROLE ${ancestorRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      ancestorCreated = true;
      await administrator.query(`GRANT ${ancestorRole} TO ${membershipRole}`);
      ancestorGranted = true;
      await administrator.query(`GRANT ${membershipRole} TO ${ownRole}`);
      membershipGranted = true;
      const membership = await administrator.query<{
        parent_name: string;
        child_name: string;
        set_option: boolean;
      }>(
        `SELECT parent.rolname AS parent_name,child.rolname AS child_name,m.set_option
         FROM pg_catalog.pg_auth_members m
         JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
         JOIN pg_catalog.pg_roles child ON child.oid=m.member
         WHERE (parent.rolname=$1 AND child.rolname=$2)
            OR (parent.rolname=$3 AND child.rolname=$1)
         ORDER BY parent.rolname,child.rolname`,
        [membershipRole, ownRole, ancestorRole],
      );
      check(
        "role_membership:set_capable_direct_and_nested_memberships_created",
        membership.rows.length === 2 &&
          membership.rows.every((row) => row.set_option === true) &&
          membership.rows.some(
            (row) =>
              row.parent_name === membershipRole && row.child_name === ownRole,
          ) &&
          membership.rows.some(
            (row) =>
              row.parent_name === ancestorRole &&
              row.child_name === membershipRole,
          ),
      );
      let rejected = false;
      try {
        await membershipAdmission.start();
      } catch (error) {
        rejected =
          error instanceof Error &&
          error.message === "TRANSFER_FENCE_RUNTIME_UNSAFE_OR_UNPROVISIONED";
        if (!rejected)
          failureTypes.push(error instanceof Error ? error.name : typeof error);
      }
      const changed = (await epoch()) !== membershipBefore;
      membershipObservation = {
        rejected,
        electionChanged: changed,
        setOption:
          membership.rows.length === 2 &&
          membership.rows.every((row) => row.set_option === true),
      };
      check("role_membership:admission_rejected", rejected);
      check("role_membership:not_ready", !membershipAdmission.isReady());
      check("role_membership:no_epoch_election", !changed);
    } finally {
      membershipAdmission.stop();
      if (membershipGranted)
        await administrator.query(`REVOKE ${membershipRole} FROM ${ownRole}`);
      if (ancestorGranted)
        await administrator.query(
          `REVOKE ${ancestorRole} FROM ${membershipRole}`,
        );
      if (ancestorCreated)
        await administrator.query(`DROP ROLE ${ancestorRole}`);
      if (parentCreated)
        await administrator.query(`DROP ROLE ${membershipRole}`);
    }
    const membershipRemoved = await administrator.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[])",
      [[membershipRole, ancestorRole]],
    );
    check(
      "role_membership:temporary_parent_roles_removed",
      membershipRemoved.rows[0]?.count === "0",
    );
    const membershipRestored = admission();
    try {
      await membershipRestored.start();
      check(
        "role_membership:fresh_admission_after_membership_removal",
        membershipRestored.isReady(),
      );
    } finally {
      membershipRestored.stop();
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
      excessObservations.length === 11 &&
      membershipObservation?.rejected === true &&
      membershipObservation.electionChanged === false &&
      membershipObservation.setOption === true &&
      passed === checks.length &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_REQUIRED_REPOSITORY_GRANTS"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed,
    checks,
    observations,
    excessObservations,
    membershipObservation,
    cleanup,
    failureTypes,
    limitations: [
      "Existing disposable database and explicit SESSION AUTHORIZATION test adapter; the temporary role has LOGIN capability but no credential, so this is not genuine network LOGIN evidence.",
      "Only temporary-role grants change and are revoked with readback; no PUBLIC grant, password, HBA, live or owner state change.",
      "Does not accept complete old binary, production, partition, restore or all original P1 conditions.",
    ],
  };
}
