import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH_KEY = "seller_agents_control_auth_v2";
const future = (ms) => new Date(Date.now() + ms).toISOString();
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const account = (n) => uuid(String(n));
const canonical = value => value === null ? "null" : typeof value === "boolean" ? (value ? "true" : "false") : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" ? String(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const fingerprint = (content, compatibility) => createHash("sha256").update(canonical({ content, compatibility })).digest("hex");

async function template(runtime) {
  const backing = { local: {}, session: {} };
  const seeded = await makeWorker(runtime, { backing });
  const payload = structuredClone(backing.local[AUTH_KEY].authority.payload);
  seeded.close();
  delete backing.local[AUTH_KEY];
  return { backing, payload };
}
function accountPayload(base, id, ai = base.ai) {
  return { ...structuredClone(base), account: { id, status: "ACTIVE" }, expiresAt: future(3600000), offlineGraceUntil: future(7200000), serverTime: new Date().toISOString(), ai: structuredClone(ai) };
}
async function signed(backing, payload) { return json(await signFixtureBootstrap(backing, payload)); }

// G1: two complete same-worker device sessions authenticate distinct accounts;
// UNCONFIGURED is account authority only, then an exact detected profile enables Work.
{
  const { backing, payload } = await template(runtime);
  let starts = 0, exchanges = 0;
  const worker = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async (url, init) => {
    if (url.endsWith("/v1/device-authorizations")) {
      starts++;
      return json({ status: "pending", authorizationId: uuid(String(starts + 10)), deviceCode: String.fromCharCode(65 + starts).repeat(43), userCode: "ABCD-EFGH", expiresAt: future(60000) });
    }
    if (url.endsWith("/v1/device-authorizations/token")) {
      exchanges++;
      return json({ status: "activated", deviceId: uuid(String(exchanges + 20)), sessionId: uuid(String(exchanges + 30)), tokenType: "Bearer", accessToken: `activation-${exchanges}-access-token`, accessTokenExpiresAt: future(3600000), refreshToken: String.fromCharCode(75 + exchanges).repeat(43), refreshTokenExpiresAt: future(7200000) });
    }
    if (url.endsWith("/v1/bootstrap")) {
      const body = JSON.parse(init.body);
      const id = body.deviceId === uuid("21") ? account(1) : account(2);
      const resolved = body.detectedAi ? payload.ai : { status: "UNCONFIGURED" };
      return signed(backing, accountPayload(payload, id, resolved));
    }
    throw new Error("unexpected control request " + url);
  } });
  try {
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(async () => (await worker.call("SellerAgentsControlClient.status")).authenticated, "account A authentication");
    const first = await worker.call("SellerAgentsControlClient.status");
    assert.equal(first.workAllowed, false);
    assert.equal(first.accountId, account(1));
    assert.equal(first.pending, null);
    const restored = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async () => { throw new Error("restored account-only worker must not poll"); } });
    try { const restoredStatus = await restored.call("SellerAgentsControlClient.status"); assert.equal(restoredStatus.authenticated, true); assert.equal(restoredStatus.workAllowed, false); assert.equal(restoredStatus.accountId, account(1)); } finally { restored.close(); }
    await worker.call("SellerAgentsControlClient.localReset");
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(async () => (await worker.call("SellerAgentsControlClient.status")).authenticated, "account B authentication");
    const second = await worker.call("SellerAgentsControlClient.status");
    assert.equal(second.accountId, account(2));
    assert.equal(second.workAllowed, false);
    assert.equal(starts, 2); assert.equal(exchanges, 2); assert.equal(worker.portalTabs.length, 2);
    await worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    assert.equal(await worker.call("SellerAgentsControlClient.currentAccount"), account(2));
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
  } finally { worker.close(); }
}

// G1 ownership race: an old exchange is held across cancel and a new start;
// releasing either an old success or failure cannot overwrite B or reopen work.
for (const oldOutcome of ["success", "failure"]) {
  const { backing, payload } = await template(runtime);
  let exchanges = 0, releaseOld;
  const worker = await makeWorker(runtime, { backing, seedAuthority: false, fetch: async (url, init) => {
    if (url.endsWith("/v1/device-authorizations")) {
      const n = ++worker.starts;
      return json({ status: "pending", authorizationId: uuid(String(n + 40)), deviceCode: String.fromCharCode(65 + n).repeat(43), userCode: "ABCD-EFGH", expiresAt: future(60000) });
    }
    if (url.endsWith("/v1/device-authorizations/token")) {
      exchanges++;
      if (exchanges === 1) return new Promise(resolve => { releaseOld = () => resolve(oldOutcome === "success" ? json({ status: "activated", deviceId: uuid("51"), sessionId: uuid("61"), tokenType: "Bearer", accessToken: "old-access-token", accessTokenExpiresAt: future(3600000), refreshToken: "O".repeat(43), refreshTokenExpiresAt: future(7200000) }) : json({ error: { code: "OLD_EXCHANGE_FAILED" } }, 500)); });
      return json({ status: "activated", deviceId: uuid("52"), sessionId: uuid("62"), tokenType: "Bearer", accessToken: "new-access-token", accessTokenExpiresAt: future(3600000), refreshToken: "N".repeat(43), refreshTokenExpiresAt: future(7200000) });
    }
    if (url.endsWith("/v1/bootstrap")) return signed(backing, accountPayload(payload, account(2), { status: "UNCONFIGURED" }));
    throw new Error("unexpected control request " + url);
  } });
  worker.starts = 0;
  try {
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(() => releaseOld, "held old exchange");
    await worker.call("SellerAgentsControlClient.cancelActivation");
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(async () => (await worker.call("SellerAgentsControlClient.status")).authenticated, "new exchange authentication");
    releaseOld();
    await new Promise(resolve => setTimeout(resolve, 20));
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.accountId, account(2)); assert.equal(state.pending, null); assert.equal(state.workAllowed, false); assert.equal(worker.portalTabs.length, 2);
  } finally { releaseOld?.(); worker.close(); }
}

// G2: a fresh bearer rejected once is rotated exactly once and retried with a
// signed operational snapshot; the durable refresh token and bearer change.
{
  const backing = { local: {}, session: {} };
  const refreshKeys = [];
  let refreshAttempts = 0;
  const worker = await makeWorker(runtime, { backing, fetch: async (url, init) => {
    if (url.endsWith("/v1/bootstrap")) {
      if (!worker.bootstrapSeen) { worker.bootstrapSeen = true; return json({ error: { code: "UNAUTHORIZED" } }, 401); }
      assert.equal(init.headers.get("Authorization"), "Bearer rotated_access_token");
      return signed(backing, backing.local[AUTH_KEY].authority.payload);
    }
    if (url.endsWith("/v1/auth/refresh")) { refreshAttempts++; refreshKeys.push(init.headers.get("Idempotency-Key")); if (refreshAttempts === 1) throw new Error("lost refresh response"); return json({ tokenType: "Bearer", accessToken: "rotated_access_token", accessTokenExpiresAt: future(3600000), refreshToken: "R".repeat(43), refreshTokenExpiresAt: future(7200000) }); }
    throw new Error("unexpected control request " + url);
  } });
  try {
    const before = backing.local[AUTH_KEY].credentials.accessToken;
    await worker.call("SellerAgentsControlClient.bootstrap");
    const after = backing.local[AUTH_KEY].credentials;
    assert.notEqual(after.accessToken, before); assert.equal(after.refreshToken, "R".repeat(43));
    assert.equal(refreshAttempts, 2); assert.equal(refreshKeys[0], refreshKeys[1]);
    assert.equal((await worker.call("SellerAgentsControlClient.status")).workAllowed, true);
  } finally { worker.close(); }
}

// G3: oversized 2xx is an invalid authority response, while an oversized 503
// remains transient and does not masquerade as signed policy denial.
for (const [status, shouldDeny] of [[200, true], [403, true], [401, true], [503, false]]) {
  const worker = await makeWorker(runtime, { fetch: async (url) => { if (url.endsWith("/v1/bootstrap")) return new Response("x".repeat(1024 * 1024 + 1), { status }); if (status === 401 && url.endsWith("/v1/auth/refresh")) return json({ tokenType: "Bearer", accessToken: "oversized-test-rotated-token", accessTokenExpiresAt: future(3600000), refreshToken: "T".repeat(43), refreshTokenExpiresAt: future(7200000) }); throw new Error("unexpected control request " + url); } });
  try {
    const initial = await worker.call("SellerAgentsControlClient.status");
    assert.equal(initial.workAllowed, true, JSON.stringify(initial));
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /CONTROL_RESPONSE_TOO_LARGE/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.authenticated, !shouldDeny, `${status} authentication classification`);
    assert.equal(state.workAllowed, !shouldDeny, `${status} Work classification`);
    if (shouldDeny) assert.equal(state.lastError.code, "CONTROL_RESPONSE_TOO_LARGE");
    else assert.equal(state.lastError, null);
  } finally { worker.close(); }
}

// G4: signed maintenance and an incompatible requested profile fail closed;
// valid signed Work is the positive control immediately before each denial.
for (const kind of ["maintenance", "requested-profile"]) {
  const { backing, payload } = await template(runtime);
  const worker = await makeWorker(runtime, { backing, fetch: async (url, init) => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected control request " + url);
    const requested = JSON.parse(init.body).detectedAi;
    const next = kind === "maintenance" ? { ...accountPayload(payload, payload.account.id), compatibility: { ...payload.compatibility, browser: { status: "MAINTENANCE" } } } : accountPayload(payload, payload.account.id);
    return signed(backing, next);
  } });
  try {
    assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: kind === "requested-profile" ? { family: "alice", surface: "web", variant: null } : { family: "chatgpt", surface: "web", variant: null } }), /BOOTSTRAP_PROFILE_INCOMPATIBLE|BOOTSTRAP_EXPIRED_OR_INCOMPATIBLE/);
    const state = await worker.call("SellerAgentsControlClient.status");
    assert.equal(state.authenticated, false); assert.equal(state.workAllowed, false); assert.equal(state.accountId, null);
  } finally { worker.close(); }
}

// G6: signed top-level/profile compatibility cases use only packaged fixture
// configuration changes, with a fresh content fingerprint and signature.
const versionCases = [
  ["equal", "0.2.4", true], ["lower-patch", "0.2.3", true], ["lower-minor", "0.1.99", true],
  ["major-transition", "1.0.0", false], ["alpha-2", "0.2.4-alpha.2", true], ["alpha-10", "0.2.4-alpha.10", true],
  ["hyphen-prerelease", "0.2.4-alpha-channel", true], ["build-metadata", "0.2.4+fixture.7", true],
  ["malformed", "0.2", false], ["large-decimal", "0.2.999999999999999999999999999999", false],
  ["top-level-equal", null, true, "0.2.4"], ["top-level-higher", null, false, "0.99.0"],
];
for (const [label, minimum, expected, topMinimum = null] of versionCases) {
  const backing = { local: {}, session: {} };
  const worker = await makeWorker(runtime, { backing, fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected version control request " + url);
    const base = structuredClone(backing.local[AUTH_KEY].authority.payload);
    const compatibility = { ...base.ai.profile.compatibility, minimumExtensionVersion: minimum };
    const profile = { ...base.ai.profile, compatibility, contentSha256: fingerprint(base.ai.profile.content, compatibility) };
    return signed(backing, { ...base, compatibility: { ...base.compatibility, extension: { ...base.compatibility.extension, minimumVersion: topMinimum } }, ai: { ...base.ai, profile } });
  } });
  try {
    const call = worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    if (expected) { try { await call; } catch (error) { throw new Error(`${label}: ${error.code || error.message}`); } assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, label); }
    else { await assert.rejects(call, /BOOTSTRAP_PROFILE_INCOMPATIBLE/); assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false, label); }
  } finally { worker.close(); }
}
for (const [label, minimum, expected] of [["browser-fourth-component", "120.0", true], ["browser-leading-zero", "0120.0.0.0", false], ["browser-out-of-range", "2147483648.0", false], ["browser-too-many-components", "120.0.0.0.0", false]]) {
  const backing = { local: {}, session: {} };
  const worker = await makeWorker(runtime, { backing, userAgent: "Mozilla/5.0 Chrome/120.0.0.0", fetch: async url => {
    if (!url.endsWith("/v1/bootstrap")) throw new Error("unexpected browser version control request " + url);
    const base = structuredClone(backing.local[AUTH_KEY].authority.payload);
    const compatibility = { ...base.ai.profile.compatibility, minimumBrowserVersions: [{ browserFamily: "chrome", minimumVersion: minimum }] };
    const profile = { ...base.ai.profile, compatibility, contentSha256: fingerprint(base.ai.profile.content, compatibility) };
    return signed(backing, { ...base, ai: { ...base.ai, profile } });
  } });
  try {
    const call = worker.call("SellerAgentsControlClient.bootstrap", { detectedAi: { family: "chatgpt", surface: "web", variant: null } });
    if (expected) { await call; assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true, label); }
    else { await assert.rejects(call, /BOOTSTRAP_PROFILE_INCOMPATIBLE/); assert.equal(await worker.call("SellerAgentsControlClient.canWork"), false, label); }
  } finally { worker.close(); }
}

// G5: denial memory closes before a failed write; successful removal is tested
// across a real worker close/restart with the same backing and no seed.
{
  const backing = { local: {}, session: {} };
  let denialObserved = false;
  const first = await makeWorker(runtime, { backing, fetch: async (url) => { assert.ok(url.endsWith("/v1/bootstrap")); denialObserved = true; return json({ error: { code: "FORBIDDEN" } }, 403); }, onStorageWrite: async (kind, values) => { if (denialObserved && kind === "local" && Object.hasOwn(values, AUTH_KEY)) throw new Error("fixture write failure"); } });
  try { await assert.rejects(first.call("SellerAgentsControlClient.bootstrap"), { code: "BOOTSTRAP_SECURITY_QUARANTINE" }); assert.equal(denialObserved, true); assert.equal((await first.call("SellerAgentsControlClient.status")).authenticated, false); } finally { first.close(); }
  const second = await makeWorker(runtime, { backing, seedAuthority: false });
  try { assert.equal((await second.call("SellerAgentsControlClient.status")).authenticated, false); assert.equal(backing.local[AUTH_KEY], undefined); } finally { second.close(); }
}

console.log(JSON.stringify({ status: "PASS", account_only_sessions: 2, distinct_accounts: true, bootstrap401_rotation: true, oversized_authority_denials: 3, transient503_preserved: true, restart_signed_out: true }));
