import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

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
const staticResults = [];
const pendingBuilders = [];
let activeBuilders = 0;
const builderWaiters = [];
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
  async function attempt(label, source, shouldSucceed, requiredError, files = {}) {
    assert.doesNotThrow(() => new vm.Script(source, {filename: label}),
      "fixture is not valid JavaScript: " + label);
    const caseInput = path.join(fixtureRoot, label + "-runtime");
    fs.cpSync(input, caseInput, {recursive: true});
    fs.writeFileSync(path.join(caseInput, "service_worker_entry.js"), source);
    for (const [name, text] of Object.entries(files)) {
      assert.doesNotThrow(() => new vm.Script(text, {filename: name}));
      fs.writeFileSync(path.join(caseInput, name), text);
    }
    // Each CLI owns its archive parent as well as its runtime directory.
    const out = path.join(fixtureRoot, label + "-output", "runtime");
    const args = [builder, "--input-runtime", caseInput, "--output", out];
    // All CLI cases share three permits inside the same finite test cgroup. Positives retain their byte assertions;
    // negatives retain actual CLI/error assertions and cannot pass on timeout.
    const job = (async () => {
      if (activeBuilders < 3) activeBuilders++;
      else await new Promise(resolve => builderWaiters.push(resolve));
      try {
        const result = await new Promise((resolve, reject) => {
          const child = spawn("python3", args, {timeout: 25000, killSignal: "SIGKILL"});
          let stderr = "";
          child.stdout.resume();
          child.stderr.setEncoding("utf8");
          child.stderr.on("data", text => { stderr += text; });
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({code, signal, stderr}));
        });
        assert.equal(result.signal, null, label + ": builder did not finish");
        assert.ok(Number.isInteger(result.code), label + ": builder did not return an exit code");
        if (shouldSucceed) assert.equal(result.code, 0, label + ": " + result.stderr);
        else {
          assert.notEqual(result.code, 0, label + " must fail closed");
          if (requiredError) assert.ok(result.stderr.includes(requiredError), label + ": " + result.stderr);
        }
        staticResults.push({label, backend: "builder", negative: !shouldSucceed});
        return shouldSucceed ? fs.readFileSync(path.join(out, "firefox_background.js"), "utf8") : null;
      } finally {
        const next = builderWaiters.shift();
        if (next) next(); // Transfer the existing permit, without a race.
        else activeBuilders--;
      }
    })();
    // Observe every rejection immediately, including jobs whose caller queues
    // a negative rather than awaiting its completion.
    pendingBuilders.push(job.then(() => null, error => error));
    return shouldSucceed ? job : null;
  }
  async function finishNegativeBuilders() {
    const errors = (await Promise.all(pendingBuilders)).filter(Boolean);
    if (errors.length) throw new AggregateError(errors, "Firefox builder failures");
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
  const compiled = await attempt("valid-static", real, true);
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
  const escapedBackground = await attempt("escaped-ident-unicode", escapedIdent, true);
  assert.ok(escapedBackground.includes("globalThis.Child1 = true;"), "escaped static import not inlined");
  assert.ok(!escapedBackground.includes(escapedIdent.trim()), "escaped worker import leaked into Firefox");
  const escapedNested = 'if (enabled) import' + unicodeEscape + 'cripts("child.js");\n';
  await attempt("escaped-ident-nested", escapedNested, false, "NOT_TOP_LEVEL_STATEMENT");
  const escapedAlias = 'const loader = import' + unicodeEscape + 'cripts;\n';
  await attempt("escaped-ident-alias", escapedAlias, false, "UNSUPPORTED_REFERENCE");
  const escapedBracket = 'self["import' + unicodeEscape + 'cripts"]("child.js");\n';
  await attempt("escaped-ident-bracket", escapedBracket, false, "UNSUPPORTED_REFERENCE");
  // Identifiers used as labels, or break/continue targets, are inert
  // control-flow names even when their spelling decodes to "importScripts".
  const plainLabel = 'importScripts: ;\n';
  assert.equal(await attempt("plain-inert-label", plainLabel, true), plainLabel);
  const escapedLabel = 'import' + unicodeEscape + 'cripts: ;\n';
  assert.equal(await attempt("escaped-inert-label", escapedLabel, true), escapedLabel);
  const escapedBreak = 'import' + unicodeEscape + 'cripts: { break import' + unicodeEscape + 'cripts; }\n';
  assert.equal(await attempt("escaped-inert-break-label", escapedBreak, true), escapedBreak);
  const escapedContinue = 'import' + unicodeEscape + 'cripts: for (let i = 0; i < 1; i++) { continue import' + unicodeEscape + 'cripts; }\n';
  assert.equal(await attempt("escaped-inert-continue-label", escapedContinue, true), escapedContinue);

  const escapedInert = 'const label = "import' + unicodeEscape + 'cripts";\n';
  assert.equal(await attempt("escaped-ident-inert-string", escapedInert, true), escapedInert);

  const interpolation =
    "const output = " + tick + "${(() => { importScripts(\"child.js\"); return 1; })()}" + tick + ";\n";
  await attempt("template-expression", interpolation, false, "NOT_TOP_LEVEL_STATEMENT");
  await attempt("unbraced-if", 'if (enabled) importScripts("child.js");\n', false, "NOT_TOP_LEVEL_STATEMENT");
  await attempt("braced-if", 'if (enabled) { importScripts("child.js"); }\n', false, "NOT_TOP_LEVEL_STATEMENT");
  await attempt("arithmetic", 'const x = 1 / importScripts("child.js");\n', false, "NOT_TOP_LEVEL_STATEMENT");
  await attempt("dynamic-arg", 'importScripts(window.file);\n', false, "NON_STATIC_ARGUMENT");
  // Never silently preserve runnable non-bare importScripts references. The
  // Firefox event-page carrier only supports direct top-level static calls.
  await attempt("self-property", 'self.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("global-property", 'globalThis.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("self-bracket", 'self["importScripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("global-template-key", 'globalThis[\x60importScripts\x60]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("global-concat-key", 'globalThis["import" + "Scripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("self-interpolated-key", 'self[`import${"Scripts"}`]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("parenthesized-computed-key", 'globalThis[(("im" + "port") + "Scripts")]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("multi-span-computed-key", 'self[`im${"port"}${"Scripts"}`]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("computed-key-depth-bound", 'globalThis[' + "(".repeat(66) + '"importScripts"' + ")".repeat(66) + ']("child.js");\n', false, "COMPUTED_REFERENCE_TOO_COMPLEX");
  const unrelatedComputedNames = [
    'globalThis["visible" + "Flag"] = true;',
    'self[`prefix${"Label"}`];',
    'const runtimeKey = "productFixture"; globalThis[runtimeKey] = true;',
    "const inertComputedText = 'globalThis[\"import\" + \"Scripts\"](\"child.js\");';",
  ].join("\n") + "\n";
  assert.equal(
    await attempt("unrelated-computed-names", unrelatedComputedNames, true),
    unrelatedComputedNames,
    "non-import computed keys and inert strings must remain byte-identical",
  );
  // Lexically resolved constant keys must not hide the worker-only API.
  // Unknown explicit worker-global reads fail closed; unrelated objects and
  // pure dynamic writes keep their original behavior.
  await attempt("binding-const-key", "const key = \"importScripts\"; self[key](\"child.js\");\n", false, "UNSUPPORTED_REFERENCE");
  await attempt("binding-const-alias-key", "const first = \"import\"; const key = first + \"Scripts\"; globalThis[key](\"child.js\");\n", false, "UNSUPPORTED_REFERENCE");
  await attempt("binding-inner-constant-key", "const key = \"safe\"; { const key = \"importScripts\"; self[key](\"child.js\"); }\n", false, "UNSUPPORTED_REFERENCE");
  await attempt("binding-inner-parameter-key", "const key = \"safe\"; function invoke(key) { self[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-mutable-key", "let key = \"safe\"; key = \"importScripts\"; globalThis[key](\"child.js\");\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-dynamic-global-read", "function invoke(key) { const loader = self[key]; loader(\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-dynamic-global-parenthesized", "function invoke(key) { ((globalThis))[key]?.(\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-global-receiver-alias", "const scope = self; function invoke(key) { scope[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-global-receiver-self", "function invoke(key) { globalThis.self[key](\"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-global-receiver-top-level-this-alias", 'const scope = this; function invoke(key) { scope[key]("child.js"); } invoke("importScripts");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-global-receiver-top-level-this-direct", 'this[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("binding-global-receiver-top-level-this-arrow", 'const invoke = (key) => this[key]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  // Keep all seven original counterexamples on the actual builder/CLI path.
  // Nearby binding controls call the identical parser in-process, avoiding
  // repeated interpreter startup within the existing 45-second package gate.
  const locateReferences = createRequire(import.meta.url)(
    path.join(repoRoot, "tooling/build/extension_importscripts_ast.cjs"),
  ).locate;
  const builderReferenceCases = new Set([
    "binding-function-this-unknown", "binding-function-this-call",
    "binding-function-this-sloppy", "reflect-get-self", "reflect-get-const-key",
    "reflect-get-global-alias", "reflect-own-descriptor", "reflect-get-function-key",
    "binding-confined-local-method", "reflect-get-safe-global",
  ]);
  async function attemptReference(label, source, shouldSucceed, requiredError) {
    if (builderReferenceCases.has(label)) return await attempt(label, source, shouldSucceed, requiredError);
    assert.doesNotThrow(() => new vm.Script(source, {filename: label}),
      "fixture is not valid JavaScript: " + label);
    staticResults.push({label, backend: "locate", negative: !shouldSucceed});
    if (shouldSucceed) {
      assert.deepEqual(locateReferences(source), [], label + " must have no static imports");
      return source;
    }
    assert.throws(() => locateReferences(source),
      error => error.message.includes(requiredError), label + " must fail closed");
    return null;
  }
  // A function's own this can still be the worker global: sloppy calls
  // supply it implicitly and call/apply/bind can supply it even in strict code.
  // The prior uncalled-function positive assumed safety without a receiver.
  for (const [label, source] of [
    ["binding-function-this-unknown", 'function invoke(key) { return this[key]("child.js"); }\n'],
    ["binding-function-this-call", 'function invoke(key){ return this[key]("child.js"); } invoke.call(self,"importScripts");\n'],
    ["binding-function-this-sloppy", 'function invoke(key){ return this[key]("child.js"); } invoke("importScripts");\n'],
    ["binding-function-this-strict-apply", '"use strict"; function invoke(key){ return this[key]("child.js"); } invoke.apply(globalThis,["importScripts"]);\n'],
    ["binding-function-this-bound-arrow", 'function invoke(key){ return (() => this[key]("child.js"))(); } invoke.bind(self)("importScripts");\n'],
    ["binding-local-method-extracted", 'const target = { inspect(key) { return this[key]("child.js"); } }; const invoke = target.inspect; invoke.call(self,"importScripts");\n'],
    ["binding-local-method-rebound", 'const target = { inspect(key) { return this[key]("child.js"); } }; target.inspect.call(self,"importScripts");\n'],
    ["binding-local-method-escaped", 'const target = { inspect(key) { return this[key]("child.js"); } }; opaque(target); target.inspect("importScripts");\n'],
    ["binding-local-method-indirect-extraction", 'const target = { inspect(key) { return this[key]; } }; target.inspect("inspect").call(self,"importScripts");\n'],
    ["binding-local-method-prototype", 'const target = { inspect(key) { return this[key]("child.js"); } }; Object.setPrototypeOf(target,self); target.inspect("importScripts");\n'],
  ]) await attemptReference(label, source, false, "UNRESOLVED_GLOBAL_REFERENCE");
  for (const [label, source] of [
    ["binding-confined-local-method", 'const target = { inspect(key){return this[key]} }; target.inspect("safe");\n'],
    ["binding-confined-aliased-method", 'const target = { inspect(key){return this[key]} }; const alias = target; alias.inspect("safe");\n'],
    ["binding-confined-function-method", 'const target = { inspect: function(key){return this[key]} }; target.inspect("safe");\n'],
  ]) assert.equal(await attemptReference(label, source, true), source, label + " must remain byte-identical");

  // Normalize both reflective property acquisition APIs at the same global
  // receiver/key boundary, including immutable aliases and invocation helpers.
  for (const [label, source] of [
    ["reflect-get-self", 'Reflect.get(self,"importScripts").call(self,"child.js");\n'],
    ["reflect-get-const-key", 'const key="importScripts"; Reflect.get(globalThis,key).call(globalThis,"child.js");\n'],
    ["reflect-get-global-alias", 'const scope=self; Reflect.get(scope,"importScripts").call(scope,"child.js");\n'],
    ["reflect-own-descriptor", 'Object.getOwnPropertyDescriptor(globalThis,"importScripts").value.call(globalThis,"child.js");\n'],
    ["reflect-get-inherited-global", 'const target = {__proto__: self}; Reflect.get(target,"importScripts").call(self,"child.js");\n'],
    ["reflect-get-destructured-owner", 'const {Reflect: reader} = self; reader.get(self,"importScripts");\n'],
    ["reflect-get-reflective-function", 'Reflect.get(Reflect,"get")(self,"importScripts");\n'],
    ["reflect-get-reflective-owner", 'Reflect.get(self,"Reflect").get(self,"importScripts");\n'],
    ["reflect-descriptor-reflective-owner", 'Object.getOwnPropertyDescriptor(self,"Reflect").value.get(self,"importScripts");\n'],
    ["reflect-descriptor-function-value", 'Object.getOwnPropertyDescriptor(Reflect,"get").value(self,"importScripts");\n'],
    ["reflect-descriptor-function-value-alias", 'const read=Object.getOwnPropertyDescriptor(Reflect,"get").value; read(self,"importScripts");\n'],
    ["reflect-get-function-alias", 'const read = Reflect.get; read(self,"importScripts");\n'],
    ["reflect-get-destructured", 'const {get: read} = Reflect; read(self,"importScripts");\n'],
    ["reflect-descriptor-aliased-owner", 'const owner = Object; const read = owner.getOwnPropertyDescriptor; read(self,"importScripts");\n'],
    ["reflect-get-call", 'Reflect.get.call(Reflect,self,"importScripts");\n'],
    ["reflect-get-apply", 'Reflect.get.apply(Reflect,[self,"importScripts"]);\n'],
    ["reflect-get-bound", 'const read = Reflect.get.bind(Reflect,self); read("importScripts");\n'],
    ["reflect-descriptor-bound", 'Object.getOwnPropertyDescriptor.bind(Object,globalThis)("importScripts");\n'],
  ]) await attemptReference(label, source, false, "UNSUPPORTED_REFERENCE");
  for (const [label, source] of [
    ["reflect-get-function-key", 'function invoke(key){ return Reflect.get(self,key).call(self,"child.js"); } invoke("importScripts");\n'],
    ["reflect-descriptor-dynamic-key", 'function invoke(key){ return Object.getOwnPropertyDescriptor(self,key); }\n'],
    ["reflect-get-function-this", 'function invoke(key){ return Reflect.get(this,key); } invoke.call(self,"importScripts");\n'],
    ["reflect-get-global-return-alias", 'const scope = Reflect.get(self,"globalThis"); scope[runtimeKey]("child.js");\n'],
    ["reflect-descriptor-global-return-alias", 'const scope = Object.getOwnPropertyDescriptor(self,"self").value; scope[runtimeKey]("child.js");\n'],
  ]) await attemptReference(label, source, false, "UNRESOLVED_GLOBAL_REFERENCE");
  for (const [label, source] of [
    ["reflect-get-shorthand-escape", 'const read = Reflect.get; const object = {read}; object.read(self,"importScripts");\n'],
    ["reflect-get-mutable-destructured", 'let {get: read} = Reflect; read(self,runtimeKey);\n'],
    ["reflect-get-unknown-destructured", 'const {[runtimeKey]: read} = Reflect; read(self,"importScripts");\n'],
    ["reflect-get-opaque-escape", 'opaque(Reflect.get);\n'],
    ["reflect-get-mutable-alias", 'let read = Reflect.get; read(self,runtimeKey);\n'],
    ["reflect-get-unknown-intrinsic-lookup", 'Reflect.get(Reflect,runtimeKey)(self,"importScripts");\n'],
    ["reflect-get-opaque-apply", 'Reflect.get.apply(Reflect,args);\n'],
    ["reflect-get-dynamic-intrinsic", 'Reflect[runtimeKey](self,"importScripts");\n'],
  ]) await attemptReference(label, source, false, "UNRESOLVED_REFLECTIVE_REFERENCE");
  for (const [label, source] of [
    ["reflect-get-safe-global", 'Reflect.get(self,"setTimeout");\n'],
    ["reflect-get-safe-const-alias", 'const read = Reflect.get; const key = "setTimeout"; read(globalThis,key);\n'],
    ["reflect-get-safe-destructured-alias", 'const {get: read} = Reflect; read(self,"setTimeout");\n'],
    ["reflect-descriptor-safe-global", 'Object.getOwnPropertyDescriptor(globalThis,"setTimeout");\n'],
    ["reflect-get-shadowed-intrinsic", 'function inspect(Reflect,key){ return Reflect.get({},"importScripts"); }\n'],
    ["reflect-descriptor-shadowed-intrinsic", 'function inspect(Object,key){ return Object.getOwnPropertyDescriptor({},"importScripts"); }\n'],
    ["reflect-get-confined-local-this", 'const target = { inspect(key){return Reflect.get(this,key)} }; target.inspect("safe");\n'],
    ["reflect-get-local-own-import-method", 'const target = {importScripts(){return 1}}; Reflect.get(target,"importScripts")();\n'],
    ["reflect-descriptor-function-safe-value", 'Object.getOwnPropertyDescriptor(Reflect,"get").value(self,"setTimeout");\n'],
    ["reflect-get-ordinary-object", 'const target = {safe: 1}; Reflect.get(target,"safe");\n'],
  ]) assert.equal(await attemptReference(label, source, true), source, label + " must remain byte-identical");
  await attempt("binding-global-call-indirect", "function invoke(key) { self[key].call(null, \"child.js\"); }\n", false, "UNRESOLVED_GLOBAL_REFERENCE");
  {
    const source = "const key = \"setTimeout\"; self[key](() => {}, 1);\n";
    assert.equal(await attempt("binding-safe-const-method", source, true), source);
  }
  {
    const source = "const key = \"importScripts\"; { const key = \"safe\"; self[key](); }\n";
    assert.equal(await attempt("binding-safe-inner-shadow", source, true), source);
  }
  {
    const source = "function invoke(object, key) { return object[key](); }\n";
    assert.equal(await attempt("binding-ordinary-object-dynamic", source, true), source);
  }
  {
    const source = "function inspect(self, key) { return self[key]; }\n";
    assert.equal(await attempt("binding-shadowed-global-object", source, true), source);
  }
  {
    const source = "function put(key, value) { globalThis[key] = value; }\n";
    assert.equal(await attempt("binding-dynamic-global-write", source, true), source);
  }
  {
    const source = "const RUNTIME_KEY = \"octoportRuntime\"; const prior = globalThis[RUNTIME_KEY]; globalThis[RUNTIME_KEY] = prior;\n";
    assert.equal(await attempt("binding-safe-const-runtime", source, true), source);
  }
  // Independent R24 review: destructured worker-global aliases must be
  // recognized without confusing ordinary objects or lexical shadowing.
  await attempt("destructured-global-self", 'const { self: scope } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("destructured-global-computed", 'const key = "self"; const { [key]: scope } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("destructured-global-nested", 'const { globalThis: { self: scope } } = globalThis; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("destructured-known-import", 'const { ["import" + "Scripts"]: loader } = self; loader("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("destructured-dynamic-import", 'const { [runtimeKey]: loader } = self; loader("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("destructured-global-rest", 'const { ...scope } = globalThis; scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("ordinary-global-prototype", 'const object = { __proto__: self }; object["importScripts"]("child.js");\n', false, "UNSUPPORTED_REFERENCE");
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
    assert.equal(await attempt(label, source, true), source, label + " must remain byte-identical");
  }
  const emptyImportSource = 'importScripts();\n"use strict";\nglobalThis.marker = true;\n';
  assert.equal(
    await attempt("empty-static-noop-statement", emptyImportSource, true),
    ';\n"use strict";\nglobalThis.marker = true;\n',
    "empty import must remain a statement barrier, not create a directive prologue",
  );
  // R25 independent review: assignment-form aliases and inherited methods
  // must not evade the declaration checks or the ordinary-object exception.
  await attempt("assigned-destructured-global", 'let scope; ({ self: scope } = globalThis); function invoke(key) { scope[key]("child.js"); } invoke("importScripts");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("assigned-mutable-global", 'let scope; scope = self; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("initialized-mutable-global", 'let scope = self; function invoke(key) { scope[key]("child.js"); }\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("assigned-nested-global", 'let scope; ({ self: { globalThis: scope } } = globalThis); scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("assigned-logical-global", 'let scope; scope ||= self; scope[runtimeKey]("child.js");\n', false, "UNRESOLVED_GLOBAL_REFERENCE");
  await attempt("ordinary-inherited-global-method", 'const object = {}; Object.setPrototypeOf(object, self); object.importScripts.call(self, "child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("ordinary-deleted-own-method", 'const object = { importScripts() { return 1; } }; delete object.importScripts; Object.setPrototypeOf(object, self); object.importScripts("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("ordinary-destructured-inherited-method", 'const object = {}; Object.setPrototypeOf(object, self); const { importScripts: loader } = object; loader.call(self, "child.js");\n', false, "UNSUPPORTED_REFERENCE");
  for (const [label, source] of [
    ["assigned-ordinary-object", 'let scope; const object = { self: {} }; ({ self: scope } = object); function read(key) { return scope[key]; }\n'],
    ["assigned-shadowed-global", 'function inspect(globalThis, key) { let scope; ({ self: scope } = globalThis); return scope[key]; }\n'],
    ["ordinary-own-method-unrelated-mutation", 'const object = { count: 1, importScripts() { return this.count; } }; object.count++; object.importScripts();\n'],
    ["assigned-ordinary-own-method", 'const object = { importScripts() { return 1; } }; let loader; ({ importScripts: loader } = object); loader();\n'],
  ]) assert.equal(await attempt(label, source, true), source, label + " must remain byte-identical");
  await attempt("property-alias", 'const loader = self.importScripts;\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("bare-alias", 'const loader = importScripts;\n', false, "UNSUPPORTED_REFERENCE");
  await attempt("parenthesized-call", '(importScripts)("child.js");\n', false, "UNSUPPORTED_REFERENCE");
  // Class/object property definition keys are inert, not import calls.
  const inertDefinitionKeys = [
    'class Metadata { importScripts = "label"; static importScripts = "static label"; }',
    'const descriptor = { importScripts: "label" };',
  ].join("\n") + "\n";
  assert.equal(
    await attempt("inert-definition-keys", inertDefinitionKeys, true),
    inertDefinitionKeys,
    "non-call class/object definition keys must survive unchanged",
  );
  await attempt("missing-static", 'importScripts("missing.js");\n', false, "invalid Firefox background input");

  // TypeScript spans use UTF-16 offsets, whereas the Python composer slices
  // Unicode code points. Two separate imports follow astral characters.
  const nonBmpSource = [
    'const before = "😀🚀";',
    'importScripts("child.js");',
    'const between = "🦊🛍️";',
    'importScripts("child2.js");',
    "globalThis.after = true;",
  ].join("\n") + "\n";
  const nonBmpResult = await attempt("non-bmp-offsets", nonBmpSource, true);
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
  // Full independent source-review class: capability boundaries and real
  // cross-file binding context, with paired ordinary/shadowed controls.
  const reworkCases = [
  {
    "id": "confined_internal_call",
    "finding": "A05-CONFINED-RECEIVER-1",
    "entry": "const box={read(key){return this[key];},leak(){return this.read(\"read\");}}; box.leak().call(self,\"importScripts\").call(self,\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "confined_dynamic_dispatch",
    "finding": "A05-CONFINED-RECEIVER-1",
    "entry": "const box={read(key){return this[key];},leak(name){return this[name](\"read\");}}; box.leak(\"read\").call(self,\"importScripts\").call(self,\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assigned_reflect_get",
    "finding": "A05-ASSIGNMENT-REFLECTION-2",
    "entry": "let read; ({get:read}=Reflect); read(self,\"importScripts\").call(self,\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assigned_descriptor",
    "finding": "A05-ASSIGNMENT-REFLECTION-2",
    "entry": "let descriptor; ({getOwnPropertyDescriptor:descriptor}=Object); descriptor(self,\"importScripts\").value.call(self,\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "global_call_argument",
    "finding": "A05-CALL-ARGUMENT-3",
    "entry": "function loadFrom(scope,key){return scope[key](\"child.js\");} loadFrom(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "intrinsic_call_argument",
    "finding": "A05-CALL-ARGUMENT-3",
    "entry": "function readVia(R,k){return R.get(self,k);} readVia(Reflect,\"importScripts\").call(self,\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph_reflective_alias",
    "finding": "A05-CROSS-FILE-4",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const read=Reflect.get;",
      "consumer.js": "read(self,\"importScripts\").call(self,\"child.js\");"
    },
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph_global_alias_dynamic",
    "finding": "A05-CROSS-FILE-4",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self;",
      "consumer.js": "function invoke(key){scope[key](\"child.js\");} invoke(\"importScripts\");"
    },
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph_global_alias_literal_review_variant",
    "finding": "A05-CROSS-FILE-4",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self;",
      "consumer.js": "const key=\"importScripts\"; scope[key](\"child.js\");"
    },
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "positive_internal_local_method",
    "entry": "const box={read(key){return this[key];},inspect(){return this.read(\"safe\");}}; box.inspect();",
    "negative": false
  },
  {
    "id": "positive_shadowed_intrinsic",
    "entry": "const Reflect={get(scope,key){return \"local\";}}; Reflect.get(self,\"importScripts\");",
    "negative": false
  },
  {
    "id": "positive_graph_reflection_alias",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const read=Reflect.get;",
      "consumer.js": "read(self,\"setTimeout\");"
    },
    "negative": false
  },
  {
    "id": "confined-empty-call-set",
    "entry": "const box={read(key){return this[key];}};",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "confined-parameter-chain",
    "entry": "const box={read(key){return this[key];},inspect(key){return this.read(key);}};box.inspect(\"safe\");",
    "negative": false
  },
  {
    "id": "confined-safe-dynamic-dispatch",
    "entry": "const box={read(key){return this[key];},inspect(name){return this[name](\"safe\");}};box.inspect(\"read\");",
    "negative": false
  },
  {
    "id": "confined-recursive-unknown",
    "entry": "const box={read(key){return this[key];},inspect(key){return this.read(key);}};box.inspect(\"read\").call(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assignment-reflection-computed",
    "entry": "let read;({[\"g\"+\"et\"]:read}=Reflect);read(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assignment-reflection-nested",
    "entry": "let read;({get:{call:read}}=Reflect);read(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assignment-reflection-rest",
    "entry": "let read;({...read}=Reflect);read.get(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "assignment-local-shadow",
    "entry": "const Reflect={get(scope,key){return \"local\";}};let read;({get:read}=Reflect);read({}, \"safe\");",
    "negative": false
  },
  {
    "id": "parameter-arrow",
    "entry": "const read=(scope,key)=>scope[key](\"child.js\");read(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-const-function-alias",
    "entry": "function read(scope,key){return scope[key](\"child.js\");}const invoke=read;invoke(globalThis,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-inline-function",
    "entry": "(function(scope,key){return scope[key](\"child.js\");})(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-arguments-escape",
    "entry": "function read(scope){return arguments[0][runtimeKey];}read(self);",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-return-escape",
    "entry": "function read(scope){return scope;}read(self)[runtimeKey](\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-opaque-boundary",
    "entry": "opaque(self);",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-call-boundary",
    "entry": "function read(scope,key){return scope[key](\"child.js\");}read.call(null,self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-apply-boundary",
    "entry": "function read(scope,key){return scope[key](\"child.js\");}read.apply(null,[self,\"importScripts\"]);",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-bind-boundary",
    "entry": "function read(scope,key){return scope[key](\"child.js\");}read.bind(null,self)(\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "parameter-local-dynamic",
    "entry": "function read(scope,key){return scope[key];}read({safe:1},\"safe\");",
    "negative": false
  },
  {
    "id": "parameter-native-static-benign",
    "entry": "function read(scope){return scope.setTimeout;}read(self);",
    "negative": false
  },
  {
    "id": "parameter-native-unused",
    "entry": "function read(scope,key){return key;}read(self,\"safe\");",
    "negative": false
  },
  {
    "id": "parameter-intrinsic-benign",
    "entry": "function read(R){return typeof R.ownKeys;}read(Reflect);",
    "negative": false
  },
  {
    "id": "parameter-shadowed-global",
    "entry": "const self={safe:1};function read(scope,key){return scope[key];}read(self,\"safe\");",
    "negative": false
  },
  {
    "id": "storage-native-global",
    "entry": "const holder={scope:self};holder.scope[runtimeKey](\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "return-native-global",
    "entry": "function scope(){return self;}scope()[runtimeKey](\"child.js\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "intrinsic-mutable-owner",
    "entry": "let owner=Reflect;owner.get(self,\"importScripts\");",
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph-function-parameter",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "function invoke(scope,key){return scope[key](\"child.js\");}",
      "consumer.js": "invoke(self,\"importScripts\");"
    },
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph-intrinsic-parameter",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "function invoke(R,key){return R.get(self,key);}",
      "consumer.js": "invoke(Reflect,\"importScripts\").call(self,\"child.js\");"
    },
    "negative": true,
    "error": "REFERENCE"
  },
  {
    "id": "graph-safe-global-helper",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self;function read(target){return target.setTimeout;}",
      "consumer.js": "read(scope);"
    },
    "negative": false
  },
  {
    "id": "graph-safe-shadow-helper",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const Reflect={get(target,key){return \"local\";}};",
      "consumer.js": "Reflect.get(self,\"importScripts\");"
    },
    "negative": false
  },
  {
    "id": "graph-imported-internal-extraction",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const box={read(key){return this[key];},leak(){return this.read(\"read\");}};",
      "consumer.js": "box.leak().call(self,\"importScripts\").call(self,\"child.js\");"
    },
    "negative": true,
    "error": "REFERENCE"
  }
];
  // Primary reviewer examples, paired boundary controls and every real graph
  // retain actual CLI builds. Additional single-source valueflow variations
  // use the identical exported locate, as the existing binding controls do.
  const builderReworkCases = new Set([
    "confined_internal_call", "confined_dynamic_dispatch",
    "assigned_reflect_get", "assigned_descriptor",
    "global_call_argument", "intrinsic_call_argument",
    "graph_reflective_alias", "graph_global_alias_dynamic",
    "graph_global_alias_literal_review_variant", "positive_internal_local_method",
    "positive_shadowed_intrinsic", "positive_graph_reflection_alias",
    "parameter-native-static-benign", "parameter-local-dynamic",
  ]);
  for (const fixture of reworkCases) {
    const run = fixture.files || builderReworkCases.has(fixture.id) ? attempt : attemptReference;
    const result = await run("review-" + fixture.id, fixture.entry, !fixture.negative,
      fixture.error, fixture.files);
    if (!fixture.negative && !fixture.files) assert.equal(result, fixture.entry,
      fixture.id + " must remain byte-identical");
    if (!fixture.negative && fixture.files) {
      assert.ok(!result.includes('importScripts("bindings.js"'), fixture.id);
      for (const text of Object.values(fixture.files)) assert.ok(result.includes(text), fixture.id);
    }
  }
  for (const [label, source] of [
    ["review-parameter-default-global", 'function read(scope,key=scope["import"+"Scripts"]){return key("child.js");}read(self);'],
    ["review-parameter-default-intrinsic", 'function read(R,key=R.get(self,"importScripts")){return key;}read(Reflect);'],
    ["review-parameter-direct-eval", 'function read(scope){return eval("scope[runtimeKey]");}read(self);'],
  ]) await attemptReference(label, source, false, "REFERENCE");
  for (const [label, source] of [
    ["review-parameter-benign-default", 'function read(scope,key="safe"){return scope.setTimeout;}read(self);'],
    ["review-parameter-nested-own-arguments", 'function read(scope){function local(){return arguments[0];}return scope.setTimeout;}read(self);'],
  ]) assert.equal(await attemptReference(label, source, true), source);
  await attemptReference("review-confined-unknown-data-write",
    'const box={slot:1,read(key){return this[key];}};box.slot=unknownValue;box.read("slot");',
    false, "UNRESOLVED_GLOBAL_REFERENCE");
  for (const [label, source] of [
    ["review-confined-primitive-data-write", 'const box={slot:1,read(key){return this[key];}};box.slot=2;box.read("slot");'],
    ["review-confined-unrelated-data-write", 'const box={slot:1,other:0,read(key){return this[key];}};box.other=()=>1;box.read("slot");'],
  ]) assert.equal(await attemptReference(label, source, true), source);
  for (const [label, source] of [
    ["review-native-self-expando", 'self.marker=1;self[runtimeKey]("child.js");'],
    ["review-native-globalThis-expando", 'globalThis.marker=1;globalThis[runtimeKey]("child.js");'],
    ["review-native-Reflect-expando", 'Reflect.extra=1;Reflect.get(self,"importScripts");'],
    ["review-native-Object-expando", 'Object.extra=1;Object.getOwnPropertyDescriptor(self,"importScripts");'],
  ]) await attemptReference(label, source, false, "REFERENCE");
  for (const [label, source] of [
    ["review-native-Reflect-benign-expando", 'Reflect.extra=1;Reflect.get(self,"setTimeout");'],
    ["review-native-self-benign-expando", 'self.marker=1;const value=self.setTimeout;'],
    ["review-real-shadowed-Reflect-expando", 'const Reflect={get(){return "local";},extra:0};Reflect.extra=1;Reflect.get({},"safe");'],
  ]) assert.equal(await attemptReference(label, source, true), source);
  // Full native-result/reference class, including receiver confinement and
  // actual graph boundaries. Same parser is used by CLI and in-process controls.
  const nativeResultCases = [
  {
    "id": "native-result-direct",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "function load(key){self.valueOf()[key](\"child.js\");}load(\"importScripts\");"
  },
  {
    "id": "native-result-parameter",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "function load(scope,key){scope.valueOf()[key](\"child.js\");}load(self,\"importScripts\");"
  },
  {
    "id": "native-result-intrinsic-parameter",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "function load(scope,native,key){const R=native.valueOf();R.get(scope.valueOf(),key).call(scope.valueOf(),\"child.js\");}load(self,Reflect,\"importScripts\");"
  },
  {
    "id": "native-result-intrinsic-direct",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "const R=Reflect.valueOf();function load(key){R.get(self.valueOf(),key).call(self.valueOf(),\"child.js\");}load(\"importScripts\");"
  },
  {
    "id": "native-result-return",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "function root(){return self.valueOf();}function load(key){root()[key](\"child.js\");}load(\"importScripts\");"
  },
  {
    "id": "native-result-graph-global",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self.valueOf();",
      "consumer.js": "function load(key){scope[key](\"child.js\");}load(\"importScripts\");"
    }
  },
  {
    "id": "native-result-graph-intrinsic",
    "finding": "A05-NATIVE-RESULT-5",
    "negative": true,
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self.valueOf();const R=Reflect.valueOf();",
      "consumer.js": "function load(key){R.get(scope,key).call(scope,\"child.js\");}load(\"importScripts\");"
    }
  },
  {
    "id": "inert-arguments-object",
    "finding": "A05-INERT-ARGUMENTS-6",
    "negative": false,
    "entry": "function read(scope){const metadata={arguments:1};return {timer:scope.setTimeout,metadata};}read(self);"
  },
  {
    "id": "inert-arguments-property",
    "finding": "A05-INERT-ARGUMENTS-6",
    "negative": false,
    "entry": "function read(scope){const metadata={arguments:1};return {timer:scope.setTimeout,arg:metadata.arguments};}read(self);"
  },
  {
    "id": "native-result-benign-timer",
    "negative": false,
    "entry": "function later(scope){return scope.setTimeout(()=>{},1);}later(self);"
  },
  {
    "id": "native-result-local",
    "negative": false,
    "entry": "const local={safe:1};function read(scope,key){return scope.valueOf()[key];}read(local,\"safe\");"
  },
  {
    "id": "native-result-graph-benign",
    "negative": false,
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self.valueOf();const R=Reflect.valueOf();",
      "consumer.js": "R.get(scope,\"setTimeout\");scope.setTimeout(()=>{},1);"
    }
  },
  {
    "id": "native-result-computed",
    "entry": "function load(key){self[\"value\"+\"Of\"]()[key](\"child.js\");}load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-arrow",
    "entry": "const load=key=>globalThis.valueOf()[key](\"child.js\");load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-this",
    "entry": "function load(key){this.valueOf()[key](\"child.js\");}load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-chain",
    "entry": "function load(key){self.valueOf().valueOf()[key](\"child.js\");}load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-opaque",
    "entry": "function load(scope,key){scope.unknown()[key](\"child.js\");}load(self,\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-identity-escape",
    "entry": "function root(scope){return scope.valueOf();}function load(key){root(self.valueOf())[key](\"child.js\");}load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-timer-write",
    "entry": "self.setTimeout=opaque;function later(scope){return scope.setTimeout(()=>{},1);}later(self);",
    "negative": true
  },
  {
    "id": "native-result-parameter-timer-write",
    "entry": "function change(scope){scope.setTimeout=opaque;}change(self);function later(scope){return scope.setTimeout(()=>{},1);}later(self);",
    "negative": true
  },
  {
    "id": "native-result-prototype-write",
    "entry": "Object.prototype.valueOf=opaque;function load(key){self.valueOf()[key](\"child.js\");}load(\"importScripts\");",
    "negative": true
  },
  {
    "id": "native-result-local-timer-write",
    "entry": "const local={setTimeout:1};local.setTimeout=()=>42;function later(scope){return scope.setTimeout(()=>{},1);}later(self);",
    "negative": false
  },
  {
    "id": "native-result-identity-benign",
    "entry": "function read(scope){return scope.valueOf().setTimeout;}read(self);",
    "negative": false
  },
  {
    "id": "native-result-identity-timer",
    "entry": "function later(scope){return scope.valueOf().setTimeout(()=>{},1);}later(self);",
    "negative": false
  },
  {
    "id": "native-result-intrinsic-benign",
    "entry": "const R=Reflect.valueOf();R.get(self.valueOf(),\"setTimeout\");",
    "negative": false
  },
  {
    "id": "native-result-local-method",
    "entry": "const obj={valueOf(){return {safe:1};}};obj.valueOf().safe;",
    "negative": false
  },
  {
    "id": "native-result-timer-call",
    "entry": "function later(scope){return scope.setTimeout.call(null,()=>{},1);}later(self);",
    "negative": false
  },
  {
    "id": "native-result-timer-bind",
    "entry": "function later(scope){return scope.setTimeout.bind(null);}later(self);",
    "negative": false
  },
  {
    "id": "inert-arguments-label",
    "entry": "function read(scope){arguments:{break arguments;}return scope.setTimeout;}read(self);",
    "negative": false
  },
  {
    "id": "inert-arguments-method",
    "entry": "function read(scope){const metadata={arguments(){return 1;}};return {timer:scope.setTimeout,arg:metadata.arguments()};}read(self);",
    "negative": false
  },
  {
    "id": "inert-arguments-field",
    "entry": "function read(scope){class Metadata{arguments=1;}return {timer:scope.setTimeout,metadata:new Metadata};}read(self);",
    "negative": false
  },
  {
    "id": "inert-arguments-local",
    "entry": "function read(scope){const arguments={safe:1};return {timer:scope.setTimeout,arg:arguments.safe};}read(self);",
    "negative": false
  },
  {
    "id": "inert-arguments-parameter",
    "entry": "function read(scope,arguments){return {timer:scope.setTimeout,arg:arguments.safe};}read(self,{safe:1});",
    "negative": false
  },
  {
    "id": "inert-arguments-arrow-shadow",
    "entry": "function read(scope){const arguments={safe:1};return {timer:scope.setTimeout,arg:(()=>arguments.safe)()};}read(self);",
    "negative": false
  },
  {
    "id": "real-arguments-shorthand",
    "entry": "function read(scope){return {arguments};}read(self);",
    "negative": true
  },
  {
    "id": "real-arguments-arrow",
    "entry": "function read(scope){return (()=>arguments[0])();}read(self);",
    "negative": true
  },
  {
    "id": "real-arguments-default",
    "entry": "function read(scope,key=arguments[0]){return key;}read(self);",
    "negative": true
  },
  {
    "id": "inert-eval-key-label",
    "entry": "function read(scope){eval:{const metadata={eval:1};break eval;}return scope.setTimeout;}read(self);",
    "negative": false
  },
  {
    "id": "local-eval-function",
    "entry": "function read(scope){const eval=()=>1;return {timer:scope.setTimeout,value:eval()};}read(self);",
    "negative": false
  },
  {
    "id": "native-eval-local-alias",
    "entry": "function read(scope){const eval=globalThis.eval;return eval(\"scope[runtimeKey]\");}read(self);",
    "negative": true
  },
  {
    "id": "confined-identity-extraction",
    "entry": "const box={read(key){return this.valueOf()[key];}};box.read(\"read\")(\"importScripts\")(\"child.js\");",
    "negative": true
  },
  {
    "id": "confined-identity-benign",
    "entry": "const box={read(key){return this.valueOf()[key];}};box.read(\"safe\");",
    "negative": false
  },
  {
    "id": "confined-identity-reflect-extraction",
    "entry": "const box={read(key){return Reflect.get(this.valueOf(),key);}};box.read(\"read\")(\"importScripts\")(\"child.js\");",
    "negative": true
  },
  {
    "id": "confined-identity-reflect-benign",
    "entry": "const box={read(key){return Reflect.get(this.valueOf(),key);}};box.read(\"safe\");",
    "negative": false
  }
];
  const nativeResultBuilderCases = new Set(["native-result-direct", "native-result-parameter", "native-result-intrinsic-parameter", "native-result-graph-global", "native-result-graph-intrinsic", "inert-arguments-object", "native-result-benign-timer", "native-result-local", "native-result-graph-benign", "native-result-this", "confined-identity-extraction"]);
  await Promise.all(nativeResultCases.map(async fixture => {
    const run = fixture.files || nativeResultBuilderCases.has(fixture.id) ? attempt : attemptReference;
    const emitted = await run("v8-" + fixture.id, fixture.entry, !fixture.negative,
      fixture.negative ? "REFERENCE" : undefined, fixture.files);
    if (!fixture.negative && !fixture.files) assert.equal(emitted, fixture.entry,
      fixture.id + " must stay byte-identical");
    if (!fixture.negative && fixture.files) {
      for (const text of Object.values(fixture.files)) assert.ok(emitted.includes(text), fixture.id);
      assert.ok(!emitted.includes('importScripts("bindings.js"'), fixture.id);
    }  }));

  // Real common-runtime consumers: ordinary native return protocols and result sinks.
  const consumerResultCases = [
  {
    "id": "ordinary-object-results",
    "entry": "const row=Object.freeze({a:1});const other=Object.assign({},row);const keys=Object.keys(other);Object.entries(row);Object.values(row);Object.fromEntries([[\"a\",1]]);Object.create(null);Object.getPrototypeOf(row);Object.hasOwn(row,\"a\");Object.is(1,1);Object.isFrozen(row);Object.getOwnPropertyNames(row);",
    "negative": false,
    "builder": true
  },
  {
    "id": "ordinary-intrinsic-parameter",
    "entry": "function read(native){return native.keys({a:1});}read(Object);",
    "negative": false,
    "builder": true
  },
  {
    "id": "ordinary-intrinsic-alias",
    "entry": "const native=Object;const freeze=native.freeze;const row=freeze({a:1});row.a;",
    "negative": false
  },
  {
    "id": "ordinary-intrinsic-graph",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const native=Object;",
      "consumer.js": "const row=native.freeze({a:1});Object.keys(row);"
    },
    "negative": false
  },
  {
    "id": "ordinary-await-boolean",
    "entry": "async function run(){const enabled=typeof self.check===\"function\"&&await self.check();const data=enabled?{}:{a:1};}run();",
    "negative": false
  },
  {
    "id": "ordinary-await-dispatch",
    "entry": "async function dispatch(){return self.resume?.();}async function run(){await dispatch();}run();",
    "negative": false
  },
  {
    "id": "ordinary-result-unused",
    "entry": "const unused=self.opaque();",
    "negative": false
  },
  {
    "id": "ordinary-result-type-only",
    "entry": "const result=self.opaque();const alias=result;if(typeof alias===\"object\"){}",
    "negative": false
  },
  {
    "id": "opaque-result-binding-escape",
    "entry": "const result=self.opaque();const alias=result;alias[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "opaque-result-return-escape",
    "entry": "function dispatch(){return self.opaque();}dispatch()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "opaque-result-function-escape",
    "entry": "function dispatch(){return self.opaque();}sink(dispatch);",
    "negative": true
  },
  {
    "id": "intrinsic-capability-argument-global",
    "entry": "Object.freeze(self)[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "intrinsic-capability-argument-object",
    "entry": "const native=Object.freeze(Object);native[key](self,key);",
    "negative": true
  },
  {
    "id": "intrinsic-method-overwrite",
    "entry": "Object.keys=opaque;Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "intrinsic-alias-overwrite",
    "entry": "const native=Object;native.keys=opaque;Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "intrinsic-reflective-overwrite",
    "entry": "Object.defineProperty(Object,\"keys\",{value:opaque});Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "intrinsic-parameter-overwrite",
    "entry": "function write(native){native.keys=opaque;}write(Object);Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "intrinsic-root-overwrite",
    "entry": "self.Object=opaque;Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "binder-actual-local-shadow",
    "entry": "const Object={defineProperty(){},keys(){return []}};Object.defineProperty(Object,\"keys\",{});Object.keys();",
    "negative": false
  },
  {
    "id": "binder-reflect-define-object",
    "entry": "Reflect.defineProperty(Object,\"keys\",{value:opaque});Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "binder-define-reflect",
    "entry": "Object.defineProperty(Reflect,\"get\",{value:opaque});Reflect.get(self,key)(\"child.js\");",
    "negative": true
  },
  {
    "id": "binder-define-properties",
    "entry": "Object.defineProperties(Object,{keys:{value:opaque}});Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "global-static-export",
    "entry": "Object.defineProperty(self,\"Plugin\",{value:{read(){return 1}},writable:false});",
    "negative": false,
    "builder": true
  },
  {
    "id": "global-reflect-export",
    "entry": "Reflect.defineProperty(self,\"Plugin\",{value:{read(){return 1}}});",
    "negative": false
  },
  {
    "id": "global-assign-export",
    "entry": "Object.assign(self,{Plugin:{read(){return 1}}});",
    "negative": false
  },
  {
    "id": "global-parameter-export",
    "entry": "(function(scope){scope.Plugin={read(){return 1}};})(globalThis);",
    "negative": false
  },
  {
    "id": "global-parameter-define",
    "entry": "function install(scope){Object.defineProperty(scope,\"Plugin\",{value:{read(){return 1}}});}install(self);",
    "negative": false
  },
  {
    "id": "global-define-graph",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "const scope=self;",
      "consumer.js": "Object.defineProperty(scope,\"Plugin\",{value:{read(){return 1}}});"
    },
    "negative": false
  },
  {
    "id": "global-define-loader",
    "entry": "Object.defineProperty(self,\"importScripts\",{value:opaque});",
    "negative": true
  },
  {
    "id": "global-define-dynamic",
    "entry": "Object.defineProperty(self,key,{value:opaque});",
    "negative": true
  },
  {
    "id": "global-assign-loader",
    "entry": "Object.assign(self,{importScripts:opaque});",
    "negative": true
  },
  {
    "id": "global-write-returned-target",
    "entry": "const target=Object.defineProperty(self,\"Plugin\",{value:{}});target[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "global-parameter-return-escape",
    "entry": "function install(scope){return Object.defineProperty(scope,\"Plugin\",{value:{}});}install(self)[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "global-parameter-native-replacement",
    "entry": "function install(scope){scope.Object=opaque;}install(self);Object.keys()[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "namespace-apply-object",
    "entry": "self.Plugin=Object.freeze({apply(){return 1}});const result=self.Plugin.apply({});result;",
    "negative": false,
    "builder": true
  },
  {
    "id": "namespace-call-object",
    "entry": "self.Plugin=Object.freeze({call(){return 1}});const result=self.Plugin.call({});result;",
    "negative": false
  },
  {
    "id": "namespace-freeze-alias",
    "entry": "const value={apply(){return 1}};self.Plugin=Object.freeze(value);self.Plugin.apply({});",
    "negative": false
  },
  {
    "id": "namespace-apply-graph",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "self.Plugin=Object.freeze({apply(){return 1}});",
      "consumer.js": "const result=self.Plugin.apply({});result;"
    },
    "negative": false
  },
  {
    "id": "namespace-callable-replacement",
    "entry": "self.Plugin=Object.freeze({apply(){return 1}});self.Plugin=opaque;self.Plugin.apply(null,[])[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "namespace-reflective-replacement",
    "entry": "self.Plugin=Object.freeze({apply(){return 1}});Object.defineProperty(self,\"Plugin\",{value:opaque});self.Plugin.apply(null,[])[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "consumer-opaque-this-forward-refused",
    "entry": "const model=self.Model;const original=model.claimDelivery;function claimDelivery(run,payload){return original.call(this,run,payload);}self.Model=Object.freeze({claimDelivery});",
    "negative": true
  },
  {
    "id": "consumer-captured-model-binding",
    "entry": "const model=self.Model;const original=model.claimDelivery.bind(model);function claimDelivery(run,payload){return original(run,payload);}self.Model=Object.freeze({claimDelivery});",
    "negative": false,
    "builder": true
  },
  {
    "id": "namespace-local-dynamic-descriptor",
    "entry": "const frame={target:{}};Object.defineProperty(frame.target,key,{value:1});self.Plugin=Object.freeze({apply(){return 1}});const result=self.Plugin.apply({});result;",
    "negative": false
  },
  {
    "id": "namespace-ordinary-single-argument-set",
    "entry": "const data={set(value){}};data.set(\"domain\");self.Plugin=Object.freeze({apply(){return 1}});const result=self.Plugin.apply({});result;",
    "negative": false,
    "builder": true
  },
  {
    "id": "namespace-native-reflect-set-replacement",
    "entry": "self.Plugin=Object.freeze({apply(){return 1}});Reflect.set(self,\"Plugin\",opaque);self.Plugin.apply(null,[])[key](\"child.js\");",
    "negative": true
  },
  {
    "id": "global-property-entry",
    "entry": "function accept(scope,key){scope[key](\"child.js\")}function dormant(){accept(self,\"importScripts\")}self[\"dormant\"]();",
    "negative": true
  },
  {
    "id": "global-reflect-entry",
    "entry": "function accept(scope,key){scope[key](\"child.js\")}function dormant(){accept(self,\"importScripts\")}Reflect.get(self,\"dormant\")();",
    "negative": true
  },
  {
    "id": "global-descriptor-entry",
    "entry": "function accept(scope,key){scope[key](\"child.js\")}function dormant(){accept(self,\"importScripts\")}Object.getOwnPropertyDescriptor(self,\"dormant\").value();",
    "negative": true
  },
  {
    "id": "global-destructured-entry",
    "entry": "function accept(scope,key){scope[key](\"child.js\")}function dormant(){accept(self,\"importScripts\")}const {dormant:run}=self;run();",
    "negative": true
  },
  {
    "id": "global-entry-graph",
    "entry": "importScripts(\"bindings.js\",\"consumer.js\");",
    "files": {
      "bindings.js": "function accept(scope,key){scope[key](\"child.js\")}function dormant(){accept(self,\"importScripts\")}",
      "consumer.js": "self[\"dormant\"]();"
    },
    "negative": true
  },
  {
    "id": "global-entry-intrinsic",
    "entry": "function accept(native,scope,key){native.get(scope,key).call(scope,\"child.js\")}function dormant(){accept(Reflect,self,\"importScripts\")}Reflect.get(self,\"dormant\")();",
    "negative": true,
    "builder": true
  },
  {
    "id": "global-entry-known-benign",
    "entry": "function consume(scope){return scope.setTimeout}function dormant(){consume(self)}dormant();",
    "negative": false
  },
  {
    "id": "global-entry-unused-benign-timer",
    "entry": "function dormant(){self.setTimeout(()=>{},1)}",
    "negative": false
  },
  {
    "id": "opaque-native-reflect-get-shadowed-intrinsic",
    "entry": "function inspect(Reflect,key){ return Reflect.get(self,key); }\n",
    "negative": true
  },
  {
    "id": "opaque-native-reflect-descriptor-shadowed-intrinsic",
    "entry": "function inspect(Object,key){ return Object.getOwnPropertyDescriptor(self,key); }\n",
    "negative": true
  },
  {
    "id": "shadowed-Reflect-native-capability",
    "entry": "function inspect(Reflect,key){return Reflect.get(self,key)}self[\"inspect\"]({get(scope,key){scope[key](\"child.js\")}},\"importScripts\");",
    "negative": true,
    "builder": true
  },
  {
    "id": "shadowed-Object-native-capability",
    "entry": "function inspect(Object,key){return Object.getOwnPropertyDescriptor(self,key)}self[\"inspect\"]({getOwnPropertyDescriptor(scope,key){scope[key](\"child.js\")}},\"importScripts\");",
    "negative": true
  }
];
  // Receiver-owned namespace writes must preserve consumed results in both graph forms.
  consumerResultCases.push(...[
  {
    "id": "namespace-owned-direct-local",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const local={};local.Plugin=1;const answer=self.Plugin.apply({});console.log(answer);",
    "builder": true,
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-direct-alias",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const local={};const alias=local;alias[\"Plugin\"]=1;const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-direct-shadow",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});{const self={};self.Plugin=1;}const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-reflection-nested",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};Object.defineProperty(frame.target,\"Plugin\",{value:1});const answer=self.Plugin.apply({});console.log(answer);",
    "builder": true,
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-reflection-alias",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};const alias=frame.target;const Intrinsic=Object;Intrinsic.defineProperty(alias,\"Plugin\",{value:1});const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-reflect-set",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};Reflect.set(frame.target,\"Plugin\",1);const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-assign",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};Object.assign(frame.target,{Plugin:1});const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-define-properties",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};Object.defineProperties(frame.target,{Plugin:{value:1}});const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-call-consumed",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const local={};local.Plugin=1;console.log(self.Plugin.call({}));",
    "expectedOutput": 8
  },
  {
    "id": "namespace-owned-bind-consumed",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const local={};local.Plugin=1;console.log(self.Plugin.bind({}));",
    "expectedOutput": 9
  },
  {
    "id": "namespace-owned-direct-graph",
    "entry": "importScripts(\"namespace.js\",\"local.js\",\"consumer.js\");",
    "files": {
      "namespace.js": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});",
      "local.js": "const local={};const alias=local;alias.Plugin=1;",
      "consumer.js": "const answer=self.Plugin.apply({});console.log(answer);"
    },
    "expectedOutput": 7
  },
  {
    "id": "namespace-owned-reflection-graph",
    "entry": "importScripts(\"namespace.js\",\"local.js\",\"consumer.js\");",
    "files": {
      "namespace.js": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});",
      "local.js": "const frame={target:{}};const alias=frame.target;Object.defineProperty(alias,\"Plugin\",{value:1});",
      "consumer.js": "const answer=self.Plugin.apply({});console.log(answer);"
    },
    "expectedOutput": 7
  },
  {
    "id": "namespace-control-without-local",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const answer=self.Plugin.apply({});console.log(answer);",
    "expectedOutput": 7
  },
  {
    "id": "namespace-global-direct-alias-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const alias=self;alias.Plugin=opaque;const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true,
    "builder": true
  },
  {
    "id": "namespace-global-reflection-alias-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const target=self;const Native=Reflect;Native.set(target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-unknown-direct-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});unknown.Plugin=opaque;const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-unknown-reflection-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});Object.defineProperty(unknown,\"Plugin\",{value:opaque});const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-global-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:self};Object.defineProperty(frame.target,\"Plugin\",{value:opaque});const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-slot-replaced-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};frame.target=self;Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-reflected-slot-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};Object.defineProperty(frame,\"target\",{value:self});Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-escaped-owner-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};sink(frame);Object.defineProperty(frame.target,\"Plugin\",{value:opaque});const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-method-owner-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{},replace(){this.target=self;}};frame.replace();Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-getter-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={get target(){return self;}};Object.defineProperty(frame.target,\"Plugin\",{value:opaque});const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-spread-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{},...unknown};Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-prototype-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});const frame={target:{}};sink(frame.__proto__);Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-global-reflection-graph-denied",
    "entry": "importScripts(\"namespace.js\",\"writer.js\",\"consumer.js\");",
    "files": {
      "namespace.js": "self.Plugin=Object.freeze({apply(){return 7},call(){return 8},bind(){return 9}});",
      "writer.js": "const alias=self;Reflect.set(alias,\"Plugin\",opaque);",
      "consumer.js": "const answer=self.Plugin.apply({});console.log(answer);"
    },
    "negative": true
  },
  {
    "id": "namespace-nested-destructuring-write-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7}});const frame={target:{}};({value:frame.target}=unknown);Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  },
  {
    "id": "namespace-nested-loop-write-denied",
    "entry": "self.Plugin=Object.freeze({apply(){return 7}});const frame={target:{}};for(frame.target of unknown){}Reflect.set(frame.target,\"Plugin\",opaque);const answer=self.Plugin.apply({});console.log(answer);",
    "negative": true
  }
]);
  consumerResultCases.push({"id": "namespace-unrelated-dynamic-storage", "entry": "self.Plugin=Object.freeze({apply(){return 7}});function update(state,key,value){state.entries[key]=value;}console.log(self.Plugin.apply({}));", "negative": false, "expectedOutput": 7});
  await Promise.all(consumerResultCases.map(async fixture => {
    const run = fixture.builder || fixture.files ? attempt : attemptReference;
    const emitted = await run("v9-" + fixture.id, fixture.entry, !fixture.negative,
      fixture.negative ? "REFERENCE" : undefined, fixture.files);
    if (fixture.expectedOutput !== undefined) {
      const values = [];
      const context = {console: {log: value => values.push(value)}};
      context.self = context;
      vm.runInNewContext(emitted, context, {timeout: 1000});
      assert.deepEqual(values, [fixture.expectedOutput], fixture.id + " consumed result");
    }
    if (!fixture.negative && !fixture.files) assert.equal(emitted, fixture.entry);
    if (!fixture.negative && fixture.files) for (const text of Object.values(fixture.files))
      assert.ok(emitted.includes(text));  }));

  await finishNegativeBuilders();
  assert.equal(new Set(staticResults.map(row => row.label)).size, staticResults.length);
  assert.equal(staticResults.length, 319, "full unfiltered Firefox static contract");
} finally {
  await Promise.all(pendingBuilders);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: "PASS",
  staticContract: {cases: staticResults.length,
    builder: staticResults.filter(row => row.backend === "builder").length,
    locate: staticResults.filter(row => row.backend === "locate").length},
  requiredDataCollection: manifest.browser_specific_settings.gecko.data_collection_permissions.required,
  loopbackHostPermissions: loopbackHosts,
}));
