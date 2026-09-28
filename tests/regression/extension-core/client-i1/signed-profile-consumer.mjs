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

console.log(JSON.stringify({
  status: "PASS",
  scenarios: results.length,
  results,
  live_provider_calls: 0,
  installed_acceptance: false,
}));
