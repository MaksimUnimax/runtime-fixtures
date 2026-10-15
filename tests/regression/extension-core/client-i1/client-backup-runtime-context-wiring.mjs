import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

// Isolated public-worker baseline only. No queued stale import, reactivation
// reproduction, browser install, provider transport or product source patch.
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
    fetch: async () => { throw new Error("UNEXPECTED_SYNTHETIC_TRANSPORT"); },
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

console.log(JSON.stringify({
  status: "PREPARATION_BASELINE_PASS",
  checks,
  evidence,
  providerCalls: 0,
  remaining: [
    "Actual Tester addressed handoff for shared runtime/client source",
    "Immutable operation context and synchronous guard wiring repair",
    "Safe candidate context-invalidation regression after repair",
    "Independent exact-candidate review, exact CI, permitted merge and postmerge readback",
  ],
}));
