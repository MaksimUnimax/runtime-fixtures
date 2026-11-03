/* Bundled release availability ceiling, separate from permission or Work authority.
 * Its exact descriptor/hash mirror the source JSON; builders check that binding.
 * Missing or incompatible package input cannot activate a retained adapter. */
(() => {
  "use strict";
  const CANONICAL_DESCRIPTOR = '{"enabledAi":[{"family":"alice","surface":"web","variant":null}],"executionAuthority":false,"releaseId":"alice_first_v1","retainedAiFamilies":["chatgpt","alice","qwen","kimi","grok","gemini","claude","deepseek"],"revision":1,"schemaVersion":"ai_release_scope_v1"}';
  const DESCRIPTOR_SHA256 = "10c20b39daec4d0a9733173222167ea7a56da2a128bbc182132591c8e5596261";
  const record = value => value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  function dataKeys(value, keys) {
    if (!record(value)) return false;
    const own = Reflect.ownKeys(value);
    return own.length === keys.length && own.every(key => typeof key === "string" &&
      keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
  }
  function canonical(value, depth = 0) {
    if (depth > 8) throw new Error("AI_RELEASE_SCOPE_INVALID");
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "string" && value.length <= 256) return JSON.stringify(value);
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) return String(value);
    if (Array.isArray(value) && value.length <= 16) {
      if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error("AI_RELEASE_SCOPE_INVALID");
      return "[" + Array.from({ length: value.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new Error("AI_RELEASE_SCOPE_INVALID");
        return canonical(d.value, depth + 1);
      }).join(",") + "]";
    }
    if (record(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length > 16 || !keys.every(key => typeof key === "string")) throw new Error("AI_RELEASE_SCOPE_INVALID");
      return "{" + keys.sort().map(key => {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new Error("AI_RELEASE_SCOPE_INVALID");
        return JSON.stringify(key) + ":" + canonical(d.value, depth + 1);
      }).join(",") + "}";
    }
    throw new Error("AI_RELEASE_SCOPE_INVALID");
  }
  function validBundle(value) {
    try {
      return dataKeys(value, ["descriptor", "sha256"]) &&
        value.sha256 === DESCRIPTOR_SHA256 && canonical(value.descriptor) === CANONICAL_DESCRIPTOR;
    } catch (_) { return false; }
  }
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  // Capture once; mutable runtime settings, feature flags or cached grants are
  // never alternative sources of supported release identities.
  const active = validBundle(globalThis.SellerAgentsControlConfig?.aiReleaseScope)
    ? freeze({ descriptor: JSON.parse(CANONICAL_DESCRIPTOR), sha256: DESCRIPTOR_SHA256 }) : null;
  function supportsAi(value) {
    return Boolean(active && dataKeys(value, ["family", "surface", "variant"]) &&
      active.descriptor.enabledAi.some(ai => ai.family === value.family &&
        ai.surface === value.surface && ai.variant === value.variant));
  }
  function supportsFamily(family) {
    return Boolean(active && typeof family === "string" &&
      active.descriptor.enabledAi.some(ai => ai.family === family));
  }
  function supportsCapability(id) {
    if (!active || typeof id !== "string") return false;
    if (["marketplace.ozon.adapter", "marketplace.wildberries.adapter"].includes(id)) return true;
    return active.descriptor.enabledAi.some(ai => id === `ai.${ai.family}.${ai.surface}.adapter`);
  }
  Object.defineProperty(globalThis, "SellerAgentsAiReleaseScope", {
    value: Object.freeze({ schemaVersion: "ai_release_scope_v1", executionAuthority: false,
      validBundle, supportsAi, supportsFamily, supportsCapability, snapshot: () => active }),
    writable: false, configurable: false, enumerable: true,
  });
})();
