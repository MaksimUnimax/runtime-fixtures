import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "./worker-harness.mjs";
const directory = path.resolve(process.argv[2]);
const api = (op) =>
  `OZON_API_V1 ${JSON.stringify({ operation: op, params: {} })}`;
const response = () =>
  new Response(JSON.stringify({ result: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
let release;
const pending = new Promise((r) => {
  release = r;
});
const requests = [];
const w = await makeWorker(directory, {
  fetch: async (url, init, n) => {
    requests.push({
      url,
      client: init.headers["Client-Id"],
      key: init.headers["Api-Key"],
    });
    if (n === 1) await pending;
    return response();
  },
});
try {
  await w.settings();
  const key = await w.start();
  const accepted = await w.request({
    type: "OZ_EXECUTE_COMMAND",
    conversation_key: key,
    command_text: api("seller_info") + "\n" + api("description_category_tree"),
    manual_request_id: "context-change-1",
    work_session_id: (await w.call("workSessionFor", key)).start_intent_id,
  });
  assert.equal(accepted.accepted, true);
  await until(() => requests.length === 1, "first request");
  const saved = await w.request({
    type: "OZ_SAVE_GLOBAL_SETTINGS",
    auto_send: true,
    personal_data_enabled: true,
    seller_client_id: "OTHER_FIXTURE_CLIENT",
    seller_api_key: "OTHER_FIXTURE_KEY",
  });
  assert.equal(saved.ok, true);
  release();
  const op = await until(async () => {
    const o = await w.call("getManualOperation", key);
    return ["failed", "delivering"].includes(o?.status) ? o : null;
  }, "terminal collection");
  assert.equal(
    requests.length,
    1,
    "Credential change must stop the remaining block, never send it to the new cabinet",
  );
  assert.equal(op.status, "failed");
  assert.ok(["EXECUTION_CONTEXT_CHANGED", "REQUEST_OUTCOME_UNKNOWN_NO_RETRY"].includes(op.last_error.code));
  assert.equal(
    w.messages.filter((m) => m.type === "OZ_BATCH_DELIVERY_AVAILABLE").length,
    0,
    "No stale delivery",
  );
  console.log(
    JSON.stringify({
      id: "CTX-credential-change-inflight-no-tail-no-delivery",
      status: "PASS",
    }),
  );
} finally {
  release();
  w.close();
}

const results = [
  { id: "CTX-credential-change-inflight-no-tail-no-delivery", status: "PASS" },
];
async function test(id, fn) {
  await fn();
  results.push({ id, status: "PASS" });
}
async function execute(worker, key, text, id) {
  const session = await worker.call("workSessionFor", key);
  return worker.request({
    type: "OZ_EXECUTE_COMMAND",
    conversation_key: key,
    command_text: text,
    manual_request_id: id,
    work_session_id: session.start_intent_id,
  });
}
async function collection(worker, key) {
  return until(async () => {
    const o = await worker.call("getManualOperation", key);
    return ["failed", "delivering"].includes(o?.status) ? o : null;
  }, "collection settled");
}
async function settings(worker, extra = {}) {
  return worker.request({
    type: "OZ_SAVE_GLOBAL_SETTINGS",
    auto_send: true,
    personal_data_enabled: true,
    ...extra,
  });
}
for (const [id, change] of [
  [
    "CTX-same-cabinet-key-rotation",
    async (worker) =>
      settings(worker, { seller_api_key: "ROTATED_FIXTURE_KEY" }),
  ],
  [
    "CTX-binding-revision-change",
    async (worker, key) => {
      const bindings = await worker.call("getConversationBindings");
      bindings[key].revision++;
      await worker.call("storageSet", { ozmb_conversation_bindings: bindings });
    },
  ],
  [
    "CTX-work-generation-change",
    async (worker, key) => {
      const sessions = await worker.call("getWorkSessions");
      sessions[key].start_intent_id = "new-fixture-work";
      await worker.call("storageSet", { ozmb_work_sessions_v1: sessions });
    },
  ],
  [
    "CTX-personal-data-revocation",
    async (worker) => settings(worker, { personal_data_enabled: false }),
  ],
])
  await test(id, async () => {
    let done;
    const hold = new Promise((r) => (done = r));
    const worker = await makeWorker(directory, {
      fetch: async () => {
        await hold;
        return response();
      },
    });
    try {
      await worker.settings();
      const key = await worker.start();
      assert.equal(
        (
          await execute(
            worker,
            key,
            api("seller_info") + "\n" + api("description_category_tree"),
            id,
          )
        ).accepted,
        true,
      );
      await until(() => worker.network.length === 1, "dispatch");
      await change(worker, key);
      done();
      const op = await collection(worker, key);
      assert.equal(worker.network.length, 1);
      assert.equal(op.status, "failed");
      assert.ok(["EXECUTION_CONTEXT_CHANGED", "REQUEST_OUTCOME_UNKNOWN_NO_RETRY"].includes(op.last_error.code));
    } finally {
      done();
      worker.close();
    }
  });
await test("CTX-unrelated-settings-do-not-stop-work-and-no-secret-metadata", async () => {
  let done;
  const hold = new Promise((r) => (done = r));
  const worker = await makeWorker(directory, {
    fetch: async () => {
      await hold;
      return response();
    },
  });
  try {
    await worker.settings();
    const key = await worker.start();
    await execute(
      worker,
      key,
      api("seller_info") + "\n" + api("description_category_tree"),
      "unrelated",
    );
    await until(() => worker.network.length === 1, "dispatch");
    await settings(worker, { auto_send: false });
    done();
    const op = await collection(worker, key);
    assert.equal(op.status, "delivering");
    assert.ok(op.batch.entries.filter((entry) => entry.kind === "command").every((entry) => ["COMPLETED_KNOWN", "FAILED_KNOWN", "RETRY_WAIT_KNOWN"].includes(entry.provider_attempt?.state)));
    assert.equal(worker.network.length, 2);
    const text = JSON.stringify(op.execution_context);
    assert.ok(
      !text.includes("FIXTURE_KEY") && !text.includes("FIXTURE_CLIENT"),
    );
    assert.equal(
      op.execution_context.accountId,
      worker.accountId,
    );
    assert.equal(op.auto_send, true, "accepted delivery option remains pinned");
  } finally {
    done();
    worker.close();
  }
});
await test("CTX-stale-complete-result-cannot-be-inserted-or-recovered", async () => {
  const worker = await makeWorker(directory);
  let resumed;
  try {
    await worker.settings();
    const key = await worker.start();
    await execute(worker, key, api("seller_info"), "stale-delivery");
    const op = await collection(worker, key);
    assert.equal(op.status, "delivering");
    await settings(worker, { seller_api_key: "ROTATED_FIXTURE_KEY" });
    const result = await worker.request({
      type: "OZ_BATCH_DELIVERY_INSERT_COMMIT",
      owner_kind: "manual",
      conversation_key: key,
      owner_id: op.operation_id,
      delivery_id: op.delivery.delivery_id,
      actor_id: "stale-actor",
    });
    assert.notEqual(result.insert_allowed, true);
    assert.equal(result.code, "EXECUTION_CONTEXT_CHANGED");
    resumed = await makeWorker(directory, {
      backing: structuredClone(worker.backing),
    });
    const ready = await resumed.request({
      type: "OZ_CONTENT_READY",
      identity: resumed.identity,
    });
    assert.equal(resumed.network.length, 0);
    assert.ok(!JSON.stringify(ready).includes('"type":"deliver_claimed"'));
    assert.equal(
      (await resumed.call("getManualOperation", key)).status,
      "failed",
    );
  } finally {
    worker.close();
    resumed?.close();
  }
});
await test("CTX-Finish-during-Performance-auth-blocks-business-request", async () => {
  let done;
  const hold = new Promise((r) => (done = r));
  const worker = await makeWorker(directory, {
    fetch: async (url) => {
      if (url.endsWith("/token")) {
        await hold;
        return new Response(
          JSON.stringify({
            access_token: "FIXTURE_ACCESS",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return response();
    },
  });
  try {
    await worker.settings();
    await settings(worker, {
      performance_client_id: "FIXTURE_PERF",
      performance_client_secret: "FIXTURE_SECRET",
    });
    const key = await worker.start();
    await execute(
      worker,
      key,
      api("performance_campaigns"),
      "performance-stop",
    );
    await until(() => worker.network.length === 1, "token dispatch");
    assert.ok(worker.network[0].url.endsWith("/token"));
    await worker.request({
      type: "OZ_WORK_FINISH",
      tab_id: worker.tabId,
      conversation_key: key,
    });
    done();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(
      worker.network.length,
      1,
      "No business request after Finish during auth",
    );
    assert.equal(
      worker.messages.filter((m) => m.type === "OZ_BATCH_DELIVERY_AVAILABLE")
        .length,
      0,
    );
  } finally {
    done();
    worker.close();
  }
});
await test("CTX-legacy-pending-batch-without-context-never-replays", async () => {
  const worker = await makeWorker(directory);
  let resumed;
  try {
    await worker.settings();
    const key = await worker.start();
    await execute(worker, key, api("seller_info"), "old-pending");
    const op = await collection(worker, key);
    op.status = "requesting";
    op.delivery = null;
    op.batch.phase = "collecting";
    op.batch.next_index = 0;
    op.batch.request_state = "idle";
    op.batch.entries[0].status = "pending";
    delete op.execution_context;
    await worker.call("storageSet", { ozmb_manual_operations: { [key]: op } });
    resumed = await makeWorker(directory, {
      backing: structuredClone(worker.backing),
    });
    await resumed.request({
      type: "OZ_CONTENT_READY",
      identity: resumed.identity,
    });
    const blocked = await collection(resumed, key);
    assert.ok(["EXECUTION_CONTEXT_MISSING", "OPERATOR_FINISH_BEFORE_PROVIDER"].includes(blocked.last_error.code));
    assert.equal(resumed.network.length, 0);
  } finally {
    worker.close();
    resumed?.close();
  }
});
await test("CTX-generic-account-store-revision-isolation", async () => {
  const worker = await makeWorker(directory);
  try {
    const fields = [
      "accountId",
      "storeId",
      "marketplace",
      "credentialRevision",
      "conversationKey",
      "bindingId",
      "bindingRevision",
      "workSessionId",
      "policyRevision",
      "commandHash",
      "requestId",
    ];
    const source = Object.fromEntries(fields.map((f) => [f, "fixture-" + f]));
    const pinned = await worker.call("SellerAgentsExecutionContext.snapshot", {
      ...source,
      apiKey: "FORBIDDEN_EXTRA",
    });
    assert.ok(Object.isFrozen(pinned));
    assert.equal(pinned.apiKey, undefined);
    await worker.call("SellerAgentsExecutionContext.assertSame", pinned, {
      ...source,
      active: true,
    });
    for (const f of fields)
      assert.throws(
        () =>
          worker.call("SellerAgentsExecutionContext.assertSame", pinned, {
            ...source,
            [f]: "other",
            active: true,
          }),
        { code: "EXECUTION_CONTEXT_CHANGED" },
      );
    assert.throws(
      () =>
        worker.call("SellerAgentsExecutionContext.assertSame", pinned, {
          ...source,
          active: false,
        }),
      { code: "EXECUTION_CONTEXT_CHANGED" },
    );
  } finally {
    worker.close();
  }
});
await test("CTX-Performance-token-reuse-is-scoped-to-credentials", async () => {
  const seen = [];
  const worker = await makeWorker(directory, {
    fetch: async (url, init) => {
      if (url.endsWith("/token")) {
        const body = JSON.parse(init.body);
        seen.push(body.client_id);
        return new Response(
          JSON.stringify({
            access_token: "TOKEN_" + body.client_id,
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      seen.push(new Headers(init.headers).get("Authorization"));
      return response();
    },
  });
  try {
    const cmd = { operation: "performance_campaigns", params: {} };
    const a = { clientId: "PERF_A", clientSecret: "SECRET_A" },
      b = { clientId: "PERF_B", clientSecret: "SECRET_B" };
    await worker.call("OzonProvider.executeCommandObject", cmd, {}, a);
    await worker.call("OzonProvider.executeCommandObject", cmd, {}, a);
    await worker.call("OzonProvider.executeCommandObject", cmd, {}, b);
    assert.deepEqual(seen, [
      "PERF_A",
      "Bearer TOKEN_PERF_A",
      "Bearer TOKEN_PERF_A",
      "PERF_B",
      "Bearer TOKEN_PERF_B",
    ]);
  } finally {
    worker.close();
  }
});
await test("CTX-checks-read-no-report-payload", async () => {
  const reads = [];
  const worker = await makeWorker(directory, {
    onStorageRead: (kind, keys) => reads.push({ kind, keys }),
  });
  try {
    await worker.settings();
    const key = await worker.start();
    await execute(worker, key, api("seller_info"), "light-guard");
    const op = await collection(worker, key);
    const guard = await worker.call("createBatchExecutionGuard", op);
    reads.length = 0;
    for (let n = 0; n < 5; n++) await guard.assertCurrent();
    assert.ok(reads.length > 0);
    assert.ok(
      reads.every(
        (row) => !JSON.stringify(row.keys).includes("ozmb_manual_operations"),
      ),
      "Guard must not reread report payloads",
    );
    assert.equal(worker.network.length, 1);
  } finally {
    worker.close();
  }
});
console.log(
  JSON.stringify(
    {
      status: "PASS",
      scenarios: results.length,
      results,
      live_provider_calls: 0,
    },
    null,
    2,
  ),
);
