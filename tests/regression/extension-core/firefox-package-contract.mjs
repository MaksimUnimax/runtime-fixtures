import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Bounded, FD-pinned reads: read and digest the SAME bytes, check for
// concurrent metadata/path changes and never load a full archive in memory.
// This local CI guard is not a signed, atomic filesystem snapshot.
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 2048;
const MAX_DEPTH = 16;
function pinnedFile(file, limit, capture = false) {
  const resolved = path.resolve(file);
  assert.equal(fs.realpathSync(resolved), resolved, "FIREFOX_PINNED_PATH_SYMLINK_DENIED");
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  const fd = fs.openSync(resolved, flags);
  try {
    const before = fs.fstatSync(fd, {bigint:true});
    assert.ok(before.isFile() && before.size >= 0n &&
      before.size <= BigInt(limit), "FIREFOX_FILE_SIZE_LIMIT_EXCEEDED");
    const hasher = createHash("sha256"), chunks = [];
    const chunk = Buffer.allocUnsafe(65536);
    let length = 0;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      length += n;
      assert.ok(length <= limit, "FIREFOX_FILE_SIZE_LIMIT_EXCEEDED");
      const slice = chunk.subarray(0, n);
      hasher.update(slice);
      if (capture) chunks.push(Buffer.from(slice));
    }
    const after = fs.fstatSync(fd, {bigint:true});
    const finalPath = fs.statSync(resolved, {bigint:true});
    for (const key of ["dev","ino","size","mtimeNs","ctimeNs"]) {
      assert.equal(before[key], after[key], "FIREFOX_PINNED_FILE_MUTATED");
      assert.equal(before[key], finalPath[key], "FIREFOX_PINNED_FILE_REPLACED");
    }
    assert.equal(BigInt(length), after.size, "FIREFOX_PINNED_SIZE_CHANGED");
    assert.equal(fs.realpathSync(resolved), resolved, "FIREFOX_PINNED_PATH_CHANGED");
    return {bytes:length, sha256:hasher.digest("hex"),
      data:capture?Buffer.concat(chunks,length):null};
  } finally { fs.closeSync(fd); }
}
function pinStable(file, checked) {
  const p=path.resolve(file);
  const current=pinnedFile(p, MAX_MANIFEST_BYTES, false);
  assert.equal(current.sha256, checked.sha256, "FIREFOX_PINNED_SEMANTIC_BYTES_CHANGED");
}
const runtime = process.argv[2];
assert.ok(runtime, "Firefox runtime directory required");
const actualRuntime = path.resolve(runtime);
assert.equal(fs.realpathSync(actualRuntime), actualRuntime,
  "FIREFOX_RUNTIME_SYMLINK_DENIED");
const manifestFile = path.join(actualRuntime,"manifest.json");
const manifestSnapshot = pinnedFile(manifestFile, MAX_MANIFEST_BYTES, true);
const manifest = JSON.parse(manifestSnapshot.data.toString("utf8"));
// A source/runtime path inferred from an unsigned package receipt is NOT
// authority. Known native build layouts are pinned independently. Nonstandard
// invocation must explicitly supply a source runtime and a valid receipt.
const expectedSourceByDerivative = {
  "firefox-development-runtime": path.join("development", "runtime"),
  "firefox-runtime": path.join("chromium", "runtime"),
};
const knownRelative = expectedSourceByDerivative[path.basename(actualRuntime)];
const expectedCommon = knownRelative
  ? path.resolve(path.dirname(actualRuntime), knownRelative) : null;
const commonRuntime = process.argv[3] ? path.resolve(process.argv[3]) : expectedCommon;
assert.ok(commonRuntime, "COMMON_SOURCE_RUNTIME_REQUIRED_FOR_FIREFOX_SCOPE");
assert.equal(fs.realpathSync(commonRuntime), commonRuntime,
  "FIREFOX_COMMON_SOURCE_SYMLINK_DENIED");
if (expectedCommon) assert.equal(commonRuntime, expectedCommon,
  "FIREFOX_COMMON_SOURCE_SCOPE_MISMATCH");
const receiptPath = path.join(path.dirname(actualRuntime), "firefox-composition-receipt.json");
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
// Firefox packaging may normalize only port-specific 127.0.0.1 patterns and
// remove Chromium side-panel metadata. It may not silently gain websites,
// optional APIs, content-script matches, resource exposure or extra UI entry.
const commonManifestFile = path.join(commonRuntime,"manifest.json");
const commonSnapshot = pinnedFile(commonManifestFile, MAX_MANIFEST_BYTES, true);
const commonManifest = JSON.parse(commonSnapshot.data.toString("utf8"));
assert.equal(commonManifest.version, manifest.version,
  "FIREFOX_COMMON_SOURCE_VERSION_MISMATCH");
const normalizeLoopback = pattern =>
  /^http:\/\/127\.0\.0\.1:\d+\/\*$/.test(pattern)
    ? "http://127.0.0.1/*" : pattern;
const expectedHosts = [...new Set(
  (commonManifest.host_permissions || []).map(normalizeLoopback)
)];
assert.deepEqual(manifest.host_permissions || [], expectedHosts,
  "FIREFOX_HOST_PERMISSION_PARITY_FAILED");
assert.deepEqual(manifest.permissions || [],
  (commonManifest.permissions || []).filter(permission => permission !== "sidePanel"),
  "FIREFOX_API_PERMISSION_PARITY_FAILED");
// The Firefox builder leaves both optional permission lists unchanged.
// They must not silently gain browser APIs or website origins.
for (const key of ["optional_permissions", "optional_host_permissions"]) {
  assert.deepEqual(manifest[key] ?? null, commonManifest[key] ?? null,
    "FIREFOX_OPTIONAL_PERMISSION_PARITY_FAILED:" + key);
}
for (const key of ["content_scripts", "web_accessible_resources", "action", "icons"]) {
  assert.deepEqual(manifest[key] ?? null, commonManifest[key] ?? null,
    "FIREFOX_RESOURCE_PERMISSION_PARITY_FAILED:" + key);
}
assert.equal(Object.hasOwn(manifest, "side_panel"), false,
  "FIREFOX_CHROMIUM_SIDE_PANEL_NOT_REMOVED");
const panel = commonManifest.side_panel;
if (panel) {
  assert.deepEqual(manifest.sidebar_action, {
    default_panel: panel.default_path,
    default_title: commonManifest.action.default_title,
    open_at_install: false,
  }, "FIREFOX_SIDEBAR_TRANSLATION_MISMATCH");
} else {
  assert.equal(Object.hasOwn(manifest, "sidebar_action"), false,
    "FIREFOX_UNEXPECTED_SIDEBAR_PERMISSION");
}
assert.ok(fs.statSync(path.join(actualRuntime, "firefox_background.js")).size > 0);
// Verify package provenance AFTER semantic parity, so injected negative
// permission fixtures report their precise missing-authority reason first.
// A valid package can never skip this receipt via one- or two-argument CLI.
assert.ok(fs.existsSync(receiptPath), "FIREFOX_RECEIPT_REQUIRED");
assert.equal(fs.realpathSync(receiptPath), receiptPath,
  "FIREFOX_RECEIPT_SYMLINK_DENIED");
const receiptSnapshot = pinnedFile(receiptPath, MAX_MANIFEST_BYTES, true);
const receipt = JSON.parse(receiptSnapshot.data.toString("utf8"));
assert.equal(receipt.browser, "firefox", "FIREFOX_RECEIPT_BROWSER_MISMATCH");
assert.equal(receipt.version, manifest.version, "FIREFOX_RECEIPT_VERSION_MISMATCH");
assert.ok(typeof receipt.source_runtime === "string" && receipt.source_runtime.length > 0,
  "FIREFOX_RECEIPT_SOURCE_MISSING");
assert.equal(path.resolve(receipt.source_runtime), commonRuntime,
  "FIREFOX_RECEIPT_SOURCE_SCOPE_MISMATCH");
assert.ok(Array.isArray(receipt.files) && receipt.files.length > 0,
  "FIREFOX_RECEIPT_FILES_MISSING");
assert.ok(receipt.files.length <= MAX_FILES, "FIREFOX_RECEIPT_FILE_COUNT_LIMIT");
const packaged = new Map();
let totalBytes = 0;
for (const row of receipt.files) {
  assert.ok(row && typeof row.path === "string" && row.path.length > 0,
    "FIREFOX_RECEIPT_INVALID_FILE_PATH");
  // A relative POSIX filename only. Never trust a sidecar row to escape the
  // package directory, use backslashes or traverse into a symlink.
  const relative = row.path;
  assert.ok(relative === path.posix.normalize(relative) &&
    !path.posix.isAbsolute(relative) &&
    !relative.split("/").includes("..") && !relative.includes("\\"),
    "FIREFOX_RECEIPT_INVALID_FILE_PATH");
  assert.ok(!packaged.has(relative), "FIREFOX_RECEIPT_DUPLICATE_FILE_PATH");
  const file = path.join(actualRuntime, relative);
  assert.ok(fs.existsSync(file) && fs.lstatSync(file).isFile() &&
    fs.realpathSync(file) === path.resolve(file),
    "FIREFOX_RECEIPT_FILE_INVALID");
  const actual = relative === "manifest.json"
    ? manifestSnapshot : pinnedFile(file, MAX_FILE_BYTES, false);
  assert.ok(actual.bytes <= MAX_FILE_BYTES, "FIREFOX_FILE_SIZE_LIMIT_EXCEEDED");
  totalBytes += actual.bytes;
  assert.ok(totalBytes <= MAX_TOTAL_BYTES, "FIREFOX_PACKAGE_TOTAL_SIZE_LIMIT");
  assert.equal(row.bytes, actual.bytes, "FIREFOX_RECEIPT_PACKAGE_BINDING_MISMATCH");
  assert.equal(row.sha256, actual.sha256, "FIREFOX_RECEIPT_PACKAGE_BINDING_MISMATCH");
  packaged.set(relative, row);
}
function allFiles(directory, prefix = "", depth = 0, result = []) {
  assert.ok(depth <= MAX_DEPTH, "FIREFOX_PACKAGE_DEPTH_LIMIT");
  for (const dirent of fs.readdirSync(directory, {withFileTypes:true})) {
    assert.ok(!dirent.isSymbolicLink(), "FIREFOX_PACKAGE_SYMLINK_DENIED");
    const relative = prefix ? prefix + "/" + dirent.name : dirent.name;
    if (dirent.isDirectory()) allFiles(path.join(directory,dirent.name),relative,depth+1,result);
    else {
      assert.ok(dirent.isFile(), "FIREFOX_PACKAGE_FILE_TYPE_INVALID");
      result.push(relative);
      assert.ok(result.length <= MAX_FILES, "FIREFOX_PACKAGE_FILE_COUNT_LIMIT");
    }
  }
  return result;
}
assert.deepEqual([...packaged.keys()].sort(), allFiles(actualRuntime).sort(),
  "FIREFOX_RECEIPT_FILE_SET_MISMATCH");
assert.ok(packaged.has("manifest.json") && packaged.has("firefox_background.js"),
  "FIREFOX_RECEIPT_PACKAGE_BINDING_MISMATCH");
// The builder's ZIP is adjacent to its derivative. This is a self-consistency
// check of local build outputs, NOT a cryptographic signature of the receipt.
const archiveName = storePackage
  ? `OCTOPORT_v${manifest.version}_FIREFOX_STORE.zip`
  : `SELLER_AGENTS_I1_C1_v${manifest.version}_FIREFOX_LOCAL_DEVELOPMENT.zip`;
assert.equal(receipt.package?.name, archiveName, "FIREFOX_ARCHIVE_NAME_MISMATCH");
const archivePath = path.join(path.dirname(actualRuntime), archiveName);
assert.ok(fs.existsSync(archivePath) &&
  fs.realpathSync(archivePath) === path.resolve(archivePath) &&
  fs.lstatSync(archivePath).isFile(), "FIREFOX_ARCHIVE_MISSING_OR_SYMLINK");
const archive = pinnedFile(archivePath, MAX_ARCHIVE_BYTES, false);
assert.equal(receipt.package.bytes, archive.bytes, "FIREFOX_ARCHIVE_BINDING_MISMATCH");
assert.equal(receipt.package.sha256, archive.sha256, "FIREFOX_ARCHIVE_BINDING_MISMATCH");
// Detect ordinary races that replace or edit the manifest/receipt during the
// remaining validation. Cross-file adversarial atomicity is NOT claimed.
pinStable(manifestFile, manifestSnapshot);
pinStable(commonManifestFile, commonSnapshot);
pinStable(receiptPath, receiptSnapshot);
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
  attempt("global-concat-key", 'globalThis["import" + "Scripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("self-interpolated-key", 'self[`import${"Scripts"}`]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("parenthesized-computed-key", 'globalThis[(("im" + "port") + "Scripts")]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("multi-span-computed-key", 'self[`im${"port"}${"Scripts"}`]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("computed-key-depth-bound", 'globalThis[' + "(".repeat(66) + '"importScripts"' + ")".repeat(66) + ']("child.js");\n', false, "COMPUTED_REFERENCE_TOO_COMPLEX");
  const unrelatedComputedNames = [
    'globalThis["visible" + "Flag"] = true;',
    'self[`prefix${"Label"}`];',
    'const runtimeKey = "productFixture"; globalThis[runtimeKey] = true;',
    "const inertComputedText = 'globalThis[\"import\" + \"Scripts\"](\"child.js\");';",
  ].join("\n") + "\n";
  assert.equal(
    attempt("unrelated-computed-names", unrelatedComputedNames, true),
    unrelatedComputedNames,
    "non-import computed keys and inert strings must remain byte-identical",
  );
  // Lexically resolved constant keys must not hide the worker-only API.
  // Unknown explicit worker-global reads fail closed; unrelated objects and
  // pure dynamic writes keep their original behavior.
  attempt("binding-const-key", "const key = \"importScripts\"; self[key](\"child.js\");\n", false, "UNSUPPORTED_REFERENCE");
  attempt("binding-const-alias-key", "const first = \"import\"; const key = first + \"Scripts\"; globalThis[key](\"child.js\");\n", false, "UNSUPPORTED_REFERENCE");
  attempt("binding-inner-constant-key", "const key = \"safe\"; { const key = \"importScripts\"; self[key](\"child.js\"); }\n", false, "UNSUPPORTED_REFERENCE");
  attempt("binding-inner-parameter-key", "const key = \"safe\"; function invoke(key) { self[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-mutable-key", "let key = \"safe\"; key = \"importScripts\"; globalThis[key](\"child.js\");\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-dynamic-global-read", "function invoke(key) { const loader = self[key]; loader(\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-dynamic-global-parenthesized", "function invoke(key) { ((globalThis))[key]?.(\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-global-receiver-alias", "const scope = self; function invoke(key) { scope[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-global-receiver-self", "function invoke(key) { globalThis.self[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("binding-global-call-indirect", "function invoke(key) { self[key].call(null, \"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  {
    const source = "const key = \"setTimeout\"; self[key](() => {}, 1);\n";
    assert.equal(attempt("binding-safe-const-method", source, true), source);
  }
  {
    const source = "const key = \"importScripts\"; { const key = \"safe\"; self[key](); }\n";
    assert.equal(attempt("binding-safe-inner-shadow", source, true), source);
  }
  {
    const source = "function invoke(object, key) { return object[key](); }\n";
    assert.equal(attempt("binding-ordinary-object-dynamic", source, true), source);
  }
  {
    const source = "function inspect(self, key) { return self[key]; }\n";
    assert.equal(attempt("binding-shadowed-global-object", source, true), source);
  }
  {
    const source = "function put(key, value) { globalThis[key] = value; }\n";
    assert.equal(attempt("binding-dynamic-global-write", source, true), source);
  }
  {
    const source = "const RUNTIME_KEY = \"octoportRuntime\"; const prior = globalThis[RUNTIME_KEY]; globalThis[RUNTIME_KEY] = prior;\n";
    assert.equal(attempt("binding-safe-const-runtime", source, true), source);
  }
  // Independent R24 review: destructured worker-global aliases must be
  // recognized without confusing ordinary objects or lexical shadowing.
  attempt("destructured-global-self", 'const { self: scope } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("destructured-global-computed", 'const key = "self"; const { [key]: scope } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("destructured-global-nested", 'const { globalThis: { self: scope } } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("destructured-known-import", 'const { ["import" + "Scripts"]: loader } = self; loader("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("destructured-dynamic-import", 'const { [runtimeKey]: loader } = self; loader("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("destructured-global-rest", 'const { ...scope } = globalThis; scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("ordinary-global-prototype", 'const object = { __proto__: self }; object["importScripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  for (const [label, source] of [
    ["ordinary-computed-import-method", 'const object = { ["importScripts"]() { return 1; } }; object["importScripts"]();\n'],
    ["ordinary-dot-import-method", 'const object = { importScripts() { return 1; } }; object.importScripts();\n'],
    ["ordinary-aliased-import-method", 'const object = { importScripts() { return 1; } }; const alias = object; alias.importScripts();\n'],
    ["ordinary-shadowed-global-method", 'const self = { importScripts() { return 1; } }; self["importScripts"]();\n'],
    ["ordinary-destructured-object", 'const object = { self: {} }; const { self: scope } = object; function inspect(key) { return scope[key]; }\n'],
    ["ordinary-destructured-import-key", 'const object = { importScripts() { return 1; } }; const { importScripts: local } = object; local();\n'],
    ["destructured-global-safe-name", 'const { setTimeout: later } = globalThis; later(() => {}, 1);\n'],
    ["destructured-shadowed-global", 'function inspect(globalThis, key) { const { self: scope } = globalThis; return scope[key]; }\n'],
  ]) {
    assert.equal(attempt(label, source, true), source, label + " must remain byte-identical");
  }
  const emptyImportSource = 'importScripts();\n"use strict";\nglobalThis.marker = true;\n';
  assert.equal(
    attempt("empty-static-noop-statement", emptyImportSource, true),
    ';\n"use strict";\nglobalThis.marker = true;\n',
    "empty import must remain a statement barrier, not create a directive prologue",
  );
  // R25 independent review: assignment-form aliases and inherited methods
  // must not evade the declaration checks or the ordinary-object exception.
  attempt("assigned-destructured-global", 'let scope; ({ self: scope } = globalThis); function invoke(key) { scope[key]("child.js"); } invoke("importScripts");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("assigned-mutable-global", 'let scope; scope = self; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("initialized-mutable-global", 'let scope = self; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("assigned-nested-global", 'let scope; ({ self: { globalThis: scope } } = globalThis); scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("assigned-logical-global", 'let scope; scope ||= self; scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  attempt("ordinary-inherited-global-method", 'const object = {}; Object.setPrototypeOf(object, self); object.importScripts.call(self, "child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("ordinary-deleted-own-method", 'const object = { importScripts() { return 1; } }; delete object.importScripts; Object.setPrototypeOf(object, self); object.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  attempt("ordinary-destructured-inherited-method", 'const object = {}; Object.setPrototypeOf(object, self); const { importScripts: loader } = object; loader.call(self, "child.js");\n', false, "UNSUPPORTED_REFERENCE");
  for (const [label, source] of [
    ["assigned-ordinary-object", 'let scope; const object = { self: {} }; ({ self: scope } = object); function read(key) { return scope[key]; }\n'],
    ["assigned-shadowed-global", 'function inspect(globalThis, key) { let scope; ({ self: scope } = globalThis); return scope[key]; }\n'],
    ["ordinary-own-method-unrelated-mutation", 'const object = { count: 1, importScripts() { return this.count; } }; object.count++; object.importScripts();\n'],
    ["assigned-ordinary-own-method", 'const object = { importScripts() { return 1; } }; let loader; ({ importScripts: loader } = object); loader();\n'],
  ]) assert.equal(attempt(label, source, true), source, label + " must remain byte-identical");
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
