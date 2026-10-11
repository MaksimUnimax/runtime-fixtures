import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const refreshKeys = [];
const future = (ms) => new Date(Date.now() + ms).toISOString();
const backing = { local: {}, session: {} };
let expireSeedToken = true;
const worker = await makeWorker(runtime, {
  backing,
  onStorageRead: (kind, keys) => {
    if (expireSeedToken && kind === "local" && String(keys).includes("seller_agents_control_auth_v2") && backing.local.seller_agents_control_auth_v2) {
      expireSeedToken = false;
      backing.local.seller_agents_control_auth_v2.credentials.accessTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
    }
  },
  fetch: async (url, init) => {
    if (!url.endsWith("/v1/auth/refresh")) throw new Error("unexpected control request: " + url);
    refreshKeys.push(init.headers.get("Idempotency-Key"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ tokenType: "Bearer", accessToken: "refreshed_access_token", accessTokenExpiresAt: future(3600000), refreshToken: "B".repeat(43), refreshTokenExpiresAt: future(7200000) }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
try {
  const [one, two] = await Promise.all([worker.call("SellerAgentsControlClient.refresh"), worker.call("SellerAgentsControlClient.refresh")]);
  assert.equal(one.accessToken, "refreshed_access_token");
  assert.equal(two.refreshToken, "B".repeat(43));
  assert.equal(refreshKeys.length, 1, "one installation has one refresh flight");
  assert.ok(Date.parse(backing.local.seller_agents_control_auth_v2.credentials.accessTokenExpiresAt) > Date.now(),
    "refreshed expiry remains durable after the real readback check");
  assert.ok(refreshKeys[0]);
  assert.equal(JSON.stringify(await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId })).includes("refreshed_access_token"), false);
  console.log(JSON.stringify({ status: "PASS", refresh_singleflight: true, stable_idempotency: true, privileged_secrets_hidden: true }));
} finally {
  worker.close();
}
