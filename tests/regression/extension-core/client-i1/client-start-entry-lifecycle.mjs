import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const repo = path.resolve(process.argv[2] || ".");
const source = fs.readFileSync(path.join(repo, "apps/extension/src/application/runtime.js"), "utf8");
const entry = source.slice(0, source.indexOf("/* End page entry. */"));
assert.ok(entry.includes("function saStartPageIdentity"), "real entry lifecycle must exist");
const results = [];
function fixture(options = {}) {
  const state = { url: "https://chatgpt.com/", ready: false, calls: [], installs: 0, reads: 0, ...options };
  const fail = (code, transport_class) => Object.assign(new Error(code), { code, transport_class });
  const providers = new Map([["https://chatgpt.com", "chatgpt"], ["https://another.example", "provider_future"]]);
  const chrome = {
    tabs: { async get(id) {
      state.reads += 1;
      state.onRead?.(state);
      if (state.gone) throw fail("TAB_GONE");
      return { id, url: state.url };
    }},
    runtime: { getManifest: () => ({ content_scripts: state.scripts || [{
      matches: ["https://chatgpt.com/*", "https://another.example/*"],
      js: ["shared/identity.js", "content.js"]
    }] }) },
    scripting: { async executeScript(value) {
      state.installs += 1; state.install = value;
      if (state.reject) throw new Error("denied");
      await state.wait;
      state.ready = true;
      state.onInstall?.(state);
    }}
  };
  const ctx = vm.createContext({ chrome, URL, Map, Set, Promise,
    normalizeTabId: Number,
    saError: code => fail(code),
    saSupportCode: value => /^[A-Z0-9_]+$/.test(value || "") ? value : null,
    safeTabMessageTransportClass: value => ["NO_RECEIVER", "PORT_CLOSED", "TAB_GONE"].includes(value) ? value : null,
    BB2ConversationIdentity: { providerForOrigin: origin => providers.get(origin) || null },
    async tabMessage(id, message) {
      state.calls.push(message.type);
      if (state.appearDuringProbe) state.ready = true;
      return state.ready ? { ok: true, identity: { ai_id: providers.get(new URL(state.url).origin) } }
        : { ok: false, code: "TAB_MESSAGE_ERROR", transport_class: state.transport || "NO_RECEIVER" };
    },
    async tabIdentity() {
      if (!state.ready) throw fail("TAB_MESSAGE_ERROR", state.transport || "NO_RECEIVER");
      return { ai_id: providers.get(new URL(state.url).origin), conversation_id: null, status: "unknown" };
    }
  });
  vm.runInContext(entry, ctx);
  return { state, ctx };
}
async function check(name, fn) { await fn(); results.push({ name, status: "PASS" }); }
await check("empty-root-recovers-without-a-conversation-id-and-without-sending", async () => {
  const {state,ctx}=fixture(); const identity=await ctx.saStartPageIdentity(7);
  assert.equal(identity.conversation_id,null);assert.equal(state.installs,1);
  assert.deepEqual(state.calls,["OZ_GET_IDENTITY"]);
  assert.equal(state.install.target.tabId,7);assert.equal(state.install.target.frameIds[0],0);
});
await check("same-entry-lifecycle-for-a-different-provider-and-arbitrary-path",async()=>{
  const {state,ctx}=fixture({url:"https://another.example/new/workspace?mode=anonymous"});
  assert.equal((await ctx.saStartPageIdentity(7)).ai_id,"provider_future");assert.equal(state.installs,1);
});
await check("healthy-receiver-is-not-reinstalled",async()=>{
  const {state,ctx}=fixture({ready:true});await ctx.saStartPageIdentity(7);assert.equal(state.installs,0);
});
await check("concurrent-start-preparations-share-one-installation",async()=>{
  const {state,ctx}=fixture();await Promise.all([ctx.saStartPageIdentity(7),ctx.saStartPageIdentity(7)]);assert.equal(state.installs,1);
});
await check("document-idle-race-does-not-install-a-second-receiver",async()=>{
  const {state,ctx}=fixture({appearDuringProbe:true});await ctx.saStartPageIdentity(7);assert.equal(state.installs,0);
});
await check("port-closure-is-not-treated-as-absent-receiver",async()=>{
  const {state,ctx}=fixture({transport:"PORT_CLOSED"});await assert.rejects(ctx.saStartPageIdentity(7),e=>e.transport_class==="PORT_CLOSED");assert.equal(state.installs,0);
});
await check("unsupported-origin-never-receives-packaged-code",async()=>{
  const {state,ctx}=fixture({url:"https://unrelated.example/"});await assert.rejects(ctx.saStartPageIdentity(7),e=>e.code==="WORK_START_UNSUPPORTED_PAGE");assert.equal(state.installs,0);
});
await check("navigation-before-install-invalidates-old-start",async()=>{
  const {state,ctx}=fixture({onRead:s=>{if(s.reads===2)s.url="https://chatgpt.com/different";}});
  await assert.rejects(ctx.saStartPageIdentity(7),e=>e.code==="POPUP_CONTEXT_STALE");assert.equal(state.installs,0);
});
await check("navigation-during-install-invalidates-old-start",async()=>{
  const {state,ctx}=fixture({onInstall:s=>{s.url="https://chatgpt.com/different";}});
  await assert.rejects(ctx.saStartPageIdentity(7),e=>e.code==="POPUP_CONTEXT_STALE");assert.equal(state.installs,1);
});
await check("browser-permission-rejection-does-not-fall-back-or-send",async()=>{
  const {state,ctx}=fixture({reject:true});await assert.rejects(ctx.saStartPageIdentity(7),e=>e.code==="PAGE_RUNTIME_INSTALL_FAILED");
  assert.deepEqual(state.calls,["OZ_GET_IDENTITY"]);
});
await check("manifest-excluded-page-is-not-injected",async()=>{
  const {state,ctx}=fixture({scripts:[{matches:["https://chatgpt.com/*"],exclude_matches:["https://chatgpt.com/*"],js:["content.js"]}]});
  await assert.rejects(ctx.saStartPageIdentity(7),e=>e.code==="PAGE_RUNTIME_NOT_PACKAGED");assert.equal(state.installs,0);
});
await check("availability-preserves-safe-transport-cause-without-raw-error",async()=>{
  const {ctx}=fixture();const value=await ctx.saUnavailablePage(7,{code:"TAB_MESSAGE_ERROR",transport_class:"NO_RECEIVER",message:"SECRET_URL"});
  assert.equal(value.supported,true);assert.equal(value.aiFamily,"chatgpt");assert.equal(value.transportClass,"NO_RECEIVER");
  assert.equal(JSON.stringify(value).includes("SECRET_URL"),false);
});

function realFunction(name) {
  const start = source.search(new RegExp("^(?:async )?function " + name + "\\(", "m"));
  assert.ok(start >= 0, name);
  const remainder = source.slice(start);
  const next = remainder.slice(1).search(/^(?:async )?function /m);
  return next < 0 ? remainder : remainder.slice(0, next + 1);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise,resolve};
}
function admissionFixture() {
  const observed = {generation:1,authorizations:0,mutations:0,authority:{verified:true,workAllowed:false,generation:1,deviceId:"device-A",sessionId:"session-A",requestedAi:null,payload:{account:{id:"account-A"}}}};
  const page = deferred(), entered = deferred(), snapshot = deferred();
  const ctx = vm.createContext({
    Map,Number,String,Date,JSON,crypto:{randomUUID:()=>"test-epoch"},
    normalizeTabId:Number, normalizeConversationKey:value=>value,
    saError:code=>Object.assign(new Error(code),{code}),
    saSupportCode:code=>code, diagnostic:async()=>{}, queueMicrotask:()=>{},
    getConversationBindings:async()=>({}),getPendingWorkStarts:async()=>({}),
    singleFlight:async(_map,_key,fn)=>fn(),
    saWorkFlights:new Map(), saAdmissionEpochs:new Map(),
    SellerAgentsControlClient:{
      generation:async()=>observed.generation,
      getAuthority:async()=>observed.authority,
      onAuthorityChanged:handler=>{observed.authorityChanged=handler;},
      ensureForIdentity:async()=>{observed.authorizations++;throw Object.assign(new Error("ENTRY_PASSED"),{code:"ENTRY_PASSED"});}
    },
    saStartPageIdentity:async()=>{entered.resolve();return page.promise;},
    saAssertLocalAuthorityAdmission:async()=>{},
    saReadAdmissionSnapshot:async()=>{entered.resolve();return snapshot.promise;},
    saValidateRebindPlan:()=>{observed.mutations++;throw new Error("unexpected admission");}
  });
  for (const name of ["saAdmissionKey","saBeginAdmission","saCancelAdmission","saAdmissionCurrent",
                      "saAdmissionError","saReleaseAdmission","saAdmitWork","saWorkStart","saInvalidateAuthority"]) {
    vm.runInContext(realFunction(name),ctx);
  }
  return {ctx,observed,page,entered,snapshot};
}
for (const change of ["finish","account"]) {
  await check(change+"-during-page-preparation-invalidates-start",async()=>{
    const f=admissionFixture();
    const run=f.ctx.saWorkStart({tab_id:7,store_id:"store"}, {});
    const rejected=assert.rejects(run,e=>e.code===(change==="finish"?"WORK_ADMISSION_CANCELLED":"WORK_ADMISSION_CONTEXT_CHANGED"));
    await f.entered.promise;
    if(change==="finish")f.ctx.saCancelAdmission(7);else f.observed.generation++;
    f.page.resolve({ai_id:"provider_future",conversation_id:null});
    await rejected;
    assert.equal(f.observed.authorizations,0);assert.equal(f.observed.mutations,0);
    assert.equal(f.ctx.saAdmissionEpochs.size,0);
  });
  await check(change+"-during-admission-handoff-cannot-revive-start",async()=>{
    const f=admissionFixture();
    const token=f.ctx.saBeginAdmission("7:pending",{operation:"start",tabId:7,store:{id:"store"}});
    token.generation=1;
    const run=f.ctx.saAdmitWork({operation:"start",tabId:7,store:{id:"store"},intentId:"start",entryToken:token});
    const rejected=assert.rejects(run,e=>e.code===(change==="finish"?"WORK_ADMISSION_CANCELLED":"WORK_ADMISSION_CONTEXT_CHANGED"));
    await f.entered.promise;
    if(change==="finish")f.ctx.saCancelAdmission(7);else f.observed.generation++;
    f.snapshot.resolve({fence:{generation:f.observed.generation}});
    await rejected;
    assert.equal(f.observed.mutations,0);
    f.ctx.saReleaseAdmission(token);assert.equal(f.ctx.saAdmissionEpochs.size,0);
  });
}


for (const transition of ["resolved-ai","denied","different-account","different-session","different-generation"]) {
  await check("authority-"+transition+"-during-preparation",async()=>{
    const f=admissionFixture();
    const run=f.ctx.saWorkStart({tab_id:7,store_id:"store"},{});
    const outcome=run.then(()=>({code:"UNEXPECTED_SUCCESS"}),error=>({code:error.code}));
    await f.entered.promise;
    const active=f.ctx.saBeginAdmission("99:active",{operation:"start",tabId:99,store:{id:"store"}});
    const next={...f.observed.authority,workAllowed:true,requestedAi:"provider_future"};
    if(transition==="denied")next.workAllowed=false;
    if(transition==="different-account")next.payload={account:{id:"account-B"}};
    if(transition==="different-session")next.sessionId="session-B";
    if(transition==="different-generation")next.generation=2;
    await f.observed.authorityChanged(next,"bootstrap_verified");
    f.page.resolve({ai_id:"provider_future",conversation_id:null});
    assert.equal((await outcome).code,transition==="resolved-ai"?"ENTRY_PASSED":"WORK_ADMISSION_CANCELLED");
    assert.equal(active.cancelled,true,"previously admitted work still loses old authority");
    f.ctx.saReleaseAdmission(active);
    assert.equal(f.ctx.saAdmissionEpochs.size,0);
  });
}

for (const transition of ["own-resolution","finish","account","session","wrong-ai","generation-gap","denied"]) {
  await check("first-bootstrap-generation-"+transition,async()=>{
    const f=admissionFixture();
    f.ctx.SellerAgentsControlClient.ensureForIdentity=async()=>{
      f.observed.authorizations++;
      const next={...f.observed.authority,generation:2,workAllowed:true,requestedAi:"provider_future"};
      if(transition==="finish")f.ctx.saCancelAdmission(7);
      if(transition==="account")next.payload={account:{id:"account-B"}};
      if(transition==="session")next.sessionId="session-B";
      if(transition==="wrong-ai")next.requestedAi="another_provider";
      if(transition==="generation-gap")next.generation=3;
      if(transition==="denied")next.workAllowed=false;
      f.observed.generation=next.generation;
      f.observed.authority=next;
      await f.observed.authorityChanged(next,"bootstrap_verified");
    };
    f.ctx.SellerAgentsControlClient.canWork=async()=>true;
    f.ctx.saCatalog={get:async()=>({id:"store"})};
    f.ctx.tabIdentity=async()=>({ai_id:"provider_future",conversation_id:null});
    f.ctx.OzonWorkSessionModel={STATES:{}};
    f.ctx.saAssertReconciliationAction=async()=>{};
    f.ctx.saAdmitWork=async({entryToken})=>{
      assert.equal(f.ctx.saAdmissionCurrent(entryToken),true);
      assert.equal(entryToken.generation,2);
      throw Object.assign(new Error("ENTRY_PASSED"),{code:"ENTRY_PASSED"});
    };
    const run=f.ctx.saWorkStart({tab_id:7,store_id:"store"},{});
    const outcome=run.then(()=>({code:"UNEXPECTED_SUCCESS"}),error=>({code:error.code}));
    await f.entered.promise;
    f.page.resolve({ai_id:"provider_future",conversation_id:null});
    assert.equal((await outcome).code,transition==="own-resolution"?"ENTRY_PASSED":"WORK_ADMISSION_CONTEXT_CHANGED");
    assert.equal(f.observed.authorizations,1);
    assert.equal(f.observed.mutations,0);
    assert.equal(f.ctx.saAdmissionEpochs.size,0);
  });
}

console.log(JSON.stringify({status:"PASS",cases:results},null,2));
