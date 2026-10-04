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
    "tests/regression/extension-core/fixtures/wb-sales-geography-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const numeric = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json",
  ),
);
const operational = JSON.parse(read(slice.sources.sales.reuseFixture));

function compareCodeUnits(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

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

assert.equal(slice.schemaVersion, "wb_sales_geography_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-09"]);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.reportsSpecBlobSha,
  "22ff073c10a3cebe0dc7af647eb2b704fd35857c",
);
assert.equal(
  slice.authority.itemsSpecBlobSha,
  "54f6d7828f4188671ef68fde06922e609ef7e7a4",
);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
const sales = slice.sources.sales;
const offices = slice.sources.offices;
assertOperation(sales);
assertOperation(offices);
assert.equal(operational.sources.sales.operationAlias, sales.operationAlias);
assert.equal(
  operational.sources.sales.rowMeaning,
  "ONE_SALE_OR_RETURN_ONE_ITEM",
);
assert.equal(operational.sources.sales.authoritativeRevenueField, null);
assert.deepEqual(sales.saleIdSemantics, {
  S: "SALE",
  R: "RETURN_TO_WB_WAREHOUSE",
});
for (const field of [
  "warehouseName",
  "countryName",
  "oblastOkrugName",
  "regionName",
]) {
  assert.equal(sales.fields[field].unit, "text_optional");
}
assert.equal(sales.fields.finishedPrice.role, "operational_buyer_price_async");
assert.equal(
  offices.joinBoundary,
  "SALES_ROWS_EXPOSE_WAREHOUSE_NAME_NOT_OFFICE_ID_NO_AUTHORITATIVE_ID_JOIN",
);
assert.equal(offices.fields.id.role, "wb_office_id");
assert.equal(offices.fields.federalDistrict.unit, "text_or_null");

const std09 = scenarios.get("STD-09");
assert.ok(std09, "STD-09 missing");
assert.deepEqual(std09.wbOperations, slice.acceptedMappingSnapshot["STD-09"]);
assert.equal(std09.externalDependency, null);
assert.equal(std09.omissionPolicy, "MISSING_NOT_ZERO");
assert.ok(std09.numericFixtures.includes("warehouse_sales_sort"));
function summarize(rows) {
  const seen = new Set();
  const grouped = new Map();
  for (const row of rows) {
    if (!row || typeof row.saleID !== "string" || !row.saleID)
      return { status: "INCOMPLETE", reason: "SALE_ID_MISSING" };
    if (seen.has(row.saleID))
      return { status: "INCOMPLETE", reason: "DUPLICATE_SALE_ID" };
    seen.add(row.saleID);
    if (typeof row.warehouseName !== "string" || !row.warehouseName.trim())
      return { status: "INCOMPLETE", reason: "WAREHOUSE_NAME_MISSING" };
    const kind = row.saleID.startsWith("S")
      ? "SALE"
      : row.saleID.startsWith("R")
        ? "RETURN"
        : null;
    if (!kind) return { status: "INCOMPLETE", reason: "UNKNOWN_SALE_ID_KIND" };
    const key = row.warehouseName;
    if (!grouped.has(key)) {
      grouped.set(key, {
        warehouse: key,
        saleUnits: 0,
        returnUnits: 0,
        providerMoneyValues: [],
        country: row.countryName ?? null,
        district: row.oblastOkrugName ?? null,
        region: row.regionName ?? null,
      });
    }
    const target = grouped.get(key);
    for (const [field, value] of [
      ["country", row.countryName ?? null],
      ["district", row.oblastOkrugName ?? null],
      ["region", row.regionName ?? null],
    ]) {
      if (target[field] !== null && value !== null && target[field] !== value)
        return { status: "INCOMPLETE", reason: "WAREHOUSE_GEOGRAPHY_CONFLICT" };
      if (target[field] === null && value !== null) target[field] = value;
    }
    if (kind === "SALE") {
      target.saleUnits += 1;
      if (typeof row.finishedPrice === "number")
        target.providerMoneyValues.push(row.finishedPrice);
    } else {
      target.returnUnits += 1;
    }
  }
  return [...grouped.values()].sort(
    (a, b) =>
      b.saleUnits - a.saleUnits || compareCodeUnits(a.warehouse, b.warehouse),
  );
}

const c = slice.syntheticCases;
assert.deepEqual(summarize(c.warehouseDay.rows), c.warehouseDay.expected);
assert.deepEqual(summarize(c.duplicateSale.rows), c.duplicateSale.expected);
assert.deepEqual(
  summarize(c.missingWarehouse.rows),
  c.missingWarehouse.expected,
);

const codeUnitTie = summarize([
  { saleID: "S-code-unit-a", warehouseName: "Ä" },
  { saleID: "S-code-unit-z", warehouseName: "Z" },
]);
assert.deepEqual(
  codeUnitTie.map((row) => row.warehouse),
  ["Z", "Ä"],
  "STD-09 equal-sale-unit tie must use exact ECMAScript code-unit order",
);

assert.deepEqual(c.officeReference.expected, {
  status: "REFERENCE_ONLY",
  authoritativeOfficeId: null,
  reason: "NO_DOCUMENTED_SALES_OFFICE_ID_JOIN",
});
const warehouseSort = numeric.cases.find(
  (row) => row.id === "warehouse_sales_sort",
);
assert.ok(warehouseSort, "warehouse_sales_sort numeric fixture missing");
const sorted = [...warehouseSort.input.rows]
  .sort((a, b) => b.units - a.units || compareCodeUnits(a.warehouse, b.warehouse))
  .map((row) => row.warehouse);
assert.deepEqual(sorted, warehouseSort.expected);

assert.equal(slice.rules.saleUnits, "COUNT_ONLY_S_PREFIX_ROWS_AS_SALES");
assert.equal(
  slice.rules.returnUnits,
  "COUNT_R_PREFIX_ROWS_SEPARATELY_DO_NOT_NET_SILENTLY",
);
assert.equal(
  slice.rules.officeJoin,
  "DO_NOT_TREAT_NAME_MATCH_AS_AUTHORITATIVE_OFFICE_ID_LINK",
);
assert.equal(
  slice.rules.money,
  "PRESERVE_OPERATIONAL_FINISHED_PRICE_VALUES_DO_NOT_LABEL_AS_FINAL_REVENUE",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-09",
    operations: [sales.operationAlias, offices.operationAlias],
    directSalesGeography: [
      "warehouseName",
      "countryName",
      "oblastOkrugName",
      "regionName",
    ],
    officeIdJoinAuthoritative: false,
    returnsNetSilently: false,
    finalRevenueSelected: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
