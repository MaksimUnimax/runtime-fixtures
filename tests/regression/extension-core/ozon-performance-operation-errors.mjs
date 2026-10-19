import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Synthetic real first-party Ozon Performance auth + business command path.
// No Ozon/network calls. Exercise post-fetch errors via actual response readers.
const here = path.dirname(fileURLToPath(import.meta.url));
const providerPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const transportPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(here, "../../../apps/extension/src/imported/ozon-v0.1.22/shared/provider_transport_core.js");
const contractPath = path.resolve(here,
  "../../../apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
const marker = "INERT_R36_DIAGNOSTIC";
const credentials = Object.freeze({ clientId: "INERT_PERFORMANCE_CLIENT", clientSecret: "INERT_NOT_REAL_SECRET" });
const command = Object.freeze({ operation: "performance_read", params: {} });
const TOKEN_URL = "https://api-performance.ozon.ru/api/client/token";
const DATA_URL = "https://api-performance.ozon.ru/api/client/statistics";

function jsonResponse(parsed, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { "content-type": "application/json" },
    text: async () => JSON.stringify(parsed),
  };
}

function unreadableResponse() {
  return {
    ok: true, status: 200, headers: { "content-type": "application/json" },
    body: { getReader: () => ({ read: async () => {
      const error = new Error(marker);
      error.http_status = 700; // invalid; must not override received HTTP200
      throw error;
    } }) },
  };
}

function newFixture(mode) {
  const sandbox = { TextDecoder, TextEncoder };
  vm.runInNewContext(readFileSync(contractPath, "utf8"), sandbox,
    { filename: "ozon-performance-real-contract.js" });
  const safeError = sandbox.OzonContract.safeBridgeErrorPayload;
  vm.runInNewContext(readFileSync(transportPath, "utf8"), sandbox,
    { filename: "ozon-performance-first-party-transport.js" });
  const calls = { auth: 0, business: 0 };
  const customContract = {
    normalizeCommand: input => input,
    preflightExecution: () => ({ meta: { provider: "performance_api" } }),
    buildPerformanceRequest: () => ({
      url: DATA_URL, method: "POST", headers: { Authorization: "Bearer INERT_TOKEN" },
      body: "{}", host_alias: "performance_api", external_request_executed: true,
    }),
    verifyProviderResponse: () => {},
    sanitizeResult: (_, data) => data,
    safeErrorPayload: () => ({ code: "INERT_PERFORMANCE_HTTP_ERROR" }),
    commandFingerprint: () => "INERT_R36_COMMAND",
    formatResultReport: () => "OZON_RESULT_V1\nINERT",
  };
  sandbox.OzonContract = customContract;
  sandbox.OzonCredentials = {
    normalizePerformanceCredentials(raw) {
      if (!raw?.clientId || !raw?.clientSecret) {
        const error = new Error("Performance credentials missing.");
        error.code = "INCOMPLETE_PERFORMANCE_CREDENTIALS";
        throw error;
      }
      return raw;
    },
    performanceTokenRequest: () => ({
      url: mode === "untrusted_host" ? "https://invalid.test/api/client/token" : TOKEN_URL,
      method: "POST", headers: {}, body: "{}", host_alias: "performance_auth",
    }),
    performanceBearerHeaders: () => ({ Authorization: "Bearer INERT_TOKEN" }),
  };
  vm.runInNewContext(readFileSync(providerPath, "utf8"), sandbox,
    { filename: "ozon-performance-provider-under-test.js" });
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    contract: customContract, now: () => 1_000_000,
    uuid: () => "INERT_R36_REQUEST",
    fetchImpl: mode === "missing_fetch" ? null : async (url) => {
      if (url === TOKEN_URL) {
        calls.auth++;
        if (mode === "auth_body_failure") return unreadableResponse();
        if (mode === "auth_network_failure") throw new Error(marker);
        return jsonResponse({
          access_token: "INERT_TOKEN", token_type: "Bearer", expires_in: 3600,
        });
      }
      assert.equal(url, DATA_URL);
      calls.business++;
      return mode === "business_body_failure"
        ? unreadableResponse()
        : jsonResponse({ result: { count: 5 } });
    },
  });
  const guard = {
    async assertDispatchAuthority() {
      if (mode === "guard_denied") {
        const error = new Error("INERT_AUTHORITY_REVOKED");
        error.code = "EXECUTION_GUARD_DENIED";
        error.external_request_executed = false;
        throw error;
      }
    },
    async assertCurrent() {},
  };
  return { provider, safeError, calls, guard };
}

async function checkError(mode, expected) {
  const { provider, safeError, calls, guard } = newFixture(mode);
  let actual = null;
  try {
    await provider.executeCommandObject(command, null, credentials, {
      executionGuard: guard,
    });
  } catch (error) { actual = error; }
  assert.ok(actual, mode + ": must reject");
  const publicError = safeError(actual, Number(actual?.http_status || 0));
  assert.equal(actual.code, expected.code, mode + ": stable code");
  assert.equal(publicError.code, expected.code, mode + ": public code");
  assert.equal(publicError.http_status, expected.httpStatus, mode + ": observed status");
  assert.equal(actual.external_request_executed === true, expected.attempted,
    mode + ": provider attempt must be truthful");
  assert.equal(publicError.external_request_executed, expected.attempted,
    mode + ": public attempt must be truthful");
  assert.ok(!String(actual.message).includes(marker),
    mode + ": provider must not expose raw transport text");
  assert.ok(!JSON.stringify(publicError).includes(marker),
    mode + ": public diagnostics must not expose raw transport text");
  assert.equal(calls.auth, expected.authCalls);
  assert.equal(calls.business, expected.businessCalls);
}

await checkError("auth_body_failure", {
  code: "PROVIDER_RESPONSE_READ_FAILED", httpStatus: 200,
  attempted: true, authCalls: 1, businessCalls: 0,
});
await checkError("business_body_failure", {
  code: "PROVIDER_RESPONSE_READ_FAILED", httpStatus: 200,
  attempted: true, authCalls: 1, businessCalls: 1,
});
await checkError("auth_network_failure", {
  code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  attempted: true, authCalls: 1, businessCalls: 0,
});
await checkError("guard_denied", {
  code: "EXECUTION_GUARD_DENIED", httpStatus: 0,
  attempted: false, authCalls: 0, businessCalls: 0,
});
await checkError("untrusted_host", {
  code: "UNTRUSTED_REQUEST_HOST", httpStatus: 0,
  attempted: false, authCalls: 0, businessCalls: 0,
});
await checkError("missing_fetch", {
  code: "FETCH_IMPL_MISSING", httpStatus: 0,
  attempted: false, authCalls: 0, businessCalls: 0,
});
const healthy = newFixture("success");
const result = await healthy.provider.executeCommandObject(command, null, credentials, {
  executionGuard: healthy.guard,
});
assert.equal(result.ok, true);
assert.equal(result.http_status, 200);
assert.equal(healthy.calls.auth, 1);
assert.equal(healthy.calls.business, 1);
assert.ok(!JSON.stringify(result).includes(credentials.clientSecret));
console.log(JSON.stringify({
  status: "PASS", cases: 7,
  performance_auth_and_business_transport_true_attempt: true,
  source_error_and_public_diagnostics_privacy_safe: true,
  predispatch_guard_remains_no_fetch: true,
  normal_business_result_ok: true,
  real_ozon_calls: 0,
  installed_acceptance: false,
}));
