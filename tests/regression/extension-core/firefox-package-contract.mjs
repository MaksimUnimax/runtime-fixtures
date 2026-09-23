import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const runtime = process.argv[2];
assert.ok(runtime, "runtime directory required");
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.background, { scripts: ["firefox_background.js"] });
assert.equal(manifest.browser_specific_settings?.gecko?.id, "seller-agents@example.test");
assert.equal(manifest.browser_specific_settings?.gecko?.strict_min_version, "140.0");
assert.deepEqual(
  manifest.browser_specific_settings?.gecko?.data_collection_permissions,
  { required: ["authenticationInfo", "personallyIdentifyingInfo"] },
);
assert.ok(fs.statSync(path.join(runtime, "firefox_background.js")).size > 0);
console.log(JSON.stringify({ status: "PASS", requiredDataCollection: manifest.browser_specific_settings.gecko.data_collection_permissions.required }));
