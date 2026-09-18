/* Privileged browser control-plane client. Tokens and deviceCode never leave this scope. */
(() => {
  "use strict";
  const config = globalThis.SellerAgentsControlConfig;
  const verifier = globalThis.SellerAgentsBootstrapVerifier;
  const STORAGE_KEY = "seller_agents_control_auth_v2";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MACHINE = /^[a-z0-9][a-z0-9._-]*$/;
  const TOKEN = /^[A-Za-z0-9._~-]{16,4096}$/;
  const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const EXCHANGE_PENDING = "DEVICE_AUTH_PENDING";
  const RETRYABLE_EXCHANGE_STATUS = new Set([429, 500, 502, 503, 504]);
  const TERMINAL_EXCHANGE_ERRORS = new Set(["DEVICE_AUTH_CLOSED", "DEVICE_AUTH_INVALID", "DEVICE_LIMIT_REACHED", "SUBSCRIPTION_REQUIRED"]);
  const LOCAL_AI = Object.freeze({ chatgpt: Object.freeze({ family: "chatgpt", surface: "web" }), alice: Object.freeze({ family: "alice", surface: "web" }) });
  const MAX_DATE_MS = 8640000000000000;
  let state = { generation: 0, credentials: null, pending: null, rotation: null, authority: null, cacheClock: null, lastError: null };
  let initialized = false, initFlight = null, mutationQueue = Promise.resolve();
  let activationFlight = null, refreshFlight = null, pollingFlight = null, authorityChanged = null;
  let runtimeClockOwner = null, runtimeAnchor = null, runtimeEffectiveHighWatermark = null, runtimeFloorNeedsPersistence = false, runtimeLastCheckpointAllowed = null;
  let bootstrapAttemptSequence = 0;
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
  function safeError(value) { const code = typeof value?.code === "string" ? value.code : "CONTROL_REQUEST_FAILED"; return { code: code.slice(0, 80) }; }
  function queueMutation(fn) { const run = mutationQueue.then(fn); mutationQueue = run.catch(() => {}); return run; }
  async function persist(next) { await chrome.storage.local.set({ [STORAGE_KEY]: clone(next) }); }
  function sameAuthorityIdentity(left, right) { return Boolean(left && right && left.deviceId === right.deviceId && left.sessionId === right.sessionId && left.generation === right.generation && left.requestedAi === right.requestedAi && left.payload?.account?.id === right.payload?.account?.id); }
  function authorityNeedsInvalidation(previous, next, reason) { if (!previous || !next) return Boolean(previous || next); if (!sameAuthorityIdentity(previous, next)) return true; if (["refresh_invalid", "bootstrap_unauthorized", "authority_invalid", "local_reset"].includes(reason)) return true; if (previous.workAllowed && !next.workAllowed) return true; return staticCanWork(previous.payload) && !staticCanWork(next.payload); }
  async function commit(next, previous = state.authority, reason = "state_changed") {
    const changed = authorityNeedsInvalidation(previous, next.authority, reason);
    await persist(next);
    state = next;
    if (changed && typeof authorityChanged === "function") { try { await authorityChanged(clone(state.authority), reason, state.generation); } catch (_) { /* guards remain authoritative */ } }
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
  function validStarting(value) { return exactKeys(value, ["phase", "attemptId", "startIdempotencyKey", "authContext"]) && value.phase === "starting" && typeof value.attemptId === "string" && value.attemptId.length > 0 && TOKEN.test(value.startIdempotencyKey) && validAuthContext(value.authContext); }
  function validPending(value) { return exactKeys(value, ["phase", "attemptId", "authorizationId", "deviceCode", "userCode", "expiresAt", "startIdempotencyKey", "exchangeIdempotencyKey", "authContext"]) && value.phase === "pending" && typeof value.attemptId === "string" && value.attemptId.length > 0 && UUID.test(value.authorizationId) && OPAQUE_TOKEN.test(value.deviceCode) && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(value.userCode) && Number.isFinite(Date.parse(value.expiresAt)) && TOKEN.test(value.startIdempotencyKey) && TOKEN.test(value.exchangeIdempotencyKey) && validAuthContext(value.authContext); }
  function validRestoredPending(value) { return validStarting(value) || validPending(value) && parsedMillis(value.expiresAt) > now(); }
  function pendingLive(value) { return value?.phase !== "starting" && validPending(value) && Date.parse(value.expiresAt) > now(); }
  function publicPending(value) { if (!value) return null; return { authorizationId: value.authorizationId, userCode: value.userCode, expiresAt: value.expiresAt, verificationUri: url(`/activate?authorizationId=${encodeURIComponent(value.authorizationId)}`, config.portalOrigin) }; }
  function publicStatus(decision = null) { const authority = state.authority, accountId = authority?.payload?.account?.id || null, snapshot = authority?.payload || null, matching = decision && decision.identity && sameAuthorityRuntimeIdentity(decision.identity, authorityDecisionIdentity()); return Object.freeze({ authenticated: Boolean(state.credentials && authority && accountId), accountId, account: accountId ? { kind: "control_account", label: `Аккаунт · ${accountId.slice(0, 8)}` } : null, pending: pendingLive(state.pending) ? publicPending(state.pending) : null, lastError: state.lastError, generation: state.generation, workAllowed: Boolean(accountId && matching && decision.allowed === true), authority: authority ? { configVersion: snapshot.configVersion, expiresAt: snapshot.expiresAt, aiStatus: snapshot.ai.status } : null }); }
  function authorityStaticValid(snapshot) {
    const extension = snapshot?.compatibility?.extension;
    return Boolean(snapshot && snapshot.account?.status === "ACTIVE" && snapshot.devicePolicy?.status === "ACTIVE" && ["SUPPORTED", "UPDATE_RECOMMENDED"].includes(extension?.status) && snapshot.compatibility?.browser?.status === "SUPPORTED" && (extension.minimumVersion === null || (parseSemver(extension.minimumVersion) && versionAtLeast(config.extensionVersion, extension.minimumVersion))));
  }
  function authorityBaseValid(snapshot, effectiveTimeMs) { const expiresAt = parsedMillis(snapshot?.expiresAt), grace = parsedMillis(snapshot?.offlineGraceUntil); return Boolean(authorityStaticValid(snapshot) && validMillis(effectiveTimeMs) && expiresAt !== null && grace !== null && grace > expiresAt && effectiveTimeMs < grace); }
  function staticCanWork(snapshot) { return Boolean(authorityStaticValid(snapshot) && snapshot.ai?.status === "RESOLVED" && ["chatgpt", "alice"].includes(snapshot.ai.detected?.family)); }
  function canWork(snapshot, effectiveTimeMs) { return Boolean(authorityBaseValid(snapshot, effectiveTimeMs) && snapshot.ai?.status === "RESOLVED" && ["chatgpt", "alice"].includes(snapshot.ai.detected?.family)); }
  function browserFamily() { const ua = typeof navigator === "object" ? String(navigator.userAgent || "").toLowerCase() : ""; return ua.includes("yabrowser") ? "yandex_chromium" : "chrome"; }
  function browserVersion() { const ua = typeof navigator === "object" ? String(navigator.userAgent || "") : ""; const match = ua.match(/(?:Chrome|YaBrowser)\/(\d+(?:\.\d+){0,3})/i); return match ? match[1] : "0.0.0"; }
  function clockOwner(credentials) { return { controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion, deviceId: credentials.deviceId, sessionId: credentials.sessionId }; }
  function authorityIdentity(authority = state.authority, generation = state.generation) { return authority ? { generation, deviceId: authority.deviceId, sessionId: authority.sessionId, accountId: authority.payload?.account?.id || null, requestedAi: authority.requestedAi ?? null } : null; }
  function authorityDecisionIdentity(authority = state.authority, generation = state.generation) { return authority ? verifier.canonicalJson({ generation, deviceId: authority.deviceId, sessionId: authority.sessionId, requestedAi: authority.requestedAi ?? null, accountId: authority.payload?.account?.id || null, envelope: authority.envelope, cacheBinding: authority.cacheBinding }) : null; }
  function sameAuthorityRuntimeIdentity(left, right) { return Boolean(left && right && verifier.canonicalJson(left) === verifier.canonicalJson(right)); }
  function validCacheBinding(value) {
    if (!exactKeys(value, ["cacheVersion", "controlApiOrigin", "portalOrigin", "contractVersion", "extensionVersion", "browser", "detectedAi", "trustBundleSha256"]) || value.cacheVersion !== "control_cache_binding_v1" || !origin(value.controlApiOrigin) || !origin(value.portalOrigin) || typeof value.contractVersion !== "string" || typeof value.extensionVersion !== "string" || !exactKeys(value.browser, ["family", "version"]) || !["chrome", "yandex_chromium"].includes(value.browser.family) || !parseBrowser(value.browser.version) || !(value.detectedAi === null || exactKeys(value.detectedAi, ["family", "surface", "variant"]) && LOCAL_AI[value.detectedAi.family] && value.detectedAi.surface === LOCAL_AI[value.detectedAi.family].surface && value.detectedAi.variant === null) || !/^[0-9a-f]{64}$/.test(value.trustBundleSha256)) return false;
    return true;
  }
  function validCacheClockShape(value, payload = null) {
    if (!exactKeys(value, ["cacheVersion", "owner", "trustedServerTimeMs", "effectiveTimeMs"]) || value.cacheVersion !== "control_cache_clock_v1" || !exactKeys(value.owner, ["controlApiOrigin", "portalOrigin", "contractVersion", "deviceId", "sessionId"]) || !origin(value.owner.controlApiOrigin) || !origin(value.owner.portalOrigin) || typeof value.owner.contractVersion !== "string" || value.owner.contractVersion.length < 1 || !UUID.test(value.owner.deviceId) || !UUID.test(value.owner.sessionId) || !validMillis(value.trustedServerTimeMs) || !validMillis(value.effectiveTimeMs) || value.effectiveTimeMs < value.trustedServerTimeMs) return false;
    if (payload && (parsedMillis(payload.serverTime) === null || value.trustedServerTimeMs < parsedMillis(payload.serverTime))) return false;
    return true;
  }
  function validCacheClock(value, credentials, payload = null) { if (!validCacheClockShape(value, payload) || !credentials) return false; const owner = value.owner; return owner.controlApiOrigin === config.controlApiOrigin && owner.portalOrigin === config.portalOrigin && owner.deviceId === credentials.deviceId && owner.sessionId === credentials.sessionId; }
  async function trustBundleDigest() { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier.canonicalJson(config.trustBundle))))].map(value => value.toString(16).padStart(2, "0")).join(""); }
  async function expectedCacheBinding(payload, requestedAi = null) { const detectedAi = payload?.ai?.status === "RESOLVED" ? { family: payload.ai.detected.family, surface: payload.ai.detected.surface, variant: payload.ai.detected.variant } : null; return { cacheVersion: "control_cache_binding_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion, extensionVersion: config.extensionVersion, browser: { family: browserFamily(), version: browserVersion() }, detectedAi, trustBundleSha256: await trustBundleDigest() }; }
  function validRuntimeOwner(owner) { return typeof owner === "string" && owner.length > 0; }
  function effectiveTime(clock) {
    if (!validCacheClock(clock, state.credentials, state.authority?.payload || null)) throw error("CACHE_CLOCK_INVALID");
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
  function currentWorkDecision(effectiveTimeMs) { const authority = state.authority; return { allowed: Boolean(authority && canWork(authority.payload, effectiveTimeMs)), effectiveTimeMs }; }
  async function notifyAuthorityChange(authority, reason, generation) { if (typeof authorityChanged === "function") { try { await authorityChanged(clone(authority), reason, generation); } catch (_) {} } }
  async function cacheAuthorizationCheckpoint() {
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
    if (requestOptions.body !== undefined) { headers.set("Content-Type", "application/json"); requestOptions.body = JSON.stringify(requestOptions.body); }
    requestOptions.headers = headers;
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
  }
  function resetRuntimeClock() { runtimeClockOwner = null; runtimeAnchor = null; runtimeEffectiveHighWatermark = null; runtimeFloorNeedsPersistence = false; runtimeLastCheckpointAllowed = null; }
  function validAuthOwnership() { return Boolean(validCredentials(state.credentials) && validCacheClock(state.cacheClock, state.credentials)); }
  async function ensureAuthOwnership() {
    if (validAuthOwnership()) return true;
    const failure = error("AUTH_CONTEXT_INVALID");
    await invalidateKnown(contextForState(), failure, true);
    throw error("AUTH_REQUIRED");
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
            const result = await request("/v1/device-authorizations/token", { method: "POST", headers: { "Idempotency-Key": pending.exchangeIdempotencyKey }, body: { deviceCode: pending.deviceCode } });
            const credentials = assertTokens(result.body);
            if (!isCurrent(owner.context) || state.pending?.authorizationId !== pending.authorizationId) return;
            const effective = now(); if (!validMillis(effective)) throw error("CACHE_WALL_CLOCK_INVALID");
            const cacheClock = { cacheVersion: "control_cache_clock_v1", owner: clockOwner(credentials), trustedServerTimeMs: 0, effectiveTimeMs: effective };
            if (!await commitIfCurrent(owner.context, current => ({ ...current, credentials, cacheClock, pending: null, rotation: null, authority: null, lastError: null, generation: current.generation + 1 }), "activated")) return;
            const bootstrapContext = contextForState({ generation: owner.context.generation + 1, deviceId: credentials.deviceId, sessionId: credentials.sessionId });
            try { await bootstrap({ context: bootstrapContext }); } catch (failure) {
              await queueMutation(async () => { if (isCurrent(bootstrapContext) && state.credentials) await commit({ ...state, lastError: safeError(failure) }, state.authority, "bootstrap_failed"); });
            }
            return;
          } catch (failure) {
            if (!isCurrent(owner.context) || state.pending?.authorizationId !== pending.authorizationId) return;
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
    const owner = { context: null, promise: null };
    owner.promise = (async () => {
      const started = await queueMutation(async () => { if (state.credentials || pendingLive(state.pending)) return null; const startIdempotencyKey = state.pending?.phase === "starting" && TOKEN.test(state.pending.startIdempotencyKey) && validAuthContext(state.pending.authContext) ? state.pending.startIdempotencyKey : key(); const attemptId = state.pending?.phase === "starting" && state.pending.attemptId && validAuthContext(state.pending.authContext) ? state.pending.attemptId : key(); const authContext = { contextVersion: "control_auth_context_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion }; const next = { ...state, generation: state.generation + 1, pending: { phase: "starting", attemptId, startIdempotencyKey, authContext }, lastError: null }; await commit(next, state.authority, "activation_starting"); return { context: { generation: next.generation, attemptId }, startIdempotencyKey }; });
      if (!started) return publicStatus();
      owner.context = started.context;
      const result = await request("/v1/device-authorizations", { method: "POST", headers: { "Idempotency-Key": started.startIdempotencyKey }, body: { clientType: "browser_extension", browserFamily: browserFamily(), browserVersion: browserVersion(), extensionVersion: config.extensionVersion } });
      const response = assertStart(result.body); const pending = { phase: "pending", attemptId: started.context.attemptId, authorizationId: response.authorizationId, deviceCode: response.deviceCode, userCode: response.userCode, expiresAt: response.expiresAt, startIdempotencyKey: started.startIdempotencyKey, exchangeIdempotencyKey: key(), authContext: { contextVersion: "control_auth_context_v1", controlApiOrigin: config.controlApiOrigin, portalOrigin: config.portalOrigin, contractVersion: config.contractVersion } };
      if (!await commitIfCurrent(started.context, current => ({ ...current, pending, lastError: null }), "activation_started") || !isCurrent(started.context)) return publicStatus();
      const portalUrl = await openPortal(response.authorizationId); if (!isCurrent(started.context)) return publicStatus(); void ensurePolling(); return { ...publicStatus(), portalUrl };
    })().catch(async failure => { if (owner.context) await commitIfCurrent(owner.context, current => ({ ...current, lastError: safeError(failure) }), "activation_failed"); throw failure; }).finally(() => { if (activationFlight === owner) activationFlight = null; });
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
      const credentials = assertRefreshTokens(result.body, prepared.credentials); if (!await commitIfCurrent(prepared.context, current => ({ ...current, credentials, rotation: null, lastError: null }), "refresh_rotated")) throw error("AUTH_GENERATION_CHANGED"); return clone(credentials);
    })().catch(async failure => { if (failure.code === "AUTH_REFRESH_INVALID" && owner.context) await invalidateKnown(owner.context, failure, true); throw failure; }).finally(() => { if (refreshFlight === owner) refreshFlight = null; });
    refreshFlight = owner; return owner.promise;
  }
  function bootstrapRequest(detectedAi, credentials, authority) { const body = { contractVersion: "control_plane_v2", extensionVersion: config.extensionVersion, browser: { family: browserFamily(), version: browserVersion() }, deviceId: credentials.deviceId, lastConfigVersion: authority?.payload?.configVersion || null }; if (detectedAi) body.detectedAi = detectedAi; return body; }
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
  function validProfileShape(profile, enforceEnvironment = true) {
    const content = profile?.content, compatibility = profile?.compatibility;
    if (!MACHINE.test(profile?.profileKey || "") || String(profile?.profileKey || "").length > 64 || !Number.isSafeInteger(profile?.revision) || profile.revision <= 0 || profile?.schemaVersion !== "adapter_profile_v1" || profile?.scopeVariant !== null) return false;
    if (!exactKeys(content, ["schemaVersion", "page", "selectors", "observation", "contours"]) || content.schemaVersion !== "adapter_profile_v1" || !exactKeys(content.page, ["identityStrategy", "conversationStrategy", "composerStrategy"]) || content.page.identityStrategy !== "page_identity" || content.page.conversationStrategy !== "conversation_root" || content.page.composerStrategy !== "composer_root") return false;
    if (!exactKeys(content.selectors, ["conversation", "composer", "send", "assistantResponse"]) || !validSelector(content.selectors.conversation, "conversation_root") || !validSelector(content.selectors.composer, "composer_root") || !validSelector(content.selectors.send, "send_control") || !validSelector(content.selectors.assistantResponse, "assistant_response")) return false;
    if (!exactKeys(content.observation, ["mode", "intervalMs"]) || !["polling", "mutation_observer"].includes(content.observation.mode) || !Number.isSafeInteger(content.observation.intervalMs) || content.observation.intervalMs < 100 || content.observation.intervalMs > 5000 || (content.observation.mode === "mutation_observer" && content.observation.intervalMs !== 100)) return false;
    const contourKeys = new Set(["page_identity", "conversation_root", "composer_root", "send_control", "busy_state", "assistant_response", "copy_control"]);
    if (!Array.isArray(content.contours) || content.contours.length < 4 || content.contours.length > 7 || new Set(content.contours.map(x => x.key)).size !== content.contours.length || !content.contours.every(x => exactKeys(x, ["key", "required", "expectedState", "strategy"]) && contourKeys.has(x.key) && typeof x.required === "boolean" && ["PRESENT", "INTERACTIVE", "COMPLETES"].includes(x.expectedState) && contourKeys.has(x.strategy))) return false;
    if (!exactKeys(compatibility, ["schemaVersion", "contractVersion", "browserFamilies", "minimumBrowserVersions", "minimumExtensionVersion"]) || compatibility.schemaVersion !== "profile_compatibility_v1" || compatibility.contractVersion !== "control_plane_v1" || !Array.isArray(compatibility.browserFamilies) || compatibility.browserFamilies.length < 1 || compatibility.browserFamilies.length > 2 || new Set(compatibility.browserFamilies).size !== compatibility.browserFamilies.length || !compatibility.browserFamilies.every(x => ["chrome", "yandex_chromium"].includes(x)) || !Array.isArray(compatibility.minimumBrowserVersions) || compatibility.minimumBrowserVersions.length > 2 || new Set(compatibility.minimumBrowserVersions.map(x => x.browserFamily)).size !== compatibility.minimumBrowserVersions.length || !compatibility.minimumBrowserVersions.every(x => exactKeys(x, ["browserFamily", "minimumVersion"]) && compatibility.browserFamilies.includes(x.browserFamily) && parseBrowser(x.minimumVersion)) || !(compatibility.minimumExtensionVersion === null || parseSemver(compatibility.minimumExtensionVersion))) return false;
    if (!enforceEnvironment) return true;
    if (!compatibility.browserFamilies.includes(browserFamily()) || (compatibility.minimumExtensionVersion && !versionAtLeast(config.extensionVersion, compatibility.minimumExtensionVersion))) return false;
    const browserMin = compatibility.minimumBrowserVersions.find(x => x.browserFamily === browserFamily()); return !browserMin || versionAtLeast(browserVersion(), browserMin.minimumVersion, true);
  }
  async function profileFingerprint(profile) { const bytes = new TextEncoder().encode(verifier.canonicalJson({ content: profile.content, compatibility: profile.compatibility })); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join(""); }
  async function validateAccountProfile(payload, requestedAi = null, enforceEnvironment = true) {
    if (!authorityStaticValid(payload) || requestedAi && !LOCAL_AI[requestedAi]) return null;
    if (payload.ai.status === "UNCONFIGURED") return requestedAi === null ? { workAllowed: false, requestedAi: null } : null;
    if (payload.ai.status !== "RESOLVED" || !validProfileShape(payload.ai.profile, enforceEnvironment)) return null;
    const expected = requestedAi ? LOCAL_AI[requestedAi] : LOCAL_AI[payload.ai.detected?.family], detected = payload.ai.detected;
    if (!expected || detected.family !== (requestedAi || detected.family) || detected.surface !== expected.surface || detected.variant !== null || payload.ai.profile.scopeVariant !== null) return null;
    if ((await profileFingerprint(payload.ai.profile)) !== payload.ai.profile.contentSha256) return null;
    return { workAllowed: true, requestedAi: requestedAi || payload.ai.detected.family };
  }
  async function validateOperationalAuthority(payload, requestedAi = null) { return Boolean(await validateAccountProfile(payload, requestedAi, true)); }
  async function validateBootstrapAuthority(payload, requestedAi = null) {
    return validateAccountProfile(payload, requestedAi, true);
  }
  async function requestBootstrap(credentials, authority, detectedAi) { return request("/v1/bootstrap", { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}` }, body: bootstrapRequest(detectedAi, credentials, authority) }); }
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
    const authority = clone(state.authority), authorityIdentityBefore = authorityDecisionIdentity(authority, context.generation); if (!authority?.envelope) throw error("HEALTH_CONTEXT_INVALID"); const result = await request("/v1/health-authority", { method: "POST", headers: { Authorization: `Bearer ${state.credentials.accessToken}` }, body: healthRequest(options.detectedAi, state.credentials, authority) });
    if (!isCurrent(context) || authorityIdentityBefore !== authorityDecisionIdentity()) throw error("AUTH_GENERATION_CHANGED");
    const verified = await verifier.verifyHealthV1(result.body, config.trustBundle); if (!verified.ok) throw error(`HEALTH_${verified.error}`);
    if (verified.payload.status === "PASS") { const expected = await healthContextFromBootstrap(authority?.payload, authority, state.credentials); if (!expected || verifier.canonicalJson(expected) !== verifier.canonicalJson(verified.payload.context)) throw error("HEALTH_CONTEXT_MISMATCH"); }
    return { payload: clone(verified.payload), envelope: clone(verified.envelope) };
  }
  async function getHealthAuthorityContext() { await init(); if (!state.credentials || !state.authority) throw error("HEALTH_CONTEXT_INVALID"); await getVerifiedAuthorityTime(); return clone(state.authority); }
  async function getVerifiedAuthorityTime() { await init(); if (!state.credentials || !state.cacheClock || !state.authority) throw error("HEALTH_CONTEXT_INVALID"); return effectiveTime(state.cacheClock); }
  /* C3A reads this cache snapshot only. It deliberately does not checkpoint,
   * persist a denial, refresh Bootstrap, or acquire Health. */
  async function getCachedContinuationState() {
    await init();
    return clone({
      generation: state.generation,
      authority: state.authority,
      cacheClock: state.cacheClock,
      localInvalidation: {
        revoked: !state.credentials || !state.authority,
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
      const previous = state.authority;
      const next = { ...state, generation: state.generation + 1, credentials: terminal ? null : state.credentials, pending: null, rotation: null, authority: null, cacheClock: terminal ? null : state.cacheClock, lastError: safeError(failure) };
      /* The denial is authoritative before any storage or cleanup await. */
      state = next;
      if (terminal) resetRuntimeClock();
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
      return persistenceFailure ? { denied: true, persistenceFailure: persistenceFailure.code } : true;
    });
  }
  async function invalidateUnauthorized(context, failure) { return invalidateKnown(context, failure, true); }
  function bootstrapAttemptCurrent(attempt) { return bootstrapAttemptSequence === attempt.sequence && isCurrent(attempt.context); }
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
      const failure = error("BOOTSTRAP_PROFILE_INCOMPATIBLE"); await invalidateBootstrapFailure(attempt, failure); throw failure;
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
      try { result = await requestBootstrap(credentials, authority, options.detectedAi); }
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
      try { verified = await verifier.verifyV2(result.body, config.trustBundle); }
      catch (verificationFailure) { const failure = error(`BOOTSTRAP_${verificationFailure?.code || "VERIFICATION_FAILED"}`); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      if (!verified.ok) { const failure = error(`BOOTSTRAP_${verified.error}`); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      const validation = await validateBootstrapAuthority(verified.payload, requestedAi).catch(() => null);
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      if (!validation) { const failure = error("BOOTSTRAP_PROFILE_INCOMPATIBLE"); await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      const cacheBinding = await expectedCacheBinding(verified.payload, validation.requestedAi);
      if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
      const nextAuthority = { verified: true, workAllowed: validation.workAllowed, payload: verified.payload, envelope: verified.envelope, deviceId: credentials.deviceId, sessionId: credentials.sessionId, generation: attempt.context.generation, requestedAi: validation.requestedAi, cacheBinding };
      let committed;
      try {
        committed = await queueMutation(async () => {
          if (!bootstrapAttemptCurrent(attempt)) return false;
          const current = clone(state), signedServerTimeMs = parsedMillis(verified.payload.serverTime), previousClock = current.cacheClock;
          if (signedServerTimeMs === null) throw error("BOOTSTRAP_SERVER_TIME_INVALID");
          if (previousClock && signedServerTimeMs < previousClock.trustedServerTimeMs) throw error("BOOTSTRAP_SERVER_TIME_REGRESSION");
          const owner = clockOwner(credentials), baseTrusted = Math.max(previousClock?.trustedServerTimeMs || 0, signedServerTimeMs), baseEffective = Math.max(previousClock?.effectiveTimeMs || 0, baseTrusted);
          const candidateClock = { cacheVersion: "control_cache_clock_v1", owner, trustedServerTimeMs: baseTrusted, effectiveTimeMs: baseEffective };
          const effective = effectiveTime(candidateClock);
          if (!authorityBaseValid(verified.payload, effective)) throw error("BOOTSTRAP_EXPIRED_OR_INCOMPATIBLE");
          const authorityContextChanged = current.authority && current.authority.requestedAi !== nextAuthority.requestedAi;
          const generation = authorityContextChanged ? current.generation + 1 : current.generation;
          const next = { ...current, generation, cacheClock: { ...candidateClock, effectiveTimeMs: Math.max(candidateClock.effectiveTimeMs, effective) }, authority: { ...nextAuthority, generation }, lastError: null };
          if (!bootstrapAttemptCurrent(attempt)) return false;
          await commit(next, current.authority, "bootstrap_verified");
          /* A requested-AI authority replacement intentionally advances generation. */
          attempt.context = { ...attempt.context, generation };
          attempt.committedAuthorityIdentity = cacheIdentity(next.authority, generation);
          return bootstrapAttemptCurrent(attempt);
        });
      } catch (failure) { await invalidateBootstrapFailure(attempt, failure, false); throw failure; }
      if (!committed) throw error("AUTH_GENERATION_CHANGED");
      if (attempt.policy !== true) runtimeLastCheckpointAllowed = nextAuthority.workAllowed === true;
      return clone(verified.payload);
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
      if (!authority || !validCacheClock(clock, state.credentials, payload) || clock.owner.contractVersion !== config.contractVersion) throw cacheFailure("CACHE_CLOCK_INVALID");
      const expiresAt = parsedMillis(payload.expiresAt), grace = parsedMillis(payload.offlineGraceUntil);
      if (expiresAt === null || grace === null || grace <= expiresAt) throw cacheFailure("CACHE_EXPIRY_INVALID");
      let effective;
      try { effective = effectiveTime(clock); } catch (_) { throw cacheFailure("CACHE_EFFECTIVE_TIME_INVALID"); }
      if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
      const floor = Math.max(clock.effectiveTimeMs, effective);
      if (!validMillis(floor)) throw cacheFailure("CACHE_EFFECTIVE_TIME_INVALID");
      const freshness = effective < expiresAt ? "FRESH" : effective < grace ? "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" : null;
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
      if (completion >= grace) {
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
  async function bootstrapWithPolicy(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context)) throw error("AUTH_CONTEXT_INVALID");
    const sequence = ++bootstrapAttemptSequence, attempt = { sequence, context: null, observedBootstrap401: false, preflightRefresh: false, policy: true };
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
      if (!eligible || !policyCurrent(capture)) throw onlineFailure;
      const authority = capture.authority, requestedAi = capture.requestedAi;
      if (!authority || authority.requestedAi !== requestedAi || !capture.clock || !validCacheBinding(authority.cacheBinding)) throw onlineFailure;
      let verified;
      try {
        verified = await verifier.verifyV2(authority.envelope, config.trustBundle);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (!verified.ok || verifier.canonicalJson(verified.payload) !== verifier.canonicalJson(authority.payload)) throw cacheFailure("CACHE_VERIFICATION_FAILED");
        const validation = await validateAccountProfile(verified.payload, requestedAi, true);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (!validation || validation.requestedAi !== requestedAi) throw cacheFailure("CACHE_CONTEXT_MISMATCH");
        const expected = await expectedCacheBinding(verified.payload, validation.requestedAi);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        if (verifier.canonicalJson(authority.cacheBinding) !== verifier.canonicalJson(expected) || !validCacheClock(capture.clock, state.credentials, verified.payload) || capture.clock.owner.contractVersion !== config.contractVersion) throw cacheFailure("CACHE_CONTEXT_MISMATCH");
        const currentAuthority = state.authority;
        if (!currentAuthority || cacheIdentity(currentAuthority, state.generation) !== capture.authorityIdentity) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        const result = await cachedBootstrapCheckpoint(capture, verified.payload);
        if (!policyCurrent(capture)) throw cacheFailure("CACHE_ACQUISITION_OBSOLETED");
        return result;
      } catch (cacheError) {
        if (cacheError?.code === "AUTH_DENIAL_PERSISTENCE_FAILED" || cacheError?.code === "CACHE_ACQUISITION_OBSOLETED" || cacheError?.code === "CACHE_CLOCK_INVALID" || cacheError?.code === "CACHE_EFFECTIVE_TIME_INVALID" || cacheError?.code === "CACHE_CONTEXT_MISMATCH" || cacheError?.code === "CACHE_VERIFICATION_FAILED" || cacheError?.code === "CACHE_EXPIRY_INVALID" || cacheError?.code === "CACHE_EXPIRED") throw cacheError;
        throw onlineFailure;
      }
    }
  }
  async function bootstrap(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || options.context !== undefined && !validContext(options.context)) throw error("AUTH_CONTEXT_INVALID");
    const sequence = ++bootstrapAttemptSequence, attempt = { sequence, context: options.context ? clone(options.context) : null, observedBootstrap401: false, preflightRefresh: false };
    await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership(); if (!attempt.context) attempt.context = contextForState(); if (!bootstrapAttemptCurrent(attempt)) throw error("AUTH_GENERATION_CHANGED");
    return bootstrapOnline(options, attempt);
  }
  async function ensureForIdentity(identity) { await init(); const decision = await cacheAuthorizationCheckpoint(); if (!state.credentials) throw error("AUTH_REQUIRED"); const requested = LOCAL_AI[identity?.ai_id] ? identity.ai_id : null; if (!requested) throw error("WORK_UNSUPPORTED_AI"); const current = state.authority; if (decision.allowed && decision.identity === authorityDecisionIdentity() && current && current.generation === state.generation && current.requestedAi === requested && current.payload?.ai?.detected?.family === requested) return clone(current.payload); return bootstrap({ detectedAi: { family: requested, surface: LOCAL_AI[requested].surface, variant: null } }); }
  async function discardRestoredAuthority(failure) {
    const context = contextForState();
    let changed = false, generation = state.generation;
    await queueMutation(async () => {
      if (!isCurrent(context)) return;
      const previous = state.authority;
      const next = { ...state, generation: state.generation + 1, authority: null, lastError: safeError(failure) };
      state = next;
      try { await persist(next); } catch (_) { try { await chrome.storage.local.remove(STORAGE_KEY); } catch (removeFailure) { state = { ...state, lastError: safeError(Object.assign(error("AUTH_DENIAL_PERSISTENCE_FAILED"), { detail: safeError(removeFailure) })) }; } }
      changed = Boolean(previous); generation = state.generation;
    });
    if (changed) void notifyAuthorityChange(null, "authority_invalid", generation);
  }
  async function discardOrphanCredentialState() {
    const next = { ...state, rotation: null, authority: null, cacheClock: null };
    state = next;
    try { await persist(next); } catch (_) { /* signed-out memory remains safe; pending state is not discarded */ }
  }
  async function restoreOnce() {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }); const result = await chrome.storage.local.get(STORAGE_KEY); const saved = result[STORAGE_KEY]; if (saved && typeof saved === "object") state = { ...state, ...clone(saved) };
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
          const verified = await verifier.verifyV2(savedAuthority.envelope, config.trustBundle); if (!verified.ok) throw error(`STORED_AUTHORITY_${verified.error}`);
          if (verifier.canonicalJson(verified.payload) !== verifier.canonicalJson(savedAuthority.payload)) throw error("STORED_AUTHORITY_PAYLOAD_MISMATCH");
          const allowed = await validateAccountProfile(verified.payload, savedAuthority.requestedAi, false).catch(() => null); if (!allowed) throw error("STORED_AUTHORITY_POLICY_MISMATCH");
          if (!validCacheClock(clock, state.credentials, verified.payload)) throw error("STORED_CACHE_CLOCK_INCONSISTENT");
          const expected = await expectedCacheBinding(verified.payload, allowed.requestedAi);
          if (verifier.canonicalJson(binding) !== verifier.canonicalJson(expected)) throw error("STORED_CACHE_CONTEXT_MISMATCH");
          if (!await validateAccountProfile(verified.payload, savedAuthority.requestedAi, true).catch(() => null)) throw error("STORED_AUTHORITY_ENVIRONMENT_MISMATCH");
          state.authority = { ...savedAuthority, payload: verified.payload, requestedAi: allowed.requestedAi, workAllowed: savedAuthority.workAllowed === true && allowed.workAllowed === true };
        } catch (failure) { authorityFailure = failure; }
      }
      if (authorityFailure) {
        if (authorityFailure.code === "STORED_CACHE_CLOCK_INCONSISTENT") await invalidateKnown(contextForState(), authorityFailure, true);
        else if (state.credentials) await discardRestoredAuthority(authorityFailure);
      }
    }
    if (state.pending && !validRestoredPending(state.pending)) await invalidateKnown(contextForState(), error("ACTIVATION_CONTEXT_MISMATCH"), true);
    const restoredDecision = state.authority && state.credentials ? await cacheAuthorizationCheckpoint() : { allowed: false };
    initialized = true; if (pendingLive(state.pending)) void ensurePolling(); return publicStatus(restoredDecision);
  }
  function init() { if (initialized) return Promise.resolve(publicStatus()); if (!initFlight) initFlight = restoreOnce().finally(() => { initFlight = null; }); return initFlight; }
  async function localReset() { await init(); await queueMutation(async () => { activationFlight = null; pollingFlight = null; refreshFlight = null; resetRuntimeClock(); await commit({ generation: state.generation + 1, credentials: null, pending: null, rotation: null, authority: null, cacheClock: null, lastError: null }, state.authority, "local_reset"); }); return publicStatus(); }
  async function cancelActivation() { await init(); await queueMutation(async () => { activationFlight = null; pollingFlight = null; await commit({ ...state, generation: state.generation + 1, pending: null, lastError: null }, state.authority, "activation_cancelled"); }); return publicStatus(); }
  async function synchronizeMetadata(body) {
    await init(); if (!state.credentials) throw error("AUTH_REQUIRED"); await ensureAuthOwnership();
    if (!body || body.syncVersion !== "seller_agents_sync_v1" || !Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 32) throw error("SYNC_REQUEST_INVALID");
    return (await request("/v1/sync", { method: "POST", headers: { Authorization: `Bearer ${state.credentials.accessToken}` }, body: { ...body, installationId: state.credentials.deviceId } })).body;
  }
  const api = { restore: init, status: async () => { await init(); const decision = await cacheAuthorizationCheckpoint(); return publicStatus(decision); }, currentAccount: async () => { await init(); return state.authority?.payload?.account?.id || null; }, generation: async () => { await init(); return state.generation; }, hasAuthority: async () => { await init(); return Boolean(state.authority && state.credentials); }, canWork: async () => { await init(); const decision = await cacheAuthorizationCheckpoint(); return decision.identity === authorityDecisionIdentity() && decision.allowed === true; }, getAuthority: async () => { await init(); const decision = await cacheAuthorizationCheckpoint(); const authority = clone(state.authority); if (authority && !(decision.identity === authorityDecisionIdentity() && decision.allowed === true)) authority.workAllowed = false; return authority; }, getCachedContinuationState, getHealthAuthorityContext, getVerifiedAuthorityTime, acquireSignedHealthAuthority, synchronizeMetadata, startActivation, cancelActivation, refresh, bootstrap, bootstrapWithPolicy, ensureForIdentity, localReset, openPortal: async () => { await init(); const pending = state.pending; if (!pendingLive(state.pending) || !validAuthContext(pending.authContext)) throw error("NO_ACTIVATION_ATTEMPT"); return openPortal(pending.authorizationId); }, onAuthorityChanged: handler => { authorityChanged = handler; } };
  globalThis.SellerAgentsControlClient = Object.freeze(api);
})();
