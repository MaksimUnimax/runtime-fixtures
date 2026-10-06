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
test("another surface root cannot inherit the completed Start", () => {
  const f = fixture(); f.tracker.endStart("intent-a", { retainWitness: true });
  assert.notEqual(promote(f, { root: {} }).conversation_id, f.bound.conversation_id);
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
return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = fs.readFileSync(fileURLToPath(new URL("../../../packages/bridge-core/src/work/conversation-identity.js", import.meta.url)), "utf8");
  const cases = lateStartRouteCases(source);
  for (const [, run] of cases) run();
  console.log(JSON.stringify({status: "PASS_SOURCE", count: cases.length, scenarios: cases.map(([name]) => name)}));
}
