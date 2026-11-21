import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "./worker-harness.mjs";

const directory = path.resolve(process.argv[2]);
const results = [];
const api = (operation) =>
  "OZON_API_V1\n" + JSON.stringify({ operation, params: {} });
async function test(id, fn) {
  await fn();
  results.push({ id, status: "PASS" });
}
const response = (status = 200) =>
  new Response(JSON.stringify({ result: [] }), {
    status,
    headers: { "content-type": "application/json" },
  });
async function execute(worker, key, text, id = "block-1") {
  const session = await worker.call("workSessionFor", key);
  return worker.request({
    type: "OZ_EXECUTE_COMMAND",
    conversation_key: key,
    command_text: text,
    manual_request_id: id,
    work_session_id: session.start_intent_id,
  });
}
async function waitOperation(worker, key, status) {
  return until(async () => {
    const op = await worker.call("getManualOperation", key);
    return op?.status === status ? op : null;
  }, "manual operation " + status);
}
function deliveryFields(key, operation) {
  return {
    owner_kind: "manual",
    conversation_key: key,
    owner_id: operation.operation_id,
    delivery_id: operation.delivery.delivery_id,
    actor_id: "delivery-actor",
    assistant_baseline_ids: ["previous-assistant-turn"],
  };
}

await test("PIPELINE-real-Start-mixed-manual-block-ordered-network-delivery-Finish", async () => {
  const w = await makeWorker(directory);
  try {
    await w.settings();
    const key = await w.start();
    assert.equal(
      w.network.length,
      0,
      "Start and existing history do not execute API commands",
    );
    assert.equal((await w.call("workSessionFor", key)).state, "active_visible");
    const text =
      api("seller_info") +
      '\nOZON_HELP_V2 {"cluster":"unknown_cluster"}\n' +
      api("description_category_tree");
    const admitted = await execute(w, key, text);
    assert.equal(admitted.accepted, true, JSON.stringify(admitted));
    const op = await waitOperation(w, key, "delivering");
    assert.equal(
      w.network.length,
      2,
      "HELP/error never adds business requests",
    );
    assert.ok(
      w.network[0].url.includes("/seller/info"),
      JSON.stringify(w.network),
    );
    assert.ok(
      w.network[1].url.includes("/description-category/tree"),
      JSON.stringify(w.network),
    );
    assert.equal(op.batch.entries.length, 3);
    assert.equal(op.delivery.mode, "batch_watch_v1");
    const fields = deliveryFields(key, op);
    const commit = await w.request({
      type: "OZ_BATCH_DELIVERY_INSERT_COMMIT",
      ...fields,
    });
    assert.equal(commit.insert_allowed, true, JSON.stringify(commit));
    const inserted = await w.request({
      type: "OZ_BATCH_DELIVERY_INSERTED",
      ...fields,
    });
    assert.equal(inserted.inserted, true, JSON.stringify(inserted));
    const send = await w.request({ type: "OZ_WORK_SEND_COMMIT", ...fields });
    assert.equal(send.click_allowed, true, JSON.stringify(send));
    const complete = await w.request({
      type: "OZ_BATCH_DELIVERY_COMPLETE",
      ...fields,
      delivery_confirmed: true,
      confirmation_basis: "alice_ready",
      click_attempts: 1,
    });
    assert.equal(complete.ok, true, JSON.stringify(complete));
    await until(async () => (await w.call("getManualOperation", key)).status === "completed", "delivery completion commit");
    const duplicate = await execute(w, key, text);
    assert.equal(duplicate.ok, false);
    assert.equal(w.network.length, 2);
    const finish = await w.request({
      type: "OZ_WORK_FINISH",
      tab_id: w.tabId,
      conversation_key: key,
    });
    assert.equal(finish.ok, true, JSON.stringify(finish));
    assert.equal((await w.call("workSessionFor", key)).state, "inactive");
    const denied = await execute(w, key, api("seller_info"), "after-finish");
    assert.equal(denied.ok, false);
    const deniedOperation = JSON.stringify(await w.call("getManualOperation", key));
    assert.ok(["WORK_SESSION_NOT_VISIBLE", "EXECUTION_CONTEXT_CHANGED"].some((code) => JSON.stringify(denied).includes(code) || deniedOperation.includes(code)));
    assert.equal(w.network.length, 2);
    assert.ok(
      w.messages.some(
        (m) => m.type === "OZ_WORK_APPLY_VISIBILITY" && m.visible === false,
      ),
    );
  } finally {
    w.close();
  }
});

await test("RACE-double-click-shares-one-request-and-Finish-stops-tail", async () => {
  let release;
  const w = await makeWorker(directory, {
    fetch: () =>
      new Promise((resolve) => {
        release = () => resolve(response());
      }),
  });
  try {
    await w.settings();
    const key = await w.start();
    const text = api("seller_info") + "\n" + api("description_category_tree");
    const clicks = await Promise.all([
      execute(w, key, text),
      execute(w, key, text),
    ]);
    assert.equal(
      clicks.filter((r) => r.accepted === true).length,
      1,
      JSON.stringify(clicks),
    );
    await until(() => release, "first request dispatch");
    assert.equal(w.network.length, 1);
    const finished = await w.request({
      type: "OZ_WORK_FINISH",
      tab_id: w.tabId,
      conversation_key: key,
    });
    assert.equal(finished.ok, true);
    assert.equal(
      finished.terminalized_operation.code,
      "REQUEST_OUTCOME_UNKNOWN_NO_RETRY",
    );
    release();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(
      w.network.length,
      1,
      "Second API command must not start after Finish",
    );
    assert.equal((await w.call("getManualOperation", key)).status, "failed");
    assert.equal(
      w.messages.filter((m) => m.type === "OZ_BATCH_DELIVERY_AVAILABLE").length,
      0,
    );
  } finally {
    release?.();
    w.close();
  }
});

await test("RECOVERY-worker-restart-does-not-replay-inflight-request", async () => {
  let release;
  const w = await makeWorker(directory, {
    fetch: () =>
      new Promise((resolve) => {
        release = () => resolve(response());
      }),
  });
  let resumed;
  try {
    await w.settings();
    const key = await w.start();
    await execute(w, key, api("seller_info"));
    await until(() => release, "request in flight");
    const snapshot = structuredClone(w.backing);
    resumed = await makeWorker(directory, { backing: snapshot });
    const state = await resumed.request({
      type: "OZ_CONTENT_READY",
      identity: resumed.identity,
    });
    assert.equal(state.ok, true, JSON.stringify(state));
    const recovered = await waitOperation(resumed, key, "failed");
    assert.equal(recovered.last_error.code, "REQUEST_OUTCOME_UNKNOWN_NO_RETRY");
    assert.equal(resumed.network.length, 0);
  } finally {
    release?.();
    w.close();
    resumed?.close();
  }
});

await test("RECOVERY-insertion-unknown-keeps-result-without-second-insertion", async () => {
  const w = await makeWorker(directory);
  let resumed;
  try {
    await w.settings();
    const key = await w.start();
    await execute(w, key, api("seller_info"));
    const op = await waitOperation(w, key, "delivering");
    const fields = deliveryFields(key, op);
    assert.equal(
      (await w.request({ type: "OZ_BATCH_DELIVERY_INSERT_COMMIT", ...fields }))
        .insert_allowed,
      true,
    );
    resumed = await makeWorker(directory, {
      backing: structuredClone(w.backing),
    });
    const repeated = await resumed.request({
      type: "OZ_BATCH_DELIVERY_INSERT_COMMIT",
      ...fields,
    });
    assert.equal(repeated.ok === false || repeated.insert_allowed === false, true);
    assert.ok(["DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY", "DELIVERY_OWNER_MISMATCH", "EXECUTION_CONTEXT_CHANGED"].includes(repeated.code));
    assert.equal(resumed.network.length, 0);
    assert.equal(
      (await resumed.call("getManualOperation", key)).delivery.phase,
      "insert_committed",
    );
  } finally {
    w.close();
    resumed?.close();
  }
});

await test("PROVIDER-429-is-reported-without-hidden-retry", async () => {
  const w = await makeWorker(directory, { fetch: async () => response(429) });
  try {
    await w.settings();
    const key = await w.start();
    await execute(w, key, api("seller_info"));
    const op = await waitOperation(w, key, "delivering");
    assert.equal(w.network.length, 1);
    assert.ok(JSON.stringify(op).includes("429"));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(w.network.length, 1);
  } finally {
    w.close();
  }
});

await test("START-unknown-send-cannot-be-recommitted-or-activated", async () => {
  const w = await makeWorker(directory, { promptOutcome: "unknown" });
  try {
    await w.settings();
    const started = await w.request({ type: "OZ_WORK_START", tab_id: w.tabId });
    assert.equal(started.accepted, true);
    const pending = await until(async () => {
      const p = (await w.call("getPendingWorkStarts"))[w.tabId];
      return p?.send_outcome === "outcome_unknown_no_retry" ? p : null;
    }, "unknown start");
    const fields = {
      intent_id: pending.intent_id,
      revision: pending.revision,
      identity: w.identity,
      actor_id: "fixture-actor",
    };
    const repeat = await w.request({
      type: "OZ_WORK_START_COMMIT_REQUEST",
      ...fields,
    });
    assert.equal(repeat.click_allowed, false);
    const bind = await w.request({
      type: "OZ_WORK_PENDING_IDENTITY",
      ...fields,
      first_response_complete: true,
    });
    assert.equal(bind.ok, false);
    assert.equal(bind.code, "WORK_START_SEND_OUTCOME_UNKNOWN_NO_RETRY");
    assert.equal(w.network.length, 0);
    assert.equal(
      w.messages.filter((m) => m.type === "OZ_WORK_SEND_INITIAL_PROMPT").length,
      1,
    );
  } finally {
    w.close();
  }
});
console.log(
  JSON.stringify(
    {
      status: "PASS",
      scenarios: results.length,
      results,
      live_provider_calls: 0,
      scope:
        "complete packaged worker with fake browser messaging/storage/network; not installed/live DOM acceptance",
    },
    null,
    2,
  ),
);
