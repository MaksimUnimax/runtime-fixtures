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
    "tests/regression/extension-core/fixtures/wb-promotion-calendar-field-schema-slice-v1.json",
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
assert.equal(
  slice.schemaVersion,
  "wb_promotion_calendar_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-11"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const promotions = slice.operations.promotions;
const details = slice.operations.details;
const nomenclatures = slice.operations.nomenclatures;
for (const source of [promotions, details, nomenclatures])
  assertOperation(source);

assert.deepEqual(promotions.requiredQuery, [
  "startDateTime",
  "endDateTime",
  "allPromo",
]);
assert.equal(promotions.pagination.limitMax, 1000);
assert.equal(details.promotionIds.minItems, 1);
assert.equal(details.promotionIds.maxItems, 100);
assert.equal(details.promotionIds.unique, true);
assert.deepEqual(nomenclatures.requiredQuery, ["promotionID", "inAction"]);
assert.equal(nomenclatures.pagination.limitMax, 1000);
assert.equal(nomenclatures.notApplicablePromotionType, "auto");
assert.equal(
  nomenclatures.fields.inAction.role,
  "product_participates_in_promotion",
);
assert.equal(nomenclatures.fields.price.role, "provider_price");
assert.equal(nomenclatures.fields.planPrice.role, "provider_planned_price");
assert.equal(nomenclatures.fields.currencyCode.role, "price_currency");
assert.notEqual(
  nomenclatures.fields.price.role,
  nomenclatures.fields.planPrice.role,
);
assert.notEqual(
  nomenclatures.fields.discount.role,
  nomenclatures.fields.planDiscount.role,
);

const cap11 = scenarios.get("CAP-11");
assert.ok(cap11, "CAP-11 missing");
assert.deepEqual(cap11.wbOperations, slice.acceptedMappingSnapshot["CAP-11"]);
assert.equal(cap11.omissionPolicy, "MISSING_NOT_ZERO");
function summarize(input) {
  const promotion = input.promotion;
  const detailsRow = input.details;
  if (
    !promotion ||
    !Number.isInteger(promotion.id) ||
    typeof promotion.type !== "string" ||
    !detailsRow ||
    detailsRow.id !== promotion.id
  )
    return { status: "INCOMPLETE", reason: "PROMOTION_IDENTITY_MISMATCH" };
  if (promotion.type === nomenclatures.notApplicablePromotionType)
    return {
      status: "INCOMPLETE",
      reason: "NOMENCLATURES_NOT_APPLICABLE_TO_AUTO_PROMOTION",
    };
  if (input.nomenclaturePagesComplete !== true)
    return {
      status: "INCOMPLETE",
      reason: "NOMENCLATURE_PAGINATION_INCOMPLETE",
    };
  if (!Array.isArray(input.nomenclatures))
    return { status: "INCOMPLETE", reason: "NOMENCLATURES_MISSING" };

  const products = [];
  const seen = new Set();
  for (const row of input.nomenclatures) {
    if (!row || !Number.isInteger(row.id) || seen.has(row.id))
      return { status: "INCOMPLETE", reason: "PROMOTION_PRODUCT_ID_INVALID" };
    seen.add(row.id);
    if (typeof row.inAction !== "boolean")
      return {
        status: "INCOMPLETE",
        reason: "PROMOTION_PARTICIPATION_MISSING",
      };
    if (
      !Number.isFinite(row.price) ||
      !Number.isFinite(row.planPrice) ||
      !Number.isFinite(row.discount) ||
      !Number.isFinite(row.planDiscount)
    )
      return { status: "INCOMPLETE", reason: "PROMOTION_PRICE_FIELDS_INVALID" };
    if (typeof row.currencyCode !== "string" || !row.currencyCode)
      return {
        status: "INCOMPLETE",
        reason: "PROMOTION_PRICE_CURRENCY_MISSING",
      };
    products.push({
      productId: row.id,
      participates: row.inAction,
      price: row.price,
      planPrice: row.planPrice,
      currency: row.currencyCode,
      discount: row.discount,
      planDiscount: row.planDiscount,
    });
  }
  products.sort((a, b) => a.productId - b.productId);
  return {
    status: "PASS",
    promotionId: promotion.id,
    promotionType: promotion.type,
    products,
  };
}
const c = slice.syntheticCases;
assert.deepEqual(summarize(c.regularPromotion), c.regularPromotion.expected);
assert.deepEqual(summarize(c.autoPromotion), c.autoPromotion.expected);
assert.deepEqual(
  summarize(c.incompletePagination),
  c.incompletePagination.expected,
);
assert.deepEqual(summarize(c.missingCurrency), c.missingCurrency.expected);

assert.equal(
  slice.rules.availability,
  "PROMOTION_LIST_AVAILABILITY_IS_NOT_PRODUCT_PARTICIPATION",
);
assert.equal(
  slice.rules.participation,
  "USE_NOMENCLATURE_IN_ACTION_BOOLEAN_FOR_PRODUCT_PARTICIPATION",
);
assert.equal(
  slice.rules.auto,
  "NOMENCLATURES_NOT_APPLICABLE_TO_AUTO_PROMOTIONS_FAILS_CLOSED",
);
assert.equal(
  slice.rules.price,
  "PRESERVE_PRICE_AND_PLAN_PRICE_AS_DISTINCT_PROVIDER_FIELDS",
);
assert.equal(
  slice.rules.currency,
  "REQUIRE_RESPONSE_CURRENCY_DO_NOT_ASSUME_RUB",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-11",
    operations: [
      promotions.operationAlias,
      details.operationAlias,
      nomenclatures.operationAlias,
    ],
    autoPromotionNomenclatureSupported: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
