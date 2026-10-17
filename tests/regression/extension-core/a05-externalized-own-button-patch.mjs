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
// The entire accepted 178-recipe baseline must remain byte-for-byte stable;
// counting recipes alone cannot detect replacing an unrelated accepted patch.
assert.equal(
  hash(JSON.stringify(patches.slice(0, 176 + transportPatches.length))),
  "b8a94250b86e77be79347a2b8d37563eef6918f716ee8262da54467a7bde1ee4",
  "pin the complete original A05/transport composer inventory",
);
// A04 adds exactly three reviewed Ozon grouped-result JSON property overlays.
// Pin both preimages and replacements rather than weakening the A05 inventory guard.
const groupedResultPatches = patches.filter(patch => patch.target === "shared/ozon_contract.js");
assert.equal(groupedResultPatches.length, 3, "only the accepted Ozon JSON own-key overlays");
assert.deepEqual(groupedResultPatches.map(patch => [hash(patch.old), hash(patch.new)]), [
  ["de977049fe188bce48fdc32df214867384616f6c6043a2dabb8da605c97ced5c", "e45657bdc13b3defa99c5a10fd1214caf2dc925da3022b8c6941ae14dc6a4be4"],
  ["9b0e9cd3db262fead5fe49df362c67d6b8e93386fcdd3e8adf1bce4f630d67e5", "add2b522fb406a259115c6c795e469a9ee9c1c5c46d97f860577b38ee7816c4a"],
  ["9199df7bdf5ff2b40d78f513747be33e653f6f62484fc593fb7eaf7154cc5dd0", "4e258bf72d73bf39d0180c5dd4084534ba5ecbd12cb107a7161ae37616052878"],
], "pin all three independently reviewed A04 OzonContract recipes");
for (const row of groupedResultPatches) {
  assert.deepEqual(Object.keys(row).sort(), ["new", "old", "target"]);
}
assert.deepEqual(patches.slice(-3), groupedResultPatches, "append A04 overlays after accepted A05 inventory");
assert.equal(patches.length, 176 + transportPatches.length + groupedResultPatches.length);
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
assert.equal(contentPatches.length, 68);
for (const row of contentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one baseline preimage per patch");
  const replacementText = row.new_source ? read(row.new_source) + "\n" : row.new;
  content = content.replace(row.old, replacementText);
}
assert.equal(
  hash(content),
  "51311e4b31490f0c5ff16287b32b3d7594d14705baeef33ce4eb15febf33e989",
  "extracted text preserves the full content_script.js composition on exact base",
);
console.log(JSON.stringify({level:"SOURCE",status:"PASS",externalized:1,
  patchCount:patches.length,contentPatches:contentPatches.length,
  emittedSHA256:hash(content),runtimeOrStoreInstall:"NOT_RUN"}));
