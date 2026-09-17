import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const clone = value => JSON.parse(JSON.stringify(value));

function capabilityRow(entitlementKey, capabilityId, satisfied = true) {
  return {
    capabilityId,
    entitlementKey,
    packaged: true,
    signedPermissionPresent: satisfied,
    signedPermissionAllowed: satisfied,
    permissionSatisfied: satisfied,
    executionAuthority: false,
  };
}

function intersection({ ozon = true, wildberries = true, chatgpt = true, alice = true } = {}) {
  return {
    schemaVersion: "verified_capability_intersection_v1",
    source: "ONLINE",
    freshness: "FRESH",
    configVersion: 7,
    accessBasis: "BETA",
    executionAuthority: false,
    capabilities: [
      capabilityRow("source.ozon", "marketplace.ozon.adapter", ozon),
      capabilityRow("source.wildberries", "marketplace.wildberries.adapter", wildberries),
      capabilityRow("ai.chatgpt", "ai.chatgpt.web.adapter", chatgpt),
      capabilityRow("ai.alice", "ai.alice.web.adapter", alice),
    ],
  };
}

function context({ marketplace = "ozon", provider = "chatgpt", intersectionValue = intersection(), state = "inactive", operation = "start" } = {}) {
  const conversationId = `${provider}-dialogue`;
  const origin = provider === "alice" ? "https://alice.yandex.ru" : "https://chatgpt.com";
  const conversationKey = `${origin}|${conversationId}`;
  const storeId = `${marketplace}-store-a`;
  const credentialRevision = `${marketplace}-credential-revision-a`;
  return {
    account: { authenticated: true, accountId: ACCOUNT, expectedAccountId: ACCOUNT },
    session: {
      generation: 4,
      expectedGeneration: 4,
      deviceId: DEVICE,
      expectedDeviceId: DEVICE,
      sessionId: SESSION,
      expectedSessionId: SESSION,
      revoked: false,
      obsolete: false,
    },
    compatibility: {
      extension: { version: "0.2.4", status: "SUPPORTED", minimumVersion: "0.2.0" },
      browser: { status: "SUPPORTED" },
      contractVersion: "control_plane_v2",
      expectedContractVersion: "control_plane_v2",
    },
    bootstrap: {
      verified: true,
      source: "ONLINE",
      freshness: "FRESH",
      accountId: ACCOUNT,
      generation: 4,
      deviceId: DEVICE,
      sessionId: SESSION,
      aiProvider: provider,
    },
    ai: {
      provider,
      profile: { verified: true, provider, revision: 3 },
    },
    health: { status: "PASS", current: true, verified: true },
    dialogue: {
      key: conversationKey,
      identity: { key: conversationKey, origin, conversationId, provider },
      binding: {
        bound: true,
        bindingId: `binding-${provider}-${marketplace}`,
        revision: 2,
        expectedRevision: 2,
        conversationKey,
        origin,
        conversationId,
        provider,
        accountId: ACCOUNT,
        storeId,
        marketplace,
        credentialRevision,
      },
    },
    store: { accountId: ACCOUNT, storeId, marketplace, credentialRevision },
    work: { operation, state },
    capabilityIntersection: intersectionValue,
  };
}

async function evaluate(worker, value) {
  return clone(await worker.call("SellerAgentsOnlineWorkAuthority.evaluate", value));
}

void (async () => {
const worker = await makeWorker(runtime);
try {
  const baseline = context();
  const validOzonChatgpt = await evaluate(worker, baseline);
  assert.equal(validOzonChatgpt.allowed, true, "C23A-01 Ozon + ChatGPT");
  assert.deepEqual(validOzonChatgpt.requiredPermissions, { source: "source.ozon", ai: "ai.chatgpt" });
  assert.ok(Object.values(validOzonChatgpt.gates).every(Boolean));

  const validWildberriesAlice = await evaluate(worker, context({ marketplace: "wildberries", provider: "alice" }));
  assert.equal(validWildberriesAlice.allowed, true, "C23A-02 Wildberries + Alice");
  assert.deepEqual(validWildberriesAlice.requiredPermissions, { source: "source.wildberries", ai: "ai.alice" });

  const deny = async (label, input, gate) => {
    const result = await evaluate(worker, input);
    assert.equal(result.allowed, false, label);
    assert.equal(result.gates[gate], false, `${label} gate`);
    return result;
  };
  await deny("C23A-03 required source missing", context({ intersectionValue: intersection({ ozon: false }) }), "sourceCapability");
  await deny("C23A-04 required AI missing", context({ intersectionValue: intersection({ chatgpt: false }) }), "aiCapability");
  await deny("C23A-05 wrong marketplace cannot substitute", context({ intersectionValue: intersection({ ozon: false, wildberries: true }) }), "sourceCapability");
  await deny("C23A-06 wrong AI cannot substitute", context({ intersectionValue: intersection({ chatgpt: false, alice: true }) }), "aiCapability");
  await deny("C23A-07 signed features cannot substitute", context({ intersectionValue: { ...intersection({ ozon: false }), signedFeatures: { "source.ozon": true } } }), "sourceCapability");
  await deny("C23A-08 stale/offline bootstrap", { ...baseline, bootstrap: { ...baseline.bootstrap, source: "CACHE", freshness: "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" } }, "bootstrapFreshness");
  await deny("C23A-09 revoked generation", { ...baseline, session: { ...baseline.session, revoked: true } }, "revocation");
  await deny("C23A-10 account mismatch", { ...baseline, account: { ...baseline.account, expectedAccountId: "99999999-9999-4999-8999-999999999999" } }, "account");
  await deny("C23A-10 device mismatch", { ...baseline, session: { ...baseline.session, expectedDeviceId: "99999999-9999-4999-8999-999999999999" } }, "sessionIdentity");
  await deny("C23A-10 session mismatch", { ...baseline, session: { ...baseline.session, expectedSessionId: "99999999-9999-4999-8999-999999999999" } }, "sessionIdentity");
  await deny("C23A-11 incompatible client", { ...baseline, compatibility: { ...baseline.compatibility, extension: { ...baseline.compatibility.extension, status: "UPDATE_REQUIRED" } } }, "compatibility");
  await deny("C23A-11 incompatible contract", { ...baseline, compatibility: { ...baseline.compatibility, contractVersion: "control_plane_v1" } }, "compatibility");
  await deny("C23A-12 invalid AI profile", { ...baseline, ai: { ...baseline.ai, profile: { ...baseline.ai.profile, verified: false } } }, "aiProfile");
  await deny("C23A-12 mismatched AI profile", { ...baseline, ai: { ...baseline.ai, profile: { ...baseline.ai.profile, provider: "alice" } } }, "aiProfile");
  await deny("C23A-13 health missing", { ...baseline, health: null }, "health");
  await deny("C23A-13 health false", { ...baseline, health: { status: "FAIL", current: true, verified: true } }, "health");
  await deny("C23A-13 health invalid", { ...baseline, health: { status: "PASS", current: false, verified: true } }, "health");
  await deny("C23A-14 no dialogue binding", { ...baseline, dialogue: { ...baseline.dialogue, binding: null } }, "dialogueBinding");
  await deny("C23A-15 stale binding revision", { ...baseline, dialogue: { ...baseline.dialogue, binding: { ...baseline.dialogue.binding, expectedRevision: 3 } } }, "dialogueBinding");
  await deny("C23A-15 store binding missing", { ...baseline, store: null }, "storeBinding");
  await deny("C23A-16 marketplace changed", { ...baseline, store: { ...baseline.store, marketplace: "wildberries" } }, "marketplaceBinding");
  await deny("C23A-17 state does not permit start", { ...baseline, work: { operation: "start", state: "active_visible" } }, "workState");

  const multiA = context({ marketplace: "ozon", provider: "chatgpt" });
  const multiB = context({ marketplace: "wildberries", provider: "alice" });
  const multi = await worker.call(`(function () {
    const a = ${JSON.stringify(multiA)};
    const b = ${JSON.stringify(multiB)};
    const first = SellerAgentsOnlineWorkAuthority.evaluate(a);
    const second = SellerAgentsOnlineWorkAuthority.evaluate(b);
    return { a: first.allowed, b: second.allowed, aPermission: first.requiredPermissions, bPermission: second.requiredPermissions };
  })`);
  assert.deepEqual(clone(multi), { a: true, b: true, aPermission: { source: "source.ozon", ai: "ai.chatgpt" }, bPermission: { source: "source.wildberries", ai: "ai.alice" } }, "C23A-18 multi-dialogue isolation");

  await deny("C23A-19 store isolation", { ...baseline, store: { ...baseline.store, storeId: "ozon-store-b" } }, "marketplaceBinding");

  const pairs = [
    ["ozon", "chatgpt", "source.ozon", "ai.chatgpt"],
    ["ozon", "alice", "source.ozon", "ai.alice"],
    ["wildberries", "chatgpt", "source.wildberries", "ai.chatgpt"],
    ["wildberries", "alice", "source.wildberries", "ai.alice"],
  ];
  for (const [marketplace, provider, source, ai] of pairs) {
    const result = await evaluate(worker, context({ marketplace, provider }));
    assert.equal(result.allowed, true, `C23A-22 ${marketplace} + ${provider}`);
    assert.deepEqual(result.requiredPermissions, { source, ai });
  }

  const oldDecision = await evaluate(worker, baseline);
  const recomputedDecision = await evaluate(worker, { ...baseline, store: { ...baseline.store, storeId: "ozon-store-b" } });
  assert.equal(oldDecision.allowed, true, "C23A-21 old decision remains detached");
  assert.equal(recomputedDecision.allowed, false, "C23A-21 changed context requires recomputation");
  assert.notStrictEqual(oldDecision, recomputedDecision, "C23A-21 decisions are distinct objects");

  const before = { backing: clone(worker.backing), network: clone(worker.network), messages: clone(worker.messages) };
  const pure = await worker.call(`(function () { "use strict";
    const value = SellerAgentsOnlineWorkAuthority.evaluate(${JSON.stringify(baseline)});
    let mutationRejected = false;
    try { value.gates.account = false; } catch (_) { mutationRejected = true; }
    return { allowed: value.allowed, frozen: Object.isFrozen(value), gatesFrozen: Object.isFrozen(value.gates), permissionsFrozen: Object.isFrozen(value.requiredPermissions), mutationRejected, executionAuthority: value.executionAuthority };
  })`);
  assert.deepEqual(clone(pure), { allowed: true, frozen: true, gatesFrozen: true, permissionsFrozen: true, mutationRejected: true, executionAuthority: false }, "C23A-20/21 pure immutable decision");
  assert.deepEqual(worker.backing, before.backing, "C23A-20 no storage mutation");
  assert.deepEqual(worker.network, before.network, "C23A-20 no network");
  assert.deepEqual(worker.messages, before.messages, "C23A-20 no runtime messages");

  const intersectionResult = validOzonChatgpt.capabilityEvidence;
  assert.equal(validOzonChatgpt.executionAuthority, false, "D2 remains non-executing");
  assert.equal(intersectionResult.source, "ONLINE");
  assert.equal(intersectionResult.freshness, "FRESH");
  assert.equal(intersectionResult.executionAuthority, false);

  console.log(JSON.stringify({ status: "PASS", cases: 22, validPairs: 4, executionAuthority: false, networkCalls: worker.network.length, runtimeMessages: worker.messages.length }));
} finally {
  worker.close();
}
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
