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
  "tests/regression/extension-core/fixtures/wb-standard-supply-acceptance-stock-reuse-v1.json",
);
const acceptance = readJson(slice.reuse.acceptanceFixture);
const stock = readJson(slice.reuse.stockFixture);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

assert.equal(
  slice.schemaVersion,
  "wb_standard_supply_acceptance_stock_reuse_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["STD-13"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(acceptance.schemaVersion, slice.reuse.acceptanceSchemaVersion);
assert.equal(stock.schemaVersion, slice.reuse.stockSchemaVersion);

const std13 = scenarios.get("STD-13");
assert.ok(std13, "STD-13 missing");
assert.deepEqual(std13.wbOperations, slice.acceptedMappingSnapshot["STD-13"]);
assert.equal(std13.continuationPolicy, "EXPLICIT_REPORT_LIFECYCLE");
assert.equal(std13.omissionPolicy, "MISSING_NOT_ZERO");
const statusIds = new Set(acceptance.sources.fbwSupply.statusIDs);
assert.equal(
  acceptance.sources.fbwSupplyGoods.fields.acceptedQuantity.role,
  "accepted_units",
);
assert.equal(
  acceptance.sources.acceptanceDownload.fields.count.role,
  "accepted_report_units",
);
assert.equal(
  stock.sources.stockProducts.metrics.stockCount.role,
  "current_stock_units",
);
assert.equal(stock.sources.stockProducts.inventoryMeaning, "CURRENT_DAY");

function groupGoods(goods) {
  const totals = new Map();
  for (const row of goods) {
    if (
      !row ||
      !Number.isInteger(row.nmID) ||
      typeof row.barcode !== "string" ||
      !row.barcode ||
      !Number.isInteger(row.acceptedQuantity) ||
      row.acceptedQuantity < 0
    )
      return { status: "INCOMPLETE", reason: "SUPPLY_GOODS_ROW_INVALID" };
    totals.set(row.nmID, (totals.get(row.nmID) ?? 0) + row.acceptedQuantity);
  }
  return totals;
}

function groupReport(statuses, rows) {
  if (!Array.isArray(statuses) || statuses.length === 0)
    return { status: "INCOMPLETE", reason: "REPORT_STATUS_MISSING" };
  const final = statuses.at(-1);
  if (final === "canceled")
    return { status: "INCOMPLETE", reason: "REPORT_TASK_CANCELED" };
  if (final === "purged")
    return { status: "INCOMPLETE", reason: "REPORT_TASK_PURGED" };
  if (final !== "done")
    return { status: "INCOMPLETE", reason: "REPORT_NOT_DONE" };
  const totals = new Map();
  for (const row of rows) {
    if (
      !row ||
      !Number.isInteger(row.incomeId) ||
      !Number.isInteger(row.nmID) ||
      !Number.isInteger(row.count) ||
      row.count < 0
    )
      return { status: "INCOMPLETE", reason: "REPORT_ROWS_INVALID" };
    totals.set(row.nmID, (totals.get(row.nmID) ?? 0) + row.count);
  }
  return totals;
}
function stockByProduct(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (
      !row ||
      !Number.isInteger(row.nmID) ||
      !row.metrics ||
      !Number.isInteger(row.metrics.stockCount) ||
      row.metrics.stockCount < 0
    )
      return { status: "INCOMPLETE", reason: "CURRENT_STOCK_ROW_INVALID" };
    if (totals.has(row.nmID))
      return {
        status: "INCOMPLETE",
        reason: "DUPLICATE_CURRENT_STOCK_PRODUCT",
      };
    totals.set(row.nmID, row.metrics.stockCount);
  }
  return totals;
}

function summarize(input) {
  if (
    !input.supply ||
    !Number.isInteger(input.supply.statusID) ||
    !statusIds.has(input.supply.statusID)
  )
    return { status: "INCOMPLETE", reason: "UNKNOWN_SUPPLY_STATUS_ID" };
  if (
    !Number.isInteger(input.supply.acceptedQuantity) ||
    input.supply.acceptedQuantity < 0
  )
    return {
      status: "INCOMPLETE",
      reason: "SUPPLY_ACCEPTED_QUANTITY_INVALID",
    };
  if (input.goodsPagesComplete !== true)
    return {
      status: "INCOMPLETE",
      reason: "SUPPLY_GOODS_PAGINATION_INCOMPLETE",
    };

  const goods = groupGoods(input.goods);
  if (goods instanceof Map === false) return goods;
  const directTotal = [...goods.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  if (directTotal !== input.supply.acceptedQuantity)
    return {
      status: "INCOMPLETE",
      reason: "SUPPLY_GOODS_ACCEPTED_TOTAL_MISMATCH",
    };

  const report = groupReport(input.reportStatuses, input.reportRows);
  if (report instanceof Map === false) return report;
  const current = stockByProduct(input.stockRows);
  if (current instanceof Map === false) return current;

  const products = [...goods.keys()].sort((a, b) => a - b);
  for (const nmID of products) {
    if (!report.has(nmID))
      return { status: "INCOMPLETE", reason: "REPORT_PRODUCT_MISSING" };
    if (!current.has(nmID))
      return { status: "INCOMPLETE", reason: "CURRENT_STOCK_MISSING" };
  }
  if (report.size !== products.length || current.size !== products.length)
    return { status: "INCOMPLETE", reason: "PRODUCT_SET_MISMATCH" };

  return {
    status: "PASS",
    providerSupplyStatusId: input.supply.statusID,
    supplyAcceptedUnits: input.supply.acceptedQuantity,
    products: products.map((nmID) => ({
      nmID,
      directAcceptedUnits: goods.get(nmID),
      reportAcceptedUnits: report.get(nmID),
      currentStockUnits: current.get(nmID),
    })),
  };
}
const c = slice.syntheticCases;
assert.deepEqual(summarize(c.complete), c.complete.expected);
assert.deepEqual(summarize(c.reportNotDone), c.reportNotDone.expected);
assert.deepEqual(
  summarize(c.goodsPaginationIncomplete),
  c.goodsPaginationIncomplete.expected,
);
assert.deepEqual(summarize(c.missingStock), c.missingStock.expected);
assert.deepEqual(
  summarize(c.unknownSupplyStatus),
  c.unknownSupplyStatus.expected,
);

const complete = summarize(c.complete);
assert.equal(complete.status, "PASS");
assert.notEqual(
  complete.products[0].directAcceptedUnits,
  complete.products[0].currentStockUnits,
  "accepted units and current stock must remain distinct metrics",
);
assert.equal(
  slice.rules.distinct,
  "DIRECT_ACCEPTED_REPORT_ACCEPTED_AND_CURRENT_STOCK_ARE_DISTINCT_METRICS",
);
assert.equal(
  slice.rules.difference,
  "METRIC_DIFFERENCE_DOES_NOT_PROVE_LOSS_WRITEOFF_OR_CAUSALITY",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-13",
    reusedSchemas: [
      slice.reuse.acceptanceSchemaVersion,
      slice.reuse.stockSchemaVersion,
    ],
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
