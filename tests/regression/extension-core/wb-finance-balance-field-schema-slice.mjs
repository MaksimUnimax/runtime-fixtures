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
    "tests/regression/extension-core/fixtures/wb-finance-balance-field-schema-slice-v1.json",
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

assert.equal(slice.schemaVersion, "wb_finance_balance_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-13"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);

const source = slice.source;
const meta = wb.OPERATIONS[source.operationAlias];
assert.ok(meta, "finance_balance operation missing");
assert.equal(meta.host, source.host);
assert.equal(meta.method, source.method);
assert.equal(meta.path, source.path);
assert.equal(meta.effect, "READ");
assert.equal(meta.execution_enabled, true);
assert.equal(meta.current, true);
assert.equal(meta.body_required, false);
assert.deepEqual(Array.from(meta.required_query_keys), []);
assert.equal(source.period, "NONE_CURRENT_SNAPSHOT");

const cap13 = scenarios.get("CAP-13");
assert.ok(cap13, "CAP-13 missing");
assert.deepEqual(cap13.wbOperations, slice.acceptedMappingSnapshot["CAP-13"]);
assert.equal(cap13.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(
  finance.sources.salesReportList.fields.retailAmountSum.role,
  slice.reportMetadataReuse.fields.retailAmountSum,
);
assert.equal(
  finance.sources.salesReportList.fields.forPaySum.role,
  slice.reportMetadataReuse.fields.forPaySum,
);

function summarizeBalance(input) {
  if (typeof input?.currency !== "string" || !input.currency.trim())
    return { status: "INCOMPLETE", reason: "BALANCE_CURRENCY_MISSING" };
  if (
    !Object.hasOwn(input, "current") ||
    !Object.hasOwn(input, "for_withdraw")
  )
    return { status: "INCOMPLETE", reason: "BALANCE_AMOUNT_MISSING" };
  if (
    typeof input.current !== "number" ||
    !Number.isFinite(input.current) ||
    typeof input.for_withdraw !== "number" ||
    !Number.isFinite(input.for_withdraw)
  )
    return { status: "INCOMPLETE", reason: "BALANCE_AMOUNT_INVALID" };
  return {
    status: "PASS",
    currency: input.currency,
    current: input.current,
    forWithdraw: input.for_withdraw,
  };
}

for (const name of [
  "snapshot",
  "negativeCurrent",
  "missingCurrency",
  "missingWithdraw",
  "invalidAmount",
]) {
  const c = slice.syntheticCases[name];
  const { expected, ...input } = c;
  assert.deepEqual(summarizeBalance(input), expected, name);
}
assert.notEqual(
  source.fields.current.role,
  source.fields.for_withdraw.role,
  "current and for_withdraw must stay distinct",
);
assert.equal(slice.rules.currentVsWithdraw, "DISTINCT_PROVIDER_BALANCE_FIELDS");
assert.equal(
  slice.rules.balanceVsReport,
  "CURRENT_ACCOUNT_SNAPSHOT_IS_NOT_PERIOD_REPORT_TOTAL",
);
assert.equal(
  slice.rules.revenue,
  "DO_NOT_LABEL_BALANCE_CURRENT_OR_FOR_WITHDRAW_AS_REVENUE",
);
assert.equal(slice.rules.profit, "DO_NOT_DERIVE_PROFIT_FROM_BALANCE_FIELDS");
assert.equal(
  slice.rules.currency,
  "REQUIRE_PROVIDER_CURRENCY_DO_NOT_ASSUME_RUB",
);
assert.equal(slice.rules.missing, "MISSING_NOT_ZERO");
assert.equal(
  slice.rules.numeric,
  "REQUIRE_FINITE_PROVIDER_NUMBER_PRESERVE_SIGN",
);

console.log(
  JSON.stringify({
    status: "PASS",
    schemaVersion: slice.schemaVersion,
    scenario: "CAP-13",
    operation: source.operationAlias,
    currentAndWithdrawDistinct: true,
    currentSnapshotDistinctFromReportTotals: true,
    acceptedOperationMappingChanged: false,
    liveValues: false,
  }),
);
