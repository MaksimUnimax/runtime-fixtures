import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabaseRuntime } from "../../../packages/server/db/src/index.js";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  type TransferRepository,
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
async function bounded<T>(value: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 6_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Real PG COMMIT with a held application continuation; no network partition simulation. */
export async function proveCredentialTransferLateStop(
  connectionString: string,
) {
  const expectedDatabase = requireI1DisposableDatabase(connectionString);
  const db = createDatabaseRuntime(connectionString);
  const account = randomUUID(),
    user = randomUUID(),
    recipientId = randomUUID(),
    sourceId = randomUUID();
  const recipient = {
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
  const services: CredentialTransferService[] = [];
  const releases: (() => void)[] = [];
  const pending: Promise<unknown>[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  const cleanup: Record<string, boolean> = {};
  const failures: string[] = [];
  let authority:
    | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
    | undefined;
  function check(name: string, value: boolean) {
    checks.push({ name, passed: value });
    assert.equal(value, true, name);
  }
  function capture(error: unknown) {
    failures.push(error instanceof Error ? error.name : typeof error);
  }
  async function cleanupStep(name: string, action: () => Promise<boolean>) {
    try {
      cleanup[name] = await action();
    } catch (error) {
      cleanup[name] = false;
      capture(error);
    }
  }
  try {
    await db.ready();
    const journal = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    check("actual_migrated51_required", journal.rows[0]?.n === "51");
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.users(id) VALUES($1)", [user]);
      await tx.query("INSERT INTO public.accounts(id) VALUES($1)", [account]);
      await tx.query(
        "INSERT INTO public.devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$3,$4,'chrome','0.2.21'),($2,$3,$4,'chrome','0.2.21')",
        [recipientId, sourceId, account, user],
      );
    });
    authority = await createCredentialTransferTestAuthority(
      db,
      expectedDatabase,
    );
    const current = authority;
    const stages = [
      { method: "markPacketAvailable", state: "PACKET_AVAILABLE_EPHEMERAL" },
      { method: "markDelivered", state: "DELIVERED_TO_RECIPIENT" },
      { method: "acknowledge", state: "COMPLETED" },
    ] as const;
    for (const [index, stage] of stages.entries()) {
      const requestId = ids[index]!;
      const packetId = randomUUID();
      const clock = () => new Date("2000-01-01T00:00:00.000Z");
      let allowed = true,
        armed = false,
        calls = 0;
      const entered = deferred(),
        release = deferred();
      releases.push(release.resolve);
      const repository = new Proxy(current.repository, {
        get(target, name: keyof TransferRepository) {
          const method = target[name];
          return async (...args: unknown[]) => {
            const value = await Reflect.apply(method, target, args);
            if (armed && name === stage.method) {
              calls++;
              entered.resolve();
              await release.promise;
            }
            return value;
          };
        },
      });
      const relay = new EphemeralTransferRelay();
      const service = new CredentialTransferService(
        repository,
        relay,
        clock,
        () => allowed && current.isActive(),
      );
      services.push(service);
      await service.create(recipient, {
        requestId,
        recipientDeviceId: recipientId,
        sourceDeviceId: sourceId,
        recipientPublicKeySpki: "A".repeat(128),
        selectedStores: [{ storeId: "synthetic-r13" }],
        consent: true,
        expiresInSeconds: 300,
      });
      await service.sourceSeen(source, requestId);
      const packet = { requestId, packetId, envelope: "opaque-synthetic-r13" };
      if (stage.method !== "markPacketAvailable")
        await service.submit(source, packet);
      if (stage.method === "acknowledge")
        await service.receive(recipient, requestId);
      armed = true;
      const action =
        stage.method === "markPacketAvailable"
          ? service.submit(source, packet)
          : stage.method === "markDelivered"
            ? service.receive(recipient, requestId)
            : service.acknowledge(recipient, {
                requestId,
                packetId,
                importDecision: "IMPORTED",
              });
      const result = action.then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error }),
      );
      pending.push(result);
      await bounded(
        Promise.race([
          entered.promise,
          result.then(() => {
            throw new Error("EXPECTED_COMMITTED_GATE_NOT_ENTERED");
          }),
        ]),
        "COMMITTED_GATE_TIMEOUT",
      );
      const before = await db.query<{ state: string; revision: number }>(
        "SELECT state,revision FROM public.credential_transfer_requests WHERE request_id=$1",
        [requestId],
      );
      check(
        stage.method + "_visible_to_later_pool_query_before_stop",
        before.rows[0]?.state === stage.state,
      );
      allowed = false;
      service.stop();
      check(
        stage.method + "_relay_cleared_synchronously",
        relay.statsForTests().packets === 0 &&
          relay.statsForTests().reserved === 0,
      );
      release.resolve();
      const observed = await bounded(result, "LATE_RESULT_TIMEOUT");
      check(
        stage.method + "_late_result_rejected",
        observed.error?.code === "TRANSFER_CONFLICT" &&
          observed.value === undefined,
      );
      check(stage.method + "_no_repeated_mutation", calls === 1);
      const after = await db.query<{ state: string; revision: number }>(
        "SELECT state,revision FROM public.credential_transfer_requests WHERE request_id=$1",
        [requestId],
      );
      check(
        stage.method + "_committed_state_and_revision_not_rolled_back",
        JSON.stringify(after.rows) === JSON.stringify(before.rows),
      );
      const context = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM octoport_transfer_fence.authorized_transactions",
      );
      check(
        stage.method + "_transaction_context_empty",
        context.rows[0]?.n === "0",
      );
    }
  } catch (error) {
    capture(error);
  } finally {
    for (const release of releases) release();
    for (const service of services) service.stop();
    await cleanupStep("pending_operations_settled", async () => {
      await bounded(Promise.allSettled(pending), "CLEANUP_PENDING_TIMEOUT");
      return true;
    });
    await cleanupStep("own_requests_absent", async () => {
      if (authority?.isActive())
        await authority.transaction((tx) =>
          tx.query(
            "DELETE FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
            [ids],
          ),
        );
      const left = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
        [ids],
      );
      return left.rows[0]?.n === "0";
    });
    await cleanupStep("own_seed_rows_absent", async () => {
      if (cleanup.own_requests_absent)
        await db.transaction(async (tx) => {
          await tx.query(
            "DELETE FROM public.devices WHERE id=ANY($1::uuid[])",
            [[recipientId, sourceId]],
          );
          await tx.query("DELETE FROM public.accounts WHERE id=$1", [account]);
          await tx.query("DELETE FROM public.users WHERE id=$1", [user]);
        });
      const left = await db.query<{ n: string }>(
        "SELECT ((SELECT count(*) FROM public.devices WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM public.accounts WHERE id=$2)+(SELECT count(*) FROM public.users WHERE id=$3))::text AS n",
        [[recipientId, sourceId], account, user],
      );
      return left.rows[0]?.n === "0";
    });
    await cleanupStep("own_role_absent", async () => {
      await authority?.dispose();
      const left = await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_roles WHERE rolname=$1",
        [authority?.role ?? ""],
      );
      return left.rows[0]?.n === "0";
    });
    await cleanupStep("context_empty_and_journal51_preserved", async () => {
      const row = await db.query<{ context: string; migrations: string }>(
        "SELECT (SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS context,(SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS migrations",
      );
      return row.rows[0]?.context === "0" && row.rows[0]?.migrations === "51";
    });
    await cleanupStep("database_closed", async () => {
      await db.close();
      return true;
    });
  }
  return {
    kind: "C06_R13_LATE_STOP_COMMITTED_NATIVE",
    verdict:
      failures.length === 0 &&
      checks.length === 19 &&
      checks.every((x) => x.passed) &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_LATE_STOP_AFTER_PG_COMMIT"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed: checks.filter((x) => x.passed).length,
    checks,
    cleanup,
    failureTypes: failures,
    limits: [
      "Actual PG COMMIT; application continuation deliberately delayed, not a network proxy",
      "Explicit test-only SESSION AUTHORIZATION; no new runtime LOGIN provisioned",
      "Packets here are opaque synthetic values, no marketplace credentials or owner browser",
      "No actual old process, partition/pooler, restore, live deployment or complete four-P1 acceptance",
    ],
  };
}
