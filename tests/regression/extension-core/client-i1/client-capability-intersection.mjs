import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
const clone = value => JSON.parse(JSON.stringify(value));
const EXPECTED_BINDINGS = [
  ["ai.alice.web.adapter", "ai.alice"],
  ["ai.chatgpt.web.adapter", "ai.chatgpt"],
  ["ai.claude.web.adapter", "ai.claude"],
  ["ai.deepseek.web.adapter", "ai.deepseek"],
  ["ai.gemini.web.adapter", "ai.gemini"],
  ["ai.grok.web.adapter", "ai.grok"],
  ["ai.kimi.web.adapter", "ai.kimi"],
  ["ai.qwen.web.adapter", "ai.qwen"],
  ["marketplace.ozon.adapter", "source.ozon"],
  ["marketplace.wildberries.adapter", "source.wildberries"],
];

async function makeCachedWorker(entitlements, features = {}) {
  const backing = { local: {}, session: {} };
  const seed = await makeWorker(runtime, { backing, fetch: async (url) => {
    assert.ok(url.endsWith("/v1/bootstrap"));
    const payload = clone(backing.local[AUTH].authority.payload);
    payload.entitlements = entitlements;
    payload.features = features;
    return Response.json(await signFixtureBootstrap(backing, payload));
  } });
  // Populate the current per-AI grant through the actual signed response path.
  await seed.call("SellerAgentsControlClient.bootstrap", { detectedAi: CHATGPT });
  seed.close();

  return makeWorker(runtime, {
    backing,
    seedAuthority: false,
    fetch: async () => {
      throw new TypeError("fixture transport unavailable");
    },
  });
}

// 1. Only the explicit server permission bindings exist.
{
  const worker = await makeWorker(runtime);
  try {
    const manifest = clone(
      await worker.call("SellerAgentsCapabilityIntersection.snapshot"),
    );
    assert.equal(manifest.schemaVersion, "seller_agents_capability_intersection_v1");
    assert.equal(manifest.authority, "PACKAGED_AND_SIGNED_ENTITLEMENT_READ_ONLY");
    assert.equal(manifest.executionAuthority, false);
    assert.deepEqual(
      manifest.bindings
        .map(row => [row.capabilityId, row.entitlementKey])
        .sort((a, b) => a[0].localeCompare(b[0])),
      EXPECTED_BINDINGS,
    );
    for (const [capabilityId] of EXPECTED_BINDINGS)
      assert.equal(
        await worker.call("SellerAgentsCapabilityIntersection.hasBinding", capabilityId),
        true,
        capabilityId,
      );
    for (const capabilityId of [
      "marketplace.amazon.adapter",
      "source.ozon",
      "ai.chatgpt",
      "",
      "../ozon",
    ])
      assert.equal(
        await worker.call("SellerAgentsCapabilityIntersection.hasBinding", capabilityId),
        false,
        capabilityId,
      );
  } finally {
    worker.close();
  }
}

// 2. Explicit signed true plus packaged-local presence satisfies the read-only
// intersection for every reviewed binding, but still grants no execution.
// The computed result itself is also immutable, not only the binding manifest.
{
  const worker = await makeCachedWorker({
    "source.ozon": true,
    "source.wildberries": true,
    "ai.chatgpt": true,
    "ai.alice": true,
    "ai.qwen": true,
    "ai.kimi": true,
    "ai.grok": true,
    "ai.gemini": true,
    "ai.claude": true,
    "ai.deepseek": true,
  });
  try {
    const result = clone(
      await worker.call("SellerAgentsCapabilityIntersection.getVerified", {
        detectedAi: CHATGPT,
      }),
    );
    assert.equal(result.schemaVersion, "verified_capability_intersection_v1");
    assert.equal(result.source, "CACHE");
    assert.equal(result.executionAuthority, false);
    assert.equal(Object.hasOwn(result, "workAllowed"), false);
    assert.equal(result.capabilities.length, 10);
    assert.ok(
      result.capabilities.every(
        row =>
          row.packaged === true &&
          row.signedPermissionPresent === true &&
          row.signedPermissionAllowed === true &&
          row.permissionSatisfied === true &&
          row.executionAuthority === false,
      ),
    );

    const immutability = clone(
      await worker.call(`(async function () {
        const value = await SellerAgentsCapabilityIntersection.getVerified({ detectedAi: ${JSON.stringify(CHATGPT)} });
        let arrayMutationRejected = false;
        try { value.capabilities.push({ capabilityId: "marketplace.amazon.adapter" }); }
        catch (_) { arrayMutationRejected = true; }
        return {
          result: Object.isFrozen(value),
          capabilities: Object.isFrozen(value.capabilities),
          rows: value.capabilities.every(Object.isFrozen),
          arrayMutationRejected,
          count: value.capabilities.length,
          executionAuthority: value.executionAuthority,
        };
      })`),
    );
    assert.deepEqual(immutability, {
      result: true,
      capabilities: true,
      rows: true,
      arrayMutationRejected: true,
      count: 10,
      executionAuthority: false,
    });
  } finally {
    worker.close();
  }
}

// 3. Missing or explicit false signed entitlements deny, and signed features
// cannot substitute for the reviewed entitlement namespace.
{
  const worker = await makeCachedWorker(
    {
      "source.ozon": false,
      "ai.chatgpt": true,
    },
    {
      "source.ozon": true,
      "source.wildberries": true,
      "ai.alice": true,
    "ai.qwen": true,
    "ai.kimi": true,
    "ai.grok": true,
    "ai.gemini": true,
    "ai.claude": true,
    "ai.deepseek": true,
    },
  );
  try {
    const result = clone(
      await worker.call("SellerAgentsCapabilityIntersection.getVerified", {
        detectedAi: CHATGPT,
      }),
    );
    const byCapability = Object.fromEntries(
      result.capabilities.map(row => [row.capabilityId, row]),
    );
    assert.equal(byCapability["marketplace.ozon.adapter"].signedPermissionPresent, true);
    assert.equal(byCapability["marketplace.ozon.adapter"].signedPermissionAllowed, false);
    assert.equal(byCapability["marketplace.ozon.adapter"].permissionSatisfied, false);
    assert.equal(byCapability["marketplace.wildberries.adapter"].signedPermissionPresent, false);
    assert.equal(byCapability["marketplace.wildberries.adapter"].permissionSatisfied, false);
    assert.equal(byCapability["ai.chatgpt.web.adapter"].permissionSatisfied, true);
    assert.equal(byCapability["ai.alice.web.adapter"].signedPermissionPresent, false);
    assert.equal(byCapability["ai.alice.web.adapter"].permissionSatisfied, false);
    assert.equal(byCapability["ai.qwen.web.adapter"].signedPermissionPresent, false);
    assert.equal(byCapability["ai.qwen.web.adapter"].permissionSatisfied, false);
    assert.equal(byCapability["ai.kimi.web.adapter"].signedPermissionPresent, false);
    assert.equal(byCapability["ai.kimi.web.adapter"].permissionSatisfied, false);
    assert.equal(result.executionAuthority, false);
  } finally {
    worker.close();
  }
}

// 4. Unknown signed keys and keys that merely resemble local capability ids
// never manufacture a binding or a local capability permission.
{
  const worker = await makeCachedWorker({
    "marketplace.ozon.adapter": true,
    "marketplace.wildberries.adapter": true,
    "ai.chatgpt.web.adapter": true,
    "ai.alice.web.adapter": true,
    "ai.qwen.web.adapter": true,
    "ai.kimi.web.adapter": true,
    "source.amazon": true,
  });
  try {
    const result = clone(
      await worker.call("SellerAgentsCapabilityIntersection.getVerified", {
        detectedAi: CHATGPT,
      }),
    );
    assert.ok(
      result.capabilities.every(
        row =>
          row.packaged === true &&
          row.signedPermissionPresent === false &&
          row.signedPermissionAllowed === false &&
          row.permissionSatisfied === false,
      ),
    );
    assert.equal(
      await worker.call(
        "SellerAgentsCapabilityIntersection.describeBinding",
        "marketplace.amazon.adapter",
      ),
      null,
    );
  } finally {
    worker.close();
  }
}

// 5. A reviewed permission key carrying a non-BOOLEAN generic entitlement
// value is a contract/semantic mismatch and fails the whole intersection closed.
{
  const worker = await makeCachedWorker({
    "source.ozon": 1,
    "source.wildberries": true,
    "ai.chatgpt": true,
    "ai.alice": true,
    "ai.qwen": true,
    "ai.kimi": true,
    "ai.grok": true,
    "ai.gemini": true,
    "ai.claude": true,
    "ai.deepseek": true,
  });
  try {
    const failure = clone(
      await worker.call(`(async function () {
        try {
          await SellerAgentsCapabilityIntersection.getVerified({ detectedAi: ${JSON.stringify(CHATGPT)} });
          return { rejected: false };
        } catch (error) {
          return { rejected: true, code: error?.code, message: error?.message };
        }
      })`),
    );
    assert.deepEqual(failure, {
      rejected: true,
      code: "CAPABILITY_PERMISSION_METADATA_INVALID",
      message: "CAPABILITY_PERMISSION_METADATA_INVALID",
    });
  } finally {
    worker.close();
  }
}

// 6. The binding authority is immutable and remains a separate read-only
// surface; it does not patch canWork or publish an executable capability API.
{
  const worker = await makeWorker(runtime);
  try {
    const frozen = clone(
      await worker.call(`(function () {
        const root = SellerAgentsCapabilityIntersection;
        const manifest = root.snapshot();
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "SellerAgentsCapabilityIntersection");
        let mutationRejected = false;
        try { manifest.bindings.push({ capabilityId: "marketplace.amazon.adapter", entitlementKey: "source.amazon" }); }
        catch (_) { mutationRejected = true; }
        try { globalThis.SellerAgentsCapabilityIntersection = { replaced: true }; }
        catch (_) {}
        return {
          api: Object.isFrozen(root),
          manifest: Object.isFrozen(manifest),
          bindings: Object.isFrozen(manifest.bindings),
          rows: manifest.bindings.every(Object.isFrozen),
          globalWritable: descriptor.writable,
          globalConfigurable: descriptor.configurable,
          globalUnchanged: globalThis.SellerAgentsCapabilityIntersection === root,
          mutationRejected,
          clientHasIntersectionMethod: Object.prototype.hasOwnProperty.call(
            SellerAgentsControlClient,
            "getVerifiedCapabilityIntersection",
          ),
          manifestExecutionAuthority: manifest.executionAuthority,
        };
      })`),
    );
    assert.deepEqual(frozen, {
      api: true,
      manifest: true,
      bindings: true,
      rows: true,
      globalWritable: false,
      globalConfigurable: false,
      globalUnchanged: true,
      mutationRejected: true,
      clientHasIntersectionMethod: false,
      manifestExecutionAuthority: false,
    });
  } finally {
    worker.close();
  }
}

console.log(
  JSON.stringify({
    status: "PASS",
    cases: 6,
    bindings: EXPECTED_BINDINGS.length,
    permission_source: "SIGNED_ENTITLEMENTS_ONLY",
    execution_authority: false,
    scope: "READ_ONLY_PACKAGED_AND_SIGNED_PERMISSION_INTERSECTION",
  }),
);
