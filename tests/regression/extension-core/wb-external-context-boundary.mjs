import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const slice = readJson(
  "tests/regression/extension-core/fixtures/wb-external-context-boundary-v1.json",
);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const stock = readJson(slice.reuse.stock);
const warehouse = readJson(slice.reuse.warehouse);
const catalog = readJson(slice.reuse.catalog);

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, relative), "utf8"), context, {
    filename: relative,
  });
  return context[name];
}

const wb = loadGlobal(
  coverage.authorities.wildberries.registryPath,
  "WBOperations",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

function assertAlias(alias) {
  const meta = wb.OPERATIONS[alias];
  assert.ok(meta, "missing WB operation " + alias);
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
}

function incidentBoundary(input) {
  if (
    !input.incident ||
    typeof input.incident.url !== "string" ||
    !input.incident.url ||
    typeof input.incident.date !== "string" ||
    !input.incident.date
  )
    return { status: "INCOMPLETE", reason: "PUBLIC_INCIDENT_SOURCE_MISSING" };
  if (
    !input.currentPrivate ||
    typeof input.currentPrivate.product !== "string" ||
    typeof input.currentPrivate.warehouse !== "string" ||
    !Number.isInteger(input.currentPrivate.stockUnits)
  )
    return { status: "INCOMPLETE", reason: "CURRENT_PRIVATE_FACT_MISSING" };
  return {
    status: "BOUNDARY",
    publicIncidentCited: true,
    currentPrivateFactKnown: true,
    historicalPresenceKnown: false,
    historicalPresence: null,
  };
}

function externalFacts(input) {
  if (
    !Array.isArray(input.privateFacts) ||
    !Array.isArray(input.publicFacts) ||
    !Array.isArray(input.hypotheses)
  )
    return { status: "INCOMPLETE", reason: "FACT_CLASSES_MISSING" };
  if (
    input.publicFacts.some(
      (row) => !row || typeof row.url !== "string" || !row.url,
    )
  )
    return { status: "INCOMPLETE", reason: "PUBLIC_FACT_SOURCE_MISSING" };
  return {
    status: "COMPLETE",
    privateFactCount: input.privateFacts.length,
    publicFactCount: input.publicFacts.length,
    hypothesisCount: input.hypotheses.length,
    classesSeparated: true,
  };
}

function competitorBoundary(input) {
  if (!input.ownCard || !Array.isArray(input.competitors))
    return { status: "INCOMPLETE", reason: "COMPETITOR_CONTEXT_MISSING" };
  if (
    input.competitors.some(
      (row) =>
        row && row.privateSales !== null && row.privateSales !== undefined,
    )
  )
    return {
      status: "INCOMPLETE",
      reason: "COMPETITOR_PRIVATE_METRIC_FORBIDDEN",
    };
  const comparable = input.competitors.filter(
    (row) =>
      row &&
      row.comparable === true &&
      typeof row.url === "string" &&
      row.url &&
      typeof row.publicTitle === "string" &&
      row.publicTitle,
  );
  if (comparable.length === 0)
    return {
      status: "INCOMPLETE",
      reason: "COMPARABLE_PUBLIC_COMPETITOR_MISSING",
    };
  return {
    status: "BOUNDARY",
    comparablePublicCompetitors: comparable.length,
    privateCompetitorSalesKnown: false,
    privateCompetitorSales: null,
  };
}

assert.equal(slice.schemaVersion, "wb_external_context_boundary_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-10", "CAP-20", "CAP-22"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

for (const source of Object.values(slice.sources))
  for (const alias of source.operations) assertAlias(alias);

assert.equal(
  stock.sources.wbWarehouses.operationAlias,
  "wb_warehouse_stocks",
);
assert.equal(
  warehouse.sources.marketplaceOffices.operationAlias,
  "marketplace_offices",
);
assert.equal(catalog.source.operationAlias, "cards_list");

for (const id of slice.scope.scenarioIds) {
  const row = scenarios.get(id);
  assert.ok(row, id + " missing");
  assert.deepEqual(row.wbOperations, slice.acceptedMappingSnapshot[id]);
  assert.equal(row.omissionPolicy, "MISSING_NOT_ZERO");
}
assert.equal(
  scenarios.get("STD-10").externalDependency,
  "PUBLIC_INCIDENT_DATE_LINK_REQUIRED",
);
assert.equal(
  scenarios.get("CAP-20").externalDependency,
  "AI_PUBLIC_RESEARCH_REQUIRED",
);
assert.equal(
  scenarios.get("CAP-22").externalDependency,
  "PUBLIC_COMPETITOR_PAGES_OR_OWNER_LINKS_REQUIRED",
);
assert.deepEqual(scenarios.get("STD-10").numericFixtures, [
  "incident_boundary",
]);
assert.deepEqual(scenarios.get("CAP-20").numericFixtures, [
  "external_fact_boundary",
]);
assert.deepEqual(scenarios.get("CAP-22").numericFixtures, [
  "competitor_boundary",
]);

const c = slice.syntheticCases;
assert.deepEqual(incidentBoundary(c.incidentKnown), c.incidentKnown.expected);
assert.deepEqual(
  incidentBoundary(c.incidentMissingCitation),
  c.incidentMissingCitation.expected,
);
assert.deepEqual(externalFacts(c.externalFacts), c.externalFacts.expected);
assert.deepEqual(competitorBoundary(c.competitors), c.competitors.expected);
assert.deepEqual(
  competitorBoundary(c.competitorPrivateMetricInvented),
  c.competitorPrivateMetricInvented.expected,
);

assert.equal(
  slice.rules.historicalStock,
  "CURRENT_STOCK_DOES_NOT_PROVE_PRODUCT_WAS_PRESENT_AT_HISTORICAL_INCIDENT_TIME",
);
assert.equal(
  slice.rules.competitorPrivateMetrics,
  "DO_NOT_INVENT_COMPETITOR_SALES_CONVERSION_STOCK_OR_PRIVATE_ANALYTICS",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenarios: slice.scope.scenarioIds,
    historicalIncidentPresenceInferred: false,
    publicFactsRequireCitation: true,
    competitorPrivateMetricsInvented: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
