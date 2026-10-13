import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const JOURNAL = "seller_agents_sync_journal_v1";
const BINDINGS = "ozmb_conversation_bindings";
const SESSIONS = "ozmb_work_sessions_v1";
const clone = value => JSON.parse(JSON.stringify(value));
const results = [];
async function test(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); }
  catch (error) { results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
}
async function fixture(backing = null, syncFetch = null) {
  const worker = await makeWorker(runtime, { backing: backing || undefined, seedAuthority: !backing, healthFetch: async () => { throw Object.assign(new Error("offline"), { code: "CONTROL_TRANSPORT_UNAVAILABLE" }); }, syncFetch });
  const response = await worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", name: "C3E store", credentials: { seller: { clientId: "C3E_CLIENT", apiKey: "C3E_KEY" }, performance: {} } } });
  assert.equal(response.ok, true, JSON.stringify(response));
  return { worker, backing: worker.backing, store: response.store };
}
async function startAndBind(f) {
  const start = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: f.store.id, confirm_change: false, start_intent_id: "c3e-start" });
  assert.equal(start.ok, true, JSON.stringify(start));
  const pending = await until(async () => (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]?.send_outcome === "sent_acknowledged" ? (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] : null, "C3E pending start");
  const identity = f.worker.identity;
  const bound = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity, first_response_complete: true }, { tab: { id: f.worker.tabId } });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  return bound.binding;
}

await test("C3E-01", "local binding success creates compact durable pending metadata", async () => {
  const f = await fixture();
  try { const binding = await startAndBind(f); const journal = f.backing.local[JOURNAL]; const entries = Object.values(journal.entries); const bindingEntry = entries.find(entry => entry.kind === "BINDING_UPSERT"); assert.ok(bindingEntry); assert.equal(bindingEntry.status, "PENDING"); assert.equal(bindingEntry.payload.bindingId, binding.binding_id); assert.equal(bindingEntry.entityId.startsWith("conversation:"), true); assert.equal("conversationKey" in bindingEntry.payload, false); }
  finally { f.worker.close(); }
});
await test("C3E-02", "restart preserves requestId and retry attempt state", async () => {
  const f = await fixture();
  const binding = await startAndBind(f); assert.ok(binding); const backing = f.backing; const before = clone(backing.local[JOURNAL]); const beforeBinding = Object.values(before.entries).find(entry => entry.kind === "BINDING_UPSERT"); assert.ok(beforeBinding); f.worker.close();
  const reopened = await fixture(backing, async () => new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }), { status: 503, headers: { "content-type": "application/json" } }));
  try { const restored = await reopened.worker.call("SellerAgentsSyncJournal.read"); const restoredBinding = Object.values(restored.entries).find(entry => entry.kind === "BINDING_UPSERT"); assert.equal(restoredBinding.requestId, beforeBinding.requestId); const outcome = await reopened.worker.call("SellerAgentsSyncJournal.syncNow", "test"); assert.equal(outcome.ok, false); const after = await reopened.worker.call("SellerAgentsSyncJournal.read"); const entry = Object.values(after.entries).find(row => row.kind === "BINDING_UPSERT"); assert.equal(entry.status, "RETRY_WAIT"); assert.equal(entry.attempts, 1); assert.ok(entry.nextAttemptAt > Date.now()); }
  finally { reopened.worker.close(); }
});
await test("C3E-03", "ACK compacts only the sent mutation and leaves a newer dirty mutation", async () => {
  let release;
  const f = await fixture(null, async (_url, init) => { const body = JSON.parse(init.body); await new Promise(resolve => { release = resolve; }); return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({ requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId, outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1, serverState: entry.payload, code: null })) }), { status: 200, headers: { "content-type": "application/json" } }); });
  try { const binding = await startAndBind(f); const key = f.worker.identity.origin + "|" + f.worker.identity.conversation_id; const flight = f.worker.call("SellerAgentsSyncJournal.syncNow", "test"); await until(async () => Object.values((await f.worker.call("SellerAgentsSyncJournal.read")).entries).some(entry => entry.status === "IN_FLIGHT"), "C3E in-flight entry"); await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: key }); release(); assert.equal((await flight).ok, true); const after = await f.worker.call("SellerAgentsSyncJournal.read"); const newer = Object.values(after.entries)[0]; assert.equal(newer.kind, "FINISH"); assert.equal(newer.baseRevision, 1); assert.ok(binding); }
  finally { f.worker.close(); }
});
await test("C3E-04", "conflict is durable, stops retry, and retains local desired metadata", async () => {
  const f = await fixture(null, async (_url, init) => { const body = JSON.parse(init.body); return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({ requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId, outcome: "CONFLICT", serverRevision: 7, serverState: { ...entry.payload, bindingRevision: 99 }, code: "SYNC_CONFLICT" })) }), { status: 200, headers: { "content-type": "application/json" } }); });
  try { await startAndBind(f); const result = await f.worker.call("SellerAgentsSyncJournal.syncNow", "test"); assert.equal(result.ok, true); const journal = await f.worker.call("SellerAgentsSyncJournal.read"); const entry = Object.values(journal.entries).find(row => row.kind === "BINDING_UPSERT"); assert.equal(entry.status, "CONFLICT"); assert.equal(entry.payload.kind, "BINDING_UPSERT"); assert.equal(entry.conflict.serverRevision, 7); }
  finally { f.worker.close(); }
});
await test("C3E-05", "delivery marker is compact and does not issue an immediate sync request", async () => {
  const f = await fixture();
  try { await startAndBind(f); const key = f.worker.identity.origin + "|" + f.worker.identity.conversation_id; await f.worker.request({ type: "OZ_REPORT_DELIVERY_CONFIRMED", tab_id: f.worker.tabId, conversation_key: key, delivery_id: "delivery-1", report_prefix_applied: true }, { tab: { id: f.worker.tabId } }); const entries = Object.values(f.backing.local[JOURNAL].entries); assert.equal(entries.at(-1).kind, "DELIVERY_MARKER"); assert.equal(f.worker.controlNetwork.filter(row => row.url.endsWith("/v1/sync")).length, 0); assert.equal("reportText" in entries.at(-1).payload, false); }
  finally { f.worker.close(); }
});
await test("C3E-06", "journal contains no prohibited secret or business content", async () => {
  const f = await fixture();
  try { await startAndBind(f); const text = JSON.stringify(f.backing.local[JOURNAL]); for (const forbidden of ["C3E_KEY", "C3E_CLIENT", "Authorization", "OZON_API_V1", "report", "token", "storageState"]) assert.equal(text.includes(forbidden), false, forbidden); }
  finally { f.worker.close(); }
});
await test("C3E-07", "stale response after newer known revision does not strand a metadata mutation in IN_FLIGHT", async () => {
  let releaseResponse;
  const f = await fixture(null, async (_url, init) => {
    const body = JSON.parse(init.body);
    await new Promise(resolve => { releaseResponse = resolve; });
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({
      requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1, serverState: entry.payload, code: null,
    })) }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const binding = await startAndBind(f);
    const conversationKey = f.worker.identity.origin + "|" + f.worker.identity.conversation_id;
    const intent = await f.worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey, binding, store: f.store });
    const flight = f.worker.call("SellerAgentsSyncJournal.syncNow", "stale-revision");
    await until(async () => Boolean(releaseResponse), "C3E-07 held response");
    const journal = f.backing.local[JOURNAL];
    const bindingEntry = Object.values(journal.entries).find(entry => entry.kind === "BINDING_UPSERT");
    assert.ok(bindingEntry);
    assert.equal(bindingEntry.status, "IN_FLIGHT");
    const slot = bindingEntry.accountId + "\u001f" + bindingEntry.entityId;
    const snapshotState = { ...bindingEntry.payload, kind: "FINISH", bindingState: "FINISHED",
      bindingRevision: bindingEntry.payload.bindingRevision + 1 };
    const snapshot = await f.worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent, currentConversationKey: conversationKey, binding, store: f.store,
      snapshots: [{ entityId: bindingEntry.entityId, serverRevision: 7, serverState: snapshotState }],
    });
    assert.equal(snapshot.applied, true, JSON.stringify(snapshot));
    releaseResponse();
    assert.equal((await flight).ok, true);
    const after = await f.worker.call("SellerAgentsSyncJournal.read");
    assert.equal(after.serverRevisions[slot], 7, "older ACK cannot roll back newer server revision");
    assert.deepEqual(after.serverStates[slot], snapshotState, "newer snapshot content must survive old ACK");
    assert.equal(after.reconciliation[slot]?.serverRevision, 7, "newer reconciliation must survive old ACK");
    const retained = after.entries[bindingEntry.entryId];
    assert.ok(retained, "stale ACK must not silently discard locally desired metadata");
    assert.equal(retained.status, "CONFLICT", "stale ACK cannot leave an unreschedulable IN_FLIGHT entry");
    assert.equal(retained.conflict?.serverRevision, 7);
    assert.equal(retained.conflict?.classification, "SYNC_STALE_REPLY_SUPERSEDED");
    assert.equal(retained.lastError, "SYNC_STALE_REPLY_SUPERSEDED");
    assert.equal(retained.payload.kind, "BINDING_UPSERT");
    const storeEntry = Object.values(journal.entries).find(entry => entry.kind === "STORE_UPSERT");
    assert.ok(storeEntry);
    assert.equal(after.entries[storeEntry.entryId], undefined, "unrelated successful ACK still compacts");
    const repeat = await f.worker.call("SellerAgentsSyncJournal.syncNow", "after-stale");
    assert.equal(repeat.sent, 0, "explicit conflict must not replay the old metadata request");
  } finally { releaseResponse?.(); f.worker.close(); }
});
for (const [id, label, invalidRow] of [
  ["C3E-08", "negative ACK revision", { outcome: "ACK", serverRevision: -1 }],
  ["C3E-09", "unknown result outcome", { outcome: "UNKNOWN_OUTCOME", serverRevision: 1 }],
  ["C3E-10", "nonnumeric RETRY revision", { outcome: "RETRY", serverRevision: "not-a-number" }],
  ["C3E-11", "malformed response state", { outcome: "ACK", serverRevision: 1, serverState: "invalid-state" }],
  ["C3E-12", "malformed diagnostic code", { outcome: "ACK", serverRevision: 1, code: { detail: "invalid-code" } }],
]) await test(id, "invalid " + label + " cannot be misclassified as a stale valid reply", async () => {
  let releaseResponse;
  const f = await fixture(null, async (_url, init) => {
    const body = JSON.parse(init.body);
    await new Promise(resolve => { releaseResponse = resolve; });
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({
      requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      serverState: entry.payload, code: null,
      ...(entry.kind === "BINDING_UPSERT" ? invalidRow : { outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1 }),
    })) }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const binding = await startAndBind(f);
    await f.worker.call("(() => { const catalog = globalThis.SellerAgentsActiveStoreCatalog; if (!catalog?.applyRemoteMetadata) throw new Error('Catalog spy unavailable'); globalThis.__c3eCatalogApplyCalls = 0; globalThis.SellerAgentsActiveStoreCatalog = { ...catalog, applyRemoteMetadata: async () => { globalThis.__c3eCatalogApplyCalls += 1; return true; } }; })");
    const conversationKey = f.worker.identity.origin + "|" + f.worker.identity.conversation_id;
    const intent = await f.worker.call("SellerAgentsSyncJournal.createSnapshotReadIntent", { conversationKey, binding, store: f.store });
    const flight = f.worker.call("SellerAgentsSyncJournal.syncNow", "invalid-stale-reply");
    await until(async () => Boolean(releaseResponse), id + " held reply");
    const journal = f.backing.local[JOURNAL];
    const entry = Object.values(journal.entries).find(row => row.kind === "BINDING_UPSERT");
    assert.ok(entry);
    const slot = entry.accountId + "\u001f" + entry.entityId;
    const snapshotState = { ...entry.payload, kind: "FINISH", bindingState: "FINISHED", bindingRevision: entry.payload.bindingRevision + 1 };
    const snapshot = await f.worker.call("SellerAgentsSyncJournal.applySnapshotRead", {
      intent, currentConversationKey: conversationKey, binding, store: f.store,
      snapshots: [{ entityId: entry.entityId, serverRevision: 7, serverState: snapshotState }],
    });
    assert.equal(snapshot.applied, true, JSON.stringify(snapshot));
    releaseResponse();
    const outcome = await flight;
    assert.equal(outcome.ok, false, "invalid server reply must not report a successful sync");
    assert.equal(outcome.code, "SYNC_CONTRACT_INVALID");
    const after = await f.worker.call("SellerAgentsSyncJournal.read");
    assert.equal(after.serverRevisions[slot], 7);
    assert.deepEqual(after.serverStates[slot], snapshotState);
    assert.equal(after.reconciliation[slot]?.serverRevision, 7);
    assert.equal(after.entries[entry.entryId]?.status, "FAILED", "invalid reply is fail-closed, not a valid conflict");
    assert.equal(after.entries[entry.entryId]?.lastError, "SYNC_CONTRACT_INVALID");
    assert.equal(await f.worker.call("(() => globalThis.__c3eCatalogApplyCalls)"), 0,
      "invalid later row cannot partially apply the earlier STORE_UPSERT ACK");
  } finally { releaseResponse?.(); f.worker.close(); }
});
// A malformed later result must never be lost in a Map overwrite or reach
// catalog effects while an earlier STORE_UPSERT row is otherwise valid.
for (const [id, label, transform] of [
  ["C3E-13", "duplicate requestId hides invalid first row", rows => {
    const last = rows.at(-1);
    return [...rows.slice(0, -1), { ...last, outcome: "INVALID_DUPLICATE" }, last];
  }],
  ["C3E-14", "unrequested extra server row", rows => [...rows, {
    ...rows.at(-1), requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }]],
  ["C3E-15", "lower-case diagnostic code", rows => rows.map((row, index) =>
    index === rows.length - 1 ? { ...row, code: "lowercase_code" } : row)],
  ["C3E-16", "partial server state missing strict required fields", rows => rows.map((row, index) =>
    index === rows.length - 1 ? { ...row, serverState: { kind: "FINISH" } } : row)],
]) await test(id, "whole-batch rejects " + label + " before an earlier store ACK side effect", async () => {
  const f = await fixture(null, async (_url, init) => {
    const body = JSON.parse(init.body);
    const rows = body.entries.map(entry => ({
      requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1,
      serverState: entry.payload, code: null,
    }));
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: transform(rows) }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  try {
    await startAndBind(f);
    await f.worker.call("(() => { const catalog = globalThis.SellerAgentsActiveStoreCatalog; if (!catalog?.applyRemoteMetadata) throw new Error('catalog spy unavailable'); globalThis.__c3eFullBatchSpies=0; globalThis.SellerAgentsActiveStoreCatalog={...catalog,applyRemoteMetadata: async () => { globalThis.__c3eFullBatchSpies++;return true; }}; })");
    const first = await f.worker.call("SellerAgentsSyncJournal.read");
    const included = Object.values(first.entries).filter(entry => entry.status === "PENDING");
    assert.ok(included.some(entry => entry.kind === "STORE_UPSERT"));
    assert.ok(included.some(entry => entry.kind === "BINDING_UPSERT"));
    const outcome = await f.worker.call("SellerAgentsSyncJournal.syncNow", id);
    assert.equal(outcome.ok, false, "invalid whole response must never report sync success");
    assert.equal(outcome.code, "SYNC_CONTRACT_INVALID");
    const readback = await f.worker.call("SellerAgentsSyncJournal.read");
    for (const entry of included) {
      assert.equal(readback.entries[entry.entryId]?.status, "FAILED", "invalid batch retains failed local intent");
      assert.equal(readback.entries[entry.entryId]?.lastError, "SYNC_CONTRACT_INVALID");
    }
    assert.equal(await f.worker.call("(() => globalThis.__c3eFullBatchSpies)"), 0,
      "no earlier store metadata side effect before full response validation");
  } finally { f.worker.close(); }
});
await test("C3E-17", "strict valid nested server reconciliation remains accepted", async () => {
  const f = await fixture(null, async (_url, init) => {
    const body = JSON.parse(init.body);
    const rows = body.entries.map(entry => ({
      requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1, code: null,
      serverState: { ...entry.payload, reconciliation: {
        classification: "SERVER_AHEAD_COMPATIBLE",
        preferred: { state: "UNSET", installationId: null },
        markers: [], observedInstallationIds: [], serverReceiveAtMs: null,
      }},
    }));
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: rows }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  try {
    await startAndBind(f);
    const result = await f.worker.call("SellerAgentsSyncJournal.syncNow", "strict-nested-valid");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.sent, 2);
    const after = await f.worker.call("SellerAgentsSyncJournal.read");
    assert.equal(Object.keys(after.entries).length, 0);
    assert.equal(Object.values(after.reconciliation).some(state =>
      state.serverState?.reconciliation?.classification === "SERVER_AHEAD_COMPATIBLE"), true);
  } finally { f.worker.close(); }
});
// SyncDeliveryOrderSchema and SyncMarkerSchema both permit nullable clientSequence.
function c3eSequenceServerState(entry, variant, sequence) {
  if (entry.kind !== "BINDING_UPSERT") return entry.payload;
  if (variant === "order") return { ...entry.payload, deliveryOrder: {
    aiOrderId: null, clientDeliveredAtMs: null, clientSequence: sequence,
    orderProvenance: "CLIENT_APPROXIMATE", serverReceiveAtMs: null,
  }};
  return { ...entry.payload, reconciliation: {
    classification: "SERVER_AHEAD_COMPATIBLE",
    preferred: { state: "UNSET", installationId: null },
    markers: [{
      installationId: "22222222-2222-4222-8222-222222222222",
      deliveryMarkerId: "c3e-sequence-check",
      bindingId: entry.payload.bindingId, bindingRevision: entry.payload.bindingRevision,
      storeId: entry.payload.storeId, marketplace: entry.payload.marketplace,
      orderProvenance: "CLIENT_APPROXIMATE", serverReceiveAtMs: 1,
      clientSequence: sequence,
    }],
    observedInstallationIds: [], serverReceiveAtMs: null,
  }};
}
for (const [id, variant] of [["C3E-18", "order"], ["C3E-19", "marker"]]) {
  await test(id, "Zod-valid nullable " + variant + " clientSequence is accepted and retained", async () => {
    const f = await fixture(null, async (_url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({
        requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
        outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1,
        serverState: c3eSequenceServerState(entry, variant, null), code: null,
      })) }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      await startAndBind(f);
      const outcome = await f.worker.call("SellerAgentsSyncJournal.syncNow", id);
      assert.equal(outcome.ok, true, "valid nullable sequence must not be rejected");
      assert.equal(outcome.sent, 2);
      const after = await f.worker.call("SellerAgentsSyncJournal.read");
      assert.equal(Object.keys(after.entries).length, 0);
      const retained = Object.values(after.serverStates).find(state =>
        state?.kind === "BINDING_UPSERT");
      assert.ok(retained, "valid binding ACK persists");
      assert.equal(variant === "order" ? retained.deliveryOrder?.clientSequence :
        retained.reconciliation?.markers?.[0]?.clientSequence, null);
    } finally { f.worker.close(); }
  });
}
for (const [id, variant, sequence] of [
  ["C3E-20", "order", -1],
  ["C3E-21", "order", Number.MAX_SAFE_INTEGER + 1],
  ["C3E-22", "marker", -1],
  ["C3E-23", "marker", Number.MAX_SAFE_INTEGER + 1],
]) await test(id, "invalid " + variant + " clientSequence fails whole batch without store effects", async () => {
  const f = await fixture(null, async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: body.entries.map(entry => ({
      requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId,
      outcome: "ACK", serverRevision: Number(entry.baseRevision || 0) + 1,
      serverState: c3eSequenceServerState(entry, variant, sequence), code: null,
    })) }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    await startAndBind(f);
    await f.worker.call("(() => { const old = globalThis.SellerAgentsActiveStoreCatalog; globalThis.__c3eNullableStoreCalls = 0; globalThis.SellerAgentsActiveStoreCatalog = { ...old, applyRemoteMetadata: async () => { globalThis.__c3eNullableStoreCalls++; return true; } }; })");
    const outcome = await f.worker.call("SellerAgentsSyncJournal.syncNow", id);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "SYNC_CONTRACT_INVALID");
    assert.equal(await f.worker.call("(() => globalThis.__c3eNullableStoreCalls)"), 0);
    const after = await f.worker.call("SellerAgentsSyncJournal.read");
    for (const entry of Object.values(after.entries)) {
      assert.equal(entry.status, "FAILED");
      assert.equal(entry.lastError, "SYNC_CONTRACT_INVALID");
    }
  } finally { f.worker.close(); }
});
const failures = results.filter(result => result.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "C3E_RARE_EXTENSION_INITIATED_SYNC_JOURNAL", results, failureBatch: failures }, null, 2));
if (failures.length) process.exitCode = 1;
