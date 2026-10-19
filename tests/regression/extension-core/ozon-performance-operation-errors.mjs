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

function unreadableResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status, headers: { "content-type": "application/json" },
    body: { getReader: () => ({ read: async () => {
      const error = new Error(marker);
      error.http_status = 700; // invalid; must never override actual HTTP200 or HTTP401
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
        if (mode === "auth_body_401_after_cached" && calls.auth === 2)
          return unreadableResponse(401);
        if (mode === "auth_network_failure") throw new Error(marker);
        return jsonResponse({
          access_token: "INERT_TOKEN", token_type: "Bearer", expires_in: 3600,
        });
      }
      assert.equal(url, DATA_URL);
      calls.business++;
      if (mode === "business_body_failure") return unreadableResponse();
      if (mode === "business_body_401_after_cached" && calls.business === 2)
        return unreadableResponse(401);
      return jsonResponse({ result: { count: 5 } });
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
async function verifyNoStaleTokenAfterUnreadable401(mode) {
  const { provider, safeError, calls, guard } = newFixture(mode);
  const execute = () => provider.executeCommandObject(
    command, null, credentials, { executionGuard: guard });
  const first = await execute();
  assert.equal(first.ok, true);
  assert.equal(calls.auth, 1);
  assert.equal(calls.business, 1);
  if (mode === "auth_body_401_after_cached") {
    // Explicit fresh-token connection probe sees a fetched HTTP401 whose body
    // cannot be read, while a prior accepted token is still cached.
    const connection = await provider.testPerformanceConnection(credentials);
    assert.equal(connection.ok, false);
    assert.equal(connection.http_status, 401);
    assert.equal(connection.auth_request_performed, true);
    assert.ok(!JSON.stringify(connection).includes(marker));
    assert.equal(calls.auth, 2);
    assert.equal(calls.business, 1);
  } else {
    await assert.rejects(execute(), (error) => {
      const publicError = safeError(error, Number(error?.http_status || 0));
      assert.equal(error.code, "PROVIDER_RESPONSE_READ_FAILED");
      assert.equal(publicError.http_status, 401);
      assert.equal(publicError.external_request_executed, true);
      assert.ok(!JSON.stringify(publicError).includes(marker));
      return true;
    });
    assert.equal(calls.auth, 1);
    assert.equal(calls.business, 2);
  }
  const third = await execute();
  assert.equal(third.ok, true);
  assert.equal(third.http_status, 200);
  assert.equal(calls.auth,
    mode === "auth_body_401_after_cached" ? 3 : 2,
    "observed unreadable HTTP401 must evict the still-TTL-valid token");
  assert.equal(calls.business,
    mode === "auth_body_401_after_cached" ? 2 : 3);
}
await verifyNoStaleTokenAfterUnreadable401("auth_body_401_after_cached");
await verifyNoStaleTokenAfterUnreadable401("business_body_401_after_cached");

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
  status: "PASS", cases: 9,
  performance_auth_and_business_transport_true_attempt: true,
  unreadable_http_401_revokes_cached_token: true,
  source_error_and_public_diagnostics_privacy_safe: true,
  predispatch_guard_remains_no_fetch: true,
  normal_business_result_ok: true,
  real_ozon_calls: 0,
  installed_acceptance: false,
}));
