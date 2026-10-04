import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const runtime = path.resolve(process.argv[2] || "");
assert(runtime, "runtime path is required");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.TextEncoder) globalThis.TextEncoder = (await import("node:util")).TextEncoder;
if (!globalThis.TextDecoder) globalThis.TextDecoder = (await import("node:util")).TextDecoder;

function load(relative) {
  const file = path.join(runtime, relative);
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
}

function card(operation) {
  const meta = globalThis.OzonOperationRegistry.operation(operation);
  assert(meta, "missing operation " + operation);
  const payload = globalThis.OzonGuidance.result({
    status: "section_selected",
    cluster: "reviews_questions",
    section: meta.section,
    version: 2
  });
  assert.equal(payload.external_request_executed, false);
  assert.equal(payload.physical_business_request_count, 0);
  return payload.choices.find((choice) => choice.operation === operation);
}

function assertCap16Guidance(stage) {
  const noSubscription = card("chat_history_v3");
  const reviewList = card("review_list");
  const reviewCount = card("review_count");
  const questionList = card("question_list");
  const questionCount = card("question_count");

  assert(noSubscription, stage + ": missing no-subscription guidance card");
  assert.equal(noSubscription.entitlement.status, "NOT_REQUIRED_FOR_TEMPLATE");
  assert.deepEqual(noSubscription.entitlement.required_subscription_types, []);
  assert.equal(noSubscription.entitlement.reason, "all_accounts");
  assert.equal(noSubscription.entitlement.applies_to, "GUIDANCE_TEMPLATE");
  assert.equal(noSubscription.entitlement.runtime_preflight_authoritative, true);

  for (const item of [reviewList, reviewCount]) {
    assert(item, stage + ": missing review guidance card");
    assert.deepEqual(item.entitlement.required_subscription_types, []);
    assert.equal(item.entitlement.status, "UNKNOWN");
    assert.equal(item.entitlement.reason, "entitlement_rule_unknown");
    assert.equal(item.entitlement.applies_to, "GUIDANCE_TEMPLATE");
    assert.equal(item.entitlement.runtime_preflight_authoritative, true);
  }
  for (const item of [questionList, questionCount]) {
    assert(item, stage + ": missing question guidance card");
    assert.equal(item.entitlement.status, "REQUIRED_FOR_TEMPLATE");
    assert.deepEqual(item.entitlement.required_subscription_types, ["PREMIUM_PLUS"]);
    assert.equal(item.entitlement.reason, "endpoint_subscription_restriction");
    assert.equal(item.entitlement.applies_to, "GUIDANCE_TEMPLATE");
    assert.equal(item.entitlement.runtime_preflight_authoritative, true);
  }

  assert.equal(reviewList.personal_data_setting_required_when_off, true);
  assert.equal(questionList.personal_data_setting_required_when_off, true);
  assert.equal(reviewCount.personal_data_setting_required_when_off, false);
  assert.equal(questionCount.personal_data_setting_required_when_off, false);
}

for (const relative of [
  "shared/runtime_names.js",
  "shared/ozon_operation_registry.js",
  "shared/ozon_entitlements.js",
  "shared/ozon_contract.js",
  "shared/ozon_guidance.js"
]) load(relative);

assertCap16Guidance("base");

for (const relative of [
  "shared/ozon_credentials.js",
  "shared/provider_transport_core.js",
  "shared/ozon_provider.js",
  "shared/swagger_read_surface_patch.js"
]) load(relative);

assertCap16Guidance("patched");

const command = globalThis.OzonContract.normalizeCommand({
  operation: "question_count",
  params: {}
});
const requirement = globalThis.OzonEntitlements.requirementFor(command);
assert.equal(requirement.required, true);
assert.equal(requirement.known, true);
assert.deepEqual([...requirement.allowed_subscription_types], ["PREMIUM_PLUS"]);

console.log(JSON.stringify({
  status: "PASS",
  evidence_level: "SOURCE_OR_EXTRACTED_RUNTIME_LOCAL",
  cap16: true,
  guidance_stages: ["base", "patched"],
  external_request_executed: false,
  physical_business_request_count: 0
}));
