import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const candidateVerifierPath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-verifier.js",
);
const candidateDispositionPath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-disposition.js",
);
const donorProviderPath = path.join(
  root,
  "migration/reference/wildberries-v0.3.0/runtime/shared/wb_provider.js",
);

function context(extra = {}) {
  return vm.createContext({
    crypto: crypto.webcrypto,
    TextEncoder,
    TextDecoder,
    structuredClone,
    console,
    setTimeout,
    clearTimeout,
    ...extra,
  });
}

function load(file, target, filename) {
  vm.runInContext(fs.readFileSync(file, "utf8"), target, { filename });
}

const candidateContext = context({
  SellerAgentsProviderResponseVerifier: Object.freeze({ verify() {} }),
});
load(
  candidateDispositionPath,
  candidateContext,
  "provider-response-disposition.js",
);
const candidate = candidateContext.SellerAgentsProviderResponseDisposition;
assert.ok(candidate, "candidate disposition global must exist");

const normalize = (value) =>
  value && typeof value === "object"
    ? JSON.parse(JSON.stringify(value))
    : value;
const capture = (fn) => {
  try {
    return { ok: true, value: normalize(fn()) };
  } catch (error) {
    return { ok: false, code: error?.code || null };
  }
};

const details = (overrides = {}) => ({
  transport: "response_received",
  http: "success",
  parse: "json",
  schema: "not_configured",
  semantic: "not_configured",
  source_revision: null,
  fully_verified: false,
  ...overrides,
});
const response = (overrides = {}) => ({
  ok: true,
  httpStatus: 200,
  rawText: '{"ok":true}',
  parsed: { ok: true },
  binaryBase64: "",
  byteLength: 0,
  responseMeta: { content_type: "application/json" },
  elapsedMs: 7,
  ...overrides,
});

function donorProvider(checked, responseValue, responseMode = "json") {
  const donorContext = context();
  donorContext.WBResponseVerifier = Object.freeze({
    policy(value) {
      return value;
    },
    verify() {
      return checked;
    },
  });
  donorContext.WBCredentials = Object.freeze({
    normalizeSellerCredentials() {
      return {};
    },
    sellerHeaders() {
      return {};
    },
  });
  donorContext.ProviderTransportCore = Object.freeze({
    async executeJsonOnce() {
      return responseValue;
    },
    async executeBinaryOnce() {
      return responseValue;
    },
  });
  donorContext.WBArtifactStore = Object.freeze({
    decode() {
      throw new Error("artifact decode outside disposition differential");
    },
  });
  donorContext.WBContract = Object.freeze({
    VERSION: "fixture",
    parseCommand() {
      return { operation: "fixture" };
    },
    resolveOperation() {
      return { method: "GET" };
    },
    buildRequest() {
      return {
        url: "https://fixture.invalid",
        host_alias: "fixture",
        method: "GET",
        headers: {},
        body: undefined,
        response_mode: responseMode,
      };
    },
    commandFingerprint() {
      return "fixture-fingerprint";
    },
    safeErrorPayload(status) {
      return { code: "HTTP_" + status };
    },
    sanitizeResult(_command, value) {
      return value;
    },
    formatResultReport() {
      return "fixture-report";
    },
  });
  load(donorProviderPath, donorContext, "wb_provider.js");
  return donorContext.WBProviderFactory.createWBProvider({
    uuid: () => "request-1",
    now: () => 0,
    verificationPolicy: null,
  });
}

const genericStatus = (status) =>
  status === "STRUCTURAL_ONLY_WB_SCHEMA_PENDING"
    ? "STRUCTURAL_ONLY_PROVIDER_SCHEMA_PENDING"
    : status;

async function donorSuccess(checked, responseValue, responseMode = "json") {
  const result = await donorProvider(
    checked,
    responseValue,
    responseMode,
  ).executeCommand("fixture", {});
  return {
    disposition: genericStatus(result.verification),
    verification_details: result.verification_details,
    provider_http_ok: result.ok,
    provider_http_status: result.http_status,
  };
}

async function donorFailure(checked, responseValue, responseMode = "json") {
  const result = await donorProvider(
    checked,
    responseValue,
    responseMode,
  ).executeCommand("fixture", {});
  const report = JSON.parse(result.report_text.split("\n", 2)[1]);
  return {
    disposition: result.verification,
    verification_details: result.verification_details,
    error: report.result.error,
    provider_http_ok: report.result.provider_http_ok,
    provider_http_status: report.result.provider_http_status,
    body_omitted: report.result.body_omitted,
    raw_capture_policy: {
      chat_access_blocked: report.result.raw_capture.chat_access_blocked,
    },
  };
}

const candidateMeta = (value) => ({
  provider_http_ok: value.ok,
  provider_http_status: value.httpStatus,
});

let assertions = 0;
async function checkSuccess(id, checked, responseValue, responseMode = "json") {
  assert.deepEqual(
    normalize(
      candidate.success(
        checked.details,
        candidateMeta(responseValue),
        { binary: responseMode === "binary" },
      ),
    ),
    normalize(await donorSuccess(checked, responseValue, responseMode)),
    id,
  );
  assertions += 1;
}

async function checkFailure(id, checked, responseValue, responseMode = "json") {
  assert.deepEqual(
    normalize(
      candidate.processingFailure(
        checked.error,
        checked.details,
        candidateMeta(responseValue),
      ),
    ),
    normalize(await donorFailure(checked, responseValue, responseMode)),
    id,
  );
  assertions += 1;
}

await checkSuccess(
  "fully verified",
  { error: null, details: details({ schema: "pass", semantic: "pass", fully_verified: true }) },
  response(),
);
await checkSuccess(
  "binary",
  { error: null, details: details({ parse: "binary" }) },
  response({
    rawText: "",
    parsed: new Uint8Array([1, 2]),
    responseMeta: { content_type: "application/octet-stream" },
  }),
  "binary",
);
await checkSuccess(
  "non-json",
  { error: null, details: details({ parse: "text" }) },
  response({ rawText: "plain", parsed: null, responseMeta: { content_type: "text/plain" } }),
);
await checkSuccess(
  "structural only pending",
  { error: null, details: details({ parse: "json" }) },
  response(),
);
await checkSuccess(
  "provider HTTP error metadata retained",
  { error: null, details: details({ http: "error", parse: "json" }) },
  response({ ok: false, httpStatus: 429 }),
);

await checkFailure(
  "invalid declared json",
  { error: { code: "PROVIDER_JSON_INVALID" }, details: details({ parse: "invalid_json" }) },
  response({ ok: true, httpStatus: 200 }),
);
await checkFailure(
  "safe verifier code retained",
  { error: { code: "DONOR_RULE" }, details: details({ semantic: "error" }) },
  response({ ok: false, httpStatus: 422 }),
);
await checkFailure(
  "unsafe verifier code sanitizes",
  { error: { code: "bad-code" }, details: details({ semantic: "error" }) },
  response({ ok: false, httpStatus: 503 }),
);
await checkFailure(
  "missing verifier code sanitizes",
  { error: new Error("boom"), details: details({ semantic: "failed" }) },
  response({ ok: false, httpStatus: 500 }),
);

for (const [id, fn, code] of [
  [
    "missing verifier dependency",
    () => {
      const target = context();
      load(candidateDispositionPath, target, "provider-response-disposition.js");
      return target.SellerAgentsProviderResponseDisposition.success(
        details(),
        { provider_http_ok: true, provider_http_status: 200 },
      );
    },
    "PROVIDER_RESPONSE_VERIFIER_REQUIRED",
  ],
  [
    "invalid verification details",
    () => candidate.success({}, { provider_http_ok: true, provider_http_status: 200 }),
    "PROVIDER_RESPONSE_VERIFICATION_REQUIRED",
  ],
  [
    "invalid response metadata",
    () => candidate.success(details(), { provider_http_ok: 1, provider_http_status: 200 }),
    "PROVIDER_RESPONSE_METADATA_INVALID",
  ],
  [
    "invalid response mode",
    () =>
      candidate.success(
        details(),
        { provider_http_ok: true, provider_http_status: 200 },
        { binary: "yes" },
      ),
    "PROVIDER_RESPONSE_MODE_INVALID",
  ],
]) {
  assert.equal(capture(fn).code, code, id);
  assertions += 1;
}

assert.deepEqual(
  Object.keys(candidate).sort(),
  ["processingFailure", "success"],
  "public surface remains disposition-only",
);
assertions += 1;

console.log(
  JSON.stringify({
    status: "PASS",
    assertions,
    donor: path.relative(root, donorProviderPath),
    candidate: path.relative(root, candidateDispositionPath),
    live_provider_calls: 0,
    browser_actions: 0,
    credential_access: 0,
    db_service_mutation: 0,
    live_queue_mutation: 0,
    storage_wiring: false,
    delivery_wiring: false,
    composition_wiring: false,
    wb_adapter_wiring: false,
  }),
);
