import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";

const runtime = path.resolve(process.argv[2]);
const results = [];
async function test(id, fn) { await fn(); results.push({ id, status: "PASS" }); }
const clone = (v) => v == null ? v : structuredClone(v);

function baseContent(
  composerPrimary = { kind: "packaged_selector_reference", reference: "composer-root" },
  conversationPrimary = { kind: "packaged_selector_reference", reference: "conversation-root" },
) {
  return {
    schemaVersion: "adapter_profile_v1",
    page: {
      identityStrategy: "page_identity",
      conversationStrategy: "conversation_root",
      composerStrategy: "composer_root",
    },
    selectors: {
      conversation: { strategy: "conversation_root", primary: conversationPrimary, fallbacks: [], timeoutMs: 1000, observationMode: "polling" },
      composer: { strategy: "composer_root", primary: composerPrimary, fallbacks: [], timeoutMs: 1000, observationMode: "polling" },
      send: { strategy: "send_control", primary: { kind: "packaged_selector_reference", reference: "send-control" }, fallbacks: [], timeoutMs: 1000, observationMode: "polling" },
      assistantResponse: { strategy: "assistant_response", primary: { kind: "packaged_selector_reference", reference: "assistant-response" }, fallbacks: [], timeoutMs: 1000, observationMode: "polling" },
    },
    observation: { mode: "polling", intervalMs: 100 },
    contours: [
      { key: "page_identity", required: true, expectedState: "PRESENT", strategy: "page_identity" },
      { key: "conversation_root", required: true, expectedState: "PRESENT", strategy: "conversation_root" },
      { key: "composer_root", required: true, expectedState: "INTERACTIVE", strategy: "composer_root" },
      { key: "send_control", required: true, expectedState: "INTERACTIVE", strategy: "send_control" },
    ],
  };
}
const compatibility = {
  schemaVersion: "profile_compatibility_v1",
  contractVersion: "control_plane_v1",
  browserFamilies: ["chrome"],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};

async function fixture() {
  const listeners = [];
  const sent = [];
  let work = false;
  let manual = false;
  let scopeFamily = "chatgpt";
  let conversationRoot = null;
  let digestGate = null;
  let receiptGate = null;
  const pending = [];
  const state = {
    authority: { authGeneration: 1, bootstrapSnapshotSha256: "a".repeat(64) },
    profile: null,
    unavailable: null,
  };
  let realmClone = clone;
  const sandbox = {
    console,
    crypto: {
      ...webcrypto,
      randomUUID: webcrypto.randomUUID.bind(webcrypto),
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: new Proxy(webcrypto.subtle, {
        get(target, property) {
          const method = Reflect.get(target, property, target);
          if (property === "digest") {
            return async (...args) => {
              const gate = digestGate;
              if (gate) {
                digestGate = null;
                gate.entered();
                await gate.release;
              }
              return Reflect.apply(method, target, args);
            };
          }
          return typeof method === "function" ? method.bind(target) : method;
        },
      }),
    },
    TextEncoder,
    TextDecoder,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    URL,
    Element: class Element {},
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(fn) { listeners.push(fn); },
          removeListener(fn) {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
        sendMessage(message, callback) {
          sent.push(clone(message));
          if (message?.messageType === "OZ_REQUEST_SIGNED_AI_PROFILE") {
            if (manual) {
              pending.push({ message: clone(message), callback });
              return;
            }
            queueMicrotask(() => callback(realmClone(responseFor(message))));
            return;
          }
          if (message?.messageType === "OZ_SIGNED_AI_PROFILE_RECEIPT") {
            const gate = receiptGate;
            if (gate) {
              receiptGate = null;
              gate.entered(message);
              void Promise.resolve(gate.release).then(() =>
                callback(realmClone({ ok: true, accepted: true })));
              return;
            }
            queueMicrotask(() => callback(realmClone({ ok: true, accepted: true })));
            return;
          }
          throw new Error("unexpected runtime message " + JSON.stringify(message));
        },
      },
    },
    SellerAgentsSignedProfileDomBridge: {
      scope: () => ({ family: scopeFamily, surface: "web", variant: null }),
      adapter: () => null,
      conversationRoot: () => conversationRoot,
      workInFlight: () => work,
    },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const cloneInRealm = vm.runInContext("(value) => JSON.parse(JSON.stringify(value))", context);
  realmClone = (value) => cloneInRealm(value);
  vm.runInContext(fs.readFileSync(path.join(runtime, "shared/signed_ai_profile_consumer.js"), "utf8"), context);
  async function makeProfile(
    revision,
    composerPrimary = { kind: "packaged_selector_reference", reference: "composer-root" },
    conversationPrimary = { kind: "packaged_selector_reference", reference: "conversation-root" },
  ) {
    const profile = realmClone({
      profileKey: "fixture-profile",
      revision,
      scopeVariant: null,
      contentSha256: "0".repeat(64),
      schemaVersion: "adapter_profile_v1",
      content: baseContent(composerPrimary, conversationPrimary),
      compatibility: clone(compatibility),
    });
    profile.contentSha256 = await sandbox.SellerAgentsSignedAiProfileConsumer.profileFingerprint(profile);
    return profile;
  }
  state.profile = await makeProfile(1);
  assert.equal(await sandbox.SellerAgentsSignedAiProfileConsumer.validMaterial(state.profile), true, JSON.stringify(state.profile));
  function responseFor(request) {
    if (state.unavailable) {
      return {
        messageType: "OZ_SIGNED_AI_PROFILE",
        protocolVersion: request.protocolVersion,
        requestId: request.requestId,
        ai: clone(request.ai),
        status: "UNAVAILABLE",
        reason: state.unavailable,
      };
    }
    return {
      messageType: "OZ_SIGNED_AI_PROFILE",
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      ai: clone(request.ai),
      status: "AVAILABLE",
      authority: clone(state.authority),
      profile: clone(state.profile),
    };
  }
  function resolvePending(index, override = null) {
    const row = pending[index];
    if (!row) throw new Error("pending request missing");
    queueMicrotask(() => row.callback(realmClone(override || responseFor(row.message))));
  }
  const runtimeSource = fs.readFileSync(path.join(runtime, "shared/signed_ai_profile_runtime.js"), "utf8");
  vm.runInContext(runtimeSource, context);
  await new Promise((r) => setTimeout(r, 0));
  const initial = await sandbox.SellerAgentsSignedProfileRuntime.refresh("fixture_ready");
  assert.equal(initial?.ok, true, JSON.stringify(initial));
  assert.equal(initial?.status, "APPLIED", JSON.stringify(initial));
  return {
    sandbox,
    listeners,
    sent,
    state,
    makeProfile,
    runtime: sandbox.SellerAgentsSignedProfileRuntime,
    setWork(value) { work = value; },
    setManual(value) { manual = value; },
    setScope(family) { scopeFamily = family; },
    setConversationRoot(value) { conversationRoot = value; },
    pauseNextDigest() {
      let enteredResolve;
      let releaseResolve;
      const entered = new Promise((resolve) => { enteredResolve = resolve; });
      const release = new Promise((resolve) => { releaseResolve = resolve; });
      digestGate = { entered: enteredResolve, release };
      return { entered, release: releaseResolve };
    },
    pauseNextReceipt() {
      let enteredResolve;
      let releaseResolve;
      const entered = new Promise((resolve) => { enteredResolve = resolve; });
      const release = new Promise((resolve) => { releaseResolve = resolve; });
      receiptGate = { entered: enteredResolve, release };
      return { entered, release: releaseResolve };
    },
    pending,
    resolvePending,
    responseFor,
    reloadRuntime() {
      vm.runInContext(runtimeSource, context);
      return sandbox.SellerAgentsSignedProfileRuntime;
    },
  };
}

await test("RUNTIME-01-same-generation-update-defer-rollback-clear", async () => {
  const f = await fixture();
  try {
    let state = f.runtime.debugState();
    assert.equal(state.applied.profile.revision, 1);

    f.state.profile = await f.makeProfile(2, {
      kind: "accessibility_role_name",
      role: "status",
      reference: "composer-root",
    });
    let update = await f.runtime.refresh("same_generation_update");
    assert.equal(update.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);
    assert.equal(f.runtime.debugState().applied.authority.authGeneration, 1);

    f.state.profile = await f.makeProfile(3);
    f.setWork(true);
    const deferred = await f.runtime.refresh("active_work");
    assert.equal(deferred.status, "DEFERRED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);
    assert.equal(f.sent.at(-1).status, "DEFERRED");

    f.setWork(false);
    update = await f.runtime.refresh("after_finish");
    assert.equal(update.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 3);

    f.state.profile = await f.makeProfile(1);
    const rollback = await f.runtime.refresh("verified_rollback");
    assert.equal(rollback.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 1);

    f.state.unavailable = "WORK_NOT_ALLOWED";
    const cleared = await f.runtime.refresh("revoked");
    assert.equal(cleared.status, "CLEARED");
    assert.equal(f.runtime.debugState().applied, null);
    assert.equal(f.sent.at(-1).status, "CLEARED");
  } finally {
    f.runtime.dispose();
  }
});

await test("RUNTIME-02-out-of-order-stale-response-cannot-restore-old-profile", async () => {
  const f = await fixture();
  try {
    const profile1 = await f.makeProfile(1);
    const profile2 = await f.makeProfile(2, {
      kind: "accessibility_role_name",
      role: "status",
      reference: "composer-root",
    });
    f.setManual(true);
    f.state.profile = profile1;
    const first = f.runtime.refresh("first");
    await new Promise((r) => setTimeout(r, 0));
    f.state.profile = profile2;
    const second = f.runtime.refresh("second");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(f.pending.length, 2);

    const secondResponse = f.responseFor(f.pending[1].message);
    f.resolvePending(1, secondResponse);
    const secondResult = await second;
    assert.equal(secondResult.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);

    const firstResponse = {
      ...f.responseFor(f.pending[0].message),
      profile: clone(profile1),
    };
    f.resolvePending(0, firstResponse);
    const firstResult = await first;
    assert.equal(firstResult.code, "STALE_REQUEST");
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);
  } finally {
    f.runtime.dispose();
  }
});

await test("RUNTIME-03-invalid-profile-rejected-and-ensure-fence-fails-closed", async () => {
  const f = await fixture();
  try {
    const invalid = await f.makeProfile(4);
    invalid.content.selectors.send.primary.reference = "copy-control";
    f.state.profile = invalid;
    const rejected = await f.runtime.refresh("invalid");
    assert.equal(rejected.code, "INVALID_PROFILE");
    assert.equal(f.runtime.debugState().applied, null);
    assert.equal(f.sent.at(-1).status, "REJECTED");

    f.state.profile = await f.makeProfile(5);
    const applied = await f.runtime.refresh("recover_valid");
    assert.equal(applied.status, "APPLIED");
    const wrong = clone(f.runtime.debugState().applied);
    wrong.profile.contentSha256 = "f".repeat(64);
    const ensured = await f.runtime.ensure({
      authority: wrong.authority,
      profile: wrong.profile,
    });
    assert.equal(ensured.applied, false);
    assert.equal(ensured.code, "PROFILE_FENCE_MISMATCH");
    assert.equal(f.runtime.debugState().applied, null);

    assert.equal(
      f.sent.some((message) => typeof message?.type === "string" && /WORK|SEND|EXECUTE|PROVIDER/.test(message.type)),
      false,
      "profile lifecycle must not replay or initiate irreversible work",
    );
  } finally {
    f.runtime.dispose();
  }
});


await test("RUNTIME-04-document-reload-does-not-carry-applied-profile", async () => {
  const f = await fixture();
  let fresh;
  try {
    assert.equal(f.runtime.debugState().applied.profile.revision, 1);
    f.runtime.dispose();
    f.setManual(true);
    const beforePending = f.pending.length;
    fresh = f.reloadRuntime();
    await new Promise((r) => setTimeout(r, 0));
    const waiting = fresh.debugState();
    assert.equal(waiting.applied, null);
    assert.ok(waiting.pending);
    assert.equal(f.pending.length, beforePending + 1);

    const index = f.pending.length - 1;
    f.resolvePending(index);
    let applied = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 0));
      applied = fresh.debugState();
      if (applied.applied && applied.pending === null) break;
    }
    assert.equal(applied.applied.profile.revision, 1);
    assert.equal(applied.pending, null);
  } finally {
    fresh?.dispose();
  }
});


await test("RUNTIME-05-scope-change-stops-old-ChatGPT-profile-before-response", async () => {
  const f = await fixture();
  try {
    f.state.profile = await f.makeProfile(2, {
      kind: "accessibility_role_name",
      role: "status",
      reference: "composer-root",
    });
    assert.equal((await f.runtime.refresh("chatgpt_role_profile")).status, "APPLIED");
    const baseline = { composer: {}, root: {}, form: {} };
    assert.equal(f.runtime.resolveComposerContext(null, baseline), null);

    f.setScope("alice");
    assert.equal(
      f.runtime.resolveComposerContext(null, baseline),
      baseline,
      "scope change must stop using old ChatGPT profile before Alice response arrives",
    );
    f.state.unavailable = "PROFILE_UNSUPPORTED";
    const cleared = await f.runtime.refresh("alice_scope_change");
    assert.equal(cleared.status, "CLEARED");
    assert.equal(cleared.reason, "PROFILE_UNSUPPORTED");
    assert.equal(f.runtime.debugState().applied, null);
  } finally {
    f.runtime.dispose();
  }
});

await test("RUNTIME-06-newer-refresh-wins-while-old-fingerprint-validation-is-paused", async () => {
  const f = await fixture();
  let gate;
  try {
    f.state.profile = await f.makeProfile(2);
    gate = f.pauseNextDigest();
    const oldRefresh = f.runtime.refresh("old_validation");
    await Promise.race([
      gate.entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("old fingerprint validation not reached")), 5000)),
    ]);

    f.state.profile = await f.makeProfile(3, {
      kind: "accessibility_role_name",
      role: "status",
      reference: "composer-root",
    });
    const newer = await f.runtime.refresh("newer_validation");
    assert.equal(newer.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 3);

    gate.release();
    gate = null;
    const oldResult = await oldRefresh;
    assert.equal(oldResult.code, "STALE_REQUEST");
    assert.equal(f.runtime.debugState().applied.profile.revision, 3);
  } finally {
    gate?.release?.();
    f.runtime.dispose();
  }
});


await test("RUNTIME-07-delayed-old-ensure-ack-cannot-clear-newer-bootstrap-profile", async () => {
  const f = await fixture();
  let gate;
  try {
    f.state.profile = await f.makeProfile(2);
    const oldExpected = {
      authority: clone(f.state.authority),
      profile: {
        profileKey: f.state.profile.profileKey,
        revision: f.state.profile.revision,
        scopeVariant: f.state.profile.scopeVariant,
        contentSha256: f.state.profile.contentSha256,
      },
    };
    gate = f.pauseNextReceipt();
    const oldEnsure = f.runtime.ensure(oldExpected);
    const oldReceipt = await Promise.race([
      gate.entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("old APPLIED receipt not reached")), 5000)),
    ]);
    assert.equal(oldReceipt.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);

    f.state.authority = { authGeneration: 1, bootstrapSnapshotSha256: "b".repeat(64) };
    f.state.profile = await f.makeProfile(3, {
      kind: "accessibility_role_name",
      role: "status",
      reference: "composer-root",
    });
    const newer = await f.runtime.refresh("newer_bootstrap_before_old_ack");
    assert.equal(newer.status, "APPLIED");
    assert.equal(f.runtime.debugState().applied.profile.revision, 3);
    assert.equal(f.runtime.debugState().applied.authority.bootstrapSnapshotSha256, "b".repeat(64));

    gate.release();
    gate = null;
    const stale = await oldEnsure;
    assert.equal(stale.applied, false);
    assert.equal(stale.code, "STALE_REQUEST");
    assert.equal(f.runtime.debugState().applied.profile.revision, 3);
    assert.equal(f.runtime.debugState().applied.authority.bootstrapSnapshotSha256, "b".repeat(64));
  } finally {
    gate?.release?.();
    f.runtime.dispose();
  }
});

await test("RUNTIME-08-dispose-during-APPLIED-receipt-ack-cannot-resurrect-profile", async () => {
  const f = await fixture();
  let gate;
  try {
    f.state.profile = await f.makeProfile(2);
    gate = f.pauseNextReceipt();
    const oldRefresh = f.runtime.refresh("dispose_during_receipt");
    await Promise.race([
      gate.entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("APPLIED receipt not reached before dispose")), 5000)),
    ]);
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);
    f.runtime.dispose();
    assert.equal(f.runtime.debugState().applied, null);

    gate.release();
    gate = null;
    const result = await oldRefresh;
    assert.equal(result.code, "STALE_REQUEST");
    assert.equal(f.runtime.debugState().applied, null);
  } finally {
    gate?.release?.();
    f.runtime.dispose();
  }
});

await test("RUNTIME-09-revocation-during-old-APPLIED-ack-keeps-cleared-state", async () => {
  const f = await fixture();
  let gate;
  try {
    f.state.profile = await f.makeProfile(2);
    gate = f.pauseNextReceipt();
    const oldRefresh = f.runtime.refresh("old_profile_before_revoke");
    await Promise.race([
      gate.entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("old APPLIED receipt not reached before revoke")), 5000)),
    ]);
    assert.equal(f.runtime.debugState().applied.profile.revision, 2);

    f.state.authority = { authGeneration: 1, bootstrapSnapshotSha256: "c".repeat(64) };
    f.state.unavailable = "WORK_NOT_ALLOWED";
    const revoked = await f.runtime.refresh("authority_revoked");
    assert.equal(revoked.status, "CLEARED");
    assert.equal(f.runtime.debugState().applied, null);

    gate.release();
    gate = null;
    const stale = await oldRefresh;
    assert.equal(stale.code, "STALE_REQUEST");
    assert.equal(f.runtime.debugState().applied, null);
  } finally {
    gate?.release?.();
    f.runtime.dispose();
  }
});


await test("RUNTIME-10-conversation-slot-scopes-packaged-message-region", async () => {
  const f = await fixture();
  try {
    const root = new f.sandbox.Element();
    const inside = new f.sandbox.Element();
    const outside = new f.sandbox.Element();
    root.tagName = "MAIN";
    root.getAttribute = (name) => name === "role" ? "main" : null;
    root.contains = (node) => node === inside;
    f.setConversationRoot(root);

    let assistant = f.runtime.resolveAssistantMessages(null, [inside, outside]);
    let users = f.runtime.resolveUserMessages(null, [outside, inside]);
    assert.equal(assistant.length, 1);
    assert.equal(assistant[0], inside);
    assert.equal(users.length, 1);
    assert.equal(users[0], inside);

    f.state.profile = await f.makeProfile(
      10,
      undefined,
      { kind: "accessibility_role_name", role: "status", reference: "conversation-root" },
    );
    const changed = await f.runtime.refresh("conversation_role_change");
    assert.equal(changed.status, "APPLIED");
    assert.equal(f.runtime.resolveConversationRoot(), null);
    assert.equal(f.runtime.resolveAssistantMessages(null, [inside, outside]).length, 0);
    assert.equal(f.runtime.resolveUserMessages(null, [inside, outside]).length, 0);
  } finally {
    f.runtime.dispose();
  }
});

console.log(JSON.stringify({
  status: "PASS",
  scenarios: results.length,
  results,
  live_provider_calls: 0,
  installed_acceptance: false,
}));
