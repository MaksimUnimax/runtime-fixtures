import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { makeWorker, signFixtureBootstrap } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const T0 = Date.parse("2026-09-17T12:00:00.000Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const OTHER_ACCOUNT = "99999999-9999-4999-8999-999999999999";
const OTHER_DEVICE = "44444444-4444-4444-8444-444444444444";
const OTHER_SESSION = "55555555-5555-4555-8555-555555555555";
const clone = value => JSON.parse(JSON.stringify(value));

function canonical(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const b64url = value => Buffer.from(value).toString("base64url");

async function signHealth(backing, claim, keyId = "fixture-key") {
  const key = await webcrypto.subtle.importKey(
    "pkcs8",
    Buffer.from(backing.local.__seller_agents_fixture_signing_key.privateKey, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const payload = new TextEncoder().encode(canonical(claim));
  const prefix = new TextEncoder().encode(`product-control-plane/health-authority/v1\0${keyId}\0`);
  const signed = new Uint8Array(prefix.length + payload.length);
  signed.set(prefix); signed.set(payload, prefix.length);
  return {
    healthEnvelopeVersion: "health_envelope_v1",
    algorithm: "Ed25519",
    keyId,
    payload: b64url(payload),
    signature: b64url(await webcrypto.subtle.sign("Ed25519", key, signed)),
  };
}

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
    configVersion: 1,
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

function workContext({
  marketplace = "ozon",
  provider = "chatgpt",
  state = "inactive",
  operation = "start",
  conversationId = `${provider}-dialogue`,
  bound = true,
  accountId = ACCOUNT,
  deviceId = DEVICE,
  sessionId = SESSION,
  generation = 1,
  capabilities = {},
} = {}) {
  const origin = provider === "alice" ? "https://alice.yandex.ru" : "https://chatgpt.com";
  const conversationKey = conversationId ? `${origin}|${conversationId}` : null;
  const storeId = `${marketplace}-store-a`;
  const credentialRevision = `${marketplace}-credential-revision-a`;
  return {
    account: { authenticated: true, accountId, expectedAccountId: accountId },
    session: {
      generation,
      expectedGeneration: generation,
      deviceId,
      expectedDeviceId: deviceId,
      sessionId,
      expectedSessionId: sessionId,
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
      accountId,
      generation,
      deviceId,
      sessionId,
      aiProvider: provider,
    },
    ai: { provider, surface: "web", variant: null, profile: { verified: true, provider, revision: 1 } },
    // This is deliberately ignored by the authoritative B2 adapter.
    health: { status: "PASS", current: true, verified: true },
    dialogue: {
      key: conversationKey,
      trusted: true,
      tabId: null,
      expectedTabId: null,
      identity: { key: conversationKey, origin, conversationId, provider, status: conversationId ? "confirmed" : "unknown" },
      binding: bound ? {
        bound: true,
        bindingId: `binding-${provider}-${marketplace}`,
        revision: 2,
        expectedRevision: 2,
        conversationKey,
        origin,
        conversationId,
        provider,
        accountId,
        storeId,
        marketplace,
        credentialRevision,
      } : null,
    },
    store: { accountId, storeId, marketplace, credentialRevision, selectedStoreId: null, expectedStoreId: null, expectedCredentialRevision: null, authGeneration: null },
    work: { operation, state, startIntentId: null, expectedStartIntentId: null },
    capabilityIntersection: intersection(capabilities),
  };
}

function claimFor(payload, overrides = {}) {
  return {
    healthClaimVersion: "health_claim_v1",
    status: "PASS",
    target: "WORK",
    context: {
      accountId: payload.account.id,
      deviceId: DEVICE,
      sessionId: SESSION,
      contractVersion: "control_plane_v2",
      configVersion: payload.configVersion,
      bootstrapSnapshotSha256: createHash("sha256").update(Buffer.from(canonical(payload))).digest("hex"),
      ai: {
        family: payload.ai.detected.family,
        surface: payload.ai.detected.surface,
        variant: payload.ai.detected.variant,
        profileKey: payload.ai.profile.profileKey,
        revision: payload.ai.profile.revision,
        scopeVariant: payload.ai.profile.scopeVariant,
        contentSha256: payload.ai.profile.contentSha256,
      },
    },
    observedAt: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + 15 * 60_000).toISOString(),
    executionAuthority: false,
    ...overrides,
  };
}

function bindBootstrapContext(input, payload) {
  const context = claimFor(payload).context;
  return {
    ...input,
    bootstrap: { ...input.bootstrap, accountId: context.accountId, deviceId: context.deviceId, sessionId: context.sessionId, contractVersion: context.contractVersion, configVersion: context.configVersion },
    ai: { ...input.ai, provider: context.ai.family, surface: context.ai.surface, variant: context.ai.variant, profile: { ...input.ai.profile, provider: context.ai.family, profileKey: context.ai.profileKey, revision: context.ai.revision, scopeVariant: context.ai.scopeVariant, contentSha256: context.ai.contentSha256 } },
  };
}

async function makeFixture({ clock, backing, envelope, onStorageWrite } = {}) {
  const currentClock = clock || { wall: T0, mono: 1000 };
  const currentBacking = backing || { local: {}, session: {} };
  const worker = await makeWorker(runtime, {
    backing: currentBacking,
    wallClock: () => currentClock.wall,
    monotonicClock: () => currentClock.mono,
    seedAuthority: backing ? false : undefined,
    fetch: async () => { throw new Error("B2 must not acquire Health over the network"); },
    onStorageWrite,
  });
  const payload = currentBacking.local[AUTH].authority.payload;
  const healthEnvelope = envelope || await signHealth(currentBacking, claimFor(payload));
  return { worker, backing: currentBacking, clock: currentClock, envelope: healthEnvelope };
}

async function evaluate(worker, input, envelope) {
  return worker.call("SellerAgentsVerifiedOnlineWorkAuthority.evaluate", input, envelope);
}

const cases = [];
const failures = [];
async function test(id, description, fn) {
  try {
    await fn();
    cases.push({ id, status: "PASS", description });
  } catch (error) {
    cases.push({ id, status: "FAIL", description, error: `${error.name}: ${error.message}` });
    failures.push(cases.at(-1));
  }
}

const fixture = await makeFixture();
const valid = bindBootstrapContext(workContext(), fixture.backing.local[AUTH].authority.payload);
const aliceBacking = clone(fixture.backing);
const alicePayload = clone(aliceBacking.local[AUTH].authority.payload);
alicePayload.ai.detected.family = "alice";
aliceBacking.local[AUTH].authority.payload = alicePayload;
aliceBacking.local[AUTH].authority.envelope = await signFixtureBootstrap(aliceBacking, alicePayload);
aliceBacking.local[AUTH].authority.requestedAi = "alice";
aliceBacking.local[AUTH].authority.cacheBinding.detectedAi.family = "alice";
const aliceFixture = await makeFixture({ backing: aliceBacking });
const validWbAlice = bindBootstrapContext(workContext({ marketplace: "wildberries", provider: "alice" }), alicePayload);

await test("B2-01", "signed current Health + Ozon/ChatGPT START", async () => {
  const result = await evaluate(fixture.worker, valid, fixture.envelope);
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.equal(result.executionAuthority, false);
});
await test("B2-02", "signed current Health + Wildberries/Alice START", async () => {
  const result = await evaluate(aliceFixture.worker, validWbAlice, aliceFixture.envelope);
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.equal(result.executionAuthority, false);
});

const negativeClaims = [
  ["B2-03", { status: "DENY", reason: "HEALTH_DENIED" }],
  ["B2-04", { status: "UNAVAILABLE", reason: "PRODUCER_UNAVAILABLE" }],
  ["B2-05", { observedAt: new Date(T0 - 16 * 60_000).toISOString(), expiresAt: new Date(T0 - 1).toISOString() }],
  ["B2-06", { observedAt: new Date(T0 + 1).toISOString() }],
];
for (const [id, overrides] of negativeClaims) {
  await test(id, "signed Health is denied by status/freshness", async () => {
    const envelope = await signHealth(fixture.backing, claimFor(fixture.backing.local[AUTH].authority.payload, overrides));
    const result = await evaluate(fixture.worker, valid, envelope);
    assert.equal(result.allowed, false);
    assert.ok(result.deniedGates.includes("health"));
  });
}

await test("B2-07", "tampered signed Health envelope", async () => {
  const envelope = clone(fixture.envelope);
  envelope.signature = `${envelope.signature.slice(0, -1)}${envelope.signature.endsWith("A") ? "B" : "A"}`;
  const result = await evaluate(fixture.worker, valid, envelope);
  assert.equal(result.allowed, false);
});
await test("B2-08", "unsigned Health JSON", async () => {
  const result = await evaluate(fixture.worker, valid, { payload: fixture.envelope.payload });
  assert.equal(result.allowed, false);
});
await test("B2-09", "wrong signing trust", async () => {
  const result = await evaluate(fixture.worker, valid, { ...fixture.envelope, keyId: "unknown-key" });
  assert.equal(result.allowed, false);
});

const otherPayload = { ...clone(fixture.backing.local[AUTH].authority.payload), configVersion: 2 };
const otherBootstrapEnvelope = await signFixtureBootstrap(fixture.backing, otherPayload);
const snapshotBacking = clone(fixture.backing);
snapshotBacking.local[AUTH].authority.payload = otherPayload;
snapshotBacking.local[AUTH].authority.envelope = otherBootstrapEnvelope;
await test("B2-10", "Health for another Bootstrap snapshot", async () => {
  const changed = await makeFixture({ backing: snapshotBacking, envelope: fixture.envelope });
  const result = await evaluate(changed.worker, valid, changed.envelope);
  assert.equal(result.allowed, false);
  changed.worker.close();
});

for (const [id, input] of [
  ["B2-11", { ...valid, account: { ...valid.account, accountId: OTHER_ACCOUNT, expectedAccountId: OTHER_ACCOUNT } }],
  ["B2-12", { ...valid, session: { ...valid.session, deviceId: OTHER_DEVICE, expectedDeviceId: OTHER_DEVICE } }],
  ["B2-13", { ...valid, session: { ...valid.session, sessionId: OTHER_SESSION, expectedSessionId: OTHER_SESSION } }],
  ["B2-14a", { ...valid, ai: { ...valid.ai, provider: "alice", profile: { ...valid.ai.profile, provider: "alice" } } }],
]) {
  await test(id, "Health context cannot satisfy a mismatched Work context", async () => {
    const result = await evaluate(fixture.worker, input, fixture.envelope);
    assert.equal(result.allowed, false);
  });
}
for (const [id, field] of [["B2-14b", "family"], ["B2-14c", "surface"], ["B2-14d", "profileKey"]]) {
  await test(id, "signed Health AI context mismatch", async () => {
    const context = claimFor(fixture.backing.local[AUTH].authority.payload).context;
    const next = clone(context);
    if (field === "family") next.ai.family = "alice";
    if (field === "surface") next.ai.surface = "mobile";
    if (field === "profileKey") next.ai.profileKey = "other-profile";
    const envelope = await signHealth(fixture.backing, claimFor(fixture.backing.local[AUTH].authority.payload, { context: next }));
    const result = await evaluate(fixture.worker, valid, envelope);
    assert.equal(result.allowed, false);
  });
}
await test("B2-14e", "caller AI surface mismatch is denied", async () => {
  const result = await evaluate(fixture.worker, { ...valid, ai: { ...valid.ai, surface: "mobile" } }, fixture.envelope);
  assert.equal(result.allowed, false);
});

for (const [id, capabilities] of [
  ["B2-15", { ozon: false }],
  ["B2-16", { chatgpt: false }],
]) {
  await test(id, "Health cannot replace a missing capability", async () => {
    const result = await evaluate(fixture.worker, workContext({ capabilities }), fixture.envelope);
    assert.equal(result.allowed, false);
  });
}
await test("B2-17", "signed Health + stale/offline Bootstrap", async () => {
  const result = await evaluate(fixture.worker, { ...valid, bootstrap: { ...valid.bootstrap, source: "CACHE", freshness: "STALE" } }, fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-18", "signed Health + revoked/obsolete generation", async () => {
  const result = await evaluate(fixture.worker, { ...valid, session: { ...valid.session, revoked: true } }, fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-19", "signed Health + incompatible extension/browser", async () => {
  const result = await evaluate(fixture.worker, { ...valid, compatibility: { ...valid.compatibility, browser: { status: "UNSUPPORTED" } } }, fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-20", "signed Health + conflicting dialogue/store binding", async () => {
  const result = await evaluate(fixture.worker, { ...valid, dialogue: { ...valid.dialogue, binding: { ...valid.dialogue.binding, marketplace: "wildberries" } } }, fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-21", "signed Health + invalid Work state", async () => {
  const result = await evaluate(fixture.worker, { ...valid, work: { ...valid.work, state: "active" } }, fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-22", "historical unbound legitimate Start", async () => {
  const result = await evaluate(fixture.worker, bindBootstrapContext(workContext({ bound: false }), fixture.backing.local[AUTH].authority.payload), fixture.envelope);
  assert.equal(result.allowed, true, JSON.stringify(result));
});
await test("B2-23", "new pending-identity legitimate Start", async () => {
  const result = await evaluate(fixture.worker, bindBootstrapContext(workContext({ bound: false, conversationId: null }), fixture.backing.local[AUTH].authority.payload), fixture.envelope);
  assert.equal(result.allowed, true, JSON.stringify(result));
});
await test("B2-24", "pre-bind Resume denied", async () => {
  const result = await evaluate(fixture.worker, workContext({ bound: false, operation: "resume" }), fixture.envelope);
  assert.equal(result.allowed, false);
});
await test("B2-25", "exact valid persisted Resume remains eligible", async () => {
  const result = await evaluate(fixture.worker, bindBootstrapContext(workContext({ operation: "resume" }), fixture.backing.local[AUTH].authority.payload), fixture.envelope);
  assert.equal(result.allowed, true, JSON.stringify(result));
});
await test("B2-26", "readVerifiedHealthMetadata failure is a denial", async () => {
  const result = await evaluate(fixture.worker, valid, { ...fixture.envelope, payload: "not-base64" });
  assert.equal(result.allowed, false);
});
await test("B2-27", "fabricated Health booleans without envelope cannot enter B2", async () => {
  const result = await evaluate(fixture.worker, valid);
  assert.equal(result.allowed, false);
  assert.ok(result.deniedGates.includes("health"));
});

const writes = [];
const sideEffectFixture = await makeFixture({ clock: { wall: T0, mono: 1000 }, backing: clone(fixture.backing), envelope: fixture.envelope, onStorageWrite: (kind, values) => writes.push({ kind, values }) });
const writesBeforeEvaluation = writes.length;
const networkBefore = sideEffectFixture.worker.network.length;
const messagesBefore = sideEffectFixture.worker.messages.length;
await test("B2-28", "authoritative B2 path performs zero network calls", async () => {
  await evaluate(sideEffectFixture.worker, valid, sideEffectFixture.envelope);
  assert.equal(sideEffectFixture.worker.network.length, networkBefore);
});
await test("B2-29", "authoritative B2 path performs zero storage writes", async () => {
  assert.equal(writes.length, writesBeforeEvaluation);
});
await test("B2-30", "authoritative B2 path performs zero Work transitions", async () => {
  assert.deepEqual(sideEffectFixture.worker.messages.slice(messagesBefore), []);
});
await test("B2-31", "authoritative B2 path performs zero provider/AI sends", async () => {
  assert.deepEqual(sideEffectFixture.worker.messages.slice(messagesBefore), []);
});
await test("B2-32", "returned decision is detached and frozen", async () => {
  const input = bindBootstrapContext(workContext(), fixture.backing.local[AUTH].authority.payload);
  const result = await evaluate(sideEffectFixture.worker, input, sideEffectFixture.envelope);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.gates), true);
  assert.equal(Object.isFrozen(result.requiredPermissions), true);
  input.account.accountId = OTHER_ACCOUNT;
  assert.equal(result.allowed, true, JSON.stringify(result));
});
await test("B2-33", "returned decision always has executionAuthority false", async () => {
  for (const input of [valid, { ...valid, work: { ...valid.work, state: "active" } }])
    assert.equal((await evaluate(sideEffectFixture.worker, input, sideEffectFixture.envelope)).executionAuthority, false);
});
await test("B2-34", "repeat evaluation stays network-free", async () => {
  await evaluate(sideEffectFixture.worker, valid, sideEffectFixture.envelope);
  await evaluate(sideEffectFixture.worker, valid, sideEffectFixture.envelope);
  assert.equal(sideEffectFixture.worker.network.length, networkBefore);
});
await test("B2-35", "safe clock beyond Health expiry denies", async () => {
  sideEffectFixture.clock.wall = T0 + 15 * 60_000;
  sideEffectFixture.clock.mono = 1000 + 15 * 60_000;
  const result = await evaluate(sideEffectFixture.worker, valid, sideEffectFixture.envelope);
  assert.equal(result.allowed, false);
});

await test("B2-36", "changed current Bootstrap denies old Health envelope", async () => {
  const changed = await makeFixture({ backing: snapshotBacking, envelope: fixture.envelope });
  const result = await evaluate(changed.worker, valid, changed.envelope);
  assert.equal(result.allowed, false);
  changed.worker.close();
});
await test("B2-37", "changed account/session generation denies old Health envelope", async () => {
  const changedBacking = clone(fixture.backing);
  const auth = changedBacking.local[AUTH];
  auth.generation = auth.generation + 1;
  auth.authority.generation = auth.generation;
  auth.credentials.sessionId = OTHER_SESSION;
  auth.authority.sessionId = OTHER_SESSION;
  auth.cacheClock.owner.sessionId = OTHER_SESSION;
  const changed = await makeFixture({ backing: changedBacking, envelope: fixture.envelope });
  const result = await evaluate(changed.worker, valid, changed.envelope);
  assert.equal(result.allowed, false);
  changed.worker.close();
});
await test("B2-38", "Health PASS does not manufacture capability rows", async () => {
  const result = await evaluate(sideEffectFixture.worker, { ...valid, capabilityIntersection: null }, sideEffectFixture.envelope);
  assert.equal(result.allowed, false);
  assert.equal(result.capabilityEvidence.sourceCapability, null);
});
await test("B2-39", "capability true does not manufacture Health PASS", async () => {
  const envelope = await signHealth(fixture.backing, claimFor(fixture.backing.local[AUTH].authority.payload, { status: "UNAVAILABLE", reason: "NO_PRODUCER" }));
  const result = await evaluate(sideEffectFixture.worker, valid, envelope);
  assert.equal(result.allowed, false);
});
await test("B2-40", "no Work/runtime production consumer exists", async () => {
  const source = fs.readFileSync(path.resolve("packages/control-client/src/online-work-authority.js"), "utf8");
  const adapter = fs.readFileSync(path.resolve("packages/control-client/src/verified-online-work-authority.js"), "utf8");
  const recipe = JSON.parse(fs.readFileSync(path.resolve("apps/extension/composition.json"), "utf8"));
  const extensionSources = fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8") + fs.readFileSync(path.resolve("apps/extension/src/application/delivery.js"), "utf8");
  assert.match(source, /SellerAgentsOnlineWorkAuthority/);
  assert.match(adapter, /readVerifiedHealthMetadata/);
  assert.doesNotMatch(adapter, /acquireSignedHealthAuthority|getVerifiedHealthMetadata/);
  assert.ok(recipe.worker_prelude.indexOf("packages/control-client/src/online-work-authority.js") < recipe.worker_prelude.indexOf("packages/control-client/src/verified-online-work-authority.js"));
  assert.doesNotMatch(extensionSources, /SellerAgents(?:Verified)?OnlineWorkAuthority/);
});

for (const item of [fixture, aliceFixture, sideEffectFixture]) item.worker.close();

console.log(JSON.stringify({
  status: failures.length ? "FAIL" : "PASS",
  scope: "C2.3-B2_VERIFIED_HEALTH_COMPOSED_INTO_PURE_ONLINE_AUTHORITY",
  cases,
  failureBatch: failures,
  executionAuthority: false,
  networkCalls: sideEffectFixture.worker.network.length,
  storageWrites: writes.length,
  runtimeMessages: sideEffectFixture.worker.messages.length,
}, null, 2));
if (failures.length) process.exitCode = 1;
