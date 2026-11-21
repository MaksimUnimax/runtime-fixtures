import assert from "node:assert/strict";
import fs from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import path from "node:path";

async function main() {
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("P2 raw-source regression requires Node.js 24 or newer; production source is not rewritten for older parsers.");
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(".");
const context = { console, TextEncoder, structuredClone, crypto: webcrypto, Date, JSON, Object, Number, String, Boolean, Array, WeakSet, Set, Map, Promise, Uint8Array };
context.globalThis = context;
const sourcePath = path.join(root, "packages/bridge-core/src/execution/result-recovery.js");
let source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : fs.readFileSync(path.join(root, "service_worker.js"), "utf8");
if (!fs.existsSync(sourcePath)) {
  const marker = source.indexOf("  const SCHEMA_VERSION = 2;");
  assert.notEqual(marker, -1, "built P2 package must contain schema-2 result recovery bytes");
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
const buffer = await api.createBuffer(input, now);
assert.equal(buffer.phase, api.RESULT_PHASES.BUFFERED);
assert.equal(buffer.provider_replay_forbidden, true);
assert.equal(buffer.payload.result.nested.authorization, undefined);
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input })).code, "KNOWN_RESULT_RECOVERY_SAFE");
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: { ...input, store_id: "store-b" } })).code, "STALE_DELIVERY_CONTEXT");
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, finish: true })).code, "STALE_DELIVERY_CONTEXT");
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, deliveryOutcome: api.DELIVERY_OUTCOMES.COMMITTED })).code, "DELIVERY_OUTCOME_UNKNOWN_NO_RETRY");
assert.equal((await api.recoveryDecision({ providerAttempt: { state: "OUTCOME_UNKNOWN" }, resultBuffer: buffer, currentContext: input })).code, "PROVIDER_OUTCOME_UNKNOWN_NO_RETRY");
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: buffer, currentContext: input, deliveryOutcome: api.DELIVERY_OUTCOMES.CONFIRMED })).code, "DELIVERY_CONFIRMED");
const expired = api.compact({ ...buffer, expires_at_ms: 999 }, 1000);
assert.equal(expired.phase, api.RESULT_PHASES.EXPIRED);
assert.equal(expired.payload, undefined);
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: expired, currentContext: input })).code, "RESULT_BUFFER_EXPIRED");
// P2-R11: JSON objects can legally contain an own "__proto__" data key.
// The technical result buffer may filter credentials but must not silently
// mutate a safe result while still classifying recovery as reusable.
const original = JSON.parse('{"ordinary":"SYNTHETIC_42","__proto__":{"fixture_field":"SYNTHETIC_KEEP"},"nested":{"ordinary":"NESTED_OK","__proto__":{"nested_fixture":"KEEP"},"authorization":"FILTER_THIS"}}');
assert.equal(Object.prototype.hasOwnProperty.call(original, "__proto__"), true);
const roundtrip = await api.createBuffer({ ...input, result: original }, now);
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
assert.equal((await api.recoveryDecision({ providerAttempt: known, resultBuffer: roundtrip, currentContext: input })).code,
  "KNOWN_RESULT_RECOVERY_SAFE");
console.log(JSON.stringify({ status: "PASS", scenarios: 10, provider_additional_calls: 0, scope: "pure result/recovery state model plus own JSON key integrity" }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
