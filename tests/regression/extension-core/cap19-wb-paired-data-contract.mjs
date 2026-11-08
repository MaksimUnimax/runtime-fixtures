import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERSION = "cap19_wb_paired_data_v1";
const MAX_ROWS = 1000;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const id = (x) => Number.isSafeInteger(x) && x > 0;
const units = (x) => Number.isSafeInteger(x) && x >= 0;
const fail = (reason) => { throw new Error(reason); };
function keys(x, required) {
  if (!object(x) || Object.keys(x).sort().join("|") !== [...required].sort().join("|"))
    fail("INVALID_SHAPE");
}
function rows(x) {
  if (!Array.isArray(x) || x.length > MAX_ROWS) fail("INVALID_ROW_COUNT");
  return x;
}
function unique(values, reason) {
  if (new Set(values).size !== values.length) fail(reason);
}
function cents(x) {
  // Normalized synthetic money uses exact decimal strings, never binary floats.
  if (typeof x !== "string" || !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(x))
    fail("INVALID_MONEY");
  return BigInt(x.replace(".", ""));
}
function money(x) {
  return `${x / 100n}.${String(x % 100n).padStart(2, "0")}`;
}
function stamp(x) {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(x))
    fail("INVALID_TIME");
  const value = Date.parse(x);
  if (!Number.isFinite(value) || new Date(value + 3 * 3600000).toISOString().slice(0, 19) !== x.slice(0, 19))
    fail("INVALID_TIME");
  return value;
}
function sameIds(a, b, reason) {
  if (JSON.stringify([...a].sort((x, y) => x - y)) !== JSON.stringify([...b].sort((x, y) => x - y)))
    fail(reason);
}

/** Pure technical projection. This v1 accepts synthetic inputs only, not live exports. */
export function projectPair(input) {
  try {
    keys(input, ["schemaVersion", "synthetic", "marketplace", "context", "campaigns", "statistics", "stock", "actualCostHistory"]);
    if (input.schemaVersion !== VERSION || input.synthetic !== true || input.marketplace !== "WILDBERRIES")
      fail("UNSUPPORTED_INPUT_SCOPE");
    const c = input.context;
    keys(c, ["period", "timezone", "currency", "stockAsOf", "membershipAsOf", "comparison"]);
    keys(c.period, ["start", "endExclusive"]);
    if (c.timezone !== "Europe/Moscow" || c.currency !== "RUB" || c.comparison !== "PERIOD_STATS_WITH_END_SNAPSHOT_NOT_HISTORICAL_STOCK")
      fail("UNSUPPORTED_CONTEXT");
    const start = stamp(c.period.start), end = stamp(c.period.endExclusive);
    // A daily row establishes the whole Moscow day, not an arbitrary interval
    // containing its midnight. No sub-day attribution or prorating is supported.
    if (c.period.start.slice(10) !== "T00:00:00+03:00" || c.period.endExclusive.slice(10) !== "T00:00:00+03:00")
      fail("DAILY_PERIOD_BOUNDARY_UNALIGNED");
    if (end <= start || end - start > 31 * 86400000) fail("INVALID_PERIOD");
    if (c.stockAsOf !== c.period.endExclusive || c.membershipAsOf !== c.stockAsOf)
      fail("SNAPSHOT_CONTEXT_MISMATCH");

    keys(input.campaigns, ["complete", "rows"]);
    keys(input.statistics, ["complete", "measure", "campaignTotals", "rows"]);
    keys(input.stock, ["complete", "scheme", "selection", "rows"]);
    if (input.campaigns.complete !== true || input.statistics.complete !== true || input.stock.complete !== true)
      fail("SOURCE_READ_INCOMPLETE");
    if (input.statistics.measure !== "PRODUCT_ATTRIBUTED_STATISTICS_NOT_ACTUAL_COST")
      fail("SPEND_MEASURE_MISMATCH");
    if (input.stock.scheme !== "WB_WAREHOUSE_ON_HAND") fail("STOCK_SCHEME_MISMATCH");

    const campaigns = new Map();
    const productIds = new Set();
    for (const row of rows(input.campaigns.rows)) {
      keys(row, ["advertId", "status", "currency", "nmIds"]);
      if (!id(row.advertId) || ![7, 9, 11].includes(row.status)) fail("CAMPAIGN_ROW_INVALID");
      if (campaigns.has(row.advertId)) fail("DUPLICATE_CAMPAIGN");
      if (row.currency !== c.currency) fail("CURRENCY_MISMATCH");
      if (rows(row.nmIds).length === 0 || row.nmIds.some((x) => !id(x))) fail("PRODUCT_ID_INVALID");
      unique(row.nmIds, "DUPLICATE_CAMPAIGN_MEMBERSHIP");
      campaigns.set(row.advertId, row);
      row.nmIds.forEach((x) => productIds.add(x));
    }
    if (campaigns.size === 0) fail("EMPTY_SELECTION");

    const declaredTotals = new Map();
    for (const row of rows(input.statistics.campaignTotals)) {
      keys(row, ["advertId", "currency", "amount"]);
      if (!campaigns.has(row.advertId) || declaredTotals.has(row.advertId)) fail("STATISTICS_CAMPAIGN_INVALID");
      if (row.currency !== c.currency) fail("CURRENCY_MISMATCH");
      declaredTotals.set(row.advertId, cents(row.amount));
    }
    sameIds(campaigns.keys(), declaredTotals.keys(), "STATISTICS_CAMPAIGN_COVERAGE_INCOMPLETE");
    const seenStats = new Set(), seenMembership = new Set(), totals = new Map(), byProduct = new Map();
    for (const row of rows(input.statistics.rows)) {
      keys(row, ["advertId", "day", "appType", "nmId", "amount"]);
      const campaign = campaigns.get(row.advertId);
      if (!campaign || !id(row.nmId) || !campaign.nmIds.includes(row.nmId) || ![1, 32, 64].includes(row.appType))
        fail("STATISTICS_IDENTITY_INVALID");
      if (typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) fail("INVALID_STATISTICS_DAY");
      const day = stamp(`${row.day}T00:00:00+03:00`);
      if (day < start || day >= end) fail("STATISTICS_PERIOD_MISMATCH");
      const grain = `${row.advertId}|${row.day}|${row.appType}|${row.nmId}`;
      if (seenStats.has(grain)) fail("DUPLICATE_STATISTICS_GRAIN");
      seenStats.add(grain);
      seenMembership.add(`${row.advertId}|${row.nmId}`);
      const amount = cents(row.amount);
      totals.set(row.advertId, (totals.get(row.advertId) ?? 0n) + amount);
      const components = byProduct.get(row.nmId) ?? new Map();
      components.set(row.advertId, (components.get(row.advertId) ?? 0n) + amount);
      byProduct.set(row.nmId, components);
    }
    for (const [advertId, campaign] of campaigns) {
      for (const nmId of campaign.nmIds)
        if (!seenMembership.has(`${advertId}|${nmId}`)) fail("STATISTICS_PRODUCT_COVERAGE_INCOMPLETE");
      if (totals.get(advertId) !== declaredTotals.get(advertId)) fail("STATISTICS_TOTAL_MISMATCH");
    }

    keys(input.stock.selection, ["warehouseIds", "products"]);
    const warehouses = rows(input.stock.selection.warehouseIds);
    if (warehouses.length === 0 || warehouses.some((x) => !id(x))) fail("WAREHOUSE_ID_INVALID");
    unique(warehouses, "DUPLICATE_WAREHOUSE_SELECTION");
    const selected = new Map(), sizeOwners = new Map(), stockKeys = new Set();
    for (const row of rows(input.stock.selection.products)) {
      keys(row, ["nmId", "chrtIds"]);
      if (!id(row.nmId) || selected.has(row.nmId) || rows(row.chrtIds).length === 0 || row.chrtIds.some((x) => !id(x)))
        fail("STOCK_SELECTION_INVALID");
      unique(row.chrtIds, "DUPLICATE_SIZE_SELECTION");
      selected.set(row.nmId, row.chrtIds);
      for (const size of row.chrtIds) {
        if (sizeOwners.has(size)) fail("SIZE_PRODUCT_IDENTITY_CONFLICT");
        sizeOwners.set(size, row.nmId);
        for (const wh of warehouses) {
          stockKeys.add(`${row.nmId}|${size}|${wh}`);
          if (stockKeys.size > MAX_ROWS) fail("INVALID_ROW_COUNT");
        }
      }
    }
    sameIds(productIds, selected.keys(), "STOCK_PRODUCT_SET_MISMATCH");
    const seenStock = new Set(), stockByProduct = new Map();
    for (const row of rows(input.stock.rows)) {
      keys(row, ["nmId", "chrtId", "warehouseId", "quantity", "inWayToClient", "inWayFromClient"]);
      if (![row.nmId, row.chrtId, row.warehouseId].every(id) || ![row.quantity, row.inWayToClient, row.inWayFromClient].every(units))
        fail("STOCK_ROW_INVALID");
      const grain = `${row.nmId}|${row.chrtId}|${row.warehouseId}`;
      if (!stockKeys.has(grain)) fail("STOCK_IDENTITY_OUTSIDE_SELECTION");
      if (seenStock.has(grain)) fail("DUPLICATE_STOCK_GRAIN");
      seenStock.add(grain);
      const list = stockByProduct.get(row.nmId) ?? [];
      list.push({ ...row });
      stockByProduct.set(row.nmId, list);
    }
    if (stockKeys.size !== seenStock.size) fail("STOCK_SELECTION_INCOMPLETE");

    // Source promo_spend_history has no product ID or proven currency binding.
    keys(input.actualCostHistory, ["complete", "currency", "rows"]);
    if (input.actualCostHistory.currency !== null) fail("ACTUAL_COST_CURRENCY_BINDING_UNPROVED");
    const refs = new Set();
    for (const row of rows(input.actualCostHistory.rows)) {
      keys(row, ["sourceRowRef", "advertId", "updSum"]);
      if (typeof row.sourceRowRef !== "string" || !/^SYNTHETIC-[A-Z0-9-]{1,64}$/.test(row.sourceRowRef) || !campaigns.has(row.advertId))
        fail("ACTUAL_COST_ROW_INVALID");
      if (refs.has(row.sourceRowRef)) fail("DUPLICATE_ACTUAL_COST_SOURCE_ROW");
      refs.add(row.sourceRowRef);
      cents(row.updSum);
    }
    if (typeof input.actualCostHistory.complete !== "boolean") fail("ACTUAL_COST_COMPLETENESS_INVALID");

    const products = [...productIds].sort((a, b) => a - b).map((nmId) => {
      const stockRows = stockByProduct.get(nmId).sort((a, b) => a.chrtId - b.chrtId || a.warehouseId - b.warehouseId);
      const onHandUnits = stockRows.reduce((sum, row) => sum + row.quantity, 0);
      if (!Number.isSafeInteger(onHandUnits)) fail("STOCK_TOTAL_OUT_OF_RANGE");
      const components = [...byProduct.get(nmId)].sort((a, b) => a[0] - b[0]);
      return {
        nmId,
        activeCampaignIds: [...campaigns.values()].filter((x) => x.status === 9 && x.nmIds.includes(nmId)).map((x) => x.advertId).sort((a, b) => a - b),
        statisticsSpend: money(components.reduce((sum, x) => sum + x[1], 0n)),
        statisticsComponents: components.map(([advertId, amount]) => ({ advertId, amount: money(amount) })),
        onHandUnits,
        outOfStockInSelection: onHandUnits === 0,
        lowStock: null,
        stockRows,
      };
    });
    return {
      status: "STATISTICS_STOCK_SYNTHETIC_PAIR_VALID",
      schemaVersion: VERSION,
      context: structuredClone(c),
      stockScope: { scheme: input.stock.scheme, selection: structuredClone(input.stock.selection), complete: true },
      statistics: { measure: input.statistics.measure, currency: c.currency, total: money([...totals.values()].reduce((a, b) => a + b, 0n)) },
      products,
      actualCostStock: { status: "INCOMPLETE", reason: "CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED", sourceComplete: input.actualCostHistory.complete, currency: null, productCost: null, warehouseCost: null, sourceRows: structuredClone(input.actualCostHistory.rows) },
    };
  } catch (error) {
    return { status: "INCOMPLETE", reason: error.message };
  }
}

export function validateSources(root, manifest) {
  for (const source of manifest.sourcePins) {
    const bytes = fs.readFileSync(path.join(root, source.path));
    if (bytes.length !== source.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== source.sha256)
      throw new Error(`SOURCE_PIN_MISMATCH: ${source.path}`);
  }
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  const root = path.resolve(path.dirname(here), "../../..");
  const read = (name) => JSON.parse(fs.readFileSync(path.join(path.dirname(here), "fixtures", name), "utf8"));
  const manifest = read("cap19-wb-paired-data-manifest-v1.json");
  const fixture = read("cap19-wb-paired-data-fixture-v1.json");
  validateSources(root, manifest);
  const result = projectPair(fixture.input);
  if (JSON.stringify(result) !== JSON.stringify(fixture.authorExpected)) throw new Error("AUTHOR_ORACLE_MISMATCH");
  console.log(JSON.stringify({ status: result.status, products: result.products.length, statisticsTotal: result.statistics.total, actualCostStock: result.actualCostStock.reason, independentExpectedTable: "PENDING_REVIEW" }));
}
