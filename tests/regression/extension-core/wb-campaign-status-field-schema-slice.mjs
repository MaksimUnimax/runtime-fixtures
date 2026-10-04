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
    "tests/regression/extension-core/fixtures/wb-campaign-status-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const advertising = JSON.parse(read(slice.sources.promotion.reuseFixture));
const advertisedStock = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-advertised-stock-reuse-v1.json",
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
assert.equal(slice.schemaVersion, "wb_campaign_status_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-17"]);
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
assert.deepEqual([...promotionMeta.query_keys], promotion.queryFields);
assert.deepEqual([...mediaMeta.query_keys], media.queryFields);
assert.deepEqual(Object.keys(promotion.fields), [
  "id",
  "status",
  "settings.payment_type",
  "nm_settings[].nm_id",
  "currency",
]);
assert.ok(!Object.hasOwn(promotion.fields, "advertId"));
assert.ok(!Object.hasOwn(promotion.fields, "paymentType"));
assert.equal(
  promotion.fields.id.role,
  advertisedStock.sources.campaigns.fields.id.role,
);
assert.equal(
  promotion.fields["nm_settings[].nm_id"].role,
  advertisedStock.sources.campaigns.fields["nm_settings.nm_id"].role,
);
assert.equal(
  promotion.fields.currency.role,
  advertisedStock.sources.campaigns.fields.currency.role,
);
assert.deepEqual(Object.keys(advertising.sources.campaigns.fields), [
  "id",
  "status",
  "settings.payment_type",
  "nm_settings[].nm_id",
  "currency",
]);
assert.equal(
  advertising.sources.campaigns.operationAlias,
  promotion.operationAlias,
);
assert.equal(
  advertising.sources.campaigns.fields.status.role,
  "campaign_status",
);
assert.equal(promotion.pagination, "NO_OFFSET_PAGINATION_DOCUMENTED");
assert.equal(media.pagination, "EXPLICIT_OFFSET_LIMIT");
const expectedPromotionIds = [-1, 4, 7, 8, 9, 11];
assert.deepEqual(
  Object.keys(promotion.statuses)
    .map(Number)
    .sort((a, b) => a - b),
  expectedPromotionIds,
);
assert.deepEqual(
  Object.keys(media.statuses).map(Number),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
);
assert.deepEqual(Object.keys(media.types).map(Number), [1, 2]);
assert.equal(promotion.statuses["9"], "ACTIVE");
assert.equal(media.statuses["9"], "PAUSED_BY_SELLER");
assert.notEqual(promotion.statuses["9"], media.statuses["9"]);
const cap17 = scenarios.get("CAP-17");
assert.ok(cap17, "CAP-17 missing");
assert.deepEqual(cap17.wbOperations, slice.acceptedMappingSnapshot["CAP-17"]);
assert.equal(cap17.continuationPolicy, "EXPLICIT_PAGINATION");
assert.equal(cap17.omissionPolicy, "MISSING_NOT_ZERO");

function projectPromotion(row) {
  if (
    !row ||
    !Number.isInteger(row.id) ||
    !Number.isInteger(row.status) ||
    !row.settings ||
    !["cpm", "cpc"].includes(row.settings.payment_type) ||
    !(row.nm_settings === null || Array.isArray(row.nm_settings)) ||
    (Array.isArray(row.nm_settings) &&
      row.nm_settings.some((item) => !item || !Number.isInteger(item.nm_id)))
  )
    return { status: "INCOMPLETE", reason: "PROMOTION_CAMPAIGN_ROW_INVALID" };
  const label = promotion.statuses[String(row.status)];
  if (!label)
    return { status: "INCOMPLETE", reason: "UNKNOWN_PROMOTION_STATUS" };
  return {
    family: "PROMOTION",
    campaignId: row.id,
    statusId: row.status,
    status: label,
  };
}

function projectMedia(row) {
  if (
    !row ||
    !Number.isInteger(row.advertId) ||
    !Number.isInteger(row.type) ||
    !media.types[String(row.type)] ||
    !Number.isInteger(row.status)
  )
    return { status: "INCOMPLETE", reason: "MEDIA_CAMPAIGN_ROW_INVALID" };
  const label = media.statuses[String(row.status)];
  if (!label) return { status: "INCOMPLETE", reason: "UNKNOWN_MEDIA_STATUS" };
  return {
    family: "MEDIA",
    campaignId: row.advertId,
    statusId: row.status,
    status: label,
  };
}

function unified(promotionRows, mediaRows) {
  const rows = [
    ...promotionRows.map(projectPromotion),
    ...mediaRows.map(projectMedia),
  ];
  const invalid = rows.find((row) => row.status === "INCOMPLETE");
  if (invalid) return invalid;
  return rows.sort(
    (a, b) => a.family.localeCompare(b.family) || a.campaignId - b.campaignId,
  );
}
const c = slice.syntheticCases;
assert.deepEqual(unified(c.rows.promotion, c.rows.media), c.rows.expected);
assert.deepEqual(
  projectPromotion(c.unknownPromotionStatus.row),
  c.unknownPromotionStatus.expected,
);
assert.deepEqual(
  projectPromotion({ advertId: 9999, status: 9, paymentType: "cpm" }),
  { status: "INCOMPLETE", reason: "PROMOTION_CAMPAIGN_ROW_INVALID" },
);
assert.deepEqual(
  projectMedia(c.unknownMediaStatus.row),
  c.unknownMediaStatus.expected,
);

const ninePromo = projectPromotion(c.sameNumericNine.promotion);
const nineMedia = projectMedia(c.sameNumericNine.media);
assert.equal(ninePromo.status, c.sameNumericNine.expected.promotion);
assert.equal(nineMedia.status, c.sameNumericNine.expected.media);
assert.notEqual(ninePromo.status, nineMedia.status);

assert.equal(
  slice.rules.status,
  "STATUS_INTEGER_MUST_BE_INTERPRETED_WITHIN_ITS_PROVIDER_FAMILY",
);
assert.equal(
  slice.rules.overlap,
  "SAME_NUMERIC_STATUS_DOES_NOT_IMPLY_SAME_CROSS_FAMILY_MEANING",
);
assert.equal(
  slice.rules.mediaPagination,
  "FULL_MEDIA_LIST_REQUIRES_EXPLICIT_OFFSET_LIMIT_COMPLETION",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-17",
    operations: [promotion.operationAlias, media.operationAlias],
    promotionStatusIds: expectedPromotionIds,
    mediaStatusIds: Object.keys(media.statuses).map(Number),
    statusNineSameMeaning: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
