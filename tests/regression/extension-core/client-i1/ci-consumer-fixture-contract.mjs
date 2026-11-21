import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createHash} from "node:crypto";

const root = path.resolve(process.argv[2] || ".");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const cases = [];
const canonical = value => Array.isArray(value) ? "["+value.map(canonical).join(",")+"]" :
  value && typeof value === "object" ? "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}" : JSON.stringify(value);
const descriptor = JSON.parse(read("packages/contracts/src/ai-release-scope.v1.json"));
const bundle = {descriptor,sha256:createHash("sha256").update(canonical(descriptor)).digest("hex")};
function actualFunction(source, name) {
  const from = source.search(new RegExp("^(?:async )?function "+name+"\\(", "m"));
  assert.ok(from>=0,name);
  const rest = source.slice(from), next = rest.slice(1).search(/^(?:async )?function /m);
  return next<0 ? rest : rest.slice(0,next+1);
}
async function test(id, fn) { await fn(); cases.push({id,status:"PASS"}); }
function element() {return {hidden:false,disabled:false,textContent:"",value:"",classList:{toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){}};}
async function popupFixture(family, changes={}) {
  const nodes=new Map(), get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const store={id:"fixture-store",marketplace:"wildberries",name:"synthetic"};
  const ctx=vm.createContext({
    URL,Set,Map,Promise,
    normalizeTabId:Number,
    tabIdentity:async()=>({ai_id:family,conversation_id:null,status:"confirmed"}),
    getPendingWorkStarts:async()=>({}),saLastStartDiagnostic:async()=>null,saStartDispatchProgress:async()=>null,
    SellerAgentsControlClient:{status:async()=>({authenticated:true,workAllowed:false})},
    saPublicContext:async()=>({work_active:false}),saCatalog:{list:async()=>[store]},
    $:get,document:{createElement:element},busy:false,marketplace:"wildberries",selectedId:store.id,
    connectionPending:null,connectionSubmitPending:false,connectionCancelConfirmation:false,
    r3Review:null,confirmAction:null,renderOnboarding(){},renderRecovery(){},closeCard(){},
    nativeBackupPickerAvailable:()=>false,startStatusText:()=>null,texts:{},
  });
  vm.runInContext("globalThis.SellerAgentsControlConfig = "+JSON.stringify({aiReleaseScope:bundle})+";",ctx);
  vm.runInContext(read("packages/control-client/src/ai-release-scope.js"),ctx);
  vm.runInContext(actualFunction(read("apps/extension/src/application/runtime.js"),"saPopupState"),ctx);
  ctx.state=await ctx.saPopupState(7);
  ctx.selected=()=>ctx.state.stores.find(row=>row.id===ctx.selectedId);
  ctx.state={...ctx.state,...changes.state};
  if(Object.hasOwn(changes,"busy"))ctx.busy=changes.busy;
  vm.runInContext(actualFunction(read("apps/extension/src/application/popup.js"),"render"),ctx);
  ctx.render();
  return {state:ctx.state,disabled:get("start").disabled};
}
await test("installed-old-ChatGPT-positive-is-intentionally-disabled",async()=>{
  const actual=await popupFixture("chatgpt");
  assert.equal(actual.state.auth.authenticated,true);
  assert.equal(actual.state.stores.length,1);
  assert.equal(actual.state.pending,null);
  assert.equal(actual.state.work,null);
  assert.equal(actual.state.page.supported,false);
  assert.equal(actual.state.page.errorCode,"AI_NOT_IN_CURRENT_RELEASE");
  assert.equal(actual.disabled,true);
});
await test("installed-Alice-positive-has-real-enabled-render-path",async()=>{
  const actual=await popupFixture("alice");
  assert.equal(actual.state.page.supported,true);
  assert.equal(actual.disabled,false);
});
for(const family of descriptor.retainedAiFamilies.filter(f=>f!=="alice"))await test("seven-negative-popup/"+family,async()=>{
  const actual=await popupFixture(family);
  assert.equal(actual.state.page.supported,false);assert.equal(actual.disabled,true);
});
for(const [id,changes] of [
  ["busy",{busy:true}],["pending",{state:{pending:{intent_id:"synthetic"}}}],
  ["missing-store",{state:{stores:[]}}],
  ...["binding","recovering","finishing"].map(state=>["work-"+state,{state:{work:{state}}}]),
]) await test("Alice-other-blocker-preserved/"+id,async()=>{
  assert.equal((await popupFixture("alice",changes)).disabled,true);
});

const fixture=read("tests/regression/extension-core/claude-modal-owner-chain.py");
const begin=fixture.indexOf(" // BEGIN synthetic worker protocol");
const end=fixture.indexOf(" // END synthetic worker protocol.",begin);
assert.ok(begin>=0 && end>begin);
const protocol=fixture.slice(begin,end);
function portFixture(variant="normal") {
  const initial={origin:"https://claude.ai",conversation_id:"fixture",status:"confirmed"};
  const T={requests:[],preflights:0,commits:0,ready:0,variant,payload:"safe",bytes:new Uint8Array([1,2]),descriptor:{filename:"safe.txt"},initial,
    recovery:{owner_kind:"work",owner_id:"owner",delivery_id:"delivery",conversation_key:"https://claude.ai|fixture",delivery_phase:"attachment_claimed"},
    mutations:[],mutate(stage){this.mutations.push(stage);}};
  const ctx=vm.createContext({T,btoa:globalThis.btoa,document:{querySelector:()=>null},
    OzonAIAdapters:{adapterForLocation:()=>({composerContext:()=>({}),sendButton:()=>null})},
    SellerAgentsConversationSurface:{read:()=>initial}});
  vm.runInContext(protocol,ctx);
  const call=(type,overrides={})=>T.workerResponse({type,...T.recovery,live_owner:initial,...overrides});
  return {T,call};
}
await test("retained-Claude-preflight-commit-metadata-recovery-ready-protocol",async()=>{
  const {T,call}=portFixture();
  assert.equal(call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"}).code,"SYNTHETIC_PREFLIGHT_REQUIRED");
  assert.equal(call("OZ_ATTACHMENT_ARTIFACT_META").code,"SYNTHETIC_COMMIT_REQUIRED");
  const ready=call("OZ_ATTACHMENT_PREFLIGHT");
  assert.equal(ready.prepared,true);assert.ok(ready.recovery.bundle_part_id);
  assert.equal(call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"}).attach_allowed,true);
  assert.equal(call("OZ_ATTACHMENT_ARTIFACT_META").descriptors.length,1);
  assert.equal(call("OZ_ATTACHMENT_ARTIFACT_CHUNK").byte_length,2);
  assert.equal(call("OZ_ATTACHMENT_RECOVERY_GET").recovery.delivery_phase,"attachment_committed");
  assert.equal(call("OZ_ATTACHMENT_READY",{actor_id:"actor"}).ready,true);
  assert.equal(T.preflights,1);assert.equal(T.commits,1);assert.equal(T.ready,1);
  assert.equal(call("OZ_ATTACHMENT_READY",{actor_id:"actor"}).ready,true);assert.equal(T.ready,1);
  assert.equal(call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"}).attach_allowed,false);
  assert.equal(T.commits,1,"committed attachment is not replayed");
});
for(const [id,override] of [
  ["owner",{owner_id:"foreign"}],["delivery",{delivery_id:"foreign"}],["part",{bundle_part_id:"foreign"}],
  ["manifest",{bundle_manifest_sha256:"b".repeat(64)}],["ordinal",{bundle_part_ordinal:2}],["actor",{actor_id:"foreign"}],
])await test("retained-Claude-current-owner-guard/"+id,async()=>{
  const {T,call}=portFixture();call("OZ_ATTACHMENT_PREFLIGHT");T.expectedActor="actor";
  assert.equal(call("OZ_ATTACHMENT_COMMIT",override).code,"SYNTHETIC_OWNER_MISMATCH");
  assert.equal(T.commits,0);assert.equal(T.ready,0);
});
for(const variant of ["preflight_denied","preflight_unknown","commit_denied","commit_unknown"])await test("retained-Claude-negative-phase/"+variant,async()=>{
  const {T,call}=portFixture(variant),preflight=call("OZ_ATTACHMENT_PREFLIGHT");
  if(variant.startsWith("preflight")) {
    assert.notEqual(preflight.prepared,true);
    assert.equal(call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"}).code,"SYNTHETIC_PREFLIGHT_REQUIRED");
    assert.equal(T.commits,0);
  } else {
    assert.equal(preflight.prepared,true);
    const response=call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"});
    assert.notEqual(response.attach_allowed,true);assert.equal(T.commits,1);
    if(variant==="commit_unknown"){
      assert.equal(call("OZ_ATTACHMENT_RECOVERY_GET").recovery.delivery_phase,"attachment_committed");
      assert.equal(call("OZ_ATTACHMENT_COMMIT",{actor_id:"actor"}).attach_allowed,false);
      assert.equal(T.commits,1);
    }
  }
});
console.log(JSON.stringify({suite:"ACTUAL_RELEASE_POPUP_AND_CI_PORT_FIXTURE_CAUSAL_CONTRACT",status:"PASS",cases,
 level:"Real source render/availability modules and exact synthetic port protocol; no browser, DB, installed or live execution"},null,2));

