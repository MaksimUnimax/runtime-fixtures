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
    "tests/regression/extension-core/fixtures/wb-advertising-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const finance = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-finance-sales-field-schema-slice-v1.json",
  ),
);
const statsGrain = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-advertising-stats-grain-field-schema-slice-v1.json",
  ),
);
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
  assert.equal(
    meta.effect,
    "READ",
    source.operationAlias + ": must remain read-only",
  );
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
}

assert.equal(slice.schemaVersion, "wb_advertising_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-16", "STD-17", "STD-20"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const campaigns = slice.sources.campaigns;
const costs = slice.sources.costHistory;
const stats = slice.sources.campaignStats;
const clusters = slice.sources.searchClusterDaily;
for (const source of [campaigns, costs, stats, clusters]) {
  assert.match(source.url, /^https:\/\/dev\.wildberries\.ru\//);
  assertOperation(source);
}
assert.deepEqual(campaigns.paymentTypes, ["cpm", "cpc"]);
assert.deepEqual(Object.keys(campaigns.fields), [
  "id",
  "status",
  "settings.payment_type",
  "nm_settings[].nm_id",
  "currency",
]);
assert.ok(!Object.hasOwn(campaigns.fields, "advertId"));
assert.ok(!Object.hasOwn(campaigns.fields, "paymentType"));
assert.deepEqual(
  campaigns.fields.id,
  advertisedStock.sources.campaigns.fields.id,
);
assert.deepEqual(
  campaigns.fields["nm_settings[].nm_id"],
  advertisedStock.sources.campaigns.fields["nm_settings.nm_id"],
);
assert.deepEqual(
  campaigns.fields.currency,
  advertisedStock.sources.campaigns.fields.currency,
);
assert.deepEqual(costs.requestFields, ["from", "to"]);
assert.equal(costs.minPeriodDays, 1);
assert.equal(costs.maxPeriodDays, 31);
assert.equal(costs.fields.updSum.role, "actual_promotion_cost_amount");
assert.equal(costs.currencyField, null);
assert.equal(
  costs.currencyBoundary,
  "CURRENCY_NOT_RETURNED_REQUIRE_SEPARATE_PROVIDER_ACCOUNT_CONTEXT",
);
assert.equal(stats.maxPeriodDays, 31);
assert.equal(stats.maxCampaignIds, 50);
assert.deepEqual(stats.eligibleStatuses, [7, 9, 11]);
assert.equal(
  stats.fields["days.sum"].role,
  "promotion_statistics_spend_not_actual_cost_ledger",
);
assert.equal(
  stats.fields["days.sum_price"].role,
  "campaign_attributed_order_value_not_store_revenue",
);
assert.equal(stats.fields.currency.role, "promotion_statistics_currency");
assert.equal(stats.fields.currency.unit, "currency_code_iso_4217");
assert.equal(stats.currencyField, "currency");
assert.equal(
  stats.currencyField,
  statsGrain.sources.promotion.currencyFieldCurrentOpenapi,
  "promo_fullstats currency must follow the newer pinned current OpenAPI evidence",
);
assert.equal(
  stats.actualSpendBoundary,
  "USE_COST_HISTORY_UPD_SUM_FOR_ACTUAL_PROMOTION_SPEND",
);
assert.deepEqual(clusters.paymentTypes, ["cpm", "cpc"]);
assert.deepEqual(clusters.cpcUnavailableFields, ["views", "ctr", "cpm"]);
assert.deepEqual(clusters.requiredForSlice, ["clicks", "orders"]);
assert.equal(clusters.moneyBoundary, "NOT_SOURCE_OF_ACTUAL_PROMOTION_SPEND");

assert.equal(
  finance.rules.ownerRevenueDefinition,
  slice.sources.revenueBoundary.ownerRevenueDefinition,
);
assert.equal(
  slice.sources.revenueBoundary.operationalStatisticsSales,
  "PRELIMINARY_NOT_FINAL_FINANCE",
);

for (const id of slice.scope.scenarioIds) {
  const scenario = scenarios.get(id);
  assert.ok(scenario, id + ": scenario missing");
  assert.equal(scenario.omissionPolicy, "MISSING_NOT_ZERO");
}
for (const [id, expected] of Object.entries(slice.acceptedMappingSnapshot)) {
  if (id === "knownGap") continue;
  assert.deepEqual(
    scenarios.get(id).wbOperations,
    expected,
    id + ": accepted operation mapping changed",
  );
}

function campaignSpend(rows) {
  const totals = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.advertId) || !Number.isFinite(row.updSum))
      return { status: "INCOMPLETE", reason: "INVALID_COST_ROW" };
    totals.set(row.advertId, (totals.get(row.advertId) ?? 0) + row.updSum);
  }
  return Object.fromEntries(
    [...totals.entries()].map(([id, spend]) => [String(id), spend]),
  );
}

const spend = campaignSpend(slice.syntheticCases.costRows);
assert.deepEqual(spend, slice.syntheticCases.expectedCampaignSpend);
const rank = Object.entries(spend)
  .sort(
    (left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]),
  )
  .map(([id]) => Number(id));
assert.deepEqual(rank, slice.syntheticCases.expectedRank);

const statsRow = slice.syntheticCases.fullStatsRow;
assert.equal(
  statsRow.currency,
  "RUB",
  "fullstats fixture must carry explicit response currency",
);
assert.notEqual(
  statsRow.sum,
  statsRow.sum_price,
  "campaign statistics spend and attributed order value must remain distinct",
);
assert.notEqual(
  Object.values(spend).reduce((sum, value) => sum + value, 0),
  statsRow.sum,
  "actual cost history must not be replaced with the fullstats spend snapshot",
);

function drr(row) {
  if (
    typeof row.spend !== "number" ||
    !Number.isFinite(row.spend) ||
    typeof row.revenue !== "number" ||
    !Number.isFinite(row.revenue) ||
    row.revenue <= 0 ||
    typeof row.spendCurrency !== "string" ||
    typeof row.revenueCurrency !== "string" ||
    row.spendCurrency !== row.revenueCurrency
  )
    return null;
  return (row.spend / row.revenue) * 100;
}

for (const row of slice.syntheticCases.drr)
  assert.equal(
    drr(row),
    row.expected,
    "DRR must fail closed on zero/missing/currency mismatch",
  );

assert.equal(
  slice.rules.spend,
  "ACTUAL_SPEND_USES_COST_HISTORY_UPD_SUM_NOT_FULLSTATS_SUM",
);
assert.equal(
  slice.rules.noDoubleCount,
  "DO_NOT_ADD_FULLSTATS_SUM_TO_COST_HISTORY_UPD_SUM",
);
assert.equal(
  slice.rules.attributedOrderValue,
  "FULLSTATS_SUM_PRICE_IS_CAMPAIGN_ATTRIBUTION_NOT_STORE_REVENUE",
);
assert.equal(
  slice.rules.denominator,
  "ZERO_MISSING_UNSELECTED_OR_CURRENCY_MISMATCH_RETURNS_NULL",
);
assert.equal(
  slice.rules.currency,
  "FULLSTATS_USES_RESPONSE_CURRENCY__ACTUAL_COST_HISTORY_REQUIRES_SEPARATE_CURRENCY_CONTEXT",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [
      campaigns.operationAlias,
      costs.operationAlias,
      stats.operationAlias,
      clusters.operationAlias,
    ],
    actualSpendSource: costs.operationAlias,
    promotionCurrencyInResponse: true,
    finalRevenueSelected: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
