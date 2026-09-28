(() => {
  "use strict";
  const RETIREMENTS = Object.freeze([
    Object.freeze({
      alias: "banned_products_shadowed",
      method: "GET",
      path: "/api/v1/analytics/banned-products/shadowed",
    }),
    Object.freeze({
      alias: "analytics_item_rating_v1",
      method: "POST",
      path: "/api/analytics/v1/item-rating",
    }),
  ]);
  const ADDITION = Object.freeze({
    alias: "analytics_item_returns",
    host: "analytics",
    method: "GET",
    path: "/api/analytics/v1/item-returns",
    category: "analytics",
    query_keys: Object.freeze([
      "dateFrom",
      "dateTo",
      "status",
      "limit",
      "offset",
    ]),
    required_query_keys: Object.freeze([
      "dateFrom",
      "dateTo",
      "status",
      "limit",
      "offset",
    ]),
    body_required: false,
    privacy: "standard",
    response_mode: "json",
    read_kind: "direct",
    effect: "READ",
    execution_enabled: true,
    current: true,
    source_openapi: "12-reports.yaml",
    source_path: "/api/analytics/v1/item-returns",
    source_readonly: true,
  });
  const registry = globalThis.WBOperations;
  if (!registry?.OPERATIONS || !registry?.HOSTS)
    throw new Error(
      "WBOperations must load before the retired analytics registry overlay.",
    );

  const operations = { ...registry.OPERATIONS };
  const goodsReturn = operations.goods_return;
  if (
    !goodsReturn ||
    goodsReturn.method !== "GET" ||
    goodsReturn.path !== "/api/v1/analytics/goods-return" ||
    goodsReturn.current !== true ||
    goodsReturn.execution_enabled !== true
  )
    throw new Error("WB goods_return registry source drift.");
  if (
    Object.prototype.hasOwnProperty.call(operations, ADDITION.alias) ||
    Object.values(operations).some(
      (operation) => operation.path === ADDITION.path,
    )
  )
    throw new Error("WB item returns registry addition already exists.");
  for (const target of RETIREMENTS) {
    const source = operations[target.alias];
    if (
      !source ||
      source.method !== target.method ||
      source.path !== target.path ||
      source.current !== true ||
      source.execution_enabled !== true
    )
      throw new Error(
        `Retired WB analytics registry source drift: ${target.alias}`,
      );
    delete operations[target.alias];
  }
  operations[ADDITION.alias] = ADDITION;

  globalThis.WBOperations = Object.freeze({
    HOSTS: registry.HOSTS,
    OPERATIONS: Object.freeze(operations),
  });
})();
