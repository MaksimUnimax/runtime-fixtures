import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export async function verifyPopupInitialState(candidate) {
  const source = fs.readFileSync(path.join(candidate, "popup.js"), "utf8");
  const html = fs.readFileSync(path.join(candidate, "popup.html"), "utf8");
  assert.match(html, /<button\b[^>]*id="auth-start"[^>]*\bdisabled\b/);
  const actionStart = source.indexOf("async function action(");
  const actionEnd = source.indexOf("function selected()", actionStart);
  const renderStart = source.indexOf("function render()");
  const renderEnd = source.indexOf("function scheduleRefresh", renderStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart && renderStart > actionEnd && renderEnd > renderStart);
  assert.match(html, /<section\b[^>]*id="catalog"[^>]*\bhidden\b/);
  for (const id of ["add", "edit", "remove"]) assert.match(html, new RegExp(`<button\\b[^>]*id="${id}"[^>]*\\bdisabled\\b`));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: "", checked: false, style: {}, focus() {}, setAttribute() {}, replaceChildren() {}, reset() {
      for (const field of ["name", "seller-id", "seller-key", "performance-id", "performance-key", "token"]) node(field).value = "";
      for (const field of ["personal", "clear-performance"]) node(field).checked = false;
    } });
    return nodes.get(id);
  };
  let requests = 0, release;
  const storeRequests = [];
  const ctx = { $: node, renderOnboarding() {}, refresh: async () => {},
    actionSuccessText: () => "done", scheduleRefresh() {}, renderRecovery() {}, startStatusText: () => null,
    texts: { AUTH_REQUIRED: "fixture auth required" }, document: { createElement: () => ({}) },
    request: async (type, fields) => { storeRequests.push({ type, fields }); return { store: { id: "fixture-store" } }; },
    send: () => { requests++; return new Promise(resolve => { release = resolve; }); } };
  vm.createContext(ctx);
  vm.runInContext("let state, busy=false, actionGeneration=0, refreshGeneration=0, refreshRequested=false, r3Review=null, marketplace='ozon', selectedId='', editingId=null, confirmAction=null;\n" +
    source.slice(actionStart, actionEnd) + source.slice(renderStart, renderEnd) +
    source.slice(source.indexOf("function selected()"), source.indexOf("function onboardingModel")) +
    source.slice(source.indexOf("function closeCard()"), source.indexOf('for (const id of ["ozon", "wildberries"])', source.indexOf("function closeCard()"))) +
    source.slice(source.indexOf('$("add").onclick'), source.indexOf('$("start").onclick')), ctx);
  for (let i = 0; i < 2; i++) {
    const result = await vm.runInContext("action(send)", ctx);
    assert.equal(result.popupAction, "INITIAL_STATE_PENDING");
    assert.equal(vm.runInContext("busy", ctx), false);
    assert.equal(requests, 0);
  }
  vm.runInContext('state={auth:{authenticated:false},account:{label:"fixture"}}; render()', ctx);
  assert.equal(node("auth-start").disabled, false);
  assert.equal(requests, 0, "initialization never replays a rejected action");
  const pending = vm.runInContext("action(send)", ctx);
  assert.equal(requests, 1);
  assert.equal(node("auth-start").disabled, true);
  assert.equal((await vm.runInContext("action(send)", ctx)).popupAction, "BUSY_REJECTED");
  assert.equal(requests, 1, "repeat click cannot duplicate the pending request");
  release({}); await pending;
  assert.equal(vm.runInContext("busy", ctx), false);
  assert.equal(node("auth-start").disabled, false);
  // Direct handlers are fenced while state is pending or signed out, even if
  // invoked outside normal visibility/disabled browser behavior.
  for (const stateExpression of ["undefined", '{auth:{authenticated:false}}']) {
    vm.runInContext(`state=${stateExpression}; $("add").onclick(); $("edit").onclick(); $("remove").onclick(); $("card").onsubmit({preventDefault(){}})`, ctx);
    assert.equal(node("card").hidden, true);
    assert.equal(storeRequests.length, 0);
    assert.equal(vm.runInContext("confirmAction", ctx), null);
  }
  const signedIn = { auth: { authenticated: true }, account: { label: "fixture" },
    stores: [{ id: "fixture-store", name: "Fixture store", marketplace: "ozon", sellerClientId: "123", sellerPresent: true }],
    context: {}, identity: {}, work: {} };
  ctx.signedIn = signedIn;
  vm.runInContext('state=signedIn; render(); $("add").onclick()', ctx);
  assert.equal(node("catalog").hidden, false);
  assert.equal(node("add").disabled, false);
  assert.equal(node("card").hidden, false, "authenticated Add remains available");
  vm.runInContext('$("edit").onclick()', ctx);
  assert.equal(node("name").value, "Fixture store");
  assert.equal(vm.runInContext("editingId", ctx), "fixture-store");
  node("seller-key").value = "SYNTHETIC_NEVER_REAL";
  node("performance-key").value = "SYNTHETIC_NEVER_REAL";
  node("token").value = "SYNTHETIC_NEVER_REAL";
  vm.runInContext('$("remove").onclick(); globalThis.oldDeleteConfirmation=confirmAction; state.auth.authenticated=false; render()', ctx);
  assert.equal(node("catalog").hidden, true);
  assert.equal(node("card").hidden, true);
  for (const id of ["seller-key", "performance-key", "token", "name"]) assert.equal(node(id).value, "", "auth loss clears the form");
  for (const id of ["add", "edit", "remove"]) assert.equal(node(id).disabled, true);
  assert.equal(vm.runInContext("editingId", ctx), null);
  assert.equal(vm.runInContext("confirmAction", ctx), null);
  assert.equal(node("confirmation").hidden, true);
  assert.throws(() => vm.runInContext("oldDeleteConfirmation()", ctx), /fixture auth required/);
  assert.equal(storeRequests.length, 0, "stale delete confirmation cannot mutate after auth loss");
  vm.runInContext('state.auth.authenticated=true; render(); $("add").onclick(); $("name").value="New fixture"; $("seller-key").value="SYNTHETIC_NEVER_REAL"; $("card").onsubmit({preventDefault(){}})', ctx);
  for (let i=0; i<10 && vm.runInContext("busy", ctx); i++) await Promise.resolve();
  assert.equal(storeRequests.length, 1);
  assert.equal(storeRequests[0].type, "SA_STORE_SAVE");
  assert.equal(node("card").hidden, true);
  vm.runInContext('$("remove").onclick()', ctx);
  await vm.runInContext("confirmAction()", ctx);
  assert.equal(storeRequests.length, 2);
  assert.equal(storeRequests[1].type, "SA_STORE_DELETE");
  vm.runInContext("state={}", ctx);
  await assert.rejects(vm.runInContext("action(send)", ctx), /label/);
  assert.equal(vm.runInContext("busy", ctx), false, "render failure cannot latch busy");
  assert.equal(requests, 1, "render failure happens before request dispatch");
}
