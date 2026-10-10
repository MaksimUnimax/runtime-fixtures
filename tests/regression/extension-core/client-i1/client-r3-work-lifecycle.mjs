import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const source = await fs.readFile(new URL("../../../../packages/bridge-core/src/work/session-model.js", import.meta.url), "utf8");
const realm = {};
vm.runInNewContext(source, realm, { filename: "session-model.js" });
const model = realm.SellerAgentsWorkSessionModel;
const { normalize, transition, canResume } = model;
let count = 0;
function test(name, fn) { fn(); count++; console.log("PASS PAR-09/10/11/source lifecycle: " + name); }
function start(id = "start-1", previous = normalize(null, "conversation-A")) {
  return transition(transition(previous, "binding", { start_intent_id: id }), "active_visible");
}
test("Hide/Show preserves Work identity and generation", () => {
  const active = start(), hidden = transition(active, "active_hidden"), visible = transition(hidden, "active_visible");
  assert.equal(hidden.work_session_id, active.work_session_id);
  assert.equal(hidden.work_generation, active.work_generation);
  assert.equal(visible.work_generation, active.work_generation);
  assert.equal(visible.finished, false);
});
test("Finish is terminal at finishing commit before asynchronous effects", () => {
  const active = start(), finishing = transition(active, "finishing");
  assert.equal(finishing.finished, true);
  assert.equal(finishing.work_generation, active.work_generation + 1);
  const afterRestart = normalize(JSON.parse(JSON.stringify(finishing)), "conversation-A");
  assert.equal(canResume(afterRestart), false);
  assert.throws(() => transition(afterRestart, "active_visible"), /Illegal work-session transition/);
});
test("inactive Finish retains terminal identity and rejects Resume", () => {
  const active = start(), finished = transition(transition(active, "finishing"), "inactive", { start_intent_id: null });
  assert.equal(canResume(finished), false);
  assert.equal(finished.work_session_id, active.work_session_id);
  assert.throws(() => transition(finished, "binding", { start_intent_id: null }), { code: "WORK_SESSION_FINISHED" });
});
test("generic patch cannot erase terminal marker or rewrite generation", () => {
  const finished = transition(transition(start(), "finishing"), "inactive");
  const patched = transition(finished, "inactive", { finished: false, work_generation: 0, work_session_id: "forged" });
  assert.equal(patched.finished, true);
  assert.equal(patched.work_generation, finished.work_generation);
  assert.equal(patched.work_session_id, finished.work_session_id);
});
test("new Start creates new Work while reused prior intent cannot revive it", () => {
  const finished = transition(transition(start(), "finishing"), "inactive");
  assert.throws(() => start("start-1", finished), { code: "WORK_SESSION_FINISHED" });
  const next = start("start-2", finished);
  assert.equal(next.finished, false);
  assert.equal(next.work_session_id, "start-2");
  assert.equal(next.work_generation, finished.work_generation + 1);
});
test("finishing one dialogue leaves another unchanged", () => {
  const first = start(), other = start("B", normalize(null, "conversation-B"));
  const before = JSON.stringify(other);
  transition(first, "finishing");
  assert.equal(JSON.stringify(other), before);
  assert.equal(other.state, "active_visible");
});
test("proven unfinished paused Work can Resume without changing its identity", () => {
  const active = start(), paused = transition(transition(active, "error"), "inactive");
  assert.equal(canResume(paused), true);
  const resumed = transition(transition(paused, "binding", { start_intent_id: null }), "active_visible");
  assert.equal(resumed.work_session_id, active.work_session_id);
  assert.equal(resumed.start_intent_id, active.start_intent_id);
  assert.equal(resumed.work_generation, active.work_generation);
});
test("legacy inactive without evidence cannot Resume but explicit Start remains available", () => {
  const legacy = normalize({ state: "inactive", revision: 8 }, "conversation-A");
  assert.equal(canResume(legacy), false);
  const ambiguous = normalize({ state: "inactive", start_intent_id: "legacy-maybe-finished", revision: 8 }, "conversation-A");
  assert.equal(canResume(ambiguous), false);
  assert.equal(canResume(normalize(ambiguous, "conversation-A")), false);
  assert.equal(transition(ambiguous, "inactive", { terminal_state_known: true }).terminal_state_known, false);
  assert.equal(start("new-after-legacy", ambiguous).terminal_state_known, true);
  assert.equal(start("new", legacy).state, "active_visible");
});
test("recovery and visibility transitions preserve unfinished Work generation", () => {
  const active = start(), recovered = transition(transition(active, "recovering"), "active_hidden");
  assert.equal(recovered.work_generation, active.work_generation);
  assert.equal(recovered.work_session_id, active.work_session_id);
});
test("generation overflow never wraps old commands into current Work", () => {
  const record = normalize({ ...start(), work_generation: Number.MAX_SAFE_INTEGER }, "conversation-A");
  assert.throws(() => transition(record, "finishing"), { code: "WORK_GENERATION_EXHAUSTED" });
});
const mutationSource = await fs.readFile(new URL("../../../../apps/extension/src/background/compat/mutateWorkSession.js", import.meta.url), "utf8");
function storageFixture({ dropWrite = false, failReadback = false } = {}) {
  let disk = {}, queue = Promise.resolve(), writes = 0;
  const canonical = value => JSON.stringify(value, (key, input) => input && typeof input === "object" && !Array.isArray(input)
    ? Object.fromEntries(Object.keys(input).sort().map(k => [k, input[k]])) : input);
  const box = { Date, Error, Object, Number, Set,
    SellerAgentsBootstrapVerifier: { canonicalJson: canonical }, KEYS: { WORK_SESSIONS: "work" },
    withBindingWrite(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; },
    async getWorkSessions() { if (failReadback && writes) throw new Error("readback failed"); return structuredClone(disk); },
    async storageSet(values) { writes++; if (!dropWrite) disk = structuredClone(values.work); },
  };
  vm.createContext(box); vm.runInContext(source, box); box.OzonWorkSessionModel = box.SellerAgentsWorkSessionModel;
  box.transitionWorkSessionRecord = (sessions, key, expected, next, patch) => {
    const current = box.OzonWorkSessionModel.normalize(sessions[key], key);
    if (expected !== null && expected !== current.revision) throw Object.assign(new Error("stale"), { code: "WORK_SESSION_STALE_EVENT" });
    return sessions[key] = box.OzonWorkSessionModel.transition(current, next, patch);
  };
  vm.runInContext(mutationSource, box);
  return { box, seed(values) { disk = structuredClone(values); }, read: () => structuredClone(disk), writes: () => writes };
}
async function storageTest(name, fn) { await fn(); count++; console.log("PASS PAR-10/source Work writer: " + name); }
await storageTest("Finish is acknowledged only after preserved-map readback", async () => {
  const f = storageFixture(); f.seed({ A: start(), B: start("B") });
  const beforeB = JSON.stringify(f.read().B);
  const next = await f.box.mutateWorkSession("A", 2, "finishing");
  assert.equal(next.finished, true); assert.equal(f.read().A.finished, true);
  assert.equal(JSON.stringify(f.read().B), beforeB); assert.equal(f.writes(), 1);
});
await storageTest("two dialogue Finish writes preserve both terminal markers", async () => {
  const f = storageFixture(); f.seed({ A: start(), B: start("B") });
  await Promise.all([f.box.mutateWorkSession("A", 2, "finishing"), f.box.mutateWorkSession("B", 2, "finishing")]);
  assert.equal(f.read().A.finished, true); assert.equal(f.read().B.finished, true);
});
await storageTest("acknowledged dropped Finish closes new Work transitions", async () => {
  const f = storageFixture({ dropWrite: true }); f.seed({ A: start(), B: start("B") });
  await assert.rejects(f.box.mutateWorkSession("A", 2, "finishing"), { code: "WORK_STATE_COMMIT_UNCONFIRMED" });
  await assert.rejects(f.box.mutateWorkSession("B", 2, "active_hidden"), { code: "WORK_STATE_COMMIT_UNCONFIRMED" });
  assert.equal(f.writes(), 1);
  assert.throws(() => f.box.OzonWorkSessionModel.transition(start(), "active_hidden"), { code: "WORK_STATE_COMMIT_UNCONFIRMED" });
});
await storageTest("failed readback gives no Finish success while retaining stored marker", async () => {
  const f = storageFixture({ failReadback: true }); f.seed({ A: start() });
  await assert.rejects(f.box.mutateWorkSession("A", 2, "finishing"), { code: "WORK_STATE_COMMIT_UNCONFIRMED" });
  assert.equal(f.read().A.finished, true);
});
await storageTest("stale revision does not close independent Work writer", async () => {
  const f = storageFixture(); f.seed({ A: start(), B: start("B") });
  await assert.rejects(f.box.mutateWorkSession("A", 1, "finishing"), { code: "WORK_SESSION_STALE_EVENT" });
  await f.box.mutateWorkSession("B", 2, "active_hidden");
  assert.equal(f.read().B.state, "active_hidden"); assert.equal(f.writes(), 1);
});
console.log("SOURCE Work model: " + count + " scenarios passed; popup, assembled worker and installed checks remain separate.");
