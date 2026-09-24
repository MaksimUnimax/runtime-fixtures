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
const failures = results.filter(result => result.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "C3E_RARE_EXTENSION_INITIATED_SYNC_JOURNAL", results, failureBatch: failures }, null, 2));
if (failures.length) process.exitCode = 1;
