import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const clone = (value) => structuredClone(value);
const t0 = Date.parse("2026-09-27T00:00:00.000Z");
const expires = t0 + 15 * 60 * 1000;
const paidThrough = t0 + 60 * 60 * 1000;
const hard = paidThrough + 72 * 60 * 60 * 1000;
const legacyGrace = hard + 30 * 24 * 60 * 60 * 1000;

const worker = await makeWorker(runtime, {
  fetch: async (url) => {
    throw new Error("unexpected control request: " + url);
  },
});

function inputFor(authority, clock, effectiveTimeMs, source = "CACHE") {
  const payload = authority.payload;
  const profile = payload.ai.profile;
  const store = {
    accountId: payload.account.id,
    id: "v3-cache-store",
    marketplace: "ozon",
    credentialRevision: "v3-cache-credential-r1",
  };
  const identity = {
    origin: "https://chatgpt.com",
    conversationId: "v3-cache-dialogue",
    key: "https://chatgpt.com|v3-cache-dialogue",
    provider: "chatgpt",
  };
  const binding = {
    binding_id: "v3-cache-binding",
    revision: 1,
    origin: identity.origin,
    ai_id: "chatgpt",
    conversation_id: identity.conversationId,
    conversation_key: identity.key,
    store_context: { ...store, authGeneration: authority.generation },
  };
  return {
    operation: "CONTINUE",
    source,
    cachedAuthority: authority,
    cacheClock: clock,
    effectiveTimeMs,
    identity,
    binding,
    store,
    work: {
      state: "active",
      conversation_key: identity.key,
      start_intent_id: null,
    },
    current: {
      accountId: payload.account.id,
      expectedAccountId: payload.account.id,
      generation: authority.generation,
      expectedGeneration: authority.generation,
      deviceId: authority.deviceId,
      expectedDeviceId: authority.deviceId,
      sessionId: authority.sessionId,
      expectedSessionId: authority.sessionId,
      aiFamily: "chatgpt",
      aiSurface: "web",
      aiVariant: null,
      aiProfile: {
        profileKey: profile.profileKey,
        revision: profile.revision,
        scopeVariant: profile.scopeVariant,
        contentSha256: profile.contentSha256,
      },
      origin: identity.origin,
      conversationId: identity.conversationId,
      conversationKey: identity.key,
      storeId: store.id,
      marketplace: store.marketplace,
      credentialRevision: store.credentialRevision,
      expectedCredentialRevision: store.credentialRevision,
      bindingId: binding.binding_id,
      bindingRevision: binding.revision,
      workStartIntentId: null,
      expectedWorkStartIntentId: null,
    },
  };
}

async function makeV3(payloadChanges = {}) {
  const seeded = clone(worker.backing.local[AUTH]);
  const base = seeded.authority.payload;
  const payload = {
    ...base,
    snapshotVersion: "bootstrap_snapshot_v3",
    contractVersion: "control_plane_v3",
    issuedAt: new Date(t0).toISOString(),
    serverTime: new Date(t0).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    offlineGraceUntil: new Date(legacyGrace).toISOString(),
    accessBasis: "COMMERCIAL",
    subscription: { state: "ACTIVE", planRevision: "paid-plan-v3" },
    subscriptionAccess: {
      schemaVersion: "subscription_access_v1",
      paidThrough: new Date(paidThrough).toISOString(),
      offlineHardUntil: new Date(hard).toISOString(),
    },
    ...payloadChanges,
  };
  const envelope = await signFixtureBootstrap(worker.backing, payload);
  envelope.envelopeVersion = "bootstrap_envelope_v3";
  const authority = {
    ...seeded.authority,
    payload,
    envelope,
    cacheBinding: {
      ...seeded.authority.cacheBinding,
      contractVersion: "control_plane_v3",
    },
  };
  const clock = {
    ...seeded.cacheClock,
    owner: {
      ...seeded.cacheClock.owner,
      contractVersion: "control_plane_v3",
    },
    trustedServerTimeMs: t0,
    effectiveTimeMs: t0,
  };
  return { authority, clock };
}

async function evaluateAt(value, effectiveTimeMs, source = "CACHE") {
  const clock = {
    ...value.clock,
    effectiveTimeMs,
  };
  return worker.call(
    "SellerAgentsAutonomousWorkAuthority.evaluate",
    inputFor(value.authority, clock, effectiveTimeMs, source),
  );
}

try {
  const paid = await makeV3();
  const fresh = await evaluateAt(paid, expires - 1);
  assert.equal(fresh.allowed, true, JSON.stringify(fresh));
  assert.equal(fresh.freshness, "FRESH");

  const atPaid = await evaluateAt(paid, paidThrough);
  assert.equal(atPaid.allowed, true, JSON.stringify(atPaid));
  assert.equal(atPaid.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");

  const beforeHard = await evaluateAt(paid, hard - 1);
  assert.equal(beforeHard.allowed, true, JSON.stringify(beforeHard));
  assert.equal(beforeHard.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");

  for (const instant of [hard, hard + 1]) {
    const denied = await evaluateAt(paid, instant);
    assert.equal(denied.allowed, false, JSON.stringify(denied));
    assert.equal(denied.authorityState, "DENY_CACHE_EXPIRED");
    assert.ok(denied.deniedGates.includes("DENY_CACHE_EXPIRED"));
  }
  assert.ok(
    legacyGrace > hard,
    "fixture legacy grace must be later than the v3 hard boundary",
  );


  // Server business GRACE can outlive the fixed commercial offline window.
  // CACHE must honor hard even while this signed response is still fresh;
  // a current permitting ONLINE response retains its own short expiry.
  for (const hardInstant of [t0 + 10 * 60 * 1000, expires]) {
    const overlapping = await makeV3({
      subscription: { state: "GRACE", planRevision: "paid-plan-v3" },
      subscriptionAccess: {
        schemaVersion: "subscription_access_v1",
        paidThrough: new Date(hardInstant - 72 * 60 * 60 * 1000).toISOString(),
        offlineHardUntil: new Date(hardInstant).toISOString(),
      },
    });
    for (const instant of [hardInstant - 1, hardInstant, hardInstant + 1]) {
      const cached = await evaluateAt(overlapping, instant, "CACHE");
      assert.equal(
        cached.allowed,
        instant < hardInstant,
        JSON.stringify(cached),
      );
      if (instant >= hardInstant) {
        assert.equal(cached.freshness, "CACHE_EXPIRED");
        assert.ok(cached.deniedGates.includes("DENY_CACHE_EXPIRED"));
      }
      const current = await evaluateAt(overlapping, instant, "ONLINE");
      assert.equal(
        current.allowed,
        instant < expires,
        JSON.stringify(current),
      );
    }
  }

  const trial = await makeV3({
    subscription: { state: "TRIAL", planRevision: "trial-v3" },
    subscriptionAccess: null,
  });
  assert.equal((await evaluateAt(trial, expires - 1)).allowed, true);
  const trialExpired = await evaluateAt(trial, expires);
  assert.equal(trialExpired.allowed, false);
  assert.equal(trialExpired.authorityState, "DENY_CACHE_EXPIRED");

  const beta = await makeV3({
    accessBasis: "BETA",
    subscription: { state: "NONE", planRevision: null },
    subscriptionAccess: null,
  });
  const betaOffline = await evaluateAt(beta, expires + 1);
  assert.equal(betaOffline.allowed, true, JSON.stringify(betaOffline));
  assert.equal(betaOffline.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");

  const none = await makeV3({
    accessBasis: "NONE",
    subscription: { state: "NONE", planRevision: null },
    subscriptionAccess: null,
  });
  const noneResult = await evaluateAt(none, expires - 1);
  assert.equal(noneResult.allowed, false);
  assert.ok(noneResult.deniedGates.includes("DENY_AUTH_INVALIDATED"));

  const wrongBinding = clone(paid);
  wrongBinding.authority.cacheBinding.contractVersion = "control_plane_v2";
  const wrongBindingResult = await evaluateAt(wrongBinding, expires - 1);
  assert.equal(wrongBindingResult.allowed, false);
  assert.ok(wrongBindingResult.deniedGates.includes("DENY_AUTH_INVALIDATED"));

  const replayClock = {
    ...paid.clock,
    trustedServerTimeMs: t0 + 1,
    effectiveTimeMs: expires - 1,
  };
  const replayResult = await worker.call(
    "SellerAgentsAutonomousWorkAuthority.evaluate",
    inputFor(paid.authority, replayClock, expires - 1),
  );
  assert.equal(replayResult.allowed, false);
  assert.ok(replayResult.deniedGates.includes("DENY_AUTH_INVALIDATED"));

  const wrongAccountInput = inputFor(
    paid.authority,
    { ...paid.clock, effectiveTimeMs: expires - 1 },
    expires - 1,
  );
  wrongAccountInput.current.expectedAccountId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const wrongAccountResult = await worker.call(
    "SellerAgentsAutonomousWorkAuthority.evaluate",
    wrongAccountInput,
  );
  assert.equal(wrongAccountResult.allowed, false);
  assert.ok(wrongAccountResult.deniedGates.includes("DENY_ACCOUNT_MISMATCH"));

  const tampered = clone(paid);
  tampered.authority.envelope.signature = "tampered";
  const tamperedResult = await evaluateAt(tampered, expires - 1);
  assert.equal(tamperedResult.allowed, false);
  assert.ok(tamperedResult.deniedGates.includes("DENY_AUTH_INVALIDATED"));

  const online = await evaluateAt(paid, expires - 1, "ONLINE");
  assert.equal(online.allowed, true);
  assert.equal(online.freshness, "FRESH");

  assert.equal(worker.controlNetwork.length, 0);
  console.log(
    JSON.stringify({
      status: "PASS",
      paid_through_refresh_fallback_to_hard: true,
      hard_exact_denied: true,
      hard_before_or_equal_expiry_denied: true,
      current_online_grace_preserved: true,
      legacy_grace_does_not_extend_paid_cache: true,
      trial_has_no_offline_grace: true,
      beta_legacy_grace_preserved: true,
      none_denied: true,
      contract_binding_enforced: true,
      older_v3_replay_denied_by_trusted_watermark: true,
      expected_account_mismatch_denied: true,
      bad_signature_denied: true,
      outgoing_v3_not_exercised: true,
    }),
  );
} finally {
  worker.close();
}
