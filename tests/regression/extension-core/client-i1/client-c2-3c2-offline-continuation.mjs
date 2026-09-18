import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const authority = fs.readFileSync(path.resolve("packages/control-client/src/autonomous-work-authority.js"), "utf8");
const runtime = fs.readFileSync(path.resolve("apps/extension/src/application/runtime.js"), "utf8");

// C3C replaces the old active-session/provenance bearer policy. The focused
// executable matrix lives in client-c3c-autonomous-authority.mjs; this gate
// keeps active-continuation wiring from regressing to that premise.
assert.match(authority, /ALLOW_OFFLINE_GRACE/);
assert.match(authority, /operation/);
assert.match(authority, /provenanceUsed: false/);
assert.doesNotMatch(authority, /provenanceMissing|provenanceBinding|operationScope/);
assert.match(runtime, /SellerAgentsAutonomousWorkAuthority\.evaluate/);
assert.doesNotMatch(runtime, /SellerAgentsOfflineWorkAuthority\.evaluate/);

console.log(JSON.stringify({
  status: "PASS",
  scope: "C2.3-C3C_ACTIVE_CONTINUATION_REWIRED",
  signedAuthorityIsBearer: true,
  historicalProvenanceIsBearer: false,
  operationNeutral: true,
}));
