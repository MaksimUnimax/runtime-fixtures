import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const LEGACY = {
  ozmb_seller_client_id: "LEGACY_CLIENT_MUST_NOT_AUTORUN",
  ozmb_seller_api_key: "LEGACY_KEY_MUST_NOT_AUTORUN",
  ozmb_personal_data_enabled_v1: true
};
const identitySender = worker => ({ tab: { id: worker.tabId }, url: worker.identity.origin + "/c/" + worker.identity.conversation_id });
const popupSender = { url: "chrome-extension://core-fixture/popup.html" };
const response = (body, status = 200, headers = { "content-type": "application/json" }) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const wb = { marketplace: "wildberries", credentials: { token: "FIXTURE_R5_WB_TOKEN" }, personalDataEnabled: true };
const ozon = { marketplace: "ozon", credentials: { seller: { clientId: "FIXTURE_R5_OZON_CLIENT", apiKey: "FIXTURE_R5_OZON_KEY" } }, personalDataEnabled: true };
function fakeIDB() {
  const records = new Map(), stats = { reads: 0, writes: 0 };
  return { records, stats, open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => true }, close() {}, transaction() {
          const tx = { objectStore() {
            const op = (kind, value) => {
              const result = {};
              queueMicrotask(() => {
                if (kind === "get" || kind === "all") stats.reads++;
                if (kind === "put") { stats.writes++; records.set(value.artifact_key, value); }
                if (kind === "delete") { stats.writes++; records.delete(value); }
                result.result = kind === "get" ? records.get(value) : kind === "all" ? [...records.values()] : value?.artifact_key;
                result.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.());
              });
              return result;
            };
            return { get: key => op("get", key), put: value => op("put", value), delete: key => op("delete", key), getAll: () => op("all") };
          } };
          return tx;
        }
      };
      request.onsuccess?.();
    });
    return request;
  } };
}

async function startStore(worker, store) {
  const saved = await worker.request({ type: "SA_STORE_SAVE", store }, popupSender);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const started = await worker.request({ type: "SA_WORK_START", store_id: saved.store.id, tab_id: worker.tabId, confirm_change: true }, popupSender);
  assert.equal(started.ok, true, JSON.stringify(started));
  const pending = await until(async () => {
    const row = (await worker.call("getPendingWorkStarts"))[worker.tabId];
    return row?.send_outcome === "sent_acknowledged" ? row : null;
  }, "R5 start acknowledgement");
  const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id, revision: pending.revision, identity: worker.identity, first_response_complete: true }, identitySender(worker));
  assert.equal(active.ok, true, JSON.stringify(active));
  return { store: saved.store, key: active.binding.conversation_key, session: active.session };
}

async function collect(worker, started, command, requestId) {
  const admitted = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: started.key, command_text: command, manual_request_id: requestId, work_session_id: started.session.start_intent_id }, identitySender(worker));
  assert.equal(admitted.accepted, true, JSON.stringify(admitted));
  return until(async () => {
    const owner = await worker.call("getManualOperation", started.key);
    if (owner?.status === "failed") throw new Error(JSON.stringify(owner.last_error));
    return owner?.status === "delivering" && owner;
  }, "R5 actual delivering owner");
}

async function binaryCommand(worker) {
  const contract = await worker.call("(() => SellerAgentsWBReference.contract)");
  const meta = Object.values(contract.OPERATIONS).find(item => item.response_mode === "binary" && item.execution_enabled && item.privacy === "standard");
  assert.ok(meta, "WB binary operation fixture");
  return "WB_API_V1 " + JSON.stringify({ operation: meta.alias, params: {
    path: Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map(match => [match[1], "fixture"])),
    query: Object.fromEntries(meta.required_query_keys.map(key => [key, "1"])),
    ...(meta.body_required ? { body: {} } : {})
  } });
}

async function assertDeniedAttachments(worker, owner, idb, beforeReads) {
  const fields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: owner.conversation_key, delivery_id: owner.delivery_id, actor_id: "r5-denied", live_owner: worker.identity };
  const results = [];
  for (const type of ["OZ_ATTACHMENT_RECOVERY_GET", "OZ_ATTACHMENT_COMMIT", "OZ_ATTACHMENT_SEND_COMMIT", "OZ_ATTACHMENT_ARTIFACT_META", "OZ_ATTACHMENT_ARTIFACT_CHUNK"]) {
    const result = await worker.portRequest({ type, ...fields, artifact_key: "provider:r5-denied-artifact", offset: 0, length: 32 });
    results.push({ type, result });
    assert.equal(result.recovery, undefined, `${type} exposed recovery after denial`);
    assert.equal(result.descriptors, undefined, `${type} exposed descriptors after denial`);
    assert.equal(result.chunk_base64, undefined, `${type} exposed bytes after denial`);
  }
  assert.equal(idb.stats.reads, beforeReads, "denied attachment owner guard must reject before IDB artifact reads");
  return results;
}

async function deniedFixture(marketplace, phase) {
  const backing = { local: { ...LEGACY }, session: {} };
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 10, 0, 255]);
  let denied = false;
  let providerCalls = 0;
  const cleanupAttempts = [];
  const idb = fakeIDB();
  const worker = await makeWorker(runtime, {
    backing,
    indexedDB: idb,
    fetch: async url => {
      if (url.endsWith("/v1/bootstrap")) return denied ? response({ error: { code: "R5_BOOTSTRAP403" } }, 403) : response({ ok: true });
      if (url.startsWith("https://")) {
        providerCalls++;
        return marketplace === "wildberries" && phase === "before-attachment-commit"
          ? new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="r5-denied.pdf"' } })
          : response({ result: [] });
      }
      throw new Error("unexpected R5 request " + url);
    },
    onStorageWrite: async (kind, values) => {
      if (denied && kind === "local" && Object.keys(values).some(key => /work|binding|manual/i.test(key))) {
        cleanupAttempts.push(Object.keys(values));
        throw new Error("R5 cleanup write unavailable");
      }
    }
  });
  try {
    worker.setDialogue("11111111-1111-4111-8111-111111111111");
    const started = await startStore(worker, marketplace === "ozon" ? ozon : wb);
    const command = marketplace === "ozon" ? 'OZON_API_V1 {"operation":"seller_info","params":{}}' : phase === "before-attachment-commit" ? await binaryCommand(worker) : 'WB_API_V1 {"operation":"seller_info","params":{}}';
    const owner = await collect(worker, started, command, `r5-${marketplace}-${phase}`);
    assert.equal(owner.status, "delivering"); assert.ok(owner.delivery?.delivery_id, "real delivery ID"); assert.ok(owner.outgoing_text, "real outgoing result");
    assert.equal(providerCalls, 1);
    if (phase === "after-insert-before-send") {
      assert.equal(owner.delivery.mode, "batch_watch_v1");
      const fields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: started.key, delivery_id: owner.delivery.delivery_id, actor_id: "r5-before-denial" };
      const inserted = await worker.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields }, identitySender(worker));
      assert.equal(inserted.insert_allowed, true, JSON.stringify(inserted));
      const acknowledged = await worker.request({ type: "OZ_BATCH_DELIVERY_INSERTED", ...fields }, identitySender(worker));
      assert.equal(acknowledged.inserted, true, JSON.stringify(acknowledged));
    }
    const sentBefore = worker.messages.filter(message => message.type === "OZ_BATCH_DELIVERY_AVAILABLE").length;
    denied = true;
    await assert.rejects(worker.call("SellerAgentsControlClient.bootstrap"), /R5_BOOTSTRAP403/);
    await until(async () => !(await worker.call("SellerAgentsControlClient.status")).workAllowed, "R5 authority denial");
    const afterDenial = await worker.call("getManualOperation", started.key);
    assert.equal(afterDenial.operation_id, owner.operation_id); assert.equal(afterDenial.delivery.delivery_id, owner.delivery.delivery_id);
    const deliveryFields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: started.key, delivery_id: owner.delivery.delivery_id, actor_id: "r5-denied" };
    for (const type of ["OZ_BATCH_DELIVERY_INSERT_COMMIT", "OZ_WORK_DELIVERY_ASSERT", "OZ_WORK_SEND_COMMIT"]) {
      const deniedResult = await worker.request({ type, ...deliveryFields }, identitySender(worker));
      assert.notEqual(deniedResult?.insert_allowed, true, `${marketplace}/${phase} insert denied`);
      assert.notEqual(deniedResult?.click_allowed, true, `${marketplace}/${phase} send denied`);
      assert.notEqual(deniedResult?.ok, true, `${marketplace}/${phase} owner assertion denied`);
    }
    const idbReads = worker.idb.stats.reads;
    const attachmentResults = await assertDeniedAttachments(worker, owner, worker.idb, idbReads);
    for (const type of ["OZ_CONTENT_READY", "OZ_CONTENT_SYNC"]) {
      const recovery = await worker.request({ type, identity: worker.identity }, identitySender(worker));
      assert.ok(recovery.ok === true || recovery.code, JSON.stringify(recovery));
      assert.ok(recovery.manual_recovery == null); assert.ok(recovery.recovery == null); assert.equal(recovery.outgoing_text, undefined);
    }
    assert.equal(worker.messages.filter(message => message.type === "OZ_BATCH_DELIVERY_AVAILABLE").length, sentBefore, "denial must not advertise delivery again");
    assert.equal(providerCalls, 1, "denial must not replay provider calls");
    assert.equal(worker.controlNetwork.filter(row => row.url.startsWith("http://127.0.0.1:43100/v1/")).length, 2, "ordinary denied guards add no control requests");
    assert.ok(cleanupAttempts.length > 0, "durable cleanup failure was exercised");
    assert.equal((await worker.request({ type: "OZ_AUTO_START", conversation_key: started.key }, popupSender)).code, "LEGACY_ACTION_DISABLED");
    denied = false;
    const finished = await worker.request({ type: "OZ_WORK_FINISH", tab_id: worker.tabId, conversation_key: started.key }, popupSender);
    assert.equal(finished.ok, true, JSON.stringify(finished));
    return { marketplace, phase, providerCalls, controlRequests: 2, cleanupAttempts: cleanupAttempts.length, attachmentResults };
  } finally { worker.close(); }
}

// Valid WB binary delivery proves the shared APP-07 attachment port still reads
// the real artifact before the negative owner-authority fixtures run.
{
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 10, 0, 255]);
  const worker = await makeWorker(runtime, { indexedDB: fakeIDB(), fetch: async url => url.startsWith("https://") ? new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="r5-positive.pdf"' } }) : response({ ok: true }) });
  try {
    worker.setDialogue("11111111-1111-4111-8111-111111111111");
    const started = await startStore(worker, wb), owner = await collect(worker, started, await binaryCommand(worker), "r5-positive-binary");
    const fields = { owner_kind: "manual", owner_id: owner.operation_id, conversation_key: started.key, delivery_id: owner.delivery_id, actor_id: "r5-positive", live_owner: worker.identity };
    const commit = await worker.portRequest({ type: "OZ_ATTACHMENT_COMMIT", ...fields }); assert.equal(commit.attach_allowed, true, JSON.stringify(commit));
    const meta = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_META", ...fields }); assert.equal(meta.ok, true);
    const original = meta.descriptors.find(descriptor => descriptor.source_kind === "original_provider_file"); assert.ok(original);
    const chunk = await worker.portRequest({ type: "OZ_ATTACHMENT_ARTIFACT_CHUNK", ...fields, artifact_key: original.artifact_key, offset: 0, length: 32 });
    assert.deepEqual(Buffer.from(chunk.chunk_base64, "base64"), Buffer.from(bytes));
  } finally { worker.close(); }
}

const outcomes = [];
for (const marketplace of ["ozon", "wildberries"]) {
  outcomes.push(await deniedFixture(marketplace, "before-insert"));
  outcomes.push(await deniedFixture(marketplace, "before-attachment-commit"));
  outcomes.push(await deniedFixture(marketplace, "after-insert-before-send").catch(error => { throw error; }));
}
console.log(JSON.stringify({ status: "PASS", r5_2: { denied_fixtures: outcomes.length, marketplaces: ["ozon", "wildberries"], real_delivery_owner: true, explicit_bootstrap403: true, legacy_credentials_seeded: true, attachment_port_positive: true, recovery_payload_denied: true, idb_reads_blocked: true, cleanup_restored_finish: true, control_requests_per_fixture: 2, ordinary_command_added_control_requests: 0 } }));
