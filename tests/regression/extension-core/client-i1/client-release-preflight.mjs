/* SOURCE tests; synthetic identities and network only. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { test } from "node:test";

const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, "packages/control-client/src/client.js"), "utf8");
const storageKey = "seller_agents_control_auth_v2";
const account = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const apiOrigin = "https://control.example.test";
const portalOrigin = "https://portal.example.test";
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const future = () => new Date(Date.now() + 3600000).toISOString();
function fixture(options = {}) {
  const credentials = {
    deviceId: device, sessionId: session, tokenType: "Bearer",
    accessToken: "synthetic-old-access-token",
    accessTokenExpiresAt: options.fresh ? future() : new Date(Date.now() - 60000).toISOString(),
    refreshToken: "r".repeat(43), refreshTokenExpiresAt: future(),
  };
  const storage = options.storage || { [storageKey]: {
    generation: 0, credentials, pending: null, rotation: null, authority: null, lastError: null,
    cacheClock: { cacheVersion: "control_cache_clock_v1",
      owner: { controlApiOrigin: apiOrigin, portalOrigin, contractVersion: "control_plane_v2", deviceId: device, sessionId: session },
      trustedServerTimeMs: 0, effectiveTimeMs: Date.now(),
    },
  } };
  const calls = [];
  const rotated = { tokenType: "Bearer", accessToken: "synthetic-new-access-token",
    accessTokenExpiresAt: future(), refreshToken: "s".repeat(43), refreshTokenExpiresAt: future() };
  const payload = { contractVersion: "control_plane_v2", snapshotVersion: "bootstrap_snapshot_v2",
    account: { id: options.wrongAccount ? device : account, status: "ACTIVE" }, ai: { status: "UNCONFIGURED" },
    serverTime: new Date().toISOString(), expiresAt: options.expiredProof ? new Date(0).toISOString() : future(),
    compatibility: { extension: { status: "UPDATE_REQUIRED" } },
  };
  const envelope = { envelopeVersion: "bootstrap_envelope_v2", payload, signature: "synthetic" };
  const box = vm.createContext({
    crypto: webcrypto, Headers, URL, AbortController, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, queueMicrotask, performance, Date,
    SellerAgentsControlConfig: { controlApiOrigin: apiOrigin, portalOrigin, contractVersion: "control_plane_v2", extensionVersion: "0.2.11", trustBundle: {} },
    SellerAgentsBrowserIdentity: { families: ["opera"], current: () => ({ family: "opera", version: "136.0.0.0" }) },
    SellerAgentsBootstrapVerifier: { canonicalJson: JSON.stringify, verifyV2: async raw =>
      options.badSignature ? { ok: false } : { ok: true, payload: raw.payload, envelope: raw } },
    SellerAgentsCredentialTransferVault: { clear: async () => {}, prune: async () => {} },
    chrome: { storage: { local: {
      get: async key => ({ [key]: copy(storage[key]) }),
      set: async values => {
        const next = values[storageKey];
        if (options.failRotatedSave && next?.credentials?.accessToken === rotated.accessToken && next.rotation === null)
          throw new Error("SYNTHETIC_STORAGE_FAILURE");
        Object.assign(storage, copy(values));
      },
      remove: async key => { delete storage[key]; },
    } } },
    fetch: async (url, request) => {
      const call = { path: new URL(url).pathname, body: JSON.parse(request.body || "null"),
        authorization: request.headers.get("authorization"), idempotency: request.headers.get("Idempotency-Key") };
      calls.push(call);
      if (call.path === "/v1/auth/refresh") {
        assert.equal(storage[storageKey].rotation.idempotencyKey, call.idempotency);
        if (options.refresh) return options.refresh(call, rotated);
        if (options.revoked) return Response.json({ error: { code: "AUTH_REFRESH_INVALID" } }, { status: 401 });
        return Response.json(rotated);
      }
      if (call.path === "/v1/bootstrap") {
        if (options.bootstrap) return options.bootstrap(call, envelope);
        assert.equal(call.authorization, "Bearer " + storage[storageKey].credentials.accessToken);
        return Response.json(envelope);
      }
      throw new Error("UNEXPECTED_NETWORK_PATH");
    },
  });
  vm.runInContext(source, box, { timeout: 1000 });
  const input = { expectedAccountId: account, request: {
    contractVersion: "control_plane_v2", extensionVersion: "0.2.11",
    browser: { family: "opera", version: "136.0.0.0" }, deviceId: device, lastConfigVersion: null,
  } };
  return { client: box.SellerAgentsControlClient, storage, calls, input, rotated, envelope };
}
test("expired access uses and persists normal refresh before signed bootstrap; no Work grant or secret output", async () => {
  const f = fixture();
  const result = await f.client.acquireBootstrapPreflight(f.input);
  assert.deepEqual(f.calls.map(x => x.path), ["/v1/auth/refresh", "/v1/bootstrap"]);
  assert.equal(f.storage[storageKey].credentials.refreshToken, f.rotated.refreshToken);
  assert.equal(f.storage[storageKey].rotation, null);
  assert.equal(f.storage[storageKey].authority, null);
  assert.equal(result.authenticatedContext.accountId, account);
  assert.equal((await f.client.status()).workAllowed, false);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-old-access|synthetic-new-access|rrrrrrrr|ssssssss/);
});
test("fresh access is reused and subsequent process restart does not register a device", async () => {
  const first = fixture();
  await first.client.acquireBootstrapPreflight(first.input);
  const second = fixture({ storage: first.storage });
  await second.client.acquireBootstrapPreflight(second.input);
  assert.deepEqual(second.calls.map(x => x.path), ["/v1/bootstrap"]);
  assert.equal(second.storage[storageKey].credentials.sessionId, session);
});
test("server committed refresh but reply lost: restart reuses persisted idempotency marker", async () => {
  const keys = [];
  const first = fixture({ refresh: async call => { keys.push(call.idempotency); throw new Error("SYNTHETIC_CONNECTION_LOSS"); } });
  await assert.rejects(() => first.client.acquireBootstrapPreflight(first.input));
  const persistedKey = first.storage[storageKey].rotation.idempotencyKey;
  const second = fixture({ storage: first.storage, refresh: async (call, rotated) => {
    keys.push(call.idempotency); return Response.json(rotated);
  } });
  await second.client.acquireBootstrapPreflight(second.input);
  assert.equal(new Set(keys).size, 1);
  assert.equal(keys[0], persistedKey);
  assert.equal(second.storage[storageKey].rotation, null);
});
test("failed durable rotation save blocks bootstrap; restart recovers through same rotation", async () => {
  const first = fixture({ failRotatedSave: true });
  await assert.rejects(() => first.client.acquireBootstrapPreflight(first.input), /SYNTHETIC_STORAGE_FAILURE/);
  assert.deepEqual(first.calls.map(x => x.path), ["/v1/auth/refresh"]);
  const key = first.storage[storageKey].rotation.idempotencyKey;
  const second = fixture({ storage: first.storage });
  await second.client.acquireBootstrapPreflight(second.input);
  assert.equal(second.calls[0].idempotency, key);
});
test("concurrent probes share the installed client's refresh transaction", async () => {
  const f = fixture();
  await Promise.all([f.client.acquireBootstrapPreflight(f.input), f.client.acquireBootstrapPreflight(f.input)]);
  assert.equal(f.calls.filter(x => x.path === "/v1/auth/refresh").length, 1);
});
test("missing and pending authentication never start device issuance", async () => {
  for (const pending of [false, true]) {
    const f = fixture();
    if (pending) f.storage[storageKey].pending = { phase: "starting" };
    else f.storage[storageKey].credentials = null;
    await assert.rejects(() => f.client.acquireBootstrapPreflight(f.input), /PREFLIGHT_EXISTING_SESSION_REQUIRED/);
    assert.equal(f.calls.length, 0);
  }
});
test("candidate, device, browser, and extra request fields are rejected before network", async () => {
  const changes = [
    x => { x.request.extensionVersion = "0.2.12"; },
    x => { x.request.deviceId = account; },
    x => { x.request.browser.family = "chrome"; },
    x => { x.request.browser.version = "135"; },
    x => { x.request.lastConfigVersion = 5; },
    x => { x.request.detectedAi = { family: "chatgpt" }; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.input);
    await assert.rejects(() => f.client.acquireBootstrapPreflight(f.input), /PREFLIGHT_CONTEXT_MISMATCH/);
    assert.equal(f.calls.length, 0);
  }
});
test("wrong stored origin never sends credentials", async () => {
  const f = fixture();
  f.storage[storageKey].cacheClock.owner.controlApiOrigin = "https://other.example.test";
  await assert.rejects(() => f.client.acquireBootstrapPreflight(f.input));
  assert.equal(f.calls.length, 0);
});
test("revoked refresh fails without bootstrap or replacement registration", async () => {
  const f = fixture({ revoked: true });
  await assert.rejects(() => f.client.acquireBootstrapPreflight(f.input), /AUTH_REFRESH_INVALID/);
  assert.deepEqual(f.calls.map(x => x.path), ["/v1/auth/refresh"]);
  assert.equal(f.storage[storageKey].credentials, null);
});
test("bad signature, wrong account and stale signed response fail closed", async () => {
  for (const [option, code] of [["badSignature", "PREFLIGHT_SIGNATURE_INVALID"], ["wrongAccount", "PREFLIGHT_SIGNED_CONTEXT_MISMATCH"], ["expiredProof", "PREFLIGHT_SIGNATURE_EXPIRED"]]) {
    const f = fixture({ fresh: true, [option]: true });
    await assert.rejects(() => f.client.acquireBootstrapPreflight(f.input), new RegExp(code));
    assert.equal(f.storage[storageKey].authority, null);
  }
});
test("logout during bootstrap prevents a late proof escaping", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture({ fresh: true, bootstrap: async (_, envelope) => {
    started(); await new Promise(resolve => { release = resolve; }); return Response.json(envelope);
  } });
  const run = f.client.acquireBootstrapPreflight(f.input);
  await ready; await f.client.localReset(); release();
  await assert.rejects(() => run, /AUTH_GENERATION_CHANGED/);
});

test("caller mutation after validation cannot change account or sent candidate", async () => {
  const f = fixture({ fresh: true });
  const run = f.client.acquireBootstrapPreflight(f.input);
  f.input.expectedAccountId = device;
  f.input.request.extensionVersion = "mutated";
  f.input.request.detectedAi = { family: "chatgpt" };
  f.input.request.browser.family = "mutated";
  const result = await run;
  assert.equal(result.authenticatedContext.accountId, account);
  assert.equal(f.calls[0].body.extensionVersion, "0.2.11");
  assert.equal(f.calls[0].body.browser.family, "opera");
  assert.equal(f.calls[0].body.detectedAi, undefined);
});
