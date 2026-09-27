import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const slice = JSON.parse(
  read("tests/regression/extension-core/fixtures/wb-finance-sales-field-schema-slice-v1.json"),
);
const coverage = JSON.parse(
  read("tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json"),
);

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(relative), context, { filename: relative });
  return context[name];
}

const wb = loadGlobal(coverage.authorities.wildberries.registryPath, "WBOperations");
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

function assertOperation(source) {
  const meta = wb.OPERATIONS[source.operationAlias];
  assert.ok(meta, "missing WB operation " + source.operationAlias);
  assert.equal(meta.host, source.host, source.operationAlias + ": host drift");
  assert.equal(meta.method, source.method, source.operationAlias + ": method drift");
  assert.equal(meta.path, source.path, source.operationAlias + ": path drift");
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
}

assert.equal(slice.schemaVersion, "wb_finance_sales_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["STD-01", "STD-03", "CAP-13"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const list = slice.sources.salesReportList;
const detail = slice.sources.salesDetailPeriod;
assert.match(list.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.match(detail.url, /^https:\/\/dev\.wildberries\.ru\//);
assert.match(detail.releaseNotesUrl, /^https:\/\/dev\.wildberries\.ru\//);
assertOperation(list);
assertOperation(detail);
assert.deepEqual(list.tokenTypes, ["personal", "service"]);
assert.deepEqual(detail.tokenTypes, ["personal", "service"]);
assert.equal(detail.requestTimezone, "Europe/Moscow");
assert.equal(detail.requestUtcOffset, "+03:00");
assert.equal(detail.limitMax, 100000);
assert.deepEqual(detail.pagination, {
  initialRrdId: 0,
  nextCursor: "LAST_ROW_RRD_ID",
  terminalHttpStatus: 204,
});
for (const field of ["retailAmountSum", "forPaySum"])
  assert.equal(list.fields[field].unit, "money_decimal_string");
for (const field of ["retailAmount", "forPay"])
  assert.equal(detail.fields[field].unit, "money_decimal_string");
assert.notEqual(detail.fields.retailAmount.role, detail.fields.forPay.role);
assert.equal(detail.currencyJoin, "reportId -> finance_sales_reports.reportId -> currency");

for (const id of slice.scope.scenarioIds) {
  assert.ok(scenarios.has(id), id + ": scenario missing");
  assert.equal(scenarios.get(id).omissionPolicy, "MISSING_NOT_ZERO");
}
for (const [id, expected] of Object.entries(slice.acceptedMappingSnapshot)) {
  if (id === "knownGap") continue;
  assert.deepEqual(
    scenarios.get(id).wbOperations,
    expected,
    id + ": accepted operation mapping changed",
  );
}

function parseDecimal(value) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, frac = ""] = unsigned.split(".");
  return {
    sign: negative ? -1n : 1n,
    digits: BigInt(whole + frac),
    scale: frac.length,
  };
}

function addDecimals(values) {
  const parsed = values.map(parseDecimal);
  if (parsed.some((value) => value === null)) return null;
  const scale = Math.max(2, ...parsed.map((value) => value.scale));
  let total = 0n;
  for (const value of parsed)
    total += value.sign * value.digits * 10n ** BigInt(scale - value.scale);
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = String(abs % base).padStart(scale, "0");
  return (negative ? "-" : "") + String(whole) + "." + frac;
}

function summarize(rows, report, paginationComplete) {
  if (!paginationComplete)
    return { status: "INCOMPLETE", reason: "PAGINATION_NOT_TERMINAL_204" };
  if (!report || typeof report.currency !== "string" || !report.currency)
    return { status: "INCOMPLETE", reason: "REPORT_CURRENCY_MISSING" };
  if (rows.some((row) => row.reportId !== report.reportId))
    return { status: "INCOMPLETE", reason: "REPORT_ID_MISMATCH" };
  for (const field of ["retailAmount", "forPay"]) {
    if (rows.some((row) => parseDecimal(row[field]) === null))
      return { status: "INCOMPLETE", reason: "MONEY_NOT_DECIMAL_STRING" };
  }

  const byProduct = {};
  for (const row of rows) {
    const key = String(row.nmId);
    const target = (byProduct[key] ??= { retailAmount: [], forPay: [] });
    target.retailAmount.push(row.retailAmount);
    target.forPay.push(row.forPay);
  }
  for (const value of Object.values(byProduct)) {
    value.retailAmount = addDecimals(value.retailAmount);
    value.forPay = addDecimals(value.forPay);
  }

  return {
    status: "PASS",
    currency: report.currency,
    retailAmount: addDecimals(rows.map((row) => row.retailAmount)),
    forPay: addDecimals(rows.map((row) => row.forPay)),
    byProduct,
  };
}

const c = slice.syntheticCases;
const summary = summarize(c.detailRows, c.reportMetadata, c.paginationComplete);
assert.equal(summary.status, "PASS");
assert.deepEqual(
  {
    currency: summary.currency,
    retailAmount: summary.retailAmount,
    forPay: summary.forPay,
    byProduct: summary.byProduct,
  },
  c.expected,
);
assert.notEqual(
  summary.retailAmount,
  summary.forPay,
  "retailAmount and forPay must not be silently substituted",
);
assert.equal(summary.retailAmount, c.reportMetadata.retailAmountSum);
assert.equal(summary.forPay, c.reportMetadata.forPaySum);
assert.deepEqual(
  summarize([c.invalidMoneyRow], c.reportMetadata, true),
  { status: "INCOMPLETE", reason: c.invalidMoneyRow.expectedReason },
);
assert.deepEqual(
  summarize([], { reportId: c.missingCurrency.reportId }, true),
  { status: "INCOMPLETE", reason: c.missingCurrency.expectedReason },
);
assert.deepEqual(
  summarize(c.detailRows, c.reportMetadata, false),
  { status: "INCOMPLETE", reason: "PAGINATION_NOT_TERMINAL_204" },
);
assert.equal(slice.rules.ownerRevenueDefinition, "REQUIRED_BEFORE_LABEL_REVENUE");
assert.equal(slice.rules.decimalMath, "EXACT_DECIMAL_STRING_NO_BINARY_FLOAT");
assert.equal(slice.rules.currency, "JOIN_REPORT_METADATA_DO_NOT_ASSUME_RUB");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenarios: slice.scope.scenarioIds,
    operations: [list.operationAlias, detail.operationAlias],
    currencyJoin: true,
    exactDecimal: true,
    finalRevenueSelected: false,
    liveValues: false,
  }),
);
