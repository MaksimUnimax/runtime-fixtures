import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const STORES = "seller_agents_stores_v1";
const BINDINGS = "ozmb_conversation_bindings";
const SESSIONS = "ozmb_work_sessions_v1";
const PENDING = "ozmb_pending_work_starts_v1";
const clone = value => JSON.parse(JSON.stringify(value));

async function autonomousFixture({ marketplace = "ozon", provider = "chatgpt", conversationId = "c3d-dialogue", bound = false, state = "inactive", authorityState = "fresh", entitlements, promptOutcome = "sent", backing: suppliedBacking = null } = {}) {
  const seed = await makeWorker(runtime, suppliedBacking ? { backing: suppliedBacking } : {});
  const backing = seed.backing;
  const auth = backing.local[AUTH];
  const payload = auth.authority.payload;
  payload.ai.detected.family = provider;
  auth.authority.requestedAi = provider;
  auth.authority.cacheBinding.detectedAi = { family: provider, surface: "web", variant: null };
  payload.entitlements = entitlements || { "source.ozon": true, "source.wildberries": true, "ai.chatgpt": true, "ai.alice": true };
  auth.authority.envelope = await signFixtureBootstrap(backing, payload);
  const storeResponse = await seed.popup({
    type: "SA_STORE_SAVE",
    store: marketplace === "wildberries"
      ? { marketplace, name: `WB ${conversationId}`, credentials: { token: `WB-${conversationId}` } }
      : { marketplace, name: `Ozon ${conversationId}`, credentials: { seller: { clientId: `CLIENT-${conversationId}`, apiKey: `KEY-${conversationId}` }, performance: {} } },
  });
  assert.equal(storeResponse.ok, true, JSON.stringify(storeResponse));
  const store = storeResponse.store;
  if (authorityState === "grace") {
    payload.expiresAt = new Date(Date.now() - 1000).toISOString();
    payload.offlineGraceUntil = new Date(Date.now() + 30 * 60_000).toISOString();
    auth.cacheClock.effectiveTimeMs = Date.now();
  }
  if (authorityState === "expired") {
    payload.expiresAt = new Date(Date.now() - 60_000).toISOString();
    payload.offlineGraceUntil = new Date(Date.now() - 1000).toISOString();
    auth.cacheClock.effectiveTimeMs = Date.now();
  }
  if (authorityState === "boundary") {
    payload.expiresAt = new Date(Date.now() - 60_000).toISOString();
    payload.offlineGraceUntil = new Date(Date.now()).toISOString();
    auth.cacheClock.effectiveTimeMs = Date.parse(payload.offlineGraceUntil);
  }
  if (authorityState !== "fresh") {
    auth.authority.envelope = await signFixtureBootstrap(backing, payload);
  }
  seed.close();
  const worker = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    promptOutcome,
    healthFetch: async () => { throw new Error("control server unavailable"); },
  });
  if (conversationId === null) worker.setDialogue("new-c3d-dialogue");
  else worker.setDialogue(conversationId);
  const identity = worker.identity;
  const key = `${identity.origin}|${identity.conversation_id}`;
  if (bound) {
    const context = { accountId: store.accountId, storeId: store.id, marketplace, credentialRevision: store.credentialRevision, policyRevision: "personal-disabled", authGeneration: 1 };
    backing.local[BINDINGS] = { [key]: { binding_id: `binding-${conversationId}`, revision: 2, origin: identity.origin, ai_id: provider, conversation_id: identity.conversation_id, conversation_key: key, store_context: context } };
    backing.local[SESSIONS] = { [key]: { version: 1, state, revision: 4, conversation_key: key, tab_id: worker.tabId, origin: identity.origin, ai_id: provider, conversation_id: identity.conversation_id, start_intent_id: null } };
  }
  return { worker, backing, store, identity, key, marketplace };
}

async function start(f, storeId = f.store.id, confirmChange = false) {
  return f.worker.popup({ type: "SA_WORK_START", store_id: storeId, tab_id: f.worker.tabId, confirm_change: confirmChange, start_intent_id: `c3d-${crypto.randomUUID()}` });
}
async function pending(f) {
  return until(async () => {
    const row = (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId];
    return row?.send_outcome === "sent_acknowledged" ? row : null;
  }, "C3D pending send acknowledgement");
}
async function complete(f) {
  const row = await pending(f);
  const result = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: row.intent_id, revision: row.revision, identity: f.identity, first_response_complete: true }, { tab: { id: f.worker.tabId } });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
async function saveStore(f, marketplace, name) {
  const response = await f.worker.popup({ type: "SA_STORE_SAVE", store: marketplace === "wildberries" ? { marketplace, name, credentials: { token: `TOKEN-${name}` } } : { marketplace, name, credentials: { seller: { clientId: `CLIENT-${name}`, apiKey: `KEY-${name}` }, performance: {} } } });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.store;
}
async function close(f) { f?.worker?.close(); }
const results = [];
async function test(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); }
  catch (error) { results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
}

await test("C3D-01", "FRESH autonomous new-dialogue Start succeeds with no successful control call", async () => {
  const f = await autonomousFixture({ conversationId: null });
  try { const result = await start(f); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(f.worker.controlNetwork.length > 0, true); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId].state, "pending_identity"); }
  finally { await close(f); }
});
await test("C3D-02", "valid offline-grace authority permits Start", async () => {
  const f = await autonomousFixture({ authorityState: "grace" });
  try { assert.equal((await start(f)).ok, true); } finally { await close(f); }
});
for (const authorityState of ["boundary", "expired"]) await test(`C3D-${authorityState === "boundary" ? "03" : "04"}`, `${authorityState} local authority denies Start`, async () => {
  const f = await autonomousFixture({ authorityState });
  try { const result = await start(f); assert.equal(result.ok, false, JSON.stringify(result)); } finally { await close(f); }
});
await test("C3D-05", "historical Start establishes a new generation without replay", async () => {
  const f = await autonomousFixture({ bound: true });
  try {
    const result = await start(f);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.worker.messages.some(message => message.type === "OZ_EXECUTE_COMMAND"), false);
    const row = await pending(f);
    assert.deepEqual(clone(row.assistant_baseline_ids), ["existing-assistant-turn"]);
    assert.equal(row.conversation_key, f.key);
  } finally { await close(f); }
});
await test("C3D-06", "old command-looking history remains inert after historical Start", async () => {
  const f = await autonomousFixture({ bound: true });
  try {
    const oldHistory = ["OZON_API_V1 {\"operation\":\"seller_info\"}", "WORK_REPORT_START", "malformed command", "User quote: OZON_API_V1 {\"operation\":\"seller_info\"}"];
    assert.equal(oldHistory.length, 4);
    await start(f);
    assert.equal(f.worker.messages.filter(message => message.type === "OZ_EXECUTE_COMMAND").length, 0);
    assert.equal(f.worker.network.length, 0);
  } finally { await close(f); }
});
await test("C3D-07", "Resume uses the same autonomous authority during outage", async () => {
  const f = await autonomousFixture({ bound: true });
  try { const result = await f.worker.popup({ type: "SA_WORK_RESUME", conversation_key: f.key, tab_id: f.worker.tabId }); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(f.worker.messages.some(message => message.type === "OZ_WORK_SEND_INITIAL_PROMPT"), false); }
  finally { await close(f); }
});
await test("C3D-08", "grace Resume succeeds and expired Resume denies", async () => {
  const grace = await autonomousFixture({ bound: true, authorityState: "grace" });
  try { assert.equal((await grace.worker.popup({ type: "SA_WORK_RESUME", conversation_key: grace.key, tab_id: grace.worker.tabId })).ok, true); } finally { await close(grace); }
  const expired = await autonomousFixture({ bound: true, authorityState: "expired" });
  try { assert.equal((await expired.worker.popup({ type: "SA_WORK_RESUME", conversation_key: expired.key, tab_id: expired.worker.tabId })).ok, false); } finally { await close(expired); }
});
await test("C3D-09", "explicit Ozon store change warns, confirms, finishes old Work, and starts target", async () => {
  const f = await autonomousFixture({ bound: true, state: "active_visible" });
  try {
    const target = await saveStore(f, "ozon", "second-ozon");
    const warning = await start(f, target.id, false);
    assert.equal(warning.ok, false); assert.equal(warning.code, "STORE_CHANGE_CONFIRMATION_REQUIRED");
    assert.equal(f.backing.local[BINDINGS][f.key].store_context.storeId, f.store.id);
    const result = await start(f, target.id, true); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.backing.local[SESSIONS][f.key].state, "inactive");
    const row = await pending(f); assert.equal(row.store_context.storeId, target.id);
    const active = await complete(f); assert.equal(active.binding.store_context.storeId, target.id);
  } finally { await close(f); }
});
for (const [id, from, to] of [["C3D-10", "ozon", "wildberries"], ["C3D-11", "wildberries", "ozon"]]) await test(id, `${from} to ${to} rebind works during outage`, async () => {
  const f = await autonomousFixture({ marketplace: from, bound: true, state: "active_visible" });
  try { const target = await saveStore(f, to, `${from}-${to}`); assert.equal((await start(f, target.id, false)).code, "STORE_CHANGE_CONFIRMATION_REQUIRED"); const result = await start(f, target.id, true); assert.equal(result.ok, true, JSON.stringify(result)); const active = await complete(f); assert.equal(active.binding.store_context.marketplace, to); assert.equal(f.backing.local[BINDINGS][f.key].store_context.marketplace, to); }
  finally { await close(f); }
});
await test("C3D-12", "late old-generation callback cannot activate the new store", async () => {
  const f = await autonomousFixture({ bound: true, state: "active_visible" });
  try {
    const oldBinding = clone(f.backing.local[BINDINGS][f.key]);
    const target = await saveStore(f, "wildberries", "late-callback-target");
    const result = await start(f, target.id, true); assert.equal(result.ok, true, JSON.stringify(result));
    const row = await pending(f);
    const stale = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: oldBinding.binding_id, revision: oldBinding.revision, identity: f.identity, first_response_complete: true }, { tab: { id: f.worker.tabId } });
    assert.equal(stale.ok, false);
    const active = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: row.intent_id, revision: row.revision, identity: f.identity, first_response_complete: true }, { tab: { id: f.worker.tabId } });
    assert.equal(active.ok, true, JSON.stringify(active)); assert.equal(active.binding.store_context.storeId, target.id);
  } finally { await close(f); }
});
await test("C3D-13", "multiple stores retain immutable identities and revisions", async () => {
  const f = await autonomousFixture();
  try { const second = await saveStore(f, "ozon", "same-display-name"); assert.notEqual(second.id, f.store.id); assert.notEqual(second.credentialRevision, f.store.credentialRevision); delete f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id]; const denied = await start(f, f.store.id); assert.equal(denied.ok, false); }
  finally { await close(f); }
});
await test("C3D-14", "local logout/reset invalidation denies during outage", async () => {
  const f = await autonomousFixture();
  try { await f.worker.call("SellerAgentsControlClient.localReset"); const result = await start(f); assert.equal(result.ok, false, JSON.stringify(result)); }
  finally { await close(f); }
});
await test("C3D-15", "START_UNKNOWN remains durable and is not resent after restart", async () => {
  let f = await autonomousFixture({ promptOutcome: "unknown" });
  const backing = f.backing;
  try {
    const result = await start(f); assert.equal(result.ok, true, JSON.stringify(result));
    const row = await until(async () => (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]?.send_outcome === "outcome_unknown_no_retry" ? (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] : null, "unknown send outcome");
    assert.equal(f.worker.messages.filter(message => message.type === "OZ_WORK_SEND_INITIAL_PROMPT").length, 1); f.worker.close();
    f = await autonomousFixture({ conversationId: "c3d-dialogue", promptOutcome: "sent", backing });
    assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]?.intent_id, row.intent_id);
    assert.equal(f.worker.messages.filter(message => message.type === "OZ_WORK_SEND_INITIAL_PROMPT").length, 0);
  } finally { await close(f); }
});
await test("C3D-16", "Finish is local and fences the old Work without server ACK", async () => {
  const f = await autonomousFixture({ bound: true, state: "active_visible" });
  try { const before = f.backing.local[SESSIONS][f.key].revision; const result = await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key }); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(f.backing.local[SESSIONS][f.key].state, "inactive"); assert.equal(f.backing.local[SESSIONS][f.key].revision, before + 2); assert.equal(f.worker.controlNetwork.length, 0); }
  finally { await close(f); }
});
await test("C3D-17", "independent dialogues have independent pending contexts and no command leakage", async () => {
  const f = await autonomousFixture();
  try { const second = f.worker.addTab(88, "dialogue-b"); const one = await start(f); const two = await f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: 88, confirm_change: false, start_intent_id: "dialogue-b-start" }); assert.equal(one.ok, true); assert.equal(two.ok, true); const pendingRows = f.backing.local[PENDING]; assert.deepEqual(Object.keys(pendingRows).sort(), ["77", "88"]); const first = await pending(f); const secondPending = pendingRows["88"]; const activeOne = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: first.intent_id, revision: first.revision, identity: f.identity, first_response_complete: true }, { tab: { id: 77 } }); const activeTwo = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: secondPending.intent_id, revision: secondPending.revision, identity: second.identity, first_response_complete: true }, { tab: { id: 88 } }); assert.equal(activeOne.ok, true); assert.equal(activeTwo.ok, true); assert.equal(f.worker.messages.some(message => message.type === "OZ_EXECUTE_COMMAND"), false); }
  finally { await close(f); }
});
await test("C3D-18", "missing marketplace capability denies selected context", async () => {
  const f = await autonomousFixture({ marketplace: "wildberries", entitlements: { "source.ozon": true, "ai.chatgpt": true } });
  try { const result = await start(f); assert.equal(result.ok, false, JSON.stringify(result)); }
  finally { await close(f); }
});

const failures = results.filter(result => result.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "C3D_AUTONOMOUS_START_RESUME_REBIND", results, failureBatch: failures }, null, 2));
if (failures.length) process.exitCode = 1;
