import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function popupFeedbackSource(source) {
  const begin=source.indexOf("function startStatusText(");
  const end=source.indexOf("function transferReceivePresentation(",begin);
  assert.ok(begin>=0&&end>begin);
  return source.slice(begin,end);
}

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
  const ctx = { $: node, navigator: { userAgent: "Chromium" }, renderOnboarding() {}, refresh: async () => {},
    actionSuccessText: () => "done", scheduleRefresh() {}, renderRecovery() {}, startStatusText: () => null,
    texts: { AUTH_REQUIRED: "fixture auth required" }, document: { createElement: () => ({}) },
    request: async (type, fields) => { storeRequests.push({ type, fields }); return { store: { id: "fixture-store" } }; },
    send: () => { requests++; return new Promise(resolve => { release = resolve; }); } };
  vm.createContext(ctx);
  // This isolated render fixture has no native browser channel; evaluate the
  // actual capability check so render and its dependencies stay in sync.
  const pickerStart = source.indexOf("function nativeBackupPickerAvailable()");
  const pickerEnd = source.indexOf("async function ensureNativeBackupBridge()", pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  vm.runInContext("const durableImportMode=false; let state, busy=false, actionGeneration=0, refreshGeneration=0, refreshRequested=false, r3Review=null, marketplace='ozon', selectedId='', editingId=null, confirmAction=null, connectionSubmitPending=false, connectionCancelConfirmation=false, startFeedback=null, tabId=12;\n" +
    popupFeedbackSource(source) + source.slice(pickerStart, pickerEnd) + source.slice(actionStart, actionEnd) + source.slice(renderStart, renderEnd) +
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
  assert.equal(node("r3-recovery").hidden, true);
  assert.equal(node("r3-review").hidden, true);
  assert.equal(vm.runInContext("r3Review", ctx), null);
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
  await verifyPopupRefreshNotifications(source);
  await verifyPopupConnectionEntry(source);
}

async function verifyPopupRefreshNotifications(source) {
  const refreshStart = source.indexOf("function scheduleRefresh()");
  const refreshEnd = source.indexOf("function closeCard()", refreshStart);
  const listenerStart = source.indexOf("chrome.storage.onChanged.addListener(");
  const listenerEnd = source.indexOf("\n});", listenerStart) + "\n});".length;
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart && listenerStart >= 0 && listenerEnd > listenerStart);
  const clone = value => JSON.parse(JSON.stringify(value));
  const credentials = { accessToken: "SYNTHETIC_NEVER_REAL", deviceId: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002" };
  const cacheClock = { cacheVersion: "control_cache_clock_v1", effectiveTimeMs: 1000, trustedServerTimeMs: 900,
    owner: { controlApiOrigin: "https://control.invalid", portalOrigin: "https://portal.invalid", contractVersion: "control_plane_v2",
      deviceId: credentials.deviceId, sessionId: credentials.sessionId } };
  const auth = { authStateSchema: 2, credentials, cacheClock: clone(cacheClock),
    grants: { "fixture-alice": { grantEpoch: 1, authority: { workAllowed: true, payload: { expiresAt: 9000 } },
      cacheClock: clone(cacheClock) } }, lastError: null };
  const timers = new Map(), pending = [], rendered = [];
  let timerId = 0, listener, requests = 0;
  const ctx = {
    URL,
    chrome: { storage: { onChanged: { addListener(fn) { listener = fn; } } } },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    $: () => ({}), refreshFirefoxTechnicalConsent: async () => {},
    render() { rendered.push(vm.runInContext("state", ctx)); },
    request(type) {
      assert.equal(type, "SA_POPUP_STATE"); requests++;
      const oldValue = clone(auth);
      auth.cacheClock.effectiveTimeMs++;
      auth.grants["fixture-alice"].cacheClock.effectiveTimeMs++;
      // A status read checkpoints time before its delayed response reaches
      // the popup. Use the actual storage listener and refresh functions.
      listener({ seller_agents_control_auth_v2: { oldValue, newValue: clone(auth) } }, "local");
      return new Promise(resolve => pending.push(resolve));
    }
  };
  vm.createContext(ctx);
  vm.runInContext("let state, refreshTimer, refreshRequested=false, refreshGeneration=0, busy=false, tabId=12, selectedId='', marketplace='ozon', startFeedback=null, actionGeneration=0; const durableImportMode=false;\n" +
    popupFeedbackSource(source) + source.slice(refreshStart, refreshEnd) + source.slice(listenerStart, listenerEnd), ctx);
  const runTimers = () => { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); };
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const snapshot = { auth: { authenticated: true, workAllowed: true }, context: {}, stores: [], work: { state: "active_visible" } };
  const initial = vm.runInContext("refresh(true)", ctx);
  for (let i = 0; i < 4; i++) {
    runTimers();
    const resolve = pending.shift();
    if (resolve) resolve(snapshot);
    await settle();
    if (!timers.size && !pending.length) break;
  }
  assert.equal(requests, 1, "a status clock checkpoint must not perpetually supersede initial popup state");
  await initial;
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0], snapshot);
  assert.equal(timers.size, 0);
  const changed = mutate => { const oldValue = clone(auth), newValue = clone(auth); mutate(newValue); return { oldValue, newValue }; };
  const authChanges = [
    changed(value => { value.credentials.accessToken = "SYNTHETIC_ROTATED"; }),
    changed(value => { value.grants["fixture-alice"].authority.workAllowed = false; value.grants["fixture-alice"].grantEpoch++; }),
    changed(value => { value.grants["fixture-alice"].authority.payload.expiresAt = 1001; }),
    changed(value => { delete value.grants["fixture-alice"]; }),
    changed(value => { value.grants["fixture-other"] = clone(value.grants["fixture-alice"]); }),
    changed(value => { value.lastError = { code: "AUTH_REQUIRED" }; }),
    changed(value => { value.newPolicyField = false; }),
    changed(value => { value.cacheClock.effectiveTimeMs--; }),
    changed(value => { value.grants["fixture-alice"].cacheClock.effectiveTimeMs--; }),
    changed(value => { value.cacheClock = { effectiveTimeMs: "malformed" }; }),
    { oldValue: clone(auth), newValue: null },
    { newValue: clone(auth) },
    { oldValue: clone(auth), newValue: { authStateSchema: 3 } }
  ];
  const staleResponse = vm.runInContext("refresh()", ctx), renderedBeforeAuthChange = rendered.length;
  listener({ seller_agents_control_auth_v2: authChanges[1] }, "local");
  pending.shift()(snapshot); await staleResponse;
  assert.equal(rendered.length, renderedBeforeAuthChange, "auth change invalidates a pending response before debounce fires");
  runTimers();
  const denied = { ...snapshot, auth: { authenticated: false, workAllowed: false } };
  pending.shift()(denied); await settle();
  assert.equal(rendered.at(-1), denied);
  for (const mutate of [
    clock => { clock.owner = null; },
    clock => { clock.owner.deviceId = "00000000-0000-4000-8000-000000000099"; },
    clock => { clock.owner.controlApiOrigin = "not-an-origin"; },
    clock => { clock.cacheVersion = "future-clock"; },
    clock => { clock.trustedServerTimeMs = 9000; },
    clock => { clock.unknownClockField = true; }
  ]) {
    const oldValue = clone(auth); mutate(oldValue.cacheClock);
    const newValue = clone(oldValue); newValue.cacheClock.effectiveTimeMs++;
    authChanges.push({ oldValue, newValue });
  }
  for (const change of authChanges) {
    const before = requests;
    listener({ seller_agents_control_auth_v2: change }, "local"); runTimers();
    assert.equal(requests, before + 1, "auth, authority and malformed-state changes must still refresh");
    pending.shift()(snapshot); await settle();
    assert.equal(timers.size, 0, "the requested refresh must settle without feeding itself");
  }
  for (const key of ["seller_agents_stores_v1", "ozmb_work_sessions_v1", "ozmb_pending_work_starts_v1", "ozmb_conversation_bindings", "ozmb_manual_operations"]) {
    const before = requests;
    listener({ [key]: { oldValue: {}, newValue: { changed: true } } }, "local"); runTimers();
    assert.equal(requests, before + 1, key + " must still refresh");
    const next = { ...snapshot, auth: { authenticated: false, workAllowed: false } };
    pending.shift()(next); await settle();
    assert.equal(rendered.at(-1), next);
    assert.equal(timers.size, 0);
  }
  const before = requests;
  listener({ unrelated: { newValue: 1 } }, "local");
  listener({ seller_agents_control_auth_v2: authChanges[0] }, "sync"); runTimers();
  assert.equal(requests, before, "unrelated storage areas and keys do not read popup state");
}

async function verifyPopupConnectionEntry(source) {
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:"",hidden:false,textContent:"",style:{},focus(){}});return nodes.get(id);};
  const sent=[];let release;
  const ctx={ $:node, texts:{}, state:{auth:{authenticated:false},account:{label:"fixture"}}, render(){}, scheduleRefresh(){},
    actionSuccessText:()=>"done", refresh:async()=>{},
    request:async(type,fields)=>{
      sent.push({type,fields});
      if(type==="SA_AUTH_CONNECT_CODE")return new Promise(resolve=>{release=()=>resolve({ok:true});});
      return {ok:true};
    } };
  vm.createContext(ctx);
  const a=source.indexOf("async function action("),b=source.indexOf("function selected()",a);
  const h=source.indexOf('$("connection-form").onsubmit'),he=source.indexOf('$("auth-reset").onclick',h);
  const c=source.indexOf('$("confirm").onclick'),ce=source.indexOf('\n',source.indexOf('$("reject").onclick',c));
  assert.ok(a>=0&&b>a&&h>=0&&he>h&&c>=0&&ce>c);
  vm.runInContext('let busy=false,actionGeneration=0,refreshGeneration=0,refreshRequested=false,connectionSubmitPending=false,connectionCancelConfirmation=false,confirmAction=null,startFeedback=null,tabId=12;\n'+popupFeedbackSource(source)+source.slice(a,b)+source.slice(c,ce)+source.slice(h,he),ctx);
  node("connection-code").value="octo1_"+"A".repeat(43);
  const submit=node("connection-form").onsubmit({preventDefault(){}});
  assert.equal(node("connection-code").value,"","code leaves the visible field on submission");
  assert.equal(sent.length,1);
  node("connection-code").value="octo1_"+"B".repeat(42)+"A";
  node("connection-form").onsubmit({preventDefault(){}});
  assert.equal(sent.length,1,"busy prevents a second send");
  node("auth-cancel").onclick();
  assert.equal(node("confirmation").hidden,false);
  node("confirm").onclick();
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(sent.filter(x=>x.type==="SA_AUTH_CANCEL").length,1,"cancel can interrupt a held code submission");
  release();await submit;
  assert.equal(node("status").textContent,"Готово","late submission cannot replace cancellation outcome");
}
