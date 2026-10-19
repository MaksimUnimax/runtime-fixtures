import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
export function lateStartRouteCases(source) {
function fixture({ provider = "chatgpt", origin = "https://chatgpt.com", evidence = true, initial = [] } = {}) {
  const box = { URL, TextEncoder }; vm.createContext(box); vm.runInContext(source, box);
  let next = 0; const tracker = box.SellerAgentsConversationIdentity.createTracker({ newToken: () => "surface-" + ++next });
  const root = {};
  const input = { origin, provider, pathname: "/", root, accountScope: "account-a",
    surfaceConfirmed: true, hasMessages: initial.length > 0, messageIds: initial };
  tracker.observe(input); tracker.beginStart("intent-a");
  const witnessed = { ...input, hasMessages: true, messageIds: ["sent-user", "assistant-placeholder"],
    startWitness: "intent-a", ...(evidence ? { startWitnessMessageId: "sent-user" } : {}) };
  const bound = tracker.observe(witnessed);
  return { tracker, input, witnessed, bound, root };
}
function promote(f, patch = {}) {
  return f.tracker.observe({ ...f.witnessed, pathname: "/any-route/opaque-address",
    messageIds: ["sent-user", "assistant-complete"], ...patch });
}
const results = [];
function test(name, fn) { results.push([name, fn]); }
test("response finishes before address appears; exact user witness preserves binding", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.equal(promote(f).conversation_id, f.bound.conversation_id);
});
test("same behavior for a different AI origin and provider", () => {
  const f = fixture({ origin: "https://other-ai.example", provider: "other-ai" });
  f.tracker.endStart("intent-a", { retainWitness: true });
  assert.equal(promote(f).conversation_id, f.bound.conversation_id);
});
test("cancellation does not retain a completed send witness", () => {
  const f = fixture(); f.tracker.endStart("intent-a");
  assert.notEqual(promote(f).conversation_id, f.bound.conversation_id);
});
test("unknown send without exact witnessed user ID cannot authorize late promotion", () => {
  const f = fixture({ evidence: false }); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f).conversation_id, f.bound.conversation_id);
});
test("another user message ID with the same intent cannot inherit binding", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { startWitnessMessageId: "other-user", messageIds: ["other-user", "assistant-complete"] }).conversation_id, f.bound.conversation_id);
});
test("witness must remain in the visible message inventory", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { messageIds: ["other-user", "assistant-complete"] }).conversation_id, f.bound.conversation_id);
});
test("remounted surface with exact retained Start witness preserves late promotion", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.equal(promote(f, { root: {} }).conversation_id, f.bound.conversation_id);
});
test("remounted surface with recorded witness preserves pending Start promotion", () => {
  const f = fixture();
  assert.equal(promote(f, { root: {} }).conversation_id, f.bound.conversation_id);
});
test("another root without the exact witness cannot inherit completed Start", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { root: {}, startWitnessMessageId: "other-user",
    messageIds: ["other-user", "assistant-complete"] }).conversation_id, f.bound.conversation_id);
});
test("a witness first observed on a replacement root cannot authorize promotion", () => {
  const f = fixture({ evidence: false });
  assert.notEqual(promote(f, { root: {}, startWitnessMessageId: "sent-user" }).conversation_id, f.bound.conversation_id);
});
test("ambiguous remount cannot authorize promotion", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  const result = promote(f, { root: {}, conflict: "multiple_conversation_surfaces" });
  assert.equal(result.conversation_id, null);
  assert.notEqual(promote(f).conversation_id, f.bound.conversation_id);
});
test("cancelled Start cannot transfer to a replacement root", () => {
  const f = fixture(); f.tracker.endStart("intent-a");
  assert.notEqual(promote(f, { root: {} }).conversation_id, f.bound.conversation_id);
});
test("provider change cannot transfer retained witness to a replacement root", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { root: {}, provider: "other-ai" }).conversation_id, f.bound.conversation_id);
});
test("changed account invalidates completed Start continuity", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { accountScope: "account-b" }).conversation_id, f.bound.conversation_id);
});
test("changed origin invalidates completed Start continuity", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { origin: "https://different.example" }).conversation_id, f.bound.conversation_id);
});
test("successful late promotion is consumed; another navigation is not silently inherited", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.equal(promote(f).conversation_id, f.bound.conversation_id);
  assert.notEqual(promote(f, { pathname: "/another-dialogue" }).conversation_id, f.bound.conversation_id);
});
test("route appears before endStart; next navigation still resets", () => {
  const f = fixture(); assert.equal(promote(f).conversation_id, f.bound.conversation_id);
  f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { pathname: "/another-dialogue" }).conversation_id, f.bound.conversation_id);
});
test("existing dialogue cannot reuse the new-empty-dialogue promotion exception", () => {
  const f = fixture({ initial: ["existing-user", "existing-assistant"] });
  f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f).conversation_id, f.bound.conversation_id);
});
test("history replacement on the same path suspends identity", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  const changed = f.tracker.observe({ ...f.witnessed, messageIds: ["other-user", "other-assistant"], startWitness: null });
  assert.equal(changed.conversation_id, null);
});

// B08 source boundary: two trackers in ONE shared module realm, unlike the
// single-tracker late-route cases above. This does not claim installed
// parallel Ozon/WB stores or live owner authority.
function parallelPending() {
  const box = { URL, TextEncoder };
  vm.createContext(box); vm.runInContext(source, box);
  let surfaceSequence = 0;
  const core = box.SellerAgentsConversationIdentity;
  function make({ provider, origin, account, intent, witness }) {
    const tracker = core.createTracker({ newToken: () => "parallel-surface-" + ++surfaceSequence });
    const root = {};
    const before = {
      origin, provider, accountScope: account, root,
      pathname: "/", surfaceConfirmed: true, hasMessages: false, messageIds: []
    };
    assert.equal(tracker.observe(before).status, "unknown");
    tracker.beginStart(intent);
    const observed = { ...before, hasMessages: true,
      messageIds: [witness, "assistant-placeholder"],
      startWitness: intent, startWitnessMessageId: witness };
    const bound = tracker.observe(observed);
    assert.equal(bound.status, "confirmed");
    function route(path = "/opaque/route", patch = {}) {
      return tracker.observe({ ...observed, pathname: path,
        messageIds: [witness, "assistant-complete"], ...patch });
    }
    return { tracker, before, observed, bound, route, root, intent, witness };
  }
  return { make };
}
test("two parallel providers retain their own witnessed Start, regardless of completion order", () => {
  for (const first of ["a", "b"]) {
    const p = parallelPending();
    const a = p.make({ provider: "chatgpt", origin: "https://chatgpt.com",
      account: "account-a", intent: "start-a", witness: "user-a" });
    const b = p.make({ provider: "alice", origin: "https://alice.yandex.ru",
      account: "account-b", intent: "start-b", witness: "user-b" });
    assert.notEqual(a.bound.conversation_id, b.bound.conversation_id);
    const completed = first === "a" ? a : b, pending = first === "a" ? b : a;
    completed.tracker.endStart(completed.intent, { retainWitness: true });
    assert.equal(completed.route("/completed").conversation_id, completed.bound.conversation_id);
    // The other dialogue's independent pending permit must still promote.
    assert.equal(pending.route("/still-pending").conversation_id, pending.bound.conversation_id);
    pending.tracker.endStart(pending.intent, { retainWitness: true });
    assert.notEqual(pending.route("/different-chat").conversation_id, pending.bound.conversation_id);
  }
});
test("cancelling one of two pending Starts neither promotes it nor retires the other", () => {
  const p = parallelPending();
  const a = p.make({ provider: "chatgpt", origin: "https://chatgpt.com",
    account: "account-a", intent: "start-a", witness: "user-a" });
  const b = p.make({ provider: "alice", origin: "https://alice.yandex.ru",
    account: "account-b", intent: "start-b", witness: "user-b" });
  a.tracker.endStart(a.intent);
  const cancelled = a.route("/cancelled");
  assert.notEqual(cancelled.conversation_id, a.bound.conversation_id);
  assert.notEqual(cancelled.conversation_id, b.bound.conversation_id,
    "cancelled Start must not inherit the other document's conversation");
  assert.equal(b.route("/legitimate-other-dialogue").conversation_id, b.bound.conversation_id);
  assert.notEqual(a.route("/later-stale-message").conversation_id, b.bound.conversation_id);
});
test("account switch and return cannot resurrect stale Start or disrupt another tracker", () => {
  const p = parallelPending();
  const a = p.make({ provider: "chatgpt", origin: "https://chatgpt.com",
    account: "account-a", intent: "same-intent", witness: "same-witness" });
  const b = p.make({ provider: "chatgpt", origin: "https://chatgpt.com",
    account: "account-b", intent: "same-intent", witness: "same-witness" });
  // Equal textual witness/intent IDs in distinct documents are not shared authority.
  assert.notEqual(a.bound.conversation_id, b.bound.conversation_id);
  a.tracker.endStart(a.intent, { retainWitness: true });
  const changed = a.tracker.observe({ ...a.observed, accountScope: "account-b" });
  assert.notEqual(changed.conversation_id, a.bound.conversation_id);
  const returned = a.tracker.observe(a.observed);
  assert.notEqual(returned.conversation_id, a.bound.conversation_id);
  assert.equal(b.route("/b-still-own").conversation_id, b.bound.conversation_id);
});

// B08-03 same-AI, same-account parallel surfaces: local message IDs may
// coincide across documents. A retained Start witness never authorizes
// another document's route even when provider/account/intent/text agree.
// Store selection/credential isolation is a separate application test.
test("same-account same-provider same-local-message Starts preserve each independent route in both finish orders", () => {
  for (const first of ["a", "b"]) {
    const p = parallelPending();
    const opts = { provider: "chatgpt", origin: "https://chatgpt.com",
      account: "same-account", intent: "same-start", witness: "same-user-local-id" };
    const a = p.make(opts), b = p.make(opts);
    assert.notEqual(a.root, b.root);
    assert.notEqual(a.bound.conversation_id, b.bound.conversation_id,
      "same local message/intent text across two documents cannot alias bindings");
    const completed = first === "a" ? a : b;
    const pending = first === "a" ? b : a;
    completed.tracker.endStart(completed.intent, { retainWitness: true });
    assert.equal(completed.route("/c/first-finished").conversation_id, completed.bound.conversation_id);
    assert.equal(pending.route("/c/second-pending").conversation_id, pending.bound.conversation_id);
    pending.tracker.endStart(pending.intent, { retainWitness: true });
    assert.notEqual(completed.route("/c/new-finished-dialogue").conversation_id, pending.bound.conversation_id);
    assert.notEqual(pending.route("/c/new-pending-dialogue").conversation_id, completed.bound.conversation_id);
  }
});
test("cancelling same-account same-provider Start cannot cancel a second independent document", () => {
  const p = parallelPending();
  const opts = { provider: "chatgpt", origin: "https://chatgpt.com",
    account: "same-account", intent: "same-start", witness: "same-user-local-id" };
  const a = p.make(opts), b = p.make(opts);
  assert.notEqual(a.bound.conversation_id, b.bound.conversation_id);
  a.tracker.endStart(a.intent); // Explicit cancel without retaining witness.
  const cancelled = a.route("/c/cancelled");
  assert.notEqual(cancelled.conversation_id, a.bound.conversation_id);
  assert.notEqual(cancelled.conversation_id, b.bound.conversation_id,
    "cancelled same-account Start must not inherit the second document's binding");
  assert.equal(b.route("/c/still-pending").conversation_id, b.bound.conversation_id);
  b.tracker.endStart(b.intent, { retainWitness: true });
  assert.notEqual(a.route("/c/stale-after-cancellation").conversation_id, b.bound.conversation_id);
});


// B08-04 intersection: the same AI/account/local IDs are open in separate
// documents while one document remounts its DOM. This test uses two actual
// trackers in one VM realm; it does not assert store or installed popup state.
test("same-account parallel Start survives one document remount without borrowing the sibling witness", () => {
  for (const remountFirst of ["a", "b"]) {
    const p = parallelPending();
    const opts = { provider: "chatgpt", origin: "https://chatgpt.com",
      account: "same-account", intent: "same-start", witness: "same-user-local-id" };
    const a = p.make(opts), b = p.make(opts);
    assert.match(a.bound.conversation_id, /^local:/);
    assert.match(b.bound.conversation_id, /^local:/);
    assert.notEqual(a.bound.conversation_id, b.bound.conversation_id);
    const remounted = remountFirst === "a" ? a : b;
    const sibling = remountFirst === "a" ? b : a;
    remounted.tracker.endStart(remounted.intent, { retainWitness: true });
    const recovered = remounted.route("/c/remounted-document", { root: {} });
    assert.equal(recovered.status, "confirmed");
    assert.equal(recovered.identity_scope, "document");
    assert.equal(recovered.conversation_id, remounted.bound.conversation_id);
    assert.notEqual(recovered.conversation_id, sibling.bound.conversation_id);
    const stillPending = sibling.route("/c/other-still-pending");
    assert.equal(stillPending.status, "confirmed");
    assert.equal(stillPending.conversation_id, sibling.bound.conversation_id);
    sibling.tracker.endStart(sibling.intent, { retainWitness: true });
    assert.notEqual(remounted.route("/c/new-after-remount").conversation_id, sibling.bound.conversation_id);
    assert.notEqual(sibling.route("/c/new-sibling-dialogue").conversation_id, remounted.bound.conversation_id);
  }
});
test("unproved remount isolates a new local ID or conflicts, without consuming the sibling Start", () => {
  const cases = [
    { patch: { root: {}, startWitnessMessageId: "foreign-user-local-id",
        messageIds: ["foreign-user-local-id", "assistant-complete"] },
      status: "confirmed", source: "local_surface", scope: "document" },
    { patch: { root: {}, conflict: "multiple_conversation_surfaces" },
      status: "conflict", source: "multiple_conversation_surfaces", scope: "none" }
  ];
  for (const { patch, status, source, scope } of cases) {
    const p = parallelPending();
    const opts = { provider: "chatgpt", origin: "https://chatgpt.com",
      account: "same-account", intent: "same-start", witness: "same-user-local-id" };
    const a = p.make(opts), b = p.make(opts);
    a.tracker.endStart(a.intent, { retainWitness: true });
    const rejected = a.route("/c/unproved-remount", patch);
    assert.equal(rejected.status, status);
    assert.equal(rejected.source, source);
    assert.equal(rejected.identity_scope, scope);
    if (status === "conflict") assert.equal(rejected.conversation_id, null);
    else assert.match(rejected.conversation_id, /^local:/);
    assert.notEqual(rejected.conversation_id, a.bound.conversation_id);
    assert.notEqual(rejected.conversation_id, b.bound.conversation_id);
    const sibling = b.route("/c/legitimate-sibling");
    assert.equal(sibling.status, "confirmed");
    assert.equal(sibling.conversation_id, b.bound.conversation_id);
    const stale = a.route("/c/stale-after-rejection");
    assert.notEqual(stale.conversation_id, a.bound.conversation_id);
    assert.notEqual(stale.conversation_id, b.bound.conversation_id);
  }
});

return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = fs.readFileSync(fileURLToPath(new URL("../../../packages/bridge-core/src/work/conversation-identity.js", import.meta.url)), "utf8");
  const cases = lateStartRouteCases(source);
  for (const [, run] of cases) run();
  console.log(JSON.stringify({status: "PASS_SOURCE", count: cases.length, scenarios: cases.map(([name]) => name)}));
}
