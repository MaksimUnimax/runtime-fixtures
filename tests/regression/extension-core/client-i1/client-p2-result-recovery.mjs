import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(".");
const context = { console, TextEncoder, structuredClone, Date, JSON, Object, Number, String, Boolean, Array, WeakSet, Set, Map };
context.globalThis = context;
const sourcePath = path.join(root, "packages/bridge-core/src/execution/result-recovery.js");
let source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : fs.readFileSync(path.join(root, "service_worker.js"), "utf8");
if (!fs.existsSync(sourcePath)) {
  const marker = source.indexOf("  const SCHEMA_VERSION = 1;");
  source = source.slice(source.lastIndexOf("(() => {", marker), source.indexOf("\n})();", marker) + "\n})();".length);
}
vm.runInNewContext(source, context);
const api = context.SellerAgentsResultRecovery;
const known = {
  state: "RESPONSE_RECEIVED",
  logical_execution_id: "logical-1",
  provider_attempt_id: "attempt-1",
  execution_id: "exec-1",
  command_index: 0,
  account: "account-a",
  conversation: "chatgpt:dialogue-a",
  marketplace: "ozon",
  store: "store-a",
  binding: "binding-a",
  binding_revision: 4,
  work_generation: "work-4",
};
const now = Date.now();
const input = { ...known, store_id: "store-a", binding_id: "binding-a", conversation_key: "chatgpt:dialogue-a", work_generation: "work-4", ok: true, request_id: "provider-response-1", operation: "seller_info", http_status: 200,
  report_text: "OZON_RESULT_V1\n{\"result\":{\"value\":42}}", result: { value: 42, nested: { authorization: "removed" } },
  expires_at_ms: now + api.TECHNICAL_RETENTION_MS };
const buffer = api.createBuffer(input, now);
assert.equal(buffer.phase, api.RESULT_PHASES.BUFFERED);
assert.equal(buffer.provider_replay_forbidden, true);
assert.equal(buffer.payload.result.nested.authorization, undefined);
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input }).code, "KNOWN_RESULT_RECOVERY_SAFE");
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: { ...input, store_id: "store-b" } }).code, "STALE_DELIVERY_CONTEXT");
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, finish: true }).code, "STALE_DELIVERY_CONTEXT");
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, deliveryOutcome: api.DELIVERY_OUTCOMES.COMMITTED }).code, "DELIVERY_OUTCOME_UNKNOWN_NO_RETRY");
assert.equal(api.recoveryDecision({ providerAttempt: { state: "OUTCOME_UNKNOWN" }, resultBuffer: buffer, currentContext: input }).code, "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY");
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, deliveryOutcome: api.DELIVERY_OUTCOMES.CONFIRMED }).code, "DELIVERY_CONFIRMED");
const expired = api.compact({ ...buffer, expires_at_ms: 999 }, 1000);
assert.equal(expired.phase, api.RESULT_PHASES.EXPIRED);
assert.equal(expired.payload, undefined);
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: expired, currentContext: input }).code, "RESULT_BUFFER_EXPIRED");
// P2-R11: JSON objects can legally contain an own "__proto__" data key.
// The technical result buffer may filter credentials but must not silently
// mutate a safe result while still classifying recovery as reusable.
const original = JSON.parse('{"ordinary":"SYNTHETIC_42","__proto__":{"fixture_field":"SYNTHETIC_KEEP"},"nested":{"ordinary":"NESTED_OK","__proto__":{"nested_fixture":"KEEP"},"authorization":"FILTER_THIS"}}');
assert.equal(Object.prototype.hasOwnProperty.call(original, "__proto__"), true);
const roundtrip = api.createBuffer({ ...input, result: original }, now);
assert.equal(roundtrip.phase, api.RESULT_PHASES.BUFFERED);
assert.equal(roundtrip.provider_replay_forbidden, true);
assert.equal(Object.prototype.hasOwnProperty.call(roundtrip.payload.result, "__proto__"), true,
  "a safe provider JSON own field may not silently disappear");
assert.equal(roundtrip.payload.result["__proto__"].fixture_field, "SYNTHETIC_KEEP");
assert.equal(Object.prototype.hasOwnProperty.call(roundtrip.payload.result.nested, "__proto__"), true,
  "nested own JSON data keys must also survive");
assert.equal(roundtrip.payload.result.nested["__proto__"].nested_fixture, "KEEP");
assert.equal(roundtrip.payload.result.nested.authorization, undefined, "existing credential redaction stays active");
assert.equal(Object.getPrototypeOf(roundtrip.payload.result).fixture_field, undefined,
  "retaining the own key must not change the result object prototype");
assert.equal(Object.getPrototypeOf(roundtrip.payload.result.nested).nested_fixture, undefined,
  "retaining nested own key must not mutate prototype");
assert.equal(api.recoveryDecision({ providerAttempt: known, resultBuffer: roundtrip, currentContext: input }).code,
  "KNOWN_RESULT_RECOVERY_SAFE");
// P2-R12: a recovered grouped analytics result traverses OzonContract's
// second JSON copier. Own JSON data keys must not disappear at projection.
const contractSourcePath = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
let contractSource = fs.existsSync(contractSourcePath)
  ? fs.readFileSync(contractSourcePath, "utf8")
  : fs.readFileSync(path.join(root, "shared/ozon_contract.js"), "utf8");
// Source tests apply the same constrained patches as the official composer;
// extracted-package tests use the already-patched shared contract bytes.
if (fs.existsSync(contractSourcePath)) {
  const recipes = JSON.parse(fs.readFileSync(path.join(root, "apps/extension/application-patches.json"), "utf8"))
    .filter(patch => patch.target === "shared/ozon_contract.js");
  assert.equal(recipes.length, 3, "exactly three reviewed Ozon JSON copier patches");
  for (const patch of recipes) {
    assert.equal(contractSource.split(patch.old).length, 2, "frozen donor patch anchor must be unique");
    contractSource = contractSource.replace(patch.old, patch.new);
  }
}
vm.runInNewContext(contractSource, context);
const ozon = context.OzonContract;
assert.equal(typeof ozon?.projectAnalyticsDataResult, "function");
const groupedJson = JSON.parse('{"ordinary":"OUTER_OK","__proto__":{"outer_marker":"OUTER_KEEP"},"result":{"ordinary":"RESULT_OK","data":[{"metrics":[5],"ordinary":"ROW_OK","__proto__":{"row_marker":"ROW_KEEP"}}],"totals":[5]}}');
const groupedBuffer = api.createBuffer({ ...input, result: groupedJson }, now);
assert.equal(Object.prototype.hasOwnProperty.call(groupedBuffer.payload.result, "__proto__"), true);
// The result buffer is persisted as JSON across the worker boundary.  Use a
// real JSON round trip so both source modules observe ordinary JSON objects,
// not an artificial cross-realm Node vm object.
const recoveredJSON = JSON.parse(JSON.stringify(groupedBuffer.payload.result));
assert.equal(Object.prototype.hasOwnProperty.call(recoveredJSON, "__proto__"), true);
const projected = ozon.projectAnalyticsDataResult(recoveredJSON, ["revenue"], ["revenue"]);
assert.deepEqual(Array.from(projected.result.data[0].metrics), [5]);
assert.equal(projected.ordinary, "OUTER_OK");
assert.equal(projected.result.ordinary, "RESULT_OK");
assert.equal(projected.result.data[0].ordinary, "ROW_OK");
assert.equal(Object.prototype.hasOwnProperty.call(projected, "__proto__"), true,
  "downstream grouped projection cannot silently discard an own JSON key");
assert.equal(projected["__proto__"].outer_marker, "OUTER_KEEP");
assert.equal(Object.prototype.hasOwnProperty.call(projected.result.data[0], "__proto__"), true,
  "nested grouped row must keep its own key");
assert.equal(projected.result.data[0]["__proto__"].row_marker, "ROW_KEEP");
assert.equal(Object.getPrototypeOf(projected).outer_marker, undefined);
assert.equal(Object.getPrototypeOf(projected.result.data[0]).row_marker, undefined);
const serialized = JSON.parse(JSON.stringify(projected));
assert.equal(Object.prototype.hasOwnProperty.call(serialized, "__proto__"), true);
assert.equal(serialized.result.data[0]["__proto__"].row_marker, "ROW_KEEP");

// Command parameter validation must not begin accepting '__proto__' through
// the same copier merely because result payloads preserve arbitrary JSON keys.
// There is deliberately no production operation registry in the isolated vm.
// A minimal synthetic READ operation lets the sanitizer run before any I/O.
const syntheticCommands = context.OzonContractFactory.createOzonContract({
  operations: { synthetic_read: {
    method: "POST", path: "/synthetic-no-network", provider: "seller_api",
    effect: "READ", execution_enabled: false,
  } },
});
const unsafeCommand = JSON.parse('{"operation":"synthetic_read","params":{"__proto__":{"fixture_only":"DO_NOT_SEND"}}}');
assert.throws(() => syntheticCommands.normalizeCommand(unsafeCommand),
  error => error?.code === "TRANSPORT_INJECTION_REJECTED",
  "unsafe own prototype key in command params must be rejected before provider IO");
console.log(JSON.stringify({ status: "PASS", scenarios: 12, provider_additional_calls: 0, scope: "pure result/recovery state model" }));
