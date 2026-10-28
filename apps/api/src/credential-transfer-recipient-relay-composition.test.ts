import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  createMemoryTransferRepository,
} from "@product/credential-transfer";
import {
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  ExtensionAuthService,
  issueAccessToken,
  type ExtensionAuthRepository,
} from "@product/extension-auth";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

// Joint source/package proof: actual composed client, API/JWT and transfer
// service. Browser storage and the repository are explicit memory fixtures.
// Replacing service instances is not an OS restart, PostgreSQL or installed
// browser proof. No real marketplace credentials or network are used.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "octoport-transfer-joint-"));
const runtime = join(scratch, "package", "extracted");
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
let harness: Factory;
beforeAll(async () => {
  execFileSync(
    "python3",
    [
      "-B",
      "tooling/build/extension_composed.py",
      "--output",
      join(scratch, "package"),
    ],
    { cwd: root, timeout: 15_000, stdio: "pipe" },
  );
  harness = (await import(
    new URL(
      "../../../tests/regression/extension-core/worker-harness.mjs",
      import.meta.url,
    ).href
  )) as Factory;
}, 20_000);
afterAll(() => rmSync(scratch, { recursive: true }));

const uuid = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accountId = uuid(1);
const recipient = { accountId, deviceId: uuid(2), sessionId: uuid(3) };
const source = { accountId, deviceId: uuid(4), sessionId: uuid(5) };
const foreign = { accountId: uuid(6), deviceId: uuid(7), sessionId: uuid(8) };
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

it("preserves imported P1 across relay loss and P2, then retires only an authenticated terminal request", async () => {
  const clientTime = Date.now();
  let serverTime = clientTime;
  const signing = createEphemeralAccessTokenSigningKey(
    "synthetic-joint-transfer",
  );
  const identities = new Map(
    [recipient, source, foreign].map((value) => [value.sessionId, value]),
  );
  const unused = async () => {
    throw new Error("unused fixture method");
  };
  const authRepository: ExtensionAuthRepository = {
    authorize: async (id) => identities.get(id),
    consumeRefreshRate: unused,
    authorizeFromRefreshHash: unused,
    createRefresh: unused,
    rotateRefresh: unused,
  };
  const auth = new ExtensionAuthService(
    authRepository,
    deriveExtensionAuthKeys(Buffer.alloc(32, 31)),
    () => new Date(serverTime),
    signing,
  );
  const [recipientToken, sourceToken, foreignToken] = await Promise.all(
    [recipient, source, foreign].map((value) =>
      issueAccessToken(signing, value, new Date(clientTime)),
    ),
  );
  const repository = createMemoryTransferRepository();
  const services: CredentialTransferService[] = [];
  const apps: ReturnType<typeof createApiApp>[] = [];
  function nextApp() {
    const service = new CredentialTransferService(
      repository,
      new EphemeralTransferRelay(),
      () => new Date(serverTime),
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
    services.push(service);
    apps.push(app);
    return app;
  }
  let app = nextApp();
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
    harness.makeWorker(runtime, {
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
  try {
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
    const endpoint = `/v1/credential-transfers/${request.requestId}`;
    const firstPacket = uuid(9),
      secondPacket = uuid(10);
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

    // The imported vault survives a worker-instance restart. The new server
    // uses the same repository but no old relay; neither storage is a real DB.
    worker.close();
    await services[0]!.stop();
    await app.close();
    app = nextApp();
    worker = await makeRecipient(false);
    await send(endpoint + "/source-seen", {});
    await send(endpoint + "/packet", {
      requestId: request.requestId,
      packetId: secondPacket,
      envelope: await envelope(secondPacket, "P2"),
    });
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
    expect(
      (
        await repository.read({
          principal: recipient,
          requestId: request.requestId,
          now: new Date(serverTime),
        })
      )?.state,
    ).toBe("EXPIRED");
  } finally {
    worker?.close();
    for (const service of services) await service.stop();
    for (const instance of apps) await instance.close();
  }
}, 20_000);
