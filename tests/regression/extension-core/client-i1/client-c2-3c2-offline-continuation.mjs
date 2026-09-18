import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const cases = [];
const clone = value => value == null ? value : structuredClone(value);
const digest = envelope => createHash("sha256").update(Buffer.from(envelope.payload, "base64url")).digest("hex");

async function validFixture() {
  const worker = await makeWorker(runtime, { fetch: async url => { throw new Error("unexpected network request " + url); } });
  const authority = clone(worker.backing.local[AUTH].authority);
  const clock = clone(worker.backing.local[AUTH].cacheClock);
  const payload = authority.payload;
  const origin = "https://chatgpt.com";
  const conversationId = "offline-fixture-dialogue";
  const conversationKey = `${origin}|${conversationId}`;
  const store = { accountId: payload.account.id, storeId: "store-offline-a", marketplace: "ozon", credentialRevision: "credential-a" };
  const binding = { bindingId: "binding-offline-a", revision: 2, conversationKey, origin, conversationId, provider: "chatgpt", accountId: store.accountId, storeId: store.storeId, marketplace: store.marketplace, credentialRevision: store.credentialRevision, authGeneration: authority.generation };
  const profile = payload.ai.profile;
  const receipt = {
    provenanceSchema: "seller_agents_online_admission_provenance_v1",
    mode: "ONLINE_VERIFIED",
    accountId: payload.account.id,
    accountGeneration: authority.generation,
    deviceId: authority.deviceId,
    sessionId: authority.sessionId,
    bootstrapSnapshotSha256: digest(authority.envelope),
    bootstrapConfigVersion: payload.configVersion,
    bootstrapContractVersion: payload.contractVersion,
    aiFamily: payload.ai.detected.family,
    aiSurface: payload.ai.detected.surface,
    aiVariant: payload.ai.detected.variant,
    aiProfileKey: profile.profileKey,
    aiProfileRevision: profile.revision,
    aiProfileScopeVariant: profile.scopeVariant,
    aiProfileContentSha256: profile.contentSha256,
    marketplace: store.marketplace,
    storeId: store.storeId,
    credentialRevision: store.credentialRevision,
    conversationKey,
    conversationId,
    bindingId: binding.bindingId,
    bindingRevision: binding.revision,
    workStartIntentId: "start-offline-a",
    operation: "START",
    admissionSafeTimeMs: clock.effectiveTimeMs,
    executionAuthority: false,
    bearer: false,
  };
  const work = { state: "active_visible", revision: 7, conversation_key: conversationKey, tab_id: worker.tabId, origin, ai_id: "chatgpt", conversation_id: conversationId, start_intent_id: receipt.workStartIntentId, admission_provenance: receipt };
  const input = { operation: "CONTINUE", work, receipt, cachedAuthority: authority, cacheClock: clock, safeTimeMs: clock.effectiveTimeMs, identity: { origin, conversationId }, binding: { binding_id: binding.bindingId, revision: binding.revision, origin, ai_id: "chatgpt", conversation_id: conversationId, conversation_key: conversationKey, store_context: { accountId: store.accountId, storeId: store.storeId, marketplace: store.marketplace, credentialRevision: store.credentialRevision, authGeneration: authority.generation } }, store: { accountId: store.accountId, id: store.storeId, marketplace: store.marketplace, credentialRevision: store.credentialRevision }, current: { ...store, accountId: payload.account.id, origin, generation: authority.generation, deviceId: authority.deviceId, sessionId: authority.sessionId, ...binding, bindingId: binding.bindingId, bindingRevision: binding.revision, aiFamily: payload.ai.detected.family, aiSurface: payload.ai.detected.surface, aiVariant: payload.ai.detected.variant, aiProfileKey: profile.profileKey, aiProfileRevision: profile.revision, aiProfileScopeVariant: profile.scopeVariant, aiProfileContentSha256: profile.contentSha256, workStartIntentId: receipt.workStartIntentId } };
  return { worker, input };
}

function expectDenied(input, expected) {
  return async () => {
    const result = await input.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", input.value);
    assert.equal(result.allowed, false, expected);
    assert.equal(result.executionAuthority, false, expected);
    assert.ok(result.deniedGates.length > 0, expected);
  };
}

async function run(id, fn) {
  try { await fn(); cases.push({ id, status: "PASS" }); }
  catch (error) { cases.push({ id, status: "FAIL", error: `${error.code ? error.code + ": " : ""}${error.message}` }); }
}

const fixture = await validFixture();
const base = fixture.input;
await run("OFF-01", async () => { const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", base); assert.equal(result.allowed, true); assert.equal(result.executionAuthority, false); });
await run("OFF-02", async () => { const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", { ...base, work: { ...base.work, state: "active_hidden" } }); assert.equal(result.allowed, true); });

const denied = [
  ["OFF-03", { receipt: null, work: { ...base.work, admission_provenance: null } }],
  ["OFF-04", { receipt: { ...base.receipt, mode: "CACHE" } }],
  ["OFF-05", { work: { ...base.work, state: "inactive" } }],
  ["OFF-06", { work: { ...base.work, state: "pending_identity" } }],
  ["OFF-07", { work: { ...base.work, state: "binding" } }],
  ["OFF-08", { work: { ...base.work, state: "recovering" } }],
  ["OFF-09", { work: { ...base.work, state: "finishing" } }],
  ["OFF-10", { work: { ...base.work, state: "error" } }],
  ["OFF-11", { operation: "START" }],
  ["OFF-12", { operation: "RESUME" }],
  ["OFF-13", { operation: "REBIND" }],
  ["OFF-14", { cachedAuthority: null }],
  ["OFF-15", { cachedAuthority: { ...base.cachedAuthority, payload: { ...base.cachedAuthority.payload, expiresAt: new Date(base.safeTimeMs).toISOString() } } }],
  ["OFF-16", { cachedAuthority: { ...base.cachedAuthority, envelope: { ...base.cachedAuthority.envelope, signature: "tampered" } } }],
  ["OFF-17", { safeTimeMs: null }],
  ["OFF-18", { current: { ...base.current, accountId: "other-account" } }],
  ["OFF-19", { current: { ...base.current, generation: base.current.generation + 1 } }],
  ["OFF-20", { current: { ...base.current, deviceId: "other-device" } }],
  ["OFF-21", { current: { ...base.current, sessionId: "other-session" } }],
  ["OFF-22", { current: { ...base.current, revoked: true } }],
  ["OFF-23", { receipt: { ...base.receipt, bootstrapSnapshotSha256: "f".repeat(64) } }],
  ["OFF-24", { receipt: { ...base.receipt, bootstrapConfigVersion: 999 } }],
  ["OFF-25", { receipt: { ...base.receipt, bootstrapContractVersion: "future" } }],
  ["OFF-26", { current: { ...base.current, aiFamily: "alice" } }],
  ["OFF-27", { current: { ...base.current, aiSurface: "mobile" } }],
  ["OFF-28", { receipt: { ...base.receipt, aiProfileContentSha256: "f".repeat(64) } }],
  ["OFF-29", { cachedAuthority: { ...base.cachedAuthority, payload: { ...base.cachedAuthority.payload, entitlements: { ...base.cachedAuthority.payload.entitlements, "source.ozon": false } } } }],
  ["OFF-30", { current: { ...base.current, marketplace: "amazon" } }],
  ["OFF-31", { cachedAuthority: { ...base.cachedAuthority, payload: { ...base.cachedAuthority.payload, entitlements: { ...base.cachedAuthority.payload.entitlements, "ai.chatgpt": false } } } }],
  ["OFF-32", { current: { ...base.current, aiFamily: "amazon" } }],
  ["OFF-33", { current: { ...base.current, conversationId: "other-dialogue", conversationKey: "https://chatgpt.com|other-dialogue" } }],
  ["OFF-34", { current: { ...base.current, bindingId: "other-binding" } }],
  ["OFF-35", { current: { ...base.current, bindingRevision: 3 } }],
  ["OFF-36", { current: { ...base.current, storeId: "other-store" } }],
  ["OFF-37", { current: { ...base.current, marketplace: "wildberries" } }],
  ["OFF-38", { current: { ...base.current, credentialRevision: "other-credential" } }],
  ["OFF-39", { current: { ...base.current, workStartIntentId: "other-intent" } }],
  ["OFF-40", { receipt: null }],
  ["OFF-41", { receipt: null, work: { ...base.work, state: "inactive", admission_provenance: null } }],
  ["OFF-42", { receipt: { ...base.receipt, operation: "START" } }],
  ["OFF-43", { receipt: { ...base.receipt, operation: "RESUME" }, work: { ...base.work, start_intent_id: null }, current: { ...base.current, workStartIntentId: null } }],
  ["OFF-44", { work: { ...base.work, state: "inactive" } }],
  ["OFF-45", { receipt: { ...base.receipt, storeId: base.current.storeId } }],
  ["OFF-46", { receipt: null }],
  ["OFF-47", { work: { ...base.work, state: "inactive", admission_provenance: null } }],
  ["OFF-48", { current: { ...base.current, storeDeleted: true } }],
  ["OFF-49", { current: { ...base.current, credentialRevision: "changed" } }],
  ["OFF-50", { current: { ...base.current, revoked: true } }],
  ["OFF-51", {}],
  ["OFF-52", {}],
  ["OFF-53", {}],
  ["OFF-54", {}],
  ["OFF-55", {}],
  ["OFF-56", {}],
  ["OFF-57", {}],
  ["OFF-58", { receipt: { ...base.receipt, bearer: true } }],
  ["OFF-59", { receipt: { ...base.receipt, storeId: "tampered" } }],
  ["OFF-60", { current: { ...base.current, conversationKey: "https://chatgpt.com|other-dialogue" } }],
];
const allowedCases = new Set(["OFF-42", "OFF-43", "OFF-45", "OFF-51", "OFF-52", "OFF-53", "OFF-54", "OFF-55", "OFF-56", "OFF-57"]);
for (const [id, changes] of denied) await run(id, async () => {
  const receipt = changes.receipt === undefined ? base.receipt : changes.receipt;
  const work = { ...base.work, ...(changes.work || {}) };
  if (changes.receipt !== undefined && (!changes.work?.admission_provenance || id === "OFF-43")) work.admission_provenance = receipt;
  const value = { ...base, ...changes, work, receipt, operation: changes.operation || "CONTINUE" };
  const result = await fixture.worker.call("SellerAgentsOfflineWorkAuthority.evaluate", value);
  assert.equal(result.allowed, allowedCases.has(id), id);
  assert.equal(result.executionAuthority, false, id);
});

fixture.worker.close();
const failed = cases.filter(row => row.status === "FAIL");
console.log(JSON.stringify({ status: failed.length ? "FAIL" : "PASS", scope: "C2.3-C2_OFFLINE_CONTINUATION_AUTHORITY", cases, failureBatch: failed, executionAuthority: false }, null, 2));
if (failed.length) process.exitCode = 1;
