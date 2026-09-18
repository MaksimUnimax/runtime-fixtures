import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const core = fs.readFileSync(path.resolve("packages/control-client/src/autonomous-work-authority.js"), "utf8");
const online = fs.readFileSync(path.resolve("packages/control-client/src/online-work-authority.js"), "utf8");
const offline = fs.readFileSync(path.resolve("packages/control-client/src/offline-work-authority.js"), "utf8");

assert.match(core, /offlineGraceUntil/);
assert.match(core, /CACHE_EXPIRED/);
assert.match(core, /provenanceUsed: false/);
assert.doesNotMatch(core, /operationScope|active_visible.*active_hidden|workAllowed !== true/);
assert.match(online, /SellerAgentsAutonomousWorkAuthority/);
assert.match(offline, /SellerAgentsAutonomousWorkAuthority/);
console.log(JSON.stringify({ status: "PASS", suite: "C2.3A_REWRITTEN_TO_UNIFIED_AUTHORITY", supersededPolicyAssertionsRemoved: true }));
