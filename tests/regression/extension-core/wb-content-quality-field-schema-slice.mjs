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
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

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
  "UNRESOLVED_IN_CURRENT_DOCUMENTATION_SEARCH",
);
assert.equal(recommendations.fieldDerivedMetricsAllowed, false);
assert.equal(recMeta.source_path, recommendations.path);
const cap03 = scenarios.get("CAP-03");
assert.ok(cap03, "CAP-03 missing");
assert.deepEqual(cap03.wbOperations, slice.acceptedMappingSnapshot["CAP-03"]);
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
  "SEPARATE_FROM_PROVIDER_ERROR_COUNT_AND_UNVERIFIED_RECOMMENDATION_FIELDS",
);
assert.equal(
  slice.rules.recommendations,
  "NO_FIELD_SEMANTICS_WITHOUT_CURRENT_OFFICIAL_SOURCE",
);
console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      errors.operationAlias,
      recommendations.operationAlias,
      cards.operationAlias,
    ],
    officialErrorPagination: errors.pagination.terminal,
    recommendationFieldSchemaResolved: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
