import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { makeWorker, signFixtureBootstrap, until } from "../worker-harness.mjs";
const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const canonical = value => value === null ? "null" : typeof value === "object"
  ? Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
    : "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
  : JSON.stringify(value);
const digest = value => createHash("sha256").update(value).digest("hex");
const results = [];
const ai = family => ({ detectedAi: { family, surface: "web", variant: null } });
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
async function validate(worker, context) {
  return worker.call(`(async () => {
    const context = ${JSON.stringify(context)};
    const live = await saReadContext(context.conversationKey, { commandHash: context.commandHash, requestId: context.requestId });
    try { SellerAgentsExecutionContext.assertSame(context, live); return { rejected: false, epoch: live.grantEpoch }; }
    catch (error) { return { rejected: true, code: error.code, epoch: live.grantEpoch }; }
  })`);
}
async function ledger(worker, method, input) {
  return worker.call(`(() => saR3Ledger()[${JSON.stringify(method)}](${JSON.stringify(input)}))`);
}
for (const change of ["revision", "content", "compatibility"]) {
  let worker, observation = { change };
  try {
    const backing = { local: {}, session: {} };
    let template, material = false, count = 0;
    worker = await makeWorker(runtime, { backing, fetch: async (url, options) => {
      if (!url.endsWith("/v1/bootstrap")) throw new Error("Unexpected fixture control operation");
      const family = JSON.parse(options.body).detectedAi?.family;
      const payload = structuredClone(template);
      payload.serverTime = new Date(Date.now() + ++count).toISOString();
      payload.configVersion += count;
      payload.ai.detected.family = family;
      if (material && family === "chatgpt") {
        if (change === "revision") payload.ai.profile.revision++;
        if (change === "content") payload.ai.profile.content.observation.intervalMs++;
        if (change === "compatibility") payload.ai.profile.compatibility.browserFamilies.push("opera");
        payload.ai.profile.contentSha256 = digest(canonical({
          content: payload.ai.profile.content, compatibility: payload.ai.profile.compatibility,
        }));
      }
      return new Response(JSON.stringify(await signFixtureBootstrap(backing, payload)),
        { headers: { "content-type": "application/json" } });
    } });
    template = structuredClone(backing.local[AUTH].authority.payload);
    await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("chatgpt"));
    await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("alice"));
    const saved = await worker.popup({ type: "SA_STORE_SAVE", store: {
      marketplace: "ozon", credentials: { seller: { clientId: "FIXTURE-CLIENT", apiKey: "FIXTURE-KEY" }, performance: {} },
      personalDataEnabled: true,
    } });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const key = await start(worker, saved.store);
    const context = await worker.call("captureBatchContext", key,
      'OZON_API_V1 {"operation":"seller_info","params":{}}', "profile-boundary-context");
    assert.ok(context);
    assert.equal((await validate(worker, context)).rejected, false);
    const aliceBefore = (await worker.call("SellerAgentsControlClient.getCachedContinuationState", "alice")).authority.grantEpoch;
    await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("chatgpt"));
    const unchanged = await validate(worker, context);
    assert.equal(unchanged.rejected, false);
    assert.equal(unchanged.epoch, context.grantEpoch);
    observation.ordinaryRefreshPreserved = true;
    const items = [0, 1].map(ordinal => ({ ordinal, inputHash: digest("fixture-input-" + ordinal),
      marketplace: "ozon", operation: "seller_info" }));
    const input = { conversationKey: key, context, blockOriginKey: digest("profile-old-origin"),
      blockVersion: digest("profile-old-block"), items };
    const reserved = await ledger(worker, "reserveCommand", input);
    const first = await ledger(worker, "beginProviderAttempt", { ...input, executionId: reserved.executionId, ordinal: 0 });
    await ledger(worker, "recordProviderOutcome", { ...input, executionId: reserved.executionId, ordinal: 0,
      providerAttemptId: first.providerAttemptId, outcome: "UNKNOWN" });
    const late = await ledger(worker, "beginProviderAttempt", { ...input, executionId: reserved.executionId, ordinal: 1 });
    material = true;
    await worker.call("SellerAgentsControlClient.bootstrapWithPolicy", ai("chatgpt"));
    const changed = await validate(worker, context);
    observation.oldContextRejected = changed.rejected;
    observation.beforeEpoch = context.grantEpoch;
    observation.afterEpoch = changed.epoch;
    assert.equal(changed.rejected, true, "new signed profile must revoke the captured execution context");
    assert.ok(changed.epoch > context.grantEpoch);
    assert.equal((await worker.call("SellerAgentsControlClient.getCachedContinuationState", "alice")).authority.grantEpoch, aliceBefore);
    observation.neighborGrantPreserved = true;
    await assert.rejects(ledger(worker, "beginProviderAttempt", { ...input, executionId: reserved.executionId, ordinal: 0 }),
      { code: "EXECUTION_CONTEXT_CHANGED" });
    await assert.rejects(ledger(worker, "recordProviderOutcome", { ...input, executionId: reserved.executionId,
      ordinal: 1, providerAttemptId: late.providerAttemptId, outcome: "RESULT", bufferDigest: digest("late-result") }),
      { code: "EXECUTION_CONTEXT_CHANGED" });
    await assert.rejects(ledger(worker, "previewRetry", { ...input, executionId: reserved.executionId,
      selection: [items[0]], parserContract: "fixture-parser", credentialRevision: context.credentialRevision }),
      { code: "EXECUTION_CONTEXT_CHANGED" });
    await assert.rejects(ledger(worker, "previewCopy", { ...input, executionId: reserved.executionId }),
      { code: "EXECUTION_CONTEXT_CHANGED" });
    const unchangedReceipt = await worker.call(`(async () => (await getManualOperation(${JSON.stringify(key)})).r3_commands.receipts[${JSON.stringify(reserved.executionId)}])`);
    assert.equal(unchangedReceipt.items[0].state, "UNKNOWN");
    assert.equal(unchangedReceipt.items[1].state, "PROVIDER_INTENT");
    observation.predispatchLateResultRetryFenced = true;
    observation.syntheticProviderIntentsOnly = true;
    observation.providerRequests = worker.network.length;
    assert.equal(worker.network.length, 0);
    observation.status = "PASS";
  } catch (error) {
    observation.status = "FAIL"; observation.error = error.stack || error.code || error.message;
  } finally { worker?.close(); }
  results.push(observation);
}
console.log(JSON.stringify({ level: "GENERATED_WORKER_SYNTHETIC_NOT_INSTALLED", results, liveProviderCalls: 0 }, null, 2));
if (results.some(result => result.status !== "PASS")) process.exitCode = 1;
