import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const candidatePath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-retention.js",
);
const donorProviderPath = path.join(
  root,
  "migration/reference/wildberries-v0.3.0/runtime/shared/wb_provider.js",
);
const dispositionPath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-disposition.js",
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

const dispositionContext = context({
  SellerAgentsProviderResponseVerifier: Object.freeze({ verify() {} }),
});
load(dispositionPath, dispositionContext, "provider-response-disposition.js");
const acceptedDisposition =
  dispositionContext.SellerAgentsProviderResponseDisposition;
assert.ok(acceptedDisposition, "accepted disposition dependency must exist");

const candidateContext = context({
  SellerAgentsProviderResponseDisposition: acceptedDisposition,
});
load(candidatePath, candidateContext, "provider-response-retention.js");
const candidate = candidateContext.SellerAgentsProviderResponseRetention;
assert.ok(candidate, "candidate retention global must exist");

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
const descriptor = Object.freeze({
  ref: "fixture-ref",
  filename: "fixture.pdf",
  mime: "application/pdf",
  byte_length: 3,
  sha256: "a".repeat(64),
  expires_at: 1234567890,
  request_id: "request-1",
  source_kind: "original_provider_file",
  artifact_key: "provider:request-1",
});
const neutralDescriptor = (value) => ({
  ref: value.ref,
  sha256: value.sha256,
  byte_length: value.byte_length,
});
const failureDisposition = acceptedDisposition.processingFailure(
  { code: "DONOR_RULE" },
  details(),
  { provider_http_ok: true, provider_http_status: 200 },
);
const malformedDisposition = acceptedDisposition.processingFailure(
  { code: "PROVIDER_JSON_INVALID" },
  details({ parse: "invalid_json" }),
  { provider_http_ok: true, provider_http_status: 200 },
);
const binaryDisposition = acceptedDisposition.success(
  details({ parse: "binary" }),
  { provider_http_ok: true, provider_http_status: 200 },
  { binary: true },
);
const verifiedBinaryDisposition = acceptedDisposition.success(
  details({
    parse: "binary",
    schema: "pass",
    semantic: "pass",
    fully_verified: true,
  }),
  { provider_http_ok: true, provider_http_status: 200 },
  { binary: true },
);

function donorProvider(
  checked,
  responseValue,
  responseMode = "json",
  { artifactSink = null, quarantineSink = null } = {},
) {
  const donorContext = context();
  let externalProviderCalls = 0;
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
    decode(value) {
      return Buffer.from(value, "base64");
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
    formatResultReport({ result }) {
      return "WB_RESULT_V1\n" + JSON.stringify({ result });
    },
  });
  load(donorProviderPath, donorContext, "wb_provider.js");
  return {
    provider: donorContext.WBProviderFactory.createWBProvider({
      uuid: () => "request-1",
      now: () => 0,
      verificationPolicy: null,
      artifactSink,
      quarantineSink,
    }),
    externalProviderCalls: () => externalProviderCalls,
  };
}

function reportResult(result) {
  return JSON.parse(result.report_text.split("\n", 2)[1]).result;
}

async function donorQuarantine({ sink = null } = {}) {
  const deep = { error: { code: "DONOR_RULE" }, details: details() };
  const responseValue = response({ rawText: '{"bad":true}' });
  const { provider, externalProviderCalls } = donorProvider(
    deep,
    responseValue,
    "json",
    { quarantineSink: sink },
  );
  const result = await provider.executeCommand("fixture", {});
  return {
    capture: reportResult(result).raw_capture,
    external_provider_calls: externalProviderCalls(),
  };
}

async function donorBinary({ sink, fullyVerified = false }) {
  const responseValue = response({
    rawText: "",
    parsed: new Uint8Array([1, 2, 3]),
    binaryBase64: Buffer.from([1, 2, 3]).toString("base64"),
    byteLength: 3,
    responseMeta: { content_type: "application/pdf" },
  });
  const { provider, externalProviderCalls } = donorProvider(
    {
      error: null,
      details: details(
        fullyVerified
          ? {
              parse: "binary",
              schema: "pass",
              semantic: "pass",
              fully_verified: true,
            }
          : { parse: "binary" },
      ),
    },
    responseValue,
    "binary",
    { artifactSink: sink },
  );
  const result = await provider.executeCommand("fixture", {});
  const stored = reportResult(result);
  return {
    artifact_refs: result.artifact_refs.map(neutralDescriptor),
    delivery_error: result.delivery_error || null,
    result_policy:
      result.delivery_error === null || result.delivery_error === undefined
        ? {
            artifact: neutralDescriptor(stored.artifact),
            byte_length: stored.byte_length,
            delivery_status: stored.delivery_status,
          }
        : {
            byte_length: stored.byte_length,
            delivery_error: stored.delivery_error,
            bytes_preserved_in_result: stored.bytes_preserved_in_result,
          },
    external_provider_calls: externalProviderCalls(),
  };
}

let assertions = 0;

{
  const donor = await donorQuarantine();
  assert.deepEqual(
    normalize(candidate.quarantineDefault(failureDisposition)),
    normalize(donor.capture),
    "quarantine absent/default",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

{
  const donor = await donorQuarantine({
    sink: async () => descriptor,
  });
  assert.deepEqual(
    normalize(candidate.quarantineStored(failureDisposition, descriptor)),
    normalize(donor.capture),
    "quarantine stored",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

{
  assert.deepEqual(
    normalize(candidate.quarantineDefault(malformedDisposition)),
    {
      stored_locally: false,
      raw_retention_failed: true,
      chat_access_blocked: true,
    },
    "accepted malformed-json failure disposition",
  );
  assertions += 1;
}

{
  const donor = await donorQuarantine({
    sink: async () => {
      throw new Error("synthetic quarantine storage failure");
    },
  });
  assert.deepEqual(
    normalize(candidate.quarantineDefault(failureDisposition)),
    normalize(donor.capture),
    "quarantine failure remains provider-truth neutral",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

{
  const donor = await donorBinary({
    sink: async () => descriptor,
  });
  assert.deepEqual(
    normalize(candidate.binaryStored(binaryDisposition, descriptor, 3)),
    normalize({
      artifact_refs: donor.artifact_refs,
      delivery_error: donor.delivery_error,
      result_policy: donor.result_policy,
    }),
    "binary stored",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

{
  const donor = await donorBinary({
    sink: async () => descriptor,
    fullyVerified: true,
  });
  assert.deepEqual(
    normalize(candidate.binaryStored(verifiedBinaryDisposition, descriptor, 3)),
    normalize({
      artifact_refs: donor.artifact_refs,
      delivery_error: donor.delivery_error,
      result_policy: donor.result_policy,
    }),
    "fully verified binary stored",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

{
  const stored = candidate.binaryStored(
    binaryDisposition,
    {
      ...descriptor,
      content_base64: "raw-must-not-cross-boundary",
      raw_bytes: [1, 2, 3],
      provider_filename: "WB-secret-name.pdf",
    },
    3,
  );
  assert.deepEqual(
    Object.keys(normalize(stored.artifact_refs[0])).sort(),
    ["byte_length", "ref", "sha256"],
    "binary artifact descriptor allowlist",
  );
  assert.deepEqual(
    Object.keys(normalize(stored.result_policy.artifact)).sort(),
    ["byte_length", "ref", "sha256"],
    "result policy artifact descriptor allowlist",
  );
  assert.equal(
    JSON.stringify(normalize(stored)).includes("raw-must-not-cross-boundary"),
    false,
    "raw base64 must not cross retention boundary",
  );
  assert.equal(
    JSON.stringify(normalize(stored)).includes("WB-secret-name.pdf"),
    false,
    "provider filename must not cross neutral descriptor boundary",
  );
  assertions += 4;
}

{
  const donor = await donorBinary({
    sink: async () => {
      throw new Error("synthetic artifact storage failure");
    },
  });
  assert.deepEqual(
    normalize(candidate.binaryStorageFailed(binaryDisposition, 3)),
    normalize({
      artifact_refs: donor.artifact_refs,
      delivery_error: donor.delivery_error,
      result_policy: donor.result_policy,
    }),
    "binary storage failure",
  );
  assert.equal(donor.external_provider_calls, 0);
  assertions += 2;
}

for (const [id, fn, code] of [
  [
    "missing disposition dependency",
    () => {
      const target = context();
      load(candidatePath, target, "provider-response-retention.js");
      return target.SellerAgentsProviderResponseRetention.quarantineDefault(
        failureDisposition,
      );
    },
    "PROVIDER_RESPONSE_DISPOSITION_REQUIRED",
  ],
  [
    "wrong failure disposition",
    () =>
      candidate.quarantineDefault({
        disposition: "BINARY_BYTES_CAPTURED",
        body_omitted: true,
        raw_capture_policy: { chat_access_blocked: true },
      }),
    "PROVIDER_RESPONSE_FAILURE_DISPOSITION_REQUIRED",
  ],
  [
    "wrong binary disposition",
    () =>
      candidate.binaryStored(
        { ...binaryDisposition, provider_http_ok: false },
        descriptor,
        3,
      ),
    "PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED",
  ],
  [
    "fabricated failure disposition without accepted metadata",
    () =>
      candidate.quarantineDefault({
        disposition: "RESPONSE_PROCESSING_FAILED",
        body_omitted: true,
        raw_capture_policy: { chat_access_blocked: true },
      }),
    "PROVIDER_RESPONSE_FAILURE_DISPOSITION_REQUIRED",
  ],
  [
    "fully verified label without fully verified binary details",
    () =>
      candidate.binaryStored(
        {
          ...binaryDisposition,
          disposition: "VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS",
        },
        descriptor,
        3,
      ),
    "PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED",
  ],
  [
    "fabricated fully verified binary without schema and semantic pass",
    () =>
      candidate.binaryStored(
        {
          ...verifiedBinaryDisposition,
          verification_details: {
            ...verifiedBinaryDisposition.verification_details,
            schema: "not_configured",
            semantic: "not_configured",
            fully_verified: true,
          },
        },
        descriptor,
        3,
      ),
    "PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED",
  ],
  [
    "fabricated nonverified binary despite schema and semantic pass",
    () =>
      candidate.binaryStored(
        {
          ...binaryDisposition,
          verification_details: {
            ...binaryDisposition.verification_details,
            schema: "pass",
            semantic: "pass",
            fully_verified: false,
          },
        },
        descriptor,
        3,
      ),
    "PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED",
  ],
  [
    "binary captured label with non-binary details",
    () =>
      candidate.binaryStored(
        {
          ...binaryDisposition,
          verification_details: {
            ...binaryDisposition.verification_details,
            parse: "json",
          },
        },
        descriptor,
        3,
      ),
    "PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED",
  ],
  [
    "invalid descriptor ref",
    () =>
      candidate.quarantineStored(failureDisposition, {
        ...descriptor,
        ref: "",
      }),
    "PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID",
  ],
  [
    "invalid descriptor sha",
    () =>
      candidate.binaryStored(
        binaryDisposition,
        { ...descriptor, sha256: "not-sha" },
        3,
      ),
    "PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID",
  ],
  [
    "uppercase descriptor sha is not normalized",
    () =>
      candidate.binaryStored(
        binaryDisposition,
        { ...descriptor, sha256: "A".repeat(64) },
        3,
      ),
    "PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID",
  ],
  [
    "invalid descriptor length",
    () =>
      candidate.binaryStored(
        binaryDisposition,
        { ...descriptor, byte_length: -1 },
        3,
      ),
    "PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID",
  ],
  [
    "stored descriptor length does not match payload length",
    () =>
      candidate.binaryStored(
        binaryDisposition,
        { ...descriptor, byte_length: descriptor.byte_length + 1 },
        descriptor.byte_length,
      ),
    "PROVIDER_RESPONSE_BYTE_LENGTH_INVALID",
  ],
  [
    "invalid payload length",
    () => candidate.binaryStorageFailed(binaryDisposition, -1),
    "PROVIDER_RESPONSE_BYTE_LENGTH_INVALID",
  ],
]) {
  assert.equal(capture(fn).code, code, id);
  assertions += 1;
}

assert.deepEqual(
  Object.keys(candidate).sort(),
  [
    "binaryStorageFailed",
    "binaryStored",
    "quarantineDefault",
    "quarantineStored",
  ],
);
assertions += 1;

process.stdout.write(
  JSON.stringify(
    {
      status: "PASS",
      assertions,
      external_provider_calls: 0,
      browser_actions: 0,
      credential_access: 0,
      db_or_service_mutation: 0,
      live_queue_mutation: 0,
      actual_storage_io: 0,
      packaged_runtime_widened: false,
    },
    null,
    2,
  ) + "\n",
);
