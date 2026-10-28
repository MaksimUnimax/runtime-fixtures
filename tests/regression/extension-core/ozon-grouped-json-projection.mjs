import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const imported = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
const sourceMode = fs.existsSync(imported);
let source = fs.readFileSync(sourceMode ? imported : path.join(root, "shared/ozon_contract.js"), "utf8");
if (sourceMode) {
  const patches = JSON.parse(fs.readFileSync(path.join(root, "apps/extension/application-patches.json"), "utf8"));
  for (const patch of patches.filter(row => row.target === "shared/ozon_contract.js")) {
    assert.equal(source.split(patch.old).length - 1, 1, "one exact OzonContract patch preimage");
    source = source.replace(patch.old, patch.new);
  }
}
const context = { console, TextEncoder, structuredClone, Date, JSON, Object, Number, String, Boolean, Array, WeakSet, Set, Map };
context.globalThis = context;
vm.runInNewContext(source, context);
const ozon = context.OzonContract;
assert.equal(typeof ozon?.projectAnalyticsDataResult, "function");

const modulePath = path.join(root, "packages/bridge-core/src/execution/result-recovery.js");
let recoverySource;
if (fs.existsSync(modulePath)) {
  recoverySource = fs.readFileSync(modulePath, "utf8");
} else {
  const worker = fs.readFileSync(path.join(root, "service_worker.js"), "utf8");
  const marker = "  // Result recovery is deliberately a separate journal dimension from the";
  assert.equal(worker.split(marker).length - 1, 1, "one actual recovery module in the packaged worker");
  const position = worker.indexOf(marker);
  const begin = worker.lastIndexOf("(() => {", position);
  const end = worker.indexOf("\n})();", position);
  assert.ok(begin >= 0 && end > position, "bounded actual module, no replacement fixture");
  recoverySource = worker.slice(begin, end + "\n})();".length);
}
vm.runInNewContext(recoverySource, context);
const recovery = context.SellerAgentsResultRecovery;
assert.equal(typeof recovery?.createBuffer, "function");

const now = 1900000000000;
const binding = {
  account_id: "account-a", conversation_key: "chatgpt:dialogue-a",
  marketplace: "ozon", store_id: "store-a", binding_id: "binding-a",
  binding_revision: 4, work_generation: "work-4", ai_surface: "chatgpt", ai_profile: "profile-a",
};
const providerAttempt = { state: "RESPONSE_RECEIVED" };
const cases = [];
let lastBuffer;
for (const [label, ownValue] of [
  ["object", { marker: "KEEP" }], ["primitive", "KEEP_PRIMITIVE"],
  ["null", null], ["array", [{ marker: "KEEP_ARRAY" }]],
]) {
  const input = {
    ordinary: "OUTER_OK", authorization: "SYNTHETIC_REMOVE",
    result: { ordinary: "RESULT_OK", data: [{ metrics: [5], ordinary: "ROW_OK", api_key: "SYNTHETIC_REMOVE" }], totals: [5] },
  };
  for (const target of [input, input.result, input.result.data[0]]) {
    Object.defineProperty(target, "__proto__", {
      value: ownValue, enumerable: true, writable: true, configurable: true,
    });
  }
  // Real JSON serialization removes repeated object aliases, as in provider data.
  const persistedInput = JSON.parse(JSON.stringify(input));
  const buffer = recovery.createBuffer({
    ...binding, logical_execution_id: "logical-" + label, provider_attempt_id: "attempt-" + label,
    execution_id: "exec-" + label, command_index: 0, projection_kind: "grouped",
    operation: "analytics_data", ok: true, http_status: 200,
    result: persistedInput, expires_at_ms: now + recovery.TECHNICAL_RETENTION_MS,
  }, now);
  assert.equal(buffer.phase, recovery.RESULT_PHASES.BUFFERED);
  assert.equal(buffer.provider_replay_forbidden, true);
  assert.equal(buffer.payload.result.authorization, undefined, "existing buffer privacy filter remains active");
  assert.equal(buffer.payload.result.result.data[0].api_key, undefined);
  // Persist and recover the whole buffer before projecting its retained result.
  lastBuffer = JSON.parse(JSON.stringify(buffer));
  const decision = recovery.recoveryDecision({ providerAttempt, resultBuffer: lastBuffer, currentContext: binding, now });
  assert.equal(decision.code, "KNOWN_RESULT_RECOVERY_SAFE");
  assert.equal(decision.provider_calls, 0);
  const projected = ozon.projectAnalyticsDataResult(lastBuffer.payload.result, ["revenue"], ["revenue"]);
  assert.deepEqual(Array.from(projected.result.data[0].metrics), [5]);
  assert.equal(projected.ordinary, "OUTER_OK");
  assert.equal(projected.result.ordinary, "RESULT_OK");
  assert.equal(projected.result.data[0].ordinary, "ROW_OK");
  for (const target of [projected, projected.result, projected.result.data[0]]) {
    assert.equal(Object.hasOwn(target, "__proto__"), true, "own JSON data field survives buffer and projection");
    assert.equal(JSON.stringify(target["__proto__"]), JSON.stringify(ownValue));
    assert.equal(Object.getPrototypeOf(target).marker, undefined, "data cannot alter the prototype");
  }
  const serialized = JSON.parse(JSON.stringify(projected));
  for (const target of [serialized, serialized.result, serialized.result.data[0]]) {
    assert.equal(Object.hasOwn(target, "__proto__"), true, "own JSON field survives final persistence");
    assert.equal(JSON.stringify(target["__proto__"]), JSON.stringify(ownValue));
  }
  cases.push("buffer-persistence-projection-" + label);
}
for (const [label, changed] of [["account", { account_id: "account-b" }], ["store", { store_id: "store-b" }]]) {
  assert.equal(recovery.recoveryDecision({
    providerAttempt, resultBuffer: lastBuffer, currentContext: { ...binding, ...changed }, now,
  }).code, "STALE_DELIVERY_CONTEXT");
  cases.push("foreign-" + label + "-rejected");
}
assert.equal(recovery.recoveryDecision({
  providerAttempt, resultBuffer: lastBuffer, currentContext: binding, finish: true, now,
}).code, "STALE_DELIVERY_CONTEXT");
cases.push("finish-rejected");
assert.equal(recovery.recoveryDecision({
  providerAttempt: { state: "OUTCOME_UNKNOWN" }, resultBuffer: lastBuffer, currentContext: binding, now,
}).code, "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY");
cases.push("unknown-provider-no-retry");
assert.equal(recovery.recoveryDecision({
  providerAttempt, resultBuffer: lastBuffer, currentContext: binding,
  deliveryOutcome: recovery.DELIVERY_OUTCOMES.UNKNOWN, now,
}).code, "DELIVERY_OUTCOME_UNKNOWN_NO_RETRY");
cases.push("unknown-delivery-no-retry");

const commands = context.OzonContractFactory.createOzonContract({
  operations: { synthetic_read: {
    method: "POST", path: "/synthetic-no-network", provider: "seller_api",
    effect: "READ", execution_enabled: false,
  } },
});
assert.throws(
  () => commands.normalizeCommand(JSON.parse('{"operation":"synthetic_read","params":{"__proto__":{"fixture_only":"DO_NOT_SEND"}}}')),
  error => error?.code === "TRANSPORT_INJECTION_REJECTED",
  "preserving result fields must not admit prototype keys in command parameters",
);
cases.push("command-transport-rejected");
console.log(JSON.stringify({
  status: "PASS", cases, count: cases.length, level: sourceMode ? "SOURCE" : "COMPOSED_RUNTIME",
  scope: "actual result buffer -> JSON persistence -> grouped projection, context/privacy/no-replay guards",
  upstream_safe_read_redactor_acceptance: false, installed_acceptance: false, live_provider_calls: 0,
}));
