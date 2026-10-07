import assert from "node:assert/strict";
import path from "node:path";
import { makeWorker } from "./worker-harness.mjs";

const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, "../../.."));
const worker = await makeWorker(root);
const api = await worker.call("(() => SellerAgentsProviderOutcome)");
assert.ok(api, "provider outcome model must be composed");
const normalize = (value) => JSON.parse(JSON.stringify(value));
const base = api.createIntent({
  logical_execution_id: "execution-1:0",
  provider_attempt_id: "attempt-1",
  execution_id: "execution-1",
  command_index: 0,
  account: "account-1",
  conversation: "conversation-1",
  work_generation: "work-1",
  binding: "binding-1",
  binding_revision: 3,
  marketplace: "wildberries",
  store: "store-1",
  credential_revision: "credential-1",
  operation: "seller_info",
  attempt_number: 1,
}, 1789344000000);
assert.equal(base.state, api.STATES.DISPATCH_INTENT_COMMITTED);
assert.equal(base.response, null);
assert.equal(base.credential_revision, "credential-1");
assert.equal(JSON.stringify(base).includes("token"), false);

const received = api.markResponseReceived(base, {
  ok: false,
  httpStatus: 429,
  responseMeta: { retry_after: "5", request_id: "provider-request-1" },
}, 1789344001000);
assert.equal(received.state, api.STATES.RESPONSE_RECEIVED);
assert.equal(received.outcome, "KNOWN_RESPONSE");
assert.equal(received.response.classification, "KNOWN_429");
const waiting = api.markKnown(received, false, 1789344002000);
assert.equal(waiting.state, api.STATES.RETRY_WAIT_KNOWN);
const retry = api.beginPermittedRetry(waiting, "attempt-2", 1789344003000);
assert.equal(retry.logical_execution_id, base.logical_execution_id);
assert.equal(retry.provider_attempt_id, "attempt-2");
assert.equal(retry.attempt_number, 2);

const unknown = api.markUnknown(base, 1789344004000, "worker_restart");
assert.equal(unknown.state, api.STATES.OUTCOME_UNKNOWN);
assert.equal(unknown.outcome, "UNKNOWN_OUTCOME");
assert.equal(api.canAutomaticallyDispatch(unknown), false);
assert.equal(api.markKnown(unknown, true).state, api.STATES.OUTCOME_UNKNOWN);
assert.throws(() => api.beginPermittedRetry(unknown, "attempt-3"), { code: "PROVIDER_RETRY_NOT_PERMITTED" });

const completed = api.markKnown(api.markResponseReceived(base, { ok: true, httpStatus: 200 }), true);
assert.equal(completed.state, api.STATES.COMPLETED_KNOWN);
assert.equal(completed.outcome, "KNOWN_RESPONSE");
assert.equal(api.compactHistory([base, unknown, completed], 1789344005000).length, 3);
assert.equal(api.compactHistory([unknown], 1789344005000 + api.UNKNOWN_RETENTION_MS + 1).length, 0);

const verification = (overrides = {}) => ({
  transport: "response_received",
  http: "success",
  parse: "json",
  schema: "not_configured",
  semantic: "not_configured",
  source_revision: null,
  fully_verified: false,
  ...overrides,
});
const responseRecord = api.markResponseReceived(
  base,
  { ok: true, httpStatus: 200 },
  1789344006000,
);
const structural = {
  disposition: "STRUCTURAL_ONLY_PROVIDER_SCHEMA_PENDING",
  verification_details: verification(),
  provider_http_ok: true,
  provider_http_status: 200,
};
const structuralBound = api.attachResponseProcessing(responseRecord, structural);
assert.equal(structuralBound.state, api.STATES.RESPONSE_RECEIVED);
assert.equal(structuralBound.outcome, responseRecord.outcome);
assert.equal(structuralBound.response_received_at, responseRecord.response_received_at);
assert.deepEqual(normalize(structuralBound.response_processing), structural);
assert.equal(Object.isFrozen(structuralBound.response_processing), true);
assert.equal(Object.isFrozen(structuralBound.response_processing.verification_details), true);

const processingFailure = {
  disposition: "RESPONSE_PROCESSING_FAILED",
  verification_details: verification(),
  error: {
    code: "PROVIDER_SEMANTIC_ERROR",
    stage: "response_processing",
    automatic_retry: false,
  },
  provider_http_ok: true,
  provider_http_status: 200,
  body_omitted: true,
  raw_capture_policy: { chat_access_blocked: true },
};
const quarantineDefault = {
  stored_locally: false,
  raw_retention_failed: true,
  chat_access_blocked: true,
};
const quarantineBound = api.attachResponseProcessing(
  responseRecord,
  processingFailure,
  quarantineDefault,
);
assert.deepEqual(normalize(quarantineBound.response_processing.retention), quarantineDefault);

const quarantineStored = {
  stored_locally: true,
  ref: "quarantine-ref",
  sha256: "a".repeat(64),
  byte_length: 7,
  chat_access_blocked: true,
};
const storedQuarantineBound = api.attachResponseProcessing(
  responseRecord,
  processingFailure,
  quarantineStored,
);
assert.deepEqual(
  normalize(storedQuarantineBound.response_processing.retention),
  quarantineStored,
);

const binaryDisposition = {
  disposition: "BINARY_BYTES_CAPTURED",
  verification_details: verification({ parse: "binary" }),
  provider_http_ok: true,
  provider_http_status: 200,
};
const artifact = {
  ref: "artifact-ref",
  sha256: "b".repeat(64),
  byte_length: 3,
};
const binaryStored = {
  artifact_refs: [artifact],
  delivery_error: null,
  result_policy: {
    artifact,
    byte_length: 3,
    delivery_status: "PREPARED_NOT_ATTACHED",
  },
};
const binaryBound = api.attachResponseProcessing(
  responseRecord,
  binaryDisposition,
  binaryStored,
);
assert.deepEqual(normalize(binaryBound.response_processing.retention), binaryStored);
assert.equal(Object.isFrozen(binaryBound.response_processing.retention.artifact_refs), true);

const binaryErrorResponse = api.markResponseReceived(
  base,
  { ok: false, httpStatus: 500 },
  1789344007000,
);
const binaryHttpErrorDisposition = {
  disposition: "BINARY_BYTES_CAPTURED",
  verification_details: verification({ http: "error", parse: "binary" }),
  provider_http_ok: false,
  provider_http_status: 500,
};
assert.throws(
  () =>
    api.attachResponseProcessing(
      binaryErrorResponse,
      binaryHttpErrorDisposition,
      binaryStored,
    ),
  { code: "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID" },
);

const storageError = {
  code: "ARTIFACT_STORAGE_FAILED",
  provider_http_status: 200,
  provider_ok: true,
  automatic_retry: false,
};
const binaryStorageFailed = {
  artifact_refs: [],
  delivery_error: storageError,
  result_policy: {
    byte_length: 3,
    delivery_error: storageError,
    bytes_preserved_in_result: true,
  },
};
const storageFailedBound = api.attachResponseProcessing(
  responseRecord,
  binaryDisposition,
  binaryStorageFailed,
);
assert.deepEqual(
  normalize(storageFailedBound.response_processing.retention),
  binaryStorageFailed,
);

const verifiedBinaryDisposition = {
  disposition: "VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS",
  verification_details: verification({
    parse: "binary",
    schema: "pass",
    semantic: "pass",
    fully_verified: true,
  }),
  provider_http_ok: true,
  provider_http_status: 200,
};
assert.deepEqual(
  normalize(
    api.attachResponseProcessing(
      responseRecord,
      verifiedBinaryDisposition,
      binaryStored,
    ).response_processing.retention,
  ),
  binaryStored,
);
assert.equal(
  Object.hasOwn(
    api.attachResponseProcessing(responseRecord, binaryDisposition)
      .response_processing,
    "retention",
  ),
  false,
);

const malformedFailure = {
  disposition: "MALFORMED_DECLARED_JSON",
  verification_details: verification({ parse: "invalid_json" }),
  error: {
    code: "PROVIDER_JSON_INVALID",
    stage: "response_processing",
    automatic_retry: false,
  },
  provider_http_ok: true,
  provider_http_status: 200,
  body_omitted: true,
  raw_capture_policy: { chat_access_blocked: true },
};
assert.deepEqual(
  normalize(
    api.attachResponseProcessing(
      responseRecord,
      malformedFailure,
      quarantineDefault,
    ).response_processing.retention,
  ),
  quarantineDefault,
);

assert.throws(
  () => api.attachResponseProcessing(structuralBound, structural),
  { code: "PROVIDER_RESPONSE_OUTCOME_STATE_INVALID" },
);
assert.throws(
  () => api.attachResponseProcessing(base, structural),
  { code: "PROVIDER_RESPONSE_OUTCOME_STATE_INVALID" },
);
assert.throws(
  () => api.attachResponseProcessing(unknown, structural),
  { code: "PROVIDER_RESPONSE_OUTCOME_STATE_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, {
      ...structural,
      provider_http_status: 201,
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_METADATA_MISMATCH" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, {
      ...structural,
      rawText: "secret-body",
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_DISPOSITION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, processingFailure, {
      ...quarantineStored,
      content_base64: "AQID",
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () => api.attachResponseProcessing(responseRecord, structural, binaryStored),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, binaryDisposition, {
      ...binaryStored,
      result_policy: { ...binaryStored.result_policy, byte_length: 4 },
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, processingFailure, {
      ...quarantineStored,
      ref: 7,
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, processingFailure, {
      ...quarantineStored,
      ref: " quarantine-ref ",
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, processingFailure, {
      ...quarantineStored,
      ref: "x".repeat(513),
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.throws(
  () =>
    api.attachResponseProcessing(responseRecord, binaryDisposition, {
      ...binaryStored,
      artifact_refs: [{ ...artifact, sha256: "B".repeat(64) }],
      result_policy: {
        ...binaryStored.result_policy,
        artifact: { ...artifact, sha256: "B".repeat(64) },
      },
    }),
  { code: "PROVIDER_RESPONSE_OUTCOME_RETENTION_INVALID" },
);
assert.equal(JSON.stringify(binaryBound).includes("base64"), false);
assert.equal(JSON.stringify(storedQuarantineBound).includes("filename"), false);

console.log(JSON.stringify({
  status: "PASS",
  scenarios: 33,
  states: Object.values(api.STATES),
  unknown_auto_replay: false,
  known_429_new_attempt: true,
}, null, 2));
worker.close();
