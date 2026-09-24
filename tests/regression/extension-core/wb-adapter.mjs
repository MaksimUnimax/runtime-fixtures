import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "./worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const worker = await makeWorker(runtime);
const results = [];
const api = await worker.call("(() => globalThis.SellerAgentsWBAdapter)");
assert.ok(api, "D2.3 WB adapter must load in the actual composed worker");
const batchApi = await worker.call("(() => SellerAgentsWBBatch)");
const local = await worker.call("(() => SellerAgentsLocalOperations)");
const quotaApi = await worker.call("(() => SellerAgentsObservedQuota)");
const reference = await worker.call("(() => SellerAgentsWBReference)");
const token = "FIXTURE_WB_PERSONAL_TOKEN_NOT_A_REAL_SECRET";
const command = (operation = "seller_info", params = {}) => "WB_API_V1\n" + JSON.stringify({ operation, params });
const basic = command();
const clone = (value) => JSON.parse(JSON.stringify(value));
async function test(id, fn) {
  await fn(); results.push({ id, status: "PASS" });
}
async function setup(source = basic, options = {}) {
  const backing = options.backing || {}, network = [], delivered = [], diagnostics = [];
  const activeToken = options.token || token;
  const storeId = options.storeId || "fixture-WB-store";
  const snapshot = { accountId: "fixture-SA-account", storeId, marketplace: "wildberries",
    credentialRevision: await api.credentialRevision({ token: activeToken }), conversationKey: options.key || "fixture-WB-dialogue",
    bindingId: "fixture-binding", bindingRevision: 1, workSessionId: "fixture-work", policyRevision: "personal-enabled",
    commandHash: await api.hash(source), requestId: "fixture-request" };
  const live = { ...snapshot, active: true };
  const context = await api.createContext({ snapshot, readCurrent: async () => live, credentials: { token: activeToken },
    quotaIdentity: options.quotaIdentity || { state: "UNCONFIRMED" } });
  const read = async (key) => ({ [key]: backing[key] === undefined ? undefined : clone(backing[key]) });
  const write = async (values) => { if (options.write) await options.write(values); Object.assign(backing, clone(values)); };
  const records = options.records || local.createRecordStore({ read, write, namespace: "fixture-records" });
  const quota = options.quota || quotaApi.create({ read, write, namespace: "fixture-quota", now: () => options.clock?.value ?? 1000 });
  const provider = api.createProvider({ timeoutMs: options.timeoutMs || 1000, maxBytes: options.maxBytes || 3000000,
    fetchImpl: async (url, init) => {
      network.push({ url, method: init.method, authorization: init.headers.Authorization });
      assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.match(url, /^https:\/\/[a-z-]+\.wildberries\.ru\//);
      return options.fetch ? options.fetch(url, init, { live, network }) : new Response('{"result":{"id":42}}',
        { status: 200, headers: { "content-type": "application/json" } });
    } });
  const queue = batchApi.create({ records, quota, provider, workerId: options.workerId || "fixture-worker",
    diagnostic: async (event, data) => diagnostics.push({ event, data }),
    finalize: async (owner, entries, guard) => {
      await guard.assertCurrent(); delivered.push(entries.map((entry) => entry.report_text)); return { ok: true, code: "READY" };
    } });
  const state = () => records.get(snapshot.conversationKey);
  return { source, snapshot, live, context, backing, network, delivered, records, quota, queue, state, diagnostics,
    async run() { await queue.admit({ source, context }); return queue.process({ context }); } };
}
try {
  await test("WB-01-isolated-authority-all-188-rows", async () => {
    let enabled = 0, disabled = 0;
    for (const [alias, meta] of Object.entries(reference.contract.OPERATIONS)) {
      const params = { path: Object.fromEntries([...meta.path.matchAll(/\{([^}]+)\}/g)].map((m) => [m[1], "fixture-id"])),
        query: Object.fromEntries(meta.required_query_keys.map((key) => [key, "1"])), ...(meta.body_required ? { body: {} } : {}) };
      if (!meta.execution_enabled) {
        assert.throws(() => reference.contract.parseCommand(command(alias, params)), /заблокирована/); disabled++; continue;
      }
      const parsed = reference.contract.parseCommand(command(alias, params));
      const request = reference.contract.buildRequest(parsed);
      assert.equal(new URL(request.url).origin, reference.contract.HOSTS[meta.host]);
      assert.equal(request.method, meta.method); assert.equal(request.effect, "READ"); enabled++;
    }
    assert.equal(enabled, 172); assert.equal(disabled, 16);
    assert.equal(await worker.call("(() => typeof WBContract)"), "undefined");
    assert.ok(await worker.call("(() => typeof OzonContract.parseCommand === 'function')"));
    assert.equal(worker.network.length, 0, "loading adapter does not issue requests");
  });
  await test("WB-02-mixed-help-errors-and-api-order", async () => {
    const s = await setup(['WB_HELP_V2 {"cluster":"common","section":"direct"}',
      command("subscriptions"), basic, command("tariff_box"), basic].join("\n"));
    assert.equal((await s.run()).ok, true); assert.equal(s.network.length, 2);
    const entries = (await s.state()).batch.entries;
    assert.deepEqual(entries.map((e) => e.kind), ["guidance", "pre_execution_error", "command", "pre_execution_error", "command"]);
    assert.ok(entries.every((e) => e.status === "complete" && e.report_text));
    assert.ok(entries.filter((e) => e.kind === "command").every((e) => e.provider_attempt?.state === "COMPLETED_KNOWN"));
    assert.equal(new Set(entries.filter((e) => e.kind === "command").map((e) => e.provider_attempt_id)).size, 2);
    assert.match(entries[1].report_text, /OPERATION_BLOCKED/); assert.match(entries[3].report_text, /MISSING_QUERY_PARAM/);
    assert.equal(s.delivered.length, 1);
  });
  await test("WB-03-local-help-legacy-and-current-zero-fetch", async () => {
    const s = await setup('WB_HELP_V1 {"operation":"catalog","params":{"family":"common","limit":2}}\nWB_HELP_V1 {"operation":"describe","params":{"alias":"seller_info"}}\nWB_HELP_V1 {"cluster":"common"}');
    await s.run(); assert.equal(s.network.length, 0); assert.equal((await s.state()).batch.entries.length, 3);
    assert.ok(s.delivered[0].every((text) => text.startsWith("WB_GUIDANCE_RESULT")));
  });
  await test("WB-04-forbidden-transport-and-cross-provider-zero-fetch", async () => {
    for (const source of [command("seller_info", { headers: { Authorization: token } }),
      'WB_API_V1 {"operation":"seller_info","params":{},"url":"https://example.test"}',
      basic + '\nOZON_API_V1 {"operation":"product_list","params":{}}',
      basic + '\nWB_FILE_V1 {"ref":"fixture"}', 'WB_API_V1 {bad json}']) {
      const s = await setup(source); await s.run(); assert.equal(s.network.length, 0);
      assert.equal(JSON.stringify(s.delivered).includes(token), false);
    }
  });
  await test("WB-05-single-flight-and-completed-no-replay", async () => {
    const s = await setup(basic + "\n" + basic); await s.queue.admit({ source: s.source, context: s.context });
    await Promise.all([s.queue.process({ context: s.context }), s.queue.process({ context: s.context })]);
    await s.run(); assert.equal(s.network.length, 2); assert.equal(s.delivered.length, 1);
  });
  await test("WB-06-credential-binding-work-account-and-policy-fences", async () => {
    for (const field of ["credentialRevision", "bindingRevision", "workSessionId", "storeId", "accountId", "policyRevision", "active"]) {
      const s = await setup(basic + "\n" + basic, { fetch: async (url, init, { live }) => {
        live[field] = field === "active" ? false : field === "bindingRevision" ? 2 : "changed";
        return new Response('{"result":42}', { headers: { "content-type": "application/json" } });
      } });
      assert.equal((await s.run()).code, "EXECUTION_CONTEXT_CHANGED");
      assert.equal(s.network.length, 1, field); assert.equal(s.delivered.length, 0, field);
    }
  });
  await test("WB-07-last-predispatch-fence-after-credential-await", async () => {
    const s = await setup(); const base = s.context;
    const context = { ...base, async credentials() { const value = await base.credentials(); s.live.active = false; return value; } };
    const provider = api.createProvider({ fetchImpl: async () => { throw new Error("must not fetch"); } });
    await assert.rejects(() => provider.execute(basic, { context }), { code: "EXECUTION_CONTEXT_CHANGED" });
  });
  await test("WB-08-worker-restart-requesting-is-unknown-no-retry", async () => {
    const s = await setup(); await s.queue.admit({ source: s.source, context: s.context });
    await s.records.mutate(s.snapshot.conversationKey, (owner) => ({ ...owner, batch: { ...owner.batch,
      request_state: "requesting", request_worker_session_id: "previous-worker",
      entries: owner.batch.entries.map((entry) => ({ ...entry, status: "requesting" })) } }));
    assert.equal((await s.queue.process({ context: s.context })).code, "REQUEST_OUTCOME_UNKNOWN_NO_RETRY");
    assert.equal(s.network.length, 0); assert.equal((await s.state()).status, "failed");
    assert.equal((await s.state()).batch.entries[0].provider_attempt, undefined);
  });
  await test("WB-08b-crash-after-intent-persists-unknown-fence", async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const s = await setup(basic, { fetch: async () => { await held; return new Response('{"result":42}', { headers: { "content-type": "application/json" } }); } });
    const running = s.run();
    while (s.network.length !== 1) await new Promise((resolve) => setTimeout(resolve, 1));
    const during = await s.state();
    assert.equal(during.batch.entries[0].provider_attempt.state, "DISPATCH_INTENT_COMMITTED");
    const restarted = await setup(basic, { backing: s.backing, workerId: "restarted-worker" });
    await restarted.queue.admit({ source: restarted.source, context: restarted.context });
    assert.equal((await restarted.queue.process({ context: restarted.context })).code, "REQUEST_OUTCOME_UNKNOWN_NO_RETRY");
    assert.equal(restarted.network.length, 0);
    assert.equal((await restarted.state()).batch.entries[0].provider_attempt.state, "OUTCOME_UNKNOWN");
    release();
    await running.catch(() => {});
  });
  await test("WB-09-no-context-or-wrong-token-or-block-no-admission", async () => {
    const s = await setup();
    await assert.rejects(() => api.createContext({ snapshot: s.snapshot, readCurrent: async () => s.live, credentials: { token: "different-fixture-token" } }), { code: "EXECUTION_CONTEXT_CHANGED" });
    await assert.rejects(() => s.queue.admit({ source: basic + " ", context: s.context }), { code: "EXECUTION_CONTEXT_CHANGED" });
    await assert.rejects(() => api.createContext({ snapshot: {}, readCurrent: async () => s.live, credentials: { token } }), { code: "EXECUTION_CONTEXT_MISSING" });
    assert.equal(await s.state(), null); assert.equal(s.network.length, 0);
  });
  await test("WB-10-privacy-denied-before-request", async () => {
    const s = await setup(command("fbs_orders_new")); s.snapshot.policyRevision = "personal-disabled"; s.live.policyRevision = "personal-disabled";
    const context = await api.createContext({ snapshot: s.snapshot, readCurrent: async () => s.live, credentials: { token } });
    await s.queue.admit({ source: s.source, context }); await s.queue.process({ context });
    assert.equal(s.network.length, 0); assert.match((await s.state()).batch.entries[0].report_text, /PERSONAL_DATA_DISABLED/);
  });
  await test("WB-11-retry-after-shared-dialogues-explicit-resume-no-retry", async () => {
    const backing = {}, clock = { value: 1000 };
    const s = await setup(basic + "\n" + basic, { backing, clock,
      fetch: async () => new Response("limited", { status: 429, headers: { "retry-after": "5" } }) });
    assert.equal((await s.run()).code, "PROVIDER_QUOTA_WAITING"); assert.equal(s.network.length, 1);
    const other = await setup(basic, { backing, clock, quota: s.quota, records: s.records, key: "fixture-second-dialogue" });
    assert.equal((await other.run()).code, "PROVIDER_QUOTA_WAITING"); assert.equal(other.network.length, 0);
    clock.value = 7000;
    await other.queue.process({ context: other.context }); assert.equal(other.network.length, 1);
    assert.equal(s.network.length, 1, "clock passing does not replay 429 or resume another batch");
  });
  await test("WB-11a-wb-ratelimit-retry-is-durable-and-precedes-reset", async () => {
    const backing = {}, clock = { value: 1000 };
    const first = await setup(basic + "\n" + basic, { backing, clock,
      fetch: async () => new Response("limited", { status: 429, headers: {
        "x-ratelimit-retry": "5", "x-ratelimit-reset": "1" } }) });
    assert.equal((await first.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(first.network.length, 1);
    const rotated = await setup(basic, { backing, clock, token: "FIXTURE_WB_ROTATED_TOKEN", key: "rotated-credential-dialogue",
      storeId: first.snapshot.storeId,
      fetch: async () => new Response('{"result":42}', { headers: { "content-type": "application/json" } }) });
    clock.value = 3000; // past Reset, still before the Retry deadline
    assert.equal((await rotated.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(rotated.network.length, 0, "credential rotation cannot bypass the durable wait");
    clock.value = 6001;
    assert.equal((await rotated.run()).ok, true);
    assert.equal(rotated.network.length, 1);
    assert.equal(first.network.length, 1, "429 is not replayed");

    const precedenceBacking = {}, precedenceClock = { value: 1000 };
    const precedence = await setup(basic, { backing: precedenceBacking, clock: precedenceClock, storeId: "header-precedence-store",
      fetch: async () => new Response("limited", { status: 429, headers: {
        "x-ratelimit-retry": "5", "retry-after": "1" } }) });
    await precedence.run();
    const beforeWbDeadline = await setup(basic, { backing: precedenceBacking, clock: precedenceClock,
      storeId: "header-precedence-store", key: "header-precedence-follow-up" });
    precedenceClock.value = 3000;
    assert.equal((await beforeWbDeadline.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(beforeWbDeadline.network.length, 0, "WB Retry header wins over the shorter generic header");
  });
  await test("WB-11b-confirmed-marketplace-cabinet-sharing-and-isolation", async () => {
    const backing = {}, clock = { value: 1000 };
    const confirmed = { state: "CONFIRMED", providerAccountId: "wb-cabinet-alpha" };
    const limited = await setup(command("seller_warehouses"), { backing, clock, storeId: "card-one", quotaIdentity: confirmed,
      fetch: async () => new Response("limited", { status: 429, headers: { "x-ratelimit-retry": "30" } }) });
    await limited.run(); assert.equal(limited.network.length, 1);
    const sameCabinet = await setup(command("marketplace_offices"), { backing, clock, storeId: "card-two",
      token: "FIXTURE_WB_CARD_TWO_TOKEN", key: "same-cabinet-dialogue", quotaIdentity: confirmed });
    assert.equal((await sameCabinet.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(sameCabinet.network.length, 0, "different marketplace operations share the confirmed cabinet group");
    const otherCabinet = await setup(command("seller_warehouses"), { backing, clock, storeId: "card-three",
      key: "other-cabinet-dialogue", quotaIdentity: { state: "CONFIRMED", providerAccountId: "wb-cabinet-beta" } });
    assert.equal((await otherCabinet.run()).ok, true);
    assert.equal(otherCabinet.network.length, 1, "separate confirmed provider accounts remain isolated");
    const nonMarketplace = await setup(command("statistics_sales", { query: { dateFrom: "2024-01-01" } }),
      { backing, clock, storeId: "card-four", key: "non-marketplace-dialogue", quotaIdentity: confirmed });
    assert.equal((await nonMarketplace.run()).ok, true);
    assert.equal(nonMarketplace.network.length, 1, "a method outside Marketplace does not inherit its cooldown");
  });
  await test("WB-11c-unconfirmed-store-local-identity-survives-rotation", async () => {
    const backing = {}, clock = { value: 1000 };
    const first = await setup(basic, { backing, clock, storeId: "unconfirmed-one", key: "unconfirmed-first",
      fetch: async () => new Response("limited", { status: 429, headers: { "retry-after": "20" } }) });
    await first.run();
    const rotated = await setup(basic, { backing, clock, storeId: "unconfirmed-one", key: "unconfirmed-rotated",
      token: "FIXTURE_WB_UNCONFIRMED_ROTATED_TOKEN" });
    assert.equal((await rotated.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(rotated.network.length, 0);
    const different = await setup(basic, { backing, clock, storeId: "unconfirmed-two", key: "unconfirmed-other-store" });
    assert.equal((await different.run()).ok, true);
    assert.equal(different.network.length, 1, "unconfirmed cards do not converge by account or credential");
  });
  await test("WB-11d-unconfirmed-to-confirmed-promotion-keeps-store-local-wait", async () => {
    const backing = {}, clock = { value: 1000 };
    const unconfirmed = await setup(basic, { backing, clock, storeId: "promotion-card", key: "promotion-before-confirm",
      fetch: async () => new Response("limited", { status: 429, headers: { "x-ratelimit-retry": "25" } }) });
    await unconfirmed.run();
    assert.equal(unconfirmed.network.length, 1);
    const promoted = await setup(basic, { backing, clock, storeId: "promotion-card", key: "promotion-after-confirm",
      token: "FIXTURE_WB_PROMOTED_TOKEN",
      quotaIdentity: { state: "CONFIRMED", providerAccountId: "wb-promoted-cabinet" } });
    assert.equal((await promoted.run()).code, "PROVIDER_QUOTA_WAITING");
    assert.equal(promoted.network.length, 0, "provider identity promotion cannot bypass the pre-confirmation store-local wait");
  });
  await test("WB-12-quota-storage-failure-retains-result-stops-tail", async () => {
    const s = await setup(basic + "\n" + basic, { fetch: async () => new Response('{"result":42}', { headers: { "content-type": "application/json", "retry-after": "5" } }),
      write: async (values) => { if (Object.keys(values).some((key) => key.startsWith("fixture-quota:"))) throw new Error("fixture-disk-failure"); } });
    assert.equal((await s.run()).code, "QUOTA_OBSERVATION_FAILED_NO_RETRY"); assert.equal(s.network.length, 1);
    const state = await s.state(); assert.equal(state.status, "failed");
    assert.equal(state.batch.entries[0].status, "complete"); assert.match(state.batch.entries[0].report_text, /42/);
    assert.equal(state.batch.entries[1].status, "pending");
  });
  await test("WB-13-provider-timeout-malformed-and-secret-errors-no-replay", async () => {
    for (const fetch of [async () => { throw new Error(token); },
      async () => new Response("{broken", { headers: { "content-type": "application/json" } }),
      async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error(token))))]) {
      const s = await setup(basic, { fetch, timeoutMs: 20 }); await s.run(); await s.run();
      assert.equal(s.network.length, 1); assert.equal(JSON.stringify(s.backing).includes(token), false);
      assert.match((await s.state()).batch.entries[0].report_text, /PROVIDER_FETCH_FAILED|PROVIDER_JSON_INVALID|REQUEST_TIMEOUT/);
    }
  });
  await test("WB-14-binary-exact-bytes-original-name-no-followup", async () => {
    const bytes = new Uint8Array([0, 255, 3, 4, 50, 0, 9]);
    const s = await setup(command("analytics_report_download", { path: { downloadId: "fixture-report-id" } }), {
      fetch: async () => new Response(bytes, { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="original-report.zip"' } }) });
    await s.run(); assert.equal(s.network.length, 1);
    const result = JSON.parse((await s.state()).batch.entries[0].report_text.split("\n").slice(1).join("\n")).result;
    assert.equal(result.original_filename, "original-report.zip");
    assert.deepEqual([...Buffer.from(result.content_base64, "base64")], [...bytes]);
    assert.equal(result.delivery_status, "BYTES_RECEIVED_NOT_DELIVERED");
  });
  await test("WB-15-complete-large-json-and-explicit-size-error", async () => {
    const payload = JSON.stringify({ values: Array.from({ length: 20000 }, (_, i) => ({ id: i })) });
    for (const maxBytes of [1000000, 100]) {
      const s = await setup(basic, { maxBytes, fetch: async () => new Response(payload, { headers: { "content-type": "application/json" } }) });
      await s.run(); assert.equal(s.network.length, 1);
      const report = (await s.state()).batch.entries[0].report_text;
      if (maxBytes === 100) assert.match(report, /RESPONSE_TOO_LARGE/);
      else assert.equal(JSON.parse(report.split("\n").slice(1).join("\n")).result.values.length, 20000);
    }
  });
  await test("WB-16-durable-store-rejection-no-provider-and-no-finalize", async () => {
    const s = await setup(basic, { write: async () => { throw new Error("fixture-storage-abort"); } });
    await assert.rejects(() => s.run(), /fixture-storage-abort/); assert.equal(s.network.length, 0); assert.equal(s.delivered.length, 0);
  });
  await test("WB-17-token-isolation-and-no-credential-in-records", async () => {
    const s = await setup(basic, { fetch: async () => new Response(JSON.stringify({ result: { note: token, authorization: token } }), { headers: { "content-type": "application/json" } }) });
    await s.run(); assert.equal(s.network[0].authorization, "Bearer " + token);
    assert.equal(JSON.stringify(s.backing).includes(token), false); assert.equal(JSON.stringify(s.diagnostics).includes(token), false);
  });
  console.log(JSON.stringify({ status: "PASS", scenarios: results.length, results,
    source_scope: "actual composed worker with local application ports", live_provider_calls: 0, installed_acceptance: false }, null, 2));
} finally { worker.close(); }
