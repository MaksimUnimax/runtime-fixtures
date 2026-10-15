import { randomUUID } from "node:crypto";
import {
  assertCredentialTransferFenceRuntime,
  createCredentialTransferEpochFence,
  createEpochFencedCredentialTransferRepository,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "../../../../packages/server/db/src/index.js";

/**
 * Test-only adapter for a previously migrated disposable database.
 * It does not disable the trigger, change product admission, or grant access to
 * private tables. The temporary role has LOGIN capability but no credential;
 * SESSION AUTHORIZATION is an explicit superuser test adapter. It is NOT
 * evidence of a genuine network login or permission provisioning.
 */
export async function createCredentialTransferTestAuthority(
  administrator: DatabaseRuntime,
  expectedDatabase:
    | "octoport_a_test"
    | "octoport_b_test"
    | "octoport_c_test"
    | "product_control_plane_test"
    | "seller_agents_i1_client",
) {
  if (
    ![
      "octoport_a_test",
      "octoport_b_test",
      "octoport_c_test",
      "product_control_plane_test",
      // Exact database already declared in extension-i1-ci.yml.
      "seller_agents_i1_client",
    ].includes(expectedDatabase)
  )
    throw new Error("TRANSFER_TEST_DATABASE_NOT_ALLOWED");
  const identity = await administrator.query<{
    database_name: string;
    is_superuser: boolean;
    direct_session: boolean;
  }>(`SELECT current_database() AS database_name,
       current_user=session_user AS direct_session,
       (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser`);
  const first = identity.rows[0];
  if (
    identity.rows.length !== 1 ||
    first?.database_name !== expectedDatabase ||
    first.is_superuser !== true ||
    first.direct_session !== true
  ) {
    throw new Error("TRANSFER_TEST_DATABASE_OR_ADMINISTRATOR_MISMATCH");
  }
  const role = `c06_test_${randomUUID().replaceAll("-", "")}`;
  if (!/^c06_test_[0-9a-f]{32}$/.test(role))
    throw new Error("INVALID_TEST_ROLE");
  const absent = await administrator.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (absent.rows[0]?.count !== "0")
    throw new Error("TEST_ROLE_ALREADY_EXISTS");
  let stopping = false;
  let disposePromise: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();
  function inSession<T>(action: (tx: DatabaseQuery) => Promise<T>): Promise<T> {
    if (stopping)
      return Promise.reject(new Error("TRANSFER_TEST_AUTHORITY_CLOSED"));
    const pending = administrator.transaction(async (tx) => {
      if (stopping) throw new Error("TRANSFER_TEST_AUTHORITY_CLOSED");
      await tx.query("SET LOCAL statement_timeout='5000ms'");
      await tx.query("SET LOCAL lock_timeout='4000ms'");
      await tx.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
      await tx.query(`SET LOCAL SESSION AUTHORIZATION ${role}`);
      await tx.query("SET LOCAL search_path=pg_catalog,public,pg_temp");
      if (stopping) throw new Error("TRANSFER_TEST_AUTHORITY_CLOSED");
      return action(tx);
    });
    active.add(pending);
    void pending.then(
      () => active.delete(pending),
      () => active.delete(pending),
    );
    return pending;
  }
  const runtime: DatabaseRuntime = {
    ...administrator,
    query: (text, values) => inSession((tx) => tx.query(text, values)),
    transaction: inSession,
  };
  const fence = createCredentialTransferEpochFence(runtime, randomUUID());
  async function removeOwnRole(): Promise<void> {
    const present = await administrator.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (present.rows[0]?.count === "0") return;
    await administrator.transaction(async (tx) => {
      await tx.query(
        `REVOKE SELECT,INSERT,UPDATE,DELETE ON public.credential_transfer_requests FROM ${role}`,
      );
      await tx.query(`REVOKE SELECT ON public.devices FROM ${role}`);
      await tx.query(
        `REVOKE EXECUTE ON FUNCTION octoport_transfer_fence.claim_writer(uuid),octoport_transfer_fence.authorize_writer(bigint,uuid) FROM ${role}`,
      );
      await tx.query(
        `REVOKE USAGE ON SCHEMA public,octoport_transfer_fence FROM ${role}`,
      );
      await tx.query(`DROP ROLE ${role}`);
    });
    const remaining = await administrator.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (remaining.rows[0]?.count !== "0")
      throw new Error("TEST_ROLE_CLEANUP_UNVERIFIED");
  }
  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    stopping = true;
    fence.deactivate();
    const attempt = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...active]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error("TRANSFER_TEST_ACTIVE_OPERATIONS_DID_NOT_FINISH"),
                ),
              8_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      await removeOwnRole();
    })();
    disposePromise = attempt;
    // A later explicit call can retry cleanup once blocked operations finish.
    // Admission remains terminally stopped; no business/election is retried.
    void attempt.then(undefined, () => {
      if (disposePromise === attempt) disposePromise = undefined;
    });
    return attempt;
  }
  try {
    await administrator.transaction(async (tx) => {
      await tx.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      await tx.query(
        `GRANT USAGE ON SCHEMA public,octoport_transfer_fence TO ${role}`,
      );
      await tx.query(
        `GRANT EXECUTE ON FUNCTION octoport_transfer_fence.claim_writer(uuid),octoport_transfer_fence.authorize_writer(bigint,uuid) TO ${role}`,
      );
      await tx.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON public.credential_transfer_requests TO ${role}`,
      );
      await tx.query(`GRANT SELECT ON public.devices TO ${role}`);
    });
    await assertCredentialTransferFenceRuntime(runtime);
    await fence.claim();
    return {
      role,
      repository: createEpochFencedCredentialTransferRepository(fence),
      transaction: <T>(action: (tx: DatabaseQuery) => Promise<T>) =>
        fence.fencedTransaction(action),
      /** Negative controls use real limited-role SQL without authorizing it. */
      unguardedTransaction: inSession,
      isActive: () => !stopping && fence.isActive(),
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "TRANSFER_TEST_SETUP_AND_CLEANUP_FAILED",
      );
    }
    throw error;
  }
}
