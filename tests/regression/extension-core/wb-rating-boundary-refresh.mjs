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
    "tests/regression/extension-core/fixtures/wb-rating-boundary-refresh-v1.json",
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

function projectBoundary(input) {
  for (const [name, value] of [
    ["sellerRating", input.sellerRating],
    ["productRating", input.productRating],
    ["measurementPenalty", input.measurementPenalty],
  ]) {
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      return { status: "INCOMPLETE", reason: name + "_INVALID" };
  }

  return {
    status: "BOUNDARY",
    sellerRating: input.sellerRating ?? null,
    productRating: input.productRating ?? null,
    measurementPenalty: input.measurementPenalty ?? null,
    fbsErrorIndexKnown: false,
    fbsErrorIndex: null,
  };
}

assert.equal(slice.schemaVersion, "wb_rating_boundary_refresh_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-15"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, true);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.changelogBlobSha,
  "7a9395c29abff969d072f95587fdb0094497b6cd",
);
assert.equal(slice.authority.itemRatingV1RemovedDate, "2026-08-15");

const frozenV1 = wb.OPERATIONS[slice.sources.deletedRatingV1.operationAlias];
assert.ok(frozenV1, "frozen v1 alias missing; drift evidence changed");
assert.equal(frozenV1.path, slice.sources.deletedRatingV1.frozenRegistryPath);
assert.equal(
  frozenV1.current,
  true,
  "frozen registry no longer demonstrates stale-v1 drift",
);
assert.equal(slice.sources.deletedRatingV1.currentMirrorOpenApiPresent, false);
assert.equal(
  slice.sources.deletedRatingV1.replacement,
  "analytics_item_rating_v2",
);

const rating = slice.sources.ratingV2;
const penalties = slice.sources.measurementPenalties;
assertOperation(rating);
assertOperation(penalties);
assert.deepEqual(rating.tokenTypes, ["personal", "service"]);
assert.equal(rating.request.currentPeriodRequired, true);
assert.equal(rating.request.maxNmIds, 50);
assert.equal(rating.request.limitMax, 1000);
assert.equal(rating.request.offsetRequired, true);
assert.equal(
  rating.response.sellerRating.current.role,
  "seller_rating_current",
);
assert.equal(rating.response.productFields.rating.role, "product_card_rating");
assert.equal(
  rating.response.productFields.isShadowed.role,
  "provider_hidden_from_catalog_flag",
);
assert.equal(penalties.pagination, "OFFSET_WITH_RESPONSE_TOTAL");
assert.equal(penalties.rowGrain[0], "dimId");
assert.equal(
  penalties.fields.penaltyAmount.role,
  "measurement_penalty_amount_optional",
);
assert.equal(
  penalties.meaning,
  "DIMENSION_MEASUREMENT_PENALTIES_NOT_ORDER_FULFILLMENT_ERROR_INDEX",
);

const cap15 = scenarios.get("CAP-15");
assert.ok(cap15, "CAP-15 missing");
assert.deepEqual(cap15.wbOperations, slice.acceptedMappingAfter["CAP-15"]);
assert.deepEqual(cap15.numericFixtures, ["rating_boundary"]);
assert.equal(
  cap15.externalDependency,
  "WB_NO_EXACT_OZON_FBS_ERROR_INDEX_EQUIVALENT",
);
assert.equal(cap15.omissionPolicy, "MISSING_NOT_ZERO");
assert.ok(
  !cap15.wbOperations.includes("analytics_item_rating_v1"),
  "removed v1 rating endpoint returned to current CAP-15 mapping",
);

const c = slice.syntheticCases;
for (const name of ["known", "missingPenalty", "missingRating"]) {
  assert.deepEqual(projectBoundary(c[name]), c[name].expected, name);
}

assert.equal(
  slice.rules.penalty,
  "MEASUREMENT_PENALTY_IS_DIMENSION_MEASUREMENT_EVIDENCE_NOT_FBS_FULFILLMENT_ERROR_INDEX",
);
assert.equal(
  slice.rules.noEquivalent,
  "NO_EXACT_WB_EQUIVALENT_TO_OZON_SELLER_FBS_ERROR_INDEX_IS_INVENTED",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-15",
    currentOperations: cap15.wbOperations,
    deletedV1Excluded: true,
    fbsErrorIndexEquivalentClaimed: false,
    measurementPenaltyMeaning: "dimension_measurement_penalty",
    acceptedOperationMappingChanged: true,
    liveValues: false,
  }),
);
