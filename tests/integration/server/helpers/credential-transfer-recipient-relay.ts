import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  type TransferRepository,
} from "../../../../packages/server/credential-transfer/src/index.js";
import {
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  ExtensionAuthService,
  issueAccessToken,
  type ExtensionAuthRepository,
  type ExtensionPrincipal,
  type AccessTokenSigningKey,
} from "../../../../packages/server/extension-auth/src/index.js";
import type { AppConfig } from "../../../../packages/shared/src/index.js";
import { createApiApp } from "../../../../apps/api/src/app.js";

// One actual composed-client/API scenario shared by memory and disposable-PG
// tests. The browser/IndexedDB backing remains synthetic in both consumers.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
type Worker = {
  call<T>(name: string, ...args: unknown[]): Promise<T>;
  popup<T>(message: unknown): Promise<T>;
  close(): void;
};
type Factory = {
  makeWorker: (
    directory: string,
    options: Record<string, unknown>,
  ) => Promise<Worker>;
};
export async function prepareRecipientRelayRuntime() {
  const scratch = mkdtempSync(join(tmpdir(), "octoport-transfer-joint-"));
  try {
    execFileSync(
      "python3",
      [
        "-B",
        "tooling/build/extension_composed.py",
        "--output",
        join(scratch, "package"),
      ],
      {
        cwd: root,
        timeout: 15_000,
        stdio: "pipe",
      },
    );
    const harness = (await import(
      new URL(
        "../../../regression/extension-core/worker-harness.mjs",
        import.meta.url,
      ).href
    )) as Factory;
    return {
      runtime: join(scratch, "package", "extracted"),
      harness,
      dispose: () => rmSync(scratch, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}
export type RecipientRelayStage =
  | "created"
  | "imported"
  | "stopped"
  | "restarted"
  | "replacement"
  | "terminal";
export type RecipientRelayApi = {
  inject(input: {
    method: "POST" | "GET" | "DELETE";
    url: string;
    headers: Record<string, string>;
    payload?: string | Record<string, unknown>;
  }): Promise<{ statusCode: number; body: string; json(): unknown }>;
  setTime(now: number): Promise<void>;
  readState(
    requestId: string,
    principal: ExtensionPrincipal,
    now: number,
  ): Promise<string | undefined>;
  stop(): Promise<void>;
};
export type RecipientRelayApiContext = {
  signing: AccessTokenSigningKey;
  now: number;
};
type Options = {
  recipient: ExtensionPrincipal;
  source: ExtensionPrincipal;
  foreign: ExtensionPrincipal;
  observe?: (stage: RecipientRelayStage, requestId: string) => Promise<void>;
} & (
  | {
      nextApi?: undefined;
      authRepository: ExtensionAuthRepository;
      nextRepository: () => Promise<{
        repository: TransferRepository;
        isAvailable?: () => boolean;
      }>;
    }
  | {
      nextApi: (
        context: RecipientRelayApiContext,
      ) => Promise<RecipientRelayApi>;
    }
);
type LocalRequest = {
  requestId: string;
  recipientPublicKeySpki: string;
  state: string;
};
type LocalRecord = { phase: string; packetId: string; requestId: string };
type ImportedStore = { storeId: string; [key: string]: unknown };
type Received = {
  packet: { packetId: string };
  payload: { stores: ImportedStore[] };
  importContext: unknown;
};
export async function proveRecipientRelayRecovery(
  fixture: Awaited<ReturnType<typeof prepareRecipientRelayRuntime>>,
  options: Options,
) {
  const { recipient, source, foreign } = options;
  const accountId = recipient.accountId;

  const clientTime = Date.now();
  let serverTime = clientTime;
  const signing = createEphemeralAccessTokenSigningKey(
    "synthetic-joint-transfer",
  );
  const [recipientToken, sourceToken, foreignToken] = await Promise.all(
    [recipient, source, foreign].map((value) =>
      issueAccessToken(signing, value, new Date(clientTime)),
    ),
  );
  const apps: RecipientRelayApi[] = [];
  async function nextApp(): Promise<RecipientRelayApi> {
    if (options.nextApi) {
      const api = await options.nextApi({ signing, now: serverTime });
      apps.push(api);
      return api;
    }
    const next = await options.nextRepository();
    const repository = next.repository;
    const auth = new ExtensionAuthService(
      options.authRepository,
      deriveExtensionAuthKeys(Buffer.alloc(32, 31)),
      () => new Date(serverTime),
      signing,
    );
    const service = new CredentialTransferService(
      repository,
      new EphemeralTransferRelay(),
      () => new Date(serverTime),
      next.isAvailable,
    );
    const app = createApiApp({
      config: {
        environment: "test",
        databaseUrl: "postgres://fixture@localhost:5432/unused_joint",
        logLevel: "silent" as AppConfig["logLevel"],
        apiPort: 0,
        workerReadyDelayMs: 0,
      },
      isInfrastructureReady: async () => true,
      extensionAuthService: auth,
      credentialTransferService: service,
    });
    const api: RecipientRelayApi = {
      inject: async (input) => {
        const reply = await app.inject(input);
        return {
          statusCode: reply.statusCode,
          body: reply.body,
          json: () => reply.json(),
        };
      },
      setTime: async (now) => {
        serverTime = now;
      },
      readState: async (requestId, principal, now) =>
        (await repository.read({ requestId, principal, now: new Date(now) }))
          ?.state,
      stop: async () => {
        await service.stop();
        await app.close();
      },
    };
    apps.push(api);
    return api;
  }
  let app!: RecipientRelayApi;
  let wrongReadback = false;
  const recipientPackets: string[] = [],
    ackPackets: string[] = [];
  const readbackStatuses: number[] = [];
  const backing: {
    local: Record<string, unknown>;
    session: Record<string, unknown>;
  } = { local: {}, session: {} };
  let worker: Worker | undefined;
  const fetch = async (url: string, init: RequestInit = {}) => {
    const pathname = new URL(url).pathname;
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const method = (init.method || "GET") as "POST" | "GET" | "DELETE";
    const statusRead =
      method === "GET" &&
      /^\/v1\/credential-transfers\/[a-f0-9-]+$/.test(pathname);
    if (statusRead && wrongReadback)
      headers.authorization = `Bearer ${foreignToken}`;
    if (pathname.endsWith("/packet") && method === "GET")
      recipientPackets.push(pathname);
    if (pathname.endsWith("/ack"))
      ackPackets.push(
        (JSON.parse(String(init.body)) as { packetId: string }).packetId,
      );
    const reply = await app.inject({
      method,
      url: pathname,
      headers,
      ...(init.body ? { payload: String(init.body) } : {}),
    });
    if (statusRead) readbackStatuses.push(reply.statusCode);
    return new Response(reply.body, {
      status: reply.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const makeRecipient = (seedAuthority: boolean) =>
    fixture.harness.makeWorker(fixture.runtime, {
      backing,
      accountId,
      deviceId: recipient.deviceId,
      sessionId: recipient.sessionId,
      wallClock: () => clientTime,
      seedAuthority,
      fetch,
    });
  const send = async (path: string, payload: Record<string, unknown>) => {
    const reply = await app.inject({
      method: "POST",
      url: path,
      headers: { authorization: `Bearer ${sourceToken}` },
      payload,
    });
    expect(reply.statusCode, reply.body).toBe(200);
    return reply.json();
  };
  const errors: unknown[] = [];
  let result:
    | { requestId: string; verdict: "IMPORTED_P1_PRESERVED_TERMINAL_EXPIRED" }
    | undefined;
  try {
    app = await nextApp();
    worker = await makeRecipient(true);
    worker.close();
    const localAuth = backing.local.seller_agents_control_auth_v2 as {
      credentials: { accessToken: string };
    };
    localAuth.credentials.accessToken = recipientToken!;
    worker = await makeRecipient(false);
    const request = await worker.call<LocalRequest>(
      "SellerAgentsControlClient.createCredentialTransfer",
      { consent: true, selectedStoreIds: ["joint-store"] },
    );
    await options.observe?.("created", request.requestId);
    const endpoint = `/v1/credential-transfers/${request.requestId}`;
    const firstPacket = randomUUID(),
      secondPacket = randomUUID();
    const envelope = (packetId: string, revision: string) =>
      worker!.call<string>("SellerAgentsCredentialTransferCrypto.encrypt", {
        accountId,
        requestId: request.requestId,
        sourceDeviceId: source.deviceId,
        recipientDeviceId: recipient.deviceId,
        packetId,
        recipientPublicKeySpki: request.recipientPublicKeySpki,
        payload: {
          transferPayloadVersion: "seller_agents_credential_payload_v1",
          stores: [
            {
              storeId: "joint-store",
              marketplace: "wildberries",
              name: "Joint fixture",
              credentialRevision: revision,
              metadataRevision: 0,
              providerAccountId: null,
              providerIdentityState: "UNCONFIRMED",
              lifecycleState: "ACTIVE",
              credentials: { token: `SYNTHETIC_NEVER_REAL_${revision}` },
            },
          ],
        },
      });
    await send(endpoint + "/source-seen", {});
    await send(endpoint + "/packet", {
      requestId: request.requestId,
      packetId: firstPacket,
      envelope: await envelope(firstPacket, "P1"),
    });
    const received = await worker.call<Received>(
      "SellerAgentsControlClient.receiveCredentialTransfer",
      request.requestId,
      source.deviceId,
    );
    const store = received.payload.stores[0]!;
    const imported = await worker.call<{ kind: string }>(
      "SellerAgentsActiveStoreCatalog.importCredential",
      { ...store, id: store.storeId },
      received.importContext,
    );
    expect(imported.kind).toBe("IMPORTED");
    await worker.call(
      "SellerAgentsControlClient.recordCredentialTransferImported",
      {
        requestId: request.requestId,
        packetId: firstPacket,
        results: [{ storeId: store.storeId, ...imported }],
      },
    );
    const localStores = JSON.stringify(backing.local.seller_agents_stores_v1);
    const localRecords = () =>
      worker!.call<LocalRecord[]>(
        "SellerAgentsControlClient.listCredentialTransferRecipients",
      );
    expect((await localRecords())[0]).toMatchObject({
      phase: "IMPORTED_PENDING_ACK",
      packetId: firstPacket,
    });
    expect(recipientPackets).toHaveLength(1);
    expect(ackPackets).toHaveLength(0);
    await options.observe?.("imported", request.requestId);

    // The imported vault survives a worker-instance restart. The new server
    // replaces the repository adapter and relay; the chosen fixture determines
    // whether persistence is memory or actual disposable PostgreSQL.
    worker.close();
    await app.stop();
    await options.observe?.("stopped", request.requestId);
    app = await nextApp();
    await options.observe?.("restarted", request.requestId);
    worker = await makeRecipient(false);
    await send(endpoint + "/source-seen", {});
    await send(endpoint + "/packet", {
      requestId: request.requestId,
      packetId: secondPacket,
      envelope: await envelope(secondPacket, "P2"),
    });
    await options.observe?.("replacement", request.requestId);
    const retry = await worker.popup<{
      importState: string;
      ackConfirmed: boolean;
      code: string;
    }>({ type: "SA_TRANSFER_RECEIVE_PENDING" });
    expect(retry).toMatchObject({
      importState: "IMPORTED_PENDING_ACK",
      ackConfirmed: false,
      code: "TRANSFER_ACK_UNCONFIRMED",
    });
    expect(ackPackets).toEqual([firstPacket]);
    expect(recipientPackets).toHaveLength(1);
    expect((await localRecords())[0]).toMatchObject({
      phase: "IMPORTED_PENDING_ACK",
      packetId: firstPacket,
    });
    expect(JSON.stringify(backing.local.seller_agents_stores_v1)).toBe(
      localStores,
    );

    // Server expiry can precede the local timer. A valid JWT for another
    // account still cannot provide terminal authority for this recipient.
    serverTime += 301_000;
    await app.setTime(serverTime);
    wrongReadback = true;
    const unauthenticatedTerminal = await worker.popup<{
      ackConfirmed: boolean;
    }>({ type: "SA_TRANSFER_RECEIVE_PENDING" });
    expect(unauthenticatedTerminal.ackConfirmed).toBe(false);
    expect(readbackStatuses.at(-1)).toBe(404);
    expect((await localRecords())[0]).toMatchObject({
      phase: "IMPORTED_PENDING_ACK",
      packetId: firstPacket,
    });
    wrongReadback = false;
    const terminal = await worker.popup<{
      importState: string;
      ackConfirmed: boolean;
      code: string;
    }>({ type: "SA_TRANSFER_RECEIVE_PENDING" });
    expect(terminal).toMatchObject({
      importState: "EXPIRED",
      ackConfirmed: false,
      code: "TRANSFER_EXPIRED",
    });
    expect(readbackStatuses.at(-1)).toBe(200);
    expect(await localRecords()).toEqual([]);
    expect(ackPackets.every((id) => id === firstPacket)).toBe(true);
    expect(recipientPackets).toHaveLength(1);
    expect(JSON.stringify(backing.local.seller_agents_stores_v1)).toBe(
      localStores,
    );
    expect(await app.readState(request.requestId, recipient, serverTime)).toBe(
      "EXPIRED",
    );
    await options.observe?.("terminal", request.requestId);
    result = {
      requestId: request.requestId,
      verdict: "IMPORTED_P1_PRESERVED_TERMINAL_EXPIRED" as const,
    };
  } catch (error) {
    errors.push(error);
  } finally {
    worker?.close();
    const results = await Promise.allSettled(
      apps.map((instance) => instance.stop()),
    );
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    errors.push(...failures.map((r) => r.reason));
  }
  if (errors.length)
    throw new AggregateError(errors, "TRANSFER_RECIPIENT_SCENARIO_FAILED");
  if (!result) throw new Error("TRANSFER_RECIPIENT_SCENARIO_NO_RESULT");
  return result;
}
