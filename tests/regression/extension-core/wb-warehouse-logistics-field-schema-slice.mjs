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
    "tests/regression/extension-core/fixtures/wb-warehouse-logistics-field-schema-slice-v1.json",
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

function assertOperation(source) {
  const meta = wb.OPERATIONS[source.operationAlias];
  assert.ok(meta, "missing WB operation " + source.operationAlias);
  assert.equal(meta.host, source.host, source.operationAlias + ": host drift");
  assert.equal(
    meta.method,
    source.method,
    source.operationAlias + ": method drift",
  );
  assert.equal(meta.path, source.path, source.operationAlias + ": path drift");
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
}

assert.equal(
  slice.schemaVersion,
  "wb_warehouse_logistics_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-06"]);
assert.equal(
  slice.scope.evidence,
  "CURRENT_UPSTREAM_OPENAPI_MIRROR_FIELD_SCHEMA",
);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(slice.authority.mirrorRepository, "eslazarev/wildberries-sdk");
assert.equal(
  slice.authority.generationBlobSha,
  "43ac4287e0afe98f273fd00f1a89bdf6c6229565",
);
assert.equal(slice.authority.directPortalFetch, "HTTP_498_BROWSER_CHECK");
assert.equal(
  slice.authority.specs["02-items.yaml"].blobSha,
  "54f6d7828f4188671ef68fde06922e609ef7e7a4",
);
assert.equal(
  slice.authority.specs["07-orders-fbw.yaml"].blobSha,
  "7ae91e4101c9a2c0f74d2c34c6dbf743d8ef5f45",
);

const offices = slice.sources.marketplaceOffices;
const seller = slice.sources.sellerWarehouses;
const fbw = slice.sources.fbwWarehouses;
for (const source of [offices, seller, fbw]) {
  assert.match(source.url, /^https:\/\/dev\.wildberries\.ru\//);
  assertOperation(source);
}
assert.deepEqual(offices.rowGrain, ["id"]);
assert.deepEqual(seller.rowGrain, ["id"]);
assert.deepEqual(fbw.rowGrain, ["ID"]);
assert.equal(seller.geographyJoin, "officeId -> marketplace_offices.id");
assert.equal(fbw.clusterIdField, null);
assert.equal(
  fbw.clusterBoundary,
  "NO_CLUSTER_ID_FIELD_IN_CURRENT_WAREHOUSE_SCHEMA_DO_NOT_INFER_FROM_NAME_OR_ADDRESS",
);
assert.equal(offices.fields.latitude.unit, "decimal_degrees");
assert.equal(offices.fields.longitude.unit, "decimal_degrees");
assert.equal(offices.fields.federalDistrict.role, "federal_district");
assert.equal(seller.fields.officeId.role, "linked_wb_office_id");
assert.notEqual(fbw.fields.isActive.role, fbw.fields.isTransitActive.role);

const cap06 = scenarios.get("CAP-06");
assert.ok(cap06, "CAP-06 missing");
assert.deepEqual(cap06.wbOperations, slice.acceptedMappingSnapshot["CAP-06"]);
assert.equal(cap06.omissionPolicy, "MISSING_NOT_ZERO");

function joinSellerWarehouse(warehouse, officeRows) {
  if (!warehouse || !Number.isInteger(warehouse.id))
    return { status: "INCOMPLETE", reason: "SELLER_WAREHOUSE_ID_INVALID" };
  if (!Number.isInteger(warehouse.officeId))
    return {
      status: "INCOMPLETE",
      reason: "SELLER_WAREHOUSE_OFFICE_ID_INVALID",
    };
  const matched = officeRows.filter(
    (office) => office.id === warehouse.officeId,
  );
  if (matched.length !== 1)
    return { status: "INCOMPLETE", reason: "LINKED_OFFICE_MISSING" };
  const office = matched[0];
  for (const field of ["city", "federalDistrict"]) {
    if (typeof office[field] !== "string")
      return { status: "INCOMPLETE", reason: "OFFICE_GEOGRAPHY_INVALID" };
  }
  if (!Number.isFinite(office.latitude) || !Number.isFinite(office.longitude))
    return { status: "INCOMPLETE", reason: "OFFICE_COORDINATES_INVALID" };
  return {
    status: "PASS",
    warehouseId: warehouse.id,
    officeId: office.id,
    city: office.city,
    federalDistrict: office.federalDistrict,
    latitude: office.latitude,
    longitude: office.longitude,
  };
}
function projectFbwWarehouse(row) {
  if (!row || !Number.isInteger(row.ID))
    return { status: "INCOMPLETE", reason: "FBW_WAREHOUSE_ID_INVALID" };
  if (
    typeof row.isActive !== "boolean" ||
    typeof row.isTransitActive !== "boolean"
  )
    return { status: "INCOMPLETE", reason: "FBW_ACTIVITY_FLAGS_INVALID" };
  return {
    warehouseId: row.ID,
    active: row.isActive,
    transitActive: row.isTransitActive,
    clusterId: null,
  };
}

const c = slice.syntheticCases;
assert.deepEqual(
  joinSellerWarehouse(
    c.sellerWarehouseJoin.warehouses[0],
    c.sellerWarehouseJoin.offices,
  ),
  c.sellerWarehouseJoin.expected,
);
assert.deepEqual(
  joinSellerWarehouse(c.missingOffice.warehouse, c.missingOffice.offices),
  c.missingOffice.expected,
);
assert.deepEqual(projectFbwWarehouse(c.fbw.row), c.fbw.expected);

assert.equal(
  slice.rules.sellerJoin,
  "SELLER_WAREHOUSE_OFFICE_ID_MUST_JOIN_EXACTLY_TO_OFFICE_ID_FOR_OFFICE_GEOGRAPHY",
);
assert.equal(
  slice.rules.cluster,
  "DO_NOT_DERIVE_CLUSTER_FROM_WAREHOUSE_NAME_CITY_DISTRICT_OR_ADDRESS",
);
assert.equal(
  slice.rules.fbwIdentity,
  "FBW_WAREHOUSE_ID_NAMESPACE_STAYS_DISTINCT_FROM_MARKETPLACE_OFFICE_AND_SELLER_WAREHOUSE_IDS",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      offices.operationAlias,
      seller.operationAlias,
      fbw.operationAlias,
    ],
    sellerOfficeJoin: true,
    fbwClusterIdAvailable: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
