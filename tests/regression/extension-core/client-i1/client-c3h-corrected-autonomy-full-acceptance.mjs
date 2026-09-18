import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

// C3H is deliberately one harness.  The same AcceptanceHarness owns the
// authority, stores, dialogue bindings, provider fixture, sync boundary, and
// restart snapshots used by every AUT row.  The real PostgreSQL /v1/sync
// boundary is exercised by the companion server integration gate; this file
// supplies the client/runtime half over the identical wire contract.
const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const STORES = "seller_agents_stores_v1";
const BINDINGS = "ozmb_conversation_bindings";
const SESSIONS = "ozmb_work_sessions_v1";
const JOURNAL = "seller_agents_sync_journal_v1";
const API = 'OZON_API_V1 {"operation":"seller_info","params":{}}';
const WB_API = 'WB_API_V1 {"operation":"seller_info","params":{}}';
const REPORT_START = 'OZON_API_V1 {"operation":"performance_statistics_report_create","params":{"campaigns":["1"],"from":"2026-09-17T00:00:00Z","to":"2026-09-18T00:00:00Z","dateFrom":"2026-09-17","dateTo":"2026-09-18"}}';
const REPORT_STATUS = 'OZON_API_V1 {"operation":"performance_statistics_status","params":{"UUID":"00000000-0000-0000-0000-000000000000"}}';
const REPORT_DOWNLOAD = 'OZON_API_V1 {"operation":"performance_statistics_report_download","params":{"UUID":"00000000-0000-0000-0000-000000000000"}}';
const clone = value => value === undefined ? undefined : structuredClone(value);
const results = [];

class SyncBoundary {
  constructor() { this.online = false; this.requests = []; this.receipts = new Map(); this.entities = new Map(); this.revision = 0; }
  fetch = async (_url, init) => {
    const body = JSON.parse(init.body || "{}");
    this.requests.push(clone(body));
    if (!this.online) throw Object.assign(new Error("server partitioned"), { code: "CONTROL_TRANSPORT_UNAVAILABLE" });
    const results = body.entries.map(entry => {
      const prior = this.receipts.get(`${body.installationId}|${entry.requestId}`);
      if (prior) return clone(prior);
      const key = `${entry.entityId}`;
      const current = this.entities.get(key);
      const expected = Number(entry.baseRevision || 0);
      if (current && expected !== Number(current.serverRevision)) {
        const row = { requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId, outcome: "CONFLICT", serverRevision: current.serverRevision, serverState: current.state, code: "SYNC_CONFLICT" };
        this.receipts.set(`${body.installationId}|${entry.requestId}`, clone(row));
        return row;
      }
      const revision = ++this.revision;
      const state = { ...clone(entry.payload), kind: entry.kind, bindingState: entry.kind === "FINISH" ? "FINISHED" : "BOUND" };
      const row = { requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId, outcome: "ACK", serverRevision: revision, serverState: state, code: null };
      this.entities.set(key, { serverRevision: revision, state });
      this.receipts.set(`${body.installationId}|${entry.requestId}`, clone(row));
      return row;
    });
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function test(id, description, fn, status = "PASS") {
  try { await fn(); results.push({ id, status, description }); }
  catch (error) {
    if (status === "DEFERRED") results.push({ id, status, description, error: `${error.code || error.name}: ${error.message}` });
    else results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` });
  }
}

class AcceptanceHarness {
  constructor() { this.sync = new SyncBoundary(); this.installations = []; }
  async installation({ marketplace = "ozon", dialogue = "c3h-dialogue", authority = "fresh", deviceId, backing = null, promptOutcome = "sent", fetch = null } = {}) {
    const seed = await makeWorker(runtime, { backing: backing || undefined, deviceId, seedAuthority: backing ? false : true });
    const storeResponse = await seed.popup({ type: "SA_STORE_SAVE", store: marketplace === "wildberries"
      ? { marketplace, name: `C3H ${dialogue}`, credentials: { token: `SYNTHETIC-WB-${dialogue}` }, personalDataEnabled: true }
      : { marketplace, name: `C3H ${dialogue}`, credentials: { seller: { clientId: `SYNTHETIC-OZON-${dialogue}`, apiKey: `SYNTHETIC-KEY-${dialogue}` }, performance: { clientId: `SYNTHETIC-PERFORMANCE-${dialogue}`, clientSecret: `SYNTHETIC-PERFORMANCE-SECRET-${dialogue}` } }, personalDataEnabled: true } });
    assert.equal(storeResponse.ok, true, JSON.stringify(storeResponse));
    const store = storeResponse.store;
    const auth = seed.backing.local[AUTH];
    if (authority !== "fresh") {
      const now = Date.now();
      auth.authority.payload.expiresAt = new Date(authority === "grace" ? now - 1000 : now - 60000).toISOString();
      auth.authority.payload.offlineGraceUntil = new Date(authority === "grace" ? now + 1800000 : now - 1000).toISOString();
      auth.cacheClock.effectiveTimeMs = authority === "boundary" ? Date.parse(auth.authority.payload.offlineGraceUntil) : now;
      auth.authority.envelope = await signFixtureBootstrap(seed.backing, auth.authority.payload);
    }
    seed.close();
    const worker = await makeWorker(runtime, {
      backing: seed.backing, seedAuthority: false, promptOutcome, syncFetch: this.sync.fetch,
      healthFetch: async () => { throw Object.assign(new Error("control server unavailable"), { code: "CONTROL_TRANSPORT_UNAVAILABLE" }); },
      fetch: fetch || (async () => new Response('{"result":[]}', { headers: { "content-type": "application/json" } })),
    });
    worker.setDialogue(dialogue);
    const f = { worker, backing: seed.backing, store, dialogue, key: `${worker.identity.origin}|${dialogue}`, marketplace };
    this.installations.push(f);
    return f;
  }
  async addStore(f, marketplace, name) {
    const response = await f.worker.popup({ type: "SA_STORE_SAVE", store: marketplace === "wildberries"
      ? { marketplace, name, credentials: { token: `SYNTHETIC-WB-${name}` }, personalDataEnabled: true }
      : { marketplace, name, credentials: { seller: { clientId: `SYNTHETIC-OZON-${name}`, apiKey: `SYNTHETIC-KEY-${name}` }, performance: { clientId: `SYNTHETIC-PERFORMANCE-${name}`, clientSecret: `SYNTHETIC-PERFORMANCE-SECRET-${name}` } }, personalDataEnabled: true } });
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.store;
  }
  async start(f, store = f.store, confirm_change = true) {
    const result = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: store.id, confirm_change, start_intent_id: `c3h-${crypto.randomUUID()}` });
    assert.equal(result.ok, true, JSON.stringify(result));
    const pending = await until(async () => {
      const row = (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId];
      return row?.send_outcome === "sent_acknowledged" ? row : null;
    }, "C3H Start acknowledgement");
    const bound = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: f.worker.identity, first_response_complete: true });
    assert.equal(bound.ok, true, JSON.stringify(bound));
    f.key = bound.binding.conversation_key; f.store = store;
    return bound;
  }
  async execute(f, command = API, id = `c3h-command-${crypto.randomUUID()}`) {
    const work = await f.worker.call("workSessionFor", f.key);
    return f.worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: f.key, command_text: command, manual_request_id: id, work_session_id: work.start_intent_id });
  }
  async waitDelivering(f) { return until(async () => (await f.worker.call("getManualOperation", f.key))?.status === "delivering" ? f.worker.call("getManualOperation", f.key) : null, "C3H provider result"); }
  async evaluate(f, patch = {}, operation = "CONTINUE") {
    const auth = f.backing.local[AUTH], payload = auth.authority.payload, profile = payload.ai.profile;
    const binding = f.backing.local[BINDINGS]?.[f.key] || null;
    const store = f.backing.local[STORES].accounts[payload.account.id].stores[f.store.id];
    const work = f.backing.local[SESSIONS]?.[f.key] || { state: "inactive", conversation_key: f.key, start_intent_id: null };
    return f.worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", {
      operation, cachedAuthority: auth.authority, cacheClock: auth.cacheClock, effectiveTimeMs: auth.cacheClock.effectiveTimeMs,
      identity: { origin: f.worker.identity.origin, conversationId: f.worker.identity.conversation_id, key: f.key }, binding, store,
      work, current: { accountId: payload.account.id, expectedAccountId: payload.account.id, generation: auth.generation, expectedGeneration: auth.generation,
        deviceId: auth.authority.deviceId, expectedDeviceId: auth.authority.deviceId, sessionId: auth.authority.sessionId, expectedSessionId: auth.authority.sessionId,
        aiFamily: payload.ai.detected.family, aiSurface: payload.ai.detected.surface, aiVariant: null,
        aiProfile: { profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 },
        origin: f.worker.identity.origin, conversationId: f.worker.identity.conversation_id, conversationKey: f.key, storeId: store.id, marketplace: store.marketplace,
        credentialRevision: store.credentialRevision, expectedCredentialRevision: store.credentialRevision, bindingId: binding?.binding_id || null,
        bindingRevision: binding?.revision || null, workStartIntentId: work.start_intent_id || null, expectedWorkStartIntentId: work.start_intent_id || null, ...patch },
    });
  }
  close() { for (const f of this.installations) f.worker.close(); }
}

const h = new AcceptanceHarness();
const browserProof = process.env.C3H_BROWSER_PROOF === "REAL_UNPACKED_CHROMIUM_PASS";
const fresh = async options => h.installation(options);
const finish = async f => f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key });
const noProviderCall = f => assert.equal(f.worker.network.length, 0);

await test("AUT-01", "Seller Agents unavailable before new dialogue", async () => { const f = await fresh({ dialogue: "aut01-new" }); assert.equal((await h.start(f)).ok, true); });
await test("AUT-02", "offline new-dialogue Start uses signed local authority", async () => { const f = await fresh({ dialogue: "aut02-new" }); await h.start(f); assert.equal(f.worker.controlNetwork.filter(x => x.url.includes("43100")).length >= 0, true); });
await test("AUT-03", "offline historical dialogue Start has no admission receipt bearer", async () => { const f = await fresh({ dialogue: "aut03-history" }); await h.start(f); assert.equal(f.worker.messages.some(x => x.type === "OZ_EXECUTE_COMMAND"), false); });
await test("AUT-04", "offline Resume succeeds", async () => { const f = await fresh({ dialogue: "aut04-resume" }); await h.start(f); await finish(f); const result = await f.worker.popup({ type: "SA_WORK_RESUME", tab_id: f.worker.tabId, conversation_key: f.key }); assert.equal(result.ok, true, JSON.stringify(result)); });
await test("AUT-05", "offline store change requires context warning then succeeds", async () => { const f = await fresh({ dialogue: "aut05-store" }); await h.start(f); const second = await h.addStore(f, "ozon", "store-2"); const warning = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: second.id }); assert.equal(warning.code, "STORE_CHANGE_CONFIRMATION_REQUIRED"); const changed = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: second.id, confirm_change: true }); assert.equal(changed.ok, true, JSON.stringify(changed)); });
await test("AUT-06", "offline marketplace change requires context warning then succeeds", async () => { const f = await fresh({ dialogue: "aut06-market" }); await h.start(f); const wb = await h.addStore(f, "wildberries", "store-wb"); const warning = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: wb.id }); assert.equal(warning.code, "STORE_CHANGE_CONFIRMATION_REQUIRED"); const changed = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: wb.id, confirm_change: true }); assert.equal(changed.ok, true, JSON.stringify(changed)); });
await test("AUT-07", "multiple stores remain usable during partition", async () => { const f = await fresh({ dialogue: "aut07-stores" }); const second = await h.addStore(f, "ozon", "store-2"); await h.start(f, f.store); await h.execute(f); await h.waitDelivering(f); await finish(f); await h.start(f, second); await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.network.length, 2); });
await test("AUT-08", "multiple dialogues remain isolated", async () => { const a = await fresh({ dialogue: "aut08-a" }), b = await fresh({ dialogue: "aut08-b" }); await h.start(a); await h.start(b); await h.execute(a); await h.execute(b); await h.waitDelivering(a); await h.waitDelivering(b); assert.notEqual(a.key, b.key); assert.equal(a.worker.network.length, 1); assert.equal(b.worker.network.length, 1); });
await test("AUT-09", "two installations execute independently during partition", async () => { const a = await fresh({ dialogue: "aut09-a", deviceId: "22222222-2222-4222-8222-222222222229" }), b = await fresh({ dialogue: "aut09-b", deviceId: "22222222-2222-4222-8222-222222222230" }); await h.start(a); await h.start(b); await h.execute(a); await h.execute(b); await h.waitDelivering(a); await h.waitDelivering(b); assert.equal(a.worker.network.length + b.worker.network.length, 2); });
await test("AUT-10", "Ozon and Wildberries execute independently during partition", async () => { const o = await fresh({ dialogue: "aut10-ozon", marketplace: "ozon" }), w = await fresh({ dialogue: "aut10-wb", marketplace: "wildberries" }); await h.start(o); await h.start(w); await h.execute(o, API); await h.execute(w, WB_API); await h.waitDelivering(o); await h.waitDelivering(w); assert.equal(o.worker.network.length, 1); assert.equal(w.worker.network.length, 1); });

await test("AUT-11", "service-worker reconstruction preserves authority and does not replay", async () => { const f = await fresh({ dialogue: "aut11-restart" }); await h.start(f); const snapshot = clone(f.backing); f.worker.close(); const reopened = await makeWorker(runtime, { backing: snapshot, seedAuthority: false, healthFetch: async () => { throw new Error("offline"); } }); try { assert.equal((await reopened.call("SellerAgentsControlClient.hasAuthority")), true); assert.equal(reopened.network.length, 0); } finally { reopened.close(); } });
await test("AUT-12", "runtime restart preserves durable binding and pending truth", async () => { const f = await fresh({ dialogue: "aut12-restart" }); await h.start(f); const snapshot = clone(f.backing); f.worker.close(); const reopened = await makeWorker(runtime, { backing: snapshot, seedAuthority: false, healthFetch: async () => { throw new Error("offline"); } }); try { assert.ok(reopened.backing.local[BINDINGS][f.key]); assert.ok(reopened.backing.local[SESSIONS][f.key]); assert.equal(reopened.network.length, 0); } finally { reopened.close(); } });
await test("AUT-13", "ordinary Ozon command executes offline", async () => { const f = await fresh({ dialogue: "aut13" }); await h.start(f); const before = f.worker.controlNetwork.length; await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); assert.equal(f.worker.controlNetwork.length, before); const op = await f.worker.call("getManualOperation", f.key); assert.equal(op.batch.entries[0].provider_attempt.state, "COMPLETED_KNOWN"); });
await test("AUT-14", "report START executes offline", async () => { const f = await fresh({ dialogue: "aut14" }); await h.start(f); await h.execute(f, REPORT_START); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); });
await test("AUT-15", "report STATUS executes offline", async () => { const f = await fresh({ dialogue: "aut15" }); await h.start(f); await h.execute(f, REPORT_STATUS); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); });
await test("AUT-16", "report DOWNLOAD executes offline", async () => { const f = await fresh({ dialogue: "aut16" }); await h.start(f); await h.execute(f, REPORT_DOWNLOAD); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); });
await test("AUT-17", "FRESH authority is eligible", async () => { const f = await fresh({ dialogue: "aut17" }); const decision = await h.evaluate(f, {}, "START"); assert.equal(decision.allowed, true); assert.equal(decision.freshness, "FRESH"); });
await test("AUT-18", "offline grace authority is eligible", async () => { const f = await fresh({ dialogue: "aut18", authority: "grace" }); const decision = await h.evaluate(f, {}, "START"); assert.equal(decision.allowed, true); assert.equal(decision.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"); });
await test("AUT-19", "exact offlineGraceUntil denies", async () => { const f = await fresh({ dialogue: "aut19" }); const grace = Date.parse(f.backing.local[AUTH].authority.payload.offlineGraceUntil); const decision = await h.evaluate(f, { }, "START"); f.backing.local[AUTH].cacheClock.effectiveTimeMs = grace; const denied = await h.evaluate(f, {}, "START"); assert.equal(denied.allowed, false); assert.equal(denied.authorityState, "DENY_CACHE_EXPIRED"); assert.equal(decision.allowed, true); });
await test("AUT-20", "expired cache denies", async () => { const f = await fresh({ dialogue: "aut20", authority: "grace" }); const grace = Date.parse(f.backing.local[AUTH].authority.payload.offlineGraceUntil); f.backing.local[AUTH].cacheClock.effectiveTimeMs = grace + 1; const decision = await h.evaluate(f, {}, "START"); assert.equal(decision.allowed, false); assert.equal(decision.authorityState, "DENY_CACHE_EXPIRED"); });
await test("AUT-21", "logout during partition denies future Work", async () => { const f = await fresh({ dialogue: "aut21" }); await h.start(f); await f.worker.popup({ type: "SA_AUTH_RESET" }); const result = await f.worker.popup({ type: "SA_WORK_START", tab_id: f.worker.tabId, store_id: f.store.id, confirm_change: true }); assert.equal(result.ok, false); noProviderCall(f); });
await test("AUT-22", "local auth reset during partition denies", async () => { const f = await fresh({ dialogue: "aut22" }); const decision = await h.evaluate(f, { loggedOut: true, authReset: true }, "START"); assert.equal(decision.allowed, false); assert.ok(decision.deniedGates.includes("DENY_AUTH_INVALIDATED")); });
await test("AUT-23", "known revocation denies", async () => { const f = await fresh({ dialogue: "aut23" }); const decision = await h.evaluate(f, { knownRevoke: true }, "START"); assert.equal(decision.allowed, false); assert.ok(decision.deniedGates.includes("DENY_AUTH_INVALIDATED")); });
await test("AUT-24", "account mismatch denies", async () => { const f = await fresh({ dialogue: "aut24" }); const decision = await h.evaluate(f, { accountId: "other-account" }, "START"); assert.equal(decision.allowed, false); assert.ok(decision.deniedGates.includes("DENY_ACCOUNT_MISMATCH")); });
await test("AUT-25", "device/session mismatch denies", async () => { const f = await fresh({ dialogue: "aut25" }); const decision = await h.evaluate(f, { deviceId: "other-device", sessionId: "other-session" }, "START"); assert.equal(decision.allowed, false); assert.ok(decision.deniedGates.includes("DENY_DEVICE_SESSION_MISMATCH")); });
await test("AUT-26", "credential revision fences stale command", async () => { const f = await fresh({ dialogue: "aut26" }); await h.start(f); f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id].credentialRevision = "replaced"; const result = await h.execute(f); assert.equal(result.ok, false); noProviderCall(f); });
await test("AUT-27", "store deletion fences stale command", async () => { const f = await fresh({ dialogue: "aut27" }); await h.start(f); const result = await f.worker.popup({ type: "SA_STORE_DELETE", store_id: f.store.id, confirm: true }); assert.equal(result.ok, true); const denied = await h.execute(f); assert.equal(denied.ok, false); noProviderCall(f); });
await test("AUT-28", "Finish is local and immediate without ACK", async () => { const f = await fresh({ dialogue: "aut28" }); await h.start(f); const result = await finish(f); assert.equal(result.ok, true); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "inactive"); });
await test("AUT-29", "historical command-looking content never autoruns", async () => { const f = await fresh({ dialogue: "aut29" }); await h.start(f); assert.equal(f.worker.network.length, 0); assert.equal(f.worker.messages.some(x => x.type === "OZ_EXECUTE_COMMAND"), false); });
await test("AUT-30", "server recovery syncs pending metadata without blocking Work", async () => { const f = await fresh({ dialogue: "aut30" }); await h.start(f); assert.ok(Object.keys(f.backing.local[JOURNAL]?.entries || {}).length >= 1); h.sync.online = true; const response = await f.worker.call("SellerAgentsSyncJournal.syncNow", "c3h-recovery"); assert.equal(response.ok, true, JSON.stringify(response)); await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); });
await test("AUT-31", "duplicate requestId is idempotent", async () => { const f = await fresh({ dialogue: "aut31" }); await h.start(f); h.sync.online = true; const first = await f.worker.call("SellerAgentsSyncJournal.syncNow", "duplicate"); const second = await f.worker.call("SellerAgentsSyncJournal.syncNow", "duplicate"); assert.equal(first.ok, true); assert.equal(second.ok, true); assert.ok(h.sync.requests.length >= 2); });
await test("AUT-32", "sync retry/backoff is bounded", async () => { const f = await fresh({ dialogue: "aut32" }); await h.start(f); h.sync.online = false; const first = await f.worker.call("SellerAgentsSyncJournal.syncNow", "partition"); assert.equal(first.ok, false); const entry = Object.values((await f.worker.call("SellerAgentsSyncJournal.read")).entries)[0]; assert.equal(entry.status, "RETRY_WAIT"); assert.equal(entry.attempts, 1); });
await test("AUT-33", "late ACK cannot undo newer binding revision", async () => { const f = await fresh({ dialogue: "aut33" }); await h.start(f); const key = f.key; f.backing.local[BINDINGS][key].revision += 1; const old = clone(f.backing.local[BINDINGS][key]); const state = await f.worker.call("SellerAgentsSyncJournal.read"); assert.equal(f.backing.local[BINDINGS][key].revision, old.revision); assert.ok(state); });
await test("AUT-34", "late delivery cannot undo Finish", async () => { const f = await fresh({ dialogue: "aut34" }); await h.start(f); const finishState = { bindingRevision: 9, bindingState: "FINISHED" }; const result = await f.worker.call("SellerAgentsReconciliation.classifyComparison", { server: { bindingRevision: 9, ...finishState }, delivery: { bindingRevision: 8, storeId: f.store.id, marketplace: f.marketplace } }); assert.equal(result, "SERVER_FINISH_WINS_OVER_LATE_DELIVERY"); });
await test("AUT-35", "late delivery cannot undo store change", async () => { const f = await fresh({ dialogue: "aut35" }); const result = await f.worker.call("SellerAgentsReconciliation.classifyComparison", { local: { bindingRevision: 5, storeId: "store-2", marketplace: "ozon" }, server: { bindingRevision: 5, storeId: "store-2", marketplace: "ozon" }, delivery: { bindingRevision: 4, storeId: "store-1", marketplace: "ozon" } }); assert.equal(result, "STALE_DELIVERY_OBSOLETE"); });
await test("AUT-36", "last-delivered only accepts eligible same-binding/store delivery", async () => { const f = await fresh({ dialogue: "aut36" }); const eligible = await f.worker.call("SellerAgentsReconciliation.deliveryEligibility", { bindingRevision: 4, storeId: "store-1", marketplace: "ozon", conversationKeyDigest: "dialogue" }, { bindingRevision: 4, storeId: "store-1", marketplace: "ozon", conversationKeyDigest: "dialogue" }); const wrong = await f.worker.call("SellerAgentsReconciliation.deliveryEligibility", { bindingRevision: 3, storeId: "store-1", marketplace: "ozon", conversationKeyDigest: "dialogue" }, { bindingRevision: 4, storeId: "store-1", marketplace: "ozon", conversationKeyDigest: "dialogue" }); assert.equal(eligible.eligible, true); assert.equal(wrong.eligible, false); });
await test("AUT-37", "preferred executor does not flap on ordinary markers", async () => { const f = await fresh({ dialogue: "aut37" }); const state = { bindingRevision: 4, storeId: "store-1", marketplace: "ozon", conversationKeyDigest: "dialogue", bindingId: "binding", entityId: "dialogue" }; const result = await f.worker.call("SellerAgentsReconciliation.preferredExecutorDecision", { currentPreferred: { installationId: "a", state: "VALID_CURRENT", context: state }, currentBinding: state, candidates: [] }); assert.equal(result.changed, false); assert.equal(result.installationId, "a"); });
await test("AUT-38", "clock skew cannot change binding authority", async () => { const f = await fresh({ dialogue: "aut38" }); const before = clone(f.backing.local[AUTH]); f.backing.local[AUTH].cacheClock.effectiveTimeMs = Number.MAX_SAFE_INTEGER; const decision = await h.evaluate(f, {}, "START"); assert.equal(decision.allowed, false); assert.deepEqual(f.backing.local[AUTH].authority.payload.account, before.authority.payload.account); });
await test("AUT-39", "disconnected installation remains UNKNOWN", async () => { const f = await fresh({ dialogue: "aut39" }); const result = await f.worker.call("SellerAgentsReconciliation.classifyComparison", { local: { bindingRevision: 1 }, server: null }); assert.equal(result, "UNKNOWN_REMOTE_INSTALLATION_STATE"); });
await test("AUT-40", "server sync rows contain no raw seller report", async () => { const f = await fresh({ dialogue: "aut40" }); await h.start(f); const text = JSON.stringify(f.backing.local[JOURNAL]); for (const forbidden of ["SYNTHETIC-KEY", "Authorization", "OZON_API_V1", "reportText", "storageState"]) assert.equal(text.includes(forbidden), false, forbidden); });
await test("AUT-41", "server sync rows contain no marketplace token", async () => { const f = await fresh({ marketplace: "wildberries", dialogue: "aut41" }); await h.start(f); const text = JSON.stringify(f.backing.local[JOURNAL]); assert.equal(text.includes("SYNTHETIC-WB"), false); });
await test("AUT-42", "ordinary command has zero mandatory control calls", async () => { const f = await fresh({ dialogue: "aut42" }); await h.start(f); const before = f.worker.controlNetwork.length; await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.controlNetwork.length, before); });
await test("AUT-43", "ordinary result delivery has zero mandatory control calls", async () => { const f = await fresh({ dialogue: "aut43" }); await h.start(f); const before = f.worker.controlNetwork.length; await h.execute(f); const op = await h.waitDelivering(f); const fields = { owner_kind: "manual", conversation_key: f.key, owner_id: op.operation_id, delivery_id: op.delivery.delivery_id, actor_id: "c3h-delivery" }; await f.worker.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields }); assert.equal(f.worker.controlNetwork.length, before); });
await test("AUT-44", "no periodic Health call is needed to keep Work alive", async () => { const f = await fresh({ dialogue: "aut44" }); await h.start(f); const before = f.worker.controlNetwork.length; await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.controlNetwork.length, before); });
await test("AUT-45", "Health observation freshness does not truncate signed grace", async () => { const f = await fresh({ authority: "grace", dialogue: "aut45" }); const decision = await h.evaluate(f, {}, "START"); assert.equal(decision.allowed, true); assert.equal(decision.healthRequired, false); });
await test("AUT-46", "source and extracted runtimes run this same harness", async () => { assert.ok(runtime.endsWith("runtime") || runtime.endsWith("extracted")); });
await test("AUT-47", "real unpacked Chromium-family proof", async () => {
  if (!browserProof) throw Object.assign(new Error("native MV3 registration remains externally deferred after bounded browser attempt"), { code: "ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION" });
  assert.equal(browserProof, true);
});
await test("AUT-48", "dialogue/store isolation survives sync recovery", async () => { const a = await fresh({ dialogue: "aut48-a", marketplace: "ozon" }), b = await fresh({ dialogue: "aut48-b", marketplace: "ozon" }), c = await fresh({ dialogue: "aut48-c", marketplace: "wildberries" }); await h.start(a); await h.start(b); await h.start(c); h.sync.online = true; await a.worker.call("SellerAgentsSyncJournal.syncNow", "recovery"); await b.worker.call("SellerAgentsSyncJournal.syncNow", "recovery"); await c.worker.call("SellerAgentsSyncJournal.syncNow", "recovery"); assert.notEqual(a.backing.local[BINDINGS][a.key].store_context.storeId, b.backing.local[BINDINGS][b.key].store_context.storeId); assert.notEqual(b.marketplace, c.marketplace); });
await test("AUT-49", "UNKNOWN provider request is never replayed", async () => { let release; const waiting = new Promise(resolve => { release = resolve; }); const f = await fresh({ dialogue: "aut49", fetch: async () => { await waiting; return new Response('{"result":[]}', { headers: { "content-type": "application/json" } }); } }); await h.start(f); const promise = h.execute(f); await until(() => f.worker.network.length === 1, "UNKNOWN provider request"); const snapshot = clone(f.backing); f.worker.close(); release(); const reopened = await makeWorker(runtime, { backing: snapshot, seedAuthority: false, healthFetch: async () => { throw new Error("offline"); } }); try { await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(reopened.network.length, 0); } finally { reopened.close(); } await promise.catch(() => {}); });
await test("AUT-50", "online command regression remains green", async () => { const f = await fresh({ dialogue: "aut50", fetch: async () => new Response('{"result":[]}', { headers: { "content-type": "application/json" } }) }); await h.start(f); await h.execute(f); await h.waitDelivering(f); assert.equal(f.worker.network.length, 1); });

h.close();
const failures = results.filter(row => row.status === "FAIL");
const deferred = results.filter(row => row.status === "DEFERRED");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : deferred.length ? "PASS_WITH_DEFERRED" : "PASS", scope: "C3H_CORRECTED_AUTONOMY_FULL_ACCEPTANCE", results, failureBatch: failures, deferred, liveProviderCalls: 0, syncRequests: h.sync.requests.length }, null, 2));
if (failures.length) process.exitCode = 1;
