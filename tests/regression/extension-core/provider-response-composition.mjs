import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  process.argv[2] ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
);
const composition = JSON.parse(
  fs.readFileSync(path.join(root, "apps/extension/composition.json"), "utf8"),
);
const prelude = composition.worker_prelude || [];

const modules = [
  [
    "provider-response-policy.js",
    "SellerAgentsProviderResponsePolicy",
    "compileSchema",
  ],
  [
    "provider-response-verifier.js",
    "SellerAgentsProviderResponseVerifier",
    "verify",
  ],
  [
    "provider-response-disposition.js",
    "SellerAgentsProviderResponseDisposition",
    "success",
  ],
  [
    "provider-response-retention.js",
    "SellerAgentsProviderResponseRetention",
    "quarantineDefault",
  ],
  [
    "provider-outcome.js",
    "SellerAgentsProviderOutcome",
    "markResponseReceived",
  ],
].map(([filename, global, expectedFunction]) => ({
  relative: "packages/bridge-core/src/execution/" + filename,
  global,
  expectedFunction,
}));

const positions = modules.map(({ relative }) => {
  assert.equal(
    prelude.filter((entry) => entry === relative).length,
    1,
    relative + " must be in the worker prelude exactly once",
  );
  return prelude.indexOf(relative);
});
assert.deepEqual(
  positions,
  [...positions].sort((a, b) => a - b),
  "provider-neutral foundations must load policy -> verifier -> disposition -> retention -> outcome",
);

const calls = {
  provider: 0,
  browser: 0,
  credentials: 0,
  db: 0,
  service: 0,
  live_queue: 0,
};
const deny = (category) => () => {
  calls[category] += 1;
  throw new Error("UNEXPECTED_SIDE_EFFECT_" + category);
};
const denyProperties = (category) =>
  new Proxy({}, { get: deny(category), set: deny(category) });
const context = vm.createContext({
  fetch: deny("provider"),
  XMLHttpRequest: deny("provider"),
  WebSocket: deny("provider"),
  chrome: denyProperties("browser"),
  browser: denyProperties("browser"),
  indexedDB: denyProperties("db"),
  localStorage: denyProperties("credentials"),
  sessionStorage: denyProperties("credentials"),
  navigator: denyProperties("browser"),
  serviceWorker: denyProperties("service"),
  SellerAgentsLiveQueue: denyProperties("live_queue"),
});

let assertions = modules.length + 1;
for (const [
  index,
  { relative, global, expectedFunction },
] of modules.entries()) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const program = new vm.Script(source, { filename: relative });
  program.runInContext(context, { timeout: 1000 });

  assert.ok(
    context[global],
    global + " must become available at its load step",
  );
  assert.equal(
    typeof context[global][expectedFunction],
    "function",
    global + " must retain its accepted frozen API surface",
  );
  assert.equal(Object.isFrozen(context[global]), true);
  assertions += 3;

  const available = modules
    .map((entry) => entry.global)
    .filter((name) => Object.hasOwn(context, name));
  assert.deepEqual(
    available,
    modules.slice(0, index + 1).map((entry) => entry.global),
    "composed globals must be installed only by their ordered source module",
  );
  assertions += 1;
}
assert.deepEqual(calls, {
  provider: 0,
  browser: 0,
  credentials: 0,
  db: 0,
  service: 0,
  live_queue: 0,
});
assertions += 1;

console.log(
  JSON.stringify({
    status: "PASS",
    assertions,
    composed_globals: modules.map((module) => module.global),
    script_order: modules.map((module) => module.relative),
    external_calls: calls,
    provider_processing_activated: false,
    installed_or_live_acceptance: false,
  }),
);
