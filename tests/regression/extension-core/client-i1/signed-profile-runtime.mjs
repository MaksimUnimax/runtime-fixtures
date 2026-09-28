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

function baseContent(composerPrimary = { kind: "packaged_selector_reference", reference: "composer-root" }) {
  return {
    schemaVersion: "adapter_profile_v1",
    page: {
      identityStrategy: "page_identity",
      conversationStrategy: "conversation_root",
      composerStrategy: "composer_root",
    },
    selectors: {
      conversation: { strategy: "conversation_root", primary: { kind: "packaged_selector_reference", reference: "conversation-root" }, fallbacks: [], timeoutMs: 1000, observationMode: "polling" },
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
  const pending = [];
  const state = {
    authority: { authGeneration: 1, bootstrapSnapshotSha256: "a".repeat(64) },
    profile: null,
    unavailable: null,
  };
  let realmClone = clone;
  const sandbox = {
    console,
    crypto: webcrypto,
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
            queueMicrotask(() => callback(realmClone({ ok: true, accepted: true })));
            return;
          }
          throw new Error("unexpected runtime message " + JSON.stringify(message));
        },
      },
    },
    SellerAgentsSignedProfileDomBridge: {
      scope: () => ({ family: "chatgpt", surface: "web", variant: null }),
      adapter: () => null,
      workInFlight: () => work,
    },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const cloneInRealm = vm.runInContext("(value) => JSON.parse(JSON.stringify(value))", context);
  realmClone = (value) => cloneInRealm(value);
  vm.runInContext(fs.readFileSync(path.join(runtime, "shared/signed_ai_profile_consumer.js"), "utf8"), context);
  async function makeProfile(revision, composerPrimary = { kind: "packaged_selector_reference", reference: "composer-root" }) {
    const profile = realmClone({
      profileKey: "fixture-profile",
      revision,
      scopeVariant: null,
      contentSha256: "0".repeat(64),
      schemaVersion: "adapter_profile_v1",
      content: baseContent(composerPrimary),
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

console.log(JSON.stringify({
  status: "PASS",
  scenarios: results.length,
  results,
  live_provider_calls: 0,
  installed_acceptance: false,
}));
