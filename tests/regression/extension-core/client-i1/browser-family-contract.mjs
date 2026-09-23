import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = readFileSync(resolve(ROOT, "packages/control-client/src/browser-identity.js"), "utf8");

function detect(userAgent) {
  const context = { navigator: { userAgent }, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.SellerAgentsBrowserIdentity.current()));
}

const cases = [
  ["chrome", "Mozilla/5.0 Chrome/153.0.8121.10 Safari/537.36", { family: "chrome", version: "153.0.8121.10" }],
  ["opera", "Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36 OPR/136.0.6008.22", { family: "opera", version: "136.0.6008.22" }],
  ["yandex", "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36 YaBrowser/26.8.1.1111", { family: "yandex_chromium", version: "26.8.1.1111" }],
  ["firefox", "Mozilla/5.0 Gecko/20100101 Firefox/156.0", { family: "firefox", version: "156.0" }],
  ["safari", "Mozilla/5.0 Version/18.6 Safari/605.1.15", { family: "safari", version: "18.6" }],
];
for (const [name, ua, expected] of cases) assert.deepEqual(detect(ua), expected, name);
assert.deepEqual(detect("Mozilla/5.0 Edg/153.0.0.0 Chrome/153.0.0.0 Safari/537.36"), { family: null, version: null });

const runtime = process.argv[2];
if (runtime) {
  const worker = resolve(runtime, "service_worker.js");
  assert.equal(existsSync(worker), true, "composed service worker missing");
  const composed = readFileSync(worker, "utf8");
  assert.match(composed, /SellerAgentsBrowserIdentity/, "browser identity module missing from composed worker");
  for (const family of ["chrome", "opera", "yandex_chromium", "firefox", "safari"]) {
    assert.equal(composed.includes(JSON.stringify(family)), true, `composed worker missing ${family}`);
  }
}
console.log(JSON.stringify({ status: "PASS", cases: cases.length, unsupported: "edge", composedRuntime: runtime || null }));
