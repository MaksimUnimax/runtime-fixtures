import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectPair, validateSources, VERSION } from "./cap19-wb-paired-data-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "tests/regression/extension-core/fixtures", name), "utf8"));
const fixture = read("cap19-wb-paired-data-fixture-v1.json");
const contract = read("cap19-wb-paired-data-contract-v1.json");
const manifest = read("cap19-wb-paired-data-manifest-v1.json");
const input = () => structuredClone(fixture.input);
function rejects(reason, mutate) {
  const value = input();
  mutate(value);
  assert.deepEqual(projectPair(value), { status: "INCOMPLETE", reason });
}

test("source pins and declared source-only scope remain exact", () => {
  validateSources(root, manifest);
  assert.equal(contract.inputSchemaVersion, VERSION);
  assert.equal(contract.scope.syntheticOnly, true);
  assert.equal(contract.scope.ozon, "OPEN_NOT_PROVIDED");
  assert.equal(manifest.applicability.independentExpected, "PENDING_REVIEW");
  assert.equal(fixture.independentExpectedTable, "PENDING_EXISTING_REVIEWER");
});
test("the complete paired input matches the AUTHOR oracle", () => {
  assert.deepEqual(projectPair(input()), fixture.authorExpected);
});
test("multiple campaigns, platforms, sizes and warehouses do not multiply spend or stock", () => {
  const out = projectPair(input());
  assert.equal(out.statistics.total, "157.00");
  assert.deepEqual(out.products.map((x) => [x.nmId, x.statisticsSpend, x.onHandUnits]), [[90001, "120.00", 10], [90002, "30.00", 0], [90003, "7.00", 10]]);
  assert.deepEqual(out.products[0].statisticsComponents, [{ advertId: 1001, amount: "95.50" }, { advertId: 1002, amount: "24.50" }]);
  assert.equal(out.products[0].stockRows.length, 4);
});
test("transit is excluded and explicit zero is limited to the declared stock selection", () => {
  const out = projectPair(input());
  assert.deepEqual(out.stockScope.selection.warehouseIds, [507, 901]);
  assert.equal(out.products[0].onHandUnits, 10);
  assert.equal(out.products[1].outOfStockInSelection, true);
  assert.equal(out.products[0].lowStock, null);
});
test("snapshot membership is distinct from attributed historical statistics", () => {
  const out = projectPair(input());
  assert.deepEqual(out.products[0].activeCampaignIds, [1001, 1002]);
  assert.deepEqual(out.products[2].activeCampaignIds, []);
  assert.equal(out.products[2].statisticsSpend, "7.00");
});
test("actual cost has no fabricated currency, product or warehouse allocation", () => {
  const out = projectPair(input());
  assert.equal(out.actualCostStock.reason, "CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED");
  assert.equal(out.actualCostStock.currency, null);
  assert.equal(out.actualCostStock.productCost, null);
  assert.equal(out.actualCostStock.warehouseCost, null);
  for (const product of out.products) for (const row of product.stockRows)
    assert.deepEqual(Object.keys(row).sort(), ["nmId", "chrtId", "warehouseId", "quantity", "inWayToClient", "inWayFromClient"].sort());
});
test("projection does not mutate inputs or retain caller-owned output references", () => {
  const original = input(), before = structuredClone(original);
  const out = projectPair(original);
  assert.deepEqual(original, before);
  out.context.currency = "CHANGED";
  out.products[0].stockRows[0].quantity = 100;
  out.actualCostStock.sourceRows[0].updSum = "0.00";
  assert.deepEqual(original, before);
});
test("row order cannot change amounts, stock projection or identity", () => {
  const value = input();
  value.campaigns.rows.reverse();
  value.statistics.rows.reverse();
  value.statistics.campaignTotals.reverse();
  value.stock.rows.reverse();
  assert.deepEqual(projectPair(value).products, fixture.authorExpected.products);
});
test("missing zero-stock cell remains incomplete", () => rejects("STOCK_SELECTION_INCOMPLETE", (x) => { x.stock.rows.splice(4, 1); }));
test("duplicate stock grain is rejected", () => rejects("DUPLICATE_STOCK_GRAIN", (x) => { x.stock.rows.push({ ...x.stock.rows[0] }); }));
test("size cannot be rebound to a different product", () => rejects("SIZE_PRODUCT_IDENTITY_CONFLICT", (x) => { x.stock.selection.products[1].chrtIds = [1011]; }));
test("undeclared stock warehouse is rejected", () => rejects("STOCK_IDENTITY_OUTSIDE_SELECTION", (x) => { x.stock.rows[0].warehouseId = 999; }));
test("negative stock is rejected", () => rejects("STOCK_ROW_INVALID", (x) => { x.stock.rows[0].quantity = -1; }));
test("unsafe aggregate stock count is rejected", () => rejects("STOCK_TOTAL_OUT_OF_RANGE", (x) => { x.stock.rows[0].quantity = Number.MAX_SAFE_INTEGER; }));
test("missing stock product set is rejected", () => rejects("STOCK_PRODUCT_SET_MISMATCH", (x) => { x.stock.selection.products.pop(); }));
for (const source of ["campaigns", "statistics", "stock"])
  test(`incomplete ${source} is not zero`, () => rejects("SOURCE_READ_INCOMPLETE", (x) => { x[source].complete = false; }));
test("partial cost history does not block the independent statistics-stock projection", () => {
  const value = input();
  value.actualCostHistory.complete = false;
  const out = projectPair(value);
  assert.equal(out.statistics.total, "157.00");
  assert.equal(out.actualCostStock.status, "INCOMPLETE");
  assert.equal(out.actualCostStock.sourceComplete, false);
});
test("explicit zero statistics are accepted without inferring missing data as zero", () => {
  const value = input();
  value.statistics.rows.find((r) => r.nmId === 90002).amount = "0.00";
  value.statistics.campaignTotals[0].amount = "95.50";
  const out = projectPair(value);
  assert.equal(out.statistics.total, "127.00");
  assert.equal(out.products.find((r) => r.nmId === 90002).statisticsSpend, "0.00");
});
test("duplicate statistics grain is rejected", () => rejects("DUPLICATE_STATISTICS_GRAIN", (x) => { x.statistics.rows.push({ ...x.statistics.rows[0] }); }));
test("statistics cannot attribute spend using campaign membership alone", () => rejects("STATISTICS_PRODUCT_COVERAGE_INCOMPLETE", (x) => {
  x.statistics.rows = x.statistics.rows.filter((r) => r.nmId !== 90002);
  x.statistics.campaignTotals[0].amount = "95.50";
}));
test("unknown statistics product is rejected", () => rejects("STATISTICS_IDENTITY_INVALID", (x) => { x.statistics.rows[0].nmId = 123; }));
test("campaign total must reconcile with unique product/platform statistics", () => rejects("STATISTICS_TOTAL_MISMATCH", (x) => { x.statistics.campaignTotals[0].amount = "130.00"; }));
test("binary floats are not accepted as normalized money", () => rejects("INVALID_MONEY", (x) => { x.statistics.rows[0].amount = 0.1; }));
test("canonical cents are required", () => rejects("INVALID_MONEY", (x) => { x.statistics.rows[0].amount = "0.1"; }));
test("currency mismatch is rejected", () => rejects("CURRENCY_MISMATCH", (x) => { x.statistics.campaignTotals[0].currency = "USD"; }));
test("unproven actual-cost currency cannot be supplied as fact", () => rejects("ACTUAL_COST_CURRENCY_BINDING_UNPROVED", (x) => { x.actualCostHistory.currency = "RUB"; }));
test("statistics amount cannot be relabelled actual cost", () => rejects("SPEND_MEASURE_MISMATCH", (x) => { x.statistics.measure = "ACTUAL_COST"; }));
test("out-of-period statistics are rejected", () => rejects("STATISTICS_PERIOD_MISMATCH", (x) => { x.statistics.rows[0].day = "2026-09-27"; }));
test("invalid calendar dates are rejected", () => rejects("INVALID_TIME", (x) => { x.statistics.rows[0].day = "2026-09-31"; }));
test("a different stock snapshot is not silently substituted", () => rejects("SNAPSHOT_CONTEXT_MISMATCH", (x) => { x.context.stockAsOf = "2026-09-28T00:00:00+03:00"; }));
test("timezone must be explicit and consistent", () => rejects("UNSUPPORTED_CONTEXT", (x) => { x.context.timezone = "UTC"; }));
test("unknown allocation payload is not accepted", () => rejects("INVALID_SHAPE", (x) => { x.stock.rows[0].allocatedCost = "12.00"; }));
test("duplicate campaign membership is rejected", () => rejects("DUPLICATE_CAMPAIGN_MEMBERSHIP", (x) => { x.campaigns.rows[0].nmIds.push(90001); }));
test("duplicate cost source references are rejected", () => rejects("DUPLICATE_ACTUAL_COST_SOURCE_ROW", (x) => { x.actualCostHistory.rows.push({ ...x.actualCostHistory.rows[0] }); }));
test("source amount rows are bounded", () => rejects("INVALID_ROW_COUNT", (x) => { x.statistics.rows = Array(1001).fill(x.statistics.rows[0]); }));
test("live or Ozon inputs cannot inherit WB synthetic acceptance", () => {
  rejects("UNSUPPORTED_INPUT_SCOPE", (x) => { x.synthetic = false; });
  rejects("UNSUPPORTED_INPUT_SCOPE", (x) => { x.marketplace = "OZON"; });
});
test("source pin mismatch fails before CLI acceptance", () => {
  const changed = structuredClone(manifest);
  changed.sourcePins[0].sha256 = "0".repeat(64);
  assert.throws(() => validateSources(root, changed), /SOURCE_PIN_MISMATCH/);
});
