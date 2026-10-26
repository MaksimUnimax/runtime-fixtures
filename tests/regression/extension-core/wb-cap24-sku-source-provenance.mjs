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
const integerLexeme = /^[1-9]\d{0,39}$/;
const isoTime =
  /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const DAY = 86400000;
function dayNum(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d$/.test(value))
    return null;
  const ts = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ts) &&
    new Date(ts).toISOString().slice(0, 10) === value
    ? Math.floor(ts / DAY)
    : null;
}
function identifier(value) {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" &&
    integerLexeme.test(value) &&
    BigInt(value) > 0n
    ? value
    : null;
}
const cursorId = (x) => (x === 0 || x === "0" ? "0" : identifier(x));
const orderedIds = (xs) =>
  [...xs].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
function validDateTime(value) {
  return (
    typeof value === "string" &&
    isoTime.test(value) &&
    dayNum(value.slice(0, 10)) !== null &&
    Number.isFinite(Date.parse(value))
  );
}
function eventDay(value, zone) {
  if (!validDateTime(value)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const d = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return d.year + "-" + d.month + "-" + d.day;
}
const incomplete = (reason) => ({
  status: "INCOMPLETE",
  reason,
  skuContribution: null,
  isNetProfit: false,
});
assert.equal(fixture.schemaVersion, "wb_cap24_sku_source_provenance_v2");
assert.equal(storage.paidStorage.create.maxPeriodDays, 8);
assert.equal(
  finance.sources.salesDetailPeriod.requestTimezone,
  "Europe/Moscow",
);
assert.equal(
  finance.sources.salesDetailPeriod.pagination.terminalHttpStatus,
  204,
);
assert.equal(ads.sources.costHistory.maxPeriodDays, 31);
assert.equal(
  storage.paidStorage.download.fields.originalDate.unit,
  "date_optional",
);

function inspect(input) {
  if (
    !input ||
    typeof input.period !== "string" ||
    typeof input.timezone !== "string"
  )
    return incomplete("PERIOD_OR_TIMEZONE_MISSING");
  const dates = input.period.split("/");
  if (dates.length !== 2) return incomplete("PERIOD_OR_TIMEZONE_MISSING");
  const first = dayNum(dates[0]),
    last = dayNum(dates[1]);
  // Only the officially specified finance UTC+3 request timezone is modeled.
  if (
    first === null ||
    last === null ||
    first > last ||
    input.timezone !== "Europe/Moscow"
  )
    return incomplete("PERIOD_OR_TIMEZONE_MISSING");

  const r = input.financeRead,
    request = r?.request,
    pages = r?.pages;
  if (
    !request ||
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > 100
  )
    return incomplete("FINANCE_READ_INCOMPLETE");
  if (
    request.dateFrom !== dates[0] ||
    request.dateTo !== dates[1] ||
    request.timezone !== input.timezone ||
    !finance.sources.salesDetailPeriod.periodEnum.includes(request.period) ||
    request.initialRrdId !== 0 ||
    !Array.isArray(request.fields) ||
    !["rrdId", "reportId", "nmId", "retailAmount", "forPay", "rrDate"].every(
      (k) => request.fields.includes(k),
    )
  )
    return incomplete("FINANCE_REQUEST_WINDOW_MISMATCH");
  const financeIds = new Set(),
    financeProducts = new Set();
  let cursor = "0",
    financeCount = 0,
    terminal = false;
  for (const [i, page] of pages.entries()) {
    if (!page || !Array.isArray(page.rows))
      return incomplete("FINANCE_READ_INCOMPLETE");
    if (cursorId(page.requestRrdId) !== cursor)
      return incomplete("FINANCE_CURSOR_MISMATCH");
    if (page.httpStatus === 204) {
      if (page.rows.length !== 0 || i !== pages.length - 1)
        return incomplete("FINANCE_READ_INCOMPLETE");
      terminal = true;
      break;
    }
    if (page.httpStatus !== 200 || page.rows.length === 0)
      return incomplete("FINANCE_READ_INCOMPLETE");
    for (const row of page.rows) {
      const id = identifier(row?.rrdId);
      const reportId = identifier(row?.reportId);
      const nm = identifier(row?.nmId);
      if (!id || !reportId || !nm)
        return incomplete("FINANCE_ROW_ID_OR_PRODUCT_INVALID");
      if (financeIds.has(id)) return incomplete("DUPLICATE_FINANCE_RRD_ID");
      if (BigInt(id) <= BigInt(cursor))
        return incomplete("FINANCE_ROW_ID_OR_PRODUCT_INVALID");
      financeIds.add(id);
      const code = input.financeReportCurrencies?.[reportId];
      if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code))
        return incomplete("FINANCE_REPORT_CURRENCY_MISSING");
      if (code !== input.currencyBindings?.financeReport)
        return incomplete("SOURCE_CURRENCY_MISMATCH");
      if (
        typeof row.retailAmount !== "string" ||
        !decimal.test(row.retailAmount) ||
        typeof row.forPay !== "string" ||
        !decimal.test(row.forPay)
      )
        return incomplete("FINANCE_DECIMAL_LEXEME_INVALID");
      const event = dayNum(row.rrDate);
      // saleDt may legitimately precede the report month (return/recalculation).
      if (
        event === null ||
        event < first ||
        event > last ||
        (row.saleDt != null && !validDateTime(row.saleDt))
      )
        return incomplete("FINANCE_ROW_EVENT_DATE_INVALID");
      financeProducts.add(nm);
      cursor = id;
      financeCount++;
    }
  }
  if (!terminal) return incomplete("FINANCE_READ_INCOMPLETE");

  const tasks = input.storageTasks;
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 100)
    return incomplete("STORAGE_READ_INCOMPLETE");
  let nextDay = first,
    storageCount = 0;
  const taskIds = new Set(),
    storageProducts = new Set();
  for (const task of tasks) {
    const start = dayNum(task?.create?.dateFrom),
      end = dayNum(task?.create?.dateTo);
    if (
      start === null ||
      end === null ||
      start > end ||
      end - start + 1 > storage.paidStorage.create.maxPeriodDays
    )
      return incomplete("STORAGE_PERIOD_INVALID");
    if (start !== nextDay)
      return incomplete(
        start > nextDay ? "STORAGE_PERIOD_GAP" : "STORAGE_PERIOD_OVERLAP",
      );
    nextDay = end + 1;
    const id = task.create?.response?.data?.taskId;
    const status = task.status?.response?.data;
    const download = task.download;
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ) ||
      taskIds.has(id) ||
      status?.id !== id ||
      download?.taskId !== id
    )
      return incomplete("STORAGE_TASK_ID_MISMATCH");
    taskIds.add(id);
    if (status.status !== "done") return incomplete("SOURCE_READ_INCOMPLETE");
    if (
      !Array.isArray(download.rows) ||
      ![200, 204].includes(download.httpStatus)
    )
      return incomplete("STORAGE_DOWNLOAD_NOT_COMPLETE");
    if (download.httpStatus === 204 && download.rows.length > 0)
      return incomplete("STORAGE_EMPTY_RESPONSE_CONFLICT");
    for (const row of download.rows) {
      const nm = identifier(row?.nmId);
      if (
        !nm ||
        typeof row.warehousePrice !== "string" ||
        !decimal.test(row.warehousePrice)
      )
        return incomplete("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID");
      const day = dayNum(row.date);
      if (
        day === null ||
        day < start ||
        day > end ||
        (row.originalDate != null && dayNum(row.originalDate) === null)
      )
        return incomplete("STORAGE_ROW_DATE_INVALID");
      storageProducts.add(nm); // No undocumented row de-duplication.
      storageCount++;
    }
  }
  if (nextDay !== last + 1) return incomplete("STORAGE_PERIOD_GAP");

  const adsRead = input.adsRead;
  if (
    !adsRead?.request ||
    !Array.isArray(adsRead.rows) ||
    adsRead.httpStatus !== 200
  )
    return incomplete("ADS_READ_INCOMPLETE");
  if (
    adsRead.request.from !== dates[0] ||
    adsRead.request.to !== dates[1] ||
    adsRead.request.timeZoneEvidence !== input.timezone ||
    last - first + 1 > ads.sources.costHistory.maxPeriodDays
  )
    return incomplete("ADS_REQUEST_WINDOW_MISMATCH");
  for (const row of adsRead.rows) {
    if (
      !identifier(row?.advertId) ||
      typeof row.updSum !== "number" ||
      !Number.isFinite(row.updSum)
    )
      return incomplete("ACTUAL_CAMPAIGN_SPEND_ROW_INVALID");
    // Provider cost event time is nullable, not proof of zero spend.
    if (row.updTime != null) {
      const day = eventDay(row.updTime, input.timezone),
        n = dayNum(day);
      if (n === null || n < first || n > last)
        return incomplete("ADS_EVENT_DATE_INVALID");
    }
  }
  const currency = input.currencyBindings || {};
  const codes = [
    currency.financeReport,
    currency.verifiedStorageAccount,
    currency.verifiedAdsAccount,
  ];
  if (codes.some((c) => typeof c !== "string" || !/^[A-Z]{3}$/.test(c)))
    return incomplete("SOURCE_CURRENCY_BINDING_MISSING");
  if (new Set(codes).size !== 1) return incomplete("SOURCE_CURRENCY_MISMATCH");
  return {
    status: "SYNTHETIC_DECLARATIONS_CONSISTENT",
    evidence: "OFFLINE_REQUEST_RESPONSE_SHAPES_ONLY",
    currency: codes[0],
    financeProducts: orderedIds(financeProducts),
    storageProducts: orderedIds(storageProducts),
    financeRows: financeCount,
    storageRows: storageCount,
    adsRows: adsRead.rows.length,
    storageChunks: tasks.length,
    adsGrain: "CAMPAIGN_NOT_SKU",
    skuContribution: null,
    contributionStatus: "INCOMPLETE",
    missingBusinessProof: [
      "OWNER_REVENUE_COMPONENT_POLICY",
      "ACTUAL_AD_SPEND_PRODUCT_ALLOCATION",
      "COGS_AND_TAX_OUTSIDE_PLATFORM_CONTRIBUTION",
      "LIVE_REQUEST_AND_RESPONSE_PROOF",
    ],
    isNetProfit: false,
  };
}
const positive = fixture.positive;
const expected = {
  status: "SYNTHETIC_DECLARATIONS_CONSISTENT",
  evidence: "OFFLINE_REQUEST_RESPONSE_SHAPES_ONLY",
  currency: "RUB",
  financeProducts: ["1001", "1002"],
  storageProducts: ["1001", "1003"],
  financeRows: 2,
  storageRows: 3,
  adsRows: 2,
  storageChunks: 4,
  adsGrain: "CAMPAIGN_NOT_SKU",
  skuContribution: null,
  contributionStatus: "INCOMPLETE",
  missingBusinessProof: [
    "OWNER_REVENUE_COMPONENT_POLICY",
    "ACTUAL_AD_SPEND_PRODUCT_ALLOCATION",
    "COGS_AND_TAX_OUTSIDE_PLATFORM_CONTRIBUTION",
    "LIVE_REQUEST_AND_RESPONSE_PROOF",
  ],
  isNetProfit: false,
};
assert.deepEqual(inspect(positive), expected);
assert.equal(
  positive.storageTasks[1].download.rows[0].warehousePrice,
  positive.storageTasks[1].download.rows[1].warehousePrice,
);
let cases = 1;
function reject(reason, mutate) {
  const x = structuredClone(positive);
  mutate(x);
  assert.deepEqual(inspect(x), incomplete(reason));
  cases++;
}
function accept(mutate, validate = () => {}) {
  const x = structuredClone(positive);
  mutate(x);
  const result = inspect(x);
  assert.equal(result.status, "SYNTHETIC_DECLARATIONS_CONSISTENT");
  validate(result);
  cases++;
}
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  delete x.period;
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.timezone = "Invalid/Timezone";
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.period = "2026-02-30/2026-03-31";
});
reject("PERIOD_OR_TIMEZONE_MISSING", (x) => {
  x.period = "2026-09-30/2026-09-01";
});
reject("FINANCE_REQUEST_WINDOW_MISMATCH", (x) => {
  x.financeRead.request.dateFrom = "2026-08-01";
});
reject("FINANCE_REQUEST_WINDOW_MISMATCH", (x) => {
  x.financeRead.request.timezone = "UTC";
});
reject("FINANCE_REQUEST_WINDOW_MISMATCH", (x) => {
  x.financeRead.request.initialRrdId = 1;
});
reject("FINANCE_READ_INCOMPLETE", (x) => {
  x.financeRead.pages.pop();
});
reject("FINANCE_CURSOR_MISMATCH", (x) => {
  x.financeRead.pages[1].requestRrdId = 1101;
});
reject("FINANCE_READ_INCOMPLETE", (x) => {
  x.financeRead.pages[1].rows = [{}];
});
reject("DUPLICATE_FINANCE_RRD_ID", (x) => {
  x.financeRead.pages[0].rows[1].rrdId = "1101"; // Mixed numeric/string IDs are identical.
});
reject("FINANCE_ROW_ID_OR_PRODUCT_INVALID", (x) => {
  x.financeRead.pages[0].rows[0].rrdId = Number.MAX_SAFE_INTEGER + 1;
});
reject("FINANCE_ROW_ID_OR_PRODUCT_INVALID", (x) => {
  delete x.financeRead.pages[0].rows[0].nmId;
});
reject("FINANCE_DECIMAL_LEXEME_INVALID", (x) => {
  delete x.financeRead.pages[0].rows[0].retailAmount;
});
reject("FINANCE_DECIMAL_LEXEME_INVALID", (x) => {
  delete x.financeRead.pages[0].rows[0].forPay;
});
reject("FINANCE_DECIMAL_LEXEME_INVALID", (x) => {
  x.financeRead.pages[0].rows[0].retailAmount = "1e2";
});
reject("FINANCE_ROW_EVENT_DATE_INVALID", (x) => {
  x.financeRead.pages[0].rows[0].rrDate = "2099-01-01";
});
reject("FINANCE_ROW_EVENT_DATE_INVALID", (x) => {
  x.financeRead.pages[0].rows[0].saleDt = "2026-02-30T12:00:00+03:00";
});
reject("FINANCE_REPORT_CURRENCY_MISSING", (x) => {
  delete x.financeReportCurrencies["901"];
});
reject("SOURCE_CURRENCY_MISMATCH", (x) => {
  x.financeReportCurrencies["901"] = "USD";
});
reject("STORAGE_READ_INCOMPLETE", (x) => {
  delete x.storageTasks;
});
reject("STORAGE_PERIOD_INVALID", (x) => {
  x.storageTasks[0].create.dateTo = "2026-09-09";
});
reject("STORAGE_PERIOD_GAP", (x) => {
  x.storageTasks.splice(2, 1);
});
reject("STORAGE_PERIOD_OVERLAP", (x) => {
  x.storageTasks[1].create.dateFrom = "2026-09-08";
  x.storageTasks[1].create.dateTo = "2026-09-15"; // Keep each task within the official 8-day maximum.
});
reject("STORAGE_TASK_ID_MISMATCH", (x) => {
  x.storageTasks[1].status.response.data.id = "different";
});
reject("STORAGE_TASK_ID_MISMATCH", (x) => {
  x.storageTasks[1].download.taskId = x.storageTasks[0].download.taskId;
});
reject("SOURCE_READ_INCOMPLETE", (x) => {
  x.storageTasks[1].status.response.data.status = "processing";
});
reject("STORAGE_DOWNLOAD_NOT_COMPLETE", (x) => {
  x.storageTasks[1].download.httpStatus = 503;
});
reject("STORAGE_EMPTY_RESPONSE_CONFLICT", (x) => {
  x.storageTasks[1].download.httpStatus = 204;
});
reject("STORAGE_ROW_DATE_INVALID", (x) => {
  x.storageTasks[1].download.rows[0].date = "nonsense";
});
reject("STORAGE_ROW_DATE_INVALID", (x) => {
  x.storageTasks[1].download.rows[0].date = "2099-01-01";
});
reject("STORAGE_ROW_DATE_INVALID", (x) => {
  x.storageTasks[1].download.rows[0].originalDate = "2026-02-30";
});
reject("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID", (x) => {
  delete x.storageTasks[1].download.rows[0].warehousePrice;
});
reject("STORAGE_ROW_OR_DECIMAL_LEXEME_INVALID", (x) => {
  x.storageTasks[1].download.rows[0].warehousePrice = 5.125;
});
accept((x) => {
  delete x.storageTasks[1].download.rows[0].originalDate;
});
accept((x) => {
  x.storageTasks[1].download.rows[0].originalDate = "2026-08-31";
});
accept(
  (x) => {
    x.storageTasks[1].download.httpStatus = 204;
    x.storageTasks[1].download.rows = [];
  },
  (result) => assert.equal(result.storageRows, 0),
);
reject("ADS_READ_INCOMPLETE", (x) => {
  x.adsRead.httpStatus = 503;
});
reject("ADS_REQUEST_WINDOW_MISMATCH", (x) => {
  x.adsRead.request.from = "2026-08-01";
});
reject("ADS_REQUEST_WINDOW_MISMATCH", (x) => {
  x.adsRead.request.timeZoneEvidence = "UTC";
});
reject("ACTUAL_CAMPAIGN_SPEND_ROW_INVALID", (x) => {
  delete x.adsRead.rows[0].updSum;
});
reject("ADS_EVENT_DATE_INVALID", (x) => {
  x.adsRead.rows[0].updTime = "nonsense";
});
reject("ADS_EVENT_DATE_INVALID", (x) => {
  x.adsRead.rows[0].updTime = "2099-01-01T10:00:00+03:00";
});
accept((x) => {
  delete x.adsRead.rows[0].updTime;
});
reject("SOURCE_CURRENCY_BINDING_MISSING", (x) => {
  delete x.currencyBindings.verifiedAdsAccount;
});
reject("SOURCE_CURRENCY_MISMATCH", (x) => {
  x.currencyBindings.verifiedStorageAccount = "USD";
});
const large = structuredClone(positive);
large.financeRead.pages[0].rows[0].rrdId = "9223372036854775806";
large.financeRead.pages[0].rows[1].rrdId = "9223372036854775807";
large.financeRead.pages[1].requestRrdId = "9223372036854775807";
large.financeRead.pages[0].rows[0].nmId = "9223372036854775806";
large.financeRead.pages[0].rows[0].reportId = "901";
large.storageTasks[1].download.rows[0].nmId = "9223372036854775806";
assert.equal(inspect(large).status, "SYNTHETIC_DECLARATIONS_CONSISTENT");
assert.ok(inspect(large).financeProducts.includes("9223372036854775806"));
cases++;
console.log(
  JSON.stringify({
    status: "PASS",
    scenario: "CAP-24",
    cases,
    level: "OFFLINE_SYNTHETIC_REQUEST_WINDOW_AND_TASK_LIFECYCLE_CHECKS",
    providerCalls: 0,
    currencyAndSkuMoney: "NOT_VERIFIED",
    adsProductAllocation: "NOT_PROVEN",
    skuContribution: null,
    isNetProfit: false,
  }),
);
