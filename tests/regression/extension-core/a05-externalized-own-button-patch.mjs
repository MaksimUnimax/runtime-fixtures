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
const cap24ReportPatches = patches.slice(359, 360);
assert.equal(cap24ReportPatches.length, 1, "exactly one approved Ozon CAP-24 app patch");
const cap24ReportPatch = cap24ReportPatches[0];
assert.equal(cap24ReportPatch.target, "shared/llm_output_report_workflow_patch.js");
assert.deepEqual(Object.keys(cap24ReportPatch).sort(), ["new", "old", "target"]);
assert.equal(hash(cap24ReportPatch.old), "a6ad130dd40809bdf56ead39d31a097ec1bdb7b211592e3d81e789922f0208d2");
assert.equal(hash(cap24ReportPatch.new), "47f3d67550b8fb0968f42a5b362ed63f2186eb95c10c8e4c285ecbdff723018c");
const groupedResultPatches = patches.slice(360, 363);
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
// Preserve all 363 historical recipes and pin the five later artifact overlays.
const artifactIntegrityPatches = patches.slice(363, 368);
assert.equal(artifactIntegrityPatches.length, 5, "exact five appended artifact integrity overlays");
assert.deepEqual(artifactIntegrityPatches.map(row => {
  assert.equal(row.target, "shared/file_delivery_port_worker.js");
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [hash(row.old), hash(row.new)];
}), [
  [
    "4ac74a7a57ba57912bd4b02b350001abbad2f7858ece46fa7b38854614749daa",
    "61a2496050eb0f9bbdb59e7cbac4c4be0740aec055827c99a373b833602a1160"
  ],
  [
    "e3dba4ae16209f283a60e64211c52b2d197e683d0213de1567d8f50d8d61a22b",
    "8abde982f04e65dabc1e1de7e29f24404ee87952959d1e11045cfd3b1a691c04"
  ],
  [
    "0f100a2512cca46ae9ae0db625a8a7c7598687b9c420aaf651ac8070aadcbdfc",
    "6164f4ab0f922d5fafb435adc9f536d69ba34d1a04c2c10dbd60bddff0272045"
  ],
  [
    "0defad5c53ea38a15822669a3e4bee17beb0adf5149a07eaac974c1f7ab46b5c",
    "24a3f5883ed0639d39ef352fb88464a607b66fdb508c0959c9dff4ec2b1a73b4"
  ],
  [
    "7e7fe00d0e6c79b00672beeb38d0b41950f210169bd33920c1b7b75d6dfee938",
    "dbe8be59edc03dfa8adc688986c29825051958a1da5b9eacb49ad4835529044c"
  ]
]);
// B02 settlement is a separate tail, not an artifact-worker count relaxation.
// Preserve every prior pin and compare each newly introduced ordered recipe.
const settlementPatches = patches.slice(368, 378);
assert.equal(settlementPatches.length, 10, "exact ten B02 settlement overlays");
assert.deepEqual(settlementPatches.map(row => {
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [row.target, hash(row.old), hash(row.new)];
}), [
  [
    "content_script.js",
    "fbbcd633bbcaaaaa9d08e4ef3049a95daf7fc98e93119a8aad9a67d460f758b1",
    "568e83f439618b8cdc1943fd272dd934f487429dba5943d514cf3cc99c200dcf"
  ],
  [
    "content_script.js",
    "effa2cc8c73930c3a37fa7cea790c484f64ff5e3547fdaa1cf990fea4bf9e8a7",
    "7f639200cb722ab22814b17a288ddd81a34a528e00cc9380e0bdd73016388c87"
  ],
  [
    "content_script.js",
    "2aef94b0dda043b0e1eb2056fb9467b818d1577555560b1212bc604f64ca3d35",
    "ebb2a56781329d650302e9df763ea31b8446ad89fdc5d776e4a2e584495863d4"
  ],
  [
    "content_script.js",
    "7ab113b7179ce2e4a397b4282e524ba84aa365f2d4552b83c02ae555bf1140ef",
    "00a01b17d141bbd4590ad4ac555cb0509cd3d888089899ea39afcf18844a0c08"
  ],
  [
    "content_script.js",
    "f8c090d67f275264437c27b3ccfad2b83b891865e4b51daaae477f2afd672375",
    "555df57b2009e9e82339def8cf74a0008a7490f4e2994b67666c256c15e3524e"
  ],
  [
    "attachment_delivery_port_content.js",
    "4a45af64a62a28f58686ca26ea05c386e6528454b72edf96cd26e2a79c72c962",
    "1e83e0797909f0e055a4a10fc69e3c73e2c6946f41e584b89a3080d864f4ab63"
  ],
  [
    "attachment_delivery_port_content.js",
    "a63fd85d3432ae63c6d302516256f2f4d3de2820b5d53c08de0235b8e80fb08d",
    "088469662c61eed14076998bcd53f22edc796b622e9e42e0576970fbfc065e5c"
  ],
  [
    "attachment_delivery_port_content.js",
    "eba49e854b81f0bc0d80e26eac860d5970296a9b9567fb55cd6be1f1a4867f73",
    "ee17113d035eb3d51df2f3c781ccf95aeba856a19f777458c45ace6152a40cda"
  ],
  [
    "attachment_delivery_port_content.js",
    "a69ed1ce4ccf0a7868e0c2a95beb5e2b9faa1d34193503e4f36085010778dbc9",
    "219cb343cea824c84dd74a0d8b789ca6fb62185e592e500230aef64461df207f"
  ],
  [
    "attachment_delivery_port_content.js",
    "518cb59f1a79bdf494b1c35072ddfc025263f51e1c387a9cdac5c81b5a771793",
    "ddeda52fc20b84d582a469d70af5279ed71901b42051607b6d09a915166e7d32"
  ]
]);
const settlementContentPatches = settlementPatches.filter(row => row.target === "content_script.js");
assert.equal(settlementContentPatches.length, 5);
assert.equal(settlementPatches.filter(row => row.target === "attachment_delivery_port_content.js").length, 5);
// Exact later d8/1d B02 writer-queue and F05 artifact corrections are a
// separate composition tail. Every historical A05/content/settlement pin stays.
const donorCorrectionPatches = patches.slice(378, 388);
assert.equal(donorCorrectionPatches.length, 10);
assert.deepEqual(donorCorrectionPatches.map(row => {
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [row.target, hash(row.old), hash(row.new)];
}), [
  [
    "service_worker.js",
    "e668e08ad860d0b1a439acaf71f19efe8fa8e931b70a5a1fb176d1fa8c8fa450",
    "4ea8fdb02124b1fe8d85133c03b9fa4aeb479bcfe46f403cf944eec6bf227ed6"
  ],
  [
    "service_worker.js",
    "3b9eed08b9b734d626948ed06dba5b474067c542c28f6fd0f0f1c590b643c8b6",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ],
  [
    "service_worker.js",
    "7748247e3958b80d710095a639f650bd8526d43f90858c22e7ac4a774eb2f3e2",
    "3011cee52103e7a5ea628881798324bd0e042ad4c24d579deaa7a9c220d731f4"
  ],
  [
    "service_worker.js",
    "76bf7e282aab9a4896d6f1487dcee56516ee6afded05094975b44fe9bd502ddd",
    "0ac9ba8b3939dddbaa8917b9ed7c56c9002b258354f63a187462d6e06e9c5e77"
  ],
  [
    "service_worker.js",
    "4f8b8f101a3b5c1becac291b5fc830c0707ec41682f91633156635420db55c50",
    "f05755bfdc49d2984e92394a14906b56e7e40092bbdcebbd7b9ea053dfbaf3a8"
  ],
  [
    "service_worker.js",
    "75a1e1ed6a939c206f5929717b9a65e5719d934dd3f7c18040596b86a74e95c5",
    "653fecdddc511fa734b81ddcd3353216280b6901db6e6c8ca39e9ead8d2fbca1"
  ],
  [
    "service_worker.js",
    "e4a040977458be4360dad1e804ec17aa25e56f5474088bb5061911f2cfff2d6a",
    "0310c82ad9696851dcac7c2423af97f7de801b4845e94983dd2f69bfa5614d81"
  ],
  [
    "service_worker.js",
    "f9c50aa7a510675ab9ed890e6b0c86680888ee2d56972977855ba3ad354c8e7b",
    "2434dfc6a34db06c9fc6a98e641d0822c367fe2e422e3d735991dfacc708e499"
  ],
  [
    "shared/file_delivery_port_worker.js",
    "c1a75ee7837cdaefc5d52db4c0908024fe4dc7e5f6a94d5d51929aecb77990ee",
    "63703aba6c4d6615124ef9500fd3af2963c6b69fd60246d9ce14b30b05f8f379"
  ],
  [
    "shared/file_delivery_port_worker.js",
    "79b40356575b283cd8d78f20b4a657f3c2e96492ee4d3b94dc4ef7067810f6ed",
    "5f8d0840ae0602f291135fc6ce6e6aa1b97b4403813817c7b8648ff79142f81b"
  ]
]);
assert.equal(donorCorrectionPatches.some(row => row.target === "content_script.js"), false);
const reportStatusPatches = patches.slice(388);
assert.equal(reportStatusPatches.length, 1, "one whole generated-resolver status correction");
assert.deepEqual(reportStatusPatches.map(row => {
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
  return [row.target, hash(row.old), hash(row.new)];
}), [["shared/llm_output_report_workflow_patch.js",
  "f1b2548ab937ef6bbfd7a981c57010f31584a6165f5090f43ad27aca46e5464b",
  "27e2b015bbf24e7ab1bbb8cf11d7ede96093d2f18367cc19b8f711ab5d620cd3"]]);
let artifactWorker = read("apps/extension/src/imported/ozon-v0.1.22/shared/file_delivery_port_worker.js");
assert.equal(hash(artifactWorker), "c9b5fdbc8661828c17145519395bde1a2eab1af9b434b99ae13c1d8ccda0c6dd");
let artifactPreimages = 0;
for (const row of patches.slice(0, 378).filter(row => row.target === "shared/file_delivery_port_worker.js")) {
  assert.equal(artifactWorker.split(row.old).length - 1, 1, "one artifact preimage in ordered composition");
  artifactWorker = artifactWorker.replace(row.old, row.new);
  artifactPreimages++;
}
assert.equal(artifactPreimages, 23);
assert.equal(hash(artifactWorker), "c316aa9a9c511eea89dab1c094029bdc3e036353ece6240ca440af12ca8144fe", "exact compiled artifact worker including final owner deadline fence");
// Preserve the original23-overlay postimage above, then require both later
// owner-context corrections and the exact extracted d8 artifact postimage.
for (const row of donorCorrectionPatches.filter(row => row.target === "shared/file_delivery_port_worker.js")) {
  assert.equal(artifactWorker.split(row.old).length - 1, 1);
  artifactWorker = artifactWorker.replace(row.old, row.new);
  artifactPreimages++;
}
assert.equal(artifactPreimages, 25);
assert.equal(hash(artifactWorker), "7e5369886d7321337dc1c4af9fce13464bbaa727bf197ff8b49df9cef80f156b",
  "exact accepted d8/1d writer-context artifact worker; no A05 code change");
assert.equal(patches.length, 176 + transportPatches.length + standardComposerPatches.length + kimiPatches.length + laterB02Patches.length + cap24ReportPatches.length + groupedResultPatches.length + artifactIntegrityPatches.length + settlementPatches.length + donorCorrectionPatches.length + reportStatusPatches.length);
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
assert.equal(contentPatches.length, 69 + kimiContentPatches.length + laterContentPatches.length + settlementContentPatches.length);
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
for (const row of settlementContentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one exact settlement preimage in ordered composition");
  content = content.replace(row.old, row.new);
}
assert.equal(hash(content), "46427e7b29db5d65bb7ec1919041f5f81f87867cc8e4e58a75a18b49f0a653bd", "exact content after all five B02 settlement overlays");
console.log(JSON.stringify({level:"SOURCE",status:"PASS",externalized:1,
  patchCount:patches.length,contentPatches:contentPatches.length,
  emittedSHA256:hash(content),runtimeOrStoreInstall:"NOT_RUN"}));
