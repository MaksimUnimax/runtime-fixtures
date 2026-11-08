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
    "tests/regression/extension-core/fixtures/wb-cross-source-join-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const salesFixture = JSON.parse(
  read(slice.sources.operationalSales.reuseFixture),
);
const financeFixture = JSON.parse(read(slice.sources.finance.reuseFixture));
const advertisingFixture = JSON.parse(
  read(slice.sources.promotionSpend.reuseFixture),
);
const stockFixture = JSON.parse(read(slice.sources.currentStock.reuseFixture));

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

function assertOperation(alias) {
  const meta = wb.OPERATIONS[alias];
  assert.ok(meta, "missing WB operation " + alias);
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}
function validateRows(rows, idField, duplicateReason) {
  const ids = new Set();
  const products = new Map();
  for (const row of rows) {
    if (
      !row ||
      row[idField] === null ||
      row[idField] === undefined ||
      // Retained SalesItem.saleID is String; the existing finance-detail
      // normalized contract requires integer rrdId. Check before key coercion.
      (idField === "saleID" && typeof row[idField] !== "string") ||
      (idField === "rrdId" && !Number.isInteger(row[idField])) ||
      !Number.isInteger(row.nmId)
    )
      return { status: "INCOMPLETE", reason: "ROW_ID_OR_PRODUCT_MISSING" };
    const id = String(row[idField]);
    if (ids.has(id)) return { status: "INCOMPLETE", reason: duplicateReason };
    ids.add(id);
    products.set(row.nmId, (products.get(row.nmId) ?? 0) + 1);
  }
  return { status: "PASS", products };
}
function projectSalesFinance(input) {
  if (input.salesComplete !== true || input.financeComplete !== true)
    return { status: "INCOMPLETE", reason: "SOURCE_READ_INCOMPLETE" };
  if (!input.period || !input.timezone)
    return { status: "INCOMPLETE", reason: "PERIOD_OR_TIMEZONE_MISSING" };
  if (typeof input.financeCurrency !== "string" || !input.financeCurrency)
    return { status: "INCOMPLETE", reason: "FINANCE_CURRENCY_MISSING" };

  const sales = validateRows(input.salesRows, "saleID", "DUPLICATE_SALE_ID");
  if (sales.status !== "PASS") return sales;
  const finance = validateRows(
    input.financeRows,
    "rrdId",
    "DUPLICATE_FINANCE_RRD_ID",
  );
  if (finance.status !== "PASS") return finance;

  const salesIds = [...sales.products.keys()].sort((a, b) => a - b);
  const financeIds = [...finance.products.keys()].sort((a, b) => a - b);
  if (JSON.stringify(salesIds) !== JSON.stringify(financeIds))
    return { status: "INCOMPLETE", reason: "PRODUCT_SET_MISMATCH" };

  return {
    status: "PASS",
    currency: input.financeCurrency,
    rows: salesIds.map((nmId) => ({
      nmId,
      saleEvents: sales.products.get(nmId),
      financeRows: finance.products.get(nmId),
    })),
  };
}
function advertisingStockBoundary(input) {
  let campaignSpend = 0;
  for (const row of input.spendRows) {
    if (!row || !Number.isInteger(row.advertId) || !Number.isFinite(row.updSum))
      return { status: "INCOMPLETE", reason: "INVALID_PROMOTION_SPEND_ROW" };
    campaignSpend += row.updSum;
  }
  return {
    status: "INCOMPLETE",
    reason: "CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED",
    campaignSpend,
    productSpend: null,
  };
}

assert.equal(slice.schemaVersion, "wb_cross_source_join_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-19"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);

const cap19 = scenarios.get("CAP-19");
assert.ok(cap19, "CAP-19 missing");
assert.deepEqual(cap19.wbOperations, slice.acceptedMappingSnapshot["CAP-19"]);
assert.deepEqual(cap19.identifiers, ["product", "period"]);
assert.deepEqual(cap19.numericFixtures, ["cross_source_join"]);
assert.equal(cap19.omissionPolicy, "MISSING_NOT_ZERO");
for (const alias of cap19.wbOperations) assertOperation(alias);

assert.equal(salesFixture.sources.sales.operationAlias, "statistics_sales");
assert.equal(salesFixture.sources.sales.rowGrain[0], "saleID");
assert.equal(slice.sources.operationalSales.productId, "nmId");
assert.equal(
  financeFixture.sources.salesDetailPeriod.operationAlias,
  "finance_sales_detail_period",
);
assert.equal(
  financeFixture.sources.salesDetailPeriod.fields.nmId.role,
  "product_id",
);
assert.equal(
  financeFixture.sources.salesDetailPeriod.currencyJoin,
  slice.sources.finance.currencyJoin,
);
assert.equal(
  advertisingFixture.sources.costHistory.operationAlias,
  "promo_spend_history",
);
assert.equal(
  advertisingFixture.sources.costHistory.fields.advertId.role,
  "campaign_id",
);
assert.equal(
  advertisingFixture.sources.costHistory.fields.updSum.role,
  "actual_promotion_cost_amount",
);
assert.equal(advertisingFixture.sources.costHistory.currencyField, null);
assert.equal(
  stockFixture.sources.stockProducts.operationAlias,
  "stock_products",
);
assert.equal(stockFixture.sources.stockProducts.rowGrain[0], "nmID");
assert.equal(slice.sources.promotionSpend.rowProductId, null);

const c = slice.syntheticCases;
assert.deepEqual(projectSalesFinance(c.salesFinance), c.salesFinance.expected);
assert.deepEqual(
  validateRows(c.duplicateSale.salesRows, "saleID", "DUPLICATE_SALE_ID"),
  c.duplicateSale.expected,
);
assert.deepEqual(
  validateRows(
    c.duplicateFinance.financeRows,
    "rrdId",
    "DUPLICATE_FINANCE_RRD_ID",
  ),
  c.duplicateFinance.expected,
);
assert.deepEqual(
  projectSalesFinance({
    period: "2026-09-20/2026-09-26",
    timezone: "Europe/Moscow",
    salesComplete: true,
    financeComplete: true,
    financeCurrency: "RUB",
    ...c.missingProduct,
  }),
  c.missingProduct.expected,
);
assert.deepEqual(
  advertisingStockBoundary(c.advertisingStock),
  c.advertisingStock.expected,
);

// Source-only row identity admission, exercised through the actual join caller.
// No ID prefix/length/trim/canonicalization or raw int64 precision is inferred.
let rowIdentityTypeCases = 0;
const rowIdentityInvalid = { status: "INCOMPLETE", reason: "ROW_ID_OR_PRODUCT_MISSING" };
function checkRowIdentity(input, expected, label) {
  const actual = projectSalesFinance(input);
  assert.deepEqual(actual, expected, label);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label + " JSON");
  rowIdentityTypeCases++;
}
const syntheticJoin = () => structuredClone(c.salesFinance);
for (const value of [0, 101, -1, 1.5, NaN, Infinity, -Infinity, true, false, null, undefined, 1n, Symbol("synthetic"), {}, [], ["S-002"], new String("S-001"), () => "S-001"])
  for (const index of [0, 2]) {
    const input = syntheticJoin();
    input.salesRows[index].saleID = value;
    checkRowIdentity(input, rowIdentityInvalid, "saleID requires primitive String");
  }
for (const value of ["1", "2", "", " ", 1.5, -0.5, Number.MIN_VALUE, NaN, Infinity, -Infinity, true, false, null, undefined, 1n, Symbol("synthetic"), {}, [], new Number(1), () => 1])
  for (const index of [0, 1]) {
    const input = syntheticJoin();
    input.financeRows[index].rrdId = value;
    checkRowIdentity(input, rowIdentityInvalid, "rrdId requires integer Number");
  }
for (const value of ["S-001", "R-return", "1", "01", "", " ", "S-001 ", "\u00e9", "e\u0301", "a\0b", "__proto__"] ) {
  const input = syntheticJoin();
  input.salesRows[0].saleID = value;
  checkRowIdentity(input, c.salesFinance.expected, "opaque String identity unchanged");
}
for (const value of [-Number.MAX_VALUE, -1, -0, 0, 1, 3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE]) {
  const input = syntheticJoin();
  input.financeRows[0].rrdId = value;
  checkRowIdentity(input, c.salesFinance.expected, "existing integer domain unchanged");
}
for (const [rows, key, duplicate, reason] of [
  ["salesRows", "saleID", "S-002", "DUPLICATE_SALE_ID"],
  ["financeRows", "rrdId", 2, "DUPLICATE_FINANCE_RRD_ID"],
]) {
  const input = syntheticJoin();
  input[rows][0][key] = duplicate;
  checkRowIdentity(input, { status: "INCOMPLETE", reason }, "valid typed duplicate unchanged");
}
const zeroDuplicate = syntheticJoin();
zeroDuplicate.financeRows[0].rrdId = -0;
zeroDuplicate.financeRows[1].rrdId = 0;
checkRowIdentity(zeroDuplicate, { status: "INCOMPLETE", reason: "DUPLICATE_FINANCE_RRD_ID" }, "zero identity equality unchanged");
for (const [rows, field] of [["salesRows", "saleID"], ["financeRows", "rrdId"]]) {
  const input = syntheticJoin();
  delete input[rows][0][field];
  checkRowIdentity(input, rowIdentityInvalid, "missing row identity unchanged");
}
for (const rows of ["salesRows", "financeRows"])
  for (const value of [undefined, null, "1001", 1.5, NaN, Infinity]) {
    const input = syntheticJoin();
    input[rows][0].nmId = value;
    checkRowIdentity(input, rowIdentityInvalid, "product admission unchanged");
  }
const mismatch = syntheticJoin();
mismatch.financeRows[0].nmId = 9999;
checkRowIdentity(mismatch, c.missingProduct.expected, "product set mismatch unchanged");
for (const field of ["salesComplete", "financeComplete"])
  for (const value of [false, undefined, 1, "true"])
    checkRowIdentity({ ...syntheticJoin(), [field]: value }, { status: "INCOMPLETE", reason: "SOURCE_READ_INCOMPLETE" }, "strict completeness unchanged");
for (const field of ["period", "timezone"])
  checkRowIdentity({ ...syntheticJoin(), [field]: "" }, { status: "INCOMPLETE", reason: "PERIOD_OR_TIMEZONE_MISSING" }, "declared period guard unchanged");
for (const value of [undefined, null, "", 1, {}])
  checkRowIdentity({ ...syntheticJoin(), financeCurrency: value }, { status: "INCOMPLETE", reason: "FINANCE_CURRENCY_MISSING" }, "currency admission unchanged");
const frozenJoin = syntheticJoin();
for (const rows of ["salesRows", "financeRows"]) {
  frozenJoin[rows].forEach(Object.freeze);
  Object.freeze(frozenJoin[rows]);
}
Object.freeze(frozenJoin);
const frozenBefore = JSON.stringify(frozenJoin);
checkRowIdentity(frozenJoin, c.salesFinance.expected, "frozen nested join");
assert.equal(JSON.stringify(frozenJoin), frozenBefore, "join input unchanged");
const detachedJoin = projectSalesFinance(frozenJoin);
detachedJoin.rows[0].saleEvents = 999;
checkRowIdentity(frozenJoin, c.salesFinance.expected, "result rows detached");

assert.equal(
  slice.rules.financeMetric,
  "RETAIL_AMOUNT_AND_FOR_PAY_REMAIN_SEPARATE",
);
assert.equal(
  slice.rules.expenseDuplication,
  "DO_NOT_COPY_FULL_CAMPAIGN_SPEND_TO_EACH_PRODUCT",
);
console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-19",
    selectedJoin: "sales_x_finance",
    acceptedOperationMappingChanged: false,
    advertisingStockProductAllocation: "INCOMPLETE",
    rowIdentityTypeCases,
    liveValues: false,
  }),
);
