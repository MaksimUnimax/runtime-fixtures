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
  "tests/regression/extension-core/fixtures/wb-sales-decline-causal-factor-reuse-v1.json",
);
const source = readJson(slice.reuse.salesDeclineEvidence);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const numeric = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

function factors(signals) {
  if (!signals || typeof signals !== "object")
    return { status: "INCOMPLETE", reason: "EVIDENCE_SIGNAL_INCOMPLETE" };
  const names = ["content_error", "orders_drop", "stock_zero", "ad_click_drop"];
  if (names.some((name) => typeof signals[name] !== "boolean"))
    return { status: "INCOMPLETE", reason: "EVIDENCE_SIGNAL_INCOMPLETE" };
  return {
    status: "COMPLETE",
    factors: names.filter((name) => signals[name]).sort(),
    claim: "HYPOTHESIS_NOT_PROVEN_CAUSE",
    likelihoodKnown: false,
  };
}

assert.equal(slice.schemaVersion, "wb_sales_decline_causal_factor_reuse_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-05"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.deepEqual(
  Object.values(slice.sources)
    .map((row) => row.operationAlias)
    .sort(),
  Object.values(source.sources)
    .map((row) => row.operationAlias)
    .sort(),
);

const std05 = scenarios.get("STD-05");
assert.ok(std05, "STD-05 missing");
assert.deepEqual(std05.wbOperations, slice.acceptedMappingSnapshot["STD-05"]);
assert.deepEqual(std05.numericFixtures, ["causal_factors"]);
assert.equal(std05.externalDependency, "OPTIONAL_BUSINESS_CONTEXT");
assert.equal(std05.omissionPolicy, "MISSING_NOT_ZERO");

const c = slice.syntheticCases;
assert.deepEqual(factors(c.complete.signals), c.complete.expected);
assert.deepEqual(factors(c.missing.signals), c.missing.expected);
assert.deepEqual(factors(c.noAdverse.signals), c.noAdverse.expected);

const numericCases = numeric.cases.filter(
  (row) => row.kind === "causal_factors",
);
assert.ok(numericCases.length >= 3, "causal_factors numeric cases missing");
for (const row of numericCases)
  assert.deepEqual(factors(row.input.signals), row.expected, row.id);

assert.equal(
  slice.rules.causality,
  "EVERY_FACTOR_IS_HYPOTHESIS_NOT_PROVEN_CAUSE",
);
assert.equal(
  slice.rules.likelihood,
  "NO_CAUSAL_PROBABILITY_OR_LIKELIHOOD_SCORE_FROM_CORRELATIONAL_SOURCE_SIGNALS",
);
assert.equal(
  slice.rules.ordering,
  "DETERMINISTIC_SIGNAL_NAME_ORDER_ONLY_NOT_LIKELIHOOD_ORDER",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "STD-05",
    operations: std05.wbOperations,
    causalProbabilityClaimed: false,
    missingSignalIsFalse: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
