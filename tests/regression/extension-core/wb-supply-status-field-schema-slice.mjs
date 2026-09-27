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
    "tests/regression/extension-core/fixtures/wb-supply-status-field-schema-slice-v1.json",
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
  return meta;
}

assert.equal(slice.schemaVersion, "wb_supply_status_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-07"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const fbw = slice.sources.fbwSupplies;
const fbs = slice.sources.fbsSupplies;
assert.match(fbw.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.match(fbs.url, /^https:\/\/dev\.wildberries\.ru\//);
const fbwMeta = assertOperation(fbw);
const fbsMeta = assertOperation(fbs);
assert.equal(fbwMeta.body_required, true);
assert.deepEqual([...fbsMeta.required_query_keys], ["limit", "next"]);
assert.deepEqual([...fbsMeta.query_keys], ["limit", "next"]);
assert.equal(fbw.query.limit.max, 1000);
assert.equal(fbw.query.offset.default, 0);
assert.equal(fbw.bodyRequired, true);
assert.equal(fbs.query.limit.max, 1000);
assert.equal(fbs.query.next.initial, 0);
assert.equal(fbs.pagination.nextCursor, "RESPONSE_NEXT");
assert.equal(
  fbs.pagination.terminal,
  "NOT_EXPLICIT_IN_SURFACED_DOCS_FAIL_CLOSED_ON_NO_PROGRESS",
);

assert.deepEqual(Object.keys(fbw.statusIDs), ["1", "2", "3", "4", "5", "6"]);
assert.equal(fbw.fields.statusID.unit, "provider_enum_integer");
assert.equal(fbs.fields.done.unit, "boolean");
assert.notEqual(
  fbw.fields.statusID.role,
  fbs.fields.done.role,
  "FBW statusID and FBS done must not be conflated",
);

const cap07 = scenarios.get("CAP-07");
assert.ok(cap07, "CAP-07 missing");
assert.deepEqual(cap07.wbOperations, slice.acceptedMappingSnapshot["CAP-07"]);
assert.equal(cap07.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(cap07.continuationPolicy, "EXPLICIT_PAGINATION");

function fbwStatus(row) {
  if (
    !row ||
    !Number.isInteger(row.preorderID) ||
    !Number.isInteger(row.statusID)
  )
    return { status: "INCOMPLETE", reason: "FBW_STATUS_ROW_INVALID" };
  const label = fbw.statusIDs[String(row.statusID)];
  if (!label) return { status: "INCOMPLETE", reason: "UNKNOWN_FBW_STATUS_ID" };
  return label;
}

function fbsStatus(row) {
  if (!row || typeof row.id !== "string" || row.id.length === 0)
    return { status: "INCOMPLETE", reason: "FBS_SUPPLY_ID_INVALID" };
  if (typeof row.done !== "boolean")
    return { status: "INCOMPLETE", reason: "FBS_DONE_MISSING" };
  return row.done ? "DONE" : "OPEN";
}
for (const row of slice.syntheticCases.fbw)
  assert.equal(fbwStatus(row), row.expected);
for (const row of slice.syntheticCases.fbs)
  assert.equal(fbsStatus(row), row.expected);

const invalidFbw = slice.syntheticCases.invalidFbw;
assert.deepEqual(fbwStatus(invalidFbw), invalidFbw.expected);
const missingFbs = slice.syntheticCases.missingFbsDone;
assert.deepEqual(fbsStatus(missingFbs), missingFbs.expected);

assert.equal(
  slice.rules.status,
  "DO_NOT_MAP_FBW_STATUS_ID_TO_FBS_DONE_BOOLEAN",
);
assert.equal(slice.rules.fbw, "STATUS_ID_IS_PROVIDER_ENUM_1_TO_6");
assert.equal(
  slice.rules.fbs,
  "DONE_IS_BOOLEAN_SUPPLY_STATE_SIGNAL_NOT_FBW_STATUS_ENUM",
);
assert.equal(
  slice.rules.pagination,
  "SCHEME_SPECIFIC_PAGINATION_MUST_COMPLETE_BEFORE_FULL_LIST_CLAIM",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [fbw.operationAlias, fbs.operationAlias],
    fbwStatusIds: Object.keys(fbw.statusIDs).map(Number),
    fbsStatusSignal: "done:boolean",
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
