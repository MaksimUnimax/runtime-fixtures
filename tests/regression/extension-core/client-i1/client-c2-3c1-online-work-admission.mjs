import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const STORES = "seller_agents_stores_v1";
const BINDINGS = "ozmb_conversation_bindings";
const SESSIONS = "ozmb_work_sessions_v1";
const PENDING = "ozmb_pending_work_starts_v1";
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const clone = value => JSON.parse(JSON.stringify(value));
const b64url = value => Buffer.from(value).toString("base64url");
function fakeIDB() {
  const records = new Map();
  return { records, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
        const tx = { objectStore() {
          const op = (kind, value) => {
            const result = {};
            queueMicrotask(() => {
              if (kind === "put") records.set(value.requestId ?? value.artifact_key, structuredClone(value));
              if (kind === "delete") records.delete(value);
              if (kind === "clear") records.clear();
              result.result = kind === "get" ? structuredClone(records.get(value)) : kind === "all" ? [...records.values()].map(structuredClone) : undefined;
              result.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.());
            });
            return result;
          };
          return { get: key => op("get", key), getAll: () => op("all"), put: value => op("put", value), delete: key => op("delete", key), clear: () => op("clear") };
        } };
        return tx;
      } };
      request.onsuccess?.();
    });
    return request;
  } };
}

async function healthEnvelope(backing, overrides = {}) {
  const authority = backing.local[AUTH].authority;
  const payload = authority.payload;
  const key = await webcrypto.subtle.importKey("pkcs8", Buffer.from(backing.local.__seller_agents_fixture_signing_key.privateKey, "base64"), { name: "Ed25519" }, false, ["sign"]);
  const context = {
    accountId: payload.account.id, deviceId: authority.deviceId, sessionId: authority.sessionId, contractVersion: payload.contractVersion, configVersion: payload.configVersion,
    bootstrapSnapshotSha256: createHash("sha256").update(Buffer.from(authority.envelope.payload, "base64url")).digest("hex"),
    ai: { family: payload.ai.detected.family, surface: payload.ai.detected.surface, variant: payload.ai.detected.variant, profileKey: payload.ai.profile.profileKey, revision: payload.ai.profile.revision, scopeVariant: payload.ai.profile.scopeVariant, contentSha256: payload.ai.profile.contentSha256 },
  };
  const claim = { healthClaimVersion: "health_claim_v1", status: "PASS", target: "WORK", context, observedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(), executionAuthority: false, ...overrides };
  if (overrides.context) claim.context = { ...context, ...overrides.context, ai: { ...context.ai, ...(overrides.context.ai || {}) } };
  const bytes = new TextEncoder().encode(canonical(claim));
  const prefix = new TextEncoder().encode("product-control-plane/health-authority/v1\0fixture-key\0");
  const signed = new Uint8Array(prefix.length + bytes.length); signed.set(prefix); signed.set(bytes, prefix.length);
  return { healthEnvelopeVersion: "health_envelope_v1", algorithm: "Ed25519", keyId: "fixture-key", payload: b64url(bytes), signature: b64url(await webcrypto.subtle.sign("Ed25519", key, signed)) };
}

async function fixture(options = {}) {
  const seed = await makeWorker(runtime);
  const backing = clone(seed.backing);
  seed.close();
  const auth = backing.local[AUTH];
  const payload = auth.authority.payload;
  const provider = options.provider || "chatgpt";
  const marketplace = options.marketplace || "ozon";
  payload.ai.detected.family = provider;
  auth.authority.requestedAi = provider;
  auth.authority.cacheBinding.detectedAi = { family: provider, surface: provider === "alice" ? "web" : "web", variant: null };
  payload.entitlements = options.entitlements || { "source.ozon": true, "source.wildberries": true, "ai.chatgpt": true, "ai.alice": true };
  if (options.incompatible) payload.compatibility.browser.status = "UNSUPPORTED";
  if (options.workAllowed === false) auth.authority.workAllowed = false;
  auth.authority.envelope = await signFixtureBootstrap(backing, payload);
  if (options.staleBootstrap) {
    payload.expiresAt = new Date(Date.now() - 60_000).toISOString();
    auth.cacheClock.effectiveTimeMs = Date.now();
    auth.authority.envelope = await signFixtureBootstrap(backing, payload);
  }
  const mode = options.health || "pass";
  const signedHealth = await healthEnvelope(backing, options.healthOverrides || {});
  if (mode === "tampered") signedHealth.signature = `${signedHealth.signature.slice(0, -1)}${signedHealth.signature.endsWith("A") ? "B" : "A"}`;
  let release;
  const gate = options.gated ? new Promise(resolve => { release = resolve; }) : null;
  const calls = [];
  const worker = await makeWorker(runtime, { backing, seedAuthority: false, indexedDB: fakeIDB(), testHooks: options.testHooks, onStorageWrite: options.onStorageWrite, healthFetch: async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (gate) await gate;
    if (mode === "network") throw new Error("network unavailable");
    if (mode === "unauthorized") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    if (mode === "unavailable") return new Response(JSON.stringify(await healthEnvelope(backing, { status: "UNAVAILABLE", reason: "PRODUCER_UNAVAILABLE" })), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(signedHealth), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const storeResponse = await worker.popup({ type: "SA_STORE_SAVE", store: marketplace === "wildberries" ? { marketplace, name: "WB fixture", credentials: { token: "WB-SYNTHETIC-TOKEN" } } : { marketplace, name: "Ozon fixture", credentials: { seller: { clientId: "FIXTURE_CLIENT", apiKey: "FIXTURE_KEY" }, performance: {} } } });
  assert.equal(storeResponse.ok, true, JSON.stringify(storeResponse));
  const store = storeResponse.store;
  let identity;
  if (provider === "alice") identity = worker.setIdentity({ origin: "https://alice.yandex.ru", ai_id: "alice", conversation_id: options.conversationId === null ? null : (options.conversationId || "alice-dialogue"), status: options.conversationId === null ? "unknown" : "confirmed" });
  else if (options.conversationId === null) { worker.setDialogue("ignored"); identity = worker.setIdentity({ conversation_id: null, status: "unknown" }); }
  else identity = worker.identity;
  const key = identity.conversation_id ? `${identity.origin}|${identity.conversation_id}` : null;
  if (options.bound) {
    const context = { accountId: store.accountId, storeId: store.id, marketplace, credentialRevision: store.credentialRevision, policyRevision: "personal-disabled", authGeneration: 1 };
    backing.local[BINDINGS] = { [key]: { binding_id: "fixture-binding", revision: 2, origin: identity.origin, ai_id: provider, conversation_id: identity.conversation_id, conversation_key: key, store_context: context } };
    backing.local[SESSIONS] = { [key]: { version: 1, state: options.state || "inactive", revision: 4, conversation_key: key, tab_id: worker.tabId, origin: identity.origin, ai_id: provider, conversation_id: identity.conversation_id, start_intent_id: null } };
  }
  return { worker, backing, store, identity, key, calls, release, mode, marketplace, provider };
}

async function close(f) { f?.worker?.close(); }
async function start(f, fields = {}) { return f.worker.popup({ type: "SA_WORK_START", store_id: fields.store_id || f.store.id, tab_id: f.worker.tabId, confirm_change: false, start_intent_id: fields.start_intent_id || `start-${crypto.randomUUID()}`, ...fields }); }
async function resume(f) { return f.worker.popup({ type: "SA_WORK_RESUME", conversation_key: f.key, tab_id: f.worker.tabId }); }
function healthCalls(f) { return f.calls.filter(row => row.url.endsWith("/v1/health-authority")); }
async function rebindFixture(options = {}) {
  const f = await fixture({ bound: true, state: options.state || "inactive", health: options.health, healthOverrides: options.healthOverrides, gated: options.gated, entitlements: options.entitlements, testHooks: options.testHooks });
  const response = await f.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: options.targetMarketplace || "wildberries", name: "Rebind target", credentials: { token: "REBIND-TARGET" } } });
  assert.equal(response.ok, true, JSON.stringify(response));
  return { ...f, target: response.store, sourceBinding: clone(f.backing.local[BINDINGS][f.key]), sourceWork: clone(f.backing.local[SESSIONS][f.key]) };
}
async function rebindStart(f, fields = {}) { return start(f, { store_id: fields.store_id || f.target.id, confirm_change: fields.confirm_change ?? true, ...fields }); }
async function untilShort(fn, description) { const end = Date.now() + 1500; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error("Timed out: " + description); }
async function pendingStartAcknowledged(f) { return untilShort(async () => { const pending = (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]; return pending?.send_outcome === "sent_acknowledged" ? pending : null; }, "rebind pending Start acknowledgement"); }
async function completePendingStart(f) { const pending = await pendingStartAcknowledged(f); return f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: f.identity, first_response_complete: true }, { tab: { id: f.worker.tabId } }); }
function assertStartAccepted(result) { assert.equal(result.ok === true || result.waiting === true, true, JSON.stringify(result)); }
async function assertRebindUnchanged(f, sourceBinding = f.sourceBinding, sourceWork = f.sourceWork) {
  assert.deepEqual(f.backing.local[BINDINGS][f.key], sourceBinding);
  assert.deepEqual(f.backing.local[SESSIONS][f.key], sourceWork);
  assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null);
}
async function activeStart(f) {
  const result = await start(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  const pending = await until(async () => (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId]?.send_outcome === "sent_acknowledged" ? (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] : null, "C1 pending send acknowledgement");
  if (!f.identity.conversation_id) { f.worker.setDialogue("c1-new-dialogue"); f.identity.conversation_id = "c1-new-dialogue"; f.key = `${f.identity.origin}|c1-new-dialogue`; }
  const response = await f.worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: f.identity, first_response_complete: true }, { tab: { id: f.worker.tabId } });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response;
}
async function deniedStart(f, expected = null) {
  const response = await start(f);
  assert.equal(response.ok, false, JSON.stringify(response));
  if (expected) assert.equal(response.code, expected);
  assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null);
  return response;
}

const cases = [];
const run = async (id, description, fn) => {
  try { await fn(); cases.push({ id, status: "PASS", description }); }
  catch (error) { cases.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
};

await run("C1-01", "new-dialogue Start acquires one Health and creates pending_identity", async () => { const f = await fixture({ conversationId: null }); try { const r = await start(f); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(healthCalls(f).length, 1); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId].state, "pending_identity"); } finally { await close(f); } });
await run("C1-02", "WB/Alice historical-unbound Start proceeds", async () => { const f = await fixture({ provider: "alice", marketplace: "wildberries" }); try { await activeStart(f); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "active_visible"); } finally { await close(f); } });
await run("C1-03", "exact inactive Resume proceeds", async () => { const f = await fixture({ bound: true }); try { const r = await resume(f); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "active_visible"); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-04", "unbound Resume denied before mutation", async () => { const f = await fixture(); try { const r = await resume(f); assert.equal(r.ok, false); assert.equal(healthCalls(f).length, 0); } finally { await close(f); } });
await run("C1-05", "conflicting binding Start denied", async () => { const f = await fixture(); const other = await f.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "wildberries", name: "other", credentials: { token: "OTHER-TOKEN" } } }); f.backing[BINDINGS] = {}; try { const context = { accountId: f.store.accountId, storeId: other.store.id, marketplace: "wildberries", credentialRevision: other.store.credentialRevision, policyRevision: "personal-disabled", authGeneration: 1 }; f.backing.local[BINDINGS] = { [f.key]: { binding_id: "conflict", revision: 2, origin: f.identity.origin, ai_id: f.provider, conversation_id: f.identity.conversation_id, conversation_key: f.key, store_context: context } }; const r = await deniedStart(f, "STORE_CHANGE_CONFIRMATION_REQUIRED"); assert.equal(healthCalls(f).length, 0); } finally { await close(f); } });
await run("C1-06", "invalid Work state denied before Health", async () => { const f = await fixture({ bound: true, state: "active_visible" }); try { const r = await start(f); assert.equal(r.ok, true); assert.equal(r.accepted, false); assert.equal(healthCalls(f).length, 0); } finally { await close(f); } });
await run("C1-07", "missing source capability denied", async () => { const f = await fixture({ entitlements: { "ai.chatgpt": true } }); try { await deniedStart(f); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-08", "missing AI capability denied", async () => { const f = await fixture({ entitlements: { "source.ozon": true } }); try { await deniedStart(f); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-09", "stale/invalid Bootstrap denied", async () => { const f = await fixture(); try { await f.worker.call("SellerAgentsControlClient.localReset"); await deniedStart(f); } finally { await close(f); } });
await run("C1-10", "persisted final allow bit is not bearer authority", async () => { const f = await fixture({ workAllowed: false }); try { const r = await start(f); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-11", "incompatible extension/browser authority is denied", async () => { const f = await fixture(); try { await f.worker.call("SellerAgentsControlClient.localReset"); await deniedStart(f); } finally { await close(f); } });
await run("C1-12", "tampered Health denied", async () => { const f = await fixture({ health: "tampered" }); try { await deniedStart(f); } finally { await close(f); } });
await run("C1-13", "Health DENY denied", async () => { const f = await fixture({ healthOverrides: { status: "DENY", reason: "OWNER_DENIED" } }); try { await deniedStart(f); } finally { await close(f); } });
await run("C1-14", "malformed Health UNAVAILABLE remains fail-closed", async () => { const f = await fixture({ health: "unavailable" }); try { await deniedStart(f, "HEALTH_INVALID_PAYLOAD_SCHEMA"); } finally { await close(f); } });
await run("C1-15", "expired Health does not truncate signed local authority", async () => { const f = await fixture({ healthOverrides: { observedAt: new Date(Date.now() - 16 * 60_000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() } }); try { const r = await start(f); assert.equal(r.ok, true, JSON.stringify(r)); } finally { await close(f); } });
await run("C1-16", "wrong Health snapshot/context denied", async () => { const f = await fixture({ healthOverrides: { context: { bootstrapSnapshotSha256: "f".repeat(64) } } }); try { await deniedStart(f); } finally { await close(f); } });
await run("C1-17", "Health network failure does not block local autonomous Start", async () => { const f = await fixture({ health: "network" }); try { const r = await start(f); assert.equal(r.ok, true, JSON.stringify(r)); } finally { await close(f); } });
await run("C1-18", "401 terminal control auth failure remains denial", async () => { const f = await fixture({ health: "unauthorized" }); try { await deniedStart(f); } finally { await close(f); } });

for (const [id, field, mutate] of [
  ["C1-19", "generation", f => f.worker.call("SellerAgentsControlClient.localReset")],
  ["C1-20", "selected store", f => { delete f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id]; }],
  ["C1-21", "marketplace", f => { f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id].marketplace = "wildberries"; }],
  ["C1-22", "credential revision", f => { f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id].credentialRevision = "changed"; }],
  ["C1-23", "binding revision", f => { f.backing.local[BINDINGS][f.key].revision += 1; }],
  ["C1-24", "conversation identity", f => f.worker.setDialogue("changed-dialogue")],
  ["C1-25", "page identity", f => f.worker.setIdentity({ origin: "https://example.invalid", ai_id: null })],
  ["C1-26", "Work state", f => { f.backing.local[SESSIONS][f.key].state = "active_visible"; }],
]) await run(id, `${field} changes during Health request discard result`, async () => { const f = await fixture({ bound: id === "C1-23" || id === "C1-24" || id === "C1-26", gated: true }); try { const pending = start(f); await until(() => healthCalls(f).length === 1, `${id} Health request`); await mutate(f); f.release(); const r = await pending; assert.equal(r.ok, false, JSON.stringify(r)); } finally { await close(f); } });

await run("C1-27", "Finish/cancel during Health request cannot Start", async () => { const f = await fixture({ gated: true }); try { const pending = start(f); await until(() => healthCalls(f).length === 1, "Finish race Health request"); await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key }); f.release(); const r = await pending; assert.equal(r.ok, false); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null); } finally { await close(f); } });
await run("C1-28", "two simultaneous Start attempts have one lifecycle transition", async () => { const f = await fixture(); try { const [one, two] = await Promise.all([start(f, { start_intent_id: "same" }), start(f, { start_intent_id: "same" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); const pending = await f.worker.call("getPendingWorkStarts"); assert.equal(Object.keys(pending).length, 1); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-29", "two simultaneous Resume attempts have one lifecycle transition", async () => { const f = await fixture({ bound: true }); try { const [one, two] = await Promise.all([resume(f), resume(f)]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "active_visible"); assert.equal(healthCalls(f).length, 1); } finally { await close(f); } });
await run("C1-30", "parallel different dialogues remain independent", async () => { const f = await fixture(); try { const second = f.worker.addTab(88, "second-dialogue"); const [one, two] = await Promise.all([start(f), f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: 88, confirm_change: false, start_intent_id: "second" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal(healthCalls(f).length, 2); } finally { await close(f); } });
await run("C1-31", "parallel different stores remain isolated", async () => { const f = await fixture(); try { const second = await f.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "wildberries", name: "WB second", credentials: { token: "SECOND" } } }); f.worker.addTab(89, "store-dialogue"); const [one, two] = await Promise.all([start(f), f.worker.popup({ type: "SA_WORK_START", store_id: second.store.id, tab_id: 89, confirm_change: false, start_intent_id: "store-second" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal(healthCalls(f).length, 2); } finally { await close(f); } });
await run("C1-32", "B2 result is not persisted as execution authority", async () => { const f = await fixture(); try { await activeStart(f); assert.equal(JSON.stringify(f.backing.local).includes("online_work_authority_decision"), false); } finally { await close(f); } });
await run("C1-33", "B2 executionAuthority remains false", async () => { const f = await fixture(); try { const r = await activeStart(f); assert.equal(r.ok, true); assert.equal(JSON.stringify(f.backing.local).includes('"executionAuthority":true'), false); } finally { await close(f); } });
await run("C1-34", "Start admission makes zero marketplace calls", async () => { const f = await fixture(); try { await start(f); assert.equal(f.calls.some(row => row.url.includes("ozon.ru") || row.url.includes("wildberries")), false); } finally { await close(f); } });
await run("C1-35", "Start admission makes zero provider calls", async () => { const f = await fixture(); try { await start(f); assert.equal(f.calls.filter(row => !row.url.endsWith("/v1/health-authority")).length, 0); } finally { await close(f); } });
await run("C1-36", "Start admission sends zero marketplace command payloads", async () => { const f = await fixture(); try { await start(f); assert.equal(f.worker.messages.some(message => /API_V1|COMMAND/.test(JSON.stringify(message))), false); } finally { await close(f); } });
await run("C1-37", "ordinary command path adds zero Health calls", async () => { const f = await fixture(); try { await activeStart(f); const before = healthCalls(f).length; await f.worker.request({ type: "OZ_GET_MANUAL_STATE", conversation_key: f.key }, { tab: { id: f.worker.tabId } }); assert.equal(healthCalls(f).length, before); } finally { await close(f); } });
await run("C1-38", "ordinary command path adds zero Bootstrap calls", async () => { const f = await fixture(); try { await activeStart(f); assert.equal(f.calls.some(row => row.url.endsWith("/v1/bootstrap")), false); } finally { await close(f); } });
await run("C1-39", "raw authority cannot authorize production Start", async () => { const source = fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8"); assert.doesNotMatch(source, /SellerAgentsOnlineWorkAuthority\.evaluate/); } );
await run("C1-40", "caller-fabricated Health cannot authorize production Start", async () => { const f = await fixture({ entitlements: {} }); try { const r = await f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: f.worker.tabId, health: { status: "PASS", current: true, verified: true }, start_intent_id: "fabricated" }); assert.equal(r.ok, false); } finally { await close(f); } });
await run("C1-41", "caller-fabricated B2 facts cannot bypass runtime derivation", async () => { const f = await fixture({ entitlements: {} }); try { const r = await f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: f.worker.tabId, input: { account: { authenticated: true }, capabilityIntersection: { executionAuthority: false } }, start_intent_id: "fabricated-input" }); assert.equal(r.ok, false); } finally { await close(f); } });
await run("C1-42", "production-default malformed UNAVAILABLE remains denied", async () => { const f = await fixture({ health: "unavailable" }); try { await deniedStart(f, "HEALTH_INVALID_PAYLOAD_SCHEMA"); } finally { await close(f); } });
await run("C1-43", "synthetic PASS exists only in test fixture", async () => { const source = fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8"); assert.doesNotMatch(source, /health\s*:\s*\{\s*status:\s*["']PASS/); } );
await run("C1-44", "Finish remains unchanged without admission", async () => { const f = await fixture(); try { await activeStart(f); const r = await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key }); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "inactive"); } finally { await close(f); } });
await run("C1-45", "pending_identity to confirmed identity to binding remains intact", async () => { const f = await fixture(); try { const response = await activeStart(f); assert.equal(response.binding.store_context.storeId, f.store.id); assert.equal(response.session.state, "active_visible"); } finally { await close(f); } });
await run("C1-46", "historical Start binding semantics remain intact", async () => { const f = await fixture({ bound: true }); try { const r = await start(f); assert.equal(r.ok, true); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId].conversation_key, f.key); } finally { await close(f); } });
await run("C1-47", "Resume transition semantics remain intact", async () => { const f = await fixture({ bound: true }); try { const r = await resume(f); assert.equal(r.ok, true); const session = await f.worker.call("workSessionFor", f.key); assert.equal(session.state, "active_visible"); assert.equal(session.start_intent_id, null); } finally { await close(f); } });
await run("C1-48", "old commands never autorun after admission", async () => { const f = await fixture(); try { await start(f); assert.equal(f.worker.messages.some(message => message.type === "OZ_EXECUTE_COMMAND"), false); assert.equal(f.calls.some(row => row.url.includes("ozon.ru")), false); } finally { await close(f); } });
await run("C1-49", "pending Work Start map writes serialize across parallel dialogues", async () => {
  let activePendingWrites = 0, maxPendingWrites = 0, gatedWrites = 0, releasePair;
  const pair = new Promise(resolve => { releasePair = resolve; });
  const f = await fixture({ onStorageWrite: async (kind, values) => {
    if (kind !== "local" || !Object.prototype.hasOwnProperty.call(values, PENDING)) return;
    activePendingWrites += 1;
    maxPendingWrites = Math.max(maxPendingWrites, activePendingWrites);
    gatedWrites += 1;
    if (gatedWrites === 2) releasePair();
    if (gatedWrites <= 2) await Promise.race([pair, new Promise(resolve => setTimeout(resolve, 75))]);
    activePendingWrites -= 1;
  } });
  try {
    f.worker.addTab(88, "serialized-pending-dialogue");
    const [one, two] = await Promise.all([
      start(f, { start_intent_id: "serialized-a" }),
      f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: 88, confirm_change: false, start_intent_id: "serialized-b" }),
    ]);
    assert.equal(one.ok, true, JSON.stringify(one));
    assert.equal(two.ok, true, JSON.stringify(two));
    const pending = await f.worker.call("getPendingWorkStarts");
    assert.ok(pending[f.worker.tabId], JSON.stringify(pending));
    assert.ok(pending[88], JSON.stringify(pending));
    assert.equal(maxPendingWrites, 1, `pending-map writes overlapped: ${maxPendingWrites}`);
  } finally { releasePair?.(); await close(f); }
});
await run("C1-50", "expired send commit clears pending without reentrant write-lock deadlock", async () => {
  const f = await fixture();
  try {
    const started = await start(f, { start_intent_id: "expired-commit" });
    assert.equal(started.ok, true, JSON.stringify(started));
    const pending = (await f.worker.call("getPendingWorkStarts"))[f.worker.tabId];
    assert.ok(pending, "pending Start missing before expiry injection");
    f.backing.local[PENDING][f.worker.tabId].expires_at = new Date(Date.now() - 1000).toISOString();
    const expiry = await Promise.race([
      f.worker.request({ type: "OZ_WORK_START_COMMIT_REQUEST", intent_id: pending.intent_id, revision: pending.revision, identity: f.identity, actor_id: "expired-actor" }, { tab: { id: f.worker.tabId } }),
      new Promise(resolve => setTimeout(() => resolve({ deadlocked: true }), 500)),
    ]);
    assert.notEqual(expiry?.deadlocked, true, "expired commit deadlocked while clearing pending Start");
    assert.equal(expiry?.ok, false, JSON.stringify(expiry));
    assert.equal(expiry?.code, "WORK_PENDING_TIMEOUT", JSON.stringify(expiry));
    assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null);
  } finally { await close(f); }
});

const rb = [];
const runRB = async (id, description, fn) => {
  try { await fn(); rb.push({ id, status: "PASS", description }); }
  catch (error) { rb.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
};
await runRB("RB-01", "unconfirmed store change is a zero-call zero-mutation denial", async () => { const f = await rebindFixture(); try { const r = await rebindStart(f, { confirm_change: false }); assert.equal(r.ok, false); assert.equal(r.code, "STORE_CHANGE_CONFIRMATION_REQUIRED"); assert.equal(healthCalls(f).length, 0); await assertRebindUnchanged(f); } finally { await close(f); } });
await runRB("RB-02", "confirmed inactive store change admits target Start", async () => { const f = await rebindFixture(); try { const r = await rebindStart(f); assertStartAccepted(r); const pending = (await pendingStartAcknowledged(f)); assert.equal(pending.store_context.storeId, f.target.id); const completed = await completePendingStart(f); assert.equal(completed.ok, true, JSON.stringify(completed)); assert.equal(completed.binding.store_context.storeId, f.target.id); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "active_visible"); } finally { await close(f); } });
await runRB("RB-03", "authoritative Health DENY leaves source binding and Work unchanged", async () => { const f = await rebindFixture({ health: "pass", healthOverrides: { status: "DENY" } }); try { const r = await rebindStart(f); assert.equal(r.ok, false, JSON.stringify(r)); await assertRebindUnchanged(f); } finally { await close(f); } });
await runRB("RB-04", "malformed Health UNAVAILABLE remains a fail-closed rebind denial", async () => { const f = await rebindFixture({ health: "unavailable" }); try { const r = await rebindStart(f); assert.equal(r.ok, false, JSON.stringify(r)); await assertRebindUnchanged(f); } finally { await close(f); } });
await runRB("RB-05", "Health network unavailability does not block confirmed local rebind", async () => { const f = await rebindFixture({ health: "network" }); try { const r = await rebindStart(f); assertStartAccepted(r); } finally { await close(f); } });
await runRB("RB-06", "tampered Health remains a fail-closed denial", async () => { const f = await rebindFixture({ health: "tampered" }); try { const r = await rebindStart(f); assert.equal(r.ok, false, JSON.stringify(r)); await assertRebindUnchanged(f); } finally { await close(f); } });
for (const id of ["active_visible", "active_hidden"]) await runRB(id === "active_visible" ? "RB-07" : "RB-08", `${id} uses one mature Finish then target Start`, async () => { const f = await rebindFixture({ state: id }); try { const r = await rebindStart(f); assertStartAccepted(r); await pendingStartAcknowledged(f); assert.equal((await f.worker.call("workSessionFor", f.key)).state, "inactive"); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId].store_context.storeId, f.target.id); const completed = await completePendingStart(f); assert.equal(completed.ok, true, JSON.stringify(completed)); assert.equal(completed.binding.store_context.storeId, f.target.id); } finally { await close(f); } });
await runRB("RB-09", "error Work follows mature confirmed-change Finish then Start", async () => { const f = await rebindFixture({ state: "error" }); try { const r = await rebindStart(f); assertStartAccepted(r); const completed = await completePendingStart(f); assert.equal(completed.ok, true, JSON.stringify(completed)); assert.equal(completed.binding.store_context.storeId, f.target.id); } finally { await close(f); } });
await runRB("RB-10", "inactive Work skips destructive Finish", async () => { const f = await rebindFixture(); try { await rebindStart(f); assert.equal(f.worker.messages.some(m => m.type === "OZ_WORK_APPLY_VISIBILITY" && m.visible === false), false); } finally { await close(f); } });
for (const state of ["pending_identity", "binding", "recovering", "finishing"]) await runRB(`RB-${({ pending_identity: 11, binding: 12, recovering: 13, finishing: 14 })[state]}`, `${state} source Work denies confirmed rebind`, async () => { const f = await rebindFixture({ state }); try { const r = await rebindStart(f); assert.equal(r.ok, false); assert.equal(healthCalls(f).length, 0); await assertRebindUnchanged(f); } finally { await close(f); } });
for (const [id, mutate] of [
  ["RB-15", f => { f.backing.local[STORES].accounts[f.target.accountId].stores[f.target.id].id = "changed-target"; }],
  ["RB-16", f => { f.backing.local[STORES].accounts[f.target.accountId].stores[f.target.id].credentialRevision = "changed-target-revision"; }],
  ["RB-17", f => { f.backing.local[BINDINGS][f.key].revision += 1; }],
  ["RB-18", f => { f.backing.local[SESSIONS][f.key].revision += 1; }],
  ["RB-19", f => f.worker.call("SellerAgentsControlClient.localReset")],
  ["RB-20", f => f.worker.setDialogue("rebind-race-dialogue")],
]) await runRB(id, "rebind Health result is discarded after trusted context changes", async () => { const f = await rebindFixture({ gated: true }); const watchdog = setTimeout(() => f.release?.(), 1000); try { const pending = rebindStart(f); await untilShort(() => healthCalls(f).length === 1, `${id} Health request`); await mutate(f); f.release(); const r = await pending; assert.equal(r.ok, false, JSON.stringify(r)); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null); } finally { clearTimeout(watchdog); f.release?.(); await close(f); } });
await runRB("RB-21", "Finish during rebind Health cancels the late result", async () => { const f = await rebindFixture({ state: "active_visible", gated: true }); const watchdog = setTimeout(() => f.release?.(), 1000); try { const pending = rebindStart(f); await untilShort(() => healthCalls(f).length === 1, "RB-21 Health request"); const finish = await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key }); assert.equal(finish.ok, true, JSON.stringify(finish)); f.release(); const r = await pending; assert.equal(r.ok, false); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null); assert.equal(f.backing.local[BINDINGS][f.key].store_context.storeId, f.sourceBinding.store_context.storeId); } finally { clearTimeout(watchdog); f.release?.(); await close(f); } });
await runRB("RB-22", "double confirmed Start has at most one rebind transition", async () => { const f = await rebindFixture(); try { const [one, two] = await Promise.all([rebindStart(f, { start_intent_id: "rb-double" }), rebindStart(f, { start_intent_id: "rb-double" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal(healthCalls(f).length, 1); assert.equal(Object.keys(await f.worker.call("getPendingWorkStarts")).length, 1); } finally { await close(f); } });
await runRB("RB-23", "same dialogue target race cannot let stale target win", async () => { const f = await rebindFixture(); try { const other = await f.worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "wildberries", name: "Rebind B", credentials: { token: "REBIND-B" } } }); const [one, two] = await Promise.all([rebindStart(f, { store_id: f.target.id, start_intent_id: "rb-a" }), rebindStart(f, { store_id: other.store.id, start_intent_id: "rb-b" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal(healthCalls(f).length, 1); assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId].store_context.storeId, f.target.id); } finally { await close(f); } });
await runRB("RB-24", "unrelated dialogue remains parallel", async () => { const f = await rebindFixture(); try { const second = f.worker.addTab(88, "unrelated-dialogue"); const [one, two] = await Promise.all([rebindStart(f), f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: 88, confirm_change: false, start_intent_id: "rb-unrelated" })]); assert.equal(one.ok, true); assert.equal(two.ok, true); assert.equal(healthCalls(f).length, 2); } finally { await close(f); } });
await runRB("RB-25", "confirmed rebind does not persist B2 decision or envelope", async () => { const f = await rebindFixture(); try { await rebindStart(f); assert.equal(JSON.stringify(f.backing.local).includes("online_work_authority_decision"), false); assert.equal(JSON.stringify(f.backing.local).includes("healthEnvelopeVersion"), false); } finally { await close(f); } });
for (const [id, options] of [["RB-26", { entitlements: { "source.ozon": true, "ai.chatgpt": true } }], ["RB-27", { entitlements: { "source.wildberries": true } }], ["RB-28", { healthOverrides: { status: "DENY" } }]]) await runRB(id, "confirm_change alone cannot satisfy authority", async () => { const f = await rebindFixture(options); try { const r = await rebindStart(f); assert.equal(r.ok, false); await assertRebindUnchanged(f); } finally { await close(f); } });
await runRB("RB-29", "confirm_change cannot bypass wrong target ownership", async () => { const f = await rebindFixture(); try { f.backing.local[STORES].accounts[f.target.accountId].stores[f.target.id].accountId = "other-account"; const r = await rebindStart(f); assert.equal(r.ok, false); await assertRebindUnchanged(f); } finally { await close(f); } });
await runRB("RB-30", "successful rebind retains executionAuthority false", async () => { const f = await rebindFixture(); try { await rebindStart(f); assert.equal(JSON.stringify(f.backing.local).includes('"executionAuthority":true'), false); } finally { await close(f); } });
await runRB("RB-31", "popup Resume uses canonical SA_WORK_RESUME", async () => { const source = fs.readFileSync(path.resolve("apps/extension/src/application/popup.js"), "utf8"); assert.match(source, /request\("SA_WORK_RESUME"/); assert.doesNotMatch(source, /request\("OZ_WORK_RESUME"/); });
await runRB("RB-32", "raw OZ_WORK_RESUME is rejected at application boundary", async () => { const f = await fixture({ bound: true }); try { await assert.rejects(() => f.worker.call("saHandleMessage", { type: "OZ_WORK_RESUME", tab_id: f.worker.tabId, conversation_key: f.key }, { tab: { id: f.worker.tabId } }), /LEGACY_ACTION_DISABLED/); } finally { await close(f); } });
await runRB("RB-33", "canonical SA_WORK_RESUME still reaches internal donor Resume", async () => { const f = await fixture({ bound: true }); try { const r = await resume(f); assert.equal(r.ok, true, JSON.stringify(r)); assert.match(fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8"), /saLegacyMessage\(\{ type: "OZ_WORK_RESUME"/); } finally { await close(f); } });
await runRB("RB-34", "raw OZ_WORK_START cannot bypass SA_WORK_START", async () => { const f = await fixture(); try { await assert.rejects(() => f.worker.call("saHandleMessage", { type: "OZ_WORK_START", tab_id: f.worker.tabId }, { tab: { id: f.worker.tabId } }), /LEGACY_ACTION_DISABLED/); } finally { await close(f); } });
await runRB("RB-35", "ordinary commands add zero Health or Bootstrap calls", async () => { const f = await fixture(); try { await activeStart(f); const before = { health: healthCalls(f).length, bootstrap: f.calls.filter(row => row.url.endsWith("/v1/bootstrap")).length }; await f.worker.request({ type: "OZ_GET_MANUAL_STATE", conversation_key: f.key }, { tab: { id: f.worker.tabId } }); assert.equal(healthCalls(f).length, before.health); assert.equal(f.calls.filter(row => row.url.endsWith("/v1/bootstrap")).length, before.bootstrap); } finally { await close(f); } });
await runRB("RB-36", "old commands do not autorun after confirmed rebind", async () => { const f = await rebindFixture(); try { await rebindStart(f); assert.equal(f.worker.messages.some(m => m.type === "OZ_EXECUTE_COMMAND"), false); assert.equal(f.calls.some(row => row.url.includes("ozon.ru") || row.url.includes("wildberries")), false); } finally { await close(f); } });

const preToken = [];
const runPR = async (id, description, fn) => {
  try { await fn(); preToken.push({ id, status: "PASS", description }); }
  catch (error) { preToken.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
};
const preTokenStorage = f => ({
  binding: clone(f.backing.local[BINDINGS][f.key]),
  work: clone(f.backing.local[SESSIONS][f.key]),
  pending: clone(f.backing.local.ozmb_pending_work_starts_v1 || {})
});
async function assertPreTokenDenied(f, afterMutation, expected = "WORK_ADMISSION_CONTEXT_CHANGED") {
  const result = await rebindStart(f);
  assert.equal(result.ok, false, JSON.stringify(result));
  if (expected) assert.equal(result.code, expected, JSON.stringify(result));
  assert.equal(healthCalls(f).length, 0, "stale rebind must not acquire Health");
  assert.equal(f.worker.messages.filter(m => ["OZ_WORK_FINISH", "OZ_WORK_START", "OZ_WORK_SEND_INITIAL_PROMPT"].includes(m.type)).length, 0, "stale rebind must not mutate or prompt");
  const current = preTokenStorage(f);
  assert.deepEqual(current, afterMutation, "stale rebind must not persist after the injected change");
  assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null, "stale rebind must not leave target pending Start");
}
async function preTokenMutationCase({ id, description, state = "inactive", mutate }) {
  let f, afterMutation;
  const hook = {
    async afterRebindPlanCreated() {
      await mutate(f);
      afterMutation = preTokenStorage(f);
    }
  };
  f = await rebindFixture({ state, testHooks: hook });
  try {
    const result = await rebindStart(f);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, "WORK_ADMISSION_CONTEXT_CHANGED", JSON.stringify(result));
    assert.equal(healthCalls(f).length, 0, "stale rebind must not acquire Health");
    const current = preTokenStorage(f);
    assert.deepEqual(current, afterMutation, "stale rebind must not persist after the injected change");
    assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null, "stale rebind must not leave target pending Start");
  }
  finally { await close(f); }
}

await runPR("PR-01", "active_visible plan versus active_hidden R+1 rejects before Health", () => preTokenMutationCase({ id: "PR-01", description: "", state: "active_visible", mutate: f => { f.backing.local[SESSIONS][f.key].state = "active_hidden"; f.backing.local[SESSIONS][f.key].revision += 1; } }));
await runPR("PR-02", "active_hidden plan versus active_visible R+1 rejects before Health", () => preTokenMutationCase({ id: "PR-02", description: "", state: "active_hidden", mutate: f => { f.backing.local[SESSIONS][f.key].state = "active_visible"; f.backing.local[SESSIONS][f.key].revision += 1; } }));
await runPR("PR-03", "legitimate Finish in the pre-token window rejects stale active plan before Health", async () => {
  let f, afterMutation;
  const hook = { async afterRebindPlanCreated() {
    const finish = await f.worker.popup({ type: "OZ_WORK_FINISH", tab_id: f.worker.tabId, conversation_key: f.key });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    afterMutation = preTokenStorage(f);
  } };
  f = await rebindFixture({ state: "active_visible", testHooks: hook });
  try {
    const result = await rebindStart(f);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, "WORK_ADMISSION_CONTEXT_CHANGED", JSON.stringify(result));
    assert.equal(healthCalls(f).length, 0);
    assert.deepEqual(preTokenStorage(f), afterMutation);
    assert.equal((await f.worker.call("getPendingWorkStarts"))[f.worker.tabId] || null, null);
    assert.equal((await f.worker.call("workSessionFor", f.key)).revision, f.sourceWork.revision + 2);
  } finally { await close(f); }
});
await runPR("PR-04", "inactive plan versus ERROR changed revision never makes stale skip-Finish decision", () => preTokenMutationCase({ id: "PR-04", description: "", state: "inactive", mutate: f => { f.backing.local[SESSIONS][f.key].state = "error"; f.backing.local[SESSIONS][f.key].revision += 1; } }));
await runPR("PR-05", "same Work state with changed revision rejects before Health", () => preTokenMutationCase({ id: "PR-05", description: "", state: "inactive", mutate: f => { f.backing.local[SESSIONS][f.key].revision += 1; } }));
await runPR("PR-06", "binding revision change rejects before Health", () => preTokenMutationCase({ id: "PR-06", description: "", mutate: f => { f.backing.local[BINDINGS][f.key].revision += 1; } }));
await runPR("PR-07", "source credential revision change rejects before Health", () => preTokenMutationCase({ id: "PR-07", description: "", mutate: f => { const source = f.backing.local[STORES].accounts[f.store.accountId].stores[f.store.id]; source.credentialRevision = "source-pre-token-revision"; f.backing.local[BINDINGS][f.key].store_context.credentialRevision = source.credentialRevision; } }));
await runPR("PR-08", "target credential revision change rejects before Health", () => preTokenMutationCase({ id: "PR-08", description: "", mutate: f => { f.backing.local[STORES].accounts[f.target.accountId].stores[f.target.id].credentialRevision = "target-pre-token-revision"; } }));
await runPR("PR-09", "account generation change rejects before Health", () => preTokenMutationCase({ id: "PR-09", description: "", mutate: f => f.worker.call("SellerAgentsControlClient.localReset") }));
await runPR("PR-10", "device/session authority change rejects before Health", () => preTokenMutationCase({ id: "PR-10", description: "", mutate: f => f.worker.call("SellerAgentsControlClient.localReset") }));
await runPR("PR-11", "dialogue identity change rejects before Health", () => preTokenMutationCase({ id: "PR-11", description: "", mutate: f => f.worker.setDialogue("pre-token-dialogue-change") }));
await runPR("PR-12", "binding identity/store context change rejects before Health", () => preTokenMutationCase({ id: "PR-12", description: "", mutate: f => { f.backing.local[BINDINGS][f.key].binding_id = "binding-pre-token-change"; } }));
await runPR("PR-13", "AI/profile authority identity change rejects before Health", () => preTokenMutationCase({ id: "PR-13", description: "", mutate: f => f.worker.setIdentity({ origin: "https://alice.yandex.ru", ai_id: "alice", conversation_id: "alice-pre-token-profile" }) }));
await runPR("PR-14", "matching plan and initial snapshot remains valid", async () => { const f = await rebindFixture(); try { const result = await rebindStart(f); assertStartAccepted(result); assert.equal(healthCalls(f).length, 1); assert.equal((await pendingStartAcknowledged(f)).store_context.storeId, f.target.id); } finally { await close(f); } });
await runPR("PR-15", "validated active source Finish uses exactly two revision increments", async () => { const f = await rebindFixture({ state: "active_visible" }); try { const result = await rebindStart(f); assertStartAccepted(result); await pendingStartAcknowledged(f); const work = await f.worker.call("workSessionFor", f.key); assert.equal(work.state, "inactive"); assert.equal(work.revision, f.sourceWork.revision + 2); } finally { await close(f); } });
await runPR("PR-16", "validated inactive source skips Finish", async () => { const f = await rebindFixture({ state: "inactive" }); try { const result = await rebindStart(f); assertStartAccepted(result); assert.equal(f.worker.messages.filter(m => m.type === "OZ_WORK_FINISH").length, 0); } finally { await close(f); } });
await runPR("PR-17", "stale plan makes no Health request", async () => { await preTokenMutationCase({ id: "PR-17", description: "", mutate: f => { f.backing.local[BINDINGS][f.key].revision += 1; } }); });
await runPR("PR-18", "stale plan makes no old Work/binding mutation", async () => { await preTokenMutationCase({ id: "PR-18", description: "", mutate: f => { f.backing.local[SESSIONS][f.key].revision += 1; } }); });
await runPR("PR-19", "stale plan makes no target pending record or prompt", async () => { await preTokenMutationCase({ id: "PR-19", description: "", mutate: f => { f.backing.local[STORES].accounts[f.target.accountId].stores[f.target.id].credentialRevision = "target-pre-token-pending-check"; } }); });
await runPR("PR-20", "unrelated dialogue remains parallel", async () => { const f = await rebindFixture(); try { const second = f.worker.addTab(88, "unrelated-pre-token-dialogue"); const [one, two] = await Promise.all([rebindStart(f), f.worker.popup({ type: "SA_WORK_START", store_id: f.store.id, tab_id: 88, confirm_change: false, start_intent_id: "pr-unrelated" })]); assert.equal(one.ok, true, JSON.stringify(one)); assert.equal(two.ok, true, JSON.stringify(two)); assert.equal(healthCalls(f).length, 2); } finally { await close(f); } });

const failureBatch = cases.filter(item => item.status === "FAIL");
const rbFailures = rb.filter(item => item.status === "FAIL");
const preTokenFailures = preToken.filter(item => item.status === "FAIL");
console.log(JSON.stringify({ status: failureBatch.length || rbFailures.length || preTokenFailures.length ? "FAIL" : "PASS", scope: "C2.3-C1-R2_PRETOKEN_REBIND_PLAN_FENCE", cases, failureBatch, rb, rbFailures, preToken, preTokenFailures, executionAuthority: false }, null, 2));
if (failureBatch.length || rbFailures.length || preTokenFailures.length) process.exitCode = 1;
