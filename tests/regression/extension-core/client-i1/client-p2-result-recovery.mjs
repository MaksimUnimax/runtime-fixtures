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
console.log(JSON.stringify({ status: "PASS", scenarios: 9, provider_additional_calls: 0, scope: "pure result/recovery state model" }));
