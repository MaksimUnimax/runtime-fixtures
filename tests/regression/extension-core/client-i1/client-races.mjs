import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const uuid = (n) => n + "0000000-0000-4000-8000-" + n + "00000000000";
const pendingStart = { status: "pending", authorizationId: uuid("4"), deviceCode: "A".repeat(43), userCode: "ABCD-EFGH", expiresAt: new Date(Date.now() + 60_000).toISOString() };
const httpError = (code, status) => new Response(JSON.stringify({ error: { code } }), { status, headers: { "content-type": "application/json" } });
const refreshed = () => new Response(JSON.stringify({ tokenType: "Bearer", accessToken: "refresh_access_token", accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: "C".repeat(43), refreshTokenExpiresAt: new Date(Date.now() + 7200000).toISOString() }), { headers: { "content-type": "application/json" } });

{
  let release;
  const worker = await makeWorker(runtime, { seedAuthority: false, fetch: async (url) => {
    if (url.endsWith("/v1/device-authorizations")) return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify(pendingStart), { headers: { "content-type": "application/json" } })); });
    throw new Error("unexpected request " + url);
  } });
  try {
    const start = worker.call("SellerAgentsControlClient.startActivation");
    await until(() => release, "device-start dispatch");
    await worker.call("SellerAgentsControlClient.cancelActivation");
    release();
    await start;
    await new Promise(resolve => setTimeout(resolve, 20));
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.pending, null);
    assert.equal(status.authenticated, false);
    assert.equal(worker.portalTabs.length, 0);
    assert.equal(worker.network.filter(row => row.url.endsWith("/v1/device-authorizations/token")).length, 0);
  } finally { release?.(); worker.close(); }
}

{
  let release;
  const worker = await makeWorker(runtime, { fetch: async (url) => {
    if (url.endsWith("/v1/bootstrap")) return new Promise(resolve => { release = () => resolve(httpError("UNAUTHORIZED", 401)); });
    if (url.endsWith("/v1/auth/refresh")) return refreshed();
    throw new Error("unexpected request " + url);
  } });
  try {
    const bootstrap = worker.call("SellerAgentsControlClient.bootstrap");
    await until(() => release, "bootstrap dispatch");
    await worker.call("SellerAgentsControlClient.localReset");
    release();
    // R3 retires the old acquisition at logout; its late 401 is not a new-principal denial.
    await assert.rejects(bootstrap, { code: "BOOTSTRAP_CONTEXT_CHANGED" });
    assert.equal(worker.controlNetwork.filter(item => item.url.endsWith("/v1/auth/refresh")).length, 0);
    const status = await worker.call("SellerAgentsControlClient.status");
    assert.equal(status.authenticated, false);
    assert.equal(status.accountId, null);
  } finally { release?.(); worker.close(); }
}

{
  let release;
  const backing = { local: {}, session: {} };
  let expireSeedToken = true;
  const workerA = await makeWorker(runtime, { backing, fetch: async (url) => {
    if (url.endsWith("/v1/auth/refresh")) return new Promise(resolve => { release = () => resolve(httpError("AUTH_REFRESH_INVALID", 401)); });
    throw new Error("unexpected request " + url);
  }, onStorageRead: (kind, keys) => {
    if (expireSeedToken && kind === "local" && String(keys).includes("seller_agents_control_auth_v2") && backing.local.seller_agents_control_auth_v2) {
      // Expire the initial fixture once. Mutating each read also corrupts commit readback,
      // which is a separate storage-failure scenario and must remain fail-closed.
      expireSeedToken = false;
      backing.local.seller_agents_control_auth_v2.credentials.accessTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
    }
  } });
  let workerB;
  try {
    const oldRefresh = workerA.call("SellerAgentsControlClient.refresh");
    await until(() => release, "account A refresh dispatch");
    await workerA.call("SellerAgentsControlClient.localReset");
    delete backing.local.seller_agents_control_auth_v2;
    workerB = await makeWorker(runtime, { backing, accountId: "99999999-9999-4999-8999-999999999999" });
    assert.equal((await workerB.call("SellerAgentsControlClient.status")).accountId, "99999999-9999-4999-8999-999999999999");
    release();
    await assert.rejects(oldRefresh, /AUTH_REFRESH_INVALID/);
    assert.equal(backing.local.seller_agents_control_auth_v2.authority.payload.account.id, "99999999-9999-4999-8999-999999999999");
    assert.equal((await workerB.call("SellerAgentsControlClient.status")).authenticated, true);
  } finally { release?.(); workerA.close(); workerB?.close(); }
}

console.log(JSON.stringify({ status: "PASS", cancelled_start_fenced: true, bootstrap_unauthorized_clears_authority: true, old_refresh_cannot_clear_new_account: true }));
