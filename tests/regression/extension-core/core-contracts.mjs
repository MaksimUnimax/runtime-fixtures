import "./business-scenario-coverage.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../../..");
const candidate = path.resolve(process.argv[2]);
const donor = path.join(root, "apps/extension/src/imported/ozon-v0.1.22");
const results = [];
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixedDate = class extends Date {
  constructor(...args) {
    super(...(args.length ? args : ["2026-09-14T00:00:00Z"]));
  }
  static now() {
    return 1789344000000;
  }
};
function realm(directory) {
  const context = vm.createContext({
    console,
    Date: fixedDate,
    TextEncoder,
    crypto: { randomUUID: () => "fixed-id" },
  });
  for (const file of [
    "work_session_model.js",
    "mixed_batch_discovery.js",
    "bridge_autorun_model.js",
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(directory, "shared", file), "utf8"),
      context,
      { filename: file },
    );
  }
  return context;
}
const old = realm(donor),
  current = realm(candidate);
async function test(id, fn) {
  await fn();
  results.push({ id, status: "PASS" });
}
function outcome(fn) {
  try {
    return { value: plain(fn()) };
  } catch (error) {
    return { error: error.code || error.message };
  }
}

await test("WORK-transition-and-revision-parity", () => {
  const states = [...Object.values(old.OzonWorkSessionModel.STATES), "unknown"];
  for (const state of states)
    for (const next of states) {
      const record = {
        state,
        revision: 4,
        conversation_key: "dialogue-a",
        tab_id: 11,
        error: null,
      };
      assert.deepEqual(
        outcome(() => current.OzonWorkSessionModel.transition(record, next)),
        outcome(() => old.OzonWorkSessionModel.transition(record, next)),
      );
    }
});
await test("WORK-finished-session-cannot-jump-active", () => {
  let value = current.OzonWorkSessionModel.normalize(null, "dialogue-a");
  value = current.OzonWorkSessionModel.transition(value, "binding");
  value = current.OzonWorkSessionModel.transition(value, "active_visible");
  value = current.OzonWorkSessionModel.transition(value, "finishing");
  value = current.OzonWorkSessionModel.transition(value, "inactive");
  assert.equal(value.revision, 4);
  assert.throws(
    () => current.OzonWorkSessionModel.transition(value, "active_visible"),
    { code: "WORK_SESSION_TRANSITION_REJECTED" },
  );
});
const apiDiscover = (text) => [
  {
    ok: true,
    marker_index: 0,
    command: JSON.parse(text.slice(text.indexOf("{"))),
  },
];
const parseHelp = (text) => ({
  ok: true,
  payload: JSON.parse(text.slice(text.indexOf("{"))),
});
await test("BLOCK-mixed-order-nested-markers-and-invalid-item-parity", () => {
  for (const text of [
    'OZON_HELP_V2 {"cluster":"catalog_products"}\nOZON_API_V1 {"operation":"test","params":{"text":"OZON_HELP_V2 {}","nested":{"x":1}}}\nOZON_HELP_V1 {"section":"help"}',
    'OZON_API_V1 {"operation":"a","params":{}}\nOZON_API_V1 {"operation":"b","params":{}}',
    'OZON_HELP_V2 {bad}\nOZON_API_V1 {"operation":"c","params":{}}',
  ])
    assert.deepEqual(
      plain(
        current.OzonMixedBatchDiscovery.discover(text, {
          apiDiscover,
          parseHelp,
        }),
      ),
      plain(
        old.OzonMixedBatchDiscovery.discover(text, { apiDiscover, parseHelp }),
      ),
    );
  const rows = current.OzonMixedBatchDiscovery.discover(
    "OZON_HELP_V2 {} OZON_API_V1 {} OZON_HELP_V1 {}",
    { apiDiscover, parseHelp },
  );
  assert.deepEqual(rows.map((r) => r.kind).join(","), "help,api,help");
});
await test("BLOCK-undiscoverable-api-fails-closed", () => {
  const options = { apiDiscover: () => [], parseHelp };
  const a = current.OzonMixedBatchDiscovery.discover("OZON_API_V1 {}", options);
  assert.equal(a[0].discovery.ok, false);
  assert.deepEqual(
    plain(a),
    plain(old.OzonMixedBatchDiscovery.discover("OZON_API_V1 {}", options)),
  );
});
await test("CORE-has-no-implicit-marketplace-and-accepts-explicit-WB-protocol", () => {
  const c = vm.createContext({ TextEncoder, Date: fixedDate });
  for (const name of ["protocol/mixed-discovery.js", "delivery/model.js"])
    vm.runInContext(
      fs.readFileSync(
        path.join(root, "packages/bridge-core/src", name),
        "utf8",
      ),
      c,
    );
  assert.equal(c.OzonContract, undefined);
  assert.throws(
    () =>
      c.SellerAgentsMixedBatchDiscovery.discover("WB_API_V1 {}", {
        apiDiscover,
        parseHelp,
      }),
    { code: "MIXED_BATCH_PREFIXES_REQUIRED" },
  );
  const rows = c.SellerAgentsMixedBatchDiscovery.discover(
    "WB_HELP_V2 {} WB_API_V1 {}",
    {
      commandPrefix: "WB_API_V1",
      helpPrefixV1: "WB_HELP_V1",
      helpPrefixV2: "WB_HELP_V2",
      apiDiscover,
      parseHelp,
    },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, "api");
  assert.throws(
    () => c.SellerAgentsDeliveryModel.create({}),
    /Delivery provider port missing/,
  );
  const model = c.SellerAgentsDeliveryModel.create({
    directInlineFileRefFromReportText: () => null,
    reportFileRefsFromBatch: () => ["wb-file"],
    attachmentDeliveryPlan: () => null,
  });
  assert.deepEqual(plain(model.reportFileRefsFromBatch({})), ["wb-file"]);
  const delivery = model.claimDelivery(
    {},
    {
      deliveryId: "wb-delivery",
      outgoingText: "WB_RESULT_V1\n{}",
      mode: "batch_watch_v1",
    },
  );
  assert.equal(delivery.delivery.outgoing_text, "WB_RESULT_V1\n{}");
});
await test("DELIVERY-claim-commit-and-unknown-recovery-parity", () => {
  const runs = [];
  for (const status of Object.values(old.BridgeAutorunModel.RUN_STATUSES)) {
    runs.push({
      status,
      request_worker_session_id: "previous",
      start_delivery: { phase: "committed" },
      batch: {
        request_state: "requesting",
        request_worker_session_id: "previous",
      },
    });
    for (const mode of ["legacy", "batch_watch_v1", "attachment_watch_v1"])
      for (const phase of [
        "claimed",
        "committed",
        "insert_committed",
        "inserted",
        "confirmed",
        "unknown",
      ]) {
        runs.push({
          status,
          delivery: { delivery_id: "d", mode, phase, commit_actor_id: "actor" },
        });
      }
  }
  for (const run of runs) {
    assert.deepEqual(
      plain(current.BridgeAutorunModel.recoveryDecision(run, "new-worker")),
      plain(old.BridgeAutorunModel.recoveryDecision(run, "new-worker")),
    );
    for (const method of [
      "commitDelivery",
      "commitDeliveryInsert",
      "markDeliveryInserted",
    ]) {
      const args = {
        deliveryId: "d",
        actorId: "actor",
        assistantBaselineIds: ["old-turn"],
      };
      assert.deepEqual(
        plain(current.BridgeAutorunModel[method](run, args)),
        plain(old.BridgeAutorunModel[method](run, args)),
      );
    }
  }
  const unknown = current.BridgeAutorunModel.recoveryDecision({
    status: "delivering",
    delivery: { mode: "batch_watch_v1", phase: "insert_committed" },
  });
  assert.equal(unknown.code, "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY");
});
await test("DELIVERY-Ozon-files-and-late-capability-policy-parity", () => {
  const response = {
    operation: "report_download",
    http_status: 200,
    result: { generated_file_inline: true, generated_file_ref: "rpf_s_test" },
  };
  const entries = [
    {
      status: "complete",
      http_status: 200,
      command: { operation: "report_download" },
      report_text: "OZON_RESULT_V1\n" + JSON.stringify(response),
    },
    {
      status: "complete",
      http_status: 200,
      command: {
        operation: "report_file_get",
        params: { file_ref: "rpf_s_test" },
      },
    },
    {
      status: "complete",
      http_status: 500,
      command: {
        operation: "report_file_get",
        params: { file_ref: "rpf_s_failed" },
      },
    },
  ];
  const run = { origin: "https://chatgpt.com", batch: { entries } };
  const payload = {
    deliveryId: "d",
    mode: "batch_watch_v1",
    outgoingText: "complete text 🌍",
  };
  // Set capabilities after creating the model: later policy wrappers must remain visible.
  for (const c of [old, current])
    c.OzonAIDeliveryCapabilities = {
      adapterIdForOrigin: () => "chatgpt",
      generatedTextDecision: () => ({
        representation: "text_document",
        unicode_chars: 15,
      }),
      utf8ByteLength: (s) => new TextEncoder().encode(s).length,
    };
  assert.deepEqual(
    plain(current.BridgeAutorunModel.claimDelivery(run, payload)),
    plain(old.BridgeAutorunModel.claimDelivery(run, payload)),
  );
  assert.deepEqual(
    plain(current.BridgeAutorunModel.reportFileRefsFromBatch(run)),
    ["rpf_s_test"],
  );
  for (const change of [
    { http_status: 403 },
    { operation: "different" },
    {
      result: {
        generated_file_inline: true,
        generated_file_ref: "https://untrusted.invalid",
      },
    },
  ]) {
    const entry = {
      ...entries[0],
      report_text:
        "OZON_RESULT_V1\n" + JSON.stringify({ ...response, ...change }),
    };
    assert.equal(
      current.BridgeAutorunModel.directInlineFileRefFromReportText(entry),
      null,
    );
  }
});
const local = vm.createContext({ Date: fixedDate });
vm.runInContext(
  fs.readFileSync(
    path.join(root, "packages/bridge-core/src/execution/local-operations.js"),
    "utf8",
  ),
  local,
);
await test("EXECUTION-concurrent-clicks-share-one-flight-and-failure-does-not-retry", async () => {
  const map = new Map();
  let calls = 0,
    release;
  const first = local.SellerAgentsLocalOperations.singleFlight(
    map,
    "same",
    () => {
      calls++;
      return new Promise((r) => {
        release = r;
      });
    },
  );
  const second = local.SellerAgentsLocalOperations.singleFlight(
    map,
    "same",
    () => {
      calls++;
    },
  );
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(7);
  assert.equal(await first, 7);
  assert.equal(map.size, 0);
  await assert.rejects(
    local.SellerAgentsLocalOperations.singleFlight(map, "same", async () => {
      calls++;
      throw new Error("offline");
    }),
    /offline/,
  );
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(map.size, 0);
});
await test("STORAGE-two-dialogues-do-not-erase-each-other-and-rejected-write-is-not-success", async () => {
  let data = {},
    fail = false;
  const ports = {
    namespace: "account-map",
    read: async () => structuredClone(data),
    write: async (value) => {
      if (fail) throw new Error("quota");
      data = structuredClone(value);
    },
  };
  const records = local.SellerAgentsLocalOperations.createRecordStore(ports);
  await Promise.all([
    records.mutate("dialogue-a", () => ({ operation_id: "a" })),
    records.mutate("dialogue-b", () => ({ operation_id: "b" })),
  ]);
  assert.equal((await records.get("dialogue-a")).operation_id, "a");
  assert.equal((await records.get("dialogue-b")).operation_id, "b");
  fail = true;
  await assert.rejects(
    records.mutate("dialogue-a", () => ({ operation_id: "lost" })),
    /quota/,
  );
  fail = false;
  assert.equal((await records.get("dialogue-a")).operation_id, "a");
  await records.mutate("dialogue-b", () => null);
  assert.equal(await records.get("dialogue-b"), null);
  const restarted = local.SellerAgentsLocalOperations.createRecordStore(ports);
  assert.equal((await restarted.get("dialogue-a")).operation_id, "a");
});
console.log(
  JSON.stringify(
    {
      status: "PASS",
      scenarios: results.length,
      results,
      scope:
        "common modules, exact composed bundles and donor differential; no browser/live-provider acceptance",
    },
    null,
    2,
  ),
);
