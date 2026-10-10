import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const source = await fs.readFile(new URL("../../../../packages/bridge-core/src/execution/local-operations.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(overrides = {}) {
  const sandbox = {}; vm.runInNewContext(source, sandbox, { filename: "local-operations.js" });
  let disk = {}, reads = 0, writes = 0;
  const events = [], failures = [];
  const read = async namespace => {
    reads++; events.push("read");
    if (overrides.read) return overrides.read({ namespace, disk: structuredClone(disk), reads });
    return structuredClone(disk);
  };
  const write = async value => {
    writes++; events.push("write");
    if (overrides.write) return overrides.write({ value, save: () => { disk = structuredClone(value); }, writes });
    disk = structuredClone(value);
  };
  const api = sandbox.SellerAgentsLocalOperations;
  const store = api.createRecordStore({ read, write, namespace: "manual", writerKey: "manual",
    now: () => "2026-10-10T00:00:00.000Z", onCommitFailure: error => failures.push(error.code) });
  return { api, store, read, write, events, failures,
    disk: () => structuredClone(disk), counts: () => ({ reads, writes }) };
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log("PASS " + name); }
await test("PAR-05/source writer: no dispatch permission before exact readback, including interleaved dialogues", async () => {
  const gate = deferred(); let blocked = false, calls = 0, secondEntered = false;
  const f = fixture({ read: async ({ disk, reads }) => { if (reads === 2) { blocked = true; await gate.promise; } return disk; } });
  const first = f.store.mutate("C1", () => ({ executionId: "E1", stage: "RESERVED" })).then(() => { calls++; });
  const second = f.store.mutate("C2", () => { secondEntered = true; return { executionId: "E2", stage: "RESERVED" }; });
  await flush();
  assert.equal(blocked, true); assert.equal(calls, 0); assert.equal(secondEntered, false);
  gate.resolve(); await first; await second;
  assert.equal(calls, 1);
  assert.equal(f.disk().manual.C1.executionId, "E1");
  assert.equal(f.disk().manual.C2.executionId, "E2");
  assert.deepEqual(f.events, ["read", "write", "read", "read", "write", "read"]);
});
await test("PAR-05/source writer: acknowledged-but-dropped write fails closed and cannot dispatch", async () => {
  let effects = 0;
  const f = fixture({ write: async () => {} });
  await assert.rejects(f.store.mutate("C1", () => ({ executionId: "E1" })).then(() => { effects++; }),
    error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED" && error.stage === "readback");
  await assert.rejects(f.store.get("C1"), error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED");
  await assert.rejects(f.store.withWrite(() => { effects++; }), error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED");
  await flush();
  assert.equal(effects, 0); assert.equal(f.counts().writes, 1);
  assert.deepEqual(f.failures, ["RECORD_STORE_COMMIT_UNCONFIRMED"]);
});
await test("PAR-05/source writer: failed write does not silently reopen the queue for the next dialogue", async () => {
  const f = fixture({ write: async () => { throw new Error("simulated storage failure"); } });
  await assert.rejects(f.store.mutate("C1", () => ({ executionId: "E1" })),
    error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED" && error.stage === "write");
  await assert.rejects(f.store.mutate("C2", () => ({ executionId: "E2" })),
    error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED");
  assert.equal(f.counts().writes, 1);
});
await test("PAR-05/source writer: readback rejection retains the written receipt but returns no permit", async () => {
  const f = fixture({ read: async ({ disk, reads }) => { if (reads === 2) throw new Error("read failed"); return disk; } });
  await assert.rejects(f.store.mutate("C1", () => ({ executionId: "E1", stage: "API_INTENT", originalExpiresAt: 99 })),
    error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED");
  assert.equal(f.disk().manual.C1.executionId, "E1");
  assert.equal(f.disk().manual.C1.stage, "API_INTENT");
  assert.equal(f.disk().manual.C1.originalExpiresAt, 99);
});
await test("PAR-05/source writer: second writer for same namespace is rejected in one worker", async () => {
  const f = fixture();
  assert.throws(() => f.api.createRecordStore({ read: f.read, write: f.write, namespace: "manual", writerKey: "manual" }),
    error => error.code === "RECORD_STORE_WRITER_ALREADY_REGISTERED");
});
await test("PAR-05/source writer: obsolete command validation does not poison unrelated dialogue", async () => {
  const f = fixture();
  await assert.rejects(f.store.mutate("C1", () => { throw Object.assign(new Error("stale context"), { code: "STALE" }); }),
    error => error.code === "STALE");
  await f.store.mutate("C2", () => ({ executionId: "E2" }));
  assert.equal(f.disk().manual.C1, undefined);
  assert.equal(f.disk().manual.C2.executionId, "E2");
  assert.deepEqual(f.failures, []);
});
await test("PAR-05/source writer: object-key order is irrelevant but changed immutable context is rejected", async () => {
  const good = fixture({ read: async ({ disk, reads }) => {
    if (reads === 2) {
      const old = disk.manual.C1;
      disk.manual.C1 = { updated_at: old.updated_at, generation: old.generation, executionId: old.executionId };
    }
    return disk;
  } });
  await good.store.mutate("C1", () => ({ executionId: "E1", generation: 4 }));
  const bad = fixture({ read: async ({ disk, reads }) => { if (reads === 2) disk.manual.C1.generation = 5; return disk; } });
  await assert.rejects(bad.store.mutate("C1", () => ({ executionId: "E1", generation: 4 })),
    error => error.code === "RECORD_STORE_COMMIT_UNCONFIRMED");
});
console.log("SOURCE record writer: " + count + " scenarios passed; assembled single-writer and physical durability remain separate gates.");

import { createHash } from "node:crypto";
const ledgerSource = await fs.readFile(new URL("../../../../packages/bridge-core/src/execution/command-ledger.js", import.meta.url), "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
const canonicalJson = value => JSON.stringify(value, (key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
function ledgerFixture() {
  let disk = {}, id = 0, time = 1000, allowed = true;
  const buffers = new Map();
  const context = { accountId: "U", principalEpoch: 1, accessEpoch: 1, grantEpoch: 1, scopeKey: "G",
    bindingRevision: 1, workGeneration: 1, workSessionId: "W", conversationBindingId: "B" };
  const item = ordinal => ({ ordinal, inputHash: digest("input-" + ordinal), operation: "read" });
  const input = { conversationKey: "C1", context, blockOriginKey: digest("origin"), blockVersion: digest("block"), items: [item(0), item(1)] };
  function restart() {
    const realm = {}; vm.createContext(realm); vm.runInContext(source, realm); vm.runInContext(ledgerSource, realm);
    const store = realm.SellerAgentsLocalOperations.createRecordStore({
      namespace: "manual", writerKey: "manual", read: async () => structuredClone(disk),
      write: async value => { disk = structuredClone(value); }, now: () => new Date(time).toISOString(),
    });
    return realm.SellerAgentsCommandLedger.createCommandLedger({ store, canonicalJson, sha256: async value => digest(value),
      makeId: () => "id-" + (++id), now: () => time,
      assertContext: candidate => allowed && canonicalJson(candidate) === canonicalJson(context),
      classifyReadOnly: candidate => candidate.operation === "read",
      readBuffer: async executionId => buffers.get(executionId),
    });
  }
  const api = restart();
  return { api, restart, input, context, item, read: () => structuredClone(disk),
    setTime(value) { time = value; }, deny() { allowed = false; }, allow() { allowed = true; },
    buffer(executionId, value) { buffers.set(executionId, structuredClone(value)); }, buffers };
}
async function unknownCommand(f) {
  const reserved = await f.api.reserveCommand(f.input);
  const intent = await f.api.beginProviderAttempt({ ...f.input, executionId: reserved.executionId, ordinal: 0 });
  await f.api.recordProviderOutcome({ ...f.input, executionId: reserved.executionId, ordinal: 0,
    providerAttemptId: intent.providerAttemptId, outcome: "UNKNOWN" });
  return reserved.executionId;
}
async function retryPreview(f, executionId) {
  const args = { ...f.input, executionId, selection: [f.item(0)], parserContract: "parser-v1", credentialRevision: "credential-1" };
  const preview = await f.api.previewRetry(args);
  return { args, preview, confirm: { ...args, confirmationId: preview.confirmationId, confirmed: true } };
}
async function buffered(f) {
  const reserved = await f.api.reserveCommand(f.input);
  const intent = await f.api.beginProviderAttempt({ ...f.input, executionId: reserved.executionId, ordinal: 0 });
  const buffer = { payload: "exact retained report", digest: digest("exact retained report"), expiresAt: 3601000, context: f.context };
  f.buffer(reserved.executionId, buffer);
  await f.api.recordProviderOutcome({ ...f.input, executionId: reserved.executionId, ordinal: 0,
    providerAttemptId: intent.providerAttemptId, outcome: "RESULT", bufferDigest: buffer.digest });
  return reserved.executionId;
}
await test("PAR-05/source ledger: two clicks reserve one execution and one provider intent", async () => {
  const f = ledgerFixture(), both = await Promise.all([f.api.reserveCommand(f.input), f.api.reserveCommand(f.input)]);
  assert.equal(both[0].executionId, both[1].executionId); assert.equal(both.filter(r => !r.duplicate).length, 1);
  const attempts = await Promise.all(both.map(r => f.api.beginProviderAttempt({ ...f.input, executionId: r.executionId, ordinal: 0 })));
  assert.equal(attempts.filter(r => r.dispatch).length, 1);
});
await test("PAR-32/source ledger: UNKNOWN click and reload retain old attempt and changed hash cannot bypass", async () => {
  const f = ledgerFixture(), executionId = await unknownCommand(f);
  const click = await f.api.reserveCommand(f.input);
  assert.equal(click.executionId, executionId); assert.equal(click.dispatch, false); assert.equal(click.unknown, true);
  const restarted = f.restart();
  assert.equal((await restarted.beginProviderAttempt({ ...f.input, executionId, ordinal: 0 })).dispatch, false);
  await assert.rejects(restarted.reserveCommand({ ...f.input, blockVersion: digest("edited block") }),
    { code: "COMMAND_OUTCOME_UNKNOWN_EXPLICIT_RETRY_REQUIRED" });
});
await test("PAR-33/source ledger: separate confirmation runs only selected read-only item and preserves predecessor", async () => {
  const f = ledgerFixture(), oldId = await unknownCommand(f), p = await retryPreview(f, oldId);
  assert.equal(p.preview.warning, "Предыдущий запрос мог выполниться. Новый запуск может повторить действие и расход квоты");
  await assert.rejects(f.api.confirmRetry({ ...p.confirm, confirmed: false }), { code: "RETRY_EXPLICIT_CONFIRMATION_REQUIRED" });
  const next = await f.api.confirmRetry(p.confirm), data = f.read().manual.C1.r3_commands;
  assert.notEqual(next.executionId, oldId); assert.equal(next.approvalRevision, 1); assert.equal(next.predecessor, oldId);
  assert.equal(data.receipts[oldId].items[0].state, "UNKNOWN");
  assert.equal(data.receipts[oldId].payloadExpiresAt, 3601000);
  assert.equal(data.receipts[next.executionId].items.length, 1);
  await assert.rejects(f.api.beginProviderAttempt({ ...f.input, executionId: next.executionId, ordinal: 1 }), { code: "COMMAND_ITEM_MISSING" });
});
await test("PAR-34/source ledger: write, unknown capability and mixed forged selections all fail closed", async () => {
  const f = ledgerFixture(), oldId = await unknownCommand(f);
  for (const operation of ["write", "unsupported", null]) {
    await assert.rejects(f.api.previewRetry({ ...f.input, executionId: oldId, selection: [f.item(0), { ...f.item(1), operation }],
      parserContract: "parser-v1", credentialRevision: "credential-1" }), { code: "RETRY_READ_ONLY_REQUIRED" });
  }
  const p = await retryPreview(f, oldId);
  await assert.rejects(f.api.confirmRetry({ ...p.confirm, credentialRevision: "credential-2" }), { code: "RETRY_PREVIEW_CHANGED" });
  await assert.rejects(f.api.confirmRetry({ ...p.confirm, blockVersion: digest("edited") }), { code: "RETRY_PREVIEW_CHANGED" });
});
await test("PAR-35/source ledger: duplicate confirmation yields one new execution and competing preview is stale", async () => {
  const f = ledgerFixture(), oldId = await unknownCommand(f), one = await retryPreview(f, oldId), two = await retryPreview(f, oldId);
  const answers = await Promise.all([f.api.confirmRetry(one.confirm), f.api.confirmRetry(one.confirm)]);
  assert.equal(answers[0].executionId, answers[1].executionId); assert.equal(answers.filter(r => !r.duplicate).length, 1);
  await assert.rejects(f.api.confirmRetry(two.confirm), { code: "RETRY_APPROVAL_STALE" });
  const restarted = f.restart(), executionId = answers[0].executionId;
  assert.equal((await restarted.beginProviderAttempt({ ...f.input, executionId, ordinal: 0 })).dispatch, true);
  assert.equal((await f.restart().beginProviderAttempt({ ...f.input, executionId, ordinal: 0 })).dispatch, false);
});
await test("PAR-36/source ledger: copy uses exact unexpired buffer and creates one delivery without provider intent", async () => {
  const f = ledgerFixture(), executionId = await buffered(f);
  const before = f.read().manual.C1.r3_commands.receipts[executionId].items;
  const preview = await f.api.previewCopy({ ...f.input, executionId });
  await assert.rejects(f.api.confirmCopy({ ...f.input, confirmationId: preview.confirmationId, confirmed: false }),
    { code: "COPY_EXPLICIT_CONFIRMATION_REQUIRED" });
  const reserved = await f.api.confirmCopy({ ...f.input, confirmationId: preview.confirmationId, confirmed: true });
  const send = await f.api.beginCopyDelivery({ ...f.input, deliveryId: reserved.deliveryId });
  assert.equal(send.send, true); assert.equal(send.expiresAt, 3601000);
  assert.deepEqual(f.read().manual.C1.r3_commands.receipts[executionId].items, before);
});
await test("PAR-37/source ledger: expired missing corrupt or mismatched buffer prevents copy", async () => {
  for (const mode of ["expired", "missing", "corrupt", "identity"]) {
    const f = ledgerFixture(), executionId = await buffered(f), saved = f.buffers.get(executionId);
    if (mode === "expired") f.setTime(saved.expiresAt);
    if (mode === "missing") f.buffers.delete(executionId);
    if (mode === "corrupt") f.buffer(executionId, { ...saved, payload: "changed" });
    if (mode === "identity") f.buffer(executionId, { ...saved, context: { ...f.context, workGeneration: 2 } });
    await assert.rejects(f.api.previewCopy({ ...f.input, executionId }), { code: "COPY_BUFFER_UNAVAILABLE" });
  }
});
await test("PAR-37/source ledger: Finish rebind logout deny and identity fence changes invalidate existing confirmation", async () => {
  for (const field of ["workGeneration", "bindingRevision", "principalEpoch", "accessEpoch", "grantEpoch"]) {
    const f = ledgerFixture(), executionId = await buffered(f), preview = await f.api.previewCopy({ ...f.input, executionId });
    f.context[field]++;
    await assert.rejects(f.api.confirmCopy({ ...f.input, confirmationId: preview.confirmationId, confirmed: true }),
      { code: "COPY_BUFFER_UNAVAILABLE" });
  }
  const f = ledgerFixture(), executionId = await buffered(f), preview = await f.api.previewCopy({ ...f.input, executionId });
  f.deny();
  await assert.rejects(f.api.confirmCopy({ ...f.input, confirmationId: preview.confirmationId, confirmed: true }),
    { code: "EXECUTION_CONTEXT_CHANGED" });
});
await test("PAR-38/source ledger: duplicate copy click and crash after intent never grant a second send", async () => {
  const f = ledgerFixture(), executionId = await buffered(f), preview = await f.api.previewCopy({ ...f.input, executionId });
  const confirmation = { ...f.input, confirmationId: preview.confirmationId, confirmed: true };
  const copies = await Promise.all([f.api.confirmCopy(confirmation), f.api.confirmCopy(confirmation)]);
  assert.equal(copies[0].deliveryId, copies[1].deliveryId);
  const deliveryId = copies[0].deliveryId;
  assert.equal((await f.restart().beginCopyDelivery({ ...f.input, deliveryId })).send, true);
  assert.equal((await f.restart().beginCopyDelivery({ ...f.input, deliveryId })).send, false);
  await f.api.recordCopyOutcome({ ...f.input, deliveryId, outcome: "UNKNOWN" });
  assert.equal(f.read().manual.C1.r3_commands.deliveries[deliveryId].state, "UNKNOWN");
});
await test("PAR-38/source ledger: second copy preview becomes stale after first reserve", async () => {
  const f = ledgerFixture(), executionId = await buffered(f);
  const one = await f.api.previewCopy({ ...f.input, executionId }), two = await f.api.previewCopy({ ...f.input, executionId });
  await f.api.confirmCopy({ ...f.input, confirmationId: one.confirmationId, confirmed: true });
  await assert.rejects(f.api.confirmCopy({ ...f.input, confirmationId: two.confirmationId, confirmed: true }),
    { code: "COPY_CONFIRMATION_STALE" });
});
await test("PAR-05/source writer: malformed readback closes writer rather than leaking a raw TypeError", async () => {
  const f = fixture({ read: ({ disk, reads }) => reads === 1 ? disk : null });
  await assert.rejects(f.store.mutate("C1", () => ({ stage: "INTENT" })), { code: "RECORD_STORE_COMMIT_UNCONFIRMED" });
  await assert.rejects(f.store.get("C1"), { code: "RECORD_STORE_COMMIT_UNCONFIRMED" });
});
await test("PAR-33/source changed parameters require a fresh review and preserve old UNKNOWN context and TTL", async () => {
  const f = ledgerFixture(), oldId = await unknownCommand(f), old = f.read().manual.C1.r3_commands.receipts[oldId];
  f.context.commandHash = "new-command"; f.context.requestId = "new-request"; f.context.grantEpoch++;
  const args = { ...f.input, executionId: oldId, blockVersion: digest("changed-block"),
    selection: [{ ...f.item(0), inputHash: digest("changed-input") }], parserContract: "parser-v2", credentialRevision: "credential-2" };
  const preview = await f.api.previewRetry(args);
  await assert.rejects(f.api.confirmRetry({ ...args, confirmationId: preview.confirmationId, confirmed: true,
    blockVersion: digest("changed-after-preview") }), { code: "RETRY_PREVIEW_CHANGED" });
  const next = await f.api.confirmRetry({ ...args, confirmationId: preview.confirmationId, confirmed: true });
  assert.equal(next.approvalRevision, 1); assert.notEqual(next.executionId, oldId);
  assert.deepEqual(f.read().manual.C1.r3_commands.receipts[oldId], old);
  assert.equal(f.read().manual.C1.r3_commands.receipts[next.executionId].items.length, 1);
  assert.equal(f.read().manual.C1.r3_commands.receipts[next.executionId].context.grantEpoch, 2);
});
await test("PAR-34/source a fresh review cannot rebind an UNKNOWN receipt to another Work", async () => {
  const f = ledgerFixture(), oldId = await unknownCommand(f); f.context.workSessionId = "another-work";
  await assert.rejects(retryPreview(f, oldId), { code: "COMMAND_CONTEXT_MISMATCH" });
});
console.log("SOURCE writer/receipt suite: " + count + " scenarios passed; integration, PACKAGE and INSTALLED remain NOT_RUN.");
