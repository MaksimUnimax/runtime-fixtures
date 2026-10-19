import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Same first-party provider runtime as the Ozon candidate. This test uses
// only inert fake URL/credentials and a local, explicitly controlled store.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const reportUrl = "https://fixture.ozon.invalid/report.pdf";
const fakeNow = 1_000_000;
const credentials = { clientId: "INERT_R6_CLIENT", apiKey: "INERT_R6_NO_SECRET" };
const command = { operation: "report_info", params: { code: "REPORT_INERT_R6" } };
const copy = value => JSON.parse(JSON.stringify(value));

function scenario(mode) {
  const calls = { provider: 0, reportFile: 0, reads: 0, sets: 0 };
  let state = null;
  let staleOnce = false;
  const store = {
    async get() {
      calls.reads++;
      if (staleOnce) {
        staleOnce = false;
        return null;
      }
      return state === null ? null : copy(state);
    },
    async set(value) {
      calls.sets++;
      if (mode === "throw") throw new Error("INERT_REPORT_STORE_WRITE_FAILURE");
      if (mode === "drop") return; // Success is reported without persistence.
      state = copy(value);
      if (mode === "stale_readback") staleOnce = true;
    },
  };
  const providerResponse = Object.freeze({
    ok: true, httpStatus: 200, rawText: JSON.stringify({ file: reportUrl }),
    parsed: { file: reportUrl }, elapsedMs: 1, responseMeta: { retry_after: null },
  });
  const contract = {
    normalizeCommand: input => input,
    preflightExecution: item => ({
      meta: { provider: item.operation === "report_file_get" ? "report_file" : "seller_api" },
    }),
    buildRequest: () => ({
      url: "https://fixture.ozon.invalid/inert-seller", method: "POST",
      host_alias: "seller_api", external_request_executed: true,
    }),
    verifyProviderResponse: () => {},
    sanitizeResult: (_command, value) => value,
    formatResultReport: ({ result }) => "OZON_RESULT_V1\n" + JSON.stringify({ result }),
    commandFingerprint: item => "INERT_R6_" + item.operation,
    safeErrorPayload: () => ({ code: "INERT_PROVIDER_ERROR" }),
  };
  const sandbox = {
    OzonContract: contract,
    OzonCredentials: {
      normalizeSellerCredentials: value => value,
      sellerHeaders: () => ({ "Client-Id": "INERT_R6_CLIENT" }),
    },
    ProviderTransportCore: {
      normalizeTrustedReportFileUrl: url => {
        assert.equal(url, reportUrl);
        return url;
      },
      async executeJsonOnce({ fetchImpl, request }) {
        await fetchImpl(request.url, { method: request.method });
        return providerResponse;
      },
      async executeTrustedReportFileOnce({ url }) {
        assert.equal(url, reportUrl);
        calls.reportFile++;
        return Object.freeze({
          ok: true, httpStatus: 200, rawText: "",
          parsed: { content_type: "application/pdf", text: "INERT_R6_DOCUMENT" },
          elapsedMs: 1, responseMeta: { retry_after: null },
        });
      },
    },
  };
  vm.runInNewContext(readFileSync(source, "utf8"), sandbox, {
    filename: "ozon-provider-runtime-session-tested.js",
  });
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    contract, now: () => fakeNow,
    uuid: () => "INERT_R6_REF_ID",
    reportStateStore: store,
    fetchImpl: async () => {
      calls.provider++;
      return { status: 200 };
    },
  });
  return { provider, store, calls, getState: () => state };
}

async function checkUncommitted(mode) {
  const s = scenario(mode);
  await assert.rejects(
    () => s.provider.executeCommandObject(command, credentials),
    error => error?.code === "REPORT_FILE_SESSION_STATE_COMMIT_UNCONFIRMED" &&
      error?.external_request_executed === true,
    "Report file reference must not be returned before persistence readback",
  );
  assert.equal(s.calls.provider, 1, "one original mocked Seller request");
  assert.equal(s.calls.sets, 1, "no blind storage write retry");
}

await checkUncommitted("drop");
await checkUncommitted("stale_readback");

{
  const s = scenario("normal");
  const result = await s.provider.executeCommandObject(command, credentials);
  assert.equal(result.ok, true);
  const ref = result.result.report_file_ref;
  assert.match(ref, /^rpf_p_INERT_R6_REF_ID$/);
  assert.ok(s.getState()?.report_file_refs?.[ref]);
  assert.equal(s.provider.reportFileRefPolicy(ref).personal_data_required, true);
  const file = await s.provider.executeCommandObject(
    { operation: "report_file_get", params: { file_ref: ref } },
    credentials,
  );
  assert.equal(file.ok, true);
  assert.equal(file.result.text, "INERT_R6_DOCUMENT");
  assert.equal(s.calls.provider, 1, "report file access must not refetch Seller");
  assert.equal(s.calls.reportFile, 1, "one inert local document retrieval");
  assert.equal(s.calls.sets, 1, "one state write for report link");
}
{
  const s = scenario("throw");
  await assert.rejects(
    () => s.provider.executeCommandObject(command, credentials),
    error => error?.code === "REPORT_FILE_SESSION_STATE_WRITE_FAILED" &&
      error?.external_request_executed === true,
  );
  assert.equal(s.calls.provider, 1);
}

console.log(JSON.stringify({
  status: "PASS",
  cases: 4,
  silent_write_drop: "FAIL_CLOSED",
  stale_readback: "FAIL_CLOSED",
  normal_report_ref_retrievable: true,
  explicit_write_exception_preserved: true,
  simulated_seller_requests_per_case: 1,
  real_Ozon_provider_calls: 0,
  user_credentials_used: false,
  installed_acceptance: false,
}));
