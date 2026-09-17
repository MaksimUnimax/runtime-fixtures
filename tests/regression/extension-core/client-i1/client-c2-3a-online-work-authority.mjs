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

function context({ marketplace = "ozon", provider = "chatgpt", intersectionValue = intersection(), state = "inactive", operation = "start", conversationId = `${provider}-dialogue`, bound = true, boundMarketplace = marketplace, boundStoreId = `${boundMarketplace}-store-a`, boundCredentialRevision = `${boundMarketplace}-credential-revision-a`, tabId = null, expectedTabId = null, startIntentId = null, expectedStartIntentId = null, selectedStoreId = null, expectedStoreId = null, expectedCredentialRevision = null, storeAuthGeneration = null, storeValue = null } = {}) {
  const origin = provider === "alice" ? "https://alice.yandex.ru" : "https://chatgpt.com";
  const conversationKey = conversationId ? `${origin}|${conversationId}` : null;
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
      trusted: true,
      tabId,
      expectedTabId,
      identity: { key: conversationKey, origin, conversationId, provider, status: conversationId ? "confirmed" : "unknown" },
      binding: bound ? {
        bound: true,
        bindingId: `binding-${provider}-${boundMarketplace}`,
        revision: 2,
        expectedRevision: 2,
        conversationKey,
        origin,
        conversationId,
        provider,
        accountId: ACCOUNT,
        storeId: boundStoreId,
        marketplace: boundMarketplace,
        credentialRevision: boundCredentialRevision,
      } : null,
    },
    store: storeValue || { accountId: ACCOUNT, storeId, marketplace, credentialRevision, selectedStoreId, expectedStoreId, expectedCredentialRevision, authGeneration: storeAuthGeneration },
    work: { operation, state, startIntentId, expectedStartIntentId },
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
  const c23a14Start = await evaluate(worker, { ...baseline, dialogue: { ...baseline.dialogue, binding: null } });
  assert.equal(c23a14Start.allowed, true, "C23A-14 no dialogue binding is valid for pre-bind Start");
  assert.equal(c23a14Start.gates.dialogueBinding, true, "C23A-14 Start does not require persisted binding");
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

  // C2.3-A-R1 operation-aware correction matrix.
  const pendingStart = context({ conversationId: null, bound: false, operation: "start" });
  const r1_01 = await evaluate(worker, pendingStart);
  assert.equal(r1_01.allowed, true, "R1-01 new dialogue without conversation ID permits pending-identity Start");
  assert.equal(r1_01.executionAuthority, false);

  const r1_02 = await evaluate(worker, { ...pendingStart, work: { operation: "resume", state: "inactive" } });
  assert.equal(r1_02.allowed, false, "R1-02 pre-bind context cannot Resume");
  assert.equal(r1_02.gates.dialogueBinding, false);

  const historicalUnbound = context({ marketplace: "wildberries", provider: "alice", bound: false });
  const r1_03 = await evaluate(worker, historicalUnbound);
  assert.equal(r1_03.allowed, true, "R1-03 historical unbound dialogue permits Start");
  assert.deepEqual(r1_03.requiredPermissions, { source: "source.wildberries", ai: "ai.alice" });

  const r1_04 = await evaluate(worker, { ...historicalUnbound, work: { operation: "resume", state: "inactive" } });
  assert.equal(r1_04.allowed, false, "R1-04 unbound historical dialogue cannot Resume");

  for (const state of ["inactive", "error"]) {
    assert.equal((await evaluate(worker, context({ state, operation: "start" }))).allowed, true, `R1-05 Start allowed from ${state}`);
  }
  for (const state of ["pending_identity", "binding", "active_visible", "active_hidden", "recovering", "finishing"]) {
    assert.equal((await evaluate(worker, context({ state, operation: "start" }))).allowed, false, `R1-05 duplicate/in-progress Start denied from ${state}`);
  }
  assert.equal((await evaluate(worker, context({ state: "active_visible", operation: "start" }))).gates.workState, false, "R1-05 active Work cannot be started twice");

  const conflicting = context({ marketplace: "wildberries", boundMarketplace: "ozon", bound: true });
  const r1_06 = await evaluate(worker, conflicting);
  assert.equal(r1_06.allowed, false, "R1-06 conflicting store binding fails closed");
  assert.equal(r1_06.gates.marketplaceBinding, false);
  const r1_07 = await evaluate(worker, { ...conflicting, confirm_change: true });
  assert.equal(r1_07.allowed, false, "R1-07 confirm boolean cannot bypass pure authority");

  const legitimateChanged = context({ marketplace: "wildberries", provider: "chatgpt", bound: true });
  const r1_08old = await evaluate(worker, conflicting);
  const r1_08new = await evaluate(worker, legitimateChanged);
  assert.equal(r1_08old.allowed, false, "R1-08 old conflicting decision is denied");
  assert.equal(r1_08new.allowed, true, "R1-08 recomputed post-change decision may pass");
  assert.notStrictEqual(r1_08old, r1_08new, "R1-08 post-change authority is recomputed");

  assert.equal((await evaluate(worker, context({ marketplace: "wildberries", bound: false, intersectionValue: intersection({ ozon: true, wildberries: false }) }))).allowed, false, "R1-09 Ozon capability cannot substitute for candidate Wildberries");
  assert.equal((await evaluate(worker, context({ marketplace: "ozon", bound: false, intersectionValue: intersection({ ozon: false, wildberries: true }) }))).allowed, false, "R1-09 Wildberries capability cannot substitute for candidate Ozon");
  assert.equal((await evaluate(worker, context({ provider: "chatgpt", bound: false, intersectionValue: intersection({ chatgpt: false, alice: true }) }))).allowed, false, "R1-10 Alice capability cannot substitute for ChatGPT");
  assert.equal((await evaluate(worker, context({ provider: "alice", bound: false, intersectionValue: intersection({ chatgpt: true, alice: false }) }))).allowed, false, "R1-10 ChatGPT capability cannot substitute for Alice");

  const r1_11mismatch = await evaluate(worker, context({ bound: false, startIntentId: "intent-a", expectedStartIntentId: "intent-b" }));
  assert.equal(r1_11mismatch.allowed, false, "R1-11 mismatched Start intent fails closed");
  assert.equal((await evaluate(worker, context({ bound: false, startIntentId: "intent-a", expectedStartIntentId: "intent-a" }))).allowed, true, "R1-11 matching Start intent is accepted");
  assert.equal((await evaluate(worker, context({ bound: false, storeValue: {} }))).allowed, false, "R1-12 missing selected account store fails closed");
  assert.equal((await evaluate(worker, context({ bound: false, storeAuthGeneration: 3 }))).allowed, false, "R1-12 stale store auth generation fails closed");
  const credentialBaseline = context({ bound: false });
  assert.equal((await evaluate(worker, { ...credentialBaseline, store: { ...credentialBaseline.store, expectedCredentialRevision: credentialBaseline.store.credentialRevision } })).allowed, true, "R1-13 current credential revision permits Start");
  assert.equal((await evaluate(worker, { ...credentialBaseline, store: { ...credentialBaseline.store, credentialRevision: "ozon-credential-revision-b", expectedCredentialRevision: "ozon-credential-revision-a" } })).allowed, false, "R1-13 changed credential revision invalidates candidate");
  assert.equal((await evaluate(worker, context({ bound: false, state: "pending_identity" }))).allowed, false, "R1-14 duplicate pending Start denied");
  assert.equal((await evaluate(worker, { ...pendingStart, dialogue: { ...pendingStart.dialogue, identity: { ...pendingStart.dialogue.identity, origin: "https://example.invalid" } } })).allowed, false, "R1-15 unsupported page identity denied");
  assert.equal((await evaluate(worker, { ...pendingStart, health: null })).allowed, false, "R1-16 Health remains required for pre-bind Start");
  assert.equal((await evaluate(worker, { ...pendingStart, bootstrap: { ...pendingStart.bootstrap, source: "CACHE", freshness: "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" } })).allowed, false, "R1-17 stale/offline authority remains denied");
  assert.equal((await evaluate(worker, context({ bound: false, tabId: 1, expectedTabId: 1 }))).allowed, true, "R1-18 tab A candidate passes in its own context");
  assert.equal((await evaluate(worker, context({ bound: false, tabId: 2, expectedTabId: 1 }))).allowed, false, "R1-18 tab B cannot reuse tab A candidate");
  assert.equal((await evaluate(worker, context({ bound: false, selectedStoreId: "ozon-store-a", expectedStoreId: "ozon-store-a" }))).allowed, true, "R1-19 store A candidate passes in its own context");
  assert.equal((await evaluate(worker, context({ bound: false, selectedStoreId: "ozon-store-b", expectedStoreId: "ozon-store-a" }))).allowed, false, "R1-19 store B cannot reuse store A candidate");

  for (const [marketplace, provider, source, ai] of [
    ["ozon", "chatgpt", "source.ozon", "ai.chatgpt"], ["ozon", "alice", "source.ozon", "ai.alice"],
    ["wildberries", "chatgpt", "source.wildberries", "ai.chatgpt"], ["wildberries", "alice", "source.wildberries", "ai.alice"]
  ]) {
    const result = await evaluate(worker, context({ marketplace, provider, bound: false }));
    assert.equal(result.allowed, true, `R1-20 ${marketplace} + ${provider}`);
    assert.deepEqual(result.requiredPermissions, { source, ai });
  }
  const frozen = await worker.call(`(function () { const value = SellerAgentsOnlineWorkAuthority.evaluate(${JSON.stringify(pendingStart)}); return { frozen: Object.isFrozen(value), gatesFrozen: Object.isFrozen(value.gates), permissionsFrozen: Object.isFrozen(value.requiredPermissions) }; })`);
  assert.deepEqual(clone(frozen), { frozen: true, gatesFrozen: true, permissionsFrozen: true }, "R1-21 decision is frozen");
  assert.equal((await evaluate(worker, pendingStart)).allowed, true, "R1-21 fresh evaluation remains detached");
  const r1_22Before = { backing: clone(worker.backing), network: clone(worker.network), messages: clone(worker.messages) };
  await evaluate(worker, pendingStart);
  assert.deepEqual(worker.backing, r1_22Before.backing, "R1-22 pure composer does not write storage");
  assert.deepEqual(worker.network, r1_22Before.network, "R1-22 pure composer does not call network");
  assert.deepEqual(worker.messages, r1_22Before.messages, "R1-22 pure composer does not send runtime messages");

  // Explicit C2.3-A-R2 acceptance matrix. Each case is intentionally
  // evaluated from a fresh input so a prior eligible result cannot authorize a
  // later operation or context.
  const r2 = async (number, label, input, expected, gate = null) => {
    const result = await evaluate(worker, input);
    assert.equal(result.allowed, expected, `C23R2-${String(number).padStart(2, "0")} ${label}`);
    if (gate) assert.equal(result.gates[gate], expected, `C23R2-${String(number).padStart(2, "0")} ${label} gate`);
    return result;
  };
  const r2PendingStart = context({ conversationId: null, bound: false, operation: "start", state: "inactive" });
  await r2(1, "new pending-identity Start is eligible", r2PendingStart, true, "pageIdentity");
  await r2(2, "the same pre-bind context cannot Resume", { ...r2PendingStart, work: { operation: "resume", state: "inactive" } }, false, "dialogueBinding");
  const r2HistoricalUnbound = context({ bound: false, operation: "start", state: "inactive" });
  await r2(3, "historical stable unbound Start is eligible", r2HistoricalUnbound, true, "dialogueBinding");
  await r2(4, "historical unbound dialogue cannot Resume", { ...r2HistoricalUnbound, work: { operation: "resume", state: "inactive" } }, false, "dialogueBinding");
  await r2(5, "matching binding preserves Start and mature inactive Resume", baseline, true, "dialogueBinding");
  await r2(5, "matching binding permits mature inactive Resume", { ...baseline, work: { operation: "resume", state: "inactive" } }, true, "workState");
  await r2(5, "active-hidden is not a mature Resume admission state", { ...baseline, work: { operation: "resume", state: "active_hidden" } }, false, "workState");
  const r2Conflict = context({ marketplace: "wildberries", boundMarketplace: "ozon", bound: true });
  await r2(6, "conflicting binding denies candidate store", r2Conflict, false, "marketplaceBinding");
  await r2(7, "confirm_change cannot bypass conflict", { ...r2Conflict, confirm_change: true }, false, "marketplaceBinding");
  const r2Rebound = context({ marketplace: "wildberries", provider: "chatgpt", bound: true });
  const r2Old = await r2(8, "old conflicting context remains denied", r2Conflict, false);
  const r2New = await r2(8, "legitimate rebind is admitted only after recomputation", r2Rebound, true);
  assert.notStrictEqual(r2Old, r2New, "C23R2-08 stale decision is not reused");
  await r2(9, "Ozon selects source.ozon exactly", context({ marketplace: "ozon", bound: false, intersectionValue: intersection({ ozon: true, wildberries: false }) }), true, "sourceCapability");
  await r2(9, "Ozon cannot use source.wildberries", context({ marketplace: "ozon", bound: false, intersectionValue: intersection({ ozon: false, wildberries: true }) }), false, "sourceCapability");
  await r2(10, "Wildberries selects source.wildberries exactly", context({ marketplace: "wildberries", bound: false, intersectionValue: intersection({ ozon: false, wildberries: true }) }), true, "sourceCapability");
  await r2(10, "Wildberries cannot use source.ozon", context({ marketplace: "wildberries", bound: false, intersectionValue: intersection({ ozon: true, wildberries: false }) }), false, "sourceCapability");
  await r2(11, "ChatGPT selects ai.chatgpt exactly", context({ provider: "chatgpt", bound: false, intersectionValue: intersection({ chatgpt: true, alice: false }) }), true, "aiCapability");
  await r2(11, "ChatGPT cannot use ai.alice", context({ provider: "chatgpt", bound: false, intersectionValue: intersection({ chatgpt: false, alice: true }) }), false, "aiCapability");
  await r2(12, "Alice selects ai.alice exactly", context({ provider: "alice", bound: false, intersectionValue: intersection({ chatgpt: false, alice: true }) }), true, "aiCapability");
  await r2(12, "Alice cannot use ai.chatgpt", context({ provider: "alice", bound: false, intersectionValue: intersection({ chatgpt: true, alice: false }) }), false, "aiCapability");
  await r2(13, "signed feature names cannot substitute for permissions", { ...r2HistoricalUnbound, capabilityIntersection: { ...intersection({ ozon: false }), signedFeatures: { "source.ozon": true } } }, false, "sourceCapability");
  await r2(14, "stale cached Bootstrap is denied", { ...baseline, bootstrap: { ...baseline.bootstrap, source: "CACHE", freshness: "STALE_BUT_OFFLINE_GRACE_ELIGIBLE" } }, false, "bootstrapFreshness");
  await r2(15, "revoked or obsolete generation is denied", { ...baseline, session: { ...baseline.session, revoked: true } }, false, "revocation");
  await r2(15, "obsolete generation is also denied", { ...baseline, session: { ...baseline.session, obsolete: true } }, false, "revocation");
  await r2(16, "account mismatch is denied", { ...baseline, account: { ...baseline.account, expectedAccountId: "99999999-9999-4999-8999-999999999999" } }, false, "account");
  await r2(17, "device or session mismatch is denied", { ...baseline, session: { ...baseline.session, expectedDeviceId: "99999999-9999-4999-8999-999999999999" } }, false, "sessionIdentity");
  await r2(18, "compatibility and minimum-version failure is denied", { ...baseline, compatibility: { ...baseline.compatibility, extension: { ...baseline.compatibility.extension, version: "0.1.9", minimumVersion: "0.2.0" } } }, false, "compatibility");
  await r2(19, "invalid or mismatched signed AI profile is denied", { ...baseline, ai: { ...baseline.ai, profile: { ...baseline.ai.profile, provider: "alice" } } }, false, "aiProfile");
  await r2(20, "missing, false, or invalid Health is denied", { ...baseline, health: null }, false, "health");
  await r2(20, "false Health is denied", { ...baseline, health: { status: "FAIL", current: true, verified: true } }, false, "health");
  await r2(21, "selected store owned by another account is denied", { ...r2HistoricalUnbound, store: { ...r2HistoricalUnbound.store, accountId: "99999999-9999-4999-8999-999999999999" } }, false, "storeOwnership");
  await r2(22, "stale credential revision is denied", { ...r2HistoricalUnbound, store: { ...r2HistoricalUnbound.store, credentialRevision: "credential-b", expectedCredentialRevision: "credential-a" } }, false, "storeOwnership");
  await r2(23, "pending duplicate Start is denied", context({ bound: false, state: "pending_identity", operation: "start" }), false, "workState");
  await r2(24, "wrong or unsupported page identity is denied", { ...r2PendingStart, dialogue: { ...r2PendingStart.dialogue, identity: { ...r2PendingStart.dialogue.identity, origin: "https://example.invalid" } } }, false, "pageIdentity");
  await r2(25, "tab identity is isolated", context({ bound: false, tabId: 2, expectedTabId: 1 }), false, "tabIdentity");
  await r2(26, "store identity is isolated", context({ bound: false, selectedStoreId: "ozon-store-b", expectedStoreId: "ozon-store-a" }), false, "storeOwnership");
  for (const [marketplace, provider, source, ai] of [
    ["ozon", "chatgpt", "source.ozon", "ai.chatgpt"], ["ozon", "alice", "source.ozon", "ai.alice"],
    ["wildberries", "chatgpt", "source.wildberries", "ai.chatgpt"], ["wildberries", "alice", "source.wildberries", "ai.alice"],
  ]) {
    const result = await r2(27, `${marketplace}+${provider} selects the orthogonal pair`, context({ marketplace, provider, bound: false }), true);
    assert.deepEqual(result.requiredPermissions, { source, ai }, `C23R2-27 ${marketplace}+${provider} exact permissions`);
  }
  const r2Frozen = await worker.call(`(function () {
    const value = SellerAgentsOnlineWorkAuthority.evaluate(${JSON.stringify(baseline)});
    return { value, allowed: value.allowed };
  })`);
  assert.equal(r2Frozen.allowed, true, "C23R2-28 eligible output is detached and frozen");
  const r2FrozenValue = r2Frozen.value;
  assert.equal(Object.isFrozen(r2FrozenValue), true, "C23R2-28 decision is frozen");
  assert.equal(Object.isFrozen(r2FrozenValue.gates), true, "C23R2-28 gates are frozen");
  const r2Before = await r2(29, "context change requires recomputation", baseline, true);
  const r2After = await r2(29, "recomputed changed context is denied", { ...baseline, store: { ...baseline.store, storeId: "ozon-store-b" } }, false);
  assert.notStrictEqual(r2Before, r2After, "C23R2-29 old true result is not permanent authority");
  const r2EffectsBefore = { backing: clone(worker.backing), network: clone(worker.network), messages: clone(worker.messages) };
  await r2(30, "composer has zero storage/network/runtime side effects", baseline, true);
  assert.deepEqual(worker.backing, r2EffectsBefore.backing);
  assert.deepEqual(worker.network, r2EffectsBefore.network);
  assert.deepEqual(worker.messages, r2EffectsBefore.messages);
  const d2Input = { ...baseline, capabilityIntersection: { ...baseline.capabilityIntersection, executionAuthority: true } };
  const d2Result = await r2(31, "D2 execution authority input cannot authorize Work", d2Input, false);
  assert.equal(d2Result.executionAuthority, false);
  assert.equal(d2Result.gates.sourceCapability, false);
  const eligibleResult = await r2(32, "eligible composer result still has no execution authority", baseline, true);
  assert.equal(eligibleResult.executionAuthority, false);

  console.log(JSON.stringify({ status: "PASS", c23aCases: 22, r1Cases: 22, c23r2Cases: 32, validPairs: 4, executionAuthority: false, networkCalls: worker.network.length, runtimeMessages: worker.messages.length }));
} finally {
  worker.close();
}
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
