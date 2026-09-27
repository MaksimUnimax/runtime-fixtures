import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const slice = readJson(
  "tests/regression/extension-core/fixtures/wb-sales-decline-evidence-reuse-v1.json",
);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const numeric = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json",
);
const content = readJson(slice.reuse.content);
const orders = readJson(slice.reuse.orders);
const stock = readJson(slice.reuse.stock);
const ads = readJson(slice.reuse.ads);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

assert.equal(slice.schemaVersion, "wb_sales_decline_evidence_reuse_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-06"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

assert.equal(
  content.sources.cardsErrors.operationAlias,
  slice.sources.content.operationAlias,
);
assert.equal(
  orders.sources.orders.operationAlias,
  slice.sources.orders.operationAlias,
);
assert.equal(
  stock.sources.stockProducts.operationAlias,
  slice.sources.stock.operationAlias,
);
assert.equal(
  ads.sources.promotion.operationAlias,
  slice.sources.ads.operationAlias,
);
assert.equal(
  stock.sources.stockProducts.metrics.stockCount.role,
  "current_stock_units",
);
assert.equal(ads.sources.promotion.fields.clicks.role, "clicks");

const std06 = scenarios.get("STD-06");
assert.ok(std06, "STD-06 missing");
assert.deepEqual(std06.wbOperations, slice.acceptedMappingSnapshot["STD-06"]);
assert.equal(std06.externalDependency, null);
assert.equal(std06.omissionPolicy, "MISSING_NOT_ZERO");
assert.deepEqual(std06.numericFixtures, ["attention_rank"]);
function rank(products) {
  if (!Array.isArray(products))
    return { status: "INCOMPLETE", reason: "EVIDENCE_ROWS_INVALID" };
  const seen = new Set();
  const ranked = [];
  for (const row of products) {
    if (
      !row ||
      typeof row.product !== "string" ||
      !row.product ||
      seen.has(row.product)
    )
      return { status: "INCOMPLETE", reason: "PRODUCT_IDENTITY_INVALID" };
    seen.add(row.product);
    const values = Object.values(row.signals || {});
    if (
      values.length !== 4 ||
      values.some((value) => typeof value !== "boolean")
    )
      return { status: "INCOMPLETE", reason: "EVIDENCE_SIGNAL_INCOMPLETE" };
    ranked.push({
      product: row.product,
      score: values.filter(Boolean).length,
    });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.product.localeCompare(b.product),
  );
}

const c = slice.syntheticCases;
assert.deepEqual(rank(c.complete.products), c.complete.expected);
assert.deepEqual(rank(c.missingSignal.products), c.missingSignal.expected);
assert.deepEqual(c.ambiguousContentIdentity.expected, {
  status: "INCOMPLETE",
  reason: "CONTENT_PRODUCT_IDENTITY_AMBIGUOUS",
});

const attention = numeric.cases.find((row) => row.id === "attention_rank");
assert.ok(attention, "attention_rank numeric fixture missing");
assert.equal(attention.kind, "attention_rank");
const numericProjection = attention.input.rows
  .map((row) => ({
    product: row.product,
    score: row.signals.filter((signal) => signal.present).length,
  }))
  .sort((a, b) => b.score - a.score || a.product.localeCompare(b.product));
assert.deepEqual(numericProjection, attention.expected);

const causal = numeric.cases.find(
  (row) => row.id === "causal_language_boundary",
);
assert.ok(causal, "causal_language_boundary missing");
assert.deepEqual(c.causalBoundary.expected, causal.expected);

assert.equal(
  slice.rules.attentionScore,
  "COUNT_PRESENT_COMPLETE_SIGNALS_EQUAL_WEIGHT",
);
assert.equal(
  slice.rules.ordinalOnly,
  "SCORE_IS_TRIAGE_ORDINAL_NOT_PROBABILITY_IMPACT_OR_CAUSAL_WEIGHT",
);
assert.equal(
  slice.rules.causality,
  "ALL_RANKED_FACTORS_REMAIN_HYPOTHESES_NOT_PROVEN_CAUSES",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-06",
    operations: Object.values(slice.sources).map(
      (source) => source.operationAlias,
    ),
    attentionRankUnweighted: true,
    causalClaimProven: false,
    missingSignalIsFalse: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
