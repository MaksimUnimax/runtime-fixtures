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
// later Standard corrections remain in the separately pinned B02 slice below.
const standardComposerPatches = patches.slice(0, 179).filter(row =>
  row.target === "content_script.js" && row.old.startsWith("  function chatgptPrimaryComposerContext() {"));
assert.equal(standardComposerPatches.length, 1, "one observed Standard composer overlay");
const standardComposerPatch = standardComposerPatches[0];
assert.deepEqual(Object.keys(standardComposerPatch).sort(), ["new", "old", "target"]);
assert.equal(hash(standardComposerPatch.old), "2149944069f6f17e75d2eb9d7861906854d66b08afcf3f224b5f22e7f28e21bc");
assert.equal(hash(standardComposerPatch.new), "dfa900cbbe80eab472d738c2125bac806252875011e64abbdffa29720b46f235");
// Keep the thirteen Kimi overlays in their existing slice; pin the current selection guard.
// The separate CAP-24 composition overlay must not silently become a Kimi patch.
const kimiPatches = patches.slice(179, 192);
assert.equal(kimiPatches.length, 13);
assert.equal(hash(JSON.stringify(patches.slice(0, 179))), "8dd63a7aa84cd49bd8aaee561b915c4006e799919cca0f8291efaff273b387d5",
  "exact pre-Kimi inventory includes the preserved B02 quota-copy correction");
assert.equal(hash(JSON.stringify(kimiPatches)), "32e8792ab10e0217287c9f766cf217d6e597184202b27926583851fe846f9935",
  "exact Kimi slice includes the preserved delivery-profile selection guard");
// Pin the one additional independently-reviewed CAP-24 composition patch.
const laterB02Patches = patches.slice(192, 359);
assert.equal(laterB02Patches.length, 167);
assert.equal(hash(JSON.stringify(laterB02Patches)), "138ff29bb349c6fd808546a169c4164db134b2d3021ef42370c4d32681a25bbd",
  "exact preserved B02 overlays before the CAP-24 patch");
const cap24ReportPatches = patches.slice(359);
assert.equal(cap24ReportPatches.length, 1, "exactly one approved Ozon CAP-24 app patch");
const cap24ReportPatch = cap24ReportPatches[0];
assert.equal(cap24ReportPatch.target, "shared/llm_output_report_workflow_patch.js");
assert.deepEqual(Object.keys(cap24ReportPatch).sort(), ["new", "old", "target"]);
assert.equal(hash(cap24ReportPatch.old), "a6ad130dd40809bdf56ead39d31a097ec1bdb7b211592e3d81e789922f0208d2");
assert.equal(hash(cap24ReportPatch.new), "47f3d67550b8fb0968f42a5b362ed63f2186eb95c10c8e4c285ecbdff723018c");
assert.equal(patches.length, 176 + transportPatches.length + standardComposerPatches.length + kimiPatches.length + laterB02Patches.length + cap24ReportPatches.length);
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
assert.equal(kimiContentPatches.length, 8);
const laterContentPatches = laterB02Patches.filter(row => row.target === "content_script.js");
assert.equal(laterContentPatches.length, 72);
assert.equal(contentPatches.length, 69 + kimiContentPatches.length + laterContentPatches.length);
const baselineContentPatches = patches.slice(0, 179).filter(row => row.target === "content_script.js" && row !== standardComposerPatch);
assert.equal(baselineContentPatches.length, 68);
for (const row of baselineContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one baseline preimage per patch");
  const replacementText = row.new_source ? read(row.new_source) + "\n" : row.new;
  content = content.replace(row.old, replacementText);
}
assert.equal(
  hash(content),
  "a4d2919985b4b23f9436b453fb85fa3571bb6a1a405756fa8bb815289a849e9f",
  "extracted text preserves the full content_script.js composition on exact base",
);
assert.equal(content.split(standardComposerPatch.old).length - 1, 1, "one Standard composer preimage after baseline");
content = content.replace(standardComposerPatch.old, standardComposerPatch.new);
assert.equal(hash(content), "fe6bbccf807f8443422e15fa88064ebbe456a0902495589b740fbff50fa0c315",
  "exact full content after the pinned Standard composer overlay");
for (const row of kimiContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one Kimi preimage after the unchanged baseline");
  content = content.replace(row.old, row.new);
}
assert.equal(hash(content), "15f57c30943bf1f902ea50081ead04db71dc44938e9b4e3990616b163386673e", "exact composition before later B02 overlays");
for (const row of laterContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one B02 preimage in ordered composition");
  content = content.replace(row.old, row.new);
}
assert.equal(hash(content), "f5c5c9611b5d1b8ff477037c5997f16ef5a8cbe9eed87ce38477805e21647e49", "exact current content composition before bundle assembly");
console.log(JSON.stringify({level:"SOURCE",status:"PASS",externalized:1,
  patchCount:patches.length,contentPatches:contentPatches.length,
  emittedSHA256:hash(content),runtimeOrStoreInstall:"NOT_RUN"}));
