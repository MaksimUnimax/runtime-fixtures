// Pure, synthetic-only CAP19 input bridge. No provider calls or money allocation.
const VERSION = "cap19_wb_fbs_stock_bridge_v1";
const SCHEME = "WB_SELLER_WAREHOUSE_FBS";
class Incomplete extends Error {}
const fail = (reason) => { throw new Incomplete(reason); };
const object = (v) => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail("INVALID_SHAPE");
  return v;
};
const array = (v, max, min = 0) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail("ARRAY_BOUNDARY_INVALID");
  return v;
};
const id = (v) => {
  if (!Number.isSafeInteger(v) || v < 1) fail("IDENTIFIER_INVALID");
  return v;
};
const quantity = (v) => {
  if (!Number.isSafeInteger(v) || v < 0) fail("QUANTITY_INVALID");
  return v;
};
const add = (a, b) => {
  if (!Number.isSafeInteger(a + b)) fail("STOCK_SUM_UNSAFE");
  return a + b;
};
const uniqueIds = (values, max) => {
  const ids = array(values, max, 1).map(id);
  if (new Set(ids).size !== ids.length) fail("IDENTIFIER_DUPLICATE");
  return ids;
};
const stamp = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(v))
    fail("SNAPSHOT_INVALID");
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || new Date(ms + 10800000).toISOString().slice(0, 19) + "+03:00" !== v)
    fail("SNAPSHOT_INVALID");
  return v;
};
const ascending = (a, b) => a - b;

export function bridgeFbsStock(input) {
  try {
    object(input);
    if (input.schemaVersion !== VERSION || input.synthetic !== true || input.marketplace !== "WB")
      fail("SYNTHETIC_WB_SCOPE_REQUIRED");
    const context = object(input.context);
    if (context.timezone !== "Europe/Moscow") fail("TIMEZONE_MISMATCH");
    const asOf = stamp(context.stockAsOf);
    const selection = object(input.selection);
    const warehouseIds = uniqueIds(selection.sellerWarehouseIds, 100).sort(ascending);
    const selectedProducts = array(selection.products, 1000, 1);
    const products = new Map();
    const selectedSizes = new Map();
    for (const product of selectedProducts) {
      object(product);
      const nmId = id(product.nmId);
      if (products.has(nmId)) fail("SELECTED_PRODUCT_DUPLICATE");
      const sizes = uniqueIds(product.chrtIds, 1000).sort(ascending);
      for (const chrtId of sizes) {
        if (selectedSizes.has(chrtId)) fail("SELECTED_SIZE_AMBIGUOUS");
        selectedSizes.set(chrtId, nmId);
        if (selectedSizes.size > 1000) fail("SELECTION_TOO_LARGE");
      }
      products.set(nmId, sizes);
    }
    if (selectedSizes.size > 1000 || selectedSizes.size * warehouseIds.length > 10000)
      fail("SELECTION_TOO_LARGE");

    const catalog = object(input.catalog);
    const warehouses = object(input.warehouses);
    const stock = object(input.stock);
    if (stock.scheme !== SCHEME) fail("FBS_SCHEME_REQUIRED");
    for (const source of [catalog, warehouses, stock]) {
      if (source.complete !== true) fail("SOURCE_INCOMPLETE");
      if (stamp(source.asOf) !== asOf) fail("SNAPSHOT_MISMATCH");
    }
    const cardProducts = new Set();
    const cardSizes = new Map();
    for (const card of array(catalog.cards, 1000)) {
      object(card);
      const nmId = id(card.nmID);
      if (cardProducts.has(nmId)) fail("CATALOG_PRODUCT_DUPLICATE");
      cardProducts.add(nmId);
      for (const size of array(card.sizes, 1000)) {
        const chrtId = id(object(size).chrtID);
        if (cardSizes.has(chrtId)) fail("CATALOG_SIZE_AMBIGUOUS");
        cardSizes.set(chrtId, nmId);
        if (cardSizes.size > 10000) fail("CATALOG_TOO_LARGE");
      }
    }
    for (const [chrtId, nmId] of selectedSizes) {
      if (cardSizes.get(chrtId) !== nmId) fail("CATALOG_SELECTION_IDENTITY_MISMATCH");
    }
    const warehouseSet = new Set();
    for (const row of array(warehouses.rows, 1000)) {
      const warehouseId = id(object(row).id);
      if (warehouseSet.has(warehouseId)) fail("SELLER_WAREHOUSE_DUPLICATE");
      warehouseSet.add(warehouseId);
    }
    for (const warehouseId of warehouseIds) {
      if (!warehouseSet.has(warehouseId)) fail("SELLER_WAREHOUSE_MISSING");
    }
    const requested = new Set();
    for (const request of array(stock.requests, 100)) {
      const warehouseId = id(object(request).warehouseId);
      if (!warehouseIds.includes(warehouseId)) fail("FBS_WAREHOUSE_NOT_SELECTED");
      if (requested.has(warehouseId)) fail("FBS_REQUEST_DUPLICATE");
      requested.add(warehouseId);
      const sizes = uniqueIds(request.chrtIds, 1000);
      if (sizes.length !== selectedSizes.size || sizes.some((x) => !selectedSizes.has(x)))
        fail("FBS_REQUEST_SIZE_SET_MISMATCH");
    }
    if (requested.size !== warehouseIds.length) fail("FBS_REQUEST_MISSING");

    const responded = new Set();
    const cells = new Map();
    for (const response of array(stock.responses, 100)) {
      const warehouseId = id(object(response).warehouseId);
      if (!requested.has(warehouseId)) fail("FBS_WAREHOUSE_NOT_SELECTED");
      if (responded.has(warehouseId)) fail("FBS_RESPONSE_DUPLICATE");
      responded.add(warehouseId);
      for (const row of array(response.stocks, 1000)) {
        object(row);
        const chrtId = id(row.chrtId);
        if (!selectedSizes.has(chrtId)) fail("FBS_SIZE_NOT_SELECTED");
        const key = `${chrtId}/${warehouseId}`;
        if (cells.has(key)) fail("FBS_CELL_DUPLICATE");
        cells.set(key, quantity(row.amount));
      }
    }
    if (responded.size !== warehouseIds.length) fail("FBS_RESPONSE_MISSING");
    if (cells.size !== selectedSizes.size * warehouseIds.length) fail("FBS_CELL_MISSING");

    let total = 0;
    const result = [...products].sort(([a], [b]) => a - b).map(([nmId, sizes]) => {
      let onHandUnits = 0;
      const stockRows = sizes.flatMap((chrtId) => warehouseIds.map((sellerWarehouseId) => {
        const amount = cells.get(`${chrtId}/${sellerWarehouseId}`);
        onHandUnits = add(onHandUnits, amount);
        total = add(total, amount);
        return { nmId, chrtId, sellerWarehouseId, amount };
      }));
      return { nmId, onHandUnits, outOfStockInSelection: onHandUnits === 0, stockRows };
    });
    return {
      status: "FBS_STOCK_IDENTITY_SYNTHETIC_VALID", schemaVersion: VERSION,
      context: { stockAsOf: asOf, timezone: "Europe/Moscow" },
      stockScope: {
        scheme: SCHEME, complete: true, sellerWarehouseIds: [...warehouseIds],
        products: [...products].sort(([a], [b]) => a - b).map(([nmId, sizes]) => ({ nmId, chrtIds: [...sizes] })),
      },
      products: result, totals: { onHandUnits: total, cells: cells.size },
    };
  } catch (error) {
    if (error instanceof Incomplete) return { status: "INCOMPLETE", reason: error.message };
    throw error;
  }
}
