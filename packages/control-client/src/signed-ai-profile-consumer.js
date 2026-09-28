/* Browser-safe strict mirror of signed_ai_profile_consumer_v1. No network or persistence. */
(() => {
  "use strict";

  const PROTOCOL_VERSION = "signed_ai_profile_consumer_v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MACHINE = /^[a-z0-9][a-z0-9._-]*$/;
  const DIGEST = /^[0-9a-f]{64}$/;
  const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const BROWSER_VERSION = /^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/;
  const BROWSER_FAMILIES = Object.freeze(["chrome", "opera", "yandex_chromium", "firefox", "safari"]);
  const ACCESSIBILITY_ROLES = new Set(["main", "article", "textbox", "button", "status"]);
  const EXPECTED_STATES = new Set(["PRESENT", "INTERACTIVE", "COMPLETES"]);
  const OBSERVATION_MODES = new Set(["mutation_observer", "polling"]);
  const UNAVAILABLE_REASONS = new Set([
    "NO_VERIFIED_AUTHORITY",
    "WORK_NOT_ALLOWED",
    "AI_SCOPE_MISMATCH",
    "PROFILE_UNSUPPORTED",
    "AUTHORITY_CHANGED",
  ]);
  const REJECT_REASONS = new Set(["INVALID_PROFILE", "STALE_REQUEST", "AI_SCOPE_MISMATCH"]);
  const SLOT = Object.freeze({
    conversation: Object.freeze({ strategy: "conversation_root", reference: "conversation-root" }),
    composer: Object.freeze({ strategy: "composer_root", reference: "composer-root" }),
    send: Object.freeze({ strategy: "send_control", reference: "send-control" }),
    assistantResponse: Object.freeze({ strategy: "assistant_response", reference: "assistant-response" }),
  });
  const CONTOUR_KEYS = new Set([
    "page_identity",
    "conversation_root",
    "composer_root",
    "send_control",
    "busy_state",
    "assistant_response",
    "copy_control",
  ]);

  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype;
  }
  function exact(value, keys) {
    if (!record(value)) return false;
    const actual = Object.keys(value);
    const expected = new Set(keys);
    return actual.length === expected.size && actual.every((key) => expected.has(key));
  }
  function exactWithOptional(value, required, optional = []) {
    if (!record(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) => allowed.has(key));
  }
  function machine(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 64 && MACHINE.test(value);
  }
  function positiveSafeInt(value) {
    return Number.isSafeInteger(value) && value > 0;
  }
  function canonical(value) {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error("NON_CANONICAL_NUMBER");
      return String(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (record(value)) {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    throw new Error("INVALID_CANONICAL_VALUE");
  }
  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function validScope(value) {
    return exact(value, ["family", "surface", "variant"]) &&
      ["chatgpt", "alice"].includes(value.family) && value.surface === "web" && value.variant === null;
  }
  function validAuthority(value) {
    return exact(value, ["authGeneration", "bootstrapSnapshotSha256"]) &&
      positiveSafeInt(value.authGeneration) && typeof value.bootstrapSnapshotSha256 === "string" &&
      DIGEST.test(value.bootstrapSnapshotSha256);
  }
  function validIdentity(value) {
    return exact(value, ["profileKey", "revision", "scopeVariant", "contentSha256"]) &&
      machine(value.profileKey) && positiveSafeInt(value.revision) && value.scopeVariant === null &&
      typeof value.contentSha256 === "string" && DIGEST.test(value.contentSha256);
  }
  function validPrimitive(value, expectedReference) {
    if (!record(value) || value.reference !== expectedReference) return false;
    if (value.kind === "packaged_selector_reference") {
      return exact(value, ["kind", "reference"]);
    }
    if (value.kind === "accessibility_role_name") {
      return exact(value, ["kind", "role", "reference"]) && ACCESSIBILITY_ROLES.has(value.role);
    }
    return false;
  }
  function validPlan(value, expected) {
    if (!exact(value, ["strategy", "primary", "fallbacks", "timeoutMs", "observationMode"])) return false;
    if (value.strategy !== expected.strategy || !validPrimitive(value.primary, expected.reference)) return false;
    if (!Array.isArray(value.fallbacks) || value.fallbacks.length > 3 ||
        !value.fallbacks.every((primitive) => validPrimitive(primitive, expected.reference))) return false;
    if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 250 || value.timeoutMs > 30000) return false;
    if (!OBSERVATION_MODES.has(value.observationMode)) return false;
    return value.observationMode !== "polling" || value.timeoutMs >= 500;
  }
  function validCompatibility(value) {
    if (!exact(value, ["schemaVersion", "contractVersion", "browserFamilies", "minimumBrowserVersions", "minimumExtensionVersion"])) return false;
    if (value.schemaVersion !== "profile_compatibility_v1" ||
        !["control_plane_v1", "control_plane_v2"].includes(value.contractVersion)) return false;
    if (!Array.isArray(value.browserFamilies) || value.browserFamilies.length < 1 ||
        value.browserFamilies.length > BROWSER_FAMILIES.length ||
        new Set(value.browserFamilies).size !== value.browserFamilies.length ||
        !value.browserFamilies.every((family) => BROWSER_FAMILIES.includes(family))) return false;
    if (!Array.isArray(value.minimumBrowserVersions) ||
        value.minimumBrowserVersions.length > BROWSER_FAMILIES.length ||
        new Set(value.minimumBrowserVersions.map((row) => row?.browserFamily)).size !== value.minimumBrowserVersions.length) return false;
    for (const row of value.minimumBrowserVersions) {
      if (!exact(row, ["browserFamily", "minimumVersion"]) ||
          !value.browserFamilies.includes(row.browserFamily) ||
          typeof row.minimumVersion !== "string" || row.minimumVersion.length > 64 ||
          !BROWSER_VERSION.test(row.minimumVersion)) return false;
    }
    return value.minimumExtensionVersion === null ||
      (typeof value.minimumExtensionVersion === "string" &&
       value.minimumExtensionVersion.length <= 64 && SEMVER.test(value.minimumExtensionVersion));
  }
  function validContent(value) {
    if (!exact(value, ["schemaVersion", "page", "selectors", "observation", "contours"]) ||
        value.schemaVersion !== "adapter_profile_v1") return false;
    if (!exact(value.page, ["identityStrategy", "conversationStrategy", "composerStrategy"]) ||
        value.page.identityStrategy !== "page_identity" ||
        value.page.conversationStrategy !== "conversation_root" ||
        value.page.composerStrategy !== "composer_root") return false;
    if (!exact(value.selectors, ["conversation", "composer", "send", "assistantResponse"])) return false;
    for (const slot of Object.keys(SLOT)) {
      if (!validPlan(value.selectors[slot], SLOT[slot])) return false;
    }
    if (!exact(value.observation, ["mode", "intervalMs"]) ||
        !OBSERVATION_MODES.has(value.observation.mode) ||
        !Number.isSafeInteger(value.observation.intervalMs) ||
        value.observation.intervalMs < 100 || value.observation.intervalMs > 5000 ||
        (value.observation.mode === "mutation_observer" && value.observation.intervalMs !== 100)) return false;
    if (!Array.isArray(value.contours) || value.contours.length < 4 || value.contours.length > 7) return false;
    if (new Set(value.contours.map((row) => row?.key)).size !== value.contours.length) return false;
    for (const contour of value.contours) {
      if (!exact(contour, ["key", "required", "expectedState", "strategy"]) ||
          !CONTOUR_KEYS.has(contour.key) || contour.strategy !== contour.key ||
          typeof contour.required !== "boolean" || !EXPECTED_STATES.has(contour.expectedState)) return false;
    }
    return true;
  }
  function validMaterialShape(value) {
    return exact(value, [
      "profileKey", "revision", "scopeVariant", "contentSha256",
      "schemaVersion", "content", "compatibility",
    ]) &&
      machine(value.profileKey) && positiveSafeInt(value.revision) && value.scopeVariant === null &&
      value.schemaVersion === "adapter_profile_v1" &&
      typeof value.contentSha256 === "string" && DIGEST.test(value.contentSha256) &&
      validContent(value.content) && validCompatibility(value.compatibility);
  }
  async function profileFingerprint(value) {
    if (!validMaterialShape(value)) return null;
    return sha256Hex(canonical({ content: value.content, compatibility: value.compatibility }));
  }
  async function validMaterial(value) {
    const fingerprint = await profileFingerprint(value);
    return fingerprint !== null && fingerprint === value.contentSha256;
  }
  function validRequest(value) {
    return exact(value, ["messageType", "protocolVersion", "requestId", "ai"]) &&
      value.messageType === "OZ_REQUEST_SIGNED_AI_PROFILE" &&
      value.protocolVersion === PROTOCOL_VERSION &&
      typeof value.requestId === "string" && UUID.test(value.requestId) &&
      validScope(value.ai);
  }
  async function validResponse(value) {
    if (!record(value) || value.messageType !== "OZ_SIGNED_AI_PROFILE" ||
        value.protocolVersion !== PROTOCOL_VERSION ||
        typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
        !validScope(value.ai)) return false;
    if (value.status === "UNAVAILABLE") {
      return exact(value, ["messageType", "protocolVersion", "requestId", "ai", "status", "reason"]) &&
        UNAVAILABLE_REASONS.has(value.reason);
    }
    if (value.status !== "AVAILABLE" ||
        !exact(value, ["messageType", "protocolVersion", "requestId", "ai", "status", "authority", "profile"]) ||
        !validAuthority(value.authority)) return false;
    return validMaterial(value.profile);
  }
  function validReceipt(value) {
    if (!record(value) || value.messageType !== "OZ_SIGNED_AI_PROFILE_RECEIPT" ||
        value.protocolVersion !== PROTOCOL_VERSION ||
        typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
        !validScope(value.ai)) return false;
    if (value.status === "CLEARED") {
      return exact(value, ["messageType", "protocolVersion", "requestId", "ai", "status", "reason"]) &&
        UNAVAILABLE_REASONS.has(value.reason);
    }
    if (value.status === "REJECTED") {
      return exact(value, ["messageType", "protocolVersion", "requestId", "ai", "status", "reason"]) &&
        REJECT_REASONS.has(value.reason);
    }
    const keys = value.status === "DEFERRED"
      ? ["messageType", "protocolVersion", "requestId", "ai", "status", "authority", "profile", "reason"]
      : ["messageType", "protocolVersion", "requestId", "ai", "status", "authority", "profile"];
    if (!["APPLIED", "DEFERRED"].includes(value.status) || !exact(value, keys) ||
        !validAuthority(value.authority) || !validIdentity(value.profile)) return false;
    return value.status !== "DEFERRED" || value.reason === "WORK_IN_FLIGHT";
  }

  globalThis.SellerAgentsSignedAiProfileConsumer = Object.freeze({
    PROTOCOL_VERSION,
    validRequest,
    validResponse,
    validReceipt,
    validMaterial,
    validMaterialShape,
    profileFingerprint,
    canonicalJson: canonical,
  });
})();
