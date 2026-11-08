import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { composeStatisticsFbs, VERSION } from "./cap19-wb-statistics-fbs-pair-v1.mjs";
import { projectPair } from "./cap19-wb-paired-data-contract.mjs";
import { bridgeFbsStock } from "./cap19-wb-fbs-stock-bridge-v1.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const fixture = read("cap19-wb-statistics-fbs-pair-v1.json");
const fresh = () => structuredClone(fixture.input);
const rejects = (name, change, reason) => test(name, () => {
  const input = fresh(); change(input); const before = structuredClone(input);
  const out = composeStatisticsFbs(input);
  assert.equal(out.status, "INCOMPLETE");
  assert.deepEqual(Object.keys(out).sort(), ["reason", "status"]);
  assert.match(out.reason, /^[A-Z0-9_]+$/);
  if (reason) assert.equal(out.reason, reason);
  assert.deepEqual(input, before);
});
const setSnapshot = (input, end) => {
  input.statistics.context.period.endExclusive = end;
  input.statistics.context.membershipAsOf = end;
  input.fbs.context.stockAsOf = end;
  for (const source of [input.fbs.catalog, input.fbs.warehouses, input.fbs.stock]) source.asOf = end;
};
const removeFbsSize = (input, nmId, chrtId) => {
  const product = input.fbs.selection.products.find((p) => p.nmId === nmId);
  product.chrtIds = product.chrtIds.filter((n) => n !== chrtId);
  input.fbs.selection.products = input.fbs.selection.products.filter((p) => p.chrtIds.length);
  for (const r of input.fbs.stock.requests) r.chrtIds = r.chrtIds.filter((n) => n !== chrtId);
  for (const r of input.fbs.stock.responses) r.stocks = r.stocks.filter((s) => s.chrtId !== chrtId);
};

test("complete pair equals the AUTHOR composition oracle", () => {
  assert.equal(VERSION, fixture.input.schemaVersion);
  assert.equal(fixture.oracleStatus, "AUTHOR_COMPOSITION_ORACLE_NOT_INDEPENDENT_ACCEPTANCE");
  assert.deepEqual(composeStatisticsFbs(fresh()), fixture.authorExpected);
});
test("both independent boundary tables and unchanged producer outputs match exactly", () => {
  const records = fixture.boundaryExpectedRecords;
  assert.equal(records.length, 2);
  for (const x of records) {
    const b = Buffer.from(x.utf8);
    assert.equal(b.length, x.bytes); assert.equal(createHash("sha256").update(b).digest("hex"), x.sha256);
  }
  const wbInput = read("cap19-wb-paired-data-fixture-v1.json").input;
  const wb = projectPair(wbInput), fb = bridgeFbsStock(read("cap19-wb-fbs-stock-bridge-v1.json").input);
  assert.deepEqual(wb, JSON.parse(records[0].utf8)); assert.deepEqual(fb, JSON.parse(records[1].utf8));
  const { stockAsOf, ...context } = wb.context;
  assert.equal(stockAsOf, context.period.endExclusive);
  assert.deepEqual(fixture.input.statistics, {
    sourceSchemaVersion: wb.schemaVersion, complete: true, context,
    measure: wb.statistics.measure, currency: wb.statistics.currency, total: wb.statistics.total,
    campaignTotals: wbInput.statistics.campaignTotals,
    products: wb.products.map(({ nmId, statisticsSpend, statisticsComponents, activeCampaignIds }) =>
      ({ nmId, statisticsSpend, statisticsComponents, activeCampaignIds })),
  });
});
test("all exact source pins and new artifact hashes match", () => {
  const manifest = read("cap19-wb-statistics-fbs-pair-manifest-v1.json");
  const root = new URL("../../../", import.meta.url);
  for (const x of [...manifest.sourcePins, ...manifest.artifacts]) {
    const b = readFileSync(new URL(x.path, root));
    assert.equal(b.length, x.bytes); assert.equal(createHash("sha256").update(b).digest("hex"), x.sha256);
  }
});
test("product statistics appear once and never on a stock cell", () => {
  const out = composeStatisticsFbs(fresh());
  assert.equal(out.statistics.total, "157.00");
  assert.deepEqual(out.products.map((p) => [p.nmId, p.statisticsSpend, p.onHandUnits]), [[90001, "120.00", 12], [90002, "30.00", 0], [90003, "7.00", 4]]);
  assert.deepEqual(out.stockTotals, { onHandUnits: 16, cells: 8 });
  for (const p of out.products) for (const c of p.stockRows)
    assert.deepEqual(Object.keys(c).sort(), ["amount", "chrtId", "nmId", "sellerWarehouseId"]);
});
test("campaign totals reconcile without copying the full campaign to each product", () => {
  const out = composeStatisticsFbs(fresh());
  assert.deepEqual(out.statistics.campaignTotals.map((x) => x.amount), ["125.50", "24.50", "7.00"]);
  assert.equal(out.products[0].statisticsComponents[0].amount, "95.50");
  assert.equal(out.products[1].statisticsComponents[0].amount, "30.00");
});
test("inactive-at-snapshot historical spend and actual-cost uncertainty remain separate", () => {
  const out = composeStatisticsFbs(fresh());
  assert.deepEqual(out.products[2].activeCampaignIds, []); assert.equal(out.products[2].statisticsSpend, "7.00");
  assert.deepEqual(out.actualCostStock, { status: "INCOMPLETE", reason: "CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED", currency: null, productCost: null, warehouseCost: null });
  assert(out.products.every((p) => p.lowStock === null));
  assert.equal("sourceComplete" in out.actualCostStock, false);
});
test("selection order and every source array permutation preserve full output", () => {
  const x = fresh(); x.selection.products.reverse(); x.selection.sellerWarehouseIds.reverse();
  x.selection.products.forEach((p) => p.chrtIds.reverse()); x.statistics.products.reverse();
  x.statistics.campaignTotals.reverse(); x.statistics.products.forEach((p) => { p.statisticsComponents.reverse(); p.activeCampaignIds.reverse(); });
  x.fbs.selection.products.reverse(); x.fbs.selection.sellerWarehouseIds.reverse(); x.fbs.selection.products.forEach((p) => p.chrtIds.reverse());
  x.fbs.catalog.cards.reverse(); x.fbs.catalog.cards.forEach((p) => p.sizes.reverse()); x.fbs.warehouses.rows.reverse();
  x.fbs.stock.requests.reverse(); x.fbs.stock.responses.reverse(); x.fbs.stock.requests.forEach((p) => p.chrtIds.reverse()); x.fbs.stock.responses.forEach((p) => p.stocks.reverse());
  assert.deepEqual(composeStatisticsFbs(x), fixture.authorExpected);
});
test("frozen input and output mutations prove detached composition", () => {
  const x = fresh(), before = structuredClone(x);
  const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(x); const out = composeStatisticsFbs(x); assert.deepEqual(out, fixture.authorExpected);
  out.context.period.start = "changed"; out.stockScope.products[0].chrtIds.push(999);
  out.products[0].statisticsComponents[0].amount = "0.00"; out.products[0].stockRows[0].amount = 999;
  assert.deepEqual(x, before);
});
for (const value of [null, [], 0, "", false]) test(`malformed root ${JSON.stringify(value)}`, () => assert.equal(composeStatisticsFbs(value).status, "INCOMPLETE"));
rejects("unsupported schema", (x) => { x.schemaVersion = "other"; }, "SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("live cannot inherit synthetic scope", (x) => { x.synthetic = false; }, "SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("Ozon cannot inherit WB scope", (x) => { x.marketplace = "OZON"; }, "SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("unrecognized statistics schema", (x) => { x.statistics.sourceSchemaVersion = "raw_provider"; }, "STATISTICS_SCHEMA_MISMATCH");
rejects("unproven monetary allocation is not an accepted field", (x) => { x.actualCostAllocation = {}; }, "INVALID_SHAPE");
rejects("actual cost cannot be relabelled statistics", (x) => { x.statistics.measure = "ACTUAL_COST"; }, "STATISTICS_MEASURE_MISMATCH");
for (const value of [false, null, 0, 1, "true", [], {}]) rejects(`statistics complete is strict ${JSON.stringify(value)}`, (x) => { x.statistics.complete = value; }, "STATISTICS_INCOMPLETE");
for (const source of ["catalog", "warehouses", "stock"]) rejects(`FBS ${source} incomplete`, (x) => { x.fbs[source].complete = false; }, "FBS_SOURCE_INCOMPLETE");
rejects("missing statistics product is not zero", (x) => { x.statistics.products.pop(); }, "STATISTICS_PRODUCT_SET_MISMATCH");
rejects("unknown statistics product identity", (x) => { x.statistics.products[0].nmId = 99001; }, "STATISTICS_PRODUCT_SET_MISMATCH");
rejects("duplicate statistics product", (x) => { x.statistics.products.push(structuredClone(x.statistics.products[0])); }, "STATISTICS_PRODUCT_DUPLICATE");
rejects("duplicate outer product", (x) => { x.selection.products.push(structuredClone(x.selection.products[0])); }, "SELECTION_PRODUCT_DUPLICATE");
rejects("same outer size cannot belong to two products", (x) => { x.selection.products[1].chrtIds.push(1011); }, "SELECTION_SIZE_AMBIGUOUS");
rejects("duplicate selected size", (x) => { x.selection.products[0].chrtIds.push(1011); }, "IDENTIFIER_DUPLICATE");
rejects("duplicate selected warehouse", (x) => { x.selection.sellerWarehouseIds.push(10); }, "IDENTIFIER_DUPLICATE");
rejects("valid smaller FBS product set conflicts with pair selection", (x) => { removeFbsSize(x, 90003, 1031); }, "FBS_PRODUCT_SELECTION_MISMATCH");
rejects("valid smaller FBS size set conflicts with pair selection", (x) => { removeFbsSize(x, 90001, 1012); }, "FBS_SIZE_SELECTION_MISMATCH");
rejects("valid smaller FBS warehouse set conflicts with pair selection", (x) => {
  x.fbs.selection.sellerWarehouseIds.pop(); x.fbs.stock.requests.pop(); x.fbs.stock.responses.pop();
}, "FBS_WAREHOUSE_SELECTION_MISMATCH");
rejects("catalog product/size conflict propagates from FBS validation", (x) => { x.fbs.catalog.cards[0].nmID = 99001; }, "FBS_CATALOG_SELECTION_IDENTITY_MISMATCH");
rejects("missing explicit stock zero remains incomplete", (x) => { x.fbs.stock.responses[0].stocks.splice(2, 1); }, "FBS_FBS_CELL_MISSING");
rejects("duplicate FBS cell cannot multiply stock or spend", (x) => { x.fbs.stock.responses[0].stocks.push(structuredClone(x.fbs.stock.responses[0].stocks[0])); }, "FBS_FBS_CELL_DUPLICATE");
rejects("FBW cannot masquerade as FBS", (x) => { x.fbs.stock.scheme = "WB_WAREHOUSE_ON_HAND"; }, "FBS_FBS_SCHEME_REQUIRED");
rejects("office ID cannot replace seller warehouse", (x) => { x.selection.sellerWarehouseIds[0] = 507; }, "FBS_WAREHOUSE_SELECTION_MISMATCH");
rejects("different FBS marketplace", (x) => { x.fbs.marketplace = "OZON"; }, "FBS_SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("different FBS schema", (x) => { x.fbs.schemaVersion = "other"; }, "FBS_SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("duplicate product component is not another amount", (x) => { x.statistics.products[0].statisticsComponents.push(structuredClone(x.statistics.products[0].statisticsComponents[0])); }, "STATISTICS_COMPONENT_DUPLICATE");
rejects("duplicate campaign total", (x) => { x.statistics.campaignTotals.push(structuredClone(x.statistics.campaignTotals[0])); }, "STATISTICS_CAMPAIGN_DUPLICATE");
rejects("undeclared component campaign", (x) => { x.statistics.campaignTotals.pop(); }, "STATISTICS_CAMPAIGN_UNDECLARED");
rejects("declared campaign without components", (x) => { x.statistics.campaignTotals.push({ advertId: 99, currency: "RUB", amount: "0.00" }); }, "STATISTICS_CAMPAIGN_COVERAGE_MISMATCH");
rejects("wrong product total", (x) => { x.statistics.products[0].statisticsSpend = "120.01"; }, "STATISTICS_PRODUCT_TOTAL_MISMATCH");
rejects("wrong campaign total", (x) => { x.statistics.campaignTotals[0].amount = "125.51"; }, "STATISTICS_CAMPAIGN_TOTAL_MISMATCH");
rejects("wrong overall total", (x) => { x.statistics.total = "157.01"; }, "STATISTICS_TOTAL_MISMATCH");
rejects("missing explicit component is not zero", (x) => { x.statistics.products[2].statisticsComponents = []; }, "ARRAY_BOUNDARY_INVALID");
rejects("active membership alone cannot provide a missing component", (x) => { x.statistics.products[0].activeCampaignIds.push(999); }, "ACTIVE_CAMPAIGN_NOT_IN_PRODUCT_STATISTICS");
rejects("duplicate active campaign", (x) => { x.statistics.products[0].activeCampaignIds.push(1001); }, "IDENTIFIER_DUPLICATE");
test("explicit zero statistics reconcile without inventing missing rows", () => {
  const x = fresh(); x.statistics.total = "0.00";
  for (const c of x.statistics.campaignTotals) c.amount = "0.00";
  for (const p of x.statistics.products) { p.statisticsSpend = "0.00"; p.statisticsComponents.forEach((c) => { c.amount = "0.00"; }); }
  const out = composeStatisticsFbs(x);
  assert.equal(out.status, "STATISTICS_FBS_SYNTHETIC_PAIR_VALID"); assert.equal(out.statistics.total, "0.00");
  assert.deepEqual(out.products.map((p) => p.onHandUnits), [12, 0, 4]);
});
test("all selected FBS cells may explicitly be zero without changing statistics", () => {
  const x = fresh(); x.fbs.stock.responses.forEach((r) => r.stocks.forEach((s) => { s.amount = 0; }));
  const out = composeStatisticsFbs(x); assert.equal(out.statistics.total, "157.00");
  assert.deepEqual(out.stockTotals, { onHandUnits: 0, cells: 8 }); assert(out.products.every((p) => p.outOfStockInSelection));
});
for (const value of [null, 0, "01.00", "1", "1.0", "-1.00", "1e2", "1.001", "10000000000000.00"]) {
  rejects(`noncanonical overall money ${JSON.stringify(value)}`, (x) => { x.statistics.total = value; }, "INVALID_MONEY");
  rejects(`noncanonical component money ${JSON.stringify(value)}`, (x) => { x.statistics.products[0].statisticsComponents[0].amount = value; }, "INVALID_MONEY");
}
rejects("source-derived money maximum is checked", (x) => { x.statistics.total = "9999999999990.01"; }, "STATISTICS_AMOUNT_OUT_OF_RANGE");
for (const value of [null, "USD", ""]) {
  rejects(`unknown/mismatched context currency ${JSON.stringify(value)}`, (x) => { x.statistics.context.currency = value; }, "CURRENCY_MISMATCH");
  rejects(`unknown/mismatched statistics currency ${JSON.stringify(value)}`, (x) => { x.statistics.currency = value; }, "CURRENCY_MISMATCH");
  rejects(`unknown/mismatched campaign currency ${JSON.stringify(value)}`, (x) => { x.statistics.campaignTotals[0].currency = value; }, "CURRENCY_MISMATCH");
}
for (const time of ["00:00:01", "12:00:00", "23:59:59"]) {
  rejects(`partial-day end ${time} despite matching snapshots`, (x) => { setSnapshot(x, `2026-09-26T${time}+03:00`); }, "DAILY_PERIOD_BOUNDARY_UNALIGNED");
  rejects(`partial-day start ${time}`, (x) => { x.statistics.context.period.start = `2026-09-26T${time}+03:00`; }, "DAILY_PERIOD_BOUNDARY_UNALIGNED");
}
rejects("elapsed 24 hours cannot replace complete days", (x) => { x.statistics.context.period.start = "2026-09-26T12:00:00+03:00"; setSnapshot(x, "2026-09-27T12:00:00+03:00"); }, "DAILY_PERIOD_BOUNDARY_UNALIGNED");
for (const start of ["2026-09-27T00:00:00+03:00", "2026-09-28T00:00:00+03:00", "2026-08-26T00:00:00+03:00"]) rejects(`invalid empty/reversed/32-day period ${start}`, (x) => { x.statistics.context.period.start = start; }, "INVALID_PERIOD");
for (const start of ["2026-02-30T00:00:00+03:00", "2026-09-26T00:00:00Z", "2026-09-26T00:00:00+00:00", "2026-09-26T00:00:00.000+03:00"]) rejects(`invalid date/representation ${start}`, (x) => { x.statistics.context.period.start = start; }, "INVALID_TIME");
test("aligned one/31-day periods preserve the paired arithmetic", () => {
  for (const start of ["2026-09-26T00:00:00+03:00", "2026-08-27T00:00:00+03:00"]) {
    const x = fresh(); x.statistics.context.period.start = start;
    const expected = structuredClone(fixture.authorExpected); expected.context.period.start = start;
    assert.deepEqual(composeStatisticsFbs(x), expected);
  }
});
rejects("membership is only the matching end snapshot", (x) => { x.statistics.context.membershipAsOf = x.statistics.context.period.start; }, "MEMBERSHIP_SNAPSHOT_MISMATCH");
rejects("valid but different FBS snapshot conflicts with period end", (x) => {
  const end = "2026-09-28T00:00:00+03:00"; x.fbs.context.stockAsOf = end;
  for (const s of [x.fbs.catalog, x.fbs.warehouses, x.fbs.stock]) s.asOf = end;
}, "FBS_END_SNAPSHOT_MISMATCH");
rejects("FBS sources cannot declare different snapshots", (x) => { x.fbs.catalog.asOf = "2026-09-28T00:00:00+03:00"; }, "FBS_SNAPSHOT_MISMATCH");
rejects("timezone mismatch", (x) => { x.statistics.context.timezone = "UTC"; }, "STATISTICS_CONTEXT_MISMATCH");
rejects("snapshot is not a historical stock series", (x) => { x.statistics.context.comparison = "HISTORICAL_STOCK_SERIES"; }, "STATISTICS_CONTEXT_MISMATCH");
test("the accepted raw statistics producer still rejects the exact exclusive-end day", () => {
  const x = read("cap19-wb-paired-data-fixture-v1.json").input;
  x.statistics.rows[0].day = "2026-09-27";
  assert.deepEqual(projectPair(x), { status: "INCOMPLETE", reason: "STATISTICS_PERIOD_MISMATCH" });
});
for (const value of ["90001", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) rejects(`invalid product identity ${JSON.stringify(value)}`, (x) => { x.statistics.products[0].nmId = value; }, "IDENTIFIER_INVALID");
rejects("outer selection cannot be empty", (x) => { x.selection.products = []; }, "ARRAY_BOUNDARY_INVALID");
rejects("outer warehouse limit", (x) => { x.selection.sellerWarehouseIds = Array.from({ length: 101 }, (_, i) => i + 1); }, "ARRAY_BOUNDARY_INVALID");
rejects("outer cell limit", (x) => { x.selection.sellerWarehouseIds = Array.from({ length: 100 }, (_, i) => i + 1); x.selection.products[0].chrtIds = Array.from({ length: 101 }, (_, i) => i + 1); }, "SELECTION_TOO_LARGE");
rejects("globally more than 1000 product/campaign components", (x) => {
  x.statistics.campaignTotals = Array.from({ length: 1000 }, (_, i) => ({ advertId: i + 1, currency: "RUB", amount: "0.00" }));
  x.statistics.products[0].statisticsSpend = "0.00"; x.statistics.products[0].activeCampaignIds = [];
  x.statistics.products[0].statisticsComponents = x.statistics.campaignTotals.map(({ advertId, amount }) => ({ advertId, amount }));
  x.statistics.products[1].statisticsComponents = [{ advertId: 1, amount: "0.00" }];
}, "STATISTICS_COMPONENT_BOUNDARY");

function grid(nProducts, nSizes, nWarehouses) {
  const x = fresh(), warehouses = Array.from({ length: nWarehouses }, (_, i) => i + 1);
  const products = Array.from({ length: nProducts }, (_, i) => ({ nmId: i + 1, chrtIds: Array.from({ length: nSizes }, (_, j) => i * nSizes + j + 1) }));
  x.selection = { sellerWarehouseIds: warehouses, products };
  x.statistics.products = products.map(({ nmId }) => ({ nmId, statisticsSpend: "1.00", statisticsComponents: [{ advertId: 1, amount: "1.00" }], activeCampaignIds: [1] }));
  x.statistics.total = `${nProducts}.00`; x.statistics.campaignTotals = [{ advertId: 1, currency: "RUB", amount: x.statistics.total }];
  x.fbs.selection = structuredClone(x.selection);
  x.fbs.catalog.cards = products.map(({ nmId, chrtIds }) => ({ nmID: nmId, sizes: chrtIds.map((chrtID) => ({ chrtID })) }));
  x.fbs.warehouses.rows = warehouses.map((id) => ({ id }));
  const sizes = products.flatMap((p) => p.chrtIds);
  x.fbs.stock.requests = warehouses.map((warehouseId) => ({ warehouseId, chrtIds: [...sizes] }));
  x.fbs.stock.responses = warehouses.map((warehouseId) => ({ warehouseId, stocks: sizes.map((chrtId) => ({ chrtId, amount: 1 })) }));
  return x;
}
for (const [products, sizes, warehouses] of [[1000, 1, 1], [1, 1000, 10], [1, 100, 100]]) test(`exact accepted grid ${products} products x ${sizes} sizes x ${warehouses} warehouses`, () => {
  const out = composeStatisticsFbs(grid(products, sizes, warehouses));
  assert.equal(out.status, "STATISTICS_FBS_SYNTHETIC_PAIR_VALID");
  assert.equal(out.statistics.total, `${products}.00`);
  assert.deepEqual(out.stockTotals, { onHandUnits: products * sizes * warehouses, cells: products * sizes * warehouses });
  assert(out.products.every((p) => p.statisticsSpend === "1.00"));
});
test("exact source-derived normalized money bound is represented without float rounding", () => {
  const x = grid(1, 1, 1), amount = "9999999999990.00";
  x.statistics.total = amount; x.statistics.campaignTotals[0].amount = amount;
  x.statistics.products[0].statisticsSpend = amount; x.statistics.products[0].statisticsComponents[0].amount = amount;
  const out = composeStatisticsFbs(x); assert.equal(out.status, "STATISTICS_FBS_SYNTHETIC_PAIR_VALID");
  assert.equal(out.statistics.total, amount); assert.equal(out.products[0].statisticsSpend, amount);
});
rejects("sum of normalized components may not exceed source-derived bound", (x) => {
  x.statistics.campaignTotals[0].amount = "9999999999990.00";
  x.statistics.products[0].statisticsComponents[0].amount = "9999999999990.00";
}, "STATISTICS_AMOUNT_OUT_OF_RANGE");
rejects("total selected sizes bound is enforced across products", (x) => {
  x.selection.sellerWarehouseIds = [10];
  x.selection.products = [{ nmId: 1, chrtIds: Array.from({ length: 1000 }, (_, i) => i + 1) }, { nmId: 2, chrtIds: [1001] }];
}, "SELECTION_TOO_LARGE");
rejects("statistics product array has a finite maximum", (x) => { x.statistics.products = Array(1001).fill(x.statistics.products[0]); }, "ARRAY_BOUNDARY_INVALID");
for (const [start, end] of [["2024-02-29T00:00:00+03:00", "2024-03-01T00:00:00+03:00"], ["2026-12-31T00:00:00+03:00", "2027-01-01T00:00:00+03:00"]]) test(`valid full-day calendar transition ${start}`, () => {
  const x = fresh(); x.statistics.context.period.start = start; setSnapshot(x, end);
  const out = composeStatisticsFbs(x); assert.equal(out.status, "STATISTICS_FBS_SYNTHETIC_PAIR_VALID");
  assert.equal(out.context.period.endExclusive, end); assert.equal(out.statistics.total, "157.00");
});
const consumedObjects = [[], ["selection"], ["selection", "products", 0], ["statistics"], ["statistics", "context"], ["statistics", "context", "period"], ["statistics", "campaignTotals", 0], ["statistics", "products", 0], ["statistics", "products", 0, "statisticsComponents", 0]];
for (const path of consumedObjects) {
  const value = path.reduce((v, k) => v[k], fixture.input);
  for (const key of Object.keys(value)) rejects(`required composition field missing ${[...path, key].join(".")}`, (x) => {
    const object = path.reduce((v, k) => v[k], x); delete object[key];
  });
}
