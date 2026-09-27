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
    "tests/regression/extension-core/fixtures/wb-price-field-schema-slice-v1.json",
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

function assertOperation(source, expectedBodyRequired = null) {
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
  if (expectedBodyRequired !== null)
    assert.equal(
      meta.body_required,
      expectedBodyRequired,
      source.operationAlias + ": body requirement drift",
    );
  return meta;
}

assert.equal(slice.schemaVersion, "wb_price_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-10"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
const all = slice.sources.allProducts;
const byNm = slice.sources.byArticles;
const sizes = slice.sources.sizePrices;
for (const source of [all, byNm, sizes])
  assert.match(source.url, /^https:\/\/dev\.wildberries\.ru\//);

const allMeta = assertOperation(all, false);
const byNmMeta = assertOperation(byNm, true);
const sizeMeta = assertOperation(sizes, false);
assert.deepEqual([...allMeta.required_query_keys], ["limit"]);
assert.deepEqual(all.request.requiredQuery, ["limit"]);
assert.deepEqual(all.request.optionalQuery, ["offset", "filterNmID"]);
assert.equal(all.request.limitMax, 1000);
assert.equal(
  all.fullCatalogPagination.nextOffset,
  "PREVIOUS_OFFSET_PLUS_LIMIT",
);
assert.equal(all.fullCatalogPagination.terminal, "EMPTY_LIST_GOODS");

assert.deepEqual(byNm.request, {
  bodyRequired: true,
  bodyField: "nmList",
  minArticles: 1,
  maxArticles: 1000,
});
assert.deepEqual([...sizeMeta.required_query_keys], ["limit", "nmID"]);
assert.deepEqual(sizes.request.requiredQuery, ["limit", "nmID"]);
assert.equal(sizes.request.limitMax, 1000);
assert.equal(sizes.availability, "ONLY_WHEN_PRODUCT_EDITABLE_SIZE_PRICE_TRUE");
assert.deepEqual(sizes.rowGrain, ["nmID", "sizeID"]);

for (const field of ["price", "discountedPrice", "clubDiscountedPrice"]) {
  assert.equal(all.sizeFields[field].unit, "response_currency_number");
  assert.equal(sizes.fields[field].unit, "response_currency_number");
}
assert.notEqual(all.sizeFields.price.role, all.sizeFields.discountedPrice.role);
assert.notEqual(
  all.sizeFields.discountedPrice.role,
  all.sizeFields.clubDiscountedPrice.role,
);
assert.equal(all.fields.currencyIsoCode4217.role, "price_currency");
assert.equal(all.fields.discount.role, "general_product_discount");
assert.equal(all.fields.clubDiscount.role, "wb_club_discount");

const cap10 = scenarios.get("CAP-10");
assert.ok(cap10, "CAP-10 scenario missing");
assert.equal(cap10.omissionPolicy, "MISSING_NOT_ZERO");
assert.deepEqual(cap10.wbOperations, slice.acceptedMappingSnapshot["CAP-10"]);
function projectProduct(product) {
  if (
    !product ||
    !Number.isInteger(product.nmID) ||
    typeof product.currencyIsoCode4217 !== "string" ||
    !product.currencyIsoCode4217
  )
    return { status: "INCOMPLETE", reason: "CURRENCY_MISSING" };
  if (
    typeof product.discount !== "number" ||
    typeof product.clubDiscount !== "number" ||
    typeof product.editableSizePrice !== "boolean" ||
    !Array.isArray(product.sizes)
  )
    return { status: "INCOMPLETE", reason: "PRODUCT_PRICE_METADATA_INVALID" };

  const projectedSizes = [];
  for (const row of product.sizes) {
    if (
      !Number.isInteger(row.sizeID) ||
      typeof row.price !== "number" ||
      !Number.isFinite(row.price) ||
      typeof row.discountedPrice !== "number" ||
      !Number.isFinite(row.discountedPrice) ||
      typeof row.clubDiscountedPrice !== "number" ||
      !Number.isFinite(row.clubDiscountedPrice)
    )
      return { status: "INCOMPLETE", reason: "PRICE_FIELD_INVALID" };
    projectedSizes.push({
      sizeId: row.sizeID,
      basePrice: row.price,
      generalDiscountedPrice: row.discountedPrice,
      clubDiscountedPrice: row.clubDiscountedPrice,
    });
  }
  return {
    productId: product.nmID,
    currency: product.currencyIsoCode4217,
    generalDiscount: product.discount,
    clubDiscount: product.clubDiscount,
    sizePriceMode: product.editableSizePrice,
    sizes: projectedSizes,
  };
}

assert.deepEqual(
  projectProduct(slice.syntheticCases.product),
  slice.syntheticCases.expectedProjection,
);
assert.deepEqual(
  projectProduct(slice.syntheticCases.missingCurrency.product),
  slice.syntheticCases.missingCurrency.expected,
);
assert.deepEqual(
  projectProduct(slice.syntheticCases.invalidPrice.product),
  slice.syntheticCases.invalidPrice.expected,
);
function selectProviderPrice(product, context) {
  const first = product.sizes?.[0];
  if (!first) return null;
  const fieldByContext = {
    GENERAL: "discountedPrice",
    WB_CLUB: "clubDiscountedPrice",
    BASE_REFERENCE: "price",
  };
  const field = fieldByContext[context];
  if (!field) return null;
  return { field, value: first[field] };
}

for (const row of slice.syntheticCases.contextSelection)
  assert.deepEqual(
    selectProviderPrice(slice.syntheticCases.product, row.context),
    { field: row.expectedField, value: row.expectedValue },
  );

function collectCompleteCatalog(pages) {
  const ids = [];
  let expectedOffset = 0;
  for (const page of pages) {
    if (page.offset !== expectedOffset)
      return { status: "INCOMPLETE", reason: "OFFSET_GAP" };
    if (!Array.isArray(page.ids))
      return { status: "INCOMPLETE", reason: "PAGE_INVALID" };
    if (page.ids.length === 0) return { status: "PASS", ids };
    ids.push(...page.ids);
    expectedOffset += page.limit;
  }
  return { status: "INCOMPLETE", reason: "TERMINAL_EMPTY_PAGE_MISSING" };
}
assert.deepEqual(collectCompleteCatalog(slice.syntheticCases.catalogPages), {
  status: "PASS",
  ids: slice.syntheticCases.expectedCatalogIds,
});

assert.equal(
  slice.rules.basePrice,
  "PRICE_IS_BASE_PROVIDER_PRICE_NOT_UNIVERSAL_BUYER_CHECKOUT_PRICE",
);
assert.equal(
  slice.rules.buyerPrice,
  "SELECT_CONTEXT_SPECIFIC_PROVIDER_FIELD_DO_NOT_COLLAPSE_TO_ONE_UNIVERSAL_PRICE",
);
assert.equal(
  slice.rules.currency,
  "REQUIRE_PROVIDER_CURRENCY_DO_NOT_ASSUME_RUB",
);
assert.equal(
  slice.rules.sizePrice,
  "USE_SIZE_LEVEL_PRICE_ONLY_WHEN_EDITABLE_SIZE_PRICE_TRUE",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [all.operationAlias, byNm.operationAlias, sizes.operationAlias],
    priceFieldsDistinct: true,
    currencyRequired: true,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
