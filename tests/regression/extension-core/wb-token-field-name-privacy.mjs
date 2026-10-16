import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "./worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const worker = await makeWorker(runtime);
const token = "FIXTURE_WB_PERSONAL_TOKEN_NOT_A_REAL_SECRET";
let syntheticFetches = 0;
try {
  const api = await worker.call("(() => globalThis.SellerAgentsWBAdapter)");
  assert.ok(api?.createContext && api?.createProvider);
  const command = "WB_API_V1\n" + JSON.stringify({ operation: "seller_info", params: {} });
  const snapshot = {
    accountId: "fixture-account",
    storeId: "fixture-WB-key-privacy-store",
    marketplace: "wildberries",
    credentialRevision: await api.credentialRevision({ token }),
    conversationKey: "fixture-WB-key-privacy-dialogue",
    bindingId: "fixture-binding",
    bindingRevision: 1,
    workSessionId: "fixture-session",
    policyRevision: "personal-enabled",
    commandHash: await api.hash(command),
    requestId: "fixture-request",
  };
  const live = { ...snapshot, active: true };
  const context = await api.createContext({
    snapshot,
    readCurrent: async () => live,
    credentials: { token },
  });
  const upstream = {
    result: {
      ["prefix-" + token + "-suffix"]: "harmless-field-value",
      nested: [{ [token]: token, safe: "prefix:" + token + ":suffix" }],
    },
  };
  const receipts = [];
  const provider = api.createProvider({
    fetchImpl: async (url, init) => {
      syntheticFetches += 1;
      assert.match(url, /^https:\/\/[a-z-]+\.wildberries\.ru\//);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      return new Response(JSON.stringify(upstream), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const answer = await provider.execute(command, {
    context,
    onProviderResult: async (receipt) => receipts.push(receipt),
  });
  assert.equal(answer.ok, true, "synthetic WB result must be accepted");
  assert.equal(syntheticFetches, 1, "exactly one mocked API request");
  assert.equal(receipts.length, 1);
  assert.equal(answer.report_text.includes(token), false, "textual result is redacted");
  assert.equal(JSON.stringify(answer.result).includes(token), false,
    "result JSON must also redact exact token in property names and values");
  assert.equal(JSON.stringify(receipts).includes(token), false,
    "callback must not expose any echoed token through JSON property names");
  console.log(JSON.stringify({
    status: "PASS", scenarios: 1, cases: ["wb-nested-key-and-value-token-echo"],
    synthetic_fetches: syntheticFetches, live_provider_calls: 0, installed_acceptance: false,
  }));
} finally {
  worker.close();
}
