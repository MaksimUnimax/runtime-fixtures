import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const runtime = path.resolve(process.argv[2] || "");
assert(runtime, "runtime path is required");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.TextEncoder)
  globalThis.TextEncoder = (await import("node:util")).TextEncoder;
if (!globalThis.TextDecoder)
  globalThis.TextDecoder = (await import("node:util")).TextDecoder;

function load(relative) {
  const file = path.join(runtime, relative);
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
}

function card(operation) {
  const meta = globalThis.OzonOperationRegistry.operation(operation);
  assert(meta, "missing operation " + operation);
  const payload = globalThis.OzonGuidance.result({
    status: "section_selected",
    cluster: "advertising_performance",
    section: "statistics",
    version: 2,
  });
  assert.equal(payload.external_request_executed, false);
  assert.equal(payload.physical_business_request_count, 0);
  const item = payload.choices.find((choice) => choice.operation === operation);
  assert(item, "missing guidance card " + operation);
  return item;
}

function assertCompositePair(dailyAlias, productAlias, stage) {
  const daily = card(dailyAlias);
  const product = card(productAlias);
  for (const [item, role, peer] of [
    [daily, "DAY_GRAIN", productAlias],
    [product, "CAMPAIGN_PRODUCT_GRAIN", dailyAlias],
  ]) {
    assert.deepEqual(item.scenario_context.scenario_ids, ["CAP-18"], stage);
    assert.equal(item.scenario_context.coverage, "COMPOSITE", stage);
    assert.deepEqual(
      item.scenario_context.required_dimensions,
      ["campaign", "product", "day"],
      stage,
    );
    assert.equal(item.scenario_context.source_role, role, stage);
    assert.deepEqual(item.scenario_context.combine_with, [peer], stage);
    assert.equal(
      item.scenario_context.missing_dimensions_policy,
      "DO_NOT_INFER_FROM_SINGLE_SOURCE",
      stage,
    );
    assert.deepEqual(item.data_readiness, {
      mode: "DIRECT_RESPONSE",
      automatic_polling: false,
      report_status_required: false,
    });
  }
}

function assertReportReadiness(stage) {
  const status = card("performance_statistics_status");
  assert.deepEqual(
    status.data_readiness,
    {
      mode: "REPORT_STATUS_CHECK",
      may_be_pending: true,
      automatic_polling: false,
    },
    stage,
  );

  const download = card("performance_statistics_report_download");
  assert.deepEqual(
    download.data_readiness,
    {
      mode: "PREPARED_REPORT_DOWNLOAD",
      requires_prepared_report: true,
      automatic_polling: false,
    },
    stage,
  );
}

for (const relative of [
  "shared/runtime_names.js",
  "shared/ozon_operation_registry.js",
  "shared/ozon_entitlements.js",
  "shared/ozon_contract.js",
  "shared/ozon_guidance.js",
])
  load(relative);

assertCompositePair(
  "performance_daily",
  "performance_campaign_product",
  "base",
);
assertReportReadiness("base");

for (const relative of [
  "shared/ozon_credentials.js",
  "shared/provider_transport_core.js",
  "shared/ozon_provider.js",
  "shared/swagger_read_surface_patch.js",
])
  load(relative);

assert.equal(
  globalThis.OzonOperationRegistry.operation("performance_daily"),
  null,
);
assert.equal(
  globalThis.OzonOperationRegistry.operation("performance_campaign_product"),
  null,
);
assertCompositePair(
  "performance_daily_csv",
  "performance_campaign_product_csv",
  "patched",
);
assertReportReadiness("patched");

const reportStart = card("performance_statistics_report_create");
assert.deepEqual(reportStart.data_readiness, {
  mode: "ASYNC_REPORT_START",
  completion_not_immediate: true,
  automatic_polling: false,
  status_operation: "performance_statistics_status",
});
assert.equal(reportStart.template, null);
assert.equal(reportStart.template_runnable, false);
assert.equal(reportStart.workflow_role, "explicit_workflow_read_step");

for (const forbidden of [
  "expected_delay_seconds",
  "delay_seconds",
  "duration_seconds",
  "poll_interval_ms",
  "retry_after",
]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(reportStart.data_readiness, forbidden),
    false,
    "provider latency/poll duration must not be invented: " + forbidden,
  );
}

console.log(
  JSON.stringify({
    status: "PASS",
    evidence_level: "SOURCE_OR_EXTRACTED_RUNTIME_LOCAL",
    scenario: "CAP-18",
    final_direct_sources: [
      "performance_daily_csv",
      "performance_campaign_product_csv",
    ],
    required_composite_dimensions: ["campaign", "product", "day"],
    async_report_status_operation: "performance_statistics_status",
    automatic_polling: false,
    invented_latency: false,
    external_request_executed: false,
    physical_business_request_count: 0,
  }),
);
