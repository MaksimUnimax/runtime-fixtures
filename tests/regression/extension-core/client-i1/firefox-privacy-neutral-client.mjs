import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const firefox = "Mozilla/5.0 Gecko/20100101 Firefox/156.0";
const pending = (n) => ({ status: "pending", authorizationId: `${n}0000000-0000-4000-8000-${n}00000000000`, deviceCode: n.repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(Date.now() + 60_000).toISOString() });
const errorResponse = (code, status = 400) => new Response(JSON.stringify({ error: { code } }), { status, headers: { "content-type": "application/json" } });
const granted = new Set(["technicalAndInteraction"]);
const permissions = store => ({ getAll: async () => ({ data_collection: [...store] }) });
const canonical = value => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const sha256 = value => createHash("sha256").update(canonical(value)).digest("hex");
async function neutralEnvelope(worker) {
  const original = structuredClone(worker.backing.local.seller_agents_control_auth_v2.authority.payload);
  const { compatibility, features, ai, ...common } = original;
  return signFixtureBootstrap(worker.backing, {
    ...common,
    localClientAuthority: {
      schemaVersion: "local_client_authority_v1", contractVersion: "control_plane_v2",
      compatibility: { releases: [{ extensionVersion: "0.2.4", contractVersions: ["control_plane_v2"], browserFamilies: ["firefox"] }], policies: [{ policyKey: "firefox", revision: 1, contractVersion: "control_plane_v2", browserFamily: "firefox", minimumExtensionVersion: null, recommendedExtensionVersion: null, minimumBrowserVersion: "140", maintenanceMode: false, maintenanceCode: null, blockedVersions: [] }] },
      featureRules: [], ai: { status: "UNCONFIGURED" },
    },
  });
}

async function neutralResolvedEnvelope(worker) {
  const original = structuredClone(worker.backing.local.seller_agents_control_auth_v2.authority.payload);
  const { compatibility, features, ai, ...common } = original;
  const profile = structuredClone(original.ai.profile);
  profile.compatibility = {
    ...profile.compatibility,
    contractVersion: "control_plane_v2",
    browserFamilies: ["firefox"],
    minimumBrowserVersions: [{ browserFamily: "firefox", minimumVersion: "140" }],
  };
  profile.contentSha256 = sha256({ content: profile.content, compatibility: profile.compatibility });
  return signFixtureBootstrap(worker.backing, {
    ...common,
    localClientAuthority: {
      schemaVersion: "local_client_authority_v1",
      contractVersion: "control_plane_v2",
      compatibility: {
        releases: [{ extensionVersion: "0.2.4", contractVersions: ["control_plane_v2"], browserFamilies: ["firefox"] }],
        policies: [{ policyKey: "firefox", revision: 1, contractVersion: "control_plane_v2", browserFamily: "firefox", minimumExtensionVersion: null, recommendedExtensionVersion: null, minimumBrowserVersion: "140", maintenanceMode: false, maintenanceCode: null, blockedVersions: [] }],
      },
      featureRules: [],
      ai: {
        status: "CANDIDATES",
        detected: original.ai.detected,
        candidates: [{ browserFamily: "firefox", resolution: { status: "RESOLVED", profile } }],
      },
    },
  });
}

function autonomousInput(worker) {
  const auth = structuredClone(worker.backing.local.seller_agents_control_auth_v2);
  const authority = auth.authority;
  const payload = authority.payload;
  const profile = payload.ai.profile;
  const store = { accountId: payload.account.id, id: "firefox-neutral-store", marketplace: "ozon", credentialRevision: "firefox-neutral-r1" };
  const identity = { origin: "https://chatgpt.com", conversationId: "firefox-neutral-dialogue", key: "https://chatgpt.com|firefox-neutral-dialogue", provider: "chatgpt" };
  const current = {
    accountId: payload.account.id, expectedAccountId: payload.account.id,
    generation: authority.generation, expectedGeneration: authority.generation,
    deviceId: authority.deviceId, expectedDeviceId: authority.deviceId,
    sessionId: authority.sessionId, expectedSessionId: authority.sessionId,
    aiFamily: "chatgpt", aiSurface: "web", aiVariant: null,
    aiProfile: { profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 },
    origin: identity.origin, conversationId: identity.conversationId, conversationKey: identity.key,
    storeId: store.id, marketplace: store.marketplace, credentialRevision: store.credentialRevision,
    expectedCredentialRevision: store.credentialRevision, bindingId: null, bindingRevision: null,
    workStartIntentId: null, expectedWorkStartIntentId: null,
  };
  return {
    operation: "START", source: "ONLINE", cachedAuthority: authority, cacheClock: auth.cacheClock,
    effectiveTimeMs: auth.cacheClock.effectiveTimeMs, identity, binding: null, store,
    work: { state: "inactive", start_intent_id: null }, current,
  };
}

async function authShape(store, userAgent = firefox) {
  const worker = await makeWorker(runtime, { userAgent, seedAuthority: false, firefoxPermissions: permissions(store), fetch: async url => url.endsWith("/v1/device-authorizations") ? new Response(JSON.stringify(pending("4")), { headers: { "content-type": "application/json" } }) : errorResponse("DEVICE_AUTH_PENDING") });
  try {
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(() => worker.controlNetwork.some(row => row.url.endsWith("/v1/device-authorizations")), "device authorization request");
    return JSON.parse(worker.controlNetwork.find(row => row.url.endsWith("/v1/device-authorizations")).body);
  } finally { worker.close(); }
}

assert.deepEqual(await authShape(new Set()), { clientType: "browser_extension" });
assert.deepEqual(await authShape(granted), { clientType: "browser_extension", browserFamily: "firefox", browserVersion: "156.0", extensionVersion: "0.2.4" });
assert.deepEqual(await authShape(new Set(), "Mozilla/5.0 Chrome/153.0.0.0"), { clientType: "browser_extension", browserFamily: "chrome", browserVersion: "153.0.0.0", extensionVersion: "0.2.4" });

{
  const grants = new Set(["technicalAndInteraction"]);
  const removalListeners = new Set();
  const permissionApi = { getAll: async () => ({ data_collection: [...grants] }), onRemoved: { addListener(listener) { removalListeners.add(listener); } } };
  let releaseExchange;
  let exchangeSignal;
  let starts = 0;
  const worker = await makeWorker(runtime, { userAgent: firefox, seedAuthority: false, firefoxPermissions: permissionApi, fetch: async (url, init) => {
    if (url.endsWith("/v1/device-authorizations")) return new Response(JSON.stringify(pending(starts++ === 0 ? "4" : "5")), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/device-authorizations/token") && !releaseExchange) { exchangeSignal = init.signal; return new Promise(resolve => { releaseExchange = () => resolve(errorResponse("DEVICE_AUTH_PENDING")); }); }
    if (url.endsWith("/v1/device-authorizations/token")) return errorResponse("DEVICE_AUTH_PENDING");
    throw new Error("unexpected request " + url);
  } });
  try {
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(() => releaseExchange, "identified authorization exchange");
    grants.clear();
    await Promise.all([...removalListeners].map(listener => listener()));
    await until(() => worker.controlNetwork.filter(row => row.url.endsWith("/v1/device-authorizations")).length === 2, "privacy-neutral authorization restart");
    assert.equal(exchangeSignal.aborted, true, "permission removal aborts a pending identified exchange");
    const starts = worker.controlNetwork.filter(row => row.url.endsWith("/v1/device-authorizations"));
    assert.deepEqual(JSON.parse(starts[0].body), { clientType: "browser_extension", browserFamily: "firefox", browserVersion: "156.0", extensionVersion: "0.2.4" });
    assert.deepEqual(JSON.parse(starts[1].body), { clientType: "browser_extension" });
    const exchanges = worker.controlNetwork.filter(row => row.url.endsWith("/v1/device-authorizations/token"));
    assert.equal(JSON.parse(exchanges[0].body).deviceCode, "4".repeat(43));
    assert.ok(exchanges.slice(1).every(row => JSON.parse(row.body).deviceCode === "5".repeat(43)), "old identified attempt is never exchanged after withdrawal");
  } finally { releaseExchange?.(); worker.close(); }
}

const store = new Set();
let signedNeutral;
const worker = await makeWorker(runtime, { userAgent: firefox, firefoxPermissions: permissions(store), fetch: async (url, init) => {
  if (url.endsWith("/v1/devices/current/client-metadata/forget")) return new Response(JSON.stringify({ status: "cleared", deviceId: "22222222-2222-4222-8222-222222222222" }), { headers: { "content-type": "application/json" } });
  if (url.endsWith("/v1/bootstrap")) return new Response(JSON.stringify(signedNeutral), { headers: { "content-type": "application/json" } });
  throw new Error("unexpected request " + url);
} });
try {
  signedNeutral = await neutralEnvelope(worker);
  const output = await worker.call("SellerAgentsControlClient.bootstrap");
  const bootstrapRequest = worker.controlNetwork.find(row => row.url.endsWith("/v1/bootstrap"));
  assert.deepEqual(JSON.parse(bootstrapRequest.body), {
    contractVersion: "control_plane_v2",
    deviceId: "22222222-2222-4222-8222-222222222222",
    lastConfigVersion: 1,
  });
  assert.equal(output.localClientAuthority.schemaVersion, "local_client_authority_v1");
  assert.equal(output.compatibility.extension.status, "SUPPORTED");
  const health = await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
  assert.equal(health, null);
  assert.equal(worker.controlNetwork.some(row => row.url.endsWith("/v1/health-authority")), false);
  await until(() => worker.controlNetwork.some(row => row.url.endsWith("/v1/devices/current/client-metadata/forget")), "metadata forget request");
  const forget = worker.controlNetwork.find(row => row.url.endsWith("/v1/devices/current/client-metadata/forget"));
  assert.equal(forget.method, "POST");
  assert.equal(forget.body, undefined);
} finally { worker.close(); }

{
  let resolvedEnvelope;
  const resolvedWorker = await makeWorker(runtime, { userAgent: firefox, firefoxPermissions: permissions(new Set()), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) return new Response(JSON.stringify({ status: "cleared", deviceId: "22222222-2222-4222-8222-222222222222" }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/bootstrap")) return new Response(JSON.stringify(resolvedEnvelope), { headers: { "content-type": "application/json" } });
    throw new Error("unexpected request " + url);
  } });
  try {
    resolvedEnvelope = await neutralResolvedEnvelope(resolvedWorker);
    const output = await resolvedWorker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    assert.equal(output.ai.status, "RESOLVED");
    assert.equal(output.ai.profile.compatibility.contractVersion, "control_plane_v2");
    const decision = await resolvedWorker.call("SellerAgentsAutonomousWorkAuthority.evaluate", autonomousInput(resolvedWorker));
    assert.equal(decision.allowed, true, JSON.stringify(decision));
    assert.equal(decision.gates.signedBootstrap, true, "materialized authority stays bound to the signed privacy-neutral payload");
  } finally { resolvedWorker.close(); }
}

{
  const grants = new Set(["technicalAndInteraction"]);
  let worker;
  worker = await makeWorker(runtime, { userAgent: firefox, firefoxPermissions: permissions(grants), fetch: async url => {
    if (url.endsWith("/v1/bootstrap")) return new Response(JSON.stringify(worker.backing.local.seller_agents_control_auth_v2.authority.envelope), { headers: { "content-type": "application/json" } });
    throw new Error("unexpected request " + url);
  } });
  try {
    await worker.call("SellerAgentsControlClient.bootstrap");
    const request = JSON.parse(worker.controlNetwork.find(row => row.url.endsWith("/v1/bootstrap")).body);
    assert.deepEqual(request, { contractVersion: "control_plane_v2", extensionVersion: "0.2.4", browser: { family: "firefox", version: "156.0" }, deviceId: "22222222-2222-4222-8222-222222222222", lastConfigVersion: 1 });
  } finally { worker.close(); }
}

{
  let malformed;
  const worker = await makeWorker(runtime, { userAgent: firefox, firefoxPermissions: permissions(new Set()), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) return new Response(JSON.stringify({ status: "cleared", deviceId: "22222222-2222-4222-8222-222222222222" }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/bootstrap")) return new Response(JSON.stringify(malformed), { headers: { "content-type": "application/json" } });
    throw new Error("unexpected request " + url);
  } });
  try {
    const original = structuredClone(worker.backing.local.seller_agents_control_auth_v2.authority.payload);
    const { compatibility, features, ai, ...common } = original;
    malformed = await signFixtureBootstrap(worker.backing, { ...common, localClientAuthority: { schemaVersion: "local_client_authority_v1", contractVersion: "control_plane_v2", compatibility: { releases: [], policies: [] }, featureRules: [] } });
    await assert.rejects(() => worker.call("SellerAgentsControlClient.bootstrap"), /BOOTSTRAP_INVALID_PAYLOAD_SCHEMA/);
    assert.equal(worker.controlNetwork.filter(row => row.url.endsWith("/v1/bootstrap")).length, 1);
    assert.equal(worker.controlNetwork.some(row => row.url.endsWith("/v1/device-authorizations")), false, "malformed signed authority never triggers identified fallback");
    const policy = n => ({ policyKey: `policy_${n}`, revision: 1, contractVersion: "control_plane_v2", browserFamily: null, minimumExtensionVersion: null, recommendedExtensionVersion: null, minimumBrowserVersion: null, maintenanceMode: false, maintenanceCode: null, blockedVersions: [] });
    const oversizedPolicies = await signFixtureBootstrap(worker.backing, { ...common, localClientAuthority: { schemaVersion: "local_client_authority_v1", contractVersion: "control_plane_v2", compatibility: { releases: [], policies: Array.from({ length: 33 }, (_, index) => policy(index)) }, featureRules: [], ai: { status: "UNCONFIGURED" } } });
    const trustBundle = await worker.call("(() => globalThis.SellerAgentsControlConfig.trustBundle)");
    const bounded = await worker.call("globalThis.SellerAgentsBootstrapVerifier.verifyV2", oversizedPolicies, trustBundle);
    assert.equal(bounded.ok, false);
    assert.equal(bounded.error, "INVALID_PAYLOAD_SCHEMA", "policy bounds fail closed before materialization");
    const unsigned = await worker.call("globalThis.SellerAgentsBootstrapVerifier.verifyV2", { ...malformed, signature: "AA" }, trustBundle);
    assert.equal(unsigned.ok, false);
    assert.equal(unsigned.error, "INVALID_SIGNATURE");
    const oversizedEnvelope = await worker.call("globalThis.SellerAgentsBootstrapVerifier.verifyV2", { envelopeVersion: "bootstrap_envelope_v2", algorithm: "Ed25519", keyId: "fixture-key", payload: "A".repeat(32769), signature: "AA" }, trustBundle);
    assert.equal(oversizedEnvelope.ok, false);
    assert.equal(oversizedEnvelope.error, "INVALID_ENVELOPE", "existing signed-envelope size limit remains enforced");
  } finally { worker.close(); }
}

{
  const backing = { local: {}, session: {} };
  let envelope;
  const offlineWorker = await makeWorker(runtime, { backing, userAgent: firefox, firefoxPermissions: permissions(new Set()), fetch: async (url) => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) throw new Error("offline");
    if (url.endsWith("/v1/bootstrap")) return new Response(JSON.stringify(envelope), { headers: { "content-type": "application/json" } });
    throw new Error("unexpected request " + url);
  } });
  try {
    envelope = await neutralEnvelope(offlineWorker);
    await offlineWorker.call("SellerAgentsControlClient.bootstrap");
    await until(() => backing.local.seller_agents_pending_metadata_clear_v1, "offline metadata-clear marker");
    assert.deepEqual(backing.local.seller_agents_pending_metadata_clear_v1, { version: "pending_client_metadata_clear_v1", deviceId: "22222222-2222-4222-8222-222222222222" });
    assert.equal(JSON.stringify(backing.local.seller_agents_pending_metadata_clear_v1).includes("firefox"), false);
    assert.equal(JSON.stringify(backing.local.seller_agents_pending_metadata_clear_v1).includes("156.0"), false);
    assert.equal(JSON.stringify(backing.local.seller_agents_pending_metadata_clear_v1).includes("0.2.4"), false);
  } finally { offlineWorker.close(); }
  backing.local.seller_agents_control_auth_v2.credentials.accessTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
  let forgetBearer = null;
  const retryWorker = await makeWorker(runtime, { backing, seedAuthority: false, userAgent: firefox, firefoxPermissions: permissions(new Set()), fetch: async (url, init) => {
    if (url.endsWith("/v1/auth/refresh")) return new Response(JSON.stringify({ tokenType: "Bearer", accessToken: "a03_metadata_forget_rotated_access_token", accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: "R".repeat(43), refreshTokenExpiresAt: new Date(Date.now() + 7200000).toISOString() }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) { forgetBearer = init.headers.get("Authorization"); return new Response(JSON.stringify({ status: "cleared", deviceId: "22222222-2222-4222-8222-222222222222" }), { headers: { "content-type": "application/json" } }); }
    throw new Error("unexpected request " + url);
  } });
  try {
    await retryWorker.call("SellerAgentsControlClient.status");
    await until(() => retryWorker.controlNetwork.some(row => row.url.endsWith("/v1/devices/current/client-metadata/forget")) && !backing.local.seller_agents_pending_metadata_clear_v1, "metadata-clear retry");
    assert.equal(retryWorker.controlNetwork.filter(row => row.url.endsWith("/v1/auth/refresh")).length, 1, "pending clear uses normal auth refresh");
    assert.equal(forgetBearer, "Bearer a03_metadata_forget_rotated_access_token");
  } finally { retryWorker.close(); }
}

console.log(JSON.stringify({ status: "PASS", cases: ["privacy_neutral_auth_exact", "identified_auth_exact", "chromium_auth_unchanged", "pending_identified_auth_restarted_after_withdrawal", "privacy_neutral_bootstrap_exact", "identified_bootstrap_shape_unchanged", "signed_local_authority_required", "privacy_neutral_autonomous_work_authority", "profile_contract_v2_local_check", "malformed_signed_authority_fails_closed", "authority_bounds_unsigned_and_oversized_fail_closed", "health_not_acquired_without_permission", "bodyless_metadata_forget", "offline_metadata_clear_marker", "metadata_clear_restart_retry", "metadata_clear_uses_auth_refresh"] }));
