import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorker } from "../worker-harness.mjs";

const runtime = path.resolve(process.argv[2]);
const AUTH = "seller_agents_control_auth_v2";
const source = fs.readFileSync(
  new URL("../../../../packages/control-client/src/client.js", import.meta.url),
  "utf8",
);

// CW-03: the hand-written public API has one canWork property, with the
// checkpoint-backed implementation as its only authority definition.
assert.equal((source.match(/\bcanWork\s*:/g) || []).length, 1);
assert.match(
  source,
  /canWork:\s*async\s*\(\)\s*=>[\s\S]*cacheAuthorizationCheckpoint\(\)/,
);
assert.doesNotMatch(
  source,
  /canWork:\s*async\s*\(\)\s*=>\s*Boolean\(state\.authority\s*&&\s*state\.credentials\)/,
);

const clock = { wall: Date.now(), mono: 1000 };
const backing = { local: {}, session: {} };
const seeded = await makeWorker(runtime, {
  backing,
  wallClock: () => clock.wall,
  monotonicClock: () => clock.mono,
});
assert.equal(await seeded.call("SellerAgentsControlClient.canWork"), true);
seeded.close();

// CW-01/02: the persisted compatibility bit is not bearer authority. A valid
// signed cache remains usable without a network call after restart.
backing.local[AUTH].authority.workAllowed = false;
const denied = await makeWorker(runtime, {
  backing,
  seedAuthority: false,
  wallClock: () => clock.wall,
  monotonicClock: () => clock.mono,
  fetch: async () => {
    throw new Error("stale cached authority must not need network access");
  },
});
assert.equal(await denied.call("SellerAgentsControlClient.canWork"), true);
const status = await denied.call("SellerAgentsControlClient.status");
assert.equal(status.authenticated, true);
assert.equal(status.workAllowed, true);
assert.ok(backing.local[AUTH].credentials);
assert.ok(backing.local[AUTH].authority);
denied.close();

console.log(
  JSON.stringify({ status: "PASS", cases: ["CW-01", "CW-02", "CW-03"] }),
);
