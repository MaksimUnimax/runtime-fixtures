// Disposable integration fixture only. Each invocation owns one API, relay,
// fenced test authority and pool. No listener or live service is started.
import { createApiApp } from "../../../../apps/api/src/app.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
} from "../../../../packages/server/db/src/index.js";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
} from "../../../../packages/server/credential-transfer/src/index.js";
import {
  deriveExtensionAuthKeys,
  ExtensionAuthService,
  loadAccessTokenSigningKey,
  type ExtensionPrincipal,
} from "../../../../packages/server/extension-auth/src/index.js";
import { requireI1DisposableDatabase } from "../../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { createCredentialTransferTestAuthority } from "./credential-transfer-test-authority.js";
import type { RecipientRelayApi } from "./credential-transfer-recipient-relay.js";

export type ProcessInit = {
  accountId: string;
  now: number;
  signingKey: string;
  keyId: string;
};
export type ProcessReady = {
  pid: number;
  backend: { pid: number; startedAt: string };
  epoch: string;
};
export type ProcessRequest = {
  id: number;
  kind: "init" | "inject" | "time" | "state" | "stop" | "cleanup" | "close";
  payload?: unknown;
};
export type ProcessReply =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; code: string };

const connectionString = process.env.DATABASE_URL;
const database = requireI1DisposableDatabase(connectionString);
if (!connectionString || !process.send)
  throw new Error("TRANSFER_PROCESS_FIXTURE_CONFIGURATION_REQUIRED");
const pool = createDatabaseRuntime(connectionString);
let authority:
  | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
  | undefined;
let app: ReturnType<typeof createApiApp> | undefined;
let service: CredentialTransferService | undefined;
let accountId: string | undefined;
let now = 0;
let stopped: Promise<void> | undefined;
let closing: Promise<void> | undefined;
async function stop() {
  stopped ??= (async () => {
    await service?.stop();
    await app?.close();
  })();
  return stopped;
}
async function close() {
  closing ??= (async () => {
    const errors: unknown[] = [];
    for (const cleanup of [
      stop,
      async () => authority?.dispose(),
      () => pool.close(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "TRANSFER_PROCESS_CLEANUP_FAILED");
  })();
  return closing;
}
async function handle(message: ProcessRequest): Promise<unknown> {
  if (message.kind === "init") {
    if (authority || app || accountId || closing)
      throw new Error("TRANSFER_PROCESS_ALREADY_INITIALIZED");
    const input = message.payload as ProcessInit;
    if (
      !/^[a-f0-9-]{36}$/.test(input.accountId) ||
      !Number.isSafeInteger(input.now)
    )
      throw new Error("TRANSFER_PROCESS_BAD_INIT");
    accountId = input.accountId;
    now = input.now;
    const signing = loadAccessTokenSigningKey({
      ACCESS_TOKEN_SIGNING_PRIVATE_KEY_PEM_B64: input.signingKey,
      ACCESS_TOKEN_SIGNING_KEY_ID: input.keyId,
    });
    authority = await createCredentialTransferTestAuthority(pool, database);
    service = new CredentialTransferService(
      authority.repository,
      new EphemeralTransferRelay(),
      () => new Date(now),
      authority.isActive,
    );
    app = createApiApp({
      config: {
        environment: "test",
        databaseUrl: "postgres://fixture@localhost:5432/unused_process",
        logLevel: "fatal",
        apiPort: 0,
        workerReadyDelayMs: 0,
      },
      isInfrastructureReady: async () => true,
      credentialTransferService: service,
      extensionAuthService: new ExtensionAuthService(
        createExtensionAuthRepository(pool),
        deriveExtensionAuthKeys(Buffer.alloc(32, 31)),
        () => new Date(now),
        signing,
      ),
    });
    await app.ready();
    const row = await pool.query<{ pid: number; started_at: string }>(
      "SELECT pid,backend_start::text AS started_at FROM pg_stat_activity WHERE pid=pg_backend_pid()",
    );
    const epoch = await pool.query<{ epoch: string }>(
      "SELECT epoch::text FROM octoport_transfer_fence.writer_epoch WHERE singleton_id=1",
    );
    if (row.rows.length !== 1 || epoch.rows.length !== 1)
      throw new Error("TRANSFER_PROCESS_BAD_IDENTITY");
    return {
      pid: process.pid,
      backend: { pid: row.rows[0]!.pid, startedAt: row.rows[0]!.started_at },
      epoch: epoch.rows[0]!.epoch,
    } satisfies ProcessReady;
  }
  if (message.kind === "close") {
    await close();
    return null;
  }
  if (!app || !authority || !accountId || closing)
    throw new Error("TRANSFER_PROCESS_NOT_READY");
  if (message.kind === "stop") {
    await stop();
    return null;
  }
  if (message.kind === "cleanup") {
    if (!authority.isActive())
      throw new Error("TRANSFER_PROCESS_CLEANUP_FENCE_INACTIVE");
    await authority.transaction((tx) =>
      tx.query(
        "DELETE FROM public.credential_transfer_requests WHERE account_id=$1",
        [accountId],
      ),
    );
    return null;
  }
  if (stopped) throw new Error("TRANSFER_PROCESS_API_STOPPED");
  if (message.kind === "inject") {
    const input = message.payload as Parameters<RecipientRelayApi["inject"]>[0];
    if (
      !/^\/v1\/credential-transfers(?:\/[a-f0-9-]{36}(?:\/(?:packet|ack|source-seen))?)?$/.test(
        input.url,
      )
    )
      throw new Error("TRANSFER_PROCESS_ROUTE_DENIED");
    const result = await app.inject(input);
    return { statusCode: result.statusCode, body: result.body };
  }
  if (message.kind === "time") {
    if (!Number.isSafeInteger(message.payload) || Number(message.payload) < now)
      throw new Error("TRANSFER_PROCESS_BAD_TIME");
    now = Number(message.payload);
    return null;
  }
  if (message.kind === "state") {
    const input = message.payload as {
      requestId: string;
      principal: ExtensionPrincipal;
      now: number;
    };
    if (input.principal.accountId !== accountId || input.now !== now)
      throw new Error("TRANSFER_PROCESS_BAD_STATE_READ");
    return (
      (await authority.repository.read({ ...input, now: new Date(now) }))
        ?.state ?? null
    );
  }
  throw new Error("TRANSFER_PROCESS_UNKNOWN_COMMAND");
}
let queue = Promise.resolve();
process.on("message", (input: ProcessRequest) => {
  queue = queue.then(async () => {
    let reply: ProcessReply;
    try {
      reply = { id: input.id, ok: true, value: await handle(input) };
    } catch {
      reply = {
        id: input.id,
        ok: false,
        code: `TRANSFER_PROCESS_${input.kind.toUpperCase()}_FAILED`,
      };
    }
    await new Promise<void>((resolve) => {
      if (!process.connected) {
        resolve();
        return;
      }
      process.send!(reply, () => resolve());
    });
    if (input.kind === "close") {
      process.exitCode = reply.ok ? 0 : 1;
      if (process.connected) process.disconnect();
    }
  });
});
process.on("disconnect", () => {
  void close().catch(() => {
    process.exitCode = 1;
  });
});
process.on("SIGTERM", () => {
  void close().then(
    () => {
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    },
    () => {
      process.exitCode = 1;
      if (process.connected) process.disconnect();
    },
  );
});
