import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createDatabaseRuntime } from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { startTransferProcess } from "./helpers/credential-transfer-process-client.js";
import {
  waitForPgBackendExit,
  type PgBackendIdentity,
} from "./helpers/wait-for-pg-backend-exit.js";
import {
  prepareRecipientRelayRuntime,
  proveRecipientRelayRecovery,
  type RecipientRelayStage,
} from "./helpers/credential-transfer-recipient-relay.js";

const connectionString = process.env.DATABASE_URL;
requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL is required");

// Actual PostgreSQL plus two sequential API OS processes with distinct relays.
// Each process must exit before the next begins. Requests use private IPC and
// app.inject; browser persistence is synthetic, not installed or HTTP proof.
// The same test authority uses SESSION AUTHORIZATION, not a network login.
it("preserves imported P1 across two API OS processes before ACK and retires it only after authenticated expiry", async () => {
  await runMigrations({ connectionString });
  const observer = createDatabaseRuntime(connectionString);
  const closed = new Set<ReturnType<typeof createDatabaseRuntime>>();
  type ApiProcess = Awaited<ReturnType<typeof startTransferProcess>>;
  const processes: ApiProcess[] = [];
  let current: ApiProcess | undefined;
  let fixture:
    | Awaited<ReturnType<typeof prepareRecipientRelayRuntime>>
    | undefined;
  const userId = randomUUID(),
    accountId = randomUUID(),
    foreignAccountId = randomUUID();
  const recipient = {
    accountId,
    deviceId: randomUUID(),
    sessionId: randomUUID(),
  };
  const source = { accountId, deviceId: randomUUID(), sessionId: randomUUID() };
  const foreign = {
    accountId: foreignAccountId,
    deviceId: randomUUID(),
    sessionId: randomUUID(),
  };
  const identities = [recipient, source, foreign];
  const errors: unknown[] = [];
  const stages: RecipientRelayStage[] = [];
  let stoppedRow: { state: string; revision: number } | undefined;
  let epochBefore = "";
  let processCount = 0;
  let originalProcessId: number | undefined;
  let originalBackend: PgBackendIdentity | undefined;
  async function closePool(pool: ReturnType<typeof createDatabaseRuntime>) {
    if (closed.has(pool)) return;
    await pool.close();
    closed.add(pool);
  }
  async function cleanup(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await observer.ready();
    const journal = await observer.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    expect(journal.rows[0]?.n).toBe("52");
    await observer.transaction(async (tx) => {
      await tx.query("INSERT INTO public.users(id) VALUES($1)", [userId]);
      await tx.query("INSERT INTO public.accounts(id) VALUES($1),($2)", [
        accountId,
        foreignAccountId,
      ]);
      for (const identity of identities) {
        await tx.query(
          "INSERT INTO public.devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','0.2.42')",
          [identity.deviceId, identity.accountId, userId],
        );
        await tx.query(
          "INSERT INTO public.sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
          [
            identity.sessionId,
            identity.deviceId,
            identity.accountId,
            randomUUID(),
          ],
        );
      }
    });
    fixture = await prepareRecipientRelayRuntime();
    const result = await proveRecipientRelayRecovery(fixture, {
      recipient,
      source,
      foreign,
      async nextApi(context) {
        expect(processCount).toBeLessThan(2);
        if (current) {
          // The first API/relay has stopped. Close its test authority and pool,
          // then confirm the owned OS process and exact backend both exited.
          await current.close();
          await waitForPgBackendExit(
            async (backend) =>
              observer.transaction(async (tx) => {
                await tx.query("SET LOCAL statement_timeout='500ms'");
                const old = await tx.query<{ n: string }>(
                  "SELECT count(*)::text AS n FROM pg_stat_activity WHERE pid=$1 AND backend_start::text=$2",
                  [backend.pid, backend.startedAt],
                );
                expect(old.rows).toHaveLength(1);
                expect(["0", "1"]).toContain(old.rows[0]!.n);
                return old.rows[0]!.n === "1";
              }),
            originalBackend!,
          );
        }
        const child = await startTransferProcess(
          context,
          accountId,
          connectionString,
        );
        processes.push(child);
        current = child;
        processCount++;
        const epoch = await observer.query<{ epoch: string }>(
          "SELECT epoch::text FROM octoport_transfer_fence.writer_epoch WHERE singleton_id=1",
        );
        expect(epoch.rows[0]?.epoch).toBe(child.ready.epoch);
        expect(child.ready.pid).not.toBe(process.pid);
        if (processCount === 1) {
          originalBackend = child.ready.backend;
          originalProcessId = child.ready.pid;
          epochBefore = child.ready.epoch;
        } else {
          expect(child.ready.pid).not.toBe(originalProcessId);
          expect(child.ready.backend.pid).not.toBe(originalBackend!.pid);
          expect(BigInt(child.ready.epoch)).toBeGreaterThan(
            BigInt(epochBefore),
          );
        }
        return child.api;
      },
      async observe(stage, requestId) {
        const read = await observer.query<{ state: string; revision: number }>(
          "SELECT state,revision FROM public.credential_transfer_requests WHERE request_id=$1 AND account_id=$2 AND recipient_device_id=$3",
          [requestId, accountId, recipient.deviceId],
        );
        expect(read.rows).toHaveLength(1);
        const row = read.rows[0]!;
        const expected = {
          created: "REQUESTED",
          imported: "DELIVERED_TO_RECIPIENT",
          stopped: "DELIVERED_TO_RECIPIENT",
          restarted: "DELIVERED_TO_RECIPIENT",
          replacement: "PACKET_AVAILABLE_EPHEMERAL",
          terminal: "EXPIRED",
        } as const;
        expect(row.state).toBe(expected[stage]);
        if (stage === "stopped") stoppedRow = row;
        if (stage === "restarted") expect(row).toEqual(stoppedRow);
        stages.push(stage);
      },
    });
    expect(result.verdict).toBe("IMPORTED_P1_PRESERVED_TERMINAL_EXPIRED");
    expect(stages).toEqual([
      "created",
      "imported",
      "stopped",
      "restarted",
      "replacement",
      "terminal",
    ]);
    expect(processCount).toBe(2);
  } catch (error) {
    errors.push(error);
  } finally {
    // Only this test's UUID-bound records are removed. A missing active fence
    // cannot be bypassed by deleting transfer rows as the administrator.
    let transferRowsRemoved = false;
    await cleanup(async () => {
      if (current) await current.cleanupTransfers();
      const remaining = await observer.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE account_id=$1",
        [accountId],
      );
      expect(remaining.rows[0]?.n).toBe("0");
      transferRowsRemoved = true;
    });
    await cleanup(async () => {
      expect(transferRowsRemoved).toBe(true);
      await observer.transaction(async (tx) => {
        await tx.query("DELETE FROM public.sessions WHERE id=ANY($1::uuid[])", [
          identities.map((x) => x.sessionId),
        ]);
        await tx.query("DELETE FROM public.devices WHERE id=ANY($1::uuid[])", [
          identities.map((x) => x.deviceId),
        ]);
        await tx.query("DELETE FROM public.accounts WHERE id=ANY($1::uuid[])", [
          [accountId, foreignAccountId],
        ]);
        await tx.query("DELETE FROM public.users WHERE id=$1", [userId]);
      });
      const remaining = await observer.query<{ n: string }>(
        "SELECT ((SELECT count(*) FROM public.sessions WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM public.devices WHERE id=ANY($2::uuid[]))+(SELECT count(*) FROM public.accounts WHERE id=ANY($3::uuid[]))+(SELECT count(*) FROM public.users WHERE id=$4))::text AS n",
        [
          identities.map((x) => x.sessionId),
          identities.map((x) => x.deviceId),
          [accountId, foreignAccountId],
          userId,
        ],
      );
      expect(remaining.rows[0]?.n).toBe("0");
    });
    for (const child of processes) await cleanup(() => child.close());
    await cleanup(async () => {
      const row = await observer.query<{ journal: string; contexts: string }>(
        "SELECT (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS journal,(SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS contexts",
      );
      expect(row.rows[0]).toEqual({ journal: "52", contexts: "0" });
    });
    await cleanup(() => closePool(observer));
    fixture?.dispose();
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "TRANSFER_RECIPIENT_PROCESS_COMPOSITION_FAILED",
    );
}, 90_000);
