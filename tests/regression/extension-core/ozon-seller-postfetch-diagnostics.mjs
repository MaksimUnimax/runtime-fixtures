import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Offline Seller business transport evidence: the real first-party readResponse
// receives HTTP headers before its body reader rejects. No real provider calls.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const transportPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(here, "../../../apps/extension/src/imported/ozon-v0.1.22/shared/provider_transport_core.js");
const contractPath = path.resolve(here,
  "../../../apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
const privateMarker = "INERT_R30_BODY_READER_UNTRUSTED_DETAIL";
const request = Object.freeze({ operation: "roles", params: {} });
const credentials = Object.freeze({ clientId: "INERT_R30_ID", apiKey: "INERT_R30_NOT_REAL" });

function fixture(mode) {
  const sandbox = { TextEncoder, TextDecoder };
  vm.runInNewContext(readFileSync(contractPath, "utf8"), sandbox,
    { filename: "ozon-first-party-contract-under-test.js" });
  const actualSafeError = sandbox.OzonContract.safeBridgeErrorPayload;
  vm.runInNewContext(readFileSync(transportPath, "utf8"), sandbox,
    { filename: "ozon-first-party-transport-under-test.js" });
  const counters = { fetch: 0, guard: 0 };
  const contract = {
    normalizeCommand: value => value,
    preflightExecution: () => ({ meta: { provider: "seller_api" } }),
    buildRequest: () => ({
      url: mode === "untrusted_host" ? "https://fixture.invalid/roles"
        : "https://api-seller.ozon.ru/v1/roles",
      method: "POST", headers: { "Client-Id": credentials.clientId },
      body: "{}", host_alias: "seller_api", external_request_executed: true,
    }),
    verifyProviderResponse: () => {},
    sanitizeResult: (_, value) => value,
    formatResultReport: () => "OZON_RESULT_V1\\nINERT",
    commandFingerprint: () => "INERT_R30_COMMAND",
    safeErrorPayload: () => ({ code: "INERT_R30_HTTP" }),
  };
  sandbox.OzonContract = contract;
  sandbox.OzonCredentials = {
    normalizeSellerCredentials: raw => raw,
    sellerHeaders: () => ({ "Client-Id": credentials.clientId }),
  };
  vm.runInNewContext(readFileSync(source, "utf8"), sandbox,
    { filename: "ozon-seller-provider-under-test.js" });
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    contract, now: () => 1_000_000, uuid: () => "INERT_R30_REQUEST",
    fetchImpl: mode === "missing_fetch" ? null : async () => {
      counters.fetch++;
      if (mode === "network_failure")
        throw new Error("UNTRUSTED_FETCH_FAILURE_" + privateMarker);
      return {
        ok: true, status: 200, headers: { "content-type": "application/json" },
        body: {
          getReader: () => ({
            read: async () => {
              if (mode === "postfetch_body_failure") {
                const error = new Error(privateMarker);
                error.http_status = 700; // invalid and conflicting with received HTTP 200
                throw error;
              }
              return { done: true };
            },
          }),
        },
      };
    },
  });
  const guard = {
    async assertDispatchAuthority() {
      counters.guard++;
      if (mode === "guard_denied") {
        const error = new Error("Execution authority was revoked before dispatch");
        error.code = "EXECUTION_GUARD_DENIED";
        error.external_request_executed = false;
        throw error;
      }
    },
    async assertCurrent() { counters.guard++; },
  };
  return { provider, guard, counters, safe: actualSafeError };
}

async function failed(mode, expected) {
  const { provider, guard, counters, safe } = fixture(mode);
  let caught = null;
  try {
    await provider.executeCommandObject(request, credentials, {}, {
      executionGuard: guard,
    });
  } catch (error) { caught = error; }
  assert.ok(caught, mode + ": controlled transport must reject");
  const publicError = safe(caught, caught?.http_status || 0);
  assert.equal(caught.code, expected.code, mode + ": stable cause");
  assert.equal(caught.http_status || 0, expected.status, mode + ": true status");
  assert.equal(caught.external_request_executed === true, expected.attempted,
    mode + ": transport attempt should reflect physical dispatch");
  assert.equal(publicError.external_request_executed, expected.attempted,
    mode + ": public attempt classification must match physical dispatch");
  assert.equal(publicError.http_status, expected.status);
  assert.equal(counters.fetch, expected.fetch);
  assert.equal(publicError.message.includes(privateMarker), false,
    "arbitrary body/fetch exception details must not be exposed");
  assert.equal(String(caught.message).includes(privateMarker), false,
    "Ozon provider must wrap untrusted transport Error.message");
}

await failed("postfetch_body_failure", {
  code: "PROVIDER_RESPONSE_READ_FAILED", status: 200,
  attempted: true, fetch: 1,
});
await failed("network_failure", {
  code: "PROVIDER_FETCH_FAILED", status: 0,
  attempted: true, fetch: 1,
});
await failed("guard_denied", {
  code: "EXECUTION_GUARD_DENIED", status: 0,
  attempted: false, fetch: 0,
});
await failed("untrusted_host", {
  code: "UNTRUSTED_REQUEST_HOST", status: 0,
  attempted: false, fetch: 0,
});
await failed("missing_fetch", {
  code: "FETCH_IMPL_MISSING", status: 0,
  attempted: false, fetch: 0,
});

const healthy = fixture("success");
const response = await healthy.provider.executeCommandObject(
  request, credentials, {}, { executionGuard: healthy.guard });
assert.equal(response.ok, true);
assert.equal(response.http_status, 200);
assert.equal(healthy.counters.fetch, 1);

console.log(JSON.stringify({
  status: "PASS",
  cases: 6,
  postfetch_http_200_body_error_attempt_known: true,
  caught_error_details_not_reflected: true,
  no_network_dispatch_on_guard_denial: true,
  no_auto_retry_or_additional_provider_fetch: true,
  real_ozon_calls: 0, installed_acceptance: false,
}));
