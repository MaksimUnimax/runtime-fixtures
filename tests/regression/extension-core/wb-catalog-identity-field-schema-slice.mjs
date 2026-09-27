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
    "tests/regression/extension-core/fixtures/wb-catalog-identity-field-schema-slice-v1.json",
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

assert.equal(slice.schemaVersion, "wb_catalog_identity_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-01"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const source = slice.source;
const meta = wb.OPERATIONS[source.operationAlias];
assert.ok(meta, "cards_list operation missing");
assert.equal(meta.host, source.host);
assert.equal(meta.method, source.method);
assert.equal(meta.path, source.path);
assert.equal(meta.body_required, true);
assert.equal(meta.effect, "READ");
assert.equal(meta.execution_enabled, true);
assert.equal(meta.current, true);
assert.equal(source.trashIncluded, false);
assert.deepEqual(source.rowGrain, ["nmID"]);
assert.deepEqual(source.pagination.cursorFields, ["updatedAt", "nmID"]);
assert.equal(
  source.pagination.terminal,
  "RESPONSE_CURSOR_TOTAL_LESS_THAN_REQUEST_LIMIT",
);
assert.equal(source.fields.nmID.role, "product_card_id");
assert.equal(source.sizeFields.chrtID.role, "size_characteristic_id");
assert.equal(source.sizeFields.skus.role, "size_sku_barcodes");

const cap01 = scenarios.get("CAP-01");
assert.ok(cap01, "CAP-01 missing");
assert.deepEqual(cap01.wbOperations, slice.acceptedMappingSnapshot["CAP-01"]);
assert.equal(cap01.omissionPolicy, "MISSING_NOT_ZERO");
function analyzeCards(cards) {
  const productIds = new Set();
  let sizeRows = 0;
  let skuRows = 0;
  for (const card of cards) {
    if (!Number.isInteger(card.nmID))
      return { status: "INCOMPLETE", reason: "NM_ID_MISSING" };
    if (productIds.has(card.nmID))
      return { status: "INCOMPLETE", reason: "DUPLICATE_NM_ID" };
    productIds.add(card.nmID);
    if (!Array.isArray(card.sizes))
      return { status: "INCOMPLETE", reason: "SIZES_MISSING" };
    const sizeIds = new Set();
    for (const size of card.sizes) {
      if (!Number.isInteger(size.chrtID))
        return { status: "INCOMPLETE", reason: "CHRT_ID_MISSING" };
      if (sizeIds.has(size.chrtID))
        return {
          status: "INCOMPLETE",
          reason: "DUPLICATE_CHRT_ID_WITHIN_PRODUCT",
        };
      sizeIds.add(size.chrtID);
      if (!Array.isArray(size.skus) || size.skus.length === 0)
        return { status: "INCOMPLETE", reason: "SIZE_SKU_MISSING" };
      if (size.skus.some((sku) => typeof sku !== "string" || sku.length === 0))
        return { status: "INCOMPLETE", reason: "SIZE_SKU_INVALID" };
      sizeRows += 1;
      skuRows += size.skus.length;
    }
  }
  return {
    status: "PASS",
    catalogRows: productIds.size,
    sizeRows,
    skuRows,
    productIds: [...productIds],
  };
}

function analyzePages(pages) {
  const cards = [];
  let previousCursor = null;
  let terminal = false;
  for (const page of pages) {
    if (!page.request || !Number.isInteger(page.request.limit))
      return { status: "INCOMPLETE", reason: "PAGE_REQUEST_INVALID" };
    if (
      previousCursor &&
      JSON.stringify(page.request.cursor) !== JSON.stringify(previousCursor)
    )
      return { status: "INCOMPLETE", reason: "CURSOR_CONTINUATION_BROKEN" };
    cards.push(...page.cards);
    terminal = page.cursor.total < page.request.limit;
    previousCursor = {
      updatedAt: page.cursor.updatedAt,
      nmID: page.cursor.nmID,
    };
    if (terminal) break;
  }
  if (!terminal)
    return { status: "INCOMPLETE", reason: "TERMINAL_PAGE_MISSING" };
  const identities = analyzeCards(cards);
  if (identities.status !== "PASS") return identities;
  return { ...identities, terminal };
}
const expected = slice.syntheticCases.expected;
const actual = analyzePages(slice.syntheticCases.pages);
assert.deepEqual(actual, { status: "PASS", ...expected });

for (const name of ["duplicateProduct", "duplicateSize", "missingSku"]) {
  const c = slice.syntheticCases[name];
  assert.deepEqual(analyzeCards(c.cards), c.expected);
}

assert.equal(slice.rules.catalogRow, "ONE_PRODUCT_CARD_PER_NM_ID");
assert.equal(slice.rules.sizeRow, "ONE_SIZE_PER_CHRT_ID_WITHIN_PRODUCT_CARD");
assert.equal(
  slice.rules.sku,
  "SKU_BARCODE_BELONGS_TO_SIZE_DO_NOT_REPLACE_NM_ID_OR_CHRT_ID",
);
assert.equal(
  slice.rules.count,
  "CATALOG_ROWS_COUNT_PRODUCT_CARDS_NOT_SIZES_OR_SKUS",
);
assert.equal(
  slice.rules.trash,
  "CARDS_LIST_EXCLUDES_TRASH_DO_NOT_CALL_IT_ALL_CREATED_CARDS_WITHOUT_BOUNDARY",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operation: source.operationAlias,
    identityLevels: ["nmID", "chrtID", "skus"],
    fullExportCursor: source.pagination.cursorFields,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
