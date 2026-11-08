import { bridgeFbsStock } from "./cap19-wb-fbs-stock-bridge-v1.mjs";

export const VERSION = "cap19_wb_statistics_fbs_pair_v1";
const MEASURE = "PRODUCT_ATTRIBUTED_STATISTICS_NOT_ACTUAL_COST";
const COMPARISON = "PERIOD_STATS_WITH_END_SNAPSHOT_NOT_HISTORICAL_STOCK";
// The qualified producer admits <=1000 statistics rows of <=9999999999.99 each.
const MAX_CENTS = 1000n * 999999999999n;
class Incomplete extends Error {}
const fail = (reason) => { throw new Incomplete(reason); };
function keys(value, names) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("|") !== [...names].sort().join("|")) fail("INVALID_SHAPE");
}
function array(value, max = 1000, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail("ARRAY_BOUNDARY_INVALID");
  return value;
}
function id(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("IDENTIFIER_INVALID");
  return value;
}
function ids(value, max = 1000, min = 0) {
  const result = array(value, max, min).map(id);
  if (new Set(result).size !== result.length) fail("IDENTIFIER_DUPLICATE");
  return result.sort((a, b) => a - b);
}
function sameIds(a, b, reason) {
  const x = [...a].sort((u, v) => u - v), y = [...b].sort((u, v) => u - v);
  if (x.length !== y.length || x.some((v, i) => v !== y[i])) fail(reason);
}
function stamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(value)) fail("INVALID_TIME");
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms + 10800000).toISOString().slice(0, 19) + "+03:00" !== value) fail("INVALID_TIME");
  return ms;
}
function cents(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,12})\.\d{2}$/.test(value)) fail("INVALID_MONEY");
  const result = BigInt(value.replace(".", ""));
  if (result > MAX_CENTS) fail("STATISTICS_AMOUNT_OUT_OF_RANGE");
  return result;
}
function add(a, b) {
  const result = a + b;
  if (result > MAX_CENTS) fail("STATISTICS_AMOUNT_OUT_OF_RANGE");
  return result;
}
const money = (value) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

/** Synthetic JSON-shaped normalized statistics + FBS input; no provider/capture attestation. */
export function composeStatisticsFbs(input) {
  try {
    keys(input, ["schemaVersion", "synthetic", "marketplace", "selection", "statistics", "fbs"]);
    if (input.schemaVersion !== VERSION || input.synthetic !== true || input.marketplace !== "WILDBERRIES")
      fail("SYNTHETIC_WB_SCOPE_REQUIRED");
    keys(input.selection, ["sellerWarehouseIds", "products"]);
    const warehouseIds = ids(input.selection.sellerWarehouseIds, 100, 1);
    const selected = new Map(), sizeOwners = new Set();
    for (const row of array(input.selection.products, 1000, 1)) {
      keys(row, ["nmId", "chrtIds"]);
      const nmId = id(row.nmId), sizes = ids(row.chrtIds, 1000, 1);
      if (selected.has(nmId)) fail("SELECTION_PRODUCT_DUPLICATE");
      selected.set(nmId, sizes);
      for (const size of sizes) {
        if (sizeOwners.has(size)) fail("SELECTION_SIZE_AMBIGUOUS");
        sizeOwners.add(size);
        if (sizeOwners.size > 1000 || sizeOwners.size * warehouseIds.length > 10000) fail("SELECTION_TOO_LARGE");
      }
    }

    const stats = input.statistics;
    keys(stats, ["sourceSchemaVersion", "complete", "context", "measure", "currency", "total", "campaignTotals", "products"]);
    if (stats.sourceSchemaVersion !== "cap19_wb_paired_data_v1") fail("STATISTICS_SCHEMA_MISMATCH");
    if (stats.complete !== true) fail("STATISTICS_INCOMPLETE");
    if (stats.measure !== MEASURE) fail("STATISTICS_MEASURE_MISMATCH");
    const context = stats.context;
    keys(context, ["period", "timezone", "currency", "membershipAsOf", "comparison"]);
    keys(context.period, ["start", "endExclusive"]);
    if (context.timezone !== "Europe/Moscow" || context.comparison !== COMPARISON) fail("STATISTICS_CONTEXT_MISMATCH");
    if (context.currency !== "RUB" || stats.currency !== context.currency) fail("CURRENCY_MISMATCH");
    const start = stamp(context.period.start), end = stamp(context.period.endExclusive);
    if (context.period.start.slice(10) !== "T00:00:00+03:00" || context.period.endExclusive.slice(10) !== "T00:00:00+03:00")
      fail("DAILY_PERIOD_BOUNDARY_UNALIGNED");
    if (end <= start || end - start > 31 * 86400000) fail("INVALID_PERIOD");
    if (context.membershipAsOf !== context.period.endExclusive) fail("MEMBERSHIP_SNAPSHOT_MISMATCH");

    const declaredCampaigns = new Map();
    for (const row of array(stats.campaignTotals, 1000, 1)) {
      keys(row, ["advertId", "currency", "amount"]);
      const advertId = id(row.advertId);
      if (declaredCampaigns.has(advertId)) fail("STATISTICS_CAMPAIGN_DUPLICATE");
      if (row.currency !== context.currency) fail("CURRENCY_MISMATCH");
      declaredCampaigns.set(advertId, cents(row.amount));
    }
    const products = new Map(), campaignSums = new Map();
    let total = 0n, componentCount = 0;
    for (const row of array(stats.products, 1000, 1)) {
      keys(row, ["nmId", "statisticsSpend", "statisticsComponents", "activeCampaignIds"]);
      const nmId = id(row.nmId);
      if (products.has(nmId)) fail("STATISTICS_PRODUCT_DUPLICATE");
      const components = new Map();
      let productTotal = 0n;
      for (const component of array(row.statisticsComponents, 1000, 1)) {
        keys(component, ["advertId", "amount"]);
        const advertId = id(component.advertId), amount = cents(component.amount);
        if (!declaredCampaigns.has(advertId)) fail("STATISTICS_CAMPAIGN_UNDECLARED");
        if (components.has(advertId)) fail("STATISTICS_COMPONENT_DUPLICATE");
        components.set(advertId, amount);
        if (++componentCount > 1000) fail("STATISTICS_COMPONENT_BOUNDARY");
        productTotal = add(productTotal, amount);
        campaignSums.set(advertId, add(campaignSums.get(advertId) ?? 0n, amount));
      }
      if (cents(row.statisticsSpend) !== productTotal) fail("STATISTICS_PRODUCT_TOTAL_MISMATCH");
      const active = ids(row.activeCampaignIds);
      if (active.some((x) => !components.has(x))) fail("ACTIVE_CAMPAIGN_NOT_IN_PRODUCT_STATISTICS");
      total = add(total, productTotal);
      products.set(nmId, { amount: productTotal, components, active });
    }
    sameIds(selected.keys(), products.keys(), "STATISTICS_PRODUCT_SET_MISMATCH");
    sameIds(declaredCampaigns.keys(), campaignSums.keys(), "STATISTICS_CAMPAIGN_COVERAGE_MISMATCH");
    for (const [advertId, amount] of declaredCampaigns) {
      if (campaignSums.get(advertId) !== amount) fail("STATISTICS_CAMPAIGN_TOTAL_MISMATCH");
    }
    if (cents(stats.total) !== total) fail("STATISTICS_TOTAL_MISMATCH");

    const fbs = bridgeFbsStock(input.fbs);
    if (fbs.status !== "FBS_STOCK_IDENTITY_SYNTHETIC_VALID") fail(`FBS_${fbs.reason}`);
    if (fbs.context.stockAsOf !== context.period.endExclusive) fail("FBS_END_SNAPSHOT_MISMATCH");
    sameIds(warehouseIds, fbs.stockScope.sellerWarehouseIds, "FBS_WAREHOUSE_SELECTION_MISMATCH");
    const fbsSelection = new Map(fbs.stockScope.products.map((p) => [p.nmId, p.chrtIds]));
    sameIds(selected.keys(), fbsSelection.keys(), "FBS_PRODUCT_SELECTION_MISMATCH");
    for (const [nmId, sizes] of selected) sameIds(sizes, fbsSelection.get(nmId), "FBS_SIZE_SELECTION_MISMATCH");
    const fbsProducts = new Map(fbs.products.map((p) => [p.nmId, p]));
    const outputProducts = [...selected.keys()].sort((a, b) => a - b).map((nmId) => {
      const s = products.get(nmId), f = fbsProducts.get(nmId);
      return {
        nmId, activeCampaignIds: [...s.active], statisticsSpend: money(s.amount),
        statisticsComponents: [...s.components].sort(([a], [b]) => a - b).map(([advertId, amount]) => ({ advertId, amount: money(amount) })),
        onHandUnits: f.onHandUnits, outOfStockInSelection: f.outOfStockInSelection,
        lowStock: null, stockRows: f.stockRows,
      };
    });
    return {
      status: "STATISTICS_FBS_SYNTHETIC_PAIR_VALID", schemaVersion: VERSION,
      synthetic: true, marketplace: "WILDBERRIES",
      context: { period: { ...context.period }, timezone: context.timezone, currency: context.currency,
        membershipAsOf: context.membershipAsOf, stockAsOf: fbs.context.stockAsOf, comparison: COMPARISON },
      statistics: { measure: MEASURE, currency: context.currency, total: money(total),
        campaignTotals: [...declaredCampaigns].sort(([a], [b]) => a - b).map(([advertId, amount]) => ({ advertId, currency: context.currency, amount: money(amount) })) },
      stockScope: fbs.stockScope, products: outputProducts, stockTotals: { ...fbs.totals },
      actualCostStock: { status: "INCOMPLETE", reason: "CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED",
        currency: null, productCost: null, warehouseCost: null },
    };
  } catch (error) {
    if (error instanceof Incomplete) return { status: "INCOMPLETE", reason: error.message };
    throw error;
  }
}
