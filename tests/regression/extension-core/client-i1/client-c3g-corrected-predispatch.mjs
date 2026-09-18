import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const STORES = "seller_agents_stores_v1";
const BINDINGS = "ozmb_conversation_bindings";
const SESSIONS = "ozmb_work_sessions_v1";
const JOURNAL = "seller_agents_sync_journal_v1";
const API = 'OZON_API_V1 {"operation":"seller_info","params":{}}';
const clone = value => JSON.parse(JSON.stringify(value));
const results = [];

async function test(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); }
  catch (error) { results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
}

async function fixture({ marketplace = "ozon", authority = "fresh", fetch = null, backing = null } = {}) {
  const seed = await makeWorker(runtime, backing ? { backing } : {});
  const storeResponse = await seed.popup({ type: "SA_STORE_SAVE", store: marketplace === "wildberries"
    ? { marketplace, credentials: { token: "C3G-WB-FIXTURE-TOKEN" }, personalDataEnabled: true }
    : { marketplace, credentials: { seller: { clientId: "C3G-OZON-CLIENT", apiKey: "C3G-OZON-KEY" }, performance: {} }, personalDataEnabled: true } });
  assert.equal(storeResponse.ok, true, JSON.stringify(storeResponse));
  const store = storeResponse.store;
  const auth = seed.backing.local[AUTH];
  if (authority !== "fresh") {
    const now = Date.now();
    auth.authority.payload.expiresAt = new Date(authority === "grace" ? now - 1000 : now - 60_000).toISOString();
    auth.authority.payload.offlineGraceUntil = new Date(authority === "grace" ? now + 30 * 60_000 : now - 1000).toISOString();
    auth.cacheClock.effectiveTimeMs = authority === "boundary" ? Date.parse(auth.authority.payload.offlineGraceUntil) : now;
    auth.authority.envelope = await signFixtureBootstrap(seed.backing, auth.authority.payload);
  }
  seed.close();
  const worker = await makeWorker(runtime, { backing: seed.backing, seedAuthority: false,
    healthFetch: async () => { throw new Error("control server unavailable"); },
    fetch: fetch || (async url => {
      return new Response('{"result":[]}', { headers: { "content-type": "application/json" } });
    }) });
  return { worker, backing: seed.backing, store, key: `${worker.identity.origin}|${worker.identity.conversation_id}` };
}

async function start(f) {
  const result = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: f.store.id, confirm_change: true, start_intent_id: `c3g-${crypto.randomUUID()}` });
  assert.equal(result.ok, true, JSON.stringify(result));
  let pending;
  try { pending = await until(async () => (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]?.send_outcome === "sent_acknowledged"
    ? (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] : null, "C3G Start acknowledgement"); }
  catch (error) { throw error; }
  const active = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: f.worker.identity, first_response_complete: true });
  assert.equal(active.ok, true, JSON.stringify(active));
  f.key = active.binding.conversation_key;
  return active;
}

async function execute(f, source = API, id = `c3g-command-${crypto.randomUUID()}`) {
  const work = await f.worker.call("workSessionFor", f.key);
  return f.worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: f.key, command_text: source, manual_request_id: id, work_session_id: work.start_intent_id });
}

async function waitFailed(f) {
  return until(async () => {
    const owner = await f.worker.call("getManualOperation", f.key);
    return owner?.status === "failed" ? owner : null;
  }, "C3G local denial");
}

function journalState(f, patch) {
  const binding = f.backing.local[BINDINGS][f.key];
  const state = {
    version: "seller_agents_sync_v1", sequence: 1, entries: {}, serverRevisions: {}, serverStates: {},
    reconciliation: {}, snapshotAt: Date.now(),
  };
  state.reconciliation[binding.binding_id] = {
    classification: patch.classification,
    preferred: patch.preferred || null,
    serverRevision: patch.serverRevision || binding.revision,
    serverState: { accountId: f.store.accountId, entityId: binding.binding_id, conversationKeyDigest: f.key,
      bindingId: binding.binding_id, bindingRevision: patch.bindingRevision || binding.revision, storeId: patch.storeId || f.store.id,
      marketplace: patch.marketplace || f.store.marketplace, credentialRevision: f.store.credentialRevision,
      workGeneration: patch.workGeneration || f.backing.local[SESSIONS][f.key].start_intent_id || null,
      bindingState: patch.bindingState || "BOUND" },
  };
  f.backing.local[JOURNAL] = state;
}

await test("C3G-RED-10", "known newer explicit binding revision was not a provider fence before C3G", async () => {
  const f = await fixture();
  try {
    await start(f);
    journalState(f, { classification: "SERVER_AHEAD_COMPATIBLE", bindingRevision: 9, storeId: "c3g-newer-store" });
    const result = await execute(f, API, "c3g-red-newer-revision");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(f.worker.network.length, 0);
  } finally { f.worker.close(); }
});

await test("C3G-RED-11", "known explicit binding conflict was not a provider fence before C3G", async () => {
  const f = await fixture();
  try {
    await start(f);
    journalState(f, { classification: "EXPLICIT_BINDING_CONFLICT", bindingRevision: 9, storeId: "c3g-conflicting-store" });
    const result = await execute(f, API, "c3g-red-conflict");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(f.worker.network.length, 0);
  } finally { f.worker.close(); }
});

await test("C3G-01", "fresh autonomous Ozon command uses zero mandatory control calls", async () => {
  const f = await fixture();
  try { await start(f); const control = f.worker.controlNetwork.length; await execute(f); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G Ozon result"); assert.equal(f.worker.network.length, 1); assert.equal(f.worker.controlNetwork.length, control); }
  finally { f.worker.close(); }
});

await test("C3G-02", "valid offline grace remains eligible for an Ozon provider request", async () => {
  const f = await fixture({ authority: "grace" });
  try { await start(f); await execute(f, API, "c3g-grace-ozon"); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G grace result"); assert.equal(f.worker.network.length, 1); }
  finally { f.worker.close(); }
});

await test("C3G-03", "fresh autonomous WB command uses the same last-mile gate", async () => {
  const f = await fixture({ marketplace: "wildberries" });
  try { await start(f); await execute(f, 'WB_API_V1 {"operation":"seller_info","params":{}}', "c3g-wb"); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G WB result"); assert.equal(f.worker.network.length, 1); }
  finally { f.worker.close(); }
});

await test("C3G-05", "exact offline grace boundary denies before provider", async () => {
  const f = await fixture({ authority: "boundary" });
  try { const result = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: f.store.id, confirm_change: true }); assert.equal(result.ok, false); assert.equal(f.worker.network.length, 0); }
  finally { f.worker.close(); }
});

await test("C3G-FENCE-07", "credential revision replacement fences a pinned command", async () => {
  const f = await fixture();
  try {
    await start(f);
    const account = f.backing.local[STORES].accounts[f.store.accountId];
    account.stores[f.store.id].credentialRevision = "c3g-replaced-credential";
    const result = await execute(f, API, "c3g-credential-revision");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(f.worker.network.length, 0);
  } finally { f.worker.close(); }
});

await test("C3G-FENCE-12", "Finish after command one prevents command two", async () => {
  const backing = { local: {}, session: {} };
  let calls = 0;
  const f = await fixture({ backing, fetch: async url => {
    calls += 1;
    if (calls === 1) {
      const session = backing.local[SESSIONS][f.key];
      session.state = "inactive"; session.revision += 1; session.start_intent_id = null;
    }
    return new Response('{"result":[]}', { headers: { "content-type": "application/json" } });
  } });
  try { await start(f); await execute(f, `${API}\n${API}`, "c3g-finish-after-one"); await waitFailed(f); assert.equal(f.worker.network.length, 1); }
  finally { f.worker.close(); }
});

await test("PREF-G-02", "different preferred executor alone does not deny local valid Work", async () => {
  const f = await fixture();
  try { await start(f); journalState(f, { classification: "IN_SYNC", preferred: { state: "VALID_CURRENT", installationId: "other-installation" } }); await execute(f, API, "c3g-other-preferred"); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G preferred result"); assert.equal(f.worker.network.length, 1); }
  finally { f.worker.close(); }
});

await test("MULTI-01", "two valid commands are each re-gated and execute sequentially", async () => {
  const f = await fixture();
  try { await start(f); await execute(f, `${API}\n${API}`, "c3g-two-valid"); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G two-command result"); assert.equal(f.worker.network.length, 2); }
  finally { f.worker.close(); }
});

await test("RECON-03", "same-binding convergence does not false-deny provider execution", async () => {
  const f = await fixture();
  try { await start(f); journalState(f, { classification: "SAME_BINDING_MERGEABLE" }); await execute(f, API, "c3g-same-binding"); await until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering", "C3G same-binding result"); assert.equal(f.worker.network.length, 1); }
  finally { f.worker.close(); }
});

await test("RECON-04", "known newer Finish fences future provider execution", async () => {
  const f = await fixture();
  try { await start(f); journalState(f, { classification: "SERVER_FINISH_WINS_OVER_LATE_DELIVERY", bindingRevision: 9, bindingState: "FINISHED" }); const result = await execute(f, API, "c3g-known-finish"); assert.equal(result.ok, false); assert.equal(f.worker.network.length, 0); }
  finally { f.worker.close(); }
});

const failures = results.filter(result => result.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "C3G_CORRECTED_PREDISPATCH", results, failureBatch: failures, live_provider_calls: 0 }, null, 2));
if (failures.length) process.exitCode = 1;
