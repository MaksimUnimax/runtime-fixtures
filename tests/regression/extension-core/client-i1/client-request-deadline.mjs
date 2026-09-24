import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const CHATGPT = { family: "chatgpt", surface: "web", variant: null };
let syncMode = "fetch-stall";
let healthMode = "fetch-stall";

function waitUntilAborted(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

const worker = await makeWorker(runtime, {
  timerScale: 0.001,
  syncFetch: async (_url, init) => {
    if (syncMode === "fetch-stall") return waitUntilAborted(init.signal);
    if (syncMode === "body-stall") {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => ({ read: () => waitUntilAborted(init.signal), cancel: async () => {} }) },
      };
    }
    return new Response(JSON.stringify({ syncVersion: "seller_agents_sync_v1", results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
  healthFetch: async (_url, init) => {
    if (healthMode === "fetch-stall") return waitUntilAborted(init.signal);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  },
});

async function expectDeadline(operation, label) {
  const timersBefore = worker.pendingTimerCount();
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.equal(failure?.code, "CONTROL_REQUEST_TIMEOUT", `${label} timeout code`);
  assert.equal(failure?.status, undefined, `${label} is not converted to HTTP`);
  assert.equal(worker.pendingTimerCount(), timersBefore, `${label} deadline timer cleaned`);
  const status = await worker.call("SellerAgentsControlClient.status");
  assert.equal(status.authenticated, true, `${label} leaves account authenticated`);
  return status.generation;
}

try {
  const syncInput = { syncVersion: "seller_agents_sync_v1", entries: [{ requestId: "deadline", mutationId: "deadline", entityId: "fixture", baseRevision: 0, payload: {} }] };
  const initial = await worker.call("SellerAgentsControlClient.status");
  assert.equal(initial.authenticated, true);
  const generation = initial.generation;

  assert.equal(await expectDeadline(() => worker.call("SellerAgentsControlClient.synchronizeMetadata", syncInput), "fetch"), generation);
  syncMode = "body-stall";
  assert.equal(await expectDeadline(() => worker.call("SellerAgentsControlClient.synchronizeMetadata", syncInput), "body read"), generation);

  syncMode = "success";
  const timersBeforeSuccess = worker.pendingTimerCount();
  const response = await worker.call("SellerAgentsControlClient.synchronizeMetadata", syncInput);
  assert.equal(response.syncVersion, "seller_agents_sync_v1");
  assert.equal(worker.pendingTimerCount(), timersBeforeSuccess, "successful request deadline timer cleaned");

  await expectDeadline(
    () => worker.call("SellerAgentsControlClient.acquireSignedHealthAuthority", { detectedAi: CHATGPT }),
    "health",
  );
  assert.equal((await worker.call("SellerAgentsControlClient.status")).generation, generation, "timeout does not invalidate auth generation");

  syncMode = "fetch-stall";
  await worker.call("SellerAgentsSyncJournal.recordStoreMetadata", {
    store: {
      id: "deadline-store",
      marketplace: "ozon",
      credentialRevision: "deadline-credential",
      metadataRevision: 1,
      name: "Deadline fixture",
      providerIdentityState: "UNCONFIRMED",
    },
  });
  const journalResult = await worker.call("SellerAgentsSyncJournal.syncNow", "deadline_test");
  assert.equal(journalResult.ok, false);
  assert.equal(journalResult.code, "CONTROL_REQUEST_TIMEOUT");
  const journal = await worker.call("SellerAgentsSyncJournal.read");
  const journalEntry = Object.values(journal.entries).find(entry => entry.entityId === "store:deadline-store");
  assert.equal(journalEntry?.status, "RETRY_WAIT", "sync timeout remains retryable/offline state");
  assert.ok(Number(journalEntry?.nextAttemptAt) > Date.now(), "sync timeout receives bounded retry deadline");

  console.log(JSON.stringify({ status: "PASS", fetch_deadline: true, body_deadline: true, success_timer_cleanup: true, health_timeout_keeps_auth: true, sync_timeout_retry_wait: true }));
} finally {
  worker.close();
}
