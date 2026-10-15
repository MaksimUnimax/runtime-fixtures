import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = filename => readFileSync(path.join(root, filename), "utf8");
const hash = source => createHash("sha256").update(source).digest("hex");
const patches = JSON.parse(read("apps/extension/application-patches.json"));
assert.equal(patches.length, 171);
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
assert.equal(contentPatches.length, 65);
for (const row of contentPatches) {
  assert.equal(content.split(row.old).length - 1, 1, "one baseline preimage per patch");
  const replacementText = row.new_source ? read(row.new_source) + "\n" : row.new;
  content = content.replace(row.old, replacementText);
}
assert.equal(
  hash(content),
  "eaf618e7621c1cb1f300aea4b3a7b54f65c942a518078b40d261075bb3f2c53c",
  "extracted text preserves the full content_script.js composition on exact base",
);
console.log(JSON.stringify({level:"SOURCE",status:"PASS",externalized:1,
  patchCount:patches.length,contentPatches:contentPatches.length,
  emittedSHA256:hash(content),runtimeOrStoreInstall:"NOT_RUN"}));
