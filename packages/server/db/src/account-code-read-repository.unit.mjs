// Public synthetic fixtures only. No DB, server, key, session or network access.
import assert from "node:assert/strict";
import test from "node:test";
import { consumeAcw1HttpMetadataResponse } from "@product/contracts/account-code-http-response";

const A = "11112233-4455-4677-8899-aabbccddeeff";
const B = "22112233-4455-4677-8899-aabbccddeeff";
const O = "77112233-4455-4677-8899-aabbccddeeff";
const O2 = "66112233-4455-4677-8899-aabbccddeeff";
const MARK = "__PUBLIC_READ_MODEL_MARKER__";
const absent = () => ({ accountId: A, state: "ABSENT", codeRevision: 0, createdAt: null });
const active = () => ({ accountId: A, state: "ACTIVE", codeRevision: 2, createdAt: 2000 });
const applied = () => ({ accountId: A, operationId: O,
  outcome: "APPLIED_SECRET_NOT_REPLAYABLE", codeRevision: 1, createdAt: 1000 });
const expired = () => ({ accountId: A, operationId: O, outcome: "UNKNOWN_EXPIRED" });
const snap = (metadata = active(), receipt = applied()) => ({ accountId: A, metadata, receipt });
let module;
try { module = await import("@product/db/account-code-read-repository"); }
catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
}
const cases = [];
const check = (name, fn) => cases.push([name, fn]);
function repository(value, inspect = () => {}) {
  let reads = 0;
  return {
    repo: module.createAccountCodeReadRepository({ async readSnapshot(query) {
      reads++; inspect(query); return typeof value === "function" ? await value() : value;
    } }),
    reads: () => reads,
  };
}
function common(result) {
  assert.equal(result.verification, "UNVERIFIED");
  assert.equal(result.executionOutcome, "UNKNOWN");
  assert.equal(result.requiredResponseMetadata.headers["cache-control"], "no-store");
  assert.equal(result.cacheEnforcement, "NOT_CHECKED");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result.safeLog).includes(MARK), false);
}
function unknown(result, reason) {
  common(result); assert.equal(result.kind, "UNKNOWN");
  assert.equal(result.reason, reason); assert.equal("data" in result, false);
  assert.equal("metadata" in result, false);
}

check("explicit ABSENT metadata; not a standalone wire response", async () => {
  const { repo, reads } = repository(snap(absent(), null), q => {
    assert.deepEqual(q, { accountId: A, operationId: null }); assert(Object.isFrozen(q));
  });
  const r = await repo.readMetadata(A); common(r);
  assert.equal(r.kind, "METADATA_DATA"); assert.deepEqual(r.metadata, absent());
  assert.equal("profile" in r, false); assert.equal("writePermit" in r, false); assert.equal(reads(), 1);
});
check("ACTIVE metadata does not admit use or issue a permit", async () => {
  const r = await repository(snap(active(), null)).repo.readMetadata(A); common(r);
  assert.deepEqual(r.metadata, active()); assert(Object.isFrozen(r.metadata));
  assert.equal("writePermit" in r, false);
});
check("applied lookup preserves original receipt after later rotation", async () => {
  const { repo, reads } = repository(snap(), q => assert.deepEqual(q, { accountId: A, operationId: O }));
  const r = await repo.lookup(A, O); common(r); assert.equal(r.kind, "LOOKUP_DATA");
  assert.deepEqual(r.data, { profile: "ACW1", metadata: active(), receipt: {
    operationId: O, outcome: "APPLIED_SECRET_NOT_REPLAYABLE", codeRevision: 1, createdAt: 1000,
  } });
  assert.equal(reads(), 1);
  const parsed = consumeAcw1HttpMetadataResponse("lookup", 200, JSON.stringify(r.data), { accountId: A, operationId: O });
  assert.equal(parsed.kind, "ACW1_METADATA_DATA"); assert.deepEqual(parsed.data, r.data);
});
for (const metadata of [absent(), active()]) check(`missing receipt with ${metadata.state} remains UNKNOWN`, async () => {
  const r = await repository(snap(metadata, null)).repo.lookup(A, O); common(r);
  assert.equal(r.kind, "LOOKUP_DATA"); assert.deepEqual(r.data.receipt, { operationId: O, outcome: "UNKNOWN" });
});
check("only explicit scoped expired record yields UNKNOWN_EXPIRED", async () => {
  const r = await repository(snap(active(), expired())).repo.lookup(A, O); common(r);
  assert.deepEqual(r.data.receipt, { operationId: O, outcome: "UNKNOWN_EXPIRED" });
});
check("missing snapshot is unavailable, never ABSENT or a receipt", async () => {
  const { repo } = repository(null);
  unknown(await repo.readMetadata(A), "SNAPSHOT_UNAVAILABLE");
  unknown(await repo.lookup(A, O), "SNAPSHOT_UNAVAILABLE");
});
check("missing metadata remains unavailable despite applied receipt", async () => {
  unknown(await repository(snap(null)).repo.lookup(A, O), "SNAPSHOT_UNAVAILABLE");
});
check("store failure is fixed UNKNOWN; no exception reflection or retry", async () => {
  const { repo, reads } = repository(() => { throw Error(MARK); });
  const r = await repo.lookup(A, O); unknown(r, "READ_UNAVAILABLE");
  assert(!JSON.stringify(r).includes(MARK)); assert.equal(reads(), 1);
});

for (const [name, account] of [ ["upper", A.toUpperCase()], ["suffix", A + "\n"], ["v1", A.replace("4677", "1677")],
  ["null", null], ["object", { toString() { throw Error(MARK); } }] ]) {
  check(`invalid account ${name} never queries store`, async () => {
    const { repo, reads } = repository(snap()); unknown(await repo.lookup(account, O), "INVALID_QUERY");
    unknown(await repo.readMetadata(account), "INVALID_QUERY"); assert.equal(reads(), 0);
  });
}
for (const op of [null, undefined, O.toUpperCase(), O + "\n", 0]) check(`invalid operation ${String(op)} never queries`, async () => {
  const { repo, reads } = repository(snap()); unknown(await repo.lookup(A, op), "INVALID_QUERY"); assert.equal(reads(), 0);
});

const invalid = [
  ["snapshot account", () => ({ ...snap(), accountId: B })],
  ["metadata account", () => snap({ ...active(), accountId: B })],
  ["receipt account", () => snap(active(), { ...applied(), accountId: B })],
  ["receipt operation", () => snap(active(), { ...applied(), operationId: O2 })],
  ["expired operation", () => snap(active(), { ...expired(), operationId: O2 })],
  ["snapshot missing receipt", () => { const s = snap(); delete s.receipt; return s; }],
  ["snapshot undefined", () => undefined],
  ["metadata undefined", () => snap(undefined)],
  ["metadata ACTIVE zero revision", () => snap({ ...active(), codeRevision: 0 })],
  ["metadata ABSENT positive revision", () => snap({ ...absent(), codeRevision: 1 })],
  ["metadata ABSENT time", () => snap({ ...absent(), createdAt: 0 })],
  ["metadata state UNKNOWN", () => snap({ ...active(), state: "UNKNOWN" })],
  ["metadata float revision", () => snap({ ...active(), codeRevision: 1.5 })],
  ["metadata unsafe revision", () => snap({ ...active(), codeRevision: 9007199254740992 })],
  ["metadata negative zero", () => snap({ ...absent(), codeRevision: -0 })],
  ["metadata Date", () => snap({ ...active(), createdAt: new Date(1000) })],
  ["metadata infinite time", () => snap({ ...active(), createdAt: Infinity })],
  ["receipt negative zero", () => snap(active(), { ...applied(), createdAt: -0 })],
  ["receipt null time", () => snap(active(), { ...applied(), createdAt: null })],
  ["receipt zero revision", () => snap(active(), { ...applied(), codeRevision: 0 })],
  ["receipt string revision", () => snap(active(), { ...applied(), codeRevision: "1" })],
  ["receipt invented outcome", () => snap(active(), { accountId: A, operationId: O, outcome: "NOT_APPLIED" })],
  ["unknown stored receipt is not expired", () => snap(active(), { accountId: A, operationId: O, outcome: "UNKNOWN" })],
  ["extra metadata detail", () => snap({ ...active(), debug: MARK })],
  ["extra receipt secret", () => snap(active(), { ...applied(), accountCode: MARK })],
  ["expired receipt extra time", () => snap(active(), { ...expired(), createdAt: 1000 })],
  ["extra snapshot secret", () => ({ ...snap(), ticket: MARK })],
  ["metadata missing field", () => { const m = active(); delete m.createdAt; return snap(m); }],
];
// Default arguments would replace undefined; use an explicit own value here.
invalid.find(x => x[0] === "metadata undefined")[1] = () => ({ ...snap(), metadata: undefined });
for (const [name, value] of invalid) check(`invalid snapshot: ${name}`, async () => {
  const r = await repository(value()).repo.lookup(A, O); unknown(r, "INVALID_SNAPSHOT");
  assert(!JSON.stringify(r).includes(MARK));
});
for (const field of ["accountId", "metadata", "receipt"]) check(`snapshot accessor ${field} not invoked`, async () => {
  let calls = 0; const s = snap(); Object.defineProperty(s, field, { enumerable: true, get() { calls++; throw Error(MARK); } });
  unknown(await repository(s).repo.lookup(A, O), "INVALID_SNAPSHOT"); assert.equal(calls, 0);
});
check("nested metadata and receipt getters not invoked", async () => {
  let calls = 0;
  for (const target of ["metadata", "receipt"]) {
    const s = snap(); Object.defineProperty(s[target], "accountId", { enumerable: true, get() { calls++; throw Error(MARK); } });
    unknown(await repository(s).repo.lookup(A, O), "INVALID_SNAPSHOT");
  } assert.equal(calls, 0);
});
for (const decorate of [s => { s[Symbol("secret")] = MARK; },
  s => Object.defineProperty(s, "hidden", { value: MARK }), s => Object.setPrototypeOf(s, { inherited: MARK })]) {
  check("non-data/plain snapshot domain rejected", async () => {
    const s = snap(); decorate(s); unknown(await repository(s).repo.lookup(A, O), "INVALID_SNAPSHOT");
  });
}
check("frozen scoped query cannot be retargeted during awaited read", async () => {
  let resolve; let query;
  const { repo } = repository(() => new Promise(r => { resolve = r; }), q => { query = q; });
  const pending = repo.lookup(A, O);
  assert.throws(() => { query.accountId = B; }, TypeError);
  assert.throws(() => { query.operationId = O2; }, TypeError);
  resolve(snap()); const r = await pending; assert.equal(r.data.metadata.accountId, A); assert.equal(r.data.receipt.operationId, O);
});
check("detached frozen output survives later store record mutation", async () => {
  const s = snap(); const r = await repository(s).repo.lookup(A, O);
  s.metadata.codeRevision = 99; s.receipt.codeRevision = 99;
  assert.equal(r.data.metadata.codeRevision, 2); assert.equal(r.data.receipt.codeRevision, 1);
  for (const part of [r.data, r.data.metadata, r.data.receipt, r.safeLog]) assert(Object.isFrozen(part));
});
check("metadata read cannot silently consume unrelated receipt", async () => {
  unknown(await repository(snap()).repo.readMetadata(A), "INVALID_SNAPSHOT");
});
check("maximum safe revision/time preserved without narrowing", async () => {
  const metadata = { ...active(), codeRevision: Number.MAX_SAFE_INTEGER, createdAt: Number.MAX_SAFE_INTEGER };
  const r = await repository(snap(metadata, null)).repo.readMetadata(A); assert.deepEqual(r.metadata, metadata);
});
check("literal fake-store result reaches accepted consumer; no write/network/hash/log", async () => {
  const originals = { fetch: globalThis.fetch, log: console.log, error: console.error, digest: crypto.subtle.digest };
  let effects = 0; const fail = () => { effects++; throw Error(MARK); };
  try {
    globalThis.fetch = fail; console.log = fail; console.error = fail; crypto.subtle.digest = fail;
    const { repo, reads } = repository(snap());
    const r = await repo.lookup(A, O); assert.equal(r.kind, "LOOKUP_DATA"); assert.equal(reads(), 1); assert.equal(effects, 0);
    assert.deepEqual(Object.keys(r.safeLog).sort(), ["executionOutcome", "kind"]);
    assert.equal(Object.keys(repo).some(k => /write|issue|rotate|permit|save|ack/i.test(k)), false);
  } finally { Object.assign(globalThis, { fetch: originals.fetch }); console.log = originals.log; console.error = originals.error; crypto.subtle.digest = originals.digest; }
});

test("read repository export is implemented", () => assert.equal(typeof module?.createAccountCodeReadRepository, "function"));
for (const [name, fn] of cases) test(name, { skip: !module }, fn);
