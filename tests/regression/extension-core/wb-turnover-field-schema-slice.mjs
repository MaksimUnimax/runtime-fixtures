import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const slice = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-turnover-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(relative), context, { filename: relative });
  return context[name];
}
const wb = loadGlobal(
  coverage.authorities.wildberries.registryPath,
  "WBOperations",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

function assertOperation(source) {
  const meta = wb.OPERATIONS[source.operationAlias];
  assert.ok(meta, "missing WB operation " + source.operationAlias);
  assert.equal(meta.host, source.host);
  assert.equal(meta.method, source.method);
  assert.equal(meta.path, source.path);
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

assert.equal(slice.schemaVersion, "wb_turnover_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-05"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
const stock = slice.sources.stockProducts;
const sales = slice.sources.statisticsSales;
assert.match(stock.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.match(sales.url, /^https:\/\/dev\.wildberries\.ru\//);
assertOperation(stock);
assertOperation(sales);
assert.equal(stock.updateMinutes, 60);
assert.equal(stock.inventoryMeaning, "CURRENT_DAY");
assert.deepEqual(stock.rowGrain, ["nmID"]);
assert.deepEqual(stock.stockTypes, ["", "wb", "mp"]);
assert.equal(stock.requestFields.currentPeriod, "required_period");
assert.equal(stock.requestFields.stockType, "required_warehouse_type");
assert.equal(stock.metrics.stockCount.role, "current_stock_units");
assert.equal(stock.metrics.saleRate.unit, "days_hours");
assert.equal(stock.metrics.avgStockTurnover.unit, "days_hours");
assert.notEqual(
  stock.metrics.saleRate.role,
  stock.metrics.avgStockTurnover.role,
  "provider sale rate and average turnover must remain distinct",
);
assert.equal(sales.dataClass, "PRELIMINARY_OPERATIONAL");
assert.equal(sales.rowMeaning, "ONE_SALE_OR_RETURN_ONE_ITEM");
assert.equal(
  sales.demandBoundary,
  "SALE_AND_RETURN_ROWS_REQUIRE_EXPLICIT_BUSINESS_CLASSIFICATION_BEFORE_CUSTOM_DEMAND_RATE",
);

const cap05 = scenarios.get("CAP-05");
assert.ok(cap05, "CAP-05 missing");
assert.deepEqual(cap05.wbOperations, slice.acceptedMappingSnapshot["CAP-05"]);
assert.equal(cap05.omissionPolicy, "MISSING_NOT_ZERO");

function durationHours(value) {
  if (
    !value ||
    !Number.isFinite(value.days) ||
    !Number.isFinite(value.hours) ||
    value.days < 0 ||
    value.hours < 0 ||
    value.hours >= 24
  )
    return null;
  return value.days * 24 + value.hours;
}
function projectProviderMetric(row) {
  if (!row || !Number.isInteger(row.nmID) || !row.metrics)
    return { status: "INCOMPLETE", reason: "PROVIDER_ROW_INVALID" };
  const m = row.metrics;
  if (
    !Number.isFinite(m.stockCount) ||
    m.stockCount < 0 ||
    durationHours(m.saleRate) === null ||
    durationHours(m.avgStockTurnover) === null ||
    typeof m.availability !== "string"
  )
    return { status: "INCOMPLETE", reason: "PROVIDER_METRIC_INVALID" };
  return {
    productId: row.nmID,
    stockUnits: m.stockCount,
    providerSaleRateHours: durationHours(m.saleRate),
    providerAverageTurnoverHours: durationHours(m.avgStockTurnover),
    availability: m.availability,
  };
}

function customDaysCover(stockUnits, averageDailyDemandUnits) {
  if (stockUnits === undefined || stockUnits === null)
    return { status: "INCOMPLETE", reason: "STOCK_MISSING" };
  if (!Number.isFinite(stockUnits) || stockUnits < 0)
    return { status: "INCOMPLETE", reason: "STOCK_INVALID" };
  if (averageDailyDemandUnits === null || averageDailyDemandUnits === undefined)
    return null;
  if (!Number.isFinite(averageDailyDemandUnits)) return null;
  if (averageDailyDemandUnits < 0)
    return { status: "INCOMPLETE", reason: "NEGATIVE_DEMAND" };
  if (averageDailyDemandUnits === 0) return null;
  return stockUnits / averageDailyDemandUnits;
}

assert.deepEqual(
  projectProviderMetric(slice.syntheticCases.providerMetric.row),
  slice.syntheticCases.providerMetric.expected,
);
for (const c of slice.syntheticCases.customDaysCover)
  assert.deepEqual(
    customDaysCover(c.stockUnits, c.averageDailyDemandUnits),
    c.expected,
  );
const negative = slice.syntheticCases.negativeDemand;
assert.deepEqual(
  customDaysCover(negative.stockUnits, negative.averageDailyDemandUnits),
  negative.expected,
);
assert.deepEqual(
  customDaysCover(
    slice.syntheticCases.missingStock.stockUnits,
    slice.syntheticCases.missingStock.averageDailyDemandUnits,
  ),
  slice.syntheticCases.missingStock.expected,
);

assert.equal(
  slice.rules.providerTurnover,
  "USE_PROVIDER_AVG_STOCK_TURNOVER_DAYS_HOURS_AS_REPORTED_DO_NOT_EQUATE_WITH_CUSTOM_DAYS_COVER",
);
assert.equal(
  slice.rules.customDaysCover,
  "STOCK_UNITS_DIVIDED_BY_EXPLICIT_COMPARABLE_AVERAGE_DAILY_DEMAND_ONLY",
);
assert.equal(slice.rules.zeroDemand, "ZERO_OR_UNKNOWN_DEMAND_RETURNS_NULL");
assert.equal(
  slice.rules.salesBoundary,
  "PRELIMINARY_SALE_RETURN_ROWS_ARE_NOT_AUTOMATICALLY_NET_DEMAND",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [stock.operationAlias, sales.operationAlias],
    providerTurnoverDistinct: true,
    customDaysCoverExplicitDemandOnly: true,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
