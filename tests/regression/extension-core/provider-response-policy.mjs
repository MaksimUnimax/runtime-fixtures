import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const candidatePath = path.join(
  root,
  "packages/bridge-core/src/execution/provider-response-policy.js",
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

const candidateContext = context();
vm.runInContext(fs.readFileSync(candidatePath, "utf8"), candidateContext, {
  filename: "provider-response-policy.js",
});
const candidate = candidateContext.SellerAgentsProviderResponsePolicy;
assert.ok(candidate, "candidate policy global must exist");

const donorContext = context();
vm.runInContext(fs.readFileSync(donorPolicyPath, "utf8"), donorContext, {
  filename: "runtime_policy.js",
});
vm.runInContext(fs.readFileSync(donorVerifierPath, "utf8"), donorContext, {
  filename: "response_verifier.js",
});
const donorPolicy = donorContext.WBRuntimePolicy;
const donorVerifier = donorContext.WBResponseVerifier;
assert.ok(
  donorPolicy && donorVerifier,
  "donor policy/verifier globals must exist",
);

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
const compare = (id, donor, current) =>
  assert.deepEqual(capture(current), capture(donor), id);

let assertions = 0;
const check = (id, donor, current) => {
  compare(id, donor, current);
  assertions += 1;
};

check(
  "canonical sorts object keys",
  () => donorPolicy.canonical({ z: [2, 1], a: { b: true } }),
  () => candidate.canonical({ z: [2, 1], a: { b: true } }),
);
check(
  "canonical rejects undefined",
  () => donorPolicy.canonical(undefined),
  () => candidate.canonical(undefined),
);
check(
  "date accepts leap day",
  () => donorPolicy.dateValue("2024-02-29"),
  () => candidate.dateValue("2024-02-29"),
);
check(
  "date rejects normalized calendar overflow",
  () => donorPolicy.dateValue("2026-02-30"),
  () => candidate.dateValue("2026-02-30"),
);
check(
  "date-time compares strict instant syntax",
  () => donorPolicy.dateTime("2026-09-01T07:00:00Z"),
  () => candidate.dateTime("2026-09-01T07:00:00Z"),
);
for (const value of [
  "2026-02-30T00:00:00Z",
  "2026-09-01T24:00:00Z",
  "2026-09-01T00:00:00+24:00",
]) {
  check(
    "date-time rejects " + value,
    () => donorPolicy.dateTime(value),
    () => candidate.dateTime(value),
  );
}

const reviewedSchema = {
  type: "object",
  required: ["count", "when"],
  additionalProperties: false,
  properties: {
    count: { type: "integer", minimum: 1, maximum: 3 },
    when: { type: "string", format: "date" },
    tags: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", minLength: 1, maxLength: 4 },
    },
    mode: { type: "string", enum: ["a", "b"] },
    optional: { type: "string", nullable: true },
  },
};
check(
  "compile supported schema",
  () => donorPolicy.compileSchema(reviewedSchema),
  () => candidate.compileSchema(reviewedSchema),
);
for (const schema of [
  { type: "object", oneOf: [] },
  { type: "mystery" },
  { type: "object", properties: [] },
  { type: "string", format: "month" },
  { type: "array", minItems: 2, maxItems: 1 },
  { type: "number", minimum: 2, maximum: 1 },
  { type: "object", required: [1] },
]) {
  check(
    "compile rejects malformed/unsupported schema " + JSON.stringify(schema),
    () => donorPolicy.compileSchema(schema),
    () => candidate.compileSchema(schema),
  );
}
const unsafeMetadata = JSON.parse('{"type":"object","__proto__":{"x":1}}');
check(
  "compile rejects unsafe metadata key",
  () => donorPolicy.compileSchema(unsafeMetadata),
  () => candidate.compileSchema(unsafeMetadata),
);
let tooDeepSchema = { type: "string" };
for (let index = 0; index < 34; index += 1)
  tooDeepSchema = { type: "array", items: tooDeepSchema };
check(
  "compile rejects schema depth",
  () => donorPolicy.compileSchema(tooDeepSchema),
  () => candidate.compileSchema(tooDeepSchema),
);

const compiledDonor = donorPolicy.compileSchema(reviewedSchema);
const compiledCandidate = candidate.compileSchema(reviewedSchema);
const validValue = {
  count: 2,
  when: "2026-09-01",
  tags: ["x", "yz"],
  mode: "a",
};
check(
  "validate supported value",
  () => donorPolicy.validateSchema(validValue, compiledDonor),
  () => candidate.validateSchema(validValue, compiledCandidate),
);
for (const value of [
  { count: 2, when: "2026-09-01", tags: ["x"], mode: "a", extra: true },
  { when: "2026-09-01", tags: ["x"], mode: "a" },
  { count: 4, when: "2026-09-01", tags: ["x"], mode: "a" },
  { count: 2, when: "2026-02-30", tags: ["x"], mode: "a" },
  { count: 2, when: "2026-09-01", tags: [], mode: "a" },
  { count: 2, when: "2026-09-01", tags: ["xxxxx"], mode: "a" },
  { count: 2, when: "2026-09-01", tags: ["x"], mode: "c" },
]) {
  check(
    "validate rejects " + JSON.stringify(value),
    () => donorPolicy.validateSchema(value, compiledDonor),
    () => candidate.validateSchema(value, compiledCandidate),
  );
}
const unsafeResponse = JSON.parse('{"__proto__":{"danger":true}}');
check(
  "metadata safe tree rejects unsafe key",
  () => donorPolicy.compileSchema(unsafeMetadata),
  () => candidate.compileSchema(unsafeMetadata),
);
check(
  "response safe tree rejects unsafe key",
  () => donorVerifier.safeTree(unsafeResponse),
  () => candidate.safeResponseTree(unsafeResponse),
);
check(
  "response safe tree rejects non-finite number",
  () => donorVerifier.safeTree({ n: Infinity }),
  () => candidate.safeResponseTree({ n: Infinity }),
);
check(
  "response safe tree enforces key budget without huge fixture",
  () => donorVerifier.safeTree({ one: 1 }, 0, { keys: 300000 }),
  () => candidate.safeResponseTree({ one: 1 }, 0, { keys: 300000 }),
);
let deepResponse = {};
let cursor = deepResponse;
for (let index = 0; index < 66; index += 1) cursor = cursor.child = {};
check(
  "response safe tree enforces depth",
  () => donorVerifier.safeTree(deepResponse),
  () => candidate.safeResponseTree(deepResponse),
);

// Source composition now includes the accepted inert policy foundation.
const composition = JSON.parse(
  fs.readFileSync(path.join(root, "apps/extension/composition.json"), "utf8"),
);
const prelude = composition.worker_prelude || [];
const policyScript =
  "packages/bridge-core/src/execution/provider-response-policy.js";
const verifierScript =
  "packages/bridge-core/src/execution/provider-response-verifier.js";
assert.equal(
  prelude.filter((script) => script === policyScript).length,
  1,
  "accepted response-policy foundation must be packaged exactly once",
);
assert.ok(
  prelude.indexOf(policyScript) >= 0 &&
    prelude.indexOf(policyScript) < prelude.indexOf(verifierScript),
  "response policy must precede verifier in worker prelude",
);
assertions += 2;

console.log(
  JSON.stringify({
    status: "PASS",
    assertions,
    live_provider_calls: 0,
    browser_actions: 0,
    packaged_runtime_widened: true,
    provider_processing_activated: false,
    scope:
      "accepted response policy packaged before verifier; no WB schema or provider processing activated",
  }),
);
