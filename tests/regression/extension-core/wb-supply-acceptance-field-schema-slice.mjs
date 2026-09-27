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
    "tests/regression/extension-core/fixtures/wb-supply-acceptance-field-schema-slice-v1.json",
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
    source.operationAlias + ": must remain READ",
  );
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

assert.equal(slice.schemaVersion, "wb_supply_acceptance_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-08"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, true);

for (const source of Object.values(slice.sources)) assertOperation(source);

const createMeta = wb.OPERATIONS[slice.sources.acceptanceCreate.operationAlias];
assert.equal(createMeta.read_kind, "derived");
assert.equal(slice.sources.acceptanceCreate.maxPeriodDays, 31);
assert.deepEqual(slice.sources.acceptanceStatus.statuses, [
  "new",
  "processing",
  "done",
  "purged",
  "canceled",
]);
assert.equal(slice.sources.acceptanceDownload.emptyHttpStatus, 204);
assert.equal(
  slice.sources.fbwSupply.fields.acceptedQuantity.role,
  "accepted_units",
);
assert.equal(
  slice.sources.fbwSupplyGoods.fields.acceptedQuantity.role,
  "accepted_units",
);
assert.equal(slice.sources.fbsSupply.fields.done.unit, "boolean");
assert.equal(
  slice.sources.fbsSupplyOrderIds.fields.orderIds.unit,
  "identifier_array",
);
const cap08 = scenarios.get("CAP-08");
assert.ok(cap08, "CAP-08 missing");
assert.deepEqual(cap08.wbOperations, slice.acceptedMappingAfter);
assert.equal(cap08.continuationPolicy, "EXPLICIT_REPORT_LIFECYCLE");
assert.equal(cap08.omissionPolicy, "MISSING_NOT_ZERO");

const std13 = scenarios.get("STD-13");
assert.ok(std13, "STD-13 missing");
for (const alias of [
  "acceptance_report_create",
  "acceptance_report_status",
  "acceptance_report_download",
])
  assert.ok(
    std13.wbOperations.includes(alias),
    "STD-13 must keep the accepted full report lifecycle",
  );

function summarizeFbw(supply, goods) {
  if (
    !supply ||
    !Number.isInteger(supply.acceptedQuantity) ||
    supply.acceptedQuantity < 0
  )
    return { status: "INCOMPLETE", reason: "SUPPLY_ACCEPTED_QUANTITY_INVALID" };
  if (
    !Array.isArray(goods) ||
    goods.some(
      (row) =>
        typeof row.barcode !== "string" ||
        !Number.isInteger(row.acceptedQuantity) ||
        row.acceptedQuantity < 0,
    )
  )
    return { status: "INCOMPLETE", reason: "GOODS_ACCEPTED_QUANTITY_INVALID" };
  const acceptedUnits = goods.reduce(
    (sum, row) => sum + row.acceptedQuantity,
    0,
  );
  return {
    status: "PASS",
    acceptedUnits,
    matchesSupply: acceptedUnits === supply.acceptedQuantity,
  };
}
function summarizeFbs(supply, orderIds) {
  if (
    !supply ||
    typeof supply.id !== "string" ||
    typeof supply.done !== "boolean"
  )
    return { status: "INCOMPLETE", reason: "FBS_SUPPLY_INVALID" };
  if (
    !Array.isArray(orderIds) ||
    orderIds.some((id) => !Number.isSafeInteger(id))
  )
    return { status: "INCOMPLETE", reason: "FBS_ORDER_IDS_INVALID" };
  return {
    status: "PASS",
    closed: supply.done,
    orderCount: orderIds.length,
    acceptedUnits: null,
  };
}

function summarizeReport(statuses, rows) {
  if (!Array.isArray(statuses) || statuses.length === 0)
    return { status: "INCOMPLETE", reason: "REPORT_STATUS_MISSING" };
  const final = statuses.at(-1);
  if (final === "canceled")
    return { status: "INCOMPLETE", reason: "REPORT_TASK_CANCELED" };
  if (final === "purged")
    return { status: "INCOMPLETE", reason: "REPORT_TASK_PURGED" };
  if (final !== "done")
    return { status: "INCOMPLETE", reason: "REPORT_NOT_DONE" };
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !Number.isInteger(row.incomeId) ||
        !Number.isInteger(row.nmID) ||
        !Number.isInteger(row.count) ||
        row.count < 0,
    )
  )
    return { status: "INCOMPLETE", reason: "REPORT_ROWS_INVALID" };
  return {
    status: "PASS",
    acceptedUnits: rows.reduce((sum, row) => sum + row.count, 0),
  };
}
const c = slice.syntheticCases;
assert.deepEqual(summarizeFbw(c.fbw.supply, c.fbw.goods), c.fbw.expected);
assert.deepEqual(summarizeFbs(c.fbs.supply, c.fbs.orderIds), c.fbs.expected);
assert.deepEqual(
  summarizeReport(c.report.statuses, c.report.rows),
  c.report.expected,
);
assert.deepEqual(
  summarizeReport(c.canceledReport.statuses, c.canceledReport.rows),
  c.canceledReport.expected,
);
assert.deepEqual(
  summarizeReport(c.prematureDownload.statuses, c.prematureDownload.rows),
  c.prematureDownload.expected,
);

assert.equal(
  slice.rules.mappingRepair,
  "CAP08_ACCEPTED_UNITS_REQUIRES_STATUS_AND_DOWNLOAD_NOT_CREATE_ONLY",
);
assert.equal(
  slice.rules.reportLifecycle,
  "CREATE_TASK_THEN_WAIT_FOR_DONE_THEN_DOWNLOAD",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-08",
    mappingBefore: slice.acceptedMappingBefore.length,
    mappingAfter: slice.acceptedMappingAfter.length,
    reportLifecycleComplete: true,
    acceptedOperationMappingChanged: true,
    liveValues: false,
  }),
);
