import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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
console.log(JSON.stringify({
  status: "PASS",
  requiredDataCollection: manifest.browser_specific_settings.gecko.data_collection_permissions.required,
  loopbackHostPermissions: loopbackHosts,
}));
