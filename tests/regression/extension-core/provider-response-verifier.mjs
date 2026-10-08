import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const candidatePolicyPath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-policy.js",
);
const candidateVerifierPath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-verifier.js",
);
const donorPolicyPath = path.join(
  root,
  "migration/reference/wildberries-v0.3.0/runtime/shared/runtime_policy.js",
);
const donorVerifierPath = path.join(
  root,
  "migration/reference/wildberries-v0.3.0/runtime/shared/response_verifier.js",
);

function context(extra = {}) {
  return vm.createContext({
    crypto: crypto.webcrypto,
    TextEncoder,
    TextDecoder,
    structuredClone,
    console,
    ...extra,
  });
}

function load(file, target, filename) {
  vm.runInContext(fs.readFileSync(file, "utf8"), target, { filename });
}

const candidateContext = context();
load(candidatePolicyPath, candidateContext, "provider-response-policy.js");
load(candidateVerifierPath, candidateContext, "provider-response-verifier.js");
const candidate = candidateContext.SellerAgentsProviderResponseVerifier;
assert.ok(candidate, "candidate verifier global must exist");

const donorContext = context();
load(donorPolicyPath, donorContext, "runtime_policy.js");
load(donorVerifierPath, donorContext, "response_verifier.js");
const donor = donorContext.WBResponseVerifier;
assert.ok(donor, "donor verifier global must exist");

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
let assertions = 0;
const check = (id, donorFn, candidateFn) => {
  assert.deepEqual(capture(candidateFn), capture(donorFn), id);
  assertions += 1;
};

const reviewedSchema = {
  type: "object",
  required: ["count"],
  additionalProperties: false,
  properties: {
    count: { type: "integer", minimum: 1, maximum: 3 },
  },
};

check(
  "null policy",
  () => donor.policy(null),
  () => candidate.policy(null),
);
check(
  "undefined policy",
  () => donor.policy(undefined),
  () => candidate.policy(undefined),
);
check(
  "reviewed minimal policy",
  () => donor.policy({ reviewed: true, source_revision: "r1" }),
  () => candidate.policy({ reviewed: true, source_revision: "r1" }),
);
check(
  "reviewed schema policy",
  () =>
    donor.policy({
      reviewed: true,
      source_revision: "r1",
      schema: reviewedSchema,
    }),
  () =>
    candidate.policy({
      reviewed: true,
      source_revision: "r1",
      schema: reviewedSchema,
    }),
);
for (const value of [
  {},
  { reviewed: false, source_revision: "r1" },
  { reviewed: true, source_revision: "" },
]) {
  check(
    "policy rejects " + JSON.stringify(value),
    () => donor.policy(value),
    () => candidate.policy(value),
  );
}
check(
  "policy rejects non-function semanticError",
  () =>
    donor.policy({
      reviewed: true,
      source_revision: "r1",
      semanticError: "no",
    }),
  () =>
    candidate.policy({
      reviewed: true,
      source_revision: "r1",
      semanticError: "no",
    }),
);
check(
  "policy propagates schema compiler failure",
  () =>
    donor.policy({
      reviewed: true,
      source_revision: "r1",
      schema: { type: "object", oneOf: [] },
    }),
  () =>
    candidate.policy({
      reviewed: true,
      source_revision: "r1",
      schema: { type: "object", oneOf: [] },
    }),
);

const donorPassPolicy = donor.policy({
  reviewed: true,
  source_revision: "r1",
  schema: reviewedSchema,
  semanticError: () => null,
});
const candidatePassPolicy = candidate.policy({
  reviewed: true,
  source_revision: "r1",
  schema: reviewedSchema,
  semanticError: () => null,
});
const response = (overrides = {}) => ({
  ok: true,
  httpStatus: 200,
  rawText: '{"count":2}',
  parsed: null,
  responseMeta: { content_type: "application/json" },
  ...overrides,
});
const verifyCheck = (
  id,
  responseValue,
  donorPolicy,
  candidatePolicy,
  options = {},
) =>
  check(
    id,
    () => donor.verify(responseValue, { ...options, policy: donorPolicy }),
    () =>
      candidate.verify(responseValue, { ...options, policy: candidatePolicy }),
  );

verifyCheck(
  "valid reviewed JSON fully verifies",
  response(),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "JSON content-type charset",
  response({
    responseMeta: { content_type: "application/json; charset=utf-8" },
  }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "plus-json content type",
  response({ responseMeta: { content_type: "application/problem+json" } }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "invalid JSON",
  response({ rawText: '{"count":' }),
  donorPassPolicy,
  candidatePassPolicy,
);
for (const status of [204, 205]) {
  verifyCheck(
    "empty " + status,
    response({ httpStatus: status, rawText: "", parsed: null }),
    null,
    null,
  );
}
verifyCheck(
  "parsed non-json response is validated as JSON value",
  response({
    rawText: "",
    parsed: { count: 2 },
    responseMeta: { content_type: "text/plain" },
  }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "unsafe response key",
  response({ rawText: '{"__proto__":{"danger":true}}' }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "non-finite parsed response",
  response({
    rawText: "",
    parsed: { count: Infinity },
    responseMeta: { content_type: "text/plain" },
  }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "schema mismatch",
  response({ rawText: '{"count":9}' }),
  donorPassPolicy,
  candidatePassPolicy,
);

const donorSemanticError = donor.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => ({ code: "DONOR_RULE" }),
});
const candidateSemanticError = candidate.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => ({ code: "DONOR_RULE" }),
});
verifyCheck(
  "semantic exact code",
  response(),
  donorSemanticError,
  candidateSemanticError,
);
const donorSemanticBadCode = donor.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => ({ code: "bad-code" }),
});
const candidateSemanticBadCode = candidate.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => ({ code: "bad-code" }),
});
verifyCheck(
  "semantic bad code sanitizes",
  response(),
  donorSemanticBadCode,
  candidateSemanticBadCode,
);
const donorSemanticThrows = donor.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => {
    throw new Error("semantic exploded");
  },
});
const candidateSemanticThrows = candidate.policy({
  reviewed: true,
  source_revision: "r2",
  schema: reviewedSchema,
  semanticError: () => {
    throw new Error("semantic exploded");
  },
});
verifyCheck(
  "semantic throw sanitizes",
  response(),
  donorSemanticThrows,
  candidateSemanticThrows,
);
verifyCheck(
  "HTTP error preserves parsed result without full verification",
  response({ ok: false, httpStatus: 429 }),
  donorPassPolicy,
  candidatePassPolicy,
);
verifyCheck(
  "binary response behavior",
  response({
    rawText: "",
    parsed: new Uint8Array([1, 2, 3]),
    responseMeta: { content_type: "application/octet-stream" },
  }),
  null,
  null,
  { binary: true },
);

const donorSchemaOnly = donor.policy({
  reviewed: true,
  source_revision: "r3",
  schema: reviewedSchema,
});
const candidateSchemaOnly = candidate.policy({
  reviewed: true,
  source_revision: "r3",
  schema: reviewedSchema,
});
verifyCheck(
  "schema-only policy is not fully verified",
  response(),
  donorSchemaOnly,
  candidateSchemaOnly,
);
const donorSemanticOnly = donor.policy({
  reviewed: true,
  source_revision: "r3",
  semanticError: () => null,
});
const candidateSemanticOnly = candidate.policy({
  reviewed: true,
  source_revision: "r3",
  semanticError: () => null,
});
verifyCheck(
  "semantic-only policy is not fully verified",
  response(),
  donorSemanticOnly,
  candidateSemanticOnly,
);
verifyCheck("no policy remains not fully verified", response(), null, null);

const noDependency = context();
load(candidateVerifierPath, noDependency, "provider-response-verifier.js");
const withoutPolicy = noDependency.SellerAgentsProviderResponseVerifier;
assert.equal(
  capture(() => withoutPolicy.policy({ reviewed: true, source_revision: "r1" }))
    .code,
  "PROVIDER_RESPONSE_POLICY_REQUIRED",
  "non-null policy must fail closed without common response-policy dependency",
);
assert.deepEqual(
  normalize(withoutPolicy.verify(response())),
  {
    ok: false,
    value: null,
    details: {
      transport: "response_received",
      http: "success",
      parse: "text",
      schema: "not_configured",
      semantic: "not_configured",
      source_revision: null,
      fully_verified: false,
    },
    error: {
      code: "PROVIDER_RESPONSE_POLICY_REQUIRED",
      stage: "response_verification",
      automatic_retry: false,
    },
  },
  "verify must fail closed without common response-policy dependency",
);
assertions += 2;

const composition = JSON.parse(
  fs.readFileSync(path.join(root, "apps/extension/composition.json"), "utf8"),
);
const prelude = composition.worker_prelude || [];
const policyScript =
  "packages/bridge-core/src/execution/provider-response-policy.js";
const verifierScript =
  "packages/bridge-core/src/execution/provider-response-verifier.js";
for (const relative of [policyScript, verifierScript]) {
  assert.equal(
    prelude.filter((script) => script === relative).length,
    1,
    relative + " must be included exactly once in packaged composition",
  );
  assertions += 1;
}
assert.ok(
  prelude.indexOf(policyScript) < prelude.indexOf(verifierScript),
  "response verifier requires the policy foundation to be loaded first",
);
assertions += 1;

console.log(
  JSON.stringify({
    status: "PASS",
    assertions,
    live_provider_calls: 0,
    browser_actions: 0,
    packaged_runtime_widened: true,
    provider_processing_activated: false,
    live_schema_attached: false,
    scope:
      "accepted response verifier packaged after policy; no runtime provider policy attachment",
  }),
);
