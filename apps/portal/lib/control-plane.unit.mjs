import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as transport from "./control-plane.ts";
import { GET } from "../app/api/control-plane/[...path]/route.ts";

// Public synthetic bytes only. A zero MAC is structural data, never authority.
const A = "11112233-4455-4677-8899-aabbccddeeff";
const B = "22112233-4455-4677-8899-aabbccddeeff";
const O = "77112233-4455-4677-8899-aabbccddeeff";
const PB = "5tNhhlaYwGCufhhW17bk9NuBXePgUQ7FQwOn-lgrRyU";
const MARK = "__PUBLIC_CLIENT_GET_MARKER__";
const bytes = (s) => new TextEncoder().encode(s);
const copy = (v) => JSON.parse(JSON.stringify(v));
function permit(mode) {
  const p = { profile: "ACW1", kind: "write", keyVersion: 1, operation: mode,
    operationId: O, accountId: A, baseRevision: mode === "issue" ? 0 : 1,
    portalBinding: PB, issuedAt: 0, notAfter: 600000 };
  return { profile: "ACW1", metadata: { accountId: A, codeRevision: p.baseRevision,
    state: mode === "issue" ? "ABSENT" : "ACTIVE", createdAt: mode === "issue" ? null : 1000 },
    writePermit: { operationId: O,
      ticket: Buffer.from(JSON.stringify(p, Object.keys(p).sort())).toString("base64url") + "." + Buffer.alloc(32).toString("base64url"),
      issuedAt: 0, notAfter: 600000 } };
}
const I = permit("issue"), R = permit("rotate");
const U = { profile: "ACW1", metadata: I.metadata, receipt: { operationId: O, outcome: "UNKNOWN" } };
let registered = 0, entered = 0;
function unit(name, fn) { registered++; test(name, async () => { entered++; await fn(); }); }
after(() => { assert.equal(registered, entered); console.log(`CLIENT_CALLBACKS registered=${registered} entered=${entered}`); });
async function run(o = {}, invoke = () => transport.readConnectionCode(A, "issue")) {
  const oldFetch = globalThis.fetch, oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const raw = o.raw ?? bytes(JSON.stringify(o.body ?? I));
  const chunks = o.chunks ?? [raw];
  const calls = [], logs = []; let at = 0, cancels = 0, releases = 0, unbounded = 0;
  const oldConsole = {};
  const response = { status: o.status ?? 200, body: o.nullBody ? null : {
    getReader() {
      if (o.readerThrows) throw Error(MARK);
      return { async read() {
        if (at >= chunks.length) return { done: true };
        const value = chunks[at++]; if (value instanceof Error) throw value;
        return { done: false, value };
      }, cancel() { cancels++; return o.cancelRejects ? Promise.reject(Error(MARK)) : Promise.resolve(); },
      releaseLock() { releases++; } };
    },
  } };
  for (const m of ["arrayBuffer", "text", "json"]) response[m] = () => { unbounded++; throw Error(MARK); };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "pcp_csrf=__PUBLIC_CSRF__" } });
  globalThis.fetch = async (target, init) => {
    calls.push({ target, init }); if (o.fetchThrows) throw Error(MARK);
    if (o.defer) await o.defer(); return response;
  };
  for (const m of ["log", "warn", "error", "debug"]) { oldConsole[m] = console[m]; console[m] = (...args) => logs.push(args); }
  try {
    const result = await invoke(); await Promise.resolve();
    assert.equal(unbounded, 0); assert.equal(logs.length, 0);
    return { result, calls, cancels, releases };
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else delete globalThis.document;
    for (const m of Object.keys(oldConsole)) console[m] = oldConsole[m];
  }
}
function unknown(r, attempts = 1) {
  assert.equal(r.calls.length, attempts);
  assert.equal(r.result.requestAttempted, Boolean(attempts));
  assert.equal(r.result.response.kind, "UNKNOWN_TRANSPORT");
  assert.equal(r.result.response.verification, "UNVERIFIED");
  assert.equal(r.result.response.executionOutcome, "UNKNOWN");
  assert.ok(!JSON.stringify(r.result).includes(MARK));
}
unit("entry exists for actual portal transport", () => assert.equal(typeof transport.readConnectionCode, "function"));
for (const [mode, body] of [["issue", I], ["rotate", R], ["lookup", U]]) unit(`GET ${mode} with caller context`, async () => {
  const r = await run({ body }, () => transport.readConnectionCode(A, mode, mode === "lookup" ? O : undefined));
  assert.equal(r.calls.length, 1); assert.equal(r.result.requestAttempted, true);
  assert.equal(r.calls[0].target, `/api/control-plane/v1/accounts/${A}/connection-code?${mode === "lookup" ? "operationId=" + O : "action=" + mode}`);
  assert.equal(r.calls[0].init.method, "GET"); assert.equal(r.calls[0].init.credentials, "same-origin");
  assert.equal(r.calls[0].init.cache, "no-store"); assert.equal(r.calls[0].init.headers.has("x-csrf-token"), false);
  assert.equal(r.calls[0].init.body, undefined);
  assert.equal(r.result.response.kind, "ACW1_METADATA_DATA"); assert.deepEqual(r.result.response.data, body);
  assert.equal(r.result.response.verification, "UNVERIFIED"); assert.equal(r.result.response.executionOutcome, "UNKNOWN");
});
for (const [account, mode, id] of [[A.toUpperCase(), "issue"], [":id", "issue"], [A, "connect"], [A, "lookup"], [A, "lookup", "bad"], [A, "issue", O], [A + "\n", "issue"]])
  unit(`invalid intent ${JSON.stringify([account, mode, id])}`, async () => unknown(await run({}, () => transport.readConnectionCode(account, mode, id)), 0));
unit("account mismatch is not adopted from returned body", async () => {
  const v = copy(I); v.metadata.accountId = B; unknown(await run({ body: v }));
});
unit("lookup id mismatch", async () => {
  const v = copy(U); v.receipt.operationId = B; unknown(await run({ body: v }, () => transport.readConnectionCode(A, "lookup", O)));
});
unit("mode mismatch", async () => unknown(await run({ body: R })));
unit("closed root keys", async () => unknown(await run({ body: { ...I, detail: MARK } })));
for (const [name, raw] of [
  ["duplicate", bytes(JSON.stringify(I).slice(0, -1) + ',"profile":"ACW1"}')],
  ["negative zero", bytes(JSON.stringify(I).replace('"codeRevision":0', '"codeRevision":-0'))],
  ["invalid UTF8", new Uint8Array([0xc3, 0x28])],
  ["BOM", bytes("\ufeff" + JSON.stringify(I))],
]) unit(name, async () => unknown(await run({ raw })));
for (const [code, status] of [["INVALID_REQUEST", 400], ["AUTH_REQUIRED", 401], ["FORBIDDEN", 403], ["RATE_LIMITED", 429], ["SERVICE_UNAVAILABLE", 503], ["ACCOUNT_CODE_INVALID", 400], ["ACCOUNT_CODE_UNAVAILABLE", 503], ["ACCOUNT_CODE_REVISION_CONFLICT", 409], ["ATTEMPT_EXPIRED", 409], ["ATTEMPT_CONFLICT", 409], ["RECOVERY_UNAVAILABLE", 409]])
  unit(`closed error ${code}`, async () => {
    const body = { profile: "ACW1", operation: "issue", error: { code } };
    const r = await run({ body, status }); assert.equal(r.calls.length, 1);
    assert.equal(r.result.response.kind, "ACW1_ERROR_DATA"); assert.equal(r.result.response.status, status);
    assert.deepEqual(r.result.response.data, body); assert.equal(r.result.response.executionOutcome, "UNKNOWN");
  });
unit("error details stay unknown", async () => unknown(await run({ status: 409, body: { profile: "ACW1", operation: "issue", error: { code: "ATTEMPT_CONFLICT", reason: MARK } } })));
unit("wrong error status", async () => unknown(await run({ status: 400, body: { profile: "ACW1", operation: "issue", error: { code: "ATTEMPT_CONFLICT" } } })));
unit("lookup has no error alias", async () => unknown(await run({ status: 503, body: { profile: "ACW1", operation: "commit", error: { code: "SERVICE_UNAVAILABLE" } } }, () => transport.readConnectionCode(A, "lookup", O))));
unit("split full bytes", async () => {
  const b = bytes(JSON.stringify(I)); const r = await run({ chunks: [b.subarray(0, 1), new Uint8Array(), b.subarray(1)] });
  assert.equal(r.result.response.kind, "ACW1_METADATA_DATA"); assert.equal(r.releases, 1);
});
for (const n of [8193, 16384, 16385]) unit(`raw bound ${n}`, async () => {
  const s = JSON.stringify(I); const r = await run({ raw: bytes(" ".repeat(n - bytes(s).length) + s) });
  if (n <= 16384) assert.equal(r.result.response.kind, "ACW1_METADATA_DATA"); else { unknown(r); assert.equal(r.cancels, 1); }
});
unit("trailing data is not prefix success", async () => unknown(await run({ chunks: [bytes(JSON.stringify(I)), bytes("{}")] })));
unit("partial read failure cancels and stays unknown", async () => {
  const r = await run({ chunks: [bytes(JSON.stringify(I)), Error(MARK)] }); unknown(r); assert.equal(r.cancels, 1); assert.equal(r.releases, 1);
});
unit("cancel rejection handled", async () => unknown(await run({ raw: new Uint8Array(16385), cancelRejects: true })));
for (const o of [{ nullBody: true }, { readerThrows: true }, { fetchThrows: true }])
  unit(`transport failure ${JSON.stringify(o)}`, async () => unknown(await run(o)));
unit("legacy GET remains raw Response", async () => {
  const r = await run({}, () => transport.controlPlane("/v1/accounts"));
  assert.equal(r.result.status, 200); assert.equal(r.calls[0].target, "/api/control-plane/v1/accounts");
  assert.equal(r.calls[0].init.headers.has("x-csrf-token"), false);
});
unit("legacy POST CSRF/headers/body unchanged", async () => {
  const r = await run({}, () => transport.controlPlane("/v1/support/cases", { method: "POST", headers: { "idempotency-key": "__PUBLIC_ID__" }, body: "__PUBLIC_BODY__" }));
  assert.equal(r.result.status, 200); assert.equal(r.calls[0].init.headers.get("x-csrf-token"), "__PUBLIC_CSRF__");
  assert.equal(r.calls[0].init.headers.get("idempotency-key"), "__PUBLIC_ID__"); assert.equal(r.calls[0].init.body, "__PUBLIC_BODY__");
  assert.equal(r.calls[0].init.credentials, "same-origin");
});

// Focused AC-GET-01 oracle: actual entry, deferred params, no consumer spy.
for (const field of ["search", "method"]) unit(`GET freezes ${field} before params await`, async () => {
  const oldFetch = globalThis.fetch, oldOrigin = process.env.CONTROL_PLANE_API_ORIGIN;
  process.env.CONTROL_PLANE_API_ORIGIN = "https://upstream.invalid";
  const calls = [];
  globalThis.fetch = async (target, init) => { calls.push([target, init.method]); return Response.json(I); };
  try {
    let resolve;
    const request = { method: "GET", nextUrl: { search: "?action=issue" }, headers: new Headers() };
    const pending = GET(request, { params: new Promise((done) => { resolve = done; }) });
    if (field === "search") request.nextUrl.search = "?action=rotate"; else request.method = "POST";
    resolve({ path: ["v1", "accounts", A, "connection-code"] });
    const response = await pending;
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[`https://upstream.invalid/v1/accounts/${A}/connection-code?action=issue`, "GET"]]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldOrigin === undefined) delete process.env.CONTROL_PLANE_API_ORIGIN; else process.env.CONTROL_PLANE_API_ORIGIN = oldOrigin;
  }
});

// Minimal hooks fixture exercises actual pre-JSX Devices effect/event logic.
// It is not React reconciliation, DOM, browser or a rendered Next page test.
async function devicesCase(fn) {
  const oldFetch = globalThis.fetch, oldHooks = globalThis.__hooks;
  const slots = [], effects = [], metadataCalls = []; let cursor = 0, hold = false, release;
  globalThis.__hooks = {
    useState(initial) {
      const i = cursor++; if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, (v) => { slots[i].value = typeof v === "function" ? v(slots[i].value) : v; }];
    },
    useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value; },
    useEffect(effect, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((v, at) => !Object.is(v, old.deps[at]))) {
        slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = effect(); });
      }
    },
  };
  globalThis.fetch = async (target) => {
    if (target === "/api/control-plane/v1/accounts") return Response.json({ accounts: [A, B].map((id) => ({ id, status: "ACTIVE", displayName: null })) });
    if (target.startsWith("/api/control-plane/v1/devices?")) return Response.json({ devices: [] });
    assert.match(target, /\/connection-code\?/);
    metadataCalls.push(target);
    const body = target.endsWith("action=rotate") ? R : target.includes("operationId=") ? U : I;
    if (hold) await new Promise((done) => { release = done; });
    return Response.json(body);
  };
  const { default: Devices } = await import("../app/devices/page.tsx");
  function render() { cursor = 0; const api = Devices(); while (effects.length) effects.shift()(); return api; }
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  const unmount = () => { for (const s of slots) if (s?.cleanup) { const f = s.cleanup; s.cleanup = undefined; f(); } };
  try {
    render(); await settle(); render(); await settle();
    await fn({ render, settle, unmount, metadataCalls, hold: () => { hold = true; }, release: () => { hold = false; release?.(); } });
  } finally {
    release?.(); unmount(); globalThis.fetch = oldFetch;
    if (oldHooks === undefined) delete globalThis.__hooks; else globalThis.__hooks = oldHooks;
  }
}
unit("Devices reads only on explicit action and displays no ticket", async () => devicesCase(async (h) => {
  assert.equal(h.metadataCalls.length, 0);
  await h.render().readCode(); const api = h.render();
  assert.equal(h.metadataCalls.length, 1); assert.match(api.codeMessage, /ABSENT/);
  assert.ok(!api.codeMessage.includes(I.writePermit.ticket)); assert.match(api.codeMessage, /does not create or replace/);
}));
unit("Devices synchronous ref blocks duplicate submit before repaint", async () => devicesCase(async (h) => {
  h.hold(); const api = h.render(), first = api.readCode(), second = api.readCode();
  assert.equal(h.metadataCalls.length, 1); h.release(); await Promise.all([first, second]);
  assert.equal(h.render().codeLoading, false);
}));
unit("Devices account switch discards old response", async () => devicesCase(async (h) => {
  h.hold(); const api = h.render(), pending = api.readCode(); api.selectAccount(B);
  h.render(); h.release(); await pending;
  assert.equal(h.render().account, B); assert.equal(h.render().codeMessage, "");
  assert.equal(h.metadataCalls.length, 1);
}));
unit("Devices mode edit discards old response without automatic permit read", async () => devicesCase(async (h) => {
  h.hold(); const api = h.render(), pending = api.readCode(); api.clearCodeRead(); api.setCodeMode("rotate");
  h.render(); h.release(); await pending;
  assert.equal(h.render().codeMessage, ""); assert.equal(h.metadataCalls.length, 1);
  await h.render().readCode(); assert.match(h.render().codeMessage, /ACTIVE/); assert.equal(h.metadataCalls.length, 2);
}));
unit("Devices lookup keeps reported UNKNOWN", async () => devicesCase(async (h) => {
  const api = h.render(); api.clearCodeRead(); api.setCodeMode("lookup"); api.setOperationId(O);
  await h.render().readCode(); assert.match(h.render().codeMessage, /UNKNOWN/);
  assert.equal(h.metadataCalls.length, 1);
}));
unit("Devices operation-id edit discards old lookup", async () => devicesCase(async (h) => {
  let api = h.render(); api.clearCodeRead(); api.setCodeMode("lookup"); api.setOperationId(O);
  h.hold(); api = h.render(); const pending = api.readCode(); api.clearCodeRead(); api.setOperationId(B);
  h.render(); h.release(); await pending; assert.equal(h.render().codeMessage, "");
}));
unit("Devices unmount discards late response", async () => devicesCase(async (h) => {
  h.hold(); const api = h.render(), pending = api.readCode(); h.unmount(); h.release(); await pending;
  assert.equal(h.render().codeMessage, ""); assert.equal(h.metadataCalls.length, 1);
}));
