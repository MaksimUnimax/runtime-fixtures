import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const fixture = read(
  "tests/regression/extension-core/fixtures/wb-cap24-sku-source-provenance-v1.json",
);
const coverage = read(
  "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
);
const finance = read(
  "tests/regression/extension-core/fixtures/wb-finance-sales-field-schema-slice-v1.json",
);
const ads = read(
  "tests/regression/extension-core/fixtures/wb-advertising-field-schema-slice-v1.json",
);
const storage = read(
  "tests/regression/extension-core/fixtures/wb-paid-storage-contribution-field-schema-slice-v1.json",
);
const scenario = coverage.scenarios.find((row) => row.id === "CAP-24");
assert.ok(scenario);
assert.equal(scenario.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(fixture.scope.liveValues, false);
assert.equal(fixture.scope.acceptedOperationMappingChanged, false);
for (const section of ["finance", "storage", "actualAds"])
  assert.ok(scenario.wbOperations.includes(fixture.sources[section].alias));
assert.equal(fixture.sources.actualAds.product, null);
assert.equal(fixture.sources.attributionOnly.actualLedger, false);
assert.equal(ads.sources.costHistory.currencyField, null);
assert.equal(
  ads.sources.campaignStats.fields["days.apps.nms.sum"].role,
  "product_attributed_promotion_statistics_spend_not_actual_cost_ledger",
);
assert.equal(
  finance.sources.salesDetailPeriod.fields.retailAmount.unit,
  "money_decimal_string",
);
assert.equal(
  finance.sources.salesDetailPeriod.fields.forPay.unit,
  "money_decimal_string",
);
assert.equal(
  finance.sources.salesDetailPeriod.currencyJoin,
  "reportId -> finance_sales_reports.reportId -> currency",
);
assert.equal(
  storage.rules.storageRows,
  "DO_NOT_DEDUP_WITHOUT_DOCUMENTED_UNIQUE_ROW_KEY",
);
assert.equal(
  storage.rules.storageDeliveryRepresentation,
  "PAID_STORAGE_WAREHOUSE_PRICE_DELIVERED_AS_LOSSLESS_JSON_NUMBER_LEXEME_STRING",
);

const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const isCalendarDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value))
    return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
const isTimezone = (value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
const incomplete = (reason) => ({
  status: "INCOMPLETE",
  reason,
  skuContribution: null,
  isNetProfit: false,
});
function inspect(input) {
  if (
    !input ||
    typeof input.period !== "string" ||
    !/^\d{4}-\d\d-\d\d\/\d{4}-\d\d-\d\d$/.test(input.period) ||
    typeof input.timezone !== "string" ||
    input.timezone !== input.timezone.trim() ||
    !input.timezone
  )
    return incomplete("PERIOD_OR_TIMEZONE_MISSING");
  const [startDay, endDay] = input.period.split("/");
  if (
    !isCalendarDay(startDay) ||
    !isCalendarDay(endDay) ||
    startDay > endDay ||
    !isTimezone(input.timezone)
  )
    return incomplete("PERIOD_OR_TIMEZONE_MISSING");
  const r = input.reads || {};
  if (
    r.financeThrough204 !== true ||
    r.storageStatus !== "done" ||
    r.adsPeriodComplete !== true
  )
    return incomplete("SOURCE_READ_INCOMPLETE");
  if (![200, 204].includes(r.storageHttp))
    return incomplete("STORAGE_DOWNLOAD_NOT_COMPLETE");
  if (
    ["finance", "storage", "ads"].some(
      (name) => input.sourcePeriods?.[name] !== input.period,
    )
  )
    return incomplete("SOURCE_PERIOD_MISMATCH");
  const cur = input.currencyBindings || {};
  const currencies = [
    cur.financeReport,
    cur.verifiedStorageAccount,
    cur.verifiedAdsAccount,
  ];
  if (
    currencies.some(
      (value) => typeof value !== "string" || !/^[A-Z]{3}$/.test(value),
    )
  )
    return incomplete("SOURCE_CURRENCY_BINDING_MISSING");
  if (new Set(currencies).size !== 1)
    return incomplete("SOURCE_CURRENCY_MISMATCH");
  const [financeRows, storageRows, adsRows] = [
    input.financeRows,
    input.storageRows,
    input.adsRows,
  ];
  if (![financeRows, storageRows, adsRows].every(Array.isArray))
    return incomplete("SOURCE_ROWS_MISSING");
  if (r.storageHttp === 204 && storageRows.length > 0)
    return incomplete("STORAGE_EMPTY_RESPONSE_CONFLICT");
  const financeIds = new Set(),
    financeProducts = new Set(),
    storageProducts = new Set();
  for (const row of financeRows) {
    if (
      !row ||
      !Number.isSafeInteger(row.rrdId) ||
      row.rrdId <= 0 ||
      !Number.isSafeInteger(row.reportId) ||
      row.reportId <= 0 ||
      !Number.isSafeInteger(row.nmId) ||
      row.nmId <= 0
    )
      return incomplete("FINANCE_ROW_ID_OR_PRODUCT_INVALID");
    if (financeIds.has(row.rrdId))
      return incomplete("DUPLICATE_FINANCE_RRD_ID");
    financeIds.add(row.rrdId);
    const reportCurrency =
      input.financeReportCurrencies?.[String(row.reportId)];
    if (
      typeof reportCurrency !== "string" ||
      !/^[A-Z]{3}$/.test(reportCurrency)
    )
      return incomplete("FINANCE_REPORT_CURRENCY_MISSING");
    if (reportCurrency !== currencies[0])
      return incomplete("SOURCE_CURRENCY_MISMATCH");
    if (
      typeof row.retailAmount !== "string" ||
      !decimal.test(row.retailAmount) ||
      typeof row.forPay !== "string" ||
      !decimal.test(row.forPay)
    )
      return incomplete("FINANCE_DECIMAL_LEXEME_INVALID");
    financeProducts.add(row.nmId);
  }
  for (const row of storageRows) {
    if (
      !row ||
      !Number.isSafeInteger(row.nmId) ||
      row.nmId <= 0 ||
      typeof row.warehousePrice !== "string" ||
      !decimal.test(row.warehousePrice) ||
      typeof row.date !== "string" ||
      typeof row.originalDate !== "string"
    )
      return incomplete("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID");
    storageProducts.add(row.nmId); // Preserve all provider rows, including duplicates and recalculations.
  }
  for (const row of adsRows)
    if (
      !row ||
      !Number.isSafeInteger(row.advertId) ||
      row.advertId <= 0 ||
      typeof row.updSum !== "number" ||
      !Number.isFinite(row.updSum)
    )
      return incomplete("ACTUAL_CAMPAIGN_SPEND_ROW_INVALID");

  return {
    status: "SOURCE_PROVENANCE_CHECKED",
    currency: currencies[0],
    financeProducts: [...financeProducts].sort((a, b) => a - b),
    storageProducts: [...storageProducts].sort((a, b) => a - b),
    financeRows: financeRows.length,
    storageRows: storageRows.length,
    adsRows: adsRows.length,
    adsGrain: "CAMPAIGN_NOT_SKU",
    skuContribution: null,
    contributionStatus: "INCOMPLETE",
    missingBusinessProof: [
      "OWNER_REVENUE_COMPONENT_POLICY",
      "ACTUAL_AD_SPEND_PRODUCT_ALLOCATION",
      "COGS_AND_TAX_OUTSIDE_PLATFORM_CONTRIBUTION",
    ],
    isNetProfit: false,
  };
}
const positive = fixture.positive;
assert.deepEqual(inspect(positive), {
  status: "SOURCE_PROVENANCE_CHECKED",
  currency: "RUB",
  financeProducts: [1001, 1002],
  storageProducts: [1001, 1003],
  financeRows: 2,
  storageRows: 3,
  adsRows: 2,
  adsGrain: "CAMPAIGN_NOT_SKU",
  skuContribution: null,
  contributionStatus: "INCOMPLETE",
  missingBusinessProof: [
    "OWNER_REVENUE_COMPONENT_POLICY",
    "ACTUAL_AD_SPEND_PRODUCT_ALLOCATION",
    "COGS_AND_TAX_OUTSIDE_PLATFORM_CONTRIBUTION",
  ],
  isNetProfit: false,
});
assert.equal(
  positive.storageRows[0].warehousePrice,
  positive.storageRows[1].warehousePrice,
);
let cases = 1;
function reject(reason, change) {
  const x = structuredClone(positive);
  change(x);
  assert.deepEqual(inspect(x), incomplete(reason));
  cases += 1;
}
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  delete x.period;
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.timezone = "";
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.period = "2026-02-30/2026-03-31";
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.period = "2026-09-30/2026-09-01";
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.timezone = "Invalid/Timezone";
});
reject("SOURCE_READ_INCOMPLETE", (x) => {
  x.reads.financeThrough204 = false;
});
reject("SOURCE_READ_INCOMPLETE", (x) => {
  x.reads.storageStatus = "processing";
});
reject("SOURCE_READ_INCOMPLETE", (x) => {
  x.reads.adsPeriodComplete = false;
});
reject("STORAGE_DOWNLOAD_NOT_COMPLETE", (x) => {
  x.reads.storageHttp = 503;
});
reject("STORAGE_EMPTY_RESPONSE_CONFLICT", (x) => {
  x.reads.storageHttp = 204;
});
reject("SOURCE_PERIOD_MISMATCH", (x) => {
  x.sourcePeriods.ads = "2026-08-01/2026-08-31";
});
reject("SOURCE_CURRENCY_BINDING_MISSING", (x) => {
  delete x.currencyBindings.verifiedAdsAccount;
});
reject("SOURCE_CURRENCY_BINDING_MISSING", (x) => {
  x.currencyBindings.financeReport = "RUB!";
});
reject("SOURCE_CURRENCY_MISMATCH", (x) => {
  x.currencyBindings.verifiedStorageAccount = "USD";
});
reject("SOURCE_ROWS_MISSING", (x) => {
  delete x.storageRows;
});
reject("FINANCE_ROW_ID_OR_PRODUCT_INVALID", (x) => {
  delete x.financeRows[0].nmId;
});
reject("FINANCE_ROW_ID_OR_PRODUCT_INVALID", (x) => {
  x.financeRows[0].rrdId = Number.MAX_SAFE_INTEGER + 1;
});
reject("FINANCE_REPORT_CURRENCY_MISSING", (x) => {
  delete x.financeReportCurrencies;
});
reject("FINANCE_REPORT_CURRENCY_MISSING", (x) => {
  x.financeRows[0].reportId = 999;
});
reject("SOURCE_CURRENCY_MISMATCH", (x) => {
  x.financeReportCurrencies["901"] = "USD";
});
reject("DUPLICATE_FINANCE_RRD_ID", (x) => {
  x.financeRows[1].rrdId = x.financeRows[0].rrdId;
});
reject("FINANCE_DECIMAL_LEXEME_INVALID", (x) => {
  x.financeRows[0].forPay = 80;
});
reject("FINANCE_DECIMAL_LEXEME_INVALID", (x) => {
  x.financeRows[0].retailAmount = "1e2";
});
reject("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID", (x) => {
  x.storageRows[0].warehousePrice = 5.125;
});
reject("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID", (x) => {
  delete x.storageRows[0].originalDate;
});
reject("ACTUAL_CAMPAIGN_SPEND_ROW_INVALID", (x) => {
  x.adsRows[0].updSum = "100";
});
const empty = structuredClone(positive);
empty.reads.storageHttp = 204;
empty.storageRows = [];
assert.equal(inspect(empty).status, "SOURCE_PROVENANCE_CHECKED");
assert.equal(inspect(empty).skuContribution, null);
cases += 1;
console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-24",
    cases,
    level: "OFFLINE_SOURCE_PROVENANCE_ONLY",
    liveProviderCalls: 0,
    perSkuPromotionSpend: "NOT_PROVEN",
    skuContribution: null,
    isNetProfit: false,
  }),
);
