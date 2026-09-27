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
    "tests/regression/extension-core/fixtures/wb-search-position-share-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const searchQuery = JSON.parse(read(slice.sources.details.reuseFixture));

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
  if (source.host)
    assert.equal(
      meta.host,
      source.host,
      source.operationAlias + ": host drift",
    );
  if (source.method)
    assert.equal(
      meta.method,
      source.method,
      source.operationAlias + ": method drift",
    );
  if (source.path)
    assert.equal(
      meta.path,
      source.path,
      source.operationAlias + ": path drift",
    );
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

function projectPositionShare(input) {
  if (typeof input.period !== "string" || !input.period)
    return { status: "INCOMPLETE", reason: "PERIOD_MISSING" };
  if (input.region !== null && input.region !== undefined)
    return { status: "INCOMPLETE", reason: "REGION_FILTER_UNSUPPORTED" };
  if (!["average", "median"].includes(input.positionKind))
    return { status: "INCOMPLETE", reason: "POSITION_DEFINITION_MISSING" };
  if (input.position === null || input.position === undefined)
    return { status: "UNKNOWN", reason: "POSITION_MISSING", position: null };
  if (!Number.isInteger(input.position) || input.position < 1)
    return { status: "INCOMPLETE", reason: "POSITION_INVALID" };

  const pricePercent = input.brandShare?.pricePercent ?? null;
  const qtyPercent = input.brandShare?.qtyPercent ?? null;
  for (const value of [pricePercent, qtyPercent]) {
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      return { status: "INCOMPLETE", reason: "BRAND_SHARE_INVALID" };
  }

  return {
    status: "COMPLETE",
    positionKind: input.positionKind,
    position: input.position,
    pricePercent,
    qtyPercent,
    nullMeansZero: false,
  };
}

assert.equal(
  slice.schemaVersion,
  "wb_search_position_share_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-23"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.analyticsSpecBlobSha,
  "de25972f376a6804e34c6842830c45cfed644d61",
);
assert.equal(
  slice.authority.reportsSpecBlobSha,
  "22ff073c10a3cebe0dc7af647eb2b704fd35857c",
);
assert.equal(
  slice.authority.mainRequestBlobSha,
  "d5205b264f4a440fcd536cb659382b199cd6a235",
);
assert.equal(
  slice.authority.mainResponseBlobSha,
  "0566c51ed5af99f47403edd558fa29346b4a660f",
);
assert.equal(
  slice.authority.positionInfoBlobSha,
  "072da396600edea880b78a893efdb36929d511bc",
);
assert.equal(
  slice.authority.tableGroupRequestBlobSha,
  "a4c0a468478da1d583ab4dd7806cbca4a9b918e8",
);
assert.equal(
  slice.authority.brandShareRowBlobSha,
  "a8fcfd372be5424a32bb933a06d863c5e778eca7",
);

const main = slice.sources.main;
const groups = slice.sources.groups;
const details = slice.sources.details;
const brandShare = slice.sources.brandShare;
assertOperation(main);
assertOperation(groups);
assertOperation({
  operationAlias: details.operationAlias,
  host: searchQuery.sources.details.host,
  method: searchQuery.sources.details.method,
  path: searchQuery.sources.details.path,
});
assertOperation(brandShare);

assert.deepEqual(main.request.positionCluster, [
  "all",
  "firstHundred",
  "secondHundred",
  "below",
]);
assert.deepEqual(groups.request.positionCluster, [
  "all",
  "firstHundred",
  "secondHundred",
  "below",
]);
assert.equal(main.request.limitMax, 1000);
assert.equal(groups.request.limitMax, 1000);
assert.equal(main.request.regionField, null);
assert.equal(groups.request.regionField, null);
assert.equal(details.regionField, null);
assert.equal(brandShare.regionField, null);
assert.equal(
  main.response.positionFields["average.current"].role,
  "provider_average_search_position",
);
assert.equal(
  main.response.positionFields["median.current"].role,
  "provider_median_search_position",
);
assert.deepEqual(brandShare.requiredQuery, [
  "parentId",
  "brand",
  "dateFrom",
  "dateTo",
]);
assert.equal(brandShare.maxPeriodDays, 365);
assert.equal(
  brandShare.responseFields.pricePercent.role,
  "sales_value_share_in_parent_category",
);
assert.equal(
  brandShare.responseFields.qtyPercent.role,
  "sales_quantity_share_in_parent_category",
);

const cap23 = scenarios.get("CAP-23");
assert.ok(cap23, "CAP-23 missing");
assert.deepEqual(cap23.wbOperations, slice.acceptedMappingSnapshot["CAP-23"]);
assert.deepEqual(cap23.numericFixtures, ["search_position_boundary"]);
assert.equal(cap23.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(
  cap23.externalDependency,
  "SEARCH_ANALYTICS_ENTITLEMENT_MAY_BE_REQUIRED",
);

const c = slice.syntheticCases;
for (const name of [
  "known",
  "nullShare",
  "missingPosition",
  "unsupportedRegion",
]) {
  assert.deepEqual(projectPositionShare(c[name]), c[name].expected, name);
}

assert.equal(
  slice.rules.region,
  "NO_REGION_PARAMETER_IN_PINNED_SEARCH_REPORT_OR_BRAND_SHARE_REQUESTS__REGION_SPECIFIC_CLAIM_UNSUPPORTED",
);
assert.equal(
  slice.rules.brandShare,
  "PRICE_PERCENT_AND_QTY_PERCENT_ARE_SALES_SHARE_IN_PARENT_CATEGORY_NOT_SEARCH_VISIBILITY_SHARE",
);
assert.equal(
  slice.rules.null,
  "OPTIONAL_MISSING_SHARE_OR_POSITION_EVIDENCE_IS_UNKNOWN_NOT_ZERO",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-23",
    positionClusters: main.request.positionCluster,
    regionFilterSupported: false,
    brandShareMeaning: "sales_share_in_parent_category",
    nullMeansZero: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
