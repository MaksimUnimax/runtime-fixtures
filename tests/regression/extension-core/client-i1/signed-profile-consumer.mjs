import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const results = [];
async function test(id, fn) {
  await fn();
  results.push({ id, status: "PASS" });
}
const plain = (value) => JSON.parse(JSON.stringify(value));

function trustedSender(worker) {
  const url = "https://chatgpt.com/c/core-fixture-dialogue";
  return {
    id: "core-fixture",
    frameId: 0,
    documentId: "fixture-document-1",
    url,
    tab: { id: worker.tabId, url },
  };
}
function requestFor(family = "chatgpt") {
  return {
    messageType: "OZ_REQUEST_SIGNED_AI_PROFILE",
    protocolVersion: "signed_ai_profile_consumer_v1",
    requestId: crypto.randomUUID(),
    ai: { family, surface: "web", variant: null },
  };
}
function changed(value, mutator) {
  const next = structuredClone(value);
  mutator(next);
  return next;
}

await test("PROFILE-01-strict-mirror-and-cross-field-rejects", async () => {
  const worker = await makeWorker(runtime);
  try {
    const authority = await worker.call("SellerAgentsControlClient.getAuthority");
    const profile = plain(authority.payload.ai.profile);
    assert.equal(
      await worker.call("SellerAgentsSignedAiProfileConsumer.validMaterial", profile),
      true,
    );

    const invalid = [
      changed(profile, (p) => { p.content.selectors.send.primary.reference = "copy-control"; }),
      changed(profile, (p) => { p.content.selectors.composer.primary.reference = "busy-control"; }),
      changed(profile, (p) => { p.content.selectors.send.fallbacks = [{ kind: "packaged_selector_reference", reference: "copy-control" }]; }),
      changed(profile, (p) => { p.content.contours[3].strategy = "assistant_response"; }),
      changed(profile, (p) => { p.content.selectors.send.primary.css = "button"; }),
      changed(profile, (p) => { p.content.javascript = "alert(1)"; }),
      changed(profile, (p) => { p.compatibility.url = "https://example.test/remote.js"; }),
      changed(profile, (p) => { p.contentSha256 = "0".repeat(64); }),
    ];
    for (const candidate of invalid) {
      assert.equal(
        await worker.call("SellerAgentsSignedAiProfileConsumer.validMaterial", candidate),
        false,
        JSON.stringify(candidate),
      );
    }

    const rollback = changed(profile, (p) => { p.revision = Math.max(1, p.revision - 1); });
    assert.equal(
      await worker.call("SellerAgentsSignedAiProfileConsumer.validMaterial", rollback),
      true,
      "revision is identity, not a delivery sequence",
    );
    assert.equal(worker.network.length, 0);
  } finally {
    worker.close();
  }
});

await test("PROFILE-02-worker-current-authority-request-receipt-and-Alice-hold", async () => {
  const worker = await makeWorker(runtime);
  try {
    const sender = trustedSender(worker);
    const request = requestFor();
    const response = await worker.request(request, sender);
    assert.equal(response.status, "AVAILABLE", JSON.stringify(response));
    assert.equal(response.requestId, request.requestId);
    assert.deepEqual(plain(response.ai), request.ai);
    assert.equal(
      await worker.call("SellerAgentsSignedAiProfileConsumer.validResponse", response),
      true,
    );

    const receipt = {
      messageType: "OZ_SIGNED_AI_PROFILE_RECEIPT",
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      ai: request.ai,
      status: "APPLIED",
      authority: response.authority,
      profile: {
        profileKey: response.profile.profileKey,
        revision: response.profile.revision,
        scopeVariant: response.profile.scopeVariant,
        contentSha256: response.profile.contentSha256,
      },
    };
    assert.equal((await worker.request(receipt, sender)).accepted, true);

    const stale = structuredClone(receipt);
    stale.profile.contentSha256 = "c".repeat(64);
    const staleResult = await worker.request(stale, sender);
    assert.equal(staleResult.accepted, false);
    assert.equal(staleResult.code, "STALE_REQUEST");

    const alice = await worker.request(requestFor("alice"), sender);
    assert.equal(alice.status, "UNAVAILABLE");
    assert.equal(alice.reason, "PROFILE_UNSUPPORTED");

    const untrusted = await worker.request(requestFor(), {
      ...sender,
      id: "other-extension",
    });
    assert.equal(untrusted.ok, false);
    assert.equal(untrusted.code, "SIGNED_PROFILE_SENDER_UNTRUSTED");

    assert.equal(worker.network.length, 0);
  } finally {
    worker.close();
  }
});


await test("PROFILE-03-revoked-and-expired-authority-cannot-activate", async () => {
  const revoked = await makeWorker(runtime);
  try {
    const sender = trustedSender(revoked);
    assert.equal((await revoked.request(requestFor(), sender)).status, "AVAILABLE");
    await revoked.call("SellerAgentsControlClient.localReset");
    const denied = await revoked.request(requestFor(), sender);
    assert.equal(denied.status, "UNAVAILABLE");
    assert.ok(["NO_VERIFIED_AUTHORITY", "WORK_NOT_ALLOWED"].includes(denied.reason));
    assert.equal(revoked.network.length, 0);
  } finally {
    revoked.close();
  }

  let now = Date.now();
  const expired = await makeWorker(runtime, { wallClock: () => now });
  try {
    const sender = trustedSender(expired);
    assert.equal((await expired.request(requestFor(), sender)).status, "AVAILABLE");
    now += 7_300_000;
    const denied = await expired.request(requestFor(), sender);
    assert.equal(denied.status, "UNAVAILABLE");
    assert.ok(["NO_VERIFIED_AUTHORITY", "WORK_NOT_ALLOWED", "AUTHORITY_CHANGED"].includes(denied.reason));
    assert.equal(expired.network.length, 0);
  } finally {
    expired.close();
  }
});

await test("PROFILE-04-worker-restart-requires-fresh-request", async () => {
  const first = await makeWorker(runtime);
  let resumed;
  try {
    const firstRequest = requestFor();
    const firstResponse = await first.request(firstRequest, trustedSender(first));
    assert.equal(firstResponse.status, "AVAILABLE");
    const backing = structuredClone(first.backing);
    first.close();

    resumed = await makeWorker(runtime, { backing });
    const secondRequest = requestFor();
    assert.notEqual(secondRequest.requestId, firstRequest.requestId);
    const secondResponse = await resumed.request(secondRequest, trustedSender(resumed));
    assert.equal(secondResponse.status, "AVAILABLE");
    assert.equal(secondResponse.requestId, secondRequest.requestId);
    assert.equal(secondResponse.profile.contentSha256, firstResponse.profile.contentSha256);
    assert.equal(resumed.network.length, 0);
    assert.equal(
      Object.keys(resumed.backing.local).some((key) => /signed.*profile.*consumer/i.test(key)),
      false,
      "profile relay must not invent persisted delivery state",
    );
  } finally {
    first.close();
    resumed?.close();
  }
});


await test("PROFILE-05-authority-loss-during-final-validation-never-returns-AVAILABLE", async () => {
  let armed = false;
  let profileDigests = 0;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const worker = await makeWorker(runtime, {
    beforeCryptoDigest: async (_algorithm, data) => {
      if (!armed) return;
      const bytes = data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      const text = bytes.toString("utf8");
      if (!text.startsWith('{"compatibility":')) return;
      profileDigests += 1;
      if (profileDigests === 2) {
        enteredResolve();
        await release;
      }
    },
  });
  try {
    armed = true;
    const pending = worker.request(requestFor(), trustedSender(worker));
    await Promise.race([
      entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("final validation digest not reached")), 5000)),
    ]);
    await worker.call("SellerAgentsControlClient.localReset");
    releaseResolve();
    const result = await pending;
    assert.equal(result.status, "UNAVAILABLE", JSON.stringify(result));
    assert.equal(result.reason, "AUTHORITY_CHANGED");
    assert.equal(worker.network.length, 0);
  } finally {
    releaseResolve?.();
    worker.close();
  }
});


await test("PROFILE-06-pending-start-provenance-rechecks-exact-profile-before-send", async () => {
  const worker = await makeWorker(runtime);
  try {
    await worker.settings();
    const popup = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
    assert.equal(popup.ok, true, JSON.stringify(popup));
    assert.equal(popup.stores.length, 1, JSON.stringify(popup.stores));
    const store = await worker.call("saCatalog.get", popup.stores[0].id);
    const storeContext = await worker.call("saAuthorityStoreContext", store);
    const authority = await worker.call("SellerAgentsControlClient.getAuthority");
    const generation = await worker.call("SellerAgentsControlClient.generation");
    const bootstrapSnapshotSha256 = await worker.call("saSnapshotDigest", authority.envelope);
    const profile = authority.payload.ai.profile;
    const detected = authority.payload.ai.detected;
    const pending = {
      store_context: plain(storeContext),
      admission_provenance: {
        accountGeneration: generation,
        bootstrapSnapshotSha256,
        aiFamily: detected.family,
        aiSurface: detected.surface,
        aiVariant: detected.variant,
        aiProfileKey: profile.profileKey,
        aiProfileRevision: profile.revision,
        aiProfileScopeVariant: profile.scopeVariant,
        aiProfileContentSha256: profile.contentSha256,
      },
    };
    await worker.call("saPendingGuard", pending);

    const stale = plain(pending);
    stale.admission_provenance.aiProfileContentSha256 = "f".repeat(64);
    await assert.rejects(
      async () => worker.call("saPendingGuard", stale),
      (error) => error?.code === "WORK_ADMISSION_CONTEXT_CHANGED",
    );
    assert.equal(worker.network.length, 0);
  } finally {
    worker.close();
  }
});


await test("PROFILE-07-authority-loss-during-receipt-validation-rejects-stale-ack", async () => {
  let armed = false;
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const worker = await makeWorker(runtime, {
    beforeCryptoDigest: async (_algorithm, data) => {
      if (!armed) return;
      const bytes = data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (!bytes.toString("utf8").startsWith('{"compatibility":')) return;
      armed = false;
      enteredResolve();
      await release;
    },
  });
  try {
    const sender = trustedSender(worker);
    const request = requestFor();
    const response = await worker.request(request, sender);
    assert.equal(response.status, "AVAILABLE", JSON.stringify(response));
    const receipt = {
      messageType: "OZ_SIGNED_AI_PROFILE_RECEIPT",
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      ai: request.ai,
      status: "APPLIED",
      authority: response.authority,
      profile: {
        profileKey: response.profile.profileKey,
        revision: response.profile.revision,
        scopeVariant: response.profile.scopeVariant,
        contentSha256: response.profile.contentSha256,
      },
    };

    armed = true;
    const pendingReceipt = worker.request(receipt, sender);
    await Promise.race([
      entered,
      new Promise((_, reject) => setTimeout(() => reject(new Error("receipt material digest not reached")), 5000)),
    ]);
    await worker.call("SellerAgentsControlClient.localReset");
    releaseResolve();
    const result = await pendingReceipt;
    assert.equal(result.accepted, false, JSON.stringify(result));
    assert.equal(result.code, "STALE_REQUEST");
    assert.equal(worker.network.length, 0);
  } finally {
    releaseResolve?.();
    worker.close();
  }
});


await test("PROFILE-08-failed-ensure-blocks-Start-and-Resume-before-legacy-action", async () => {
  let allowEnsure = true;
  const worker = await makeWorker(runtime, {
    profileEnsureResponse: (message) => allowEnsure
      ? {
          ok: true,
          applied: true,
          authority: plain(message.expected?.authority || null),
          profile: plain(message.expected?.profile || null),
        }
      : { ok: false, applied: false, code: "PROFILE_FENCE_MISMATCH" },
  });
  try {
    await worker.settings();
    const popup = await worker.popup({ type: "SA_POPUP_STATE", tab_id: worker.tabId });
    assert.equal(popup.ok, true, JSON.stringify(popup));
    const storeId = popup.stores[0].id;

    allowEnsure = false;
    const beforeStartMessages = worker.messages.length;
    const deniedStart = await worker.popup({
      type: "SA_WORK_START",
      tab_id: worker.tabId,
      store_id: storeId,
      confirm_change: true,
      start_intent_id: crypto.randomUUID(),
    });
    assert.equal(deniedStart.ok, false, JSON.stringify(deniedStart));
    assert.equal(deniedStart.code, "SIGNED_PROFILE_NOT_APPLIED");
    assert.deepEqual(plain(await worker.call("getPendingWorkStarts")), {});
    const deniedStartMessages = worker.messages.slice(beforeStartMessages);
    assert.equal(deniedStartMessages.filter((m) => m.type === "OZ_SIGNED_AI_PROFILE_ENSURE").length, 1);
    assert.equal(deniedStartMessages.some((m) => m.type === "OZ_WORK_SEND_INITIAL_PROMPT"), false);

    allowEnsure = true;
    const key = await worker.start();
    const finish = await worker.popup({
      type: "OZ_WORK_FINISH",
      tab_id: worker.tabId,
      conversation_key: key,
    });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.equal((await worker.call("workSessionFor", key)).state, "inactive");

    allowEnsure = false;
    const beforeResumeMessages = worker.messages.length;
    const deniedResume = await worker.popup({
      type: "SA_WORK_RESUME",
      tab_id: worker.tabId,
      conversation_key: key,
    });
    assert.equal(deniedResume.ok, false, JSON.stringify(deniedResume));
    assert.equal(deniedResume.code, "SIGNED_PROFILE_NOT_APPLIED");
    assert.equal((await worker.call("workSessionFor", key)).state, "inactive");
    const deniedResumeMessages = worker.messages.slice(beforeResumeMessages);
    assert.equal(deniedResumeMessages.filter((m) => m.type === "OZ_SIGNED_AI_PROFILE_ENSURE").length, 1);
    assert.equal(deniedResumeMessages.some((m) => m.type === "OZ_WORK_APPLY_VISIBILITY"), false);
    assert.equal(worker.network.length, 0);
  } finally {
    worker.close();
  }
});

console.log(JSON.stringify({
  status: "PASS",
  scenarios: results.length,
  results,
  live_provider_calls: 0,
  installed_acceptance: false,
}));
