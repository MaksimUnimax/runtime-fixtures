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
    "tests/regression/extension-core/fixtures/wb-order-lifecycle-field-schema-slice-v1.json",
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
  assert.equal(
    meta.effect,
    "READ",
    source.operationAlias + ": must remain read-only",
  );
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

assert.equal(slice.schemaVersion, "wb_order_lifecycle_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-11", "CAP-09", "CAP-12"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
const s = slice.sources;
for (const source of [
  s.statisticsOrders,
  s.fbsOrders,
  s.fbsStatuses,
  s.dbsOrders,
  s.dbsStatuses,
  s.dbwOrders,
  s.dbwStatuses,
  s.goodsReturn,
  s.buyerReturnClaims,
]) {
  assert.match(source.url, /^https:\/\/dev\.wildberries\.ru\//);
  assertOperation(source);
}

assert.equal(
  s.statisticsOrders.freshness,
  "PRELIMINARY_OPERATIONAL_30_MINUTES",
);
assert.equal(s.statisticsOrders.storageGuaranteeDays, 90);
assert.equal(s.statisticsOrders.requestUtcOffset, "+03:00");
assert.deepEqual(s.statisticsOrders.rowGrain, ["srid"]);
assert.equal(s.statisticsOrders.fields.isCancel.unit, "boolean");
assert.equal(s.statisticsOrders.pagination.terminal, "EMPTY_ARRAY");

assert.equal(s.fbsOrders.maxPeriodDays, 30);
assert.equal(s.fbsOrders.returnsCurrentStatus, false);
assert.equal(s.fbsStatuses.requestIdField, "orders");
assert.equal(s.fbsStatuses.requestMaxIds, 1000);
assert.notEqual(
  s.fbsStatuses.fields.supplierStatus.role,
  s.fbsStatuses.fields.wbStatus.role,
);

assert.equal(s.dbsOrders.completedOnly, true);
assert.equal(s.dbsOrders.maxPeriodDays, 30);
assert.equal(s.dbsStatuses.requestIdField, "ordersIds");
assert.equal(s.dbsStatuses.requestMaxIds, 1000);
assert.equal(s.dbsStatuses.fields.errors.role, "per_order_lookup_error");

assert.equal(s.goodsReturn.maxPeriodDays, 31);
assert.equal(s.goodsReturn.fields.status.role, "return_movement_status");
assert.equal(s.goodsReturn.fields.returnType.role, "return_movement_type");
assert.deepEqual(s.buyerReturnClaims.requiredQuery, ["is_archive"]);
assert.equal(s.buyerReturnClaims.isArchiveWireType, "string_boolean");
assert.equal(s.buyerReturnClaims.fields.status.role, "claim_status");
assert.notEqual(
  s.goodsReturn.fields.status.role,
  s.buyerReturnClaims.fields.status.role,
);

for (const id of slice.scope.scenarioIds) {
  const scenario = scenarios.get(id);
  assert.ok(scenario, id + ": scenario missing");
  assert.equal(scenario.omissionPolicy, "MISSING_NOT_ZERO");
}
for (const [id, expected] of Object.entries(slice.acceptedMappingSnapshot)) {
  assert.deepEqual(
    scenarios.get(id).wbOperations,
    expected,
    id + ": accepted operation mapping changed",
  );
}

const detectedRegistryGaps = slice.knownRegistryGaps.map((gap) => {
  const meta = wb.OPERATIONS[gap.operationAlias];
  assert.ok(
    meta,
    "known registry gap operation missing: " + gap.operationAlias,
  );
  return {
    operationAlias: gap.operationAlias,
    field: gap.field,
    currentFrozenValue: meta[gap.field],
  };
});
assert.deepEqual(
  detectedRegistryGaps,
  slice.knownRegistryGaps.map(
    ({ operationAlias, field, currentFrozenValue }) => ({
      operationAlias,
      field,
      currentFrozenValue,
    }),
  ),
  "known shared registry metadata gap changed; reconcile instead of silently masking it",
);

function joinCurrentStatus(order, status) {
  if (!order || !Number.isInteger(order.id))
    return { status: "INCOMPLETE", reason: "ORDER_ID_MISSING" };
  if (!status)
    return { status: "INCOMPLETE", reason: "CURRENT_STATUS_MISSING" };
  const statusId = status.id ?? status.orderId;
  if (statusId !== order.id)
    return { status: "INCOMPLETE", reason: "ORDER_STATUS_ID_MISMATCH" };
  if (
    typeof status.supplierStatus !== "string" ||
    typeof status.wbStatus !== "string"
  )
    return { status: "INCOMPLETE", reason: "ORDER_STATUS_FIELDS_MISSING" };
  return {
    id: order.id,
    supplierStatus: status.supplierStatus,
    wbStatus: status.wbStatus,
  };
}

const c = slice.syntheticCases;
assert.deepEqual(
  joinCurrentStatus(c.orderStatus.order, c.orderStatus.status),
  c.orderStatus.expected,
);
assert.deepEqual(
  joinCurrentStatus(c.missingStatus.order, null),
  c.missingStatus.expected,
);
function returnKinds(claim, movement) {
  const result = [];
  if (
    claim &&
    typeof claim.id === "string" &&
    Number.isInteger(claim.nm_id) &&
    Number.isInteger(claim.claim_type) &&
    Number.isInteger(claim.status)
  )
    result.push("BUYER_RETURN_CLAIM");
  if (
    movement &&
    Number.isInteger(movement.shkId) &&
    Number.isInteger(movement.nmId) &&
    Number.isInteger(movement.orderId) &&
    typeof movement.status === "string" &&
    typeof movement.returnType === "string"
  )
    result.push("GOODS_RETURN_MOVEMENT");
  return result;
}
assert.deepEqual(
  returnKinds(c.returnEvents.claim, c.returnEvents.movement),
  c.returnEvents.expectedKinds,
);
assert.equal(
  slice.rules.currentStatus,
  "ORDER_LIST_ROWS_DO_NOT_REPLACE_CURRENT_STATUS_ENDPOINTS",
);
assert.equal(
  slice.rules.fbsStatus,
  "SUPPLIER_STATUS_AND_WB_STATUS_ARE_DISTINCT",
);
assert.equal(
  slice.rules.returns,
  "BUYER_RETURN_CLAIM_AND_GOODS_RETURN_MOVEMENT_ARE_DISTINCT_EVENT_FAMILIES",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");
assert.equal(
  slice.rules.causality,
  "MOVEMENT_OR_RETURN_STATUS_DOES_NOT_PROVE_INVENTORY_WRITEOFF_CAUSE",
);

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      s.statisticsOrders.operationAlias,
      s.fbsOrders.operationAlias,
      s.fbsStatuses.operationAlias,
      s.dbsOrders.operationAlias,
      s.dbsStatuses.operationAlias,
      s.dbwOrders.operationAlias,
      s.dbwStatuses.operationAlias,
      s.goodsReturn.operationAlias,
      s.buyerReturnClaims.operationAlias,
    ],
    knownRegistryGaps: detectedRegistryGaps,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
