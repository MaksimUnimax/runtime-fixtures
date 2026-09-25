import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const detectedAi = { family: "chatgpt", surface: "web", variant: null };
const receiptKey = "seller_agents_metadata_clear_receipt_v1";
const pendingKey = "seller_agents_pending_metadata_clear_v1";
const deviceId = "22222222-2222-4222-8222-222222222222";
const firefox = "Mozilla/5.0 Gecko/20100101 Firefox/156.0";
const canonical = value => value === null ? "null" : Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" : typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);
const response = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const permissions = grants => ({ getAll: async () => ({ data_collection: [...grants] }) });
const cleared = () => response({ status: "cleared", deviceId });
const forgets = worker => worker.controlNetwork.filter(row => row.url.endsWith("/v1/devices/current/client-metadata/forget")).length;
const drain = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
async function identified(worker, contract = "control_plane_v2") {
  const payload = structuredClone(worker.backing.local.seller_agents_control_auth_v2.authority.payload);
  payload.ai.profile.compatibility.contractVersion = contract;
  payload.ai.profile.contentSha256 = createHash("sha256").update(canonical({ content: payload.ai.profile.content, compatibility: payload.ai.profile.compatibility })).digest("hex");
  return signFixtureBootstrap(worker.backing, payload);
}
const passed = [];
for (const [browser, userAgent] of [
  ["opera", "Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 OPR/136.0.0.0"],
  ["chrome", "Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36"],
  ["firefox", firefox],
]) {
  for (const contract of ["control_plane_v1", "control_plane_v2", "control_plane_v3"]) {
    let envelope;
    const options = { userAgent, firefoxPermissions: permissions(new Set(["technicalAndInteraction"])), fetch: async url => {
      if (url.endsWith("/v1/bootstrap")) return response(envelope);
      throw new Error("unexpected request");
    } };
    const worker = await makeWorker(runtime, options);
    try {
      envelope = await identified(worker, contract);
      if (contract === "control_plane_v3") {
        await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap", { detectedAi }), /BOOTSTRAP_PROFILE_INCOMPATIBLE/);
      } else {
        const payload = await worker.call("SellerAgentsControlClient.bootstrap", { detectedAi });
        assert.equal(payload.ai.profile.compatibility.contractVersion, contract);
        assert.equal(await worker.call("SellerAgentsControlClient.canWork"), true);
        const backing = worker.backing;
        worker.close();
        const restarted = await makeWorker(runtime, { ...options, backing, seedAuthority: false });
        try { assert.equal(await restarted.call("SellerAgentsControlClient.canWork"), true, "signed current/legacy identified profile survives restore"); }
        finally { restarted.close(); }
      }
      passed.push(browser + ":" + contract);
    } finally { worker.close(); }
  }
}
{
  const grants = new Set();
  let envelope;
  const options = { userAgent: firefox, firefoxPermissions: permissions(grants), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) return cleared();
    if (url.endsWith("/v1/bootstrap")) return response(envelope);
    throw new Error("unexpected request");
  } };
  const worker = await makeWorker(runtime, options);
  try {
    envelope = await identified(worker);
    for (let i = 0; i < 5; i++) {
      assert.equal(await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }), null);
      await drain();
    }
    assert.equal(forgets(worker), 1, "completed clear must not repeat on every local check");
    assert.equal(worker.backing.local[pendingKey], undefined);
    assert.equal(worker.backing.local[receiptKey].deviceId, deviceId);
    const restarted = await makeWorker(runtime, { ...options, backing: worker.backing, seedAuthority: false });
    try {
      await restarted.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain();
      assert.equal(forgets(restarted), 0, "clear acknowledgement survives worker restart");
      grants.add("technicalAndInteraction");
      await restarted.call("SellerAgentsControlClient.bootstrap", { detectedAi });
      assert.equal(restarted.backing.local[receiptKey], undefined, "identified send invalidates clear acknowledgement");
      grants.clear();
      await restarted.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain();
      assert.equal(forgets(restarted), 1, "new withdrawal performs a fresh clear");
    } finally { restarted.close(); }
    passed.push("clear_dedup_restart_and_regrant");
  } finally { worker.close(); }
}
{
  let clock = Date.now();
  const worker = await makeWorker(runtime, { userAgent: firefox, wallClock: () => clock, firefoxPermissions: permissions(new Set()), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) throw new Error("offline");
    throw new Error("unexpected request");
  } });
  try {
    for (let i = 0; i < 5; i++) { await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain(); }
    assert.equal(forgets(worker), 1, "failed clearing has bounded retry, even when status is called repeatedly");
    assert.equal(worker.backing.local[pendingKey].deviceId, deviceId);
    clock += 60001;
    await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain();
    assert.equal(forgets(worker), 2, "later ordinary activity retries pending clearing");
    passed.push("clear_offline_retry_cooldown");
  } finally { worker.close(); }
}
{
  const grants = new Set();
  let envelope, releaseClear, count = 0;
  const worker = await makeWorker(runtime, { userAgent: firefox, firefoxPermissions: permissions(grants), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) {
      count++;
      if (count === 1) return new Promise(resolve => { releaseClear = () => resolve(cleared()); });
      return cleared();
    }
    if (url.endsWith("/v1/bootstrap")) return response(envelope);
    throw new Error("unexpected request");
  } });
  try {
    envelope = await identified(worker);
    await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi });
    await until(() => releaseClear, "clear started");
    grants.add("technicalAndInteraction");
    await worker.call("SellerAgentsControlClient.bootstrap", { detectedAi });
    releaseClear(); await drain();
    assert.equal(worker.backing.local[receiptKey], undefined, "late clear cannot acknowledge newer identified transmission");
    grants.clear();
    await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain();
    assert.equal(forgets(worker), 2);
    assert.equal(worker.backing.local[receiptKey].deviceId, deviceId);
    passed.push("late_clear_vs_identified_send");
  } finally { releaseClear?.(); worker.close(); }
}
{
  const backing = { local: { [receiptKey]: { version: "client_metadata_cleared_v1", deviceId: "99999999-9999-4999-8999-999999999999" } }, session: {} };
  const worker = await makeWorker(runtime, { backing, userAgent: firefox, firefoxPermissions: permissions(new Set()), fetch: async url => {
    if (url.endsWith("/v1/devices/current/client-metadata/forget")) return cleared();
    throw new Error("unexpected request");
  } });
  try {
    await worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi }); await drain();
    assert.equal(forgets(worker), 1, "another device acknowledgement cannot suppress current clear");
    passed.push("device_scoped_clear_receipt");
  } finally { worker.close(); }
}
console.log(JSON.stringify({ status: "PASS", cases: passed }));
