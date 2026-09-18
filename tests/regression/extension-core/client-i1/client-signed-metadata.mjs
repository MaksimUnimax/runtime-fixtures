import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
const ALICE = { family: "alice", surface: "web", variant: null };
const clone = value => JSON.parse(JSON.stringify(value));
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const expectedFeatures = {
  "fixture.feature_on": true,
  "fixture.feature_off": false,
};
const expectedEntitlements = {
  "fixture.enabled": true,
  "fixture.limit": 17,
  "fixture.mode": "standard",
};

function assertProjection(result, source, freshness) {
  assert.equal(result.metadataVersion, "signed_bootstrap_metadata_v1");
  assert.equal(result.source, source);
  assert.equal(result.freshness, freshness);
  assert.equal(result.executionAuthority, false);
  assert.equal(Object.hasOwn(result, "workAllowed"), false);
  assert.equal(Object.hasOwn(result, "capabilities"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.signedFeatures)), expectedFeatures);
  assert.deepEqual(JSON.parse(JSON.stringify(result.signedEntitlements)), expectedEntitlements);
}

async function makeCachedFixture({ accountOnly = false } = {}) {
  const clock = { wall: Date.now(), mono: 1000 };
  const backing = { local: {}, session: {} };
  const seed = await makeWorker(runtime, {
    backing,
    wallClock: () => clock.wall,
    monotonicClock: () => clock.mono,
  });
  seed.close();

  const authority = backing.local[AUTH].authority;
  const payload = clone(authority.payload);
  payload.features = clone(expectedFeatures);
  payload.entitlements = clone(expectedEntitlements);
  payload.expiresAt = new Date(clock.wall - 1).toISOString();
  payload.offlineGraceUntil = new Date(clock.wall + 60 * 60_000).toISOString();
  if (accountOnly) {
    payload.ai = { status: "UNCONFIGURED" };
    authority.requestedAi = null;
    authority.workAllowed = false;
    authority.cacheBinding.detectedAi = null;
  }
  authority.payload = payload;
  authority.envelope = await signFixtureBootstrap(backing, payload);

  const worker = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    wallClock: () => clock.wall,
    monotonicClock: () => clock.mono,
    fetch: async url => {
      assert.ok(url.endsWith("/v1/bootstrap"), "metadata cache fallback only attempts bootstrap");
      throw new TypeError("fixture transport unavailable");
    },
  });
  return { worker, backing, clock };
}

// The bounded API is present on the composed source/package worker and wraps
// C2.2-A rather than introducing a second bootstrap or trust path.
{
  const worker = await makeWorker(runtime);
  try {
    const available = await worker.call("(function () { return typeof SellerAgentsControlClient.getVerifiedBootstrapMetadata === 'function'; })");
    assert.equal(available, true);
  } finally {
    worker.close();
  }
}

// Online metadata is a detached, signed projection. A remotely true feature
// remains metadata only: this layer publishes no executable capability/grant.
{
  const backing = { local: {}, session: {} };
  let onlinePayload = null;
  const worker = await makeWorker(runtime, {
    backing,
    fetch: async url => {
      assert.ok(url.endsWith("/v1/bootstrap"), "online metadata uses the existing bootstrap route");
      assert.ok(onlinePayload, "online payload prepared before bootstrap request");
      return json(await signFixtureBootstrap(backing, onlinePayload));
    },
  });
  try {
    onlinePayload = clone(backing.local[AUTH].authority.payload);
    onlinePayload.features = clone(expectedFeatures);
    onlinePayload.entitlements = clone(expectedEntitlements);
    const result = await worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata", { detectedAi: CHATGPT });
    assertProjection(result, "ONLINE", "FRESH");
    assert.equal(result.ai.status, "RESOLVED");
    assert.equal(result.ai.detected.family, "chatgpt");
    assert.match(result.ai.profile.contentSha256, /^[0-9a-f]{64}$/);
    const authority = await worker.call("SellerAgentsControlClient.getAuthority");
    assert.equal(authority.payload.features["fixture.feature_on"], true);
  } finally {
    worker.close();
  }
}

// A stale-but-grace-eligible cache may expose verified metadata and is directly
// consumable by the same installation-local Work authority.
{
  const fixture = await makeCachedFixture();
  try {
    const before = fixture.backing.local[AUTH].authority.workAllowed;
    const result = await fixture.worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata", { detectedAi: CHATGPT });
    assertProjection(result, "CACHE", "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
    assert.equal(result.ai.status, "RESOLVED");
    assert.equal(fixture.backing.local[AUTH].authority.workAllowed, before, "metadata read does not escalate persisted Work authority");
    assert.equal(await fixture.worker.call("SellerAgentsControlClient.canWork"), true, "signed offline grace remains authorizing for Work");
    assert.equal(fixture.worker.controlNetwork.filter(row => row.url.endsWith("/v1/bootstrap")).length, 1);
  } finally {
    fixture.worker.close();
  }
}

// Cached profile context remains exact. A ChatGPT snapshot cannot be borrowed
// as Alice metadata merely because transport fallback is eligible.
{
  const fixture = await makeCachedFixture();
  try {
    let failure;
    try {
      await fixture.worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata", { detectedAi: ALICE });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "AI-context mismatch must reject");
    assert.equal(failure.code, "CONTROL_TRANSPORT_UNAVAILABLE");
  } finally {
    fixture.worker.close();
  }
}

// Account-only signed configuration is representable without fabricating an AI
// profile or Work grant.
{
  const fixture = await makeCachedFixture({ accountOnly: true });
  try {
    const result = await fixture.worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata", {});
    assertProjection(result, "CACHE", "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
    assert.deepEqual(JSON.parse(JSON.stringify(result.ai)), { status: "UNCONFIGURED" });
    assert.equal(await fixture.worker.call("SellerAgentsControlClient.canWork"), false);
  } finally {
    fixture.worker.close();
  }
}

console.log(JSON.stringify({
  status: "PASS",
  cases: 5,
  scope: "SIGNED_METADATA_ONLY_NO_EXECUTION_AUTHORITY",
}));
