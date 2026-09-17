/* Read-only intersection of reviewed packaged-local capabilities and explicit
 * signed server entitlement permissions. This layer never grants Work,
 * dispatch, replay, provider, scheduler, or offline execution authority. */
(() => {
  "use strict";

  const client = globalThis.SellerAgentsControlClient;
  const packaged = globalThis.SellerAgentsPackagedCapabilities;
  if (!client || typeof client.getVerifiedBootstrapMetadata !== "function")
    throw new Error("CAPABILITY_INTERSECTION_SIGNED_METADATA_MISSING");
  if (
    !packaged ||
    typeof packaged.has !== "function" ||
    typeof packaged.describe !== "function"
  )
    throw new Error("CAPABILITY_INTERSECTION_PACKAGED_AUTHORITY_MISSING");

  const SOURCES = new Set(["ONLINE", "CACHE"]);
  const FRESHNESS = new Set(["FRESH", "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"]);
  const ACCESS_BASES = new Set(["BETA", "COMMERCIAL", "NONE"]);

  const bindings = [
    {
      capabilityId: "marketplace.ozon.adapter",
      entitlementKey: "source.ozon",
    },
    {
      capabilityId: "marketplace.wildberries.adapter",
      entitlementKey: "source.wildberries",
    },
    {
      capabilityId: "ai.chatgpt.web.adapter",
      entitlementKey: "ai.chatgpt",
    },
    {
      capabilityId: "ai.alice.web.adapter",
      entitlementKey: "ai.alice",
    },
  ];

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value))
      return value;
    for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  }

  const manifest = deepFreeze({
    schemaVersion: "seller_agents_capability_intersection_v1",
    authority: "PACKAGED_AND_SIGNED_ENTITLEMENT_READ_ONLY",
    executionAuthority: false,
    bindings,
  });
  const byCapabilityId = new Map(
    manifest.bindings.map(binding => [binding.capabilityId, binding]),
  );

  function fail() {
    return Object.assign(new Error("CAPABILITY_PERMISSION_METADATA_INVALID"), {
      code: "CAPABILITY_PERMISSION_METADATA_INVALID",
    });
  }

  function plainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function validateMetadata(metadata) {
    if (
      !plainObject(metadata) ||
      metadata.metadataVersion !== "signed_bootstrap_metadata_v1" ||
      !SOURCES.has(metadata.source) ||
      !FRESHNESS.has(metadata.freshness) ||
      metadata.executionAuthority !== false ||
      !Number.isSafeInteger(metadata.configVersion) ||
      metadata.configVersion <= 0 ||
      !ACCESS_BASES.has(metadata.accessBasis) ||
      !plainObject(metadata.signedEntitlements)
    )
      throw fail();
  }

  function evaluate(metadata) {
    validateMetadata(metadata);
    const capabilities = manifest.bindings.map(binding => {
      const local = packaged.describe(binding.capabilityId);
      const packagedPresent =
        packaged.has(binding.capabilityId) === true &&
        local?.packaged === true &&
        local.executionAuthority === false;
      const signedPermissionPresent = Object.prototype.hasOwnProperty.call(
        metadata.signedEntitlements,
        binding.entitlementKey,
      );
      const signedValue = signedPermissionPresent
        ? metadata.signedEntitlements[binding.entitlementKey]
        : undefined;
      if (signedPermissionPresent && typeof signedValue !== "boolean")
        throw fail();
      const signedPermissionAllowed = signedValue === true;

      return {
        capabilityId: binding.capabilityId,
        entitlementKey: binding.entitlementKey,
        packaged: packagedPresent,
        signedPermissionPresent,
        signedPermissionAllowed,
        permissionSatisfied: packagedPresent && signedPermissionAllowed,
        executionAuthority: false,
      };
    });

    return deepFreeze({
      schemaVersion: "verified_capability_intersection_v1",
      source: metadata.source,
      freshness: metadata.freshness,
      configVersion: metadata.configVersion,
      accessBasis: metadata.accessBasis,
      executionAuthority: false,
      capabilities,
    });
  }

  function snapshot() {
    return manifest;
  }

  function hasBinding(capabilityId) {
    return typeof capabilityId === "string" && byCapabilityId.has(capabilityId);
  }

  function describeBinding(capabilityId) {
    return hasBinding(capabilityId) ? byCapabilityId.get(capabilityId) : null;
  }

  async function getVerified(options = {}) {
    return evaluate(await client.getVerifiedBootstrapMetadata(options));
  }

  function evaluateVerifiedMetadata(metadata) {
    return evaluate(metadata);
  }

  const api = Object.freeze({
    schemaVersion: manifest.schemaVersion,
    snapshot,
    hasBinding,
    describeBinding,
    getVerified,
    evaluateVerifiedMetadata,
  });
  Object.defineProperty(globalThis, "SellerAgentsCapabilityIntersection", {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
