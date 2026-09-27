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
    "tests/regression/extension-core/fixtures/wb-stock-field-schema-slice-v1.json",
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
const registryPath = coverage.authorities.wildberries.registryPath;
const wb = loadGlobal(registryPath, "WBOperations");
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

assert.equal(slice.schemaVersion, "wb_stock_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-08", "CAP-04"]);
assert.equal(slice.scope.liveValues, false);
for (const id of slice.scope.scenarioIds) {
  const scenario = scenarios.get(id);
  assert.ok(scenario, `${id}: mapped business scenario missing`);
  assert.equal(scenario.periodPolicy, "CURRENT_SNAPSHOT");
  assert.equal(scenario.omissionPolicy, "MISSING_NOT_ZERO");
  for (const alias of [
    "wb_warehouse_stocks",
    "fbs_stocks",
    "seller_warehouses",
  ])
    assert.ok(
      scenario.wbOperations.includes(alias),
      `${id}: current-stock alias ${alias} missing from accepted mapping`,
    );
}

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
const wbWarehouses = slice.sources.wbWarehouses;
assert.match(wbWarehouses.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.equal(wbWarehouses.freshnessMinutes, 30);
assert.deepEqual(wbWarehouses.rowGrain, ["nmId", "chrtId", "warehouseId"]);
assert.equal(wbWarehouses.pagination.kind, "offset");
assert.equal(wbWarehouses.pagination.limitMax, 250000);
assert.deepEqual(wbWarehouses.officialTokenTypes, ["personal", "service"]);
assertOperation(wbWarehouses.operationAlias, wbWarehouses);
assert.equal(wbWarehouses.replacesDeprecated.path, "/api/v1/supplier/stocks");
assert.equal(wbWarehouses.replacesDeprecated.disableDate, "2026-06-23");
assert.ok(
  wbWarehouses.replacesDeprecated.disableDate < slice.capturedDate,
  "deprecated supplier stocks endpoint cutoff must precede this evidence capture",
);
assert.notEqual(
  wbWarehouses.path,
  wbWarehouses.replacesDeprecated.path,
  "deprecated supplier stocks endpoint must not back the current slice",
);
assert.equal(wbWarehouses.fields.quantity.role, "current_on_hand_stock");
assert.equal(wbWarehouses.fields.quantity.unit, "product_units");
assert.deepEqual(slice.rules.transitExcludedFromOnHand, [
  "inWayToClient",
  "inWayFromClient",
]);

const seller = slice.sources.sellerWarehouses;
assert.match(seller.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.equal(seller.stockFreshnessSla, null);
assert.equal(seller.stockFreshnessBoundary, "NOT_DOCUMENTED_IN_METHOD");
assertOperation(seller.warehouseListAlias, seller.warehouseList);
assertOperation(seller.stockAlias, seller.stock);
assert.equal(seller.stock.pathWarehouseField, "id");
assert.equal(seller.stock.requestSizeField, "chrtIds");
assert.equal(seller.stock.responseArray, "stocks");
assert.equal(seller.stock.fields.amount.role, "current_on_hand_stock");
assert.equal(seller.stock.fields.amount.unit, "product_units");
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");
assert.equal(
  slice.rules.wbWarehouseCompleteness,
  "REQUIRES_COMPLETE_OFFSET_PAGINATION",
);
assert.equal(
  slice.rules.sellerWarehouseCompleteness,
  "REQUIRES_COMPLETE_CHRT_ID_INPUT_SET_PER_WAREHOUSE",
);
assert.equal(slice.rules.doNotMergeSchemes, true);
function aggregateWbWarehouses(rows) {
  const totals = new Map();
  for (const row of rows) {
    assert.ok(Number.isInteger(row.warehouseId), "WB warehouse ID required");
    assert.ok(
      Number.isInteger(row.quantity) && row.quantity >= 0,
      "WB quantity must be a non-negative integer",
    );
    const current = totals.get(row.warehouseId) || {
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      onHandUnits: 0,
    };
    assert.equal(
      current.warehouseName,
      row.warehouseName,
      "warehouse ID/name mismatch",
    );
    current.onHandUnits += row.quantity;
    totals.set(row.warehouseId, current);
  }
  return [...totals.values()].sort(
    (a, b) =>
      b.onHandUnits - a.onHandUnits ||
      a.warehouseName.localeCompare(b.warehouseName),
  );
}

const wbCase = slice.syntheticCases.wbWarehouses;
assert.deepEqual(aggregateWbWarehouses(wbCase.rows), wbCase.expected);
assert.notEqual(
  wbCase.expected[1].onHandUnits,
  wbCase.rows
    .filter((row) => row.warehouseId === 507)
    .reduce(
      (sum, row) =>
        sum + row.quantity + row.inWayToClient + row.inWayFromClient,
      0,
    ),
  "transit counts must not be added to current on-hand stock",
);
function aggregateSellerWarehouses(warehouses, responses) {
  const names = new Map(warehouses.map((row) => [row.id, row.name]));
  if (names.size !== warehouses.length)
    return { status: "INCOMPLETE", reason: "DUPLICATE_WAREHOUSE_ID" };
  const byWarehouse = new Map();
  for (const response of responses) {
    if (
      !names.has(response.warehouseId) ||
      byWarehouse.has(response.warehouseId)
    )
      return { status: "INCOMPLETE", reason: "WAREHOUSE_RESPONSE_MISMATCH" };
    let total = 0;
    for (const row of response.stocks) {
      if (
        !Number.isInteger(row.chrtId) ||
        !Number.isInteger(row.amount) ||
        row.amount < 0
      )
        return { status: "INCOMPLETE", reason: "INVALID_STOCK_ROW" };
      total += row.amount;
    }
    byWarehouse.set(response.warehouseId, total);
  }
  if (byWarehouse.size !== names.size)
    return { status: "INCOMPLETE", reason: "MISSING_WAREHOUSE_RESPONSE" };
  return {
    status: "COMPLETE",
    rows: [...byWarehouse]
      .map(([warehouseId, onHandUnits]) => ({
        warehouseId,
        warehouseName: names.get(warehouseId),
        onHandUnits,
      }))
      .sort(
        (a, b) =>
          b.onHandUnits - a.onHandUnits ||
          a.warehouseName.localeCompare(b.warehouseName),
      ),
  };
}
const sellerCase = slice.syntheticCases.sellerWarehouses;
const sellerResult = aggregateSellerWarehouses(
  sellerCase.warehouses,
  sellerCase.responses,
);
assert.equal(sellerResult.status, "COMPLETE");
assert.deepEqual(sellerResult.rows, sellerCase.expected);
assert.deepEqual(
  aggregateSellerWarehouses(
    sellerCase.warehouses,
    sellerCase.responses.slice(0, 1),
  ),
  { status: "INCOMPLETE", reason: "MISSING_WAREHOUSE_RESPONSE" },
  "missing seller-warehouse data must not become zero stock",
);

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      wbWarehouses.operationAlias,
      seller.warehouseListAlias,
      seller.stockAlias,
    ],
    evidence: slice.scope.evidence,
    liveValues: slice.scope.liveValues,
  }),
);
