import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const uuid = (n) => `${n}0000000-0000-4000-8000-${n}00000000000`;
const future = (ms) => new Date(Date.now() + ms).toISOString();
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// G1: a completed attempt must not retain the old polling owner in the worker.
{
  let starts = 0, exchanges = 0;
  const worker = await makeWorker(runtime, { seedAuthority: false, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) {
      const n = ++starts;
      return response({ status: "pending", authorizationId: uuid(String(n)), deviceCode: String.fromCharCode(64 + n).repeat(43), userCode: "ABCD-EFGH", expiresAt: future(60_000) });
    }
    if (url.endsWith("/v1/device-authorizations/token")) {
      exchanges++;
      return response({ status: "activated", deviceId: uuid("2"), sessionId: uuid("3"), tokenType: "Bearer", accessToken: `attempt-${exchanges}-access-token`, accessTokenExpiresAt: future(3_600_000), refreshToken: String.fromCharCode(65 + exchanges).repeat(43), refreshTokenExpiresAt: future(7_200_000) });
    }
    if (url.endsWith("/v1/bootstrap")) return response({ error: { code: "DENIED" } }, 403);
    throw new Error("unexpected request " + url);
  } });
  try {
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(() => exchanges === 1, "first exchange");
    await worker.call("SellerAgentsControlClient.localReset");
    await worker.call("SellerAgentsControlClient.startActivation");
    await until(() => exchanges === 2, "second exchange");
    assert.equal(starts, 2);
    assert.equal(worker.portalTabs.length, 2);
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, false);
  } finally { worker.close(); }
}

// G2: the first bootstrap 401 forces one current-context rotation and retries with its new bearer.
{
  const bearers = [], routes = [];
  const worker = await makeWorker(runtime, { fetch: async (url, init) => {
    if (url.endsWith("/v1/bootstrap")) {
      bearers.push(init.headers.get("Authorization"));
      routes.push("bootstrap");
      return routes.length === 1 ? response({ error: { code: "UNAUTHORIZED" } }, 401) : response({ error: { code: "DENIED" } }, 403);
    }
    if (url.endsWith("/v1/auth/refresh")) {
      routes.push("refresh");
      return response({ tokenType: "Bearer", accessToken: "rotated_access_token", accessTokenExpiresAt: future(3_600_000), refreshToken: "R".repeat(43), refreshTokenExpiresAt: future(7_200_000) });
    }
    throw new Error("unexpected request " + url);
  } });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /DENIED/);
    assert.deepEqual(routes, ["bootstrap", "refresh", "bootstrap"]);
    assert.notEqual(bearers[0], bearers[1]);
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.authenticated, false);
    assert.equal(status.workAllowed, false);
  } finally { worker.close(); }
}

// G3: a restrictive denial closes memory before storage; removal is the fail-closed restart fallback.
{
  const backing = { local: {}, session: {} };
  let denialObserved = false;
  const worker = await makeWorker(runtime, { backing, fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) { denialObserved = true; return response({ error: { code: "FORBIDDEN" } }, 403); }
    throw new Error("unexpected request " + url);
  }, onStorageWrite: async (kind, values) => {
    if (denialObserved && kind === "local" && Object.hasOwn(values, "seller_agents_control_auth_v2")) throw new Error("fixture write failure");
  } });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), { code: "BOOTSTRAP_SECURITY_QUARANTINE" });
    assert.equal((await worker.call("SellerAgentsControlClient.status")).authenticated, false);
    assert.equal(denialObserved, true);
    assert.equal(backing.local.seller_agents_control_auth_v2, undefined);
    assert.equal((await worker.call("SellerAgentsControlClient.status")).lastError.code, "AUTH_STATE_COMMIT_UNCONFIRMED");
  } finally { worker.close(); }
}

{
  let denialObserved = false;
  const worker = await makeWorker(runtime, { fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) { denialObserved = true; return response({ error: { code: "FORBIDDEN" } }, 403); }
    throw new Error("unexpected request " + url);
  }, onStorageWrite: async (kind, values) => {
    if (denialObserved && kind === "local" && Object.hasOwn(values, "seller_agents_control_auth_v2")) throw new Error("fixture write failure");
  }, onStorageRemove: async (kind, key) => {
    if (kind === "local" && String(key) === "seller_agents_control_auth_v2") throw new Error("fixture remove failure");
  } });
  try {
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), { code: "BOOTSTRAP_SECURITY_QUARANTINE" });
    assert.equal(denialObserved, true);
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.authenticated, false);
    assert.equal(status.lastError.code, "AUTH_DENIAL_PERSISTENCE_FAILED");
  } finally { worker.close(); }
}

console.log(JSON.stringify({ status: "PASS", generation_owned_polling: true, forced_bootstrap_rotation: true, final_denial_closed: true }));
