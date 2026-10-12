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
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {});
    return nodes.get(id);
  };
  let requests = 0, release;
  const ctx = { $: node, renderOnboarding() {}, refresh: async () => {},
    actionSuccessText: () => "done", scheduleRefresh() {},
    send: () => { requests++; return new Promise(resolve => { release = resolve; }); } };
  vm.createContext(ctx);
  vm.runInContext("let state, busy=false, actionGeneration=0, refreshGeneration=0, refreshRequested=false, r3Review=null;\n" +
    source.slice(actionStart, actionEnd) + source.slice(renderStart, renderEnd), ctx);
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
  vm.runInContext("state={}", ctx);
  await assert.rejects(vm.runInContext("action(send)", ctx), /label/);
  assert.equal(vm.runInContext("busy", ctx), false, "render failure cannot latch busy");
  assert.equal(requests, 1, "render failure happens before request dispatch");
}
