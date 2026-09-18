/* Pure authority for continuing an already-active Work session while the
 * control plane is unreachable. It reads only its detached input, performs
 * signature verification, and never performs browser/storage/provider I/O. */
(() => {
  "use strict";
  const config = globalThis.SellerAgentsControlConfig;
  const verifier = globalThis.SellerAgentsBootstrapVerifier;
  const packaged = globalThis.SellerAgentsPackagedCapabilities;
  const intersection = globalThis.SellerAgentsCapabilityIntersection;
  const SOURCE_PERMISSION = Object.freeze({ ozon: "source.ozon", wildberries: "source.wildberries" });
  const AI_PERMISSION = Object.freeze({ chatgpt: "ai.chatgpt", alice: "ai.alice" });
  const CAPABILITY_IDS = Object.freeze({ "source.ozon": "marketplace.ozon.adapter", "source.wildberries": "marketplace.wildberries.adapter", "ai.chatgpt": "ai.chatgpt.web.adapter", "ai.alice": "ai.alice.web.adapter" });
  const AI_FAMILIES = new Set(["chatgpt", "alice"]);
  const MAX_DATE_MS = 8640000000000000;
  const RECEIPT_KEYS = ["provenanceSchema", "mode", "accountId", "accountGeneration", "deviceId", "sessionId", "bootstrapSnapshotSha256", "bootstrapConfigVersion", "bootstrapContractVersion", "aiFamily", "aiSurface", "aiVariant", "aiProfileKey", "aiProfileRevision", "aiProfileScopeVariant", "aiProfileContentSha256", "marketplace", "storeId", "credentialRevision", "conversationKey", "conversationId", "bindingId", "bindingRevision", "workStartIntentId", "operation", "admissionSafeTimeMs", "executionAuthority", "bearer"];
  function plain(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
  function text(value) { return typeof value === "string" && value.length > 0; }
  function same(left, right) { return text(left) && left === right; }
  function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const nested of Object.values(value)) deepFreeze(nested); return Object.freeze(value); }
  function result(input, deniedGates, extra = {}) { return deepFreeze({ schemaVersion: "offline_work_authority_decision_v1", allowed: deniedGates.length === 0, deniedGates: [...deniedGates], provenanceMode: input?.receipt?.mode || null, executionAuthority: false, ...extra }); }
  function parsed(value) { const millis = Date.parse(value); return Number.isSafeInteger(millis) && millis >= 0 && millis <= MAX_DATE_MS ? millis : null; }
  function browserFamily() { const ua = typeof navigator === "object" ? String(navigator.userAgent || "").toLowerCase() : ""; return ua.includes("yabrowser") ? "yandex_chromium" : "chrome"; }
  function browserVersion() { const ua = typeof navigator === "object" ? String(navigator.userAgent || "") : ""; const match = ua.match(/(?:Chrome|YaBrowser)\/(\d+(?:\.\d+){0,3})/i); return match ? match[1] : "0.0.0"; }
  function semver(value) { const match = typeof value === "string" && /^(\d+)\.(\d+)\.(\d+)$/.exec(value); return match ? match.slice(1).map(Number) : null; }
  function atLeast(actual, minimum) { const a = semver(actual), b = semver(minimum); if (!a || !b) return false; for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]; return true; }
  async function sha256Bytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join(""); }
  async function snapshotDigest(envelope) { if (!text(envelope?.payload) || !/^[A-Za-z0-9_-]+$/.test(envelope.payload)) return null; try { const padded = envelope.payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - envelope.payload.length % 4) % 4); const binary = atob(padded); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)); return { digest: await sha256Bytes(bytes), bytes }; } catch (_) { return null; } }
  function currentView(value) { return plain(value) ? value : {}; }
  function capability(payload, marketplace, family) {
    const source = SOURCE_PERMISSION[marketplace], ai = AI_PERMISSION[family];
    if (!source || !ai || !packaged || !intersection) return false;
    try {
      const metadata = { metadataVersion: "signed_bootstrap_metadata_v1", source: "CACHE", freshness: "FRESH", executionAuthority: false, configVersion: payload.configVersion, accessBasis: payload.accessBasis, signedEntitlements: payload.entitlements };
      const value = intersection.evaluateVerifiedMetadata(metadata);
      const sourceRow = value.capabilities.find(row => row.entitlementKey === source && row.capabilityId === CAPABILITY_IDS[source]);
      const aiRow = value.capabilities.find(row => row.entitlementKey === ai && row.capabilityId === CAPABILITY_IDS[ai]);
      return Boolean(sourceRow?.packaged === true && sourceRow.signedPermissionPresent === true && sourceRow.signedPermissionAllowed === true && sourceRow.permissionSatisfied === true && sourceRow.executionAuthority === false && aiRow?.packaged === true && aiRow.signedPermissionPresent === true && aiRow.signedPermissionAllowed === true && aiRow.permissionSatisfied === true && aiRow.executionAuthority === false);
    } catch (_) { return false; }
  }
  async function evaluate(input) {
    const value = plain(input) ? input : {};
    const authority = currentView(value.cachedAuthority), payload = currentView(authority.payload), current = currentView(value.current), receipt = currentView(value.receipt), work = currentView(value.work), clock = currentView(value.cacheClock);
    const denied = [], safeTime = value.safeTimeMs;
    if (value.operation !== "CONTINUE") denied.push("operationScope");
    if (!["active_visible", "active_hidden"].includes(work.state)) denied.push("workState");
    if (!plain(value.receipt)) denied.push("provenanceMissing");
    if (!plain(work.admission_provenance) || !plain(value.receipt) || verifier.canonicalJson(work.admission_provenance) !== verifier.canonicalJson(value.receipt)) denied.push("provenanceBinding");
    if (receipt.provenanceSchema !== "seller_agents_online_admission_provenance_v1" || receipt.mode !== "ONLINE_VERIFIED" || receipt.executionAuthority !== false || receipt.bearer !== false) denied.push("provenanceMode");
    if (RECEIPT_KEYS.some(key => !(key in receipt))) denied.push("provenanceShape");
    if (!["START", "RESUME"].includes(receipt.operation) || !Number.isSafeInteger(receipt.admissionSafeTimeMs) || receipt.admissionSafeTimeMs < 0 || receipt.admissionSafeTimeMs > MAX_DATE_MS || Number.isSafeInteger(safeTime) && receipt.admissionSafeTimeMs > safeTime) denied.push("provenanceTime");
    if (current.revoked === true || current.loggedOut === true || current.authReset === true || current.obsolete === true || current.storeDeleted === true) denied.push("localInvalidation");
    if (!Number.isSafeInteger(safeTime) || safeTime < 0 || safeTime > MAX_DATE_MS || !Number.isSafeInteger(clock.effectiveTimeMs) || safeTime < clock.effectiveTimeMs || !Number.isSafeInteger(clock.trustedServerTimeMs) || safeTime < clock.trustedServerTimeMs) denied.push("safeTime");
    if (authority.workAllowed !== true) denied.push("authorityPermission");
    if (!(authority.generation === current.generation && same(authority.deviceId, current.deviceId) && same(authority.sessionId, current.sessionId) && same(payload.account?.id, current.accountId))) denied.push("authorityIdentity");
    if (receipt.accountId !== current.accountId || receipt.accountGeneration !== current.generation || receipt.deviceId !== current.deviceId || receipt.sessionId !== current.sessionId) denied.push("provenanceAuthorityIdentity");
    const cacheOwner = clock.owner;
    if (clock.cacheVersion !== "control_cache_clock_v1" || !plain(cacheOwner) || cacheOwner.controlApiOrigin !== config.controlApiOrigin || cacheOwner.portalOrigin !== config.portalOrigin || cacheOwner.contractVersion !== config.contractVersion || cacheOwner.deviceId !== current.deviceId || cacheOwner.sessionId !== current.sessionId || parsed(payload.serverTime) === null || clock.trustedServerTimeMs < parsed(payload.serverTime)) denied.push("cacheOwner");
    const snapshot = await snapshotDigest(authority.envelope);
    if (!snapshot) denied.push("bootstrapUnverifiable");
    else {
      let verified = false;
      try { const checked = await verifier.verifyV2(authority.envelope, config.trustBundle); verified = checked.ok === true && verifier.canonicalJson(checked.payload) === verifier.canonicalJson(payload); } catch (_) {}
      if (authority.verified !== true || !verified) denied.push("bootstrapUnverifiable");
      if (receipt.bootstrapSnapshotSha256 !== snapshot.digest) denied.push("bootstrapSnapshot");
    }
    const binding = currentView(value.binding), store = currentView(value.store), identity = currentView(value.identity);
    const expires = parsed(payload.expiresAt);
    if (expires === null || safeTime >= expires) denied.push("bootstrapFreshness");
    if (payload.snapshotVersion !== "bootstrap_snapshot_v2" || payload.contractVersion !== config.contractVersion || !Number.isSafeInteger(payload.configVersion) || payload.configVersion <= 0 || payload.account?.status !== "ACTIVE" || payload.devicePolicy?.status !== "ACTIVE") denied.push("bootstrapCompatibility");
    const extension = payload.compatibility?.extension;
    if (!extension || !["SUPPORTED", "UPDATE_RECOMMENDED"].includes(extension.status) || extension.minimumVersion !== null && !atLeast(config.extensionVersion, extension.minimumVersion) || payload.compatibility?.browser?.status !== "SUPPORTED") denied.push("bootstrapCompatibility");
    if (receipt.bootstrapConfigVersion !== payload.configVersion || receipt.bootstrapContractVersion !== payload.contractVersion) denied.push("provenanceBootstrapVersion");
    const detected = payload.ai?.detected, profile = payload.ai?.profile;
    if (payload.ai?.status !== "RESOLVED" || !AI_FAMILIES.has(detected?.family) || authority.requestedAi !== detected?.family || detected.family !== current.aiFamily || detected.surface !== current.aiSurface || detected.variant !== current.aiVariant) denied.push("aiIdentity");
    if (receipt.aiFamily !== detected?.family || receipt.aiSurface !== detected?.surface || receipt.aiVariant !== detected?.variant || receipt.aiProfileKey !== profile?.profileKey || receipt.aiProfileRevision !== profile?.revision || receipt.aiProfileScopeVariant !== profile?.scopeVariant || receipt.aiProfileContentSha256 !== profile?.contentSha256 || current.aiProfileKey !== profile?.profileKey || current.aiProfileRevision !== profile?.revision || current.aiProfileScopeVariant !== profile?.scopeVariant || current.aiProfileContentSha256 !== profile?.contentSha256) denied.push("aiProfile");
    if (profile?.contentSha256 && await sha256Bytes(new TextEncoder().encode(verifier.canonicalJson({ content: profile.content, compatibility: profile.compatibility }))) !== profile.contentSha256) denied.push("aiProfileContent");
    const expectedKey = `${current.origin}|${current.conversationId}`;
    if (!text(current.origin) || !text(current.conversationId) || current.conversationKey !== expectedKey || receipt.conversationKey !== current.conversationKey || receipt.conversationId !== current.conversationId || work.conversation_key !== current.conversationKey || work.conversation_id !== current.conversationId || identity.origin !== current.origin || identity.conversationId !== current.conversationId) denied.push("conversation");
    if (binding.binding_id !== current.bindingId || binding.revision !== current.bindingRevision || binding.conversation_key !== current.conversationKey || binding.conversation_id !== current.conversationId || binding.origin !== current.origin || binding.ai_id !== current.aiFamily) denied.push("binding");
    const boundStore = binding.store_context || binding;
    if (store.accountId !== current.accountId || store.id !== current.storeId || store.marketplace !== current.marketplace || store.credentialRevision !== current.credentialRevision || boundStore.accountId !== current.accountId || boundStore.storeId !== current.storeId || boundStore.marketplace !== current.marketplace || boundStore.credentialRevision !== current.credentialRevision || receipt.marketplace !== current.marketplace || receipt.storeId !== current.storeId || receipt.credentialRevision !== current.credentialRevision) denied.push("storeBinding");
    const intentMatches = receipt.operation === "START"
      ? receipt.workStartIntentId === current.workStartIntentId && work.start_intent_id === current.workStartIntentId
      : receipt.operation === "RESUME" && current.workStartIntentId === null && work.start_intent_id === null;
    if (receipt.bindingId !== current.bindingId || receipt.bindingRevision !== current.bindingRevision || !intentMatches) denied.push("workIntentBinding");
    if (!capability(payload, current.marketplace, current.aiFamily)) denied.push("capabilityIntersection");
    const cacheBinding = authority.cacheBinding;
    const trustBundleSha256 = await sha256Bytes(new TextEncoder().encode(verifier.canonicalJson(config.trustBundle)));
    if (!plain(cacheBinding) || cacheBinding.cacheVersion !== "control_cache_binding_v1" || cacheBinding.controlApiOrigin !== config.controlApiOrigin || cacheBinding.portalOrigin !== config.portalOrigin || cacheBinding.contractVersion !== config.contractVersion || cacheBinding.extensionVersion !== config.extensionVersion || cacheBinding.browser?.family !== browserFamily() || cacheBinding.browser?.version !== browserVersion() || cacheBinding.trustBundleSha256 !== trustBundleSha256 || verifier.canonicalJson(cacheBinding.detectedAi) !== verifier.canonicalJson(detected)) denied.push("cacheBinding");
    return result(value, [...new Set(denied)], { operation: "CONTINUE", bootstrapFreshness: denied.includes("bootstrapFreshness") ? "EXPIRED" : "FRESH" });
  }
  function createProvenance(seed, finalFields = {}) {
    const value = plain(seed) ? { ...seed, ...finalFields } : null;
    return value ? deepFreeze(value) : null;
  }
  Object.defineProperty(globalThis, "SellerAgentsOfflineWorkAuthority", { value: Object.freeze({ evaluate, createProvenance }), writable: false, configurable: false, enumerable: true });
})();
