import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const baseWall = 1_700_000_000_000;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const fixtureTrustBundle = backing => { const key = backing.local.__seller_agents_fixture_signing_key; const publicKey = Buffer.from(key.publicKey, "base64"); return { trustBundleVersion: "bootstrap_trust_bundle_v1", algorithm: "Ed25519", publicKeyFormat: "spki_der", publicKeyEncoding: "base64", fingerprintAlgorithm: "sha256", fingerprintEncoding: "lowercase_hex", keys: [{ keyId: "fixture-key", publicKey: key.publicKey, fingerprintSha256: createHash("sha256").update(publicKey).digest("hex"), lifecycle: "ACTIVE", trustEligibility: "SIGNING_AND_VERIFICATION" }] }; };
const signed = async (backing, payload) => json(await signFixtureBootstrap(backing, payload));

async function fixture(options = {}) {
  const backing = options.backing || { local: {}, session: {} };
  const clock = options.clock || { wall: baseWall, mono: 1000 };
  const worker = await makeWorker(runtime, { backing, wallClock: () => clock.wall, monotonicClock: () => clock.mono, seedAuthority: options.seedAuthority, userAgent: options.userAgent, packagedConfig: options.packagedConfig, onStorageWrite: options.onStorageWrite, onStorageRemove: options.onStorageRemove, fetch: options.fetch });
  return { worker, backing, clock };
}

async function signedOutTemplate(clock) {
  const backing = { local: {}, session: {} };
  const seeded = await makeWorker(runtime, { backing, wallClock: () => clock.wall, monotonicClock: () => clock.mono });
  const payload = clone(backing.local[AUTH].authority.payload);
  seeded.close();
  delete backing.local[AUTH];
  return { backing, payload };
}

function activationResponse(clock, values = {}) {
  return { status: "pending", authorizationId: values.authorizationId || "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deviceCode: values.deviceCode || "D".repeat(43), userCode: values.userCode || "ABCD-EFGH", expiresAt: values.expiresAt || new Date(clock.wall + 60000).toISOString() };
}

function activatedResponse(clock, values = {}) {
  return { status: "activated", deviceId: values.deviceId || "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sessionId: values.sessionId || "cccccccc-cccc-4ccc-8ccc-cccccccccccc", tokenType: "Bearer", accessToken: "A".repeat(24), accessTokenExpiresAt: new Date(clock.wall + 3600000).toISOString(), refreshToken: "R".repeat(43), refreshTokenExpiresAt: new Date(clock.wall + 7200000).toISOString() };
}

async function signedBootstrap(backing, payload, clock, accountId = "11111111-1111-4111-8111-111111111111") {
  return signed(backing, { ...clone(payload), account: { id: accountId, status: "ACTIVE" }, serverTime: new Date(clock.wall).toISOString(), expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() });
}

// T1: a real pending activation is an independent signed-out restore state.
// The held exchange belongs to the old VM and is intentionally never released.
{
  const clock = { wall: baseWall, mono: 1000 }, { backing, payload } = await signedOutTemplate(clock);
  const requests = [], exchangeWait = new Promise(() => {});
  const first = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    requests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null, body: init.body || "" });
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return exchangeWait;
    throw new Error("unexpected T1 request " + url);
  } });
  const started = await first.call("SellerAgentsControlClient.startActivation");
  await until(() => backing.local[AUTH]?.pending?.phase === "pending", "T1 pending persisted");
  const savedPending = clone(backing.local[AUTH].pending), savedGeneration = backing.local[AUTH].generation;
  assert.equal(requests.filter(row => row.url.endsWith("/v1/device-authorizations")).length, 1);
  assert.equal(requests.filter(row => row.url.endsWith("/v1/device-authorizations/token")).length, 1);
  assert.equal(started.pending.authorizationId, savedPending.authorizationId);
  first.close();
  const resumedRequests = [];
  const resumed = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    resumedRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null, body: init.body || "" });
    if (url.endsWith("/v1/device-authorizations")) throw new Error("T1 allocated a new device attempt");
    if (url.endsWith("/v1/device-authorizations/token")) return json(activatedResponse(clock));
    if (url.endsWith("/v1/bootstrap")) return signedBootstrap(backing, payload, clock);
    throw new Error("unexpected T1 resume request " + url);
  } });
  try {
    await until(() => resumedRequests.some(row => row.url.endsWith("/v1/device-authorizations/token")), "T1 resumed exchange");
    await until(async () => (await resumed.call("SellerAgentsControlClient.status")).authenticated, "T1 signed bootstrap");
    assert.equal(backing.local[AUTH].generation, savedGeneration + 1);
    assert.equal(backing.local[AUTH].credentials.sessionId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(backing.local[AUTH].cacheClock.owner.sessionId, backing.local[AUTH].credentials.sessionId);
    assert.equal(backing.local[AUTH].pending, null);
    assert.equal(resumedRequests.filter(row => row.url.endsWith("/v1/device-authorizations")).length, 0);
    const exchange = resumedRequests.find(row => row.url.endsWith("/v1/device-authorizations/token"));
    assert.equal(exchange.key, savedPending.exchangeIdempotencyKey);
    assert.equal(JSON.parse(exchange.body).deviceCode, savedPending.deviceCode);
    assert.equal(backing.local[AUTH].authority.payload.account.id, "11111111-1111-4111-8111-111111111111");
  } finally { resumed.close(); }
}

// T2: a durably stored starting attempt keeps its attempt and start keys. The
// old held HTTP promise is not released after its worker VM is closed.
{
  const clock = { wall: baseWall, mono: 1000 }, { backing, payload } = await signedOutTemplate(clock);
  const firstRequests = [], oldStart = new Promise(() => {});
  const first = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    firstRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null });
    if (url.endsWith("/v1/device-authorizations")) return oldStart;
    throw new Error("unexpected T2 old request " + url);
  } });
  const oldStartCall = first.call("SellerAgentsControlClient.startActivation");
  await until(() => backing.local[AUTH]?.pending?.phase === "starting", "T2 starting persisted");
  const savedStarting = clone(backing.local[AUTH].pending);
  first.close();
  const secondRequests = [];
  const second = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    secondRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null });
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { authorizationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", deviceCode: "E".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return json(activatedResponse(clock));
    if (url.endsWith("/v1/bootstrap")) return signedBootstrap(backing, payload, clock);
    throw new Error("unexpected T2 resume request " + url);
  } });
  try {
    const resumedStart = await second.call("SellerAgentsControlClient.startActivation");
    await until(() => secondRequests.some(row => row.url.endsWith("/v1/device-authorizations/token")), "T2 exchange");
    await until(async () => (await second.call("SellerAgentsControlClient.status")).authenticated, "T2 signed bootstrap");
    const start = secondRequests.find(row => row.url.endsWith("/v1/device-authorizations"));
    assert.equal(start.key, savedStarting.startIdempotencyKey);
    assert.equal(resumedStart.pending.authorizationId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    assert.equal(secondRequests.filter(row => row.url.endsWith("/v1/device-authorizations")).length, 1);
    assert.equal(firstRequests.length, 1);
  } finally { second.close(); oldStartCall.catch(() => {}); }
}

// T3: each invalid pending/starting control is durably discarded before a
// fresh activation can emit a request. A valid same-context pending record and
// a normal signed-out restart remain positive controls.
{
  const controls = [
    ["api-origin", pending => { pending.authContext.controlApiOrigin = "http://127.0.0.1:43199"; }],
    ["portal-origin", pending => { pending.authContext.portalOrigin = "http://127.0.0.1:43199"; }],
    ["contract", pending => { pending.authContext.contractVersion = "control_plane_v3"; }],
    ["missing-context", pending => { delete pending.authContext; }],
    ["pending-shape", pending => { pending.deviceCode = "bad"; }],
    ["starting-shape", pending => { pending = { phase: "starting", attemptId: pending.attemptId, startIdempotencyKey: "bad", authContext: pending.authContext }; return pending; }],
    ["expired", pending => { pending.expiresAt = new Date(baseWall).toISOString(); }],
  ];
  for (const [label, mutate] of controls) {
    const clock = { wall: baseWall, mono: 1000 }, { backing } = await signedOutTemplate(clock);
    const source = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async url => url.endsWith("/v1/device-authorizations") ? json(activationResponse(clock), 201) : new Promise(() => {}) });
    await source.call("SellerAgentsControlClient.startActivation"); await until(() => backing.local[AUTH]?.pending?.phase === "pending", `${label} seed`); source.close();
    const original = clone(backing.local[AUTH].pending);
    let replacement = clone(original); const result = mutate(replacement); if (result) replacement = result; backing.local[AUTH].pending = replacement;
    const requests = [];
    const worker = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => { requests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null, body: init.body || "" }); return url.endsWith("/v1/device-authorizations") ? json(activationResponse(clock, { authorizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", deviceCode: "F".repeat(43) }), 201) : new Promise(() => {}); } });
    try {
      const status = await worker.call("SellerAgentsControlClient.status"); assert.equal(status.pending, null, label); assert.equal(backing.local[AUTH].pending, null, `${label} durable discard`);
      const started = await worker.call("SellerAgentsControlClient.startActivation"); assert.ok(started.pending); await until(() => requests.some(row => row.url.endsWith("/v1/device-authorizations")), `${label} fresh start`);
      assert.notEqual(requests.find(row => row.url.endsWith("/v1/device-authorizations")).key, original.startIdempotencyKey, `${label} fresh start key`);
      assert.equal(requests.some(row => String(row.body).includes(original.deviceCode)), false, `${label} old device code reuse`);
    } finally { worker.close(); }
  }
  const positiveClock = { wall: baseWall, mono: 1000 }, positive = await signedOutTemplate(positiveClock);
  const positiveRequests = [], positiveWorker = await makeWorker(runtime, { backing: positive.backing, seedAuthority: false, wallClock: () => positiveClock.wall, monotonicClock: () => positiveClock.mono, fetch: async (url, init) => { positiveRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null }); return url.endsWith("/v1/device-authorizations/token") ? new Promise(() => {}) : json(activationResponse(positiveClock), 201); } });
  try { const output = await positiveWorker.call("SellerAgentsControlClient.startActivation"); assert.ok(output.pending); await until(() => positiveWorker.portalTabs.length === 1, "same-context portal"); assert.equal(positiveWorker.controlNetwork.length, 2); } finally { positiveWorker.close(); }
  const normalClock = { wall: baseWall, mono: 1000 }, normal = await signedOutTemplate(normalClock); const normalWorker = await makeWorker(runtime, { backing: normal.backing, seedAuthority: false, wallClock: () => normalClock.wall, monotonicClock: () => normalClock.mono }); try { const status = await normalWorker.call("SellerAgentsControlClient.status"); assert.equal(status.lastError, null); assert.equal(status.pending, null); } finally { normalWorker.close(); }
}

// R3-A: an expired real pending attempt is terminally discarded in memory
// before its failed AUTH write; a successful removal protects restart and a
// later start gets fresh idempotency material without the old device code.
{
  const clock = { wall: baseWall, mono: 1000 }, { backing } = await signedOutTemplate(clock);
  const oldExchange = new Promise(() => {}), oldWorker = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { deviceCode: "D".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return oldExchange;
    throw new Error("unexpected R3-A old request " + url);
  } });
  await oldWorker.call("SellerAgentsControlClient.startActivation"); await until(() => backing.local[AUTH]?.pending?.phase === "pending", "R3-A real pending");
  const oldPending = clone(backing.local[AUTH].pending); oldWorker.close(); backing.local.r3_catalog_marker = { keep: true };
  clock.wall = Date.parse(oldPending.expiresAt); clock.mono += 1;
  let setAttempts = 0, removeAttempts = 0;
  const reopened = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, onStorageWrite: async (kind, values) => { if (kind === "local" && Object.hasOwn(values, AUTH)) { setAttempts++; throw new Error("R3-A AUTH set failure"); } }, onStorageRemove: async (kind, key) => { if (kind === "local" && key === AUTH) removeAttempts++; }, fetch: async () => { throw new Error("R3-A restore issued a request"); } });
  try {
    const status = await reopened.call("SellerAgentsControlClient.status");
    assert.equal(status.authenticated, false); assert.equal(status.pending, null); assert.equal(status.workAllowed, false); assert.equal(setAttempts, 1); assert.equal(removeAttempts, 1); assert.equal(backing.local[AUTH], undefined); assert.equal(backing.local.r3_catalog_marker.keep, true); assert.equal(reopened.network.length, 0); assert.equal(reopened.portalTabs.length, 0);
  } finally { reopened.close(); }
  clock.wall = baseWall - 1000; clock.mono += 1000;
  const freshRequests = [], fresh = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    freshRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null, body: init.body || "" });
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { authorizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", deviceCode: "F".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return new Promise(() => {});
    throw new Error("unexpected R3-A fresh request " + url);
  } });
  try {
    await fresh.call("SellerAgentsControlClient.startActivation"); const start = await until(() => freshRequests.find(row => row.url.endsWith("/v1/device-authorizations")), "R3-A fresh start");
    assert.ok(start); assert.notEqual(start.key, oldPending.startIdempotencyKey); assert.equal(freshRequests.some(row => String(row.body).includes(oldPending.deviceCode)), false); assert.equal(backing.local.r3_catalog_marker.keep, true); assert.equal(backing.local[AUTH].pending.deviceCode, "F".repeat(43));
  } finally { fresh.close(); }
}

// R3-B: invalid-origin and malformed-starting records use the same terminal
// cleanup branch. When both persistence operations fail, initialization still
// resolves denied and leaves the old disk record explicitly unprotected until
// storage recovers; the same initialized worker can then start fresh.
for (const [label, makeInvalid] of [["invalid-origin", pending => { pending.authContext.controlApiOrigin = "http://127.0.0.1:43199"; }], ["malformed-starting", pending => ({ phase: "starting", attemptId: pending.attemptId, startIdempotencyKey: "bad", authContext: pending.authContext })]]) {
  const clock = { wall: baseWall, mono: 1000 }, { backing } = await signedOutTemplate(clock);
  const source = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) return label === "malformed-starting" ? new Promise(() => {}) : json(activationResponse(clock, { deviceCode: "D".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return new Promise(() => {});
    throw new Error("unexpected R3-B seed request " + url);
  } });
  const oldStart = source.call("SellerAgentsControlClient.startActivation");
  if (label === "malformed-starting") await until(() => backing.local[AUTH]?.pending?.phase === "starting", `${label} starting`);
  else { await until(() => backing.local[AUTH]?.pending?.phase === "pending", `${label} pending`); const pending = clone(backing.local[AUTH].pending); const changed = makeInvalid(pending); backing.local[AUTH].pending = changed || pending; }
  if (label === "malformed-starting") { const pending = clone(backing.local[AUTH].pending); backing.local[AUTH].pending = makeInvalid(pending); }
  const oldPending = clone(backing.local[AUTH].pending); source.close(); oldStart.catch(() => {}); backing.local.r3_catalog_marker = { keep: true };
  let failPersistence = true, setAttempts = 0, removeAttempts = 0;
  const brokenRequests = [], freshRequests = [], broken = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, onStorageWrite: async (kind, values) => { if (failPersistence && kind === "local" && Object.hasOwn(values, AUTH)) { setAttempts++; throw new Error(`R3-B ${label} AUTH set failure`); } }, onStorageRemove: async (kind, key) => { if (failPersistence && kind === "local" && key === AUTH) { removeAttempts++; throw new Error(`R3-B ${label} AUTH remove failure`); } }, fetch: async (url, init) => { if (failPersistence) { brokenRequests.push({ url, body: init?.body || "" }); throw new Error(`R3-B ${label} restore request`); } freshRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null, body: init.body || "" }); if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { authorizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff", deviceCode: "F".repeat(43) }), 201); if (url.endsWith("/v1/device-authorizations/token")) return new Promise(() => {}); throw new Error(`R3-B ${label} unexpected fresh request`); } });
  try {
    const status = await broken.call("SellerAgentsControlClient.status"); assert.equal(status.authenticated, false, label); assert.equal(status.pending, null, label); assert.equal(status.workAllowed, false, label); assert.equal(status.lastError.code, "AUTH_DENIAL_PERSISTENCE_FAILED", label); assert.equal(setAttempts, 1, `${label} one failed denied write`); assert.equal(removeAttempts, 1, `${label} one failed removal`); assert.ok(backing.local[AUTH], `${label} no durable-protection claim`); assert.equal(brokenRequests.length, 0, `${label} no old request`);
    failPersistence = false; const started = await broken.call("SellerAgentsControlClient.startActivation");
    await until(() => freshRequests.some(row => row.url.endsWith("/v1/device-authorizations")), `${label} fresh request`);
    assert.ok(started.pending); assert.notEqual(freshRequests.find(row => row.url.endsWith("/v1/device-authorizations")).key, oldPending.startIdempotencyKey, `${label} fresh idempotency key`); assert.equal(freshRequests.some(row => String(row.body).includes(oldPending.deviceCode)), false, `${label} old device code`); assert.equal(backing.local.r3_catalog_marker.keep, true);
  } finally { broken.close(); }
}

// C2.1-R1: exact base behavior was the known regression. The candidate's
// seeded record has the new metadata; the explicit legacy branch records the
// pre-change behavior when this suite is run against the exact base runtime.
{
  const { worker, backing, clock } = await fixture();
  try {
    const authority = clone(backing.local[AUTH].authority);
    const payload = authority.payload;
    const expiry = Date.parse(payload.expiresAt);
    assert.equal((await worker.call("SellerAgentsControlClient.canWork")), true);
    clock.wall = expiry + 1; clock.mono += 10;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, "expiresAt starts signed offline grace");
    clock.wall = baseWall; clock.mono += 10;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, "wall rollback remains grace-eligible");
    assert.equal(backing.local[AUTH].authority.cacheBinding.cacheVersion, "control_cache_binding_v1");
  } finally { worker.close(); }
}

// C2.1-R2/R3/R4: half-open freshness, wall rollback resistance, monotonic
// advancement, restart floor retention, and byte-preserving signed cache.
{
  const { worker, backing, clock } = await fixture();
  try {
    const before = clone(backing.local[AUTH].authority);
    const expiry = Date.parse(before.payload.expiresAt), grace = Date.parse(before.payload.offlineGraceUntil);
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    clock.wall += 100; clock.mono += 100;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    const floorAfterMonotonic = backing.local[AUTH].cacheClock.effectiveTimeMs;
    clock.wall = baseWall - 1000; clock.mono += 1000;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs > floorAfterMonotonic);
    const envelope = before.envelope, payloadBytes = before.envelope.payload, deadline = before.payload.expiresAt;
    clock.wall = expiry; clock.mono += 1;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, "exact expiresAt remains grace-eligible");
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= expiry);
    clock.wall = grace; clock.mono += 1;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false);
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= grace);
    assert.equal(backing.local[AUTH].authority.envelope.payload, payloadBytes);
    assert.equal(backing.local[AUTH].authority.envelope.signature, envelope.signature);
    assert.equal(backing.local[AUTH].authority.payload.expiresAt, deadline);
    worker.close();
    const restarted = await makeWorker(runtime, { backing, wallClock: () => baseWall - 100000, monotonicClock: () => 1 });
    try { assert.equal(await restarted.call("SellerAgentsControlClient.canWork"), false); } finally { restarted.close(); }
  } catch (error) { worker.close(); throw error; }
}

// C2.1-R5/R6: unsafe monotonic observations fail closed; a positive floor
// cannot authorize until its durable write succeeds, then can recover without
// lowering that floor. Total storage failure is intentionally only a denial.
{
  for (const kind of ["missing", "nan", "decreasing"]) {
    const clock = { wall: baseWall, mono: 1000 };
    const backing = { local: {}, session: {} };
    const seeded = await makeWorker(runtime, { backing, wallClock: () => clock.wall, monotonicClock: () => clock.mono });
    seeded.close();
    const worker = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: kind === "missing" ? () => undefined : kind === "nan" ? () => NaN : () => { clock.mono -= 1; return clock.mono; } });
    try { assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false, kind); assert.equal((await worker.call("SellerAgentsControlClient.getAuthority")).workAllowed, false); } finally { worker.close(); }
  }
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  let release, writes = 0;
  const { worker } = await fixture({ backing, clock, onStorageWrite: async (kind, values) => { if (kind === "local" && Object.hasOwn(values, AUTH) && writes++ === 0) await new Promise(resolve => { release = resolve; }); } });
  try {
    await worker.call("SellerAgentsControlClient.canWork");
    clock.wall += 100; clock.mono += 100;
    const held = worker.call("SellerAgentsControlClient.canWork");
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(release !== undefined, true); release(); assert.equal(await held, true);
    clock.wall += 100; clock.mono += 100;
    const oldFloor = backing.local[AUTH].cacheClock.effectiveTimeMs;
    let mode = "normal";
    const failing = await fixture({ backing, clock, onStorageWrite: async (kind, values) => { if (mode === "fail" && kind === "local" && Object.hasOwn(values, AUTH)) throw new Error("write barrier"); }, onStorageRemove: async () => { throw new Error("removal barrier"); } });
    try { await failing.worker.call("SellerAgentsControlClient.canWork"); mode = "fail"; clock.wall += 100; clock.mono += 100; assert.equal(await failing.worker.call("SellerAgentsControlClient.canWork"), false); clock.wall += 100; clock.mono += 100; mode = "normal"; assert.equal(await failing.worker.call("SellerAgentsControlClient.canWork"), true); assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= oldFloor); } finally { failing.worker.close(); }
  } finally { worker.close(); }
}

// T5: a failed checkpoint with a successful removal is durably fail-closed;
// when both writes fail, only the in-memory denial is proven until a later
// successful, nondecreasing floor is persisted.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  let fail = false;
  const seeded = await fixture({ backing, clock }); seeded.worker.close();
  const denied = await fixture({ backing, clock, onStorageWrite: async (kind, values) => { if (fail && kind === "local" && Object.hasOwn(values, AUTH)) throw new Error("T5 set failure"); } });
  try {
    await denied.worker.call("SellerAgentsControlClient.canWork"); fail = true; clock.wall += 100; clock.mono += 100;
    assert.equal(await denied.worker.call("SellerAgentsControlClient.canWork"), false);
    assert.equal(backing.local[AUTH], undefined, "successful removal clears the record");
  } finally { denied.worker.close(); }
  const restartDenied = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono });
  try { assert.equal(await restartDenied.call("SellerAgentsControlClient.canWork"), false); } finally { restartDenied.close(); }

  const limitedClock = { wall: baseWall, mono: 1000 }, limitedBacking = { local: {}, session: {} }, limitedSeed = await fixture({ backing: limitedBacking, clock: limitedClock }); limitedSeed.worker.close();
  let limited = true;
  const limitedWorker = await fixture({ backing: limitedBacking, clock: limitedClock, onStorageWrite: async (kind, values) => { if (limited && kind === "local" && Object.hasOwn(values, AUTH)) throw new Error("T5 set failure"); }, onStorageRemove: async () => { if (limited) throw new Error("T5 remove failure"); } });
  const oldFloor = limitedBacking.local[AUTH].cacheClock.effectiveTimeMs;
  try {
    limitedClock.wall += 100; limitedClock.mono += 100; assert.equal(await limitedWorker.worker.call("SellerAgentsControlClient.canWork"), false);
    assert.ok(limitedBacking.local[AUTH], "failed set/remove leaves a record whose restart protection is unproven");
  } finally { limitedWorker.worker.close(); }
  limited = false; limitedClock.wall += 100; limitedClock.mono += 100;
  const recovered = await fixture({ backing: limitedBacking, clock: limitedClock });
  try { assert.equal(await recovered.worker.call("SellerAgentsControlClient.canWork"), true); assert.ok(limitedBacking.local[AUTH].cacheClock.effectiveTimeMs >= oldFloor); } finally { recovered.worker.close(); }
}

// C2.1-R7/R8: every packaged context dimension denies cached Work. Origin
// changes are checked before bootstrap so no old credential-bearing request is
// emitted; same-origin package mismatch keeps credentials for signed refresh.
{
  const dimensions = [
    ["api-origin", { controlApiOrigin: "http://127.0.0.1:43199" }, true],
    ["portal-origin", { portalOrigin: "http://127.0.0.1:43199" }, true],
    ["contract", { contractVersion: "control_plane_v3" }, false],
    ["extension", { extensionVersion: "0.2.5" }, false],
    ["browser-family", { userAgent: "Mozilla/5.0 YaBrowser/120.0.0.0" }, false],
    ["browser-version", { userAgent: "Mozilla/5.0 Chrome/121.0.0.0" }, false],
    ["trust-ring", { trustChanged: true }, false],
    ["requested-ai", { requestedChanged: true }, false],
    ["device-owner", { deviceChanged: true }, true],
    ["session-owner", { sessionChanged: true }, true],
    ["generation-owner", { generationChanged: true }, true],
  ];
  for (const [label, change, originChanged] of dimensions) {
    const seed = await fixture(); const original = clone(seed.backing.local[AUTH]); seed.worker.close();
    const trustBundle = fixtureTrustBundle(seed.backing); if (change.trustChanged) trustBundle.keys[0].fingerprintSha256 = "0".repeat(64);
    if (change.requestedChanged) seed.backing.local[AUTH].authority.requestedAi = "alice";
    if (change.deviceChanged) seed.backing.local[AUTH].credentials.deviceId = "44444444-4444-4444-8444-444444444444";
    if (change.sessionChanged) seed.backing.local[AUTH].credentials.sessionId = "55555555-5555-4555-8555-555555555555";
    if (change.generationChanged) seed.backing.local[AUTH].generation = 2;
    const network = []; const worker = await makeWorker(runtime, { backing: seed.backing, seedAuthority: false, userAgent: change.userAgent, packagedConfig: { environment: "LOCAL DEVELOPMENT", controlApiOrigin: change.controlApiOrigin || "http://127.0.0.1:43100", portalOrigin: change.portalOrigin || "http://127.0.0.1:43101", extensionVersion: change.extensionVersion || "0.2.4", contractVersion: change.contractVersion || "control_plane_v2", trustBundle }, fetch: async (url) => { network.push(url); return json({ error: { code: "UNEXPECTED" } }, 500); } });
    try { assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false, label); if (originChanged) { await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /AUTH_REQUIRED/); assert.equal(network.length, 0); } else if (!change.deviceChanged && !change.sessionChanged && !change.generationChanged) { assert.equal((await worker.call("SellerAgentsControlClient.getAuthority")), null, label); assert.ok(seed.backing.local[AUTH]?.credentials, `${label} preserves credentials`); } } finally { worker.close(); }
  }
  const positive = await fixture(); try { assert.equal(await positive.worker.call("SellerAgentsControlClient.canWork"), true); } finally { positive.worker.close(); }
}

// C2.1-R9/R10: legacy records fail closed, online replacement must be signed,
// server time cannot regress, and an old verification cannot publish after B.
{
  const seed = await fixture(); const backing = seed.backing; delete backing.local[AUTH]; seed.worker.close();
  const legacy = await makeWorker(runtime, { backing, seedAuthority: false });
  try { assert.equal((await legacy.call("SellerAgentsControlClient.status")).authenticated, false); } finally { legacy.close(); }
  const accountWorker = await fixture(); const preserved = clone(accountWorker.backing.local[AUTH]); accountWorker.backing.local.catalog_fixture = { keep: true }; accountWorker.backing.local[AUTH].authority.cacheBinding.extensionVersion = "0.2.3"; accountWorker.worker.close();
  const replacement = await makeWorker(runtime, { backing: accountWorker.backing, seedAuthority: false, wallClock: () => baseWall, monotonicClock: () => 1000, fetch: async (url, init) => url.endsWith("/v1/bootstrap") ? json({ error: { code: "NO_UNSIGNED_BOOTSTRAP" } }, 500) : json({ error: { code: "UNEXPECTED" } }, 500) });
  try { assert.equal(await replacement.call("SellerAgentsControlClient.canWork"), false); assert.equal(replacement.backing.local.catalog_fixture.keep, true); await assert.rejects(replacement.call("SellerAgentsControlClient.bootstrap"), /NO_UNSIGNED_BOOTSTRAP/); } finally { replacement.close(); }
  assert.ok(preserved.cacheClock.effectiveTimeMs >= preserved.cacheClock.trustedServerTimeMs);
}

// C2.1-R9/R12: a lower same-session server time cannot replace the cache;
// account-only authority remains authenticated but is never operational Work.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  const first = await fixture({ backing, clock, fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) return json({ error: { code: "UNEXPECTED" } }, 500);
    const base = clone(backing.local[AUTH].authority.payload);
    return json(await signFixtureBootstrap(backing, { ...base, serverTime: new Date(baseWall - 1).toISOString(), expiresAt: new Date(baseWall + 3600000).toISOString(), offlineGraceUntil: new Date(baseWall + 7200000).toISOString() }));
  } });
  try { await first.worker.call("SellerAgentsControlClient.canWork"); clock.wall += 1000; clock.mono += 1000; await first.worker.call("SellerAgentsControlClient.canWork"); await assert.rejects(first.worker.call("SellerAgentsControlClient.bootstrap"), /BOOTSTRAP_SERVER_TIME_REGRESSION/); } finally { first.worker.close(); }
  const accountOnlyBacking = { local: {}, session: {} };
  const accountOnly = await fixture({ backing: accountOnlyBacking, clock, fetch: async url => { const base = clone(accountOnlyBacking.local[AUTH].authority.payload); return json(await signFixtureBootstrap(accountOnlyBacking, { ...base, serverTime: new Date(clock.wall + 2000).toISOString(), expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString(), ai: { status: "UNCONFIGURED" } })); } });
  try { await accountOnly.worker.call("SellerAgentsControlClient.bootstrap"); const status = await accountOnly.worker.call("SellerAgentsControlClient.status"); assert.equal(status.authenticated, true); assert.equal(status.workAllowed, false); assert.equal(accountOnly.backing.local[AUTH].authority.cacheBinding.detectedAi, null); } finally { accountOnly.worker.close(); }
}

// C2.1-R10: a held A verification cannot publish after reset and completed B
// activation; B owns the resulting authority, account and cache floor.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  let releaseA, bootstraps = 0, basePayload;
  const owned = await fixture({ backing, clock, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) return json({ status: "pending", authorizationId: "66666666-6666-4666-8666-666666666666", deviceCode: "D".repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(clock.wall + 60000).toISOString() });
    if (url.endsWith("/v1/device-authorizations/token")) return json({ status: "activated", deviceId: "77777777-7777-4777-8777-777777777777", sessionId: "88888888-8888-4888-8888-888888888888", tokenType: "Bearer", accessToken: "B".repeat(24), accessTokenExpiresAt: new Date(clock.wall + 3600000).toISOString(), refreshToken: "C".repeat(43), refreshTokenExpiresAt: new Date(clock.wall + 7200000).toISOString() });
    if (url.endsWith("/v1/bootstrap")) { bootstraps++; const base = basePayload; if (bootstraps === 1) return new Promise(resolve => { releaseA = () => resolve(signed(backing, base)); }); return signed(backing, { ...base, account: { id: "99999999-9999-4999-8999-999999999999", status: "ACTIVE" }, serverTime: new Date(clock.wall + 100).toISOString(), ai: { status: "UNCONFIGURED" } }); }
    return json({ error: { code: "UNEXPECTED" } }, 500);
  } });
  basePayload = clone(backing.local[AUTH].authority.payload);
  try {
    const oldBootstrap = owned.worker.call("SellerAgentsControlClient.bootstrap"); await until(() => releaseA, "held A verification");
    const oldEnvelope = clone(backing.local[AUTH].authority.envelope);
    await owned.worker.call("SellerAgentsControlClient.localReset"); await owned.worker.call("SellerAgentsControlClient.startActivation");
    await until(async () => (await owned.worker.call("SellerAgentsControlClient.status")).authenticated, "B activation");
    const bRecord = clone(backing.local[AUTH]), bEnvelope = clone(bRecord.authority.envelope), bClock = clone(bRecord.cacheClock);
    assert.notDeepEqual(bEnvelope, oldEnvelope, "B signed envelope replaces A");
    releaseA();
    await assert.rejects(oldBootstrap, /AUTH_GENERATION_CHANGED/); assert.equal(await owned.worker.call("SellerAgentsControlClient.currentAccount"), "99999999-9999-4999-8999-999999999999"); assert.equal((await owned.worker.call("SellerAgentsControlClient.status")).workAllowed, false);
    assert.deepEqual(backing.local[AUTH].authority.envelope, bEnvelope, "old A cannot replace B envelope");
    assert.deepEqual(backing.local[AUTH].cacheClock, bClock, "old A cannot replace B clock");
  } finally { releaseA?.(); owned.worker.close(); }
}

// T6: same-session signed renewal keeps both floors, while terminal refresh
// invalidation gives a later device/session a fresh owner-scoped clock.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} }, seed = await fixture({ backing, clock });
  const original = clone(backing.local[AUTH].authority.payload), initialClock = clone(backing.local[AUTH].cacheClock); seed.worker.close();
  const replacement = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    if (url.endsWith("/v1/bootstrap")) return signedBootstrap(backing, original, clock);
    if (url.endsWith("/v1/auth/refresh")) return json({ error: { code: "AUTH_REFRESH_INVALID" } }, 401);
    throw new Error("unexpected T6 request " + url);
  } });
  let oldFloor;
  try {
    clock.wall += 100000; clock.mono += 100000; assert.equal(await replacement.call("SellerAgentsControlClient.canWork"), true); oldFloor = backing.local[AUTH].cacheClock.effectiveTimeMs;
    clock.wall += 1000; clock.mono += 1000; await replacement.call("SellerAgentsControlClient.bootstrap");
    assert.ok(backing.local[AUTH].cacheClock.trustedServerTimeMs >= initialClock.trustedServerTimeMs);
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= oldFloor);
    await assert.rejects(replacement.call("SellerAgentsControlClient.refresh", { force: true }), /AUTH_REFRESH_INVALID|AUTH_REQUIRED/);
  } finally { replacement.close(); }
  clock.wall = baseWall + 2000; clock.mono += 1000;
  const freshRequests = [], fresh = await makeWorker(runtime, { backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async (url, init) => {
    freshRequests.push({ url, key: init.headers?.get?.("Idempotency-Key") || init.headers?.["Idempotency-Key"] || null });
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { authorizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff", deviceCode: "G".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return json(activatedResponse(clock, { deviceId: "99999999-9999-4999-8999-999999999999", sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }));
    if (url.endsWith("/v1/bootstrap")) return signedBootstrap(backing, original, clock, "99999999-9999-4999-8999-999999999999");
    throw new Error("unexpected T6 fresh request " + url);
  } });
  try {
    await fresh.call("SellerAgentsControlClient.startActivation"); await until(async () => (await fresh.call("SellerAgentsControlClient.status")).authenticated, "T6 fresh session");
    assert.equal(backing.local[AUTH].cacheClock.owner.sessionId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs < oldFloor, "new session does not inherit old floor");
  } finally { fresh.close(); }
}

// R3-C/T6-queued-reset-before-B: the real checkpoint write owns the queue;
// reset and B cannot publish through its latch. After release, B completes and
// the old checkpoint is denied as stale/fail-closed, with B retaining ownership.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} }, events = [];
  let releaseCheckpoint, basePayload;
  const owned = await fixture({ backing, clock, onStorageWrite: async (kind, values) => {
    if (kind !== "local" || !Object.hasOwn(values, AUTH)) return;
    const record = values[AUTH]; events.push({ generation: record.generation, pending: record.pending?.phase || null, deviceId: record.credentials?.deviceId || null, accountId: record.authority?.payload?.account?.id || null });
    if (releaseCheckpoint === undefined && record.generation === 1 && record.cacheClock.effectiveTimeMs > baseWall) await new Promise(resolve => { releaseCheckpoint = resolve; });
  }, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) return json(activationResponse(clock, { authorizationId: "66666666-6666-4666-8666-666666666666", deviceCode: "B".repeat(43) }), 201);
    if (url.endsWith("/v1/device-authorizations/token")) return json(activatedResponse(clock, { deviceId: "77777777-7777-4777-8777-777777777777", sessionId: "88888888-8888-4888-8888-888888888888" }));
    if (url.endsWith("/v1/bootstrap")) return signedBootstrap(backing, basePayload, clock, "99999999-9999-4999-8999-999999999999");
    throw new Error("unexpected R3-C queued request " + url);
  } });
  basePayload = clone(backing.local[AUTH].authority.payload); const oldRecord = clone(backing.local[AUTH]);
  let resetSettled = false, startSettled = false;
  try {
    await owned.worker.call("SellerAgentsControlClient.canWork"); clock.wall += 100; clock.mono += 100;
    const oldCheckpoint = owned.worker.call("SellerAgentsControlClient.canWork"); await until(() => releaseCheckpoint, "R3-C held checkpoint");
    const reset = owned.worker.call("SellerAgentsControlClient.localReset").then(value => { resetSettled = true; return value; });
    const start = reset.then(() => owned.worker.call("SellerAgentsControlClient.startActivation")).then(value => { startSettled = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(resetSettled, false, "R3-C reset is queued"); assert.equal(startSettled, false, "R3-C B activation is queued"); assert.deepEqual(backing.local[AUTH], oldRecord, "R3-C held checkpoint blocks reset publication");
    releaseCheckpoint(); const oldDecision = await oldCheckpoint; await reset; await start; await until(async () => (await owned.worker.call("SellerAgentsControlClient.status")).authenticated, "R3-C B signed bootstrap");
    const bRecord = clone(backing.local[AUTH]), bAuthority = clone(bRecord.authority), bClock = clone(bRecord.cacheClock);
    assert.equal(oldDecision, false, "R3-C old checkpoint is stale after reset generation change"); assert.equal(bRecord.credentials.deviceId, "77777777-7777-4777-8777-777777777777"); assert.equal(bRecord.credentials.sessionId, "88888888-8888-4888-8888-888888888888"); assert.equal(bAuthority.payload.account.id, "99999999-9999-4999-8999-999999999999"); assert.equal(bRecord.generation, 4); assert.ok(bClock.owner.sessionId === bRecord.credentials.sessionId);
    const resetIndex = events.findIndex(row => row.generation === 2 && row.pending === null && row.deviceId === null), bStartIndex = events.findIndex(row => row.generation === 3 && row.pending === "starting"), bPendingIndex = events.findIndex(row => row.generation === 3 && row.pending === "pending"), bActivatedIndex = events.findIndex(row => row.generation === 4 && row.deviceId === bRecord.credentials.deviceId && row.accountId === null), bBootstrapIndex = events.findIndex(row => row.generation === 4 && row.accountId === bAuthority.payload.account.id);
    assert.ok(resetIndex >= 0 && bStartIndex > resetIndex && bPendingIndex > bStartIndex && bActivatedIndex > bPendingIndex && bBootstrapIndex > bActivatedIndex, `R3-C ordering ${JSON.stringify(events)}`);
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(backing.local[AUTH], bRecord, "R3-C late A work cannot alter B"); assert.equal(same(await owned.worker.call("SellerAgentsControlClient.getAuthority"), bAuthority), true, "R3-C getAuthority remains B"); assert.equal(await owned.worker.call("SellerAgentsControlClient.canWork"), true);
  } finally { releaseCheckpoint?.(); owned.worker.close(); }
}

// R3-C/T6-same-session-envelope-replacement: a differently signed envelope
// with the same device/session/requested-AI/account identity is verified and
// committed while the old checkpoint is in flight. Its decision is either
// denied as stale or recorded only before replacement; it is never reused for
// the replacement authority.
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} }, events = [];
  let releaseCheckpoint, replacementFetchStarted = false, replacementCall, oldPublicSettled = false;
  const { worker } = await fixture({ backing, clock, onStorageWrite: async (kind, values) => {
    if (kind !== "local" || !Object.hasOwn(values, AUTH)) return;
    const record = values[AUTH];
    if (releaseCheckpoint === undefined && record.generation === 1 && record.cacheClock.effectiveTimeMs > baseWall) {
      events.push("old-checkpoint");
      replacementCall = worker.call("SellerAgentsControlClient.bootstrap"); await until(() => replacementFetchStarted, "R3-C replacement request");
      await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => { releaseCheckpoint = resolve; });
    } else {
      events.push(record.authority?.payload?.configVersion === 2 ? "replacement-commit" : "other-auth-write");
    }
  }, fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) { replacementFetchStarted = true; const payload = clone(backing.local[AUTH].authority.payload); return signed(backing, { ...payload, configVersion: 2, serverTime: new Date(clock.wall + 100).toISOString(), expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() }); }
    throw new Error("unexpected R3-C replacement request " + url);
  } });
  const oldEnvelope = clone(backing.local[AUTH].authority.envelope), oldAuthority = clone(backing.local[AUTH].authority);
  try {
    await worker.call("SellerAgentsControlClient.canWork"); clock.wall += 100; clock.mono += 100;
    const oldPublic = worker.call("SellerAgentsControlClient.canWork").then(value => { oldPublicSettled = true; return value; }); await until(() => releaseCheckpoint, "R3-C replacement checkpoint"); releaseCheckpoint();
    await replacementCall; const replacementCommittedBeforeOldPublic = !oldPublicSettled; const oldDecision = await oldPublic;
    const current = await worker.call("SellerAgentsControlClient.getAuthority"), status = await worker.call("SellerAgentsControlClient.status");
    assert.ok(oldDecision === false || !replacementCommittedBeforeOldPublic, `R3-C stale decision ${oldDecision}`); assert.notDeepEqual(current.envelope, oldEnvelope, "R3-C replacement has a different signed envelope"); assert.notEqual(current.envelope.signature, undefined); assert.equal(current.payload.configVersion, 2); assert.equal(status.authenticated, true); assert.equal(status.workAllowed, true); assert.equal(current.deviceId, oldAuthority.deviceId); assert.equal(current.sessionId, oldAuthority.sessionId); assert.equal(current.payload.account.id, oldAuthority.payload.account.id); assert.equal(current.requestedAi, oldAuthority.requestedAi); assert.deepEqual(events.slice(0, 2), ["old-checkpoint", "replacement-commit"]);
  } finally { releaseCheckpoint?.(); replacementCall?.catch(() => {}); worker.close(); }
}

// T4/C2.1-R1-A: the rolling anchor rejects a decrease after a larger reading,
// while equal readings remain legal. The held-write assertion crosses exact
// exact offline grace expiry before releasing the write, so the same public call must deny.
{
  const clock = { wall: baseWall, mono: 1000 };
  const { worker, backing } = await fixture({ clock });
  try {
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    clock.mono = 2000; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    clock.mono = 1500; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false);
    clock.mono = 2000; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    clock.mono = 2000; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    const grace = Date.parse(backing.local[AUTH].authority.payload.offlineGraceUntil);
    const beforeWallJump = backing.local[AUTH].cacheClock.effectiveTimeMs;
    clock.wall += 60000; clock.mono += 100;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    const afterWallJump = backing.local[AUTH].cacheClock.effectiveTimeMs;
    clock.wall -= 60000; clock.mono += 1000;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= afterWallJump + 1000);
    assert.ok(afterWallJump >= clock.wall); assert.ok(afterWallJump > beforeWallJump);
    clock.wall = grace; clock.mono += 1;
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false);
    worker.close();
    const restarted = await makeWorker(runtime, { backing, wallClock: () => baseWall, monotonicClock: () => 1 });
    try { assert.equal(await restarted.call("SellerAgentsControlClient.canWork"), false); } finally { restarted.close(); }
  } catch (error) { worker.close(); throw error; }
}
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  let hold = false, releaseWrite, settled = false;
  const { worker } = await fixture({ backing, clock, onStorageWrite: async (kind, values) => {
    if (hold && kind === "local" && Object.hasOwn(values, AUTH) && !releaseWrite) await new Promise(resolve => { releaseWrite = resolve; });
  } });
  try {
    await worker.call("SellerAgentsControlClient.canWork"); hold = true; clock.wall += 100; clock.mono += 100;
    const pending = worker.call("SellerAgentsControlClient.canWork").then(value => { settled = true; return value; });
    await until(() => releaseWrite, "checkpoint write latch");
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    const expiry = Date.parse(backing.local[AUTH].authority.payload.expiresAt), grace = Date.parse(backing.local[AUTH].authority.payload.offlineGraceUntil);
    clock.wall = grace; clock.mono += 1;
    releaseWrite(); assert.equal(await pending, false, "same-call exact-grace veto");
    assert.ok(backing.local[AUTH].cacheClock.effectiveTimeMs >= grace);
    hold = false; releaseWrite = undefined;
    assert.equal(await worker.call("SellerAgentsControlClient.status").then(status => status.workAllowed), false, "status denial");
    assert.equal(await worker.call("SellerAgentsControlClient.getAuthority").then(authority => authority.workAllowed), false, "authority denial");
    worker.close();
    const restarted = await makeWorker(runtime, { backing: backing, seedAuthority: false, wallClock: () => baseWall - 100000, monotonicClock: () => 1 });
    try { assert.equal(await restarted.call("SellerAgentsControlClient.canWork"), false, "rolled-back restart denial"); } finally { restarted.close(); }
  } finally { releaseWrite?.(); worker.close(); }
}
{
  const clock = { wall: baseWall, mono: 1000 }, backing = { local: {}, session: {} };
  let hold = false, releaseWrite;
  const { worker } = await fixture({ backing, clock, onStorageWrite: async (kind, values) => {
    if (hold && kind === "local" && Object.hasOwn(values, AUTH) && !releaseWrite) await new Promise(resolve => { releaseWrite = resolve; });
  } });
  try {
    await worker.call("SellerAgentsControlClient.canWork"); hold = true; clock.wall += 100; clock.mono += 100;
    const pending = worker.call("SellerAgentsControlClient.canWork"); await until(() => releaseWrite, "fresh checkpoint write latch");
    assert.equal(await Promise.race([pending.then(() => "settled"), new Promise(resolve => setImmediate(() => resolve("held")))]), "held");
    releaseWrite(); assert.equal(await pending, true, "still-fresh held-write control");
  } finally { releaseWrite?.(); worker.close(); }
}

// C2.1-R1-B/D provenance and ownership: an actual origin replacement clears
// transport ownership before any secret-bearing route; a same-origin package
// replacement keeps only the valid session clock and obtains a fresh signed
// authority online.
{
  const seed = await fixture(); const saved = clone(seed.backing.local[AUTH]); seed.backing.local.catalog_fixture = { keep: true }; seed.worker.close();
  const network = [];
  const changed = await makeWorker(runtime, { backing: seed.backing, seedAuthority: false, packagedConfig: { environment: "LOCAL DEVELOPMENT", controlApiOrigin: "http://127.0.0.1:43199", portalOrigin: "http://127.0.0.1:43101", extensionVersion: "0.2.4", contractVersion: "control_plane_v2", trustBundle: fixtureTrustBundle(seed.backing) }, fetch: async (url, init) => { network.push({ url, body: init?.body || "" }); return url.endsWith("/v1/device-authorizations") ? json({ status: "pending", authorizationId: "66666666-6666-4666-8666-666666666666", deviceCode: "N".repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(baseWall + 60000).toISOString() }) : json({ error: { code: "MUST_NOT_USE_OLD_SECRET" } }, 500); } });
  try {
    assert.equal((await changed.call("SellerAgentsControlClient.status")).authenticated, false);
    await assert.rejects(changed.call("SellerAgentsControlClient.bootstrap"), /AUTH_REQUIRED/);
    await assert.rejects(changed.call("SellerAgentsControlClient.refresh", { force: true }), /AUTH_REQUIRED/);
    await changed.call("SellerAgentsControlClient.startActivation");
    assert.equal(network[0].url.endsWith("/v1/device-authorizations"), true);
    assert.equal(network.every(row => !row.body.includes(saved.credentials.accessToken) && !row.body.includes(saved.credentials.refreshToken)), true);
  } finally { changed.close(); }
  const sameOriginBacking = { local: {}, session: {} }, sameSeed = await fixture({ backing: sameOriginBacking });
  const raisedFloor = sameOriginBacking.local[AUTH].cacheClock.effectiveTimeMs + 5000; sameOriginBacking.local[AUTH].cacheClock.effectiveTimeMs = raisedFloor; sameSeed.worker.close();
  const replacementPayload = clone(sameOriginBacking.local[AUTH].authority.payload); const replacement = await makeWorker(runtime, { backing: sameOriginBacking, seedAuthority: false, wallClock: () => baseWall, monotonicClock: () => 1000, packagedConfig: { environment: "LOCAL DEVELOPMENT", controlApiOrigin: "http://127.0.0.1:43100", portalOrigin: "http://127.0.0.1:43101", extensionVersion: "0.2.5", contractVersion: "control_plane_v2", trustBundle: fixtureTrustBundle(sameOriginBacking) }, fetch: async url => url.endsWith("/v1/bootstrap") ? signed(sameOriginBacking, { ...replacementPayload, serverTime: new Date(baseWall).toISOString(), expiresAt: new Date(baseWall + 3600000).toISOString(), offlineGraceUntil: new Date(baseWall + 7200000).toISOString() }) : json({ error: { code: "UNEXPECTED" } }, 500) });
  try { assert.equal((await replacement.call("SellerAgentsControlClient.status")).authenticated, false); assert.ok(replacement.backing.local[AUTH].credentials); assert.ok(replacement.backing.local[AUTH].cacheClock.effectiveTimeMs >= raisedFloor); await replacement.call("SellerAgentsControlClient.bootstrap"); assert.equal((await replacement.call("SellerAgentsControlClient.status")).authenticated, true); } finally { replacement.close(); }
}

// C2.1-R1-C: a real credential-bearing legacy record cannot be resumed when
// its clock/binding metadata is absent, and pending attempts are bound before
// their first request and again when the server response is stored.
{
  const seed = await fixture(); const backing = seed.backing; const saved = clone(backing.local[AUTH]); delete backing.local[AUTH].cacheClock; delete backing.local[AUTH].authority.cacheBinding; backing.local.catalog_fixture = { keep: true }; seed.worker.close();
  const worker = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async () => json({ error: { code: "NO_LEGACY_RESUME" } }, 500) });
  try { assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, false); assert.equal(backing.local.catalog_fixture.keep, true); assert.equal(backing.local[AUTH].credentials, null); } finally { worker.close(); }
  const pendingBacking = { local: {}, session: {} }, pendingSeed = await fixture({ backing: pendingBacking }); pendingSeed.worker.close(); pendingBacking.local[AUTH].credentials = null; pendingBacking.local[AUTH].authority = null; pendingBacking.local[AUTH].cacheClock = null;
  pendingBacking.local[AUTH].pending = { phase: "pending", attemptId: "legacy-attempt", authorizationId: "66666666-6666-4666-8666-666666666666", deviceCode: "D".repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(baseWall + 60000).toISOString(), startIdempotencyKey: "S".repeat(16), exchangeIdempotencyKey: "E".repeat(16) };
  const pendingNetwork = []; const pendingWorker = await makeWorker(runtime, { backing: pendingBacking, seedAuthority: false, fetch: async (url, init) => { pendingNetwork.push({ url, body: init?.body || "" }); return url.endsWith("/v1/device-authorizations") ? json({ status: "pending", authorizationId: "77777777-7777-4777-8777-777777777777", deviceCode: "N".repeat(43), userCode: "JKLM-NPQR", expiresAt: new Date(baseWall + 60000).toISOString() }) : json({ error: { code: "NO_LEGACY_PENDING" } }, 500); } });
  try { assert.equal((await pendingWorker.call("SellerAgentsControlClient.status")).pending, null); await pendingWorker.call("SellerAgentsControlClient.startActivation"); await until(() => pendingNetwork.some(row => row.url.endsWith("/v1/device-authorizations")), "new activation after legacy pending"); assert.equal(pendingNetwork.some(row => String(row.body).includes("D".repeat(43))), false); } finally { pendingWorker.close(); }
}

// T7: composed Work uses the real store/start/identity/provider path. Fresh
// text and binary controls succeed, then exact signed expiry denies every
// captured real owner/delivery/artifact operation without replay.
function t7FakeIDB() {
  const records = new Map(), stats = { reads: 0, writes: 0 };
  return { records, stats, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
        const tx = { objectStore() {
          const op = (kind, value) => { const result = {}; queueMicrotask(() => { if (kind === "get" || kind === "all") stats.reads++; if (kind === "put") { stats.writes++; records.set(value.artifact_key, value); } if (kind === "delete") { stats.writes++; records.delete(value); } result.result = kind === "get" ? records.get(value) : kind === "all" ? [...records.values()] : value?.artifact_key; result.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); }); return result; };
          return { get: key => op("get", key), put: value => op("put", value), delete: key => op("delete", key), getAll: () => op("all") };
        } }; return tx;
      } };
      request.onsuccess?.();
    }); return request;
  } };
}
const t7IdentitySender = worker => ({ tab: { id: worker.tabId }, url: worker.identity.origin + "/c/" + worker.identity.conversation_id });
const t7PopupSender = { url: "chrome-extension://core-fixture/popup.html" };
const t7Stores = {
  ozon: { marketplace: "ozon", credentials: { seller: { clientId: "FIXTURE_R5_OZON_CLIENT", apiKey: "FIXTURE_R5_OZON_KEY" } }, personalDataEnabled: true },
  wildberries: { marketplace: "wildberries", credentials: { token: "FIXTURE_R5_WB_TOKEN" }, personalDataEnabled: true },
};
async function t7StartStore(worker, store) {
  const saved = await worker.popup({ type: "SA_STORE_SAVE", store }); assert.equal(saved.ok, true, JSON.stringify(saved));
  const started = await worker.popup({ type: "SA_WORK_START", store_id: saved.store.id, tab_id: worker.tabId, confirm_change: true }); assert.equal(started.ok, true, JSON.stringify(started));
  const pending = await until(async () => { const row = (await worker.call("getPendingWorkStarts"))[worker.tabId]; if (row?.send_outcome === "failed") throw new Error("T7 start failed " + JSON.stringify(row)); return row?.send_outcome === "sent_acknowledged" ? row : null; }, "T7 start acknowledgement");
  const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: worker.identity, first_response_complete: true }); assert.equal(active.ok, true, JSON.stringify(active));
  return { store: saved.store, key: active.binding.conversation_key, session: active.session };
}
async function t7Collect(worker, started, command, requestId) {
  const admitted = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: started.key, command_text: command, manual_request_id: requestId, work_session_id: started.session.start_intent_id }, t7IdentitySender(worker)); assert.equal(admitted.accepted, true, JSON.stringify(admitted));
  return until(async () => { const owner = await worker.call("getManualOperation", started.key); if (owner?.status === "failed") throw new Error(JSON.stringify(owner.last_error)); return owner?.status === "delivering" && owner; }, "T7 delivering owner");
}
async function t7BinaryCommand(worker) {
  const contract = await worker.call("(() => SellerAgentsWBReference.contract)");
  const meta = Object.values(contract.OPERATIONS).find(item => item.response_mode === "binary" && item.execution_enabled && item.privacy === "standard"); assert.ok(meta);
  return "WB_API_V1 " + JSON.stringify({ operation: meta.alias, params: { path: Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], "fixture"])), query: Object.fromEntries(meta.required_query_keys.map(key => [key, "1"])), ...(meta.body_required ? { body: {} } : {}) } });
}
for (const marketplace of ["ozon", "wildberries"]) {
  const clock = { wall: Date.now(), mono: 1000 }, bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 10, 0, 255]), idb = t7FakeIDB();
  let expired = false, providerCalls = 0, controlRequests = 0, cleanupResolve;
  const cleanupAttempt = new Promise(resolve => { cleanupResolve = resolve; }), cleanupAttempts = [];
  const worker = await makeWorker(runtime, { indexedDB: marketplace === "wildberries" ? idb : undefined, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async url => {
    if (url.startsWith("https://")) { providerCalls++; return marketplace === "wildberries" ? new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="t7.pdf"' } }) : json({ result: [] }); }
    controlRequests++; return json({ ok: true });
  }, onStorageWrite: async (kind, values) => {
    if (expired && kind === "local" && Object.keys(values).some(key => /work|binding|manual/i.test(key))) { cleanupAttempts.push(Object.keys(values)); cleanupResolve(); throw new Error("T7 cleanup write rejection"); }
  } });
  try {
    worker.setDialogue("11111111-1111-4111-8111-111111111111");
    const started = await t7StartStore(worker, t7Stores[marketplace]);
    const owner = await t7Collect(worker, started, marketplace === "ozon" ? 'OZON_API_V1 {"operation":"seller_info","params":{}}' : await t7BinaryCommand(worker), `t7-${marketplace}`);
    assert.equal(providerCalls, 1); assert.equal(owner.status, "delivering"); assert.ok(owner.delivery?.delivery_id);
    const fields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: started.key, delivery_id: owner.delivery.delivery_id, actor_id: `t7-${marketplace}` };
    let artifactKey = null, originalBytes = null;
    if (marketplace === "ozon") {
      assert.equal(owner.delivery.mode, "batch_watch_v1");
      assert.equal((await worker.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields }, t7IdentitySender(worker))).insert_allowed, true);
      assert.equal((await worker.request({ type: "OZ_BATCH_DELIVERY_INSERTED", ...fields }, t7IdentitySender(worker))).inserted, true);
    } else {
      const commit = await worker.portRequest({ type: "OZ_ATTACHMENT_COMMIT", ...fields, live_owner: worker.identity }); assert.equal(commit.attach_allowed, true);
      const meta = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_META", ...fields, live_owner: worker.identity }); assert.equal(meta.ok, true);
      const descriptor = meta.descriptors.find(item => item.source_kind === "original_provider_file"); assert.ok(descriptor); artifactKey = descriptor.artifact_key;
      const chunk = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_CHUNK", ...fields, live_owner: worker.identity, artifact_key: artifactKey, offset: 0, length: bytes.length }); originalBytes = Buffer.from(chunk.chunk_base64, "base64"); assert.deepEqual(originalBytes, Buffer.from(bytes));
    }
    const advertisements = worker.messages.filter(message => message.type === "OZ_BATCH_DELIVERY_AVAILABLE").length, controlsBeforeExpiry = controlRequests;
    const grace = Date.parse(worker.backing.local[AUTH].authority.payload.offlineGraceUntil); clock.wall = grace; clock.mono += 1; expired = true;
    const deniedInsert = await worker.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields }, t7IdentitySender(worker)); assert.notEqual(deniedInsert.insert_allowed, true);
    await until(() => cleanupAttempts.length > 0, "T7 explicit cleanup-attempt latch"); await cleanupAttempt;
    const deniedCommand = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: started.key, command_text: marketplace === "ozon" ? 'OZON_API_V1 {"operation":"seller_info","params":{}}' : await t7BinaryCommand(worker), manual_request_id: `t7-expired-${marketplace}`, work_session_id: started.session.start_intent_id }, t7IdentitySender(worker));
    assert.notEqual(deniedCommand.accepted, true, "T7 fresh expired command denied");
    const readsBefore = idb.stats.reads;
    assert.notEqual((await worker.request({ type: "OZ_WORK_DELIVERY_ASSERT", ...fields }, t7IdentitySender(worker))).ok, true);
    assert.notEqual((await worker.request({ type: "OZ_WORK_SEND_COMMIT", ...fields }, t7IdentitySender(worker))).click_allowed, true);
    if (marketplace === "wildberries") {
      for (const type of ["OZ_ATTACHMENT_RECOVERY_GET", "OZ_ATTACHMENT_COMMIT", "OZ_ATTACHMENT_ARTIFACT_META", "OZ_ATTACHMENT_ARTIFACT_CHUNK", "OZ_ATTACHMENT_SEND_COMMIT"]) {
        const result = await worker.portRequest({ type, ...fields, live_owner: worker.identity, artifact_key: artifactKey, offset: 0, length: bytes.length });
        assert.equal(result.recovery, undefined); assert.equal(result.descriptors, undefined); assert.equal(result.chunk_base64, undefined); assert.notEqual(result.attach_allowed, true); assert.notEqual(result.send_allowed, true);
      }
      assert.deepEqual(originalBytes, Buffer.from(bytes));
    }
    assert.equal(idb.stats.reads, readsBefore, "T7 guard precedes artifact reads");
    for (const type of ["OZ_CONTENT_READY", "OZ_CONTENT_SYNC"]) { const recovery = await worker.request({ type, identity: worker.identity }, t7IdentitySender(worker)); assert.equal(recovery.outgoing_text, undefined); assert.equal(recovery.recovery, undefined); assert.equal(recovery.manual_recovery, undefined); }
    assert.equal(worker.messages.filter(message => message.type === "OZ_BATCH_DELIVERY_AVAILABLE").length, advertisements);
    assert.equal(providerCalls, 1); assert.equal(controlRequests, controlsBeforeExpiry, "T7 local guards add no control-plane HTTP");
  } finally { cleanupResolve(); worker.close(); }
}

console.log(JSON.stringify({ status: "PASS", focused: "client-cache-time", t1_valid_pending_restart: true, t2_valid_starting_restart: true, t3_pending_controls: 7, t4_completion_veto: true, t5_storage_failures: true, t6_ownership_renewal: true, t7_composed_expiry: { marketplaces: ["ozon", "wildberries"], provider_replay: false, control_guard_http: 0 }, fresh_boundary: true, effective_floor: true, restart_floor: true, context_matrix: 11, legacy_closed: true, ownership_reset_race: true, no_live_provider_calls: true, r3_cases: { "A-expired-pending-failed-set-removal-fallback": true, "B-both-fail-invalid-origin-and-malformed-starting": true, "C-queued-reset-B-ordering": true, "C-same-session-signed-replacement": true, "D-expired-fresh-command-and-recovery-absence": ["ozon", "wildberries"] }, r1_cases: { "A-rolling-monotonic-and-completion-veto": 2, "B-origin-and-same-origin-replacement": 2, "C-legacy-and-pending-provenance": 2, "D-wall-rollback-and-restart-floor": "included_in_A", "prior-focused-matrix": 11 } }));
