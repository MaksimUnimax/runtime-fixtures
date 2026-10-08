import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const root = new URL("../../../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), "utf8");
const context = { structuredClone, crypto: webcrypto, TextEncoder, TextDecoder, btoa, atob };
vm.createContext(context);
for (const path of [
  "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_credentials.js",
  "packages/bridge-core/src/execution/local-operations.js",
  "packages/bridge-core/src/stores/backup.js",
  "packages/bridge-core/src/stores/catalog.js",
]) vm.runInContext(read(path), context, { filename: path });
// Use the real application adapter: an identity mock misses derived `present` fields.
const application = read("apps/extension/src/application/runtime.js");
const start = application.indexOf("  normalizeCredentials(marketplace, input, previous = {}) {");
const end = application.indexOf("  revision:", start);
assert.ok(start >= 0 && end > start);
const normalizeCredentials = vm.runInContext(`({${application.slice(start, end)}}).normalizeCredentials`, context);
const backup = context.SellerAgentsStoreBackup;
const account = "synthetic-account";
const key = "seller_agents_stores_v1";
let checks = 0;

function fixture() {
  let data = {}, serial = 0;
  const catalog = context.SellerAgentsStoreCatalog.create({
    read: async () => structuredClone(data),
    write: async next => { data = structuredClone(next); },
    currentAccount: async () => account,
    normalizeCredentials,
    uuid: () => String(++serial),
    revision: () => `revision-${++serial}`,
  });
  return { catalog, snapshot: () => structuredClone(data), replace: next => { data = next; } };
}
async function seed(catalog, performance = true) {
  return catalog.save({ marketplace: "ozon", name: "Synthetic store", credentials: {
    seller: { clientId: "100", apiKey: "synthetic-seller-key" },
    performance: performance ? { clientId: "200", clientSecret: "synthetic-performance-secret" } : {},
  } });
}
async function run(name, fn) {
  await fn(); checks++; console.log(`PASS ${name}`);
}

for (const performance of [true, false]) {
  await run(`real-normalizer encrypted roundtrip performance=${performance}`, async () => {
    const f = fixture(); await seed(f.catalog, performance);
    const before = f.snapshot();
    const payload = backup.payloadFromStores(account, await f.catalog.backupSnapshot());
    const decoded = await backup.decrypt(await backup.encrypt(payload, "synthetic-roundtrip-password"), "synthetic-roundtrip-password", account);
    const plan = await f.catalog.planBackupImport(decoded.payload);
    assert.equal(plan.classifications[0].kind, "SAME_CURRENT");
    const applied = await f.catalog.applyBackupImport(decoded.payload, plan);
    assert.equal(applied.imported.length, 0);
    assert.deepEqual(f.snapshot(), before, "idempotent reimport must not alter keys, revisions or metadata");
  });
}
await run("new import becomes canonical and subsequent preview is SAME_CURRENT", async () => {
  const source = fixture(); await seed(source.catalog);
  const payload = backup.payloadFromStores(account, await source.catalog.backupSnapshot());
  const target = fixture(); const plan = await target.catalog.planBackupImport(payload);
  assert.equal(plan.classifications[0].kind, "IMPORT_NEW");
  assert.equal((await target.catalog.applyBackupImport(payload, plan)).imported.length, 1);
  assert.equal((await target.catalog.planBackupImport(payload)).classifications[0].kind, "SAME_CURRENT");
});
for (const change of ["secret", "revision"]) {
  await run(`changed ${change} remains a conflict and does not overwrite`, async () => {
    const f = fixture(); await seed(f.catalog); const before = f.snapshot();
    const payload = structuredClone(backup.payloadFromStores(account, await f.catalog.backupSnapshot()));
    if (change === "secret") payload.stores[0].credentials.seller.apiKey = "different-synthetic-key";
    else payload.stores[0].credentialRevision = "different-revision";
    const plan = await f.catalog.planBackupImport(payload);
    assert.equal(plan.classifications[0].kind, "LOCAL_NEWER");
    assert.equal((await f.catalog.applyBackupImport(payload, plan)).imported.length, 0);
    assert.deepEqual(f.snapshot(), before);
  });
}
await run("credential change after preview rejects stale plan without overwriting", async () => {
  const f = fixture(); await seed(f.catalog);
  const payload = backup.payloadFromStores(account, await f.catalog.backupSnapshot());
  const plan = await f.catalog.planBackupImport(payload);
  const changed = f.snapshot(); changed[key].accounts[account].stores[payload.stores[0].storeId].credentials.seller.apiKey = "new-local-key";
  f.replace(changed);
  await assert.rejects(() => f.catalog.applyBackupImport(payload, plan), error => error.code === "IMPORT_PLAN_STALE");
  assert.deepEqual(f.snapshot(), changed);
});
console.log(JSON.stringify({ status: "PASS", checks, sourceOnly: true }));
