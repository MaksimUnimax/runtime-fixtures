// Exact composed WB provider artifact contract: source-only, no live provider/DB.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import vm from "node:vm";

const WORKER_SOURCE = readFileSync(new URL("../../../apps/extension/src/imported/ozon-v0.1.22/shared/file_delivery_port_worker.js", import.meta.url), "utf8");
const APPLICATION_SOURCE = readFileSync(new URL("../../../apps/extension/src/application/delivery.js", import.meta.url), "utf8");
const PLAN_SOURCE = readFileSync(new URL("../../../packages/marketplaces/ozon/src/delivery-plan.js", import.meta.url), "utf8");

// IndexedDB-style asynchronous request/transaction completion, kept entirely
// in memory. The real browser transaction remains covered by installed tests.
const records = new Map();
let commits = 0, inserts = 0;
const db = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction() {
    let pending = 0, ended = false;
    const tx = { abort() { ended = true; queueMicrotask(() => tx.onabort?.()); } };
    function finish() {
      queueMicrotask(() => {
        if (!pending && !ended) { ended = true; commits++; tx.oncomplete?.(); }
      });
    }
    tx.objectStore = () => ({
      get(key) {
        pending++;
        const req = {};
        queueMicrotask(() => {
          req.result = records.get(key);
          req.onsuccess?.();
          pending--; finish();
        });
        return req;
      },
      add(value) {
        pending++;
        const req = {};
        queueMicrotask(() => {
          if (records.has(value.artifact_key)) {
            req.error = new Error("duplicate");
            req.onerror?.();
            tx.abort();
          } else {
            records.set(value.artifact_key, structuredClone(value));
            inserts++;
            req.onsuccess?.();
          }
          pending--; finish();
        });
        return req;
      }
    });
    return tx;
  }
};
const context = {
  OzonRuntime: { STORAGE_KEYS: {} },
  BridgeAutorunModel: { ATTACHMENT_PHASES: {} },
  ProviderTransportCore: {
    reportBase64ToBytes: (value) => Uint8Array.from(Buffer.from(value, "base64"))
  },
  chrome: { runtime: { onConnect: { addListener() {} } } },
  setTimeout() {},
  indexedDB: { open() {
    const req = { result: db };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  } },
  saEnabled: async () => true,
  saGuard: async () => ({ assertCurrent: async () => {} }),
  saError: (code) => Object.assign(new Error(code), { code }),
  OzonAIDeliveryCapabilities: { extensionFromFilename: (name) => name.split(".").at(-1) },
  crypto: crypto.webcrypto, TextEncoder, Uint8Array, ArrayBuffer, Date, URL
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(WORKER_SOURCE, context);
const baselineKeys = Object.keys(context.OzonFileDeliveryWorker);
assert.equal(typeof context.OzonFileDeliveryWorker.storeApplicationArtifact, "undefined");
vm.runInContext(APPLICATION_SOURCE + "\nthis.testPrepare = saPrepareDelivery;", context);
const bridge = context.OzonFileDeliveryWorker;
assert.equal(typeof bridge.storeApplicationArtifact, "function");
assert.equal(typeof bridge.copyManifest, "function");
for (const name of baselineKeys) assert(name in bridge);
vm.runInContext(PLAN_SOURCE, context);
const plan = context.SellerAgentsOzonDeliveryPlan.create(() => ({
  adapterIdForOrigin: () => "chatgpt",
  generatedTextDecision: () => ({ representation: "plain_text" }),
  utf8ByteLength: (text) => Buffer.byteLength(text)
}));

function owner(accountId, storeId, op = "synthetic-operation") {
  return { operation_id: op, execution_context: {
    marketplace: "wildberries", accountId, storeId,
    bindingId: "binding", workSessionId: "work-session"
  }, payload_expires_at_ms: Date.now() + 500000 };
}
function result(id, body = "synthetic") {
  const bytes = Buffer.from(body);
  return {
    report_text: "WB_RESULT_V1\n" + JSON.stringify({
      result: {
        content_base64: bytes.toString("base64"),
        byte_length: bytes.length,
        original_filename: "synthetic.csv",
        content_type: "text/csv"
      }
    }),
    http_status: 200, operation: "report_file",
    provider_attempt: { provider_attempt_id: id }, request_id: id
  };
}
const checks = [];
async function check(name, test) {
  try { await test(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: String(error) }); }
}
let first, original;

await check("provider_bytes_persist_before_descriptor", async () => {
  first = (await context.testPrepare([result("SYNTH/a")], owner("account-A", "store-A")))[0];
  assert.match(first.provider_file_ref, /^sa_file_[a-f0-9]{64}$/);
  assert.equal(first.report_text.includes("content_base64"), false);
  original = records.get("provider:" + first.provider_file_ref);
  assert.equal(original.byte_length, 9);
  assert.equal(original.sha256, crypto.createHash("sha256").update("synthetic").digest("hex"));
  assert(commits > 0);
});
await check("same_result_is_idempotent_after_restart", async () => {
  const before = inserts;
  const repeated = (await context.testPrepare([result("SYNTH/a")], owner("account-A", "store-A")))[0];
  assert.equal(repeated.provider_file_ref, first.provider_file_ref);
  assert.equal(inserts, before);
});
await check("normalized_attempt_ids_have_distinct_artifact_keys", async () => {
  const alternative = (await context.testPrepare([result("SYNTH-a")], owner("account-A", "store-A")))[0];
  assert.notEqual(alternative.provider_file_ref, first.provider_file_ref);
});
await check("different_account_and_store_cannot_alias_artifact", async () => {
  const otherAccount = (await context.testPrepare([result("SYNTH/a")], owner("account-B", "store-A")))[0];
  const otherStore = (await context.testPrepare([result("SYNTH/a")], owner("account-A", "store-B")))[0];
  assert.notEqual(otherAccount.provider_file_ref, first.provider_file_ref);
  assert.notEqual(otherStore.provider_file_ref, first.provider_file_ref);
});
await check("generated_file_ref_is_accepted_by_delivery_plan", async () => {
  const run = { execution_context: owner("account-A", "store-A").execution_context,
    origin: "https://chatgpt.com",
    batch: { entries: [{ ...first, status: "complete", http_status: 200 }] } };
  const next = plan.attachmentDeliveryPlan(run, {
    mode: "batch_watch_v1", deliveryId: "synthetic-delivery", outgoingText: "OK"
  });
  assert(next);
  assert.deepEqual(Array.from(next.provider_file_refs), [first.provider_file_ref]);
});
await check("different_bytes_with_existing_identity_do_not_overwrite", async () => {
  const sha = records.get(original.artifact_key).sha256;
  await assert.rejects(context.testPrepare([result("SYNTH/a", "changed")], owner("account-A", "store-A")), /CONFLICT_NO_OVERWRITE/);
  assert.equal(records.get(original.artifact_key).sha256, sha);
});
const descriptor = () => {
  const saved = records.get(original.artifact_key);
  return { artifact_key: saved.artifact_key, source_kind: saved.source_kind,
    filename: saved.filename, byte_length: saved.byte_length, sha256: saved.sha256 };
};
await check("copy_manifest_reads_and_verifies_record", async () => {
  const manifest = await bridge.copyManifest({ mode: "attachment_watch_v1",
    phase: "attachment_ready", artifact_descriptors: [descriptor()] });
  assert.equal(manifest[0].sha256, original.sha256);
});
await check("copy_manifest_rejects_uncommitted_attachment", async () => {
  await assert.rejects(bridge.copyManifest({ mode: "attachment_watch_v1",
    phase: "attachment_claimed", artifact_descriptors: [] }), /NOT_READY_NO_RETRY/);
});
await check("copy_manifest_rejects_corrupt_file_bytes", async () => {
  const saved = records.get(original.artifact_key), previous = saved.bytes;
  saved.bytes = Uint8Array.from(Buffer.from("corrupted")).buffer;
  await assert.rejects(bridge.copyManifest({ mode: "attachment_watch_v1",
    phase: "attachment_ready", artifact_descriptors: [descriptor()] }), /INTEGRITY_UNKNOWN_NO_RETRY/);
  saved.bytes = previous;
});
await check("copy_manifest_rejects_expired_file", async () => {
  const saved = records.get(original.artifact_key), previous = saved.expires_at_ms;
  saved.expires_at_ms = Date.now() - 1;
  await assert.rejects(bridge.copyManifest({ mode: "attachment_watch_v1",
    phase: "attachment_ready", artifact_descriptors: [descriptor()] }), /INTEGRITY_UNKNOWN_NO_RETRY/);
  saved.expires_at_ms = previous;
});
await check("store_identity_must_be_known_before_persistence", async () => {
  const before = inserts;
  await assert.rejects(context.testPrepare([result("SYNTH/a")], owner("account-A", "")), /IDENTITY_UNVERIFIED/);
  assert.equal(inserts, before);
});
await check("expired_owner_data_cannot_be_saved", async () => {
  const expired = owner("account-A", "store-A", "expired");
  expired.payload_expires_at_ms = Date.now() - 1;
  const before = inserts;
  await assert.rejects(context.testPrepare([result("SYNTH/a")], expired), /EXPIRED_NO_RETRY/);
  assert.equal(inserts, before);
});
const failed = checks.filter((entry) => !entry.pass);
console.log("WB_ORIGINAL_APPLICATION_FILE_REGRESSION " + JSON.stringify({
  total: checks.length, pass: checks.length - failed.length,
  failed, inserts, committed_transactions: commits
}));
assert.equal(failed.length, 0, "WB original-file delivery regression");
