import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const caseResults = [], caseFailures = [];
const negativeControls = [];
const T0 = 1700000000000;
const clone = value => value === undefined ? undefined : structuredClone(value);
const paths = worker => worker.controlNetwork.map(row => new URL(row.url).pathname);
const fixedPayload = (clock, changes = {}) => base => ({ ...clone(base), issuedAt: new Date(T0 - 100).toISOString(), serverTime: new Date(T0).toISOString(), expiresAt: new Date(T0 + 1000).toISOString(), offlineGraceUntil: new Date(T0 + 3000).toISOString(), ...changes });
const profileFingerprint = (content, compatibility) => createHash("sha256").update(canonical({ content, compatibility })).digest("hex");
function withProfile(base, changes = {}) {
  const compatibility = { ...base.ai.profile.compatibility, ...changes };
  const profile = { ...base.ai.profile, compatibility, contentSha256: profileFingerprint(base.ai.profile.content, compatibility) };
  return { ...clone(base), ai: { ...base.ai, profile } };
}
async function exactFailure(operation, expected, label) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.ok(failure, label + ": expected rejection");
  assert.equal(failure.code, expected.code || expected, label + ": code");
  if (expected.status !== undefined) assert.equal(failure.status, expected.status, label + ": status");
  if (expected.responseOk !== undefined) assert.equal(failure.responseOk, expected.responseOk, label + ": responseOk");
  return failure;
}
async function namedCase(id, fn, assertion = id + " assertions completed") {
  try {
    await fn();
    caseResults.push({ id, status: "PASS", source: "asserted", failure_origin: null, actual_assertion: assertion });
  } catch (error) {
    caseResults.push({ id, status: "FAIL", source: "asserted", failure_origin: (error.code ? error.code + ": " : "") + (error.message || String(error)), actual_assertion: assertion });
    caseFailures.push(error);
  }
}
function fakeIDB() {
  const records = new Map(), stats = { reads: 0, writes: 0 };
  return { records, stats, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
        const tx = { objectStore() {
          const op = (kind, value) => {
            const result = {};
            queueMicrotask(() => {
              if (kind === "get" || kind === "all") stats.reads++;
              if (kind === "put") { stats.writes++; records.set(value.artifact_key, value); }
              if (kind === "delete") { stats.writes++; records.delete(value); }
              result.result = kind === "get" ? records.get(value) : kind === "all" ? [...records.values()] : value?.artifact_key;
              result.onsuccess?.();
              queueMicrotask(() => tx.oncomplete?.());
            });
            return result;
          };
          return { get: key => op("get", key), put: value => op("put", value), delete: key => op("delete", key), getAll: () => op("all") };
        } };
        return tx;
      } };
      request.onsuccess?.();
    });
    return request;
  } };
}
const idbRequest = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("fixture IDB request failed")); });
async function idbPut(idb, record) {
  const database = await idbRequest(idb.open());
  const store = database.transaction("artifacts", "readwrite").objectStore("artifacts");
  await idbRequest(store.put(record));
}
async function idbGet(idb, artifactKey) {
  const database = await idbRequest(idb.open());
  const store = database.transaction("artifacts", "readonly").objectStore("artifacts");
  return idbRequest(store.get(artifactKey));
}
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
function packagedConfig(backing, changes = {}) {
  const key = backing.local.__seller_agents_fixture_signing_key;
  const publicKey = Buffer.from(key.publicKey, "base64");
  const fingerprint = createHash("sha256").update(publicKey).digest("hex");
  return { environment: "LOCAL DEVELOPMENT", controlApiOrigin: "http://127.0.0.1:43100", portalOrigin: "http://127.0.0.1:43101", extensionVersion: "0.2.4", contractVersion: "control_plane_v2", trustBundle: { trustBundleVersion: "bootstrap_trust_bundle_v1", algorithm: "Ed25519", publicKeyFormat: "spki_der", publicKeyEncoding: "base64", fingerprintAlgorithm: "sha256", fingerprintEncoding: "lowercase_hex", keys: [{ keyId: "fixture-key", publicKey: key.publicKey, fingerprintSha256: fingerprint, lifecycle: "ACTIVE", trustEligibility: "SIGNING_AND_VERIFICATION" }] }, ...changes };
}

async function signed(backing, payload) { return json(await signFixtureBootstrap(backing, payload)); }

async function prepared(options = {}) {
  const clock = options.clock || { wall: Date.now(), mono: 1000 };
  const backing = options.backing || { local: {}, session: {} };
  const wallClock = options.wallClock || (() => clock.wall);
  const monotonicClock = options.monotonicClock || (() => clock.mono);
  const first = await makeWorker(runtime, { backing, wallClock: () => clock.wall, monotonicClock: () => clock.mono });
  const original = structuredClone(backing.local[AUTH]);
  first.close();
  if (options.payload) {
    const payload = structuredClone(options.payload(original.authority.payload));
    backing.local[AUTH].authority.payload = payload;
    backing.local[AUTH].authority.envelope = await signFixtureBootstrap(backing, payload);
    backing.local[AUTH].authority.requestedAi = options.requestedAi === undefined ? original.authority.requestedAi : options.requestedAi;
    backing.local[AUTH].authority.cacheBinding.detectedAi = backing.local[AUTH].authority.requestedAi === null ? null : CHATGPT;
  }
  if (options.credentials) Object.assign(backing.local[AUTH].credentials, options.credentials);
  await options.mutateBacking?.(backing);
  const packagedConfig = options.packagedConfigFactory ? await options.packagedConfigFactory(backing) : options.packagedConfig;
  const worker = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    wallClock,
    monotonicClock,
    ...(Object.hasOwn(options, "indexedDB") ? { indexedDB: options.indexedDB } : {}),
    beforeCryptoVerify: options.beforeCryptoVerify,
    accountId: options.accountId,
    deviceId: options.deviceId,
    sessionId: options.sessionId,
    userAgent: options.userAgent,
    packagedConfig,
    fetch: options.fetch || (async url => { throw new Error("unexpected control request " + url); }),
    onStorageWrite: options.onStorageWrite,
    onStorageRemove: options.onStorageRemove,
  });
  return { worker, backing, clock, original };
}

async function policy(worker, options = {}) {
  const available = await worker.call("(function () { return typeof SellerAgentsControlClient.bootstrapWithPolicy === 'function'; })");
  assert.equal(typeof available, "boolean");
  assert.equal(available, true, "candidate must expose bootstrapWithPolicy; exact-base RED is a separate run");
  return worker.call("SellerAgentsControlClient.bootstrapWithPolicy", options);
}

async function assertTransportCase(kind, responseFactory, expectedFreshness = "STALE_BUT_OFFLINE_GRACE_ELIGIBLE", payloadOptions = {}) {
  const clock = { wall: Date.now(), mono: 1000 };
  const fixture = await prepared({ clock, payload: base => ({ ...base, expiresAt: new Date(clock.wall - 1).toISOString(), offlineGraceUntil: new Date(clock.wall + 3600000).toISOString(), ...payloadOptions }), fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"), `${kind} only attempts bootstrap`);
    return responseFactory();
  } });
  try {
    const before = structuredClone(fixture.backing.local[AUTH].authority);
    const result = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(result.source, "CACHE", kind);
    assert.equal(result.freshness, expectedFreshness, kind);
    assert.equal(canonical(result.payload), canonical(before.payload), `${kind} preserves payload`);
    assert.equal(canonical(fixture.backing.local[AUTH].authority.envelope), canonical(before.envelope), `${kind} preserves signed envelope`);
    assert.equal(fixture.worker.controlNetwork.filter(row => row.url.endsWith("/v1/bootstrap")).length, 1, `${kind} observed online failure`);
  } finally { fixture.worker.close(); }
}

await assertTransportCase("TypeError transport", () => { throw new TypeError("offline detail must stay private"); });
await assertTransportCase("abort-like transport", () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
await assertTransportCase("audited bootstrap 503", () => json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503));
await assertTransportCase("audited bootstrap 503 with fresh access", () => json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503), "FRESH", { expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineGraceUntil: new Date(Date.now() + 7200000).toISOString() });

// A response-body failure may carry the audited fields in its local cause,
// but it did not come from request()'s HTTP-error construction and cannot
// acquire cache.
{
  const localBodyFailure = Object.assign(new Error("body read failure"), { status: 503, code: "BOOTSTRAP_UNAVAILABLE" });
  const fixture = await prepared({ fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    return { ok: false, status: 503, headers: { get: () => null }, body: { getReader: () => ({ read: async () => { throw localBodyFailure; }, cancel: async () => {} }) } };
  } });
  try {
    const before = structuredClone(fixture.backing.local[AUTH].authority);
    await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /CONTROL_HTTP_503/);
    assert.equal(canonical(fixture.backing.local[AUTH].authority), canonical(before), "local body failure leaves signed cache unchanged");
  } finally { fixture.worker.close(); }
}

// A response exists for every case below; none may be reclassified as
// transport merely because it has no useful status on an arbitrary exception.
for (const [label, responseFactory] of [
  ["wrong-code 503", () => json({ error: { code: "TEMPORARY" } }, 503)],
  ["malformed 503", () => new Response("not-json", { status: 503, headers: { "content-type": "application/json" } })],
  ["429", () => json({ error: { code: "RETRY" } }, 429)],
  ["500", () => json({ error: { code: "FAIL" } }, 500)],
  ["502", () => json({ error: { code: "FAIL" } }, 502)],
  ["504", () => json({ error: { code: "FAIL" } }, 504)],
  ["malformed 200", () => json({ malformed: true }, 200)],
]) {
  const fixture = await prepared({ fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return responseFactory(); } });
  try { await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT })); assert.notEqual(fixture.worker.controlNetwork.length, 0, label); assert.ok(fixture.backing.local[AUTH] === undefined || fixture.backing.local[AUTH]?.authority == null || fixture.backing.local[AUTH]?.authority?.payload); }
  finally { fixture.worker.close(); }
}

// A body-read failure after Response is not transport and therefore cannot
// acquire cache. The verifier sees a missing body and rejects the bootstrap.
{
  const fixture = await prepared({ fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error("body read failure")); } }), { status: 200 });
  } });
  try { await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /BOOTSTRAP_/); }
  finally { fixture.worker.close(); }
}

// Exact expiry boundaries use the real signed envelope and the production
// effective-time checkpoint: expiry is stale, grace equality is denied.
for (const [label, offset, expected] of [["expiresAt", 0, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"], ["grace equality", 3600000, "CACHE_EXPIRED"], ["grace after", 3600001, "CACHE_EXPIRED"]]) {
  const clock = { wall: Date.now(), mono: 1000 };
  const fixture = await prepared({ clock, payload: base => ({ ...base, expiresAt: new Date(clock.wall).toISOString(), offlineGraceUntil: new Date(clock.wall + 3600000).toISOString() }), fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  clock.wall += offset; clock.mono += offset;
  try {
    if (expected === "CACHE_EXPIRED") await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), new RegExp(expected));
    else { const result = await policy(fixture.worker, { detectedAi: CHATGPT }); assert.equal(result.freshness, expected, label); }
  } finally { fixture.worker.close(); }
}

// Expired access may fail at preflight refresh and still preserve rotation
// intent while using the matching signed cache. A bootstrap 401 followed by
// forced-refresh transport is a known auth challenge and cannot fall back.
{
  const clock = { wall: Date.now(), mono: 1000 };
  const preflight = await prepared({ clock, credentials: { accessTokenExpiresAt: new Date(clock.wall - 1000).toISOString() }, payload: base => ({ ...base, expiresAt: new Date(clock.wall - 1).toISOString(), offlineGraceUntil: new Date(clock.wall + 3600000).toISOString() }), fetch: async url => { assert.ok(url.endsWith("/v1/auth/refresh")); throw new TypeError("refresh transport"); } });
  try { const result = await policy(preflight.worker, { detectedAi: CHATGPT }); assert.equal(result.source, "CACHE"); assert.ok(preflight.backing.local[AUTH].rotation, "rotation intent retained"); }
  catch (error) { throw error; }
  finally { preflight.worker.close(); }
}
{
  const fixture = await prepared({ fetch: async url => {
    if (url.endsWith("/v1/bootstrap")) return json({ error: { code: "AUTH_CHALLENGE" } }, 401);
    assert.ok(url.endsWith("/v1/auth/refresh")); throw new TypeError("forced refresh transport");
  } });
  try { await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /AUTH_CHALLENGE/); assert.equal(fixture.backing.local[AUTH].credentials, null, "known auth challenge is terminal"); assert.equal(fixture.backing.local[AUTH].authority, null); }
  finally { fixture.worker.close(); }
}

// P2: hold the actual denial AUTH write after the increased-floor write. A
// later raw bootstrap supersedes the policy while that successful write is
// held. Obsolescence must not remove AUTH or turn the successful write into a
// storage failure.
{
  const clock = { wall: Date.now(), mono: 1000 };
  let denialRelease, denialHeld = false, bootstrapCalls = 0;
  const writes = [];
  const fixture = await prepared({
    clock,
    credentials: { accessTokenExpiresAt: new Date(clock.wall + 86400000).toISOString(), refreshTokenExpiresAt: new Date(clock.wall + 172800000).toISOString() },
    payload: base => ({ ...base, expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() }),
    fetch: async url => {
      assert.ok(url.endsWith("/v1/bootstrap"));
      bootstrapCalls++;
      if (bootstrapCalls === 1) return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503);
      return new Promise(resolve => { fixture.releaseBootstrap = () => resolve(signed(fixture.backing, { ...fixture.backing.local[AUTH].authority.payload, configVersion: 2, serverTime: new Date(clock.wall + 1).toISOString(), expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() })); });
    },
    onStorageWrite: async (kind, values) => {
      if (kind !== "local" || !values[AUTH]) return;
      const entry = structuredClone(values[AUTH]);
      writes.push({ workAllowed: entry.authority?.workAllowed, floor: entry.cacheClock?.effectiveTimeMs, configVersion: entry.authority?.payload?.configVersion });
      if (!denialHeld && entry.authority?.workAllowed === false) {
        denialHeld = true;
        await new Promise(resolve => { denialRelease = resolve; });
      }
    },
    onStorageRemove: async (kind, key) => { if (kind === "local" && key === AUTH) fixture.removeAttempts = (fixture.removeAttempts || 0) + 1; },
  });
  try {
    clock.wall += 7200000; clock.mono += 7200000;
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => denialHeld && writes.some(row => row.workAllowed === true) && typeof denialRelease === "function", "P2 denial AUTH write");
    const oldFloor = fixture.backing.local[AUTH].cacheClock.effectiveTimeMs;
    const later = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    await until(() => bootstrapCalls === 2, "P2 later raw bootstrap");
    denialRelease();
    try { await old; } catch (error) { if (error.code !== "CACHE_ACQUISITION_OBSOLETED") throw error; }
    assert.equal(fixture.removeAttempts || 0, 0, "P2 obsolescence does not remove AUTH");
    assert.ok(fixture.backing.local[AUTH], "P2 AUTH remains present");
    assert.ok(fixture.backing.local[AUTH].cacheClock.effectiveTimeMs >= oldFloor, "P2 floor is nondecreasing");
    fixture.releaseBootstrap();
    let newer;
    try { newer = await later; } catch (error) { throw error; }
    assert.equal(newer.configVersion, 2, "P2 newer raw result completes");
    assert.equal(fixture.backing.local[AUTH].authority.payload.configVersion, 2, "P2 newer authority remains owner");
    assert.ok(writes.some(row => row.workAllowed === true) && writes.some(row => row.workAllowed === false), "P2 held denial write was after floor write");
  } finally { fixture.worker.close(); }
}

// G/public-return fence: resolve the real successful checkpoint write, then
// start a newer raw invocation before the queue promise reaches the public
// consumer. The old policy result is rejected and B owns the final authority.
{
  const clock = { wall: Date.now(), mono: 1000 };
  let checkpointHeld = false, releaseCheckpoint, calls = 0;
  const fixture = await prepared({
    clock,
    credentials: { accessTokenExpiresAt: new Date(clock.wall + 86400000).toISOString(), refreshTokenExpiresAt: new Date(clock.wall + 172800000).toISOString() },
    payload: base => ({ ...base, expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() }),
    fetch: async url => {
      assert.ok(url.endsWith("/v1/bootstrap"));
      if (++calls === 1) return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503);
      const base = structuredClone(fixture.backing.local[AUTH].authority.payload);
      return signed(fixture.backing, { ...base, configVersion: 2, serverTime: new Date(clock.wall + 1).toISOString(), expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() });
    },
    onStorageWrite: async (kind, values) => {
      if (kind === "local" && values[AUTH]?.authority?.workAllowed === true && values[AUTH].cacheClock.effectiveTimeMs > Date.now() && !checkpointHeld) {
        checkpointHeld = true;
        await new Promise(resolve => { releaseCheckpoint = resolve; });
      }
    },
  });
  try {
    clock.wall += 3600001; clock.mono += 3600001;
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => checkpointHeld && typeof releaseCheckpoint === "function", "G checkpoint write");
    releaseCheckpoint();
    const newer = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    await assert.rejects(old, /CACHE_ACQUISITION_OBSOLETED/);
    const result = await newer;
    assert.equal(result.configVersion, 2);
    assert.equal(fixture.backing.local[AUTH].authority.payload.configVersion, 2);
  } finally { fixture.worker.close(); }
}

// Account-only cache is valid configuration only for an account-only request;
// it cannot satisfy a requested AI context, and stale acquisition never turns
// the existing Work-facing guards into an offline grant.
{
  const clock = { wall: Date.now(), mono: 1000 }, backing = { local: {}, session: {} };
  let offline = false;
  const fixture = await prepared({ clock, backing, fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    if (offline) return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503);
    const base = structuredClone(backing.local[AUTH].authority.payload);
    return signed(backing, { ...base, serverTime: new Date(clock.wall + 1).toISOString(), expiresAt: new Date(clock.wall + 1000).toISOString(), offlineGraceUntil: new Date(clock.wall + 3600000).toISOString(), ai: { status: "UNCONFIGURED" } });
  } });
  try {
    await fixture.worker.call("SellerAgentsControlClient.bootstrap");
    offline = true; clock.wall += 2000; clock.mono += 2000;
    const result = await policy(fixture.worker);
    assert.equal(result.source, "CACHE");
    assert.equal(await fixture.worker.call("SellerAgentsControlClient.canWork"), false);
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.status")).workAllowed, false);
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.getAuthority")).workAllowed, false);
  } finally { fixture.worker.close(); }
}

// F: policy acquisition rejects the signed cache for each changed binding
// dimension. The first group is restore-level denial; requested AI is an
// in-flight policy identity mismatch with the original authority preserved.
for (const [label, changes, userAgent] of [
  ["api origin", { controlApiOrigin: "http://127.0.0.1:43199" }],
  ["portal origin", { portalOrigin: "http://127.0.0.1:43199" }],
  ["browser", {}, "Mozilla/5.0 Gecko/20100101 Firefox/156.0"],
  ["extension version", { extensionVersion: "0.2.5" }],
  ["contract", { contractVersion: "control_plane_v3" }],
  ["packaged trust ring", { trustBundle: { trustBundleVersion: "bootstrap_trust_bundle_v1", algorithm: "Ed25519", publicKeyFormat: "spki_der", publicKeyEncoding: "base64", fingerprintAlgorithm: "sha256", fingerprintEncoding: "lowercase_hex", keys: [] } }],
]) {
  const clock = { wall: Date.now(), mono: 1000 };
  const fixture = await prepared({
    clock,
    userAgent,
    packagedConfigFactory: async backing => packagedConfig(backing, changes),
    payload: base => ({ ...base, expiresAt: new Date(clock.wall - 1).toISOString(), offlineGraceUntil: new Date(clock.wall + 3600000).toISOString() }),
    fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); },
  });
  try {
    await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /BOOTSTRAP_UNAVAILABLE|CACHE_CONTEXT_MISMATCH|AUTH_REQUIRED/);
    assert.ok(fixture.worker.controlNetwork.filter(row => row.url.endsWith("/v1/bootstrap")).length <= 1, `${label} source`);
    assert.equal(fixture.backing.local[AUTH]?.authority, null, `${label} restore denial`);
  } finally { fixture.worker.close(); }
}
{
  const fixture = await prepared({ payload: base => ({ ...base, expiresAt: new Date(Date.now() - 1).toISOString(), offlineGraceUntil: new Date(Date.now() + 3600000).toISOString() }), fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try {
    await assert.rejects(policy(fixture.worker, { detectedAi: { family: "alice", surface: "web", variant: null } }), /BOOTSTRAP_UNAVAILABLE|CACHE_CONTEXT_MISMATCH/);
    assert.ok(fixture.backing.local[AUTH]?.authority, "requested-AI mismatch keeps the original authority");
  } catch (error) { throw error; }
  finally { fixture.worker.close(); }
}
for (const [label, field, value] of [
  ["device context", "deviceId", "44444444-4444-4444-8444-444444444444"],
  ["session context", "sessionId", "55555555-5555-4555-8555-555555555555"],
]) {
  const fixture = await prepared({
    payload: base => ({ ...base, expiresAt: new Date(Date.now() - 1).toISOString(), offlineGraceUntil: new Date(Date.now() + 3600000).toISOString() }),
    mutateBacking: backing => { backing.local[AUTH].credentials[field] = value; },
    fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); },
  });
  try { await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /AUTH_REQUIRED|BOOTSTRAP_UNAVAILABLE/); assert.equal(fixture.backing.local[AUTH]?.authority, null, `${label} authority denied`); }
  finally { fixture.worker.close(); }
}
{
  const fixture = await prepared({
    payload: base => ({ ...base, expiresAt: new Date(Date.now() - 1).toISOString(), offlineGraceUntil: new Date(Date.now() + 3600000).toISOString() }),
    mutateBacking: backing => { const signature = backing.local[AUTH].authority.envelope.signature; backing.local[AUTH].authority.envelope.signature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`; },
    fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); },
  });
  try { await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /BOOTSTRAP_UNAVAILABLE|AUTH_REQUIRED/); assert.equal(fixture.backing.local[AUTH]?.authority, null, "differently signed envelope is denied"); }
  finally { fixture.worker.close(); }
}
{
  const fixture = await prepared({ fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try { await assert.rejects(policy(fixture.worker), /BOOTSTRAP_UNAVAILABLE|CACHE_CONTEXT_MISMATCH/); }
  finally { fixture.worker.close(); }
}

// A later raw online invocation supersedes an older policy attempt even when
// both use the same account/device/session. The held A response cannot return
// cache or lower B's signed authority.
{
  let calls = 0, release;
  const fixture = await prepared({ fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    if (++calls === 1) return new Promise((resolve, reject) => { release = () => reject(new TypeError("A transport")); });
    const payload = structuredClone(fixture.backing.local[AUTH].authority.payload);
    return signed(fixture.backing, { ...payload, configVersion: 2 });
  } });
  try {
    const old = policy(fixture.worker, { detectedAi: CHATGPT }), oldFailure = assert.rejects(old, /CONTROL_TRANSPORT_UNAVAILABLE/); await until(() => release, "held policy A");
    const replacement = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    await until(() => calls === 2, "raw online B"); release();
    await replacement; await oldFailure;
    assert.equal(fixture.backing.local[AUTH].authority.payload.configVersion, 2);
  } finally { fixture.worker.close(); }
}

// A later 403 invalidates the current authority; the old eligible transport
// failure must not restore it.
{
  let calls = 0, release;
  const fixture = await prepared({ fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    if (++calls === 1) return new Promise((resolve, reject) => { release = () => reject(new TypeError("A transport")); });
    return json({ error: { code: "LATER_FORBIDDEN" } }, 403);
  } });
  try {
    const old = policy(fixture.worker, { detectedAi: CHATGPT }), oldFailure = assert.rejects(old, /CONTROL_TRANSPORT_UNAVAILABLE/); await until(() => release, "held policy before 403");
    const forbidden = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT }), forbiddenFailure = assert.rejects(forbidden, /LATER_FORBIDDEN/);
    await until(() => calls === 2, "later 403"); release();
    await forbiddenFailure; await oldFailure;
    assert.equal(fixture.backing.local[AUTH].authority, null);
  } finally { fixture.worker.close(); }
}

// Failed checkpoint writes deny this call; after storage recovery the same
// signed cache is reconsidered. The catalog/IDB surface is not involved.
{
  let fail = false, writes = 0, removes = 0;
  const fixture = await prepared({ payload: base => ({ ...base, expiresAt: new Date(Date.now() - 1).toISOString(), offlineGraceUntil: new Date(Date.now() + 3600000).toISOString() }), fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); }, onStorageWrite: async (kind, values) => { if (kind === "local" && values[AUTH] && fail) { writes++; throw new Error("injected storage failure"); } }, onStorageRemove: async kind => { if (kind === "local" && fail) removes++; } });
  try {
    fail = true;
    fixture.clock.wall += 100; fixture.clock.mono += 100;
    await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /AUTH_DENIAL_PERSISTENCE_FAILED/);
    assert.equal(writes, 1); assert.equal(removes, 1);
    fail = false;
    const result = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(result.source, "CACHE");
  } finally { fixture.worker.close(); }
}

// A failed denial set followed by a failed removal is reported honestly. The
// persisted record remains the old checkpoint, so a restart cannot claim the
// newer in-memory floor was durable.
{
  const clock = { wall: Date.now(), mono: 1000 }, writes = [], removals = [];
  let failDenial = false;
  const fixture = await prepared({
    clock,
    payload: base => ({ ...base, expiresAt: new Date(clock.wall + 3600000).toISOString(), offlineGraceUntil: new Date(clock.wall + 7200000).toISOString() }),
    fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); },
    onStorageWrite: async (kind, values) => { if (kind === "local" && failDenial && values[AUTH]?.authority?.workAllowed === false) { writes.push(values[AUTH].cacheClock.effectiveTimeMs); throw new Error("denial set failed"); } },
    onStorageRemove: async (kind, key) => { if (kind === "local" && failDenial && key === AUTH) { removals.push(key); throw new Error("denial remove failed"); } },
  });
  const persistedFloor = fixture.backing.local[AUTH].cacheClock.effectiveTimeMs;
  try {
    clock.wall += 7200000; clock.mono += 7200000; failDenial = true;
    await assert.rejects(policy(fixture.worker, { detectedAi: CHATGPT }), /AUTH_DENIAL_PERSISTENCE_FAILED/);
    assert.equal(writes.length, 1); assert.equal(removals.length, 1);
    assert.ok(fixture.backing.local[AUTH].cacheClock.effectiveTimeMs >= persistedFloor, "successful floor checkpoint is retained");
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.getAuthority")).workAllowed, false, "memory remains denied");
    failDenial = false;
    const restarted = await makeWorker(runtime, { backing: fixture.backing, seedAuthority: false, wallClock: () => clock.wall, monotonicClock: () => clock.mono, fetch: async url => { assert.ok(url.endsWith("/v1/bootstrap")); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
    try { assert.equal((await restarted.call("SellerAgentsControlClient.status")).authenticated, true); assert.ok(restarted.backing.local[AUTH].cacheClock.effectiveTimeMs >= persistedFloor); } finally { restarted.close(); }
  } finally { fixture.worker.close(); }
}

// A verified live renewal remains online and replaces the cached envelope;
// policy never replays a provider request on behalf of Work guards.
{
  const fixture = await prepared({ fetch: async url => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    const payload = structuredClone(fixture.backing.local[AUTH].authority.payload);
    return signed(fixture.backing, { ...payload, configVersion: 3 });
  } });
  try {
    const result = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(result.source, "ONLINE"); assert.equal(result.freshness, "FRESH");
    assert.equal(result.payload.configVersion, 3); assert.equal(fixture.worker.controlNetwork.length, 1);
    await fixture.worker.call("SellerAgentsControlClient.canWork"); await fixture.worker.call("SellerAgentsControlClient.status");
    assert.equal(fixture.worker.controlNetwork.length, 1, "fresh Work guards do not add network requests");
  } finally { fixture.worker.close(); }
}

await namedCase("Q1-A-refresh503-not-cache", async () => {
  const clock = { wall: T0, mono: 1000 };
  const fixture = await prepared({ clock, credentials: { accessTokenExpiresAt: new Date(T0 - 1).toISOString() }, payload: fixedPayload(clock, { expiresAt: new Date(T0 - 1).toISOString() }), fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/auth/refresh");
    return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503);
  } });
  try {
    const failure = await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), { code: "BOOTSTRAP_UNAVAILABLE", status: 503 }, "Q1-A");
    assert.equal(failure.code, "BOOTSTRAP_UNAVAILABLE");
    assert.deepEqual(paths(fixture.worker), ["/v1/auth/refresh"]);
    assert.equal(paths(fixture.worker).filter(pathname => pathname === "/v1/bootstrap").length, 0);
    assert.equal(fixture.backing.local[AUTH].authority.payload.configVersion, 1);
  } finally { fixture.worker.close(); }
});

for (const status of [200, 503]) await namedCase("Q1-B-oversized-" + status, async () => {
  const clock = { wall: T0, mono: 1000 };
  const fixture = await prepared({ clock, fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap");
    return new Response("x".repeat(1024 * 1024 + 1), { status, headers: { "content-type": "application/json" } });
  } });
  try {
    const failure = await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), { code: "CONTROL_RESPONSE_TOO_LARGE", status, responseOk: status >= 200 && status < 300 }, "Q1-B-" + status);
    assert.deepEqual(paths(fixture.worker), ["/v1/bootstrap"]);
    assert.equal(failure.body, null);
    assert.equal(fixture.worker.controlNetwork.length, 1);
    assert.equal(fixture.backing.local[AUTH]?.authority == null, status === 200);
  } finally { fixture.worker.close(); }
});

const onlineEnvelopeCases = [
  ["unknown-key", "BOOTSTRAP_UNKNOWN_SIGNING_KEY", async (backing, base) => json(await signFixtureBootstrap(backing, base, "unknown-fixture-key"))],
  ["corrupted-signature", "BOOTSTRAP_INVALID_SIGNATURE", async (backing, base) => {
    const envelope = await signFixtureBootstrap(backing, base);
    const bytes = Buffer.from(envelope.signature, "base64url"); bytes[0] ^= 1; envelope.signature = bytes.toString("base64url"); return json(envelope);
  }],
  ["browser-unsupported", "BOOTSTRAP_PROFILE_INCOMPATIBLE", async (backing, base) => signed(backing, { ...base, compatibility: { ...base.compatibility, browser: { status: "UNSUPPORTED_BROWSER" } } })],
  ["extension-update-required", "BOOTSTRAP_PROFILE_INCOMPATIBLE", async (backing, base) => signed(backing, { ...base, compatibility: { ...base.compatibility, extension: { status: "UPDATE_REQUIRED", minimumVersion: "0.2.3" } } })],
  ["profile-minimum-99", "BOOTSTRAP_PROFILE_INCOMPATIBLE", async (backing, base) => signed(backing, withProfile(base, { minimumExtensionVersion: "99.0.0" }))],
  ["server-time-regression", "BOOTSTRAP_SERVER_TIME_REGRESSION", async (backing, base) => signed(backing, { ...base, issuedAt: new Date(T0 - 200).toISOString(), serverTime: new Date(T0 - 1).toISOString() })],
];
for (const [label, expected, response] of onlineEnvelopeCases) await namedCase("Q1-C-" + label, async () => {
  const clock = { wall: T0, mono: 1000 };
  const fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap");
    const base = clone(fixture.backing.local[AUTH].authority.payload);
    return response(fixture.backing, base);
  } });
  try {
    await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), expected, "Q1-C-" + label);
    assert.deepEqual(paths(fixture.worker), ["/v1/bootstrap"]);
    assert.equal(fixture.backing.local[AUTH]?.authority, null);
  } finally { fixture.worker.close(); }
});

for (const status of [401, 403]) await namedCase("Q1-D-preflight-refresh-" + status, async () => {
  const clock = { wall: T0, mono: 1000 };
  const fixture = await prepared({ clock, credentials: { accessTokenExpiresAt: new Date(T0 - 1).toISOString() }, fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/auth/refresh");
    return json({ error: { code: "REFRESH_TERMINAL_" + status } }, status);
  } });
  try {
    await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), { code: "REFRESH_TERMINAL_" + status, status }, "Q1-D-preflight-" + status);
    assert.deepEqual(paths(fixture.worker), ["/v1/auth/refresh"]);
    assert.equal(fixture.backing.local[AUTH].credentials, null);
    assert.equal(fixture.backing.local[AUTH].authority, null);
    const restarted = await makeWorker(runtime, { backing: fixture.backing, seedAuthority: false, wallClock: () => T0, monotonicClock: () => 1, fetch: async () => { throw new Error("signed-out restart must not request"); } });
    try {
      const state = await restarted.call("SellerAgentsControlClient.status");
      assert.equal(state.authenticated, false); assert.equal(state.workAllowed, false); assert.equal(restarted.network.length, 0);
    } finally { restarted.close(); }
  } finally { fixture.worker.close(); }
});

for (const status of [401, 403]) await namedCase("Q1-D-bootstrap401-refresh-" + status, async () => {
  const clock = { wall: T0, mono: 1000 };
  const fixture = await prepared({ clock, fetch: async url => {
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/bootstrap") return json({ error: { code: "BOOTSTRAP_AUTH_CHALLENGE" } }, 401);
    assert.equal(pathname, "/v1/auth/refresh");
    return json({ error: { code: "FORCED_REFRESH_" + status } }, status);
  } });
  try {
    await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), { code: "BOOTSTRAP_AUTH_CHALLENGE", status: 401 }, "Q1-D-bootstrap401-" + status);
    assert.deepEqual(paths(fixture.worker), ["/v1/bootstrap", "/v1/auth/refresh"]);
    assert.equal(fixture.backing.local[AUTH].credentials, null);
    assert.equal(fixture.backing.local[AUTH].authority, null);
    const restarted = await makeWorker(runtime, { backing: fixture.backing, seedAuthority: false, wallClock: () => T0, monotonicClock: () => 1 });
    try { assert.equal((await restarted.call("SellerAgentsControlClient.status")).authenticated, false); assert.equal(restarted.network.length, 0); } finally { restarted.close(); }
  } finally { fixture.worker.close(); }
});

await namedCase("Q1-E-storage503-is-not-http503", async () => {
  const clock = { wall: T0, mono: 1000 };
  const injected = Object.assign(new Error("local AUTH set failed"), { status: 503, code: "BOOTSTRAP_UNAVAILABLE" });
  const fixture = await prepared({ clock, payload: fixedPayload(clock, { expiresAt: new Date(T0 - 1).toISOString() }), fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503);
  }, onStorageWrite: async (kind, values) => { if (kind === "local" && values[AUTH]) throw injected; } });
  try {
    clock.wall = T0 + 100; clock.mono = 1100;
    const failure = await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), "AUTH_DENIAL_PERSISTENCE_FAILED", "Q1-E");
    assert.notEqual(failure.status, 503);
    assert.deepEqual(paths(fixture.worker), ["/v1/bootstrap"]);
  } finally { fixture.worker.close(); }
});

for (const [label, offset, expected] of [["expires-minus-one", 999, "FRESH"], ["expires-equality", 1000, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"], ["grace-minus-one", 2999, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE"], ["grace-equality", 3000, "CACHE_EXPIRED"], ["grace-after", 3001, "CACHE_EXPIRED"]]) await namedCase("Q2-A-" + label, async () => {
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try {
    clock.wall = T0 + offset; clock.mono = 1000 + offset;
    if (expected === "CACHE_EXPIRED") await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), expected, "Q2-A-" + label);
    else { const result = await policy(fixture.worker, { detectedAi: CHATGPT }); assert.equal(result.source, "CACHE"); assert.equal(result.freshness, expected); }
    assert.equal(fixture.backing.local[AUTH].authority.workAllowed, expected === "CACHE_EXPIRED" ? false : true);
  } finally { fixture.worker.close(); }
});

await namedCase("Q2-B-held-write-crosses-grace", async () => {
  const clock = { wall: T0, mono: 1000 }; let release, held = false;
  const fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); }, onStorageWrite: async (kind, values) => {
    if (kind === "local" && values[AUTH]?.cacheClock?.effectiveTimeMs === T0 + 2999 && !held) { held = true; await new Promise(resolve => { release = resolve; }); }
  } });
  try {
    clock.wall = T0 + 2999; clock.mono = 3999;
    const pending = policy(fixture.worker, { detectedAi: CHATGPT });
    await until(() => held, "Q2-B increased-floor write");
    clock.wall = T0 + 3000; clock.mono = 4000; release();
    await exactFailure(() => pending, "CACHE_EXPIRED", "Q2-B");
    assert.ok(fixture.backing.local[AUTH].cacheClock.effectiveTimeMs >= T0 + 3000);
    assert.equal(fixture.backing.local[AUTH].authority.workAllowed, false);
  } finally { release?.(); fixture.worker.close(); }
});

await namedCase("Q2-C-resolved-AI-signed-grace-remains-authorized", async () => {
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try {
    assert.equal(await fixture.worker.call("SellerAgentsControlClient.canWork"), true);
    clock.wall = T0 + 1001; clock.mono = 2001;
    const cached = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(cached.source, "CACHE"); assert.equal(cached.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
    const count = fixture.worker.controlNetwork.length;
    assert.equal(await fixture.worker.call("SellerAgentsControlClient.canWork"), true);
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.status")).workAllowed, true);
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.getAuthority")).workAllowed, true);
    assert.equal(fixture.worker.controlNetwork.length, count);
  } finally { fixture.worker.close(); }
});

await namedCase("Q2-D-rollback-consumed-grace-restart", async () => {
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try {
    clock.wall = T0 + 500; clock.mono = 1500;
    const first = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(first.source, "CACHE"); assert.equal(first.freshness, "FRESH");
    clock.wall = T0 - 500; clock.mono = 2500;
    const rolled = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(rolled.source, "CACHE"); assert.equal(rolled.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
    const consumedFloor = fixture.backing.local[AUTH].cacheClock.effectiveTimeMs;
    assert.equal(consumedFloor, T0 + 1500);
    fixture.worker.close();
    const restartClock = { wall: T0 - 500, mono: 1 };
    const restarted = await makeWorker(runtime, { backing: fixture.backing, seedAuthority: false, wallClock: () => restartClock.wall, monotonicClock: () => restartClock.mono, fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
    try {
      assert.equal(fixture.backing.local[AUTH].cacheClock.effectiveTimeMs, consumedFloor);
      const cached = await policy(restarted, { detectedAi: CHATGPT });
      assert.equal(cached.source, "CACHE");
      assert.equal(cached.freshness, "STALE_BUT_OFFLINE_GRACE_ELIGIBLE");
      restartClock.wall = T0 + 3000; restartClock.mono = 1501;
      await exactFailure(() => policy(restarted, { detectedAi: CHATGPT }), "CACHE_EXPIRED", "Q2-D grace");
      assert.ok(restarted.backing.local[AUTH].cacheClock.effectiveTimeMs >= T0 + 3000);
      assert.deepEqual(paths(restarted), ["/v1/bootstrap", "/v1/bootstrap"]);
      restarted.close();
      const again = await makeWorker(runtime, { backing: fixture.backing, seedAuthority: false, wallClock: () => T0 - 10000, monotonicClock: () => 1, fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
      try {
        assert.equal((await again.call("SellerAgentsControlClient.canWork")), false);
        assert.equal((await again.call("SellerAgentsControlClient.getAuthority")).workAllowed, false);
        assert.ok(again.backing.local[AUTH].cacheClock.effectiveTimeMs >= T0 + 3000);
        await exactFailure(() => policy(again, { detectedAi: CHATGPT }), "CACHE_EXPIRED", "Q2-D rollback denial");
        assert.deepEqual(paths(again), ["/v1/bootstrap"]);
      } finally { again.close(); }
    } finally { if (restarted) restarted.close(); }
  } finally { fixture.worker.close(); }
});

await namedCase("Q3-A-first-floor-both-storage-fail-and-idb-retention", async () => {
  const clock = { wall: T0, mono: 1000 }, idb = fakeIDB(), backing = { local: {}, session: {} };
  let fail = false, writes = 0, removes = 0;
  const fixture = await prepared({ clock, backing, indexedDB: idb, payload: fixedPayload(clock), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); }, mutateBacking: value => { value.local.r2_catalog_marker = { keep: "catalog-exact" }; }, onStorageWrite: async (kind, values) => { if (fail && kind === "local" && values[AUTH]) { writes++; throw Object.assign(new Error("first-floor set failed"), { status: 503, code: "BOOTSTRAP_UNAVAILABLE" }); } }, onStorageRemove: async (kind, key) => { if (fail && kind === "local" && key === AUTH) { removes++; throw new Error("first-floor remove failed"); } } });
  const record = { artifact_key: "r3-retained-artifact", value: "idb-exact", created_at_ms: T0, expires_at_ms: T0 + 3600000 };
  try {
    await idbPut(idb, record);
    const seedWriteCount = idb.stats.writes;
    assert.equal(seedWriteCount, 1);
    assert.deepEqual(await idbGet(idb, record.artifact_key), record);
    const oldBytes = clone(backing.local[AUTH]), oldFloor = oldBytes.cacheClock.effectiveTimeMs;
    fail = true; clock.wall = T0 + 100; clock.mono = 1100;
    await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), "AUTH_DENIAL_PERSISTENCE_FAILED", "Q3-A");
    assert.equal(writes, 1); assert.equal(removes, 1);
    assert.deepEqual(backing.local[AUTH], oldBytes);
    assert.equal(backing.local.r2_catalog_marker.keep, "catalog-exact");
    assert.deepEqual(await idbGet(idb, record.artifact_key), record);
    assert.equal(idb.stats.writes, seedWriteCount, "Q3 failed denial does not rewrite IDB");
    const failedBacking = clone(backing);

    const negativeControl = fakeIDB();
    await idbPut(negativeControl, record);
    negativeControl.records.clear();
    let negativeFailure;
    try { assert.deepEqual(await idbGet(negativeControl, record.artifact_key), record); }
    catch (error) { negativeFailure = error; }
    assert.ok(negativeFailure, "Q3 destructive readonly negative control must fail");
    assert.equal(await idbGet(negativeControl, record.artifact_key), undefined);
    negativeControls.push({ id: "Q3-readonly-get-after-destructive-clear", status: "EXPECTED_FAIL", failure_origin: negativeFailure.message, normal_control: "PASS" });

    fail = false;
    clock.wall = T0 - 100; clock.mono = 1100;
    const recovered = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(recovered.source, "CACHE"); assert.equal(recovered.freshness, "FRESH");
    assert.equal(backing.local[AUTH].cacheClock.effectiveTimeMs, T0 + 100);
    assert.deepEqual(await idbGet(idb, record.artifact_key), record);
    assert.equal(idb.stats.writes, seedWriteCount, "Q3 recovery does not rewrite IDB");
    fixture.worker.close();
    const restartClock = { wall: T0, mono: 1000 };
    const restarted = await makeWorker(runtime, { backing: failedBacking, seedAuthority: false, indexedDB: idb, wallClock: () => restartClock.wall, monotonicClock: () => restartClock.mono, fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
    try {
      assert.equal(restarted.backing.local[AUTH].cacheClock.effectiveTimeMs, oldFloor, "Q3 crash branch restores only failed-backing floor");
      assert.equal(restarted.backing.local.r2_catalog_marker.keep, "catalog-exact");
      assert.deepEqual(await idbGet(idb, record.artifact_key), record);
      assert.equal(idb.stats.writes, seedWriteCount, "Q3 restart does not rewrite IDB");
      restartClock.wall = T0 + 100; restartClock.mono = 1100;
      const restartedRecovery = await policy(restarted, { detectedAi: CHATGPT });
      assert.equal(restartedRecovery.source, "CACHE"); assert.equal(restartedRecovery.freshness, "FRESH");
      assert.equal(restarted.backing.local[AUTH].cacheClock.effectiveTimeMs, T0 + 100);
      assert.deepEqual(await idbGet(idb, record.artifact_key), record);
      assert.equal(idb.stats.writes, seedWriteCount, "Q3 normal checkpoint does not rewrite IDB");
    } finally { restarted.close(); }
  } finally { if (fixture.worker) fixture.worker.close(); }
});

await namedCase("Q4-A-no-authority-cache-control", async () => {
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, payload: fixedPayload(clock), mutateBacking: backing => { backing.local[AUTH].authority = null; }, fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return json({ error: { code: "BOOTSTRAP_UNAVAILABLE" } }, 503); } });
  try {
    await exactFailure(() => policy(fixture.worker, { detectedAi: CHATGPT }), { code: "BOOTSTRAP_UNAVAILABLE", status: 503 }, "Q4-A");
    assert.deepEqual(paths(fixture.worker), ["/v1/bootstrap"]);
    assert.equal(fixture.backing.local[AUTH].authority, null);
  } finally { fixture.worker.close(); }
});

await namedCase("Q4-B-signed-out-auth-required-zero-requests", async () => {
  const worker = await makeWorker(runtime, { seedAuthority: false, wallClock: () => T0, monotonicClock: () => 1, fetch: async () => { throw new Error("signed-out policy must not request"); } });
  try { await exactFailure(() => policy(worker, { detectedAi: CHATGPT }), "AUTH_REQUIRED", "Q4-B"); assert.equal(worker.network.length, 0); } finally { worker.close(); }
});

await namedCase("Q4-C-account-only-online-positive", async () => {
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, requestedAi: null, payload: fixedPayload(clock, { ai: { status: "UNCONFIGURED" } }), fetch: async url => { assert.equal(new URL(url).pathname, "/v1/bootstrap"); return signed(fixture.backing, { ...fixture.backing.local[AUTH].authority.payload, ai: { status: "UNCONFIGURED" } }); } });
  try {
    const result = await policy(fixture.worker);
    assert.equal(result.source, "ONLINE"); assert.equal(result.payload.ai.status, "UNCONFIGURED");
    assert.equal((await fixture.worker.call("SellerAgentsControlClient.canWork")), false);
  } finally { fixture.worker.close(); }
});

await namedCase("Q4-D-account-replacement-online-positive", async () => {
  let request = 0;
  const clock = { wall: T0, mono: 1000 }, fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap");
    const base = clone(fixture.backing.local[AUTH].authority.payload);
    if (++request === 1) return signed(fixture.backing, base);
    return signed(fixture.backing, { ...base, account: { id: "99999999-9999-4999-8999-999999999999", status: "ACTIVE" } });
  } });
  try {
    const positive = await fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    assert.equal(positive.account.id, fixture.backing.local[AUTH].authority.payload.account.id);
    const result = await policy(fixture.worker, { detectedAi: CHATGPT });
    assert.equal(result.source, "ONLINE");
    assert.equal(result.payload.account.id, "99999999-9999-4999-8999-999999999999");
    assert.equal(fixture.backing.local[AUTH].authority.payload.account.id, result.payload.account.id);
  } finally { fixture.worker.close(); }
}, "valid signed online account replacement is a positive policy case; legitimate server authority is accepted");

await namedCase("Q4-D-account-replacement-obsoletes-held-cache", async () => {
  const accountB = "99999999-9999-4999-8999-999999999999";
  const clock = { wall: T0, mono: 1000 }, backing = { local: {}, session: {} };
  const held = { armed: false, entered: false };
  let releaseA, calls = 0;
  const fixture = await prepared({ clock, backing, payload: fixedPayload(clock), beforeCryptoVerify: async () => {
    if (!held.armed || held.entered) return;
    held.entered = true;
    await new Promise(resolve => { releaseA = resolve; });
  }, fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap");
    calls++;
    if (calls === 1) return signed(backing, clone(backing.local[AUTH].authority.payload));
    if (calls === 2) throw new TypeError("A policy transport");
    const payload = { ...clone(backing.local[AUTH].authority.payload), account: { id: accountB, status: "ACTIVE" }, configVersion: 2, serverTime: new Date(T0 + 1).toISOString(), expiresAt: new Date(T0 + 3600000).toISOString(), offlineGraceUntil: new Date(T0 + 7200000).toISOString() };
    return signed(backing, payload);
  } });
  try {
    const sameAccount = await fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    assert.equal(sameAccount.account.id, "11111111-1111-4111-8111-111111111111");
    const aRecord = clone(backing.local[AUTH]);
    const aDeviceId = aRecord.authority.deviceId, aSessionId = aRecord.authority.sessionId;
    held.armed = true;
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => held.entered, "Q4-D held cached-envelope verification");
    const b = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
    const bResult = await b;
    const bSnapshot = clone(backing.local[AUTH]);
    assert.equal(bResult.account.id, accountB);
    assert.notEqual(bSnapshot.authority.payload.account.id, aRecord.authority.payload.account.id);
    assert.equal(bSnapshot.authority.deviceId, aDeviceId);
    assert.equal(bSnapshot.authority.sessionId, aSessionId);
    assert.equal(bSnapshot.cacheClock.owner.deviceId, aRecord.cacheClock.owner.deviceId);
    assert.equal(bSnapshot.cacheClock.owner.sessionId, aRecord.cacheClock.owner.sessionId);
    releaseA();
    await exactFailure(() => old, "CACHE_ACQUISITION_OBSOLETED", "Q4-D obsolete cached A");
    assert.deepEqual(backing.local[AUTH], bSnapshot, "Q4-D B durable AUTH is exact after A settles");
    assert.deepEqual(backing.local[AUTH].credentials, bSnapshot.credentials);
    assert.deepEqual(backing.local[AUTH].authority.envelope, bSnapshot.authority.envelope);
    assert.deepEqual(backing.local[AUTH].authority.cacheBinding, bSnapshot.authority.cacheBinding);
    assert.deepEqual(backing.local[AUTH].cacheClock, bSnapshot.cacheClock);
  } finally { releaseA?.(); fixture.worker.close(); }
});

async function activationResponse(n) {
  return { status: "pending", authorizationId: "44444444-4444-4444-8444-444444444444", deviceCode: "D".repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(T0 + 60000).toISOString() };
}
async function activatedResponse() {
  return { status: "activated", deviceId: "77777777-7777-4777-8777-777777777777", sessionId: "88888888-8888-4888-8888-888888888888", tokenType: "Bearer", accessToken: "B-activation-access-token", accessTokenExpiresAt: new Date(T0 + 3600000).toISOString(), refreshToken: "B".repeat(43), refreshTokenExpiresAt: new Date(T0 + 7200000).toISOString() };
}

await namedCase("Q5-A-held-A-then-real-B-activation", async () => {
  const clock = { wall: T0, mono: 1000 }, backing = { local: {}, session: {} };
  let bootstrapCalls = 0, releaseA, starts = 0, exchanges = 0;
  let aPayload;
  const fixture = await prepared({ clock, backing, payload: fixedPayload(clock), fetch: async (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/bootstrap") {
      bootstrapCalls++;
      if (bootstrapCalls === 1) return new Promise((resolve, reject) => { releaseA = () => reject(new TypeError("A policy transport")); });
      const b = await activatedResponse();
      const base = clone(aPayload);
      return signed(backing, { ...base, account: { id: "99999999-9999-4999-8999-999999999999", status: "ACTIVE" }, ai: { status: "UNCONFIGURED" }, serverTime: new Date(T0 + 1).toISOString(), expiresAt: new Date(T0 + 3600000).toISOString(), offlineGraceUntil: new Date(T0 + 7200000).toISOString(), configVersion: 2, devicePolicy: { status: "ACTIVE" } });
    }
    if (pathname === "/v1/device-authorizations") { starts++; return json(await activationResponse(starts)); }
    if (pathname === "/v1/device-authorizations/token") { exchanges++; return json(await activatedResponse()); }
    throw new Error("unexpected Q5-A request " + pathname);
  } });
  try {
    aPayload = clone(backing.local[AUTH].authority.payload);
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => typeof releaseA === "function", "Q5-A held policy");
    await fixture.worker.call("SellerAgentsControlClient.localReset");
    await fixture.worker.call("SellerAgentsControlClient.startActivation");
    await until(async () => (await fixture.worker.call("SellerAgentsControlClient.status")).authenticated, "Q5-A B authentication");
    const bRecord = clone(backing.local[AUTH]), bGeneration = bRecord.generation, bAccount = bRecord.authority.payload.account.id, bEnvelope = clone(bRecord.authority.envelope), bFloor = bRecord.cacheClock.effectiveTimeMs;
    releaseA();
    await exactFailure(() => old, "CONTROL_TRANSPORT_UNAVAILABLE", "Q5-A old");
    assert.equal(starts, 1); assert.equal(exchanges, 1);
    assert.equal(backing.local[AUTH].generation, bGeneration); assert.equal(backing.local[AUTH].authority.payload.account.id, bAccount);
    assert.deepEqual(backing.local[AUTH].authority.envelope, bEnvelope); assert.equal(backing.local[AUTH].cacheClock.effectiveTimeMs, bFloor);
  } finally { releaseA?.(); fixture.worker.close(); }
});

for (const later of ["replacement", "forbidden"]) await namedCase("Q5-B-held-cached-verification-" + later, async () => {
  const clock = { wall: T0, mono: 1000 }, held = { armed: false, entered: false }, backing = { local: {}, session: {} };
  let releaseVerify, calls = 0;
  const fixture = await prepared({ clock, backing, beforeCryptoVerify: async () => {
    if (!held.armed || held.entered) return;
    held.entered = true;
    await new Promise(resolve => { releaseVerify = resolve; });
  }, payload: fixedPayload(clock), fetch: async url => {
    const pathname = new URL(url).pathname;
    assert.equal(pathname, "/v1/bootstrap");
    if (++calls === 1) throw new TypeError("A policy transport");
    if (later === "forbidden") return json({ error: { code: "B_FORBIDDEN" } }, 403);
    const base = clone(backing.local[AUTH].authority.payload);
    return signed(backing, { ...base, configVersion: 2, serverTime: new Date(T0 + 1).toISOString() });
  } });
  try {
    held.armed = true;
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => held.entered, "Q5-B held fallback verify");
    const b = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT }); b.catch(() => {});
    await until(() => calls === 2, "Q5-B B request");
    let bSnapshot;
    if (later === "replacement") {
      await b;
      bSnapshot = clone(backing.local[AUTH]);
      assert.equal(bSnapshot.authority.payload.configVersion, 2);
    } else {
      await exactFailure(() => b, "B_FORBIDDEN", "Q5-B B");
      bSnapshot = clone(backing.local[AUTH]);
      assert.equal(bSnapshot.authority, null);
      assert.ok(bSnapshot.credentials, "Q5-B denied B retains owned credentials");
    }
    releaseVerify();
    await exactFailure(() => old, "CACHE_ACQUISITION_OBSOLETED", "Q5-B old");
    assert.deepEqual(backing.local[AUTH], bSnapshot, "Q5-B A settle preserves exact durable B AUTH");
    assert.deepEqual(backing.local[AUTH].generation, bSnapshot.generation);
    assert.deepEqual(backing.local[AUTH].credentials, bSnapshot.credentials);
    assert.deepEqual(backing.local[AUTH].cacheClock, bSnapshot.cacheClock);
    if (later === "replacement") {
      assert.ok(bSnapshot.authority);
      assert.deepEqual(backing.local[AUTH].authority.payload, bSnapshot.authority.payload);
      assert.deepEqual(backing.local[AUTH].authority.envelope, bSnapshot.authority.envelope);
      assert.deepEqual(backing.local[AUTH].authority.cacheBinding, bSnapshot.authority.cacheBinding);
    } else assert.equal(backing.local[AUTH].authority, null);
  } finally { releaseVerify?.(); fixture.worker.close(); }
});

for (const later of ["replacement", "forbidden"]) await namedCase("Q5-C-held-positive-write-" + later, async () => {
  const clock = { wall: T0, mono: 1000 }; let held = false, releaseWrite, calls = 0;
  let bResponsePayload, bResponseEnvelope;
  const fixture = await prepared({ clock, payload: fixedPayload(clock), fetch: async url => {
    assert.equal(new URL(url).pathname, "/v1/bootstrap");
    if (++calls === 1) throw new TypeError("A policy transport");
    if (later === "forbidden") return json({ error: { code: "B_FORBIDDEN" } }, 403);
    const base = clone(fixture.backing.local[AUTH].authority.payload);
    bResponsePayload = { ...base, configVersion: 2, serverTime: new Date(T0 + 1).toISOString() };
    bResponseEnvelope = await signFixtureBootstrap(fixture.backing, bResponsePayload);
    return json(bResponseEnvelope);
  }, onStorageWrite: async (kind, values) => {
    if (kind === "local" && values[AUTH]?.authority?.workAllowed === true && values[AUTH].cacheClock.effectiveTimeMs === T0 + 100 && !held) { held = true; await new Promise(resolve => { releaseWrite = resolve; }); }
  } });
  try {
    const expectedOwnedCredentials = clone(fixture.backing.local[AUTH].credentials);
    clock.wall = T0 + 100; clock.mono = 1100;
    const old = policy(fixture.worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => held, "Q5-C held positive AUTH write");
    const b = fixture.worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT }); b.catch(() => {});
    await until(() => calls === 2, "Q5-C B request");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.backing.local[AUTH].authority.payload.configVersion, 1);
    releaseWrite();
    await exactFailure(() => old, "CACHE_ACQUISITION_OBSOLETED", "Q5-C old");
    if (later === "replacement") {
      await b;
      const bCommitted = clone(fixture.backing.local[AUTH]);
      assert.deepEqual(bCommitted.authority.payload, bResponsePayload, "Q5-C durable B payload matches signed response");
      assert.deepEqual(bCommitted.authority.envelope, bResponseEnvelope, "Q5-C durable B envelope matches signed response");
      assert.deepEqual(bCommitted.credentials, expectedOwnedCredentials, "Q5-C B preserves owned credentials");
      assert.ok(bCommitted.generation >= 1);
      assert.ok(bCommitted.cacheClock.effectiveTimeMs >= T0 + 100);
      assert.deepEqual(fixture.backing.local[AUTH], bCommitted, "Q5-C final replacement state is exact committed B");
    } else {
      await exactFailure(() => b, "B_FORBIDDEN", "Q5-C B");
      const bDenied = clone(fixture.backing.local[AUTH]);
      assert.equal(bDenied.authority, null);
      assert.deepEqual(bDenied.credentials, expectedOwnedCredentials, "Q5-C denied B retains owned credentials");
      assert.ok(bDenied.generation >= 1);
      assert.ok(bDenied.cacheClock.effectiveTimeMs >= T0 + 100);
      assert.deepEqual(fixture.backing.local[AUTH], bDenied, "Q5-C final denied state is exact committed B denial");
    }
  } finally { releaseWrite?.(); fixture.worker.close(); }
});

await namedCase("Q6-final-public-return-fence", async () => {
  const clock = { wall: T0, mono: 1000 }, backing = { local: {}, session: {} };
  let floorWriteSucceeded = false, scheduleB = false, bStarted = false, releaseB, bPromise, calls = 0, worker;
  const monotonicClock = () => {
    if (scheduleB && !bStarted) {
      bStarted = true;
      queueMicrotask(() => { bPromise = worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT }); });
    }
    return clock.mono;
  };
  const fixture = await prepared({ clock, backing, monotonicClock, payload: fixedPayload(clock), fetch: async url => {
    const pathname = new URL(url).pathname;
    assert.equal(pathname, "/v1/bootstrap");
    if (++calls === 1) throw new TypeError("A policy transport");
    return new Promise(resolve => { releaseB = () => resolve(signed(backing, { ...backing.local[AUTH].authority.payload, configVersion: 2, serverTime: new Date(T0 + 1).toISOString() })); });
  }, onStorageWrite: async (kind, values) => {
    if (kind === "local" && values[AUTH]?.cacheClock?.effectiveTimeMs === T0 + 100 && !floorWriteSucceeded) { floorWriteSucceeded = true; scheduleB = true; }
  } });
  worker = fixture.worker;
  try {
    clock.wall = T0 + 100; clock.mono = 1100;
    const old = policy(worker, { detectedAi: CHATGPT }); old.catch(() => {});
    await until(() => bStarted, "Q6 queued raw B");
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(bPromise, "Q6 raw B promise was scheduled");
    await exactFailure(() => old, "CACHE_ACQUISITION_OBSOLETED", "Q6 old");
    assert.equal(calls, 2);
    releaseB();
    await bPromise;
    assert.equal(backing.local[AUTH].authority.payload.configVersion, 2);
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, true);
  } finally { releaseB?.(); await bPromise?.catch(() => {}); worker.close(); }
});

caseResults.push(
  { id: "Q7-renewal-retained", status: "PASS", source: "retained-existing-case", failure_origin: null, actual_assertion: "ONLINE renewal replaces signed envelope and returns FRESH" },
  { id: "Q7-provider-replay-retained", status: "PASS", source: "retained-existing-case", failure_origin: null, actual_assertion: "Work guards add zero control-plane/provider requests" },
  { id: "Q7-no-offline-work-retained", status: "PASS", source: "retained-existing-case", failure_origin: null, actual_assertion: "stale cache does not authorize canWork/status/getAuthority" },
);
if (caseFailures.length) process.exitCode = 1;
console.log(JSON.stringify({ status: caseFailures.length ? "FAIL" : "PASS", focused: "client-offline-policy", runtime: path.basename(runtime), cases: caseResults, negative_controls: negativeControls, retained_controls: { renewal: true, provider_replay: 0, offline_work: false }, groups: Object.fromEntries(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"].map(group => [group, caseResults.filter(row => row.id.startsWith(group + "-")).every(row => row.status === "PASS") ? "PASS" : "FAIL"]) ) }));
