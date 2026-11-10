// Actual helper output + bounded static DTO key/version projection, NOT Zod/API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const startedAt = new Date().toISOString();
const root = resolve(process.argv[2] ?? process.cwd());
const helperPath = resolve(root, "apps/portal/lib/feedback-ui.ts");
const contractPath = resolve(root, "packages/contracts/src/index.ts");
const packagePath = resolve(root, "apps/portal/package.json");
const helperSource = readFileSync(helperPath, "utf8");
const contractSource = readFileSync(contractPath, "utf8");
const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const { buildFeedbackPayload, FEEDBACK_CATEGORIES } = await import(pathToFileURL(helperPath).href);
function strictKeys(name) {
  const start = contractSource.indexOf(`export const ${name} = z\n  .object({`);
  const end = contractSource.indexOf("\n  })\n  .strict();", start);
  assert.ok(start >= 0 && end > start, `exact strict object anchors: ${name}`);
  const declaration = contractSource.slice(start, end);
  const keys = Array.from(declaration.matchAll(/^    ([A-Za-z][A-Za-z0-9]*):/gm), (x) => x[1]);
  assert.ok(keys.length > 0 && new Set(keys).size === keys.length);
  return { name, keys, declarationSha256: sha(declaration), declaration };
}
const create = strictKeys("FeedbackCreateBodyV1Schema");
const diagnostics = strictKeys("SafeDiagnosticEnvelopeV1Schema");
// Deliberately only checks source-declared keys, not schema parsing/defaults.
function undeclaredKeys(payload) {
  const errors = Object.keys(payload).filter((key) => !create.keys.includes(key));
  if (payload.diagnostics && typeof payload.diagnostics === "object") {
    errors.push(...Object.keys(payload.diagnostics).filter((key) => !diagnostics.keys.includes(key)).map((key) => `diagnostics.${key}`));
  }
  return errors;
}
const input = { accountId: "11111111-1111-4111-8111-111111111111", category: "OTHER", description: "Synthetic feedback" };
const make = (includeDiagnostics, values = input) => buildFeedbackPayload({ ...values, includeDiagnostics });
const expected = (values = input) => ({ ...values, portalVersion: version });
const results = [];
function check(name, run) {
  try { run(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: String(error.message) }); }
}
check("top-level existing portalVersion is optional B2SafeVersion", () => {
  assert.match(create.declaration, /portalVersion: B2SafeVersion\.optional\(\)/);
  assert.match(create.declaration, /diagnostics: SafeDiagnosticEnvelopeV1Schema\.optional\(\)/);
});
check("strict nested diagnostic envelope does not declare portalVersion", () => {
  assert.equal(diagnostics.keys.includes("portalVersion"), false);
  assert.equal(diagnostics.keys.includes("productVersion"), true);
});
check("opt-out payload remains exact base fields", () => assert.deepEqual(make(false), input));
check("opt-out contains no version or diagnostic metadata", () => {
  for (const key of ["portalVersion", "productVersion", "diagnostics", "browserFamily", "extensionVersion"])
    assert.equal(Object.hasOwn(make(false), key), false);
});
check("actual opt-in helper output has no undeclared strict DTO keys", () => assert.deepEqual(undeclaredKeys(make(true)), []));
check("opt-in attaches only the existing top-level portalVersion", () => assert.deepEqual(make(true), expected()));
check("opt-in version matches current portal package value", () => assert.equal(make(true).portalVersion, version));
check("opt-in version satisfies retained B2SafeVersion scalar bounds", () => {
  const value = make(true).portalVersion;
  assert.equal(typeof value, "string");
  assert.ok(value.length >= 1 && value.length <= 64 && /^[A-Za-z0-9._+-]+$/u.test(value));
});
check("no empty/invalid diagnostic envelope or productVersion is invented", () => {
  assert.equal(Object.hasOwn(make(true), "diagnostics"), false);
  assert.equal(Object.hasOwn(make(true), "productVersion"), false);
});
check("no caller object mutation while choosing consent", () => {
  const before = JSON.stringify(input); make(true); make(false); assert.equal(JSON.stringify(input), before);
});
check("consent toggles never cache metadata into a later opt-out", () => {
  make(true); assert.deepEqual(make(false), input); make(true); assert.deepEqual(make(false), input);
});
check("account/category/description including plain multiline text retained", () => {
  const values = { ...input, description: "Synthetic line one\n  line two  " };
  const payload = make(true, values);
  assert.equal(payload.accountId, values.accountId); assert.equal(payload.category, values.category); assert.equal(payload.description, values.description);
});
check("category contract inventory stays17 unique entries", () => {
  assert.equal(FEEDBACK_CATEGORIES.length, 17); assert.equal(new Set(FEEDBACK_CATEGORIES).size, 17);
});
for (const category of FEEDBACK_CATEGORIES) {
  check(`opt-in/${category}: exact transport payload and declared key placement`, () => {
    const values = { ...input, category }; const payload = make(true, values);
    assert.deepEqual(undeclaredKeys(payload), []); assert.deepEqual(payload, expected(values));
  });
  check(`opt-out/${category}: exact base payload only`, () => {
    const values = { ...input, category }; assert.deepEqual(make(false, values), values);
  });
}
check("negative control diagnoses original nested portalVersion", () => {
  assert.deepEqual(undeclaredKeys({ ...input, diagnostics: { portalVersion: version } }), ["diagnostics.portalVersion"]);
});
check("negative controls diagnose unknown top/nested fields", () => {
  assert.deepEqual(undeclaredKeys({ ...input, debugPayload: "synthetic" }), ["debugPayload"]);
  assert.deepEqual(undeclaredKeys({ ...input, diagnostics: { rawDetails: "synthetic" } }), ["diagnostics.rawDetails"]);
});
const passed = results.filter((x) => x.pass).length;
console.log(JSON.stringify({ kind: "FB_CONTRACT_01_HELPER_STATIC_DECLARED_SHAPE_V1", startedAt,
  completedAt: new Date().toISOString(), node: process.version,
  helper: { path: helperPath, bytes: Buffer.byteLength(helperSource), sha256: sha(helperSource) },
  contracts: { path: contractPath, bytes: Buffer.byteLength(contractSource), sha256: sha(contractSource), createKeys: create.keys, diagnosticKeys: diagnostics.keys },
  portalVersion: version, runnerSha256: sha(readFileSync(new URL(import.meta.url))), passed, total: results.length, results,
  level: "actual native Node TypeScript helper output; static strict declared key/version checks only. Actual Zod parsing/defaults/refinements, API, React/Next/browser NOT_RUN.",
}, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
