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
assert.equal(stats.fields["days.apps.nms.nmId"].role, "product_id");
assert.deepEqual(
  stats.fields["days.apps.nms.nmId"],
  statsGrain.sources.promotion.fields["days.apps.nms.nmId"],
  "STD advertising and CAP-18 must use the same official app-nested product grain",
);
assert.equal(
  stats.fields["days.apps.nms.sum"].role,
  "product_attributed_promotion_statistics_spend_not_actual_cost_ledger",
);

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
  const value = (row.spend / row.revenue) * 100;
  return Number.isFinite(value) ? value : null;
}

for (const row of slice.syntheticCases.drr)
  assert.equal(
    drr(row),
    row.expected,
    "DRR must fail closed on zero/missing/currency mismatch",
  );

let finiteDrrCases = 0;
function checkFiniteDrr(values, expected, label) {
  const actual = drr(values);
  assert.ok(Object.is(actual, expected), label);
  assert.ok(actual === null || Number.isFinite(actual), label + " finite/null");
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label + " JSON");
  finiteDrrCases++;
}
for (const [label, spend, revenue, expected] of [
  ["division overflow", 1, Number.MIN_VALUE, null],
  ["scale overflow", Number.MAX_VALUE, 1, null],
  ["negative division overflow", -1, Number.MIN_VALUE, null],
  ["negative scale overflow", -Number.MAX_VALUE, 1, null],
  ["finite MAX", 1.7976931348623156e306, 1, Number.MAX_VALUE],
  ["finite negative MAX", -1.7976931348623156e306, 1, -Number.MAX_VALUE],
  ["scale overflow neighbour", 1.797693134862316e306, 1, null],
  ["ordinary percent", 150, 1000, 15],
  ["above100 retained", 100, 1, 10000],
  ["negative finite spend", -150, 1000, -15],
  ["division rounding", 1, 3, 33.33333333333333],
  ["zero", 0, Number.MIN_VALUE, 0],
  ["negative zero", -0, Number.MIN_VALUE, -0],
  ["subnormal scale", Number.MIN_VALUE, 1, 4.94e-322],
  ["underflow", Number.MIN_VALUE, 2, 0],
  ["negative underflow", -Number.MIN_VALUE, 2, -0],
  ["subnormal tie", 3 * Number.MIN_VALUE, 2, 9.9e-322],
  ["zero revenue", 1, 0, null],
  ["negative revenue", 1, -1, null],
])
  checkFiniteDrr({ spend, revenue, spendCurrency: "RUB", revenueCurrency: "RUB" }, expected, label);
for (const field of ["spend", "revenue"]) {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, "1", {}, [], true, false, 1n, Symbol("synthetic"), new Number(1), () => 1])
    checkFiniteDrr({ spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB", [field]: value }, null, "invalid metric " + field);
  const missing = { spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB" };
  delete missing[field];
  checkFiniteDrr(missing, null, "missing metric " + field);
}
for (const field of ["spendCurrency", "revenueCurrency"]) {
  for (const value of [null, undefined, 1, true, {}, [], Symbol("synthetic"), new String("RUB"), "USD"])
    checkFiniteDrr({ spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB", [field]: value }, null, "currency rejection " + field);
  const missing = { spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB" };
  delete missing[field];
  checkFiniteDrr(missing, null, "missing currency " + field);
}
// Existing string-equality admission is characterized, not ISO/provider proof.
for (const currency of ["", " RUB ", "USD"])
  checkFiniteDrr({ spend: 150, revenue: 1000, spendCurrency: currency, revenueCurrency: currency }, 15, "existing equal currency strings");
checkFiniteDrr({ spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB", complete: false }, 15, "helper has no generic completeness flag");
const frozenDrrRow = Object.freeze({ spend: 150, revenue: 1000, spendCurrency: "RUB", revenueCurrency: "RUB" });
const frozenDrrRowBefore = JSON.stringify(frozenDrrRow);
checkFiniteDrr(frozenDrrRow, 15, "frozen helper input");
assert.equal(JSON.stringify(frozenDrrRow), frozenDrrRowBefore, "helper input unchanged");
assert.throws(() => drr(null), TypeError, "preexisting helper null root");
assert.throws(() => drr(undefined), TypeError, "preexisting helper missing root");

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
    finiteDrrCases,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
