import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
const clone = value => JSON.parse(JSON.stringify(value));
const EXPECTED = [
  "marketplace.ozon.adapter",
  "marketplace.wildberries.adapter",
  "ai.chatgpt.web.adapter",
  "ai.alice.web.adapter",
  "ai.qwen.web.adapter",
  "ai.kimi.web.adapter",
  "ai.grok.web.adapter",
  "ai.gemini.web.adapter",
  "ai.claude.web.adapter",
  "ai.deepseek.web.adapter",
].sort();

// 1. Exact packaged manifest: two marketplaces and eight reviewed AI adapters.
{
  const worker = await makeWorker(runtime);
  try {
    const manifest = clone(await worker.call("SellerAgentsPackagedCapabilities.snapshot"));
    assert.equal(manifest.schemaVersion, "packaged_capability_manifest_v1");
    assert.equal(manifest.authority, "PACKAGED_LOCAL_ONLY");
    assert.equal(manifest.executionAuthority, false);
    assert.deepEqual(manifest.signedPermissionBindings, []);
    assert.deepEqual(manifest.capabilities.map(row => row.id).sort(), EXPECTED);
    assert.ok(manifest.capabilities.every(row => row.packaged === true && row.executionAuthority === false));
    assert.deepEqual(manifest.capabilities.filter(row => row.kind === "marketplace_adapter").map(row => row.marketplace).sort(), ["ozon", "wildberries"]);
    assert.deepEqual(manifest.capabilities.filter(row => row.kind === "ai_adapter").map(row => `${row.family}:${row.surface}`).sort(), ["alice:web", "chatgpt:web", "claude:web", "deepseek:web", "gemini:web", "grok:web", "kimi:web", "qwen:web"]);
  } finally {
    worker.close();
  }
}

// 2. Lookup is strict and does not infer unknown, remote-looking, or malformed ids.
{
  const worker = await makeWorker(runtime);
  try {
    for (const id of EXPECTED) assert.equal(await worker.call("SellerAgentsPackagedCapabilities.has", id), true, id);
    for (const id of ["fixture.feature_on", "marketplace.amazon.adapter", "WORK_ALLOWED", "", "../ozon"])
      assert.equal(await worker.call("SellerAgentsPackagedCapabilities.has", id), false, id);
    assert.equal(await worker.call("SellerAgentsPackagedCapabilities.describe", "fixture.feature_on"), null);
  } finally {
    worker.close();
  }
}

// 3. Authority and every nested row are frozen, and the global authority slot
// itself is non-writable/non-configurable inside the extension realm.
{
  const worker = await makeWorker(runtime);
  try {
    const frozen = await worker.call(`(function () {
      const root = SellerAgentsPackagedCapabilities;
      const manifest = root.snapshot();
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "SellerAgentsPackagedCapabilities");
      let mutationRejected = false;
      try { manifest.capabilities.push({ id: "remote.injected", packaged: true }); }
      catch (_) { mutationRejected = true; }
      try { globalThis.SellerAgentsPackagedCapabilities = { replaced: true }; }
      catch (_) {}
      return {
        api: Object.isFrozen(root),
        manifest: Object.isFrozen(manifest),
        capabilities: Object.isFrozen(manifest.capabilities),
        rows: manifest.capabilities.every(Object.isFrozen),
        bindings: Object.isFrozen(manifest.signedPermissionBindings),
        globalWritable: descriptor.writable,
        globalConfigurable: descriptor.configurable,
        globalUnchanged: globalThis.SellerAgentsPackagedCapabilities === root,
        mutationRejected,
        count: manifest.capabilities.length,
      };
    })`);
    assert.deepEqual(clone(frozen), {
      api: true,
      manifest: true,
      capabilities: true,
      rows: true,
      bindings: true,
      globalWritable: false,
      globalConfigurable: false,
      globalUnchanged: true,
      mutationRejected: true,
      count: 10,
    });
  } finally {
    worker.close();
  }
}

// 4. Signed bootstrap metadata and packaged capability authority remain separate.
// Even signed remote keys identical to local ids are data only until a later,
// explicit binding/intersection step is designed and accepted.
{
  const backing = { local: {}, session: {} };
  const seed = await makeWorker(runtime, { backing, fetch: async (url) => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    const payload = clone(backing.local[AUTH].authority.payload);
    payload.features = { "marketplace.ozon.adapter": true };
    payload.entitlements = { "ai.chatgpt.web.adapter": true };
    return Response.json(await signFixtureBootstrap(backing, payload));
  } });
  await seed.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
  seed.close();

  const worker = await makeWorker(runtime, {
    backing,
    seedAuthority: false,
    fetch: async () => { throw new TypeError("fixture transport unavailable"); },
  });
  try {
    const metadata = clone(await worker.call("SellerAgentsControlClient.getVerifiedBootstrapMetadata", { detectedAi: CHATGPT }));
    assert.equal(metadata.signedFeatures["marketplace.ozon.adapter"], true);
    assert.equal(metadata.signedEntitlements["ai.chatgpt.web.adapter"], true);
    assert.equal(metadata.executionAuthority, false);
    const independence = clone(await worker.call(`(function () {
      const manifest = SellerAgentsPackagedCapabilities.snapshot();
      return {
        localOzon: SellerAgentsPackagedCapabilities.has("marketplace.ozon.adapter"),
        localChatgpt: SellerAgentsPackagedCapabilities.has("ai.chatgpt.web.adapter"),
        bindings: manifest.signedPermissionBindings.length,
        executionAuthority: manifest.executionAuthority,
      };
    })`));
    assert.deepEqual(independence, {
      localOzon: true,
      localChatgpt: true,
      bindings: 0,
      executionAuthority: false,
    });
  } finally {
    worker.close();
  }
}

// 5. Packaged authority is pure local package data: lookups do not touch
// storage or network after the existing control client has initialized.
{
  const io = { read: 0, write: 0, remove: 0 };
  const worker = await makeWorker(runtime, {
    onStorageRead: () => { io.read += 1; },
    onStorageWrite: () => { io.write += 1; },
    onStorageRemove: () => { io.remove += 1; },
  });
  try {
    await worker.call("SellerAgentsControlClient.status");
    await new Promise(resolve => setTimeout(resolve, 20));
    const before = { ...io, network: worker.network.length };
    for (let index = 0; index < 25; index += 1) {
      await worker.call("SellerAgentsPackagedCapabilities.has", EXPECTED[index % EXPECTED.length]);
      await worker.call("SellerAgentsPackagedCapabilities.describe", EXPECTED[index % EXPECTED.length]);
      await worker.call("SellerAgentsPackagedCapabilities.snapshot");
    }
    assert.deepEqual({ ...io, network: worker.network.length }, before);
  } finally {
    worker.close();
  }
}

console.log(JSON.stringify({
  status: "PASS",
  cases: 5,
  capabilities: EXPECTED.length,
  signed_permission_bindings: 0,
  execution_authority: false,
  scope: "PACKAGED_LOCAL_CAPABILITY_PRESENCE_ONLY",
}));
