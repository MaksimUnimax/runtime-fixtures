/**
 * A02+B03 source integration, deliberately without PostgreSQL, a live API or a browser.
 * B03 production CredentialTransferService/repository state machine is real; its
 * durable adapter is an in-memory test repository. A02 packaged worker is real.
 * These assertions DO NOT certify PostgreSQL, INSTALLED or LIVE_OWNER.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeWorker } from "../worker-harness.mjs";
import {
  CredentialTransferService,
  createMemoryTransferRepository,
} from "../../../../packages/server/credential-transfer/src/index.ts";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";
const SOURCE = "44444444-4444-4444-8444-444444444444";
const PACKET = "55555555-5555-4555-8555-555555555555";
const STORE = "a02-b03-test-store";
const principal = (deviceId: string) => ({
  accountId: ACCOUNT,
  deviceId,
  sessionId:
    deviceId === SOURCE
      ? "66666666-6666-4666-8666-666666666666"
      : "77777777-7777-4777-8777-777777777777",
});
const runtime = process.env.SA_A02_B03_MAIN_RUNTIME;
if (!runtime)
  throw new Error(
    "SA_A02_B03_MAIN_RUNTIME must be the exact clean-main build/runtime",
  );
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function fixtureVault() {
  const records = new Map<string, any>();
  const copy = (value: any) =>
    value === undefined ? undefined : structuredClone(value);
  return {
    records,
    indexedDB: {
      open() {
        const open: any = {};
        queueMicrotask(() => {
          open.result = {
            objectStoreNames: { contains: () => true },
            close() {},
            transaction() {
              const tx: any = {};
              const op = (kind: string, value: any) => {
                const req: any = {};
                queueMicrotask(() => {
                  if (kind === "get") req.result = copy(records.get(value));
                  if (kind === "all")
                    req.result = [...records.values()].map(copy);
                  if (kind === "put") {
                    records.set(value.requestId, copy(value));
                    req.result = value.requestId;
                  }
                  if (kind === "delete") records.delete(value);
                  if (kind === "clear") records.clear();
                  req.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return req;
              };
              tx.objectStore = () => ({
                get: (key: string) => op("get", key),
                getAll: () => op("all", null),
                put: (row: any) => op("put", row),
                delete: (key: string) => op("delete", key),
                clear: () => op("clear", null),
              });
              return tx;
            },
          };
          open.onsuccess?.();
        });
        return open;
      },
    },
  };
}

function presentation(result: unknown) {
  const source = readFileSync(path.join(runtime!, "popup.js"), "utf8");
  const start = source.indexOf("function transferReceivePresentation(result)");
  const end = source.indexOf(
    "\nasync function requestTransferReceivePending()",
    start,
  );
  assert.ok(start >= 0 && end > start, "current production popup pure helper");
  const fn = new Function(
    source.slice(start, end) + "; return transferReceivePresentation;",
  )();
  return fn(result);
}

function relayScenario(kind: "precommit" | "postcommit") {
  const service = new CredentialTransferService(
    createMemoryTransferRepository(),
  );
  const state = {
    ackAttempts: 0,
    commits: 0,
    transportDrops: 0,
    rejectBeforeCommit: kind === "precommit",
    loseResponseAfterCommit: kind === "postcommit",
    credentialCatalogWrites: 0,
  };
  const fetch = async (url: string, init: RequestInit = {}) => {
    const pathname = new URL(url).pathname;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const match = pathname.match(
      /^\/v1\/credential-transfers\/([0-9a-f-]{36})(?:\/(packet|ack))?$/i,
    );
    try {
      if (pathname === "/v1/credential-transfers" && method === "POST")
        return json(await service.create(principal(RECIPIENT), body), 201);
      if (!match) throw new Error("unexpected transfer fixture endpoint");
      const requestId = match[1]!;
      if (!match[2] && method === "GET") {
        const row = await service.read(principal(RECIPIENT), requestId);
        return row
          ? json(row)
          : json({ error: { code: "TRANSFER_ACCOUNT_MISMATCH" } }, 404);
      }
      if (match[2] === "packet" && method === "GET")
        return json(await service.receive(principal(RECIPIENT), requestId));
      if (match[2] === "ack" && method === "POST") {
        state.ackAttempts++;
        if (state.rejectBeforeCommit)
          return json({ error: { code: "TRANSFER_CONFLICT" } }, 409);
        const reply = await service.acknowledge(principal(RECIPIENT), body);
        state.commits++;
        if (state.loseResponseAfterCommit) {
          state.loseResponseAfterCommit = false;
          state.transportDrops++;
          throw new Error("fixture: response lost AFTER actual service commit");
        }
        return json(reply);
      }
      throw new Error("unexpected transfer method");
    } catch (error: any) {
      if (
        error.message === "fixture: response lost AFTER actual service commit"
      )
        throw error;
      if (typeof error.code === "string")
        return json(
          { error: { code: error.code } },
          error.code === "TRANSFER_EXPIRED" ? 410 : 409,
        );
      throw error;
    }
  };
  return { service, state, fetch };
}

async function prepare(kind: "precommit" | "postcommit") {
  const server = relayScenario(kind),
    backing = { local: {} as any, session: {} as any };
  const vault = fixtureVault();
  const options = {
    backing,
    indexedDB: vault.indexedDB,
    seedAuthority: true,
    accountId: ACCOUNT,
    deviceId: RECIPIENT,
    fetch: server.fetch,
    onStorageWrite: (area: string, rows: Record<string, unknown>) => {
      if (area === "local" && Object.hasOwn(rows, "seller_agents_stores_v1"))
        server.state.credentialCatalogWrites++;
    },
  };
  let worker = await makeWorker(runtime!, options);
  const created = await worker.call(
    "SellerAgentsControlClient.createCredentialTransfer",
    {
      consent: true,
      selectedStoreIds: [STORE],
    },
  );
  expect(created.state).toBe("REQUESTED");
  const encrypted = await worker.call(
    "SellerAgentsCredentialTransferCrypto.encrypt",
    {
      accountId: ACCOUNT,
      requestId: created.requestId,
      sourceDeviceId: SOURCE,
      recipientDeviceId: RECIPIENT,
      packetId: PACKET,
      recipientPublicKeySpki: created.recipientPublicKeySpki,
      payload: {
        transferPayloadVersion: "seller_agents_credential_payload_v1",
        stores: [
          {
            storeId: STORE,
            marketplace: "wildberries",
            name: "WB fixture",
            credentialRevision: "fixture-revision-1",
            metadataRevision: 0,
            providerAccountId: null,
            providerIdentityState: "UNCONFIRMED",
            lifecycleState: "ACTIVE",
            credentials: { token: "TEST_ONLY_FAKE_TOKEN" },
          },
        ],
      },
    },
  );
  await server.service.sourceSeen(principal(SOURCE), created.requestId);
  await server.service.submit(principal(SOURCE), {
    requestId: created.requestId,
    packetId: PACKET,
    envelope: encrypted,
  });
  const stored = () =>
    backing.local.seller_agents_stores_v1?.accounts?.[ACCOUNT]?.stores || {};
  return {
    server,
    vault,
    stored,
    backing,
    created,
    options,
    current: () => worker,
    restart: async () => {
      worker.close();
      worker = await makeWorker(runtime!, options);
      return worker;
    },
    close: () => worker.close(),
  };
}

describe("A02+B03 ACK commit boundary (real server service + packaged A02 worker, memory repo)", () => {
  it("pre-commit rejection never reports success, retains imported vault, then reconciles without reimport", async () => {
    const fixture = await prepare("precommit");
    try {
      const one = await fixture
        .current()
        .popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
      const firstWrites = fixture.server.state.credentialCatalogWrites;
      expect(one.importState).not.toBe("IMPORTED");
      expect(one.ackConfirmed).not.toBe(true);
      const firstPresentation = presentation(one);
      expect(firstPresentation).toEqual({
        text: "Подтверждённого результата переноса пока нет. Если ключи уже импортированы, проверьте магазин перед повторной попыткой.",
        consume: false,
      });
      expect(
        (
          await fixture.server.service.read(
            principal(RECIPIENT),
            fixture.created.requestId,
          )
        )?.state,
      ).toBe("DELIVERED_TO_RECIPIENT");
      expect(Object.keys(fixture.stored())).toEqual([STORE]);
      expect(fixture.vault.records.size).toBe(1);
      expect([...fixture.vault.records.values()][0].phase).toBe(
        "IMPORTED_PENDING_ACK",
      );
      const repeat = await fixture
        .current()
        .popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
      expect(repeat.importState).not.toBe("IMPORTED");
      expect(repeat.code).toBe("TRANSFER_CONFLICT");
      const secondPresentation = presentation(repeat);
      expect(secondPresentation).toEqual({
        text: "Сервер не подтвердил завершение передачи. Ключи могли быть импортированы локально; проверьте магазин перед повторной попыткой.",
        consume: false,
      });
      expect(fixture.server.state.credentialCatalogWrites).toBe(firstWrites);
      expect(Object.keys(fixture.stored())).toEqual([STORE]);
      fixture.server.state.rejectBeforeCommit = false;
      await fixture.restart();
      const done = await fixture
        .current()
        .popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
      expect(done.importState).toBe("IMPORTED");
      expect(presentation(done)?.consume).toBe(true);
      expect([...fixture.vault.records.values()][0].phase).toBe("ACKED_RESULT");
      expect(fixture.server.state.commits).toBe(1);
      expect(fixture.server.state.credentialCatalogWrites).toBe(firstWrites);
      expect(Object.keys(fixture.stored())).toEqual([STORE]);
      console.log(
        "PRECOMMIT_B03_SAFE_OBSERVATION",
        JSON.stringify({
          first: {
            code: one.code ?? null,
            importState: one.importState,
            ackConfirmed: one.ackConfirmed ?? null,
            text: firstPresentation?.text ?? null,
          },
          repeat: {
            code: repeat.code ?? null,
            importState: repeat.importState,
            text: secondPresentation?.text ?? null,
          },
          final: {
            importState: done.importState,
            serverCommits: fixture.server.state.commits,
            catalogWrites: firstWrites,
            stores: Object.keys(fixture.stored()).length,
          },
        }),
      );
      expect(firstPresentation?.consume).toBe(false);
      expect(secondPresentation?.consume).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it("response loss after actual commit readback shows success once without duplicate import on restart", async () => {
    const fixture = await prepare("postcommit");
    try {
      const answer = await fixture
        .current()
        .popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
      expect(fixture.server.state.transportDrops).toBe(1);
      expect(fixture.server.state.commits).toBe(1);
      expect(
        (
          await fixture.server.service.read(
            principal(RECIPIENT),
            fixture.created.requestId,
          )
        )?.state,
      ).toBe("COMPLETED");
      expect(answer.importState).toBe("IMPORTED");
      expect(presentation(answer)?.consume).toBe(true);
      expect(Object.keys(fixture.stored())).toEqual([STORE]);
      expect([...fixture.vault.records.values()][0].phase).toBe("ACKED_RESULT");
      const writes = fixture.server.state.credentialCatalogWrites;
      await fixture.restart();
      const recovered = await fixture
        .current()
        .popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
      expect(recovered.importState).toBe("IMPORTED");
      expect(recovered.recovered).toBe(true);
      expect(Object.keys(fixture.stored())).toEqual([STORE]);
      expect(fixture.server.state.credentialCatalogWrites).toBe(writes);
      expect(fixture.server.state.commits).toBe(1);
    } finally {
      fixture.close();
    }
  });
});
