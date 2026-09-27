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
    "tests/regression/extension-core/fixtures/wb-finance-reconciliation-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const finance = JSON.parse(read(slice.financeDetailReuse.fixture));

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
  "wb_finance_reconciliation_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-14"]);
assert.equal(
  slice.scope.evidence,
  "CURRENT_UPSTREAM_OPENAPI_MIRROR_PLUS_FROZEN_REGISTRY",
);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.specs["12-reports.yaml"].blobSha,
  "22ff073c10a3cebe0dc7af647eb2b704fd35857c",
);
assert.equal(
  slice.authority.specs["13-finances.yaml"].blobSha,
  "9b268d4f3edfc5912e3e7c8b9bc571523bd7a377",
);

const deductions = slice.source;
const deductionMeta = assertOperation(deductions);
assert.deepEqual([...deductionMeta.required_query_keys], ["dateTo", "limit"]);
assert.deepEqual(
  [...deductionMeta.query_keys],
  ["dateFrom", "dateTo", "sort", "order", "limit", "offset"],
);
assert.equal(deductions.query.limit.max, 1000);
assert.deepEqual(deductions.query.sort.enum, ["nmId", "dtBonus", "bonusSumm"]);
assert.deepEqual(deductions.query.order.enum, ["desc", "asc"]);
assert.equal(
  deductions.response.totalMeaning,
  "TOTAL_ROWS_WITHOUT_LIMIT_OFFSET",
);
assert.equal(
  deductions.fields.bonusSumm.unit,
  "money_number_seller_registration_country_currency",
);
assert.equal(
  slice.authority.analyticsCurrencyPolicy.rule,
  "MONETARY_VALUES_USE_SELLER_REGISTRATION_COUNTRY_CURRENCY",
);
assert.equal(
  slice.authority.analyticsCurrencyPolicy.currencyFieldInDeductionsResponse,
  false,
);
assert.equal(
  deductions.rowIdentity,
  "NO_UNIQUE_ROW_KEY_DOCUMENTED_DO_NOT_DEDUP_BY_GUESS",
);
const financeMeta = wb.OPERATIONS[slice.financeDetailReuse.operationAlias];
assert.ok(financeMeta, "finance detail operation missing");
assert.equal(financeMeta.host, "finance");
assert.equal(financeMeta.method, "POST");
assert.equal(financeMeta.path, "/api/finance/v1/sales-reports/detailed");
assert.equal(financeMeta.body_required, true);
assert.equal(financeMeta.effect, "READ");
assert.equal(financeMeta.current, true);
assert.deepEqual(slice.financeDetailReuse.rowGrain, ["rrdId"]);
assert.equal(slice.financeDetailReuse.fields.currency.unit, "currency_code");
for (const field of [
  "retailAmount",
  "forPay",
  "penalty",
  "additionalPayment",
  "deduction",
]) {
  assert.equal(
    slice.financeDetailReuse.fields[field].unit,
    "money_decimal_string",
    field + ": finance money must remain decimal string",
  );
}
assert.equal(finance.schemaVersion, "wb_finance_sales_field_schema_slice_v1");
assert.equal(
  finance.sources.salesDetailPeriod.fields.retailAmount.unit,
  "money_decimal_string",
);
assert.equal(
  finance.sources.salesDetailPeriod.fields.forPay.unit,
  "money_decimal_string",
);

const cap14 = scenarios.get("CAP-14");
assert.ok(cap14, "CAP-14 missing");
assert.deepEqual(cap14.wbOperations, slice.acceptedMappingSnapshot["CAP-14"]);
assert.equal(cap14.omissionPolicy, "MISSING_NOT_ZERO");
function validateDeductionRow(row) {
  if (!row || typeof row !== "object")
    return { status: "INCOMPLETE", reason: "DEDUCTION_ROW_INVALID" };
  if (typeof row.dtBonus !== "string" || !row.dtBonus)
    return { status: "INCOMPLETE", reason: "DEDUCTION_DATE_MISSING" };
  if (!Number.isInteger(row.nmId))
    return { status: "INCOMPLETE", reason: "DEDUCTION_PRODUCT_ID_INVALID" };
  if (!Object.hasOwn(row, "bonusSumm"))
    return { status: "INCOMPLETE", reason: "DEDUCTION_AMOUNT_MISSING" };
  if (!Number.isFinite(row.bonusSumm))
    return { status: "INCOMPLETE", reason: "DEDUCTION_AMOUNT_INVALID" };
  if (typeof row.bonusType !== "string" || !row.bonusType)
    return { status: "INCOMPLETE", reason: "DEDUCTION_TYPE_MISSING" };
  return { status: "PASS" };
}

function summarizeDeductionPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0)
    return { status: "INCOMPLETE", reason: "DEDUCTION_PAGES_MISSING" };
  let expectedOffset = 0;
  let total = null;
  const providerAmounts = [];
  let rows = 0;
  for (const page of pages) {
    if (
      !page ||
      !page.request ||
      !Number.isInteger(page.request.limit) ||
      page.request.limit < 1 ||
      page.request.limit > deductions.query.limit.max ||
      !Number.isInteger(page.request.offset) ||
      page.request.offset !== expectedOffset
    )
      return {
        status: "INCOMPLETE",
        reason: "DEDUCTION_OFFSET_SEQUENCE_INVALID",
      };
    if (!Number.isInteger(page.total) || page.total < 0)
      return { status: "INCOMPLETE", reason: "DEDUCTION_TOTAL_INVALID" };
    if (total === null) total = page.total;
    if (page.total !== total)
      return { status: "INCOMPLETE", reason: "DEDUCTION_TOTAL_CHANGED" };
    if (!Array.isArray(page.reports))
      return { status: "INCOMPLETE", reason: "DEDUCTION_REPORTS_MISSING" };
    for (const row of page.reports) {
      const checked = validateDeductionRow(row);
      if (checked.status !== "PASS") return checked;
      providerAmounts.push(row.bonusSumm);
      rows += 1;
    }
    expectedOffset += page.reports.length;
  }
  if (rows !== total)
    return { status: "INCOMPLETE", reason: "DEDUCTION_PAGINATION_INCOMPLETE" };
  return {
    status: "PASS",
    complete: true,
    rows,
    providerAmounts,
    currencyCode: null,
    currencyPolicy: "SELLER_REGISTRATION_COUNTRY_CURRENCY",
  };
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
function summarizeFinanceDetail(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    return { status: "INCOMPLETE", reason: "FINANCE_DETAIL_ROWS_MISSING" };
  const ids = new Set();
  let currency = null;
  for (const row of rows) {
    if (!row || !Number.isInteger(row.rrdId) || ids.has(row.rrdId))
      return { status: "INCOMPLETE", reason: "FINANCE_DETAIL_RRD_ID_INVALID" };
    ids.add(row.rrdId);
    if (typeof row.currency !== "string" || !row.currency)
      return {
        status: "INCOMPLETE",
        reason: "FINANCE_DETAIL_CURRENCY_MISSING",
      };
    if (currency === null) currency = row.currency;
    if (currency !== row.currency)
      return {
        status: "INCOMPLETE",
        reason: "FINANCE_DETAIL_CURRENCY_MISMATCH",
      };
    if (typeof row.sellerOperName !== "string" || !row.sellerOperName)
      return {
        status: "INCOMPLETE",
        reason: "FINANCE_DETAIL_LINE_TYPE_MISSING",
      };
    for (const field of [
      "retailAmount",
      "forPay",
      "penalty",
      "additionalPayment",
      "deduction",
    ]) {
      if (typeof row[field] !== "string" || !DECIMAL.test(row[field]))
        return { status: "INCOMPLETE", reason: "FINANCE_DETAIL_MONEY_INVALID" };
    }
  }
  return {
    status: "PASS",
    rows: rows.length,
    currency,
    signedFieldsPreserved: rows.some((row) =>
      [
        "retailAmount",
        "forPay",
        "penalty",
        "additionalPayment",
        "deduction",
      ].some((field) => row[field].startsWith("-")),
    ),
  };
}

const c = slice.syntheticCases;
assert.deepEqual(summarizeDeductionPages(c.completePages), c.completeExpected);
assert.deepEqual(
  summarizeDeductionPages(c.incompletePages),
  c.incompleteExpected,
);
assert.deepEqual(summarizeDeductionPages(c.badOffset), c.badOffsetExpected);
assert.deepEqual(
  validateDeductionRow(c.missingAmount),
  c.missingAmount.expected,
);
assert.deepEqual(
  summarizeFinanceDetail(c.financeDetailRows),
  c.financeDetailExpected,
);
assert.deepEqual(
  summarizeFinanceDetail(c.financeDetailCurrencyMismatch),
  c.financeDetailCurrencyMismatchExpected,
);
assert.equal(
  slice.rules.currency,
  "DEDUCTION_MONEY_USES_SELLER_REGISTRATION_COUNTRY_CURRENCY_BUT_CODE_NOT_IN_RESPONSE",
);
assert.equal(
  slice.rules.reconciliation,
  "DO_NOT_NET_DEDUCTIONS_WITH_FINANCE_REPORT_MONEY_UNTIL_STORE_CURRENCY_MATCH_AND_BUSINESS_RULE_ARE_EXPLICIT",
);
assert.equal(
  slice.financeDetailReuse.currencyBoundary,
  "FINANCE_DETAIL_HAS_EXPLICIT_CURRENCY_DEDUCTIONS_CODE_IS_IMPLICIT_BY_SELLER_COUNTRY_POLICY",
);
assert.equal(
  slice.rules.rowIdentity,
  "DO_NOT_DEDUP_WITHOUT_DOCUMENTED_UNIQUE_KEY",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-14",
    operations: [
      slice.financeDetailReuse.operationAlias,
      deductions.operationAlias,
    ],
    deductionCurrencyCodeInResponse: false,
    deductionCurrencyPolicy: "SELLER_REGISTRATION_COUNTRY_CURRENCY",
    financeDetailCurrencyRequired: true,
    crossSourceNettingAllowed: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
