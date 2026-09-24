import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const JOURNAL = "seller_agents_sync_journal_v1";
const BINDINGS = "ozmb_conversation_bindings";
const results = [];
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceA = "22222222-2222-4222-8222-222222222222";
const deviceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clone = value => JSON.parse(JSON.stringify(value));

async function test(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); }
  catch (error) { results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
}
function keyOf(worker) { return `${worker.identity.origin}|${worker.identity.conversation_id}`.toLowerCase(); }
function expectedEntity(key) { return `conversation:${createHash("sha256").update(key.toLowerCase()).digest("hex")}`; }
async function addStore(worker, name = "N2 store") {
  const response = await worker.popup({
    type: "SA_STORE_SAVE",
    store: {
      marketplace: "ozon",
      name,
      credentials: { seller: { clientId: "N2_CLIENT", apiKey: "N2_KEY" }, performance: {} },
    },
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.store;
}
async function startAndBind(worker, store) {
  const start = await worker.popup({
    type: "SA_WORK_START",
    tab_id: worker.tabId,
    store_id: store.id,
    confirm_change: false,
    start_intent_id: `n2-${crypto.randomUUID()}`,
  });
  assert.equal(start.ok, true, JSON.stringify(start));
  const pending = await until(async () => {
    const row = (await worker.call("getPendingWorkStarts"))[worker.tabId];
    return row?.send_outcome === "sent_acknowledged" ? row : null;
  }, "N2 pending start");
  const active = await worker.request({
    type: "OZ_WORK_PENDING_IDENTITY",
    intent_id: pending.intent_id,
    revision: pending.revision,
    identity: worker.identity,
    first_response_complete: true,
  }, { tab: { id: worker.tabId } });
  assert.equal(active.ok, true, JSON.stringify(active));
  return active.binding;
}
function remoteState(intent, store, patch = {}) {
  return {
    kind: "BINDING_UPSERT",
    conversationKeyDigest: intent.conversationKeyDigest,
    bindingId: "remote-binding",
    bindingRevision: 4,
    storeId: store?.id || "store-remote-only",
    marketplace: "ozon",
    credentialRevision: "remote-credential-revision",
    bindingState: "BOUND",
    workGeneration: null,
    ...patch,
  };
}

await test("N2-A01", "same normalized dialogue has one canonical entity across installations", async () => {
  const first = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const second = await makeWorker(runtime, { accountId: accountA, deviceId: deviceB });
  try {
    const key = keyOf(first);
    const a = await first.call("SellerAgentsSyncJournal.entityIdForConversation", key);
    const b = await second.call("SellerAgentsSyncJournal.entityIdForConversation", key.toUpperCase());
    assert.equal(a, expectedEntity(key));
    assert.equal(b, a);
    assert.equal(a.includes(first.identity.conversation_id), false);
  } finally { first.close(); second.close(); }
});

await test("N2-A02", "snapshot intent is fenced to account and installation", async () => {
  const first = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const second = await makeWorker(runtime, { accountId: accountB, deviceId: deviceB });
  try {
    const key = keyOf(first);
    const intent = await first.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key });
    const result = await second.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 0, serverState: null }],
    });
    assert.equal(result.applied, false); assert.equal(result.code, "SYNC_SNAPSHOT_CONTEXT_STALE");
    assert.equal(second.backing.local[JOURNAL]?.snapshotAt || 0, 0);
  } finally { first.close(); second.close(); }
});

await test("N2-A03", "compatible remote binding adopts only with local store credentials", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker), key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key });
    const state = remoteState(intent, store);
    const result = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 4, serverState: state }],
    });
    assert.equal(result.applied, true);
    assert.equal(result.classification, "SERVER_AHEAD_COMPATIBLE");
    assert.equal(result.adoption.adopted, true);
    const binding = worker.backing.local[BINDINGS][key];
    assert.equal(binding.binding_id, state.bindingId);
    assert.equal(binding.store_context.storeId, store.id);
  } finally { worker.close(); }
});

await test("N2-A04", "remote binding never implies missing marketplace credentials", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key });
    const result = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 3, serverState: remoteState(intent, null) }],
    });
    assert.equal(result.applied, true);
    assert.equal(result.adoption.adopted, false);
    assert.equal(result.adoption.code, "SYNC_SNAPSHOT_LOCAL_CREDENTIALS_REQUIRED");
    assert.equal(worker.backing.local[BINDINGS]?.[key], undefined);
  } finally { worker.close(); }
});

await test("N2-A05", "incompatible local and remote binding becomes explicit conflict", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key, binding, store });
    const result = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      binding,
      store,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 9, serverState: remoteState(intent, store, { bindingId: "other-binding", bindingRevision: 9 }) }],
    });
    assert.equal(result.classification, "EXPLICIT_BINDING_CONFLICT");
    const decision = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, false); assert.equal(decision.code, "SYNC_EXPLICIT_BINDING_CONFLICT");
  } finally { worker.close(); }
});

await test("N2-A06", "server Finish fences late local action and older delivery snapshot cannot overwrite it", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key, binding, store });
    const finish = remoteState(intent, store, { kind: "FINISH", bindingId: binding.binding_id, bindingRevision: binding.revision + 1, bindingState: "FINISHED" });
    const accepted = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent, currentConversationKey: key, binding, store,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 7, serverState: finish }],
    });
    assert.equal(accepted.applied, true);
    const decision = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, false); assert.equal(decision.code, "SYNC_SERVER_FINISH_FENCE");
    const late = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent, currentConversationKey: key, binding, store,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 8, serverState: remoteState(intent, store, { kind: "DELIVERY_MARKER", bindingId: binding.binding_id, bindingRevision: binding.revision }) }],
    });
    assert.equal(late.applied, true);
    assert.equal(late.code, "SYNC_SNAPSHOT_LATE_DELIVERY_OBSOLETE");
    assert.equal(late.classification, "SERVER_FINISH_WINS_OVER_LATE_DELIVERY");
    const afterLate = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(afterLate.allowed, false); assert.equal(afterLate.code, "SYNC_SERVER_FINISH_FENCE");
  } finally { worker.close(); }
});

await test("N2-A07", "response after dialogue change is ignored without mutating snapshot state", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key });
    const result = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: `${worker.identity.origin}|different-dialogue`,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 2, serverState: remoteState(intent, null) }],
    });
    assert.equal(result.applied, false); assert.equal(result.code, "SYNC_SNAPSHOT_CONTEXT_STALE");
    assert.equal(worker.backing.local[JOURNAL]?.snapshotAt || 0, 0);
  } finally { worker.close(); }
});

await test("N2-A08", "mutation sync preserves historical wire shape while snapshot reads use a separate request", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker);
    const binding = await startAndBind(worker, store);
    const before = await worker.call("SellerAgentsSyncJournal.read");
    const localBinding = Object.values(before.entries).find(entry => entry.kind === "BINDING_UPSERT");
    assert.ok(localBinding);
    assert.equal(localBinding.entityId, expectedEntity(keyOf(worker)));
    assert.equal(localBinding.wireEntityId, binding.binding_id);
    const result = await worker.call("SellerAgentsSyncJournal.syncNow", "n2-wire-compat");
    assert.equal(result.ok, true, JSON.stringify(result));
    const sync = worker.controlNetwork.find(row => row.url.endsWith("/v1/sync"));
    assert.ok(sync);
    const body = JSON.parse(sync.body);
    assert.equal(Object.hasOwn(body, "readEntityIds"), false);
    const bindingEntries = body.entries.filter(entry => ["BINDING_UPSERT", "FINISH", "DELIVERY_MARKER"].includes(entry.kind));
    assert.ok(bindingEntries.length > 0);
    assert.equal(bindingEntries.every(entry => entry.entityId === binding.binding_id), true);
    assert.equal(bindingEntries.some(entry => entry.entityId.startsWith("conversation:")), false);
  } finally { worker.close(); }
});

await test("N2-A09", "legacy pending journal migrates locally while exact old wire entity is preserved", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
  const backing = worker.backing, journal = backing.local[JOURNAL];
  const pending = Object.values(journal.entries).find(entry => entry.kind === "BINDING_UPSERT");
  assert.ok(pending?.wireEntityId);
  const legacyWire = pending.wireEntityId;
  pending.entityId = legacyWire;
  delete pending.wireEntityId;
  worker.close();
  const reopened = await makeWorker(runtime, { backing, accountId: accountA, deviceId: deviceA });
  try {
    const restored = await reopened.call("SellerAgentsSyncJournal.read");
    const migrated = Object.values(restored.entries).find(entry => entry.kind === "BINDING_UPSERT");
    assert.equal(migrated.entityId, expectedEntity(key));
    assert.equal(migrated.wireEntityId, legacyWire);
    assert.equal(legacyWire, binding.binding_id);
    const result = await reopened.call("SellerAgentsSyncJournal.syncNow", "legacy-replay");
    assert.equal(result.ok, true, JSON.stringify(result));
    const sync = reopened.controlNetwork.find(row => row.url.endsWith("/v1/sync"));
    const body = JSON.parse(sync.body);
    assert.equal(body.entries.find(entry => entry.kind === "BINDING_UPSERT").entityId, legacyWire);
  } finally { reopened.close(); }
});

await test("N2-A10", "snapshot knowledge from another account cannot fence the current account", async () => {
  const first = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const key = keyOf(first);
  const intent = await first.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key });
  const learned = await first.call("SellerAgentsSyncJournal.applySnapshotRead", {
    intent,
    currentConversationKey: key,
    snapshots: [{ entityId: intent.entityIds[0], serverRevision: 5, serverState: remoteState(intent, null, { kind: "FINISH", bindingRevision: 5, bindingState: "FINISHED" }) }],
  });
  assert.equal(learned.applied, true);
  const foreignJournal = clone(first.backing.local[JOURNAL]);
  first.close();
  const backing = { local: { [JOURNAL]: foreignJournal }, session: {} };
  const second = await makeWorker(runtime, { backing, accountId: accountB, deviceId: deviceB });
  try {
    const decision = await second.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", {
      conversationKey: key,
      binding: { binding_id: "account-b-binding", revision: 1, conversation_key: key, store_context: { storeId: "store-b", marketplace: "ozon" } },
    });
    assert.equal(decision.allowed, true);
    const state = await second.call("SellerAgentsSyncJournal.read");
    assert.equal(Object.keys(state.reconciliation).some(slot => slot.startsWith(accountB)), false);
  } finally { second.close(); }
});

await test("N2-A11", "snapshot response started before local Finish is rejected while pending Finish preserves offline continuation", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key, binding, store });
    await worker.call("SellerAgentsSyncJournal.recordFinish", { conversationKey: key, binding, store });
    const late = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      binding,
      store,
      snapshots: [{ entityId: intent.entityIds[0], serverRevision: 6, serverState: remoteState(intent, store, { kind: "DELIVERY_MARKER", bindingId: binding.binding_id, bindingRevision: binding.revision }) }],
    });
    assert.equal(late.applied, false);
    assert.equal(late.code, "SYNC_SNAPSHOT_CONTEXT_STALE");
    const decision = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, true);
    assert.equal(decision.code, null);
  } finally { worker.close(); }
});

await test("N2-A12", "legacy unscoped server Finish is migrated through the local account binding and remains a fence", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
  await worker.call("SellerAgentsSyncJournal.syncNow", "seed-legacy-knowledge");
  const backing = worker.backing, journal = backing.local[JOURNAL], entityId = expectedEntity(key);
  const slot = `${accountA}\u001f${entityId}`;
  const finish = {
    kind: "FINISH",
    conversationKeyDigest: entityId.slice("conversation:".length),
    bindingId: binding.binding_id,
    bindingRevision: binding.revision + 1,
    storeId: store.id,
    marketplace: store.marketplace,
    credentialRevision: store.credentialRevision,
    bindingState: "FINISHED",
    workGeneration: null,
  };
  journal.serverRevisions = { [binding.binding_id]: 7 };
  journal.serverStates = { [binding.binding_id]: finish };
  journal.reconciliation = { [binding.binding_id]: { classification: "SERVER_AHEAD_COMPATIBLE", preferred: null, serverRevision: 7, serverState: finish } };
  worker.close();
  const reopened = await makeWorker(runtime, { backing, accountId: accountA, deviceId: deviceA });
  try {
    const restored = await reopened.call("SellerAgentsSyncJournal.read");
    assert.equal(restored.serverRevisions[slot], 7);
    assert.equal(restored.serverStates[slot].bindingState, "FINISHED");
    const decision = await reopened.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "SYNC_SERVER_FINISH_FENCE");
  } finally { reopened.close(); }
});

await test("N2-A13", "legacy unscoped explicit conflict without server state remains fail-closed after migration", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
  await worker.call("SellerAgentsSyncJournal.syncNow", "seed-legacy-conflict");
  const backing = worker.backing, journal = backing.local[JOURNAL], entityId = expectedEntity(key);
  const slot = `${accountA}\u001f${entityId}`;
  journal.serverRevisions = { [binding.binding_id]: 9 };
  journal.serverStates = {};
  journal.reconciliation = { [binding.binding_id]: { classification: "EXPLICIT_BINDING_CONFLICT", preferred: null, serverRevision: 9, serverState: null } };
  worker.close();
  const reopened = await makeWorker(runtime, { backing, accountId: accountA, deviceId: deviceA });
  try {
    const restored = await reopened.call("SellerAgentsSyncJournal.read");
    assert.equal(restored.reconciliation[slot].classification, "EXPLICIT_BINDING_CONFLICT");
    const decision = await reopened.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "SYNC_EXPLICIT_BINDING_CONFLICT");
  } finally { reopened.close(); }
});

await test("N2-A14", "control client accepts bounded canonical read-only sync and rejects invalid read shapes", async () => {
  let body = null;
  const worker = await makeWorker(runtime, {
    accountId: accountA,
    deviceId: deviceA,
    syncFetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        syncVersion: "seller_agents_sync_v1",
        results: [],
        snapshots: body.readEntityIds.map(entityId => ({ entityId, serverRevision: 0, serverState: null })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    const entityId = expectedEntity(keyOf(worker));
    const response = await worker.call("SellerAgentsControlClient.synchronizeMetadata", {
      syncVersion: "seller_agents_sync_v1",
      entries: [],
      readEntityIds: [entityId],
    });
    assert.deepEqual(body.entries, []);
    assert.deepEqual(body.readEntityIds, [entityId]);
    assert.equal(body.installationId, deviceA);
    assert.equal(response.snapshots[0].entityId, entityId);
    for (const readEntityIds of [[], [entityId, entityId], ["legacy-random-binding-id"]]) {
      await assert.rejects(
        () => worker.call("SellerAgentsControlClient.synchronizeMetadata", {
          syncVersion: "seller_agents_sync_v1",
          entries: [],
          readEntityIds,
        }),
        error => error?.code === "SYNC_REQUEST_INVALID",
      );
    }
  } finally { worker.close(); }
});

await test("N2-A15", "read-only conversation snapshot uses canonical wire and applies bounded remote knowledge", async () => {
  let requestBody = null;
  const worker = await makeWorker(runtime, {
    accountId: accountA,
    deviceId: deviceA,
    syncFetch: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      const entityId = requestBody.readEntityIds[0];
      const digest = entityId.slice("conversation:".length);
      return new Response(JSON.stringify({
        syncVersion: "seller_agents_sync_v1",
        results: [],
        snapshots: [{
          entityId,
          serverRevision: 4,
          serverState: {
            kind: "BINDING_UPSERT",
            conversationKeyDigest: digest,
            bindingId: "remote-read-binding",
            bindingRevision: 4,
            storeId: "remote-store-without-local-credentials",
            marketplace: "ozon",
            credentialRevision: "remote-read-credential",
            bindingState: "BOUND",
            workGeneration: null,
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    const key = keyOf(worker), entityId = expectedEntity(key);
    const result = await worker.call("SellerAgentsSyncJournal.syncConversationSnapshot", {
      conversationKey: key,
      reason: "n2-test",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.read, 1);
    assert.equal(result.classification, "SERVER_AHEAD_COMPATIBLE");
    assert.equal(result.adoption.adopted, false);
    assert.equal(result.adoption.code, "SYNC_SNAPSHOT_LOCAL_CREDENTIALS_REQUIRED");
    assert.deepEqual(requestBody.entries, []);
    assert.deepEqual(requestBody.readEntityIds, [entityId]);
    const state = await worker.call("SellerAgentsSyncJournal.read");
    assert.equal(state.serverRevisions[`${accountA}\u001f${entityId}`], 4);
  } finally { worker.close(); }
});

await test("N2-A16", "popup-open snapshot read is background-only, rare and does not block local popup state", async () => {
  let release, requestBody = null, syncCalls = 0;
  const pendingResponse = new Promise(resolve => { release = resolve; });
  const worker = await makeWorker(runtime, {
    accountId: accountA,
    deviceId: deviceA,
    syncFetch: async (_url, init) => {
      syncCalls += 1;
      requestBody = JSON.parse(init.body);
      return pendingResponse;
    },
  });
  try {
    const popup = await Promise.race([
      worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("popup blocked on snapshot network")), 250)),
    ]);
    assert.equal(popup.ok, true);
    await until(() => requestBody, "N2 popup snapshot request");
    assert.deepEqual(requestBody.entries, []);
    assert.deepEqual(requestBody.readEntityIds, [expectedEntity(keyOf(worker))]);
    release(new Response(JSON.stringify({
      syncVersion: "seller_agents_sync_v1",
      results: [],
      snapshots: [{ entityId: requestBody.readEntityIds[0], serverRevision: 0, serverState: null }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await until(() => (worker.backing.local[JOURNAL]?.snapshotAt || 0) > 0, "N2 popup snapshot applied");
    const second = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
    assert.equal(second.ok, true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(syncCalls, 1, "success cooldown keeps popup refresh from becoming polling");
    const cooldown = await worker.call("SellerAgentsSyncJournal.syncConversationSnapshot", {
      conversationKey: keyOf(worker),
      reason: "repeat-popup",
    });
    assert.equal(cooldown.ok, true);
    assert.equal(cooldown.read, 0);
    assert.equal(cooldown.code, "SYNC_SNAPSHOT_COOLDOWN");
  } finally { worker.close(); }
});

await test("N2-A17", "repeated popup refresh is bounded by snapshot cooldown instead of polling", async () => {
  let reads = 0;
  const worker = await makeWorker(runtime, {
    accountId: accountA,
    deviceId: deviceA,
    syncFetch: async (_url, init) => {
      reads += 1;
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        syncVersion: "seller_agents_sync_v1",
        results: [],
        snapshots: [{ entityId: body.readEntityIds[0], serverRevision: 0, serverState: null }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  try {
    for (let index = 0; index < 5; index += 1) {
      const popup = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
      assert.equal(popup.ok, true);
    }
    await until(() => reads === 1, "N2 one bounded popup read");
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(reads, 1);
  } finally { worker.close(); }
});

await test("N2-A18", "pending local explicit change wins over equal-or-older snapshot revision", async () => {
  const worker = await makeWorker(runtime, { accountId: accountA, deviceId: deviceA });
  try {
    const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
    const intent = await worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey: key, binding, store });
    const pending = Object.values((await worker.call("SellerAgentsSyncJournal.read")).entries)
      .find(entry => entry.kind === "BINDING_UPSERT");
    assert.ok(pending);
    const result = await worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent,
      currentConversationKey: key,
      binding,
      store,
      snapshots: [{
        entityId: intent.entityIds[0],
        serverRevision: Number(pending.baseRevision || 0),
        serverState: Number(pending.baseRevision || 0) === 0 ? null : remoteState(intent, store, {
          bindingId: "older-server-binding",
          bindingRevision: Number(pending.baseRevision || 0),
        }),
      }],
    });
    assert.equal(result.applied, false);
    assert.equal(result.code, "SYNC_SNAPSHOT_LOCAL_EXPLICIT_AHEAD");
    const decision = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, true);
  } finally { worker.close(); }
});

await test("N2-A19", "snapshot service failure preserves local Work and uses bounded retry cooldown", async () => {
  let reads = 0;
  const worker = await makeWorker(runtime, {
    accountId: accountA,
    deviceId: deviceA,
    syncFetch: async () => {
      reads += 1;
      return new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    const store = await addStore(worker), binding = await startAndBind(worker, store), key = keyOf(worker);
    const popup = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
    assert.equal(popup.ok, true);
    assert.equal(popup.context.work_active, true);
    await until(() => reads === 1, "N2 failed popup snapshot read");
    const decision = await worker.call("SellerAgentsSyncJournal.assertCurrentActionAllowed", { conversationKey: key, binding, store });
    assert.equal(decision.allowed, true);
    const again = await worker.call("SellerAgentsSyncJournal.syncConversationSnapshot", {
      conversationKey: key,
      binding,
      store,
      reason: "failed-read-repeat",
    });
    assert.equal(again.ok, true);
    assert.equal(again.read, 0);
    assert.equal(again.code, "SYNC_SNAPSHOT_COOLDOWN");
    assert.equal(reads, 1);
  } finally { worker.close(); }
});

const failures = results.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "A04_N2_LOCAL_SNAPSHOT", results, failureBatch: failures }, null, 2));
if (failures.length) process.exitCode = 1;
