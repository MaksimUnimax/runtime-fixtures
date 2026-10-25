/* Privileged browser control-plane client. Tokens and deviceCode never leave this scope. */
(() => {
  "use strict";
  const config = globalThis.SellerAgentsControlConfig;
  const verifier = globalThis.SellerAgentsBootstrapVerifier;
  const browserIdentity = globalThis.SellerAgentsBrowserIdentity;
  const localAuthority = globalThis.SellerAgentsLocalClientAuthority;
  const parallelAuthority = globalThis.SellerAgentsParallelAuthority;
  const STORAGE_KEY = "seller_agents_control_auth_v2";
  const METADATA_CLEAR_KEY = "seller_agents_pending_metadata_clear_v1";
  const METADATA_CLEAR_RECEIPT_KEY = "seller_agents_metadata_clear_receipt_v1";
  const consentApi = globalThis.SellerAgentsTechnicalDataConsent;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MACHINE = /^[a-z0-9][a-z0-9._-]*$/;
  const TOKEN = /^[A-Za-z0-9._~-]{16,4096}$/;
  const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const EXCHANGE_PENDING = "DEVICE_AUTH_PENDING";
  const RETRYABLE_EXCHANGE_STATUS = new Set([429, 500, 502, 503, 504]);
  const CONTROL_REQUEST_DEADLINE_MS = 30000;
  const SUBSCRIPTION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const SUBSCRIPTION_REFRESH_JITTER_MAX_MS = 30 * 60 * 1000;
  const TERMINAL_EXCHANGE_ERRORS = new Set(["DEVICE_AUTH_CLOSED", "DEVICE_AUTH_INVALID", "DEVICE_LIMIT_REACHED", "SUBSCRIPTION_REQUIRED"]);
  const LOCAL_AI = Object.freeze({ chatgpt: Object.freeze({ family: "chatgpt", surface: "web" }), alice: Object.freeze({ family: "alice", surface: "web" }), qwen: Object.freeze({ family: "qwen", surface: "web" }), kimi: Object.freeze({ family: "kimi", surface: "web" }), grok: Object.freeze({ family: "grok", surface: "web" }), gemini: Object.freeze({ family: "gemini", surface: "web" }), claude: Object.freeze({ family: "claude", surface: "web" }), deepseek: Object.freeze({ family: "deepseek", surface: "web" }) });
  const MAX_DATE_MS = 8640000000000000;
  let state = { generation: 0, principalEpoch: 0, accessEpoch: 0, grants: {}, credentials: null, pending: null, rotation: null, authority: null, cacheClock: null, lastError: null };
  let initialized = false, initFlight = null, mutationQueue = Promise.resolve();
  let activationFlight = null, refreshFlight = null, subscriptionRefreshFlight = null, pollingFlight = null, authorityChanged = null;
  let runtimeClockOwner = null, runtimeAnchor = null, runtimeEffectiveHighWatermark = null, runtimeFloorNeedsPersistence = false, runtimeLastCheckpointAllowed = null;
  let bootstrapAttemptSequence = 0;
  let bootstrapScheduler = null;
  const bootstrapAcquisitionScopes = new Map();
  const bootstrapAttempts = new Map();
  let authStorageUnconfirmed = false;
  const verifiedGrantIdentities = new Set();
  const transferVault = globalThis.SellerAgentsCredentialTransferVault;
  const transferRecipientFlights = new Map();
  let metadataForgetFlight = null;
  let metadataForgetEpoch = 0, metadataForgetLastAttempt = null;
  async function clearTransferRecipientVault() {
    if (!transferVault) throw error("TRANSFER_VAULT_UNAVAILABLE");
    try { await transferVault.clear(); } catch (failure) { throw error("TRANSFER_VAULT_CLEAR_FAILED", safeError(failure)); }
  }
  function transferSingleFlight(requestId, fn) {
    const id = String(requestId || "");
    if (transferRecipientFlights.has(id)) return transferRecipientFlights.get(id);
    const run = Promise.resolve().then(fn).finally(() => { if (transferRecipientFlights.get(id) === run) transferRecipientFlights.delete(id); });
    transferRecipientFlights.set(id, run);
    return run;
  }
  const transportProvenance = new WeakMap();
  const httpErrorProvenance = new WeakMap();
  function error(code, detail) { const value = Object.assign(new Error(code), { code }); if (detail !== undefined) value.detail = detail; return value; }
  function now() { return Date.now(); }
  function validMillis(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS; }
  function parsedMillis(value) { const result = Date.parse(value); return validMillis(result) ? result : null; }
  function monotonicNow() { const value = globalThis.performance && typeof globalThis.performance.now === "function" ? globalThis.performance.now() : NaN; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.ceil(value))) throw error("CACHE_MONOTONIC_INVALID"); return value; }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function key() { return crypto.randomUUID(); }
  function origin(value) { try { return typeof value === "string" && value === new URL(value).origin; } catch (_) { return false; } }
  function url(path, base) { const root = base || config.controlApiOrigin; if (!origin(root) || ![config.controlApiOrigin, config.portalOrigin].includes(root)) throw error("PACKAGED_ORIGIN_INVALID"); return new URL(path, `${root}/`).toString(); }
  const BOOTSTRAP_DIAGNOSTIC_STAGES = new Set(["REQUEST_FAMILY", "REQUEST_IDENTITY", "SIGNED_AUTHORITY"]);
  const BOOTSTRAP_DIAGNOSTIC_CHECKS = new Set(["REQUESTED_AI_KNOWN", "REQUEST_SURFACE", "REQUEST_VARIANT", "PAYLOAD_PRESENT", "ACCESS_BASIS_ALLOWED", "ACCOUNT_ACTIVE", "DEVICE_ACTIVE", "EXTENSION_STATUS_ALLOWED", "BROWSER_SUPPORTED", "EXTENSION_MINIMUM", "AI_UNCONFIGURED_SCOPE", "AI_UNAVAILABLE_LOCAL", "AI_RESOLVED", "PROFILE_SHAPE", "PROFILE_BROWSER_FAMILY", "PROFILE_EXTENSION_MINIMUM", "PROFILE_BROWSER_MINIMUM", "AI_PROFILE_SCOPE", "PROFILE_FINGERPRINT", "PAYLOAD_VARIANT", "LOCAL_MATERIALIZATION", "VALIDATOR_COMPLETED"]);
  function bootstrapCheck(checks, check, passed) { if (checks) checks.push({ check, passed: Boolean(passed) }); return passed; }
  function safeBootstrapDiagnostic(value) {
    if (value?.diagnosticVersion !== "bootstrap_rejection_v1" || !BOOTSTRAP_DIAGNOSTIC_STAGES.has(value.stage) || typeof value.recordedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.recordedAt) || !Number.isFinite(Date.parse(value.recordedAt)) || !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 24 || !value.checks.every(row => BOOTSTRAP_DIAGNOSTIC_CHECKS.has(row?.check) && typeof row.passed === "boolean")) return null;
    return { diagnosticVersion: "bootstrap_rejection_v1", stage: value.stage, recordedAt: value.recordedAt, checks: value.checks.map(row => ({ check: row.check, passed: row.passed })) };
  }
  function bootstrapProfileFailure(stage, checks) {
    const failure = error("BOOTSTRAP_PROFILE_INCOMPATIBLE");
    failure.bootstrapDiagnostic = { diagnosticVersion: "bootstrap_rejection_v1", stage, recordedAt: new Date(now()).toISOString(), checks };
    return failure;
  }
  function safeError(value) { const code = typeof value?.code === "string" ? value.code : "CONTROL_REQUEST_FAILED"; const result = { code: code.slice(0, 80) }; const diagnostic = result.code === "BOOTSTRAP_PROFILE_INCOMPATIBLE" ? safeBootstrapDiagnostic(value?.bootstrapDiagnostic) : null; if (diagnostic) result.bootstrapDiagnostic = diagnostic; return result; }
  function queueMutation(fn) { const run = mutationQueue.then(fn); mutationQueue = run.catch(() => {}); return run; }
  async function persist(next) {
    if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    const expected = { ...clone(next), authStateSchema: 2 };
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: expected });
      const observed = await chrome.storage.local.get(STORAGE_KEY);
      if (!observed?.[STORAGE_KEY] || verifier.canonicalJson(observed[STORAGE_KEY]) !== verifier.canonicalJson(expected))
        throw error("AUTH_STATE_READBACK_MISMATCH");
    } catch (failure) {
      authStorageUnconfirmed = true;
      state = { ...state, generation: state.generation + 1, accessEpoch: epoch("accessEpoch") + 1,
        grants: {}, authority: null, lastError: { code: "AUTH_STATE_COMMIT_UNCONFIRMED" } };
      queueMicrotask(() => { void notifyAuthorityChange(null, "AUTH_STATE_COMMIT_UNCONFIRMED", state.generation); });
      throw Object.assign(error("AUTH_STATE_COMMIT_UNCONFIRMED"), { cause: safeError(failure) });
    }
  }
  function sameAuthorityIdentity(left, right) { return Boolean(left && right && left.deviceId === right.deviceId && left.sessionId === right.sessionId && left.generation === right.generation && left.requestedAi === right.requestedAi && left.payload?.account?.id === right.payload?.account?.id); }
  function authorityProfileIdentity(authority) {
    const ai = authority?.payload?.ai;
    if (ai?.status !== "RESOLVED" || !ai.profile) return null;
    return verifier.canonicalJson({
      requestedAi: authority?.requestedAi ?? null,
      detected: ai.detected || null,
      profile: {
        profileKey: ai.profile.profileKey || null,
        revision: ai.profile.revision ?? null,
        scopeVariant: ai.profile.scopeVariant ?? null,
        contentSha256: ai.profile.contentSha256 || null
      }
    });
  }
  function authorityNeedsInvalidation(previous, next, reason) { if (!previous || !next) return Boolean(previous || next); if (!sameAuthorityIdentity(previous, next)) return true; if (["refresh_invalid", "bootstrap_unauthorized", "authority_invalid", "local_reset"].includes(reason)) return true; if (previous.workAllowed && !next.workAllowed) return true; return staticCanWork(previous.payload) && !staticCanWork(next.payload); }
  async function commit(next, previous = state.authority, reason = "state_changed", scopeNotice = null) {
    const changed = authorityNeedsInvalidation(previous, next.authority, reason);
    const profileChanged = authorityProfileIdentity(previous) !== authorityProfileIdentity(next.authority);
    await persist(next);
    state = next;
    if ((changed || profileChanged) && typeof authorityChanged === "function") {
      const notificationReason = changed ? reason : "profile_changed";
      try { await authorityChanged(clone(state.authority), notificationReason, state.generation, scopeNotice); } catch (_) { /* guards remain authoritative */ }
    }
    return true;
  }
  function isCurrent(context) {
    if (!context || state.generation !== context.generation) return false;
    if (context.attemptId && state.pending?.attemptId !== context.attemptId) return false;
    if (context.deviceId && state.credentials?.deviceId !== context.deviceId) return false;
    if (context.sessionId && state.credentials?.sessionId !== context.sessionId) return false;
    if (context.rotationKey && state.rotation?.idempotencyKey !== context.rotationKey) return false;
    return true;
  }
  function validContext(context) {
    if (!context || typeof context !== "object" || !Number.isSafeInteger(context.generation) || context.generation < 0) return false;
    return ["attemptId", "deviceId", "sessionId", "rotationKey"].every(key => context[key] === undefined || context[key] === null || typeof context[key] === "string");
  }
  function contextForState(extra = {}) { return { generation: state.generation, attemptId: state.pending?.attemptId || null, deviceId: state.credentials?.deviceId || null, sessionId: state.credentials?.sessionId || null, ...extra }; }
  function commitIfCurrent(context, updater, reason = "state_changed") { return queueMutation(async () => { if (!isCurrent(context)) return false; const next = await updater(clone(state)); if (!next || !isCurrent(context)) return false; await commit(next, state.authority, reason); return true; }); }
  function validCredentials(value) { return value && UUID.test(value.deviceId) && UUID.test(value.sessionId) && value.tokenType === "Bearer" && TOKEN.test(value.accessToken) && OPAQUE_TOKEN.test(value.refreshToken) && Number.isFinite(Date.parse(value.accessTokenExpiresAt)) && Number.isFinite(Date.parse(value.refreshTokenExpiresAt)); }
  function validAuthContext(value) { return exactKeys(value, ["contextVersion", "controlApiOrigin", "portalOrigin", "contractVersion"]) && value.contextVersion === "control_auth_context_v1" && origin(value.controlApiOrigin) && origin(value.portalOrigin) && typeof value.contractVersion === "string" && value.controlApiOrigin === config.controlApiOrigin && value.portalOrigin === config.portalOrigin && value.contractVersion === config.contractVersion; }
  function validStarting(value) { return exactKeys(value, ["phase", "attemptId", "startIdempotencyKey", "authContext"], ["metadataMode"]) && (!Object.hasOwn(value, "metadataMode") || ["identified", "privacy_neutral"].includes(value.metadataMode)) && value.phase === "starting" && typeof value.attemptId === "string" && value.attemptId.length > 0 && TOKEN.test(value.startIdempotencyKey) && validAuthContext(value.authContext); }
  function validPending(value) { return exactKeys(value, ["phase", "attemptId", "authorizationId", "deviceCode", "userCode", "expiresAt", "startIdempotencyKey", "exchangeIdempotencyKey", "authContext"], ["metadataMode"]) && (!Object.hasOwn(value, "metadataMode") || ["identified", "privacy_neutral"].includes(value.metadataMode)) && value.phase === "pending" && typeof value.attemptId === "string" && value.attemptId.length > 0 && UUID.test(value.authorizationId) && OPAQUE_TOKEN.test(value.deviceCode) && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(value.userCode) && Number.isFinite(Date.parse(value.expiresAt)) && TOKEN.test(value.startIdempotencyKey) && TOKEN.test(value.exchangeIdempotencyKey) && validAuthContext(value.authContext); }
  function validRestoredPending(value) { return validStarting(value) || validPending(value) && parsedMillis(value.expiresAt) > now(); }
  function pendingLive(value) { return value?.phase !== "starting" && validPending(value) && Date.parse(value.expiresAt) > now(); }
  function publicPending(value) { if (!value) return null; return { authorizationId: value.authorizationId, userCode: value.userCode, expiresAt: value.expiresAt, verificationUri: url(`/activate?authorizationId=${encodeURIComponent(value.authorizationId)}`, config.portalOrigin) }; }
  function publicStatus(decision = null) { const authority = state.grants?.[decision?.scopeKey]?.authority || state.authority, accountId = authority?.payload?.account?.id || null, snapshot = authority?.payload || null, matching = isCurrentScopedDecision(decision) && sameAuthorityRuntimeIdentity(decision.identity, authorityDecisionIdentity(authority)); const compatibility = snapshot?.compatibility ? { extension: { status: snapshot.compatibility.extension.status, minimumVersion: snapshot.compatibility.extension.minimumVersion }, browser: { status: snapshot.compatibility.browser.status } } : null; return Object.freeze({ authenticated: Boolean(state.credentials && authority && accountId), bootstrapRetryAvailable: Boolean(state.credentials && !state.authority), accountId, account: accountId ? { kind: "control_account", label: `Аккаунт · ${accountId.slice(0, 8)}` } : null, pending: pendingLive(state.pending) ? publicPending(state.pending) : null, lastError: state.lastError ? safeError(state.lastError) : null, generation: state.generation, workAllowed: Boolean(accountId && matching && decision.allowed === true), authority: authority ? { configVersion: snapshot.configVersion, expiresAt: snapshot.expiresAt, aiStatus: snapshot.ai.status } : null, compatibility }); }
  function authorityStaticValid(snapshot, checks = null) {
    const extension = snapshot?.compatibility?.extension;
    const accessAllowed = snapshot?.contractVersion !== "control_plane_v3" || snapshot?.accessBasis !== "NONE";
    return Boolean(bootstrapCheck(checks, "PAYLOAD_PRESENT", snapshot) && bootstrapCheck(checks, "ACCESS_BASIS_ALLOWED", accessAllowed) && bootstrapCheck(checks, "ACCOUNT_ACTIVE", snapshot.account?.status === "ACTIVE") && bootstrapCheck(checks, "DEVICE_ACTIVE", snapshot.devicePolicy?.status === "ACTIVE") && bootstrapCheck(checks, "EXTENSION_STATUS_ALLOWED", ["SUPPORTED", "UPDATE_RECOMMENDED"].includes(extension?.status)) && bootstrapCheck(checks, "BROWSER_SUPPORTED", snapshot.compatibility?.browser?.status === "SUPPORTED") && bootstrapCheck(checks, "EXTENSION_MINIMUM", extension.minimumVersion === null || (parseSemver(extension.minimumVersion) && versionAtLeast(config.extensionVersion, extension.minimumVersion))));
  }
  function cacheAuthorityDeadline(snapshot) {
    const expiresAt = parsedMillis(snapshot?.expiresAt);
    if (expiresAt === null) return null;
    if (snapshot?.contractVersion !== "control_plane_v3") return parsedMillis(snapshot?.offlineGraceUntil);
    if (snapshot.accessBasis === "COMMERCIAL") {
      const access = snapshot.subscriptionAccess;
      if (access === null) return expiresAt;
      const paidThrough = parsedMillis(access?.paidThrough), offlineHardUntil = parsedMillis(access?.offlineHardUntil);
      return paidThrough !== null && offlineHardUntil !== null && offlineHardUntil - paidThrough === 72 * 60 * 60 * 1000 ? offlineHardUntil : null;
    }
    return snapshot.accessBasis === "BETA" ? parsedMillis(snapshot.offlineGraceUntil) : expiresAt;
  }
  function authorityBaseValid(snapshot, effectiveTimeMs) {
    const expiresAt = parsedMillis(snapshot?.expiresAt), deadline = cacheAuthorityDeadline(snapshot);
    const legacyGraceRequired = snapshot?.contractVersion !== "control_plane_v3" || snapshot?.accessBasis === "BETA";
    return Boolean(authorityStaticValid(snapshot) && validMillis(effectiveTimeMs) && expiresAt !== null && deadline !== null && (!legacyGraceRequired || deadline > expiresAt) && effectiveTimeMs < deadline);
  }
  function staticCanWork(snapshot) { return Boolean(authorityStaticValid(snapshot) && snapshot.ai?.status === "RESOLVED" && ["chatgpt", "alice", "qwen", "kimi", "grok", "gemini", "claude", "deepseek"].includes(snapshot.ai.detected?.family)); }
  function canWork(snapshot, effectiveTimeMs) { return Boolean(authorityBaseValid(snapshot, effectiveTimeMs) && snapshot.ai?.status === "RESOLVED" && ["chatgpt", "alice", "qwen", "kimi", "grok", "gemini", "claude", "deepseek"].includes(snapshot.ai.detected?.family)); }
  function currentBrowserIdentity() { const detected = browserIdentity?.current?.(); if (!detected?.family || !detected?.version || !browserIdentity.families.includes(detected.family)) throw error("UNSUPPORTED_BROWSER"); return detected; }
  function browserFamily() { return currentBrowserIdentity().family; }
  function browserVersion() { return currentBrowserIdentity().version; }
  function clockOwner(credentials) { return { controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion, deviceId: credentials.deviceId, sessionId: credentials.sessionId }; }
  function authorityIdentity(authority = state.authority, generation = state.generation) { return authority ? { generation, deviceId: authority.deviceId, sessionId: authority.sessionId, accountId: authority.payload?.account?.id || null, requestedAi: authority.requestedAi ?? null } : null; }
  function authorityDecisionIdentity(authority = state.authority, generation = state.generation) { return authority ? verifier.canonicalJson({ generation, deviceId: authority.deviceId, sessionId: authority.sessionId, requestedAi: authority.requestedAi ?? null, accountId: authority.payload?.account?.id || null, envelope: authority.envelope, cacheBinding: authority.cacheBinding }) : null; }
  function sameAuthorityRuntimeIdentity(left, right) { return Boolean(left && right && verifier.canonicalJson(left) === verifier.canonicalJson(right)); }
  function validCacheBinding(value) {
    if (!exactKeys(value, ["cacheVersion", "controlApiOrigin", "portalOrigin", "contractVersion", "extensionVersion", "browser", "detectedAi", "trustBundleSha256"]) || value.cacheVersion !== "control_cache_binding_v1" || !origin(value.controlApiOrigin) || !origin(value.portalOrigin) || typeof value.contractVersion !== "string" || typeof value.extensionVersion !== "string" || !exactKeys(value.browser, ["family", "version"]) || !browserIdentity?.families?.includes(value.browser.family) || !parseBrowser(value.browser.version) || !(value.detectedAi === null || exactKeys(value.detectedAi, ["family", "surface", "variant"]) && LOCAL_AI[value.detectedAi.family] && value.detectedAi.surface === LOCAL_AI[value.detectedAi.family].surface && value.detectedAi.variant === null) || !/^[0-9a-f]{64}$/.test(value.trustBundleSha256)) return false;
    return true;
  }
  function validCacheClockShape(value, payload = null) {
    if (!exactKeys(value, ["cacheVersion", "owner", "trustedServerTimeMs", "effectiveTimeMs"]) || value.cacheVersion !== "control_cache_clock_v1" || !exactKeys(value.owner, ["controlApiOrigin", "portalOrigin", "contractVersion", "deviceId", "sessionId"]) || !origin(value.owner.controlApiOrigin) || !origin(value.owner.portalOrigin) || typeof value.owner.contractVersion !== "string" || value.owner.contractVersion.length < 1 || !UUID.test(value.owner.deviceId) || !UUID.test(value.owner.sessionId) || !validMillis(value.trustedServerTimeMs) || !validMillis(value.effectiveTimeMs) || value.effectiveTimeMs < value.trustedServerTimeMs) return false;
    if (payload) { const serverTimeMs = parsedMillis(payload.serverTime); if (serverTimeMs === null || value.trustedServerTimeMs < serverTimeMs || payload.contractVersion === "control_plane_v3" && value.trustedServerTimeMs !== serverTimeMs) return false; }
    return true;
  }
  function validCacheClock(value, credentials, payload = null) { if (!validCacheClockShape(value, payload) || !credentials) return false; const owner = value.owner; return owner.controlApiOrigin === config.controlApiOrigin && owner.portalOrigin === config.portalOrigin && owner.deviceId === credentials.deviceId && owner.sessionId === credentials.sessionId; }
  function expectedCacheContract(payload = null) { return payload?.contractVersion === "control_plane_v3" ? "control_plane_v3" : config.contractVersion; }
  async function trustBundleDigest() { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier.canonicalJson(config.trustBundle))))].map(value => value.toString(16).padStart(2, "0")).join(""); }
  async function expectedCacheBinding(payload, requestedAi = null) { const detectedAi = payload?.ai?.status === "RESOLVED" ? { family: payload.ai.detected.family, surface: payload.ai.detected.surface, variant: payload.ai.detected.variant } : null; return { cacheVersion: "control_cache_binding_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: expectedCacheContract(payload), extensionVersion: config.extensionVersion, browser: { family: browserFamily(), version: browserVersion() }, detectedAi, trustBundleSha256: await trustBundleDigest() }; }
  async function verifyCachedEnvelope(envelope) {
    if (envelope?.envelopeVersion === "bootstrap_envelope_v3" && typeof verifier.verifyV3 === "function") return verifier.verifyV3(envelope, config.trustBundle);
    if (envelope?.envelopeVersion === "bootstrap_envelope_v2") return verifier.verifyV2(envelope, config.trustBundle);
    return { ok: false, error: "INVALID_ENVELOPE" };
  }
  function validRuntimeOwner(owner) { return typeof owner === "string" && owner.length > 0; }
  function effectiveTime(clock, payload = state.authority?.payload || null) {
    if (!validCacheClock(clock, state.credentials, payload)) throw error("CACHE_CLOCK_INVALID");
    const wall = Date.now();
    if (!validMillis(wall)) throw error("CACHE_WALL_CLOCK_INVALID");
    const monotonic = monotonicNow();
    const owner = verifier.canonicalJson({ controlApiOrigin: clock.owner.controlApiOrigin, portalOrigin: clock.owner.portalOrigin, deviceId: clock.owner.deviceId, sessionId: clock.owner.sessionId });
    if (runtimeClockOwner !== owner) {
      runtimeClockOwner = owner;
      const initial = Math.max(wall, clock.trustedServerTimeMs, clock.effectiveTimeMs);
      if (!validMillis(initial)) throw error("CACHE_EFFECTIVE_TIME_INVALID");
      runtimeAnchor = { effectiveNowMs: initial, monotonicNowMs: monotonic };
      runtimeEffectiveHighWatermark = runtimeAnchor.effectiveNowMs;
    } else {
      if (!runtimeAnchor || monotonic < runtimeAnchor.monotonicNowMs) throw error("CACHE_MONOTONIC_DECREASING");
      runtimeEffectiveHighWatermark = Math.max(runtimeEffectiveHighWatermark, clock.effectiveTimeMs);
    }
    const elapsed = monotonic - runtimeAnchor.monotonicNowMs;
    const anchoredRaw = runtimeAnchor.effectiveNowMs + elapsed;
    if (!Number.isFinite(anchoredRaw) || anchoredRaw < 0 || anchoredRaw > MAX_DATE_MS) throw error("CACHE_EFFECTIVE_TIME_INVALID");
    const anchored = Math.ceil(anchoredRaw);
    const result = Math.max(wall, clock.trustedServerTimeMs, clock.effectiveTimeMs, runtimeEffectiveHighWatermark, anchored);
    if (!validMillis(result)) throw error("CACHE_EFFECTIVE_TIME_INVALID");
    if (result < runtimeAnchor.effectiveNowMs) throw error("CACHE_EFFECTIVE_TIME_REGRESSION");
    runtimeAnchor = { effectiveNowMs: result, monotonicNowMs: monotonic };
    runtimeEffectiveHighWatermark = Math.max(runtimeEffectiveHighWatermark, result);
    return result;
  }
  function epoch(name) {
    const value = state[name] === undefined ? state.generation : state[name];
    if (!Number.isSafeInteger(value) || value < 0) throw error("AUTH_EPOCH_INVALID");
    return value;
  }
  function requestedFamily(identity) {
    const family = typeof identity === "string" ? identity : identity?.ai_id || identity?.family;
    return LOCAL_AI[family] ? family : null;
  }
  function grantFor(identity) {
    const family = requestedFamily(identity);
    if (!family || !state.credentials || !state.authority || !state.grants || typeof state.grants !== "object" || Array.isArray(state.grants)) return null;
    const matches = Object.values(state.grants).filter(record => record?.authority?.requestedAi === family &&
      record.principalEpoch === epoch("principalEpoch") && record.accessEpoch === epoch("accessEpoch") &&
      record.authority.generation === state.generation && record.authority.deviceId === state.credentials.deviceId &&
      record.authority.sessionId === state.credentials.sessionId && record.authority.payload?.account?.id === state.authority.payload?.account?.id);
    if (matches.length > 1) throw error("AUTH_GRANT_AMBIGUOUS");
    return matches[0] || null;
  }
  function grantIdentity(record) {
    return record ? verifier.canonicalJson({ scopeKey: record.scopeKey, environmentKey: record.environmentKey,
      principalEpoch: record.principalEpoch, accessEpoch: record.accessEpoch, grantEpoch: record.grantEpoch,
      authority: authorityDecisionIdentity(record.authority) }) : null;
  }
  async function scopeIdentityFor(authority) {
    if (!parallelAuthority?.createScopeIdentity || !state.credentials) throw error("AUTH_SCOPE_UNAVAILABLE");
    return parallelAuthority.createScopeIdentity({ controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin,
      allowedOrigins: [config.controlApiOrigin, config.portalOrigin], development: config.environment === "LOCAL DEVELOPMENT",
      accountId: authority.payload?.account?.id, deviceId: state.credentials.deviceId, sessionId: state.credentials.sessionId,
      principalEpoch: epoch("principalEpoch"), contractVersion: expectedCacheContract(authority.payload),
      extensionVersion: config.extensionVersion, browser: currentBrowserIdentity(), trustBundleSha256: await trustBundleDigest(),
      privacyProjection: authority.privacyNeutral === true ? "privacy-neutral" : "identified",
      ai: { family: authority.requestedAi, surface: LOCAL_AI[authority.requestedAi]?.surface, variant: null } },
    { canonicalJson: verifier.canonicalJson,
      sha256: async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, "0")).join("") });
  }
  function grantRights(authority) {
    const payload = clone(authority.payload);
    for (const field of ["serverTime", "expiresAt", "offlineGraceUntil", "configVersion"]) delete payload[field];
    // Signed profile content and compatibility are execution rights, including its revision.
    return verifier.canonicalJson(payload);
  }
  async function makeGrant(authority, cacheClock) {
    const scope = await scopeIdentityFor(authority), previous = grantFor(authority.requestedAi);
    const changed = !previous || previous.authority.workAllowed !== true || grantRights(previous.authority) !== grantRights(authority);
    const grantEpoch = (previous?.grantEpoch || 0) + (changed ? 1 : 0);
    if (!Number.isSafeInteger(grantEpoch)) throw error("AUTH_GRANT_EPOCH_EXHAUSTED");
    const record = { schemaVersion: 1, ...scope, principalEpoch: epoch("principalEpoch"), accessEpoch: epoch("accessEpoch"), grantEpoch,
      authority: { ...authority, scopeKey: scope.scopeKey, principalEpoch: epoch("principalEpoch"), accessEpoch: epoch("accessEpoch"), grantEpoch },
      cacheClock: clone(cacheClock) };
    verifiedGrantIdentities.add(grantIdentity(record));
    return record;
  }
  async function verifyStoredGrant(record) {
    const identity = grantIdentity(record);
    if (verifiedGrantIdentities.has(identity)) return true;
    const authority = record?.authority;
    if (record?.schemaVersion !== 1 || !Number.isSafeInteger(record.grantEpoch) || record.grantEpoch < 1 ||
        !state.credentials || authority?.deviceId !== state.credentials.deviceId || authority?.sessionId !== state.credentials.sessionId ||
        authority?.generation !== state.generation || authority?.payload?.account?.id !== state.authority?.payload?.account?.id)
      throw error("STORED_GRANT_CONTEXT_MISMATCH");
    const verified = await verifyCachedEnvelope(authority.envelope);
    if (!verified.ok) throw error("STORED_GRANT_" + verified.error);
    const payload = verified.payload.localClientAuthority ? await materializeLocalAuthority(verified.payload, authority.requestedAi) : verified.payload;
    if (verifier.canonicalJson(payload) !== verifier.canonicalJson(authority.payload)) throw error("STORED_GRANT_PAYLOAD_MISMATCH");
    const policy = await validateAccountProfile(payload, authority.requestedAi, true);
    if (!policy || !validCacheClock(record.cacheClock, state.credentials, verified.payload)) throw error("STORED_GRANT_POLICY_MISMATCH");
    const expected = await expectedCacheBinding(payload, authority.requestedAi), scope = await scopeIdentityFor(authority);
    if (verifier.canonicalJson(expected) !== verifier.canonicalJson(authority.cacheBinding) || scope.scopeKey !== record.scopeKey || scope.environmentKey !== record.environmentKey)
      throw error("STORED_GRANT_SCOPE_MISMATCH");
    if (identity !== grantIdentity(grantFor(authority.requestedAi))) throw error("AUTH_GENERATION_CHANGED");
    verifiedGrantIdentities.add(identity); return true;
  }
  async function materializeLegacyScopedGrant(family) {
    if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    let record = grantFor(family);
    // Migrate only the already verified legacy authority, retaining its clock and TTL.
    if (!record && family && state.authority?.requestedAi === family && state.authority.workAllowed === true) {
      const oldIdentity = authorityDecisionIdentity();
      const migrated = await makeGrant(state.authority, state.cacheClock);
      await queueMutation(async () => {
        if (oldIdentity !== authorityDecisionIdentity()) throw error("AUTH_GENERATION_CHANGED");
        const next = { ...state, grants: { ...(state.grants || {}), [migrated.scopeKey]: migrated } };
        await persist(next); state = next;
      });
      record = grantFor(family);
    }
    return record;
  }
  async function scopedCacheCheckpoint(identity, acquisitionLease = null) {
    try { return await scopedCacheCheckpointActive(identity, acquisitionLease); }
    catch (failure) {
      if (authStorageUnconfirmed && failure?.code === "AUTH_STATE_COMMIT_UNCONFIRMED") {
        // The failed/held write has settled before this catch. Serialize the
        // existing fail-closed AUTH removal and verify restart protection.
        await queueMutation(async () => {
          try {
            await chrome.storage.local.remove(STORAGE_KEY);
            const observed = await chrome.storage.local.get(STORAGE_KEY);
            if (observed?.[STORAGE_KEY] !== undefined) throw error("AUTH_DENIAL_REMOVE_READBACK_FAILED");
            state = { ...state, credentials: null, authority: null, grants: {}, cacheClock: null };
          } catch (_) {
            state = { ...state, lastError: { code: "AUTH_DENIAL_PERSISTENCE_FAILED" } };
          }
        });
      }
      // Work-facing reads keep the existing boolean fail-closed contract.
      // Acquisitions must still propagate the exact failure to their lease.
      if (acquisitionLease) throw failure;
      return { allowed: false, persistenceFailure: authStorageUnconfirmed, checkpointFailed: true };
    }
  }
  async function scopedCacheCheckpointActive(identity, acquisitionLease = null) {
    if (authStorageUnconfirmed) return { allowed: false, persistenceFailure: true };
    const family = requestedFamily(identity);
    const record = await materializeLegacyScopedGrant(family);
    if (!record) return { allowed: false, missing: true };
    try { await verifyStoredGrant(record); }
    catch (failure) { await invalidateKnown(contextForState(), failure, false); return { allowed: false, invalid: true }; }
    const captured = grantIdentity(record);
    const outcome = await queueMutation(async () => {
      const current = grantFor(family);
      if (!current || captured !== grantIdentity(current)) return { allowed: false, stale: true };
      acquisitionLease?.assertCurrent();
      let effective = effectiveTime(current.cacheClock, current.authority.payload);
      let allowed = current.authority.workAllowed === true && canWork(current.authority.payload, effective);
      let denied = current.authority.workAllowed === true && !allowed;
      const updatedRecord = () => {
        const grantEpoch = current.grantEpoch + (denied ? 1 : 0);
        if (!Number.isSafeInteger(grantEpoch)) throw error("AUTH_GRANT_EPOCH_EXHAUSTED");
        return { ...current, grantEpoch, cacheClock: { ...current.cacheClock, effectiveTimeMs: Math.max(current.cacheClock.effectiveTimeMs, effective) },
          authority: { ...current.authority, workAllowed: allowed, grantEpoch } };
      };
      const updatedState = updated => ({ ...state, grants: { ...state.grants, [current.scopeKey]: updated },
        cacheClock: state.cacheClock ? { ...state.cacheClock, effectiveTimeMs: Math.max(state.cacheClock.effectiveTimeMs, effective) } : state.cacheClock,
        authority: state.authority?.scopeKey === current.scopeKey ? updated.authority : state.authority });
      let updated = updatedRecord(), next = updatedState(updated);
      acquisitionLease?.beginSecurityCommit();
      if (denied) state = next; // Denial precedes every storage await.
      await persist(next);
      if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
      state = next;
      // A held storage write cannot return an allow after the signed deadline.
      const completion = effectiveTime(updated.cacheClock, updated.authority.payload);
      if (allowed && !canWork(updated.authority.payload, completion)) {
        effective = completion; allowed = false; denied = true;
        updated = updatedRecord(); next = updatedState(updated); state = next;
        await persist(next);
        if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
      }
      if (denied) acquisitionLease?.finishRevocationCommit();
      else acquisitionLease?.finishSecurityCommit();
      verifiedGrantIdentities.add(grantIdentity(updated));
      return { allowed, effectiveTimeMs: Math.max(effective, completion), identity: authorityDecisionIdentity(updated.authority), grantIdentity: grantIdentity(updated), scopeKey: updated.scopeKey,
        grant: clone(updated), changed: denied };
    });
    if (outcome.changed) queueMicrotask(() => { void notifyAuthorityChange(outcome.grant.authority, "cache_time_expired", state.generation,
      { scopeKey: outcome.scopeKey, requestedAi: family }); });
    return outcome;
  }
  function isCurrentScopedDecision(decision) {
    const current = decision?.scopeKey ? state.grants?.[decision.scopeKey] : null;
    return Boolean(!authStorageUnconfirmed && state.credentials && current && decision.allowed === true
      && decision.grantIdentity === grantIdentity(current));
  }
  async function workDecisionFor(identity = null) {
    if (authStorageUnconfirmed) return { allowed: false, persistenceFailure: true };
    const family = requestedFamily(identity);
    if (identity !== null && !family) return { allowed: false, unsupported: true };
    if (family) return scopedCacheCheckpoint(family);
    const families = [...new Set(Object.values(state.grants || {}).map(g => g?.authority?.requestedAi).filter(f => LOCAL_AI[f]))];
    if (!families.length && LOCAL_AI[state.authority?.requestedAi]) families.push(state.authority.requestedAi);
    for (const candidate of families) {
      const decision = await scopedCacheCheckpoint(candidate);
      if (decision.allowed === true) return decision;
    }
    return { allowed: false };
  }
  async function authorityFor(identity = null) {
    await init();
    if (authStorageUnconfirmed) return null;
    if (identity === null) {
      const decision = await cacheAuthorizationCheckpoint(), authority = clone(state.authority);
      if (authority && !(decision.identity === authorityDecisionIdentity() && decision.allowed === true)) authority.workAllowed = false;
      return authority;
    }
    const decision = await workDecisionFor(identity), record = grantFor(identity);
    if (!record) return null;
    const authority = clone(record.authority);
    if (!isCurrentScopedDecision(decision) || decision.identity !== authorityDecisionIdentity(record.authority)) authority.workAllowed = false;
    return authority;
  }
  function currentWorkDecision(effectiveTimeMs) { const authority = state.authority; return { allowed: Boolean(authority && canWork(authority.payload, effectiveTimeMs)), effectiveTimeMs }; }
  async function notifyAuthorityChange(authority, reason, generation, scopeNotice = null) { if (typeof authorityChanged === "function") { try { await authorityChanged(clone(authority), reason, generation, scopeNotice); } catch (_) {} } }
  async function cacheAuthorizationCheckpoint() {
    if (authStorageUnconfirmed) return { allowed: false, persistenceFailure: true };
    if (state.authority?.requestedAi && grantFor(state.authority.requestedAi))
      return scopedCacheCheckpoint(state.authority.requestedAi);
    const entryIdentity = authorityDecisionIdentity();
    let outcome;
    try {
      outcome = await queueMutation(async () => {
        if (!entryIdentity || entryIdentity !== authorityDecisionIdentity()) return { allowed: false, stale: true, identity: entryIdentity };
        const clock = state.cacheClock, previous = state.authority;
        let effective;
        try { effective = effectiveTime(clock); }
        catch (failure) {
          return { allowed: false, clockInvalid: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true };
        }
        if (entryIdentity !== authorityDecisionIdentity()) return { allowed: false, stale: true, identity: entryIdentity };
        const decision = currentWorkDecision(effective), floor = Math.max(clock.effectiveTimeMs, effective);
        if (!validMillis(floor)) return { allowed: false, clockInvalid: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true };
        const changed = runtimeFloorNeedsPersistence || floor !== clock.effectiveTimeMs || Boolean(previous?.workAllowed && !decision.allowed);
        const next = changed ? { ...state, cacheClock: { ...clock, effectiveTimeMs: floor }, authority: previous && !decision.allowed ? { ...previous, workAllowed: false } : previous } : state;
        if (changed) state = next;
        if (changed) {
          try { await persist(next); runtimeFloorNeedsPersistence = false; }
          catch (failure) {
            runtimeFloorNeedsPersistence = true;
            try { await chrome.storage.local.remove(STORAGE_KEY); }
            catch (removeFailure) { state = { ...state, lastError: safeError(Object.assign(error("AUTH_DENIAL_PERSISTENCE_FAILED"), { detail: safeError(removeFailure) })) }; return { allowed: false, persistenceFailure: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true && !decision.allowed }; }
            return { allowed: false, persistenceFailure: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true && !decision.allowed };
          }
        }
        if (entryIdentity !== authorityDecisionIdentity()) return { allowed: false, stale: true, identity: entryIdentity };
        let completion;
        try { completion = effectiveTime(state.cacheClock); }
        catch (failure) {
          return { allowed: false, clockInvalid: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true };
        }
        if (entryIdentity !== authorityDecisionIdentity()) return { allowed: false, stale: true, identity: entryIdentity };
        const completionDecision = currentWorkDecision(completion);
        if (completionDecision.allowed && decision.allowed) return { allowed: true, effectiveTimeMs: completion, identity: entryIdentity, generation: state.generation, changed: false };
        const denialFloor = Math.max(state.cacheClock.effectiveTimeMs, completion);
        const denial = { ...state, cacheClock: { ...state.cacheClock, effectiveTimeMs: denialFloor }, authority: state.authority ? { ...state.authority, workAllowed: false } : null };
        state = denial;
        try { await persist(denial); runtimeFloorNeedsPersistence = false; }
        catch (failure) {
          runtimeFloorNeedsPersistence = true;
          try { await chrome.storage.local.remove(STORAGE_KEY); }
          catch (removeFailure) { state = { ...state, lastError: safeError(Object.assign(error("AUTH_DENIAL_PERSISTENCE_FAILED"), { detail: safeError(removeFailure) })) }; }
          return { allowed: false, persistenceFailure: true, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true };
        }
        return { allowed: false, effectiveTimeMs: completion, identity: entryIdentity, generation: state.generation, changed: previous?.workAllowed === true };
      });
    } catch (_) { runtimeLastCheckpointAllowed = false; return { allowed: false, persistenceFailure: true }; }
    const matching = outcome?.identity && outcome.identity === authorityDecisionIdentity();
    runtimeLastCheckpointAllowed = matching && outcome?.allowed === true;
    if (matching && outcome?.changed) { const notificationIdentity = outcome.identity, notificationGeneration = outcome.generation, notificationAuthority = clone(state.authority); queueMicrotask(() => { if (notificationIdentity === authorityDecisionIdentity() && notificationGeneration === state.generation) void notifyAuthorityChange(notificationAuthority, "cache_time_expired", notificationGeneration); }); }
    if (!matching) return { allowed: false, stale: true, identity: outcome?.identity || entryIdentity };
    return outcome || { allowed: false };
  }
  function parseRetryAfter(response) { const value = response.headers?.get("Retry-After"); if (!value) return 1000; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(250, Math.min(60000, seconds * 1000)); const date = Date.parse(value); return Number.isFinite(date) ? Math.max(250, Math.min(60000, date - now())) : 1000; }
  async function readLimitedBody(response, limit = 1024 * 1024) {
    if (!response.body?.getReader) {
      const text = await response.text();
      if (text.length > limit) throw error("CONTROL_RESPONSE_TOO_LARGE");
      return text;
    }
    const reader = response.body.getReader(), chunks = [], decoder = new TextDecoder();
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) { try { await reader.cancel(); } catch (_) {} throw error("CONTROL_RESPONSE_TOO_LARGE"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return decoder.decode(bytes);
  }
  async function request(path, options = {}) {
    const endpoint = url(path), headers = new Headers(options.headers || {}), requestOptions = { ...options };
    headers.set("Accept", "application/json");
    const captureProjection = requestOptions.captureProjection, observeSettlement = requestOptions.observeSettlement;
    delete requestOptions.captureProjection;
    delete requestOptions.observeSettlement;
    const requestPath = new URL(endpoint).pathname;
    const treeRequest = requestPath === "/v1/ai-prompt-tree";
    if (treeRequest || requestPath === "/v1/bootstrap" || requestPath === "/v1/health-authority") {
      requestOptions.cache = "no-store";
      headers.set("Cache-Control", "no-store");
    }
    const projectionKind = requestPath === "/v1/device-authorizations" ? "device_authorization" : requestPath === "/v1/bootstrap" || treeRequest ? "bootstrap" : requestPath === "/v1/health-authority" ? "health_authority" : null;
    if (projectionKind && requestOptions.body && typeof requestOptions.body === "object" && consentApi?.projectControlRequest) {
      const projection = await consentApi.projectControlRequest(projectionKind, treeRequest ? requestOptions.body.bootstrap : requestOptions.body);
      requestOptions.body = treeRequest ? { ...requestOptions.body, bootstrap: projection.body } : projection.body;
      if (typeof captureProjection === "function") captureProjection(projection);
      if (projection.consent.applicable && projection.consent.granted) {
        // A later identified send invalidates the prior clear acknowledgement.
        metadataForgetEpoch += 1;
        metadataForgetLastAttempt = null;
        await chrome.storage.local.remove(METADATA_CLEAR_RECEIPT_KEY);
      }
      if (projection.consent.applicable && !projection.consent.granted) {
        void scheduleMetadataForget();
        if (treeRequest) throw error("AI_TREE_TECHNICAL_PERMISSION_REQUIRED");
        if (projectionKind === "health_authority") throw error("HEALTH_TECHNICAL_PERMISSION_REQUIRED");
      }
    }
    if (requestPath === "/v1/device-authorizations/token" && consentApi?.consent) {
      const permission = await consentApi.consent();
      if (permission.applicable && !permission.granted && (state.pending?.metadataMode || "identified") === "identified") throw error("DEVICE_AUTH_WITHDRAWN");
    }
    if (requestOptions.body !== undefined) { headers.set("Content-Type", "application/json"); requestOptions.body = JSON.stringify(requestOptions.body); }
    const callerSignal = requestOptions.signal, controller = new AbortController();
    let timer = null, rejectInterrupted, resolveInterrupted;
    const interrupted = callerSignal ? new Promise((resolve, reject) => { resolveInterrupted = resolve; rejectInterrupted = reject; }) : null;
    const abortFromCaller = () => {
      rejectInterrupted(error("CONTROL_REQUEST_ABORTED"));
      controller.abort();
    };
    if (callerSignal) {
      if (callerSignal.aborted) abortFromCaller();
      else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    requestOptions.signal = controller.signal;
    requestOptions.headers = headers;
    let requestReturned = false;
    const operation = (async () => {
      let response;
      try { response = await fetch(endpoint, requestOptions); }
      catch (_) { const failure = error("CONTROL_TRANSPORT_UNAVAILABLE"); transportProvenance.set(failure, endpoint); throw failure; }
      let body = null, bodyFailure = false;
      try {
        const text = await readLimitedBody(response); body = text ? JSON.parse(text) : null;
      } catch (failure) {
        bodyFailure = true;
        if (failure?.code === "CONTROL_RESPONSE_TOO_LARGE") { failure.status = response.status; failure.responseOk = response.ok; failure.retryAfterMs = parseRetryAfter(response); failure.body = null; }
        if (failure?.code === "CONTROL_RESPONSE_TOO_LARGE") throw failure;
      }
      if (!response.ok) { const failure = error(body?.error?.code || `CONTROL_HTTP_${response.status}`); failure.status = response.status; failure.retryAfterMs = parseRetryAfter(response); failure.body = body; if (!bodyFailure) httpErrorProvenance.set(failure, endpoint); throw failure; }
      return { body, response };
    })();
    if (typeof observeSettlement === "function") {
      const observe = outcome => Promise.resolve(observeSettlement({ ...outcome, late: requestReturned })).catch(quarantineBootstrap);
      void operation.then(value => observe({ value }), error => observe({ error }));
    }
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const failure = error("CONTROL_REQUEST_TIMEOUT");
          transportProvenance.set(failure, endpoint);
          reject(failure);
          controller.abort();
        }, CONTROL_REQUEST_DEADLINE_MS);
      });
      return await Promise.race(interrupted ? [operation, deadline, interrupted] : [operation, deadline]);
    } finally {
      requestReturned = true;
      if (timer !== null) clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", abortFromCaller);
      resolveInterrupted?.();
    }
  }
  async function scheduleMetadataForget() {
    if (metadataForgetFlight) return metadataForgetFlight;
    const credentials = clone(state.credentials);
    if (!credentials?.accessToken || !credentials.deviceId) return false;
    const context = contextForState({ deviceId: credentials.deviceId, sessionId: credentials.sessionId });
    const epoch = metadataForgetEpoch;
    metadataForgetFlight = (async () => {
      try {
        const stored = await chrome.storage.local.get(METADATA_CLEAR_RECEIPT_KEY);
        if (!isCurrent(context) || epoch !== metadataForgetEpoch) return false;
        const receipt = stored?.[METADATA_CLEAR_RECEIPT_KEY];
        if (receipt?.version === "client_metadata_cleared_v1" && receipt.deviceId === credentials.deviceId) return true;
        const attemptAt = now();
        if (metadataForgetLastAttempt?.deviceId === credentials.deviceId &&
            attemptAt >= metadataForgetLastAttempt.at && attemptAt - metadataForgetLastAttempt.at < 60000) return false;
        metadataForgetLastAttempt = { deviceId: credentials.deviceId, at: attemptAt };
        const marker = { version: "pending_client_metadata_clear_v1", deviceId: credentials.deviceId };
        await chrome.storage.local.set({ [METADATA_CLEAR_KEY]: marker });
        if (!isCurrent(context) || epoch !== metadataForgetEpoch) return false;
        const result = await authenticatedRequest("/v1/devices/current/client-metadata/forget", { method: "POST" }, context);
        if (result.body?.status !== "cleared" || result.body.deviceId !== credentials.deviceId ||
            !isCurrent(context) || epoch !== metadataForgetEpoch) return false;
        await chrome.storage.local.set({ [METADATA_CLEAR_RECEIPT_KEY]: { version: "client_metadata_cleared_v1", deviceId: credentials.deviceId } });
        if (!isCurrent(context) || epoch !== metadataForgetEpoch) {
          await chrome.storage.local.remove(METADATA_CLEAR_RECEIPT_KEY);
          return false;
        }
        const pending = await chrome.storage.local.get(METADATA_CLEAR_KEY);
        if (pending?.[METADATA_CLEAR_KEY]?.deviceId === credentials.deviceId) await chrome.storage.local.remove(METADATA_CLEAR_KEY);
        return true;
      } catch (_) { return false; }
    })().finally(() => { metadataForgetFlight = null; });
    return metadataForgetFlight;
  }
  async function handleTechnicalPermissionWithdrawal() {
    await init();
    const pending = state.pending;
    if (!state.credentials && pendingLive(pending) && (pending.metadataMode || "identified") === "identified") {
      pollingFlight?.exchangeController?.abort();
      await queueMutation(async () => {
        if (state.pending?.authorizationId === pending.authorizationId) await commit({ ...state, generation: state.generation + 1, pending: null, lastError: null }, state.authority, "activation_consent_withdrawn");
      });
      if (!state.credentials) await startActivation();
      return;
    }
    await scheduleMetadataForget();
  }
  function assertStart(body) { if (!body || body.status !== "pending" || !UUID.test(body.authorizationId) || !OPAQUE_TOKEN.test(body.deviceCode) || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(body.userCode) || !Number.isFinite(Date.parse(body.expiresAt))) throw error("INVALID_DEVICE_AUTH_RESPONSE"); return body; }
  function assertTokens(body) { if (!body || body.status !== "activated" || !validCredentials(body)) throw error("INVALID_TOKEN_RESPONSE"); return { deviceId: body.deviceId, sessionId: body.sessionId, tokenType: body.tokenType, accessToken: body.accessToken, accessTokenExpiresAt: body.accessTokenExpiresAt, refreshToken: body.refreshToken, refreshTokenExpiresAt: body.refreshTokenExpiresAt }; }
  function assertRefreshTokens(body, previous) { if (!body || body.tokenType !== "Bearer" || typeof body.accessToken !== "string" || !body.accessToken || !OPAQUE_TOKEN.test(body.refreshToken || "") || !Number.isFinite(Date.parse(body.accessTokenExpiresAt)) || !Number.isFinite(Date.parse(body.refreshTokenExpiresAt))) throw error("INVALID_REFRESH_RESPONSE"); return { deviceId: previous.deviceId, sessionId: previous.sessionId, tokenType: body.tokenType, accessToken: body.accessToken, accessTokenExpiresAt: body.accessTokenExpiresAt, refreshToken: body.refreshToken, refreshTokenExpiresAt: body.refreshTokenExpiresAt }; }
  function accessFresh() { return state.credentials && Date.parse(state.credentials.accessTokenExpiresAt) > now() + 30000; }
  async function openPortal(authorizationId) { const portalUrl = url(`/activate?authorizationId=${encodeURIComponent(authorizationId)}`, config.portalOrigin); if (chrome.tabs?.create) await chrome.tabs.create({ url: portalUrl }); return portalUrl; }
  function retryableExchange(failure) { return failure.code === EXCHANGE_PENDING || !failure.status || RETRYABLE_EXCHANGE_STATUS.has(failure.status); }
  function ownerCurrent(owner) { return Boolean(owner && (owner.context === null || isCurrent(owner.context))); }
  function detachObsoleteOwners() {
    if (pollingFlight && !ownerCurrent(pollingFlight)) pollingFlight = null;
    if (activationFlight && !ownerCurrent(activationFlight)) activationFlight = null;
    if (refreshFlight && !ownerCurrent(refreshFlight)) refreshFlight = null;
    if (subscriptionRefreshFlight && !ownerCurrent(subscriptionRefreshFlight)) subscriptionRefreshFlight = null;
  }
  function resetRuntimeClock() { runtimeClockOwner = null; runtimeAnchor = null; runtimeEffectiveHighWatermark = null; runtimeFloorNeedsPersistence = false; runtimeLastCheckpointAllowed = null; }
  function validAuthOwnership() { return Boolean(validCredentials(state.credentials) && validCacheClock(state.cacheClock, state.credentials, state.authority?.payload || null)); }
  async function ensureAuthOwnership() {
    if (validAuthOwnership()) return true;
    const failure = error("AUTH_CONTEXT_INVALID");
    await invalidateKnown(contextForState(), failure, true);
    throw error("AUTH_REQUIRED");
  }
  async function ensureFreshAccess(context, options = {}) {
    if (!state.credentials) throw error("AUTH_REQUIRED");
    if (!isCurrent(context)) throw error("AUTH_GENERATION_CHANGED");
    const forced = options.force === true;
    if (!forced && accessFresh()) return clone(state.credentials);
    try {
      await refresh({ context, ...(forced ? { force: true, rejectedAccessToken: options.rejectedAccessToken } : {}) });
    } catch (failure) {
      if (isCurrent(context) && (failure?.status === 401 || failure?.status === 403 || terminalAuthFailure(failure))) await invalidateKnown(context, failure, true);
      throw failure;
    }
    if (!isCurrent(context) || !state.credentials) throw error("AUTH_GENERATION_CHANGED");
    return clone(state.credentials);
  }
  function terminalServiceAuthFailure(failure) {
    return ["DEVICE_MISMATCH", "ACCOUNT_IDENTITY_MISMATCH", "TRANSFER_DEVICE_REVOKED"].includes(failure?.code);
  }
  async function authenticatedRequest(path, options = {}, requestContext = null) {
    await init();
    if (!state.credentials) throw error("AUTH_REQUIRED");
    await ensureAuthOwnership();
    const context = requestContext ? clone(requestContext) : contextForState();
    if (!isCurrent(context)) throw error("AUTH_GENERATION_CHANGED");
    await ensureFreshAccess(context);
    let retried = false;
    while (true) {
      if (!isCurrent(context) || !state.credentials) throw error("AUTH_GENERATION_CHANGED");
      const rejectedAccessToken = state.credentials.accessToken;
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${rejectedAccessToken}`);
      try {
        return await request(path, { ...options, headers });
      } catch (failure) {
        if (!isCurrent(context)) throw failure;
        if (failure?.status !== 401) {
          if (terminalServiceAuthFailure(failure)) await invalidateKnown(context, failure, true);
          throw failure;
        }
        if (retried) {
          await invalidateKnown(context, failure, true);
          throw failure;
        }
        retried = true;
        try {
          await ensureFreshAccess(context, { force: true, rejectedAccessToken });
        } catch (refreshFailure) {
          if (refreshFailure?.status === 401 || refreshFailure?.status === 403 || terminalAuthFailure(refreshFailure)) throw refreshFailure;
          throw failure;
        }
      }
    }
  }
  async function ensurePolling() {
    await init();
    if (!pendingLive(state.pending)) return;
    if (!validAuthContext(state.pending.authContext)) { await queueMutation(async () => { if (state.pending && !validAuthContext(state.pending.authContext)) await commit({ ...state, generation: state.generation + 1, pending: null, lastError: safeError(error("ACTIVATION_CONTEXT_MISMATCH")) }, state.authority, "activation_context_invalid"); }); return; }
    if (ownerCurrent(pollingFlight)) return pollingFlight.promise;
    if (pollingFlight) pollingFlight = null;
    const owner = { context: contextForState(), promise: null };
    owner.promise = (async () => {
      try {
        while (isCurrent(owner.context) && pendingLive(state.pending)) {
          const pending = state.pending;
          try {
            const permission = consentApi?.consent ? await consentApi.consent() : { applicable: false, granted: true };
            if (permission.applicable && !permission.granted && (pending.metadataMode || "identified") === "identified") {
              await queueMutation(async () => {
                if (state.pending?.authorizationId === pending.authorizationId) await commit({ ...state, generation: state.generation + 1, pending: null, lastError: null }, state.authority, "activation_consent_withdrawn");
              });
              if (!state.credentials) await startActivation();
              return;
            }
            const exchangeController = new AbortController();
            owner.exchangeController = exchangeController;
            let result;
            try { result = await request("/v1/device-authorizations/token", { method: "POST", headers: { "Idempotency-Key": pending.exchangeIdempotencyKey }, body: { deviceCode: pending.deviceCode }, signal: exchangeController.signal }); }
            finally { if (owner.exchangeController === exchangeController) owner.exchangeController = null; }
            const credentials = assertTokens(result.body);
            if (!isCurrent(owner.context) || state.pending?.authorizationId !== pending.authorizationId) return;
            const effective = now(); if (!validMillis(effective)) throw error("CACHE_WALL_CLOCK_INVALID");
            const cacheClock = { cacheVersion: "control_cache_clock_v1", owner: clockOwner(credentials), trustedServerTimeMs: 0, effectiveTimeMs: effective };
            if (!await commitIfCurrent(owner.context, current => ({ ...current, credentials, cacheClock, pending: null, rotation: null, authority: null, grants: {},
              principalEpoch: epoch("principalEpoch") + 1, accessEpoch: epoch("accessEpoch") + 1,
              lastError: null, generation: current.generation + 1 }), "activated")) return;
            const bootstrapContext = contextForState({ generation: owner.context.generation + 1, deviceId: credentials.deviceId, sessionId: credentials.sessionId });
            try { await bootstrap({ context: bootstrapContext }); } catch (failure) {
              await queueMutation(async () => { if (isCurrent(bootstrapContext) && state.credentials) await commit({ ...state, lastError: safeError(failure) }, state.authority, "bootstrap_failed"); });
            }
            return;
          } catch (failure) {
            if (!isCurrent(owner.context) || state.pending?.authorizationId !== pending.authorizationId) return;
            if (failure.code === "DEVICE_AUTH_WITHDRAWN") {
              await queueMutation(async () => {
                if (state.pending?.authorizationId === pending.authorizationId) await commit({ ...state, generation: state.generation + 1, pending: null, lastError: null }, state.authority, "activation_consent_withdrawn");
              });
              if (!state.credentials) await startActivation();
              return;
            }
            if (retryableExchange(failure) && Date.parse(pending.expiresAt) > now()) {
              const wait = failure.code === EXCHANGE_PENDING ? failure.retryAfterMs || 1000 : Math.min(5000, Math.max(1000, failure.retryAfterMs || 1000));
              await new Promise(resolve => setTimeout(resolve, Math.min(wait, Math.max(250, Date.parse(pending.expiresAt) - now()))));
              continue;
            }
            await commitIfCurrent(owner.context, current => ({ ...current, pending: null, lastError: safeError(failure), generation: current.generation + 1 }), "activation_failed");
            return;
          }
        }
      } finally { if (pollingFlight === owner) pollingFlight = null; }
    })();
    pollingFlight = owner;
    return owner.promise;
  }
  async function startActivation() {
    await init();
    if (state.credentials) { try { await ensureAuthOwnership(); } catch (_) {} }
    if (state.credentials && state.authority) return { ...publicStatus(), portalUrl: null };
    if (state.credentials && !state.authority) { const context = contextForState(); try { await bootstrap({ context }); } catch (failure) { await commitIfCurrent(context, current => ({ ...current, lastError: safeError(failure) }), "bootstrap_failed"); } return { ...publicStatus(), portalUrl: null }; }
    if (pendingLive(state.pending)) { if (!validAuthContext(state.pending.authContext)) { await queueMutation(async () => { await commit({ ...state, generation: state.generation + 1, pending: null, lastError: safeError(error("ACTIVATION_CONTEXT_MISMATCH")) }, state.authority, "activation_context_invalid"); }); } else { const context = contextForState(); const portalUrl = await openPortal(state.pending.authorizationId); if (isCurrent(context)) void ensurePolling(); return { ...publicStatus(), portalUrl: isCurrent(context) ? portalUrl : null }; } }
    if (ownerCurrent(activationFlight)) return activationFlight.promise;
    activationFlight = null;
    const permission = consentApi?.consent ? await consentApi.consent() : { applicable: false, granted: true };
    const requestedMetadataMode = permission.applicable && !permission.granted ? "privacy_neutral" : "identified";
    let metadataMode = requestedMetadataMode;
    const owner = { context: null, promise: null };
    owner.promise = (async () => {
      const started = await queueMutation(async () => { if (state.credentials || pendingLive(state.pending)) return null; const reusableStarting = state.pending?.phase === "starting" && (state.pending.metadataMode || "identified") === requestedMetadataMode && TOKEN.test(state.pending.startIdempotencyKey) && validAuthContext(state.pending.authContext); const startIdempotencyKey = reusableStarting ? state.pending.startIdempotencyKey : key(); const attemptId = reusableStarting && state.pending.attemptId && validAuthContext(state.pending.authContext) ? state.pending.attemptId : key(); const authContext = { contextVersion: "control_auth_context_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion }; const next = { ...state, generation: state.generation + 1, pending: { phase: "starting", attemptId, startIdempotencyKey, authContext, metadataMode: requestedMetadataMode }, lastError: null }; await commit(next, state.authority, "activation_starting"); return { context: { generation: next.generation, attemptId }, startIdempotencyKey }; });
      if (!started) return publicStatus();
      owner.context = started.context;
      const result = await request("/v1/device-authorizations", { method: "POST", headers: { "Idempotency-Key": started.startIdempotencyKey }, body: { clientType: "browser_extension", browserFamily: browserFamily(), browserVersion: browserVersion(), extensionVersion: config.extensionVersion }, captureProjection: projection => { metadataMode = projection.consent.applicable && !projection.consent.granted ? "privacy_neutral" : "identified"; } });
      const response = assertStart(result.body); const pending = { phase: "pending", attemptId: started.context.attemptId, authorizationId: response.authorizationId, deviceCode: response.deviceCode, userCode: response.userCode, expiresAt: response.expiresAt, startIdempotencyKey: started.startIdempotencyKey, exchangeIdempotencyKey: key(), authContext: { contextVersion: "control_auth_context_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion }, metadataMode };
      if (!await commitIfCurrent(started.context, current => ({ ...current, pending, lastError: null }), "activation_started") || !isCurrent(started.context)) return publicStatus();
      const portalUrl = await openPortal(response.authorizationId); if (!isCurrent(started.context)) return publicStatus(); void ensurePolling(); return { ...publicStatus(), portalUrl };
    })().catch(async failure => { if (owner.context) await commitIfCurrent(owner.context, current => ({ ...current, pending: current.pending?.phase === "starting" ? { ...current.pending, metadataMode } : current.pending, lastError: safeError(failure) }), "activation_failed"); throw failure; }).finally(() => { if (activationFlight === owner) activationFlight = null; });
    activationFlight = owner; return owner.promise;
  }
  async function refresh(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context)) throw error("AUTH_CONTEXT_INVALID");
    await init();
    const entryContext = options.context ? clone(options.context) : contextForState();
    if (!isCurrent(entryContext)) throw error("AUTH_GENERATION_CHANGED");
    const forced = options.force === true, rejectedAccessToken = options.rejectedAccessToken;
    if (!state.credentials) throw error("AUTH_REQUIRED");
    await ensureAuthOwnership();
    if (forced && rejectedAccessToken && state.credentials.accessToken !== rejectedAccessToken) { if (!isCurrent(entryContext)) throw error("AUTH_GENERATION_CHANGED"); return clone(state.credentials); }
    if (!forced && accessFresh() && !state.rotation) { if (!isCurrent(entryContext)) throw error("AUTH_GENERATION_CHANGED"); return clone(state.credentials); }
    if (ownerCurrent(refreshFlight) && refreshFlight.context && isCurrent(refreshFlight.context) && refreshFlight.context.generation === entryContext.generation && refreshFlight.context.deviceId === entryContext.deviceId && refreshFlight.context.sessionId === entryContext.sessionId) return refreshFlight.promise;
    refreshFlight = null;
    const owner = { context: entryContext, promise: null };
    owner.promise = (async () => {
      const prepared = await queueMutation(async () => { if (!isCurrent(entryContext)) throw error("AUTH_GENERATION_CHANGED"); if (!state.credentials) throw error("AUTH_REQUIRED"); const context = contextForState(); let rotation = state.rotation; if (!rotation || rotation.generation !== context.generation || rotation.refreshToken !== state.credentials.refreshToken) { rotation = { generation: context.generation, refreshToken: state.credentials.refreshToken, idempotencyKey: key() }; await commit({ ...state, rotation }, state.authority, "refresh_prepared"); } const preparedContext = { ...context, rotationKey: rotation.idempotencyKey }; owner.context = preparedContext; return { context: preparedContext, rotation, credentials: clone(state.credentials) }; });
      if (!isCurrent(prepared.context)) throw error("AUTH_GENERATION_CHANGED");
      owner.context = prepared.context;
      let result;
      try { result = await request("/v1/auth/refresh", { method: "POST", headers: { "Idempotency-Key": prepared.rotation.idempotencyKey }, body: { refreshToken: prepared.rotation.refreshToken } }); }
      catch (failure) { if (failure?.status || !isCurrent(prepared.context)) throw failure; result = await request("/v1/auth/refresh", { method: "POST", headers: { "Idempotency-Key": prepared.rotation.idempotencyKey }, body: { refreshToken: prepared.rotation.refreshToken } }); }
      const credentials = assertRefreshTokens(result.body, prepared.credentials); if (!await commitIfCurrent(prepared.context, current => ({ ...current, credentials, rotation: null, lastError: null }), "refresh_rotated")) throw error("AUTH_GENERATION_CHANGED"); void retryPendingMetadataForget(); return clone(credentials);
    })().catch(async failure => { if (failure.code === "AUTH_REFRESH_INVALID" && owner.context) await invalidateKnown(owner.context, failure, true); throw failure; }).finally(() => { if (refreshFlight === owner) refreshFlight = null; });
    refreshFlight = owner; return owner.promise;
  }
  function bootstrapContractVersion() { if (!["control_plane_v2", "control_plane_v3"].includes(config.contractVersion)) throw error("PACKAGED_CONTRACT_UNSUPPORTED"); return config.contractVersion; }
  function bootstrapRequest(detectedAi, credentials, authority) { const body = { contractVersion: bootstrapContractVersion(), extensionVersion: config.extensionVersion, browser: { family: browserFamily(), version: browserVersion() }, deviceId: credentials.deviceId, lastConfigVersion: authority?.payload?.configVersion || null }; if (detectedAi) body.detectedAi = detectedAi; return body; }
  const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  function decimalCompare(left, right) { const a = left.replace(/^0+(?=\d)/, ""), b = right.replace(/^0+(?=\d)/, ""); return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1; }
  function parseSemver(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 64 || !SEMVER.test(value)) return null;
    const withoutBuild = value.split("+", 1)[0], hyphen = withoutBuild.indexOf("-");
    const core = hyphen < 0 ? withoutBuild : withoutBuild.slice(0, hyphen);
    return { core: core.split("."), prerelease: hyphen < 0 ? [] : withoutBuild.slice(hyphen + 1).split(".") };
  }
  function compareSemver(left, right) {
    const a = parseSemver(left), b = parseSemver(right); if (!a || !b) return undefined;
    for (let i = 0; i < 3; i++) { const compared = decimalCompare(a.core[i], b.core[i]); if (compared) return compared; }
    if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
    for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
      const x = a.prerelease[i], y = b.prerelease[i]; if (x === y) continue;
      const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y); if (xn && yn) return decimalCompare(x, y); if (xn !== yn) return xn ? -1 : 1; return x < y ? -1 : 1;
    }
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length < b.prerelease.length ? -1 : 1;
  }
  function parseBrowser(value) {
    if (typeof value !== "string") return null; const parts = value.split(".");
    if (parts.length < 1 || parts.length > 4 || parts.some(part => !/^(?:0|[1-9]\d*)$/.test(part))) return null;
    if (parts.some(part => decimalCompare(part, "2147483647") > 0)) return null;
    return [...parts, ...Array(4 - parts.length).fill("0")];
  }
  function compareBrowser(left, right) { const a = parseBrowser(left), b = parseBrowser(right); if (!a || !b) return undefined; for (let i = 0; i < 4; i++) { const compared = decimalCompare(a[i], b[i]); if (compared) return compared; } return 0; }
  function versionAtLeast(actual, minimum, browser = false) { const compared = browser ? compareBrowser(actual, minimum) : compareSemver(actual, minimum); return compared !== undefined && compared >= 0; }
  function exactKeys(value, required, optional = []) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const allowed = new Set([...required, ...optional]); return Object.keys(value).every(k => allowed.has(k)) && required.every(k => Object.hasOwn(value, k)); }
  function validSelector(value, strategy) {
    if (!exactKeys(value, ["strategy", "primary", "fallbacks", "timeoutMs", "observationMode"]) || value.strategy !== strategy || !Array.isArray(value.fallbacks) || value.fallbacks.length > 3 || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 250 || value.timeoutMs > 30000 || !["polling", "mutation_observer"].includes(value.observationMode)) return false;
    const validPrimitive = primitive => exactKeys(primitive, ["kind", "reference"], ["role"]) && ["page-root", "conversation-root", "composer-root", "send-control", "assistant-response", "busy-control", "copy-control"].includes(primitive.reference) && (primitive.kind === "packaged_selector_reference" ? !Object.hasOwn(primitive, "role") : primitive.kind === "accessibility_role_name" && ["main", "article", "textbox", "button", "status"].includes(primitive.role));
    return validPrimitive(value.primary) && value.fallbacks.every(validPrimitive) && !(value.observationMode === "polling" && value.timeoutMs < 500);
  }
  function validProfileShape(profile, enforceEnvironment = true, expectedContractVersion = "control_plane_v1", checks = null) {
    const content = profile?.content, compatibility = profile?.compatibility;
    if (!MACHINE.test(profile?.profileKey || "") || String(profile?.profileKey || "").length > 64 || !Number.isSafeInteger(profile?.revision) || profile.revision <= 0 || profile?.schemaVersion !== "adapter_profile_v1" || profile?.scopeVariant !== null) return false;
    if (!exactKeys(content, ["schemaVersion", "page", "selectors", "observation", "contours"]) || content.schemaVersion !== "adapter_profile_v1" || !exactKeys(content.page, ["identityStrategy", "conversationStrategy", "composerStrategy"]) || content.page.identityStrategy !== "page_identity" || content.page.conversationStrategy !== "conversation_root" || content.page.composerStrategy !== "composer_root") return false;
    if (!exactKeys(content.selectors, ["conversation", "composer", "send", "assistantResponse"]) || !validSelector(content.selectors.conversation, "conversation_root") || !validSelector(content.selectors.composer, "composer_root") || !validSelector(content.selectors.send, "send_control") || !validSelector(content.selectors.assistantResponse, "assistant_response")) return false;
    if (!exactKeys(content.observation, ["mode", "intervalMs"]) || !["polling", "mutation_observer"].includes(content.observation.mode) || !Number.isSafeInteger(content.observation.intervalMs) || content.observation.intervalMs < 100 || content.observation.intervalMs > 5000 || (content.observation.mode === "mutation_observer" && content.observation.intervalMs !== 100)) return false;
    const contourKeys = new Set(["page_identity", "conversation_root", "composer_root", "send_control", "busy_state", "assistant_response", "copy_control"]);
    if (!Array.isArray(content.contours) || content.contours.length < 4 || content.contours.length > 7 || new Set(content.contours.map(x => x.key)).size !== content.contours.length || !content.contours.every(x => exactKeys(x, ["key", "required", "expectedState", "strategy"]) && contourKeys.has(x.key) && typeof x.required === "boolean" && ["PRESENT", "INTERACTIVE", "COMPLETES"].includes(x.expectedState) && contourKeys.has(x.strategy))) return false;
    if (!exactKeys(compatibility, ["schemaVersion", "contractVersion", "browserFamilies", "minimumBrowserVersions", "minimumExtensionVersion"]) || compatibility.schemaVersion !== "profile_compatibility_v1" || compatibility.contractVersion !== expectedContractVersion || !["control_plane_v1", "control_plane_v2"].includes(compatibility.contractVersion) || !Array.isArray(compatibility.browserFamilies) || compatibility.browserFamilies.length < 1 || compatibility.browserFamilies.length > browserIdentity.families.length || new Set(compatibility.browserFamilies).size !== compatibility.browserFamilies.length || !compatibility.browserFamilies.every(x => browserIdentity.families.includes(x)) || !Array.isArray(compatibility.minimumBrowserVersions) || compatibility.minimumBrowserVersions.length > browserIdentity.families.length || new Set(compatibility.minimumBrowserVersions.map(x => x.browserFamily)).size !== compatibility.minimumBrowserVersions.length || !compatibility.minimumBrowserVersions.every(x => exactKeys(x, ["browserFamily", "minimumVersion"]) && compatibility.browserFamilies.includes(x.browserFamily) && parseBrowser(x.minimumVersion)) || !(compatibility.minimumExtensionVersion === null || parseSemver(compatibility.minimumExtensionVersion))) return false;
    bootstrapCheck(checks, "PROFILE_SHAPE", true);
    if (!enforceEnvironment) return true;
    if (!bootstrapCheck(checks, "PROFILE_BROWSER_FAMILY", compatibility.browserFamilies.includes(browserFamily())) || !bootstrapCheck(checks, "PROFILE_EXTENSION_MINIMUM", !compatibility.minimumExtensionVersion || versionAtLeast(config.extensionVersion, compatibility.minimumExtensionVersion))) return false;
    const browserMin = compatibility.minimumBrowserVersions.find(x => x.browserFamily === browserFamily()); return bootstrapCheck(checks, "PROFILE_BROWSER_MINIMUM", !browserMin || versionAtLeast(browserVersion(), browserMin.minimumVersion, true));
  }
  async function profileFingerprint(profile) { const bytes = new TextEncoder().encode(verifier.canonicalJson({ content: profile.content, compatibility: profile.compatibility })); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join(""); }
  async function materializeLocalAuthority(payload, requestedAi = null) {
    const identity = currentBrowserIdentity();
    return localAuthority?.materialize(payload, {
      browserFamily: identity.family,
      browserVersion: identity.version,
      extensionVersion: config.extensionVersion,
      requestedAi,
      localAi: LOCAL_AI,
      compareSemver,
      compareBrowser,
      versionAtLeast,
      profileValid: (profile, family, version, extension) => validProfileShape(profile, true, "control_plane_v2") && browserFamily() === family && browserVersion() === version && config.extensionVersion === extension,
      profileFingerprint,
    }) || null;
  }
  async function validateAccountProfile(payload, requestedAi = null, enforceEnvironment = true, checks = null) {
    if (!authorityStaticValid(payload, checks) || !bootstrapCheck(checks, "REQUESTED_AI_KNOWN", !requestedAi || Boolean(LOCAL_AI[requestedAi]))) return null;
    if (payload.ai.status === "UNCONFIGURED") return bootstrapCheck(checks, "AI_UNCONFIGURED_SCOPE", requestedAi === null) ? { workAllowed: false, requestedAi: null } : null;
    if (payload.ai.status === "UNAVAILABLE") return bootstrapCheck(checks, "AI_UNAVAILABLE_LOCAL", payload.localClientAuthority) ? { workAllowed: false, requestedAi: requestedAi || null } : null;
    // Adapter profile bytes remain v1/v2 material even when a dormant v3 bootstrap carries them.
    const profileContractVersion = payload.ai.profile?.compatibility?.contractVersion === "control_plane_v1" ? "control_plane_v1" : "control_plane_v2";
    if (!bootstrapCheck(checks, "AI_RESOLVED", payload.ai.status === "RESOLVED")) return null;
    const checksBeforeProfile = checks?.length || 0;
    if (!validProfileShape(payload.ai.profile, enforceEnvironment, profileContractVersion, checks)) { if (checks && checks.length === checksBeforeProfile) bootstrapCheck(checks, "PROFILE_SHAPE", false); return null; }
    const expected = requestedAi ? LOCAL_AI[requestedAi] : LOCAL_AI[payload.ai.detected?.family], detected = payload.ai.detected;
    if (!bootstrapCheck(checks, "AI_PROFILE_SCOPE", expected && detected.family === (requestedAi || detected.family) && detected.surface === expected.surface && detected.variant === null && payload.ai.profile.scopeVariant === null)) return null;
    if (!bootstrapCheck(checks, "PROFILE_FINGERPRINT", (await profileFingerprint(payload.ai.profile)) === payload.ai.profile.contentSha256)) return null;
    return { workAllowed: true, requestedAi: requestedAi || payload.ai.detected.family };
  }
  async function validateOperationalAuthority(payload, requestedAi = null) { return Boolean(await validateAccountProfile(payload, requestedAi, true)); }
  async function validateBootstrapAuthority(payload, requestedAi = null, privacyNeutral = false, checks = null) {
    if (privacyNeutral) {
      if (!bootstrapCheck(checks, "PAYLOAD_VARIANT", payload?.localClientAuthority && !Object.hasOwn(payload, "compatibility") && !Object.hasOwn(payload, "features") && !Object.hasOwn(payload, "ai"))) return null;
      payload = await materializeLocalAuthority(payload, requestedAi);
      if (!bootstrapCheck(checks, "LOCAL_MATERIALIZATION", payload)) return null;
    } else if (!bootstrapCheck(checks, "PAYLOAD_VARIANT", !payload?.localClientAuthority)) return null;
    return validateAccountProfile(payload, requestedAi, true, checks);
  }
  async function requestBootstrap(credentials, authority, detectedAi, attempt) {
    return request("/v1/bootstrap", { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}` },
      body: bootstrapRequest(detectedAi, credentials, authority), signal: attempt.lease?.signal,
      captureProjection: projection => { attempt.privacyNeutral = projection.consent.applicable && !projection.consent.granted; },
      observeSettlement: async outcome => { attempt.lastHttpOutcome = outcome; await observeBootstrapLate(attempt, outcome); } });
  }
  function decodeBase64Url(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null; try { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4); const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0)); return verifier.base64urlEncode(bytes) === value ? bytes : null; } catch (_) { return null; } }
  async function snapshotDigest(envelope) { const bytes = decodeBase64Url(envelope?.payload); if (!bytes) return null; return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join(""); }
  function healthRequest(detectedAi, credentials, authority) { return { healthTransportVersion: "health_transport_v1", bootstrap: bootstrapRequest(detectedAi, credentials, authority), bootstrapEnvelope: authority.envelope }; }
  async function healthContextFromBootstrap(payload, authority, credentials) { if (payload?.contractVersion !== "control_plane_v2" || payload?.ai?.status !== "RESOLVED" || !authority?.deviceId || !authority?.sessionId || !credentials?.deviceId || !credentials?.sessionId || authority.deviceId !== credentials.deviceId || authority.sessionId !== credentials.sessionId) return null; const bootstrapSnapshotSha256 = await snapshotDigest(authority.envelope); if (!bootstrapSnapshotSha256) return null; return { accountId: payload.account.id, deviceId: authority.deviceId, sessionId: authority.sessionId, contractVersion: payload.contractVersion, configVersion: payload.configVersion, bootstrapSnapshotSha256, ai: { family: payload.ai.detected.family, surface: payload.ai.detected.surface, variant: payload.ai.detected.variant, profileKey: payload.ai.profile.profileKey, revision: payload.ai.profile.revision, scopeVariant: payload.ai.profile.scopeVariant, contentSha256: payload.ai.profile.contentSha256 } }; }
  async function acquireSignedHealthAuthority(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context)) throw error("AUTH_CONTEXT_INVALID");
    await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership();
    const context = options.context ? clone(options.context) : contextForState(); if (!isCurrent(context)) throw error("AUTH_GENERATION_CHANGED");
    const requestedAi = options.detectedAi?.family || null;
    if (!requestedAi || !LOCAL_AI[requestedAi] || options.detectedAi.surface !== LOCAL_AI[requestedAi].surface || options.detectedAi.variant !== null) throw error("HEALTH_CONTEXT_INVALID");
    const permission = consentApi?.consent ? await consentApi.consent() : { applicable: false, granted: true };
    if (permission.applicable && !permission.granted) { void scheduleMetadataForget(); return null; }
    const authority = clone(state.authority), authorityIdentityBefore = authorityDecisionIdentity(authority, context.generation); if (!authority?.envelope) throw error("HEALTH_CONTEXT_INVALID"); if (authority.payload?.contractVersion !== "control_plane_v2") return null; let result; try { result = await authenticatedRequest("/v1/health-authority", { method: "POST", body: healthRequest(options.detectedAi, state.credentials, authority) }, context); } catch (failure) { if (failure.code === "HEALTH_TECHNICAL_PERMISSION_REQUIRED") return null; throw failure; }
    if (!isCurrent(context) || authorityIdentityBefore !== authorityDecisionIdentity()) throw error("AUTH_GENERATION_CHANGED");
    const verified = await verifier.verifyHealthV1(result.body, config.trustBundle); if (!verified.ok) throw error(`HEALTH_${verified.error}`);
    if (verified.payload.status === "PASS") { const expected = await healthContextFromBootstrap(authority?.payload, authority, state.credentials); if (!expected || verifier.canonicalJson(expected) !== verifier.canonicalJson(verified.payload.context)) throw error("HEALTH_CONTEXT_MISMATCH"); }
    return { payload: clone(verified.payload), envelope: clone(verified.envelope) };
  }
  async function getHealthAuthorityContext() { await init(); if (!state.credentials || !state.authority) throw error("HEALTH_CONTEXT_INVALID"); await getVerifiedAuthorityTime(); return clone(state.authority); }
  async function getVerifiedAuthorityTime(identity = null) {
    await init();
    if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    const record = identity === null ? null : grantFor(identity);
    const authority = identity === null ? state.authority : record?.authority;
    const clock = identity === null ? state.cacheClock : record?.cacheClock;
    if (!state.credentials || !clock || !authority || record && !verifiedGrantIdentities.has(grantIdentity(record))) throw error("HEALTH_CONTEXT_INVALID");
    return effectiveTime(clock, authority.payload);
  }
  /* C3A reads this cache snapshot only. It deliberately does not checkpoint,
   * persist a denial, refresh Bootstrap, or acquire Health. */
  function canContinueCached(identity) {
    if (!initialized || authStorageUnconfirmed) return false;
    try {
      const record = grantFor(identity);
      return Boolean(record && verifiedGrantIdentities.has(grantIdentity(record)) && record.authority.workAllowed === true &&
        canWork(record.authority.payload, effectiveTime(record.cacheClock, record.authority.payload)));
    } catch (_) { return false; }
  }
  async function getCachedContinuationState(identity = null) {
    await init();
    const record = identity === null ? null : grantFor(identity);
    const trusted = !authStorageUnconfirmed && (identity === null || record && verifiedGrantIdentities.has(grantIdentity(record)));
    const authority = trusted ? (identity === null ? state.authority : record?.authority) : null;
    return clone({
      generation: state.generation,
      principalEpoch: epoch("principalEpoch"), accessEpoch: epoch("accessEpoch"), grantEpoch: record?.grantEpoch || null,
      authority,
      cacheClock: identity === null ? state.cacheClock : record?.cacheClock || null,
      localInvalidation: {
        revoked: !state.credentials || !authority,
        loggedOut: !state.credentials,
        authReset: !state.credentials,
        obsolete: false,
        storeDeleted: false,
      },
    });
  }
  function terminalAuthFailure(failure) { return failure?.code === "AUTH_REFRESH_INVALID" || failure?.status === 401 || ["AUTH_INVALID", "DEVICE_REVOKED"].includes(failure?.code); }
  async function invalidateKnown(context, failure, terminal = terminalAuthFailure(failure)) {
    return queueMutation(async () => {
      if (!isCurrent(context)) return false;
      const denyingAcquisitions = [...bootstrapAttempts.values()].filter(attempt => attempt.lease && bootstrapAttemptCurrent(attempt));
      for (const attempt of denyingAcquisitions) attempt.lease.beginSecurityCommit();
      const previous = state.authority;
      const next = { ...state, generation: state.generation + 1, principalEpoch: epoch("principalEpoch") + (terminal ? 1 : 0), accessEpoch: epoch("accessEpoch") + 1, grants: {}, credentials: terminal ? null : state.credentials, pending: null, rotation: null, authority: null, cacheClock: terminal ? null : state.cacheClock, lastError: safeError(failure) };
      /* The denial is authoritative before any storage or cleanup await. */
      state = next;
      let transferCleanupFailure = null;
      if (terminal) {
        resetRuntimeClock();
        try { await clearTransferRecipientVault(); } catch (cleanupFailure) { transferCleanupFailure = cleanupFailure; }
      }
      detachObsoleteOwners();
      let persistenceFailure = null;
      try { await persist(next); }
      catch (_) {
        let removed = false;
        try { await chrome.storage.local.remove(STORAGE_KEY); removed = true; }
        catch (removeFailure) { persistenceFailure = error("AUTH_DENIAL_PERSISTENCE_FAILED"); persistenceFailure.detail = safeError(removeFailure); /* memory remains denied; disk could still contain the old record */ }
        if (removed) state = { ...state, credentials: null, cacheClock: null };
        if (persistenceFailure) state = { ...state, lastError: safeError(persistenceFailure) };
      }
      if (previous && typeof authorityChanged === "function") {
        try { await authorityChanged(null, failure?.code || "authority_invalid", state.generation); } catch (_) { /* cleanup is advisory */ }
      }
      if (!authStorageUnconfirmed && !persistenceFailure)
        for (const attempt of denyingAcquisitions) attempt.lease.finishRevocationCommit();
      return persistenceFailure || transferCleanupFailure ? { denied: true, ...(persistenceFailure ? { persistenceFailure: persistenceFailure.code } : {}), ...(transferCleanupFailure ? { transferCleanupFailure: transferCleanupFailure.code } : {}) } : true;
    });
  }
  async function invalidateUnauthorized(context, failure) { return invalidateKnown(context, failure, true); }
  function bootstrapAttemptCurrent(attempt) {
    if (!attempt || authStorageUnconfirmed || bootstrapAttemptSequence !== attempt.sequence || !isCurrent(attempt.context)) return false;
    if (attempt.lease) { try { attempt.lease.assertCurrent(); } catch (_) { return false; } }
    return true;
  }
  function bootstrapFence(scopeKey) {
    const scope = bootstrapAcquisitionScopes.get(scopeKey);
    if (!scope) throw error("BOOTSTRAP_ACQUISITION_SCOPE_MISSING");
    return { scopeKey, environmentKey: scope.environmentKey, principalEpoch: epoch("principalEpoch"),
      accessEpoch: epoch("accessEpoch"), grantEpoch: grantFor(scope.family)?.grantEpoch || 0 };
  }
  function bootstrapFenceCurrent(fence) {
    const scope = bootstrapAcquisitionScopes.get(fence.scopeKey), credentials = state.credentials;
    if (authStorageUnconfirmed || !scope || !credentials || scope.deviceId !== credentials.deviceId ||
        scope.sessionId !== credentials.sessionId || scope.principalEpoch !== epoch("principalEpoch")) return false;
    return verifier.canonicalJson(bootstrapFence(fence.scopeKey)) === verifier.canonicalJson(fence);
  }
  function quarantineBootstrap(failure) {
    if (authStorageUnconfirmed) return;
    authStorageUnconfirmed = true;
    state = { ...state, generation: state.generation + 1, accessEpoch: epoch("accessEpoch") + 1,
      authority: null, grants: {}, lastError: safeError(failure) };
    queueMicrotask(() => { void notifyAuthorityChange(null, "BOOTSTRAP_SECURITY_QUARANTINE", state.generation); });
  }
  async function observeBootstrapLate(attempt, outcome) {
    // A late allow never enters the state writer. A denial retains its common scope.
    if (!attempt?.principal || outcome.late !== true && bootstrapAttemptCurrent(attempt)) return;
    const principalCurrent = () => !authStorageUnconfirmed && state.credentials &&
      epoch("principalEpoch") === attempt.principal.principalEpoch &&
      state.credentials.deviceId === attempt.principal.deviceId && state.credentials.sessionId === attempt.principal.sessionId;
    if (!principalCurrent()) return;
    const failed = outcome.error;
    if (failed) {
      if ((failed.status === 401 || failed.status === 403) && httpErrorProvenance.get(failed) === endpointFor("/v1/bootstrap"))
        await invalidateKnown(contextForState(), failed, failed.status === 401);
      else if (failed.code === "CONTROL_RESPONSE_TOO_LARGE" && failed.responseOk === true)
        await invalidateKnown(contextForState(), failed, false);
      return;
    }
    const verified = await verifyCachedEnvelope(outcome.value?.body);
    if (!principalCurrent()) return;
    if (!verified?.ok) { await invalidateKnown(contextForState(), error("BOOTSTRAP_LATE_VERIFICATION_FAILED"), false); return; }
    const payload = attempt.privacyNeutral ? await materializeLocalAuthority(verified.payload, attempt.requestedAi) : verified.payload;
    if (!principalCurrent()) return;
    const validation = await validateBootstrapAuthority(verified.payload, attempt.requestedAi, attempt.privacyNeutral);
    if (!principalCurrent()) return;
    if (!validation || validation.workAllowed !== true || !staticCanWork(payload))
      await invalidateKnown(contextForState(), error("BOOTSTRAP_LATE_COMMON_DENY"), false);
  }
  async function scheduleBootstrap(options, mode, execute) {
    // The coalescing key and dispatched options share one private snapshot.
    // Wait duration and cancellation remain properties of each caller.
    const captured = {};
    for (const key of ["detectedAi", "context", "expectedAccountId", "minimumServerTimeExclusive"]) {
      if (options[key] !== undefined) captured[key] = clone(options[key]);
    }
    const requestKey = verifier.canonicalJson({ mode, options: captured });
    const signal = options.signal, waitMs = options.waitMs;
    await init();
    if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    if (!state.credentials) throw error("AUTH_REQUIRED");
    if (!parallelAuthority?.createBootstrapScheduler) throw error("BOOTSTRAP_SCHEDULER_UNAVAILABLE");
    const family = captured.detectedAi?.family || null;
    if (family !== null && !LOCAL_AI[family]) throw bootstrapProfileFailure("REQUEST_FAMILY", [{ check: "REQUESTED_AI_KNOWN", passed: false }]);
    // Capture the acquisition fence only after legacy cache materialization.
    // Offline fallback must not invalidate its own ticket by creating the first grant.
    await materializeLegacyScopedGrant(family);
    if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    if (!state.credentials) throw error("AUTH_REQUIRED");
    const principal = { principalEpoch: epoch("principalEpoch"), deviceId: state.credentials.deviceId, sessionId: state.credentials.sessionId };
    const environmentKey = verifier.canonicalJson({ purpose: "bootstrap_acquisition_environment_v1",
      controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: bootstrapContractVersion(),
      extensionVersion: config.extensionVersion, browser: currentBrowserIdentity(), trustBundleSha256: await trustBundleDigest() });
    // This acquisition key is not a signed grant scopeKey. The first response alone
    // can establish the control account ID; no fabricated account ID is persisted.
    const scopeKey = verifier.canonicalJson({ purpose: "bootstrap_acquisition_v1", principal, environmentKey, family });
    if (principal.principalEpoch !== epoch("principalEpoch") || principal.deviceId !== state.credentials?.deviceId ||
        principal.sessionId !== state.credentials?.sessionId) throw error("AUTH_GENERATION_CHANGED");
    bootstrapAcquisitionScopes.set(scopeKey, { ...principal, family, environmentKey });
    if (!bootstrapScheduler) bootstrapScheduler = parallelAuthority.createBootstrapScheduler({
      isFenceCurrent: bootstrapFenceCurrent,
      observeLateOutcome: async ({ ticket }) => {
        const attempt = bootstrapAttempts.get(ticket.acquisitionId);
        try { if (attempt?.lastHttpOutcome) await observeBootstrapLate(attempt, { ...attempt.lastHttpOutcome, late: true }); }
        finally { bootstrapAttempts.delete(ticket.acquisitionId); }
      },
      quarantine: quarantineBootstrap,
    });
    const result = await bootstrapScheduler.request({ fence: bootstrapFence(scopeKey), requestKey,
      ...(signal ? { signal } : {}),
      ...(waitMs === undefined ? {} : { waitMs }),
      run: lease => execute(captured, lease, principal) });
    bootstrapAttempts.delete(result.ticket.acquisitionId);
    return result.value;
  }
  function endpointFor(path) { return url(path); }
  function registeredTransport(failure, path) { return transportProvenance.get(failure) === endpointFor(path); }
  async function invalidateBootstrapFailure(attempt, failure, terminal = false) {
    if (!bootstrapAttemptCurrent(attempt)) return false;
    return invalidateKnown(attempt.context, failure, terminal);
  }
  async function bootstrapOnline(options, attempt) {
    await init();
    if (!state.credentials) throw error("AUTH_REQUIRED");
    await ensureAuthOwnership();
    if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
    const requestedAi = options.detectedAi?.family || null;
    if (options.detectedAi && (!LOCAL_AI[requestedAi] || options.detectedAi.surface !== LOCAL_AI[requestedAi].surface || options.detectedAi.variant !== null)) {
      const failure = bootstrapProfileFailure("REQUEST_IDENTITY", [{ check: "REQUESTED_AI_KNOWN", passed: Boolean(LOCAL_AI[requestedAi]) }, { check: "REQUEST_SURFACE", passed: options.detectedAi.surface === LOCAL_AI[requestedAi]?.surface }, { check: "REQUEST_VARIANT", passed: options.detectedAi.variant === null }]); await invalidateBootstrapFailure(attempt, failure); throw failure;
    }
    if (!accessFresh()) {
      attempt.preflightRefresh = true;
      try { await refresh({ context: attempt.context }); }
      catch (failure) {
        attempt.preflightRefreshTransport = registeredTransport(failure, "/v1/auth/refresh");
        attempt.preflightRefresh = false;
        if (failure.status === 401 || failure.status === 403 || terminalAuthFailure(failure)) await invalidateBootstrapFailure(attempt, failure, true);
        throw failure;
      }
      attempt.preflightRefresh = false;
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
    }
    let credentials = clone(state.credentials), authority = clone(state.authority), retried = false;
    while (true) {
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      let result;
      try { result = await requestBootstrap(credentials, authority, options.detectedAi, attempt); }
      catch (failure) {
        if (failure.status === 401 && !retried && bootstrapAttemptCurrent(attempt)) {
          retried = true; attempt.observedBootstrap401 = true;
          try { await refresh({ force: true, rejectedAccessToken: credentials.accessToken, context: attempt.context }); }
          catch (refreshFailure) {
            if (failure.status === 401 && bootstrapAttemptCurrent(attempt)) await invalidateBootstrapFailure(attempt, failure, true);
            throw failure;
          }
          if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
          credentials = clone(state.credentials); authority = clone(state.authority); continue;
        }
        if (failure.status === 401) await invalidateBootstrapFailure(attempt, failure, true);
        else if (failure.status === 403 || (failure.code === "CONTROL_RESPONSE_TOO_LARGE" && failure.responseOk === true)) await invalidateBootstrapFailure(attempt, failure, false);
        throw failure;
      }
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      let verified;
      try {
        const verify = bootstrapContractVersion() === "control_plane_v3" ? verifier.verifyV3 : verifier.verifyV2;
        if (typeof verify !== "function") throw error("BOOTSTRAP_VERIFIER_UNAVAILABLE");
        verified = await verify(result.body, config.trustBundle);
      }
      catch (verificationFailure) { const failure = error(`BOOTSTRAP_${verificationFailure?.code || "VERIFICATION_FAILED"}`); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      if (!verified.ok) { const failure = error(`BOOTSTRAP_${verified.error}`); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      const verifiedServerTimeMs = parsedMillis(verified.payload?.serverTime);
      if (options.minimumServerTimeExclusive !== undefined && (verifiedServerTimeMs === null || verifiedServerTimeMs <= options.minimumServerTimeExclusive))
        throw error("BOOTSTRAP_SERVER_TIME_NOT_ADVANCED");
      const currentDeny = verified.payload?.contractVersion === "control_plane_v3" && verified.payload?.accessBasis === "NONE";
      const privacyVariantMatches = attempt.privacyNeutral === true ? Boolean(verified.payload?.localClientAuthority) : !verified.payload?.localClientAuthority;
      const acceptedPayload = currentDeny ? verified.payload : attempt.privacyNeutral === true ? await materializeLocalAuthority(verified.payload, requestedAi).catch(() => null) : verified.payload;
      if (options.expectedAccountId && acceptedPayload?.account?.id !== options.expectedAccountId) {
        const failure = error("BOOTSTRAP_ACCOUNT_MISMATCH"); await invalidateBootstrapFailure(attempt, failure, false); throw failure;
      }
      const validationChecks = [];
      const validation = acceptedPayload ? currentDeny && privacyVariantMatches ? { workAllowed: false, requestedAi } : await validateBootstrapAuthority(verified.payload, requestedAi, attempt.privacyNeutral === true, validationChecks).catch(() => { bootstrapCheck(validationChecks, "VALIDATOR_COMPLETED", false); return null; }) : (bootstrapCheck(validationChecks, "LOCAL_MATERIALIZATION", false), null);
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      if (!validation) { const failure = bootstrapProfileFailure("SIGNED_AUTHORITY", validationChecks); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      const cacheBinding = await expectedCacheBinding(acceptedPayload, validation.requestedAi);
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      const nextAuthority = { verified: true, privacyNeutral: attempt.privacyNeutral === true, workAllowed: validation.workAllowed, payload: acceptedPayload, envelope: verified.envelope, deviceId: credentials.deviceId, sessionId: credentials.sessionId, generation: attempt.context.generation, requestedAi: validation.requestedAi, cacheBinding };
      let committed;
      try {
        committed = await queueMutation(async () => {
          if (!bootstrapAttemptCurrent(attempt)) return false;
          const current = clone(state), signedServerTimeMs = verifiedServerTimeMs, previousClock = current.cacheClock;
          if (signedServerTimeMs === null) throw error("BOOTSTRAP_SERVER_TIME_INVALID");
          if (previousClock && signedServerTimeMs < previousClock.trustedServerTimeMs) throw error("BOOTSTRAP_SERVER_TIME_REGRESSION");
          const owner = clockOwner(credentials), baseTrusted = Math.max(previousClock?.trustedServerTimeMs || 0, signedServerTimeMs), baseEffective = Math.max(previousClock?.effectiveTimeMs || 0, baseTrusted);
          const candidateClock = { cacheVersion: "control_cache_clock_v1", owner, trustedServerTimeMs: baseTrusted, effectiveTimeMs: baseEffective };
          const effective = effectiveTime(candidateClock, verified.payload);
          if (currentDeny) {
            const denyExpiresAt = parsedMillis(acceptedPayload.expiresAt);
            if (denyExpiresAt === null || effective >= denyExpiresAt) throw error("BOOTSTRAP_EXPIRED_OR_INCOMPATIBLE");
          } else if (!authorityBaseValid(acceptedPayload, effective)) throw error("BOOTSTRAP_EXPIRED_OR_INCOMPATIBLE");
          // Preserve the current common denial for identified/neutral UNAVAILABLE.
          // Merely resolving a different AI no longer changes the common generation.
          const commonDeny = currentDeny || nextAuthority.workAllowed !== true;
          const generation = commonDeny ? current.generation + 1 : current.generation;
          const clock = { ...candidateClock, effectiveTimeMs: Math.max(candidateClock.effectiveTimeMs, effective) };
          const previousGrant = grantFor(nextAuthority.requestedAi);
          const grant = commonDeny ? null : await makeGrant({ ...nextAuthority, generation }, clock);
          if (!bootstrapAttemptCurrent(attempt)) return false;
          const grants = commonDeny ? {} : Object.fromEntries(Object.entries(current.grants || {})
            .filter(([, item]) => item.authority?.requestedAi !== nextAuthority.requestedAi));
          if (grant) grants[grant.scopeKey] = grant;
          const next = { ...current, generation, principalEpoch: epoch("principalEpoch"),
            accessEpoch: epoch("accessEpoch") + (commonDeny ? 1 : 0), grants, cacheClock: clock,
            authority: grant?.authority || { ...nextAuthority, generation }, lastError: null };
          attempt.lease?.beginSecurityCommit();
          if (commonDeny) state = next;
          await commit(next, commonDeny ? current.authority : previousGrant?.authority || null, "bootstrap_verified",
            grant ? { scopeKey: grant.scopeKey, requestedAi: nextAuthority.requestedAi } : null);
          attempt.lease?.finishSecurityCommit(bootstrapFence(attempt.lease.fence.scopeKey));
          attempt.context = { ...attempt.context, generation };
          attempt.committedAuthorityIdentity = cacheIdentity(next.authority, generation);
          return bootstrapAttemptCurrent(attempt);
        });
      } catch (failure) { await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      if (!committed) throw error("AUTH_GENERATION_CHANGED");
      if (attempt.policy !== true) runtimeLastCheckpointAllowed = nextAuthority.workAllowed === true;
      return clone(acceptedPayload);
    }
  }
  function cacheIdentity(authority, generation) { return authority ? verifier.canonicalJson({ generation, deviceId: authority.deviceId, sessionId: authority.sessionId, requestedAi: authority.requestedAi ?? null, accountId: authority.payload?.account?.id || null, envelope: authority.envelope, cacheBinding: authority.cacheBinding }) : null; }
  function policyCurrent(capture) { return bootstrapAttemptSequence === capture.sequence && isCurrent(capture.context) && validCredentials(state.credentials) && cacheIdentity(state.authority, state.generation) === capture.authorityIdentity; }
  function cacheFailure(code) { return error(code); }
  async function persistCacheDenial(next, capture) {
    if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
    state = next;
    try { await persist(next); }
    catch (_) {
      runtimeFloorNeedsPersistence = true;
      state = { ...state, authority: state.authority ? { ...state.authority, workAllowed: false } : null };
      runtimeLastCheckpointAllowed = false;
      try { await chrome.storage.local.remove(STORAGE_KEY); }
      catch (removeFailure) { const failure = error("AUTH_DENIAL_PERSISTENCE_FAILED"); failure.detail = safeError(removeFailure); state = { ...state, lastError: safeError(failure) }; throw failure; }
      throw error("AUTH_DENIAL_PERSISTENCE_FAILED");
    }
    runtimeFloorNeedsPersistence = false;
    if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
  }
  async function cachedBootstrapCheckpoint(capture, payload) {
    return queueMutation(async () => {
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      const authority = state.authority, clock = state.cacheClock;
      if (!authority || !validCacheClock(clock, state.credentials, payload) || clock.owner.contractVersion !== expectedCacheContract(payload)) throw cacheFailure("CACHE_CLOCK_INVALID");
      const expiresAt = parsedMillis(payload.expiresAt), deadline = cacheAuthorityDeadline(payload);
      const legacyGraceRequired = payload?.contractVersion !== "control_plane_v3" || payload?.accessBasis === "BETA";
      if (expiresAt === null || deadline === null || legacyGraceRequired && deadline <= expiresAt) throw cacheFailure("CACHE_EXPIRY_INVALID");
      let effective;
      try { effective = effectiveTime(clock); } catch (_) { throw cacheFailure("CACHE_EFFECTIVE_TIME_INVALID"); }
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      const floor = Math.max(clock.effectiveTimeMs, effective);
      if (!validMillis(floor)) throw cacheFailure("CACHE_EFFECTIVE_TIME_INVALID");
      const freshness = effective < deadline ? (effective < expiresAt ? "FRESH" : "STALE_BUT_OFFLINE_GRACE_ELIGIBLE") : null;
      const next = floor === clock.effectiveTimeMs && !runtimeFloorNeedsPersistence ? state : { ...state, cacheClock: { ...clock, effectiveTimeMs: floor } };
      if (next !== state) {
        state = next;
        try { await persist(next); }
        catch (_) {
          runtimeFloorNeedsPersistence = true; state = { ...state, authority: state.authority ? { ...state.authority, workAllowed: false } : null }; runtimeLastCheckpointAllowed = false;
          try { await chrome.storage.local.remove(STORAGE_KEY); }
          catch (removeFailure) { const denial = error("AUTH_DENIAL_PERSISTENCE_FAILED"); denial.detail = safeError(removeFailure); state = { ...state, lastError: safeError(denial) }; throw denial; }
          throw error("AUTH_DENIAL_PERSISTENCE_FAILED");
        }
        runtimeFloorNeedsPersistence = false;
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      }
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      if (!freshness) { await persistCacheDenial({ ...state, cacheClock: { ...state.cacheClock, effectiveTimeMs: floor }, authority: { ...authority, workAllowed: false } }, capture); throw cacheFailure("CACHE_EXPIRED"); }
      let completion;
      try { completion = effectiveTime(state.cacheClock); } catch (_) { throw cacheFailure("CACHE_EFFECTIVE_TIME_INVALID"); }
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      if (completion >= deadline) {
        const denialFloor = Math.max(state.cacheClock.effectiveTimeMs, completion);
        await persistCacheDenial({ ...state, cacheClock: { ...state.cacheClock, effectiveTimeMs: denialFloor }, authority: { ...authority, workAllowed: false } }, capture);
        throw cacheFailure("CACHE_EXPIRED");
      }
      const resultFreshness = completion < expiresAt ? "FRESH" : "STALE_BUT_OFFLINE_GRACE_ELIGIBLE";
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      runtimeLastCheckpointAllowed = false;
      return { source: "CACHE", freshness: resultFreshness, payload: clone(payload) };
    });
  }
  function subscriptionRefreshJitter(deviceId) {
    let hash = 2166136261;
    for (const char of String(deviceId || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % (SUBSCRIPTION_REFRESH_JITTER_MAX_MS + 1);
  }
  async function getSubscriptionRefreshPlan() {
    await init();
    if (bootstrapContractVersion() !== "control_plane_v3")
      return Object.freeze({ active: false, reason: "NEGOTIATION_DORMANT" });
    const authority = state.authority, payload = authority?.payload, credentials = state.credentials, clock = state.cacheClock;
    if (!authority || !credentials || !clock || payload?.contractVersion !== "control_plane_v3")
      return Object.freeze({ active: false, reason: "V3_AUTHORITY_MISSING" });
    if (payload.accessBasis === "NONE" || authority.workAllowed !== true)
      return Object.freeze({ active: false, reason: "V3_AUTHORITY_DENIED" });
    let effectiveTimeMs;
    try { effectiveTimeMs = effectiveTime(clock, payload); }
    catch (_) { return Object.freeze({ active: false, reason: "V3_AUTHORITY_INVALID" }); }
    const serverTimeMs = parsedMillis(payload.serverTime), expiresAt = parsedMillis(payload.expiresAt);
    if (serverTimeMs === null || expiresAt === null)
      return Object.freeze({ active: false, reason: "V3_AUTHORITY_INVALID" });
    const cadenceDue = serverTimeMs + SUBSCRIPTION_REFRESH_INTERVAL_MS - subscriptionRefreshJitter(credentials.deviceId);
    let effectiveDueAt = cadenceDue, reason = "CADENCE";
    if (payload.accessBasis === "COMMERCIAL") {
      const paidThrough = parsedMillis(payload.subscriptionAccess?.paidThrough);
      if (paidThrough !== null && paidThrough > serverTimeMs && paidThrough <= effectiveDueAt) {
        effectiveDueAt = paidThrough;
        reason = "PAID_THROUGH";
      } else if (payload.subscriptionAccess === null && expiresAt <= effectiveDueAt) {
        effectiveDueAt = expiresAt;
        reason = "TRIAL_EXPIRY";
      }
    } else if (payload.accessBasis === "BETA") {
      const legacyGrace = parsedMillis(payload.offlineGraceUntil);
      if (legacyGrace !== null && legacyGrace <= effectiveDueAt) {
        effectiveDueAt = legacyGrace;
        reason = "BETA_GRACE";
      }
    }
    if (!validMillis(effectiveDueAt))
      return Object.freeze({ active: false, reason: "V3_AUTHORITY_INVALID" });
    const dueAt = now() + Math.max(0, effectiveDueAt - effectiveTimeMs);
    if (!validMillis(dueAt))
      return Object.freeze({ active: false, reason: "V3_REFRESH_DUE_INVALID" });
    const identity = Object.freeze({
      accountId: payload.account.id,
      deviceId: credentials.deviceId,
      sessionId: credentials.sessionId,
      generation: state.generation,
      contractVersion: payload.contractVersion,
      configVersion: payload.configVersion,
      serverTime: payload.serverTime,
      paidThrough: payload.subscriptionAccess?.paidThrough || null,
    });
    return Object.freeze({ active: true, reason, dueAt, effectiveDueAt, identity });
  }
  async function runSubscriptionRefreshTask(expectedIdentity) {
    await init();
    const plan = await getSubscriptionRefreshPlan();
    if (!plan.active) return { status: "INACTIVE", reason: plan.reason };
    if (!expectedIdentity || verifier.canonicalJson(expectedIdentity) !== verifier.canonicalJson(plan.identity))
      return { status: "STALE" };
    const authority = state.authority, entryContext = contextForState();
    if (subscriptionRefreshFlight && ownerCurrent(subscriptionRefreshFlight) && subscriptionRefreshFlight.context && isCurrent(subscriptionRefreshFlight.context) && subscriptionRefreshFlight.identity === verifier.canonicalJson(plan.identity))
      return subscriptionRefreshFlight.promise;
    const requestedAi = authority.requestedAi;
    const detectedAi = requestedAi && LOCAL_AI[requestedAi] ? { family: requestedAi, surface: LOCAL_AI[requestedAi].surface, variant: null } : null;
    const owner = { context: entryContext, identity: verifier.canonicalJson(plan.identity), promise: null };
    owner.promise = (async () => {
      const previousServerTimeMs = parsedMillis(authority.payload.serverTime);
      if (previousServerTimeMs === null) throw error("SUBSCRIPTION_AUTHORITY_TIME_INVALID");
      const payload = await bootstrap({
        context: entryContext,
        expectedAccountId: authority.payload.account.id,
        minimumServerTimeExclusive: previousServerTimeMs,
        ...(detectedAi ? { detectedAi } : {}),
      });
      const denied = payload?.contractVersion === "control_plane_v3" && payload?.accessBasis === "NONE";
      return {
        status: denied ? "DENY" : "REFRESHED",
        contractVersion: payload?.contractVersion || null,
        configVersion: payload?.configVersion || null,
        serverTime: payload?.serverTime || null,
      };
    })().finally(() => { if (subscriptionRefreshFlight === owner) subscriptionRefreshFlight = null; });
    subscriptionRefreshFlight = owner;
    return owner.promise;
  }

  async function bootstrapWithPolicyActive(options = {}, lease = null, principal = null) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context)) throw error("AUTH_CONTEXT_INVALID");
    const sequence = ++bootstrapAttemptSequence, attempt = { sequence, context: null, observedBootstrap401: false, preflightRefresh: false, policy: true, lease, principal };
    if (lease) bootstrapAttempts.set(lease.acquisitionId, attempt);
    try {
      await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership();
      attempt.context = options.context ? clone(options.context) : contextForState();
      if (!isCurrent(attempt.context)) throw error("AUTH_GENERATION_CHANGED");
      const requestedAi = options.detectedAi?.family || null;
      const capturedAuthority = clone(state.authority), capturedClock = clone(state.cacheClock);
      Object.assign(attempt, { requestedAi, authority: capturedAuthority, clock: capturedClock, authorityIdentity: cacheIdentity(capturedAuthority, attempt.context.generation) });
      const payload = await bootstrapOnline(options, attempt);
      if (!bootstrapAttemptCurrent(attempt) || !attempt.committedAuthorityIdentity || cacheIdentity(state.authority, state.generation) !== attempt.committedAuthorityIdentity) throw error("AUTH_GENERATION_CHANGED");
      return { source: "ONLINE", freshness: "FRESH", payload: clone(payload) };
    } catch (onlineFailure) {
      const capture = typeof attempt.authorityIdentity === "string" || attempt.authorityIdentity === null ? attempt : null;
      const eligible = capture && !attempt.observedBootstrap401 && (registeredTransport(onlineFailure, "/v1/bootstrap") || (attempt.preflightRefreshTransport === true && registeredTransport(onlineFailure, "/v1/auth/refresh")) || (httpErrorProvenance.get(onlineFailure) === endpointFor("/v1/bootstrap") && onlineFailure.status === 503 && onlineFailure.code === "BOOTSTRAP_UNAVAILABLE"));
      if (eligible && capture.requestedAi && bootstrapAttemptCurrent(attempt)) {
        const cached = await scopedCacheCheckpoint(capture.requestedAi, attempt.lease);
        // A confirmed expiry rejects the acquisition under its revocation receipt;
        // it must never acknowledge a newer fence as an allowed result.
        if (cached.changed) throw cacheFailure("CACHE_EXPIRED");
        if (cached.invalid) throw cacheFailure("CACHE_VERIFICATION_FAILED");
        if (!bootstrapAttemptCurrent(attempt)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (cached.grant) {
          const payload = cached.grant.authority.payload;
          const effective = effectiveTime(cached.grant.cacheClock, payload);
          const expiresAt = parsedMillis(payload.expiresAt), deadline = cacheAuthorityDeadline(payload);
          if (expiresAt === null || deadline === null || effective >= deadline) throw cacheFailure("CACHE_EXPIRED");
          if (!cached.allowed) throw onlineFailure;
          return { source: "CACHE", freshness: effective < expiresAt ? "FRESH" : "STALE_BUT_OFFLINE_GRACE_ELIGIBLE", payload: clone(payload) };
        }
        // An already expired legacy authority has no operational grant. Preserve
        // the existing verified legacy-cache diagnostics below, never invent a grant.
      }
      if (!eligible || !policyCurrent(capture)) throw onlineFailure;
      const authority = capture.authority, requestedAi = capture.requestedAi;
      if (!authority || authority.requestedAi !== requestedAi || !capture.clock || !validCacheBinding(authority.cacheBinding)) throw onlineFailure;
      let verified;
      try {
        verified = await verifyCachedEnvelope(authority.envelope);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (!verified.ok) throw cacheFailure("CACHE_VERIFICATION_FAILED");
        const verifiedPayload = verified.payload.localClientAuthority ? await materializeLocalAuthority(verified.payload, requestedAi) : verified.payload;
        if (!verifiedPayload || verifier.canonicalJson(verifiedPayload) !== verifier.canonicalJson(authority.payload)) throw cacheFailure("CACHE_VERIFICATION_FAILED");
        const validation = await validateAccountProfile(verifiedPayload, requestedAi, true);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (!validation || validation.requestedAi !== requestedAi) throw cacheFailure("CACHE_CONTEXT_MISMATCH");
        const expected = await expectedCacheBinding(verifiedPayload, validation.requestedAi);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (verifier.canonicalJson(authority.cacheBinding) !== verifier.canonicalJson(expected) || !validCacheClock(capture.clock, state.credentials, verified.payload) || capture.clock.owner.contractVersion !== expectedCacheContract(verified.payload)) throw cacheFailure("CACHE_CONTEXT_MISMATCH");
        const currentAuthority = state.authority;
        if (!currentAuthority || cacheIdentity(currentAuthority, state.generation) !== capture.authorityIdentity) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        const result = await cachedBootstrapCheckpoint(capture, verifiedPayload);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        return result;
      } catch (cacheError) {
        if (cacheError?.code === "AUTH_DENIAL_PERSISTENCE_FAILED" || cacheError?.code === "CACHE_ACQUISITION_OBSOLETED" || cacheError?.code === "CACHE_CLOCK_INVALID" || cacheError?.code === "CACHE_EFFECTIVE_TIME_INVALID" || cacheError?.code === "CACHE_CONTEXT_MISMATCH" || cacheError?.code === "CACHE_VERIFICATION_FAILED" || cacheError?.code === "CACHE_EXPIRY_INVALID" || cacheError?.code === "CACHE_EXPIRED") throw cacheError;
        throw onlineFailure;
      }
    }
  }
  async function bootstrapActive(options = {}, lease = null, principal = null) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context) || options.expectedAccountId !== undefined && !UUID.test(options.expectedAccountId) || options.minimumServerTimeExclusive !== undefined && !validMillis(options.minimumServerTimeExclusive)) throw error("AUTH_CONTEXT_INVALID");
    const sequence = ++bootstrapAttemptSequence, attempt = { sequence, context: options.context ? clone(options.context) : null, observedBootstrap401: false, preflightRefresh: false, lease, principal, requestedAi: options.detectedAi?.family || null };
    if (lease) bootstrapAttempts.set(lease.acquisitionId, attempt);
    await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership(); if (!attempt.context) attempt.context = contextForState(); if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
    return bootstrapOnline(options, attempt);
  }
  async function bootstrapWithPolicy(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw error("AUTH_CONTEXT_INVALID");
    return scheduleBootstrap(options, "POLICY", (captured, lease, principal) => bootstrapWithPolicyActive(captured, lease, principal));
  }
  async function bootstrap(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw error("AUTH_CONTEXT_INVALID");
    const payload = await scheduleBootstrap(options, "RAW", (captured, lease, principal) => bootstrapActive(captured, lease, principal));
    // Reuse initiated configuration synchronization; no tab polling, timer or
    // marketplace hook. The per-AI cache coalesces pulls and checks infrequently.
    if (payload?.ai?.status === "RESOLVED" && LOCAL_AI[payload.ai.detected?.family])
      void getPromptTree(payload.ai.detected.family);
    return payload;
  }
  // Privileged release diagnostics: retain the installed client's own storage and
  // refresh transaction. This never activates a device or grants Work authority.
  async function acquireBootstrapPreflight(input) {
    let body = input?.request;
    if (!exactKeys(input, ["expectedAccountId", "request"]) || !UUID.test(input.expectedAccountId) ||
        !exactKeys(body, ["contractVersion", "extensionVersion", "browser", "deviceId", "lastConfigVersion"]) ||
        !exactKeys(body.browser, ["family", "version"]) || !UUID.test(body.deviceId) || body.lastConfigVersion !== null ||
        body.contractVersion !== "control_plane_v2" || body.contractVersion !== config.contractVersion ||
        body.extensionVersion !== config.extensionVersion || body.browser.family !== browserFamily() ||
        body.browser.version !== browserVersion()) throw error("PREFLIGHT_CONTEXT_MISMATCH");
    body = clone(body);
    const expectedAccountId = input.expectedAccountId;
    // restore() resumes a pending activation. A release probe must never do that.
    const saved = initialized ? state : (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (!saved?.credentials || saved.pending) throw error("PREFLIGHT_EXISTING_SESSION_REQUIRED");
    if (saved.credentials.deviceId !== body.deviceId) throw error("PREFLIGHT_CONTEXT_MISMATCH");
    await init();
    if (!state.credentials || state.pending || state.credentials.deviceId !== body.deviceId) throw error("PREFLIGHT_EXISTING_SESSION_REQUIRED");
    const context = contextForState();
    const result = await authenticatedRequest("/v1/bootstrap", { method: "POST", body: clone(body) }, context);
    if (!isCurrent(context)) throw error("AUTH_GENERATION_CHANGED");
    const verified = await verifier.verifyV2(result.body, config.trustBundle);
    if (!isCurrent(context)) throw error("AUTH_GENERATION_CHANGED");
    if (!verified?.ok) throw error("PREFLIGHT_SIGNATURE_INVALID");
    const payload = verified.payload;
    if (payload?.contractVersion !== body.contractVersion || payload?.snapshotVersion !== "bootstrap_snapshot_v2" ||
        payload?.account?.id !== expectedAccountId || payload.account.status !== "ACTIVE" ||
        payload?.ai?.status !== "UNCONFIGURED") throw error("PREFLIGHT_SIGNED_CONTEXT_MISMATCH");
    const serverTime = parsedMillis(payload.serverTime), expiresAt = parsedMillis(payload.expiresAt);
    if (serverTime === null || expiresAt === null || Math.max(now(), serverTime) >= expiresAt) throw error("PREFLIGHT_SIGNATURE_EXPIRED");
    return { envelope: clone(verified.envelope), authenticatedContext: {
      accountId: payload.account.id, deviceId: context.deviceId,
      browserFamily: browserFamily(), browserVersion: browserVersion(), controlApiOrigin: config.controlApiOrigin,
    } };
  }
  async function ensureForIdentity(identity) {
    await init(); if (authStorageUnconfirmed) throw error("AUTH_STATE_COMMIT_UNCONFIRMED");
    if (!state.credentials) throw error("AUTH_REQUIRED");
    const requested = requestedFamily(identity); if (!requested) throw error("WORK_UNSUPPORTED_AI");
    const decision = await scopedCacheCheckpoint(requested), current = grantFor(requested)?.authority;
    if (decision.allowed && decision.identity === authorityDecisionIdentity(current) && current?.generation === state.generation)
      return clone(current.payload);
    return bootstrap({ detectedAi: { family: requested, surface: LOCAL_AI[requested].surface, variant: null } });
  }
  async function discardRestoredAuthority(failure) {
    const context = contextForState();
    let changed = false, generation = state.generation;
    await queueMutation(async () => {
      if (!isCurrent(context)) return;
      const previous = state.authority;
      const next = { ...state, generation: state.generation + 1, accessEpoch: epoch("accessEpoch") + 1,
        grants: {}, authority: null, lastError: safeError(failure) };
      state = next;
      try { await persist(next); } catch (_) { try { await chrome.storage.local.remove(STORAGE_KEY); } catch (removeFailure) { state = { ...state, lastError: safeError(Object.assign(error("AUTH_DENIAL_PERSISTENCE_FAILED"), { detail: safeError(removeFailure) })) }; } }
      changed = Boolean(previous); generation = state.generation;
    });
    if (changed) void notifyAuthorityChange(null, "authority_invalid", generation);
  }
  async function discardOrphanCredentialState() {
    const next = { ...state, rotation: null, authority: null, grants: {}, cacheClock: null };
    state = next;
    try { await persist(next); } catch (_) { /* signed-out memory remains safe; pending state is not discarded */ }
  }
  function storedAuthShapeError(saved) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return "AUTH_STATE_SCHEMA_INVALID";
    if (saved.authStateSchema !== undefined && saved.authStateSchema !== 2) return "AUTH_STATE_SCHEMA_UNSUPPORTED";
    for (const name of ["generation", "principalEpoch", "accessEpoch"]) {
      if (saved[name] === undefined && name !== "generation" && saved.authStateSchema === undefined) continue;
      if (!Number.isSafeInteger(saved[name]) || saved[name] < 0) return "AUTH_EPOCH_INVALID";
    }
    if (saved.grants === undefined && saved.authStateSchema === 2) return "AUTH_GRANT_HISTORY_INVALID";
    if (saved.grants !== undefined) {
      if (!saved.grants || typeof saved.grants !== "object" || Array.isArray(saved.grants)) return "AUTH_GRANT_HISTORY_INVALID";
      for (const [scopeKey, grant] of Object.entries(saved.grants)) {
        if (!grant || typeof grant !== "object" || grant.schemaVersion !== 1 || grant.scopeKey !== scopeKey ||
          !Number.isSafeInteger(grant.grantEpoch) || grant.grantEpoch < 1 ||
          !grant.authority || grant.authority.generation !== saved.generation ||
          grant.authority.deviceId !== saved.credentials?.deviceId || grant.authority.sessionId !== saved.credentials?.sessionId ||
          grant.authority.payload?.account?.id !== saved.authority?.payload?.account?.id ||
          grant.principalEpoch !== (saved.principalEpoch ?? saved.generation) || grant.accessEpoch !== (saved.accessEpoch ?? 0))
          return "AUTH_GRANT_HISTORY_INVALID";
      }
    }
    if (saved.authMigration !== undefined) {
      const migration = saved.authMigration;
      if (!migration || migration.sourceSchema !== 1 || migration.targetSchema !== 2 || migration.phase !== "COMMITTED" ||
        !/^[a-f0-9]{64}$/.test(migration.sourceDigest || "") || migration.migrationId !== "auth-v2:" + migration.sourceDigest)
        return "AUTH_MIGRATION_REVALIDATION_REQUIRED";
    }
    return null;
  }
  async function legacyAuthMigration(saved) {
    const bytes = new TextEncoder().encode(verifier.canonicalJson(saved));
    const sourceDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
    return { sourceSchema: 1, targetSchema: 2, migrationId: "auth-v2:" + sourceDigest, sourceDigest, phase: "COMMITTED" };
  }
  async function restoreOnce() {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    const result = await chrome.storage.local.get(STORAGE_KEY), saved = result[STORAGE_KEY];
    if (saved !== undefined && saved !== null) {
      const schemaFailure = storedAuthShapeError(saved);
      if (schemaFailure) {
        // Preserve the unrecognized record for compatible recovery. No fallback
        // to its old authority or rewrite of generations/history is permitted.
        authStorageUnconfirmed = true;
        state = { ...state, lastError: { code: schemaFailure } };
        initialized = true;
        return publicStatus({ allowed: false, persistenceFailure: true });
      }
      state = { ...state, ...clone(saved), principalEpoch: saved.principalEpoch ?? saved.generation,
        accessEpoch: saved.accessEpoch ?? 0, grants: saved.grants ?? {} };
      if (saved.authStateSchema === undefined) state.authMigration = await legacyAuthMigration(saved);
    }
    if (state.credentials !== null && state.credentials !== undefined && !validCredentials(state.credentials)) await invalidateKnown(contextForState(), error("STORED_CREDENTIALS_INVALID"), true);
    else if ((state.credentials === null || state.credentials === undefined) && saved && (state.rotation || state.authority || state.cacheClock)) await discardOrphanCredentialState();
    if (state.credentials && !validCacheClock(state.cacheClock, state.credentials)) await invalidateKnown(contextForState(), error("STORED_CACHE_CLOCK_INVALID"), true);
    if (state.credentials && state.authority) {
      const savedAuthority = state.authority, binding = savedAuthority.cacheBinding, clock = state.cacheClock;
      let authorityFailure = null;
      if (!validCacheBinding(binding)) authorityFailure = error("STORED_CACHE_BINDING_INVALID");
      else if (savedAuthority.deviceId !== state.credentials.deviceId || savedAuthority.sessionId !== state.credentials.sessionId) await invalidateKnown(contextForState(), error("AUTHORITY_CREDENTIAL_MISMATCH"), true);
      else if (savedAuthority.generation !== state.generation) await invalidateKnown(contextForState(), error("STORED_AUTHORITY_GENERATION_MISMATCH"), true);
      else if (binding.controlApiOrigin !== config.controlApiOrigin || binding.portalOrigin !== config.portalOrigin) authorityFailure = error("STORED_CACHE_CONTEXT_MISMATCH");
      else {
        try {
          const verified = await verifyCachedEnvelope(savedAuthority.envelope); if (!verified.ok) throw error(`STORED_AUTHORITY_${verified.error}`);
          const storedDeny = verified.payload?.contractVersion === "control_plane_v3" && verified.payload?.accessBasis === "NONE";
          const verifiedPayload = storedDeny ? verified.payload : verified.payload.localClientAuthority ? await materializeLocalAuthority(verified.payload, savedAuthority.requestedAi) : verified.payload;
          if (!verifiedPayload || verifier.canonicalJson(verifiedPayload) !== verifier.canonicalJson(savedAuthority.payload)) throw error("STORED_AUTHORITY_PAYLOAD_MISMATCH");
          const allowed = storedDeny ? { workAllowed: false, requestedAi: savedAuthority.requestedAi ?? null } : await validateAccountProfile(verifiedPayload, savedAuthority.requestedAi, false).catch(() => null); if (!allowed) throw error("STORED_AUTHORITY_POLICY_MISMATCH");
          if (!validCacheClock(clock, state.credentials, verified.payload) || verified.payload.contractVersion === "control_plane_v3" && clock.owner.contractVersion !== "control_plane_v3") throw error("STORED_CACHE_CLOCK_INCONSISTENT");
          const expected = await expectedCacheBinding(verifiedPayload, allowed.requestedAi);
          if (verifier.canonicalJson(binding) !== verifier.canonicalJson(expected)) throw error("STORED_CACHE_CONTEXT_MISMATCH");
          if (!storedDeny && !await validateAccountProfile(verifiedPayload, savedAuthority.requestedAi, true).catch(() => null)) throw error("STORED_AUTHORITY_ENVIRONMENT_MISMATCH");
          state.authority = { ...savedAuthority, privacyNeutral: Boolean(verified.payload.localClientAuthority), payload: verifiedPayload, requestedAi: allowed.requestedAi, workAllowed: savedAuthority.workAllowed === true && allowed.workAllowed === true };
        } catch (failure) { authorityFailure = failure; }
      }
      if (authorityFailure) {
        if (authorityFailure.code === "STORED_CACHE_CLOCK_INCONSISTENT") await invalidateKnown(contextForState(), authorityFailure, true);
        else if (state.credentials) await discardRestoredAuthority(authorityFailure);
      }
    }
    if (state.pending && !validRestoredPending(state.pending)) await invalidateKnown(contextForState(), error("ACTIVATION_CONTEXT_MISMATCH"), true);
    try { await transferVault?.prune(now()); } catch (_) { /* transfer actions fail closed on vault access; auth restore remains independent */ }
    const restoredDecision = state.authority && state.credentials ? await cacheAuthorizationCheckpoint() : { allowed: false };
    // The auth migration is one existing storage-key replacement, followed by
    // exact readback; there is no cross-key staging window or renewed TTL.
    if (saved && saved.authStateSchema === undefined && !authStorageUnconfirmed) await persist(state);
    initialized = true; if (pendingLive(state.pending)) void ensurePolling(); return publicStatus(restoredDecision);
  }
  function init() { if (initialized) { void retryPendingMetadataForget(); return Promise.resolve(publicStatus()); } if (!initFlight) initFlight = restoreOnce().finally(() => { initFlight = null; }); return initFlight.then(status => { void retryPendingMetadataForget(); return status; }); }
  async function retryPendingMetadataForget() { try { const stored = await chrome.storage.local.get(METADATA_CLEAR_KEY); const marker = stored?.[METADATA_CLEAR_KEY]; if (marker?.version === "pending_client_metadata_clear_v1" && marker.deviceId === state.credentials?.deviceId) void scheduleMetadataForget(); } catch (_) {} }
  async function localReset() { await init(); await queueMutation(async () => {
    activationFlight = null; pollingFlight = null; refreshFlight = null; subscriptionRefreshFlight = null;
    const previous = state.authority, next = { generation: state.generation + 1, principalEpoch: epoch("principalEpoch") + 1, accessEpoch: epoch("accessEpoch") + 1, grants: {}, credentials: null, pending: null, rotation: null, authority: null, cacheClock: null, lastError: null };
    state = next; resetRuntimeClock();
    // Retire every old-principal waiter before another principal can acquire.
    // Disposing preserves quarantine if a security write was not confirmed.
    bootstrapScheduler?.dispose("AUTH_GENERATION_CHANGED");
    bootstrapScheduler = null;
    let cleanupFailure = null;
    try { await clearTransferRecipientVault(); } catch (failure) { cleanupFailure = failure; }
    await commit({ ...next, lastError: cleanupFailure ? safeError(cleanupFailure) : null }, previous, "local_reset");
    if (cleanupFailure) throw cleanupFailure;
  }); return publicStatus(); }
  async function cancelActivation() { await init(); await queueMutation(async () => { activationFlight = null; pollingFlight = null; await commit({ ...state, generation: state.generation + 1, pending: null, lastError: null }, state.authority, "activation_cancelled"); }); return publicStatus(); }
  function validSyncReadEntityId(value) {
    if (typeof value !== "string") return false;
    if (/^conversation:[a-f0-9]{64}$/.test(value)) return true;
    if (!/^store:.{1,122}$/s.test(value)) return false;
    return [...value.slice("store:".length)].every(character => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    });
  }
  async function synchronizeMetadata(body) {
    await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership();
    const entries = body?.entries, readEntityIds = body?.readEntityIds ?? [];
    if (!body || body.syncVersion !== "seller_agents_sync_v1" || !Array.isArray(entries) || entries.length > 32 ||
      !Array.isArray(readEntityIds) || readEntityIds.length > 32 || entries.length + readEntityIds.length < 1 ||
      entries.length + readEntityIds.length > 32 || new Set(readEntityIds).size !== readEntityIds.length ||
      readEntityIds.some(value => !validSyncReadEntityId(value))) throw error("SYNC_REQUEST_INVALID");
    return (await authenticatedRequest("/v1/sync", { method: "POST", body: { ...body, installationId: state.credentials.deviceId } })).body;
  }
  async function transferAuth() {
    await init();
    if (!state.credentials || !state.authority?.payload?.account?.id) throw error("AUTH_REQUIRED");
    await ensureAuthOwnership();
    const context = contextForState();
    return { credentials: clone(state.credentials), accountId: state.authority.payload.account.id, sessionId: state.credentials.sessionId, context };
  }
  // A transfer may cross crypto/storage awaits. Its original account and auth
  // generation remain authoritative even after reset and re-login to that account.
  function assertCredentialTransferContext(context) {
    if (!validContext(context) || !context.accountId || !context.deviceId || !context.sessionId ||
        !isCurrent(context) || state.authority?.payload?.account?.id !== context.accountId ||
        !validAuthOwnership()) throw error("AUTH_GENERATION_CHANGED");
    return true;
  }
  // Backup authority is pinned once before crypto and remains synchronous at
  // the catalog write barrier, including logout/re-login to the same account.
  function assertBackupContext(context) {
    return assertCredentialTransferContext(context);
  }
  async function captureBackupContext() {
    await init();
    const accountId = state.authority?.payload?.account?.id;
    if (!state.credentials || !accountId) throw error("AUTH_REQUIRED");
    const context = Object.freeze(contextForState({ accountId }));
    assertBackupContext(context);
    return context;
  }
  function transferRecordMatches(record, auth) {
    return Boolean(record && record.accountId === auth.accountId && record.recipientDeviceId === auth.credentials.deviceId && record.sessionId === auth.sessionId);
  }
  function transferBodyFromRecord(record) {
    return { requestId: record.requestId, recipientDeviceId: record.recipientDeviceId, recipientPublicKeySpki: record.publicKeySpki, sourceDeviceId: record.sourceDeviceId || null, selectedStores: record.selectedStoreIds.map(storeId => ({ storeId })), consent: true, expiresInSeconds: record.expiresInSeconds };
  }
  function assertTransferRequestMatches(record, result) {
    const stores = Array.isArray(result?.selectedStores) ? result.selectedStores.map(item => item?.storeId) : [];
    if (!result || result.requestId !== record.requestId || result.accountId !== record.accountId || result.recipientDeviceId !== record.recipientDeviceId || result.recipientPublicKeySpki !== record.publicKeySpki || (record.sourceDeviceId && result.sourceDeviceId !== record.sourceDeviceId) || verifier.canonicalJson(stores) !== verifier.canonicalJson(record.selectedStoreIds) || !Number.isFinite(Date.parse(result.expiresAt))) throw error("TRANSFER_REQUEST_MISMATCH");
    return result;
  }
  function safeTransferResult(input) {
    if (!input || input.importState !== "IMPORTED" || typeof input.requestId !== "string" || !Array.isArray(input.results)) throw error("TRANSFER_RESULT_INVALID");
    return { requestId: input.requestId, importState: "IMPORTED", results: input.results.map(item => ({ storeId: typeof item?.storeId === "string" ? item.storeId : null, kind: typeof item?.kind === "string" ? item.kind : null, code: typeof item?.code === "string" ? item.code : null, store: item?.store ? { id: String(item.store.id || ""), marketplace: String(item.store.marketplace || ""), credentialRevision: String(item.store.credentialRevision || "") } : null })) };
  }
  function publicTransferRecord(record) {
    return clone({ requestId: record.requestId, sourceDeviceId: record.sourceDeviceId || null, phase: record.phase, expiresAt: record.expiresAt, packetId: record.packetId || null, result: record.result || null });
  }
  async function requireTransferRecord(requestId, auth = null) {
    const identity = auth || await transferAuth(), record = await transferVault.get(requestId);
    if (!record) throw error("TRANSFER_KEY_MISSING");
    if (!transferRecordMatches(record, identity)) throw error("TRANSFER_ACCOUNT_MISMATCH");
    return { auth: identity, record };
  }
  async function reconcilePreparedCredentialTransfer(record, auth) {
    if (record.phase !== "PREPARED") return record;
    const body = transferBodyFromRecord(record), options = { method: "POST", body };
    let response;
    try { response = await authenticatedRequest("/v1/credential-transfers", options, auth.context); }
    catch (failure) {
      if (failure?.status) throw failure;
      response = await authenticatedRequest("/v1/credential-transfers", options, auth.context);
    }
    const result = assertTransferRequestMatches(record, response.body);
    const currentAuth = await transferAuth();
    if (!transferRecordMatches(record, currentAuth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
    const active = await transferVault.update(record.requestId, current => ({ ...current, phase: "ACTIVE", sourceDeviceId: result.sourceDeviceId || current.sourceDeviceId || null, expiresAt: result.expiresAt }));
    return { record: active, request: clone(result) };
  }
  async function createCredentialTransfer(input = {}) {
    const auth = await transferAuth();
    if (input.consent !== true) throw error("TRANSFER_CONSENT_REQUIRED");
    if (!transferVault) throw error("TRANSFER_VAULT_UNAVAILABLE");
    const keys = await SellerAgentsCredentialTransferCrypto.generateRecipientKeyPair(), requestId = input.requestId || crypto.randomUUID();
    const selectedStoreIds = (input.selectedStoreIds || []).map(value => String(value).trim());
    const requestedExpiry = input.expiresInSeconds === undefined ? 300 : Number(input.expiresInSeconds);
    if (selectedStoreIds.length > 16 || selectedStoreIds.some(value => !value || value.length > 128) || !Number.isInteger(requestedExpiry)) throw error("TRANSFER_REQUEST_INVALID");
    const expiresInSeconds = Math.min(900, Math.max(60, requestedExpiry));
    const prepared = { vaultVersion: transferVault.VERSION, requestId, accountId: auth.accountId, recipientDeviceId: auth.credentials.deviceId, sessionId: auth.sessionId, sourceDeviceId: input.sourceDeviceId || null, selectedStoreIds, publicKeySpki: keys.publicKeySpki, privateKey: keys.privateKey, expiresInSeconds, expiresAt: new Date(now() + expiresInSeconds * 1000).toISOString(), phase: "PREPARED", packetId: null, result: null };
    try { await transferVault.put(prepared); } catch (failure) { throw error("TRANSFER_VAULT_PERSIST_FAILED", safeError(failure)); }
    const reconciled = await reconcilePreparedCredentialTransfer(prepared, auth);
    return clone(reconciled.request);
  }
  async function listCredentialTransferRecipients() {
    const auth = await transferAuth();
    if (!transferVault) throw error("TRANSFER_VAULT_UNAVAILABLE");
    const rows = [];
    for (const stored of await transferVault.list()) {
      if (!transferRecordMatches(stored, auth)) { await transferVault.remove(stored.requestId).catch(() => null); continue; }
      let record = stored;
      if (record.phase === "PREPARED") {
        try { record = (await reconcilePreparedCredentialTransfer(record, auth)).record; }
        catch (failure) { if (failure?.code === "TRANSFER_EXPIRED" || failure?.code === "TRANSFER_REPLAY" || failure?.code === "TRANSFER_ACCOUNT_MISMATCH") await transferVault.remove(record.requestId).catch(() => null); else rows.push(publicTransferRecord(record)); continue; }
      }
      rows.push(publicTransferRecord(record));
    }
    return rows;
  }
  async function listCredentialTransfers() { const auth = await transferAuth(); return clone((await authenticatedRequest("/v1/credential-transfers/pending/source", {}, auth.context)).body); }
  async function readCredentialTransfer(requestId) { const auth = await transferAuth(); return clone((await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(requestId)}`, {}, auth.context)).body); }
  async function markCredentialTransferSourceSeen(requestId) { const auth = await transferAuth(); return clone((await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(requestId)}/source-seen`, { method: "POST" }, auth.context)).body); }
  async function submitCredentialTransferPacket(input) { const auth = await transferAuth(); return clone((await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(input.requestId)}/packet`, { method: "POST", body: { requestId: input.requestId, packetId: input.packetId, envelope: input.envelope } }, auth.context)).body); }
  async function receiveCredentialTransfer(requestId, sourceDeviceId) {
    return transferSingleFlight(requestId, async () => {
      const { auth, record } = await requireTransferRecord(requestId);
      const importContext = { ...auth.context, accountId: auth.accountId };
      assertCredentialTransferContext(importContext);
      if (record.phase === "ACKED_RESULT") return { ackedResult: true, result: clone(record.result), importContext };
      if (record.phase === "IMPORTED_PENDING_ACK") return { pendingAck: true, packet: { packetId: record.packetId }, result: clone(record.result), importContext };
      if (!record.privateKey) throw error("TRANSFER_KEY_MISSING");
      const packet = (await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(requestId)}/packet`, {}, auth.context)).body;
      if (!packet?.packetId || packet.requestId !== requestId) throw error("TRANSFER_PACKET_INVALID");
      const current = await transferVault.update(requestId, value => ({ ...value, phase: "RECEIVING", sourceDeviceId: sourceDeviceId || value.sourceDeviceId || null, packetId: packet.packetId }));
      if (!transferRecordMatches(current, await transferAuth())) throw error("TRANSFER_ACCOUNT_MISMATCH");
      const payload = await SellerAgentsCredentialTransferCrypto.decrypt({ envelope: packet.envelope, privateKey: current.privateKey, accountId: auth.accountId, requestId, sourceDeviceId, recipientDeviceId: auth.credentials.deviceId, packetId: packet.packetId });
      assertCredentialTransferContext(importContext);
      return { packet, payload, importContext };
    });
  }
  async function recordCredentialTransferImported(input) {
    const { record } = await requireTransferRecord(input?.requestId);
    if (input.importContext) assertCredentialTransferContext(input.importContext);
    if (!input?.packetId || record.packetId !== input.packetId) throw error("TRANSFER_PACKET_CHANGED");
    if (record.phase === "ACKED_RESULT" && record.result) return clone(record.result);
    if (record.phase === "IMPORTED_PENDING_ACK" && record.result) return clone(record.result);
    if (record.phase !== "RECEIVING") throw error("TRANSFER_IMPORT_PHASE_INVALID");
    const result = safeTransferResult({ requestId: input.requestId, importState: "IMPORTED", results: input.results || [] });
    await transferVault.update(input.requestId, current => {
      if (input.importContext) assertCredentialTransferContext(input.importContext);
      if (current.packetId !== input.packetId) throw error("TRANSFER_PACKET_CHANGED");
      if (current.phase === "ACKED_RESULT" && current.result) return current;
      if (current.phase === "IMPORTED_PENDING_ACK" && current.result) return current;
      if (current.phase !== "RECEIVING") throw error("TRANSFER_IMPORT_PHASE_INVALID");
      return { ...current, phase: "IMPORTED_PENDING_ACK", packetId: input.packetId, result };
    });
    return clone(result);
  }
  async function acknowledgeCredentialTransfer(input) {
    return transferSingleFlight(input?.requestId, async () => {
      const { auth, record } = await requireTransferRecord(input?.requestId);
      if (record.phase === "ACKED_RESULT") return { request: null, result: clone(record.result), reconciled: true };
      if (record.phase !== "IMPORTED_PENDING_ACK" || !record.result || record.packetId !== input.packetId) throw error("TRANSFER_IMPORT_NOT_DURABLE");
      let serverResult, directResponse, reconciled = false;
      try { directResponse = clone((await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(input.requestId)}/ack`, { method: "POST", body: input }, auth.context)).body); }
      catch (failure) {
        let observed = null, readFailure = null;
        try {
          const body = clone((await authenticatedRequest(`/v1/credential-transfers/${encodeURIComponent(input.requestId)}`, {}, auth.context)).body);
          observed = assertTransferRequestMatches(record, body);
        } catch (readError) { readFailure = readError; }
        if (readFailure?.code === "TRANSFER_ACCOUNT_MISMATCH") {
          // A GET 404/mismatch after any failed ACK (including transport
          // timeout, not only REPLAY) supplies no identity-bound terminal
          // result. Keep the imported vault record, never invent ACK, and
          // only show the sanitized pending state if local authority still
          // matches its original account/device/session/store binding.
          const latestAuth = await transferAuth();
          if (!transferRecordMatches(record, latestAuth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
          throw error("TRANSFER_ACK_UNCONFIRMED", { serverState: null });
        }
        if (readFailure && ["TRANSFER_REQUEST_MISMATCH", "TRANSFER_ACCOUNT_MISMATCH",
                            "AUTH_REQUIRED", "TRANSFER_EXPIRED"].includes(readFailure.code)) throw readFailure;
        if (["CANCELLED", "EXPIRED"].includes(observed?.state)) {
          const latestAuth = await transferAuth();
          if (!transferRecordMatches(record, latestAuth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
          // The authenticated readback matched this exact recipient request.
          // A terminal server state is distinct from a recoverable lost relay.
          throw error("TRANSFER_ACK_TERMINAL", { state: observed.state });
        }
        if (observed?.state !== "COMPLETED") {
          // Losing the process-memory relay before ACK can yield REPLAY while
          // PostgreSQL still has a nonterminal delivered request. Do not
          // erase the already durable recipient import or invent an ACK.
          if (failure?.code === "TRANSFER_REPLAY" &&
              (!observed || !["CANCELLED", "EXPIRED"].includes(observed.state))) {
            const latestAuth = await transferAuth();
            if (!transferRecordMatches(record, latestAuth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
            throw error("TRANSFER_ACK_UNCONFIRMED", { serverState: observed?.state || null });
          }
          throw failure;
        }
        serverResult = observed; reconciled = true;
      }
      if (!reconciled) {
        // A successful HTTP status alone cannot certify the exact imported
        // recipient request. Reject a foreign/malformed ACK body before the
        // durable vault is marked ACKED_RESULT; a later matching authenticated
        // readback can still recover a lost or malformed response.
        serverResult = assertTransferRequestMatches(record, directResponse);
        if (serverResult.state !== "COMPLETED")
          throw error("TRANSFER_ACK_UNCONFIRMED", { serverState: serverResult.state || null });
      }
      const latestAuth = await transferAuth();
      if (!transferRecordMatches(record, latestAuth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
      const acked = await transferVault.update(input.requestId, current => ({ ...current, phase: "ACKED_RESULT", privateKey: null, result: current.result }));
      return { request: serverResult, result: clone(acked.result), reconciled };
    });
  }
  async function discardCredentialTransfer(requestId) {
    const auth = await transferAuth(), record = await transferVault.get(requestId);
    if (!record) return false;
    if (!transferRecordMatches(record, auth)) throw error("TRANSFER_ACCOUNT_MISMATCH");
    await transferVault.remove(requestId); return true;
  }
  async function consumeCredentialTransferResult(requestId) {
    const { record } = await requireTransferRecord(requestId);
    if (record.phase !== "ACKED_RESULT" || !record.result) throw error("TRANSFER_RESULT_NOT_READY");
    const result = clone(record.result);
    await transferVault.remove(requestId);
    return result;
  }
  let promptTreeCache = null;
  async function promptTreeContext(detected) {
    await init();
    await ensureAuthOwnership();
    const authority = await authorityFor(detected.family), payload = authority?.payload;
    if (!authority?.workAllowed || authStorageUnconfirmed || !state.credentials ||
        payload?.ai?.status !== "RESOLVED" ||
        verifier.canonicalJson(payload.ai.detected) !== verifier.canonicalJson(detected))
      throw error("AI_TREE_ACCESS_REQUIRED");
    return { origin: config.controlApiOrigin, accountId: payload.account.id,
      deviceId: state.credentials.deviceId, sessionId: state.credentials.sessionId,
      principalEpoch: epoch("principalEpoch"), accessEpoch: epoch("accessEpoch"),
      grantEpoch: authority.grantEpoch, scopeKey: authority.scopeKey,
      profileKey: payload.ai.profile.profileKey, profileRevision: payload.ai.profile.revision,
      profileHash: payload.ai.profile.contentSha256 };
  }
  function treeCache() {
    if (!globalThis.OctoportPromptTrees?.createCache || !verifier?.verifyPromptTreeV1)
      throw error("AI_TREE_CLIENT_UNAVAILABLE");
    if (!promptTreeCache) promptTreeCache = OctoportPromptTrees.createCache({
      storage: chrome.storage.local, verifier, trustBundle: config.trustBundle,
      authorize: promptTreeContext,
      fetchManifest: async ({ detected, context, requestNonce, known }) => {
        if (verifier.canonicalJson(await promptTreeContext(detected)) !== verifier.canonicalJson(context))
          throw error("AI_TREE_CONTEXT_CHANGED");
        const authority = grantFor(detected.family)?.authority;
        const requestContext = contextForState();
        const principal = { principalEpoch: epoch("principalEpoch"), deviceId: state.credentials?.deviceId, sessionId: state.credentials?.sessionId };
        let denialApplied = false;
        const observeDenial = async (failure, late = false) => {
          // A current endpoint denial invalidates all grants, including a denial
          // arriving after timeout. Tree data and transport failures cannot grant work.
          if (denialApplied || !failure || !(failure.status === 403 || late && failure.status === 401) ||
            httpErrorProvenance.get(failure) !== endpointFor("/v1/ai-prompt-tree") || authStorageUnconfirmed ||
            epoch("principalEpoch") !== principal.principalEpoch || state.credentials?.deviceId !== principal.deviceId ||
            state.credentials?.sessionId !== principal.sessionId) return;
          denialApplied = true;
          await invalidateKnown(contextForState(), failure, failure.status === 401);
        };
        try {
          const result = await authenticatedRequest("/v1/ai-prompt-tree", { method: "POST",
            body: { bootstrap: bootstrapRequest(detected, state.credentials, authority), requestNonce, known },
            observeSettlement: outcome => outcome.late ? observeDenial(outcome.error, true) : undefined }, requestContext);
          return result.body;
        } catch (failure) {
          await observeDenial(failure);
          throw failure;
        }
      },
    });
    return promptTreeCache;
  }
  async function promptTreeDetected(identity) {
    const family = requestedFamily(identity);
    if (!family) throw error("AI_TREE_SCOPE_UNSUPPORTED");
    const authority = await authorityFor(family);
    if (!authority?.workAllowed || authority.payload?.ai?.status !== "RESOLVED") throw error("AI_TREE_ACCESS_REQUIRED");
    return clone(authority.payload.ai.detected);
  }
  async function getPromptTree(identity, options = {}) {
    let detected;
    try {
      detected = await promptTreeDetected(identity);
      const pin = await treeCache().get(detected, { offline: options.cacheOnly === true, refresh: options.refresh === true });
      return { available: true, pin, warning: null };
    } catch (failure) {
      // A failed update preserves a previously verified copy. Reauthorization
      // inside the cache prevents this fallback from reviving a known denial.
      if (detected && !options.cacheOnly) {
        try { return { available: true, pin: await treeCache().get(detected, { offline: true }), warning: safeError(failure) }; }
        catch (_) { /* No foreign AI or unverified fallback. */ }
      }
      return { available: false, pin: null, warning: safeError(failure) };
    }
  }
  async function validatePromptTreePin(identity, pin) {
    const detected = await promptTreeDetected(identity);
    return treeCache().validatePinned(detected, pin);
  }
  const api = { getPromptTree, validatePromptTreePin, restore: init, status: async (identity = null) => { await init(); const decision = await workDecisionFor(identity); return publicStatus(decision); }, currentAccount: async () => { await init(); return state.authority?.payload?.account?.id || null; }, generation: async () => { await init(); return state.generation; }, hasAuthority: async () => { await init(); return Boolean(state.authority && state.credentials); }, canWork: async (identity = null) => { await init(); const decision = await workDecisionFor(identity); return isCurrentScopedDecision(decision); }, getAuthority: authorityFor, canContinueCached, getCachedContinuationState, getHealthAuthorityContext, getVerifiedAuthorityTime, getSubscriptionRefreshPlan, runSubscriptionRefreshTask, acquireSignedHealthAuthority, synchronizeMetadata, captureBackupContext, assertBackupContext, createCredentialTransfer, assertCredentialTransferContext, listCredentialTransferRecipients, listCredentialTransfers, readCredentialTransfer, markCredentialTransferSourceSeen, submitCredentialTransferPacket, receiveCredentialTransfer, recordCredentialTransferImported, acknowledgeCredentialTransfer, discardCredentialTransfer, consumeCredentialTransferResult, startActivation, cancelActivation, refresh, bootstrap, acquireBootstrapPreflight, bootstrapWithPolicy, ensureForIdentity, localReset, openPortal: async () => { await init(); const pending = state.pending; if (!pendingLive(state.pending) || !validAuthContext(pending.authContext)) throw error("NO_ACTIVATION_ATTEMPT"); return openPortal(pending.authorizationId); }, onAuthorityChanged: handler => { authorityChanged = handler; } };
  consentApi?.onWithdrawal?.(handleTechnicalPermissionWithdrawal);
  globalThis.SellerAgentsControlClient = Object.freeze(api);
})();
