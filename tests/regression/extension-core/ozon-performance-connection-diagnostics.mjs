import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// A04 synthetic only: inspect the real provider-runtime, never contact Ozon.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const originalTransport = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(here, "../../../apps/extension/src/imported/ozon-v0.1.22/shared/provider_transport_core.js");
const privateMarker = "INERT_R10_PRIVATE_AUTH_DIAGNOSTIC_MARKER";
const fakeCredentials = Object.freeze({
  clientId: "INERT_R10_PERFORMANCE_CLIENT_ID",
  clientSecret: "INERT_R10_PERFORMANCE_CLIENT_SECRET_NOT_REAL",
});

function fixture(mode) {
  const calls = { authTransport: 0, fetch: 0, codeReads: 0, metadataReads: 0 };
  const sandbox = {
    TextDecoder, TextEncoder,
    OzonCredentials: {
      normalizePerformanceCredentials(raw) {
        if (!raw?.clientId) {
          const error = new Error("INERT_PRIVATE_R10_BAD_FIELD_" + privateMarker);
          error.code = "MISSING_PERFORMANCE_CLIENT_ID";
          throw error;
        }
        if (!raw?.clientSecret) {
          const error = new Error(privateMarker);
          error.code = "MISSING_PERFORMANCE_CLIENT_SECRET";
          throw error;
        }
        return Object.freeze({ clientId: raw.clientId, clientSecret: raw.clientSecret });
      },
      performanceTokenRequest: () => ({
        url: "https://api-performance.ozon.ru/api/client/token",
        method: "POST", host_alias: "performance_auth",
        body: '{"grant_type":"client_credentials"}',
      }),
    },
    ProviderTransportCore: {
      async executePerformanceJsonOnce({ fetchImpl }) {
        calls.authTransport++;
        // A transport failure may include content copied from the original
        // Error.message; it must not be reflected in public diagnostics.
        if (mode === "network_after_fetch") return fetchImpl("https://fixture.invalid/inert");
        if (mode === "spoofed_http_401") {
          const error = new Error(privateMarker);
          error.code = "PROVIDER_FETCH_FAILED";
          error.http_status = 401;
          error.request_attempted = true;
          error.external_request_executed = true;
          throw error;
        }
        if (mode === "mutating_code") {
          const error = new Error(privateMarker);
          Object.defineProperty(error, "code", { get() {
            calls.codeReads++;
            return calls.codeReads === 1 ? "PROVIDER_FETCH_FAILED" : privateMarker;
          } });
          throw error;
        }
        if (mode === "throwing_code") {
          const error = new Error(privateMarker);
          Object.defineProperty(error, "code", { get() {
            calls.codeReads++;
            throw new Error(privateMarker);
          } });
          throw error;
        }
        if (mode === "throwing_metadata") {
          const error = new Error(privateMarker);
          error.code = "PROVIDER_FETCH_FAILED";
          for (const key of ["http_status", "request_attempted", "external_request_executed"])
            Object.defineProperty(error, key, { get() {
              calls.metadataReads++;
              throw new Error(privateMarker);
            } });
          throw error;
        }
        if (mode === "network") {
          const error = new Error("Network failed: " + privateMarker);
          error.code = "PROVIDER_FETCH_FAILED";
          error.external_request_executed = true;
          error.request_attempted = true;
          throw error;
        }
        if (mode === "unknown") {
          const error = new Error(privateMarker);
          error.code = "UNKNOWN_CODE_" + privateMarker;
          throw error;
        }
        await fetchImpl("https://fixture.invalid/inert");
        if (mode === "http401")
          return { ok: false, httpStatus: 401, parsed: {}, rawText: "", responseMeta: {} };
        if (mode === "bad_token")
          return { ok: true, httpStatus: 200, parsed: { token_type: "Bearer" }, rawText: "", responseMeta: {} };
        return {
          ok: true, httpStatus: 200,
          parsed: { access_token: "INERT_R10_ACCESS_TOKEN_NOT_REAL", token_type: "Bearer", expires_in: 3600 },
          rawText: "", responseMeta: {},
        };
      },
    },
  };
  if (mode.startsWith("body_read_failure")) {
    // Reproduce the real first-party transport's post-fetch readResponse path.
    vm.runInNewContext(readFileSync(originalTransport, "utf8"), sandbox, {
      filename: "ozon-first-party-performance-transport.js",
    });
    const actualTransport = sandbox.ProviderTransportCore.executePerformanceJsonOnce;
    sandbox.ProviderTransportCore = {
      ...sandbox.ProviderTransportCore,
      executePerformanceJsonOnce: async (arguments_) => {
        calls.authTransport++;
        return actualTransport(arguments_);
      },
    };
  }
  vm.runInNewContext(readFileSync(source, "utf8"), sandbox, {
    filename: "ozon-performance-connection-diagnostic-under-test.js",
  });
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    now: () => 1_000_000,
    fetchImpl: async () => {
      calls.fetch++;
      if (mode === "network_after_fetch") throw new Error(privateMarker);
      if (mode.startsWith("body_read_failure")) {
        return {
          ok: true, status: 200, headers: { "content-type": "application/json" },
          body: { getReader: () => ({ read: async () => {
            const error = new Error("INERT_POSTFETCH_BODY_READ_FAILED_" + privateMarker);
            if (mode === "body_read_failure_bad_700") error.http_status = 700;
            if (mode === "body_read_failure_bad_text") error.http_status = "bad";
            if (mode === "body_read_failure_conflicting_401") error.http_status = 401;
            throw error;
          } }) },
        };
      }
      // The stubbed 401 transport outcome must match the observed HTTP response.
      return { status: mode === "http401" ? 401 : 200 };
    },
  });
  return { provider, calls };
}

function assertPrivateDataAbsent(result) {
  const exposed = JSON.stringify(result);
  assert.ok(!exposed.includes(privateMarker),
    "public Performance diagnostics must not disclose arbitrary network/validation error content");
  assert.ok(!exposed.includes(fakeCredentials.clientSecret),
    "never return a Performance Client Secret");
  assert.ok(!exposed.includes("INERT_R10_ACCESS_TOKEN_NOT_REAL"),
    "successful connection probe must not expose an access token");
}

async function check(mode, rawCredentials, expected) {
  const { provider, calls } = fixture(mode);
  const result = await provider.testPerformanceConnection(rawCredentials);
  assert.equal(result.ok, expected.ok);
  assert.equal(result.code, expected.code);
  assert.equal(result.http_status, expected.httpStatus);
  assert.equal(result.auth_request_performed, expected.authRequestPerformed);
  assert.equal(calls.authTransport, expected.transportCalls);
  assert.equal(calls.fetch, expected.fetchCalls);
  assert.equal(calls.codeReads, expected.codeReads || 0);
  assert.equal(calls.metadataReads, 0, "never read exception metadata");
  assertPrivateDataAbsent(result);
  return result;
}

await check("network", fakeCredentials, {
  ok: false, code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0,
});
await check("network_after_fetch", fakeCredentials, {
  ok: false, code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
});
await check("spoofed_http_401", fakeCredentials, {
  ok: false, code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0,
});
await check("mutating_code", fakeCredentials, {
  ok: false, code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0, codeReads: 1,
});
await check("throwing_code", fakeCredentials, {
  ok: false, code: "PERFORMANCE_CONNECTION_TEST_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0, codeReads: 1,
});
await check("throwing_metadata", fakeCredentials, {
  ok: false, code: "PROVIDER_FETCH_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0,
});
await check("unknown", fakeCredentials, {
  ok: false, code: "PERFORMANCE_CONNECTION_TEST_FAILED", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 1, fetchCalls: 0,
});
await check("body_read_failure", fakeCredentials, {
  ok: false, code: "PERFORMANCE_CONNECTION_TEST_FAILED", httpStatus: 200,
  authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
});
for (const mode of [
  "body_read_failure_bad_700",
  "body_read_failure_bad_text",
  "body_read_failure_conflicting_401",
]) {
  await check(mode, fakeCredentials, {
    ok: false, code: "PERFORMANCE_CONNECTION_TEST_FAILED", httpStatus: 200,
    authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
  });
}
await check("success", { clientSecret: fakeCredentials.clientSecret }, {
  ok: false, code: "MISSING_PERFORMANCE_CLIENT_ID", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 0, fetchCalls: 0,
});
await check("success", { clientId: fakeCredentials.clientId }, {
  ok: false, code: "MISSING_PERFORMANCE_CLIENT_SECRET", httpStatus: 0,
  authRequestPerformed: false, transportCalls: 0, fetchCalls: 0,
});
await check("http401", fakeCredentials, {
  ok: false, code: "PERFORMANCE_AUTH_FAILED", httpStatus: 401,
  authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
});
await check("bad_token", fakeCredentials, {
  ok: false, code: "INVALID_PERFORMANCE_TOKEN_RESPONSE", httpStatus: 200,
  authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
});
const healthy = await check("success", fakeCredentials, {
  ok: true, code: "PERFORMANCE_CONNECTED", httpStatus: 200,
  authRequestPerformed: true, transportCalls: 1, fetchCalls: 1,
});
assert.equal(typeof healthy.token_expires_at_ms, "number");

console.log(JSON.stringify({
  status: "PASS", scenarios: 16,
  postfetch_body_read_failure_attempt_observed: true,
  response_http_status_wins_invalid_or_conflicting_error_status: true,
  raw_error_message_hidden: true, unknown_error_code_not_reflected: true,
  preflight_auth_attempt_false: true, known_auth_error_codes_preserved: true,
  successful_token_not_returned: true, real_Ozon_auth_calls: 0,
  installed_acceptance: false,
}));
