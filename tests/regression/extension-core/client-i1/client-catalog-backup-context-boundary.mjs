// Real catalog write queue, synthetic account/activation/storage only.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const base = new URL("../../../../", import.meta.url);
const read = path => fs.readFileSync(new URL(path, base), "utf8");
const KEY = "seller_agents_stores_v1";
const A = "synthetic-backup-account-A";
const B = "synthetic-backup-account-B";
const payload = {
  accountBinding: { accountId: A },
  stores: [{
    storeId: "synthetic-import-wb",
    marketplace: "wildberries",
    label: "Synthetic import",
    credentials: { type: "wildberries", token: "SYNTHETIC_WB_TOKEN_NOT_LIVE" },
    credentialRevision: "synthetic-import-revision",
    metadataRevision: 1,
    providerIdentityState: "UNCONFIRMED",
    providerAccountId: null,
  }],
};
const clone = structuredClone;
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function gate() {
  return { entered: deferred(), release: deferred() };
}
async function bounded(promise) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("SYNTHETIC_TEST_DEADLINE")), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function fixture(name, guardMode = "normal") {
  const realm = { structuredClone, crypto: webcrypto, TextEncoder, TextDecoder };
  vm.createContext(realm);
  vm.runInContext(read("packages/bridge-core/src/execution/local-operations.js"), realm);
  vm.runInContext(read("packages/bridge-core/src/stores/catalog.js"), realm);
  const originalCreateQueue = realm.SellerAgentsLocalOperations.createWriteQueue;
  let queueCount = 0, writes = 0, generation = 1, accountId = A, serial = 0;
  let data = { unrelated: { retained: "sentinel" } }, readGate = null, writeGate = null;
  const waiting = [];
  realm.SellerAgentsLocalOperations = Object.freeze({
    ...realm.SellerAgentsLocalOperations,
    createWriteQueue() {
      const actual = originalCreateQueue();
      return Object.freeze({
        run(fn) {
          queueCount++;
          for (const row of waiting) {
            if (queueCount >= row.count) row.signal.resolve();
          }
          return actual.run(fn);
        },
      });
    },
  });
  const invalid = code => Object.assign(new Error(code), { code });
  const assertContext = context => {
    if (context?.accountId !== accountId || context?.generation !== generation)
      throw invalid("AUTH_GENERATION_CHANGED");
    return true;
  };
  const ports = {
    currentAccount: async () => accountId,
    read: async () => {
      if (readGate) {
        const waiting = readGate; readGate = null;
        waiting.entered.resolve();
        await waiting.release.promise;
      }
      return clone(data);
    },
    write: async value => {
      writes++;
      if (writeGate) {
        const waiting = writeGate; writeGate = null;
        waiting.entered.resolve();
        await waiting.release.promise;
      }
      data = { ...data, ...clone(value) };
    },
    normalizeCredentials: (marketplace, input, previous) => {
      assert.equal(marketplace, "wildberries");
      return { token: input?.token || previous?.token || "" };
    },
    revision: async () => "revision-" + (++serial),
    uuid: () => name + "-store-" + (++serial),
    assertTransferContext: assertContext,
    ...(guardMode === "missing" ? {} : {
      assertBackupContext: guardMode === "async" ? async () => true : assertContext,
    }),
  };
  const catalog = realm.SellerAgentsStoreCatalog.create(ports);
  return {
    catalog,
    snapshot: () => clone(data),
    writes: () => writes,
    queueCount: () => queueCount,
    whenQueued(count) {
      if (queueCount >= count) return Promise.resolve();
      const signal = deferred();
      waiting.push({ count, signal });
      return signal.promise;
    },
    holdRead() { assert.equal(readGate, null); return readGate = gate(); },
    holdWrite() { assert.equal(writeGate, null); return writeGate = gate(); },
    transition(otherAccount = false) {
      generation++;
      if (otherAccount) accountId = B;
    },
    context: () => ({ accountId, generation }),
  };
}
let cases = 0;
async function check(name, run) {
  await run();
  cases++;
  console.log("PASS catalog backup guard " + name);
}
function storedImported(f) {
  return Boolean(f.snapshot()[KEY]?.accounts?.[A]?.stores?.[payload.stores[0].storeId]);
}
const rejectsCode = (fn, codes) => assert.rejects(fn, error => codes.includes(error?.code));

await check("valid unchanged generation imports once", async () => {
  const f = fixture("normal"), context = f.context(), plan = await f.catalog.planBackupImport(payload);
  assert.equal(plan.classifications[0].kind, "IMPORT_NEW");
  assert.equal((await f.catalog.applyBackupImport(payload, plan, context)).imported.length, 1);
  assert.equal(f.writes(), 1);
  assert.equal(storedImported(f), true);
  assert.equal(f.snapshot().unrelated.retained, "sentinel");
});
await check("legacy callers without optional context remain compatible", async () => {
  const f = fixture("legacy"), plan = await f.catalog.planBackupImport(payload);
  assert.equal((await f.catalog.applyBackupImport(payload, plan)).imported.length, 1);
});
for (const otherAccount of [false, true]) {
  await check("queued import rejects changed generation, otherAccount=" + otherAccount, async () => {
    const f = fixture("queued"), plan = await f.catalog.planBackupImport(payload);
    const context = f.context(), blocker = f.holdWrite();
    const earlier = f.catalog.save({
      marketplace: "wildberries", name: "Prior queued mutation",
      credentials: { token: "SYNTHETIC_PRIOR" },
    }).then(() => ({ ok: true }), error => ({ ok: false, code: error?.code }));
    await bounded(blocker.entered.promise);
    const next = f.queueCount() + 1;
    const pending = f.catalog.applyBackupImport(payload, plan, context);
    await bounded(f.whenQueued(next));
    f.transition(otherAccount);
    blocker.release.resolve();
    await bounded(earlier);
    await rejectsCode(() => bounded(pending), ["AUTH_GENERATION_CHANGED", "ACCOUNT_CHANGED"]);
    assert.equal(f.writes(), 1, "obsolete queued import must never invoke storage write");
    assert.equal(storedImported(f), false);
    assert.equal(f.snapshot().unrelated.retained, "sentinel");
  });
}
for (const otherAccount of [false, true]) {
  await check("catalog read barrier denies obsolete import, otherAccount=" + otherAccount, async () => {
    const f = fixture("read"), plan = await f.catalog.planBackupImport(payload);
    const context = f.context(), blocker = f.holdRead();
    const pending = f.catalog.applyBackupImport(payload, plan, context);
    await bounded(blocker.entered.promise);
    f.transition(otherAccount);
    blocker.release.resolve();
    await rejectsCode(() => bounded(pending), ["AUTH_GENERATION_CHANGED", "ACCOUNT_CHANGED"]);
    assert.equal(f.writes(), 0);
    assert.equal(storedImported(f), false);
  });
}
for (const otherAccount of [false, true]) {
  await check("already-in-flight write is not mislabeled success, otherAccount=" + otherAccount, async () => {
    const f = fixture("write"), plan = await f.catalog.planBackupImport(payload);
    const context = f.context(), blocker = f.holdWrite();
    const pending = f.catalog.applyBackupImport(payload, plan, context);
    await bounded(blocker.entered.promise);
    f.transition(otherAccount);
    blocker.release.resolve();
    await rejectsCode(() => bounded(pending), ["AUTH_GENERATION_CHANGED", "ACCOUNT_CHANGED"]);
    assert.equal(f.writes(), 1, "the already invoked write cannot be undone");
    assert.equal(storedImported(f), true, "do not pretend an already invoked write was cancelled");
  });
}
for (const mode of ["missing", "async"]) {
  await check("guard capability fails closed: " + mode, async () => {
    const f = fixture("deny-" + mode, mode), plan = await f.catalog.planBackupImport(payload);
    const before = f.snapshot();
    await rejectsCode(
      () => f.catalog.applyBackupImport(payload, plan, f.context()),
      [mode === "missing" ? "BACKUP_CONTEXT_GUARD_REQUIRED" : "BACKUP_CONTEXT_GUARD_INVALID"],
    );
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.snapshot(), before);
  });
}
for (const [name, invalidContext] of [
  ["false", false],
  ["null", null],
  ["undefined", undefined],
  ["empty_string", ""],
  ["empty_array", []],
]) {
  await check("explicit invalid context cannot bypass the guard: " + name, async () => {
    const f = fixture("invalid-" + name), plan = await f.catalog.planBackupImport(payload);
    const before = f.snapshot();
    await rejectsCode(
      () => f.catalog.applyBackupImport(payload, plan, invalidContext),
      ["BACKUP_CONTEXT_GUARD_INVALID", "AUTH_GENERATION_CHANGED"],
    );
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.snapshot(), before);
  });
}
console.log(JSON.stringify({
  status: "PASS", level: "EXACT_CATALOG_SOURCE_SYNTHETIC_NO_PROVIDER_NO_BROWSER",
  checks: cases, liveProviderCalls: 0,
}));
