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
    "tests/regression/extension-core/fixtures/wb-content-quality-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const catalogIdentity = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-catalog-identity-field-schema-slice-v1.json",
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

assert.equal(slice.schemaVersion, "wb_content_quality_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-03"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, true);

const errors = slice.sources.cardsErrors;
const cards = slice.sources.cardsList;
const recommendations = slice.sources.contentRecommendations;
assert.match(errors.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.match(cards.url, /^https:\/\/dev\.wildberries\.ru\//);
const errorsMeta = assertOperation(errors);
const cardsMeta = assertOperation(cards);
const recMeta = assertOperation(recommendations);
assert.equal(errorsMeta.body_required, true);
assert.equal(cardsMeta.body_required, true);
assert.equal(errors.bodyRequired, true);
assert.equal(errors.pagination.terminal, "RESPONSE_CURSOR_NEXT_FALSE");
assert.deepEqual(errors.pagination.nextCursor, ["updatedAt", "batchUUID"]);
assert.equal(errors.batchFields.errors.role, "provider_errors_by_vendor_code");
assert.equal(catalogIdentity.source.fields.nmID.role, "product_card_id");
assert.equal(catalogIdentity.source.fields.vendorCode.role, "seller_article");
assert.equal(
  recommendations.currentOfficialFieldSchema,
  "RESOLVED_PRODUCT_RECOMMENDATION_LIST",
);
assert.deepEqual(recommendations.tokenTypes, ["personal", "service"]);
assert.equal(recommendations.bodyRequired, false);
assert.equal(recommendations.response.rowGrain[0], "nmId");
assert.equal(
  recommendations.response.fields.recomCount.role,
  "recommended_product_count",
);
assert.equal(
  recommendations.response.fields.recomNms.role,
  "recommended_product_ids",
);
assert.equal(recommendations.qualitySignalAllowed, false);
assert.equal(recommendations.expertQualityScoreAllowed, false);
assert.equal(
  recommendations.acceptedMappingUse,
  "EXCLUDED_FROM_CAP03_QUALITY_MAPPING",
);
assert.equal(recMeta.source_path, recommendations.path);
const cap03 = scenarios.get("CAP-03");
assert.ok(cap03, "CAP-03 missing");
assert.deepEqual(slice.acceptedMappingBefore["CAP-03"], [
  "cards_errors",
  "content_recommendations",
  "cards_list",
]);
assert.deepEqual(cap03.wbOperations, slice.acceptedMappingAfter["CAP-03"]);
assert.deepEqual(cap03.wbOperations, ["cards_errors", "cards_list"]);
assert.equal(cap03.omissionPolicy, "MISSING_NOT_ZERO");

function summarizeErrorPages(pages) {
  const seenBatches = new Set();
  const vendorCodes = new Set();
  let errorOccurrences = 0;
  for (const page of pages) {
    if (!page || !Array.isArray(page.batches) || !page.cursor)
      return { status: "INCOMPLETE", reason: "ERROR_PAGE_INVALID" };
    for (const batch of page.batches) {
      if (
        !batch ||
        typeof batch.batchUUID !== "string" ||
        !batch.batchUUID ||
        !Array.isArray(batch.vendorCodes) ||
        typeof batch.errors !== "object" ||
        !batch.errors
      )
        return { status: "INCOMPLETE", reason: "ERROR_BATCH_INVALID" };
      if (seenBatches.has(batch.batchUUID))
        return {
          status: "INCOMPLETE",
          reason: "DUPLICATE_ERROR_BATCH_UUID",
        };
      seenBatches.add(batch.batchUUID);
      for (const vendorCode of batch.vendorCodes) {
        if (typeof vendorCode !== "string" || !vendorCode)
          return { status: "INCOMPLETE", reason: "VENDOR_CODE_INVALID" };
        const messages = batch.errors[vendorCode];
        if (!Array.isArray(messages))
          return { status: "INCOMPLETE", reason: "ERROR_MESSAGES_MISSING" };
        if (messages.some((message) => typeof message !== "string" || !message))
          return { status: "INCOMPLETE", reason: "ERROR_MESSAGE_INVALID" };
        if (messages.length) vendorCodes.add(vendorCode);
        errorOccurrences += messages.length;
      }
    }
  }
  const last = pages.at(-1);
  if (!last || last.cursor.next !== false)
    return {
      status: "INCOMPLETE",
      reason: "ERROR_PAGINATION_NOT_TERMINAL",
    };
  return {
    status: "PASS",
    batchCount: seenBatches.size,
    vendorCodesWithErrors: vendorCodes.size,
    officialErrorOccurrences: errorOccurrences,
  };
}

const c = slice.syntheticCases;
assert.deepEqual(
  summarizeErrorPages(c.completeBatches.pages),
  c.completeBatches.expected,
);
assert.deepEqual(
  summarizeErrorPages(c.duplicateBatch.pages),
  c.duplicateBatch.expected,
);
assert.deepEqual(
  summarizeErrorPages(c.incompletePagination.pages),
  c.incompletePagination.expected,
);

function joinVendorCodeToNmId(vendorCode, activeCards) {
  const matched = activeCards.filter((card) => card.vendorCode === vendorCode);
  if (matched.length !== 1)
    return {
      status: "INCOMPLETE",
      reason: "VENDOR_CODE_TO_NM_ID_NOT_UNIQUE",
    };
  if (!Number.isInteger(matched[0].nmID))
    return { status: "INCOMPLETE", reason: "NM_ID_INVALID" };
  return { status: "PASS", nmID: matched[0].nmID };
}
assert.deepEqual(
  joinVendorCodeToNmId(
    c.ambiguousVendorJoin.vendorCode,
    c.ambiguousVendorJoin.activeCards,
  ),
  c.ambiguousVendorJoin.expected,
);

function projectRecommendations(row) {
  if (
    !row ||
    !Number.isInteger(row.nmId) ||
    !Number.isInteger(row.recomCount) ||
    row.recomCount < 0 ||
    !Array.isArray(row.recomNms) ||
    !Array.isArray(row.recomPics) ||
    row.recomCount !== row.recomNms.length
  )
    return { status: "INCOMPLETE", reason: "RECOMMENDATION_ROW_INVALID" };
  return {
    recommendedProductCount: row.recomCount,
    expertQualityKnown: false,
    expertQuality: null,
    contentIssueCountFromRecommendations: 0,
  };
}
assert.deepEqual(
  projectRecommendations(c.recommendationsNotQuality.row),
  c.recommendationsNotQuality.expected,
);

assert.equal(
  slice.rules.officialErrors,
  "COUNT_PROVIDER_ERROR_MESSAGE_OCCURRENCES_ONLY_AFTER_COMPLETE_BATCH_PAGINATION",
);
assert.equal(
  slice.rules.vendorCode,
  "ERRORS_ATTACH_TO_SELLER_ARTICLE_DO_NOT_INVENT_NM_ID_JOIN",
);
assert.equal(
  slice.rules.expertQuality,
  "SEPARATE_FROM_PROVIDER_ERROR_COUNT_AND_PRODUCT_RECOMMENDATION_LIST",
);
assert.equal(
  slice.rules.recommendations,
  "PRODUCT_TO_PRODUCT_RECOMMENDATION_LIST_NOT_CONTENT_QUALITY_ADVICE_OR_SCORE",
);
assert.equal(
  slice.rules.recommendationCount,
  "RECOM_COUNT_COUNTS_RECOMMENDED_PRODUCTS_NOT_QUALITY_ISSUES",
);
console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    currentQualityOperations: cap03.wbOperations,
    excludedValidReadOperation: recommendations.operationAlias,
    officialErrorPagination: errors.pagination.terminal,
    recommendationFieldSchemaResolved: true,
    recommendationIsQualitySignal: false,
    acceptedOperationMappingChanged: true,
    liveValues: false,
  }),
);
