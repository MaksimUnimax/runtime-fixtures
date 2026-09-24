import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";
const SOURCE = "44444444-4444-4444-8444-444444444444";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const results = [];
async function check(id, fn) {
  try { await fn(); results.push({ id, status: "PASS" }); }
  catch (error) { results.push({ id, status: "FAIL", error: `${error.code ? error.code + ": " : ""}${error.message || error}` }); }
}
function fakeIDB({ failOpen = false } = {}) {
  const records = new Map();
  const copy = value => value === undefined ? undefined : structuredClone(value);
  return { records, open() {
    const open = {};
    queueMicrotask(() => {
      if (failOpen) { open.error = new Error("fixture vault unavailable"); open.onerror?.(); return; }
      open.result = {
        objectStoreNames: { contains: () => true }, close() {},
        transaction() {
          const tx = {};
          const op = (kind, value) => {
            const request = {};
            queueMicrotask(() => {
              if (kind === "get") request.result = copy(records.get(value));
              if (kind === "all") request.result = [...records.values()].map(copy);
              if (kind === "put") { records.set(value.requestId, copy(value)); request.result = value.requestId; }
              if (kind === "delete") { records.delete(value); request.result = undefined; }
              if (kind === "clear") { records.clear(); request.result = undefined; }
              request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.());
            });
            return request;
          };
          tx.objectStore = () => ({ get: key => op("get", key), getAll: () => op("all"), put: value => op("put", value), delete: key => op("delete", key), clear: () => op("clear") });
          return tx;
        },
      };
      open.onsuccess?.();
    });
    return open;
  } };
}
function transferServer() {
  const state = { request: null, packet: null, createCalls: 0, ackCalls: 0, loseCreateResponse: false, loseAckResponse: false };
  return {
    state,
    async fetch(url, init = {}) {
      const pathname = new URL(url).pathname, method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null;
      if (pathname === "/v1/credential-transfers" && method === "POST") {
        state.createCalls += 1;
        if (!state.request) state.request = { requestId: body.requestId, accountId: ACCOUNT, recipientDeviceId: body.recipientDeviceId, sourceDeviceId: body.sourceDeviceId, recipientPublicKeySpki: body.recipientPublicKeySpki, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + body.expiresInSeconds * 1000).toISOString(), state: "REQUESTED", selectedStores: body.selectedStores, revision: 1 };
        else {
          assert.equal(body.requestId, state.request.requestId); assert.equal(body.recipientPublicKeySpki, state.request.recipientPublicKeySpki); assert.deepEqual(body.selectedStores, state.request.selectedStores);
        }
        if (state.loseCreateResponse) { state.loseCreateResponse = false; throw new Error("fixture create response lost"); }
        return json(state.request);
      }
      const match = pathname.match(/^\/v1\/credential-transfers\/([^/]+)(?:\/(packet|ack|source-seen))?$/);
      if (!match) throw new Error(`unexpected transfer URL ${method} ${pathname}`);
      const [, requestId, suffix] = match;
      assert.equal(requestId, state.request?.requestId);
      if (!suffix && method === "GET") return json(state.request);
      if (suffix === "packet" && method === "GET") {
        if (!state.packet) return json({ error: { code: "SOURCE_OFFLINE" } }, 409);
        state.request = { ...state.request, state: "DELIVERED_TO_RECIPIENT", revision: state.request.revision + 1 };
        return json(state.packet);
      }
      if (suffix === "ack" && method === "POST") {
        state.ackCalls += 1;
        assert.equal(body.packetId, state.packet?.packetId);
        if (state.request.state === "COMPLETED") return json({ error: { code: "TRANSFER_REPLAY" } }, 409);
        state.request = { ...state.request, state: "COMPLETED", revision: state.request.revision + 1 };
        if (state.loseAckResponse) { state.loseAckResponse = false; throw new Error("fixture ACK response lost"); }
        return json(state.request);
      }
      throw new Error(`unexpected transfer operation ${method} ${pathname}`);
    },
    makePacket(envelope, packetId = "55555555-5555-4555-8555-555555555555") {
      state.packet = { requestId: state.request.requestId, packetId, envelope };
      state.request = { ...state.request, sourceDeviceId: SOURCE, state: "PACKET_AVAILABLE_EPHEMERAL", revision: state.request.revision + 1 };
      return state.packet;
    },
  };
}
async function workerWith({ backing, idb, server, seedAuthority = false }) {
  return makeWorker(runtime, { backing, indexedDB: idb, seedAuthority, accountId: ACCOUNT, deviceId: RECIPIENT, fetch: server.fetch });
}
async function envelope(worker, server, storeId) {
  return worker.call("SellerAgentsCredentialTransferCrypto.encrypt", { accountId: ACCOUNT, requestId: server.state.request.requestId, sourceDeviceId: SOURCE, recipientDeviceId: RECIPIENT, packetId: "55555555-5555-4555-8555-555555555555", recipientPublicKeySpki: server.state.request.recipientPublicKeySpki, payload: { transferPayloadVersion: "seller_agents_credential_payload_v1", stores: [{ storeId, marketplace: "wildberries", name: "Recovered WB", credentialRevision: "credential-recovered-v1", metadataRevision: 0, providerAccountId: null, providerIdentityState: "UNCONFIRMED", lifecycleState: "ACTIVE", credentials: { token: "FIXTURE_TRANSFER_TOKEN_NEVER_REAL" } }] } });
}

await check("TRR-01-vault-failure-before-POST", async () => {
  const server = transferServer(), backing = { local: {}, session: {} }, bootstrap = await makeWorker(runtime, { backing, accountId: ACCOUNT, deviceId: RECIPIENT }); bootstrap.close();
  const worker = await workerWith({ backing, idb: fakeIDB({ failOpen: true }), server });
  try {
    let failure; try { await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["store-a"] }); } catch (error) { failure = error; }
    assert.equal(failure?.code, "TRANSFER_VAULT_PERSIST_FAILED"); assert.equal(server.state.createCalls, 0);
  } finally { worker.close(); }
});

await check("TRR-02-worker-restart-restores-private-key-and-request-discovery", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  let worker = await workerWith({ backing, idb, server, seedAuthority: true });
  const created = await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
  assert.equal(created.state, "REQUESTED"); assert.equal(server.state.createCalls, 1);
  const vaultBefore = [...idb.records.values()][0]; assert.equal(vaultBefore.privateKey.extractable, false); assert.equal(vaultBefore.phase, "ACTIVE"); assert.ok(!JSON.stringify(vaultBefore).includes("FIXTURE_TRANSFER_TOKEN_NEVER_REAL"));
  const encrypted = await envelope(worker, server, "transfer-store"); server.makePacket(encrypted); worker.close();
  worker = await workerWith({ backing, idb, server });
  try {
    const recovered = await worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" });
    assert.equal(recovered.importState, "IMPORTED", JSON.stringify(recovered)); assert.equal(server.state.ackCalls, 1); assert.equal(server.state.request.state, "COMPLETED");
    const stores = backing.local.seller_agents_stores_v1.accounts[ACCOUNT].stores; assert.equal(Object.keys(stores).length, 1); assert.equal(stores["transfer-store"].credentialRevision, "credential-recovered-v1");
    const vault = [...idb.records.values()][0]; assert.equal(vault.phase, "ACKED_RESULT"); assert.equal(vault.privateKey, null); assert.equal(vault.result.importState, "IMPORTED"); assert.ok(!JSON.stringify(vault).includes("FIXTURE_TRANSFER_TOKEN_NEVER_REAL"));
  } finally { worker.close(); }
});

await check("TRR-03-restart-after-durable-import-before-ACK-does-not-reimport", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  let worker = await workerWith({ backing, idb, server, seedAuthority: true });
  await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
  const encrypted = await envelope(worker, server, "transfer-store"); const packet = server.makePacket(encrypted);
  const received = await worker.call("SellerAgentsControlClient.receiveCredentialTransfer", server.state.request.requestId, SOURCE);
  const store = received.payload.stores[0];
  const imported = await worker.call("SellerAgentsActiveStoreCatalog.importCredential", { ...store, id: store.storeId }); assert.equal(imported.kind, "IMPORTED");
  await worker.call("SellerAgentsControlClient.recordCredentialTransferImported", { requestId: server.state.request.requestId, packetId: packet.packetId, results: [{ storeId: store.storeId, ...imported }] });
  assert.equal([...idb.records.values()][0].phase, "IMPORTED_PENDING_ACK"); worker.close();
  worker = await workerWith({ backing, idb, server });
  try {
    const recovered = await worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" }); assert.equal(recovered.importState, "IMPORTED", JSON.stringify(recovered)); assert.equal(recovered.recovered, true); assert.equal(server.state.ackCalls, 1);
    assert.equal(Object.keys(backing.local.seller_agents_stores_v1.accounts[ACCOUNT].stores).length, 1);
  } finally { worker.close(); }
});

await check("TRR-04-lost-ACK-response-reconciles-COMPLETED-and-safe-result-survives-popup-restart", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  let worker = await workerWith({ backing, idb, server, seedAuthority: true });
  await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
  const encrypted = await envelope(worker, server, "transfer-store"); server.makePacket(encrypted); server.state.loseAckResponse = true;
  const imported = await worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" }); assert.equal(imported.importState, "IMPORTED", JSON.stringify(imported)); assert.equal(server.state.request.state, "COMPLETED");
  assert.equal([...idb.records.values()][0].phase, "ACKED_RESULT"); worker.close();
  worker = await workerWith({ backing, idb, server });
  try {
    const recovered = await worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" }); assert.equal(recovered.importState, "IMPORTED"); assert.equal(recovered.recovered, true);
    const consumed = await worker.popup({ type: "SA_TRANSFER_RESULT_CONSUME", requestId: recovered.requestId }); assert.equal(consumed.ok, true); assert.equal(idb.records.size, 0);
  } finally { worker.close(); }
});


await check("TRR-05-local-reset-clears-durable-recipient-key", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  const worker = await workerWith({ backing, idb, server, seedAuthority: true });
  try {
    await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
    assert.equal(idb.records.size, 1); assert.equal([...idb.records.values()][0].privateKey.extractable, false);
    const reset = await worker.call("SellerAgentsControlClient.localReset");
    assert.equal(reset.authenticated, false); assert.equal(idb.records.size, 0);
  } finally { worker.close(); }
});

await check("TRR-06-concurrent-receive-is-idempotent-and-does-not-reopen-ACKED-result", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  const worker = await workerWith({ backing, idb, server, seedAuthority: true });
  try {
    await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
    const encrypted = await envelope(worker, server, "transfer-store"); server.makePacket(encrypted);
    const [left, right] = await Promise.all([worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" }), worker.popup({ type: "SA_TRANSFER_RECEIVE_PENDING" })]);
    assert.equal(left.importState, "IMPORTED", JSON.stringify(left)); assert.equal(right.importState, "IMPORTED", JSON.stringify(right));
    assert.equal(server.state.request.state, "COMPLETED"); assert.ok(server.state.ackCalls >= 1 && server.state.ackCalls <= 2, server.state.ackCalls);
    const stores = backing.local.seller_agents_stores_v1.accounts[ACCOUNT].stores; assert.equal(Object.keys(stores).length, 1);
    const vault = [...idb.records.values()][0]; assert.equal(vault.phase, "ACKED_RESULT"); assert.equal(vault.privateKey, null);
  } finally { worker.close(); }
});


await check("TRR-07-lost-create-response-retries-same-request-and-key", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  server.state.loseCreateResponse = true;
  const worker = await workerWith({ backing, idb, server, seedAuthority: true });
  try {
    const created = await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
    assert.equal(created.state, "REQUESTED"); assert.equal(server.state.createCalls, 2);
    const vault = [...idb.records.values()][0]; assert.equal(vault.phase, "ACTIVE"); assert.equal(vault.publicKeySpki, server.state.request.recipientPublicKeySpki); assert.equal(vault.privateKey.extractable, false);
  } finally { worker.close(); }
});

await check("TRR-08-expired-vault-record-pruned-on-worker-restore", async () => {
  const server = transferServer(), idb = fakeIDB(), backing = { local: {}, session: {} };
  let worker = await workerWith({ backing, idb, server, seedAuthority: true });
  await worker.call("SellerAgentsControlClient.createCredentialTransfer", { consent: true, selectedStoreIds: ["transfer-store"] });
  const record = [...idb.records.values()][0]; record.expiresAt = new Date(Date.now() - 1000).toISOString(); idb.records.set(record.requestId, record); worker.close();
  worker = await workerWith({ backing, idb, server });
  try { assert.equal(idb.records.size, 0); } finally { worker.close(); }
});

const failed = results.filter(row => row.status !== "PASS");
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", scope: "A02_MV3_TRANSFER_RECIPIENT_RECOVERY", results, failures: failed, executionAuthority: false }, null, 2));
if (failed.length) process.exitCode = 1;
