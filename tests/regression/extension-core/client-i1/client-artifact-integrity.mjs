// Exercise the composed worker's private port handler, not an exported facade.
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
assert.ok(process.argv[3] === undefined || process.argv[3] === "--store");
const fixtureEnvironment = process.argv[3] === "--store" ? "PREPRODUCTION" : "LOCAL DEVELOPMENT";
const records = new Map();
let inserts = 0;
// Requests return snapshots like IndexedDB. A transaction completes only after
// requests enqueued by its callbacks, and a failed add cannot overwrite a row.
const indexedDB = { open() {
  const request = {};
  queueMicrotask(() => {
    request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
      let pending = 0, ended = false;
      const tx = { abort() { ended = true; queueMicrotask(() => tx.onabort?.()); } };
      const operation = (kind, value) => {
        const req = {}; pending++;
        queueMicrotask(() => {
          if (ended) return;
          if (kind === "add" && records.has(value.artifact_key)) {
            req.error = new Error("duplicate"); req.onerror?.(); tx.abort();
          } else {
            if (kind === "put" || kind === "add") {
              records.set(value.artifact_key, structuredClone(value)); inserts++;
            }
            if (kind === "delete") records.delete(value);
            req.result = kind === "get" ? structuredClone(records.get(value))
              : kind === "all" ? [...records.values()].map(value => structuredClone(value)) : value?.artifact_key;
            req.onsuccess?.();
          }
          pending--;
          queueMicrotask(() => { if (!pending && !ended) { ended = true; tx.oncomplete?.(); } });
        });
        return req;
      };
      tx.objectStore = () => ({ get: key => operation("get", key), getAll: () => operation("all"),
        put: row => operation("put", row), add: row => operation("add", row), delete: key => operation("delete", key) });
      return tx;
    } };
    request.onsuccess?.();
  });
  return request;
} };
const originalBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 10, 0, 255]);
const startTime = Date.now();
let now = startTime, duringDigest = null, providerCalls = 0;
const worker = await makeWorker(runtime, { fixtureEnvironment, indexedDB, wallClock: () => now,
  beforeCryptoDigest: async () => { const action = duringDigest; duringDigest = null; await action?.(); },
  fetch: async url => {
    if (url.startsWith("https://")) {
      providerCalls++;
      return new Response(originalBytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="integrity.pdf"' } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  },
});
const outcomes = [];
async function check(name, test) {
  try { await test(); outcomes.push({ name, pass: true }); }
  catch (error) { outcomes.push({ name, pass: false, error: String(error) }); }
  finally { duringDigest = null; now = startTime; }
}
try {
  worker.setDialogue("11111111-1111-4111-8111-111111111111");
  const popup = { url: "chrome-extension://core-fixture/popup.html" };
  const sender = { tab: { id: worker.tabId }, url: worker.identity.origin + "/c/" + worker.identity.conversation_id };
  const saved = await worker.request({ type: "SA_STORE_SAVE", store: { marketplace: "wildberries",
    credentials: { token: "FIXTURE_ARTIFACT_TOKEN" }, personalDataEnabled: true } }, popup);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const started = await worker.request({ type: "SA_WORK_START", store_id: saved.store.id, tab_id: worker.tabId, confirm_change: true }, popup);
  assert.equal(started.ok, true, JSON.stringify(started));
  const pending = await until(async () => {
    const row = (await worker.call("getPendingWorkStarts"))[worker.tabId];
    return row?.send_outcome === "sent_acknowledged" && row;
  }, "artifact start acknowledgement");
  const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id,
    revision: pending.revision, identity: worker.identity, first_response_complete: true }, sender);
  assert.equal(active.ok, true, JSON.stringify(active));
  const contract = await worker.call("(() => SellerAgentsWBReference.contract)");
  const meta = Object.values(contract.OPERATIONS).find(item => item.response_mode === "binary" && item.execution_enabled && item.privacy === "standard");
  assert.ok(meta);
  const command = "WB_API_V1 " + JSON.stringify({ operation: meta.alias, params: {
    path: Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], "fixture"])),
    query: Object.fromEntries(meta.required_query_keys.map(key => [key, "1"])), ...(meta.body_required ? { body: {} } : {}) } });
  const admitted = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: active.binding.conversation_key,
    command_text: command, manual_request_id: "artifact-integrity", work_session_id: active.session.start_intent_id }, sender);
  assert.equal(admitted.accepted, true, JSON.stringify(admitted));
  const owner = await until(async () => {
    const value = await worker.call("getManualOperation", active.binding.conversation_key);
    if (value?.status === "failed") throw new Error(JSON.stringify(value.last_error));
    return value?.status === "delivering" && value;
  }, "artifact delivering owner");
  const fields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: owner.conversation_key,
    delivery_id: owner.delivery_id, actor_id: "artifact-integrity" };
  const committed = await worker.portRequest({ type: "OZ_ATTACHMENT_COMMIT", ...fields });
  assert.equal(committed.attach_allowed, true, JSON.stringify(committed));
  const metadata = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_META", ...fields });
  assert.equal(metadata.ok, true, JSON.stringify(metadata));
  const descriptor = metadata.descriptors.find(row => row.source_kind === "original_provider_file");
  assert.ok(descriptor);
  const pristine = structuredClone(records.get(descriptor.artifact_key));
  assert.ok(pristine);
  const delivery = { mode: "attachment_watch_v1", phase: await worker.call("(() => BridgeAutorunModel.ATTACHMENT_PHASES.ATTACH_COMMITTED)"), artifact_descriptors: [descriptor] };
  const chunk = () => worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_CHUNK", ...fields,
    artifact_key: descriptor.artifact_key, offset: 0, length: 32 });
  const copy = () => worker.call("OzonFileDeliveryWorker.copyManifest", delivery);
  const reset = () => records.set(descriptor.artifact_key, structuredClone(pristine));
  async function denyChunk() {
    const result = await chunk();
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.chunk_base64, undefined, "denial exposes no bytes");
  }
  await check("valid_composed_chunk_and_copy", async () => {
    assert.deepEqual(Buffer.from((await chunk()).chunk_base64, "base64"), Buffer.from(originalBytes));
    assert.equal((await copy())[0].sha256, descriptor.sha256);
  });
  const store = input => worker.call("(input => OzonFileDeliveryWorker.storeApplicationArtifact({ ...input, bytes: new Uint8Array(input.bytes) }))", input);
  const storeInput = () => ({ ...pristine, bytes: [...originalBytes] });
  await check("repeat_storage_preserves_initial_deadline", async () => {
    reset(); now += 2000;
    const before = inserts;
    await store({ ...storeInput(), expires_at_ms: pristine.expires_at_ms + 2000 });
    assert.equal(inserts, before);
    assert.equal(records.get(descriptor.artifact_key).created_at_ms, pristine.created_at_ms);
    assert.equal(records.get(descriptor.artifact_key).expires_at_ms, pristine.expires_at_ms);
  });
  await check("same_identity_different_bytes_cannot_overwrite", async () => {
    reset();
    const input = storeInput(); input.bytes[0] ^= 1;
    await assert.rejects(() => store(input), /CONFLICT_NO_OVERWRITE/);
    assert.deepEqual(new Uint8Array(records.get(descriptor.artifact_key).bytes), originalBytes);
  });
  await check("corrupted_prior_storage_cannot_be_repaired_or_extended", async () => {
    reset();
    const damaged = records.get(descriptor.artifact_key);
    new Uint8Array(damaged.bytes)[0] ^= 1;
    const before = structuredClone(damaged), writes = inserts;
    now += 2000;
    await assert.rejects(() => store({ ...storeInput(), expires_at_ms: pristine.expires_at_ms + 2000 }), /CONFLICT_NO_OVERWRITE/);
    assert.equal(inserts, writes, "corrupt prior row must never be overwritten");
    assert.deepEqual(records.get(descriptor.artifact_key), before, "original bytes and deadline retained for denial");
  });
  await check("same_identity_metadata_cannot_overwrite", async () => {
    reset();
    await assert.rejects(() => store({ ...storeInput(), filename: "changed.pdf" }), /CONFLICT_NO_OVERWRITE/);
    assert.equal(records.get(descriptor.artifact_key).filename, pristine.filename);
  });
  await check("expired_identity_cannot_be_recreated", async () => {
    reset(); records.get(descriptor.artifact_key).expires_at_ms = now;
    const before = inserts;
    await assert.rejects(() => store(storeInput()), /CONFLICT_NO_OVERWRITE/);
    assert.equal(inserts, before);
  });
  await check("hash_delay_cannot_persist_expired_payload", async () => {
    reset(); const before = inserts;
    duringDigest = () => { now += 100; };
    await assert.rejects(() => store({ ...storeInput(), expires_at_ms: now + 100 }), /EXPIRED_NO_RETRY/);
    assert.equal(inserts, before);
  });
  const binaryResult = id => ({ http_status: 200, operation: meta.alias,
    provider_attempt: { provider_attempt_id: id }, request_id: id,
    report_text: "WB_RESULT_V1\n" + JSON.stringify({ result: { content_base64: Buffer.from(originalBytes).toString("base64"),
      byte_length: originalBytes.length, original_filename: "identity.pdf", content_type: "application/pdf" } }) });
  await check("logical_identity_avoids_lossy_normalization_and_retains_restart_key", async () => {
    const a = (await worker.call("saPrepareDelivery", [binaryResult("same/a")], owner))[0];
    const b = (await worker.call("saPrepareDelivery", [binaryResult("same-a")], owner))[0];
    assert.match(a.provider_file_ref, /^sa_file_[a-f0-9]{64}$/);
    assert.notEqual(a.provider_file_ref, b.provider_file_ref);
    const before = inserts;
    const repeated = (await worker.call("saPrepareDelivery", [{ report_text: "unrelated", http_status: 200 }, binaryResult("same/a")], owner))[1];
    assert.equal(repeated.provider_file_ref, a.provider_file_ref);
    assert.equal(inserts, before);
  });
  await check("logical_identity_does_not_truncate_long_ids", async () => {
    const prefix = "a".repeat(190);
    const a = (await worker.call("saPrepareDelivery", [binaryResult(prefix + "-first")], owner))[0];
    const b = (await worker.call("saPrepareDelivery", [binaryResult(prefix + "-second")], owner))[0];
    assert.notEqual(a.provider_file_ref, b.provider_file_ref);
  });
  await check("invalid_identity_is_denied_before_storage", async () => {
    const before = inserts;
    await assert.rejects(() => worker.call("saPrepareDelivery", [binaryResult("a".repeat(513))], owner), /IDENTITY_INVALID/);
    assert.equal(inserts, before);
  });
  const mutations = {
    same_length_bytes: row => { new Uint8Array(row.bytes)[0] ^= 1; },
    digest: row => { row.sha256 = "0".repeat(64); },
    length: row => { row.byte_length++; },
    filename: row => { row.filename = "changed.pdf"; },
    mime: row => { row.mime_type = "application/octet-stream"; },
    source_kind: row => { row.source_kind = "generated_text"; },
    extension: row => { row.extension = "exe"; },
    key: row => { row.artifact_key += "-changed"; },
    expired: row => { row.expires_at_ms = now; },
    nan_expiry: row => { row.expires_at_ms = NaN; },
    infinite_expiry: row => { row.expires_at_ms = Infinity; },
    future_creation: row => { row.created_at_ms = now + 1; },
    missing_creation: row => { delete row.created_at_ms; },
    excessive_ttl: row => { row.created_at_ms = now - 3600000; row.expires_at_ms = now + 1; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await check("chunk_rejects_" + name, async () => { reset(); mutate(records.get(descriptor.artifact_key)); await denyChunk(); });
    await check("copy_rejects_" + name, async () => { reset(); mutate(records.get(descriptor.artifact_key)); await assert.rejects(copy); });
  }
  for (const operation of ["chunk", "copy"]) {
    await check(operation + "_rechecks_expiry_after_digest", async () => {
      reset(); records.get(descriptor.artifact_key).expires_at_ms = now + 100;
      duringDigest = () => { now += 100; };
      if (operation === "chunk") await denyChunk(); else await assert.rejects(copy);
    });
  }
  await check("chunk_rechecks_committed_descriptor_after_digest", async () => {
    reset();
    const mapKey = Object.keys(worker.backing.local).find(key => worker.backing.local[key]?.[owner.conversation_key]?.operation_id === owner.operation_id);
    assert.ok(mapKey, "actual persisted owner map");
    const before = structuredClone(worker.backing.local[mapKey]);
    try {
      duringDigest = () => {
        const current = worker.backing.local[mapKey][owner.conversation_key];
        current.delivery.artifact_descriptors.find(row => row.artifact_key === descriptor.artifact_key).sha256 = "0".repeat(64);
      };
      await denyChunk();
    } finally { worker.backing.local[mapKey] = before; }
  });
  await check("copy_rechecks_earlier_artifact_after_later_hash", async () => {
    reset(); records.get(descriptor.artifact_key).expires_at_ms = now + 100;
    const second = { ...structuredClone(pristine), artifact_key: pristine.artifact_key + "-second", expires_at_ms: now + 1000 };
    records.set(second.artifact_key, second);
    try {
      duringDigest = () => { duringDigest = () => { now += 100; }; };
      await assert.rejects(() => worker.call("OzonFileDeliveryWorker.copyManifest", { ...delivery,
        artifact_descriptors: [descriptor, { ...descriptor, artifact_key: second.artifact_key }] }));
    } finally { records.delete(second.artifact_key); }
  });
  await check("unowned_artifact_is_denied", async () => {
    reset();
    const response = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_CHUNK", ...fields,
      artifact_key: "provider:unowned", offset: 0, length: 32 });
    assert.equal(response.code, "ATTACHMENT_ARTIFACT_NOT_OWNED");
    assert.equal(response.chunk_base64, undefined);
  });
  await check("no_provider_replay", async () => { assert.equal(providerCalls, 1); assert.ok(inserts > 0); });
} finally { worker.close(); }
// Ozon original-file capture starts its own TTL after the operation starts.
// Seed that already-captured IDB record and committed attachment on a real Ozon
// operation; all ownership/context guards still execute in the actual worker.
for (const crossDeadline of [false, true]) {
  await check("ozon_owner_deadline_after_final_guard_" + (crossDeadline ? "denied" : "positive"), async () => {
    records.clear();
    let providerRequests = 0, deadline;
    const ozon = await makeWorker(runtime, { fixtureEnvironment, indexedDB, wallClock: () => now,
      onStorageWrite: (kind, values) => {
        if (kind === "session" && values.__fixture_final_owner_guard_delay)
          now = deadline - (crossDeadline ? 0 : 1);
      },
      fetch: async url => {
        if (url.startsWith("https://")) providerRequests++;
        return new Response(JSON.stringify({ result: [] }), { headers: { "content-type": "application/json" } });
      },
    });
    try {
      ozon.setDialogue("22222222-2222-4222-8222-222222222222");
      await ozon.settings();
      const key = await ozon.start();
      const session = await ozon.call("workSessionFor", key);
      const sender = { tab: { id: ozon.tabId }, url: ozon.identity.origin + "/c/" + ozon.identity.conversation_id };
      const result = await ozon.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: key,
        command_text: 'OZON_API_V1 {"operation":"seller_info","params":{}}',
        manual_request_id: "ozon-original-expiry", work_session_id: session.start_intent_id }, sender);
      assert.equal(result.accepted, true, JSON.stringify(result));
      const owner = await until(async () => {
        const row = await ozon.call("getManualOperation", key);
        if (row?.status === "failed") throw new Error(JSON.stringify(row.last_error));
        return row?.status === "delivering" && row;
      }, "Ozon original-file fixture owner");
      assert.equal(owner.execution_context.marketplace, "ozon");
      deadline = owner.payload_expires_at_ms;
      const artifactKey = "provider:ozon-original-fixture";
      const capturedAt = now + 1000;
      now = capturedAt;
      const digest = createHash("sha256").update(originalBytes).digest("hex");
      const descriptor = { artifact_key: artifactKey, source_kind: "original_provider_file",
        filename: "ozon-original.pdf", mime_type: "application/pdf", extension: "pdf",
        byte_length: originalBytes.length, sha256: digest };
      records.set(artifactKey, { ...descriptor, bytes: originalBytes.slice().buffer,
        created_at_ms: capturedAt, expires_at_ms: capturedAt + 3600000 });
      assert.ok(records.get(artifactKey).expires_at_ms > deadline);
      const mapKey = Object.keys(ozon.backing.local).find(name => ozon.backing.local[name]?.[key]?.operation_id === owner.operation_id);
      assert.ok(mapKey);
      ozon.backing.local[mapKey][key].delivery = { ...owner.delivery, mode: "attachment_watch_v1",
        phase: await ozon.call("(() => BridgeAutorunModel.ATTACHMENT_PHASES.ATTACH_COMMITTED)"), artifact_descriptors: [descriptor] };
      // Delay only completion of the final real guard. The preceding guard and
      // every underlying authority/context/storage check are still awaited.
      await ozon.call(`(() => {
        const original = saAssertDeliveryOwner;
        globalThis.__fixture_owner_guard_calls = 0;
        saAssertDeliveryOwner = async owner => {
          const ordinal = ++globalThis.__fixture_owner_guard_calls;
          await original(owner);
          if (ordinal === 5) await chrome.storage.session.set({ __fixture_final_owner_guard_delay: true });
        };
      })`);
      const chunk = await ozon.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_CHUNK", owner_kind: "manual",
        owner_id: owner.operation_id, conversation_key: key, delivery_id: owner.delivery.delivery_id,
        artifact_key: artifactKey, offset: 0, length: 32 });
      assert.equal(await ozon.call("(() => globalThis.__fixture_owner_guard_calls)"), 5, "last guard delay exercised: " + JSON.stringify(chunk));
      assert.ok(records.get(artifactKey).expires_at_ms > now, "artifact remains valid beyond owner deadline");
      if (crossDeadline) {
        assert.equal(chunk.ok, false, JSON.stringify(chunk));
        assert.equal(chunk.code, "RESULT_EXPIRED");
        assert.equal(chunk.chunk_base64, undefined);
      } else {
        assert.equal(chunk.ok, true, JSON.stringify(chunk));
        assert.deepEqual(Buffer.from(chunk.chunk_base64, "base64"), Buffer.from(originalBytes));
      }
      assert.equal(providerRequests, 1, "no provider replay");
    } finally { ozon.close(); }
  });
}
console.log(JSON.stringify({ status: outcomes.every(row => row.pass) ? "PASS" : "FAIL", checks: outcomes }, null, 2));
assert.ok(outcomes.every(row => row.pass), `${outcomes.filter(row => !row.pass).length}/${outcomes.length} artifact checks failed`);
