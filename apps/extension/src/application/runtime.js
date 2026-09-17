/* Privileged application orchestration. Mature Ozon Work and delivery remain the implementation. */
const SA_PAYLOAD_TTL = 3600000;
let saCatalogEnabled = false;
const saStarts = new Map();
const saWorkFlights = new Map();
const saAdmissionEpochs = new Map();
const saCatalog = SellerAgentsStoreCatalog.create({
  read: storageGet, write: storageSet,
  currentAccount: () => SellerAgentsControlClient.currentAccount(),
  uuid: () => crypto.randomUUID(),
  normalizeCredentials(marketplace, input, previous = {}) {
    if (marketplace === "wildberries") return { token: SellerAgentsWBReference.credentials.normalizeSellerCredentials({ token: input.token || previous.token, tokenType: "personal" }, { required: true }).token };
    const seller = OzonCredentials.normalizeSellerCredentials({ clientId: input.seller?.clientId ?? previous.seller?.clientId,
      apiKey: input.seller?.apiKey || previous.seller?.apiKey }, { required: true });
    const performance = input.clearPerformance ? OzonCredentials.normalizePerformanceCredentials({}) :
      OzonCredentials.normalizePerformanceCredentials({ clientId: input.performance?.clientId ?? previous.performance?.clientId,
        clientSecret: input.performance?.clientSecret || previous.performance?.clientSecret });
    return { seller, performance };
  },
  revision: (marketplace, c) => marketplace === "wildberries" ? SellerAgentsWBAdapter.credentialRevision(c) :
    sha256Hex(JSON.stringify(["account-scoped-ozon-credentials", c.seller.clientId, c.seller.apiKey, c.performance.clientId, c.performance.clientSecret]))
});
const saQuota = SellerAgentsObservedQuota.create({ read: storageGet, write: storageSet, namespace: "seller_agents_observed_quota_v1" });
const saReady = (async () => {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  await SellerAgentsControlClient.restore();
  saCatalogEnabled = true;
})();
function saError(code) { return Object.assign(new Error(code), { code }); }
function saPopupSender(sender) {
  // MessageSender.url is assigned by the browser, not supplied in the message.
  // The same privileged page may be hosted by the browser action or its own tab.
  return sender?.url === chrome.runtime.getURL("popup.html");
}
async function saEnabled() { await saReady; return saCatalogEnabled; }
async function saAssertWorkAuthority() {
  await saReady;
  if (!await SellerAgentsControlClient.currentAccount() || !await SellerAgentsControlClient.canWork()) throw saError("WORK_POLICY_BLOCKED");
  return true;
}
let saInitializeFlight = null;
async function saInitialize() {
  await saReady;
  if (saInitializeFlight) return saInitializeFlight;
  saInitializeFlight = saInitializeOnce().finally(() => { saInitializeFlight = null; });
  return saInitializeFlight;
}
async function saInitializeOnce() {
  /* Legacy global credentials remain isolated. Never assign them to the first real account. */
  if (!await SellerAgentsControlClient.currentAccount()) return;
  await saCatalog.list();
}
function saStoreContext(store) {
  return { accountId: store.accountId, storeId: store.id, marketplace: store.marketplace,
    credentialRevision: store.credentialRevision, policyRevision: store.personalDataEnabled ? "personal-enabled" : "personal-disabled" };
}
async function saAuthorityStoreContext(store) {
  return { ...saStoreContext(store), authGeneration: await SellerAgentsControlClient.generation() };
}
async function saAssertStore(pinned) {
  const accountId = await SellerAgentsControlClient.currentAccount();
  if (!accountId || !pinned || pinned.accountId !== accountId) throw SellerAgentsExecutionContext.error();
  let store;
  try { store = await saCatalog.get(pinned.storeId); } catch (_) { throw SellerAgentsExecutionContext.error(); }
  const live = { ...saStoreContext(store), ...(pinned.authGeneration === undefined ? {} : { authGeneration: await SellerAgentsControlClient.generation() }) };
  if (Object.keys(live).some(key => live[key] !== pinned[key])) throw SellerAgentsExecutionContext.error();
  return store;
}
async function saStoreForPending(tab, intent) {
  const pending = (await getPendingWorkStarts())[String(tab)];
  if (!pending || pending.intent_id !== intent) throw SellerAgentsExecutionContext.error();
  await saAssertStore(pending.store_context);
  return pending.store_context;
}
async function saPendingGuard(pending) {
  await saAssertWorkAuthority();
  if (pending?.store_context) await saAssertStore(pending.store_context);
  else throw SellerAgentsExecutionContext.error();
}
function saAdmissionError(code, deniedGates = []) {
  const error = saError(code);
  error.deniedGates = [...deniedGates];
  return error;
}
function saAdmissionKey(tabId, conversationKey = null) {
  return `${Number(tabId)}:${conversationKey || "pending"}`;
}
function saBeginAdmission(key, { operation, tabId, conversationKey, store, intentId }) {
  const token = { id: crypto.randomUUID(), key, operation, tabId: Number(tabId), conversationKey: conversationKey || null, store, intentId: String(intentId || ""), cancelled: false, admitted: false, fence: null };
  saAdmissionEpochs.set(key, token);
  return token;
}
function saCancelAdmission(tabId, conversationKey = null) {
  const tab = Number(tabId);
  const key = conversationKey ? normalizeConversationKey(conversationKey) : null;
  const waits = [];
  for (const token of saAdmissionEpochs.values()) {
    if (token.tabId === tab || key && token.conversationKey === key) {
      token.cancelled = true;
      if (token.mutationFlight) waits.push(token.mutationFlight);
    }
  }
  return waits;
}
function saCancelAdmissionsForStore(storeId) {
  const waits = [];
  for (const token of saAdmissionEpochs.values()) if (token.store?.id === storeId) {
    token.cancelled = true;
    if (token.mutationFlight) waits.push(token.mutationFlight);
  }
  return waits;
}
function saAdmissionCurrent(token) {
  return token && token.cancelled !== true && saAdmissionEpochs.get(token.key) === token;
}
function saAuthorityIdentity(authority) {
  return JSON.stringify({
    generation: authority?.generation,
    deviceId: authority?.deviceId,
    sessionId: authority?.sessionId,
    requestedAi: authority?.requestedAi,
    accountId: authority?.payload?.account?.id || null,
    envelope: authority?.envelope || null,
    cacheBinding: authority?.cacheBinding || null
  });
}
function saBase64UrlBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return encoded === value ? bytes : null;
  } catch (_) { return null; }
}
async function saSnapshotDigest(envelope) {
  const bytes = saBase64UrlBytes(envelope?.payload);
  if (!bytes) throw saAdmissionError("BOOTSTRAP_SNAPSHOT_INVALID");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}
function saCapabilityMetadata(authority) {
  const payload = authority?.payload;
  return {
    metadataVersion: "signed_bootstrap_metadata_v1",
    source: "ONLINE",
    freshness: "FRESH",
    executionAuthority: false,
    configVersion: payload?.configVersion,
    accessBasis: payload?.accessBasis,
    signedEntitlements: payload?.entitlements,
    signedFeatures: payload?.features,
    ai: payload?.ai
  };
}
async function saAdmissionFence({ operation, tabId, identity, key, binding, work, store, intentId, authority, admissionEpoch = "" }) {
  const currentAuthority = authority || await SellerAgentsControlClient.getAuthority();
  const currentGeneration = await SellerAgentsControlClient.generation();
  const profile = currentAuthority?.payload?.ai?.profile || {};
  return Object.freeze({
    operation: String(operation || ""),
    admissionEpoch: String(admissionEpoch || ""),
    accountId: currentAuthority?.payload?.account?.id || null,
    generation: currentGeneration,
    deviceId: currentAuthority?.deviceId || null,
    sessionId: currentAuthority?.sessionId || null,
    authorityIdentity: saAuthorityIdentity(currentAuthority),
    bootstrapSnapshotSha256: await saSnapshotDigest(currentAuthority?.envelope),
    tabId: Number(tabId),
    origin: identity?.origin || null,
    pageSource: identity?.source || null,
    chatPath: identity?.chat_path || null,
    aiId: identity?.ai_id || null,
    aiProfileKey: profile.profileKey || null,
    aiProfileRevision: profile.revision || null,
    aiProfileScopeVariant: profile.scopeVariant ?? null,
    aiProfileContentSha256: profile.contentSha256 || null,
    conversationKey: key || null,
    conversationId: identity?.conversation_id || null,
    pendingIdentityState: identity?.conversation_id ? "confirmed" : identity?.status || "unknown",
    bindingId: binding?.binding_id || null,
    bindingIdentity: JSON.stringify(binding ? { bindingId: binding.binding_id, accountId: binding.store_context?.accountId || null, storeId: binding.store_context?.storeId || null, marketplace: binding.store_context?.marketplace || null, credentialRevision: binding.store_context?.credentialRevision || null, authGeneration: binding.store_context?.authGeneration ?? null } : null),
    storeId: store?.id || null,
    selectedStoreId: store?.id || null,
    marketplace: store?.marketplace || null,
    credentialRevision: store?.credentialRevision || null,
    bindingRevision: Number(binding?.revision || 0),
    workState: work?.state || "inactive",
    workRevision: Number(work?.revision || 0),
    workIntentId: work?.start_intent_id || null,
    intentId: String(intentId || "")
  });
}
function saSameFence(left, right) {
  return left && right && ["operation", "admissionEpoch", "accountId", "generation", "deviceId", "sessionId", "authorityIdentity", "bootstrapSnapshotSha256", "tabId", "origin", "pageSource", "chatPath", "aiId", "aiProfileKey", "aiProfileRevision", "aiProfileScopeVariant", "aiProfileContentSha256", "conversationKey", "conversationId", "pendingIdentityState", "bindingId", "bindingIdentity", "storeId", "selectedStoreId", "marketplace", "credentialRevision", "bindingRevision", "workState", "workRevision", "workIntentId", "intentId"].every(field => left[field] === right[field]);
}
async function saAdmissionInput({ operation, tabId, identity, key, binding, work, store }) {
  const authority = await SellerAgentsControlClient.getAuthority();
  const payload = authority?.payload;
  const generation = await SellerAgentsControlClient.generation();
  const bootstrapSnapshotSha256 = await saSnapshotDigest(authority?.envelope);
  const provider = identity.ai_id;
  const profile = payload?.ai?.profile || {};
  const identityValue = {
    key: key || null,
    origin: identity.origin,
    conversationId: identity.conversation_id || null,
    provider,
    status: identity.conversation_id ? "confirmed" : "unknown"
  };
  const bindingValue = binding ? {
    bound: true,
    bindingId: binding.binding_id,
    revision: Number(binding.revision),
    expectedRevision: Number(binding.revision),
    conversationKey: key,
    origin: binding.origin,
    conversationId: binding.conversation_id,
    provider: binding.ai_id || provider,
    accountId: binding.store_context?.accountId || payload?.account?.id,
    storeId: binding.store_context?.storeId || store.id,
    marketplace: binding.store_context?.marketplace || store.marketplace,
    credentialRevision: binding.store_context?.credentialRevision || store.credentialRevision,
    authGeneration: binding.store_context?.authGeneration ?? null
  } : null;
  const capabilities = SellerAgentsCapabilityIntersection.evaluateVerifiedMetadata(saCapabilityMetadata(authority));
  return {
    account: { authenticated: true, accountId: payload?.account?.id, expectedAccountId: payload?.account?.id },
    session: { generation, expectedGeneration: generation, deviceId: authority?.deviceId, expectedDeviceId: authority?.deviceId, sessionId: authority?.sessionId, expectedSessionId: authority?.sessionId, revoked: false, obsolete: false },
    compatibility: {
      extension: { version: SellerAgentsControlConfig.extensionVersion, status: payload?.compatibility?.extension?.status, minimumVersion: payload?.compatibility?.extension?.minimumVersion ?? null },
      browser: { status: payload?.compatibility?.browser?.status },
      contractVersion: payload?.contractVersion,
      expectedContractVersion: SellerAgentsControlConfig.contractVersion
    },
    bootstrap: { verified: true, source: "ONLINE", freshness: "FRESH", accountId: payload?.account?.id, generation, deviceId: authority?.deviceId, sessionId: authority?.sessionId, contractVersion: payload?.contractVersion, configVersion: payload?.configVersion, bootstrapSnapshotSha256, aiProvider: payload?.ai?.detected?.family },
    ai: { provider, surface: payload?.ai?.detected?.surface, variant: payload?.ai?.detected?.variant, profile: { verified: true, provider: payload?.ai?.detected?.family, profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 } },
    dialogue: { key: key || null, trusted: true, tabId: Number(tabId), expectedTabId: Number(tabId), identity: identityValue, binding: bindingValue },
    store: { accountId: store.accountId, storeId: store.id, marketplace: store.marketplace, credentialRevision: store.credentialRevision, selectedStoreId: store.id, expectedStoreId: store.id, expectedCredentialRevision: store.credentialRevision, authGeneration: generation, accountGeneration: generation },
    work: { operation, state: work?.state || "inactive", startIntentId: work?.start_intent_id || null, expectedStartIntentId: work?.start_intent_id || null },
    capabilityIntersection: capabilities
  };
}
async function saReadAdmissionSnapshot({ operation, tabId, store, intentId, conversationKey = null, admissionEpoch = "" }) {
  const identity = await tabIdentity(normalizeTabId(tabId));
  const key = identity.conversation_id ? conversationKeyFromIdentity(identity) : null;
  if (conversationKey && key !== normalizeConversationKey(conversationKey)) throw saAdmissionError("CONVERSATION_MISMATCH");
  const binding = key ? await bindingForConversationKey(key) : null;
  const work = key ? await workSessionFor(key) : { state: OzonWorkSessionModel.STATES.INACTIVE, revision: 0 };
  const liveStore = store ? await saAssertStore(saStoreContext(store)) : (binding?.store_context ? await saAssertStore(binding.store_context) : null);
  if (!liveStore) throw saAdmissionError("STORE_NOT_FOUND");
  const authority = await SellerAgentsControlClient.getAuthority();
  return { identity, key, binding, work, store: liveStore, authority, fence: await saAdmissionFence({ operation, tabId, identity, key, binding, work, store: liveStore, intentId, authority, admissionEpoch }) };
}
async function saAdmissionMutationGuard({ operation, tabId, conversationKey = null, intentId = "" }) {
  const key = saAdmissionKey(tabId, conversationKey);
  const token = saAdmissionEpochs.get(key);
  if (!saAdmissionCurrent(token) || token.operation !== operation || intentId && token.intentId !== String(intentId)) throw saAdmissionError("WORK_ADMISSION_CANCELLED");
  let current;
  try {
    current = await saReadAdmissionSnapshot({ operation, tabId, store: token.store, intentId: token.intentId, conversationKey: token.conversationKey, admissionEpoch: token.id });
  } catch (_) {
    token.cancelled = true;
    throw saAdmissionError("WORK_ADMISSION_CONTEXT_CHANGED");
  }
  if (!saAdmissionCurrent(token)) throw saAdmissionError("WORK_ADMISSION_CANCELLED");
  if (!saSameFence(token.fence, current.fence)) {
    token.cancelled = true;
    throw saAdmissionError("WORK_ADMISSION_CONTEXT_CHANGED");
  }
  return token;
}
async function saAdmitOnline({ operation, tabId, store, intentId, conversationKey = null }) {
  await saAssertWorkAuthority();
  const initialRead = await saReadAdmissionSnapshot({ operation, tabId, store, intentId, conversationKey });
  const admissionKey = saAdmissionKey(tabId, initialRead.key);
  const token = saBeginAdmission(admissionKey, { operation, tabId, conversationKey: initialRead.key, store: initialRead.store, intentId });
  const initial = { ...initialRead, fence: await saAdmissionFence({ operation, tabId, identity: initialRead.identity, key: initialRead.key, binding: initialRead.binding, work: initialRead.work, store: initialRead.store, intentId, authority: initialRead.authority, admissionEpoch: token.id }) };
  try {
    const healthContext = { generation: initial.fence.generation, deviceId: initial.fence.deviceId, sessionId: initial.fence.sessionId };
    const detectedAi = { family: initial.identity.ai_id, surface: initial.authority.payload.ai.detected.surface, variant: initial.authority.payload.ai.detected.variant };
    const acquired = await SellerAgentsControlClient.acquireSignedHealthAuthority({ detectedAi, context: healthContext });
    if (!saAdmissionCurrent(token)) throw saAdmissionError("WORK_ADMISSION_CANCELLED");
    const afterHealth = await saReadAdmissionSnapshot({ operation, tabId, store, intentId, conversationKey, admissionEpoch: token.id });
    if (!saSameFence(initial.fence, afterHealth.fence)) throw saAdmissionError("WORK_ADMISSION_CONTEXT_CHANGED");
    const inputSnapshot = await saReadAdmissionSnapshot({ operation, tabId, store, intentId, conversationKey, admissionEpoch: token.id });
    if (!saSameFence(afterHealth.fence, inputSnapshot.fence)) throw saAdmissionError("WORK_ADMISSION_CONTEXT_CHANGED");
    const input = await saAdmissionInput({ operation, tabId, identity: inputSnapshot.identity, key: inputSnapshot.key, binding: inputSnapshot.binding, work: inputSnapshot.work, store: inputSnapshot.store });
    const decision = await SellerAgentsVerifiedOnlineWorkAuthority.evaluate(input, acquired.envelope);
    if (!saAdmissionCurrent(token)) throw saAdmissionError("WORK_ADMISSION_CANCELLED");
    const beforeMutation = await saReadAdmissionSnapshot({ operation, tabId, store, intentId, conversationKey, admissionEpoch: token.id });
    if (!saSameFence(inputSnapshot.fence, beforeMutation.fence)) throw saAdmissionError("WORK_ADMISSION_CONTEXT_CHANGED");
    if (decision.executionAuthority !== false || decision.allowed !== true) throw saAdmissionError("WORK_AUTHORITY_DENIED", decision.deniedGates);
    token.fence = beforeMutation.fence;
    token.admitted = true;
    return { token, snapshot: beforeMutation, decision };
  } finally {
    if (!token.admitted && saAdmissionEpochs.get(admissionKey) === token) saAdmissionEpochs.delete(admissionKey);
  }
}
function saReleaseAdmission(token) {
  if (token && saAdmissionEpochs.get(token.key) === token) saAdmissionEpochs.delete(token.key);
}
async function saRunAdmissionMutation(token, fn) {
  if (!saAdmissionCurrent(token)) throw saAdmissionError("WORK_ADMISSION_CANCELLED");
  const flight = Promise.resolve().then(fn);
  token.mutationFlight = flight;
  try { return await flight; }
  finally { if (token.mutationFlight === flight) token.mutationFlight = null; }
}
async function saReadContext(key, immutable, ownerIdentity) {
  const data = await storageGet([KEYS.CONVERSATION_BINDINGS, KEYS.WORK_SESSIONS]);
  const binding = normalizeBindingRecord(data[KEYS.CONVERSATION_BINDINGS]?.[key], key);
  const work = OzonWorkSessionModel.normalize(data[KEYS.WORK_SESSIONS]?.[key], key);
  const p = binding?.store_context;
  let store = null;
  try { store = await saAssertStore(p); } catch (_) {}
  const current = manualContextOwners.get(key), workAllowed = await SellerAgentsControlClient.canWork();
  const ownerActive = !ownerIdentity || current?.operation_id === ownerIdentity.operation_id && manualOperationActive(current) &&
    SellerAgentsExecutionContext.fields.every(field => current.execution_context?.[field] === ownerIdentity.execution_context[field]);
  return { ...immutable, ...(store ? await saAuthorityStoreContext(store) : p), accountId: store?.accountId || "unavailable",
    conversationKey: key, bindingId: binding?.binding_id || "unbound", bindingRevision: binding?.revision || 0,
    workSessionId: work.start_intent_id || "inactive", active: Boolean(workAllowed && store && ownerActive &&
      [OzonWorkSessionModel.STATES.ACTIVE_VISIBLE, OzonWorkSessionModel.STATES.ACTIVE_HIDDEN, OzonWorkSessionModel.STATES.RECOVERING].includes(work.state)) };
}
async function saSettings(pinned) {
  const store = await saAssertStore(pinned);
  if (store.marketplace !== "ozon") throw saError("WRONG_SETTINGS_PROVIDER");
  return { sellerCredentials: store.credentials.seller, performanceCredentials: store.credentials.performance,
    autoSend: true, personalDataEnabled: store.personalDataEnabled,
    sellerApiMetadata: OzonEntitlements.normalizeSnapshot(null), lastStatus: null };
}
async function saGuard(owner) {
  const p = owner?.execution_context;
  if (!p) throw SellerAgentsExecutionContext.error("EXECUTION_CONTEXT_MISSING");
  await saAssertWorkAuthority();
  const readCurrent = () => saReadContext(owner.conversation_key, { commandHash: p.commandHash, requestId: p.requestId }, owner);
  if (owner.payload_expires_at_ms && owner.payload_expires_at_ms <= Date.now()) throw saError("RESULT_EXPIRED");
  const guard = SellerAgentsExecutionContext.createGuard(p, readCurrent);
  await guard.assertCurrent();
  const store = await saAssertStore(p);
  if (p.marketplace === "wildberries") return SellerAgentsWBAdapter.createContext({ snapshot: p, readCurrent, credentials: store.credentials });
  const settings = await saSettings(p);
  await guard.assertCurrent();
  return Object.freeze({ ...guard, async settings() { await guard.assertCurrent(); return settings; } });
}
async function saPublicContext(key) {
  const binding = key ? await bindingForConversationKey(key) : null;
  const work = key ? await workSessionFor(key) : null;
  const allowed = await SellerAgentsControlClient.canWork();
  return { marketplace: binding?.store_context?.marketplace || "ozon", store_id: binding?.store_context?.storeId || null,
    work_session_id: allowed ? work?.start_intent_id || null : null, work_active: Boolean(allowed && work && ["active_visible", "active_hidden", "recovering"].includes(work.state)),
    button_visible: Boolean(allowed && work?.state === "active_visible"), assistant_baseline_ids: allowed ? binding?.assistant_baseline_ids || [] : [] };
}
async function saInvalidateStore(id) {
  await Promise.allSettled(saCancelAdmissionsForStore(id));
  const bindings = await getConversationBindings();
  for (const [key, raw] of Object.entries(bindings)) {
    if (raw.store_context?.storeId !== id) continue;
    const work = await workSessionFor(key);
    if (["active_visible", "active_hidden", "error"].includes(work.state))
      await saLegacyMessage({ type: "OZ_WORK_FINISH", conversation_key: key, tab_id: work.tab_id }, {});
  }
  const pending = await getPendingWorkStarts();
  for (const [tab, start] of Object.entries(pending)) if (start.store_context?.storeId === id)
    await clearPendingWorkStart(Number(tab), start.intent_id, start.revision, "store_changed");
}
async function saInvalidateAuthority() {
  const waits = [];
  for (const token of saAdmissionEpochs.values()) {
    token.cancelled = true;
    if (token.mutationFlight) waits.push(token.mutationFlight);
  }
  await Promise.allSettled(waits);
  const bindings = await getConversationBindings();
  for (const [key, raw] of Object.entries(bindings)) {
    const work = await workSessionFor(key);
    if (["active_visible", "active_hidden", "recovering", "error"].includes(work.state)) {
      try { await saLegacyMessage({ type: "OZ_WORK_FINISH", conversation_key: key, tab_id: work.tab_id }, {}); } catch (_) { /* the context guard remains closed */ }
    }
  }
  const pending = await getPendingWorkStarts();
  for (const [tab, start] of Object.entries(pending)) {
    try { await clearPendingWorkStart(Number(tab), start.intent_id, start.revision, "authority_changed"); } catch (_) { /* stale pending state is harmless */ }
  }
}
SellerAgentsControlClient.onAuthorityChanged(() => saInvalidateAuthority());
async function saPopupState(tabId) {
  let live = { ai_id: null, origin: null, conversation_id: null, status: "unavailable", source: "none", chat_path: "" };
  let usableIdentity = false;
  try {
    live = await tabIdentity(normalizeTabId(tabId));
    usableIdentity = true;
  } catch (_) {}
  const key = usableIdentity && live.conversation_id ? conversationKeyFromIdentity(live) : null;
  const context = await saPublicContext(key);
  const pending = usableIdentity ? (await getPendingWorkStarts())[String(tabId)] || null : null;
  const auth = await SellerAgentsControlClient.status();
  const work = key ? await workSessionFor(key) : null;
  const publicWork = auth.workAllowed ? work : work ? { ...work, state: OzonWorkSessionModel.STATES.INACTIVE } : null;
  let stores = [];
  if (auth.authenticated) stores = await saCatalog.list();
  return { ok: true, auth, pending: pending ? { intent_id: pending.intent_id, send_outcome: pending.send_outcome, expires_at: pending.expires_at } : null, stores,
    account: auth.account || { kind: "signed_out", label: "Вход не выполнен" },
    identity: live, conversation_key: key, context, work: publicWork,
    operation: key ? publicManualOperation(await getManualOperation(key)) : null };
}
async function saWorkStart(message, sender) {
  return singleFlight(saWorkFlights, String(message.tab_id), async () => {
    const identity = await tabIdentity(normalizeTabId(message.tab_id));
    await SellerAgentsControlClient.ensureForIdentity(identity);
    if (!await SellerAgentsControlClient.canWork()) throw saError("WORK_POLICY_BLOCKED");
    const store = await saCatalog.get(message.store_id);
    const live = await tabIdentity(normalizeTabId(message.tab_id));
    const key = live.conversation_id ? conversationKeyFromIdentity(live) : null;
    const binding = key ? await bindingForConversationKey(key) : null;
    const work = key ? await workSessionFor(key) : null;
    const pending = (await getPendingWorkStarts())[String(message.tab_id)];
    if (pending && String(pending.expires_at || "") > new Date().toISOString())
      return { ok: true, accepted: false, code: "WORK_START_ALREADY_PENDING", pending_start: pending };
    if (binding?.store_context?.storeId === store.id && ["active_visible", "active_hidden"].includes(work?.state))
      return { ok: true, accepted: false, code: "WORK_SESSION_ALREADY_ACTIVE" };
    if (binding?.store_context && binding.store_context.storeId !== store.id) throw saError("STORE_CHANGE_CONFIRMATION_REQUIRED");
    if (key && ![OzonWorkSessionModel.STATES.INACTIVE, OzonWorkSessionModel.STATES.ERROR].includes(work?.state))
      throw saError("WORK_START_ALREADY_IN_PROGRESS");
    const intentId = String(message.start_intent_id || "").trim() || `work-start-${crypto.randomUUID()}`;
    const admission = await saAdmitOnline({ operation: "start", tabId: message.tab_id, store, intentId });
    saStarts.set(Number(message.tab_id), await saAuthorityStoreContext(store));
    try {
      await saAdmissionMutationGuard({ operation: "start", tabId: message.tab_id, conversationKey: admission.snapshot.key });
      return await saRunAdmissionMutation(admission.token, () => saLegacyMessage({ type: "OZ_WORK_START", tab_id: message.tab_id, start_intent_id: intentId }, sender));
    } finally { saReleaseAdmission(admission.token); saStarts.delete(Number(message.tab_id)); }
  });
}
async function saWorkResume(message, sender) {
  return singleFlight(saWorkFlights, String(message.tab_id), async () => {
    const tab = normalizeTabId(message.tab_id);
    const identity = await tabIdentity(tab);
    await SellerAgentsControlClient.ensureForIdentity(identity);
    const key = identity.conversation_id ? conversationKeyFromIdentity(identity) : null;
    if (!key || key !== normalizeConversationKey(message.conversation_key)) throw saAdmissionError("CONVERSATION_MISMATCH");
    const binding = await bindingForConversationKey(key);
    if (!binding?.store_context) throw saAdmissionError("CONVERSATION_NOT_BOUND");
    const store = await saAssertStore(binding.store_context);
    const work = await workSessionFor(key);
    if (work.state !== OzonWorkSessionModel.STATES.INACTIVE) throw saError("WORK_SESSION_NOT_INACTIVE");
    if (await getManualOperation(key).then(manualOperationActive)) throw saError("WORK_RESUME_OPERATION_ACTIVE");
    const intentId = `resume-${crypto.randomUUID()}`;
    const admission = await saAdmitOnline({ operation: "resume", tabId: tab, store, intentId, conversationKey: key });
    try {
      await saAdmissionMutationGuard({ operation: "resume", tabId: tab, conversationKey: key });
      return await saRunAdmissionMutation(admission.token, () => saLegacyMessage({ type: "OZ_WORK_RESUME", tab_id: tab, conversation_key: key }, sender));
    } finally { saReleaseAdmission(admission.token); }
  });
}
async function saHandleMessage(message, sender) {
  const enabled = await saEnabled();
  if (/^OZ_(?:SAVE_|RESET_|CLEAR_|SET_|GET_SETTINGS_STATE|GET_GLOBAL_SETTINGS_STATE|GET_DIAGNOSTICS|BIND_CONVERSATION|TEST_CONNECTION|REFRESH_SELLER_API_METADATA|WORK_START$|WORK_SHOW$|WORK_HIDE$|WORK_FINISH$|WORK_REFRESH$|WORK_RESUME$)/.test(message?.type || "") && !saPopupSender(sender)) throw saError("POPUP_SENDER_REQUIRED");
  if (/^OZ_AUTO_/.test(message?.type || "")) throw saError("LEGACY_ACTION_DISABLED");
  if (message?.type?.startsWith("SA_")) {
    if (!saPopupSender(sender)) throw saError("POPUP_SENDER_REQUIRED");
    if (message.type === "SA_AUTH_STATE") return { ok: true, auth: await SellerAgentsControlClient.status() };
    if (message.type === "SA_AUTH_START") return { ok: true, auth: await SellerAgentsControlClient.startActivation() };
    if (message.type === "SA_AUTH_OPEN_PORTAL") return { ok: true, portalUrl: await SellerAgentsControlClient.openPortal() };
    if (message.type === "SA_AUTH_CANCEL") return { ok: true, auth: await SellerAgentsControlClient.cancelActivation() };
    if (message.type === "SA_AUTH_RESET") return { ok: true, auth: await SellerAgentsControlClient.localReset() };
    await saInitialize();
    switch (message.type) {
      case "SA_POPUP_STATE": return saPopupState(message.tab_id);
      case "SA_STORE_SAVE": {
        const old = message.store?.id ? await saCatalog.get(message.store.id) : null;
        const saved = await saCatalog.save(message.store);
        if (old && (old.credentialRevision !== saved.credentialRevision || old.personalDataEnabled !== saved.personalDataEnabled)) await saInvalidateStore(saved.id);
        return { ok: true, store: saved };
      }
      case "SA_STORE_DELETE":
        if (message.confirm !== true) throw saError("DELETE_CONFIRMATION_REQUIRED");
        await saCatalog.remove(message.store_id);
        await saInvalidateStore(message.store_id);
        return { ok: true };
      case "SA_WORK_START": return saWorkStart(message, sender);
      case "SA_WORK_RESUME": return saWorkResume(message, sender);
      case "SA_STORE_CHECK": return saCheckStore(message);
      case "SA_RESUME_QUOTA": {
        await saAssertWorkAuthority();
        const state = await saPopupState(message.tab_id), key = state.conversation_key;
        const owner = await getManualOperation(key);
        if (!owner || owner.batch?.request_state !== "quota_waiting") throw saError("NO_QUOTA_WAIT");
        await assertManualBatchContext(key, owner.operation_id);
        launchBatchProcessor("manual", key, owner.operation_id, "explicit_quota_resume");
        return { ok: true };
      }
      default: throw saError("UNKNOWN_MESSAGE");
    }
  }
  if (enabled) {
    const workMessage = message?.type === "OZ_EXECUTE_COMMAND" || message?.type === "OZ_WORK_START" || message?.type?.startsWith("OZ_WORK_START_") || message?.type === "OZ_WORK_PENDING_IDENTITY" || message?.type === "OZ_BATCH_DELIVERY_RESUME";
    if (workMessage) await saAssertWorkAuthority();
    if (/^OZ_(?:GET_SETTINGS_STATE|GET_GLOBAL_SETTINGS_STATE|GET_DIAGNOSTICS)/.test(message.type) && !saPopupSender(sender)) throw saError("POPUP_SENDER_REQUIRED");
    if (message.type === "OZ_WORK_RESUME") return saWorkResume(message, sender);
    if (/^OZ_(?:AUTO_|BIND_CONVERSATION|SAVE_.*SETTINGS|TEST_CONNECTION|SET_MANUAL_MODE|SAVE_REPORT_PREFIX|SAVE_.*START_PROMPT|RESET_.*START_PROMPT|REFRESH_SELLER_API_METADATA)/.test(message?.type || "")) throw saError("LEGACY_ACTION_DISABLED");
    if (["OZ_WORK_DELIVERY_ASSERT", "OZ_WORK_SEND_COMMIT"].includes(message.type)) {
      const key = normalizeConversationKey(message.conversation_key), id = String(message.owner_id || "");
      await assertTabConversation(sender?.tab?.id, key);
      const current = await getManualOperation(key);
      if (current?.operation_id !== id || current.delivery?.delivery_id !== message.delivery_id || Number(current.tab_id) !== Number(sender?.tab?.id)) throw saError("DELIVERY_OWNER_MISMATCH");
      await saAssertDeliveryOwner(current);
      if (message.type === "OZ_WORK_DELIVERY_ASSERT") return { ok: true };
      if (!message.actor_id) throw saError("DELIVERY_ACTOR_REQUIRED");
      let granted = false;
      await mutateManualOperation(key, async owner => {
        if (owner?.operation_id !== id || owner.delivery?.delivery_id !== message.delivery_id) throw saError("DELIVERY_OWNER_MISMATCH");
        await saAssertDeliveryOwner(owner);
        if (owner.delivery.sa_send_actor) return owner;
        if (owner.delivery.phase !== "inserted") throw saError("DELIVERY_NOT_INSERTED");
        granted = true;
        return { ...owner, delivery: { ...owner.delivery, sa_send_actor: message.actor_id, sa_send_committed_at: Date.now() } };
      });
      return { ok: true, click_allowed: granted, code: granted ? "SEND_COMMITTED" : "SEND_OUTCOME_UNKNOWN_NO_RETRY" };
    }
    if (message.type === "OZ_WORK_START") throw saError("STORE_SELECTION_REQUIRED");
    if (["OZ_WORK_SHOW", "OZ_WORK_HIDE", "OZ_WORK_FINISH", "OZ_WORK_REFRESH"].includes(message.type) && !saPopupSender(sender)) throw saError("POPUP_SENDER_REQUIRED");
    if (message.type.startsWith("OZ_WORK_START_") || message.type === "OZ_WORK_PENDING_IDENTITY") {
      const pending = (await getPendingWorkStarts())[String(sender?.tab?.id || message.tab_id)];
      await saPendingGuard(pending);
    }
    if (message.type === "OZ_WORK_FINISH") {
      await Promise.allSettled(saCancelAdmission(message.tab_id, typeof message.conversation_key === "string" ? message.conversation_key : null));
      const pending = (await getPendingWorkStarts())[String(message.tab_id)];
      if (pending) {
        await clearPendingWorkStart(message.tab_id, pending.intent_id, pending.revision, "operator_finish");
        if (pending.conversation_key) await tabMessage(message.tab_id, { type: "OZ_WORK_APPLY_VISIBILITY", visible: false, conversation_key: pending.conversation_key });
        return { ok: true, pending_cancelled: true };
      }
    }
    if (message.type === "OZ_WORK_HIDE") {
      const key = normalizeConversationKey(message.conversation_key), work = await workSessionFor(key);
      await assertTabConversation(message.tab_id, key);
      if (work.state !== "active_visible") throw saError("WORK_SESSION_NOT_VISIBLE");
      await mutateWorkSession(key, work.revision, OzonWorkSessionModel.STATES.ACTIVE_HIDDEN);
      await tabMessage(message.tab_id, { type: "OZ_WORK_APPLY_VISIBILITY", visible: false, conversation_key: key, work_active: true });
      return { ok: true };
    }
    if (message.type === "OZ_EXECUTE_COMMAND") {
      await saAssertWorkAuthority();
      await assertTabConversation(sender?.tab?.id, message.conversation_key);
      const binding = await bindingForConversationKey(message.conversation_key);
      await saAssertStore(binding?.store_context);
      const work = await workSessionFor(message.conversation_key);
      if (work.state !== "active_visible") throw saError("WORK_SESSION_NOT_VISIBLE");
      if (message.work_session_id !== work.start_intent_id) throw saError("WORK_SESSION_CHANGED");
    }
    if (message.type.startsWith("OZ_BATCH_DELIVERY_")) {
      await assertManualBatchContext(message.conversation_key, message.owner_id || message.operation_id);
      if (message.type === "OZ_BATCH_DELIVERY_COMPLETE") {
        const current = await getManualOperation(message.conversation_key);
        if (!current?.delivery?.sa_send_actor) throw saError("SEND_NOT_COMMITTED");
      }
    }
  }
  const result = await saLegacyMessage(message, sender);
  if (enabled && ["OZ_CONTENT_READY", "OZ_CONTENT_SYNC", "OZ_GET_MANUAL_STATE"].includes(message.type) && result?.ok) {
    const key = result.conversation_key || message.conversation_key;
    result.store_context = await saPublicContext(key);
    result.auto_watch = null;
  }
  return result;
}
async function saCheckStore(message) {
  const store = await saCatalog.get(message.store_id), pinned = saStoreContext(store);
  let result;
  try {
    if (store.marketplace === "wildberries") {
      const snapshot = SellerAgentsExecutionContext.snapshot({ ...pinned, conversationKey: "credential-check", bindingId: "credential-check",
        bindingRevision: 1, workSessionId: "credential-check", commandHash: "credential-check", requestId: crypto.randomUUID() });
      const context = await SellerAgentsWBAdapter.createContext({ snapshot, credentials: store.credentials,
        readCurrent: async () => ({ ...snapshot, ...saStoreContext(await saAssertStore(pinned)), active: true }) });
      result = await SellerAgentsWBAdapter.createProvider().execute('WB_API_V1 {"operation":"seller_info","params":{}}', { context });
    } else if (message.part === "performance") result = await OzonProvider.testPerformanceConnection(store.credentials.performance);
    else result = await OzonProvider.testConnection(store.credentials.seller);
  } catch (error) { result = { ok: false, http_status: error.http_status || 0 }; }
  await saAssertStore(pinned);
  const httpStatus = Number(result.http_status || 0);
  const code = result.ok ? "ACCESS_CONFIRMED" : httpStatus === 401 ? "CREDENTIAL_REJECTED" : httpStatus === 403 ? "ACCESS_DENIED" : "CHECK_FAILED";
  return { ok: true, store: await saCatalog.noteVerification(store.id, store.credentialRevision,
    store.marketplace === "wildberries" ? "token" : message.part === "performance" ? "performance" : "seller", { code, httpStatus }) };
}
function saPrunePayload(owner, now = Date.now()) {
  if (!owner) return owner;
  const expires = owner.payload_expires_at_ms || Date.parse(owner.created_at || "") + SA_PAYLOAD_TTL;
  if (Number.isFinite(expires) && expires > now) return { ...owner, payload_expires_at_ms: expires };
  return { ...owner, status: "failed", batch: null, outgoing_text: null, delivery: null,
    completed_at: owner.completed_at || new Date(now).toISOString(), last_error: { code: "RESULT_EXPIRED" } };
}
async function saAssertDeliveryOwner(owner) {
  if (!owner?.execution_context) throw SellerAgentsExecutionContext.error("EXECUTION_CONTEXT_MISSING");
  await saAssertWorkAuthority();
  if (owner.payload_expires_at_ms <= Date.now()) throw saError("RESULT_EXPIRED");
  const guard = await saGuard(owner);
  await guard.assertCurrent();
}

async function saCleanupExpiredPayloads() {
  if (!await saEnabled()) return;
  const data = await storageGet(KEYS.MANUAL_OPERATIONS);
  for (const [key, owner] of Object.entries(data[KEYS.MANUAL_OPERATIONS] || {})) {
    const expiry = owner.payload_expires_at_ms || Date.parse(owner.created_at || "") + SA_PAYLOAD_TTL;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) await mutateManualOperation(key, current => saPrunePayload(current));
  }
  await OzonFileDeliveryWorker.cleanupExpiredArtifacts();
}
chrome.alarms.create("seller-agents-payload-cleanup", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "seller-agents-payload-cleanup") void saCleanupExpiredPayloads(); });
setTimeout(() => { void saCleanupExpiredPayloads(); }, 0);
const saFileOwners = SellerAgentsLocalOperations.createRecordStore({ read: keys => chrome.storage.session.get(keys),
  write: values => chrome.storage.session.set(values), namespace: "seller_agents_file_owners_v1" });
async function saCheckOzonFileRef(command, context) {
  if (command.operation !== "report_file_get") return;
  await saAssertWorkAuthority();
  const owner = await saFileOwners.get(command.params.file_ref), pinned = context?.snapshot;
  if (!pinned || !owner || owner.expires_at_ms <= Date.now() ||
    ["accountId", "storeId", "credentialRevision"].some(field => owner[field] !== pinned[field]))
    throw saError("REPORT_FILE_STORE_MISMATCH");
  await context.assertCurrent();
}
async function saRememberOzonFileRefs(response, context) {
  if (!context) return;
  await saAssertWorkAuthority();
  let envelope;
  try { envelope = JSON.parse(String(response.report_text).slice(String(response.report_text).indexOf("\n") + 1)); } catch (_) { return; }
  for (const ref of [envelope?.result?.report_file_ref, envelope?.result?.generated_file_ref]) {
    if (!/^rpf_[sp]_[A-Za-z0-9_-]+$/.test(ref || "")) continue;
    await context.assertCurrent();
    await saFileOwners.mutate(ref, async old => {
      await context.assertCurrent();
      const p = context.snapshot;
      if (old && ["accountId", "storeId", "credentialRevision"].some(field => old[field] !== p[field])) throw saError("REPORT_FILE_STORE_MISMATCH");
      return old || { accountId: p.accountId, storeId: p.storeId, credentialRevision: p.credentialRevision, expires_at_ms: Date.now() + SA_PAYLOAD_TTL };
    });
  }
}
