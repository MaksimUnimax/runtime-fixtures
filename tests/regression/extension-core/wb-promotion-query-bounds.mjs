import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "./worker-harness.mjs";

// A04: synthetic only. Exercise the actual composed and extracted WB adapter.
// No seller credential, live Wildberries call, browser profile or client data.
const worker = await makeWorker(path.resolve(process.argv[2]));
const api = await worker.call("(() => globalThis.SellerAgentsWBAdapter)");
assert.ok(api, "WB adapter must be present in the composed worker");

const onlyTestToken = "SYNTHETIC_WB_TOKEN_NOT_REAL";
const context = {
  snapshot: { marketplace: "wildberries", policyRevision: "personal-enabled" },
  async assertCurrent() {},
  async credentials() { return { token: onlyTestToken }; },
};
const asText = (operation, query) =>
  "WB_API_V1\n" + JSON.stringify({ operation, params: { query } });
const fiftyIds = Array.from({ length: 50 }, (_, i) => String(i + 10001)).join(",");
const fiftyOneIds = fiftyIds + ",10051";
const invalidCases = [
  ["WB-PROMO-51-IDS-LOCAL-REJECT", "promo_fullstats",
    { ids: fiftyOneIds, beginDate: "2026-10-01", endDate: "2026-10-02" },
    "WB_PROMO_IDS_INVALID"],
  ["WB-PROMO-EMPTY-ID-LOCAL-REJECT", "promo_fullstats",
    { ids: "10001,,10003", beginDate: "2026-10-01", endDate: "2026-10-02" },
    "WB_PROMO_IDS_INVALID"],
  ["WB-PROMO-TRAILING-NEWLINE-LOCAL-REJECT", "promo_fullstats",
    { ids: "10001\n", beginDate: "2026-10-01", endDate: "2026-10-02" },
    "WB_PROMO_IDS_INVALID"],
  ["WB-PROMO-33-DAYS-LOCAL-REJECT", "promo_spend_history",
    { from: "2026-09-01", to: "2026-10-03" },
    "WB_PROMO_RANGE_INVALID"],
  ["WB-PROMO-INVALID-CALENDAR-LOCAL-REJECT", "promo_spend_history",
    { from: "2026-02-30", to: "2026-03-01" },
    "WB_PROMO_RANGE_INVALID"],
  ["WB-PROMO-REVERSE-RANGE-LOCAL-REJECT", "promo_spend_history",
    { from: "2026-10-03", to: "2026-10-01" },
    "WB_PROMO_RANGE_INVALID"],
];
const validCases = [
  ["WB-PROMO-2-IDS-ONCE", "promo_fullstats",
    { ids: "10001,10002", beginDate: "2026-10-01", endDate: "2026-10-02" }],
  ["WB-PROMO-50-IDS-ONCE", "promo_fullstats",
    { ids: fiftyIds, beginDate: "2026-10-01", endDate: "2026-10-02" }],
  ["WB-PROMO-2-DAYS-ONCE", "promo_spend_history",
    { from: "2026-10-01", to: "2026-10-02" }],
  ["WB-PROMO-31-DAYS-ONCE", "promo_spend_history",
    { from: "2026-09-01", to: "2026-10-01" }],
  ["WB-PROMO-ISO-EARLY-YEAR-ONCE", "promo_spend_history",
    { from: "0099-01-01", to: "0099-01-02" }],
];
const results = [];
async function inspect(name, operation, query, expected = null) {
  const text = asText(operation, query);
  const rows = api.discover(text);
  assert.equal(rows.length, 1, name + " must be one explicit command");
  let physical = 0;
  const provider = api.createProvider({
    uuid: () => "SYNTHETIC_PROMO_REQUEST",
    fetchImpl: async (_url, init) => {
      physical++;
      assert.equal(init.credentials, "omit");
      return new Response('{"data":[]}', {
        status: 200, headers: { "content-type": "application/json" },
      });
    },
  });
  const executed = await provider.execute(text, { context });
  if (expected) {
    assert.equal(rows[0].kind, "pre_execution_error", name + " discover");
    assert.equal(rows[0].error.code, expected, name + " discover code");
    assert.equal(executed.ok, false, name + " execution");
    assert.equal(executed.error.code, expected, name + " execution code");
    assert.equal(executed.external_request_executed, false, name + " no dispatch");
    assert.equal(physical, 0, name + " zero provider requests");
  } else {
    assert.equal(rows[0].kind, "command", name + " discover");
    assert.equal(executed.ok, true, name + " successful synthetic response");
    assert.equal(executed.external_request_executed, true, name + " dispatched once");
    assert.equal(physical, 1, name + " exactly one provider request");
  }
  results.push({ id: name, status: "PASS", physical_synthetic_calls: physical });
}
try {
  for (const row of invalidCases) await inspect(...row);
  for (const row of validCases) await inspect(...row);
  console.log(JSON.stringify({
    status: "PASS", cases: results.length, results,
    offline: true, real_provider_calls: 0, installed_acceptance: false,
    contract: "official WB Promotion 08-promotion.yaml SHA256 9d8ff74c...",
  }));
} finally {
  worker.close();
}
