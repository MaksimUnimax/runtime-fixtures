import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";

const root = path.resolve(process.argv[2] || process.cwd());
const storage = {};
const scheduled = [];
let online = true;
let lastRequest = null;
let appliedRemote = [];
function chromeStorageReadback(value) {
  if (Array.isArray(value)) return value.map(chromeStorageReadback);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, chromeStorageReadback(item)]));
  return value;
}
const box = {
  crypto: { subtle: crypto.webcrypto.subtle, randomUUID: crypto.randomUUID },
  structuredClone,
  TextEncoder,
  TextDecoder,
  queueMicrotask,
  console,
  Date,
  storageGet: async key => ({ [key]: chromeStorageReadback(storage[key]) }),
  storageSet: async values => Object.assign(storage, structuredClone(values)),
  SellerAgentsControlClient: {
    async getAuthority() { return { payload: { account: { id: "11111111-1111-4111-8111-111111111111" } }, deviceId: "22222222-2222-4222-8222-222222222222" }; },
    async synchronizeMetadata(request) {
      lastRequest = request;
      if (!online) throw Object.assign(new Error("offline"), { code: "CONTROL_TRANSPORT_UNAVAILABLE" });
      return { syncVersion: request.syncVersion, results: request.entries.map(entry => ({ requestId: entry.requestId, mutationId: entry.mutationId, entityId: entry.entityId, outcome: "ACK", serverRevision: 1, serverState: { ...entry.payload }, code: null })) };
    },
  },
  SellerAgentsTechnicalScheduler: { KINDS: { SYNC: "SYNC" }, async schedule(kind, value) { scheduled.push([kind, value]); }, async cancelKind() {}, async wake() {} },
  SellerAgentsReconciliation: { allowsFutureAction() { return { allowed: true, code: null }; } },
  SellerAgentsActiveStoreCatalog: { async applyRemoteMetadata(state) { appliedRemote.push(structuredClone(state)); } },
  WORKER_SESSION_ID: "worker-1",
};
const context = vm.createContext(box);
for (const file of ["packages/bridge-core/src/sync/reconciliation.js", "apps/extension/src/application/sync-journal.js"])
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });

async function main() {
  const journal = context.SellerAgentsSyncJournal;
  const store = { id: "store-1", marketplace: "ozon", name: "Offline rename", providerAccountId: null, providerIdentityState: "UNCONFIRMED", credentialRevision: "a".repeat(64), metadataRevision: 2, lifecycleState: "ACTIVE", credentials: { seller: { apiKey: "synthetic-secret" } } };
  const rename = await journal.recordStoreMetadata({ store });
  assert.equal(rename.kind, "STORE_UPSERT");
  assert.equal(rename.entityId, "store:store-1");
  assert.equal(rename.payload.name, "Offline rename");
  assert.doesNotMatch(JSON.stringify(rename.payload), /synthetic-secret|credentials|token|secret/i);
  online = false;
  const offline = await journal.syncNow("offline");
  assert.equal(offline.ok, false);
  const retained = await journal.read();
  assert.equal(Object.values(retained.entries).length, 1);
  const tombstone = await journal.recordStoreTombstone({ store: { ...store, lifecycleState: "TOMBSTONED", metadataRevision: 3, credentials: {} } });
  assert.equal(tombstone.kind, "STORE_TOMBSTONE");
  assert.equal(tombstone.payload.lifecycleState, "TOMBSTONED");
  assert.doesNotMatch(JSON.stringify(tombstone.payload), /credentials|synthetic-secret/i);
  const before = await journal.read();
  for (const entry of Object.values(before.entries)) entry.nextAttemptAt = 0;
  await box.storageSet({ seller_agents_sync_journal_v1: before });
  online = true;
  const recovered = await journal.syncNow("recovery");
  assert.equal(recovered.ok, true);
  assert.equal(lastRequest.entries.every(entry => entry.kind === "STORE_TOMBSTONE"), true);
  assert.equal(appliedRemote.length > 0, true);
  console.log(JSON.stringify({ rename: "PASS", offline: "PASS", tombstone: "PASS", recovery: "PASS", scheduled: scheduled.length, appliedRemote: appliedRemote.length }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
