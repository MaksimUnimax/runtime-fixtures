(() => {
  "use strict";
  const TARGET = "fbs_order_statuses";
  const registry = globalThis.WBOperations;
  if (!registry?.OPERATIONS || !registry?.HOSTS)
    throw new Error(
      "WBOperations must load before the FBS statuses registry overlay.",
    );
  const source = registry.OPERATIONS[TARGET];
  if (
    !source ||
    source.method !== "POST" ||
    source.path !== "/api/v3/orders/status"
  )
    throw new Error("FBS statuses registry source drift.");
  if (source.body_required !== false)
    throw new Error(
      "FBS statuses body_required baseline drift; retire or update the overlay.",
    );

  const patched = Object.freeze({ ...source, body_required: true });
  const operations = Object.freeze({
    ...registry.OPERATIONS,
    [TARGET]: patched,
  });
  globalThis.WBOperations = Object.freeze({
    HOSTS: registry.HOSTS,
    OPERATIONS: operations,
  });
})();
