import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const SESSIONS = "ozmb_work_sessions_v1";
const BINDINGS = "ozmb_conversation_bindings";
const STORES = "seller_agents_stores_v1";
const cases = [];
const clone = value => value == null ? value : structuredClone(value);

async function started(options = {}) {
  const worker = await makeWorker(runtime, { fetch: async url => { throw new Error("offline evaluator must not call " + url); } });
  await worker.settings();
  const popup = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
  const store = popup.stores[0];
  const key = await worker.start();
  return { worker, key, store, options };
}

function inputFor(fixture) {
  const { worker, key, store } = fixture;
  const authority = clone(worker.backing.local[AUTH].authority);
  const clock = clone(worker.backing.local[AUTH].cacheClock);
  const session = clone(worker.backing.local[SESSIONS][key]);
  const binding = clone(worker.backing.local[BINDINGS][key]);
  const receipt = clone(session.admission_provenance);
  const payload = authority.payload, profile = payload.ai.profile;
  return {
    operation: "CONTINUE", work: session, receipt, cachedAuthority: authority, cacheClock: clock, safeTimeMs: clock.effectiveTimeMs,
    identity: { origin: binding.origin, conversationId: binding.conversation_id }, binding, store: clone(worker.backing.local[STORES].accounts[store.accountId].stores[store.id]),
    current: { accountId: store.accountId, generation: authority.generation, deviceId: authority.deviceId, sessionId: authority.sessionId, origin: binding.origin, conversationId: binding.conversation_id, conversationKey: key, bindingId: binding.binding_id, bindingRevision: binding.revision, marketplace: store.marketplace, storeId: store.id, credentialRevision: store.credentialRevision, aiFamily: payload.ai.detected.family, aiSurface: payload.ai.detected.surface, aiVariant: payload.ai.detected.variant, aiProfileKey: profile.profileKey, aiProfileRevision: profile.revision, aiProfileScopeVariant: profile.scopeVariant, aiProfileContentSha256: profile.contentSha256, workStartIntentId: session.start_intent_id },
  };
}

async function run(id, fn) {
  try { await fn(); cases.push({ id, status: "PASS" }); }
  catch (error) { cases.push({ id, status: "FAIL", error: `${error.code ? error.code + ": " : ""}${error.message}` }); }
}

let fixture = await started();
await run("OFF-40", async () => {
  const worker = await makeWorker(runtime, { fetch: async url => { throw new Error("new-dialogue offline network " + url); } });
  try {
    await worker.settings();
    const stores = (await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId })).stores;
    worker.setIdentity({ conversation_id: null, status: "unknown" });
    const accepted = await worker.popup({ type: "SA_WORK_START", store_id: stores[0].id, tab_id: worker.tabId, confirm_change: false, start_intent_id: "new-dialogue-start" });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const pending = await until(async () => (await worker.call("getPendingWorkStarts"))[worker.tabId]?.send_outcome === "sent_acknowledged" ? (await worker.call("getPendingWorkStarts"))[worker.tabId] : null, "new-dialogue pending acknowledgement");
    const finalIdentity = worker.setIdentity({ conversation_id: "new-dialogue-final", status: "confirmed" });
    const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: finalIdentity, first_response_complete: true }, { tab: { id: worker.tabId } });
    assert.equal(active.ok, true, JSON.stringify(active));
    const key = "https://chatgpt.com|new-dialogue-final", receipt = worker.backing.local[SESSIONS][key].admission_provenance;
    assert.equal(receipt.mode, "ONLINE_VERIFIED"); assert.equal(receipt.conversationKey, key); assert.ok(receipt.bindingId);
  } finally { worker.close(); }
});
await run("OFF-42", async () => { const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(result.allowed, true); assert.equal(result.executionAuthority, false); });
await run("OFF-43", async () => { await fixture.worker.popup({ type: "OZ_WORK_FINISH", tab_id: fixture.worker.tabId, conversation_key: fixture.key }); const resumed = await fixture.worker.popup({ type: "SA_WORK_RESUME", tab_id: fixture.worker.tabId, conversation_key: fixture.key }); assert.equal(resumed.ok, true, JSON.stringify(resumed)); const receipt = fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance; assert.equal(receipt.operation, "RESUME"); const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(result.allowed, true); });
await run("OFF-47", async () => { await fixture.worker.popup({ type: "OZ_WORK_FINISH", tab_id: fixture.worker.tabId, conversation_key: fixture.key }); assert.equal(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance, null); });
fixture.worker.close();

fixture = await started();
await run("OFF-45", async () => {
  const target = (await fixture.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "wildberries", name: "Offline target", credentials: { token: "OFFLINE-TARGET" } } })).store;
  const accepted = await fixture.worker.popup({ type: "SA_WORK_START", store_id: target.id, tab_id: fixture.worker.tabId, confirm_change: true, start_intent_id: "offline-rebind-target" });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const pending = await until(async () => {
    const row = (await fixture.worker.call("getPendingWorkStarts"))[fixture.worker.tabId];
    return row?.send_outcome === "sent_acknowledged" ? row : null;
  }, "target rebind acknowledgement");
  const active = await fixture.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: fixture.worker.identity, first_response_complete: true }, { tab: { id: fixture.worker.tabId } });
  assert.equal(active.ok, true, JSON.stringify(active));
  const receipt = fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance;
  assert.equal(receipt.storeId, target.id); assert.equal(receipt.marketplace, "wildberries"); assert.equal(receipt.operation, "START");
  const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor({ worker: fixture.worker, key: fixture.key, store: target }));
  assert.equal(result.allowed, true); assert.equal(result.executionAuthority, false);
});
await run("OFF-46", async () => {
  const before = clone(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance);
  const target = (await fixture.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", name: "Offline rejected target", credentials: { seller: { clientId: "REJECTED", apiKey: "REJECTED" }, performance: {} } } })).store;
  const rejected = await fixture.worker.popup({ type: "SA_WORK_START", store_id: target.id, tab_id: fixture.worker.tabId, confirm_change: false, start_intent_id: "offline-rebind-rejected" });
  assert.equal(rejected.ok, false); assert.equal(rejected.code, "STORE_CHANGE_CONFIRMATION_REQUIRED");
  assert.deepEqual(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance, before);
});
fixture.worker.close();

fixture = await started();
await run("OFF-51", async () => { const backing = fixture.worker.backing; fixture.worker.close(); const restarted = await makeWorker(runtime, { backing, fetch: async url => { throw new Error("restart offline network " + url); } }); try { const before = restarted.controlNetwork.length; const result = await restarted.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor({ worker: restarted, key: fixture.key, store: fixture.store })); assert.equal(result.allowed, true); assert.equal(restarted.controlNetwork.length, before); } finally { restarted.close(); } });
await run("OFF-52", async () => { const auth = fixture.worker.backing.local[AUTH]; assert.equal(Object.prototype.hasOwnProperty.call(auth, "health"), false); assert.equal(JSON.stringify(auth).includes("healthEnvelope"), false); assert.equal(JSON.stringify(auth).includes("healthClaim"), false); });
await run("OFF-53", async () => { const before = fixture.worker.controlNetwork.length; await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(fixture.worker.controlNetwork.length, before); });
await run("OFF-54", async () => { const before = fixture.worker.controlNetwork.length; await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(fixture.worker.controlNetwork.length, before); });
await run("OFF-55", async () => { assert.equal(fixture.worker.network.length, 0); });
await run("OFF-56", async () => { const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.deniedGates), true); const detached = inputFor(fixture); detached.receipt.mode = "CACHE"; assert.equal(result.allowed, true); });
await run("OFF-57", async () => { const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", inputFor(fixture)); assert.equal(result.executionAuthority, false); });
await run("OFF-48", async () => { await fixture.worker.popup({ type: "SA_STORE_DELETE", store_id: fixture.store.id, confirm: true }); assert.equal(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance, null); });
fixture.worker.close();

fixture = await started();
await run("OFF-49", async () => { const response = await fixture.worker.popup({ type: "SA_STORE_SAVE", store: { id: fixture.store.id, marketplace: fixture.store.marketplace, name: fixture.store.name, credentials: { seller: { clientId: "CHANGED_CLIENT", apiKey: "CHANGED_KEY" }, performance: {} } } }); assert.equal(response.ok, true); assert.equal(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance, null); });
fixture.worker.close();

fixture = await started();
await run("OFF-50", async () => { const response = await fixture.worker.popup({ type: "SA_AUTH_RESET" }); assert.equal(response.ok, true); assert.equal(fixture.worker.backing.local[SESSIONS][fixture.key].admission_provenance, null); });
fixture.worker.close();

const failed = cases.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", scope: "C2.3-C2_LIFECYCLE_PROVENANCE_RESTART_INVALIDATION", cases, failureBatch: failed, executionAuthority: false }, null, 2));
if (failed.length) process.exitCode = 1;
