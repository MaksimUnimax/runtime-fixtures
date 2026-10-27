import "./ozon-capability-status-boundary.mjs";
import "./ozon-cap24-report-status-failclosed.mjs";
import "./wb-stock-field-schema-slice.mjs";
import "./wb-operational-sales-field-schema-slice.mjs";
import "./wb-finance-sales-field-schema-slice.mjs";
import "./wb-advertising-field-schema-slice.mjs";
import "./wb-order-lifecycle-field-schema-slice.mjs";
import "./wb-inventory-movement-boundary.mjs";
import "./wb-price-field-schema-slice.mjs";
import "./wb-catalog-identity-field-schema-slice.mjs";
import "./wb-turnover-field-schema-slice.mjs";
import "./wb-supply-status-field-schema-slice.mjs";
import "./wb-content-quality-field-schema-slice.mjs";
import "./wb-warehouse-logistics-field-schema-slice.mjs";
import "./wb-supply-acceptance-field-schema-slice.mjs";
import "./wb-replenishment-field-schema-slice.mjs";
import "./wb-standard-supply-status-reuse.mjs";
import "./wb-standard-supply-acceptance-stock-reuse.mjs";
import "./wb-promotion-calendar-field-schema-slice.mjs";
import "./wb-finance-balance-field-schema-slice.mjs";
import "./wb-finance-reconciliation-field-schema-slice.mjs";
import "./wb-feedback-question-privacy-field-schema-slice.mjs";
import "./wb-campaign-status-field-schema-slice.mjs";
import "./wb-advertising-stats-grain-field-schema-slice.mjs";
import "./wb-advertised-stock-reuse.mjs";
import "./wb-paid-storage-contribution-field-schema-slice.mjs";
import "./wb-cap24-sku-source-provenance.mjs";
import "./wb-sales-geography-field-schema-slice.mjs";
import "./wb-sales-decline-evidence-reuse.mjs";
import "./wb-cross-source-join-field-schema-slice.mjs";
import "./wb-search-query-field-schema-slice.mjs";
import "./wb-search-position-share-field-schema-slice.mjs";
import "./wb-visibility-mapping-refresh.mjs";
import "./wb-rating-boundary-refresh.mjs";
import "./wb-sales-decline-causal-factor-reuse.mjs";
import "./wb-external-context-boundary.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const abs = (relative) => path.join(ROOT, relative);
const read = (relative) => fs.readFileSync(abs(relative), "utf8");
const sha256File = (relative) =>
  createHash("sha256")
    .update(fs.readFileSync(abs(relative)))
    .digest("hex");
const sha256Text = (value) => createHash("sha256").update(value).digest("hex");
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const numeric = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json",
  ),
);

function compareCodeUnits(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(relative), context, { filename: relative });
  return context[name];
}

function loadEffectiveWildberriesRegistry() {
  const composition = JSON.parse(read("apps/extension/composition.json"));
  const sources =
    composition.isolated_bundles?.["shared/wb_adapter.js"]?.reference_sources;
  assert.ok(
    Array.isArray(sources),
    "WB effective registry composition missing",
  );
  const donorIndex = sources.indexOf(
    coverage.authorities.wildberries.registryPath,
  );
  const credentialsIndex = sources.findIndex((value) =>
    value.endsWith("/wb_credentials.js"),
  );
  assert.equal(donorIndex, 0, "frozen WB donor must remain first in bundle");
  assert.ok(
    credentialsIndex > donorIndex,
    "WB registry overlay boundary missing",
  );
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  for (const relative of sources.slice(donorIndex, credentialsIndex))
    vm.runInContext(read(relative), context, { filename: relative });
  assert.ok(context.WBOperations?.OPERATIONS, "effective WB registry missing");
  return context.WBOperations;
}

function parseTsv(relative) {
  const lines = read(relative).trimEnd().split("\n");
  const headers = lines.shift().split("\t");
  return lines.map((line) =>
    Object.fromEntries(
      line.split("\t").map((value, index) => [headers[index], value]),
    ),
  );
}

assert.equal(coverage.schemaVersion, "business_scenario_coverage_v1");
assert.equal(numeric.schemaVersion, "business_scenario_numeric_fixtures_v1");
assert.equal(
  sha256File(coverage.authorities.ozon.registryPath),
  coverage.authorities.ozon.registrySha256,
  "Ozon registry drift requires mapping review",
);
assert.equal(
  sha256File(coverage.authorities.wildberries.registryPath),
  coverage.authorities.wildberries.registrySha256,
  "WB registry drift requires mapping review",
);

const readinessRows = parseTsv(coverage.readiness.path);
assert.equal(readinessRows.length, coverage.readiness.expectedRows);
const semanticProjection = readinessRows
  .map(
    (row) =>
      coverage.readiness.semanticColumns
        .map((column) => row[column])
        .join("\t") + "\n",
  )
  .join("");
assert.equal(
  sha256Text(semanticProjection),
  coverage.readiness.semanticProjectionSha256,
  "readiness semantics drift requires explicit mapping review",
);

const readinessIds = readinessRows.map((row) => row.ID);
const mappedIds = coverage.scenarios.map((row) => row.id);
assert.deepEqual(
  mappedIds,
  readinessIds,
  "coverage manifest must account for every readiness row in order",
);
assert.equal(
  new Set(mappedIds).size,
  mappedIds.length,
  "scenario IDs must be unique",
);

const wb = loadEffectiveWildberriesRegistry();
const ozon = loadGlobal(
  coverage.authorities.ozon.registryPath,
  "OzonOperationRegistry",
);
const allowedCoverage = new Set([
  "DIRECT",
  "COMPOSITE",
  "BOUNDARY",
  "EXTERNAL_CONTEXT",
  "CONTRIBUTION_ONLY",
  "LOCAL_FILE_HISTORY",
]);
const allowedContinuation = new Set([
  "EXPLICIT_ONLY",
  "EXPLICIT_PAGINATION",
  "EXPLICIT_REPORT_LIFECYCLE",
  "EXPLICIT_NEXT_READ",
]);
const boundaryCoverage = new Set([
  "BOUNDARY",
  "EXTERNAL_CONTEXT",
  "CONTRIBUTION_ONLY",
  "LOCAL_FILE_HISTORY",
]);
const wbHosts = new Set();
let wbOperationRefs = 0;
let ozonOperationRefs = 0;
for (const row of coverage.scenarios) {
  assert.ok(
    allowedCoverage.has(row.ozonCoverage),
    `${row.id}: invalid Ozon coverage state`,
  );
  assert.ok(
    allowedCoverage.has(row.wbCoverage),
    `${row.id}: invalid WB coverage state`,
  );
  assert.ok(
    allowedContinuation.has(row.continuationPolicy),
    `${row.id}: continuation must remain explicit`,
  );
  assert.equal(
    row.omissionPolicy,
    "MISSING_NOT_ZERO",
    `${row.id}: missing/403/unready must not become zero`,
  );
  assert.ok(
    row.identifiers.length > 0,
    `${row.id}: identifier grain must be explicit`,
  );
  assert.ok(
    row.metrics.length > 0,
    `${row.id}: metrics/units must be explicit`,
  );
  assert.ok(
    row.ozonOperations.length > 0 && row.wbOperations.length > 0,
    `${row.id}: both marketplace mappings required`,
  );
  assert.equal(
    new Set(row.ozonOperations).size,
    row.ozonOperations.length,
    `${row.id}: duplicate Ozon operation`,
  );
  assert.equal(
    new Set(row.wbOperations).size,
    row.wbOperations.length,
    `${row.id}: duplicate WB operation`,
  );
  for (const alias of row.ozonOperations) {
    const meta = ozon.OPERATIONS[alias];
    assert.ok(meta, `${row.id}: missing Ozon operation ${alias}`);
    assert.equal(
      meta.execution_enabled,
      true,
      `${row.id}/${alias}: Ozon operation disabled`,
    );
    assert.equal(
      meta.effect,
      "READ",
      `${row.id}/${alias}: Ozon operation not READ`,
    );
    assert.equal(
      meta.currentness,
      "current",
      `${row.id}/${alias}: Ozon operation not current`,
    );
    ozonOperationRefs++;
  }
  for (const alias of row.wbOperations) {
    const meta = wb.OPERATIONS[alias];
    assert.ok(meta, `${row.id}: missing WB operation ${alias}`);
    assert.equal(
      meta.execution_enabled,
      true,
      `${row.id}/${alias}: WB operation disabled`,
    );
    assert.equal(
      meta.effect,
      "READ",
      `${row.id}/${alias}: WB operation not READ`,
    );
    assert.equal(
      meta.current,
      true,
      `${row.id}/${alias}: WB operation not current`,
    );
    assert.notEqual(
      meta.privacy,
      "blocked_pii",
      `${row.id}/${alias}: direct PII surface forbidden`,
    );
    wbHosts.add(meta.host);
    wbOperationRefs++;
  }
  if (
    boundaryCoverage.has(row.wbCoverage) ||
    boundaryCoverage.has(row.ozonCoverage)
  )
    assert.ok(
      row.externalDependency,
      `${row.id}: bounded coverage must state its external/semantic boundary`,
    );
}

// A missing numerical source is not the same as an observed zero.
// Keep existing finite numeric/string metrics while rejecting null and blank.
function finiteRecordedMetric(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Validate a real UTC calendar day before using it in a best/worst ranking.
function exactUtcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const time = Date.parse(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    return null;
  return time;
}

function validDeclaredTimeZone(value) {
  if (typeof value !== "string" || !value || value !== value.trim())
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// SOURCE-only finite aggregation: alternate positive and negative operands
// to avoid intermediate Infinity before a valid cancellation is applied.
// Do not convert an unrepresentable aggregate into observed zero.
function balancedFiniteSum(values) {
  const positives = [];
  const negatives = [];
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (value > 0) positives.push(value);
    else if (value < 0) negatives.push(value);
  }
  positives.sort((a, b) => b - a);
  negatives.sort((a, b) => a - b);
  let total = 0;
  let pos = 0;
  let neg = 0;
  while (pos < positives.length || neg < negatives.length) {
    const next =
      (total <= 0 && pos < positives.length) || neg >= negatives.length
        ? positives[pos++]
        : negatives[neg++];
    total += next;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

const calculators = {
  sales_totals(input) {
    if (input?.complete !== true || !Array.isArray(input.rows))
      return { status: "INCOMPLETE", money: null, units: null };
    const rows = input.rows;
    const invalid = rows.some(
      (row) =>
        row?.money === null ||
        row?.money === undefined ||
        row?.units === null ||
        row?.units === undefined ||
        typeof row?.money !== "number" ||
        typeof row?.units !== "number" ||
        !Number.isFinite(row.money) ||
        !Number.isFinite(row.units),
    );
    if (invalid) return { status: "INCOMPLETE", money: null, units: null };
    const money = balancedFiniteSum(rows.map((row) => row.money));
    const units = balancedFiniteSum(rows.map((row) => row.units));
    if (money === null || units === null)
      return { status: "INCOMPLETE", money: null, units: null };
    return { status: "COMPLETE", money, units };
  },
  daily_rank(input) {
    if (!Array.isArray(input?.rows) || input.rows.length === 0) return null;
    const seenDays = new Set();
    const rows = [];
    for (const row of input.rows) {
      const dayMs = exactUtcDay(row?.day);
      const money = finiteRecordedMetric(row?.money);
      if (dayMs === null || money === null || seenDays.has(row.day))
        return null;
      seenDays.add(row.day);
      rows.push({ day: row.day, money });
    }
    // Historical numeric fixtures rank supplied rows only; a declared
    // completeness claim needs a bounded inclusive period and every day.
    if (input.period !== undefined || input.complete !== undefined) {
      const startMs = exactUtcDay(input.period?.start);
      const endMs = exactUtcDay(input.period?.end);
      if (
        input.complete !== true ||
        startMs === null ||
        endMs === null ||
        startMs > endMs
      )
        return null;
      const count = (endMs - startMs) / 86400000 + 1;
      if (
        !Number.isSafeInteger(count) ||
        count !== 14 ||
        rows.length !== count ||
        rows.some(
          (r) => exactUtcDay(r.day) < startMs || exactUtcDay(r.day) > endMs,
        )
      )
        return null;
    }
    const best = [...rows]
      .sort((a, b) => b.money - a.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((r) => r.day);
    const worst = [...rows]
      .sort((a, b) => a.money - b.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((r) => r.day);
    return { best, worst };
  },
  percent_change(input) {
    // SOURCE-ONLY: validate a DECLARED pair of source rows, not provider
    // authenticity or authoritative sales/revenue field semantics. Callers must
    // independently establish those before claiming a live business answer.
    if (input?.complete !== undefined || input?.proof !== undefined) {
      const asOf = input.proof?.asOf;
      const currentProof = input.proof?.current;
      const previousProof = input.proof?.previous;
      const asOfDay = exactUtcDay(asOf?.day);
      const currentDay = exactUtcDay(currentProof?.day);
      const previousDay = exactUtcDay(previousProof?.day);
      if (
        input.complete !== true ||
        currentProof?.complete !== true ||
        previousProof?.complete !== true ||
        asOfDay === null ||
        currentDay === null ||
        previousDay === null ||
        currentDay !== asOfDay - 86400000 ||
        previousDay !== asOfDay - 172800000 ||
        !validDeclaredTimeZone(asOf?.timeZone)
      )
        return null;
      const sameFields = [
        "timeZone",
        "definition",
        "source",
        "storeId",
        "operation",
        "field",
        "metric",
        "unit",
        "currency",
      ];
      if (
        currentProof.timeZone !== asOf.timeZone ||
        sameFields.some((name) => currentProof[name] !== previousProof[name]) ||
        [
          "definition",
          "source",
          "storeId",
          "operation",
          "field",
          "metric",
          "unit",
        ].some(
          (name) =>
            typeof currentProof[name] !== "string" ||
            !currentProof[name].trim(),
        )
      )
        return null;
      if (
        !["ozon", "wildberries"].includes(currentProof.source) ||
        !["money", "units"].includes(currentProof.metric)
      )
        return null;
      const std04 = coverage.scenarios.find((row) => row.id === "STD-04");
      const operations =
        currentProof.source === "ozon"
          ? std04?.ozonOperations
          : std04?.wbOperations;
      if (
        !Array.isArray(operations) ||
        !operations.includes(currentProof.operation)
      )
        return null;
      if (
        currentProof.metric === "money"
          ? typeof currentProof.currency !== "string" ||
            currentProof.currency.length !== 3 ||
            !/^[A-Z]{3}$/.test(currentProof.currency) ||
            currentProof.unit !== currentProof.currency
          : currentProof.currency !== null || currentProof.unit !== "count"
      )
        return null;
      if (
        typeof input.current !== "number" ||
        typeof input.previous !== "number" ||
        !Number.isFinite(currentProof.value) ||
        !Number.isFinite(previousProof.value) ||
        input.current !== currentProof.value ||
        input.previous !== previousProof.value
      )
        return null;
    }
    const current = finiteRecordedMetric(input?.current),
      previous = finiteRecordedMetric(input?.previous);
    if (current === null || previous === null || previous === 0) return null;
    const percent = ((current - previous) / Math.abs(previous)) * 100;
    return Number.isFinite(percent) ? percent : null;
  },
  warehouse_sort(input) {
    if (
      !Array.isArray(input?.rows) ||
      input.rows.some(
        (row) =>
          !row ||
          typeof row.warehouse !== "string" ||
          !row.warehouse ||
          finiteRecordedMetric(row.units) === null,
      )
    )
      return null;
    return [...input.rows]
      .sort(
        (a, b) =>
          finiteRecordedMetric(b.units) - finiteRecordedMetric(a.units) ||
          compareCodeUnits(a.warehouse, b.warehouse),
      )
      .map((row) => row.warehouse);
  },
  days_cover(input) {
    if (input?.complete !== true) return null;
    const stock = finiteRecordedMetric(input.stock),
      demand = finiteRecordedMetric(input.demandUnits),
      days = finiteRecordedMetric(input.days);
    if (
      stock === null ||
      demand === null ||
      days === null ||
      stock < 0 ||
      demand <= 0 ||
      days <= 0
    )
      return null;
    if (stock === 0) return 0;
    // Neither division order is universally safe at IEEE-754 limits.
    // Try a total-period quotient first, then a daily-rate quotient.
    // Underflow is UNKNOWN rather than fabricated zero stock coverage.
    const periodRatio = (stock / demand) * days;
    if (Number.isFinite(periodRatio) && periodRatio > 0) return periodRatio;
    const dailyRatio = stock / (demand / days);
    if (Number.isFinite(dailyRatio) && dailyRatio > 0) return dailyRatio;
    // Either earlier quotient can overflow before its later cancellation.
    // This final product-first order still rejects genuinely infinite output.
    const productRatio = (stock * days) / demand;
    return Number.isFinite(productRatio) && productRatio > 0
      ? productRatio
      : null;
  },
  drr(input) {
    if (input?.complete !== true) return null;
    const spend = finiteRecordedMetric(input.spend),
      revenue = finiteRecordedMetric(input.revenue);
    if (spend === null || revenue === null || revenue <= 0) return null;
    if (spend === 0) return 0;
    // An intermediate ratio can underflow although the scaled percentage
    // is representable. Unknown subnormal values must never be called 0%.
    const percentage = (spend / revenue) * 100;
    if (Number.isFinite(percentage) && percentage !== 0) return percentage;
    const scaledNumerator = (spend * 100) / revenue;
    return Number.isFinite(scaledNumerator) && scaledNumerator !== 0
      ? scaledNumerator
      : null;
  },
  platform_contribution(input) {
    const incomplete = {
      status: "INCOMPLETE",
      label: "platform_contribution",
      amount: null,
      isNetProfit: false,
    };
    const raw = [
      input.revenue,
      input.fees,
      input.storage,
      input.logistics,
      input.ads,
    ];
    if (
      input.complete !== true ||
      raw.some((value) => typeof value !== "number" || !Number.isFinite(value))
    )
      return incomplete;

    const components = ["revenue", "fees", "storage", "logistics", "ads"];
    const currencyByComponent = input.currencyByComponent;
    if (
      !currencyByComponent ||
      typeof currencyByComponent !== "object" ||
      Array.isArray(currencyByComponent)
    )
      return incomplete;
    const currencies = components.map(
      (component) => currencyByComponent[component],
    );
    if (
      currencies.some(
        (currency) =>
          typeof currency !== "string" ||
          !currency ||
          currency !== currency.trim(),
      ) ||
      new Set(currencies).size !== 1
    )
      return incomplete;

    const amount = balancedFiniteSum([
      raw[0],
      -raw[1],
      -raw[2],
      -raw[3],
      -raw[4],
    ]);
    if (amount === null) return incomplete;
    return {
      status: "COMPLETE",
      label: "platform_contribution",
      amount,
      isNetProfit: false,
    };
  },
  top_n_join(input) {
    if (!input || !Array.isArray(input.catalog) || !Array.isArray(input.sales))
      return { status: "INCOMPLETE", reason: "JOIN_INPUT_MISSING" };
    if (!Number.isSafeInteger(input.n) || input.n < 1)
      return { status: "INCOMPLETE", reason: "TOP_N_INVALID" };
    // Missing source product identity cannot be reported as joined sales.
    const recordedId = (value) =>
      (typeof value === "string" && value.trim() !== "") ||
      (typeof value === "number" && Number.isSafeInteger(value));
    if (
      input.catalog.some((row) => !row || !recordedId(row.id)) ||
      input.sales.some((row) => !row || !recordedId(row.id))
    )
      return { status: "INCOMPLETE", reason: "SOURCE_ITEM_ID_MISSING" };
    if (
      input.catalog.some(
        (row) => typeof row.name !== "string" || !row.name.trim(),
      )
    )
      return { status: "INCOMPLETE", reason: "CATALOG_NAME_MISSING" };
    const catalogIds = input.catalog.map((row) => row.id);
    if (new Set(catalogIds).size !== catalogIds.length)
      return { status: "DUPLICATE_KEY", side: "catalog" };
    const salesIds = input.sales.map((row) => row.id);
    if (new Set(salesIds).size !== salesIds.length)
      return { status: "DUPLICATE_KEY", side: "sales" };
    if (
      input.sales.some(
        (row) => typeof row.money !== "number" || !Number.isFinite(row.money),
      )
    )
      return { status: "INCOMPLETE" };
    const catalog = new Map(input.catalog.map((row) => [row.id, row]));
    const ranked = [...input.sales]
      .sort(
        (a, b) =>
          Number(b.money) - Number(a.money) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, input.n);
    const missingCatalog = ranked
      .filter((row) => !catalog.has(row.id))
      .map((row) => row.id);
    const top = ranked
      .filter((row) => catalog.has(row.id))
      .map((row) => ({
        id: row.id,
        name: catalog.get(row.id).name,
        money: row.money,
      }));
    return { top, missingCatalog };
  },
  join_unique(input) {
    const left = input.left.map((row) => row.id);
    if (new Set(left).size !== left.length)
      return { status: "DUPLICATE_KEY", side: "left" };
    const right = input.right.map((row) => row.id);
    if (new Set(right).size !== right.length)
      return { status: "DUPLICATE_KEY", side: "right" };
    return { status: "UNIQUE" };
  },
  cross_source_join(input) {
    if (
      typeof input.period !== "string" ||
      !input.period ||
      !Array.isArray(input.left) ||
      !Array.isArray(input.right)
    )
      return { status: "INCOMPLETE", reason: "PERIOD_OR_SOURCE_MISSING" };

    // A source that has not confirmed all pages/read completion is UNKNOWN,
    // not a legitimately empty reporting period. Both read sides must prove
    // completeness before comparing their product populations.
    if (input.leftComplete !== true || input.rightComplete !== true)
      return { status: "INCOMPLETE", reason: "SOURCE_READ_INCOMPLETE" };

    const project = (rows, side) => {
      const ids = new Set();
      const products = new Map();
      for (const row of rows) {
        if (
          !row ||
          typeof row.rowId !== "string" ||
          !row.rowId ||
          typeof row.product !== "string" ||
          !row.product ||
          row.period !== input.period
        )
          return {
            status: "INCOMPLETE",
            reason: side === "left" ? "LEFT_ROW_INVALID" : "RIGHT_ROW_INVALID",
          };
        if (ids.has(row.rowId))
          return {
            status: "INCOMPLETE",
            reason:
              side === "left"
                ? "DUPLICATE_LEFT_ROW_ID"
                : "DUPLICATE_RIGHT_ROW_ID",
          };
        ids.add(row.rowId);
        products.set(row.product, (products.get(row.product) ?? 0) + 1);
      }
      return { status: "COMPLETE", products };
    };

    const left = project(input.left, "left");
    if (left.status !== "COMPLETE") return left;
    const right = project(input.right, "right");
    if (right.status !== "COMPLETE") return right;
    const leftProducts = [...left.products.keys()].sort();
    const rightProducts = [...right.products.keys()].sort();
    if (JSON.stringify(leftProducts) !== JSON.stringify(rightProducts))
      return { status: "INCOMPLETE", reason: "PRODUCT_SET_MISMATCH" };

    return {
      status: "COMPLETE",
      rows: leftProducts.map((product) => ({
        product,
        leftRows: left.products.get(product),
        rightRows: right.products.get(product),
      })),
    };
  },
  search_dedup(input) {
    if (!input || !Array.isArray(input.rows))
      return {
        status: "INCOMPLETE",
        reason: "SEARCH_ROWS_MISSING",
        uniqueCount: null,
        pageCountProvesCompleteness: false,
      };
    const keys = [];
    for (const row of input.rows) {
      if (
        !row ||
        typeof row.period !== "string" ||
        !row.period.trim() ||
        typeof row.product !== "string" ||
        !row.product.trim() ||
        typeof row.query !== "string" ||
        !row.query.trim()
      )
        return {
          status: "INCOMPLETE",
          reason: "SEARCH_BUSINESS_KEY_MISSING",
          uniqueCount: null,
          pageCountProvesCompleteness: false,
        };
      keys.push(JSON.stringify([row.period, row.product, row.query]));
    }
    return {
      uniqueCount: new Set(keys).size,
      pageCountProvesCompleteness: false,
    };
  },
  search_fact_boundary(input) {
    if (
      typeof input?.period !== "string" ||
      !input.period ||
      !Array.isArray(input.rows) ||
      !Array.isArray(input.aiSuggestions)
    )
      return { status: "INCOMPLETE", reason: "PERIOD_OR_ROWS_MISSING" };

    const keys = new Set();
    for (const row of input.rows) {
      if (
        !row ||
        typeof row.product !== "string" ||
        !row.product ||
        typeof row.query !== "string" ||
        !row.query
      )
        return {
          status: "INCOMPLETE",
          reason: "PROVIDER_SEARCH_FACT_IDENTITY_MISSING",
        };
      if (!Number.isInteger(row.frequency) || !Number.isInteger(row.position))
        return {
          status: "INCOMPLETE",
          reason: "PROVIDER_SEARCH_METRIC_MISSING",
        };
      const key = JSON.stringify([input.period, row.product, row.query]);
      if (keys.has(key))
        return {
          status: "INCOMPLETE",
          reason: "DUPLICATE_SEARCH_FACT_BUSINESS_KEY",
        };
      keys.add(key);
    }

    return {
      status: "COMPLETE",
      providerFactCount: input.rows.length,
      aiSuggestionCount: input.aiSuggestions.length,
      aiSuggestionsAreProviderFacts: false,
    };
  },
  search_position_boundary(input) {
    if (typeof input?.period !== "string" || !input.period)
      return { status: "INCOMPLETE", reason: "PERIOD_MISSING" };
    if (input.region !== null && input.region !== undefined)
      return { status: "INCOMPLETE", reason: "REGION_FILTER_UNSUPPORTED" };
    if (!["average", "median"].includes(input.positionKind))
      return { status: "INCOMPLETE", reason: "POSITION_DEFINITION_MISSING" };
    if (input.position === null || input.position === undefined)
      return { status: "UNKNOWN", reason: "POSITION_MISSING", position: null };
    if (!Number.isInteger(input.position) || input.position < 1)
      return { status: "INCOMPLETE", reason: "POSITION_INVALID" };

    for (const value of [input.pricePercent, input.qtyPercent]) {
      if (
        value !== null &&
        value !== undefined &&
        (typeof value !== "number" || !Number.isFinite(value))
      )
        return { status: "INCOMPLETE", reason: "BRAND_SHARE_INVALID" };
    }

    return {
      status: "COMPLETE",
      positionKind: input.positionKind,
      position: input.position,
      pricePercent: input.pricePercent ?? null,
      qtyPercent: input.qtyPercent ?? null,
      nullMeansZero: false,
    };
  },
  content_quality_boundary(input) {
    if (!Number.isInteger(input.officialErrors) || input.officialErrors < 0)
      return { status: "INCOMPLETE", reason: "OFFICIAL_ERROR_COUNT_MISSING" };
    if (
      !Number.isInteger(input.recommendedProductCount) ||
      input.recommendedProductCount < 0
    )
      return {
        status: "INCOMPLETE",
        reason: "RECOMMENDED_PRODUCT_COUNT_INVALID",
      };
    return {
      status: "BOUNDARY",
      officialErrors: input.officialErrors,
      expertQualityKnown: false,
      expertQuality: null,
      recommendationsAreQualitySignal: false,
    };
  },
  visibility_boundary(input) {
    if (
      input.stockUnits !== null &&
      (!Number.isInteger(input.stockUnits) || input.stockUnits < 0)
    )
      return { status: "INCOMPLETE", reason: "STOCK_INVALID" };
    if (
      typeof input.contentIssue !== "boolean" ||
      typeof input.blocked !== "boolean"
    )
      return { status: "INCOMPLETE", reason: "VISIBILITY_SIGNAL_INVALID" };
    return {
      status: "BOUNDARY",
      stockUnits: input.stockUnits,
      contentIssue: input.contentIssue,
      blocked: input.blocked,
      buyerVisibilityKnown: false,
      buyerVisibility: null,
      missingNotZero: true,
    };
  },
  restriction_boundary(input) {
    if (input.blockedReason !== null && typeof input.blockedReason !== "string")
      return { status: "INCOMPLETE", reason: "BLOCK_REASON_INVALID" };
    if (typeof input.warehouseKnown !== "boolean")
      return { status: "INCOMPLETE", reason: "WAREHOUSE_SIGNAL_INVALID" };
    return {
      status: "BOUNDARY",
      providerRestrictionKnown: Boolean(input.blockedReason),
      blockedReason: input.blockedReason,
      warehouseKnown: input.warehouseKnown,
      buyerDeliveryKnown: false,
      buyerDelivery: null,
    };
  },
  ad_content_join(input) {
    if (
      !Array.isArray(input.active) ||
      !Array.isArray(input.contentIssueProducts) ||
      !Array.isArray(input.blockedProducts)
    )
      return { status: "INCOMPLETE", reason: "JOIN_INPUT_MISSING" };

    const active = new Map();
    for (const row of input.active) {
      if (
        !row ||
        typeof row.product !== "string" ||
        !row.product ||
        !Array.isArray(row.campaignIds) ||
        row.campaignIds.some((id) => !Number.isInteger(id))
      )
        return { status: "INCOMPLETE", reason: "ACTIVE_PRODUCT_INVALID" };
      if (active.has(row.product))
        return { status: "INCOMPLETE", reason: "DUPLICATE_ACTIVE_PRODUCT" };
      active.set(
        row.product,
        [...row.campaignIds].sort((a, b) => a - b),
      );
    }

    const content = new Set(input.contentIssueProducts);
    const blocked = new Set(input.blockedProducts);
    const rows = [...active.entries()]
      .filter(([product]) => content.has(product) || blocked.has(product))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([product, campaignIds]) => ({
        product,
        campaignIds,
        contentIssue: content.has(product),
        blocked: blocked.has(product),
        buyerVisibilityKnown: false,
      }));
    return { status: "COMPLETE", rows };
  },
  rating_boundary(input) {
    for (const value of [input.sellerRating, input.productRating]) {
      if (
        value !== null &&
        (typeof value !== "number" || !Number.isFinite(value))
      )
        return { status: "INCOMPLETE", reason: "RATING_INVALID" };
    }
    if (
      input.measurementPenalty !== null &&
      (typeof input.measurementPenalty !== "number" ||
        !Number.isFinite(input.measurementPenalty))
    )
      return { status: "INCOMPLETE", reason: "PENALTY_INVALID" };

    return {
      status: "BOUNDARY",
      sellerRating: input.sellerRating,
      productRating: input.productRating,
      measurementPenalty: input.measurementPenalty,
      fbsErrorIndexKnown: false,
      fbsErrorIndex: null,
    };
  },
  causal_factors(input) {
    const names = [
      "content_error",
      "orders_drop",
      "stock_zero",
      "ad_click_drop",
    ];
    if (
      !input.signals ||
      typeof input.signals !== "object" ||
      names.some((name) => typeof input.signals[name] !== "boolean")
    )
      return { status: "INCOMPLETE", reason: "EVIDENCE_SIGNAL_INCOMPLETE" };

    return {
      status: "COMPLETE",
      factors: names.filter((name) => input.signals[name]).sort(),
      claim: "HYPOTHESIS_NOT_PROVEN_CAUSE",
      likelihoodKnown: false,
    };
  },
  movement_evidence(input) {
    if (
      !Number.isInteger(input.stockBeforeUnits) ||
      input.stockBeforeUnits < 0 ||
      !Number.isInteger(input.stockAfterUnits) ||
      input.stockAfterUnits < 0 ||
      !Number.isInteger(input.salesUnits) ||
      input.salesUnits < 0 ||
      !Array.isArray(input.providerEvents) ||
      input.providerEvents.some(
        (row) => !row || typeof row.family !== "string" || !row.family,
      )
    )
      return { status: "INCOMPLETE", reason: "MOVEMENT_EVIDENCE_INVALID" };

    const providerMovementEvents = input.providerEvents.filter(
      (row) => row.family === "GOODS_RETURN_MOVEMENT",
    ).length;
    return {
      status: providerMovementEvents > 0 ? "BOUNDARY" : "UNKNOWN_CAUSE",
      stockDeltaUnits: input.stockAfterUnits - input.stockBeforeUnits,
      salesUnitsObserved: input.salesUnits,
      providerMovementEvents,
      writeoffOrTransferCauseProven: false,
    };
  },
  incident_boundary(input) {
    if (
      !input.incident ||
      typeof input.incident.url !== "string" ||
      !input.incident.url ||
      typeof input.incident.date !== "string" ||
      !input.incident.date
    )
      return { status: "INCOMPLETE", reason: "PUBLIC_INCIDENT_SOURCE_MISSING" };
    if (
      !input.currentPrivate ||
      typeof input.currentPrivate.product !== "string" ||
      typeof input.currentPrivate.warehouse !== "string" ||
      !Number.isInteger(input.currentPrivate.stockUnits)
    )
      return { status: "INCOMPLETE", reason: "CURRENT_PRIVATE_FACT_MISSING" };
    return {
      status: "BOUNDARY",
      publicIncidentCited: true,
      currentPrivateFactKnown: true,
      historicalPresenceKnown: false,
      historicalPresence: null,
    };
  },
  external_fact_boundary(input) {
    if (
      !Array.isArray(input.privateFacts) ||
      !Array.isArray(input.publicFacts) ||
      !Array.isArray(input.hypotheses)
    )
      return { status: "INCOMPLETE", reason: "FACT_CLASSES_MISSING" };
    if (
      input.publicFacts.some(
        (row) => !row || typeof row.url !== "string" || !row.url,
      )
    )
      return { status: "INCOMPLETE", reason: "PUBLIC_FACT_SOURCE_MISSING" };
    return {
      status: "COMPLETE",
      privateFactCount: input.privateFacts.length,
      publicFactCount: input.publicFacts.length,
      hypothesisCount: input.hypotheses.length,
      classesSeparated: true,
    };
  },
  competitor_boundary(input) {
    if (!input.ownCard || !Array.isArray(input.competitors))
      return { status: "INCOMPLETE", reason: "COMPETITOR_CONTEXT_MISSING" };
    if (
      input.competitors.some(
        (row) =>
          row && row.privateSales !== null && row.privateSales !== undefined,
      )
    )
      return {
        status: "INCOMPLETE",
        reason: "COMPETITOR_PRIVATE_METRIC_FORBIDDEN",
      };
    const comparable = input.competitors.filter(
      (row) =>
        row &&
        row.comparable === true &&
        typeof row.url === "string" &&
        row.url &&
        typeof row.publicTitle === "string" &&
        row.publicTitle,
    );
    if (comparable.length === 0)
      return {
        status: "INCOMPLETE",
        reason: "COMPARABLE_PUBLIC_COMPETITOR_MISSING",
      };
    return {
      status: "BOUNDARY",
      comparablePublicCompetitors: comparable.length,
      privateCompetitorSalesKnown: false,
      privateCompetitorSales: null,
    };
  },
  attention_rank(input) {
    if (!Array.isArray(input.rows)) return { status: "INCOMPLETE" };
    const products = new Set();
    const ranked = [];
    for (const row of input.rows) {
      if (
        !row ||
        typeof row.product !== "string" ||
        !row.product ||
        products.has(row.product) ||
        !Array.isArray(row.signals) ||
        row.signals.some(
          (signal) =>
            !signal ||
            typeof signal.name !== "string" ||
            !signal.name ||
            typeof signal.present !== "boolean",
        )
      )
        return { status: "INCOMPLETE" };
      products.add(row.product);
      ranked.push({
        product: row.product,
        score: row.signals.filter((signal) => signal.present).length,
      });
    }
    return ranked.sort(
      (a, b) => b.score - a.score || a.product.localeCompare(b.product),
    );
  },
  causal_boundary(input) {
    return {
      claim: "HYPOTHESIS_NOT_PROVEN_CAUSE",
      factorCount: input.signals.length,
    };
  },
};

// STD-01: unknown sales rows are not proof of zero turnover or zero units.
// An explicitly complete, valid empty page collection remains a genuine zero.
const salesTotalsIncomplete = {
  status: "INCOMPLETE",
  money: null,
  units: null,
};
for (const [name, source] of [
  ["no_input", undefined],
  ["null_input", null],
  ["missing_rows", { complete: true }],
  ["null_rows", { complete: true, rows: null }],
  ["object_rows", { complete: true, rows: { length: 0 } }],
  ["text_rows", { complete: true, rows: "" }],
  ["string_completeness", { complete: "true", rows: [] }],
  ["numeric_completeness", { complete: 1, rows: [] }],
]) {
  assert.deepEqual(
    calculators.sales_totals(source),
    salesTotalsIncomplete,
    "sales_totals " + name + " must not fabricate zero sales",
  );
}
assert.deepEqual(
  calculators.sales_totals({ complete: true, rows: [] }),
  { status: "COMPLETE", money: 0, units: 0 },
  "proven complete zero-row sales period is genuine zero",
);
assert.deepEqual(
  calculators.sales_totals({
    complete: true,
    rows: [
      { money: 90.5, units: 2 },
      { money: 9.5, units: 1 },
    ],
  }),
  { status: "COMPLETE", money: 100, units: 3 },
  "valid complete sales rows preserve numeric money and units",
);

// STD-03 top-N must fail closed on an invalid N or incomplete join identity.
const validTopNCatalog = [{ id: "p", name: "Product" }];
const validTopNSales = [{ id: "p", money: 100 }];
for (const [name, input, reason] of [
  [
    "missing_n",
    { catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  [
    "null_n",
    { n: null, catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  [
    "zero_n",
    { n: 0, catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  [
    "negative_n",
    { n: -1, catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  [
    "fractional_n",
    { n: 1.5, catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  [
    "text_n",
    { n: "1", catalog: validTopNCatalog, sales: validTopNSales },
    "TOP_N_INVALID",
  ],
  ["missing_catalog", { n: 1, sales: validTopNSales }, "JOIN_INPUT_MISSING"],
  ["missing_sales", { n: 1, catalog: validTopNCatalog }, "JOIN_INPUT_MISSING"],
  [
    "null_catalog_row",
    { n: 1, catalog: [null], sales: validTopNSales },
    "SOURCE_ITEM_ID_MISSING",
  ],
  [
    "blank_sales_id",
    { n: 1, catalog: validTopNCatalog, sales: [{ id: "", money: 100 }] },
    "SOURCE_ITEM_ID_MISSING",
  ],
  [
    "null_sales_id",
    { n: 1, catalog: validTopNCatalog, sales: [{ id: null, money: 100 }] },
    "SOURCE_ITEM_ID_MISSING",
  ],
  [
    "missing_catalog_name",
    { n: 1, catalog: [{ id: "p" }], sales: validTopNSales },
    "CATALOG_NAME_MISSING",
  ],
]) {
  assert.deepEqual(
    calculators.top_n_join(input),
    { status: "INCOMPLETE", reason },
    "top_n_join " + name + " must not fabricate a complete ranking",
  );
}
assert.deepEqual(
  calculators.top_n_join({
    n: 1,
    catalog: [{ id: 0, name: "Zero" }],
    sales: [{ id: 0, money: 25 }],
  }),
  { top: [{ id: 0, name: "Zero", money: 25 }], missingCatalog: [] },
  "valid zero-valued numeric product ID remains joinable",
);

assert.deepEqual(
  calculators.warehouse_sort({
    rows: [
      { warehouse: "Ä", units: 7 },
      { warehouse: "Z", units: 7 },
    ],
  }),
  ["Z", "Ä"],
  "warehouse_sort equal-unit tie must use exact ECMAScript code-unit order",
);

// CAP24_JOIN_SOURCE_READ_PROOF_REGRESSIONS: missing or unfinished pages are
// UNKNOWN, not evidence that a product had no sales or fees in a period.
// Preserve the existing three Gold-bound cases; test proof-state failures here.
const joinProofPeriod = "2026-09-20/2026-09-26";
const joinProofRows = {
  left: [{ rowId: "S-PROOF", product: "1001", period: joinProofPeriod }],
  right: [{ rowId: "R-PROOF", product: "1001", period: joinProofPeriod }],
};
for (const [caseId, proof] of [
  ["no_source_proof", {}],
  ["left_source_incomplete", { leftComplete: false, rightComplete: true }],
  ["right_source_incomplete", { leftComplete: true, rightComplete: false }],
  ["truthy_not_boolean", { leftComplete: "true", rightComplete: true }],
]) {
  assert.deepEqual(
    calculators.cross_source_join({
      period: joinProofPeriod,
      ...joinProofRows,
      ...proof,
    }),
    { status: "INCOMPLETE", reason: "SOURCE_READ_INCOMPLETE" },
    "cross_source_join " + caseId + " must fail closed",
  );
}
assert.deepEqual(
  calculators.cross_source_join({
    period: joinProofPeriod,
    left: [],
    right: [],
    leftComplete: true,
    rightComplete: true,
  }),
  { status: "COMPLETE", rows: [] },
  "proven complete zero-row period is distinct from unknown data",
);

for (const row of numeric.cases) {
  assert.ok(
    calculators[row.kind],
    `${row.id}: unknown calculator kind ${row.kind}`,
  );
  assert.deepEqual(
    calculators[row.kind](row.input),
    row.expected,
    `${row.id}: deterministic fixture mismatch`,
  );
}

// Explicitly distinguish missing values from real observed zero.
// These are source-only checks, not real marketplace or owner acceptance.
const missingNumberCases = [
  [
    "day_rank_null",
    "daily_rank",
    {
      rows: [
        { day: "2026-09-01", money: 100 },
        { day: "2026-09-02", money: null },
      ],
    },
  ],
  [
    "day_rank_blank",
    "daily_rank",
    {
      rows: [
        { day: "2026-09-01", money: 100 },
        { day: "2026-09-02", money: "  " },
      ],
    },
  ],
  ["percent_null", "percent_change", { current: null, previous: 20 }],
  ["percent_blank", "percent_change", { current: "", previous: 20 }],
  ["percent_missing_prior", "percent_change", { current: 20 }],
  [
    "warehouse_null",
    "warehouse_sort",
    {
      rows: [
        { warehouse: "A", units: 3 },
        { warehouse: "B", units: null },
      ],
    },
  ],
  [
    "warehouse_blank",
    "warehouse_sort",
    {
      rows: [
        { warehouse: "A", units: 3 },
        { warehouse: "B", units: "" },
      ],
    },
  ],
  [
    "cover_null_stock",
    "days_cover",
    { complete: true, stock: null, demandUnits: 5, days: 7 },
  ],
  [
    "cover_blank_demand",
    "days_cover",
    { complete: true, stock: 5, demandUnits: "", days: 7 },
  ],
  [
    "cover_missing_days",
    "days_cover",
    { complete: true, stock: 5, demandUnits: 4 },
  ],
  ["drr_null_spend", "drr", { complete: true, spend: null, revenue: 100 }],
  ["drr_blank_spend", "drr", { complete: true, spend: "  ", revenue: 100 }],
];
for (const [name, kind, input] of missingNumberCases) {
  assert.equal(
    calculators[kind](input),
    null,
    name + " must not fabricate zero",
  );
}
const observedZeroCases = [
  ["real_zero_drr", "drr", { complete: true, spend: 0, revenue: 100 }, 0],
  ["real_zero_percent", "percent_change", { current: 0, previous: 100 }, -100],
  [
    "real_zero_stock",
    "days_cover",
    { complete: true, stock: 0, demandUnits: 10, days: 7 },
    0,
  ],
  [
    "numeric_string_percent",
    "percent_change",
    { current: "100", previous: "50" },
    100,
  ],
  [
    "numeric_string_drr",
    "drr",
    { complete: true, spend: "15.5", revenue: "100" },
    15.5,
  ],
];
for (const [name, kind, input, expected] of observedZeroCases) {
  assert.equal(calculators[kind](input), expected, name + " must stay valid");
}

// STD-04 SOURCE-only: require declared complete source rows, amounts, matching
// provider/store/operation/field/metric/currency, and yesterday/prior relative
// to a stated calendar reference. Declared identities do not prove real provider
// field semantics; those still require separate authoritative mapping and live
// evidence. Legacy numeric fixtures exercise arithmetic only.
const std04Proof = {
  asOf: { day: "2026-10-27", timeZone: "Europe/Moscow" },
  current: {
    day: "2026-10-26",
    complete: true,
    value: 120,
    timeZone: "Europe/Moscow",
    source: "ozon",
    storeId: "synthetic-store-one",
    operation: "analytics_data",
    field: "synthetic_revenue",
    definition: "synthetic_sales_revenue",
    metric: "money",
    unit: "RUB",
    currency: "RUB",
  },
  previous: {
    day: "2026-10-25",
    complete: true,
    value: 100,
    timeZone: "Europe/Moscow",
    source: "ozon",
    storeId: "synthetic-store-one",
    operation: "analytics_data",
    field: "synthetic_revenue",
    definition: "synthetic_sales_revenue",
    metric: "money",
    unit: "RUB",
    currency: "RUB",
  },
};
const std04Base = {
  current: 120,
  previous: 100,
  complete: true,
  proof: std04Proof,
};
const std04InvalidClaims = [
  ["missing_proof", { ...std04Base, proof: undefined }],
  ["missing_complete", { ...std04Base, complete: undefined }],
  ["false_complete", { ...std04Base, complete: false }],
  ["textual_complete", { ...std04Base, complete: "true" }],
  [
    "missing_current",
    { ...std04Base, proof: { previous: std04Proof.previous } },
  ],
  [
    "missing_previous",
    { ...std04Base, proof: { current: std04Proof.current } },
  ],
  [
    "current_incomplete",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, complete: false },
      },
    },
  ],
  [
    "previous_incomplete",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, complete: false },
      },
    },
  ],
  [
    "current_invalid_date",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, day: "2026-02-30" },
      },
    },
  ],
  [
    "previous_invalid_date",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, day: "2026-02-30" },
      },
    },
  ],
  [
    "equal_days",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, day: "2026-10-26" },
      },
    },
  ],
  [
    "reversed_days",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, day: "2026-10-27" },
      },
    },
  ],
  [
    "missing_middle_day",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, day: "2026-10-24" },
      },
    },
  ],
  [
    "timezone_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, timeZone: "UTC" },
      },
    },
  ],
  [
    "timezone_blank",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, timeZone: "  " },
      },
    },
  ],
  [
    "definition_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, definition: "orders_revenue" },
      },
    },
  ],
  [
    "definition_blank",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, definition: " " },
      },
    },
  ],
  [
    "as_of_missing",
    {
      ...std04Base,
      proof: { ...std04Proof, asOf: undefined },
    },
  ],
  [
    "as_of_wrong_day",
    {
      ...std04Base,
      proof: { ...std04Proof, asOf: { ...std04Proof.asOf, day: "2026-10-28" } },
    },
  ],
  [
    "as_of_invalid_day",
    {
      ...std04Base,
      proof: { ...std04Proof, asOf: { ...std04Proof.asOf, day: "2026-02-30" } },
    },
  ],
  [
    "as_of_invalid_zone",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        asOf: { ...std04Proof.asOf, timeZone: "Bogus/Zone" },
        current: { ...std04Proof.current, timeZone: "Bogus/Zone" },
        previous: { ...std04Proof.previous, timeZone: "Bogus/Zone" },
      },
    },
  ],
  [
    "source_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, source: "wildberries" },
      },
    },
  ],
  [
    "source_unknown",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, source: "unverified" },
        previous: { ...std04Proof.previous, source: "unverified" },
      },
    },
  ],
  [
    "store_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, storeId: "synthetic-other-store" },
      },
    },
  ],
  [
    "store_blank",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, storeId: " " },
        previous: { ...std04Proof.previous, storeId: " " },
      },
    },
  ],
  [
    "operation_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, operation: "statistics_orders" },
      },
    },
  ],
  [
    "operation_unpinned",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, operation: "unknown_alias" },
        previous: { ...std04Proof.previous, operation: "unknown_alias" },
      },
    },
  ],
  [
    "field_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, field: "different_money" },
      },
    },
  ],
  [
    "current_value_unbound",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, value: 119 },
      },
    },
  ],
  [
    "previous_value_unbound",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, value: 101 },
      },
    },
  ],
  [
    "source_value_nonfinite",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, value: Infinity },
      },
    },
  ],
  ["numeric_string_claim", { ...std04Base, current: "120" }],
  [
    "currency_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, currency: "USD" },
      },
    },
  ],
  [
    "currency_bad_format",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, currency: "RUB4", unit: "RUB4" },
        previous: { ...std04Proof.previous, currency: "RUB4", unit: "RUB4" },
      },
    },
  ],
  [
    "currency_final_line_feed",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, currency: "RUB\n", unit: "RUB\n" },
        previous: { ...std04Proof.previous, currency: "RUB\n", unit: "RUB\n" },
      },
    },
  ],
  [
    "unit_currency_disagree",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, unit: "USD" },
        previous: { ...std04Proof.previous, unit: "USD" },
      },
    },
  ],
  [
    "metric_mismatch",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        previous: { ...std04Proof.previous, metric: "units" },
      },
    },
  ],
  [
    "metric_unrecognized",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        current: { ...std04Proof.current, metric: "net_profit" },
        previous: { ...std04Proof.previous, metric: "net_profit" },
      },
    },
  ],
  [
    "timezone_invalid_whitespace",
    {
      ...std04Base,
      proof: {
        ...std04Proof,
        asOf: { ...std04Proof.asOf, timeZone: " Europe/Moscow " },
        current: { ...std04Proof.current, timeZone: " Europe/Moscow " },
        previous: { ...std04Proof.previous, timeZone: " Europe/Moscow " },
      },
    },
  ],
];
for (const [name, input] of std04InvalidClaims) {
  assert.equal(calculators.percent_change(input), null, "STD-04 " + name);
}
assert.equal(
  calculators.percent_change({
    current: Number.MAX_VALUE,
    previous: Number.MIN_VALUE,
  }),
  null,
  "STD-04 finite source values must not produce infinite percentages",
);
assert.equal(
  calculators.percent_change(std04Base),
  20,
  "STD-04 complete comparable days",
);
assert.equal(
  calculators.percent_change({
    ...std04Base,
    current: 0,
    proof: {
      ...std04Proof,
      current: { ...std04Proof.current, value: 0 },
    },
  }),
  -100,
  "STD-04 observed zero after a nonzero previous day",
);
assert.equal(
  calculators.percent_change({
    ...std04Base,
    current: 150,
    proof: {
      ...std04Proof,
      asOf: { ...std04Proof.asOf, day: "2024-03-02" },
      current: { ...std04Proof.current, day: "2024-03-01", value: 150 },
      previous: { ...std04Proof.previous, day: "2024-02-29" },
    },
  }),
  50,
  "STD-04 complete comparison over valid leap day anchored to its as-of date",
);
assert.equal(
  calculators.percent_change({
    current: 12,
    previous: 8,
    complete: true,
    proof: {
      ...std04Proof,
      current: {
        ...std04Proof.current,
        value: 12,
        metric: "units",
        unit: "count",
        currency: null,
        field: "synthetic_units",
        definition: "synthetic_ordered_units",
      },
      previous: {
        ...std04Proof.previous,
        value: 8,
        metric: "units",
        unit: "count",
        currency: null,
        field: "synthetic_units",
        definition: "synthetic_ordered_units",
      },
    },
  }),
  50,
  "STD-04 complete and matching unit-count comparison",
);

// A04 SOURCE arithmetic integrity: finite rows can overflow while summing,
// dividing or scaling. Never label a non-finite aggregate as a complete
// provider figure; 69 owner-curated numeric fixtures remain immutable.
const finiteOverflowCurrencies = {
  revenue: "RUB",
  fees: "RUB",
  storage: "RUB",
  logistics: "RUB",
  ads: "RUB",
};
const finiteOverflowCases = [
  [
    "STD-01 money_sum_overflow",
    "sales_totals",
    {
      complete: true,
      rows: [
        { money: Number.MAX_VALUE, units: 1 },
        { money: Number.MAX_VALUE, units: 2 },
      ],
    },
    { status: "INCOMPLETE", money: null, units: null },
  ],
  [
    "STD-01 units_sum_overflow",
    "sales_totals",
    {
      complete: true,
      rows: [
        { money: 1, units: Number.MAX_VALUE },
        { money: 2, units: Number.MAX_VALUE },
      ],
    },
    { status: "INCOMPLETE", money: null, units: null },
  ],
  [
    "STD-07 stock_over_tiny_demand",
    "days_cover",
    {
      complete: true,
      stock: Number.MAX_VALUE,
      demandUnits: Number.MIN_VALUE,
      days: 1,
    },
    null,
  ],
  [
    "STD-07 large_stock_and_period_true_overflow",
    "days_cover",
    {
      complete: true,
      stock: 2,
      demandUnits: 1,
      days: Number.MAX_VALUE,
    },
    null,
  ],
  [
    "ad_percentage_tiny_revenue",
    "drr",
    {
      complete: true,
      spend: Number.MAX_VALUE,
      revenue: Number.MIN_VALUE,
    },
    null,
  ],
  [
    "ad_percentage_scale_overflow",
    "drr",
    {
      complete: true,
      spend: Number.MAX_VALUE,
      revenue: 10,
    },
    null,
  ],
  [
    "ad_percentage_tiny_nonzero_spend_not_observed_zero",
    "drr",
    {
      complete: true,
      spend: Number.MIN_VALUE,
      revenue: Number.MAX_VALUE,
    },
    null,
  ],
  [
    "ad_percentage_tiny_negative_spend_not_observed_zero",
    "drr",
    {
      complete: true,
      spend: -Number.MIN_VALUE,
      revenue: Number.MAX_VALUE,
    },
    null,
  ],
  [
    "CAP-24 finite_components_sum_overflow",
    "platform_contribution",
    {
      complete: true,
      revenue: 1,
      fees: Number.MAX_VALUE,
      storage: Number.MAX_VALUE,
      logistics: 0,
      ads: 0,
      currencyByComponent: finiteOverflowCurrencies,
    },
    {
      status: "INCOMPLETE",
      label: "platform_contribution",
      amount: null,
      isNetProfit: false,
    },
  ],
];
for (const [name, kind, input, expected] of finiteOverflowCases) {
  assert.deepEqual(
    calculators[kind](input),
    expected,
    name + ": non-finite result",
  );
}
for (const [name, kind, input, expected] of [
  [
    "STD-01 finite_after_signed_cancellation",
    "sales_totals",
    {
      complete: true,
      rows: [
        { money: Number.MAX_VALUE, units: 1 },
        { money: Number.MAX_VALUE, units: 1 },
        { money: -Number.MAX_VALUE, units: 0 },
      ],
    },
    { status: "COMPLETE", money: Number.MAX_VALUE, units: 2 },
  ],
  [
    "STD-01 tiny_remainder_after_large_cancellation",
    "sales_totals",
    {
      complete: true,
      rows: [
        { money: Number.MAX_VALUE, units: 1 },
        { money: Number.MAX_VALUE, units: 1 },
        { money: -Number.MAX_VALUE, units: 0 },
        { money: -Number.MAX_VALUE, units: 0 },
        { money: 1, units: 0 },
      ],
    },
    { status: "COMPLETE", money: 1, units: 2 },
  ],
  [
    "STD-01 large_finite_total",
    "sales_totals",
    {
      complete: true,
      rows: [
        { money: Number.MAX_VALUE / 4, units: 1 },
        { money: Number.MAX_VALUE / 4, units: 1 },
      ],
    },
    { status: "COMPLETE", money: Number.MAX_VALUE / 2, units: 2 },
  ],
  [
    "STD-07 tiny_demand_cancellation_is_finite",
    "days_cover",
    {
      complete: true,
      stock: Number.MIN_VALUE,
      demandUnits: Number.MIN_VALUE,
      days: Number.MAX_VALUE,
    },
    Number.MAX_VALUE,
  ],
  [
    "STD-07 large_period_is_finite",
    "days_cover",
    {
      complete: true,
      stock: 1,
      demandUnits: 1,
      days: Number.MAX_VALUE,
    },
    Number.MAX_VALUE,
  ],
  [
    "STD-07 tiny_period_does_not_round_to_zero",
    "days_cover",
    {
      complete: true,
      stock: Number.MAX_VALUE,
      demandUnits: Number.MAX_VALUE,
      days: Number.MIN_VALUE,
    },
    Number.MIN_VALUE,
  ],
  [
    "STD-07 balanced_subnormal_demand_and_days",
    "days_cover",
    {
      complete: true,
      stock: Number.MAX_VALUE,
      demandUnits: Number.MIN_VALUE,
      days: Number.MIN_VALUE,
    },
    Number.MAX_VALUE,
  ],
  [
    "STD-07 severe_underflow_in_first_ratio",
    "days_cover",
    {
      complete: true,
      stock: Number.MIN_VALUE,
      demandUnits: Number.MAX_VALUE,
      days: Number.MAX_VALUE,
    },
    Number.MIN_VALUE,
  ],
  [
    "STD-07 tiny_vs_huge_source_range",
    "days_cover",
    {
      complete: true,
      stock: 1e-300,
      demandUnits: 1e300,
      days: 1e300,
    },
    1e-300,
  ],
  [
    "STD-07 product_before_quotient_cancellation",
    "days_cover",
    {
      complete: true,
      stock: Number.MAX_VALUE,
      demandUnits: 0.125,
      days: Number.MIN_VALUE,
    },
    Number.MAX_VALUE * Number.MIN_VALUE * 8,
  ],
  [
    "STD-07 zero_stock_observed",
    "days_cover",
    { complete: true, stock: 0, demandUnits: 2, days: 7 },
    0,
  ],
  [
    "ad_percentage_tiny_nonzero_is_representable",
    "drr",
    { complete: true, spend: Number.MIN_VALUE, revenue: 10 },
    Number.MIN_VALUE * 10,
  ],
  [
    "ad_percentage_zero_spend_observed",
    "drr",
    { complete: true, spend: 0, revenue: 10 },
    0,
  ],
  [
    "CAP-24 finite_component_cancellation_without_intermediate_overflow",
    "platform_contribution",
    {
      complete: true,
      revenue: Number.MAX_VALUE,
      fees: Number.MAX_VALUE,
      storage: Number.MAX_VALUE,
      logistics: 0,
      ads: 0,
      currencyByComponent: finiteOverflowCurrencies,
    },
    {
      status: "COMPLETE",
      label: "platform_contribution",
      amount: -Number.MAX_VALUE,
      isNetProfit: false,
    },
  ],
  [
    "CAP-24 finite_negative_contribution",
    "platform_contribution",
    {
      complete: true,
      revenue: 1000,
      fees: 1100,
      storage: 0,
      logistics: 0,
      ads: 0,
      currencyByComponent: finiteOverflowCurrencies,
    },
    {
      status: "COMPLETE",
      label: "platform_contribution",
      amount: -100,
      isNetProfit: false,
    },
  ],
]) {
  assert.deepEqual(
    calculators[kind](input),
    expected,
    name + ": finite control",
  );
}

// CAP-25 business identity guards supplement the immutable owner-curated
// gold/numeric fixture case list rather than changing its accepted bindings.
const searchKeyIntegrityCases = [
  [
    "search_dedup_distinct_delimiter_tuples",
    "search_dedup",
    {
      rows: [
        { period: "2026-08", product: "1001\u0000sub", query: "dress" },
        { period: "2026-08", product: "1001", query: "sub\u0000dress" },
      ],
      pageCount: 2,
    },
    { uniqueCount: 2, pageCountProvesCompleteness: false },
  ],
  [
    "search_fact_distinct_delimiter_tuples",
    "search_fact_boundary",
    {
      period: "2026-08",
      rows: [
        {
          product: "1001\u0000sub",
          query: "dress",
          frequency: 10,
          position: 5,
        },
        {
          product: "1001",
          query: "sub\u0000dress",
          frequency: 10,
          position: 5,
        },
      ],
      aiSuggestions: [],
    },
    {
      status: "COMPLETE",
      providerFactCount: 2,
      aiSuggestionCount: 0,
      aiSuggestionsAreProviderFacts: false,
    },
  ],
  [
    "search_fact_null_input",
    "search_fact_boundary",
    null,
    { status: "INCOMPLETE", reason: "PERIOD_OR_ROWS_MISSING" },
  ],
  [
    "search_position_null_input",
    "search_position_boundary",
    null,
    { status: "INCOMPLETE", reason: "PERIOD_MISSING" },
  ],
];
for (const [name, kind, input, expected] of searchKeyIntegrityCases) {
  assert.deepEqual(
    calculators[kind](input),
    expected,
    name + ": integrity drift",
  );
}

// STD-02 SOURCE only: missing, repeated, or impossible calendar dates must
// never be silently ranked as complete observations of an announced period.
const rank14 = Array.from({ length: 14 }, (_, i) => ({
  day: "2026-09-" + String(i + 1).padStart(2, "0"),
  money: i * 10,
}));
const rankPeriod = { start: "2026-09-01", end: "2026-09-14" };
for (const [name, input] of [
  [
    "duplicate",
    {
      rows: [
        { day: "2026-09-01", money: 10 },
        { day: "2026-09-01", money: 20 },
      ],
    },
  ],
  ["impossible_day", { rows: [{ day: "2026-02-30", money: 10 }] }],
  ["non_iso_day", { rows: [{ day: "2026-9-01", money: 10 }] }],
  ["blank_day", { rows: [{ day: " ", money: 10 }] }],
  ["empty", { rows: [] }],
  ["incomplete", { complete: false, period: rankPeriod, rows: rank14 }],
  [
    "string_completeness",
    { complete: "true", period: rankPeriod, rows: rank14 },
  ],
  ["no_completeness", { period: rankPeriod, rows: rank14 }],
  ["no_period", { complete: true, rows: rank14 }],
  [
    "complete_two_day_period",
    {
      complete: true,
      period: { start: "2026-09-01", end: "2026-09-02" },
      rows: rank14.slice(0, 2),
    },
  ],
  [
    "complete_fifteen_day_period",
    {
      complete: true,
      period: { start: "2026-09-01", end: "2026-09-15" },
      rows: [...rank14, { day: "2026-09-15", money: 140 }],
    },
  ],
  [
    "missing_middle_day",
    { complete: true, period: rankPeriod, rows: rank14.slice(1) },
  ],
  [
    "foreign_day",
    {
      complete: true,
      period: rankPeriod,
      rows: [...rank14.slice(0, 13), { day: "2026-09-15", money: 140 }],
    },
  ],
  [
    "reversed_bounds",
    {
      complete: true,
      period: { start: "2026-09-14", end: "2026-09-01" },
      rows: rank14,
    },
  ],
]) {
  assert.equal(calculators.daily_rank(input), null, "STD-02 " + name);
}
assert.deepEqual(
  calculators.daily_rank({ complete: true, period: rankPeriod, rows: rank14 }),
  {
    best: ["2026-09-14", "2026-09-13", "2026-09-12"],
    worst: ["2026-09-01", "2026-09-02", "2026-09-03"],
  },
  "STD-02 14 days explicitly complete",
);
assert.deepEqual(
  calculators.daily_rank({
    rows: [
      { day: "2024-02-29", money: 0 },
      { day: "2024-03-01", money: 1 },
    ],
  }),
  { best: ["2024-03-01", "2024-02-29"], worst: ["2024-02-29", "2024-03-01"] },
  "valid leap day and genuine zero",
);

const requiredKinds = new Set([
  "sales_totals",
  "daily_rank",
  "percent_change",
  "warehouse_sort",
  "days_cover",
  "drr",
  "platform_contribution",
  "top_n_join",
  "join_unique",
  "cross_source_join",
  "search_dedup",
  "search_fact_boundary",
  "search_position_boundary",
  "content_quality_boundary",
  "visibility_boundary",
  "restriction_boundary",
  "ad_content_join",
  "rating_boundary",
  "causal_factors",
  "movement_evidence",
  "incident_boundary",
  "external_fact_boundary",
  "competitor_boundary",
  "attention_rank",
  "causal_boundary",
]);
assert.deepEqual(
  new Set(numeric.cases.map((row) => row.kind)),
  requiredKinds,
  "numeric rule coverage drift",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenarioRows: mappedIds.length,
    ozonOperationRefs,
    wbOperationRefs,
    wbHosts: [...wbHosts].sort(),
    numericCases: numeric.cases.length,
    semanticProjectionSha256: coverage.readiness.semanticProjectionSha256,
    ozonRegistrySha256: coverage.authorities.ozon.registrySha256,
    wbRegistrySha256: coverage.authorities.wildberries.registrySha256,
    wbEffectiveOperationCount: Object.keys(wb.OPERATIONS).length,
  }),
);
