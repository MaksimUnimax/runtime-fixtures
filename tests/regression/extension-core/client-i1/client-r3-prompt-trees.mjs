import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext, runInNewContext } from "node:vm";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
const root=resolve(process.argv[2] || process.cwd());
globalThis.crypto ||= webcrypto;
const moduleFiles=["packages/control-client/src/prompt-trees.js","packages/control-client/src/crypto.js"];
const storeBundle=existsSync(resolve(root,"manifest.json")) && existsSync(resolve(root,"service_worker.js"));
const packaged=storeBundle || existsSync(resolve(root,"shared/bootstrap_verifier.js"));
if(storeBundle) {
  const worker=readFileSync(resolve(root,"service_worker.js"),"utf8");
  const sourceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
  for(const file of moduleFiles) {
    const expected=readFileSync(resolve(sourceRoot,file),"utf8");
    const start=worker.indexOf(expected);
    assert.ok(start>=0,`Exact source module missing from STORE service_worker.js: ${file}`);
    assert.equal(worker.indexOf(expected,start+1),-1,`Duplicate STORE module: ${file}`);
    // Execute bytes read from the archive, not the source used to locate them.
    runInThisContext(worker.slice(start,start+expected.length),{filename:`service_worker.js:${file}`});
  }
  console.log("PACKAGE module provenance: exact prompt-tree and crypto bytes from STORE service_worker.js; not installed worker acceptance.");
} else {
  for(const file of packaged?["shared/bootstrap_verifier.js"]:moduleFiles)
    runInThisContext(readFileSync(resolve(root,file),"utf8"),{filename:file});
}
const trees=globalThis.OctoportPromptTrees,verifier=globalThis.SellerAgentsBootstrapVerifier;
const {privateKey,publicKey}=generateKeyPairSync("ed25519"),der=publicKey.export({type:"spki",format:"der"});
const bundle={trustBundleVersion:"bootstrap_trust_bundle_v1",algorithm:"Ed25519",publicKeyFormat:"spki_der",publicKeyEncoding:"base64",
  fingerprintAlgorithm:"sha256",fingerprintEncoding:"lowercase_hex",keys:[{keyId:"tree-key",publicKey:der.toString("base64"),
    fingerprintSha256:createHash("sha256").update(der).digest("hex"),lifecycle:"ACTIVE",trustEligibility:"SIGNING_AND_VERIFICATION"}]};
const uuid=n=>`${String(n).padStart(8,"0")}-1111-4111-8111-111111111111`;
const detected=family=>({family,surface:"web",variant:null});
const body=text=>({format:"octoport_prompt_tree_v1",root:"root",nodes:[{id:"root",text,children:[]}]});
const copy=value=>JSON.parse(JSON.stringify(value));
function envelope(claim,domain="Octoport ai prompt tree v1\0") {
  const bytes=Buffer.from(verifier.canonicalJson(claim));
  return {treeEnvelopeVersion:"ai_prompt_tree_envelope_v1",algorithm:"Ed25519",keyId:"tree-key",payload:bytes.toString("base64url"),
    signature:sign(null,Buffer.concat([Buffer.from(domain),Buffer.from("tree-key\0"),bytes]),privateKey).toString("base64url")};
}
function fixture() {
  let memory={},clock=1000000,context={origin:"https://control.invalid",accountId:uuid(1),deviceId:uuid(2),sessionId:uuid(3),principalEpoch:1,accessEpoch:1};
  const versions={chatgpt:{aiId:uuid(4),version:1,body:body("GPT only")},alice:{aiId:uuid(5),version:1,body:body("Alice only")},third:{aiId:uuid(6),version:1,body:body("Third AI")}};
  const trace={fetches:0,bodyDownloads:0,providerApi:0,send:0};let hook=null,dropWrite=false,rewriteStored=value=>value;
  const storage={get:async key=>({[key]:memory[key]===undefined?undefined:copy(memory[key])}),set:async value=>{if(!dropWrite)memory={...memory,...rewriteStored(copy(value))};}};
  const fetchManifest=async request=>{
    trace.fetches++;const v=versions[request.detected.family],sha256=await trees.digest(v.body);
    const same=request.known?.aiId===v.aiId&&request.known.version===v.version&&request.known.sha256===sha256;
    const claim={claimVersion:"ai_prompt_tree_claim_v1",accountId:request.context.accountId,deviceId:request.context.deviceId,
      sessionId:request.context.sessionId,requestNonce:request.requestNonce,detected:request.detected,aiId:v.aiId,
      issuedAt:"2026-10-10T15:00:00.000Z",publication:{version:v.version,format:"octoport_prompt_tree_v1",sha256,
        body:same?null:copy(v.body),publishedAt:"2026-10-10T14:00:00.000Z"}};
    if(!same)trace.bodyDownloads++;return hook?hook(claim,request):envelope(claim);
  };
  const make=()=>trees.createCache({storage,verifier,trustBundle:bundle,authorize:async()=>context?copy(context):null,fetchManifest,now:()=>clock});
  return {cache:make(),make,trace,versions,memory:()=>memory,setMemory:x=>{memory=x;},advance:()=>{clock+=7*60*60*1000;},
    hook:fn=>{hook=fn;},deny:()=>{context=null;},changePrincipal:()=>{context={...context,sessionId:uuid(20),principalEpoch:2};},dropWrite:()=>{dropWrite=true;},rewriteStored:fn=>{rewriteStored=fn;}};
}
let passed=0;
async function test(name,run){await run();passed++;console.log(`PASS ${name}`);}
await test("AI-TREE independent permanent IDs and data-only behavior",async()=>{
 const f=fixture();const [g,a]=await Promise.all([f.cache.get(detected("chatgpt")),f.cache.get(detected("alice"))]);
 assert.notEqual(g.aiId,a.aiId);assert.equal(trees.render(g.body),"GPT only");assert.equal(trees.render(a.body),"Alice only");
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});
await test("same AI concurrent sync coalesces; Standard/Work do not invent distinct tree IDs",async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);f.hook(async c=>{await gate;return envelope(c);});
 const a=f.cache.get(detected("chatgpt")),b=f.cache.get(detected("chatgpt"));await new Promise(r=>setTimeout(r,30));release();
 const [x,y]=await Promise.all([a,b]);assert.equal(f.trace.fetches,1);assert.equal(x.aiId,y.aiId);
});
await test("new publication affects the next acquisition, never the previously returned pin",async()=>{
 const f=fixture(),pin=await f.cache.get(detected("chatgpt"));f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("New draft published")};f.advance();
 const next=await f.cache.get(detected("chatgpt"));assert.equal(pin.version,1);assert.equal(trees.render(pin.body),"GPT only");assert.equal(next.version,2);
 next.body.nodes[0].text="outside mutation";assert.equal(trees.render((await f.cache.get(detected("chatgpt"))).body),"New draft published");
});
await test("same version checks metadata without downloading body again",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.advance();await f.cache.get(detected("chatgpt"));
 assert.equal(f.trace.fetches,2);assert.equal(f.trace.bodyDownloads,1);
});
await test("nonce and account-bound responses reject replay",async()=>{
 const f=fixture();f.hook(c=>envelope({...c,requestNonce:uuid(90)}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_RESPONSE_MISMATCH/);
 f.hook(c=>envelope({...c,accountId:uuid(91)}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_RESPONSE_MISMATCH/);
 assert.deepEqual(f.memory(),{});
});
await test("signature domain and unknown signing key cannot substitute another contract",async()=>{
 const f=fixture();f.hook(c=>envelope(c,"product-control-plane/bootstrap-snapshot/v1\0"));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_INVALID_SIGNATURE/);
 f.hook(c=>({...envelope(c),keyId:"unknown-key"}));await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_UNKNOWN_SIGNING_KEY/);
});
await test("corrupt update preserves the previous verified copy",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.advance();f.hook(c=>envelope({...c,publication:{...c.publication,body:body("Corrupt bytes")}}));
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_HASH_MISMATCH/);
 assert.equal(trees.render((await f.cache.get(detected("chatgpt"),{offline:true})).body),"GPT only");
});
await test("version regression and same-version content replacement are rejected",async()=>{
 const f=fixture();f.versions.chatgpt.version=2;await f.cache.get(detected("chatgpt"));f.advance();f.versions.chatgpt.version=1;
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_VERSION_REGRESSION/);
 f.versions.chatgpt.version=2;f.versions.chatgpt.body=body("Changed same version");await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_VERSION_REGRESSION/);
});
await test("offline cache never grants authority after deny",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));f.deny();await assert.rejects(f.cache.get(detected("chatgpt"),{offline:true}),/AI_TREE_ACCESS_REQUIRED/);
});
await test("late response after principal change cannot be installed",async()=>{
 const f=fixture();f.hook(c=>{f.changePrincipal();return envelope(c);});await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_CONTEXT_CHANGED/);assert.deepEqual(f.memory(),{});
});
await test("restart re-verifies cache; modified cache is not accepted",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));const restarted=f.make();assert.equal((await restarted.get(detected("chatgpt"))).version,1);assert.equal(f.trace.fetches,1);
 const memory=copy(f.memory());Object.values(memory.octoport_prompt_trees_v1.entries)[0].body=body("Modified storage");f.setMemory(memory);
 await assert.rejects(f.make().get(detected("chatgpt"),{offline:true}),/AI_TREE_CACHE_UNVERIFIED/);
});
await test("unconfirmed cache write is not reported as installed",async()=>{
 const f=fixture();f.dropWrite();await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_READBACK_FAILED/);assert.deepEqual(f.memory(),{});
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_UNCONFIRMED/);
});
await test("Chrome reordered object keys survive readback and restart without weakening verification",async()=>{
 const f=fixture();
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"
   ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;
 f.rewriteStored(reorder);
 const first=await f.cache.get(detected("chatgpt"));
 assert.equal(first.version,1);assert.equal(trees.render(first.body),"GPT only");
 assert.deepEqual(Object.keys(f.memory().octoport_prompt_trees_v1),["aliases","entries","schema"]);
 const next=await f.make().get(detected("chatgpt"),{offline:true});
 assert.equal(next.sha256,first.sha256);assert.equal(f.trace.fetches,1);
});
await test("readback rejects modified scalar despite equivalent key order",async()=>{
 const f=fixture();f.rewriteStored(value=>{Object.values(value.octoport_prompt_trees_v1.entries)[0].body.nodes[0].text="changed";return value;});
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_READBACK_FAILED/);
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_UNCONFIRMED/);
});
await test("readback rejects changed branch order and keeps its failure latch",async()=>{
 const f=fixture();f.versions.chatgpt.body={format:"octoport_prompt_tree_v1",root:"root",nodes:[
   {id:"root",text:"Root",children:["a","b"]},{id:"a",text:"First",children:[]},{id:"b",text:"Second",children:[]}]};
 f.rewriteStored(value=>{Object.values(value.octoport_prompt_trees_v1.entries)[0].body.nodes[0].children.reverse();return value;});
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_READBACK_FAILED/);
 await assert.rejects(f.cache.get(detected("chatgpt")),/AI_TREE_STORAGE_UNCONFIRMED/);
});
await test("third AI needs no ChatGPT/Alice special case",async()=>{
 const f=fixture();const third=await f.cache.get(detected("third"));assert.equal(third.aiId,uuid(6));assert.equal(trees.render(third.body),"Third AI");
});
await test("pinned exchange keeps verified old version after update; denial still blocks it",async()=>{
 const f=fixture(),old=await f.cache.get(detected("chatgpt"));
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Next exchange")};f.advance();await f.cache.get(detected("chatgpt"));
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),old)).version,1);
 const before=f.trace.fetches;await f.cache.validatePinned(detected("chatgpt"),old);assert.equal(f.trace.fetches,before);
 f.deny();await assert.rejects(f.cache.validatePinned(detected("chatgpt"),old),/AI_TREE_ACCESS_REQUIRED/);
});
await test("foreign or mutated exchange pin is rejected without a fetch",async()=>{
 const f=fixture(),g=await f.cache.get(detected("chatgpt")),a=await f.cache.get(detected("alice"));
 await assert.rejects(f.cache.validatePinned(detected("chatgpt"),a),/AI_TREE_PIN_ID_MISMATCH/);
 const changed=copy(g);changed.body=body("Tampered pin");await assert.rejects(f.cache.validatePinned(detected("chatgpt"),changed),/AI_TREE_CACHE_UNVERIFIED/);
 assert.equal(f.trace.fetches,2);
});
await test("storage alias cannot relabel a signed cache entry as another permanent AI ID",async()=>{
 const f=fixture();await f.cache.get(detected("chatgpt"));const saved=copy(f.memory()),s=saved.octoport_prompt_trees_v1;
 const oldKey=Object.keys(s.entries)[0],parts=JSON.parse(oldKey);parts[2]=uuid(99);s.entries[JSON.stringify(parts)]=s.entries[oldKey];delete s.entries[oldKey];
 s.aliases[Object.keys(s.aliases)[0]]=uuid(99);f.setMemory(saved);
 await assert.rejects(f.make().get(detected("chatgpt"),{offline:true}),/AI_TREE_CACHE_ID_MISMATCH/);
});
await test("explicit Start receives an immediate publication; commands and old Work preserve their pin",async()=>{
 const f=fixture(),old=await f.cache.get(detected("chatgpt")),alice=await f.cache.get(detected("alice"));
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Published immediately before new dialogue")};
 const sourceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
 const runtime=readFileSync(resolve(sourceRoot,"apps/extension/src/application/runtime.js"),"utf8");
 const start=runtime.indexOf("async function saPromptTreeForExchange("),end=runtime.indexOf("\nasync function saPendingPrompt",start);
 assert.ok(start>=0&&end>start);
 const exchange=runInNewContext(runtime.slice(start,end)+"; saPromptTreeForExchange",{
   SellerAgentsControlClient:{getPromptTree:async(identity,options)=>({available:true,pin:await f.cache.get(identity,{offline:options.cacheOnly,refresh:options.refresh})})}
 });
 const current=await exchange(detected("chatgpt"));
 assert.equal(current.pin.version,2,"Explicit Start must not wait for the six-hour background interval");
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),old)).version,1);
 assert.equal((await f.cache.get(detected("alice"))).version,alice.version);
 assert.equal(trees.render(alice.body),"Alice only");
 const before=f.trace.fetches;
 assert.equal((await exchange(detected("chatgpt"),true)).pin.version,2);
 assert.equal(f.trace.fetches,before,"Ordinary command must not synchronize trees");
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});

// Owner requirement: a Work keeps its Start tree for all subsequent operations.
const workSourceRoot=fileURLToPath(new URL("../../../../",import.meta.url));
// Work and tree modules share one JSON realm in the actual worker.
const workRealm={JSON};
runInNewContext(readFileSync(resolve(workSourceRoot,"packages/bridge-core/src/work/session-model.js"),"utf8"),workRealm);
const workModel=workRealm.SellerAgentsWorkSessionModel;
function pinnedWork(pin,id="work-1",key="dialogue-1") {
 const binding=workModel.transition(workModel.normalize(null,key),"binding",{start_intent_id:id});
 return workModel.transition(binding,"active_visible",{prompt_tree:copy(pin)});
}
async function commandTree(f,work) {
 const STOP=new Error("stop before operation reservation or provider execution");
 let captured=null,validated=0;
 const prepared={requestToken:"test-request",source:{}};
 const source=readFileSync(resolve(workSourceRoot,"apps/extension/src/background/context/executeManualCommand.js"),"utf8");
 const command=runInNewContext(source+"; executeManualCommand",{
  OzonWorkSessionModel:workModel,
  normalizeConversationKey:key=>key,
  assertTabConversation:async()=>detected("chatgpt"),
  strictBindingForIdentity:async()=>({store_context:{marketplace:"ozon"}}),
  getSettings:async()=>({autoSend:true}),
  workSessionFor:async()=>workModel.normalize(copy(work),"dialogue-1"),
  getManualMode:async()=>true,getAutoRun:async()=>null,
  discoverBatchEntries:()=>[{kind:"guidance"}],
  saEnabled:async()=>true,saR3PrepareCommandSource:async()=>prepared,
  saError:code=>Object.assign(new Error(code),{code}),
  SellerAgentsControlClient:{
   canWork:async()=>true,
   validatePromptTreePin:async(identity,pin)=>{validated++;return f.cache.validatePinned(identity,pin);}
  },
  saPromptTreeForExchange:async()=>{throw new Error("Work command must not replace its pin from shared cache");},
  captureBatchContext:async()=>{captured=copy(prepared.source.promptTree||null);throw STOP;}
 });
 try {await command("OZON_HELP_V2 {}", "dialogue-1",{tab:{id:7}},"test-request");}
 catch(error) {if(error!==STOP)throw error;}
 assert.ok(captured||Object.prototype.hasOwnProperty.call(work,"prompt_tree"));
 return {captured,validated};
}
await test("Work lifetime pin survives hide/show, reload and recovery; Finish retires it",async()=>{
 const f=fixture(),pin=await f.cache.get(detected("chatgpt"));
 let work=pinnedWork(pin);
 work=workModel.transition(work,"active_hidden");
 work=workModel.normalize(copy(work),"dialogue-1");
 work=workModel.transition(work,"recovering");
 work=workModel.transition(work,"active_visible");
 assert.equal(work.prompt_tree?.sha256,pin.sha256);
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),work.prompt_tree)).version,1);
 const finished=workModel.transition(work,"finishing");
 assert.equal(finished.prompt_tree,null);
 const inactive=workModel.transition(finished,"inactive");
 assert.equal(inactive.prompt_tree,null);
});
await test("Work lifetime commands stay on Start version when a second dialogue refreshes the same AI",async()=>{
 const f=fixture(),first=await f.cache.get(detected("chatgpt")),alice=await f.cache.get(detected("alice"));
 const work=pinnedWork(first),pending=copy(first);
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Published version two")};
 const next=await f.cache.get(detected("chatgpt"),{refresh:true});
 assert.equal(next.version,2);
 const fetches=f.trace.fetches;
 assert.equal((await f.cache.validatePinned(detected("chatgpt"),pending)).version,1);
 for(let i=0;i<2;i++) {
  const result=await commandTree(f,work);
  assert.equal(result.captured.version,1);
  assert.equal(result.captured.sha256,first.sha256);
  assert.equal(result.validated,1);
 }
 assert.equal((await commandTree(f,pinnedWork(next,"work-2","dialogue-2"))).captured.version,2);
 assert.equal(f.trace.fetches,fetches,"Commands cannot synchronize or replace the Work tree");
 assert.equal((await f.cache.validatePinned(detected("alice"),alice)).version,1);
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});
await test("Work lifetime pin is revalidated and cannot bypass changed authority or signature checks",async()=>{
 const f=fixture(),pin=await f.cache.get(detected("chatgpt"));
 const changed=copy(pin);changed.body.nodes[0].text="tampered";
 await assert.rejects(commandTree(f,pinnedWork(changed)),/AI_TREE_/);
 f.deny();
 await assert.rejects(commandTree(f,pinnedWork(pin)),/AI_TREE_/);
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});
await test("Work lifetime preserves a no-tree Start and rejects an unknown legacy pin without replacing it",async()=>{
 const f=fixture();
 const none=await commandTree(f,pinnedWork(null));
 assert.equal(none.captured,null);assert.equal(none.validated,0);assert.equal(f.trace.fetches,0);
 const legacy={...pinnedWork(null)};delete legacy.prompt_tree;
 await assert.rejects(commandTree(f,legacy),{code:"WORK_PROMPT_TREE_PIN_MISSING_START_REQUIRED"});
 assert.equal(f.trace.fetches,0);assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});


await test("Work lifetime actual composed Start persists pending pin across reload and another dialogue Start",async()=>{
 const worker=packaged
  ? readFileSync(resolve(root,"service_worker.js"),"utf8")
  : execFileSync("python3",["-c",[
      "import pathlib,sys,tempfile",
      "root=pathlib.Path(sys.argv[1])",
      "sys.path.insert(0,str(root/'tooling/build'))",
      "import extension_composed",
      "with tempfile.TemporaryDirectory(prefix='octoport-tree-pin-source-') as d:",
      " extension_composed.compose(pathlib.Path(d)/'runtime')",
      " sys.stdout.write((pathlib.Path(d)/'runtime/service_worker.js').read_text())"
    ].join("\n"),workSourceRoot],{encoding:"utf8",maxBuffer:8*1024*1024});
 function segment(begin,end) {
  const a=worker.indexOf(begin),b=worker.indexOf(end,a+begin.length);
  assert.ok(a>=0&&b>a,begin+" actual composed worker boundary");
  return worker.slice(a,b);
 }
 // Composition rewrites visible labels; execute the actual generated factory bytes.
 const pendingSource=segment("async function createPendingWorkStart(","async function pendingWorkStartForMessage(");
 const storageSource=segment("async function getWorkSessions()","async function retireWorkSession(");
 const startCase=segment('      case "OZ_WORK_START": {','      case "OZ_WORK_START_COMMIT_REQUEST":');
 const identityCase=segment('      case "OZ_WORK_PENDING_IDENTITY": {','      case "OZ_WORK_PENDING_TIMEOUT": {');
 let memory={},dispatches=0,visibleAcks=0;
 const storeContext={accountId:uuid(1),marketplace:"ozon",storeId:"test-store",credentialRevision:"test-revision"};
 function boot() {
  const c={crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa,
   KEYS:{WORK_SESSIONS:"work",PENDING_WORK_STARTS:"pending",WORK_SESSION_RECOVERIES:"recoveries"},
   readStoredJSON:key=>JSON.stringify({[key]:memory[key]||{}}),
   writeStoredJSON:value=>{memory={...memory,...JSON.parse(value)};},
   withBindingWrite:async fn=>fn(),diagnostic:async()=>{},
   normalizeTabId:Number,normalizeIdentity:x=>x,
   saStarts:new Map([[7,storeContext],[8,storeContext]]),
   saAdmissionMutationGuard:async()=>{},
   tabIdentity:async tab=>({origin:"https://chatgpt.com",ai_id:"chatgpt",conversation_id:"dialogue-"+tab}),
   resolveConfirmedConversationKey:async live=>live.conversation_id,
   getAutoStartPrompt:async()=>({text:"fixture prompt"}),getGlobalAutoStartPrompt:async()=>({text:"fixture prompt"}),
   DEFAULT_AUTO_START_TEXT:"fixture prompt",
   dispatchPendingWorkStartPrompt:async()=>{dispatches++;},
   SellerAgentsOfflineWorkAuthority:{createProvenance:()=>null},
   setWorkSessionCommandAcceptance:async()=>{},
   tabMessage:async()=>{visibleAcks++;return {ok:true,applied:true};},
   clearPendingWorkStart:async tab=>{delete memory.pending[String(tab)];return true;}
  };
  // A real worker has one realm; storage and message boundaries deserialize into it.
  runInNewContext(readFileSync(resolve(workSourceRoot,"packages/control-client/src/crypto.js"),"utf8"),c);
  runInNewContext(readFileSync(resolve(workSourceRoot,"packages/bridge-core/src/work/session-model.js"),"utf8")+
    ";globalThis.OzonWorkSessionModel=globalThis.SellerAgentsWorkSessionModel",c);
  c.importJSON=runInNewContext("(text=>JSON.parse(text))",c);
  c.storageGet=runInNewContext("(async key=>JSON.parse(readStoredJSON(key)))",c);
  c.storageSet=runInNewContext("(async value=>writeStoredJSON(JSON.stringify(value)))",c);
  runInNewContext(storageSource+"\n"+pendingSource,c);
  const durableMutate=c.mutateWorkSession;
  c.mutateWorkSession=async(...args)=>{
   try{return await durableMutate(...args);}
   catch(error){throw new Error("SOURCE fixture Work writer: "+error.code+" / "+error.cause?.message,{cause:error});}
  };
  c.bindConversation=async(context,options)=>{
   const key=context.conversation_id,current=await c.workSessionFor(key);
   await c.mutateWorkSession(key,current.revision,"binding",{
    ...context,ai_id:"chatgpt",start_intent_id:options.work_start_intent_id
   });
   return {conversation_key:key,binding_id:"binding-"+key,revision:1,store_context:storeContext};
  };
  c.start=runInNewContext("(async function(message,sender){switch(message?.type){\n"+startCase+"\n}})",c);
  c.commit=runInNewContext("(async function(message,sender){switch(message?.type){\n"+identityCase+"\n}})",c);
  return c;
 }
 async function startAndPersist(c,tab,pin,intent) {
  const sender=c.importJSON(JSON.stringify({tab:{id:tab}}));
  const result=await c.start(c.importJSON(JSON.stringify({type:"OZ_WORK_START",tab_id:tab,start_intent_id:intent,prompt_tree:pin})),sender);
  assert.equal(result.ok,true);assert.equal(result.accepted,true);
  const pending=memory.pending[String(tab)];
  assert.equal(pending.prompt_tree.sha256,pin.sha256,"Start must durably preserve its exact input pin");
  memory.pending[String(tab)]={...pending,prompt_delivered:true,send_outcome:"sent_acknowledged"};
  const committed=await c.commit(c.importJSON(JSON.stringify({type:"OZ_WORK_PENDING_IDENTITY",tab_id:tab,
   intent_id:pending.intent_id,revision:pending.revision,first_response_complete:true,
   identity:{origin:"https://chatgpt.com",ai_id:"chatgpt",conversation_id:"dialogue-"+tab}})),sender);
  assert.equal(committed.ok,true,committed.error||committed.code);
  assert.equal(memory.work["dialogue-"+tab].prompt_tree.sha256,pin.sha256,
   "Actual ACTIVE_VISIBLE producer must persist pending tree pin");
 }
 const f=fixture(),first=await f.cache.get(detected("chatgpt"));
 let c=boot();await startAndPersist(c,7,first,"first-start");
 c=boot(); // New worker context reads the same serialized store.
 const restored=await c.workSessionFor("dialogue-7");
 assert.equal(restored.prompt_tree.sha256,first.sha256);
 f.versions.chatgpt={...f.versions.chatgpt,version:2,body:body("Second dialogue publication")};
 const second=await f.cache.get(detected("chatgpt"),{refresh:true});
 await startAndPersist(c,8,second,"second-start");
 const original=await c.workSessionFor("dialogue-7");
 assert.equal((await commandTree(f,original)).captured.version,1);
 assert.equal((await commandTree(f,await c.workSessionFor("dialogue-8"))).captured.version,2);
 assert.equal(dispatches,2);assert.equal(visibleAcks,2);
 assert.equal(f.trace.providerApi,0);assert.equal(f.trace.send,0);
});

console.log(JSON.stringify({level:packaged?"PACKAGE":"SOURCE",passed,installed:"NOT_RUN",owner:"NOT_RUN",providerApiCalls:0,sendCalls:0}));
