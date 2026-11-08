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
  const value = stockUnits / averageDailyDemandUnits;
  if (!Number.isFinite(value))
    return { status: "INCOMPLETE", reason: "DAYS_COVER_NONFINITE" };
  return { status: "FINITE", value };
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

let finitePriorityCases = 0;
function checkFinitePriority(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  finitePriorityCases++;
}
const nonfiniteCover = {
  status: "INCOMPLETE",
  reason: "DAYS_COVER_NONFINITE",
};
for (const [stock, demand] of [
  [Number.MAX_VALUE, 0.5],
  [Number.MAX_VALUE, Number.MIN_VALUE],
  [1, Number.MIN_VALUE],
  [Number.MAX_VALUE / 2, 0.25],
]) {
  checkFinitePriority(
    daysCover(stock, demand),
    nonfiniteCover,
    "finite operands must not produce FINITE Infinity",
  );
  const overflowRow = {
    productId: 9,
    stockUnits: stock,
    averageDailyDemandUnits: demand,
  };
  for (const rows of [
    [overflowRow],
    [overflowRow, c.priority.rows[0]],
    [c.priority.rows[0], overflowRow],
  ]) {
    const result = priority(rows);
    checkFinitePriority(result, nonfiniteCover, "overflow blocks whole priority");
    checkFinitePriority(
      JSON.parse(JSON.stringify(result)),
      nonfiniteCover,
      "overflow must not become a successful null days-cover value in JSON",
    );
  }
}
for (const [stock, demand, expected] of [
  [Number.MAX_VALUE, 1, Number.MAX_VALUE],
  [Number.MAX_VALUE, Number.MAX_VALUE, 1],
  [Number.MAX_VALUE / 2, 0.5, Number.MAX_VALUE],
  [Number.MIN_VALUE, Number.MIN_VALUE, 1],
  [Number.MIN_VALUE, 1, Number.MIN_VALUE],
  [0, Number.MIN_VALUE, 0],
  [-0, Number.MIN_VALUE, -0],
  [3, 2, 1.5],
]) {
  const result = daysCover(stock, demand);
  checkFinitePriority(result, { status: "FINITE", value: expected }, "finite boundary");
  assert.ok(Number.isFinite(result.value));
}
for (const demand of [null, undefined, NaN, Infinity, -Infinity, 0, -0, "2"])
  checkFinitePriority(daysCover(3, demand), { status: "UNKNOWN_DEMAND" }, "unknown demand retained");
for (const stock of [-1, NaN, Infinity, -Infinity, null, undefined, "3"])
  checkFinitePriority(daysCover(stock, 2), { status: "INCOMPLETE", reason: "STOCK_INVALID" }, "invalid stock retained");
checkFinitePriority(daysCover(3, -1), { status: "INCOMPLETE", reason: "NEGATIVE_DEMAND" }, "negative demand retained");
checkFinitePriority(priority([]), {
  urgentProductIds: [], daysCover: {}, unknownDemandProductIds: [], exactOrderQuantities: null,
}, "empty input retained");
const tiedRows = [
  { productId: 3, stockUnits: 4, averageDailyDemandUnits: 2 },
  { productId: 2, stockUnits: 0, averageDailyDemandUnits: Number.MIN_VALUE },
  { productId: 4, stockUnits: 5, averageDailyDemandUnits: 0 },
  { productId: 1, stockUnits: 2, averageDailyDemandUnits: 1 },
];
const tiedExpected = {
  urgentProductIds: [2, 1, 3], daysCover: { 2: 0, 1: 2, 3: 2 },
  unknownDemandProductIds: [4], exactOrderQuantities: null,
};
for (const rows of [tiedRows, [...tiedRows].reverse()])
  checkFinitePriority(priority(rows), tiedExpected, "zero stock and product-ID ties retained");
const frozenRows = Object.freeze(tiedRows.map((row) => Object.freeze({ ...row })));
const frozenBefore = JSON.stringify(frozenRows);
checkFinitePriority(priority(frozenRows), tiedExpected, "frozen input supported");
checkFinitePriority(JSON.stringify(frozenRows), frozenBefore, "input not mutated");
const detached = priority(frozenRows);
detached.urgentProductIds.push(999);
detached.daysCover[1] = 999;
detached.unknownDemandProductIds.push(999);
checkFinitePriority(priority(frozenRows), tiedExpected, "return values detached");
for (const productId of [null, undefined, "1", NaN, Infinity, 1.5])
  checkFinitePriority(priority([{ productId, stockUnits: 3, averageDailyDemandUnits: 1 }]),
    { status: "INCOMPLETE", reason: "PRODUCT_ID_INVALID" }, "product-ID validation retained");

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
    finitePriorityCases,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
