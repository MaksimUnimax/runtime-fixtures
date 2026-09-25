import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("packages/control-client/src/local-client-authority.js", "utf8");
const context = { globalThis: null };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
const { materialize } = context.SellerAgentsLocalClientAuthority;
const env = {
  browserFamily: "firefox", browserVersion: "140.0", extensionVersion: "1.0.0", requestedAi: "chatgpt",
  localAi: { chatgpt: { family: "chatgpt", surface: "web" } },
  compareSemver: (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  compareBrowser: (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  versionAtLeast: (a, b) => a.localeCompare(b, undefined, { numeric: true }) >= 0,
  profileValid: p => p.valid === true,
  profileFingerprint: async p => p.fingerprint,
};
const profile = { valid: true, contentSha256: "a".repeat(64), fingerprint: "a".repeat(64) };
const policy = overrides => ({ policyKey: "global", revision: 1, contractVersion: "control_plane_v2", browserFamily: null, minimumExtensionVersion: null, recommendedExtensionVersion: null, minimumBrowserVersion: null, maintenanceMode: false, maintenanceCode: null, blockedVersions: [], ...overrides });
const rule = overrides => ({ featureKey: "feature_a", revision: 1, contractVersion: "control_plane_v2", enabled: true, browserFamily: null, minimumExtensionVersion: null, ...overrides });
const base = () => ({
  snapshotVersion: "bootstrap_snapshot_v2", contractVersion: "control_plane_v2", configVersion: 3,
  localClientAuthority: {
    schemaVersion: "local_client_authority_v1", contractVersion: "control_plane_v2",
    compatibility: { releases: [{ extensionVersion: "1.0.0", contractVersions: ["control_plane_v2"], browserFamilies: ["firefox"] }], policies: [] },
    featureRules: [rule(), rule({ featureKey: "chrome_only", browserFamily: "chrome" }), rule({ featureKey: "later", minimumExtensionVersion: "2.0.0" })],
    ai: { status: "CANDIDATES", detected: { family: "chatgpt", surface: "web", variant: null }, candidates: [{ browserFamily: "firefox", resolution: { status: "RESOLVED", profile } }] },
  },
});

let payload = base();
let result = await materialize(payload, env);
assert.deepEqual(JSON.parse(JSON.stringify(result.features)), { feature_a: true, chrome_only: false, later: false });
assert.equal(result.ai.status, "RESOLVED");
assert.equal(result.compatibility.extension.status, "SUPPORTED");

payload = base(); payload.localClientAuthority.compatibility.policies = [policy({ maintenanceMode: true, maintenanceCode: "planned" })];
result = await materialize(payload, env); assert.equal(result.compatibility.browser.status, "MAINTENANCE");

payload = base(); payload.localClientAuthority.compatibility.policies = [policy({ blockedVersions: ["1.0.0"] })];
result = await materialize(payload, env); assert.equal(result.compatibility.extension.status, "UPDATE_REQUIRED");

payload = base(); payload.localClientAuthority.compatibility.policies = [policy({ minimumExtensionVersion: "2.0.0" })];
result = await materialize(payload, env); assert.equal(result.compatibility.extension.status, "UPDATE_REQUIRED");

payload = base(); payload.localClientAuthority.compatibility.policies = [policy({ recommendedExtensionVersion: "2.0.0" })];
result = await materialize(payload, env); assert.equal(result.compatibility.extension.status, "UPDATE_RECOMMENDED");

payload = base(); payload.localClientAuthority.compatibility.releases = [];
result = await materialize(payload, env); assert.equal(result.compatibility.extension.status, "UPDATE_REQUIRED");

payload = base(); payload.localClientAuthority.compatibility.policies = [policy({ policyKey: "firefox", browserFamily: "firefox", minimumBrowserVersion: "141.0" })];
result = await materialize(payload, env); assert.equal(result.compatibility.browser.status, "UNSUPPORTED_BROWSER");

payload = base(); payload.localClientAuthority.ai.candidates[0].browserFamily = "chrome";
result = await materialize(payload, env); assert.equal(result.ai.status, "UNAVAILABLE");

payload = base(); payload.localClientAuthority.ai.candidates[0].resolution.profile = { ...profile, valid: false };
result = await materialize(payload, env); assert.equal(result.ai.status, "UNAVAILABLE");

payload = base(); payload.localClientAuthority.ai.candidates[0].resolution.profile = { ...profile, fingerprint: "b".repeat(64) };
result = await materialize(payload, env); assert.equal(result.ai.status, "UNAVAILABLE");

payload = base(); payload.localClientAuthority.contractVersion = "control_plane_v1";
assert.equal(await materialize(payload, env), null);

console.log(JSON.stringify({ status: "PASS", cases: ["feature_rule_filtering", "maintenance", "blocked_version", "minimum_version", "recommended_update", "missing_release_update_required", "wrong_family_ai", "profile_minimum_failure", "profile_hash_failure", "wrong_authority_contract"] }));
