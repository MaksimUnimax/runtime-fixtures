import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, until } from "../worker-harness.mjs";
const runtime = path.resolve(process.argv[2]);
const digest = value => createHash("sha256").update(value).digest("hex");
const backing = { local: {}, session: {} };
let worker = await makeWorker(runtime, { backing });
const invoke = (method, input) => worker.call(`(() => saR3Ledger()[${JSON.stringify(method)}](${JSON.stringify(input)}))`);
async function start(worker, store) {
  const response = await worker.popup({ type: "SA_WORK_START", tab_id: worker.tabId,
    store_id: store.id, confirm_change: true, start_intent_id: "profile-boundary-" + crypto.randomUUID() });
  assert.equal(response.ok, true, JSON.stringify(response));
  const pending = await until(async () => (await worker.call("getPendingWorkStarts"))[worker.tabId]?.send_outcome === "sent_acknowledged"
    ? (await worker.call("getPendingWorkStarts"))[worker.tabId] : null, "profile boundary Start acknowledgement");
  const active = await worker.request({ type: "OZ_WORK_PENDING_IDENTITY", intent_id: pending.intent_id,
    revision: pending.revision, identity: worker.identity, first_response_complete: true });
  assert.equal(active.ok, true, JSON.stringify(active));
  return active.binding.conversation_key;
}
try {
  const saved = await worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", credentials: { seller: { clientId: "FIXTURE-CLIENT", apiKey: "FIXTURE-KEY" }, performance: {} }, personalDataEnabled: true } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const key = await start(worker, saved.store);
  const context = await worker.call("captureBatchContext", key,
    'OZON_API_V1 {"operation":"seller_info","params":{}}', "capacity-old-command");
  assert.ok(context);
  const completedInput = { conversationKey: key, context, blockOriginKey: digest("confirmed-source-origin"),
    blockVersion: digest("confirmed-source-block"), items: [{ ordinal: 0, inputHash: digest("confirmed-source-input") }] };
  const completed = await invoke("reserveCommand", completedInput);
  const provider = await invoke("beginProviderAttempt", { ...completedInput, executionId: completed.executionId, ordinal: 0 });
  const payload = "complete synthetic COPY result", bufferDigest = digest(payload);
  await invoke("recordProviderOutcome", { ...completedInput, executionId: completed.executionId, ordinal: 0,
    providerAttemptId: provider.providerAttemptId, outcome: "RESULT", bufferDigest });
  await worker.call(`(async () => manualOperationRecords.mutate(${JSON.stringify(key)}, current => ({ ...current,
    r3_execution_id: ${JSON.stringify(completed.executionId)}, outgoing_text: ${JSON.stringify(payload)},
    execution_context: ${JSON.stringify(context)}, payload_expires_at_ms: ${completed.payloadExpiresAt},
    status: MANUAL_OPERATION_STATUSES.COMPLETED })))`);
  const preview = await invoke("previewCopy", { ...completedInput, executionId: completed.executionId });
  const copy = await invoke("confirmCopy", { ...completedInput, confirmationId: preview.confirmationId, confirmed: true });
  assert.equal((await invoke("beginCopyDelivery", { ...completedInput, deliveryId: copy.deliveryId })).send, true);
  await invoke("recordCopyOutcome", { ...completedInput, deliveryId: copy.deliveryId, outcome: "CONFIRMED" });
  const template = await worker.call(`(async () => (await getManualOperation(${JSON.stringify(key)})).r3_commands)`);
  assert.equal(template.approvals[preview.confirmationId].consumedBy, copy.deliveryId);
  assert.equal(template.deliveries[copy.deliveryId].state, "CONFIRMED");
  const data = { schema: 2, origins: {}, receipts: {}, approvals: {}, deliveries: {} };
  for (let i = 0; i < 668; i++) {
    const executionId = "history-" + i, blockOriginKey = digest("origin-" + i);
    data.origins[blockOriginKey] = { approvalRevision: 0 };
    data.receipts[executionId] = { executionId, commandKey: digest("command-" + i), blockOriginKey,
      blockVersion: digest("block-" + i), approvalRevision: 0, context, createdAt: 0,
      payloadExpiresAt: 1, predecessor: null,
      items: [{ ordinal: 0, inputHash: digest("input-" + i), itemId: "item-" + i,
        state: "RESULT", providerAttemptId: "attempt-" + i, bufferDigest: digest("result-" + i) }] };
  }
  for (let i = 0; i < 666; i++) {
    const executionId = "history-" + i, confirmationId = "copy-approval-" + i, deliveryId = "copy-delivery-" + i;
    data.receipts[executionId].payloadExpiresAt = completed.payloadExpiresAt;
    data.receipts[executionId].items[0].bufferDigest = bufferDigest;
    data.receipts[executionId].deliveryRevision = 1;
    data.approvals[confirmationId] = { ...structuredClone(template.approvals[preview.confirmationId]),
      confirmationId, executionId, consumedBy: deliveryId };
    data.deliveries[deliveryId] = { ...structuredClone(template.deliveries[copy.deliveryId]),
      deliveryId, executionId, confirmationId };
  }
  await worker.call(`(async () => manualOperationRecords.mutate(${JSON.stringify(key)}, current =>
    ({ ...current, r3_commands: ${JSON.stringify(data)} })))`);
  const input = { conversationKey: key, context, blockOriginKey: digest("new-origin"),
    blockVersion: digest("new-block"), items: [{ ordinal: 0, inputHash: digest("new-input") }] };
  await assert.rejects(invoke("reserveCommand", input), { code: "WORK_MARKER_CAPACITY_START_REQUIRED" });
  const finished = await worker.popup({ type: "OZ_WORK_FINISH", tab_id: worker.tabId, conversation_key: key });
  assert.equal(finished.ok, true, JSON.stringify(finished));
  assert.equal(await start(worker, saved.store), key);
  const nextContext = await worker.call("captureBatchContext", key,
    'OZON_API_V1 {"operation":"seller_info","params":{}}', "capacity-new-command");
  assert.ok(nextContext); assert.notEqual(nextContext.workSessionId, context.workSessionId);
  input.context = nextContext;
  const reserved = await invoke("reserveCommand", input);
  assert.equal(reserved.duplicate, false);
  for (let i = 1; i < 3; i++) assert.equal((await invoke("reserveCommand", {
    ...input, blockOriginKey: digest("new-work-command-" + i),
  })).duplicate, false);
  const attempt = { ...input, executionId: reserved.executionId, ordinal: 0 };
  assert.equal((await invoke("beginProviderAttempt", attempt)).dispatch, true);
  assert.equal(worker.network.length, 0);
  worker.close();
  worker = await makeWorker(runtime, { backing, seedAuthority: false });
  assert.equal((await invoke("beginProviderAttempt", attempt)).dispatch, false);
  const stored = await worker.call(`(async () => (await getManualOperation(${JSON.stringify(key)})).r3_commands)`);
  assert.equal(Object.keys(stored.receipts).length, 3);
  assert.equal(Object.keys(stored.approvals).length, 0);
  assert.equal(Object.keys(stored.deliveries).length, 0);
  assert.equal(stored.receipts[reserved.executionId].items[0].state, "PROVIDER_INTENT");
  assert.equal(worker.network.length, 0);
  console.log(JSON.stringify({ status: "PASS", level: "GENERATED_WORKER_SYNTHETIC_NOT_INSTALLED",
    seededCompletedMarkers: 2000, confirmedCopyTriples: 666, actualCopyLedgerAPI: true, newWorkReservations: 3, actualFinishStart: true, restartDuplicateFenced: true, liveProviderCalls: 0 }));
} finally { worker.close(); }
