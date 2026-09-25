/* Firefox built-in data consent for optional technical metadata. */
(() => {
  "use strict";

  const CATEGORY = "technicalAndInteraction";
  const KINDS = new Set(["device_authorization", "bootstrap", "health_authority"]);
  const browserIdentity = globalThis.SellerAgentsBrowserIdentity;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function family() {
    return browserIdentity?.current?.().family || null;
  }

  function firefoxPermissions() {
    return globalThis.browser?.permissions || null;
  }

  async function consent() {
    if (family() !== "firefox") {
      return Object.freeze({ applicable: false, granted: true, source: "not_firefox" });
    }
    const permissions = firefoxPermissions();
    if (!permissions || typeof permissions.getAll !== "function") {
      return Object.freeze({ applicable: true, granted: false, source: "unavailable" });
    }
    try {
      const current = await permissions.getAll();
      const categories = Array.isArray(current?.data_collection) ? current.data_collection : [];
      return Object.freeze({
        applicable: true,
        granted: categories.includes(CATEGORY),
        source: "firefox_permission",
      });
    } catch (_) {
      return Object.freeze({ applicable: true, granted: false, source: "query_failed" });
    }
  }

  async function requestFromUserGesture() {
    if (family() !== "firefox") return true;
    const permissions = firefoxPermissions();
    if (!permissions || typeof permissions.request !== "function") return false;
    try {
      const requested = await permissions.request({ data_collection: [CATEGORY] });
      if (requested !== true) return false;
      return (await consent()).granted === true;
    } catch (_) {
      return false;
    }
  }

  async function revoke() {
    if (family() !== "firefox") return true;
    const permissions = firefoxPermissions();
    if (!permissions || typeof permissions.remove !== "function") return false;
    try {
      await permissions.remove({ data_collection: [CATEGORY] });
      return (await consent()).granted === false;
    } catch (_) {
      return false;
    }
  }

  function onWithdrawal(handler) {
    if (family() !== "firefox" || typeof handler !== "function") return () => {};
    const event = firefoxPermissions()?.onRemoved;
    if (!event || typeof event.addListener !== "function") return () => {};
    const listener = async () => {
      const current = await consent();
      if (current.applicable && !current.granted) await handler();
    };
    event.addListener(listener);
    return () => event.removeListener?.(listener);
  }

  function omitTechnicalFields(kind, body) {
    const projected = clone(body);
    if (kind === "device_authorization") {
      const deviceLabel = projected.deviceLabel;
      delete projected.browserFamily;
      delete projected.browserVersion;
      delete projected.extensionVersion;
      return deviceLabel === undefined
        ? { clientType: "browser_extension" }
        : { clientType: "browser_extension", deviceLabel };
    }
    if (kind === "bootstrap") {
      delete projected.extensionVersion;
      delete projected.browser;
      return projected;
    }
    if (kind === "health_authority") {
      if (projected?.bootstrap) projected.bootstrap = omitTechnicalFields("bootstrap", projected.bootstrap);
      return projected;
    }
    throw new Error("TECHNICAL_DATA_PROJECTION_KIND_INVALID");
  }

  async function projectControlRequest(kind, body) {
    if (!KINDS.has(kind)) throw new Error("TECHNICAL_DATA_PROJECTION_KIND_INVALID");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("TECHNICAL_DATA_PROJECTION_BODY_INVALID");
    }
    const current = await consent();
    return Object.freeze({
      consent: current,
      body: current.applicable && !current.granted ? omitTechnicalFields(kind, body) : clone(body),
    });
  }

  globalThis.SellerAgentsTechnicalDataConsent = Object.freeze({
    CATEGORY,
    consent,
    requestFromUserGesture,
    revoke,
    onWithdrawal,
    projectControlRequest,
  });
})();
