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
    "tests/regression/extension-core/fixtures/wb-advertising-stats-grain-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const advertising = JSON.parse(read(slice.sources.promotion.reuseFixture));

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
  "wb_advertising_stats_grain_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-18"]);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.blobSha,
  "30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9",
);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const promotion = slice.sources.promotion;
const media = slice.sources.media;
const promotionMeta = assertOperation(promotion);
const mediaMeta = assertOperation(media);

assert.deepEqual(
  Array.from(promotionMeta.required_query_keys),
  promotion.requiredQuery,
);
assert.equal(promotionMeta.body_required, false);
assert.equal(mediaMeta.body_required, true);
assert.deepEqual(Array.from(mediaMeta.required_query_keys), []);

assert.equal(promotion.maxPeriodDays, 31);
assert.equal(promotion.maxCampaignIds, 50);
assert.deepEqual(promotion.eligibleStatuses, [7, 9, 11]);
assert.deepEqual(promotion.responseGrain, ["campaign", "day", "product"]);
assert.equal(promotion.fields.currency.unit, "currency_code_iso_4217");
assert.equal(promotion.currencyFieldCurrentOpenapi, "currency");

assert.equal(media.body.minItems, 1);
assert.equal(media.body.maxItems, 100);
assert.deepEqual(media.responseVariants, [
  "Stat",
  "StatDate",
  "StatInterval",
  "StatCampaignNotFound",
]);
assert.equal(media.successfulResponseCampaignIdField, null);
assert.equal(media.campaignNotFoundIdField, "advert_id");
assert.equal(media.fields["stats.item_id"].unit, "identifier_not_product_id");
assert.equal(media.currencyField, null);
assert.equal(media.responseCampaignJoinGuaranteeDocumented, false);

assert.equal(
  advertising.sources.campaignStats.operationAlias,
  promotion.operationAlias,
);
assert.equal(
  advertising.sources.campaignStats.currencyField,
  promotion.currencyFieldCurrentOpenapi,
  "active advertising fixture must reconcile to the newer pinned promo_fullstats currency field",
);
const cap18 = scenarios.get("CAP-18");
assert.ok(cap18, "CAP-18 missing");
assert.deepEqual(cap18.wbOperations, slice.acceptedMappingSnapshot["CAP-18"]);
assert.equal(cap18.omissionPolicy, "MISSING_NOT_ZERO");

function projectPromotion(row) {
  if (
    !row ||
    !Number.isInteger(row.advertId) ||
    !Number.isFinite(row.views) ||
    !Number.isFinite(row.clicks) ||
    !Number.isFinite(row.sum) ||
    typeof row.currency !== "string" ||
    !row.currency ||
    !Array.isArray(row.days)
  )
    return { status: "INCOMPLETE", reason: "PROMOTION_STATS_INVALID" };

  const productIds = [];
  for (const day of row.days) {
    if (!day || typeof day.date !== "string" || !Array.isArray(day.nms))
      return { status: "INCOMPLETE", reason: "PROMOTION_DAY_GRAIN_INVALID" };
    for (const nm of day.nms) {
      if (!nm || !Number.isInteger(nm.nmId))
        return { status: "INCOMPLETE", reason: "PROMOTION_PRODUCT_ID_INVALID" };
      productIds.push(nm.nmId);
    }
  }

  return {
    status: "PASS",
    family: "PROMOTION",
    campaignId: row.advertId,
    currency: row.currency,
    spend: row.sum,
    views: row.views,
    clicks: row.clicks,
    productIds: [...new Set(productIds)].sort((a, b) => a - b),
  };
}

function validateMediaRequest(request) {
  if (!Array.isArray(request) || request.length < media.body.minItems)
    return { status: "INCOMPLETE", reason: "MEDIA_STATS_REQUEST_MISSING" };
  if (request.length > media.body.maxItems)
    return {
      status: "INCOMPLETE",
      reason: "MEDIA_STATS_REQUEST_LIMIT_EXCEEDED",
    };
  for (const item of request) {
    if (!item || !Number.isInteger(item.id))
      return { status: "INCOMPLETE", reason: "MEDIA_CAMPAIGN_ID_INVALID" };
    const hasDates = Object.hasOwn(item, "dates");
    const hasInterval = Object.hasOwn(item, "interval");
    if (hasDates && hasInterval)
      return { status: "INCOMPLETE", reason: "MEDIA_STATS_REQUEST_AMBIGUOUS" };
    if (hasDates && !Array.isArray(item.dates))
      return { status: "INCOMPLETE", reason: "MEDIA_DATES_INVALID" };
    if (
      hasInterval &&
      (!item.interval ||
        typeof item.interval.begin !== "string" ||
        typeof item.interval.end !== "string")
    )
      return { status: "INCOMPLETE", reason: "MEDIA_INTERVAL_INVALID" };
  }
  return { status: "PASS" };
}
function projectMedia(request, response) {
  const requestCheck = validateMediaRequest(request);
  if (requestCheck.status !== "PASS") return requestCheck;
  if (!Array.isArray(response) || response.length === 0)
    return { status: "INCOMPLETE", reason: "MEDIA_STATS_RESPONSE_MISSING" };

  const first = response[0];
  if (
    first &&
    Number.isInteger(first.advert_id) &&
    typeof first.error === "string"
  )
    return {
      status: "INCOMPLETE",
      reason: "MEDIA_CAMPAIGN_NOT_FOUND",
      campaignId: first.advert_id,
    };

  const stats = first?.stats;
  if (!Array.isArray(stats) || stats.length === 0)
    return { status: "INCOMPLETE", reason: "MEDIA_STATS_BLOCK_MISSING" };

  const row = stats[0];
  if (
    !row ||
    !Number.isInteger(row.item_id) ||
    !Number.isFinite(row.views) ||
    !Number.isFinite(row.clicks) ||
    !Number.isFinite(row.expenses)
  )
    return { status: "INCOMPLETE", reason: "MEDIA_STATS_ROW_INVALID" };

  return {
    status: "INCOMPLETE",
    reason: "MEDIA_CAMPAIGN_IDENTITY_NOT_PROVEN",
    bannerId: row.item_id,
    productId: null,
    currency: null,
  };
}

const c = slice.syntheticCases;
assert.deepEqual(projectPromotion(c.promotion.row), c.promotion.expected);
assert.deepEqual(
  projectMedia(c.media.request, c.media.response),
  c.media.expected,
);
assert.deepEqual(
  projectMedia(c.mediaNotFound.request, c.mediaNotFound.response),
  c.mediaNotFound.expected,
);
assert.deepEqual(
  validateMediaRequest(
    Array.from({ length: c.mediaTooManyRequests.count }, (_, i) => ({
      id: i + 1,
    })),
  ),
  c.mediaTooManyRequests.expected,
);

assert.equal(slice.rules.product, "MEDIA_ITEM_ID_IS_BANNER_ID_NOT_NMID");
assert.equal(
  slice.rules.campaignJoin,
  "DO_NOT_JOIN_SUCCESSFUL_MEDIA_RESPONSE_TO_CAMPAIGN_BY_ARRAY_POSITION_WITHOUT_PROVIDER_GUARANTEE",
);
assert.equal(
  slice.rules.currency,
  "MEDIA_EXPENSES_REQUIRE_EXPLICIT_ACCOUNT_CURRENCY_CODE_BEFORE_PROVIDER_CURRENCY_LABEL",
);
assert.equal(
  slice.rules.grain,
  "DO_NOT_MERGE_PROMOTION_PRODUCT_GRAIN_WITH_MEDIA_BANNER_GRAIN",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-18",
    operations: [promotion.operationAlias, media.operationAlias],
    promotionCurrencyExplicit: true,
    mediaCampaignJoinResolved: false,
    mediaCurrencyResolved: false,
    mediaItemIsProductId: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
