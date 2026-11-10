// New portal logout consumer, exact function logic with explicit hook/HTTP ports.
// Baseline absence is a missing feature, not an existing incorrect HTTP response.
// This does not render React/Next or execute API/auth/cookie/DB operations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const startedAt = new Date().toISOString();
const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url)));
const pagePath = "apps/portal/app/logout/page.tsx";
const source = existsSync(path.join(root, pagePath)) ? readFileSync(path.join(root, pagePath), "utf8") : null;
const home = readFileSync(path.join(root, "apps/portal/app/page.tsx"), "utf8");
let executable;
if (source) {
  const start = source.indexOf("export default function Logout() {");
  const end = source.indexOf("\n  return (\n    <main>", start);
  assert.ok(start >= 0 && end > start, "exact consumer logic boundary required");
  executable = stripTypeScriptTypes(source.slice(start, end).replace("export default ", "") + "\nreturn { state, logout };\n}");
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const confirmed = () => new Response(null, { status: 204 });
function mount(send = async () => confirmed(), failNavigation = false) {
  assert.ok(executable, "missing portal logout consumer in this exact source baseline");
  let cursor = 0, mounted = true;
  const hooks = [], effects = [], calls = [], navigations = [], disposedWrites = [];
  const context = vm.createContext({
    controlPlane: (url, init) => { calls.push({ url, init }); return Promise.resolve().then(() => send(url, init)); },
    location: { replace(target) { navigations.push(target); if (failNavigation) throw Error("fixture navigation blocked"); } },
    useState(initial) {
      const slot = cursor++; if (!hooks[slot]) hooks[slot] = { kind: "state", value: initial };
      assert.equal(hooks[slot].kind, "state");
      return [hooks[slot].value, value => { if (!mounted) disposedWrites.push(slot); hooks[slot].value = typeof value === "function" ? value(hooks[slot].value) : value; }];
    },
    useRef(initial) {
      const slot = cursor++; if (!hooks[slot]) hooks[slot] = { kind: "ref", value: { current: initial } };
      assert.equal(hooks[slot].kind, "ref"); return hooks[slot].value;
    },
    useEffect(setup, deps) {
      const slot = cursor++; assert.deepEqual(Array.from(deps), []);
      if (!hooks[slot]) { const effect = { setup, cleanup: undefined }; hooks[slot] = { kind: "effect", effect }; effects.push(effect); }
    },
  });
  vm.runInContext(executable, context);
  const view = () => { cursor = 0; return vm.runInContext("Logout()", context); };
  view(); for (const effect of effects) effect.cleanup = effect.setup();
  return {
    view, calls, navigations, disposedWrites,
    dispose() { for (const effect of effects) effect.cleanup?.(); mounted = false; },
    replay() { for (const effect of effects) effect.cleanup?.(); for (const effect of effects) effect.cleanup = effect.setup(); },
    async flush() { for (let i = 0; i < 20; i++) { await Promise.resolve(); view(); } },
  };
}
const cases = [], check = (id, run) => cases.push({ id, run });
check("existing homepage offers explicit logout route", () => assert.match(home, /<a href="\/logout">Sign out<\/a>/));
check("logout control is an explicit button and has a sign-in fallback", () => {
  assert.ok(source, "missing consumer"); assert.match(source, /type="button"/); assert.match(source, /onClick=\{\(\) => void logout\(\)\}/); assert.match(source, /href="\/login"/);
});
check("render and repeated render send no request", async () => {
  const f = mount(); f.view(); await f.flush(); assert.equal(f.calls.length, 0); assert.equal(f.view().state, "ready");
});
check("only explicit action sends exact body-free POST", async () => {
  const f = mount(); await f.view().logout(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "/v1/auth/logout"); assert.equal(f.calls[0].init.method, "POST"); assert.equal(f.calls[0].init.body, undefined); assert.equal(f.calls[0].init.headers, undefined);
});
check("confirmed204 fully navigates to login and locks completion", async () => {
  const f = mount(); await f.view().logout(); assert.equal(f.view().state, "done"); assert.deepEqual(f.navigations, ["/login"]); await f.view().logout(); assert.equal(f.calls.length, 1);
});
check("empty204 does not parse a JSON body", async () => {
  const f = mount(async () => ({ status: 204, json() { throw Error("204 body must not be read"); } })); await f.view().logout(); assert.equal(f.view().state, "done"); assert.deepEqual(f.navigations, ["/login"]);
});
for (const status of [200, 202, 401, 403, 404, 429, 500, 503]) check(`status${status} is unconfirmed and never navigates`, async () => {
  const f = mount(async () => new Response("fixture", { status })); await f.view().logout(); await f.flush(); assert.equal(f.view().state, "unconfirmed"); assert.equal(f.navigations.length, 0); assert.equal(f.calls.length, 1);
});
check("network loss remains unconfirmed without automatic retry", async () => {
  const f = mount(async () => { throw Error("fixture transport error with sensitive detail"); }); await f.view().logout(); await f.flush(); assert.equal(f.view().state, "unconfirmed"); assert.equal(f.navigations.length, 0); assert.equal(f.calls.length, 1); assert.doesNotMatch(f.view().state, /sensitive/);
});
check("explicit retry after unconfirmed result uses idempotent logout endpoint", async () => {
  let count = 0; const f = mount(async () => ++count === 1 ? new Response(null, { status: 503 }) : confirmed()); await f.view().logout(); await f.flush(); assert.equal(f.calls.length, 1); await f.view().logout(); assert.equal(f.calls.length, 2); assert.equal(f.view().state, "done"); assert.deepEqual(f.navigations, ["/login"]);
});
check("two clicks before paint send one POST", async () => {
  const wait = deferred(), f = mount(() => wait.promise); const old = f.view(); const a = old.logout(), b = old.logout(); await f.flush(); assert.equal(f.calls.length, 1); assert.equal(f.view().state, "pending"); wait.resolve(confirmed()); await Promise.all([a, b]); assert.equal(f.calls.length, 1);
});
check("late204 after true cleanup cannot navigate or write", async () => {
  const wait = deferred(), f = mount(() => wait.promise); const action = f.view().logout(); await f.flush(); f.dispose(); wait.resolve(confirmed()); await action; assert.equal(f.navigations.length, 0); assert.equal(f.disposedWrites.length, 0);
});
check("late failure after cleanup cannot write", async () => {
  const wait = deferred(), f = mount(() => wait.promise); const action = f.view().logout(); await f.flush(); f.dispose(); wait.resolve(new Response(null, { status: 503 })); await action; assert.equal(f.disposedWrites.length, 0);
});
check("retained handler after cleanup sends no POST", async () => {
  const f = mount(), old = f.view().logout; f.dispose(); await old(); assert.equal(f.calls.length, 0);
});
check("StrictMode setup-cleanup-setup never performs automatic logout", async () => {
  const f = mount(); f.replay(); await f.flush(); assert.equal(f.calls.length, 0); await f.view().logout(); assert.equal(f.calls.length, 1); assert.equal(f.view().state, "done");
});
check("previous effect generation cannot finish current instance", async () => {
  const wait = deferred(), f = mount(() => wait.promise); const action = f.view().logout(); await f.flush(); f.replay(); await f.flush(); wait.resolve(confirmed()); await action; assert.equal(f.navigations.length, 0); assert.equal(f.view().state, "ready");
});
check("confirmed server result survives a navigation exception", async () => {
  const f = mount(undefined, true); await f.view().logout(); assert.equal(f.view().state, "done"); await f.view().logout(); assert.equal(f.calls.length, 1);
});
check("portal-only scope and uncertain result are explicit without local secret mutation", () => {
  assert.ok(source, "missing consumer"); assert.match(source, /does not revoke devices or delete locally saved marketplace keys/); assert.match(source, /session may still be active/); assert.doesNotMatch(source, /localStorage|indexedDB|document\.cookie|\/v1\/devices/);
});
const results = [];
for (const item of cases) {
  try { await item.run(); results.push({ id: item.id, pass: true }); }
  catch (error) { results.push({ id: item.id, pass: false, error: String(error) }); }
}
console.log(JSON.stringify({ startedAt, completedAt: new Date().toISOString(), node: process.version, sourcePath: pagePath, sourcePresent: source !== null, sourceSha256: source === null ? null : createHash("sha256").update(source).digest("hex"), homeSha256: createHash("sha256").update(home).digest("hex"), runnerSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"), level: "exact new UI function logic with hook/controlPlane/location ports; structural home/button binding; actual React/Next/API/auth/cookies/DB NOT_RUN", baselineQualification: "absent consumer fails feature cases explicitly; not an observed bad logout HTTP response", passed: results.filter(x => x.pass).length, total: results.length, results }, null, 2));
process.exitCode = results.every(x => x.pass) ? 0 : 1;
