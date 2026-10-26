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

const calculators = {
  sales_totals(input) {
    const rows = Array.isArray(input.rows) ? input.rows : [];
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
    if (!input.complete || invalid)
      return { status: "INCOMPLETE", money: null, units: null };
    return {
      status: "COMPLETE",
      money: rows.reduce((sum, row) => sum + row.money, 0),
      units: rows.reduce((sum, row) => sum + row.units, 0),
    };
  },
  daily_rank(input) {
    if (
      !Array.isArray(input?.rows) ||
      input.rows.some(
        (row) =>
          !row ||
          typeof row.day !== "string" ||
          !row.day ||
          finiteRecordedMetric(row.money) === null,
      )
    )
      return null;
    const rows = input.rows.map((row) => ({
      ...row,
      money: finiteRecordedMetric(row.money),
    }));
    const best = [...rows]
      .sort((a, b) => b.money - a.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((row) => row.day);
    const worst = [...rows]
      .sort((a, b) => a.money - b.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((row) => row.day);
    return { best, worst };
  },
  percent_change(input) {
    const current = finiteRecordedMetric(input?.current),
      previous = finiteRecordedMetric(input?.previous);
    if (current === null || previous === null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
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
    return stock / (demand / days);
  },
  drr(input) {
    if (input?.complete !== true) return null;
    const spend = finiteRecordedMetric(input.spend),
      revenue = finiteRecordedMetric(input.revenue);
    if (spend === null || revenue === null || revenue <= 0) return null;
    return (spend / revenue) * 100;
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

    const values = raw;
    return {
      status: "COMPLETE",
      label: "platform_contribution",
      amount:
        values[0] - values.slice(1).reduce((sum, value) => sum + value, 0),
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
