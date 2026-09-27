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
    "tests/regression/extension-core/fixtures/wb-advertised-stock-reuse-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const campaigns = JSON.parse(read(slice.sources.campaigns.reuseFixture));
const stock = JSON.parse(read(slice.sources.currentStock.reuseFixture));

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
assert.equal(slice.schemaVersion, "wb_advertised_stock_reuse_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-18"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, true);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.blobSha,
  "30ae48c8d1b67944b34cf51ac896ae4c2b2fa0d9",
);

const eligible = slice.sources.eligibleCards;
const campaignSource = slice.sources.campaigns;
const stockSource = slice.sources.currentStock;
assertOperation(eligible);
assertOperation(campaignSource);
assertOperation(stockSource);

assert.equal(eligible.meaning, "CARDS_ELIGIBLE_TO_ADD_TO_A_CAMPAIGN");
assert.equal(eligible.advertisedSignal, false);
assert.equal(eligible.acceptedMappingUse, "EXCLUDED_NOT_A_MEMBERSHIP_SOURCE");
assert.equal(campaigns.sources.promotion.statuses["9"], "ACTIVE");
assert.equal(campaignSource.activeStatus, 9);
assert.equal(
  stock.sources.stockProducts.metrics.stockCount.role,
  "current_stock_units",
);
assert.equal(stock.sources.stockProducts.inventoryMeaning, "CURRENT_DAY");

const std18 = scenarios.get("STD-18");
assert.ok(std18, "STD-18 missing");
assert.deepEqual(slice.acceptedMappingBefore["STD-18"], [
  "promo_nms",
  "promo_campaigns",
  "stock_products",
]);
assert.deepEqual(std18.wbOperations, slice.acceptedMappingAfter["STD-18"]);
assert.deepEqual(std18.wbOperations, ["promo_campaigns", "stock_products"]);
assert.equal(std18.omissionPolicy, "MISSING_NOT_ZERO");
function advertisedMembership(campaignRows) {
  const active = new Map();
  const inactive = new Set();
  const campaignIds = new Set();

  for (const row of campaignRows) {
    if (
      !row ||
      !Number.isInteger(row.id) ||
      !Number.isInteger(row.status) ||
      campaignIds.has(row.id)
    )
      return { status: "INCOMPLETE", reason: "CAMPAIGN_ROW_INVALID" };
    campaignIds.add(row.id);

    if (!Array.isArray(row.nm_settings))
      return { status: "INCOMPLETE", reason: "CAMPAIGN_NM_SETTINGS_MISSING" };

    for (const nm of row.nm_settings) {
      if (!nm || !Number.isInteger(nm.nm_id))
        return { status: "INCOMPLETE", reason: "CAMPAIGN_PRODUCT_ID_INVALID" };
      if (row.status === campaignSource.activeStatus) {
        const ids = active.get(nm.nm_id) ?? [];
        ids.push(row.id);
        active.set(nm.nm_id, ids);
      } else {
        inactive.add(nm.nm_id);
      }
    }
  }

  return { status: "PASS", active, inactive };
}

function currentStock(rows, pagesComplete) {
  if (pagesComplete !== true)
    return {
      status: "INCOMPLETE",
      reason: "CURRENT_STOCK_PAGINATION_INCOMPLETE",
    };

  const byProduct = new Map();
  for (const row of rows) {
    if (
      !row ||
      !Number.isInteger(row.nmID) ||
      !row.metrics ||
      !Number.isInteger(row.metrics.stockCount) ||
      row.metrics.stockCount < 0
    )
      return { status: "INCOMPLETE", reason: "CURRENT_STOCK_ROW_INVALID" };
    if (byProduct.has(row.nmID))
      return {
        status: "INCOMPLETE",
        reason: "CURRENT_STOCK_PRODUCT_DUPLICATE",
      };
    byProduct.set(row.nmID, row.metrics.stockCount);
  }
  return { status: "PASS", byProduct };
}
function project(campaignRows, stockRows, stockPagesComplete) {
  const membership = advertisedMembership(campaignRows);
  if (membership.status !== "PASS") return membership;
  const stockState = currentStock(stockRows, stockPagesComplete);
  if (stockState.status !== "PASS") return stockState;

  const rows = [];
  for (const [nmID, campaignIds] of [...membership.active.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    if (!stockState.byProduct.has(nmID))
      return {
        status: "INCOMPLETE",
        reason: "ADVERTISED_STOCK_ROW_MISSING",
      };
    const stockCount = stockState.byProduct.get(nmID);
    rows.push({
      nmID,
      advertised: true,
      campaignIds: [...campaignIds].sort((a, b) => a - b),
      stockCount,
      outOfStock: stockCount === 0,
      lowStock: null,
    });
  }

  const inactiveOnlyNmIds = [...membership.inactive]
    .filter((nmID) => !membership.active.has(nmID))
    .sort((a, b) => a - b);

  return { status: "PASS", rows, inactiveOnlyNmIds };
}

function eligibleSignal(row) {
  if (
    !row ||
    !Number.isInteger(row.nm) ||
    typeof row.title !== "string" ||
    !Number.isInteger(row.subjectId)
  )
    return { status: "INCOMPLETE", reason: "ELIGIBLE_CARD_INVALID" };
  return {
    productId: row.nm,
    advertisedSignal: false,
    reason: "ELIGIBLE_TO_ADD_IS_NOT_CAMPAIGN_MEMBERSHIP",
  };
}
const c = slice.syntheticCases;
assert.deepEqual(
  project(c.campaigns, c.stockRows, c.stockPagesComplete),
  c.expected,
);
assert.deepEqual(
  project(
    c.missingStock.campaigns,
    c.missingStock.stockRows,
    c.missingStock.stockPagesComplete,
  ),
  c.missingStock.expected,
);
assert.deepEqual(
  project(
    c.incompleteStock.campaigns,
    c.incompleteStock.stockRows,
    c.incompleteStock.stockPagesComplete,
  ),
  c.incompleteStock.expected,
);
assert.deepEqual(
  project(
    c.duplicateStock.campaigns,
    c.duplicateStock.stockRows,
    c.duplicateStock.stockPagesComplete,
  ),
  c.duplicateStock.expected,
);
assert.deepEqual(
  eligibleSignal(c.eligibleNotAdvertised.eligibleCard),
  c.eligibleNotAdvertised.expected,
);

assert.equal(
  slice.rules.eligibility,
  "PROMO_NMS_ELIGIBILITY_DOES_NOT_MEAN_CURRENTLY_ADVERTISED",
);
assert.equal(
  slice.rules.activeMembership,
  "ADVERTISED_TRUE_ONLY_IF_NM_ID_BELONGS_TO_AT_LEAST_ONE_STATUS_9_CAMPAIGN",
);
assert.equal(
  slice.rules.zero,
  "EXPLICIT_STOCK_COUNT_ZERO_MEANS_NO_CURRENT_STOCK_UNITS",
);
assert.equal(
  slice.rules.lowStock,
  "NO_UNIVERSAL_LOW_STOCK_THRESHOLD_IN_PROVIDER_SCHEMA_OWNER_RULE_REQUIRED",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "STD-18",
    acceptedMappingBefore: slice.acceptedMappingBefore["STD-18"],
    acceptedMappingAfter: slice.acceptedMappingAfter["STD-18"],
    promoEligibilityIsMembership: false,
    activeCampaignMembershipSource: campaignSource.operationAlias,
    stockSource: stockSource.operationAlias,
    acceptedOperationMappingChanged: true,
    liveValues: false,
  }),
);
