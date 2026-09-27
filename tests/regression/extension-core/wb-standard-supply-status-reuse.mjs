import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));

const slice = readJson(
  "tests/regression/extension-core/fixtures/wb-standard-supply-status-reuse-v1.json",
);
const source = readJson(slice.reuse.fixture);
const coverage = readJson(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

assert.equal(slice.schemaVersion, "wb_standard_supply_status_reuse_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-12"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(source.schemaVersion, slice.reuse.requiredSchemaVersion);
assert.deepEqual(slice.reuse.operations, ["fbw_supplies", "fbs_supplies"]);

const std12 = scenarios.get("STD-12");
assert.ok(std12, "STD-12 missing");
assert.deepEqual(std12.wbOperations, slice.acceptedMappingSnapshot["STD-12"]);
assert.equal(std12.continuationPolicy, "EXPLICIT_PAGINATION");
assert.equal(std12.omissionPolicy, "MISSING_NOT_ZERO");
const labels = source.sources.fbwSupplies.statusIDs;

function projectFbw(row) {
  if (
    !row ||
    !Number.isInteger(row.supplyID) ||
    !Number.isInteger(row.preorderID) ||
    !Number.isInteger(row.statusID)
  )
    return { status: "INCOMPLETE", reason: "FBW_STATUS_ROW_INVALID" };
  const label = labels[String(row.statusID)];
  if (!label) return { status: "INCOMPLETE", reason: "UNKNOWN_FBW_STATUS_ID" };
  return {
    scheme: "FBW",
    supplyId: String(row.supplyID),
    status: label,
    providerStatusId: row.statusID,
  };
}

function projectFbs(row) {
  if (!row || typeof row.id !== "string" || !row.id)
    return { status: "INCOMPLETE", reason: "FBS_SUPPLY_ID_INVALID" };
  if (typeof row.done !== "boolean")
    return { status: "INCOMPLETE", reason: "FBS_DONE_MISSING" };
  return {
    scheme: "FBS",
    supplyId: row.id,
    status: row.done ? "DONE" : "OPEN",
    providerStatusId: null,
  };
}

function unified(fbwRows, fbsRows) {
  const rows = [...fbwRows.map(projectFbw), ...fbsRows.map(projectFbs)];
  const invalid = rows.find((row) => row.status === "INCOMPLETE");
  if (invalid) return invalid;
  return rows.sort(
    (a, b) =>
      a.scheme.localeCompare(b.scheme) || a.supplyId.localeCompare(b.supplyId),
  );
}
const c = slice.syntheticCases;
assert.deepEqual(unified(c.rows.fbw, c.rows.fbs), c.rows.expected);
assert.deepEqual(
  projectFbw(c.unknownFbwStatus.row),
  c.unknownFbwStatus.expected,
);
assert.deepEqual(projectFbs(c.missingFbsDone.row), c.missingFbsDone.expected);

assert.equal(
  slice.rules.unified,
  "ADD_SCHEME_TAG_DO_NOT_COLLAPSE_TO_SHARED_PROVIDER_ENUM",
);
assert.equal(
  slice.rules.pagination,
  "COMPLETE_EACH_SCHEME_WITH_ITS_OWN_PAGINATION_BEFORE_FULL_LIST_CLAIM",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-12",
    reusedOperations: slice.reuse.operations,
    crossSchemeEnumInvented: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
