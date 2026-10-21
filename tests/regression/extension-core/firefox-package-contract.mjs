import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtime = process.argv[2];
assert.ok(runtime, "runtime directory required");
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.background, { scripts: ["firefox_background.js"] });
const storePackage = manifest.name === "Октопорт — Ozon + Wildberries";
assert.equal(
  manifest.browser_specific_settings?.gecko?.id,
  storePackage ? "octoport@octoport.ru" : "seller-agents@example.test",
);
assert.equal(manifest.browser_specific_settings?.gecko?.strict_min_version, "140.0");
assert.deepEqual(
  manifest.browser_specific_settings?.gecko?.data_collection_permissions,
  {
    required: [
      "authenticationInfo",
      "personallyIdentifyingInfo",
      "browsingActivity",
      "websiteContent",
      "searchTerms",
      "financialAndPaymentInfo",
      "personalCommunications",
    ],
    optional: ["technicalAndInteraction"],
  },
);
const loopbackHosts = (manifest.host_permissions || []).filter(value =>
  value.startsWith("http://127.0.0.1"),
);
assert.equal(
  loopbackHosts.some(value => /^http:\/\/127\.0\.0\.1:\d+\//.test(value)),
  false,
  "Firefox loopback host permissions must not include explicit ports",
);
if (loopbackHosts.length) {
  assert.ok(
    loopbackHosts.includes("http://127.0.0.1/*"),
    "Firefox loopback development access must use the portless host pattern",
  );
}
assert.ok(fs.statSync(path.join(runtime, "firefox_background.js")).size > 0);

// Verify the executable static import boundary with TypeScript's JS AST,
// not a regex scanner that mistakes comments, templates or regex literals
// for executable calls. Store/package CI invokes this file twice.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const builder = path.join(repoRoot, "tooling/build/extension_firefox.py");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "octoport-firefox-ast-"));
try {
  const input = path.join(fixtureRoot, "runtime");
  fs.mkdirSync(input);
  fs.writeFileSync(
    path.join(input, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      version: "0.2.37",
      name: "Synthetic Firefox AST contract",
      background: { service_worker: "service_worker_entry.js" },
      action: { default_title: "Synthetic Firefox" },
      permissions: [],
      host_permissions: [],
    }),
  );
  fs.writeFileSync(path.join(input, "child.js"), "globalThis.Child1 = true;\n");
  fs.writeFileSync(path.join(input, "child2.js"), "globalThis.Child2 = true;\n");
  const entry = path.join(input, "service_worker_entry.js");
  function attempt(label, source, shouldSucceed, requiredError) {
    fs.writeFileSync(entry, source);
    const syntax = spawnSync("node", ["--check"], {
      input: source,
      encoding: "utf8",
      timeout: 12000,
    });
    assert.equal(syntax.status, 0, "fixture is not valid JavaScript: " + label + " " + syntax.stderr);
    const out = path.join(fixtureRoot, label);
    const result = spawnSync(
      "python3",
      [builder, "--input-runtime", input, "--output", out],
      { encoding: "utf8", timeout: 25000 },
    );
    if (shouldSucceed) {
      assert.equal(result.status, 0, label + ": " + (result.stderr || result.error?.message));
      return fs.readFileSync(path.join(out, "firefox_background.js"), "utf8");
    }
    assert.notEqual(result.status, 0, label + " must fail closed");
    if (requiredError) assert.ok(result.stderr.includes(requiredError), result.stderr);
    return null;
  }
  const tick = String.fromCharCode(96);
  const real = [
    '"use strict"',
    "const value = 'importScripts(\"ghost.js\");';",
    "// importScripts(\"ghost.js\");",
    "/* importScripts(\"ghost.js\"); */",
    "const template = " + tick + 'importScripts("ghost.js");' + tick + ";",
    "if (enabled) {} /;importScripts(\"ghost.js\");/.test(source);",
    "const regex = +/;importScripts(\"ghost.js\");/;",
    "if /* comment */ (enabled) /importScripts(\"ghost.js\");/.test(source);",
    'importScripts /* comment */ ("child.js");',
    'importScripts("child2.js");',
  ].join("\n") + "\n";
  const compiled = attempt("valid-static", real, true);
  for (const untouched of real.split("\n").slice(0, 8)) {
    assert.ok(compiled.includes(untouched), "non-executable literal was changed");
  }
  for (const name of ["Child1", "Child2"]) {
    assert.ok(compiled.includes("globalThis." + name + " = true;"), name + " not inlined");
  }
  assert.ok(!compiled.includes('importScripts /* comment */ ("child.js");'));
  assert.ok(!compiled.includes('importScripts("child2.js");'));

  // JavaScript Unicode escapes can spell executable identifiers without
  // containing the literal ASCII string "importScripts" in the source.
  // The Firefox background must never silently retain those worker-only calls.
  const unicodeEscape = String.fromCharCode(92) + "u0053";
  const escapedIdent = 'import' + unicodeEscape + 'cripts("child.js");\n';
  const escapedBackground = attempt("escaped-ident-unicode", escapedIdent, true);
  assert.ok(escapedBackground.includes("globalThis.Child1 = true;"), "escaped static import not inlined");
  assert.ok(!escapedBackground.includes(escapedIdent.trim()), "escaped worker import leaked into Firefox");
  const escapedNested = 'if (enabled) import' + unicodeEscape + 'cripts("child.js");\n';
  attempt("escaped-ident-nested", escapedNested, false, "NOT_TOP_LEVEL_STATEMENT");
  const escapedAlias = 'const loader = import' + unicodeEscape + 'cripts;\n';
  attempt("escaped-ident-alias", escapedAlias, false, "UNSUPPORTED_REFERENCE");
  const escapedBracket = 'self["import' + unicodeEscape + 'cripts"]("child.js");\n';
  attempt("escaped-ident-bracket", escapedBracket, false, "UNSUPPORTED_REFERENCE");
  // Identifiers used as labels, or break/continue targets, are inert
  // control-flow names even when their spelling decodes to "importScripts".
  const plainLabel = 'importScripts: ;\n';
  assert.equal(attempt("plain-inert-label", plainLabel, true), plainLabel);
  const escapedLabel = 'import' + unicodeEscape + 'cripts: ;\n';
  assert.equal(attempt("escaped-inert-label", escapedLabel, true), escapedLabel);
  const escapedBreak = 'import' + unicodeEscape + 'cripts: { break import' + unicodeEscape + 'cripts; }\n';
  assert.equal(attempt("escaped-inert-break-label", escapedBreak, true), escapedBreak);
  const escapedContinue = 'import' + unicodeEscape + 'cripts: for (let i = 0; i < 1; i++) { continue import' + unicodeEscape + 'cripts; }\n';
  assert.equal(attempt("escaped-inert-continue-label", escapedContinue, true), escapedContinue);

  const escapedInert = 'const label = "import' + unicodeEscape + 'cripts";\n';
  assert.equal(attempt("escaped-ident-inert-string", escapedInert, true), escapedInert);

  const interpolation =
    "const output = " + tick + "${(() => { importScripts(\"child.js\"); return 1; })()}" + tick + ";\n";
  attempt("template-expression", interpolation, false, "NOT_TOP_LEVEL_STATEMENT");
  attempt("unbraced-if", 'if (enabled) importScripts("child.js");\n', false, "NOT_TOP_LEVEL_STATEMENT");
  attempt("braced-if", 'if (enabled) { importScripts("child.js"); }\n', false, "NOT_TOP_LEVEL_STATEMENT");
  attempt("arithmetic", 'const x = 1 / importScripts("child.js");\n', false, "NOT_TOP_LEVEL_STATEMENT");
  attempt("dynamic-arg", 'importScripts(window.file);\n', false, "NON_STATIC_ARGUMENT");
  // Never silently preserve runnable non-bare importScripts references. The
  // Firefox event-page carrier only supports direct top-level static calls.
  attempt("self-property", 'self.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("global-property", 'globalThis.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("self-bracket", 'self["importScripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("global-template-key", 'globalThis[\x60importScripts\x60]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("property-alias", 'const loader = self.importScripts;\n', false, "UNSUPPORTED_REFERENCE");
  attempt("bare-alias", 'const loader = importScripts;\n', false, "UNSUPPORTED_REFERENCE");
  attempt("parenthesized-call", '(importScripts)("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  // Class/object property definition keys are inert, not import calls.
  const inertDefinitionKeys = [
    'class Metadata { importScripts = "label"; static importScripts = "static label"; }',
    'const descriptor = { importScripts: "label" };',
  ].join("\n") + "\n";
  assert.equal(
    attempt("inert-definition-keys", inertDefinitionKeys, true),
    inertDefinitionKeys,
    "non-call class/object definition keys must survive unchanged",
  );
  attempt("missing-static", 'importScripts("missing.js");\n', false, "invalid Firefox background input");

  // TypeScript spans use UTF-16 offsets, whereas the Python composer slices
  // Unicode code points. Two separate imports follow astral characters.
  const nonBmpSource = [
    'const before = "😀🚀";',
    'importScripts("child.js");',
    'const between = "🦊🛍️";',
    'importScripts("child2.js");',
    "globalThis.after = true;",
  ].join("\n") + "\n";
  const nonBmpResult = attempt("non-bmp-offsets", nonBmpSource, true);
  const expectedNonBmp = [
    'const before = "😀🚀";',
    "globalThis.Child1 = true;",
    "",
    'const between = "🦊🛍️";',
    "globalThis.Child2 = true;",
    "",
    "globalThis.after = true;",
  ].join("\n") + "\n";
  assert.equal(
    nonBmpResult, expectedNonBmp,
    "AST import spans must preserve exact Unicode code-point boundaries",
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: "PASS",
  requiredDataCollection: manifest.browser_specific_settings.gecko.data_collection_permissions.required,
  loopbackHostPermissions: loopbackHosts,
}));
