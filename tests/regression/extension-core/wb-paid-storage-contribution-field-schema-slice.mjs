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
    "tests/regression/extension-core/fixtures/wb-paid-storage-contribution-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const finance = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-finance-reconciliation-field-schema-slice-v1.json",
  ),
);
const advertising = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-advertising-field-schema-slice-v1.json",
  ),
);
const operationalSales = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-operational-sales-field-schema-slice-v1.json",
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
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = 24 * 60 * 60 * 1000;

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
  "wb_paid_storage_contribution_field_schema_slice_v1",
);
assert.deepEqual(slice.scope.scenarioIds, ["CAP-24"]);
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
assert.equal(
  finance.authority.analyticsCurrencyPolicy.rule,
  slice.authority.deductionsCurrencyPolicyReuse.rule,
);

const create = slice.paidStorage.create;
const statusSource = slice.paidStorage.status;
const download = slice.paidStorage.download;
const createMeta = assertOperation(create);
const statusMeta = assertOperation(statusSource);
const downloadMeta = assertOperation(download);
assert.deepEqual(Array.from(createMeta.required_query_keys), [
  "dateFrom",
  "dateTo",
]);
assert.equal(createMeta.body_required, false);
assert.equal(statusMeta.body_required, false);
assert.equal(downloadMeta.body_required, false);
assert.equal(create.maxPeriodDays, 8);
assert.deepEqual(statusSource.statuses, {
  new: "PENDING",
  processing: "PENDING",
  done: "READY",
  purged: "TERMINAL_UNAVAILABLE",
  canceled: "TERMINAL_UNAVAILABLE",
});
assert.equal(download.allowedOnlyAfterStatus, "done");
assert.equal(download.http204, "EXPLICIT_NO_DATA");
assert.equal(download.currencyCodeField, null);
assert.equal(download.rowIdentity, "NO_DOCUMENTED_UNIQUE_ROW_KEY");
assert.equal(
  download.fields.warehousePrice.unit,
  "provider_money_number_currency_code_absent",
);
assert.equal(
  slice.authority.deductionsCurrencyPolicyReuse.scope,
  "DEDUCTIONS_ONLY_NOT_ASSUMED_FOR_PAID_STORAGE",
);
const cap24 = scenarios.get("CAP-24");
assert.ok(cap24, "CAP-24 missing");
assert.deepEqual(cap24.wbOperations, slice.acceptedMappingSnapshot["CAP-24"]);
assert.equal(cap24.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(
  cap24.externalDependency,
  "COGS_TAX_EXTERNAL_COSTS_DEFERRED_FOR_FULL_PROFIT",
);

assert.equal(
  finance.financeDetailReuse.operationAlias,
  slice.reusedSources.financeDetail.operationAlias,
);
assert.equal(
  finance.source.operationAlias,
  slice.reusedSources.deductions.operationAlias,
);
assert.equal(
  advertising.sources.costHistory.operationAlias,
  slice.reusedSources.promotionSpend.operationAlias,
);
assert.equal(advertising.sources.costHistory.currencyField, null);
assert.equal(
  operationalSales.sources.sales.operationAlias,
  slice.reusedSources.operationalSales.operationAlias,
);
assert.equal(operationalSales.sources.sales.authoritativeRevenueField, null);

for (const field of [
  "currency",
  "retailAmount",
  "forPay",
  "commissionPercent",
  "ppvzSalesCommission",
  "acquiringFee",
  "vw",
  "vwNds",
  "deliveryService",
  "rebillLogisticCost",
  "paidStorage",
  "penalty",
  "additionalPayment",
  "deduction",
])
  assert.equal(
    typeof slice.reusedSources.financeDetail.currentOpenapiFields[field],
    "string",
    field + ": current finance-detail field claim missing",
  );

function dateMs(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validatePeriod(createInput) {
  const from = dateMs(createInput?.dateFrom);
  const to = dateMs(createInput?.dateTo);
  if (
    from === null ||
    to === null ||
    to <= from ||
    to - from > create.maxPeriodDays * DAY
  )
    return { status: "INCOMPLETE", reason: "PAID_STORAGE_PERIOD_INVALID" };
  return { status: "PASS" };
}

function taskId(input) {
  const value = input?.response?.data?.taskId;
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function statusData(input) {
  const data = input?.response?.data;
  if (
    !data ||
    typeof data.id !== "string" ||
    !UUID.test(data.id) ||
    !Object.hasOwn(statusSource.statuses, data.status)
  )
    return null;
  return { id: data.id, status: data.status };
}

const JSON_DECIMAL_LEXEME = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

function parseBoundedDecimalExponent(value, fractionLength) {
  const token = value ?? "0";
  const negative = token.startsWith("-");
  const digits =
    token.startsWith("-") || token.startsWith("+") ? token.slice(1) : token;
  if (
    digits.length === 0 ||
    digits.length > slice.decimalContract.maxExponentLexemeDigits
  )
    return null;

  const maximumRelevantMagnitude =
    slice.decimalContract.maxExpansionDigits + fractionLength;
  let magnitude = 0;
  for (const digit of digits) {
    magnitude = magnitude * 10 + (digit.charCodeAt(0) - 48);
    if (magnitude > maximumRelevantMagnitude) return null;
  }
  return negative ? -magnitude : magnitude;
}

function parseExactDecimalLexeme(value) {
  if (typeof value !== "string") return null;
  const match = JSON_DECIMAL_LEXEME.exec(value);
  if (!match) return null;

  const fraction = match[3] ?? "";
  const digitCount = match[2].length + fraction.length;
  if (digitCount > slice.decimalContract.maxExpansionDigits) return null;

  const exponent = parseBoundedDecimalExponent(match[4], fraction.length);
  if (exponent === null) return null;

  let coefficient = BigInt(match[2] + fraction);
  if (match[1] === "-") coefficient = -coefficient;

  let scale = fraction.length - exponent;
  if (!Number.isSafeInteger(scale)) return null;
  if (scale < 0) {
    const shift = -scale;
    if (
      shift > slice.decimalContract.maxExpansionDigits ||
      digitCount + shift > slice.decimalContract.maxExpansionDigits
    )
      return null;
    if (coefficient !== 0n) coefficient *= 10n ** BigInt(shift);
    scale = 0;
  }
  if (scale > slice.decimalContract.maxExpansionDigits) return null;
  return { coefficient, scale };
}

function coefficientDigits(coefficient) {
  return (coefficient < 0n ? -coefficient : coefficient).toString().length;
}

function formatExactDecimal(coefficient, scale) {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale === 0) {
    const value = (negative ? "-" : "") + digits;
    return value.length <= slice.decimalContract.maxOutputCharacters
      ? value
      : null;
  }
  digits = digits.padStart(scale + 1, "0");
  const value =
    (negative ? "-" : "") +
    digits.slice(0, -scale) +
    "." +
    digits.slice(-scale);
  return value.length <= slice.decimalContract.maxOutputCharacters
    ? value
    : null;
}

function aggregateExactDecimals(parts) {
  if (parts.length === 0) return "0";
  if (parts.length > slice.decimalContract.maxAggregateRows) return null;

  let scale = 0;
  for (const part of parts) {
    if (
      !part ||
      typeof part.coefficient !== "bigint" ||
      !Number.isSafeInteger(part.scale) ||
      part.scale < 0 ||
      part.scale > slice.decimalContract.maxExpansionDigits
    )
      return null;
    if (part.scale > scale) scale = part.scale;
  }

  let coefficient = 0n;
  for (const part of parts) {
    const shift = scale - part.scale;
    if (
      part.coefficient !== 0n &&
      coefficientDigits(part.coefficient) + shift >
        slice.decimalContract.maxAlignedCoefficientDigits
    )
      return null;
    const aligned =
      part.coefficient === 0n ? 0n : part.coefficient * 10n ** BigInt(shift);
    coefficient += aligned;
    if (
      coefficientDigits(coefficient) >
      slice.decimalContract.maxAggregateCoefficientDigits
    )
      return null;
  }
  return formatExactDecimal(coefficient, scale);
}

function projectPaidStorage(input) {
  const period = validatePeriod(input.create);
  if (period.status !== "PASS") return period;

  const createdTaskId = taskId(input.create);
  const observed = statusData(input.status);
  if (!createdTaskId || !observed)
    return { status: "INCOMPLETE", reason: "PAID_STORAGE_TASK_INVALID" };
  if (observed.id !== createdTaskId)
    return { status: "INCOMPLETE", reason: "PAID_STORAGE_TASK_ID_MISMATCH" };

  const lifecycle = statusSource.statuses[observed.status];
  if (lifecycle === "PENDING")
    return { status: "INCOMPLETE", reason: "PAID_STORAGE_TASK_PENDING" };
  if (lifecycle === "TERMINAL_UNAVAILABLE")
    return {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_TASK_TERMINAL_UNAVAILABLE",
    };

  if (input.downloadHttpStatus === 204) {
    if (Array.isArray(input.rows) && input.rows.length !== 0)
      return { status: "INCOMPLETE", reason: "PAID_STORAGE_204_WITH_ROWS" };
    return {
      status: "PASS",
      complete: true,
      taskId: createdTaskId,
      rows: 0,
      productIds: [],
      storageAmounts: [],
      currencyCode: null,
      currencyPolicy: null,
      exactStorageAggregate: "0",
    };
  }
  if (input.downloadHttpStatus !== 200 || !Array.isArray(input.rows))
    return { status: "INCOMPLETE", reason: "PAID_STORAGE_DOWNLOAD_INVALID" };
  if (input.rows.length > slice.decimalContract.maxAggregateRows)
    return {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_DECIMAL_AGGREGATE_ROW_LIMIT_EXCEEDED",
    };

  const productIds = new Set();
  const storageAmounts = [];
  const exactAmounts = [];
  for (const row of input.rows) {
    if (!row || dateMs(row.date) === null || !Number.isInteger(row.nmId))
      return { status: "INCOMPLETE", reason: "PAID_STORAGE_ROW_INVALID" };
    const exactAmount = parseExactDecimalLexeme(row.warehousePrice);
    if (!exactAmount)
      return {
        status: "INCOMPLETE",
        reason: "PAID_STORAGE_WAREHOUSE_PRICE_DECIMAL_INVALID",
      };
    if (
      row.originalDate !== undefined &&
      row.originalDate !== null &&
      dateMs(row.originalDate) === null
    )
      return {
        status: "INCOMPLETE",
        reason: "PAID_STORAGE_ORIGINAL_DATE_INVALID",
      };
    productIds.add(row.nmId);
    storageAmounts.push(row.warehousePrice);
    exactAmounts.push(exactAmount);
  }

  const exactStorageAggregate = aggregateExactDecimals(exactAmounts);
  if (exactStorageAggregate === null)
    return {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_DECIMAL_AGGREGATE_LIMIT_EXCEEDED",
    };

  return {
    status: "PASS",
    complete: true,
    taskId: createdTaskId,
    rows: input.rows.length,
    productIds: [...productIds].sort((a, b) => a - b),
    storageAmounts,
    currencyCode: null,
    currencyPolicy: null,
    exactStorageAggregate,
  };
}
const cases = slice.syntheticCases;
for (const name of [
  "doneRows",
  "doneNoData",
  "processing",
  "purged",
  "taskMismatch",
  "periodTooLong",
]) {
  const value = cases[name];
  const { expected, ...input } = value;
  assert.deepEqual(projectPaidStorage(input), expected, name);
}

assert.equal(
  slice.decimalContract.inputRepresentation,
  "LOSSLESS_JSON_NUMBER_LEXEME_STRING",
);
assert.equal(slice.decimalContract.grammar, "JSON_NUMBER");
assert.equal(
  slice.decimalContract.arithmetic,
  "BIGINT_COEFFICIENT_EFFECTIVE_SCALE",
);
assert.equal(slice.decimalContract.aggregateScale, "MAX_EFFECTIVE_INPUT_SCALE");
assert.equal(slice.decimalContract.output, "NON_EXPONENTIAL_DECIMAL_STRING");
assert.equal(slice.decimalContract.maxExpansionDigits, 4096);
assert.equal(slice.decimalContract.maxExponentLexemeDigits, 4096);
assert.equal(slice.decimalContract.maxAggregateRows, 4096);
assert.equal(slice.decimalContract.maxAlignedCoefficientDigits, 4096);
assert.equal(slice.decimalContract.maxAggregateCoefficientDigits, 4096);
assert.equal(slice.decimalContract.maxOutputCharacters, 4100);
assert.equal(
  slice.decimalContract.resourceBoundsAuthority,
  "LOCAL_FAIL_CLOSED_SAFETY_LIMIT_NOT_PROVIDER_SEMANTICS",
);

for (const value of slice.decimalContract.cases) {
  const parts = value.lexemes.map(parseExactDecimalLexeme);
  assert.equal(parts.includes(null), false, value.name + ": parse");
  assert.equal(
    aggregateExactDecimals(parts),
    value.expectedAggregate,
    value.name + ": aggregate",
  );

  const projected = structuredClone(cases.doneRows);
  projected.rows[0].warehousePrice = value.lexemes[0];
  projected.rows[1].warehousePrice = value.lexemes[1];
  projected.expected.storageAmounts = [...value.lexemes];
  projected.expected.exactStorageAggregate = value.expectedAggregate;
  const { expected, ...input } = projected;
  assert.deepEqual(
    projectPaidStorage(input),
    expected,
    value.name + ": project",
  );
}
assert.equal(
  parseExactDecimalLexeme(
    "1".repeat(slice.decimalContract.maxExpansionDigits + 1),
  ),
  null,
  "oversize decimal mantissa must fail closed",
);
assert.equal(
  parseExactDecimalLexeme(
    "1e" + "0".repeat(slice.decimalContract.maxExponentLexemeDigits + 1) + "1",
  ),
  null,
  "oversize exponent lexeme must fail closed before numeric conversion",
);

{
  const crossScale = [
    parseExactDecimalLexeme(
      "9".repeat(slice.decimalContract.maxExpansionDigits),
    ),
    parseExactDecimalLexeme("1e-" + slice.decimalContract.maxExpansionDigits),
  ];
  assert.equal(
    crossScale.includes(null),
    false,
    "cross-scale inputs parse individually",
  );
  assert.equal(
    aggregateExactDecimals(crossScale),
    null,
    "cross-scale alignment beyond aggregate coefficient bound must fail closed",
  );

  const projected = structuredClone(cases.doneRows);
  projected.rows[0].warehousePrice = "9".repeat(
    slice.decimalContract.maxExpansionDigits,
  );
  projected.rows[1].warehousePrice =
    "1e-" + slice.decimalContract.maxExpansionDigits;
  const { expected: _expected, ...input } = projected;
  assert.deepEqual(
    projectPaidStorage(input),
    {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_DECIMAL_AGGREGATE_LIMIT_EXCEEDED",
    },
    "projected cross-scale aggregate growth must fail closed",
  );
}

{
  const maxDigits = "9".repeat(slice.decimalContract.maxExpansionDigits);
  const carryParts = [
    parseExactDecimalLexeme(maxDigits),
    parseExactDecimalLexeme(maxDigits),
  ];
  assert.equal(
    carryParts.includes(null),
    false,
    "carry inputs parse individually",
  );
  assert.equal(
    aggregateExactDecimals(carryParts),
    null,
    "aggregate carry beyond coefficient bound must fail closed",
  );
}

{
  const projected = structuredClone(cases.doneRows);
  const template = projected.rows[0];
  projected.rows = Array.from(
    { length: slice.decimalContract.maxAggregateRows + 1 },
    () => ({ ...template }),
  );
  const { expected: _expected, ...input } = projected;
  assert.deepEqual(
    projectPaidStorage(input),
    {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_DECIMAL_AGGREGATE_ROW_LIMIT_EXCEEDED",
    },
    "aggregate row count must fail closed before decimal work",
  );
}

for (const value of slice.decimalContract.invalidInputs) {
  assert.equal(
    parseExactDecimalLexeme(value),
    null,
    "invalid decimal " + String(value),
  );
  const projected = structuredClone(cases.doneRows);
  projected.rows[0].warehousePrice = value;
  const { expected: _expected, ...input } = projected;
  assert.deepEqual(
    projectPaidStorage(input),
    {
      status: "INCOMPLETE",
      reason: "PAID_STORAGE_WAREHOUSE_PRICE_DECIMAL_INVALID",
    },
    "invalid projected decimal " + String(value),
  );
}

function contributionReadiness(input) {
  if (input?.completeSources !== true)
    return {
      status: "INCOMPLETE",
      reason: "PLATFORM_CONTRIBUTION_SOURCES_INCOMPLETE",
    };
  if (!input.componentPolicy)
    return {
      status: "INCOMPLETE",
      reason: "PLATFORM_CONTRIBUTION_COMPONENT_POLICY_REQUIRED",
    };
  if (
    typeof input.financeCurrency !== "string" ||
    !input.financeCurrency ||
    typeof input.storageCurrencyCode !== "string" ||
    !input.storageCurrencyCode ||
    typeof input.adsCurrencyCode !== "string" ||
    !input.adsCurrencyCode ||
    new Set([
      input.financeCurrency,
      input.storageCurrencyCode,
      input.adsCurrencyCode,
    ]).size !== 1
  )
    return {
      status: "INCOMPLETE",
      reason: "PLATFORM_CONTRIBUTION_CURRENCY_BINDING_REQUIRED",
    };
  return { status: "SOURCE_READY_FOR_NUMERIC_POLICY" };
}

{
  const value = cases.contributionWithoutPolicy;
  const { expected, ...input } = value;
  assert.deepEqual(contributionReadiness(input), expected);
}

assert.equal(
  slice.rules.storageRows,
  "DO_NOT_DEDUP_WITHOUT_DOCUMENTED_UNIQUE_ROW_KEY",
);
assert.equal(
  slice.rules.storageDeliveryRepresentation,
  "PAID_STORAGE_WAREHOUSE_PRICE_DELIVERED_AS_LOSSLESS_JSON_NUMBER_LEXEME_STRING",
);
assert.equal(
  slice.rules.storageArithmetic,
  "SUM_LOSSLESS_DECIMAL_STRINGS_WITH_BIGINT_COEFFICIENT_AND_MAX_EFFECTIVE_SCALE",
);
assert.equal(
  slice.rules.revenue,
  "NO_OWNER_DEFINED_REVENUE_FIELD_IS_CURRENTLY_SELECTED",
);
assert.equal(
  slice.rules.fees,
  "DO_NOT_DERIVE_PLATFORM_FEES_AS_RETAIL_AMOUNT_MINUS_FOR_PAY_OR_BY_IMPLICIT_FIELD_BUCKETING",
);
assert.equal(
  slice.rules.logistics,
  "DO_NOT_AUTO_GROUP_DELIVERY_SERVICE_AND_REBILL_LOGISTIC_COST_WITHOUT_COMPONENT_POLICY",
);
assert.equal(
  slice.rules.ads,
  "PROMO_SPEND_HISTORY_HAS_NO_CURRENCY_CODE_REQUIRE_EXPLICIT_ACCOUNT_CURRENCY_BINDING",
);
assert.equal(
  slice.rules.contribution,
  "PLATFORM_CONTRIBUTION_REQUIRES_COMPLETE_EXPLICIT_COMPONENT_POLICY_AND_COMMON_CURRENCY_BINDING",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");
assert.equal(slice.rules.netProfit, false);

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-24",
    paidStorageLifecycle: "CREATE_STATUS_DOWNLOAD",
    maxPeriodDays: create.maxPeriodDays,
    taskStatuses: Object.keys(statusSource.statuses),
    done204ExplicitEmpty: true,
    recalculationRowsPreserved: true,
    storageCurrencyCodeInResponse: false,
    storageExactAggregateRequiresPolicy: false,
    storageExactAggregateUsesLosslessDecimalStrings: true,
    platformContributionSourceReady: false,
    platformContributionReason:
      "COMPONENT_POLICY_AND_COMMON_CURRENCY_BINDING_OPEN",
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
