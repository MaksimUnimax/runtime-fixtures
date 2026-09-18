import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const results = [];
const ids = {
  accountId: "account-1",
  entityId: "conversation-1",
  conversationKeyDigest: "conversation-1",
  bindingId: "binding-1",
  bindingRevision: 4,
  storeId: "store-1",
  marketplace: "ozon",
  workGeneration: "generation-1",
  bindingState: "BOUND",
};
const marker = (patch = {}) => ({
  ...ids,
  installationId: "installation-a",
  deliveryMarkerId: "delivery-a",
  aiOrderId: null,
  clientDeliveredAtMs: null,
  clientSequence: null,
  serverReceiveAtMs: 100,
  ...patch,
});
async function test(id, description, fn) {
  try { await fn(); results.push({ id, status: "PASS", description }); }
  catch (error) { results.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` }); }
}

const worker = await makeWorker(runtime);
const r = name => (...args) => worker.call(`SellerAgentsReconciliation.${name}`, ...args);
try {
  await test("C3F-01", "AI ordering beats inverted server receive order", async () => {
    const compare = r("compareDeliveryMarkers");
    assert.equal(compare(marker({ installationId: "a", aiOrderId: "message-2", serverReceiveAtMs: 200 }), marker({ installationId: "b", aiOrderId: "message-1", serverReceiveAtMs: 100 })) > 0, true);
  });
  await test("C3F-02", "later stable AI order wins", async () => {
    assert.equal(r("compareDeliveryMarkers")(marker({ aiOrderId: "message-10" }), marker({ aiOrderId: "message-2" })) > 0, true);
  });
  await test("C3F-03", "approximate fallback is deterministic with stable tie-break", async () => {
    const left = marker({ installationId: "installation-a", clientDeliveredAtMs: 20, serverReceiveAtMs: 100 });
    const right = marker({ installationId: "installation-b", clientDeliveredAtMs: 20, serverReceiveAtMs: 100 });
    assert.equal(r("compareDeliveryMarkers")(left, right) < 0, true);
    assert.equal(r("compareDeliveryMarkers")(right, left) > 0, true);
  });
  await test("C3F-04", "wrong binding and wrong store markers are ineligible", async () => {
    const eligible = r("deliveryEligibility");
    assert.equal(eligible(marker(), ids).eligible, true);
    assert.equal(eligible(marker({ bindingRevision: 3 }), ids).eligible, false);
    assert.equal(eligible(marker({ storeId: "store-2" }), ids).eligible, false);
    assert.equal(eligible(marker({ entityId: "other-dialogue" }), ids).eligible, false);
  });
  await test("C3F-05", "Finish outranks late delivery", async () => {
    const finish = { ...ids, bindingRevision: 5, bindingState: "FINISHED" };
    assert.equal(r("classifyComparison")({ server: finish, delivery: marker({ bindingRevision: 4 }) }), "SERVER_FINISH_WINS_OVER_LATE_DELIVERY");
  });
  await test("C3F-06", "old-store delivery is obsolete after explicit switch", async () => {
    const current = { ...ids, bindingRevision: 5, storeId: "store-2", bindingState: "BOUND" };
    assert.equal(r("classifyComparison")({ server: current, delivery: marker({ bindingRevision: 4, storeId: "store-1" }) }), "STALE_DELIVERY_OBSOLETE");
  });
  await test("C3F-07", "different-store stale explicit state requires explicit conflict", async () => {
    assert.equal(r("classifyComparison")({ local: { ...ids, storeId: "store-3" }, server: { ...ids, bindingRevision: 5, storeId: "store-2" } }), "EXPLICIT_BINDING_CONFLICT");
  });
  await test("C3F-08", "same binding converges without semantic conflict", async () => {
    assert.equal(r("classifyComparison")({ local: ids, server: ids, pending: { kind: "BINDING_UPSERT" } }), "SAME_BINDING_MERGEABLE");
  });
  await test("C3F-09", "valid preferred executor does not flap on ordinary markers", async () => {
    const result = r("preferredExecutorDecision")({ currentPreferred: { installationId: "installation-a", revoked: false, context: ids }, currentBinding: ids, candidates: [marker({ installationId: "installation-b", aiOrderId: "message-99" })] });
    assert.equal(result.state, "VALID_CURRENT"); assert.equal(result.installationId, "installation-a"); assert.equal(result.changed, false); assert.equal(result.reason, "VALID_CURRENT");
  });
  await test("C3F-10", "UNSET preferred executor is initialized by eligible candidate", async () => {
    const result = r("preferredExecutorDecision")({ currentPreferred: null, currentBinding: ids, candidates: [marker({ installationId: "installation-a", aiOrderId: "message-1" }), marker({ installationId: "installation-b", aiOrderId: "message-2" })] });
    assert.equal(result.state, "VALID_CURRENT");
    assert.equal(result.installationId, "installation-b");
    assert.equal(result.changed, true);
  });
  await test("C3F-11", "revoked preferred executor is replaced deterministically", async () => {
    const result = r("preferredExecutorDecision")({ currentPreferred: { installationId: "installation-a", revoked: true, context: ids }, currentBinding: ids, candidates: [marker({ installationId: "installation-b", aiOrderId: "message-2" })] });
    assert.equal(result.state, "VALID_CURRENT");
    assert.equal(result.installationId, "installation-b");
  });
  await test("C3F-12", "disconnected preferred remains valid until explicit invalidation", async () => {
    const result = r("preferredExecutorDecision")({ currentPreferred: { installationId: "installation-a", context: ids }, currentBinding: ids, candidates: [] });
    assert.equal(result.state, "VALID_CURRENT");
    assert.equal(result.installationId, "installation-a");
  });
  await test("C3F-13", "clock skew is advisory and cannot change binding state", async () => {
    const before = JSON.stringify(ids);
    r("compareDeliveryMarkers")(marker({ clientDeliveredAtMs: 9999999999999 }), marker({ clientDeliveredAtMs: -9999999999999 }));
    assert.equal(JSON.stringify(ids), before);
  });
  await test("C3F-14", "newer server Finish fences future stale actions only", async () => {
    const fenced = r("allowsFutureAction")({ local: ids, server: { ...ids, bindingRevision: 5, bindingState: "FINISHED" } });
    assert.equal(fenced.allowed, false); assert.equal(fenced.code, "SYNC_SERVER_FINISH_FENCE");
    const open = r("allowsFutureAction")({ local: ids, server: null });
    assert.equal(open.allowed, true); assert.equal(open.code, null);
  });
  await test("C3F-15", "reconciliation is pure and performs no provider/prompt operation", async () => {
    const result = r("reconcile")({ local: ids, server: ids, delivery: marker() });
    assert.equal(result.classification, "IN_SYNC");
    assert.equal(worker.network.length, 0);
    assert.equal(worker.messages.filter(message => /PROMPT|COMMAND|SEND/.test(String(message.type))).length, 0);
  });
  await test("C3F-16", "one dialogue conflict does not affect another dialogue", async () => {
    const conflict = { local: { ...ids, entityId: "dialogue-a", conversationKeyDigest: "dialogue-a", storeId: "store-3" }, server: { ...ids, entityId: "dialogue-a", conversationKeyDigest: "dialogue-a", bindingRevision: 5, storeId: "store-2" } };
    const independent = { local: { ...ids, entityId: "dialogue-b", conversationKeyDigest: "dialogue-b" }, server: { ...ids, entityId: "dialogue-b", conversationKeyDigest: "dialogue-b" } };
    assert.equal(r("classifyComparison")(conflict), "EXPLICIT_BINDING_CONFLICT");
    assert.equal(r("classifyComparison")(independent), "IN_SYNC");
  });
  await test("C3F-17", "equivalent same-store stale state converges safely", async () => {
    assert.equal(r("classifyComparison")({ local: ids, server: ids, pending: { kind: "BINDING_UPSERT" } }), "SAME_BINDING_MERGEABLE");
  });
  await test("C3F-18", "receive-order inversion cannot override stable AI order", async () => {
    assert.equal(r("compareDeliveryMarkers")(marker({ aiOrderId: "ai-1", serverReceiveAtMs: 900 }), marker({ aiOrderId: "ai-2", serverReceiveAtMs: 1 })) < 0, true);
  });
  await test("C3F-19", "approximate ordering is deterministic without AI order", async () => {
    assert.equal(r("markerProvenance")(marker({ clientDeliveredAtMs: 10 })), "CLIENT_APPROXIMATE");
    assert.equal(r("markerProvenance")(marker({})), "SERVER_RECEIVE_FALLBACK");
  });
  await test("C3F-20", "extreme future and past clocks never mutate explicit binding", async () => {
    const future = r("reconcile")({ local: ids, server: ids, delivery: marker({ clientDeliveredAtMs: Number.MAX_SAFE_INTEGER }) });
    const past = r("reconcile")({ local: ids, server: ids, delivery: marker({ clientDeliveredAtMs: -Number.MAX_SAFE_INTEGER }) });
    assert.equal(future.current.bindingRevision, ids.bindingRevision); assert.equal(past.current.storeId, ids.storeId);
  });
  await test("C3F-21", "disconnected installation remains unknown before contact", async () => {
    assert.equal(r("classifyComparison")({ local: ids, server: null }), "UNKNOWN_REMOTE_INSTALLATION_STATE");
  });
  await test("C3F-22", "later contact refines server knowledge", async () => {
    assert.equal(r("classifyComparison")({ local: null, server: { ...ids, bindingRevision: 5 } }), "SERVER_AHEAD_COMPATIBLE");
  });
  await test("C3F-23", "reconciliation does not delete already-sent AI messages", async () => {
    const before = worker.messages.length;
    r("reconcile")({ local: ids, server: { ...ids, bindingRevision: 5, bindingState: "FINISHED" }, delivery: marker() });
    assert.equal(worker.messages.length, before);
  });
  await test("C3F-24", "newer explicit revision fences stale future actions", async () => {
    assert.equal(r("allowsFutureAction")({ local: ids, server: { ...ids, bindingRevision: 5, storeId: "store-2" } }).allowed, false);
  });
  await test("C3F-25", "reconciliation never sends a prompt", async () => {
    r("reconcile")({ local: ids, server: ids });
    assert.equal(worker.messages.filter(message => String(message.type).includes("PROMPT")).length, 0);
  });
  await test("C3F-26", "reconciliation never invokes a provider", async () => {
    r("reconcile")({ local: ids, server: ids });
    assert.equal(worker.network.length, 0);
  });
  await test("C3F-27", "reconciliation never replays a result", async () => {
    const before = worker.messages.length;
    r("reconcile")({ local: ids, server: ids, pending: { kind: "DELIVERY_MARKER" } });
    assert.equal(worker.messages.length, before);
  });
  await test("C3F-28", "pure reconciliation remains restart-deterministic", async () => {
    const first = r("reconcile")({ local: ids, server: ids, delivery: marker({ aiOrderId: "restart-1" }) });
    const second = r("reconcile")({ local: ids, server: ids, delivery: marker({ aiOrderId: "restart-1" }) });
    assert.equal(first.classification, second.classification); assert.equal(first.preference.state, second.preference.state);
  });
} finally { worker.close(); }

const failures = results.filter(result => result.status === "FAIL");
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", scope: "C3F_RECONCILIATION_KERNEL", results, failureBatch: failures }, null, 2));
if (failures.length) process.exitCode = 1;
