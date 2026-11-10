// Run: node tests/regression/portal/otp-login-lifecycle.mjs [source-root]
// Executes exact LoginContent logic before JSX with explicit hook, router and
// controlPlane ports. This is not a React renderer, browser or API/mail proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const startedAt = new Date().toISOString();
const root = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url)),
);
const pagePath = "apps/portal/app/login/page.tsx";
const helperPath = "apps/portal/lib/otp-outcome.ts";
const source = readFileSync(path.join(root, pagePath), "utf8");
const start = source.indexOf("function LoginContent() {");
const end = source.indexOf("\n  return (\n    <main>", start);
assert.ok(start >= 0 && end > start, "exact LoginContent slice must exist");
const executable = stripTypeScriptTypes(
  source.slice(start, end) +
    "\nreturn { request, verify, restart, setEmail, setCode, challenge, email, code, error, pending, verifyAttempt, inFlight };\n}",
);
const otp = await import(pathToFileURL(path.join(root, helperPath)).href);
const { safeReturnTo } = await import(
  pathToFileURL(path.join(root, "apps/portal/lib/return-to.ts")).href
);
const challengeId = "22222222-2222-4222-8222-222222222222";
const expiry = "2030-10-23T05:30:00.000Z";
const accepted = { status: "accepted", challengeId, expiresAt: expiry };
const authenticated = { status: "authenticated", expiresAt: expiry };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

function mount(send, returnTo = "/devices") {
  let cursor = 0;
  let mounted = true;
  let keys = 0;
  const hooks = [];
  const effects = [];
  const calls = [];
  const navigations = [];
  const disposedWrites = [];
  const context = vm.createContext({
    ...otp,
    safeReturnTo,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++keys).padStart(12, "0")}` },
    useRouter: () => ({ replace: (to) => navigations.push(to) }),
    useSearchParams: () => new URLSearchParams({ returnTo }),
    useState(initial) {
      const slot = cursor++;
      hooks[slot] ??= { kind: "state", value: initial };
      assert.equal(hooks[slot].kind, "state");
      return [hooks[slot].value, (value) => {
        if (!mounted) disposedWrites.push(slot);
        hooks[slot].value = value;
      }];
    },
    useRef(initial) {
      const slot = cursor++;
      hooks[slot] ??= { kind: "ref", ref: { current: initial } };
      assert.equal(hooks[slot].kind, "ref");
      return hooks[slot].ref;
    },
    useEffect(setup, dependencies) {
      const slot = cursor++;
      assert.equal(dependencies.length, 0, "only mount lifecycle is ported");
      if (!hooks[slot]) {
        const effect = { setup, cleanup: undefined };
        hooks[slot] = { kind: "effect" };
        effects.push(effect);
      }
    },
    controlPlane: (url, init) => {
      calls.push({ url, init });
      return send(url, init);
    },
  });
  vm.runInContext(executable, context);
  const render = () => {
    cursor = 0;
    return vm.runInContext("LoginContent()", context);
  };
  render();
  for (const effect of effects) effect.cleanup = effect.setup();
  const dispose = () => {
    for (const effect of effects) effect.cleanup?.();
    mounted = false;
  };
  return {
    view: render, calls, navigations, disposedWrites, dispose,
    replayMountEffects() {
      for (const effect of effects) effect.cleanup?.();
      for (const effect of effects) effect.cleanup = effect.setup();
    },
  };
}

async function challenge(flow) {
  flow.view().setEmail("otp-lifecycle@example.test");
  await flow.view().request();
  assert.equal(flow.view().challenge, challengeId);
  flow.view().setCode("111111");
}
const cases = [];
const check = (id, run) => cases.push({ id, run });

check("mounted documented success navigates once", async () => {
  const flow = mount(async (url) =>
    url.endsWith("/request") ? json(accepted, 202) : json(authenticated),
  );
  await challenge(flow);
  await flow.view().verify();
  assert.deepEqual(flow.navigations, ["/devices"]);
  assert.equal(flow.view().pending, false);
  assert.equal(flow.view().verifyAttempt.current, undefined);
});

for (const phase of ["request", "verify"]) {
  const outcomes = [
    ["success", () => phase === "request" ? json(accepted, 202) : json(authenticated)],
    ["expired-or-rejected", () => json({ error: { code: "AUTH_OTP_INVALID" } }, 401)],
    ["rate-limited", () => json({}, 429)],
    ["beta-closed", () => json({ error: { code: "BETA_CLOSED" } }, 403)],
    ["server-error", () => json({}, 503)],
    ["malformed", () => json({}, phase === "request" ? 202 : 200)],
    ["network-rejected", () => { throw new TypeError("synthetic transport unavailable"); }],
  ];
  for (const [name, response] of outcomes) {
    check(`${phase} ${name} after disposal is inert`, async () => {
      const gate = deferred();
      const flow = mount(async (url) => {
        if (!url.endsWith(`/${phase}`)) return json(accepted, 202);
        await gate.promise;
        return response();
      });
      if (phase === "verify") await challenge(flow);
      const pending = flow.view()[phase]();
      assert.equal(flow.view().pending, true);
      const retainedAttempt = flow.view().verifyAttempt;
      flow.dispose();
      gate.resolve();
      await pending;
      assert.deepEqual(flow.navigations, [], "disposed login cannot navigate");
      assert.deepEqual(flow.disposedWrites, [], "disposed login cannot update state");
      assert.equal(retainedAttempt.current, undefined, "dispose clears retained retry identity");
    });
  }

  check(`${phase} disposal during body parsing is inert`, async () => {
    const body = deferred();
    let parsing = false;
    const flow = mount(async (url) => {
      if (!url.endsWith(`/${phase}`)) return json(accepted, 202);
      return {
        ok: true, status: phase === "request" ? 202 : 200,
        json: () => { parsing = true; return body.promise; },
      };
    });
    if (phase === "verify") await challenge(flow);
    const pending = flow.view()[phase]();
    await settle();
    assert.equal(parsing, true);
    flow.dispose();
    body.resolve(phase === "request" ? accepted : authenticated);
    await pending;
    assert.deepEqual(flow.navigations, []);
    assert.deepEqual(flow.disposedWrites, []);
  });

  check(`${phase} remains single flight before any rerender`, async () => {
    const gate = deferred();
    const flow = mount(async (url) => {
      if (!url.endsWith(`/${phase}`)) return json(accepted, 202);
      await gate.promise;
      return phase === "request" ? json(accepted, 202) : json({}, 401);
    });
    if (phase === "verify") await challenge(flow);
    const handlers = flow.view();
    const first = handlers[phase]();
    await handlers[phase]();
    handlers.restart();
    assert.equal(flow.calls.filter((call) => call.url.endsWith(`/${phase}`)).length, 1);
    gate.resolve();
    await first;
    assert.equal(flow.view().pending, false);
    if (phase === "verify") assert.equal(flow.view().challenge, challengeId);
  });

  check(`${phase} retained handler cannot submit after disposal`, async () => {
    const flow = mount(async () => json(accepted, 202));
    if (phase === "verify") await challenge(flow);
    const handler = flow.view()[phase];
    const before = flow.calls.length;
    flow.dispose();
    await handler();
    assert.equal(flow.calls.length, before, "no request from a disposed consumer");
    assert.deepEqual(flow.disposedWrites, []);
  });
}

check("expiry, retry identity, correction and explicit restart are preserved", async () => {
  const flow = mount(async (url) =>
    url.endsWith("/request") ? json(accepted, 202) : json({}, 401),
  );
  await challenge(flow);
  await flow.view().verify();
  assert.match(flow.view().error, /Неверный или просроченный код/);
  await flow.view().verify();
  flow.view().setCode("222222");
  await flow.view().verify();
  const attempts = flow.calls.filter((call) => call.url.endsWith("/verify"));
  assert.equal(attempts[0].init.headers["idempotency-key"], attempts[1].init.headers["idempotency-key"]);
  assert.notEqual(attempts[0].init.headers["idempotency-key"], attempts[2].init.headers["idempotency-key"]);
  flow.view().restart();
  assert.equal(flow.view().challenge, undefined);
  assert.equal(flow.view().code, "");
  assert.equal(flow.view().error, "");
  assert.equal(flow.view().email, "otp-lifecycle@example.test");
  assert.equal(flow.calls.length, 4, "restart sends no hidden OTP request");
  assert.deepEqual(flow.navigations, []);
});

check("mount effect setup-cleanup-setup keeps current login usable", async () => {
  const flow = mount(async (url) =>
    url.endsWith("/request") ? json(accepted, 202) : json(authenticated),
  );
  flow.replayMountEffects();
  await challenge(flow);
  await flow.view().verify();
  assert.deepEqual(flow.navigations, ["/devices"]);
});

check("old completion cannot navigate or release a new page's verification", async () => {
  const oldGate = deferred(), newGate = deferred();
  const make = (gate) => mount(async (url) => {
    if (url.endsWith("/request")) return json(accepted, 202);
    await gate.promise;
    return json(authenticated);
  });
  const old = make(oldGate);
  await challenge(old);
  const oldPending = old.view().verify();
  old.dispose();
  const current = make(newGate);
  await challenge(current);
  const newPending = current.view().verify();
  oldGate.resolve();
  await oldPending;
  assert.deepEqual(old.navigations, []);
  assert.deepEqual(old.disposedWrites, []);
  assert.equal(current.view().pending, true);
  await current.view().verify();
  assert.equal(current.calls.filter((call) => call.url.endsWith("/verify")).length, 1);
  newGate.resolve();
  await newPending;
  assert.deepEqual(current.navigations, ["/devices"]);
});

const results = [];
for (const { id, run } of cases) {
  try { await run(); results.push({ id, ok: true }); }
  catch (error) { results.push({ id, ok: false, error: error.message }); }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const passed = results.filter((result) => result.ok).length;
console.log(JSON.stringify({
  evidence: "SOURCE_LOGIC_WITH_EXPLICIT_HOOK_ROUTER_TRANSPORT_PORTS",
  startedAt, completedAt: new Date().toISOString(), node: process.version,
  sourceRoot: root, pageSha256: hash(source), helperSha256: hash(readFileSync(path.join(root, helperPath))),
  passed, total: results.length, results,
  actualReactNextBrowserApiDbMail: "NOT_RUN",
}, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
