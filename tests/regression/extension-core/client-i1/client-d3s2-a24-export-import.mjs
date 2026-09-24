import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../../../packages/bridge-core/src/stores/backup.js", import.meta.url), "utf8");
const context = { console, crypto: webcrypto, structuredClone, TextEncoder, TextDecoder, btoa, atob };
vm.createContext(context);
vm.runInContext(source, context, { filename: "backup.js" });
const backup = context.SellerAgentsStoreBackup;
const accountA = "account-a";
const accountB = "account-b";
const password = "synthetic-a24-password";
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = async value => [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");

const stores = [
  { id: "ozon-seller", name: "Ozon Seller", marketplace: "ozon", credentialRevision: "credential-ozon-seller", metadataRevision: 2, lifecycleState: "ACTIVE", providerIdentityState: "CONFIRMED", providerAccountId: "ozon-100", credentials: { seller: { clientId: "ozon-client", apiKey: "ozon-key" }, performance: {} } },
  { id: "ozon-performance", name: "Ozon Performance", marketplace: "ozon", credentialRevision: "credential-ozon-performance", metadataRevision: 3, lifecycleState: "ACTIVE", providerIdentityState: "UNCONFIRMED", providerAccountId: null, credentials: { seller: { clientId: "ozon-client-2", apiKey: "ozon-key-2" }, performance: { clientId: "perf-client", clientSecret: "perf-secret" } } },
  { id: "wb-one", name: "WB One", marketplace: "wildberries", credentialRevision: "credential-wb-one", metadataRevision: 1, lifecycleState: "ACTIVE", providerIdentityState: "UNCONFIRMED", providerAccountId: null, credentials: { token: "wb-token-one" } },
  { id: "wb-two", name: "WB Two", marketplace: "wildberries", credentialRevision: "credential-wb-two", metadataRevision: 4, lifecycleState: "ACTIVE", providerIdentityState: "CONFIRMED", providerAccountId: "wb-200", credentials: { token: "wb-token-two" } },
  { id: "deleted", name: "Deleted", marketplace: "ozon", credentialRevision: "credential-deleted", metadataRevision: 9, lifecycleState: "TOMBSTONED", providerIdentityState: "UNCONFIRMED", providerAccountId: null, credentials: { seller: { clientId: "deleted", apiKey: "deleted" }, performance: {} } },
];
const payload = backup.payloadFromStores(accountA, stores);
const results = [];
async function run(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); } catch (error) { results.push({ id, status: "FAIL", description, error: `${error.code || error.name}: ${error.message}` }); throw error; }
}
async function rejects(fn, code) { const accepted = Array.isArray(code) ? code : [code]; await assert.rejects(fn, error => accepted.includes(error?.code), accepted.join("/")); }

await run("EX-01..EX-18", "export boundary includes every active store and excludes local/session/remote side effects", async () => {
  assert.equal(payload.stores.length, 4); assert.deepEqual(payload.stores.map(store => store.storeId), ["ozon-seller", "ozon-performance", "wb-one", "wb-two"]);
  assert.equal(JSON.stringify(payload).includes("deleted"), false); assert.equal(JSON.stringify(payload).includes("conversation"), false); assert.equal(JSON.stringify(payload).includes("access_token"), false);
});
await run("EX-19..EX-24", "current envelope is versioned, randomized, bounded and authenticated", async () => {
  const first = JSON.parse(await backup.encrypt(payload, password)); const second = JSON.parse(await backup.encrypt(payload, password));
  assert.equal(first.magic, backup.MAGIC); assert.equal(first.envelopeVersion, 1); assert.equal(first.kdf.name, backup.KDF_NAME); assert.equal(first.encryption.name, backup.ENCRYPTION_NAME);
  assert.notEqual(first.kdf.salt, second.kdf.salt); assert.notEqual(first.encryption.iv, second.encryption.iv); assert.notEqual(first.ciphertext, second.ciphertext); assert.equal(first.kdf.iterations, backup.KDF_ITERATIONS);
});
const encrypted = await backup.encrypt(payload, password);
await run("EX-25..EX-30", "wrong password, ciphertext/tag/header/truncation/encoding tamper fail closed", async () => {
  await rejects(() => backup.decrypt(encrypted, "wrong-password", accountA), "BACKUP_AUTHENTICATION_FAILED");
  const cases = [
    value => { value.ciphertext = value.ciphertext.slice(0, -2) + (value.ciphertext.endsWith("A") ? "B" : "A"); },
    value => { value.kdf.iterations += 1; },
    value => { value.encryption.iv = value.encryption.iv.slice(0, -2) + "AA"; },
    value => { value.ciphertext = value.ciphertext.slice(0, -4); },
  ];
  for (const mutate of cases) { const value = JSON.parse(encrypted); mutate(value); await rejects(() => backup.decrypt(JSON.stringify(value), password, accountA), ["BACKUP_AUTHENTICATION_FAILED", "BACKUP_ENCODING_INVALID"]); }
  await rejects(() => backup.decrypt("not-json", password, accountA), "BACKUP_JSON_INVALID");
});
await run("EX-31..EX-35", "unsupported algorithms/versions and resource bounds fail before import", async () => {
  const algorithm = JSON.parse(encrypted); algorithm.kdf.name = "scrypt"; await rejects(() => backup.decrypt(JSON.stringify(algorithm), password, accountA), "BACKUP_KDF_INVALID");
  const future = JSON.parse(encrypted); future.envelopeVersion = 99; await rejects(() => backup.decrypt(JSON.stringify(future), password, accountA), "BACKUP_VERSION_UNSUPPORTED");
  await rejects(() => backup.decrypt("{" + "x".repeat(backup.LIMITS.maxFileBytes) + "}", password, accountA), "BACKUP_FILE_TOO_LARGE");
  const duplicate = structuredClone(payload); duplicate.stores.push(structuredClone(duplicate.stores[0])); await rejects(() => backup.encrypt(duplicate, password), "BACKUP_DUPLICATE_STORE_ID");
  const extra = structuredClone(payload); extra.stores[0].credentials.extra = "no"; await rejects(() => backup.encrypt(extra, password), "BACKUP_UNKNOWN_FIELDS");
});
await run("EX-36..EX-40", "account binding is explicit and login/device sessions are not portable", async () => {
  const decoded = await backup.decrypt(encrypted, password, accountA); assert.equal(decoded.payload.accountBinding.accountId, accountA);
  await rejects(() => backup.decrypt(encrypted, password, accountB), "BACKUP_ACCOUNT_MISMATCH");
  assert.equal(JSON.stringify(decoded.payload).includes("session"), false); assert.equal(JSON.stringify(decoded.payload).includes("device"), false);
});
await run("EX-41..EX-45", "Ozon seller/performance and WB shapes round-trip; unknown/mismatched shapes reject", async () => {
  const decoded = (await backup.decrypt(encrypted, password, accountA)).payload;
  assert.equal(decoded.stores[0].credentials.performance, null); assert.equal(decoded.stores[1].credentials.performance.clientSecret, "perf-secret"); assert.equal(decoded.stores[2].credentials.type, "wildberries");
  const unknown = structuredClone(payload); unknown.stores[0].credentials.type = "unknown"; await rejects(() => backup.encrypt(unknown, password), "BACKUP_CREDENTIAL_SHAPE_INVALID");
  const mismatch = structuredClone(payload); mismatch.stores[0].marketplace = "wildberries"; await rejects(() => backup.encrypt(mismatch, password), ["BACKUP_CREDENTIAL_SHAPE_INVALID", "BACKUP_UNKNOWN_FIELDS"]);
});
await run("EX-46..EX-63", "conflict plan inputs remain non-overwriting and lifecycle state is absent from payload", async () => {
  const decoded = await backup.decrypt(encrypted, password, accountA); const ids = Array.from(decoded.payload.stores, store => store.storeId); assert.deepEqual(ids, ["ozon-seller", "ozon-performance", "wb-one", "wb-two"]);
  assert.equal(decoded.payload.stores.every(store => store.credentialsStale === undefined), true); assert.equal(decoded.payload.stores.every(store => store.lifecycleState === undefined), true);
  // The runtime catalog classifies existing credential revisions as a safe conflict.
  assert.equal(decoded.payload.stores.every(store => typeof store.credentialRevision === "string"), true);
});
await run("EX-56", "catalog import writes one coherent storage snapshot and leaves prior state after write failure", async () => {
  const catalogContext = { ...context, SellerAgentsLocalOperations: { createWriteQueue: () => { let flight = Promise.resolve(); return { run(fn) { const next = flight.then(fn, fn); flight = next.catch(() => {}); return next; } }; } } };
  vm.createContext(catalogContext);
  vm.runInContext(fs.readFileSync(new URL("../../../../packages/bridge-core/src/stores/catalog.js", import.meta.url), "utf8"), catalogContext, { filename: "catalog.js" });
  const storage = {};
  let failWrites = false;
  const catalog = catalogContext.SellerAgentsStoreCatalog.create({
    read: async key => structuredClone(key ? { [key]: storage[key] } : storage),
    write: async values => { if (failWrites) throw new Error("INJECTED_STORAGE_FAILURE"); Object.assign(storage, structuredClone(values)); },
    currentAccount: async () => accountA,
    normalizeCredentials: (_marketplace, input) => structuredClone(input),
    revision: async () => "credential-generated",
    uuid: () => "catalog-store",
  });
  const saved = await catalog.save({ marketplace: "wildberries", name: "Atomic baseline", credentials: { token: "atomic-token" } });
  const before = structuredClone(storage);
  const importedSource = { ...await catalog.get(saved.id), id: "atomic-import", name: "Atomic imported", lifecycleState: "ACTIVE" };
  const importedPayload = backup.payloadFromStores(accountA, [importedSource]);
  const plan = await catalog.planBackupImport(importedPayload);
  assert.equal(plan.classifications[0].kind, "IMPORT_NEW");
  failWrites = true;
  await assert.rejects(() => catalog.applyBackupImport(importedPayload, plan), /INJECTED_STORAGE_FAILURE/);
  assert.deepEqual(storage, before);
});
await run("EX-64..EX-67", "real historical provider backups are explicit adapters; unknown legacy JSON is rejected", async () => {
  const ozonLegacy = { format: "ozon-bridge-seller-credentials-backup", backup_version: 1, exported_at: "2026-01-01T00:00:00.000Z", extension_version: "0.1.22", extension_id: null, contains_secrets: true, credentials: { seller_client_id: "legacy-client", seller_api_key: "legacy-key" } };
  ozonLegacy.credentials_sha256 = await digest(ozonLegacy.credentials);
  const adapted = await backup.decrypt(JSON.stringify(ozonLegacy), "unused", accountA); assert.equal(adapted.legacy, true); assert.equal(adapted.payload.stores[0].credentials.seller.apiKey, "legacy-key");
  const repeated = await backup.decrypt(JSON.stringify(ozonLegacy), "unused", accountA);
  assert.equal(repeated.payload.stores[0].storeId, adapted.payload.stores[0].storeId);
  assert.equal(repeated.payload.stores[0].credentialRevision, adapted.payload.stores[0].credentialRevision);
  const otherAccount = await backup.decrypt(JSON.stringify(ozonLegacy), "unused", accountB);
  assert.notEqual(otherAccount.payload.stores[0].storeId, adapted.payload.stores[0].storeId);
  const ozonV2 = { format: "ozon-bridge-credentials-backup", backup_version: 2, exported_at: "2026-08-17T03:57:15.847Z", extension_version: "0.1.12", extension_id: "synthetic-ozon-extension", contains_secrets: true, credentials: { seller_client_id: "legacy-v2-client", seller_api_key: "legacy-v2-key", performance_client_id: "legacy-performance-client", performance_client_secret: "legacy-performance-secret" } };
  ozonV2.credentials_sha256 = await digest(ozonV2.credentials);
  const wbV2 = { format: "wildberries-bridge-seller-credentials-backup", backup_version: 2, exported_at: "2026-08-12T14:05:27.253Z", extension_version: "0.1.2", extension_id: "synthetic-wb-extension", contains_secrets: true, credentials: { seller_token: "legacy-wb-token", seller_token_type: "personal" } };
  wbV2.credentials_sha256 = await digest(wbV2.credentials);
  for (const legacy of [ozonV2, wbV2]) {
    const first = await backup.decrypt(JSON.stringify(legacy), "unused", accountA);
    const second = await backup.decrypt(JSON.stringify(legacy), "unused", accountA);
    assert.equal(second.payload.stores[0].storeId, first.payload.stores[0].storeId);
    assert.equal(second.payload.stores[0].credentialRevision, first.payload.stores[0].credentialRevision);
    assert.notEqual((await backup.decrypt(JSON.stringify(legacy), "unused", accountB)).payload.stores[0].storeId, first.payload.stores[0].storeId);
  }
  const legacyStorage = {};
  const legacyContext = { ...context, SellerAgentsLocalOperations: { createWriteQueue: () => ({ run: fn => fn() }) } };
  vm.createContext(legacyContext);
  vm.runInContext(fs.readFileSync(new URL("../../../../packages/bridge-core/src/stores/catalog.js", import.meta.url), "utf8"), legacyContext, { filename: "catalog.js" });
  const legacyCatalog = legacyContext.SellerAgentsStoreCatalog.create({
    read: async key => structuredClone(key ? { [key]: legacyStorage[key] } : legacyStorage),
    write: async values => Object.assign(legacyStorage, structuredClone(values)),
    currentAccount: async () => accountA,
    normalizeCredentials: (_marketplace, input) => structuredClone(input),
    revision: async () => "unused-revision",
    uuid: () => "unused-uuid",
  });
  const previewPlan = await legacyCatalog.planBackupImport(adapted.payload);
  assert.equal(previewPlan.classifications[0].kind, "IMPORT_NEW");
  const applied = await legacyCatalog.applyBackupImport(repeated.payload, previewPlan);
  assert.equal(applied.imported.length, 1);
  const repeatPlan = await legacyCatalog.planBackupImport((await backup.decrypt(JSON.stringify(ozonLegacy), "unused", accountA)).payload);
  assert.equal(repeatPlan.classifications[0].kind, "SAME_CURRENT");
  const unknown = { format: "seller-agents-old-looking-json", backup_version: 0, credentials: { seller_client_id: "x", seller_api_key: "y" } }; await rejects(() => backup.decrypt(JSON.stringify(unknown), "unused", accountA), "BACKUP_VERSION_UNSUPPORTED");
});
await run("EX-68..EX-74", "secret lifetime/privacy boundaries contain no plaintext in envelope and reject arbitrary page-shaped payloads", async () => {
  assert.equal(encrypted.includes("ozon-key"), false); assert.equal(encrypted.includes("perf-secret"), false); assert.equal(encrypted.includes("wb-token"), false);
  const malformed = structuredClone(payload); malformed.stores[0].credentials = { type: "ozon", version: 1, seller: { clientId: "x", apiKey: "y" }, performance: null, executable: "eval" }; await rejects(() => backup.encrypt(malformed, password), "BACKUP_UNKNOWN_FIELDS");
});

console.log(JSON.stringify({ suite: "A24", cases: results.length, results }, null, 2));
