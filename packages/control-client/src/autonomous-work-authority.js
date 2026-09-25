/* One pure installation-local Work authority evaluator. */
(() => {
  "use strict";
  const config = globalThis.SellerAgentsControlConfig;
  const verifier = globalThis.SellerAgentsBootstrapVerifier;
  const browserIdentity = globalThis.SellerAgentsBrowserIdentity;
  const packaged = globalThis.SellerAgentsPackagedCapabilities;
  const intersection = globalThis.SellerAgentsCapabilityIntersection;
  const sourcePermission = Object.freeze({ ozon: "source.ozon", wildberries: "source.wildberries" });
  const aiPermission = Object.freeze({ chatgpt: "ai.chatgpt", alice: "ai.alice" });
  const capabilityId = Object.freeze({ "source.ozon": "marketplace.ozon.adapter", "source.wildberries": "marketplace.wildberries.adapter", "ai.chatgpt": "ai.chatgpt.web.adapter", "ai.alice": "ai.alice.web.adapter" });
  const aiFamilies = new Set(["chatgpt", "alice"]);
  const maxDate = 8640000000000000;
  const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const text = value => typeof value === "string" && value.length > 0;
  const same = (left, right) => text(left) && left === right;
  const parsed = value => { const result = Date.parse(value); return Number.isSafeInteger(result) && result >= 0 && result <= maxDate ? result : null; };
  function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }
  function deny(denied, code) { if (!denied.includes(code)) denied.push(code); }
  function browserFamily() { return browserIdentity?.current?.().family || null; }
  function browserVersion() { return browserIdentity?.current?.().version || null; }
  function bytes(value) { if (!text(value) || !/^[A-Za-z0-9_-]+$/.test(value)) return null; try { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4); const result = Uint8Array.from(atob(padded), char => char.charCodeAt(0)); return verifier.base64urlEncode(result) === value ? result : null; } catch (_) { return null; } }
  async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier.canonicalJson(value))))].map(item => item.toString(16).padStart(2, "0")).join(""); }
  function atLeast(actual, minimum) { const a = typeof actual === "string" && actual.split(".").map(Number), b = typeof minimum === "string" && minimum.split(".").map(Number); if (!a || !b || a.length < 3 || b.length < 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false; for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]; return true; }
  function invalidation(current) { if (current.revoked === true || current.knownRevoke === true || current.knownRevoked === true || current.loggedOut === true || current.authReset === true || current.obsolete === true) return "DENY_AUTH_INVALIDATED"; if (current.storeDeleted === true) return "DENY_STORE_CONTEXT"; return null; }
  function freshness(payload, clock, requestedTime) { const expires = parsed(payload?.expiresAt), grace = parsed(payload?.offlineGraceUntil), server = parsed(payload?.serverTime); const values = [clock?.effectiveTimeMs, clock?.trustedServerTimeMs, server, requestedTime].filter(Number.isSafeInteger); if (expires === null || grace === null || server === null || grace <= expires || values.length < 3 || values.some(value => value < 0 || value > maxDate)) return { state: null, effectiveTimeMs: null }; const effectiveTimeMs = Math.max(...values); return { state: effectiveTimeMs < expires ? "FRESH" : effectiveTimeMs < grace ? "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" : "CACHE_EXPIRED", effectiveTimeMs }; }
  function capability(payload, state, source, marketplace, family) { const sourceKey = sourcePermission[marketplace], aiKey = aiPermission[family]; if (!sourceKey || !aiKey) return { source: null, ai: null, result: null }; try { const result = intersection.evaluateVerifiedMetadata({ metadataVersion: "signed_bootstrap_metadata_v1", source: source === "ONLINE" ? "ONLINE" : "CACHE", freshness: state, executionAuthority: false, configVersion: payload.configVersion, accessBasis: payload.accessBasis, signedEntitlements: payload.entitlements, signedFeatures: payload.features, ai: payload.ai }); const sourceRow = result.capabilities.find(row => row.entitlementKey === sourceKey && row.capabilityId === capabilityId[sourceKey]); const aiRow = result.capabilities.find(row => row.entitlementKey === aiKey && row.capabilityId === capabilityId[aiKey]); return { source: sourceRow || null, ai: aiRow || null, result }; } catch (_) { return { source: null, ai: null, result: null }; } }
  function signedPayloadProjection(payload) {
    if (!plain(payload?.localClientAuthority)) return payload;
    const { compatibility, features, ai, ...signedPayload } = payload;
    return signedPayload;
  }
  function context(value, current, authority, payload, operation) {
    const identity = plain(value.identity) ? value.identity : plain(value.dialogue?.identity) ? value.dialogue.identity : {};
    const family = current.aiFamily || current.aiProvider || identity.ai_id || identity.provider || payload.ai?.detected?.family;
    const origin = current.origin || identity.origin;
    const conversationId = current.conversationId ?? identity.conversationId ?? identity.conversation_id ?? null;
    const conversationKey = current.conversationKey ?? identity.key ?? null;
    const store = plain(value.store) ? value.store : {};
    const binding = plain(value.binding) ? value.binding : plain(value.dialogue?.binding) ? value.dialogue.binding : null;
    const boundStore = binding?.store_context || binding || {};
    const profile = payload.ai?.profile, actualProfile = current.aiProfile || {};
    const gates = {
      account: text(payload.account?.id) && current.accountId === payload.account.id && (current.expectedAccountId === undefined || current.expectedAccountId === payload.account.id),
      device: same(authority.deviceId, current.deviceId) && (current.expectedDeviceId === undefined || current.expectedDeviceId === authority.deviceId),
      session: same(authority.sessionId, current.sessionId) && (current.expectedSessionId === undefined || current.expectedSessionId === authority.sessionId),
      generation: Number.isSafeInteger(authority.generation) && authority.generation === current.generation && (current.expectedGeneration === undefined || current.expectedGeneration === current.generation),
      pageIdentity: (family === "chatgpt" && ["https://chatgpt.com", "https://chat.openai.com"].includes(origin) || family === "alice" && origin === "https://alice.yandex.ru") && (conversationId === null || conversationKey === `${origin}|${conversationId}`),
      aiProfile: payload.ai?.status === "RESOLVED" && aiFamilies.has(family) && payload.ai.detected?.family === family && authority.requestedAi === family && payload.ai.detected?.surface === current.aiSurface && payload.ai.detected?.variant === current.aiVariant && profile?.scopeVariant === null && actualProfile.profileKey === profile.profileKey && actualProfile.revision === profile.revision && actualProfile.scopeVariant === profile.scopeVariant && actualProfile.contentSha256 === profile.contentSha256,
      dialogue: conversationId === null || conversationKey === `${origin}|${conversationId}`,
      store: text(store.accountId) && store.accountId === payload.account?.id && text(store.id || store.storeId) && (current.storeId === undefined || (store.id || store.storeId) === current.storeId) && ["ozon", "wildberries"].includes(store.marketplace) && store.marketplace === current.marketplace && text(store.credentialRevision) && store.credentialRevision === current.credentialRevision && (store.selectedStoreId == null || store.selectedStoreId === store.id || store.selectedStoreId === store.storeId) && (store.expectedStoreId == null || store.expectedStoreId === store.id || store.expectedStoreId === store.storeId),
      binding: !binding ? operation === "START" || operation === "REBIND" : text(binding.binding_id || binding.bindingId) && Number(binding.revision) > 0 && (binding.conversation_key || binding.conversationKey) === conversationKey && (binding.conversation_id || binding.conversationId) === conversationId && binding.origin === origin && (binding.ai_id || binding.provider) === family,
      bindingStore: !binding || boundStore.accountId === payload.account?.id && (boundStore.storeId || boundStore.id) === (store.id || store.storeId) && boundStore.marketplace === store.marketplace && boundStore.credentialRevision === store.credentialRevision,
      credentialRevision: current.expectedCredentialRevision == null || current.expectedCredentialRevision === current.credentialRevision,
      bindingRevision: !binding || current.bindingId == null || (binding.binding_id || binding.bindingId) === current.bindingId && Number(binding.revision) === Number(current.bindingRevision),
      workIntent: current.workStartIntentId === undefined || current.expectedWorkStartIntentId === undefined || current.workStartIntentId === current.expectedWorkStartIntentId,
    };
    if (plain(value.work) && value.work.start_intent_id !== undefined && current.workStartIntentId !== undefined) gates.workIntent = gates.workIntent && value.work.start_intent_id === current.workStartIntentId;
    return { gates, family, origin, conversationId, conversationKey, store, binding };
  }
  async function evaluate(input, options = {}) {
    const value = plain(input) ? input : {}, current = plain(value.current) ? value.current : {}, authority = plain(value.cachedAuthority) ? value.cachedAuthority : plain(value.authority) ? value.authority : null, payload = authority?.payload;
    const rawOperation = value.operation || value.work?.operation;
    const operation = typeof rawOperation === "string" ? rawOperation.toUpperCase() : null, denied = [], gates = {};
    const invalid = invalidation(current); if (invalid) deny(denied, invalid);
    if (!authority || !plain(payload)) { deny(denied, "DENY_AUTH_INVALIDATED"); return freeze({ schemaVersion: "autonomous_work_authority_decision_v1", allowed: false, executionAuthority: false, operation, authorityState: "DENY_AUTH_INVALIDATED", freshness: null, effectiveTimeMs: null, deniedGates: denied, gates, provenanceUsed: false, healthRequired: options.requireHealth === true }); }
    let signed = false; try { const verified = await verifier.verifyV2(authority.envelope, config.trustBundle); const expectedSignedPayload = signedPayloadProjection(payload); signed = authority.verified === true && verified.ok === true && verifier.canonicalJson(verified.payload) === verifier.canonicalJson(expectedSignedPayload); } catch (_) {}
    gates.signedBootstrap = signed; if (!signed) deny(denied, "DENY_AUTH_INVALIDATED");
    const time = freshness(payload, value.cacheClock, value.effectiveTimeMs); gates.freshness = time.state !== null;
    if (time.state === "CACHE_EXPIRED") deny(denied, "DENY_CACHE_EXPIRED"); else if (!gates.freshness) deny(denied, "DENY_AUTH_INVALIDATED");
    const clockOwner = value.cacheClock?.owner || {};
    gates.cacheOwnership = value.cacheClock?.cacheVersion === "control_cache_clock_v1" && clockOwner.controlApiOrigin === config.controlApiOrigin && clockOwner.portalOrigin === config.portalOrigin && clockOwner.contractVersion === config.contractVersion && clockOwner.deviceId === authority.deviceId && clockOwner.sessionId === authority.sessionId && parsed(payload.serverTime) !== null && Number(value.cacheClock?.trustedServerTimeMs) >= parsed(payload.serverTime);
    if (!gates.cacheOwnership) deny(denied, "DENY_AUTH_INVALIDATED");
    gates.bootstrapCompatibility = payload.snapshotVersion === "bootstrap_snapshot_v2" && payload.contractVersion === config.contractVersion && Number.isSafeInteger(payload.configVersion) && payload.configVersion > 0 && payload.account?.status === "ACTIVE" && payload.devicePolicy?.status === "ACTIVE" && ["SUPPORTED", "UPDATE_RECOMMENDED"].includes(payload.compatibility?.extension?.status) && (payload.compatibility?.extension?.minimumVersion === null || atLeast(config.extensionVersion, payload.compatibility.extension.minimumVersion)) && payload.compatibility?.browser?.status === "SUPPORTED";
    if (!gates.bootstrapCompatibility) deny(denied, "DENY_AUTH_INVALIDATED");
    const trustBundleSha256 = await digest(config.trustBundle), expectedAi = payload.ai?.status === "RESOLVED" ? { family: payload.ai.detected.family, surface: payload.ai.detected.surface, variant: payload.ai.detected.variant } : null;
    gates.cacheBinding = plain(authority.cacheBinding) && authority.cacheBinding.cacheVersion === "control_cache_binding_v1" && authority.cacheBinding.controlApiOrigin === config.controlApiOrigin && authority.cacheBinding.portalOrigin === config.portalOrigin && authority.cacheBinding.contractVersion === config.contractVersion && authority.cacheBinding.extensionVersion === config.extensionVersion && authority.cacheBinding.browser?.family === browserFamily() && authority.cacheBinding.browser?.version === browserVersion() && authority.cacheBinding.trustBundleSha256 === trustBundleSha256 && verifier.canonicalJson(authority.cacheBinding.detectedAi) === verifier.canonicalJson(expectedAi);
    if (!gates.cacheBinding) deny(denied, "DENY_AUTH_INVALIDATED");
    const details = context(value, current, authority, payload, operation); Object.assign(gates, details.gates);
    if (!details.gates.account) deny(denied, "DENY_ACCOUNT_MISMATCH");
    if (!details.gates.device || !details.gates.session || !details.gates.generation) deny(denied, "DENY_DEVICE_SESSION_MISMATCH");
    if (!details.gates.aiProfile) deny(denied, "DENY_AI_PROFILE_MISMATCH");
    if (!details.gates.pageIdentity || !details.gates.dialogue) deny(denied, "DENY_BINDING_CONTEXT");
    if (!details.gates.store || !details.gates.bindingStore) deny(denied, "DENY_STORE_CONTEXT");
    if (!details.gates.credentialRevision) deny(denied, "DENY_CREDENTIAL_REVISION");
    if (!details.gates.binding || !details.gates.bindingRevision || !details.gates.workIntent) deny(denied, "DENY_BINDING_CONTEXT");
    const profileDigest = payload.ai?.profile?.contentSha256 ? await digest({ content: payload.ai.profile.content, compatibility: payload.ai.profile.compatibility }) : null;
    gates.aiProfileContent = profileDigest !== null && profileDigest === payload.ai?.profile?.contentSha256;
    if (!gates.aiProfileContent) deny(denied, "DENY_AI_PROFILE_MISMATCH");
    const capabilities = capability(payload, time.state, value.source, details.store.marketplace, details.family); gates.sourceCapability = capabilities.source?.permissionSatisfied === true && capabilities.source?.packaged === true; gates.aiCapability = capabilities.ai?.permissionSatisfied === true && capabilities.ai?.packaged === true;
    if (!gates.sourceCapability || !gates.aiCapability) deny(denied, "DENY_CAPABILITY");
    if (options.requireHealth === true && !(value.health?.status === "PASS" && value.health.current === true && value.health.verified === true)) deny(denied, "DENY_HEALTH_OBSERVATION");
    const state = time.state === "FRESH" ? "ALLOW_FRESH" : time.state === "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" ? "ALLOW_OFFLINE_GRACE" : "DENY_CACHE_EXPIRED";
    const authorityState = denied.length ? (denied.includes("DENY_CACHE_EXPIRED") ? "DENY_CACHE_EXPIRED" : "DENY_CONTEXT") : state;
    return freeze({ schemaVersion: "autonomous_work_authority_decision_v1", allowed: denied.length === 0, executionAuthority: false, operation, authorityState, freshness: time.state, effectiveTimeMs: time.effectiveTimeMs, deniedGates: [...denied], gates, provenanceUsed: false, healthRequired: options.requireHealth === true, capabilityEvidence: capabilities.result ? { source: capabilities.result.source, freshness: capabilities.result.freshness, executionAuthority: false } : null });
  }
  function createProvenance(seed, finalFields = {}) { const value = plain(seed) ? { ...seed, ...finalFields, executionAuthority: false, bearer: false } : null; return value ? freeze(value) : null; }
  Object.defineProperty(globalThis, "SellerAgentsAutonomousWorkAuthority", { value: Object.freeze({ evaluate, createProvenance }), writable: false, configurable: false, enumerable: true });
})();
