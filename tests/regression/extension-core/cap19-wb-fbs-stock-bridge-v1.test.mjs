import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { bridgeFbsStock } from "./cap19-wb-fbs-stock-bridge-v1.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cap19-wb-fbs-stock-bridge-v1.json", import.meta.url)));
const fresh = () => structuredClone(fixture.input);
const rejects = (name, change, reason) => test(name, () => {
  const input = fresh(); change(input);
  const before = structuredClone(input);
  assert.deepEqual(bridgeFbsStock(input), { status: "INCOMPLETE", reason });
  assert.deepEqual(input, before);
});

test("full synthetic author oracle and exact count of selected cells", () => {
  assert.equal(fixture.independentExpected, "NOT_PROVIDED_AUTHOR_ORACLE_ONLY");
  assert.deepEqual(bridgeFbsStock(fresh()), fixture.authorExpected);
});
test("retained complete source pins and all declared candidate artifact hashes match", () => {
  const manifest = JSON.parse(readFileSync(new URL("./fixtures/cap19-wb-fbs-stock-bridge-manifest-v1.json", import.meta.url)));
  const root = new URL("../../../", import.meta.url);
  for (const record of [...manifest.sourcePins, ...manifest.artifacts]) {
    const bytes = readFileSync(new URL(record.path, root));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
  }
});
test("seller warehouse id is not linked office id or a WB warehouse id", () => {
  const output = bridgeFbsStock(fresh());
  assert.deepEqual(output.stockScope.sellerWarehouseIds, [10, 20]);
  assert.equal(output.products.some((p) => p.stockRows.some((r) => r.sellerWarehouseId === 507)), false);
  assert.equal("warehouseId" in output.products[0].stockRows[0], false);
});
test("card size identity, not SKU/barcode or article, supplies the product join", () => {
  const input = fresh();
  for (const card of input.catalog.cards) {
    card.vendorCode = "shared-label";
    for (const size of card.sizes) size.skus = ["shared-barcode"];
  }
  assert.deepEqual(bridgeFbsStock(input), fixture.authorExpected);
});
test("permutations preserve the complete deterministic output", () => {
  const input = fresh();
  input.selection.products.reverse(); input.selection.products[2].chrtIds.reverse();
  input.selection.sellerWarehouseIds.reverse(); input.catalog.cards.reverse();
  input.catalog.cards[2].sizes.reverse(); input.warehouses.rows.reverse();
  input.stock.requests.reverse(); input.stock.responses.reverse();
  for (const r of input.stock.requests) r.chrtIds.reverse();
  for (const r of input.stock.responses) r.stocks.reverse();
  assert.deepEqual(bridgeFbsStock(input), fixture.authorExpected);
});
test("input is unmodified and every output array is detached", () => {
  const input = fresh(), before = structuredClone(input), output = bridgeFbsStock(input);
  assert.deepEqual(input, before);
  output.stockScope.sellerWarehouseIds[0] = 99;
  output.stockScope.products[0].chrtIds[0] = 99;
  output.products[0].stockRows[0].amount = 99;
  assert.deepEqual(input, before);
  input.selection.products[0].chrtIds[0] = 88;
  assert.equal(output.products[0].stockRows[0].chrtId, 1011);
});
test("unrelated raw fields are not copied into output and no money is invented", () => {
  const input = fresh(); input.extra = "SYNTHETIC-UNRELATED";
  input.stock.responses[0].stocks[0].statisticsSpend = "999.00";
  assert.deepEqual(bridgeFbsStock(input), fixture.authorExpected);
});
for (const field of ["catalog", "warehouses", "stock"]) {
  rejects(`${field} incomplete is not zero`, (x) => { x[field].complete = false; }, "SOURCE_INCOMPLETE");
  rejects(`${field} snapshot declaration must match`, (x) => { x[field].asOf = "2026-09-27T00:00:01+03:00"; }, "SNAPSHOT_MISMATCH");
}
for (const value of [null, {}, "1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  rejects(`invalid selected product ID ${JSON.stringify(value)}`, (x) => { x.selection.products[0].nmId = value; }, "IDENTIFIER_INVALID");
}
for (const value of [null, "0", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  rejects(`invalid FBS amount ${JSON.stringify(value)}`, (x) => { x.stock.responses[0].stocks[0].amount = value; }, "QUANTITY_INVALID");
}
rejects("Ozon cannot inherit WB synthetic acceptance", (x) => { x.marketplace = "OZON"; }, "SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("live values cannot inherit synthetic acceptance", (x) => { x.synthetic = false; }, "SYNTHETIC_WB_SCOPE_REQUIRED");
rejects("FBW is not relabelled FBS", (x) => { x.stock.scheme = "WB_WAREHOUSE_ON_HAND"; }, "FBS_SCHEME_REQUIRED");
rejects("timezone is explicit", (x) => { x.context.timezone = "UTC"; }, "TIMEZONE_MISMATCH");
rejects("invalid calendar snapshot", (x) => { x.context.stockAsOf = "2026-02-30T00:00:00+03:00"; }, "SNAPSHOT_INVALID");
rejects("different timestamp offset is not silently normalized", (x) => { x.context.stockAsOf = "2026-09-26T21:00:00+00:00"; }, "SNAPSHOT_INVALID");
rejects("missing catalog product relation", (x) => { x.catalog.cards.shift(); }, "CATALOG_SELECTION_IDENTITY_MISMATCH");
rejects("size cannot bind to another product", (x) => { x.catalog.cards[0].nmID = 90004; }, "CATALOG_SELECTION_IDENTITY_MISMATCH");
rejects("duplicate product in catalog", (x) => { x.catalog.cards.push(structuredClone(x.catalog.cards[0])); }, "CATALOG_PRODUCT_DUPLICATE");
rejects("duplicate size within a product", (x) => { x.catalog.cards[0].sizes.push({ chrtID: 1011 }); }, "CATALOG_SIZE_AMBIGUOUS");
rejects("size shared by catalog products is ambiguous", (x) => { x.catalog.cards[1].sizes.push({ chrtID: 1011 }); }, "CATALOG_SIZE_AMBIGUOUS");
rejects("duplicate selected product", (x) => { x.selection.products.push(structuredClone(x.selection.products[0])); }, "SELECTED_PRODUCT_DUPLICATE");
rejects("selected size shared across products is ambiguous", (x) => { x.selection.products[1].chrtIds.push(1011); }, "SELECTED_SIZE_AMBIGUOUS");
rejects("duplicate selected size", (x) => { x.selection.products[0].chrtIds.push(1011); }, "IDENTIFIER_DUPLICATE");
rejects("warehouse office ID cannot replace seller warehouse ID", (x) => { x.warehouses.rows[0].id = 507; }, "SELLER_WAREHOUSE_MISSING");
rejects("duplicate seller warehouse", (x) => { x.warehouses.rows.push({ id: 10 }); }, "SELLER_WAREHOUSE_DUPLICATE");
rejects("duplicate selected warehouse", (x) => { x.selection.sellerWarehouseIds.push(10); }, "IDENTIFIER_DUPLICATE");
rejects("missing FBS request", (x) => { x.stock.requests.pop(); }, "FBS_REQUEST_MISSING");
rejects("duplicate FBS request", (x) => { x.stock.requests.push(structuredClone(x.stock.requests[0])); }, "FBS_REQUEST_DUPLICATE");
rejects("request size set must be complete", (x) => { x.stock.requests[0].chrtIds.pop(); }, "FBS_REQUEST_SIZE_SET_MISMATCH");
rejects("request cannot substitute an unselected size", (x) => { x.stock.requests[0].chrtIds[0] = 9999; }, "FBS_REQUEST_SIZE_SET_MISMATCH");
rejects("request warehouse must be selected", (x) => { x.stock.requests[0].warehouseId = 507; }, "FBS_WAREHOUSE_NOT_SELECTED");
rejects("missing FBS response", (x) => { x.stock.responses.pop(); }, "FBS_RESPONSE_MISSING");
rejects("duplicate response from a warehouse", (x) => { x.stock.responses.push(structuredClone(x.stock.responses[0])); }, "FBS_RESPONSE_DUPLICATE");
rejects("response cannot invent a warehouse binding", (x) => { x.stock.responses[0].warehouseId = 507; }, "FBS_WAREHOUSE_NOT_SELECTED");
rejects("missing explicit zero is incomplete", (x) => { x.stock.responses[0].stocks.splice(2, 1); }, "FBS_CELL_MISSING");
rejects("duplicate response cell", (x) => { x.stock.responses[0].stocks.push(structuredClone(x.stock.responses[0].stocks[0])); }, "FBS_CELL_DUPLICATE");
rejects("response size must be selected", (x) => { x.stock.responses[0].stocks[0].chrtId = 9999; }, "FBS_SIZE_NOT_SELECTED");
rejects("unsafe aggregate fails instead of rounding", (x) => { x.stock.responses[0].stocks[0].amount = Number.MAX_SAFE_INTEGER; }, "STOCK_SUM_UNSAFE");
rejects("empty selection", (x) => { x.selection.products = []; }, "ARRAY_BOUNDARY_INVALID");
rejects("warehouse count bound", (x) => { x.selection.sellerWarehouseIds = Array.from({ length: 101 }, (_, i) => i + 1); }, "ARRAY_BOUNDARY_INVALID");
rejects("total selected size bound", (x) => {
  x.selection.products = [{ nmId: 1, chrtIds: Array.from({ length: 1000 }, (_, i) => i + 1) }, { nmId: 2, chrtIds: [1001] }];
}, "SELECTION_TOO_LARGE");
rejects("selected cell bound", (x) => {
  x.selection.products = [{ nmId: 1, chrtIds: Array.from({ length: 101 }, (_, i) => i + 1) }];
  x.selection.sellerWarehouseIds = Array.from({ length: 100 }, (_, i) => i + 1);
}, "SELECTION_TOO_LARGE");
test("exact 10000-cell boundary remains finite and accepted", () => {
  const input = fresh(), sizes = Array.from({ length: 1000 }, (_, i) => i + 1);
  const warehouseIds = Array.from({ length: 10 }, (_, i) => i + 1);
  input.selection = { sellerWarehouseIds: warehouseIds, products: [{ nmId: 1, chrtIds: sizes }] };
  input.catalog.cards = [{ nmID: 1, sizes: sizes.map((chrtID) => ({ chrtID })) }];
  input.warehouses.rows = warehouseIds.map((id) => ({ id }));
  input.stock.requests = warehouseIds.map((warehouseId) => ({ warehouseId, chrtIds: sizes }));
  input.stock.responses = warehouseIds.map((warehouseId) => ({ warehouseId, stocks: sizes.map((chrtId) => ({ chrtId, amount: 1 })) }));
  const output = bridgeFbsStock(input);
  assert.equal(output.status, "FBS_STOCK_IDENTITY_SYNTHETIC_VALID");
  assert.deepEqual(output.totals, { onHandUnits: 10000, cells: 10000 });
});
test("point snapshot may be a valid non-midnight instant", () => {
  const input = fresh(), point = "2024-02-29T12:34:56+03:00";
  input.context.stockAsOf = point;
  for (const s of [input.catalog, input.warehouses, input.stock]) s.asOf = point;
  const output = bridgeFbsStock(input);
  assert.equal(output.status, "FBS_STOCK_IDENTITY_SYNTHETIC_VALID");
  assert.equal(output.context.stockAsOf, point);
});
