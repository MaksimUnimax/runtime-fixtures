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
    "tests/regression/extension-core/fixtures/wb-visibility-mapping-refresh-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const advertised = JSON.parse(
  read(slice.sources.campaignMembership.reuseFixture),
);
const contentQuality = JSON.parse(
  read(slice.sources.contentErrors.reuseFixture),
);
const catalog = JSON.parse(read(slice.sources.catalogIdentity.reuseFixture));

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

function assertCurrentOperation(alias, expected = {}) {
  const meta = wb.OPERATIONS[alias];
  assert.ok(meta, "missing WB operation " + alias);
  if (expected.host)
    assert.equal(meta.host, expected.host, alias + ": host drift");
  if (expected.method)
    assert.equal(meta.method, expected.method, alias + ": method drift");
  if (expected.path)
    assert.equal(meta.path, expected.path, alias + ": path drift");
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

function advertisedMembership(campaigns) {
  const active = new Map();
  const seenCampaigns = new Set();
  for (const row of campaigns) {
    if (
      !row ||
      !Number.isInteger(row.id) ||
      !Number.isInteger(row.status) ||
      seenCampaigns.has(row.id) ||
      !Array.isArray(row.nm_settings)
    )
      return { status: "INCOMPLETE", reason: "CAMPAIGN_ROW_INVALID" };
    seenCampaigns.add(row.id);
    if (row.status !== slice.sources.campaignMembership.activeStatus) continue;
    for (const item of row.nm_settings) {
      if (!item || !Number.isInteger(item.nm_id))
        return { status: "INCOMPLETE", reason: "CAMPAIGN_PRODUCT_ID_INVALID" };
      const ids = active.get(item.nm_id) ?? [];
      ids.push(row.id);
      active.set(item.nm_id, ids);
    }
  }
  return { status: "PASS", active };
}

function catalogIdentity(cards) {
  const byNm = new Map();
  const byVendor = new Map();
  for (const card of cards) {
    if (
      !card ||
      !Number.isInteger(card.nmID) ||
      typeof card.vendorCode !== "string" ||
      !card.vendorCode ||
      byNm.has(card.nmID)
    )
      return { status: "INCOMPLETE", reason: "CATALOG_IDENTITY_INVALID" };
    byNm.set(card.nmID, card);
    const ids = byVendor.get(card.vendorCode) ?? [];
    ids.push(card.nmID);
    byVendor.set(card.vendorCode, ids);
  }
  return { status: "PASS", byNm, byVendor };
}

function projectStd19(input) {
  const membership = advertisedMembership(input.campaigns);
  if (membership.status !== "PASS") return membership;
  const identities = catalogIdentity(input.cards);
  if (identities.status !== "PASS") return identities;

  const contentProducts = new Set();
  for (const vendorCode of input.contentErrorVendorCodes) {
    if (typeof vendorCode !== "string" || !vendorCode)
      return { status: "INCOMPLETE", reason: "CONTENT_VENDOR_CODE_INVALID" };
    const ids = identities.byVendor.get(vendorCode) ?? [];
    if (ids.length !== 1)
      return {
        status: "INCOMPLETE",
        reason: "VENDOR_CODE_TO_NM_ID_NOT_UNIQUE",
      };
    contentProducts.add(ids[0]);
  }

  const blocked = new Map();
  for (const row of input.blockedRows) {
    if (!row || !Number.isInteger(row.nmId))
      return { status: "INCOMPLETE", reason: "BLOCKED_PRODUCT_ID_MISSING" };
    if (blocked.has(row.nmId))
      return { status: "INCOMPLETE", reason: "DUPLICATE_BLOCKED_NM_ID" };
    blocked.set(row.nmId, row.reason ?? null);
  }

  const rows = [];
  for (const [nmId, campaignIds] of [...membership.active.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const contentIssue = contentProducts.has(nmId);
    const blockedSignal = blocked.has(nmId);
    if (!contentIssue && !blockedSignal) continue;
    rows.push({
      nmId,
      campaignIds: [...campaignIds].sort((a, b) => a - b),
      contentIssue,
      blocked: blockedSignal,
      buyerVisibilityKnown: false,
    });
  }
  return { status: "PASS", rows };
}

assert.equal(slice.schemaVersion, "wb_visibility_mapping_refresh_v1");
assert.deepEqual(slice.scope.scenarioIds, [
  "STD-14",
  "STD-15",
  "STD-19",
  "CAP-02",
]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, true);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(slice.authority.shadowedEndpointRemovedDate, "2026-08-15");
assert.equal(
  slice.authority.blockedRowBlobSha,
  "5494cb177f096d5e4c8860d7a84a78a8ba9b0daf",
);

const stale = wb.OPERATIONS[slice.sources.deletedShadowed.operationAlias];
assert.ok(stale, "frozen registry no longer exposes stale alias evidence");
assert.equal(stale.path, slice.sources.deletedShadowed.frozenRegistryPath);
assert.equal(stale.current, true, "this test documents frozen-registry drift");
assert.equal(slice.sources.deletedShadowed.currentMirrorOpenApiPresent, false);
assert.equal(slice.sources.deletedShadowed.replacementInvented, false);

assertCurrentOperation("banned_products_blocked", {
  host: slice.sources.blocked.host,
  method: slice.sources.blocked.method,
  path: slice.sources.blocked.path,
});
assertCurrentOperation("promo_campaigns");
assertCurrentOperation("promo_nms");
assertCurrentOperation("cards_errors");
assertCurrentOperation("cards_list");
assertCurrentOperation("stock_products");
assertCurrentOperation("seller_warehouses");
assertCurrentOperation("marketplace_offices");

assert.equal(advertised.sources.eligibleCards.advertisedSignal, false);
assert.equal(advertised.sources.campaigns.activeStatus, 9);
assert.equal(
  contentQuality.sources.cardsErrors.batchFields.vendorCodes.role,
  "seller_articles_in_batch",
);
assert.equal(
  contentQuality.sources.cardsErrors.batchFields.errors.role,
  "provider_errors_by_vendor_code",
);
assert.equal(catalog.source.fields.nmID.role, "product_card_id");
assert.equal(catalog.source.fields.vendorCode.role, "seller_article");

for (const id of slice.scope.scenarioIds) {
  const row = scenarios.get(id);
  assert.ok(row, id + " missing");
  assert.deepEqual(
    row.wbOperations,
    slice.acceptedMappingAfter[id],
    id + ": mapping correction missing",
  );
  assert.ok(
    !row.wbOperations.includes("banned_products_shadowed"),
    id + ": deleted shadowed alias retained",
  );
}
assert.ok(!scenarios.get("STD-19").wbOperations.includes("promo_nms"));
assert.ok(scenarios.get("STD-19").wbOperations.includes("promo_campaigns"));
assert.ok(scenarios.get("STD-19").wbOperations.includes("cards_list"));
assert.equal(scenarios.get("STD-14").wbCoverage, "BOUNDARY");
assert.equal(scenarios.get("STD-15").wbCoverage, "BOUNDARY");
assert.equal(scenarios.get("CAP-02").wbCoverage, "BOUNDARY");

const c = slice.syntheticCases;
assert.deepEqual(projectStd19(c.std19), c.std19.expected);
assert.deepEqual(
  projectStd19(c.ambiguousContentJoin),
  c.ambiguousContentJoin.expected,
);
assert.deepEqual(c.eligibilityOnly.expected, {
  advertisedSignal: false,
  reason: "ELIGIBLE_TO_ADD_IS_NOT_CAMPAIGN_MEMBERSHIP",
});

assert.equal(
  slice.rules.buyerVisibility,
  "BLOCKED_CONTENT_STOCK_AND_CAMPAIGN_SIGNALS_DO_NOT_PROVE_BUYER_SPECIFIC_DELIVERY_OR_VISIBILITY",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    scenarios: slice.scope.scenarioIds,
    removedCurrentMappingAlias: "banned_products_shadowed",
    shadowedRemovedUpstream: "2026-08-15",
    std19AdvertisingSource: "promo_campaigns",
    std19ContentIdentityBridge: "cards_list",
    buyerSpecificVisibilityProven: false,
    acceptedOperationMappingChanged: true,
    liveValues: false,
  }),
);
