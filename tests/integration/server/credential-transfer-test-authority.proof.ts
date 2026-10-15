import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabaseRuntime,
  createCredentialTransferRepository,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";

/** Actual migrated50 C/CI database, no live input and no trigger disablement. */
export async function proveCredentialTransferTestAuthority(
  connectionString: string,
  expectedDatabase:
    | "octoport_a_test"
    | "octoport_b_test"
    | "octoport_c_test"
    | "product_control_plane_test",
) {
  const db = createDatabaseRuntime(connectionString);
  type Authority = Awaited<
    ReturnType<typeof createCredentialTransferTestAuthority>
  >;
  const authorities: Authority[] = [];
  let current: Authority | undefined;
  const user = randomUUID(),
    account = randomUUID();
  const recipientId = randomUUID(),
    sourceId = randomUUID();
  const principal = {
    accountId: account,
    deviceId: recipientId,
    sessionId: randomUUID(),
  };
  const source = {
    accountId: account,
    deviceId: sourceId,
    sessionId: randomUUID(),
  };
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const checks: { name: string; passed: boolean }[] = [];
  let release: (() => void) | undefined;
  let error: unknown;
  let requestsCleared = false;
  const cleanup: Record<string, boolean> = {};
  const now = new Date("2000-01-01T00:00:00.000Z");
  const makeRequest = (requestId: string) => ({
    requestId,
    recipientDeviceId: recipientId,
    sourceDeviceId: sourceId,
    recipientPublicKeySpki: "A".repeat(128),
    selectedStores: [{ storeId: "synthetic-r9" }],
    consent: true as const,
    expiresInSeconds: 300,
  });
  function check(name: string, value: boolean) {
    checks.push({ name, passed: value });
    assert.equal(value, true, name);
  }
  async function rejected(
    name: string,
    fn: () => Promise<unknown>,
    code: string,
  ) {
    let observed: unknown;
    try {
      await fn();
    } catch (caught) {
      observed = caught;
    }
    const actual =
      observed && typeof observed === "object" && "code" in observed
        ? observed.code
        : observed instanceof Error
          ? observed.message
          : undefined;
    check(name, actual === code);
  }
  async function contextEmpty() {
    const r = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM octoport_transfer_fence.authorized_transactions",
    );
    return r.rows[0]?.n === "0";
  }
  try {
    await db.ready();
    const baseline = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    check("migrated_50_required", baseline.rows[0]?.n === "50");
    const due = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE expires_at<=$1 AND state NOT IN ('COMPLETED','CANCELLED','EXPIRED')",
      [new Date(now.getTime() + 301_000)],
    );
    check("expiry_test_cannot_touch_existing_rows", due.rows[0]?.n === "0");
    await rejected(
      "wrong_database_rejected_before_role_creation",
      () =>
        createCredentialTransferTestAuthority(
          db,
          expectedDatabase === "octoport_c_test"
            ? "product_control_plane_test"
            : "octoport_c_test",
        ),
      "TRANSFER_TEST_DATABASE_OR_ADMINISTRATOR_MISMATCH",
    );
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO users(id) VALUES($1)", [user]);
      await tx.query("INSERT INTO accounts(id) VALUES($1)", [account]);
      await tx.query(
        "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$3,$4,'chrome','0.2.21'),($2,$3,$4,'chrome','0.2.21')",
        [recipientId, sourceId, account, user],
      );
    });
    const ordinary = createCredentialTransferRepository(db);
    await rejected(
      "original_unfenced_consumer_rejected_by_mandatory_trigger",
      () => ordinary.create({ principal, request: makeRequest(ids[0]!), now }),
      "PTF02",
    );
    current = await createCredentialTransferTestAuthority(db, expectedDatabase);
    authorities.push(current);
    check("limited_role_passes_real_product_admission", current.isActive());
    const roleRow = await current.unguardedTransaction(
      async (tx) =>
        (
          await tx.query<{ c: string; s: string }>(
            "SELECT current_user AS c,session_user AS s",
          )
        ).rows[0],
    );
    check(
      "explicit_test_session_authorization_not_real_login",
      roleRow?.c === current.role && roleRow.s === current.role,
    );
    await rejected(
      "limited_role_cannot_read_private_context",
      () =>
        current!.unguardedTransaction((tx) =>
          tx.query(
            "SELECT * FROM octoport_transfer_fence.authorized_transactions",
          ),
        ),
      "42501",
    );
    await rejected(
      "unguarded_zero_row_dml_rejected",
      () =>
        current!.unguardedTransaction((tx) =>
          tx.query(
            "UPDATE public.credential_transfer_requests SET revision=revision+1 WHERE request_id=$1",
            [ids[0]],
          ),
        ),
      "PTF02",
    );
    const row = await current.repository.create({
      principal,
      request: makeRequest(ids[0]!),
      now,
    });
    check(
      "ordinary_create_consumer_with_explicit_authority",
      row.state === "REQUESTED",
    );
    check("context_removed_after_real_commit", await contextEmpty());
    check(
      "read",
      (await current.repository.read({ principal, requestId: ids[0]!, now }))
        ?.state === "REQUESTED",
    );
    check(
      "readForSource",
      (
        await current.repository.readForSource({
          principal: source,
          requestId: ids[0]!,
          now,
        })
      )?.requestId === ids[0],
    );
    check(
      "listForSource",
      (await current.repository.listForSource({ principal: source, now })).some(
        (x) => x.requestId === ids[0],
      ),
    );
    check(
      "markSourceSeen",
      (
        await current.repository.markSourceSeen({
          principal: source,
          requestId: ids[0]!,
          now,
        })
      ).state === "SOURCE_SEEN",
    );
    check(
      "markPacketAvailable",
      (
        await current.repository.markPacketAvailable({
          principal: source,
          requestId: ids[0]!,
          now,
        })
      ).state === "PACKET_AVAILABLE_EPHEMERAL",
    );
    check(
      "markDelivered",
      (
        await current.repository.markDelivered({
          principal,
          requestId: ids[0]!,
          now,
        })
      ).state === "DELIVERED_TO_RECIPIENT",
    );
    check(
      "acknowledge",
      (
        await current.repository.acknowledge({
          principal,
          ack: {
            requestId: ids[0]!,
            packetId: randomUUID(),
            importDecision: "IMPORTED",
          },
          now,
        })
      ).state === "COMPLETED",
    );
    await current.repository.create({
      principal,
      request: makeRequest(ids[1]!),
      now,
    });
    check(
      "cancel",
      (await current.repository.cancel({ principal, requestId: ids[1]!, now }))
        .state === "CANCELLED",
    );
    await current.repository.create({
      principal,
      request: makeRequest(ids[2]!),
      now,
    });
    // The old synthetic clock and verified zero baseline due-count keep
    // this global maintenance call from expiring unrelated baseline rows.
    const expireCount = await current.repository.expireDue(
      new Date(now.getTime() + 301_000),
    );
    check(
      "expireDue_is_fenced_and_changes_only_one_owned_row",
      expireCount === 1,
    );
    check(
      "expired_row_matches_committed_state",
      (
        await current.repository.read({
          principal,
          requestId: ids[2]!,
          now: new Date(now.getTime() + 301_000),
        })
      )?.state === "EXPIRED",
    );
    await rejected(
      "context_not_reused_by_next_unguarded_transaction",
      () =>
        current!.unguardedTransaction((tx) =>
          tx.query(
            "UPDATE public.credential_transfer_requests SET revision=revision+1 WHERE request_id=$1",
            [ids[0]],
          ),
        ),
      "PTF02",
    );
    check("rollback_removes_private_context", await contextEmpty());
    const first = current;
    current = await createCredentialTransferTestAuthority(db, expectedDatabase);
    authorities.push(current);
    await rejected(
      "replacement_invalidates_prior_consumer",
      () => first.repository.listForSource({ principal: source, now }),
      "TRANSFER_CONFLICT",
    );
    check("prior_consumer_cannot_reactivate", !first.isActive());
    await first.dispose();
    check(
      "replacement_can_read_committed_result",
      (await current.repository.read({ principal, requestId: ids[0]!, now }))
        ?.state === "COMPLETED",
    );
    await current.transaction((tx) =>
      tx.query(
        "DELETE FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
        [ids],
      ),
    );
    requestsCleared = true;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = current.transaction(async (tx) => {
      await tx.query("SELECT 1");
      entered();
      await releasePromise;
      return "finished";
    });
    await enteredPromise;
    let disposed = false;
    const disposing = current.dispose().then(() => {
      disposed = true;
    });
    check(
      "dispose_immediately_removes_new_work_admission",
      !current.isActive(),
    );
    await rejected(
      "closed_consumer_cannot_start_read",
      () => current!.repository.read({ principal, requestId: ids[0]!, now }),
      "TRANSFER_CONFLICT",
    );
    check("dispose_waits_for_started_transaction", !disposed);
    release!();
    check(
      "already_started_transaction_finishes",
      (await pending) === "finished",
    );
    await disposing;
    await current.dispose();
    check("dispose_is_idempotent_and_complete", disposed);
    check("final_context_empty", await contextEmpty());
  } catch (caught) {
    error = caught;
  } finally {
    release?.();
    try {
      if (!requestsCleared && current?.isActive()) {
        await current.transaction((tx) =>
          tx.query(
            "DELETE FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
            [ids],
          ),
        );
        requestsCleared = true;
      }
      for (const authority of authorities) await authority.dispose();
      const remaining = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
        [ids],
      );
      cleanup.ownRequestsAbsent = remaining.rows[0]?.n === "0";
      if (cleanup.ownRequestsAbsent) {
        await db.transaction(async (tx) => {
          await tx.query("DELETE FROM devices WHERE id=ANY($1::uuid[])", [
            [recipientId, sourceId],
          ]);
          await tx.query("DELETE FROM accounts WHERE id=$1", [account]);
          await tx.query("DELETE FROM users WHERE id=$1", [user]);
        });
      }
      const roles = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_roles WHERE rolname=ANY($1::text[])",
        [authorities.map((a) => a.role)],
      );
      cleanup.ownRolesAbsent = roles.rows[0]?.n === "0";
      cleanup.privateContextEmpty = await contextEmpty();
      const end = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
      );
      cleanup.journalStill50 = end.rows[0]?.n === "50";
    } catch (cleanupError) {
      error = new AggregateError(
        [error, cleanupError],
        "R9_PROOF_OR_CLEANUP_FAILED",
      );
    }
    await db.close();
  }
  const ok =
    !error &&
    checks.every((x) => x.passed) &&
    Object.values(cleanup).every(Boolean);
  return {
    kind: "C06_R9_EXPLICIT_TEST_AUTHORITY_NATIVE",
    verdict: ok
      ? "PASS_SCOPED_TEST_CONSUMER_AUTHORITY"
      : "FAIL_OR_INCONCLUSIVE",
    checks,
    total: checks.length,
    passed: checks.filter((x) => x.passed).length,
    cleanup,
    error: error instanceof Error ? error.message : null,
    limits: [
      "Test-only SESSION AUTHORIZATION, not genuine runtime login",
      "No main startup, HTTP, original B tests or installed scenario executed",
      "No live data, grants or service changes; no trigger disablement",
      "Original four singleton P1 and deployment/restore/pooler gates remain open",
    ],
  };
}
