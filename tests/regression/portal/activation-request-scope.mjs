// Exact activation component logic with explicit hook/effect/router/HTTP ports.
// The public React key binding is checked structurally; no React/Next/API/DB runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const startedAt = new Date().toISOString();
const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url)));
const page = "apps/portal/app/activate/page.tsx";
const source = readFileSync(path.join(root, page), "utf8");
const keyed = /<ActivationRequest\s+key=\{id\s*\?\?\s*""\}\s+id=\{id\}\s*\/>/.test(source);
const name = source.includes("function ActivationRequest(") ? "ActivationRequest" : "ActivateContent";
const start = source.indexOf(`function ${name}(`);
const end = source.indexOf("\n  return (\n    <main>", start);
assert.ok(start >= 0 && end > start, "exact component logic boundary required");
const executable = stripTypeScriptTypes(source.slice(start, end) +
  "\nreturn { accounts, preview, accountId, userCode, message, act, setAccountId, setUserCode, busy: typeof busy === 'undefined' ? false : busy, closed: typeof closed === 'undefined' ? false : closed, ready: typeof ready === 'undefined' ? Boolean(preview) : ready };\n}");
const { deviceClientMetadataDisplay } = await import(pathToFileURL(path.join(root, "apps/portal/lib/device-client-metadata.ts")).href);
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const accounts = [{ id: account, displayName: "Fixture account", status: "ACTIVE" }];
const preview = (id, label = id) => ({ status: "pending", authorizationId: id, clientType: "browser_extension", clientMetadata: { state: "WITHHELD" }, deviceLabel: label, expiresAt: "2030-11-10T10:00:00.000Z" });
const receipt = (id, kind) => ({ status: kind === "approve" ? "approved" : "denied", authorizationId: id, ...(kind === "approve" ? { expiresAt: "2030-11-10T10:00:00.000Z" } : {}) });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const unhandled = [];
process.on("unhandledRejection", error => unhandled.push(String(error)));

function mount(send, initialId = A) {
  let id = initialId, instance;
  const calls = [], redirects = [], disposedWrites = [];
  const router = { replace: target => redirects.push(target) };
  const instances = [];
  function create() {
    let cursor = 0, mounted = true;
    const hooks = [], pending = [];
    const context = vm.createContext({
      deviceClientMetadataDisplay,
      useSearchParams: () => new URLSearchParams(id === null ? {} : { authorizationId: id }),
      useRouter: () => router,
      controlPlane: (url, init) => { calls.push({ url, init }); return Promise.resolve().then(() => send(url, init)); },
      useState(initial) {
        const slot = cursor++;
        if (!hooks[slot]) hooks[slot] = { kind: "state", value: initial };
        assert.equal(hooks[slot].kind, "state");
        return [hooks[slot].value, value => {
          if (!mounted) disposedWrites.push(slot);
          hooks[slot].value = typeof value === "function" ? value(hooks[slot].value) : value;
        }];
      },
      useRef(initial) {
        const slot = cursor++;
        if (!hooks[slot]) hooks[slot] = { kind: "ref", value: { current: initial } };
        assert.equal(hooks[slot].kind, "ref"); return hooks[slot].value;
      },
      useEffect(setup, deps) {
        const slot = cursor++, old = hooks[slot];
        if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
          const effect = { setup, cleanup: old?.effect.cleanup };
          hooks[slot] = { kind: "effect", deps, effect }; pending.push(effect);
        }
      },
    });
    vm.runInContext(executable, context);
    const value = {
      render() { cursor = 0; context.props = { id }; return vm.runInContext(`${name}(props)`, context); },
      commit() { for (const effect of pending.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup(); } },
      dispose() { for (const hook of hooks) if (hook.kind === "effect") hook.effect.cleanup?.(); mounted = false; },
      replay() { for (const hook of hooks) if (hook.kind === "effect") hook.effect.cleanup?.(); for (const hook of hooks) if (hook.kind === "effect") hook.effect.cleanup = hook.effect.setup(); },
    };
    instances.push(value); return value;
  }
  instance = create(); instance.render(); instance.commit();
  const flow = {
    calls, redirects, disposedWrites,
    view: () => instance.render(),
    commit: () => instance.commit(),
    change(next, commit = true) { const old = id; id = next; if (keyed && old !== next) { instance.dispose(); instance = create(); } instance.render(); if (commit) instance.commit(); },
    dispose: () => instance.dispose(),
    replay: () => instance.replay(),
    async flush() { for (let i = 0; i < 25; i++) { await Promise.resolve(); instance.render(); instance.commit(); } },
    async input(code = "ABCD-EFGH") { flow.view().setUserCode(code); flow.view().setAccountId(account); await flow.flush(); },
  };
  return flow;
}
const boot = async (send = async url => json(preview(url.split("/").at(-1))), id = A) => {
  const flow = mount((url, init) => url === "/v1/accounts" ? json({ accounts }) : send(url, init), id);
  await flow.flush(); return flow;
};
const posts = f => f.calls.filter(call => call.init?.method === "POST");
const cases = [], check = (id, run) => cases.push({ id, run });

check("public keyed request binding exists", () => assert.ok(keyed));
check("mounted preview preserves WITHHELD and exact request identity", async () => {
  const f = await boot(); assert.equal(f.view().preview.authorizationId, A); assert.equal(f.view().preview.clientMetadata.state, "WITHHELD"); assert.equal(f.view().accountId, account);
});
check("query change hides previous preview before effect commit", async () => {
  const f = await boot(); f.change(B, false); assert.equal(f.view().preview, undefined); f.commit(); await f.flush();
});
check("query change clears code and account before commit", async () => {
  const f = await boot(); await f.input(); f.change(B, false); assert.equal(f.view().userCode, ""); assert.equal(f.view().accountId, ""); f.commit(); await f.flush();
});
check("late old preview cannot replace current request", async () => {
  const old = deferred(); const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : url.endsWith(A) ? old.promise : json(preview(B)));
  f.change(B); await f.flush(); old.resolve(json(preview(A))); await f.flush(); assert.equal(f.view().preview.authorizationId, B);
});
check("A-B-A rejects first A generation", async () => {
  const old = deferred(); let count = 0;
  const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : url.endsWith(A) && ++count === 1 ? old.promise : json(preview(url.split("/").at(-1), "new")));
  f.change(B); await f.flush(); f.change(A); await f.flush(); old.resolve(json(preview(A, "old"))); await f.flush(); assert.equal(f.view().preview.deviceLabel, "new");
});
check("late preview JSON body cannot replace new request", async () => {
  const body = deferred(); const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : url.endsWith(A) ? { ok: true, status: 200, json: () => body.promise } : json(preview(B)));
  await f.flush(); f.change(B); await f.flush(); body.resolve(preview(A)); await f.flush(); assert.equal(f.view().preview.authorizationId, B);
});
check("late old401 cannot redirect current request", async () => {
  const old = deferred(); const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : url.endsWith(A) ? old.promise : json(preview(B)));
  f.change(B); await f.flush(); old.resolve(json({}, 401)); await f.flush(); assert.equal(f.redirects.length, 0);
});
check("disposed preview completion cannot write", async () => {
  const wait = deferred(); const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : wait.promise); f.dispose(); wait.resolve(json(preview(A))); await f.flush(); assert.equal(f.disposedWrites.length, 0);
});
for (const id of [null, "not-a-uuid"]) check(`invalid request ${id} sends no action`, async () => {
  const f = await boot(undefined, id); await f.input(); await f.view().act("approve"); assert.equal(posts(f).length, 0);
});
check("unloaded preview sends no action", async () => {
  const wait = deferred(); const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : wait.promise); await f.input(); const action = f.view().act("approve"); await f.flush(); assert.equal(posts(f).length, 0); wait.resolve(json(preview(A))); await action; await f.flush();
});
check("unavailable preview sends no action", async () => {
  const f = await boot(async () => json({}, 404)); await f.input(); await f.view().act("approve"); assert.equal(posts(f).length, 0);
});
check("preview identity mismatch is unavailable", async () => {
  const f = await boot(async () => json(preview(B))); assert.equal(f.view().preview, undefined); assert.match(f.view().message, /unavailable/i);
});
for (const kind of ["approve", "deny"]) {
  check(`current ${kind} confirms documented receipt only`, async () => {
    const f = await boot(async (url, init) => init ? json(receipt(A, kind)) : json(preview(A))); await f.input(); await f.view().act(kind); await f.flush(); assert.match(f.view().message, kind === "approve" ? /Device approved\. Return to the extension/ : /Device request denied/); assert.equal(posts(f).length, 1); const payload = JSON.parse(posts(f)[0].init.body); assert.equal(payload.userCode, "ABCD-EFGH"); assert.equal("accountId" in payload, kind === "approve");
  });
  check(`late ${kind} cannot replace current request message`, async () => {
    const wait = deferred(); const f = await boot(async (url, init) => init ? wait.promise : json(preview(url.split("/").at(-1)))); await f.input(); const action = f.view().act(kind); await f.flush(); f.change(B); await f.flush(); wait.resolve(json(receipt(A, kind))); await action; await f.flush(); assert.equal(f.view().message, ""); assert.equal(f.view().preview.authorizationId, B);
  });
}
check("opposite double click before paint sends one POST", async () => {
  const wait = deferred(); const f = await boot(async (url, init) => init ? wait.promise : json(preview(A))); await f.input(); const v = f.view(), first = v.act("approve"), second = v.act("deny"); await f.flush(); const count = posts(f).length; wait.resolve(json(receipt(A, "approve"))); await Promise.all([first, second]); assert.equal(count, 1);
});
check("retained old handler after query change sends no POST", async () => {
  const f = await boot(); await f.input(); const old = f.view().act; f.change(B); await f.flush(); await old("approve"); assert.equal(posts(f).length, 0);
});
check("late action JSON body cannot write after dispose", async () => {
  const body = deferred(); const f = await boot(async (url, init) => init ? { ok: true, status: 200, json: () => body.promise } : json(preview(A))); await f.input(); const action = f.view().act("approve"); await f.flush(); f.dispose(); body.resolve(receipt(A, "approve")); await action; await f.flush(); assert.equal(f.disposedWrites.length, 0);
});
for (const bad of [{}, receipt(B, "approve"), receipt(A, "deny")]) check(`unconfirmed200 ${JSON.stringify(bad)} never reports approval`, async () => {
  const f = await boot(async (url, init) => init ? json(bad) : json(preview(A))); await f.input(); await f.view().act("approve"); await f.flush(); assert.doesNotMatch(f.view().message, /^Device approved/); assert.match(f.view().message, /not be confirmed/i); await f.view().act("approve"); assert.equal(posts(f).length, 1);
});
check("network mutation outcome is unknown and not retried", async () => {
  const f = await boot(async (url, init) => { if (init) throw Error("fixture transport"); return json(preview(A)); }); await f.input(); await f.view().act("approve"); await f.flush(); assert.match(f.view().message, /not be confirmed/i); await f.view().act("approve"); assert.equal(posts(f).length, 1);
});
check("current401 redirects with exact request returnTo", async () => {
  const f = await boot(async () => json({}, 401)); assert.deepEqual(f.redirects, [`/login?returnTo=${encodeURIComponent(`/activate?authorizationId=${A}`)}`]);
});
check("current non401 failure stays unavailable", async () => {
  const f = await boot(async () => json({}, 503)); assert.equal(f.redirects.length, 0); assert.match(f.view().message, /unavailable/i);
});
check("StrictMode effect cleanup rejects first setup preview", async () => {
  const wait = deferred(); let reads = 0;
  const f = mount(url => url === "/v1/accounts" ? json({ accounts }) : ++reads === 1 ? wait.promise : json(preview(A, "second")));
  await f.flush(); f.replay(); await f.flush(); wait.resolve(json(preview(A, "first"))); await f.flush(); assert.equal(f.view().preview.deviceLabel, "second");
});
check("preview JSON rejection is caught and unavailable", async () => {
  const before = unhandled.length; const f = await boot(async () => ({ ok: true, status: 200, json: async () => { throw Error("fixture JSON"); } })); await new Promise(done => setImmediate(done)); assert.equal(unhandled.length, before); assert.match(f.view().message, /unavailable/i);
});

// ACT-01: successful status without the documented200 receipt is unconfirmed.
// These are synthetic source-port outcomes, not an authoritative API reload.
for (const status of [201, 202, 204, 206, 205, 207, 226, 299]) {
  for (const kind of ["approve", "deny"]) {
    check(`ACT-01 status${status}/${kind} stays closed until authoritative reload`, async () => {
      const observedStatuses = [];
      const f = await boot(async (url, init) => {
        if (!init) return json(preview(A));
        const response = new Response(null, { status });
        observedStatuses.push(response.status);
        return response;
      });
      await f.input();
      const readsBefore = f.calls.filter(call => !call.init?.method).length;
      await f.view().act(kind);
      await f.flush();
      assert.equal(posts(f).length, 1, "no automatic mutation retry");
      // Both subsequent explicit clicks must be inert on the old preview.
      await f.view().act(kind);
      await f.view().act(kind === "approve" ? "deny" : "approve");
      await f.flush();
      assert.equal(posts(f).length, 1, "old preview cannot authorize a second POST");
      assert.deepEqual(observedStatuses, [status], "fixture returned the intended HTTP status");
      assert.equal(f.view().closed, true);
      assert.equal(f.view().ready, false);
      assert.match(f.view().message, /not be confirmed.*Reload/i);
      assert.equal(f.calls.filter(call => !call.init?.method).length, readsBefore,
        "no fresh GET/reload is fabricated by the closed outcome");
      assert.equal(f.redirects.length, 0);
    });
  }
}

for (const status of [400, 401, 403, 409, 429, 503]) {
  for (const kind of ["approve", "deny"]) {
    check(`ACT-01 preserves documented rejection${status}/${kind}`, async () => {
      const f = await boot(async (url, init) => init ? new Response(null, { status }) : json(preview(A)));
      await f.input();
      await f.view().act(kind);
      await f.flush();
      assert.equal(f.view().message, "Request could not be completed.");
      assert.equal(f.view().closed, false);
      assert.equal(f.view().ready, true);
      assert.equal(posts(f).length, 1, "known failure sends no automatic retry");
      await f.view().act(kind);
      assert.equal(posts(f).length, 2, "preexisting explicit rejection behavior retained");
      assert.equal(f.redirects.length, 0);
    });
  }
}

check("ACT-01 new instance requires actual source GET responses before another action", async () => {
  const requests = [];
  let unexpected = true;
  const send = (url, init) => {
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === "/v1/accounts") return json({ accounts });
    if (!init) return json(preview(A));
    return unexpected ? new Response(null, { status: 202 }) : json(receipt(A, "approve"));
  };
  const old = mount(send);
  await old.flush(); await old.input(); await old.view().act("approve");
  await old.flush();
  assert.equal(old.view().ready, false);
  const getCount = requests.filter(call => call.method === "GET").length;
  await old.view().act("deny");
  assert.equal(requests.filter(call => call.method === "POST").length, 1);
  assert.equal(requests.filter(call => call.method === "GET").length, getCount);
  old.dispose();
  unexpected = false;
  const fresh = mount(send);
  // Before receiving a new preview, the newly mounted handler is also inert.
  fresh.view().setUserCode("ABCD-EFGH");
  fresh.view().setAccountId(account);
  await fresh.view().act("approve");
  assert.equal(requests.filter(call => call.method === "POST").length, 1);
  await fresh.flush(); await fresh.input();
  assert.equal(fresh.view().preview.authorizationId, A);
  assert.equal(requests.filter(call => call.method === "GET").length, getCount + 2);
  await fresh.view().act("approve");
  assert.equal(requests.filter(call => call.method === "POST").length, 2);
  assert.match(fresh.view().message, /^Device approved/);
});


const results = [];
for (const test of cases) {
  try { await test.run(); results.push({ id: test.id, pass: true }); }
  catch (error) { results.push({ id: test.id, pass: false, error: String(error) }); }
}
console.log(JSON.stringify({ startedAt, completedAt: new Date().toISOString(), node: process.version, sourcePath: page, sourceSha256: createHash("sha256").update(source).digest("hex"), runnerSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex"), level: "exact source-expression hook/HTTP ports; key binding structural only; actual React/Next/browser/API/DB NOT_RUN", passed: results.filter(r => r.pass).length, total: results.length, results }, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
