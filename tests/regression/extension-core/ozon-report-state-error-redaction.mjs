import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../../packages/marketplaces/ozon/src/provider-runtime.js");
const marker = "INERT_R8_STORAGE_ERROR_PRIVATE_MARKER";
const account = { clientId: "INERT_R8_CLIENT", apiKey: "INERT_R8_NOT_REAL" };

function providerFor(mode) {
  const calls = { seller: 0, sessionGet: 0, sessionSet: 0 };
  const contract = {
    normalizeCommand: value => value,
    preflightExecution: command => ({
      meta: { provider: command.operation === "report_file_get" ? "report_file" : "seller_api" },
    }),
    buildRequest: () => ({
      method: "POST", url: "https://fixture.invalid/inert",
      host_alias: "seller_api", external_request_executed: true,
    }),
    verifyProviderResponse: () => {},
    sanitizeResult: (_command, response) => response,
    formatResultReport: () => "OZON_RESULT_V1\nINERT",
    commandFingerprint: () => "INERT_R8_FINGERPRINT",
    safeErrorPayload: () => ({ code: "INERT_HTTP_ERROR" }),
  };
  const sandbox = {
    OzonContract: contract,
    OzonCredentials: {
      normalizeSellerCredentials: raw => raw,
      sellerHeaders: () => ({ "Client-Id": "INERT_R8_CLIENT" }),
    },
    ProviderTransportCore: {
      async executeJsonOnce({ fetchImpl, request }) {
        await fetchImpl(request.url, { method: "POST" });
        return {
          ok: true, httpStatus: 200, rawText: '{"file":"INERT"}',
          parsed: { file: "INERT" }, elapsedMs: 1,
          responseMeta: { retry_after: null },
        };
      },
      normalizeTrustedReportFileUrl: value => value,
    },
  };
  vm.runInNewContext(readFileSync(source, "utf8"), sandbox, {
    filename: "ozon-report-storage-error-synthetic.js",
  });
  const store = {
    async get() {
      calls.sessionGet++;
      if (mode === "get") throw new Error(marker);
      return null;
    },
    async set() {
      calls.sessionSet++;
      if (mode === "set") throw new Error(marker);
    },
  };
  const provider = sandbox.OzonProviderFactory.createOzonProvider({
    contract, reportStateStore: store, now: () => 1_000_000,
    uuid: () => "INERT_R8_REF",
    fetchImpl: async () => { calls.seller++; return { status: 200 }; },
  });
  return { provider, calls };
}

async function assertSanitized(mode, command, expectedCode, expectedExternalRequest) {
  const { provider, calls } = providerFor(mode);
  let observed;
  try {
    await provider.executeCommandObject(command, account);
  } catch (error) {
    observed = error;
  }
  assert.ok(observed, "controlled session storage must fail");
  assert.equal(observed.code, expectedCode);
  assert.equal(observed.external_request_executed, expectedExternalRequest);
  assert.ok(!String(observed.message).includes(marker),
    "storage error message must not disclose opaque underlying diagnostic content");
  assert.ok(!String(observed).includes(marker),
    "exception string must not disclose opaque underlying diagnostic content");
  assert.equal(calls.seller, expectedExternalRequest ? 1 : 0);
}

await assertSanitized("set", { operation: "report_info", params: { code: "REPORT_INERT_R8" } },
  "REPORT_FILE_SESSION_STATE_WRITE_FAILED", true);
await assertSanitized("get", { operation: "report_file_get", params: { file_ref: "rpf_s_INERT_R8" } },
  "REPORT_FILE_SESSION_STATE_READ_FAILED", false);

console.log(JSON.stringify({
  status: "PASS", cases: 2,
  session_write_diagnostic_redacted: true,
  session_read_diagnostic_redacted: true,
  original_error_codes_preserved: true,
  real_provider_network_calls: 0, real_credentials_used: false,
  installed_acceptance: false,
}));
