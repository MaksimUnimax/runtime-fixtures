import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const b64url = value => Buffer.from(value).toString("base64url");
const clone = value => structuredClone(value);

async function signHealth(backing, claim) {
  const key = await webcrypto.subtle.importKey("pkcs8", Buffer.from(backing.local.__seller_agents_fixture_signing_key.privateKey, "base64"), { name: "Ed25519" }, false, ["sign"]);
  const payload = new TextEncoder().encode(canonical(claim));
  const prefix = new TextEncoder().encode("product-control-plane/health-authority/v1\0fixture-key\0");
  const bytes = new Uint8Array(prefix.length + payload.length); bytes.set(prefix); bytes.set(payload, prefix.length);
  return { healthEnvelopeVersion: "health_envelope_v1", algorithm: "Ed25519", keyId: "fixture-key", payload: b64url(payload), signature: b64url(await webcrypto.subtle.sign("Ed25519", key, bytes)) };
}

function inputFor(worker) {
  const auth = clone(worker.backing.local[AUTH]), authority = auth.authority, payload = authority.payload, profile = payload.ai.profile;
  const origin = "https://chatgpt.com", conversationId = "b2-dialogue", conversationKey = `${origin}|${conversationId}`;
  const store = { accountId: payload.account.id, id: "b2-store", marketplace: "ozon", credentialRevision: "b2-credential" };
  const binding = { binding_id: "b2-binding", revision: 2, origin, ai_id: "chatgpt", conversation_id: conversationId, conversation_key: conversationKey, store_context: { ...store, authGeneration: authority.generation } };
  const current = { accountId: payload.account.id, expectedAccountId: payload.account.id, generation: authority.generation, expectedGeneration: authority.generation, deviceId: authority.deviceId, expectedDeviceId: authority.deviceId, sessionId: authority.sessionId, expectedSessionId: authority.sessionId, aiFamily: "chatgpt", aiSurface: "web", aiVariant: null, aiProfile: { profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 }, origin, conversationId, conversationKey, storeId: store.id, marketplace: store.marketplace, credentialRevision: store.credentialRevision, expectedCredentialRevision: store.credentialRevision, bindingId: binding.binding_id, bindingRevision: binding.revision, workStartIntentId: null, expectedWorkStartIntentId: null };
  const bootstrapHash = createHash("sha256").update(Buffer.from(authority.envelope.payload, "base64url")).digest("hex");
  const healthContext = { accountId: payload.account.id, deviceId: authority.deviceId, sessionId: authority.sessionId, contractVersion: payload.contractVersion, configVersion: payload.configVersion, bootstrapSnapshotSha256: bootstrapHash, ai: { family: "chatgpt", surface: "web", variant: null, profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 } };
  const value = { operation: "START", cachedAuthority: authority, cacheClock: auth.cacheClock, effectiveTimeMs: auth.cacheClock.effectiveTimeMs, source: "ONLINE", identity: { origin, conversationId, key: conversationKey, provider: "chatgpt" }, binding, store, current, account: { authenticated: true, accountId: payload.account.id }, session: { generation: authority.generation, deviceId: authority.deviceId, sessionId: authority.sessionId }, compatibility: { contractVersion: payload.contractVersion }, bootstrap: { accountId: payload.account.id, generation: authority.generation, deviceId: authority.deviceId, sessionId: authority.sessionId, contractVersion: payload.contractVersion, configVersion: payload.configVersion, bootstrapSnapshotSha256: bootstrapHash, aiProvider: "chatgpt" }, ai: { provider: "chatgpt", surface: "web", variant: null, profile: { provider: "chatgpt", profileKey: profile.profileKey, revision: profile.revision, scopeVariant: profile.scopeVariant, contentSha256: profile.contentSha256 } }, capabilityIntersection: { configVersion: payload.configVersion } };
  return { auth, value, healthContext };
}

const fixture = await makeWorker(runtime, { fetch: async () => { throw new Error("verified Health adapter must not fetch"); } });
try {
  const { value, healthContext } = inputFor(fixture);
  const now = Date.now();
  const good = await signHealth(fixture.backing, { healthClaimVersion: "health_claim_v1", status: "PASS", target: "WORK", context: healthContext, observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 900000).toISOString(), executionAuthority: false });
  const accepted = await fixture.call("SellerAgentsVerifiedOnlineWorkAuthority.evaluate", value, good);
  assert.equal(accepted.allowed, true, JSON.stringify(accepted));
  assert.equal(accepted.healthRequired, true);
  assert.equal(accepted.provenanceUsed, false);

  const tampered = { ...good, signature: `${good.signature.slice(0, -1)}${good.signature.endsWith("A") ? "B" : "A"}` };
  const denied = await fixture.call("SellerAgentsVerifiedOnlineWorkAuthority.evaluate", value, tampered);
  assert.equal(denied.allowed, false);
  assert.ok(denied.deniedGates.includes("DENY_HEALTH_OBSERVATION"));

  const expired = await signHealth(fixture.backing, { healthClaimVersion: "health_claim_v1", status: "PASS", target: "WORK", context: healthContext, observedAt: new Date(now - 901000).toISOString(), expiresAt: new Date(now - 1).toISOString(), executionAuthority: false });
  const expiredResult = await fixture.call("SellerAgentsVerifiedOnlineWorkAuthority.evaluate", value, expired);
  assert.equal(expiredResult.allowed, false);
  assert.ok(expiredResult.deniedGates.includes("DENY_HEALTH_OBSERVATION"));

  const source = fs.readFileSync(path.resolve("packages/control-client/src/verified-online-work-authority.js"), "utf8");
  assert.match(source, /readVerifiedHealthMetadata/);
  assert.doesNotMatch(source, /acquireSignedHealthAuthority|getVerifiedHealthMetadata/);
  assert.doesNotMatch(source, /fetch\(/);
  console.log(JSON.stringify({ status: "PASS", scope: "C2.3-C3C_VERIFIED_HEALTH_OBSERVATION_ADAPTER", cases: ["signed Health permits online observation", "tampered Health denies", "expired Health denies", "no Health acquisition"] }));
} finally { fixture.close(); }
