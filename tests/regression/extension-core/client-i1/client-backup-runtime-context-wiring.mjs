import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorker, until, signFixtureBootstrap } from "../worker-harness.mjs";

// Isolated ordinary public-worker regressions for the repaired candidate.
// Disposable synthetic ports only; no browser install or external transport.
const directory = path.resolve(process.argv[2] || "");
assert.ok(process.argv[2], "Pass an already composed development worker directory");
const application = fs.readFileSync(path.join(directory, "shared/application.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
const catalogKey = "seller_agents_stores_v1";
const popup = { url: "chrome-extension://core-fixture/popup.html" };
const importPanel = { url: "chrome-extension://core-fixture/popup.html#backup-import" };
const password = "synthetic-backup-baseline-password";
const checks = [];
const evidence = {
  version: manifest.version,
  level: "GENERATED_WORKER_SYNTHETIC",
  callbackConfigured: /assertBackupContext\s*:/.test(application),
  legacyTwoArgumentImport: application.includes("saCatalog.applyBackupImport(decoded.payload, plan)"),
  productAcceptance: false,
  candidateInvalidationRun: false,
};
async function test(name, fn) {
  await fn();
  checks.push({ name, status: "PASS" });
}
async function worker(options = {}) {
  return makeWorker(directory, {
    ...options,
    fetch: options.fetch || (async () => { throw new Error("UNEXPECTED_SYNTHETIC_TRANSPORT"); }),
  });
}
function assertNoProviderCalls(instance) {
  assert.equal(instance.network.length, 0);
}
function catalogWrites(options = {}) {
  const state = { attempts: 0 };
  state.options = {
    ...options,
    onStorageWrite(kind, values) {
      if (kind === "local" && Object.hasOwn(values, catalogKey)) {
        state.attempts++;
        if (options.failCatalogWrite) throw new Error("SYNTHETIC_STORAGE_FAILURE");
      }
    },
  };
  return state;
}
let backup;
const source = await worker();
try {
  const saved = await source.request({
    type: "SA_STORE_SAVE",
    store: {
      marketplace: "ozon",
      name: "Synthetic backup baseline",
      credentials: {
        seller: { clientId: "100", apiKey: "synthetic-backup-baseline-key" },
        performance: {},
      },
    },
  }, popup);
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const exported = await source.request({
    type: "SA_BACKUP_EXPORT", password, passwordConfirmation: password,
  }, popup);
  assert.equal(exported.ok, true, JSON.stringify(exported.error));
  assert.equal(exported.storeCount, 1);
  backup = exported.backup;
  assert.ok(backup);
  assert.equal(JSON.stringify(backup).includes("synthetic-backup-baseline-key"), false);
  assertNoProviderCalls(source);
} finally { source.close(); }

await test("ordinary encrypted public-panel import and idempotent preview", async () => {
  const writes = catalogWrites();
  const target = await worker(writes.options);
  try {
    const preview = await target.request({ type: "SA_BACKUP_PREVIEW", backup, password }, importPanel);
    assert.equal(preview.ok, true, JSON.stringify(preview.error));
    assert.equal(preview.preview.classifications[0].kind, "IMPORT_NEW");
    assert.equal(writes.attempts, 0);
    const applied = await target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: true }, importPanel);
    assert.equal(applied.ok, true, JSON.stringify(applied.error));
    assert.equal(applied.imported.length, 1);
    const persisted = target.backing.local[catalogKey].accounts[target.accountId].stores;
    assert.equal(Object.keys(persisted).length, 1);
    assert.equal(persisted[applied.imported[0].id].accountId, target.accountId);
    assert.equal(persisted[applied.imported[0].id].credentials.seller.apiKey, "synthetic-backup-baseline-key");
    assert.equal(writes.attempts, 1);
    const again = await target.request({ type: "SA_BACKUP_PREVIEW", backup, password }, importPanel);
    assert.equal(again.ok, true);
    assert.equal(again.preview.classifications[0].kind, "SAME_CURRENT");
    assert.equal(writes.attempts, 1);
    assertNoProviderCalls(target);
  } finally { target.close(); }
});

await test("cancelled import confirmation leaves catalog untouched", async () => {
  const writes = catalogWrites();
  const target = await worker(writes.options);
  try {
    const response = await target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: false }, importPanel);
    assert.equal(response.ok, false);
    assert.equal(response.code, "BACKUP_EXPLICIT_ACTION_REQUIRED");
    assert.equal(writes.attempts, 0);
    assert.equal(target.backing.local[catalogKey], undefined);
    assertNoProviderCalls(target);
  } finally { target.close(); }
});

await test("ordinary signed-out import is refused before catalog write", async () => {
  const writes = catalogWrites({ seedAuthority: false });
  const target = await worker(writes.options);
  try {
    const response = await target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: true }, importPanel);
    assert.equal(response.ok, false);
    assert.equal(response.code, "AUTH_REQUIRED");
    assert.equal(writes.attempts, 0);
    assertNoProviderCalls(target);
  } finally { target.close(); }
});

await test("backup belonging to a different synthetic account is refused", async () => {
  const writes = catalogWrites({ accountId: "44444444-4444-4444-8444-444444444444" });
  const target = await worker(writes.options);
  try {
    const response = await target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: true }, importPanel);
    assert.equal(response.ok, false);
    assert.ok(response.code);
    assert.equal(writes.attempts, 0);
    assert.equal(target.backing.local[catalogKey], undefined);
    assertNoProviderCalls(target);
  } finally { target.close(); }
});

await test("synthetic storage failure never reports successful import", async () => {
  const writes = catalogWrites({ failCatalogWrite: true });
  const target = await worker(writes.options);
  try {
    const response = await target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: true }, importPanel);
    assert.equal(response.ok, false);
    assert.ok(response.code);
    assert.equal(writes.attempts, 1);
    assert.equal(target.backing.local[catalogKey], undefined);
    assertNoProviderCalls(target);
  } finally { target.close(); }
});


await test("captured backup context is frozen and synchronous guard expires on ordinary cancellation", async () => {
  const target = await worker();
  try {
    const pinned = await target.call("SellerAgentsControlClient.captureBackupContext");
    assert.equal(Object.isFrozen(pinned), true);
    assert.equal(target.call("SellerAgentsControlClient.assertBackupContext", pinned), true);
    const cancelled = await target.request({ type: "SA_AUTH_CANCEL" }, popup);
    assert.equal(cancelled.ok, true);
    assert.throws(() => target.call("SellerAgentsControlClient.assertBackupContext", pinned),
      error => error.code === "AUTH_GENERATION_CHANGED");
    assertNoProviderCalls(target);
  } finally { target.close(); }
});

async function queuedImportInvalidation(transition) {
  // Ordinary authorized operations on disposable ports. The production import,
  // catalog queue, encryption, sender admission and signature verifier stay real.
  // This check runs only on the repaired candidate; no historical failing path.
  let releaseWrite, writeEntered, planRead = false, watchPlan = false, attempts = 0;
  const held = new Promise(resolve => { writeEntered = resolve; });
  const release = new Promise(resolve => { releaseWrite = resolve; });
  const backing = { local: {}, session: {} };
  let payload, credentials;
  const target = await worker({
    backing,
    onStorageRead(kind, keys) {
      if (watchPlan && kind === "local" &&
          (keys === catalogKey || Array.isArray(keys) && keys.includes(catalogKey))) planRead = true;
    },
    async onStorageWrite(kind, values) {
      if (kind !== "local" || !Object.hasOwn(values, catalogKey)) return;
      attempts++;
      if (attempts === 1) { writeEntered(); await release; }
    },
    fetch: async url => {
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/device-authorizations") return Response.json({
        status: "pending", authorizationId: "55555555-5555-4555-8555-555555555555",
        deviceCode: "D".repeat(43), userCode: "ABCD-EFGH",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      if (pathname === "/v1/device-authorizations/token")
        return Response.json({ status: "activated", ...credentials });
      if (pathname === "/v1/bootstrap")
        return Response.json(await signFixtureBootstrap(backing, payload));
      throw new Error("UNEXPECTED_SYNTHETIC_TRANSPORT");
    },
  });
  let blocker, importing;
  try {
    const authKey = "seller_agents_control_auth_v2";
    payload = structuredClone(backing.local[authKey].authority.payload);
    credentials = structuredClone(backing.local[authKey].credentials);
    const original = await target.call("SellerAgentsControlClient.captureBackupContext");
    blocker = target.request({
      type: "SA_STORE_SAVE", store: {
        marketplace: "ozon", name: "Synthetic independent ordinary save",
        credentials: { seller: { clientId: "200", apiKey: "synthetic-independent-save-key" }, performance: {} },
      },
    }, popup);
    blocker.catch(() => {});
    await held;
    watchPlan = true;
    let importSettled = false;
    importing = target.request({ type: "SA_BACKUP_IMPORT", backup, password, apply: true }, importPanel);
    importing.then(() => { importSettled = true; }, () => { importSettled = true; });
    await until(() => planRead, "ordinary import reached planning while prior write is pending");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(importSettled, false);
    if (transition === "cancel") {
      assert.equal((await target.request({ type: "SA_AUTH_CANCEL" }, popup)).ok, true);
    } else {
      const reset = await target.request({ type: "SA_AUTH_RESET" }, popup);
      assert.equal(reset.ok, true);
      assert.equal(reset.auth.authenticated, false);
      const activation = await target.request({ type: "SA_AUTH_START" }, popup);
      assert.equal(activation.ok, true);
      await until(async () => await target.call("SellerAgentsControlClient.currentAccount") === original.accountId,
        "ordinary signed fixture reactivation in the same account");
      assert.equal(backing.local[authKey].authority.verified, true);
    }
    assert.ok(await target.call("SellerAgentsControlClient.generation") > original.generation);
    assert.equal(await target.call("SellerAgentsControlClient.currentAccount"), original.accountId);
    releaseWrite();
    const saved = await blocker;
    assert.equal(saved.ok, true);
    const response = await importing;
    assert.equal(response.ok, false);
    assert.equal(response.code, "AUTH_GENERATION_CHANGED");
    assert.equal(attempts, 1, "the pending import must add no catalog write");
    const stores = backing.local[catalogKey].accounts[target.accountId].stores;
    assert.deepEqual(Object.keys(stores), [saved.store.id]);
    assertNoProviderCalls(target);
  } finally {
    releaseWrite();
    await Promise.allSettled([blocker, importing].filter(Boolean));
    target.close();
  }
}
await test("ordinary generation cancellation invalidates pending public import before write",
  () => queuedImportInvalidation("cancel"));
await test("ordinary reset and signed same-account reactivation invalidate pending public import",
  () => queuedImportInvalidation("reactivate"));

assert.equal(evidence.callbackConfigured, true);
assert.equal(evidence.legacyTwoArgumentImport, false);
evidence.candidateInvalidationRun = true;
console.log(JSON.stringify({
  status: "SOURCE_REGRESSION_PASS",
  checks,
  evidence,
  providerCalls: 0,
  remaining: ["Independent exact-candidate review, exact CI, permitted merge and postmerge readback"],
}));
