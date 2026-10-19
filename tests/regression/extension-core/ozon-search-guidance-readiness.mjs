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
    cluster: meta.cluster,
    section: meta.section,
    version: 2,
  });
  assert.equal(payload.external_request_executed, false);
  assert.equal(payload.physical_business_request_count, 0);
  const item = payload.choices.find((choice) => choice.operation === operation);
  assert(item, "missing guidance card " + operation);
  return item;
}

function assertCommon(item, sourceRole, peer, stage) {
  assert(item.entitlement, stage + ": entitlement must remain present");
  assert.equal(item.entitlement.applies_to, "GUIDANCE_TEMPLATE", stage);
  assert.equal(item.entitlement.runtime_preflight_authoritative, true, stage);
  assert.deepEqual(item.scenario_context.scenario_ids, ["CAP-21"], stage);
  assert.equal(item.scenario_context.coverage, "COMPOSITE", stage);
  assert.deepEqual(
    item.scenario_context.required_dimensions,
    ["product", "search_text"],
    stage,
  );
  assert.equal(item.scenario_context.source_role, sourceRole, stage);
  assert.deepEqual(item.scenario_context.combine_with, [peer], stage);
  assert.equal(
    item.scenario_context.provider_search_fact_policy,
    "QUERY_FREQUENCY_POSITION_ONLY_IF_RETURNED",
    stage,
  );
  assert.equal(
    item.scenario_context.ai_suggestion_policy,
    "SEPARATE_NOT_PROVIDER_FACTS",
    stage,
  );
  assert.equal(
    item.scenario_context.missing_search_metric_policy,
    "INCOMPLETE_NOT_ZERO",
    stage,
  );
}

function assertCap21(stage) {
  const search = card("product_queries");
  const content = card("product_content_rating");

  assertCommon(
    search,
    "PROVIDER_SEARCH_FACTS",
    "product_content_rating",
    stage,
  );
  assertCommon(
    content,
    "OWN_CARD_CONTENT_FACTS",
    "product_queries",
    stage,
  );

  assert.deepEqual(search.data_readiness, {
    mode: "DIRECT_RESPONSE",
    automatic_continuation: false,
    provider_fact_scope: "RETURNED_ROWS_ONLY",
    exhaustive_semantic_query_universe: false,
    missing_provider_metric_policy: "INCOMPLETE_NOT_ZERO",
    ai_suggestions_are_provider_facts: false,
    runtime_entitlement_authoritative: true,
  });

  assert.deepEqual(content.data_readiness, {
    mode: "DIRECT_RESPONSE",
    automatic_continuation: false,
    contains_search_metrics: false,
    search_fact_source: "product_queries",
    recommendation_role: "OWN_CARD_CONTENT_CONTEXT",
  });
}

for (const relative of [
  "shared/runtime_names.js",
  "shared/ozon_operation_registry.js",
  "shared/ozon_entitlements.js",
  "shared/ozon_contract.js",
  "shared/ozon_guidance.js",
])
  load(relative);

assertCap21("base");

for (const relative of [
  "shared/ozon_credentials.js",
  "shared/provider_transport_core.js",
  "shared/ozon_provider.js",
  "shared/swagger_read_surface_patch.js",
])
  load(relative);

assertCap21("patched");

// A validated initial Seller/Performance API URL must not silently follow a
// redirect while still carrying provider header values. Use synthetic headers
// and an in-memory fetch stub; never perform a network request here.
async function assertFixedProviderJsonRedirectMode() {
  const cases = [
    {
      label: "Seller",
      execute: globalThis.ProviderTransportCore.executeJsonOnce,
      url: "https://api-seller.ozon.ru/v1/analytics/data",
      headers: { "Client-Id": "synthetic-id", "Api-Key": "synthetic-key" },
    },
    {
      label: "Performance",
      execute: globalThis.ProviderTransportCore.executePerformanceJsonOnce,
      url: "https://api-performance.ozon.ru/api/client/campaign",
      headers: { Authorization: "Bearer synthetic-nonsecret" },
    },
  ];
  for (const item of cases) {
    for (const method of ["GET", "POST"]) {
      let requests = 0;
      const body = method === "POST" ? '{"synthetic":true}' : undefined;
      const request = { url: item.url, method, headers: item.headers, body };
      const result = await item.execute({
        request,
        fetchImpl: async (url, init) => {
          requests += 1;
          assert.equal(url, item.url, item.label + " must use its fixed origin");
          assert.equal(init.redirect, "error", item.label + " must refuse HTTP redirects");
          assert.equal(init.method, method);
          assert.deepEqual(init.headers, item.headers);
          assert.equal(init.body, body);
          return {
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            text: async () => '{"ok":true}',
          };
        },
      });
      assert.equal(requests, 1, item.label + " must dispatch one physical request");
      assert.equal(result.ok, true);
      assert.equal(result.parsed.ok, true);
    }
    await assert.rejects(
      item.execute({
        request: { url: item.url, method: "GET", headers: item.headers },
        fetchImpl: async (_url, init) => {
          assert.equal(init.redirect, "error");
          throw new Error("synthetic redirect blocked before any follow-up request");
        },
      }),
      (error) => error?.code === "PROVIDER_FETCH_FAILED" &&
        error?.external_request_executed === true,
      item.label + " redirect must fail closed without a retry",
    );
  }
}
await assertFixedProviderJsonRedirectMode();

console.log(
  JSON.stringify({
    status: "PASS",
    evidence_level: "SOURCE_OR_EXTRACTED_RUNTIME_LOCAL",
    scenario: "CAP-21",
    provider_search_fact_source: "product_queries",
    content_context_source: "product_content_rating",
    exhaustive_semantic_query_universe: false,
    ai_suggestions_are_provider_facts: false,
    missing_provider_metric_policy: "INCOMPLETE_NOT_ZERO",
    external_request_executed: false,
    physical_business_request_count: 0,
  }),
);
