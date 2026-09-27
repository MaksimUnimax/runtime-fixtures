import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
const HOUR = 60 * 60 * 1000;
const clone = (value) => structuredClone(value);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function seedV3(
  clock,
  {
    accessBasis = "COMMERCIAL",
    subscriptionState = "ACTIVE",
    expiresOffsetMs = -1000,
    legacyGraceOffsetMs = 8 * HOUR,
    hardOffsetMs = HOUR,
  } = {},
) {
  const backing = { local: {}, session: {} };
  const seeded = await makeWorker(runtime, {
    backing,
    wallClock: () => clock.wall,
    monotonicClock: () => clock.mono,
  });
  seeded.close();

  const auth = backing.local[AUTH];
  const base = clone(auth.authority.payload);
  const serverTimeMs = clock.wall - 60_000;
  const expiresAtMs = clock.wall + expiresOffsetMs;
  const paidThroughMs = clock.wall + hardOffsetMs - 72 * HOUR;
  const paid =
    accessBasis === "COMMERCIAL" &&
    ["ACTIVE", "GRACE", "CANCELED"].includes(subscriptionState);

  const payload = {
    ...base,
    snapshotVersion: "bootstrap_snapshot_v3",
    contractVersion: "control_plane_v3",
    issuedAt: new Date(serverTimeMs - 60_000).toISOString(),
    serverTime: new Date(serverTimeMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    offlineGraceUntil: new Date(clock.wall + legacyGraceOffsetMs).toISOString(),
    accessBasis,
    subscription:
      subscriptionState === "NONE"
        ? { state: "NONE", planRevision: null }
        : { state: subscriptionState, planRevision: "fixture-plan-v3" },
    subscriptionAccess: paid
      ? {
          schemaVersion: "subscription_access_v1",
          paidThrough: new Date(paidThroughMs).toISOString(),
          offlineHardUntil: new Date(paidThroughMs + 72 * HOUR).toISOString(),
        }
      : null,
  };
  const envelope = await signFixtureBootstrap(backing, payload);
  envelope.envelopeVersion = "bootstrap_envelope_v3";

  auth.authority = {
    ...auth.authority,
    payload,
    envelope,
    workAllowed: true,
    cacheBinding: {
      ...auth.authority.cacheBinding,
      contractVersion: "control_plane_v3",
    },
  };
  auth.cacheClock = {
    ...auth.cacheClock,
    owner: {
      ...auth.cacheClock.owner,
      contractVersion: "control_plane_v3",
    },
    trustedServerTimeMs: serverTimeMs,
    effectiveTimeMs: Math.max(serverTimeMs, clock.wall),
  };
  auth.credentials = {
    ...auth.credentials,
    accessTokenExpiresAt: new Date(clock.wall + 12 * HOUR).toISOString(),
    refreshTokenExpiresAt: new Date(clock.wall + 24 * HOUR).toISOString(),
  };
  return { backing, payload, hardMs: paid ? paidThroughMs + 72 * HOUR : null };
}

async function open(backing, clock, options = {}) {
  return makeWorker(runtime, {
    backing,
    seedAuthority: false,
    wallClock: () => clock.wall,
    monotonicClock: () => clock.mono,
    fetch:
      options.fetch ||
      (async (url) => {
        throw new Error("unexpected network " + url);
      }),
  });
}

async function status(worker) {
  return worker.call("SellerAgentsControlClient.status");
}
async function canWork(worker) {
  return worker.call("SellerAgentsControlClient.canWork");
}
async function policy(worker) {
  return worker.call("SellerAgentsControlClient.bootstrapWithPolicy", {
    detectedAi: CHATGPT,
  });
}
// V3-CA-01: a verified paid v3 authority restores while stale short bootstrap
// freshness is still before the fixed commercial hard deadline. No network
// request is required merely to reconstruct the cached authority.
{
  const clock = { wall: 1_800_000_000_000, mono: 1000 };
  const { backing, hardMs } = await seedV3(clock);
  const worker = await open(backing, clock);
  try {
    const restored = await status(worker);
    assert.equal(restored.authenticated, true);
    assert.equal(restored.workAllowed, true);
    assert.equal(await canWork(worker), true);
    assert.equal(worker.controlNetwork.length, 0);
    assert.ok(clock.wall < hardMs);
    assert.equal(
      backing.local[AUTH].cacheClock.owner.contractVersion,
      "control_plane_v3",
    );
  } finally {
    worker.close();
  }
}

// V3-CA-02/03: exact hard instant and +1 ms deny even though the legacy
// offlineGraceUntil is deliberately many hours later.
for (const [label, delta] of [
  ["exact-hard", 0],
  ["hard-plus-one", 1],
]) {
  const clock = { wall: 1_800_010_000_000, mono: 1000 };
  const { backing, hardMs, payload } = await seedV3(clock, {
    legacyGraceOffsetMs: 12 * HOUR,
  });
  const jump = hardMs - clock.wall + delta;
  clock.wall += jump;
  clock.mono += jump;
  const worker = await open(backing, clock);
  try {
    const restored = await status(worker);
    assert.equal(restored.workAllowed, false, label);
    assert.equal(await canWork(worker), false, label);
    assert.ok(
      Date.parse(payload.offlineGraceUntil) > hardMs,
      label + " legacy grace is later",
    );
  } finally {
    worker.close();
  }
}

// V3-CA-04: after the hard boundary has been observed and persisted, a process
// restart plus wall-clock rollback cannot move effective time behind it.
{
  const clock = { wall: 1_800_020_000_000, mono: 1000 };
  const { backing, hardMs } = await seedV3(clock);
  let worker = await open(backing, clock);
  try {
    const beforeJump = hardMs - clock.wall - 1;
    clock.wall += beforeJump;
    clock.mono += beforeJump;
    assert.equal(await canWork(worker), true);
    clock.wall += 2;
    clock.mono += 2;
    assert.equal(await canWork(worker), false);
  } finally {
    worker.close();
  }
  const persistedFloor = backing.local[AUTH].cacheClock.effectiveTimeMs;
  assert.ok(persistedFloor >= hardMs);
  clock.wall -= 24 * HOUR;
  clock.mono = 10;
  worker = await open(backing, clock);
  try {
    assert.equal((await status(worker)).workAllowed, false);
    assert.equal(await canWork(worker), false);
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= persistedFloor);
  } finally {
    worker.close();
  }
}
// V3-CA-05: device/session, generation and contract binding remain restore
// fences for passive v3 caches.
for (const [label, mutate] of [
  [
    "device",
    (auth) => {
      auth.authority.deviceId = "44444444-4444-4444-8444-444444444444";
    },
  ],
  [
    "session",
    (auth) => {
      auth.authority.sessionId = "55555555-5555-4555-8555-555555555555";
    },
  ],
  [
    "generation",
    (auth) => {
      auth.authority.generation = auth.generation + 1;
    },
  ],
  [
    "binding-contract",
    (auth) => {
      auth.authority.cacheBinding.contractVersion = "control_plane_v2";
    },
  ],
]) {
  const clock = { wall: 1_800_030_000_000, mono: 1000 };
  const { backing } = await seedV3(clock);
  mutate(backing.local[AUTH]);
  const worker = await open(backing, clock);
  try {
    const restored = await status(worker);
    assert.equal(restored.workAllowed, false, label);
    assert.equal(restored.authenticated, false, label);
    assert.equal(worker.controlNetwork.length, 0, label);
  } finally {
    worker.close();
  }
}

// V3-CA-06: an older signed v3 allow cannot be substituted over a newer
// trusted bootstrap watermark.
{
  const clock = { wall: 1_800_040_000_000, mono: 1000 };
  const { backing, payload } = await seedV3(clock);
  const trusted = backing.local[AUTH].cacheClock.trustedServerTimeMs;
  const oldPayload = {
    ...clone(payload),
    issuedAt: new Date(trusted - 180_000).toISOString(),
    serverTime: new Date(trusted - 120_000).toISOString(),
  };
  const oldEnvelope = await signFixtureBootstrap(backing, oldPayload);
  oldEnvelope.envelopeVersion = "bootstrap_envelope_v3";
  backing.local[AUTH].authority = {
    ...backing.local[AUTH].authority,
    payload: oldPayload,
    envelope: oldEnvelope,
    workAllowed: true,
  };
  const worker = await open(backing, clock);
  try {
    const restored = await status(worker);
    assert.equal(restored.workAllowed, false);
    assert.equal(restored.authenticated, false);
    assert.equal(worker.controlNetwork.length, 0);
  } finally {
    worker.close();
  }
}
// V3-CA-07: passive v3 cache fallback verifies the cached v3 envelope while
// the actual outgoing bootstrap request remains v2.
{
  const clock = { wall: 1_800_050_000_000, mono: 1000 };
  const { backing } = await seedV3(clock);
  const requests = [];
  const worker = await open(backing, clock, {
    fetch: async (url, init) => {
      assert.ok(String(url).endsWith("/v1/bootstrap"));
      const body = JSON.parse(init.body || "{}");
      requests.push(body);
      assert.equal(body.contractVersion, "control_plane_v2");
      throw new TypeError("fixture transport unavailable");
    },
  });
  try {
    const result = await policy(worker);
    assert.equal(result.source, "CACHE");
    assert.equal(result.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
    assert.equal(result.payload.contractVersion, "control_plane_v3");
    assert.equal(requests.length, 1);
  } finally {
    worker.close();
  }
}

// V3-CA-08: the same fallback fails closed at the exact commercial hard
// instant; legacy offlineGraceUntil cannot rescue it.
{
  const clock = { wall: 1_800_060_000_000, mono: 1000 };
  const { backing, hardMs } = await seedV3(clock, {
    legacyGraceOffsetMs: 12 * HOUR,
  });
  const jump = hardMs - clock.wall;
  clock.wall += jump;
  clock.mono += jump;
  const worker = await open(backing, clock, {
    fetch: async (url, init) => {
      assert.ok(String(url).endsWith("/v1/bootstrap"));
      assert.equal(
        JSON.parse(init.body || "{}").contractVersion,
        "control_plane_v2",
      );
      throw new TypeError("fixture transport unavailable");
    },
  });
  try {
    await assert.rejects(policy(worker), /CACHE_EXPIRED/);
    assert.equal(await canWork(worker), false);
  } finally {
    worker.close();
  }
}
// V3-CA-09: BETA retains its separately defined legacy offline grace, while
// non-paid COMMERCIAL TRIAL cannot use that grace after expiresAt.
{
  const clock = { wall: 1_800_070_000_000, mono: 1000 };
  const beta = await seedV3(clock, {
    accessBasis: "BETA",
    subscriptionState: "NONE",
    expiresOffsetMs: -1000,
    legacyGraceOffsetMs: HOUR,
  });
  let worker = await open(beta.backing, clock);
  try {
    assert.equal((await status(worker)).workAllowed, true);
    assert.equal(await canWork(worker), true);
  } finally {
    worker.close();
  }

  const trial = await seedV3(clock, {
    accessBasis: "COMMERCIAL",
    subscriptionState: "TRIAL",
    expiresOffsetMs: -1000,
    legacyGraceOffsetMs: HOUR,
  });
  worker = await open(trial.backing, clock);
  try {
    assert.equal((await status(worker)).workAllowed, false);
    assert.equal(await canWork(worker), false);
  } finally {
    worker.close();
  }
}

// V3-CA-10: a signed v3 NONE authority is a deny, not an offline allow.
{
  const clock = { wall: 1_800_080_000_000, mono: 1000 };
  const denied = await seedV3(clock, {
    accessBasis: "NONE",
    subscriptionState: "NONE",
    expiresOffsetMs: HOUR,
  });
  const worker = await open(denied.backing, clock);
  try {
    assert.equal((await status(worker)).workAllowed, false);
    assert.equal(await canWork(worker), false);
  } finally {
    worker.close();
  }
}
// V3-CA-11: expected-account mismatch belongs to the Work authority boundary.
// The same signed cached v3 authority is rejected when the caller expects a
// different account.
{
  const clock = { wall: 1_800_090_000_000, mono: 1000 };
  const { backing } = await seedV3(clock, { expiresOffsetMs: HOUR });
  const worker = await open(backing, clock);
  try {
    await status(worker);
    const auth = clone(backing.local[AUTH]);
    const payload = auth.authority.payload;
    const profile = payload.ai.profile;
    const origin = "https://chatgpt.com";
    const conversationId = "v3-account-fence";
    const store = {
      accountId: payload.account.id,
      id: "ozon-store-v3",
      marketplace: "ozon",
      credentialRevision: "credential-v3",
    };
    const input = {
      operation: "START",
      source: "CACHE",
      cachedAuthority: auth.authority,
      cacheClock: auth.cacheClock,
      effectiveTimeMs: auth.cacheClock.effectiveTimeMs,
      current: {
        accountId: payload.account.id,
        expectedAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        generation: auth.generation,
        expectedGeneration: auth.generation,
        deviceId: auth.authority.deviceId,
        expectedDeviceId: auth.authority.deviceId,
        sessionId: auth.authority.sessionId,
        expectedSessionId: auth.authority.sessionId,
        aiFamily: "chatgpt",
        aiSurface: "web",
        aiVariant: null,
        aiProfile: {
          profileKey: profile.profileKey,
          revision: profile.revision,
          scopeVariant: profile.scopeVariant,
          contentSha256: profile.contentSha256,
        },
        origin,
        conversationId,
        conversationKey: origin + "|" + conversationId,
        storeId: store.id,
        marketplace: store.marketplace,
        credentialRevision: store.credentialRevision,
      },
      identity: {
        origin,
        conversationId,
        key: origin + "|" + conversationId,
        provider: "chatgpt",
      },
      store,
    };
    const decision = await worker.call(
      "SellerAgentsAutonomousWorkAuthority.evaluate",
      input,
    );
    assert.equal(decision.allowed, false);
    assert.ok(decision.deniedGates.includes("DENY_ACCOUNT_MISMATCH"));
  } finally {
    worker.close();
  }
}

console.log(
  JSON.stringify({
    status: "PASS",
    focused: "client-v3-passive-cache",
    restore_before_hard: true,
    exact_hard_denies: true,
    legacy_grace_cannot_extend_commercial: true,
    restart_wall_rollback_cannot_extend: true,
    device_session_generation_binding_fences: true,
    older_signed_v3_replay_rejected_by_trusted_watermark: true,
    fallback_uses_cached_v3_while_outgoing_stays_v2: true,
    beta_legacy_grace_preserved: true,
    trial_no_paid_offline_fallback: true,
    signed_none_denies: true,
    expected_account_mismatch_denied_at_work_authority: true,
  }),
);
