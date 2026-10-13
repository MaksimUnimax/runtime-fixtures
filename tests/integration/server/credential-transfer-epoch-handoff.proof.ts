import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createDatabaseRuntime,
  type DatabaseQuery,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
} from "../../../packages/server/credential-transfer/src/index.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 7_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : error instanceof Error
      ? error.message
      : undefined;
}

/** Independent actual PG pools, not an OS restart, pooler or delayed TCP test. */
export async function proveCredentialTransferEpochHandoff(
  connectionString: string,
) {
  const expectedDatabase = requireI1DisposableDatabase(connectionString);
  const observer = createDatabaseRuntime(connectionString);
  const firstPool = createDatabaseRuntime(connectionString);
  const nextPool = createDatabaseRuntime(connectionString);
  type Authority = Awaited<
    ReturnType<typeof createCredentialTransferTestAuthority>
  >;
  const authorities: Authority[] = [];
  const services: CredentialTransferService[] = [];
  const releases: (() => void)[] = [];
  const pending: Promise<unknown>[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  const cleanup: Record<string, boolean> = {};
  const failures: string[] = [];
  const observations: {
    outcome: string;
    oldEpoch: string;
    newEpoch: string;
    blockedByOldBackend: boolean;
    oldSubmitOutcome: string;
  }[] = [];
  const accountId = randomUUID(),
    userId = randomUUID();
  const recipientId = randomUUID(),
    sourceId = randomUUID();
  const recipient = {
    accountId,
    deviceId: recipientId,
    sessionId: randomUUID(),
  };
  const source = { accountId, deviceId: sourceId, sessionId: randomUUID() };
  const requestIds: string[] = [];
  let latest: Authority | undefined;
  const clock = () => new Date("2000-01-01T00:00:00.000Z");
  function check(name: string, passed: boolean) {
    checks.push({ name, passed });
    assert.equal(passed, true, name);
  }
  function capture(error: unknown) {
    failures.push(
      error instanceof Error ? error.message.slice(0, 160) : typeof error,
    );
  }
  async function cleanupStep(name: string, action: () => Promise<boolean>) {
    try {
      cleanup[name] = await action();
    } catch (error) {
      cleanup[name] = false;
      capture(error);
    }
  }
  async function row(id: string) {
    const value = await observer.query<{ state: string; revision: number }>(
      "SELECT state,revision FROM public.credential_transfer_requests WHERE request_id=$1",
      [id],
    );
    assert.equal(value.rows.length, 1);
    return value.rows[0]!;
  }
  async function epoch() {
    const r = await observer.query<{ epoch: string }>(
      "SELECT epoch::text FROM octoport_transfer_fence.writer_epoch WHERE singleton_id=1",
    );
    assert.equal(r.rows.length, 1);
    return r.rows[0]!.epoch;
  }
  const makeRequest = (requestId: string) => ({
    requestId,
    recipientDeviceId: recipientId,
    sourceDeviceId: sourceId,
    recipientPublicKeySpki: "A".repeat(128),
    selectedStores: [{ storeId: "synthetic-r16" }],
    consent: true as const,
    expiresInSeconds: 300,
  });
  try {
    await observer.ready();
    const initial = await observer.query<{ journal: string; contexts: string }>(
      "SELECT (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS journal,(SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS contexts",
    );
    check(
      "migrated49_no_transaction_context",
      initial.rows[0]?.journal === "49" && initial.rows[0]?.contexts === "0",
    );
    await observer.transaction(async (tx) => {
      await tx.query("INSERT INTO public.users(id) VALUES($1)", [userId]);
      await tx.query("INSERT INTO public.accounts(id) VALUES($1)", [accountId]);
      await tx.query(
        "INSERT INTO public.devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$3,$4,'chrome','0.2.21'),($2,$3,$4,'chrome','0.2.21')",
        [recipientId, sourceId, accountId, userId],
      );
    });
    for (const outcome of ["commit", "rollback"] as const) {
      const prefix = outcome + "_";
      const requestId = randomUUID();
      requestIds.push(requestId);
      const changed = deferred(),
        finishOld = deferred(),
        nextClaimEntered = deferred(),
        dispatchNextClaim = deferred();
      releases.push(finishOld.resolve, dispatchNextClaim.resolve);
      const rollbackError = new Error(
        "R16_INTENTIONAL_OLD_TRANSACTION_ROLLBACK",
      );
      let armed = false,
        oldBackend = 0,
        nextBackend = 0,
        businessSql = 0,
        nextClaims = 0;
      const observedFirst: DatabaseRuntime = {
        ...firstPool,
        transaction: (action) =>
          firstPool.transaction(async (tx) => {
            const instrumented: DatabaseQuery = {
              async query<
                T extends Record<string, unknown> = Record<string, unknown>,
              >(text: string, values?: unknown[]) {
                if (
                  /\b(?:FROM|INTO|UPDATE)\s+(?:public\.)?(?:devices|credential_transfer_requests)\b/i.test(
                    text,
                  )
                )
                  businessSql++;
                const result = await tx.query<T>(text, values);
                if (
                  armed &&
                  text.includes("SET state='PACKET_AVAILABLE_EPHEMERAL'")
                ) {
                  armed = false;
                  oldBackend = (
                    await tx.query<{ pid: number }>(
                      "SELECT pg_backend_pid() AS pid",
                    )
                  ).rows[0]!.pid;
                  changed.resolve();
                  await finishOld.promise;
                  if (outcome === "rollback") throw rollbackError;
                }
                return result;
              },
            };
            return action(instrumented);
          }),
      };
      const first = await createCredentialTransferTestAuthority(
        observedFirst,
        expectedDatabase,
      );
      authorities.push(first);
      latest = first;
      const relayA = new EphemeralTransferRelay();
      const serviceA = new CredentialTransferService(
        first.repository,
        relayA,
        clock,
        () => first.isActive(),
      );
      services.push(serviceA);
      await serviceA.create(recipient, makeRequest(requestId));
      await serviceA.sourceSeen(source, requestId);
      const before = await row(requestId),
        oldEpoch = await epoch();
      check(
        prefix + "old_owner_prepared_source",
        before.state === "SOURCE_SEEN" && first.isActive(),
      );
      const observedNext: DatabaseRuntime = {
        ...nextPool,
        transaction: (action) =>
          nextPool.transaction(async (tx) => {
            const instrumented: DatabaseQuery = {
              async query<
                T extends Record<string, unknown> = Record<string, unknown>,
              >(text: string, values?: unknown[]) {
                if (
                  /FROM\s+octoport_transfer_fence\.claim_writer\s*\(/i.test(
                    text,
                  )
                ) {
                  nextClaims++;
                  nextBackend = (
                    await tx.query<{ pid: number }>(
                      "SELECT pg_backend_pid() AS pid",
                    )
                  ).rows[0]!.pid;
                  nextClaimEntered.resolve();
                  await dispatchNextClaim.promise;
                }
                return tx.query<T>(text, values);
              },
            };
            return action(instrumented);
          }),
      };
      // Prepare the next test role before the old DML holds relation locks.
      // Its claim is held before dispatch, not replaced by a fake repository.
      const takeover = settled(
        createCredentialTransferTestAuthority(
          observedNext,
          expectedDatabase,
        ).then((value) => {
          authorities.push(value);
          latest = value;
          return value;
        }),
      );
      pending.push(takeover);
      await bounded(
        Promise.race([
          nextClaimEntered.promise,
          takeover.then(() => {
            throw new Error("NEXT_CLAIM_DID_NOT_ENTER");
          }),
        ]),
        "NEXT_CLAIM_SETUP_TIMEOUT",
      );
      armed = true;
      const oldSubmit = settled(
        serviceA.submit(source, {
          requestId,
          packetId: randomUUID(),
          envelope: "synthetic-old-r16",
        }),
      );
      pending.push(oldSubmit);
      await bounded(
        Promise.race([
          changed.promise,
          oldSubmit.then(() => {
            throw new Error("OLD_MUTATION_DID_NOT_ENTER");
          }),
        ]),
        "OLD_MUTATION_TIMEOUT",
      );
      check(
        prefix + "separate_pg_backends",
        oldBackend > 0 && nextBackend > 0 && oldBackend !== nextBackend,
      );
      dispatchNextClaim.resolve();
      let blockObserved = false;
      const deadline = Date.now() + 2_500;
      while (Date.now() < deadline) {
        const blocked = await observer.query<{ waiting: boolean }>(
          "SELECT wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) AS waiting FROM pg_stat_activity WHERE pid=$2::int",
          [oldBackend, nextBackend],
        );
        if (blocked.rows[0]?.waiting === true) {
          blockObserved = true;
          break;
        }
        await delay(10);
      }
      check(prefix + "pg_blocking_pids_proves_election_waits", blockObserved);
      check(
        prefix + "old_write_invisible_before_transaction_end",
        JSON.stringify(await row(requestId)) === JSON.stringify(before),
      );
      check(
        prefix + "epoch_unchanged_while_old_write_pending",
        (await epoch()) === oldEpoch,
      );
      check(
        prefix + "only_unreadable_reservation_while_pending",
        relayA.statsForTests().reserved === 1,
      );
      finishOld.resolve();
      const nextResult = await bounded(takeover, "NEXT_ELECTION_TIMEOUT");
      assert.ok(nextResult.ok, "NEXT_ELECTION_FAILED");
      const next = nextResult.value;
      const oldResult = await bounded(
        oldSubmit,
        "OLD_SUBMIT_SETTLEMENT_TIMEOUT",
      );
      const after = await row(requestId),
        newEpoch = await epoch();
      check(
        prefix + "exactly_one_next_election",
        nextClaims === 1 && BigInt(newEpoch) === BigInt(oldEpoch) + 1n,
      );
      check(
        prefix + "expected_commit_or_rollback_state",
        outcome === "commit"
          ? after.state === "PACKET_AVAILABLE_EPHEMERAL" &&
              after.revision === before.revision + 1
          : JSON.stringify(after) === JSON.stringify(before),
      );
      if (outcome === "rollback")
        check(
          prefix + "original_rollback_error_preserved",
          !oldResult.ok && oldResult.error === rollbackError,
        );
      else
        check(
          prefix + "no_unexpected_old_submit_error",
          oldResult.ok || errorCode(oldResult.error) === "TRANSFER_CONFLICT",
        );
      const startCount = businessSql;
      const actions: { name: string; run: () => Promise<unknown> }[] = [
        {
          name: "create",
          run: () =>
            first.repository.create({
              principal: recipient,
              request: makeRequest(requestId),
              now: clock(),
            }),
        },
        {
          name: "read",
          run: () =>
            first.repository.read({
              principal: recipient,
              requestId,
              now: clock(),
            }),
        },
        {
          name: "readForSource",
          run: () =>
            first.repository.readForSource({
              principal: source,
              requestId,
              now: clock(),
            }),
        },
        {
          name: "listForSource",
          run: () =>
            first.repository.listForSource({ principal: source, now: clock() }),
        },
        {
          name: "markSourceSeen",
          run: () =>
            first.repository.markSourceSeen({
              principal: source,
              requestId,
              now: clock(),
            }),
        },
        {
          name: "markPacketAvailable",
          run: () =>
            first.repository.markPacketAvailable({
              principal: source,
              requestId,
              now: clock(),
            }),
        },
        {
          name: "markDelivered",
          run: () =>
            first.repository.markDelivered({
              principal: recipient,
              requestId,
              now: clock(),
            }),
        },
        {
          name: "acknowledge",
          run: () =>
            first.repository.acknowledge({
              principal: recipient,
              ack: {
                requestId,
                packetId: randomUUID(),
                importDecision: "IMPORTED",
              },
              now: clock(),
            }),
        },
        {
          name: "cancel",
          run: () =>
            first.repository.cancel({
              principal: recipient,
              requestId,
              now: clock(),
            }),
        },
        { name: "expireDue", run: () => first.repository.expireDue(clock()) },
      ];
      for (const action of actions) {
        const result = await settled(action.run());
        check(
          prefix + "stale_" + action.name + "_denied_before_business_SQL",
          !result.ok &&
            errorCode(result.error) === "TRANSFER_CONFLICT" &&
            businessSql === startCount,
        );
      }
      const staleService = await settled(serviceA.read(recipient, requestId));
      check(
        prefix + "stale_service_clears_own_relay",
        !staleService.ok &&
          errorCode(staleService.error) === "TRANSFER_CONFLICT" &&
          relayA.statsForTests().packets === 0 &&
          relayA.statsForTests().reserved === 0,
      );
      check(
        prefix + "stale_attempts_do_not_change_committed_row",
        JSON.stringify(await row(requestId)) === JSON.stringify(after),
      );
      const relayB = new EphemeralTransferRelay();
      const serviceB = new CredentialTransferService(
        next.repository,
        relayB,
        clock,
        () => next.isActive(),
      );
      services.push(serviceB);
      const unavailable = await settled(serviceB.receive(recipient, requestId));
      check(
        prefix + "new_owner_does_not_invent_old_packet",
        !unavailable.ok && errorCode(unavailable.error) === "SOURCE_OFFLINE",
      );
      await serviceB.sourceSeen(source, requestId);
      const packetId = randomUUID();
      await serviceB.submit(source, {
        requestId,
        packetId,
        envelope: "synthetic-new-r16",
      });
      const received = await serviceB.receive(recipient, requestId);
      check(
        prefix + "new_owner_uses_its_own_packet",
        received.packetId === packetId &&
          received.envelope === "synthetic-new-r16",
      );
      const completed = await serviceB.acknowledge(recipient, {
        requestId,
        packetId,
        importDecision: "IMPORTED",
      });
      check(
        prefix + "new_owner_completes_against_real_DB",
        completed.state === "COMPLETED" &&
          JSON.stringify(await row(requestId)) ===
            JSON.stringify({
              state: completed.state,
              revision: completed.revision,
            }),
      );
      const replay = await settled(
        serviceB.acknowledge(recipient, {
          requestId,
          packetId,
          importDecision: "IMPORTED",
        }),
      );
      check(
        prefix + "new_owner_ACK_replay_refused",
        !replay.ok && errorCode(replay.error) === "TRANSFER_REPLAY",
      );
      check(
        prefix + "new_relay_empty_after_ACK",
        relayB.statsForTests().packets === 0 &&
          relayB.statsForTests().reserved === 0,
      );
      const contexts = await observer.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM octoport_transfer_fence.authorized_transactions",
      );
      check(
        prefix + "transaction_context_not_retained",
        contexts.rows[0]?.n === "0",
      );
      observations.push({
        outcome,
        oldEpoch,
        newEpoch,
        blockedByOldBackend: blockObserved,
        oldSubmitOutcome: oldResult.ok
          ? "RETURNED_AFTER_PRE_SWITCH_COMMIT"
          : String(errorCode(oldResult.error)),
      });
      serviceA.stop();
      serviceB.stop();
    }
  } catch (error) {
    capture(error);
  } finally {
    for (const release of releases) release();
    for (const service of services) service.stop();
    await cleanupStep("all_started_operations_settled", async () => {
      await bounded(
        Promise.allSettled(pending),
        "HANDOFF_PENDING_CLEANUP_TIMEOUT",
      );
      return true;
    });
    await cleanupStep("own_transfer_rows_removed", async () => {
      if (latest?.isActive())
        await latest.transaction((tx) =>
          tx.query(
            "DELETE FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
            [requestIds],
          ),
        );
      const r = await observer.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
        [requestIds],
      );
      return r.rows[0]?.n === "0";
    });
    await cleanupStep("own_seed_rows_removed", async () => {
      if (cleanup.own_transfer_rows_removed)
        await observer.transaction(async (tx) => {
          await tx.query(
            "DELETE FROM public.devices WHERE id=ANY($1::uuid[])",
            [[recipientId, sourceId]],
          );
          await tx.query("DELETE FROM public.accounts WHERE id=$1", [
            accountId,
          ]);
          await tx.query("DELETE FROM public.users WHERE id=$1", [userId]);
        });
      const r = await observer.query<{ n: string }>(
        "SELECT ((SELECT count(*) FROM public.devices WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM public.accounts WHERE id=$2)+(SELECT count(*) FROM public.users WHERE id=$3))::text AS n",
        [[recipientId, sourceId], accountId, userId],
      );
      return r.rows[0]?.n === "0";
    });
    for (const [i, authority] of authorities.entries())
      await cleanupStep("test_authority_" + i + "_disposed", async () => {
        try {
          await authority.dispose();
        } catch (error) {
          capture(error);
          await authority.dispose();
        }
        const r = await observer.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM pg_roles WHERE rolname=$1",
          [authority.role],
        );
        return r.rows[0]?.n === "0";
      });
    await cleanupStep("context_empty_journal49_preserved", async () => {
      const r = await observer.query<{ journal: string; contexts: string }>(
        "SELECT (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS journal,(SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS contexts",
      );
      return r.rows[0]?.journal === "49" && r.rows[0]?.contexts === "0";
    });
    for (const [name, pool] of [
      ["first", firstPool],
      ["next", nextPool],
      ["observer", observer],
    ] as const)
      await cleanupStep(name + "_pool_closed", async () => {
        await pool.close();
        return true;
      });
  }
  return {
    kind: "C06_R16_ACTUAL_TWO_POOL_EPOCH_HANDOFF",
    verdict:
      failures.length === 0 &&
      observations.length === 2 &&
      checks.every((x) => x.passed) &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_TWO_POOL_EPOCH_HANDOFF"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed: checks.filter((x) => x.passed).length,
    checks,
    observations,
    cleanup,
    failureTypes: failures,
    limits: [
      "Two independent actual PostgreSQL pools and product service/repository instances, not two OS API processes or a pooler",
      "Explicit test SESSION AUTHORIZATION using temporary NOLOGIN roles; no new LOGIN/password/HBA or live changes",
      "A transaction admitted before handoff may finish before election and its already-committed result may arrive later; this proof does not promise network response cancellation",
      "No process restart, pre-ACK restart, old binary, partition, restore/rollback or complete original four-P1 acceptance",
      "Only owned synthetic records; monotonic writer epoch advances as in existing C proofs and is not reset",
    ],
  };
}
