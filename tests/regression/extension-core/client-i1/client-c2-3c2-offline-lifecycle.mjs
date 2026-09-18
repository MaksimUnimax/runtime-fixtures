import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const authority = fs.readFileSync(path.resolve("packages/control-client/src/autonomous-work-authority.js"), "utf8");
const runtime = fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8");
assert.match(authority, /ALLOW_OFFLINE_GRACE/);
assert.match(authority, /provenanceUsed: false/);
assert.doesNotMatch(authority, /operationScope|provenanceMissing|provenanceBinding|active_visible.*active_hidden/);
assert.match(runtime, /SellerAgentsAutonomousWorkAuthority\.evaluate/);
console.log(JSON.stringify({ status: "PASS", scope: "C2.3-C3C_ACTIVE_CONTINUATION_REWIRED", activeSessionOnlyPolicyRemoved: true, provenanceNonAuthoritative: true }));
