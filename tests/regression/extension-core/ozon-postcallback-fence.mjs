import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Offline direct-provider source regression. No Ozon network or live credentials.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(currentDir, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const command = { operation: "roles", params: {} };
const credential = { clientId: "FIXTURE_CLIENT", apiKey: "FIXTURE_KEY_NOT_REAL" };
const fakeResponse = Object.freeze({
  ok: true, httpStatus: 200, rawText: '{"result":{"id":42}}',
  parsed: { result: { id: 42 } }, elapsedMs: 1,
  responseMeta: { retry_after: null },
});

function newFixture() {
  const counters = { requests: 0, responseHooks: 0, resultHooks: 0, checks: 0 };
  const live = { active: true };
  const contract = {
    normalizeCommand: input => input,
    preflightExecution: () => ({ meta: { provider: "seller_api" } }),
    buildRequest: () => ({
      url: "https://fixture.invalid/roles", method: "POST",
      headers: { "Client-Id": "FIXTURE_CLIENT" }, body: "{}",
      host_alias: "seller_api", external_request_executed: true,
    }),
    verifyProviderResponse: () => {},
    sanitizeResult: (_command, value) => value,
    formatResultReport: () => "OZON_RESULT_V1\nSYNTHETIC",
    commandFingerprint: () => "FIXTURE_COMMAND_FINGERPRINT",
    safeErrorPayload: () => ({ code: "SYNTHETIC_ERROR" }),
  };
  const context = {
    async assertCurrent() {
      counters.checks++;
      if (!live.active) throw Object.assign(new Error("EXECUTION_CONTEXT_CHANGED"), {
        code: "EXECUTION_CONTEXT_CHANGED", execution_context_error: true,
        external_request_executed: true,
      });
    },
  };
  const sandbox = {
    OzonContract: contract,
    OzonCredentials: {
      normalizeSellerCredentials: raw => raw,
      sellerHeaders: () => ({ "Client-Id": "FIXTURE_CLIENT" }),
    },
    ProviderTransportCore: {
      async executeJsonOnce({ fetchImpl, request }) {
        await fetchImpl(request.url, { method: request.method });
        return fakeResponse;
      },
    },
  };
  vm.runInNewContext(readFileSync(source, "utf8"), sandbox, { filename: "ozon-provider-runtime-tested.js" });
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    contract, fetchImpl: async () => {
      counters.requests++;
      return { status: 200 };
    },
    uuid: () => "FIXTURE_REQUEST_ONLY",
  });
  return { counters, live, provider, context };
}

async function runCase({ revokeAfterResult = false, revokeAfterResponse = false }) {
  const f = newFixture();
  const execute = () => f.provider.executeCommandObject(
    command, credential, {}, {
      executionGuard: f.context,
      onProviderResponse: async () => {
        f.counters.responseHooks++;
        if (revokeAfterResponse) f.live.active = false;
      },
      onProviderResult: async ({ provider_result }) => {
        f.counters.resultHooks++;
        assert.equal(provider_result.ok, true);
        if (revokeAfterResult) f.live.active = false;
      },
    },
  );
  if (revokeAfterResult || revokeAfterResponse) {
    await assert.rejects(execute, (error) =>
      error?.code === "EXECUTION_CONTEXT_CHANGED" &&
      error?.execution_context_error === true,
      "revoked Ozon provider generation must not return an accepted result",
    );
  } else {
    const result = await execute();
    assert.equal(result.ok, true);
    assert.equal(result.result.result.id, 42);
  }
  assert.equal(f.counters.requests, 1, "exactly one synthetic provider request");
  assert.equal(f.counters.responseHooks, 1, "exactly one response callback");
  assert.equal(f.counters.resultHooks, revokeAfterResponse ? 0 : 1,
    "after-response invalidation prevents result callback");
}

await runCase({ revokeAfterResult: true });
await runCase({ revokeAfterResponse: true });
await runCase({});
process.stdout.write("OZON_DIRECT_POSTRESULT_CONTEXT_FENCE_3_CASES_PASS\n");
