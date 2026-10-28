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
// PR330 changes exactly four existing artifact recipes. Pin their identities
// separately; all other pre-Kimi recipes, including B02 quota-copy, are unchanged.
const artifactPatchIndexes = [25, 29, 32, 135];
const unchangedPreKimi = patches.slice(0, 179).filter((_, index) => !artifactPatchIndexes.includes(index));
assert.equal(unchangedPreKimi.length, 175);
assert.equal(hash(JSON.stringify(unchangedPreKimi)), "b3596f97daaff2005068fabf005e9bb0596348bf4d987d9a2abe5921f6d1375f",
  "exact 175 preserved pre-Kimi recipes including B02 quota-copy");
assert.deepEqual(artifactPatchIndexes.map(index => {
  const row = patches[index];
  assert.equal(row.target, "shared/file_delivery_port_worker.js");
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [index, hash(row.old), hash(row.new)];
}), [
  [25, "797019b84c1379d6a4b7b7da44fe87941ff78be6e1eda97f27e93ab58d795ccd", "5ae0ef7a133383721abd5061fa422d0c196a4ff582bf5e5812b5af5ed0e7b144"],
  [29, "870ef4a10b216b69eaf52e00a7fda81d9fe4f630dcbc4206a2818d6725033eab", "de32b7461d288342df4eefd068970eb76f2561a135af7a81c62190aaffeca4b9"],
  [32, "4026de0552e555d8a3e2e56346578e0aec633af22b26b45138f5e74eb5cd6390", "0e3e8b8ae8e492649071321afbe98c135f62ba04602593d9184960eecbb5aa03"],
  [135, "0e72b71ab29e2664ee359c0c912c911a595e3bedccf37c6e8e3090c8147f766c", "49c35375526cac09ac76919cc06b9a550326afbadc857131015c5f93bc40a0cd"],
]);
assert.equal(hash(JSON.stringify(patches.slice(0, 179))), "b191b8c0b9ae412610ca584aa76831003af01b59006f5679b438680e57fc0dca",
  "exact pre-Kimi composition with four PR330 artifact corrections");
assert.equal(hash(JSON.stringify(kimiPatches)), "32e8792ab10e0217287c9f766cf217d6e597184202b27926583851fe846f9935",
  "exact Kimi slice includes the preserved delivery-profile selection guard");
// Pin the one additional independently-reviewed CAP-24 composition patch.
const laterB02Patches = patches.slice(192, 359);
assert.equal(laterB02Patches.length, 167);
assert.equal(hash(JSON.stringify(laterB02Patches)), "138ff29bb349c6fd808546a169c4164db134b2d3021ef42370c4d32681a25bbd",
  "exact preserved B02 overlays before the CAP-24 patch");
const cap24ReportPatches = patches.slice(359, 360);
assert.equal(cap24ReportPatches.length, 1, "exactly one approved Ozon CAP-24 app patch");
const cap24ReportPatch = cap24ReportPatches[0];
assert.equal(cap24ReportPatch.target, "shared/llm_output_report_workflow_patch.js");
assert.deepEqual(Object.keys(cap24ReportPatch).sort(), ["new", "old", "target"]);
assert.equal(hash(cap24ReportPatch.old), "a6ad130dd40809bdf56ead39d31a097ec1bdb7b211592e3d81e789922f0208d2");
assert.equal(hash(cap24ReportPatch.new), "47f3d67550b8fb0968f42a5b362ed63f2186eb95c10c8e4c285ecbdff723018c");
const groupedResultPatches = patches.slice(360);
assert.equal(groupedResultPatches.length, 3, "exactly three retained PR205 Ozon JSON-copy overlays");
assert.deepEqual(groupedResultPatches.map(row => {
  assert.equal(row.target, "shared/ozon_contract.js");
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [hash(row.old), hash(row.new)];
}), [
  [
    "de977049fe188bce48fdc32df214867384616f6c6043a2dabb8da605c97ced5c",
    "e45657bdc13b3defa99c5a10fd1214caf2dc925da3022b8c6941ae14dc6a4be4"
  ],
  [
    "9b0e9cd3db262fead5fe49df362c67d6b8e93386fcdd3e8adf1bce4f630d67e5",
    "add2b522fb406a259115c6c795e469a9ee9c1c5c46d97f860577b38ee7816c4a"
  ],
  [
    "9199df7bdf5ff2b40d78f513747be33e653f6f62484fc593fb7eaf7154cc5dd0",
    "4e258bf72d73bf39d0180c5dd4084534ba5ecbd12cb107a7161ae37616052878"
  ]
]);
assert.equal(patches.length, 176 + transportPatches.length + standardComposerPatches.length + kimiPatches.length + laterB02Patches.length + cap24ReportPatches.length + groupedResultPatches.length);
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
