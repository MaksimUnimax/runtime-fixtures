/* Independent packaged-local capability authority.
 * Presence here means the adapter is packaged. It is never a Work grant and
 * has no implicit relationship to signed feature/entitlement keys. */
(() => {
  "use strict";

  const ID = /^[a-z0-9][a-z0-9._-]{2,95}$/;
  const entries = [
    {
      id: "marketplace.ozon.adapter",
      kind: "marketplace_adapter",
      marketplace: "ozon",
      packaged: true,
      executionAuthority: false,
    },
    {
      id: "marketplace.wildberries.adapter",
      kind: "marketplace_adapter",
      marketplace: "wildberries",
      packaged: true,
      executionAuthority: false,
    },
    {
      id: "ai.chatgpt.web.adapter",
      kind: "ai_adapter",
      family: "chatgpt",
      surface: "web",
      packaged: true,
      executionAuthority: false,
    },
    {
      id: "ai.alice.web.adapter",
      kind: "ai_adapter",
      family: "alice",
      surface: "web",
      packaged: true,
      executionAuthority: false,
    },
    {
      id: "ai.qwen.web.adapter",
      kind: "ai_adapter",
      family: "qwen",
      surface: "web",
      packaged: true,
      executionAuthority: false,
    },
  ];

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }

  const manifest = deepFreeze({
    schemaVersion: "packaged_capability_manifest_v1",
    authority: "PACKAGED_LOCAL_ONLY",
    executionAuthority: false,
    signedPermissionBindings: [],
    capabilities: entries,
  });
  const byId = new Map(entries.map(entry => [entry.id, entry]));

  function validId(id) {
    return typeof id === "string" && ID.test(id);
  }

  function has(id) {
    return validId(id) && byId.has(id);
  }

  function describe(id) {
    return validId(id) ? byId.get(id) || null : null;
  }

  function snapshot() {
    return manifest;
  }

  const api = Object.freeze({
    schemaVersion: manifest.schemaVersion,
    has,
    describe,
    snapshot,
  });
  Object.defineProperty(globalThis, "SellerAgentsPackagedCapabilities", {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
