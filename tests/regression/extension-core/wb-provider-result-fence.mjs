import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Source-only synthetic regression; no real provider, credentials or browser.
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.resolve(here, "../../../packages/marketplaces/wildberries/src/adapter.js");
const command = "WB_API_V1\n" + JSON.stringify({ operation: "seller_info", params: {} });
const fakeToken = "SYNTHETIC_ONLY_WB_CREDENTIAL";
const payload = '{"result":{"id":42}}';

function fixture() {
  const calls = { dispatch: 0, before: 0, result: 0, assertions: 0 };
  const live = { active: true };
  const contract = {
    OPERATIONS: { seller_info: { privacy: "standard", method: "GET" } },
    resolveOperation: () => ({ privacy: "standard", method: "GET" }),
    preflightExecution: () => {},
    parseCommand: (text) => JSON.parse(text.slice("WB_API_V1\n".length)),
    buildRequest: () => ({ method: "GET", host_alias: "fixture-wb", response_mode: "json" }),
    sanitizeResult: (_command, result) => result,
    formatResultReport: ({ result }) => "WB_RESULT_V1\n" + JSON.stringify(result),
    commandFingerprint: () => "FIXTURE_FINGERPRINT",
  };
  const credentials = {
    sellerHeaders: () => ({ Authorization: fakeToken }),
  };
  const transport = {
    async executeJsonOnce({ fetchImpl }) {
      const response = await fetchImpl("https://fixture.invalid/wb", {
        method: "GET", redirect: "error", headers: { Authorization: fakeToken },
      });
      const rawText = await response.text();
      return {
        ok: true, rawText, parsed: JSON.parse(rawText),
        httpStatus: response.status, elapsedMs: 1,
        responseMeta: { content_type: "application/json", retry_after: null },
      };
    },
  };
  const sandbox = {
    SellerAgentsWBReference: { contract, credentials, transport, guidance: {} },
  };
  vm.runInNewContext(readFileSync(sourceFile, "utf8"), sandbox, { filename: "wb-adapter-under-test.js" });
  const provider = sandbox.SellerAgentsWBAdapter.createProvider({
    uuid: () => "SYNTHETIC_REQUEST_ID",
    fetchImpl: async (_url, init) => {
      calls.dispatch++;
      assert.equal(init.credentials, "omit");
      return new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const context = {
    snapshot: { marketplace: "wildberries", policyRevision: "personal-enabled" },
    async assertCurrent() {
      calls.assertions++;
      if (!live.active) {
        const error = new Error("EXECUTION_CONTEXT_CHANGED");
        error.code = "EXECUTION_CONTEXT_CHANGED";
        error.execution_context_error = true;
        throw error;
      }
    },
    async credentials() { return { token: fakeToken }; },
  };
  return { calls, live, provider, context };
}

async function checkPostResultRevocation() {
  const t = fixture();
  await assert.rejects(
    () => t.provider.execute(command, {
      context: t.context,
      onProviderResult: async ({ provider_result }) => {
        t.calls.result++;
        assert.equal(provider_result.ok, true);
        t.live.active = false; // Change happens during awaited result persistence.
      },
    }),
    (error) => error?.code === "EXECUTION_CONTEXT_CHANGED" && error.execution_context_error === true,
    "a revoked account/store generation must not return successful stale provider result",
  );
  assert.equal(t.calls.dispatch, 1, "no duplicate WB provider request");
  assert.equal(t.calls.result, 1, "single result callback");
}

async function checkStableContextControl() {
  const t = fixture();
  const result = await t.provider.execute(command, {
    context: t.context,
    onProviderResult: async () => { t.calls.result++; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.result.id, 42);
  assert.equal(t.calls.result, 1);
  assert.equal(t.calls.dispatch, 1);
}

async function checkAlreadyGuardedResponseCallback() {
  const t = fixture();
  await assert.rejects(
    () => t.provider.execute(command, {
      context: t.context,
      onProviderResponse: async () => {
        t.calls.before++;
        t.live.active = false;
      },
      onProviderResult: async () => { t.calls.result++; },
    }),
    (error) => error?.code === "EXECUTION_CONTEXT_CHANGED",
  );
  assert.equal(t.calls.before, 1);
  assert.equal(t.calls.result, 0, "no provider result after earlier revocation");
  assert.equal(t.calls.dispatch, 1);
}

await checkPostResultRevocation();
await checkStableContextControl();
await checkAlreadyGuardedResponseCallback();
process.stdout.write("WB_POST_CALLBACK_GENERATION_FENCE_3_CASES_PASS\n");
