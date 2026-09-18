import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const clone = value => structuredClone(value);
const cases = [];

function inputFor(worker, overrides = {}) {
  const auth = clone(worker.backing.local[AUTH]);
  const authority = auth.authority;
  const payload = authority.payload;
  const profile = payload.ai.profile;
  const store = { accountId: payload.account.id, id: "c3c-store", marketplace: "ozon", credentialRevision: "credential-r1" };
  const identity = { origin: "https://chatgpt.com", conversationId: "c3c-dialogue", key: "https://chatgpt.com|c3c-dialogue", provider: "chatgpt" };
  const binding = { binding_id: "c3c-binding", revision: 2, origin: identity.origin, ai_id: "chatgpt", conversation_id: identity.conversationId, conversation_key: identity.key, store_context: { ...store, authGeneration: authority.generation } };
  const current = {
    accountId: payload.account.id, expectedAccountId: payload.account.id,
    generation: authority.generation, expectedGeneration: authority.generation,
    deviceId: authority.deviceId, expectedDeviceId: authority.deviceId,
    sessionId: authority.sessionId, expectedSessionId: authority.sessionId,
    aiFamily: "chatgpt", aiSurface: "web", aiVariant: null,
    aiProfile: { profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 },
    origin: identity.origin, conversationId: identity.conversationId, conversationKey: identity.key,
    storeId: store.id, marketplace: store.marketplace, credentialRevision: store.credentialRevision,
    expectedCredentialRevision: store.credentialRevision, bindingId: binding.binding_id, bindingRevision: binding.revision,
    workStartIntentId: null, expectedWorkStartIntentId: null,
  };
  return {
    operation: "CONTINUE", source: "CACHE", cachedAuthority: authority, cacheClock: auth.cacheClock,
    effectiveTimeMs: auth.cacheClock.effectiveTimeMs, identity, binding, store,
    work: { state: "inactive", conversation_key: identity.key, start_intent_id: null }, current,
    ...overrides,
  };
}

async function signAuthority(worker, input, changes) {
  const authority = clone(input.cachedAuthority);
  const payload = { ...clone(authority.payload), ...changes };
  authority.payload = payload;
  authority.envelope = await signFixtureBootstrap(worker.backing, payload);
  return { ...input, cachedAuthority: authority };
}

async function run(id, fn) {
  try { await fn(); cases.push({ id, status: "PASS" }); }
  catch (error) { cases.push({ id, status: "FAIL", error: `${error.code ? `${error.code}: ` : ""}${error.message}` }); }
}

const worker = await makeWorker(runtime, { fetch: async url => { throw new Error(`unexpected control request: ${url}`); } });
try {
  const base = inputFor(worker);
  await run("C3C-RED-01/C3C-GREEN-02", async () => {
    const payload = base.cachedAuthority.payload;
    const value = await signAuthority(worker, base, { expiresAt: new Date(base.effectiveTimeMs - 1).toISOString(), offlineGraceUntil: new Date(base.effectiveTimeMs + 60000).toISOString() });
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", value);
    assert.equal(result.allowed, true, JSON.stringify(result)); assert.equal(result.authorityState, "ALLOW_OFFLINE_GRACE"); assert.equal(result.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"); assert.notEqual(payload.expiresAt, value.cachedAuthority.payload.expiresAt);
  });
  await run("C3C-RED-02/C3C-GREEN-19/20", async () => {
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, cachedAuthority: { ...base.cachedAuthority, workAllowed: false }, receipt: { forged: true }, work: { state: "inactive", admission_provenance: { forged: true } } });
    assert.equal(result.allowed, true, JSON.stringify(result)); assert.equal(result.provenanceUsed, false);
    const denied = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, cachedAuthority: { ...base.cachedAuthority, workAllowed: true }, current: { ...base.current, storeId: "other" } });
    assert.equal(denied.allowed, false); assert.ok(denied.deniedGates.includes("DENY_STORE_CONTEXT"));
  });
  await run("C3C-RED-03/04/C3C-GREEN-21/22", async () => {
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, operation: "START", work: { state: "inactive" }, receipt: null, current: { ...base.current, bindingId: null, bindingRevision: null } });
    assert.equal(result.allowed, true, JSON.stringify(result));
    const continued = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, operation: "RESUME", work: { state: "active_hidden" } });
    assert.equal(continued.allowed, true);
  });
  await run("C3C-GREEN-01/27", async () => {
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, operation: "START", source: "ONLINE" });
    assert.equal(result.allowed, true, JSON.stringify(result)); assert.equal(result.authorityState, "ALLOW_FRESH");
  });
  for (const [id, time, expected] of [["C3C-GREEN-03", "offlineGraceUntil", "DENY_CACHE_EXPIRED"], ["C3C-GREEN-04", "offlineGraceUntil", "DENY_CACHE_EXPIRED"]]) await run(id, async () => {
    const grace = Date.parse(base.cachedAuthority.payload.offlineGraceUntil);
    const value = { ...base, effectiveTimeMs: id.endsWith("04") ? grace + 1 : grace };
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", value);
    assert.equal(result.allowed, false); assert.equal(result.authorityState, expected);
  });
  await run("C3C-GREEN-05", async () => {
    const value = await signAuthority(worker, base, { expiresAt: new Date(base.effectiveTimeMs - 1).toISOString(), offlineGraceUntil: new Date(base.effectiveTimeMs).toISOString() });
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", value); assert.equal(result.allowed, false); assert.ok(result.deniedGates.includes("DENY_CACHE_EXPIRED"));
  });
  for (const [id, field, expected] of [["C3C-GREEN-06", "loggedOut", "DENY_AUTH_INVALIDATED"], ["C3C-GREEN-07", "authReset", "DENY_AUTH_INVALIDATED"], ["C3C-GREEN-08", "knownRevoke", "DENY_AUTH_INVALIDATED"], ["C3C-GREEN-09", "accountId", "DENY_ACCOUNT_MISMATCH"], ["C3C-GREEN-10", "deviceId", "DENY_DEVICE_SESSION_MISMATCH"], ["C3C-GREEN-11", "generation", "DENY_DEVICE_SESSION_MISMATCH"], ["C3C-GREEN-12", "aiFamily", "DENY_AI_PROFILE_MISMATCH"], ["C3C-GREEN-16", "storeId", "DENY_STORE_CONTEXT"], ["C3C-GREEN-17", "credentialRevision", "DENY_CREDENTIAL_REVISION"], ["C3C-GREEN-18", "bindingRevision", "DENY_BINDING_CONTEXT"]]) await run(id, async () => {
    const current = { ...base.current };
    if (field === "loggedOut" || field === "authReset" || field === "knownRevoke") current[field] = true;
    else if (field === "accountId") current[field] = "other-account";
    else if (field === "deviceId") current[field] = "other-device";
    else if (field === "generation") current[field] += 1;
    else if (field === "aiFamily") current[field] = "alice";
    else if (field === "storeId") current[field] = "other-store";
    else if (field === "credentialRevision") current[field] = "changed";
    else if (field === "bindingRevision") current[field] += 1;
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, current });
    assert.equal(result.allowed, false); assert.ok(result.deniedGates.includes(expected), `${id}: ${JSON.stringify(result)}`);
  });
  for (const [id, changes] of [["C3C-GREEN-13", { "source.ozon": false }], ["C3C-GREEN-14", { "source.ozon": true, "ai.chatgpt": true }], ["C3C-GREEN-15", { "source.ozon": false, "source.wildberries": false, "ai.chatgpt": false, "ai.alice": false, unknown: true }]]) await run(id, async () => {
    const value = await signAuthority(worker, base, { entitlements: { ...base.cachedAuthority.payload.entitlements, ...changes } });
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", value); assert.equal(result.allowed, id === "C3C-GREEN-14", JSON.stringify(result));
    if (id !== "C3C-GREEN-14") assert.ok(result.deniedGates.includes("DENY_CAPABILITY"));
  });
  await run("C3C-GREEN-23/24/25/26", async () => {
    const before = { network: clone(worker.network), control: clone(worker.controlNetwork), backing: clone(worker.backing) };
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, health: { status: "STALE", current: false, verified: false } });
    assert.equal(result.allowed, true, JSON.stringify(result)); assert.deepEqual(worker.network, before.network); assert.deepEqual(worker.controlNetwork, before.control); assert.deepEqual(worker.backing, before.backing);
  });
  await run("C3C-GREEN-28/negative-bearer-inputs", async () => {
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, freshness: "FRESH", workAllowed: true, permissionMap: { "source.ozon": true }, packagedCapabilities: ["everything"], admission_provenance: { allowed: true }, healthEnvelope: { status: "PASS" }, finalAllow: true });
    assert.equal(result.allowed, true, JSON.stringify(result)); assert.equal(result.provenanceUsed, false);
  });
  await run("C3C-NEGATIVE-TAMPERED-SIGNED-BOOTSTRAP", async () => {
    const result = await worker.call("SellerAgentsAutonomousWorkAuthority.evaluate", { ...base, cachedAuthority: { ...base.cachedAuthority, envelope: { ...base.cachedAuthority.envelope, signature: "tampered" } } });
    assert.equal(result.allowed, false); assert.ok(result.deniedGates.includes("DENY_AUTH_INVALIDATED"));
  });
  await run("C3C-GREEN-28-RESTART", async () => {
    worker.close();
    const restarted = await makeWorker(runtime, { backing: worker.backing, fetch: async url => { throw new Error(`unexpected restart request: ${url}`); } });
    try {
      const result = await restarted.call("SellerAgentsAutonomousWorkAuthority.evaluate", inputFor(restarted, { cachedAuthority: { ...restarted.backing.local[AUTH].authority, workAllowed: false } }));
      assert.equal(result.allowed, true, JSON.stringify(result)); assert.equal(result.provenanceUsed, false);
    } finally { restarted.close(); }
  });
} finally { if (worker) worker.close(); }

const failed = cases.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", suite: "C3C_AUTONOMOUS_AUTHORITY", cases, failureBatch: failed }, null, 2));
if (failed.length) process.exitCode = 1;
