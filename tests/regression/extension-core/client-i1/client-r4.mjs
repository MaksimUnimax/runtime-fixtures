import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const future = ms => new Date(Date.now() + ms).toISOString();
const uuid = n => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const account = n => uuid(n);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const profileFingerprint = (content, compatibility) => createHash("sha256").update(canonical({ content, compatibility })).digest("hex");

async function template(directory) {
  const backing = { local: {}, session: {} };
  const worker = await makeWorker(directory, { backing });
  const saved = structuredClone(backing.local[AUTH]);
  const payload = structuredClone(saved.authority.payload);
  worker.close();
  delete backing.local[AUTH];
  return { backing, payload, saved };
}
function payloadFor(base, id, ai = base.ai, changes = {}) {
  return { ...structuredClone(base), account: { id, status: "ACTIVE" }, issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: future(3600000), offlineGraceUntil: future(7200000), serverTime: new Date().toISOString(), ai: structuredClone(ai), ...changes };
}
async function signed(backing, payload) { return json(await signFixtureBootstrap(backing, payload)); }
async function packagedConfig(backing, extensionVersion) {
  const publicKey = Buffer.from(backing.local.__seller_agents_fixture_signing_key.publicKey, "base64");
  const fingerprint = createHash("sha256").update(publicKey).digest("hex");
  return { environment: "LOCAL DEVELOPMENT", controlApiOrigin: "http://127.0.0.1:43100", portalOrigin: "http://127.0.0.1:43101", extensionVersion, contractVersion: "control_plane_v2", trustBundle: { trustBundleVersion: "bootstrap_trust_bundle_v1", algorithm: "Ed25519", publicKeyFormat: "spki_der", publicKeyEncoding: "base64", fingerprintAlgorithm: "sha256", fingerprintEncoding: "lowercase_hex", keys: [{ keyId: "fixture-key", publicKey: publicKey.toString("base64"), fingerprintSha256: fingerprint, lifecycle: "ACTIVE", trustEligibility: "SIGNING_AND_VERIFICATION" }] } };
}
function activated(n, prefix = "b") { return { status: "activated", deviceId: uuid(100 + n), sessionId: uuid(200 + n), tokenType: "Bearer", accessToken: `${prefix}-access-${n}-token`, accessTokenExpiresAt: future(3600000), refreshToken: `${prefix.toUpperCase()}${String(n).repeat(42)}`, refreshTokenExpiresAt: future(7200000) }; }
function startResponse(n) { return { status: "pending", authorizationId: uuid(300 + n), deviceCode: String.fromCharCode(65 + n).repeat(43), userCode: "ABCD-EFGH", expiresAt: future(60000) }; }

// R4-1: every successful response whose bounded body cannot be read is denial;
// a bounded-body failure on a transient non-2xx response remains retry/transport state.
for (const status of [200, 201, 206]) {
  const worker = await makeWorker(runtime, { fetch: async url => url.endsWith("/v1/bootstrap") ? new Response("x".repeat(1024 * 1024 + 1), { status }) : (() => { throw new Error("unexpected control request " + url); })() });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /CONTROL_RESPONSE_TOO_LARGE/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.authenticated, false, `${status} invalidates account authority`);
    assert.equal(state.workAllowed, false, `${status} invalidates Work`);
    assert.equal(state.lastError.code, "CONTROL_RESPONSE_TOO_LARGE");
  } finally { worker.close(); }
}
{
  const worker = await makeWorker(runtime, { fetch: async url => url.endsWith("/v1/bootstrap") ? new Response("x".repeat(1024 * 1024 + 1), { status: 503 }) : (() => { throw new Error("unexpected control request " + url); })() });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /CONTROL_RESPONSE_TOO_LARGE/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.authenticated, true); assert.equal(state.workAllowed, true); assert.equal(state.lastError, null);
  } finally { worker.close(); }
}
for (const status of [401, 403]) {
  const worker = await makeWorker(runtime, { fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) return new Response("x".repeat(1024 * 1024 + 1), { status });
    if (url.endsWith("/v1/auth/refresh")) return json({ tokenType: "Bearer", accessToken: "rotated-access-token", accessTokenExpiresAt: future(3600000), refreshToken: "R".repeat(43), refreshTokenExpiresAt: future(7200000) });
    throw new Error("unexpected control request " + url);
  } });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /CONTROL_RESPONSE_TOO_LARGE/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.authenticated, false, `${status} remains final invalidation`); assert.equal(state.workAllowed, false); assert.equal(state.lastError.code, "CONTROL_RESPONSE_TOO_LARGE");
  } finally { worker.close(); }
}

// Signed top-level and profile minimums exercise the real verifier and the
// client comparator, including precedence cases that cannot be inferred from a
// single packaged version.
const semverCases = [
  ["combined-prerelease-build", "0.2.4-alpha.2+build.7", "0.2.4", true],
  ["build-does-not-change-precedence", "0.2.4+build.99", "0.2.4", true],
  ["alpha-2-before-alpha-10", null, "0.2.4-alpha.10", false, "0.2.4-alpha.2"],
  ["alpha-10-after-alpha-2", null, "0.2.4-alpha.2", true, "0.2.4-alpha.10"],
  ["prerelease-before-release", null, "0.2.4", false, "0.2.4-alpha.10"],
  ["release-after-prerelease", null, "0.2.4-alpha.10", true, "0.2.4"],
  ["numeric-prerelease-before-text", null, "0.2.4-alpha-channel", false, "0.2.4-alpha.2"],
  ["text-prerelease-after-numeric", null, "0.2.4-alpha.2", true, "0.2.4-alpha-channel"],
  ["alpha-2-before-alpha-beta", null, "0.2.4-alpha.beta", false, "0.2.4-alpha.2"],
  ["alpha-beta-after-alpha-2", null, "0.2.4-alpha.2", true, "0.2.4-alpha.beta"],
  ["alpha-before-alpha-1", null, "0.2.4-alpha.1", false, "0.2.4-alpha"],
  ["alpha-1-after-alpha", null, "0.2.4-alpha", true, "0.2.4-alpha.1"],
  ["leading-zero-prerelease-denied", "0.2.4-alpha.01", "0.2.4", false],
  ["malformed-build-denied", "0.2.4+bad..metadata", "0.2.4", false],
  ["over-64-denied", "0.2.4+" + "x".repeat(60), "0.2.4", false],
];
for (const [label, topMinimum, profileMinimum, expected, packagedVersion = "0.2.4"] of semverCases) {
  const { backing, payload, saved } = await template(runtime);
  backing.local[AUTH] = saved;
  const config = await packagedConfig(backing, packagedVersion);
  const worker = await makeWorker(runtime, { backing, packagedConfig: config, fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected semver control request " + url);
    const base = structuredClone(backing.local[AUTH].authority?.payload || payload);
    const compatibility = { ...base.ai.profile.compatibility, minimumExtensionVersion: profileMinimum };
    const profile = { ...base.ai.profile, compatibility, contentSha256: profileFingerprint(base.ai.profile.content, compatibility) };
    return signed(backing, payloadFor(base, base.account.id, { ...base.ai, profile }, { compatibility: { ...base.compatibility, extension: { ...base.compatibility.extension, minimumVersion: topMinimum } } }));
  } });
  try {
    const call = worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    if (expected) { await call; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, label); }
    else { await assert.rejects(call, /BOOTSTRAP_(?:INVALID_PAYLOAD_SCHEMA|PROFILE_INCOMPATIBLE)/, label); assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false, label); }
  } finally { worker.close(); }
}
for (const [label, version, minimum, expected] of [["browser-minimum-one-higher", "120.0.0.0", "120.0.0.1", false], ["browser-equal-four-components", "120.0.0.0", "120.0.0.0", true], ["browser-equal-zero-padded-shape", "120.0.0.0", "120.0.0", true], ["browser-leading-zero-control", "120.0.0.0", "0120.0.0.0", false], ["browser-out-of-range-control", "120.0.0.0", "2147483648.0", false]]) {
  const { backing, payload, saved } = await template(runtime);
  backing.local[AUTH] = saved;
  const worker = await makeWorker(runtime, { backing, userAgent: `Mozilla/5.0 Chrome/${version}`, fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected browser control request " + url);
    const base = structuredClone(payload), compatibility = { ...base.ai.profile.compatibility, minimumBrowserVersions: [{ browserFamily: "chrome", minimumVersion: minimum }] };
    const profile = { ...base.ai.profile, compatibility, contentSha256: profileFingerprint(base.ai.profile.content, compatibility) };
    return signed(backing, payloadFor(base, base.account.id, { ...base.ai, profile }));
  } });
  try {
    const call = worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    if (expected) await call; else await assert.rejects(call, /BOOTSTRAP_PROFILE_INCOMPATIBLE/);
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), expected, label);
  } finally { worker.close(); }
}

// R4-2 owner barriers: old requests are settled after a same-worker B
// exchange, so the assertion covers bearer, generation, authority and error
// ownership rather than merely comparing two worker stores.
async function completeB(worker, payload, starts, fetchState) {
  await worker.call("SellerAgentsControlClient.startActivation");
  await until(() => fetchState.starts >= starts, "B device start");
  await until(async () => (await worker.call("SellerAgentsControlClient.status")).authenticated, "B authenticated");
  const state = await worker.call("SellerAgentsControlClient.status");
  assert.equal(state.accountId, account(2));
  return state;
}
for (const oldOutcome of ["success", "failure"]) {
  const { backing, payload } = await template(runtime); let releaseA; const fetchState = { starts: 0, tokens: 0 };
  const worker = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) { const n = ++fetchState.starts; if (n === 1) return new Promise(resolve => { releaseA = () => resolve(oldOutcome === "success" ? json(startResponse(1)) : json({ error: { code: "A_START_FAILED" } }, 500)); }); return json(startResponse(2)); }
    if (url.endsWith("/v1/device-authorizations/token")) { fetchState.tokens++; return json(activated(2)); }
    if (url.endsWith("/v1/bootstrap")) return signed(backing, payloadFor(payload, account(2), { status: "UNCONFIGURED" }));
    throw new Error("unexpected start owner request " + url);
  } });
  try {
    const oldStart = worker.call("SellerAgentsControlClient.startActivation"); await until(() => releaseA, "held A start");
    await worker.call("SellerAgentsControlClient.cancelActivation");
    await completeB(worker, payload, 2, fetchState); releaseA();
    if (oldOutcome === "success") await oldStart; else await assert.rejects(oldStart, /A_START_FAILED/);
    const state = await worker.call("SellerAgentsControlClient.status"); assert.equal(state.accountId, account(2)); assert.equal(state.pending, null); assert.equal(state.lastError, null); assert.equal(fetchState.tokens, 1);
  } finally { releaseA?.(); worker.close(); }
}

for (const outcome of ["success", "invalid"]) {
  const { backing, payload } = await template(runtime); let releaseA; let refreshCalls = 0;
  const worker = await makeWorker(runtime, { backing, fetch: async url => {
    if (url.endsWith("/v1/auth/refresh")) { refreshCalls++; return new Promise(resolve => { releaseA = () => resolve(outcome === "success" ? json({ tokenType: "Bearer", accessToken: "A-refresh-token", accessTokenExpiresAt: future(3600000), refreshToken: "Q".repeat(43), refreshTokenExpiresAt: future(7200000) }) : json({ error: { code: "AUTH_REFRESH_INVALID" } }, 401)); }); }
    if (url.endsWith("/v1/device-authorizations")) return json(startResponse(2));
    if (url.endsWith("/v1/device-authorizations/token")) return json(activated(2));
    if (url.endsWith("/v1/bootstrap")) return signed(backing, payloadFor(payload, account(2), { status: "UNCONFIGURED" }));
    throw new Error("unexpected refresh owner request " + url);
  } });
  try {
    const oldRefresh = worker.call("SellerAgentsControlClient.refresh", { force: true }); await until(() => refreshCalls === 1, "held A refresh");
    await worker.call("SellerAgentsControlClient.localReset"); await completeB(worker, payload, 1, { starts: 1 }); releaseA?.();
    if (outcome === "success") await assert.rejects(oldRefresh, /AUTH_GENERATION_CHANGED/); else await assert.rejects(oldRefresh, /AUTH_REFRESH_INVALID/);
    const state = await worker.call("SellerAgentsControlClient.status"); assert.equal(state.accountId, account(2)); assert.equal(state.authenticated, true); assert.equal(state.lastError, null);
  } finally { releaseA?.(); worker.close(); }
}

for (const outcome of ["success", "forbidden", "malformed"]) {
  const { backing, payload, saved } = await template(runtime);
  backing.local[AUTH] = saved;
  backing.local[AUTH].credentials.accessTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
  let bootstrapCalls = 0, releaseA;
  const worker = await makeWorker(runtime, { backing, fetch: async (url) => {
    if (url.endsWith("/v1/auth/refresh")) return json({ tokenType: "Bearer", accessToken: "A-refreshed-token", accessTokenExpiresAt: future(3600000), refreshToken: "S".repeat(43), refreshTokenExpiresAt: future(7200000) });
    if (url.endsWith("/v1/device-authorizations")) return json(startResponse(2));
    if (url.endsWith("/v1/device-authorizations/token")) return json(activated(2));
    if (url.endsWith("/v1/bootstrap")) {
      bootstrapCalls++;
      if (bootstrapCalls === 1) return new Promise(resolve => { releaseA = () => resolve(outcome === "success" ? signed(backing, payloadFor(payload, account(1), { status: "UNCONFIGURED" })) : outcome === "forbidden" ? json({ error: { code: "A_BOOTSTRAP_FORBIDDEN" } }, 403) : signed(backing, (() => { const malformed = payloadFor(payload, account(1), { status: "UNCONFIGURED" }); delete malformed.account; return malformed; })())); });
      return signed(backing, payloadFor(payload, account(2), { status: "UNCONFIGURED" }));
    }
    throw new Error("unexpected bootstrap-owner request " + url);
  } });
  try {
    const oldBootstrap = worker.call("SellerAgentsControlClient.bootstrap");
    await until(() => bootstrapCalls === 1 && releaseA, "held A bootstrap after expired-token refresh");
    await worker.call("SellerAgentsControlClient.localReset");
    await completeB(worker, payload, 1, { starts: 1 });
    releaseA();
    if (outcome === "success") await assert.rejects(oldBootstrap, /AUTH_GENERATION_CHANGED/);
    else if (outcome === "forbidden") await assert.rejects(oldBootstrap, /A_BOOTSTRAP_FORBIDDEN/);
    else await assert.rejects(oldBootstrap, /BOOTSTRAP_INVALID_PAYLOAD_SCHEMA|AUTH_GENERATION_CHANGED/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.accountId, account(2)); assert.equal(state.authenticated, true); assert.equal(state.workAllowed, false); assert.equal(state.lastError, null);
  } finally { releaseA?.(); worker.close(); }
}

// startActivation's credentials/no-authority recovery path has the same owner
// rule: a stale A bootstrap result cannot write its failure into B.
{
  const { backing, payload, saved } = await template(runtime);
  backing.local[AUTH] = saved;
  backing.local[AUTH].authority = null;
  let releaseA, bootstrapCalls = 0;
  const worker = await makeWorker(runtime, { backing, fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) { bootstrapCalls++; if (bootstrapCalls === 1) return new Promise(resolve => { releaseA = () => resolve(json({ error: { code: "A_START_BOOTSTRAP_FAILED" } }, 403)); }); return signed(backing, payloadFor(payload, account(2), { status: "UNCONFIGURED" })); }
    if (url.endsWith("/v1/device-authorizations")) return json(startResponse(2));
    if (url.endsWith("/v1/device-authorizations/token")) return json(activated(2));
    throw new Error("unexpected start recovery request " + url);
  } });
  try {
    const oldRecovery = worker.call("SellerAgentsControlClient.startActivation"); await until(() => bootstrapCalls === 1 && releaseA, "held no-authority A bootstrap");
    await worker.call("SellerAgentsControlClient.localReset"); await completeB(worker, payload, 1, { starts: 1 }); releaseA(); await oldRecovery;
    const state = await worker.call("SellerAgentsControlClient.status"); assert.equal(state.accountId, account(2)); assert.equal(state.authenticated, true); assert.equal(state.lastError, null);
  } finally { releaseA?.(); worker.close(); }
}

for (const kind of ["bad-signature", "unknown-key", "malformed-schema"]) {
  const { backing, payload } = await template(runtime);
  const worker = await makeWorker(runtime, { backing, fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected authority invalidation request " + url);
    if (kind === "malformed-schema") { const malformed = structuredClone(payload); delete malformed.account; return signed(backing, malformed); }
    const envelope = await signFixtureBootstrap(backing, payload);
    if (kind === "bad-signature") { const bytes = Buffer.from(envelope.signature, "base64url"); bytes[0] ^= 1; envelope.signature = bytes.toString("base64url"); }
    else envelope.keyId = "unknown-fixture-key";
    return json(envelope);
  } });
  try {
    const before = await worker.call("SellerAgentsControlClient.generation");
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /BOOTSTRAP_(?:INVALID_SIGNATURE|UNKNOWN_SIGNING_KEY|INVALID_PAYLOAD_SCHEMA)/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.ok(state.generation > before, `${kind} advances generation`); assert.equal(state.authenticated, false); assert.equal(state.workAllowed, false); assert.equal(state.accountId, null);
  } finally { worker.close(); }
}

async function startComposedStore(worker, store) {
  const saved = await worker.popup({ type: "SA_STORE_SAVE", store }); assert.equal(saved.ok, true, JSON.stringify(saved));
  const started = await worker.popup({ type: "SA_WORK_START", store_id: saved.store.id, tab_id: worker.tabId, confirm_change: true }); assert.equal(started.ok, true, JSON.stringify(started));
  const pending = await until(async () => { const row = (await worker.call("getPendingWorkStarts"))[worker.tabId]; return row?.send_outcome === "sent_acknowledged" ? row : null; }, "composed start acknowledgement");
  const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: worker.identity, first_response_complete: true });
  assert.equal(active.ok, true, JSON.stringify(active)); return { key: active.binding.conversation_key, session: active.session, store: saved.store };
}

// G3 composed denial: the client’s real signed-authority invalidation is
// exercised while the first provider request of a sequential Ozon/WB batch is
// held. Cleanup writes are deliberately unavailable; memory-side guards still
// deny the tail and delivery without control-plane guard traffic.
for (const marketplace of ["ozon", "wildberries"]) {
  let releaseProvider, denied = false, providerCalls = 0;
  const providerUrls = [];
  const providerWait = new Promise(resolve => { releaseProvider = resolve; });
  const cleanupAttempts = [];
  const worker = await makeWorker(runtime, { fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) return json({ error: { code: "COMPOSED_BOOTSTRAP_DENIED" } }, 403);
    if (url.startsWith("https://")) { providerCalls++; providerUrls.push(url); await providerWait; return json({ result: [] }); }
    throw new Error("unexpected composed denial request " + url);
  }, onStorageWrite: async (kind, values) => {
    if (denied && kind === "local" && Object.keys(values).some(key => /work|binding|manual/i.test(key))) { cleanupAttempts.push(Object.keys(values)); throw new Error("fixture cleanup write failure"); }
  } });
  try {
    const store = marketplace === "ozon" ? { marketplace, credentials: { seller: { clientId: "FIXTURE_OZON_CLIENT", apiKey: "FIXTURE_OZON_KEY" } }, personalDataEnabled: true } : { marketplace, credentials: { token: "FIXTURE_WB_TOKEN" }, personalDataEnabled: true };
    const started = await startComposedStore(worker, store);
    const command = marketplace === "ozon" ? `OZON_API_V1\n${JSON.stringify({ operation: "seller_info", params: {} })}\nOZON_API_V1\n${JSON.stringify({ operation: "description_category_tree", params: {} })}` : `WB_API_V1 ${JSON.stringify({ operation: "seller_info", params: {} })}\nWB_API_V1 ${JSON.stringify({ operation: "seller_info", params: {} })}`;
    const admission = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: started.key, command_text: command, manual_request_id: `r4-denial-${marketplace}`, work_session_id: started.session.start_intent_id });
    assert.equal(admission.accepted, true, JSON.stringify(admission)); await until(() => providerCalls === 1 ? true : null, `${marketplace} first provider dispatch`);
    denied = true;
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /COMPOSED_BOOTSTRAP_DENIED/);
    denied = false;
    releaseProvider();
    const settlementDeadline = Date.now() + 3000;
    const operation = await until(async () => { const row = await worker.call("getManualOperation", started.key); if (row?.status === "failed") return row; if (Date.now() > settlementDeadline) throw new Error(`${marketplace} denied batch status=${row?.status || "missing"} network=${worker.network.length} messages=${worker.messages.length}`); return null; }, `${marketplace} denied batch settlement`);
    assert.ok(operation.last_error); assert.equal(worker.messages.filter(message => message.type === "OZ_BATCH_DELIVERY_AVAILABLE").length, 0);
    assert.equal(providerCalls, 1, `${marketplace} no second provider dispatch: ${JSON.stringify(providerUrls)}`);
    assert.equal(providerUrls.length, 1); assert.match(providerUrls[0], marketplace === "ozon" ? /ozon\.ru/ : /wildberries\.ru/);
    const control = worker.controlNetwork.filter(row => row.url.startsWith("http://127.0.0.1:43100/v1/"));
    assert.equal(control.filter(row => row.url.endsWith("/v1/bootstrap")).length, 1, `${marketplace} one explicit bootstrap control request`);
    assert.equal(control.filter(row => row.url.endsWith("/v1/health-authority")).length, 1, `${marketplace} one admission Health request`);
    const fields = { owner_kind: "manual", owner_id: operation.operation_id, conversation_key: started.key, delivery_id: operation.delivery_id || "denied-delivery", actor_id: "fixture-denied" };
    assert.notEqual((await worker.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields })).insert_allowed, true);
    assert.notEqual((await worker.request({ type: "OZ_WORK_SEND_COMMIT", ...fields })).click_allowed, true);
    assert.ok(cleanupAttempts.length > 0, `${marketplace} attempted cleanup writes`);
  } finally { releaseProvider(); worker.close(); }
}

console.log(JSON.stringify({ status: "PASS", r4_1: { oversized_successes: [200, 201, 206], transient_503: true, final_401_403: true, semver_shared_grammar: true, precedence_matrix: semverCases.length, browser_120_matrix: 5 }, r4_2: { held_start_outcomes: 2, same_worker_refresh_outcomes: 2, owner_barriers: true } }));
