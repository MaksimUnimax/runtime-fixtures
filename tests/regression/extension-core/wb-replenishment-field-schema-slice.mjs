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
  "tests/regression/extension-core/fixtures/wb-replenishment-field-schema-slice-v1.json",
);
const turnover = readJson(slice.reuse.fixture);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

assert.equal(slice.schemaVersion, "wb_replenishment_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-07"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(turnover.schemaVersion, slice.reuse.requiredSchemaVersion);
assert.deepEqual(slice.reuse.operations, [
  "stock_products",
  "statistics_sales",
]);
assert.equal(turnover.rules.customDaysCover, slice.reuse.customDaysCoverRule);
const std07 = scenarios.get("STD-07");
assert.ok(std07, "STD-07 missing");
assert.deepEqual(std07.wbOperations, slice.acceptedMappingSnapshot["STD-07"]);
assert.equal(std07.omissionPolicy, "MISSING_NOT_ZERO");
assert.deepEqual(std07.numericFixtures, ["days_cover"]);

function daysCover(stockUnits, averageDailyDemandUnits) {
  if (!Number.isFinite(stockUnits) || stockUnits < 0)
    return { status: "INCOMPLETE", reason: "STOCK_INVALID" };
  if (
    averageDailyDemandUnits === null ||
    averageDailyDemandUnits === undefined ||
    !Number.isFinite(averageDailyDemandUnits) ||
    averageDailyDemandUnits === 0
  )
    return { status: "UNKNOWN_DEMAND" };
  if (averageDailyDemandUnits < 0)
    return { status: "INCOMPLETE", reason: "NEGATIVE_DEMAND" };
  return { status: "FINITE", value: stockUnits / averageDailyDemandUnits };
}

function priority(rows) {
  const finite = [];
  const unknownDemandProductIds = [];
  for (const row of rows) {
    if (!Number.isInteger(row.productId))
      return { status: "INCOMPLETE", reason: "PRODUCT_ID_INVALID" };
    const cover = daysCover(row.stockUnits, row.averageDailyDemandUnits);
    if (cover.status === "INCOMPLETE") return cover;
    if (cover.status === "UNKNOWN_DEMAND") {
      unknownDemandProductIds.push(row.productId);
      continue;
    }
    finite.push({ productId: row.productId, cover: cover.value });
  }
  finite.sort((a, b) => a.cover - b.cover || a.productId - b.productId);
  return {
    urgentProductIds: finite.map((row) => row.productId),
    daysCover: Object.fromEntries(
      finite.map((row) => [String(row.productId), row.cover]),
    ),
    unknownDemandProductIds,
    exactOrderQuantities: null,
  };
}
function durationDays(value) {
  if (
    !value ||
    !Number.isFinite(value.days) ||
    !Number.isFinite(value.hours) ||
    value.days < 0 ||
    value.hours < 0 ||
    value.hours >= 24
  )
    return null;
  return value.days + value.hours / 24;
}

function slowMovers(rows, thresholdDays) {
  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0)
    return {
      status: "INCOMPLETE",
      reason: "SLOW_MOVER_THRESHOLD_REQUIRED",
    };
  const slowMoverIds = [];
  for (const row of rows) {
    if (!Number.isInteger(row.productId))
      return { status: "INCOMPLETE", reason: "PRODUCT_ID_INVALID" };
    const value = durationDays(row.avgStockTurnover);
    if (value === null)
      return { status: "INCOMPLETE", reason: "TURNOVER_DURATION_INVALID" };
    if (value > thresholdDays) slowMoverIds.push(row.productId);
  }
  return { slowMoverIds };
}

function exactOrderQuantity(row) {
  if (
    !Number.isFinite(row.leadTimeDays) ||
    !Number.isFinite(row.targetStockDays) ||
    row.leadTimeDays < 0 ||
    row.targetStockDays <= 0
  )
    return {
      status: "INCOMPLETE",
      reason: "LEAD_TIME_AND_TARGET_STOCK_REQUIRED",
    };
  return {
    status: "INCOMPLETE",
    reason: "EXACT_ORDER_FORMULA_NOT_ACCEPTED",
  };
}
const c = slice.syntheticCases;
assert.deepEqual(priority(c.priority.rows), c.priority.expected);
assert.deepEqual(
  slowMovers(c.slowMover.rows, c.slowMover.thresholdDays),
  c.slowMover.expected,
);
assert.deepEqual(
  slowMovers(c.missingSlowThreshold.rows, c.missingSlowThreshold.thresholdDays),
  c.missingSlowThreshold.expected,
);
assert.deepEqual(
  exactOrderQuantity(c.exactOrderWithoutInputs),
  c.exactOrderWithoutInputs.expected,
);
assert.deepEqual(
  exactOrderQuantity(c.exactOrderWithoutAcceptedFormula),
  c.exactOrderWithoutAcceptedFormula.expected,
);
assert.deepEqual(
  priority(c.invalidStockPriority.rows),
  c.invalidStockPriority.expected,
);
assert.deepEqual(
  priority(c.negativeDemandPriority.rows),
  c.negativeDemandPriority.expected,
);

assert.equal(
  slice.rules.urgency,
  "FINITE_DAYS_COVER_SORT_ASCENDING_STABLE_BY_PRODUCT_ID",
);
assert.equal(
  slice.rules.exactOrderQuantity,
  "REQUIRES_LEAD_TIME_TARGET_STOCK_AND_ACCEPTED_BUSINESS_FORMULA",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-07",
    reusedOperations: slice.reuse.operations,
    exactOrderQuantityWithoutInputs: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
