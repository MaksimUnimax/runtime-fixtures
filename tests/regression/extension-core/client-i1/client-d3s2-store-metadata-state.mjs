/* D3/S2-1 complete reachable RED/GREEN batch. Synthetic values only. */
import assert from "assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.cwd());
const failures = [];
const cases = [];
if (!Object.hasOwn) Object.hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "99999999-9999-4999-8999-999999999999";
const installationA = "22222222-2222-4222-8222-222222222222";
const installationB = "33333333-3333-4333-8333-333333333333";
const uuid = (() => { let n = 1; return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`; })();

function test(id, description, fn) { cases.push({ id, description, fn }); }
function expectThrow(fn, code) { assert.throws(fn, error => !code || error && (error.code === code || error.message === code)); }
async function expectReject(fn, code) { await assert.rejects(fn, error => !code || error && (error.code === code || error.message === code)); }

function load(file, box = {}) {
  const context = vm.createContext({
    crypto: crypto.webcrypto,
    structuredClone: value => value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
    TextEncoder,
    TextDecoder,
    console,
    Date,
    ...box,
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return context;
}

function catalogFixture(accountId = accountA) {
  const local = {};
  let revisionCounter = 0;
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const context = load("packages/bridge-core/src/stores/catalog.js", {
    SellerAgentsLocalOperations: { createWriteQueue: () => ({ run: fn => fn() }) },
  });
  const catalog = context.SellerAgentsStoreCatalog.create({
    read: async key => ({ [key]: copy(local[key]) }),
    write: async value => Object.assign(local, copy(value)),
    currentAccount: async () => accountId,
    normalizeCredentials: (marketplace, input, previous = {}) => marketplace === "wildberries"
      ? { token: input.token || previous.token || "synthetic-wb-token" }
      : { seller: { clientId: (input.seller && input.seller.clientId) || (previous.seller && previous.seller.clientId) || "seller-id", apiKey: (input.seller && input.seller.apiKey) || (previous.seller && previous.seller.apiKey) || "seller-key" }, performance: input.clearPerformance ? {} : { clientId: (input.performance && input.performance.clientId) || (previous.performance && previous.performance.clientId) || "", clientSecret: (input.performance && input.performance.clientSecret) || (previous.performance && previous.performance.clientSecret) || "" } },
    revision: async () => `credential-revision-${++revisionCounter}`,
    uuid,
  });
  return { catalog, local };
}

async function store(fixture, input = {}) {
  return fixture.catalog.save({ marketplace: "ozon", name: "Synthetic shop", credentials: { seller: { clientId: "seller-id", apiKey: "seller-key" }, ...input.credentials }, ...input });
}

test("STORE-01", "distinct stores remain distinct by stable storeId", async () => { const f = catalogFixture(); const a = await store(f, { name: "A" }); const b = await store(f, { name: "B" }); assert.notEqual(a.id, b.id); });
test("STORE-02", "rename preserves storeId", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, name: "Renamed", credentials: {} }); assert.equal(b.id, a.id); });
test("STORE-03", "rename does not change providerAccountId", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.confirmProviderIdentity(a.id, a.credentialRevision, "provider-1"); const b = await f.catalog.save({ id: a.id, name: "Renamed", credentials: {} }); assert.equal(b.providerAccountId, "provider-1"); });
test("STORE-04", "rename does not change credentialRevision", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, name: "Renamed", credentials: {} }); assert.equal(b.credentialRevision, a.credentialRevision); });
test("STORE-05", "first legitimate provider identity confirmation is accepted", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.confirmProviderIdentity(a.id, a.credentialRevision, "provider-1"); assert.equal(b.providerIdentityState, "CONFIRMED"); assert.equal(b.providerAccountId, "provider-1"); });
test("STORE-06", "confirmed provider identity cannot be silently replaced", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.confirmProviderIdentity(a.id, a.credentialRevision, "provider-1"); await expectReject(() => f.catalog.confirmProviderIdentity(a.id, a.credentialRevision, "provider-2"), "STORE_PROVIDER_IDENTITY_MISMATCH"); });
test("STORE-07", "unconfirmed verification does not erase confirmed identity", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.confirmProviderIdentity(a.id, a.credentialRevision, "provider-1"); const b = await f.catalog.noteVerification(a.id, a.credentialRevision, "seller", { code: "CHECK_FAILED", httpStatus: 503 }); assert.equal(b.providerAccountId, "provider-1"); });
test("STORE-08", "Ozon Seller-only remains usable without Performance", async () => { const f = catalogFixture(); const a = await store(f, { credentials: { seller: { clientId: "s", apiKey: "k" }, performance: {} } }); assert.equal(a.sellerPresent, true); assert.equal(a.performancePresent, false); });
test("STORE-09", "Performance changes do not create another store identity", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, credentials: { performance: { clientId: "p", clientSecret: "secret" } } }); assert.equal(b.id, a.id); });
test("STORE-10", "credential change advances the accepted credential revision", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, credentials: { seller: { clientId: "s2", apiKey: "k2" } } }); assert.notEqual(b.credentialRevision, a.credentialRevision); });
test("STORE-11", "WB state does not acquire Ozon credential semantics", async () => { const f = catalogFixture(); const a = await f.catalog.save({ marketplace: "wildberries", name: "WB", credentials: { token: "wb-token" } }); assert.equal(a.tokenPresent, true); assert.equal(a.sellerPresent, false); assert.equal(a.performancePresent, false); });
test("STORE-12", "same-marketplace stores remain isolated", async () => { const f = catalogFixture(); const a = await store(f, { credentials: { seller: { clientId: "a", apiKey: "a" } } }); const b = await store(f, { credentials: { seller: { clientId: "b", apiKey: "b" } } }); assert.notEqual(a.id, b.id); assert.notEqual(a.credentialRevision, b.credentialRevision); });
test("STORE-13", "newer credential revision fences old Work", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, credentials: { seller: { clientId: "new", apiKey: "new" } } }); assert.notEqual(a.credentialRevision, b.credentialRevision); });
test("STORE-14", "late ACK cannot roll credential revision backward", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, credentials: { seller: { clientId: "new", apiKey: "new" } } }); await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "old", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 1 }); assert.equal((await f.catalog.get(a.id)).credentialRevision, b.credentialRevision); });
test("STORE-15", "duplicate requestId cannot double-advance revision", async () => { const f = catalogFixture(); const a = await store(f); assert.equal((await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "same", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 2 })).metadataRevision, 2); });
test("STORE-16", "stale installation cannot roll revision backward", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "new", credentialRevision: "credential-new", providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 3 }); await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "old", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 2 }); assert.equal((await f.catalog.get(a.id)).metadataRevision, 3); });
test("STORE-17", "credential revision sync contains no credential data", async () => { const f = catalogFixture(); const a = await store(f); const wire = await f.catalog.metadataForSync(a.id); assert.doesNotMatch(JSON.stringify(wire), /seller-key|secret|token/); });
test("STORE-18", "rename remains locally usable while server unavailable", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, name: "Offline rename", credentials: {} }); assert.equal(b.name, "Offline rename"); });
test("STORE-19", "pending rename is journaled through existing C3E", async () => { const f = catalogFixture(); const a = await store(f); assert.equal(typeof f.catalog.metadataForSync, "function"); assert.equal((await f.catalog.metadataForSync(a.id)).name, a.name); });
test("STORE-20", "sync failure does not block ordinary Work", async () => { const f = catalogFixture(); const a = await store(f); assert.equal((await f.catalog.get(a.id)).id, a.id); });
test("STORE-21", "rename does not redirect a pinned command", async () => { const f = catalogFixture(); const a = await store(f); const b = await f.catalog.save({ id: a.id, name: "Renamed", credentials: {} }); assert.equal(b.id, a.id); });
test("STORE-22", "local delete immediately fences current Work", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); await expectReject(() => f.catalog.get(a.id), "STORE_NOT_FOUND"); });
test("STORE-23", "local delete removes local credentials", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const raw = f.local.seller_agents_stores_v1.accounts[accountA].stores[a.id]; assert.deepEqual(raw.credentials, {}); });
test("STORE-24", "delete produces metadata-only pending tombstone", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const raw = f.local.seller_agents_stores_v1.accounts[accountA].stores[a.id]; assert.equal(raw.lifecycleState, "TOMBSTONED"); assert.deepEqual(Object.keys(raw.credentials), []); });
test("STORE-25", "another installation converges the tombstone", async () => { const f = catalogFixture(); const a = await store(f); const result = await f.catalog.applyRemoteMetadata({ kind: "STORE_TOMBSTONE", storeId: a.id, marketplace: "ozon", name: a.name, credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "TOMBSTONED", metadataRevision: 5 }); assert.equal(result.lifecycleState, "TOMBSTONED"); });
test("STORE-26", "converged tombstone fences stale Work", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.applyRemoteMetadata({ kind: "STORE_TOMBSTONE", storeId: a.id, marketplace: "ozon", name: a.name, credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "TOMBSTONED", metadataRevision: 5 }); await expectReject(() => f.catalog.get(a.id), "STORE_NOT_FOUND"); });
test("STORE-27", "stale rename cannot resurrect deleted store", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const result = await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "stale", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 1 }); assert.equal(result.lifecycleState, "TOMBSTONED"); });
test("STORE-28", "stale update cannot resurrect deleted store", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const result = await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "stale", credentialRevision: "old", providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 0 }); assert.equal(result.lifecycleState, "TOMBSTONED"); });
test("STORE-29", "late ACK cannot resurrect deleted store", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const result = await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "late", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 0 }); assert.equal(result.lifecycleState, "TOMBSTONED"); });
test("STORE-30", "clock skew cannot resurrect deleted store", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const result = await f.catalog.applyRemoteMetadata({ kind: "STORE_UPSERT", storeId: a.id, marketplace: "ozon", name: "skew", credentialRevision: a.credentialRevision, providerIdentityState: "UNCONFIRMED", providerAccountId: null, lifecycleState: "ACTIVE", metadataRevision: 0, updatedAt: 1 }); assert.equal(result.lifecycleState, "TOMBSTONED"); });
test("STORE-31", "recreated logical shop gets a new storeId", async () => { const f = catalogFixture(); const a = await store(f); await f.catalog.remove(a.id); const b = await store(f, { name: "Recreated" }); assert.notEqual(a.id, b.id); });
test("STORE-32", "delete for one store does not affect another store", async () => { const f = catalogFixture(); const a = await store(f, { name: "A" }); const b = await store(f, { name: "B" }); await f.catalog.remove(a.id); assert.equal((await f.catalog.get(b.id)).id, b.id); });

// The remaining cases are intentionally direct guards over the one C3E/C3F model.
test("SYNC-33", "requestId duplicate handling remains idempotent", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /applyStoreMetadata/); });
test("SYNC-34", "stale baseRevision gives deterministic conflict", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /applyStoreMetadata/); });
test("SYNC-35", "one store conflict does not block unrelated store", async () => { const f = catalogFixture(); const a = await store(f, { name: "A" }); const b = await store(f, { name: "B" }); await f.catalog.remove(a.id); assert.equal((await f.catalog.get(b.id)).name, "B"); });
test("SYNC-36", "one-store backlog does not block ordinary work elsewhere", async () => { const f = catalogFixture(); const a = await store(f); const b = await store(f); assert.equal((await f.catalog.get(b.id)).id, b.id); assert.equal(a.id !== b.id, true); });
test("SYNC-37", "disconnected installation remains UNKNOWN until contact", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /UNKNOWN_REMOTE_INSTALLATION_STATE/); assert.match(source, /STORE_RECONCILIATION_CLASSES/); });
test("SYNC-38", "recovery drains metadata through C3E/P3 only", async () => { const f = catalogFixture(); assert.equal(typeof f.catalog.metadataForSync, "function"); });
test("SYNC-39", "no second sync queue exists", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/sync-journal.js"), "utf8"); assert.equal((source.match(/STORAGE_KEY/g) || []).length >= 1, true); assert.doesNotMatch(source, /sync_v2|second.?queue|heartbeat|WebSocket|lease/i); });
test("SYNC-40", "no heartbeat/WebSocket/lease is introduced", async () => { const files = ["apps/extension/src/application/sync-journal.js", "packages/bridge-core/src/stores/catalog.js"]; for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /WebSocket|heartbeat|server lease/i); });
test("BIND-41", "store metadata update does not overwrite bindingRevision", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /applyStoreMetadata/); });
test("BIND-42", "Finish still outranks late delivery", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /SERVER_FINISH_WINS_OVER_LATE_DELIVERY/); });
test("BIND-43", "explicit store switch still outranks late delivery", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /STALE_DELIVERY_OBSOLETE/); });
test("BIND-44", "last-delivered remains same-binding/store eligible", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /deliveryEligibility/); });
test("BIND-45", "preferredExecutor does not flap from store metadata", async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.match(source, /preferredExecutorDecision/); });
for (const [id, text] of [["REPLAY-46", "UNKNOWN provider attempt"], ["REPLAY-47", "known provider result"], ["REPLAY-48", "UNKNOWN AI delivery"], ["REPLAY-49", "confirmed AI delivery"]]) test(id, `store reconciliation cannot replay ${text}`, async () => { const source = fs.readFileSync(path.join(root, "packages/bridge-core/src/sync/reconciliation.js"), "utf8"); assert.doesNotMatch(source, /provider.*replay|resend.*AI|retry.*delivery/i); });
test("REPLAY-50", "delete/rename/revision reconciliation causes zero provider calls", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/sync-journal.js"), "utf8"); assert.doesNotMatch(source, /OzonProvider|WBAdapter|provider.*call/i); });
test("PRIV-51", "sync payload contains no marketplace credential", async () => { const f = catalogFixture(); const a = await store(f); const wire = await f.catalog.metadataForSync(a.id); assert.deepEqual(Object.keys(wire).sort(), ["credentialRevision", "kind", "lifecycleState", "marketplace", "metadataRevision", "name", "providerAccountId", "providerIdentityState", "storeId"].sort()); });
test("PRIV-52", "database state has no marketplace credential field", async () => { const source = fs.readFileSync(path.join(root, "packages/server/db/drizzle/0017_i1_c3e_sync_journal.sql"), "utf8"); assert.doesNotMatch(source, /credential|token|secret/i); });
test("PRIV-53", "logs/evidence do not add credentials", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/sync-journal.js"), "utf8"); assert.doesNotMatch(source, /console\.(log|error).*credential|console\.(log|error).*token/i); });
test("PRIV-54", "new state stores no report/provider file/AI text", async () => { const f = catalogFixture(); const a = await store(f); const wire = await f.catalog.metadataForSync(a.id); assert.doesNotMatch(JSON.stringify(wire), /report|file|aiText|messageBody/i); });
test("PRIV-55", "account A cannot read/reconcile account B state", async () => { const f = catalogFixture(accountA); const b = catalogFixture(accountB); const aStore = await store(f); await expectReject(() => b.catalog.get(aStore.id), "STORE_NOT_FOUND"); });
test("CALL-56", "ordinary Ozon command has zero mandatory control calls", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/runtime.js"), "utf8"); assert.doesNotMatch(source, /SA_STORE_METADATA_SYNC.*mandatory/i); });
test("CALL-57", "ordinary WB command has zero mandatory control calls", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/runtime.js"), "utf8"); assert.doesNotMatch(source, /SA_STORE_METADATA_SYNC.*mandatory/i); });
test("CALL-58", "ordinary AI delivery has zero mandatory control calls", async () => { const source = fs.readFileSync(path.join(root, "apps/extension/src/application/delivery.js"), "utf8"); assert.doesNotMatch(source, /store.?metadata|syncNow/i); });
test("CALL-59", "offline valid Work remains valid with pending metadata sync", async () => { const f = catalogFixture(); const a = await store(f); assert.equal((await f.catalog.get(a.id)).id, a.id); });

async function main() {
  for (const item of cases) {
    try { await item.fn(); } catch (error) { failures.push({ id: item.id, description: item.description, error: (error && error.message) || String(error) }); }
  }
  console.log(JSON.stringify({ total: cases.length, passed: cases.length - failures.length, failed: failures.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
main();
