// Exact source-expression lifecycle regression. No React, browser, API or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";

const startedAt = new Date().toISOString();
const pagePath = resolve(process.argv[2] ?? "apps/portal/app/feedback/page.tsx");
const helperPath = resolve(dirname(pagePath), "../../lib/feedback-ui.ts");
const page = readFileSync(pagePath, "utf8");
const helper = readFileSync(helperPath, "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const begin = page.indexOf("const caseIdPattern =");
const end = page.indexOf("\n  return (\n    <main>");
assert.ok(begin > 0 && end > begin, "exact pre-JSX extraction anchors");
const component = page.slice(begin, end).replace("export default function", "function") +
  "\nreturn {load, submit, showSupportReply, setDescription, setDiagnostics};\n}";
const executable = stripTypeScriptTypes(helper, { mode: "strip" }).replaceAll("export ", "") +
  "\n" + stripTypeScriptTypes(component, { mode: "strip" }) +
  "\nglobalThis.FeedbackPage = FeedbackPage;";
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const account = { id: otherId, displayName: "Synthetic account", status: "ACTIVE" };
const item = {
  caseId: id, accountId: otherId, deviceId: null,
  createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z",
  category: "OTHER", severity: "LOW", status: "NEW", description: "Synthetic draft",
  diagnostics: null, serverVersion: null, portalVersion: null, extensionVersion: null,
  browserFamily: null, browserVersion: null, marketplace: "NONE", supportCode: null,
  releaseIdentity: null, assignedAdminPrincipalId: null, resolutionCode: null,
};
const contractsPath = resolve(dirname(helperPath), "../../../packages/contracts/src/index.ts");
const contracts = readFileSync(contractsPath, "utf8");
const statusDeclaration = contracts.match(/FeedbackCaseStatusV1Schema = z\.enum\(\[([\s\S]*?)\]\)/);
assert.ok(statusDeclaration && statusDeclaration[1].includes(JSON.stringify(item.status)), "synthetic case status binds actual DTO enum");
const detail = { ...item, followups: ["USER", "SUPPORT", "ADMIN"].map((authorType, i) => ({
  followupId: `${i + 3}3333333-3333-4333-8333-333333333333`, authorType,
  body: `Synthetic ${authorType}`, createdAt: item.createdAt,
})) };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const event = () => ({ preventDefault() {} });
function response(data, { status = 200, body } = {}) {
  return { status, ok: status >= 200 && status < 300, reads: 0,
    async json() { this.reads++; return body ? await body.promise : structuredClone(data); } };
}
const created = () => response({ case: item }, { status: 201 });
function harness() {
  const slots = [], refs = [], effects = [], writes = [], calls = [], unexpected = [], plans = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, disposed = false, cleanup;
  const context = vm.createContext({ AbortController,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => {
        writes.push({ index, disposed });
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useEffect(setup) { const index = effectIndex++; effects[index] ??= setup; },
    controlPlane(path, options = {}) {
      const method = options.method ?? "GET";
      calls.push({ path, method, signal: options.signal, body: options.body, disposed });
      const plan = plans.shift();
      if (plan) {
        if (plan.path !== path || (plan.method ?? "GET") !== method) {
          unexpected.push({ expected: [plan.path, plan.method ?? "GET"], actual: [path, method] });
          return Promise.reject(Error("UNEXPECTED_SYNTHETIC_CALL"));
        }
        return Promise.resolve(plan.value);
      }
      if (path === "/v1/accounts" && method === "GET") return Promise.resolve(response({ accounts: [account] }));
      if (path === "/v1/support/cases" && method === "GET") return Promise.resolve(response({ items: [item] }));
      if (path === "/v1/support/cases" && method === "POST") return Promise.resolve(created());
      if (path === `/v1/support/cases/${id}` && method === "GET") return Promise.resolve(response(detail));
      unexpected.push({ actual: [path, method] });
      return Promise.reject(Error("UNEXPECTED_SYNTHETIC_ROUTE"));
    },
  });
  vm.runInContext(executable, context, { filename: "exact-feedback-pre-JSX-source.js" });
  const h = {
    slots, refs, writes, calls, unexpected, plans,
    render() { stateIndex = refIndex = effectIndex = 0; h.handlers = context.FeedbackPage(); return h.handlers; },
    setup() { disposed = false; cleanup = effects[0](); },
    dispose() { disposed = true; cleanup?.(); },
    replay() { h.dispose(); h.setup(); },
    plan(path, value, method = "GET") { plans.push({ path, value, method }); },
    reset() { writes.length = 0; calls.length = 0; },
    async boot() { h.render(); h.setup(); await flush(); h.render(); assert.equal(slots[2], otherId); h.reset(); return h; },
    draft(text = "Synthetic draft") { h.handlers.setDescription(text); h.render(); h.reset(); },
    clean() { assert.deepEqual(unexpected, []); assert.equal(plans.length, 0); },
  };
  return h;
}
const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: String(error.message) }); }
}
const noDisposedWrites = (h) => assert.equal(h.writes.filter((x) => x.disposed).length, 0);
const noNewCalls = (h) => assert.equal(h.calls.length, 0);

for (const phase of ["response", "body"]) {
  for (const outcome of ["201", "reject", "invalid"]) {
    await test(`disposed POST ${phase}/${outcome}: draft/no writes/no follow-on GET`, async () => {
      const h = await harness().boot(); h.draft();
      const gate = deferred();
      const receipt = response({ case: item }, { status: 201, ...(phase === "body" ? { body: gate } : {}) });
      h.plan("/v1/support/cases", phase === "response" ? gate.promise : receipt, "POST");
      const pending = h.handlers.submit(event()); await flush();
      h.dispose(); h.reset();
      if (outcome === "reject") gate.reject(Error("SYNTHETIC_UNKNOWN"));
      else gate.resolve(phase === "response" ? (outcome === "201" ? created() : response({})) : (outcome === "201" ? { case: item } : {}));
      await pending; await flush();
      noNewCalls(h); noDisposedWrites(h); assert.equal(h.slots[4], "Synthetic draft"); h.clean();
    });
  }
}
for (const phase of ["response", "account-body", "case-body"]) {
  for (const outcome of ["success", "failure"]) {
    await test(`disposed list ${phase}/${outcome}: no late write or next body read`, async () => {
      const h = await harness().boot(); const gate = deferred();
      const ar = response({ accounts: [account] }, phase === "account-body" ? { body: gate } : {});
      const cr = response({ items: [item] }, phase === "case-body" ? { body: gate } : {});
      h.plan("/v1/accounts", phase === "response" ? gate.promise : ar);
      h.plan("/v1/support/cases", cr);
      const pending = h.handlers.load(); await flush(); h.dispose(); h.reset();
      if (outcome === "failure") gate.reject(Error("SYNTHETIC_READ_FAILURE"));
      else gate.resolve(phase === "response" ? ar : phase === "account-body" ? { accounts: [account] } : { items: [item] });
      await pending; noDisposedWrites(h); noNewCalls(h);
      if (phase === "response") assert.equal(ar.reads, 0);
      if (phase !== "case-body") assert.equal(cr.reads, 0);
      h.clean();
    });
  }
}
for (const phase of ["response", "body"]) {
  for (const outcome of ["success", "failure"]) {
    await test(`disposed detail ${phase}/${outcome}: fence even when abort ignored`, async () => {
      const h = await harness().boot(); const gate = deferred();
      const dr = response(detail, phase === "body" ? { body: gate } : {});
      h.plan(`/v1/support/cases/${id}`, phase === "response" ? gate.promise : dr);
      const pending = h.handlers.showSupportReply(id); await flush();
      const signal = h.calls[0].signal; h.dispose(); h.reset();
      if (outcome === "failure") gate.reject(Error("SYNTHETIC_DETAIL_FAILURE"));
      else gate.resolve(phase === "response" ? dr : detail);
      await pending; noDisposedWrites(h); noNewCalls(h); assert.equal(signal.aborted, true);
      if (phase === "response") assert.equal(dr.reads, 0);
      h.clean();
    });
  }
}
for (const handler of ["submit", "load", "showSupportReply"]) {
  await test(`retained ${handler} after true disposal dispatches nothing`, async () => {
    const h = await harness().boot(); h.draft(); const retained = h.handlers;
    h.dispose(); h.reset();
    await retained[handler](handler === "submit" ? event() : id);
    noNewCalls(h); noDisposedWrites(h); h.clean();
  });
}
await test("StrictMode replay issues a current load; old finally cannot unlock it", async () => {
  const h = harness(); const old = deferred(), current = deferred();
  h.plan("/v1/accounts", old.promise); h.plan("/v1/support/cases", response({ items: [item] }));
  h.render(); h.setup(); h.replay();
  assert.equal(h.calls.length, 4, "setup2 must load independently of retired setup1");
  // Hold another current refresh, then settle the retired setup.
  await flush(); h.render(); h.reset();
  h.plan("/v1/accounts", current.promise); h.plan("/v1/support/cases", response({ items: [item] }));
  const fresh = h.handlers.load(); await flush(); h.reset();
  old.resolve(response({ accounts: [{ ...account, displayName: "Retired" }] })); await flush();
  assert.equal(h.writes.length, 0); assert.equal(h.slots[6], true);
  await h.handlers.load(); noNewCalls(h);
  current.resolve(response({ accounts: [account] })); await fresh;
  assert.equal(h.slots[0][0].displayName, account.displayName); h.clean();
});
for (const phase of ["response", "body"]) {
  for (const outcome of ["201", "reject"]) {
    await test(`StrictMode retired POST ${phase}/${outcome} cannot write/refresh/unlock newer POST`, async () => {
      const h = await harness().boot(); h.draft(); const old = deferred(), current = deferred();
      const receipt = response({ case: item }, { status: 201, ...(phase === "body" ? { body: old } : {}) });
      h.plan("/v1/support/cases", phase === "response" ? old.promise : receipt, "POST");
      const retired = h.handlers.submit(event()); await flush(); h.replay(); await flush(); h.render();
      assert.equal(h.slots[7], false, "replayed owner must not retain old sending state");
      h.plan("/v1/support/cases", current.promise, "POST");
      const fresh = h.handlers.submit(event()); await flush(); h.reset();
      if (outcome === "reject") old.reject(Error("SYNTHETIC_UNKNOWN"));
      else old.resolve(phase === "response" ? created() : { case: item });
      await retired; assert.equal(h.writes.length, 0); noNewCalls(h); assert.equal(h.slots[7], true);
      await h.handlers.submit(event()); noNewCalls(h);
      current.resolve(created()); await fresh; assert.match(h.slots[8], new RegExp(id)); h.clean();
    });
  }
}
await test("StrictMode retired detail cannot replace or unlock newer detail", async () => {
  const h = await harness().boot(); const old = deferred(), current = deferred();
  h.plan(`/v1/support/cases/${id}`, old.promise); const retired = h.handlers.showSupportReply(id);
  await flush(); h.replay(); await flush(); h.render();
  h.plan(`/v1/support/cases/${id}`, current.promise); const fresh = h.handlers.showSupportReply(id);
  await flush(); h.reset(); old.resolve(response(detail)); await retired;
  assert.equal(h.writes.length, 0); await h.handlers.showSupportReply(id); noNewCalls(h);
  current.resolve(response(detail)); await fresh; assert.equal(h.slots[10].state, "ready"); h.clean();
});
await test("new instance remains isolated from disposed old POST and retained handlers", async () => {
  const old = await harness().boot(); old.draft(); const gate = deferred();
  old.plan("/v1/support/cases", gate.promise, "POST"); const pending = old.handlers.submit(event());
  await flush(); old.dispose(); old.reset();
  const fresh = await harness().boot(); fresh.draft("New instance draft"); const snapshot = JSON.stringify(fresh.slots);
  gate.resolve(created()); await pending; await old.handlers.load(); await old.handlers.submit(event());
  noNewCalls(old); noDisposedWrites(old); assert.equal(JSON.stringify(fresh.slots), snapshot);
  await fresh.handlers.submit(event()); assert.equal(fresh.slots[4], ""); old.clean(); fresh.clean();
});
await test("current201 confirms actual caseId and exactly one refresh pair", async () => {
  const h = await harness().boot(); h.draft(); await h.handlers.submit(event());
  assert.deepEqual(h.calls.map(({ path, method }) => [path, method]), [
    ["/v1/support/cases", "POST"], ["/v1/accounts", "GET"], ["/v1/support/cases", "GET"],
  ]);
  assert.equal(h.slots[8], `Сообщение принято. Номер обращения: ${id}`);
  assert.equal(h.slots[4], ""); assert.equal(h.slots[7], false); h.clean();
});
await test("confirmed201 survives list refresh failure", async () => {
  const h = await harness().boot(); h.draft();
  h.plan("/v1/support/cases", created(), "POST");
  h.plan("/v1/accounts", response({}, { status: 503 }));
  h.plan("/v1/support/cases", response({ items: [item] }));
  await h.handlers.submit(event()); assert.match(h.slots[8], new RegExp(id));
  assert.match(h.slots[9], /Не удалось загрузить/); assert.equal(h.slots[4], ""); h.clean();
});
for (const outcome of ["network", "204", "invalid-case"]) {
  await test(`unknown POST ${outcome} preserves draft and never automatically retries`, async () => {
    const h = await harness().boot(); h.draft(); const gate = deferred();
    const receipt = outcome === "204" ? response(null, { status: 204, body: gate }) : response({ case: {} });
    h.plan("/v1/support/cases", outcome === "network" ? gate.promise : receipt, "POST");
    const pending = h.handlers.submit(event()); await flush();
    if (outcome === "network" || outcome === "204") gate.reject(Error("SYNTHETIC_UNCONFIRMED"));
    await pending; await flush(); assert.equal(h.calls.length, 1); assert.equal(h.slots[4], "Synthetic draft");
    assert.match(h.slots[8], /Не удалось подтвердить/); h.clean();
  });
}
await test("current POST cannot clear a newer edited draft", async () => {
  const h = await harness().boot(); h.draft(); const gate = deferred();
  h.plan("/v1/support/cases", gate.promise, "POST"); const pending = h.handlers.submit(event()); await flush();
  h.handlers.setDescription("New edited draft"); gate.resolve(created()); await pending;
  assert.equal(h.slots[4], "New edited draft"); h.clean();
});
for (const handler of ["submit", "load", "showSupportReply"]) {
  await test(`${handler} single flight fences same-render repeated invocation`, async () => {
    const h = await harness().boot(); h.draft(); const gate = deferred();
    const path = handler === "load" ? "/v1/accounts" : handler === "submit" ? "/v1/support/cases" : `/v1/support/cases/${id}`;
    h.plan(path, gate.promise, handler === "submit" ? "POST" : "GET");
    const arg = handler === "submit" ? event() : id;
    const pending = h.handlers[handler](arg); await h.handlers[handler](arg);
    assert.equal(h.calls.length, handler === "load" ? 2 : 1);
    gate.resolve(handler === "submit" ? created() : handler === "load" ? response({ accounts: [account] }) : response(detail));
    await pending; h.clean();
  });
}
await test("only listed own case is eligible; reply projection filters USER notes", async () => {
  const h = await harness().boot();
  await h.handlers.showSupportReply(otherId); await h.handlers.showSupportReply("invalid"); noNewCalls(h);
  await h.handlers.showSupportReply(id); assert.equal(h.slots[10].state, "ready");
  assert.equal(h.slots[10].response.caseId, id);
  assert.deepEqual(Array.from(h.slots[10].response.replies, (x) => x.authorType), ["SUPPORT", "ADMIN"]); h.clean();
});
await test("wrong-case detail is rejected without displaying another case", async () => {
  const h = await harness().boot(); h.plan(`/v1/support/cases/${id}`, response({ ...detail, caseId: otherId }));
  await h.handlers.showSupportReply(id); assert.equal(h.slots[10].state, "error"); h.clean();
});
await test("list refresh invalidates old reply and its finally cannot unlock newer detail", async () => {
  const h = await harness().boot(); const old = deferred(), current = deferred();
  h.plan(`/v1/support/cases/${id}`, old.promise); const retired = h.handlers.showSupportReply(id);
  await flush(); const signal = h.calls[0].signal; await h.handlers.load(); h.render();
  assert.equal(signal.aborted, true); assert.equal(h.slots[10], null);
  h.plan(`/v1/support/cases/${id}`, current.promise); const fresh = h.handlers.showSupportReply(id); await flush(); h.reset();
  old.resolve(response(detail)); await retired; assert.equal(h.writes.length, 0);
  await h.handlers.showSupportReply(id); noNewCalls(h);
  current.resolve(response(detail)); await fresh; assert.equal(h.slots[10].state, "ready"); h.clean();
});
await test("safe diagnostic opt-in and exact payload remain unchanged", async () => {
  const h = await harness().boot(); h.draft(); await h.handlers.submit(event());
  assert.deepEqual(JSON.parse(h.calls[0].body), { accountId: otherId, category: "OTHER", description: "Synthetic draft" });
  h.render(); h.draft(); h.handlers.setDiagnostics(true); h.render(); h.reset(); await h.handlers.submit(event());
  assert.deepEqual(JSON.parse(h.calls[0].body).diagnostics, { portalVersion: "0.1.0" }); h.clean();
});
const passed = results.filter((x) => x.pass).length;
console.log(JSON.stringify({ kind: "PORTAL_FEEDBACK_DISPOSAL_SOURCE_PORT_V1", startedAt,
  completedAt: new Date().toISOString(), level: "exact pre-JSX source/helper with manual hook/effect/HTTP/body ports; actual React/StrictMode/browser/API NOT_RUN",
  source: { path: pagePath, bytes: Buffer.byteLength(page), sha256: sha(page), extractedBytes: Buffer.byteLength(component), extractedSha256: sha(component) },
  helper: { path: helperPath, bytes: Buffer.byteLength(helper), sha256: sha(helper) },
  contracts: { path: contractsPath, bytes: Buffer.byteLength(contracts), sha256: sha(contracts), fixtureCaseStatus: item.status, check: "static enum binding, actual Zod NOT_RUN" },
  runnerSha256: sha(readFileSync(new URL(import.meta.url))), passed, total: results.length, results,
}, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
