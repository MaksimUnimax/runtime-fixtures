import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const donorPath = path.join(ROOT, "apps/extension/src/imported/ozon-v0.1.22/service_worker.js");
const replacementPath = path.join(ROOT, "apps/extension/src/background/compat/createPendingWorkStart.js");
const compositionPath = path.join(ROOT, "apps/extension/composition.json");
const patchesPath = path.join(ROOT, "apps/extension/application-patches.json");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const extract = source => {
  const matches = [...source.matchAll(/^(?:async )?function createPendingWorkStart\(.*?^}$/gms)];
  assert.equal(matches.length, 1, "donor must contain exactly one createPendingWorkStart function");
  return matches[0][0];
};

const donorFunction = extract(fs.readFileSync(donorPath, "utf8"));
assert.equal(sha256(donorFunction), "7bbf2b74017852afc3c4af834bea076440bf07c6adbf29e9be69de798bc559b8", "raw donor function SHA drifted");

const replacementFunction = fs.readFileSync(replacementPath, "utf8").trimEnd();
assert.equal(sha256(replacementFunction), "f8af51a38db0f31633f9c54a5cdad8945cfa64546945203c2fa0c9ccd318a1ae", "adapted replacement function SHA drifted");
assert.match(replacementFunction, /store_context: saStarts\.get\(Number\(tab\)\) \|\| null/);
assert.match(replacementFunction, /admission_provenance: options\.admission_provenance \|\| null/);
assert.match(replacementFunction, /await saAdmissionMutationGuard\(\{ operation: "start", tabId: tab, conversationKey, intentId: transaction\.intent_id \}\);\n  await storageSet/);

const composition = JSON.parse(fs.readFileSync(compositionPath, "utf8"));
const rows = composition.worker_function_replacements.filter(row => row.function === "createPendingWorkStart");
assert.deepEqual(rows, [{
  function: "createPendingWorkStart",
  source_sha256: "7bbf2b74017852afc3c4af834bea076440bf07c6adbf29e9be69de798bc559b8",
  replacement: "apps/extension/src/background/compat/createPendingWorkStart.js",
}]);

const patches = JSON.parse(fs.readFileSync(patchesPath, "utf8"));
assert.equal(patches.some(row => row.target === "service_worker.js" && row.old === "    version: 2,\n    state: OzonWorkSessionModel.STATES.PENDING_IDENTITY,"), false, "legacy transaction-field patch must stay removed");
assert.equal(patches.some(row => row.target === "service_worker.js" && row.old.startsWith("  pending[slot] = transaction;\n  await diagnostic(\"WORK_START_PENDING_CREATED\"")), false, "legacy pre-storage admission patch must stay removed");
const callsite = patches.filter(row => row.target === "service_worker.js" && row.old.includes("const pending = await createPendingWorkStart(tab, live"));
assert.equal(callsite.length, 1, "callsite patch must remain unique");
assert.match(callsite[0].new, /withBindingWrite\(\(\) => createPendingWorkStart/);
assert.match(callsite[0].new, /admission_provenance: message\.admission_provenance \|\| null/);

console.log(JSON.stringify({
  status: "PASS",
  donor_function_sha256: sha256(donorFunction),
  replacement_function_sha256: sha256(replacementFunction),
  application_patch_count: patches.length,
  callsite_patch_count: callsite.length,
  executionAuthority: false,
}, null, 2));
