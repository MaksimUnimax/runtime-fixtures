import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = filename => readFileSync(path.join(root, filename), "utf8");
const hash = source => createHash("sha256").update(source).digest("hex");
const patches = JSON.parse(read("apps/extension/application-patches.json"));
// Preserve the accepted A05 patch inventory while explicitly pinning the two
// independent JSON API redirect guards. This is not a general count relaxation.
const transportPatches = patches.filter(patch => patch.target === "shared/provider_transport_core.js");
assert.equal(transportPatches.length, 2, "only Seller and Performance transport overlays");
assert.deepEqual(
  transportPatches.map(patch => patch.old.match(/async function (execute(?:Performance)?JsonOnce)\(/)?.[1]).sort(),
  ["executeJsonOnce", "executePerformanceJsonOnce"],
);
for (const patch of transportPatches) {
  assert.deepEqual(Object.keys(patch).sort(), ["new", "old", "target"]);
  assert.equal(patch.old.includes('redirect: "error"'), false, "preimage must lack the redirect fence");
  assert.equal(patch.new.includes('redirect: "error"'), true, "replacement must reject redirects");
}
// Pin the one independently reviewed Standard-composer overlay explicitly;
// retain the accepted A05 baseline and its original full-content hash below.
const preKimiPatches = patches.slice(0, 179);
const standardComposerPatches = preKimiPatches.filter(row =>
  row.target === "content_script.js" && row.old.startsWith("  function chatgptPrimaryComposerContext() {"));
assert.equal(standardComposerPatches.length, 1, "one observed Standard composer overlay");
const standardComposerPatch = standardComposerPatches[0];
assert.deepEqual(Object.keys(standardComposerPatch).sort(), ["new", "old", "target"]);
assert.equal(hash(standardComposerPatch.old), "2149944069f6f17e75d2eb9d7861906854d66b08afcf3f224b5f22e7f28e21bc");
assert.equal(hash(standardComposerPatch.new), "dfa900cbbe80eab472d738c2125bac806252875011e64abbdffa29720b46f235");
// Keep each accepted composition stage explicit. Later B02 overlays include a
// second composer replacement and must not be counted as the original overlay.
const kimiPatches = patches.slice(179, 192);
const b02Patches = patches.slice(192);
assert.equal(kimiPatches.length, 13);
assert.equal(hash(JSON.stringify(preKimiPatches)), "18a6b8c9943d4b2f67c118c149fcc335d83629081059a6ab107f73ebe081c1aa",
  "accepted pre-Kimi patch inventory remains byte-equivalent");
// The later B02 adapter-registry update changed only row 191 of the original
// Kimi stage; pin its current full bytes and preserve the eight content rows below.
assert.equal(hash(JSON.stringify(kimiPatches)), "32e8792ab10e0217287c9f766cf217d6e597184202b27926583851fe846f9935",
  "exact Kimi stage with the current B02 adapter registry");
assert.equal(b02Patches.length, 151);
assert.equal(hash(JSON.stringify(b02Patches)), "79c95b8ecdfc460d9e098cfa8c40009f0e01ae933ea5b0909f8fe608220216f3",
  "exact additional B02 overlays; no unpinned tail");
assert.equal(patches.length, 176 + transportPatches.length + standardComposerPatches.length + kimiPatches.length + b02Patches.length);
const extracted = patches.filter(patch => Object.hasOwn(patch, "new_source"));
assert.equal(extracted.length, 1, "A05 limits this migration to one audited function");
const patch = extracted[0];
assert.equal(patch.target, "content_script.js");
assert.equal(patch.new_source, "apps/extension/src/content/position-own-button.js");
assert.deepEqual(Object.keys(patch).sort(), ["new_sha256", "new_source", "old", "old_sha256", "target"]);
assert.equal(hash(patch.old), "0c10432e2e27f1b10dda3d8bffecdb8f363384b4f40257c0d5e21fd1effacbe9");
assert.equal(patch.old_sha256, hash(patch.old));
const sourceFile = read(patch.new_source);
assert.ok(sourceFile.endsWith("  }\n") && !sourceFile.endsWith("  }\n\n"));
const replacement = sourceFile + "\n";
assert.equal(hash(replacement), "ebb04a256aae41f7f1ca382693401d9324654997915134ec7b6113d73b55a6bf");
assert.equal(patch.new_sha256, hash(replacement));
assert.ok(replacement.startsWith("  function positionOwnButton(record) {"));
assert.ok(replacement.endsWith("  }\n\n"));

let content = read("apps/extension/src/imported/ozon-v0.1.22/content_script.js");
const contentPatches = patches.filter(row => row.target === "content_script.js");
const kimiContentPatches = kimiPatches.filter(row => row.target === "content_script.js");
const b02ContentPatches = b02Patches.filter(row => row.target === "content_script.js");
assert.equal(kimiContentPatches.length, 8);
assert.equal(hash(JSON.stringify(kimiContentPatches)), "baa61703dc196ec14aefc883a519644e2b810765dd90f14b946a00268b165ffb",
  "the original eight Kimi content overlays remain unchanged");
assert.equal(b02ContentPatches.length, 69);
assert.equal(contentPatches.length, 69 + kimiContentPatches.length + b02ContentPatches.length);
const baselineContentPatches = preKimiPatches.filter(row => row.target === "content_script.js" && row !== standardComposerPatch);
assert.equal(baselineContentPatches.length, 68);
for (const row of baselineContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one baseline preimage per patch");
  const replacementText = row.new_source ? read(row.new_source) + "\n" : row.new;
  content = content.replace(row.old, replacementText);
}
assert.equal(
  hash(content),
  "51311e4b31490f0c5ff16287b32b3d7594d14705baeef33ce4eb15febf33e989",
  "extracted text preserves the full content_script.js composition on exact base",
);
assert.equal(content.split(standardComposerPatch.old).length - 1, 1, "one Standard composer preimage after baseline");
content = content.replace(standardComposerPatch.old, standardComposerPatch.new);
assert.equal(hash(content), "3ffafc00da373a1a6bf017bf62f3babc25d1a2a14f4038d9204710ed4579f2fb",
  "exact full content after the pinned Standard composer overlay");
for (const row of kimiContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one Kimi preimage after the unchanged baseline");
  content = content.replace(row.old, row.new);
}
assert.equal(hash(content), "d372417469868a7cc8f3ab438b2810974a926b17b26d70722e24980cc0fddb99", "original Kimi composition remains unchanged before later B02 overlays");
for (const row of b02ContentPatches) {
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  assert.equal(content.split(row.old).length - 1, 1, "one B02 preimage at its ordered composition stage");
  content = content.replace(row.old, row.new);
}
assert.equal(hash(content), "916075a132a09e310d8fdec7575cf5dfb7e4f313dc27e2cdf4e71b3d67a11948",
  "exact current B02 donor composition before bundle assembly");
console.log(JSON.stringify({level:"SOURCE",status:"PASS",externalized:1,
  patchCount:patches.length,contentPatches:contentPatches.length,
  emittedSHA256:hash(content),runtimeOrStoreInstall:"NOT_RUN"}));
