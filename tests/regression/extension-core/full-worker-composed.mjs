import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker, until } from "./worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const independentFingerprint = command => {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const text = JSON.stringify(stable(command)); let hash = 2166136261;
  for (const character of text) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
};
const reports = {
  performance_search_promo_orders_report_create: { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" },
  performance_search_promo_products_report_create: { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" },
  performance_statistics_report_create: { campaigns: ["1"], dateFrom: "2026-09-01", dateTo: "2026-09-02", groupBy: "DATE" },
  performance_all_sku_promo_orders_report_create: { "timeBounds.from": "2026-09-01T00:00:00Z", "timeBounds.to": "2026-09-02T00:00:00Z" },
  performance_all_sku_promo_products_report_create: { "timeBounds.from": "2026-09-01T00:00:00Z", "timeBounds.to": "2026-09-02T00:00:00Z" },
  performance_attribution_report_create: { campaigns: ["1"], dateFrom: "2026-09-01", dateTo: "2026-09-02" },
  performance_phrases_report_create: { dateFrom: "2026-09-01", dateTo: "2026-09-02" },
  performance_video_report_create: { campaigns: ["1"], dateFrom: "2026-09-01", dateTo: "2026-09-02", groupBy: "NO_GROUP_BY" },
  performance_vendor_statistics_report_create: { dateFrom: "2026-09-01", dateTo: "2026-09-02", type: "ORDERS" },
};
const cases = [...Object.entries(reports), ["description_category_dependent_attribute_values", { parent_attribute_id: 85, child_attribute_id: 10096, description_category_id: 87515080, type_id: 93733, limit: 1 }]];
const passes = [];
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

for (const [alias, params] of cases) {
  const worker = await makeWorker(runtime, { fetch: async url => {
    if (url === "https://api-performance.ozon.ru/api/client/token") return response({ access_token: "WORKER_GATE_TOKEN", token_type: "Bearer", expires_in: 3600 });
    if (url.startsWith("https://api-performance.ozon.ru/")) return response({ UUID: `REPORT_${alias.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` });
    if (url.startsWith("https://api-seller.ozon.ru/")) return response({ result: [] });
    throw new Error(`Unexpected network target in composed worker: ${url}`);
  } });
  try {
    const countsBefore = worker.listenerCounts();
    assert.ok(countsBefore.attachmentPorts >= 1, `${alias}: attachment port loaded`);
    assert.ok(countsBefore.storageWake >= 1, `${alias}: storage wake loaded`);
    const saved = await worker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", name: "Ozon + Performance fixture", personalDataEnabled: true, credentials: { seller: { clientId: "FIXTURE_CLIENT", apiKey: "FIXTURE_KEY" }, performance: { clientId: "FIXTURE_PERFORMANCE_CLIENT", clientSecret: "FIXTURE_PERFORMANCE_SECRET" } } } });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const key = await worker.start();
    const command = { operation: alias, params };
    const text = `OZON_API_V1\n${JSON.stringify(command)}`;
    const session = await worker.call("workSessionFor", key);
    const admission = await worker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: key, command_text: text, manual_request_id: `worker-composed-${alias}`, work_session_id: session.start_intent_id });
    assert.equal(admission.ok, true, JSON.stringify(admission));
    assert.equal(admission.accepted, true, JSON.stringify(admission));
    const diagnostics = await until(async () => {
      const result = await worker.popup({ type: "OZ_GET_DIAGNOSTICS" });
      const rows = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
      return rows.some(row => row.event === "BATCH_RESULT_STORED") ? rows : null;
    }, `${alias}: result stored`);
    const events = name => diagnostics.filter(row => row.event === name);
    const started = events("OZON_REQUEST_STARTED");
    const finished = events("OZON_REQUEST_FINISHED");
    assert.equal(events("MANUAL_BATCH_FAILED").length, 0);
    assert.equal(events("BATCH_PROCESSOR_UNCAUGHT").length, 0);
    assert.equal(events("BATCH_CAPABILITY_PLANNING_COMPLETED").length, 1);
    assert.equal(events("BATCH_QUERY_PLANNING_COMPLETED").length, 1);
    assert.equal(events("BATCH_REQUEST_STARTED").length, 1);
    assert.equal(started.length, 1); assert.equal(finished.length, 1); assert.equal(Number(finished[0].http_status), 200);
    assert.equal(events("BATCH_RESULT_STORED").length, 1);
    assert.equal(events("BATCH_RESULT_STORED")[0].external_request_executed, true);
    assert.equal(started[0].command_transformed, false);
    const expected = independentFingerprint(command);
    assert.equal(started[0].command_fingerprint, expected);
    assert.equal(started[0].physical_command_fingerprint, expected);
    const provider = worker.network.filter(row => row.url.startsWith("https://api-performance.ozon.ru/") || row.url.startsWith("https://api-seller.ozon.ru/"));
    const auth = worker.network.filter(row => row.url === "https://api-performance.ozon.ru/api/client/token");
    const performanceBusiness = provider.filter(row => row.url.startsWith("https://api-performance.ozon.ru/") && row.url !== "https://api-performance.ozon.ru/api/client/token");
    const sellerBusiness = provider.filter(row => row.url.startsWith("https://api-seller.ozon.ru/"));
    if (alias.startsWith("performance_")) {
      assert.equal(performanceBusiness.length, 1);
      assert.equal(sellerBusiness.length, 0);
      assert.equal(auth.length, 1);
    } else {
      assert.equal(performanceBusiness.length, 0);
      assert.equal(sellerBusiness.length, 1);
      assert.equal(auth.length, 0);
    }
    passes.push(alias);
  } finally { worker.close(); }
}

// Exercise the durable QUOTA task through the real composed worker alarm
// listener. Two analytics commands in one manually authorized package leave
// the second dispatch waiting on the existing provider quota state.
let quotaNow = Date.now();
const quotaWorker = await makeWorker(runtime, { wallClock: () => quotaNow, fetch: async url => {
  if (url === "https://api-performance.ozon.ru/api/client/token") return response({ access_token: "QUOTA_FIXTURE_TOKEN", token_type: "Bearer", expires_in: 3600 });
  if (url.startsWith("https://api-seller.ozon.ru/")) return response({ result: [] });
  throw new Error(`Unexpected network target in quota fixture: ${url}`);
} });
try {
  const saved = await quotaWorker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", name: "Quota wake fixture", personalDataEnabled: true, credentials: { seller: { clientId: "QUOTA_CLIENT", apiKey: "QUOTA_KEY" }, performance: {} } } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const key = await quotaWorker.start();
  const session = await quotaWorker.call("workSessionFor", key);
  const first = { operation: "analytics_data", params: { date_from: "2026-09-01", date_to: "2026-09-02", dimension: ["day"], metrics: ["revenue"], limit: 100 } };
  const second = { ...first, params: { ...first.params, date_from: "2026-09-03", date_to: "2026-09-04" } };
  const admission = await quotaWorker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: key, command_text: `OZON_API_V1\n${JSON.stringify(first)}\nOZON_API_V1\n${JSON.stringify(second)}`, manual_request_id: "composed-quota-wake", work_session_id: session.start_intent_id });
  assert.equal(admission.ok, true, JSON.stringify(admission));
  await until(async () => {
    const owner = await quotaWorker.call("getManualOperation", key);
    return owner?.batch?.request_state === "quota_waiting" ? owner : null;
  }, "second authorized analytics command reaches quota wait");
  const providerCalls = () => quotaWorker.network.filter(row => row.url.startsWith("https://api-seller.ozon.ru/")).length;
  assert.equal(providerCalls(), 1, "only first command dispatched before quota deadline");
  const keys = await quotaWorker.call("(() => OzonRuntime.STORAGE_KEYS)");
  const waitingOwner = quotaWorker.backing.local[keys.MANUAL_OPERATIONS][key];
  const deadline = Number(waitingOwner.batch.quota_wait.next_allowed_at);
  const scheduler = await quotaWorker.call("(() => SellerAgentsTechnicalScheduler)");
  await quotaWorker.fireAlarm(scheduler.ALARM);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(providerCalls(), 1, "early alarm leaves the quota wait scheduled");
  quotaNow = deadline + 1;
  await quotaWorker.fireAlarm(scheduler.ALARM);
  await until(async () => providerCalls() === 2, "due composed alarm resumes the existing manual package");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(providerCalls(), 2, "due alarm resumes the package exactly once without popup or tab wake");
  assert.equal((await quotaWorker.call("getManualOperation", key)).batch.request_state, "idle");
} finally { quotaWorker.close(); }

let finishedQuotaNow = Date.now();
const finishedQuotaWorker = await makeWorker(runtime, { wallClock: () => finishedQuotaNow, fetch: async url => {
  if (url.startsWith("https://api-seller.ozon.ru/")) return response({ result: [] });
  throw new Error(`Unexpected network target in finished quota fixture: ${url}`);
} });
try {
  const saved = await finishedQuotaWorker.popup({ type: "SA_STORE_SAVE", store: { marketplace: "ozon", name: "Finished quota fixture", personalDataEnabled: true, credentials: { seller: { clientId: "FINISHED_QUOTA_CLIENT", apiKey: "FINISHED_QUOTA_KEY" }, performance: {} } } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const key = await finishedQuotaWorker.start();
  const session = await finishedQuotaWorker.call("workSessionFor", key);
  const command = { operation: "analytics_data", params: { date_from: "2026-09-01", date_to: "2026-09-02", dimension: ["day"], metrics: ["revenue"], limit: 100 } };
  const second = { ...command, params: { ...command.params, date_from: "2026-09-03", date_to: "2026-09-04" } };
  const admission = await finishedQuotaWorker.request({ type: "OZ_EXECUTE_COMMAND", conversation_key: key, command_text: `OZON_API_V1\n${JSON.stringify(command)}\nOZON_API_V1\n${JSON.stringify(second)}`, manual_request_id: "composed-quota-finish", work_session_id: session.start_intent_id });
  assert.equal(admission.ok, true, JSON.stringify(admission));
  const waitingOwner = await until(async () => {
    const owner = await finishedQuotaWorker.call("getManualOperation", key);
    return owner?.batch?.request_state === "quota_waiting" ? owner : null;
  }, "finished-package fixture reaches quota wait");
  assert.equal(finishedQuotaWorker.network.filter(row => row.url.startsWith("https://api-seller.ozon.ru/")).length, 1);
  const finished = await finishedQuotaWorker.request({ type: "OZ_WORK_FINISH", tab_id: finishedQuotaWorker.tabId, conversation_key: key });
  assert.equal(finished.ok, true, JSON.stringify(finished));
  finishedQuotaNow = Number(waitingOwner.batch.quota_wait.next_allowed_at) + 1;
  const scheduler = await finishedQuotaWorker.call("(() => SellerAgentsTechnicalScheduler)");
  await finishedQuotaWorker.fireAlarm(scheduler.ALARM);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(finishedQuotaWorker.network.filter(row => row.url.startsWith("https://api-seller.ozon.ru/")).length, 1, "Finish terminalizes the authorized package before quota alarm dispatch");
} finally { finishedQuotaWorker.close(); }

// Stale client-autorun quota records must not reconstruct an immediate QUOTA
// task in the composed runtime, where autorun processor launches are blocked.
const autorunWorker = await makeWorker(runtime);
try {
  const keys = await autorunWorker.call("(() => OzonRuntime.STORAGE_KEYS)");
  autorunWorker.backing.local[keys.AUTO_RUNS] = {
    "chatgpt:stale-autorun": { run_id: "stale-autorun", status: "collecting", batch: { request_state: "quota_waiting", next_index: 0, quota_wait: { next_allowed_at: Date.now() - 1, waiting_since: "stale" } } },
  };
  const scheduler = await autorunWorker.call("(() => SellerAgentsTechnicalScheduler)");
  await autorunWorker.fireAlarm(scheduler.ALARM);
  await autorunWorker.fireAlarm(scheduler.ALARM);
  const state = await scheduler.state();
  assert.equal(Object.values(state.entries).some(entry => entry.kind === scheduler.KINDS.QUOTA), false, "disabled autorun wait does not keep rearming quota wake");
  assert.equal(autorunWorker.network.length, 0, "autorun quota record never dispatches provider work");
} finally { autorunWorker.close(); }

assert.equal(independentFingerprint({ operation: "description_category_dependent_attribute_values", params: cases.at(-1)[1] }), "cd4bce38");
console.log(JSON.stringify({ status: "PASS", setup: "SA_STORE_SAVE+SA_WORK_START+real_start_ack_identity", cases: passes.length, aliases: passes, exact_once: true, quota_alarm_resume: true, early_quota_alarm_stays_scheduled: true, finish_blocks_quota_dispatch: true, autorun_quota_wake_disabled: true, failure_events_zero: ["MANUAL_BATCH_FAILED", "BATCH_PROCESSOR_UNCAUGHT"], provider_split_asserted: true, semantic_fingerprint: "cd4bce38", workers_closed: true }));
