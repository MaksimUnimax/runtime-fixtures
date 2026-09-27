import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const clone = (value) => structuredClone(value);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function trustBundle(backing) {
  const key = backing.local.__seller_agents_fixture_signing_key;
  const der = Buffer.from(key.publicKey, "base64");
  return {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "fixture-key",
        publicKey: key.publicKey,
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
}

function packagedV3(backing) {
  return {
    environment: "LOCAL DEVELOPMENT",
    controlApiOrigin: "http://127.0.0.1:43100",
    portalOrigin: "http://127.0.0.1:43101",
    extensionVersion: "0.2.4",
    contractVersion: "control_plane_v3",
    trustBundle: trustBundle(backing),
  };
}

async function signedV3(backing, payload) {
  const envelope = await signFixtureBootstrap(backing, payload);
  envelope.envelopeVersion = "bootstrap_envelope_v3";
  return envelope;
}

async function seedV3({
  wall,
  serverOffsetMs = -25 * HOUR,
  paidThroughOffsetMs = 48 * HOUR,
  accessBasis = "COMMERCIAL",
  subscriptionState = "ACTIVE",
  accessTokenOffsetMs = HOUR,
} = {}) {
  const backing = { local: {}, session: {} };
  const seed = await makeWorker(runtime, {
    backing,
    wallClock: () => wall,
    monotonicClock: () => 1000,
  });
  seed.close();

  const auth = backing.local[AUTH];
  const base = clone(auth.authority.payload);
  const serverTimeMs = wall + serverOffsetMs;
  const paid =
    accessBasis === "COMMERCIAL" &&
    ["ACTIVE", "GRACE", "CANCELED"].includes(subscriptionState);
  const paidThroughMs = wall + paidThroughOffsetMs;
  const payload = {
    ...base,
    snapshotVersion: "bootstrap_snapshot_v3",
    contractVersion: "control_plane_v3",
    configVersion: 31,
    issuedAt: new Date(serverTimeMs - 1000).toISOString(),
    serverTime: new Date(serverTimeMs).toISOString(),
    expiresAt: new Date(serverTimeMs + 15 * 60 * 1000).toISOString(),
    offlineGraceUntil: new Date(
      serverTimeMs + DAY + 15 * 60 * 1000,
    ).toISOString(),
    accessBasis,
    subscription:
      subscriptionState === "NONE"
        ? { state: "NONE", planRevision: null }
        : { state: subscriptionState, planRevision: "fixture-v3-plan" },
    subscriptionAccess: paid
      ? {
          schemaVersion: "subscription_access_v1",
          paidThrough: new Date(paidThroughMs).toISOString(),
          offlineHardUntil: new Date(paidThroughMs + 72 * HOUR).toISOString(),
        }
      : null,
  };
  const envelope = await signedV3(backing, payload);
  auth.authority = {
    ...auth.authority,
    payload,
    envelope,
    workAllowed: accessBasis !== "NONE",
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
    effectiveTimeMs: Math.max(serverTimeMs, wall),
  };
  auth.credentials = {
    ...auth.credentials,
    accessTokenExpiresAt: new Date(wall + accessTokenOffsetMs).toISOString(),
    refreshTokenExpiresAt: new Date(wall + 7 * DAY).toISOString(),
  };
  return { backing, payload, paidThroughMs };
}

function renewedPayload(current, wall, { configVersion = 32 } = {}) {
  const paidThroughMs = wall + 30 * DAY;
  return {
    ...clone(current),
    configVersion,
    issuedAt: new Date(wall - 1000).toISOString(),
    serverTime: new Date(wall).toISOString(),
    expiresAt: new Date(wall + 15 * 60 * 1000).toISOString(),
    offlineGraceUntil: new Date(wall + DAY + 15 * 60 * 1000).toISOString(),
    accessBasis: "COMMERCIAL",
    subscription: { state: "ACTIVE", planRevision: "fixture-v3-renewed" },
    subscriptionAccess: {
      schemaVersion: "subscription_access_v1",
      paidThrough: new Date(paidThroughMs).toISOString(),
      offlineHardUntil: new Date(paidThroughMs + 72 * HOUR).toISOString(),
    },
  };
}

function denyPayload(current, wall, { configVersion = 33 } = {}) {
  return {
    ...clone(current),
    configVersion,
    issuedAt: new Date(wall - 1000).toISOString(),
    serverTime: new Date(wall).toISOString(),
    expiresAt: new Date(wall + 15 * 60 * 1000).toISOString(),
    offlineGraceUntil: new Date(wall + DAY + 15 * 60 * 1000).toISOString(),
    accessBasis: "NONE",
    subscription: { state: "NONE", planRevision: null },
    subscriptionAccess: null,
    entitlements: {},
    features: {},
  };
}

// V3-RS-01: the current STORE package remains v2/dormant and creates no
// signed-access refresh task.
{
  const wall = Date.now();
  const seed = await seedV3({ wall });
  const worker = await makeWorker(runtime, {
    backing: seed.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 2000,
  });
  try {
    const plan = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    assert.equal(plan.active, false);
    assert.equal(plan.reason, "NEGOTIATION_DORMANT");
    await worker.call("SellerAgentsTechnicalScheduler.wake", "v2-dormant");
    const state = await worker.call("SellerAgentsTechnicalScheduler.state");
    assert.equal(state.entries["authority:refresh"], undefined);
    assert.equal(worker.controlNetwork.length, 0);
  } finally {
    worker.close();
  }
}

// V3-RS-02: a future compatible v3 package performs one overdue refresh,
// reuses the existing access-token refresh single-flight, and reanchors from
// the newly signed server authority.
{
  const wall = Date.now();
  const seeded = await seedV3({
    wall,
    accessTokenOffsetMs: -1000,
  });
  let refreshCalls = 0;
  let bootstrapCalls = 0;
  let bootstrapRequest = null;
  const renewed = renewedPayload(seeded.payload, wall);
  const worker = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 3000,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async (url, init = {}) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/auth/refresh") {
        refreshCalls += 1;
        return json({
          tokenType: "Bearer",
          accessToken: "v3_scheduler_rotated_access_token",
          accessTokenExpiresAt: new Date(wall + HOUR).toISOString(),
          refreshToken: "R".repeat(43),
          refreshTokenExpiresAt: new Date(wall + 7 * DAY).toISOString(),
        });
      }
      if (pathname === "/v1/bootstrap") {
        bootstrapCalls += 1;
        bootstrapRequest = JSON.parse(init.body || "{}");
        return json(await signedV3(seeded.backing, renewed));
      }
      throw new Error("unexpected control request " + pathname);
    },
  });
  try {
    const before = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    assert.equal(before.active, true);
    assert.equal(before.reason, "CADENCE");
    assert.ok(before.dueAt <= wall + 1000);

    await worker.call(
      "SellerAgentsTechnicalScheduler.wake",
      "shared-installation-wake",
    );
    assert.equal(
      bootstrapCalls,
      1,
      `one shared overdue subscription refresh is dispatched; refreshCalls=${refreshCalls}; paths=${worker.controlNetwork.map((row) => new URL(row.url).pathname).join(",")}`,
    );
    assert.equal(
      refreshCalls,
      1,
      "short-token refresh remains one single-flight",
    );
    assert.equal(bootstrapRequest.contractVersion, "control_plane_v3");

    const authority = await worker.call(
      "SellerAgentsControlClient.getAuthority",
    );
    assert.equal(authority.payload.configVersion, 32);
    assert.equal(
      authority.payload.subscriptionAccess.paidThrough,
      renewed.subscriptionAccess.paidThrough,
    );
    const after = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    assert.equal(after.active, true);
    assert.ok(after.dueAt > wall + 23 * HOUR);
    const scheduler = await worker.call("SellerAgentsTechnicalScheduler.state");
    assert.equal(
      scheduler.entries["authority:refresh"].identity.serverTime,
      renewed.serverTime,
    );
  } finally {
    worker.close();
  }
}

// V3-RS-03: exact paidThrough is a refresh trigger. Transport failure keeps
// the fixed cached paid authority usable before offlineHardUntil and reschedules
// one bounded retry; it does not turn into a cache-as-refresh success.
{
  const wall = Date.now();
  const seeded = await seedV3({
    wall,
    serverOffsetMs: -HOUR,
    paidThroughOffsetMs: 0,
  });
  let bootstrapCalls = 0;
  const worker = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 4000,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/bootstrap") {
        bootstrapCalls += 1;
        throw new TypeError("fixture bootstrap unavailable");
      }
      throw new Error("unexpected control request " + pathname);
    },
  });
  try {
    const plan = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    assert.equal(plan.active, true);
    assert.equal(plan.reason, "PAID_THROUGH");
    assert.ok(plan.dueAt <= wall + 1000);
    await worker.call("SellerAgentsTechnicalScheduler.wake", "paid-through");
    assert.equal(bootstrapCalls, 1);
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    const scheduler = await worker.call("SellerAgentsTechnicalScheduler.state");
    const task = scheduler.entries["authority:refresh"];
    assert.equal(task.attempts, 1);
    assert.ok(task.dueAt > wall + 13.5 * 60 * 1000);
    assert.ok(task.dueAt <= wall + 16.5 * 60 * 1000 + 1000);
  } finally {
    worker.close();
  }
}

// V3-RS-04: a verified current signed NONE response wins immediately,
// advances generation/server watermark and cancels future subscription refresh.
{
  const wall = Date.now();
  const seeded = await seedV3({ wall });
  const oldAllow = clone(seeded.backing.local[AUTH].authority);
  const oldGeneration = seeded.backing.local[AUTH].generation;
  const denied = denyPayload(seeded.payload, wall);
  let bootstrapCalls = 0;
  const worker = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 5000,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname !== "/v1/bootstrap")
        throw new Error("unexpected control request " + pathname);
      bootstrapCalls += 1;
      return json(await signedV3(seeded.backing, denied));
    },
  });
  try {
    await worker.call("SellerAgentsTechnicalScheduler.wake", "deny");
    assert.equal(bootstrapCalls, 1);
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false);
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.workAllowed, false);
    assert.equal(status.generation, oldGeneration + 1);
    assert.equal(
      seeded.backing.local[AUTH].cacheClock.trustedServerTimeMs,
      Date.parse(denied.serverTime),
    );
    assert.equal(
      (await worker.call("SellerAgentsTechnicalScheduler.state")).entries[
        "authority:refresh"
      ],
      undefined,
    );
  } finally {
    worker.close();
  }

  const deniedClock = seeded.backing.local[AUTH].cacheClock;
  const deniedGeneration = seeded.backing.local[AUTH].generation;
  seeded.backing.local[AUTH].authority = {
    ...oldAllow,
    generation: deniedGeneration,
  };
  seeded.backing.local[AUTH].cacheClock = deniedClock;
  const replay = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 10,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async () => {
      throw new Error("replay restore must not use network");
    },
  });
  try {
    assert.equal(await replay.call("SellerAgentsControlClient.canWork"), false);
    assert.equal(
      (await replay.call("SellerAgentsControlClient.status")).authenticated,
      false,
      "older cached allow cannot replace the newer signed deny watermark",
    );
  } finally {
    replay.close();
  }
}

// V3-RS-05: a freshly verified GRACE response whose paidThrough is already
// behind serverTime does not schedule an immediate paidThrough loop. The
// server has already answered after that trigger, so the next planned check is
// the approximately-daily cadence.
{
  const wall = 1_800_500_000_000;
  const seeded = await seedV3({
    wall,
    serverOffsetMs: 0,
    paidThroughOffsetMs: -HOUR,
    subscriptionState: "GRACE",
  });
  const worker = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 6000,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async (url) => {
      throw new Error("current GRACE plan must not request " + url);
    },
  });
  try {
    const plan = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    assert.equal(plan.active, true);
    assert.equal(plan.reason, "CADENCE");
    assert.ok(plan.dueAt >= wall + 23.5 * HOUR);
    assert.ok(plan.dueAt <= wall + 24 * HOUR + 1000);
    assert.equal(worker.controlNetwork.length, 0);
  } finally {
    worker.close();
  }
}

// V3-RS-06: a signed response that does not advance serverTime is replay/stale
// for a scheduled refresh. It cannot replace the current allow or create a new
// paid boundary.
{
  const wall = 1_800_600_000_000;
  const seeded = await seedV3({ wall });
  const stale = {
    ...clone(seeded.payload),
    configVersion: seeded.payload.configVersion + 1,
  };
  const staleEnvelope = await signedV3(seeded.backing, stale);
  const worker = await makeWorker(runtime, {
    backing: seeded.backing,
    seedAuthority: false,
    wallClock: () => wall,
    monotonicClock: () => 7000,
    packagedConfig: packagedV3(seeded.backing),
    fetch: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/bootstrap") return json(staleEnvelope);
      throw new Error("unexpected control request " + pathname);
    },
  });
  try {
    const plan = await worker.call(
      "SellerAgentsControlClient.getSubscriptionRefreshPlan",
    );
    await assert.rejects(
      worker.call(
        "SellerAgentsControlClient.runSubscriptionRefreshTask",
        plan.identity,
      ),
      /BOOTSTRAP_SERVER_TIME_NOT_ADVANCED/,
    );
    assert.equal(
      seeded.backing.local[AUTH].authority.payload.configVersion,
      seeded.payload.configVersion,
      "stale signed response did not replace current authority",
    );
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    assert.equal(
      worker.controlNetwork.filter((row) => row.url.endsWith("/v1/bootstrap"))
        .length,
      1,
    );
  } finally {
    worker.close();
  }
}

console.log(
  JSON.stringify({
    status: "PASS",
    current_v2_dormant: true,
    future_v3_daily_refresh: true,
    short_token_single_flight: true,
    renewal_reanchors: true,
    paid_through_triggers: true,
    unavailable_refresh_preserves_fixed_fallback: true,
    signed_deny_immediate: true,
    deny_advances_generation_and_watermark: true,
    older_allow_replay_after_deny_rejected: true,
    current_grace_past_paidthrough_uses_cadence: true,
    non_advancing_signed_refresh_rejected: true,
  }),
);
