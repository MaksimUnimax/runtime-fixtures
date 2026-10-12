import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exact SOURCE test, not a browser-installed or user-authorized Work Start.
// Compose the same two pre-existing patches that add the identity surface fields.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = readFileSync(path.join(ROOT, "apps/extension/src/background/compat/createPendingWorkStart.js"), "utf8").trimEnd();
const patches = JSON.parse(readFileSync(path.join(ROOT, "apps/extension/application-patches.json"), "utf8"));
const sha256 = text => createHash("sha256").update(text).digest("hex");
assert.equal(sha256(source), "e00b5d597fc2a3f95c7d661eb2c45eb2c71eb1d2ecb5d05ccb9d3d4f71fa4d64");

function selectUniquePatch(pattern) {
  const hits = patches.filter(row =>
    row.target === "service_worker.js" &&
    typeof row.old === "string" &&
    typeof row.new === "string" &&
    pattern(row)
  );
  assert.equal(hits.length, 1, "Expected one unambiguous composition patch");
  return hits[0];
}
const surfacePatch = selectUniquePatch(row => row.old.includes("const sameSurface =") && row.new.includes("existing.surface_id === identity.surface_id"));
const fieldsPatch = selectUniquePatch(row => row.old.includes("conversation_key: conversationKey,") && row.new.includes("identity_scope: identity.identity_scope || null"));
let composed = source;
for (const patch of [surfacePatch, fieldsPatch]) {
  assert.equal(composed.split(patch.old).length - 1, 1, "Exact patch preimage must appear once in function");
  composed = composed.replace(patch.old, patch.new);
}
assert.equal(sha256(composed), "7332fc148c1af5f8bd4dde52bfdd29e0564037706cad2686cf4bf37a1938d2cb");
assert.match(composed, /readback\.surface_id !== transaction\.surface_id/);
assert.match(composed, /readback\.identity_scope !== transaction\.identity_scope/);

const copy = value => JSON.parse(JSON.stringify(value));
const identity = {
  origin: "https://chatgpt.com",
  ai_id: "chatgpt",
  surface_id: "synthetic-surface-A",
  identity_scope: "conversation",
  conversation_id: "synthetic-conversation-A"
};
const options = {
  intent_id: "synthetic-intent-A",
  revision: 4,
  observed_conversation_id: "synthetic-conversation-A",
  conversation_key: "synthetic-account-store-A",
  expected_session_revision: 3,
  prompt_tree: { version: 1, steps: [{ id: "synthetic-no-send" }] },
  admission_provenance: { source: "synthetic-test" }
};

function harness({ alterReadback = null, denyAdmission = false, failStorage = false, pending = {}, storeContext = null } = {}) {
  const state = { pending: copy(pending) };
  const counts = { reads: 0, writes: 0, admissions: 0, externalRequests: 0 };
  const events = [];
  const sandbox = {
    KEYS: { PENDING_WORK_STARTS: "pending" },
    saStarts: new Map([[41, storeContext || { accountId: "synthetic-account", storeId: "synthetic-store", marketplace: "ozon", credentialRevision: 7, policyRevision: "personal-disabled", authGeneration: "synthetic-generation" }]]),
    crypto: { randomUUID: () => "synthetic-uuid" },
    OzonWorkSessionModel: { STATES: { PENDING_IDENTITY: "PENDING_IDENTITY" } },
    getPendingWorkStarts: async () => {
      counts.reads++;
      const result = copy(state.pending);
      if (counts.reads === 2 && alterReadback && result["41"]) alterReadback(result["41"]);
      return result;
    },
    storageSet: async patch => {
      counts.writes++;
      assert.deepEqual(Object.keys(patch), ["pending"]);
      if (failStorage) throw Object.assign(new Error("Test storage unavailable"), { code: "TEST_STORAGE_FAILURE" });
      state.pending = copy(patch.pending);
    },
    diagnostic: async (code, data) => events.push({ code, external: data?.external_request_executed }),
    saAdmissionMutationGuard: async () => {
      counts.admissions++;
      if (denyAdmission) throw Object.assign(new Error("Test admission denied"), { code: "TEST_ADMISSION_DENIED" });
    }
  };
  const fn = runInContext(composed + "\ncreatePendingWorkStart;", createContext(sandbox));
  return { fn, state, counts, events };
}
const hasAck = h => h.events.some(entry => entry.code === "WORK_START_PENDING_COMMIT_ACK");
const assertFailClosed = async (mutate, label) => {
  const h = harness({ alterReadback: mutate });
  await assert.rejects(h.fn(41, identity, options), error => error?.code === "WORK_START_PENDING_COMMIT_READBACK_FAILED", label);
  assert.equal(hasAck(h), false, label);
  assert.equal(h.counts.externalRequests, 0, label);
  assert.equal(h.counts.writes, 1, label);
};

test("A01-01 durable store readback acknowledges matching identity", async () => {
  const h = harness();
  const result = await h.fn(41, identity, options);
  assert.equal(result.duplicate, false);
  assert.equal(result.transaction.intent_id, options.intent_id);
  assert.equal(result.transaction.surface_id, identity.surface_id);
  assert.equal(result.transaction.identity_scope, identity.identity_scope);
  assert.equal(result.transaction.prompt_delivered, false);
  assert.equal(result.transaction.send_outcome, "not_started");
  assert.equal(h.counts.reads, 2);
  assert.equal(h.counts.writes, 1);
  assert.equal(hasAck(h), true);
  assert.ok(h.events.every(e => e.external === false));
});
test("A01-02 unexpired duplicate does not write or send again", async () => {
  const h = harness();
  await h.fn(41, identity, options);
  const before = h.counts.writes;
  const result = await h.fn(41, identity, { ...options, intent_id: "another-intent" });
  assert.equal(result.duplicate, true);
  assert.equal(result.transaction.intent_id, options.intent_id);
  assert.equal(h.counts.writes, before);
  assert.equal(h.counts.externalRequests, 0);
});
test("A01-03 changed surface retires and replaces pending Start", async () => {
  const h = harness();
  await h.fn(41, identity, options);
  const another = { ...identity, surface_id: "synthetic-surface-B", conversation_id: "synthetic-conversation-B" };
  const result = await h.fn(41, another, { ...options, intent_id: "intent-B", observed_conversation_id: "synthetic-conversation-B" });
  assert.equal(result.duplicate, false);
  assert.equal(result.transaction.surface_id, "synthetic-surface-B");
  assert.equal(h.state.pending["41"].intent_id, "intent-B");
  assert.equal(h.counts.writes, 3);
  assert.ok(h.events.some(e => e.code === "WORK_PENDING_START_STALE_RETIRED"));
});
test("A01-04 corrupted intent fails before acknowledged send", async () => {
  await assertFailClosed(record => { record.intent_id = "wrong-intent"; }, "intent");
});
test("A01-05 corrupted surface fails before acknowledged send", async () => {
  await assertFailClosed(record => { record.surface_id = "wrong-surface"; }, "surface");
});
test("A01-06 corrupted identity scope fails before acknowledged send", async () => {
  await assertFailClosed(record => { record.identity_scope = "document"; }, "scope");
});
test("A01-07 admission refusal prevents writing pending Start", async () => {
  const h = harness({ denyAdmission: true });
  await assert.rejects(h.fn(41, identity, options), error => error?.code === "TEST_ADMISSION_DENIED");
  assert.equal(h.counts.writes, 0);
  assert.equal(hasAck(h), false);
  assert.equal(Object.keys(h.state.pending).length, 0);
});
test("A01-08 storage failure prevents acknowledging Start", async () => {
  const h = harness({ failStorage: true });
  await assert.rejects(h.fn(41, identity, options), error => error?.code === "TEST_STORAGE_FAILURE");
  assert.equal(hasAck(h), false);
});
test("A01-09 legacy pending without surface stays duplicate, no dispatch", async () => {
  const earlier = {
    41: {
      origin: identity.origin,
      ai_id: identity.ai_id,
      intent_id: "legacy-intent",
      revision: 1,
      expires_at: new Date(Date.now() + 60_000).toISOString()
    }
  };
  const h = harness({ pending: earlier });
  const result = await h.fn(41, { ...identity, surface_id: "different-surface" }, options);
  assert.equal(result.duplicate, true);
  assert.equal(result.transaction.intent_id, "legacy-intent");
  assert.equal(h.counts.writes, 0);
  assert.equal(h.counts.externalRequests, 0);
});
test("A01-10 missing readback surface field fails closed", async () => {
  await assertFailClosed(record => { delete record.surface_id; }, "missing surface");
});
test("A01-11 missing readback identity scope fails closed", async () => {
  await assertFailClosed(record => { delete record.identity_scope; }, "missing scope");
});
test("A01-12 null/null identity fields remain compatible", async () => {
  const h = harness();
  const result = await h.fn(41, { ...identity, surface_id: null, identity_scope: null }, options);
  assert.equal(result.duplicate, false);
  assert.equal(result.transaction.surface_id, null);
  assert.equal(result.transaction.identity_scope, null);
  assert.equal(hasAck(h), true);
});

test("A01-13 changed original store context fails before ACK", async () => {
  await assertFailClosed(record => { record.store_context.storeId = "different-synthetic-store"; }, "storeId");
});
test("A01-14 changed original conversation key fails before ACK", async () => {
  await assertFailClosed(record => { record.conversation_key = "different-synthetic-conversation"; }, "conversation_key");
});
test("A01-15 removed pinned store context fails before ACK", async () => {
  await assertFailClosed(record => { delete record.store_context; }, "missing store_context");
});
test("A01-16 reordered stored context properties do not cause a false rejection", async () => {
  const h = harness({
    alterReadback: record => {
      record.store_context = Object.fromEntries(Object.entries(record.store_context).reverse());
    }
  });
  const r = await h.fn(41, identity, options);
  assert.equal(r.duplicate, false);
  assert.equal(hasAck(h), true);
  assert.equal(h.counts.externalRequests, 0);
});
test("A01-17 extra unexpected store context property fails before ACK", async () => {
  await assertFailClosed(record => { record.store_context.addedField = "untrusted-test-field"; }, "extra store context field");
});

test("A01-18 removed conversation key fails before ACK", async () => {
  await assertFailClosed(record => { delete record.conversation_key; }, "missing conversation key");
});
test("A01-19 optional undefined generation survives Chrome-style JSON roundtrip", async () => {
  const h = harness({
    storeContext: {
      accountId: "synthetic-account", storeId: "synthetic-store", marketplace: "ozon",
      credentialRevision: 7, policyRevision: "personal-disabled", authGeneration: undefined
    }
  });
  const result = await h.fn(41, identity, options);
  assert.equal(result.duplicate, false);
  assert.equal(hasAck(h), true);
  assert.equal(h.counts.externalRequests, 0);
});
test("A01-20 changed pinned credential revision fails before ACK", async () => {
  await assertFailClosed(record => { record.store_context.credentialRevision = 8; }, "credential revision");
});
