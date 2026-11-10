// Exact Devices logic before JSX, explicit hook/effect/router/HTTP ports.
// This is a source regression; it does not render React or call an API/DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const startedAt = new Date().toISOString();
const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url)));
const source = readFileSync(path.join(root, "apps/portal/app/devices/page.tsx"), "utf8");
const start = source.indexOf("export default function Devices() {");
const end = source.indexOf("\n  return (\n    <main>", start);
const selector = source.match(/onChange=\{\(e\) => (\w+)\(e.target.value\)\}/)?.[1];
assert.ok(start >= 0 && end > start && selector, "exact logic/selection binding required");
const script = stripTypeScriptTypes(source.slice(start, end).replace("export default ", "") +
  `\nreturn { accounts, account, devices, choose: ${selector}, load, revoke, loading: typeof loading === 'undefined' ? undefined : loading, error: typeof error === 'undefined' ? undefined : error };\n}`);
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const device = (label, status = "ACTIVE") => ({
  id: "33333333-3333-4333-8333-333333333333", label, status,
  clientMetadata: { state: "WITHHELD" }, activatedAt: null, lastSeenAt: null,
});
const accounts = [{ id: A, displayName: "A", status: "ACTIVE" }, { id: B, displayName: "B", status: "ACTIVE" }];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const devices = (label, status) => json({ devices: [device(label, status)], nextCursor: null });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const cases = [], check = (id, run) => cases.push({ id, run });

function mount(send) {
  let cursor = 0, mounted = true;
  const hooks = [], effects = [], calls = [], redirects = [], disposedWrites = [];
  const context = vm.createContext({
    location: { assign: to => redirects.push(to) },
    controlPlane: (url, init) => { calls.push({ url, init }); return send(url, init); },
    useState(initial) {
      const slot = cursor++; hooks[slot] ??= { kind: "state", value: initial };
      assert.equal(hooks[slot].kind, "state");
      return [hooks[slot].value, value => {
        if (!mounted) disposedWrites.push(slot);
        hooks[slot].value = typeof value === "function" ? value(hooks[slot].value) : value;
      }];
    },
    useRef(initial) {
      const slot = cursor++; hooks[slot] ??= { kind: "ref", value: { current: initial } };
      assert.equal(hooks[slot].kind, "ref"); return hooks[slot].value;
    },
    useEffect(setup, deps) {
      const slot = cursor++, previous = hooks[slot];
      const changed = !previous || deps.some((v, i) => !Object.is(v, previous.deps[i]));
      if (changed) {
        const effect = { setup, cleanup: previous?.effect.cleanup };
        hooks[slot] = { kind: "effect", deps, effect }; effects.push(effect);
      }
    },
  });
  vm.runInContext(script, context);
  const view = () => {
    cursor = 0; const value = vm.runInContext("Devices()", context);
    for (const effect of effects.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup(); }
    return value;
  };
  const flush = async () => { for (let i = 0; i < 25; i++) { await Promise.resolve(); view(); } };
  view();
  return {
    view, flush, calls, redirects, disposedWrites,
    dispose() {
      for (const hook of hooks) if (hook.kind === "effect") hook.effect.cleanup?.();
      mounted = false;
    },
  };
}
const bootstrap = async (send) => {
  const f = mount((url, init) => url === "/v1/accounts" ? Promise.resolve(json({ accounts })) : send(url, init));
  await f.flush(); return f;
};
const listCalls = flow => flow.calls.filter(c => c.url.startsWith("/v1/devices?"));
const labels = flow => Array.from(flow.view().devices, x => x.label);

check("mounted first account displays its actual DTO unchanged", async () => {
  const f = await bootstrap(async () => devices("A-device"));
  assert.equal(f.view().account, A); assert.deepEqual(labels(f), ["A-device"]);
  assert.equal(f.view().devices[0].clientMetadata.state, "WITHHELD");
  assert.equal(f.view().devices[0].lastSeenAt, null);
});

check("selection hides previous rows immediately before effects", async () => {
  const f = await bootstrap(async () => devices("A-device"));
  const v = f.view(); v.choose(B);
  assert.deepEqual(labels(f), []);
  await f.flush();
});

check("late A cannot overwrite completed B", async () => {
  const old = deferred();
  const f = await bootstrap(async url => url.includes(A) ? old.promise : devices("B-device"));
  f.view().choose(B); await f.flush();
  assert.deepEqual(labels(f), ["B-device"]);
  old.resolve(devices("A-old")); await f.flush();
  assert.equal(f.view().account, B); assert.deepEqual(labels(f), ["B-device"]);
});

check("A to B to A rejects the first A generation", async () => {
  const old = deferred(); let count = 0;
  const f = await bootstrap(async url => url.includes(A) && ++count === 1 ? old.promise : devices(url.includes(A) ? "A-new" : "B-device"));
  f.view().choose(B); await f.flush(); f.view().choose(A); await f.flush();
  old.resolve(devices("A-old")); await f.flush();
  assert.deepEqual(labels(f), ["A-new"]);
});

check("late JSON body cannot cross selection", async () => {
  const body = deferred();
  const f = await bootstrap(async url => url.includes(A) ? { ok: true, status: 200, json: () => body.promise } : devices("B-device"));
  f.view().choose(B); await f.flush();
  body.resolve({ devices: [device("A-body")], nextCursor: null }); await f.flush();
  assert.deepEqual(labels(f), ["B-device"]);
});

check("newest same-account read wins", async () => {
  let count = 0; const first = deferred(), second = deferred();
  const f = await bootstrap(async () => { count++; return count === 1 ? devices("initial") : count === 2 ? first.promise : second.promise; });
  const older = f.view().load(), newer = f.view().load();
  second.resolve(devices("newest")); await newer;
  first.resolve(devices("older")); await older;
  assert.deepEqual(labels(f), ["newest"]);
});

check("stale failure cannot finish the current account's loading", async () => {
  const old = deferred(), current = deferred();
  const f = await bootstrap(async url => url.includes(A) ? old.promise : current.promise);
  f.view().choose(B); await f.flush(); old.resolve(json({}, 503)); await f.flush();
  assert.equal(f.view().loading, true); assert.equal(f.view().error, "");
  current.resolve(devices("B-device")); await f.flush();
  assert.deepEqual(labels(f), ["B-device"]); assert.equal(f.view().loading, false);
});

for (const status of [403, 503]) check(`current HTTP ${status} is visible and explicit read retry recovers`, async () => {
  let failed = true;
  const f = await bootstrap(async () => failed ? json({}, status) : devices("recovered"));
  assert.match(f.view().error, /load/i); assert.deepEqual(labels(f), []);
  failed = false; await f.view().load(); await f.flush();
  assert.deepEqual(labels(f), ["recovered"]); assert.equal(f.view().error, "");
  assert.equal(f.calls.some(c => c.init?.method === "POST"), false);
});

for (const phase of ["network", "body"]) check(`current ${phase} failure settles without stale rows or thrown handler`, async () => {
  let fail = false;
  const f = await bootstrap(async () => {
    if (!fail) return devices("initial");
    if (phase === "network") throw new TypeError("synthetic unavailable");
    return new Response("not-json", { status: 200 });
  });
  fail = true; await assert.doesNotReject(() => f.view().load());
  assert.match(f.view().error, /load/i); assert.deepEqual(labels(f), []);
  assert.equal(f.view().loading, false);
});

check("account service outage stays an outage rather than a login redirect", async () => {
  const f = mount(async () => json({}, 503)); await f.flush();
  assert.deepEqual(f.redirects, []); assert.match(f.view().error, /account/i);
});

check("current invalid portal session redirects to login", async () => {
  const f = mount(async () => json({}, 401)); await f.flush();
  assert.deepEqual(f.redirects, ["/login?returnTo=%2Fdevices"]);
});

check("account response after disposal is inert", async () => {
  const gate = deferred(); const f = mount(async () => gate.promise);
  f.dispose(); gate.resolve(json({}, 401)); await f.flush();
  assert.deepEqual(f.redirects, []); assert.deepEqual(f.disposedWrites, []);
});

check("device response after disposal is inert", async () => {
  const gate = deferred(); const f = await bootstrap(async () => gate.promise);
  f.dispose(); gate.resolve(devices("late")); await f.flush();
  assert.deepEqual(f.disposedWrites, []);
});

check("old account revoke cannot refresh A under selected B", async () => {
  const gate = deferred(); const f = await bootstrap(async (url, init) => init?.method === "POST" ? gate.promise : devices(url.includes(A) ? "A-device" : "B-device"));
  const revoke = f.view().revoke(device("A-device").id);
  f.view().choose(B); await f.flush(); const before = listCalls(f).length;
  gate.resolve(json({ status: "revoked", deviceId: device("A-device").id })); await revoke; await f.flush();
  assert.equal(listCalls(f).length, before); assert.deepEqual(labels(f), ["B-device"]);
});

check("successful current revoke refreshes only its current account", async () => {
  let revoked = false;
  const f = await bootstrap(async (url, init) => {
    if (init?.method === "POST") { revoked = true; return json({ status: "revoked", deviceId: device("A-device").id }); }
    return devices("A-device", revoked ? "REVOKED" : "ACTIVE");
  });
  await f.view().revoke(device("A-device").id); await f.flush();
  assert.equal(f.view().devices[0].status, "REVOKED");
  assert.equal(listCalls(f).every(c => c.url.includes(A)), true);
});

for (const outcome of ["rejected", "unknown"]) check(`current revoke ${outcome} is visible and never auto-replays POST`, async () => {
  const f = await bootstrap(async (url, init) => {
    if (init?.method === "POST") {
      if (outcome === "unknown") throw new TypeError("synthetic lost response");
      return json({}, 403);
    }
    return devices("A-device");
  });
  await assert.doesNotReject(() => f.view().revoke(device("A-device").id));
  assert.match(f.view().error, outcome === "unknown" ? /unknown/i : /revok/i);
  assert.equal(f.calls.filter(c => c.init?.method === "POST").length, 1);
});

const results = [];
for (const { id, run } of cases) {
  try { await run(); results.push({ id, ok: true }); }
  catch (error) { results.push({ id, ok: false, error: error.message }); }
}
const passed = results.filter(v => v.ok).length;
console.log(JSON.stringify({ evidence: "SOURCE_LOGIC_WITH_EXPLICIT_HOOK_EFFECT_TRANSPORT_PORTS", startedAt,
  completedAt: new Date().toISOString(), node: process.version, root,
  pageSha256: createHash("sha256").update(source).digest("hex"), passed, total: results.length, results,
  actualReactNextApiDb: "NOT_RUN" }, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
