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
  const registry = globalThis.WBOperations;
  if (!registry?.OPERATIONS || !registry?.HOSTS)
    throw new Error(
      "WBOperations must load before the retired analytics registry overlay.",
    );

  const operations = { ...registry.OPERATIONS };
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

  globalThis.WBOperations = Object.freeze({
    HOSTS: registry.HOSTS,
    OPERATIONS: Object.freeze(operations),
  });
})();
