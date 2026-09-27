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
    "tests/regression/extension-core/fixtures/wb-operational-sales-field-schema-slice-v1.json",
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

assert.equal(slice.schemaVersion, "wb_operational_sales_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-01", "STD-02", "STD-04"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

for (const id of slice.scope.scenarioIds) {
  const scenario = scenarios.get(id);
  assert.ok(scenario, `${id}: accepted coverage row missing`);
  assert.equal(scenario.omissionPolicy, "MISSING_NOT_ZERO");
}
assert.deepEqual(scenarios.get("STD-01").wbOperations, [
  "statistics_orders",
  "statistics_sales",
]);
assert.deepEqual(scenarios.get("STD-02").wbOperations, [
  "statistics_orders",
  "sales_funnel_history",
]);
assert.deepEqual(scenarios.get("STD-04").wbOperations, ["statistics_orders"]);
function assertOperation(alias, expected) {
  const meta = wb.OPERATIONS[alias];
  assert.ok(meta, `missing WB operation ${alias}`);
  assert.equal(meta.host, expected.host, `${alias}: host drift`);
  assert.equal(meta.method, expected.method, `${alias}: method drift`);
  assert.equal(meta.path, expected.path, `${alias}: path drift`);
  assert.equal(meta.effect, "READ", `${alias}: must remain read-only`);
  assert.equal(meta.execution_enabled, true, `${alias}: operation disabled`);
  assert.equal(meta.current, true, `${alias}: operation no longer current`);
}

const orders = slice.sources.orders;
assert.match(orders.url, /^https:\/\/dev\.wildberries\.ru\//);
assertOperation(orders.operationAlias, orders);
assert.equal(orders.updateMinutes, 30);
assert.equal(orders.storageGuaranteeDays, 90);
assert.equal(orders.dataClass, "PRELIMINARY_OPERATIONAL");
assert.deepEqual(orders.rowGrain, ["srid"]);
assert.equal(orders.rowMeaning, "ONE_ORDER_ONE_ITEM");
assert.equal(orders.authoritativeRevenueField, null);
assert.equal(orders.moneyBoundary, "BUSINESS_DEFINITION_AND_GOLD_SET_REQUIRED");
for (const field of ["totalPrice", "finishedPrice", "priceWithDisc"])
  assert.equal(
    orders.fields[field].role,
    "price_field_not_final_revenue",
    `${field}: operational price must not be relabeled as final revenue`,
  );
const sales = slice.sources.sales;
assert.match(sales.url, /^https:\/\/dev\.wildberries\.ru\//);
assertOperation(sales.operationAlias, sales);
assert.equal(sales.updateMinutes, 30);
assert.equal(sales.storageGuaranteeDays, 90);
assert.equal(sales.dataClass, "PRELIMINARY_OPERATIONAL");
assert.equal(sales.rowMeaning, "ONE_SALE_OR_RETURN_ONE_ITEM");
assert.equal(sales.orderLinkField, "srid");
assert.equal(sales.asyncMoneyFillHoursMax, 24);
assert.equal(sales.authoritativeRevenueField, null);
for (const field of ["finishedPrice", "priceWithDisc", "forPay"])
  assert.match(
    sales.fields[field].role,
    /operational_.*may_be_async_zero|operational_price_may_be_async_zero/,
    `${field}: async-zero boundary missing`,
  );

const finance = sales.accurateFinancialBoundary;
assertOperation(finance.operationAlias, finance);
assert.notEqual(
  finance.operationAlias,
  sales.operationAlias,
  "accurate financial boundary must remain distinct from operational sales",
);
assert.equal(
  finance.purpose,
  "ACCURATE_FINANCIAL_RECONCILIATION_NOT_OPERATIONAL_SALES",
);
const funnel = slice.sources.salesFunnelHistory;
assert.match(funnel.url, /^https:\/\/dev\.wildberries\.ru\//);
assertOperation(funnel.operationAlias, funnel);
assert.equal(funnel.updateMinutes, 60);
assert.equal(funnel.maxHistoryDays, 7);
assert.deepEqual(funnel.rowGrain, ["product.nmId", "history.date"]);
assert.equal(funnel.fields["history.orderCount"].unit, "count");
assert.equal(funnel.fields["history.orderSum"].unit, "response_currency");
assert.equal(funnel.fields.currency.role, "money_currency");
assert.equal(
  funnel.attributionBoundary,
  "BUYOUTS_CANCELLATIONS_RETURNS_ARE_ATTRIBUTED_TO_ORDER_DAY",
);
assert.equal(funnel.finalSalesBoundary, "USE_REALIZATION_REPORT_DETAILS");
assert.equal(funnel.fourteenDayCompleteness, "NOT_SUFFICIENT_ALONE");

assert.equal(
  slice.rules.money,
  "DO_NOT_LABEL_OPERATIONAL_PRICE_FIELDS_AS_FINAL_REVENUE",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");
assert.equal(slice.rules.percentChange, "ZERO_OR_UNKNOWN_BASE_RETURNS_NULL");
assert.equal(
  slice.rules.fourteenDayTrend,
  "SALES_FUNNEL_HISTORY_REQUIRES_ANOTHER_COMPLETE_SOURCE_FOR_DAYS_BEYOND_LAST_7",
);
function summarizeOrders(rows) {
  const ids = rows.map((row) => row.srid);
  if (
    ids.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(ids).size !== ids.length
  )
    return { status: "INCOMPLETE", reason: "DUPLICATE_ORDER_ID" };
  if (
    rows.some(
      (row) =>
        typeof row.date !== "string" || typeof row.isCancel !== "boolean",
    )
  )
    return { status: "INCOMPLETE", reason: "INVALID_ORDER_ROW" };
  const cancelledUnits = rows.filter((row) => row.isCancel).length;
  return {
    ordersPlacedUnits: rows.length,
    cancelledUnits,
    activeAfterCancellationUnits: rows.length - cancelledUnits,
  };
}

const ordersCase = slice.syntheticCases.orders;
assert.deepEqual(summarizeOrders(ordersCase.rows), ordersCase.expected);
const duplicateCase = slice.syntheticCases.duplicateOrder;
assert.deepEqual(
  summarizeOrders(duplicateCase.rows),
  duplicateCase.expected,
  "duplicate operational rows must not inflate unit counts",
);
function percentChange(current, previous) {
  if (
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    typeof previous !== "number" ||
    !Number.isFinite(previous) ||
    previous === 0
  )
    return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

for (const row of slice.syntheticCases.percentChange)
  assert.equal(
    percentChange(row.current, row.previous),
    row.expected,
    "percent change must fail closed on zero/unknown base",
  );

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      orders.operationAlias,
      sales.operationAlias,
      funnel.operationAlias,
      finance.operationAlias,
    ],
    evidence: slice.scope.evidence,
    liveValues: slice.scope.liveValues,
    finalRevenueMapped: false,
  }),
);
