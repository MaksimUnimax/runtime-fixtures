import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";
import {
  prepareRecipientRelayRuntime,
  proveRecipientRelayRecovery,
  type RecipientRelayStage,
} from "./helpers/credential-transfer-recipient-relay.js";

const connectionString = process.env.DATABASE_URL;
const database = requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL is required");

// Actual migrated PostgreSQL, limited-role fenced repositories and independent
// pools. Browser persistence is synthetic; API instances share this process.
// The existing test authority uses SESSION AUTHORIZATION, not a network login.
it("preserves imported P1 through a pre-ACK PG-pool replacement and authenticated expiry despite P2", async () => {
  await runMigrations({ connectionString });
  const observer = createDatabaseRuntime(connectionString);
  const firstPool = createDatabaseRuntime(connectionString);
  const nextPool = createDatabaseRuntime(connectionString);
  const closed = new Set<ReturnType<typeof createDatabaseRuntime>>();
  type Authority = Awaited<
    ReturnType<typeof createCredentialTransferTestAuthority>
  >;
  const authorities: Authority[] = [];
  let current: Authority | undefined;
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
  let repositoryCount = 0;
  let originalBackend = 0;
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
      authRepository: createExtensionAuthRepository(observer),
      async nextRepository() {
        expect(repositoryCount).toBeLessThan(2);
        const pool = repositoryCount++ === 0 ? firstPool : nextPool;
        if (current) {
          // All previous requests and application close have settled. Retire
          // the old authority and close its actual pool before replacement.
          await current.dispose();
          await closePool(firstPool);
          const old = await observer.query<{ n: string }>(
            "SELECT count(*)::text AS n FROM pg_stat_activity WHERE pid=$1",
            [originalBackend],
          );
          expect(old.rows[0]?.n).toBe("0");
        }
        const authority = await createCredentialTransferTestAuthority(
          pool,
          database,
        );
        authorities.push(authority);
        current = authority;
        const backend = await pool.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        const epoch = await observer.query<{ epoch: string }>(
          "SELECT epoch::text FROM octoport_transfer_fence.writer_epoch WHERE singleton_id=1",
        );
        if (repositoryCount === 1) {
          originalBackend = backend.rows[0]!.pid;
          epochBefore = epoch.rows[0]!.epoch;
        } else {
          expect(backend.rows[0]!.pid).not.toBe(originalBackend);
          expect(BigInt(epoch.rows[0]!.epoch)).toBeGreaterThan(
            BigInt(epochBefore),
          );
        }
        return {
          repository: authority.repository,
          isAvailable: authority.isActive,
        };
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
    expect(repositoryCount).toBe(2);
  } catch (error) {
    errors.push(error);
  } finally {
    // Only this test's UUID-bound records are removed. A missing active fence
    // cannot be bypassed by deleting transfer rows as the administrator.
    let transferRowsRemoved = false;
    await cleanup(async () => {
      if (current?.isActive())
        await current.transaction((tx) =>
          tx.query(
            "DELETE FROM public.credential_transfer_requests WHERE account_id=$1",
            [accountId],
          ),
        );
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
    for (const authority of authorities)
      await cleanup(() => authority.dispose());
    await cleanup(async () => {
      const row = await observer.query<{ journal: string; contexts: string }>(
        "SELECT (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS journal,(SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS contexts",
      );
      expect(row.rows[0]).toEqual({ journal: "52", contexts: "0" });
    });
    for (const pool of [firstPool, nextPool, observer])
      await cleanup(() => closePool(pool));
    fixture?.dispose();
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "TRANSFER_RECIPIENT_PG_COMPOSITION_FAILED",
    );
}, 60_000);
