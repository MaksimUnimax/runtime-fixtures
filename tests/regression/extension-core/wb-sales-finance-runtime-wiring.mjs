import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {webcrypto,createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url),ts=require("typescript");
export const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
export const fixture=JSON.parse(fs.readFileSync(path.join(repo,"tests/regression/extension-core/fixtures/wb-sales-finance-six-pages-v1.json"),"utf8"));
export const clone=x=>x===undefined?undefined:structuredClone(x);
export const plain=x=>JSON.parse(JSON.stringify(x));
export const hash=x=>createHash("sha256").update(x).digest("hex");
function sourceText(relative){return fs.readFileSync(path.join(repo,relative),"utf8");}
function patched(relative,target) {
 let text=sourceText(relative);
 for(const patch of JSON.parse(sourceText("apps/extension/application-patches.json")))if(patch.target===target){
  assert.equal(text.split(patch.old).length-1,1,"exact application patch anchor");
  text=text.replace(patch.old,patch.new_source?sourceText(patch.new_source)+"\n":patch.new);
 }
 return text;
}
// Cache only immutable parsed source text within this one finite test process.
const parsedSources=new Map();
function nodeText(text,predicate,label){
 let file=parsedSources.get(text);
 if(!file){file=ts.createSourceFile(label,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(parsedSources.size>=12)parsedSources.delete(parsedSources.keys().next().value);parsedSources.set(text,file);}
 assert.equal(file.parseDiagnostics.length,0,label+" syntax");
 const matches=file.statements.filter(predicate);assert.equal(matches.length,1,label+" unique source boundary");
 return matches[0].getText(file);
}
export function fixtureDB(hooks={}) {
 const records=new Map();let puts=0,opens=0;
 const indexedDB={open(){
  opens++;const request={};queueMicrotask(()=>{
   request.result={objectStoreNames:{contains:()=>true},close(){},transaction(_name,mode){
    const snapshot=new Map([...records].map(([k,v])=>[k,clone(v)])),tx={};let pending=0,finished=false,aborted=false,ticket=0;
    function complete(){
     const current=++ticket;
     queueMicrotask(()=>{if(current!==ticket || pending || aborted || finished)return;finished=true;
      if(mode==="readwrite"){records.clear();for(const [k,v]of snapshot)records.set(k,clone(v));}
      hooks.afterCommit?.();tx.oncomplete?.();
     });
    }
    function op(kind,value){
     const r={};pending++;ticket++;
     queueMicrotask(()=>{
      if(aborted)return;
      try{
       if(kind==="put"){hooks.beforePut?.(value);snapshot.set(value.artifact_key??value.requestId,clone(value));puts++;}
       if(kind==="delete")snapshot.delete(value);
       if(kind==="clear")snapshot.clear();
       r.result=kind==="get"?clone(snapshot.get(value)):kind==="all"?[...snapshot.values()].map(clone):undefined;
       r.onsuccess?.();
      }catch(error){r.error=error;r.onerror?.();tx.error=error;tx.onerror?.();}
      pending--;complete();
     });return r;
    }
    tx.objectStore=()=>({get:k=>op("get",k),getAll:()=>op("all"),put:v=>op("put",v),delete:k=>op("delete",k),clear:()=>op("clear")});
    tx.abort=()=>{if(aborted || finished)return;aborted=true;queueMicrotask(()=>tx.onabort?.());};
    return tx;
   }};
   request.onsuccess?.();
  });return request;
 }};
 return {indexedDB,records,get puts(){return puts;},get opens(){return opens;}};
}
export async function createHarness(runtimePath=null,options={}) {
 const runtime=runtimePath && fs.existsSync(path.join(runtimePath,"service_worker.js"))?runtimePath:null;
 const recipe=JSON.parse(sourceText("apps/extension/composition.json"));
 const manifest=runtime?JSON.parse(fs.readFileSync(path.join(runtime,"manifest.json"),"utf8")):null;
 const workerMember=manifest?.background?.scripts?.[0]||"service_worker.js";
 const workerSource=runtime?fs.readFileSync(path.join(runtime,workerMember),"utf8"):null;
 const applicationSource=runtime?fs.readFileSync(path.join(runtime,"shared/application.js"),"utf8"):sourceText("apps/extension/src/application/runtime.js");
 const events=[],network=[],deliveries=[],hooks={},backing={};
 let clock=Date.now(),mono=0,sequence=0,pending=Promise.resolve(),r3Sequence=0;
 const key=options.key||"https://chatgpt.com|cap19-fixture";
 const live={accountId:"CAP19_SYNTHETIC_ACCOUNT",storeId:"CAP19_SYNTHETIC_STORE",marketplace:"wildberries",credentialRevision:"opaque-fixture-revision",
  conversationKey:key,bindingId:"CAP19_SYNTHETIC_BINDING",bindingRevision:1,workSessionId:"CAP19_SYNTHETIC_WORK",policyRevision:"personal-enabled",authGeneration:1,
  scopeKey:"synthetic-scope",principalEpoch:1,accessEpoch:1,grantEpoch:1,workGeneration:1,aiFamily:"chatgpt",active:true};
 const db=fixtureDB(hooks);
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const listeners=[],messages=[];
 const realm=vm.createContext({console,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,AbortController,structuredClone,
  Date:ClockDate,performance:{now:()=>mono},setTimeout,clearTimeout,queueMicrotask,
  crypto:{randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
   if(hooks.pauseDigest){const pause=hooks.pauseDigest;hooks.pauseDigest=null;await pause();}
   return webcrypto.subtle.digest(...args);
  }}},indexedDB:db.indexedDB,
  fetch:()=>{throw new Error("UNEXPECTED_REAL_NETWORK");},
  btoa:s=>Buffer.from(s,"binary").toString("base64"),atob:s=>Buffer.from(s,"base64").toString("binary"),
  chrome:{runtime:{onConnect:{addListener:fn=>listeners.push(fn)},onMessage:{addListener:fn=>messages.push(fn)}},
   storage:{local:{get:async request=>typeof request==="string"?{[request]:clone(backing[request])}:Object.fromEntries(request.map(k=>[k,clone(backing[k])])),set:async values=>Object.assign(backing,clone(values))}}},
  OzonRuntime:{STORAGE_KEYS:{MANUAL_OPERATIONS:"manual",AUTO_RUNS:"auto",MANUAL_MODES:"manualModes",REPORT_PREFIXES:"reportPrefixes"}},
  ProviderTransportCore:{},BB2ConversationIdentity:{providerForOrigin:origin=>origin==="https://chatgpt.com"?"chatgpt":null}
 });
 const run=(s,name)=>vm.runInContext(s,realm,{filename:name,timeout:5000});
 function moduleFile(relative,globalName){
  const code=runtime?nodeText(workerSource,n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.getText().includes("globalThis."+globalName+" ="),globalName):sourceText(relative);
  run(code,relative);
 }
 for(const [file,name]of [
  ["local-operations.js","SellerAgentsLocalOperations"],["context.js","SellerAgentsExecutionContext"],
  ["provider-response-policy.js","SellerAgentsProviderResponsePolicy"],["provider-response-verifier.js","SellerAgentsProviderResponseVerifier"],
  ["provider-response-disposition.js","SellerAgentsProviderResponseDisposition"],["provider-response-retention.js","SellerAgentsProviderResponseRetention"],
  ["provider-outcome.js","SellerAgentsProviderOutcome"],["result-recovery.js","SellerAgentsResultRecovery"],
  ["command-ledger.js","SellerAgentsCommandLedger"],["batch-queue.js","SellerAgentsBatchQueue"],["guarded-queue.js","SellerAgentsGuardedBatchQueue"],["observed-quota.js","SellerAgentsObservedQuota"]
 ]) moduleFile("packages/bridge-core/src/execution/"+file,name);
 if(runtime)run(fs.readFileSync(path.join(runtime,"shared/mixed_batch_discovery.js"),"utf8"),"packaged mixed discovery");
 else run(sourceText("packages/bridge-core/src/protocol/mixed-discovery.js"),"source mixed discovery");
 if(runtime)run(fs.readFileSync(path.join(runtime,"shared/wb_adapter.js"),"utf8"),"packaged WB graph");
 else {
  const wb=recipe.isolated_bundles["shared/wb_adapter.js"];
  run("(()=>{const scope=Object.create(null);(function(globalThis){\n"+wb.reference_sources.map(sourceText).join("\n;\n")+
   "\n})(scope);globalThis.SellerAgentsWBReference=Object.freeze({contract:scope.WBContract,credentials:scope.WBCredentials,guidance:scope.WBGuidance,transport:scope.ProviderTransportCore});})();\n"+
   wb.sources.map(sourceText).join("\n;\n"),"source WB exact recipe");
 }
 const capability=runtime?fs.readFileSync(path.join(runtime,"shared/ai_delivery_capabilities.js"),"utf8"):
  patched(recipe.baseline+"/shared/ai_delivery_capabilities.js","shared/ai_delivery_capabilities.js");
 run(capability,"actual capability source");
 run(runtime?fs.readFileSync(path.join(runtime,"shared/bridge_autorun_model.js"),"utf8"):
  recipe.bundles["shared/bridge_autorun_model.js"].map(sourceText).join("\n;\n"),"actual planner/claim");
 const read=async request=>typeof request==="string"?{[request]:clone(backing[request])}:Object.fromEntries(request.map(k=>[k,clone(backing[k])]));
 const records=realm.SellerAgentsLocalOperations.createRecordStore({read,write:async value=>{Object.assign(backing,clone(value));hooks.ownerWrite?.(value);},namespace:"manual",writerKey:"manual"});
 const getOwner=()=>records.get(key);
 const mutateOwner=fn=>records.mutate(key,fn);
 async function guardFor(owner) {
  const expected=owner.execution_context;
  const context=await realm.SellerAgentsWBAdapter.createContext({snapshot:expected,credentials:{token:options.token||"PUBLIC_SYNTHETIC_CAP19_TOKEN"},readCurrent:async()=>{
   events.push("context");
   const current=await getOwner();
   return {...expected,...live,active:live.active && current?.operation_id===owner.operation_id};
  }});
  return {...context,assertDispatchAuthority:async()=>{events.push("dispatch");await context.assertCurrent();}};
 }
 const fakeFetch=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;
  const page=(options.pages||fixture.pages).find(p=>p.stream==="sales"?u.pathname===p.expectedRequest.pathname && u.searchParams.get("dateFrom")===p.command.params.query.dateFrom:
   u.pathname===p.expectedRequest.pathname && body?.rrdId===p.command.params.body.rrdId);
  assert.ok(page,"no extra/fifth/provider request");
  assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
  network.push({pageId:page.pageId,method:init.method,host:u.hostname});
  hooks.fetch?.(page);
  if(hooks.fetchError)throw new Error("SYNTHETIC_NETWORK_FAILURE");
  const ct=Object.hasOwn(page.response,"testContentType")?page.response.testContentType:"application/json";
  return new Response(page.response.httpStatus===204?null:page.response.rawText,{status:page.response.httpStatus,headers:ct===null?{}:{"content-type":ct}});
 };
 const baseManual=realm.SellerAgentsWBSalesFinanceManual;
 const coordinator=baseManual.createCoordinator({now:()=>clock,monotonic:()=>mono,fetchImpl:fakeFetch});
 realm.SellerAgentsWBSalesFinanceManual=Object.freeze({createCoordinator:baseManual.createCoordinator,...coordinator});
 const diagnostics=[];
 const statuses={REQUESTING:"requesting",DELIVERING:"delivering",COMPLETED:"completed",FAILED:"failed"};
 Object.assign(realm,{
  MANUAL_OPERATION_STATUSES:statuses,normalizeConversationKey:v=>String(v).trim().toLowerCase(),
  normalizeIdentity:v=>({...v,status:"confirmed",origin:String(v.origin).toLowerCase(),conversation_id:String(v.conversation_id).toLowerCase()}),
  assertTabConversation:async()=>{events.push("identity");return {origin:options.origin||"https://chatgpt.com",conversation_id:"cap19-fixture",ai_id:"chatgpt"};},
  strictBindingForIdentity:async()=>({binding_id:live.bindingId,revision:live.bindingRevision,ai_id:"chatgpt",store_context:{...live}}),
  getSettings:async()=>({autoSend:true}),workSessionFor:async()=>({state:"active_visible",start_intent_id:live.workSessionId,prompt_tree:null}),
  OzonWorkSessionModel:{STATES:{ACTIVE_VISIBLE:"active_visible"}},getManualMode:async()=>true,getAutoRun:async()=>null,
  saEnabled:async()=>true,saError:code=>Object.assign(new Error(code),{code}),
  SellerAgentsControlClient:{currentAccount:async()=>live.accountId,canWork:async()=>{events.push("canWork");return true;}},
  saR3RetryPermits:new WeakSet(),
  saR3ReserveCommand:async()=>{events.push("R3_reserve");return {executionId:"fixture-r3-"+(++r3Sequence),payloadExpiresAt:clock+3600000};},
  captureBatchContext:async(_key,text,token)=>{const {active,...context}=live;return {...context,commandHash:hash(text),requestId:token};},
  readBatchContextState:async(_key,fields)=>({...live,...fields}),
  bindingSnapshot:binding=>clone(binding),
  mutateManualOperation:async(_key,fn)=>mutateOwner(fn),getManualOperation:async()=>getOwner(),
  manualOperationActive:o=>o && ["requesting","delivering"].includes(o.status),
  createBatchExecutionGuard:guardFor,
  saGuard:guardFor,
  saAssertDeliveryOwner:async owner=>{hooks.guard?.();await(await guardFor(owner)).assertCurrent();},
  assertManualBatchContext:async()=>{const owner=await getOwner();await(await guardFor(owner)).assertCurrent();},
  failManualBatch:async(_key,id,code,message)=>mutateOwner(o=>o?.operation_id===id?{...o,status:"failed",last_error:{code,message}}:o),
  batchErrorEntry:(error)=>({kind:"pre_execution_error",status:"pending",error:{code:error.code}}),
  diagnostic:async(kind,data)=>{events.push("diagnostic:"+kind);diagnostics.push({kind,data:clone(data)});assert.ok(!JSON.stringify(data).includes(options.token||"PUBLIC_SYNTHETIC_CAP19_TOKEN"));},
  withConversationMapsWrite:async fn=>fn(),
  applyPrefixToReport:async(_key,text)=>({outgoing_text:text,report_prefix_applied:false}),
  formatCombinedBatchReport:entries=>entries.map(e=>e.report_text||"").join("\n"),
  attemptManualBatchDelivery:()=>{events.push("delivery-push");},
  saAdmissionEpochs:new Map(),
  saQuota:realm.SellerAgentsObservedQuota.create({read,write:async value=>Object.assign(backing,clone(value)),namespace:"quota",now:()=>clock}),
  WORKER_SESSION_ID:"CAP19_TEST_WORKER",batchCollectionRequests:new Map(),saFileOwners:new Map(),
  sha256Hex:async text=>hash(text),
 });
 // The real current producer and runtime branch are used. Dependency authority,
 // UI identity and R3 reservation services above are explicit synthetic fixtures.
 function fn(relative,name) {
  const code=nodeText(runtime?workerSource:sourceText(relative),n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,name);
  run(code,relative);
 }
 // Execute the unchanged real R3 source validator and real block-key code.
 // UI/account authority and reservation service remain explicit synthetic ports.
 realm.SellerAgentsBootstrapVerifier={canonicalJson:coordinator.canonical};
 const sourceLedger=realm.SellerAgentsCommandLedger.createCommandLedger({
  store:records,canonicalJson:coordinator.canonical,sha256:async text=>hash(text),
  assertContext:async()=>{throw new Error("UNEXPECTED_LEDGER_EFFECT");},
  classifyReadOnly:()=>{throw new Error("UNEXPECTED_LEDGER_EFFECT");},
  readBuffer:()=>{throw new Error("UNEXPECTED_LEDGER_EFFECT");}
 });
 realm.saR3Ledger=()=>sourceLedger;
 run(nodeText(applicationSource,n=>ts.isFunctionDeclaration(n)&&n.name?.text==="saR3PrepareCommandSource","actual R3 prepare"),"actual R3 source approval");
 const actualR3Prepare=realm.saR3PrepareCommandSource;
 realm.saR3PrepareCommandSource=(...args)=>{events.push("R3_source");return actualR3Prepare(...args);};
 fn("apps/extension/src/background/context/executeManualCommand.js","executeManualCommand");
 fn("apps/extension/src/background/context/runtime-context.js","runComposedBatchQueue");
 fn("apps/extension/src/background/context/finalizeManualBatch.js","finalizeManualBatch");
 if(runtime) {
  for(const name of ["saCombinedReport","saPrepareDelivery","saPrepareCAP19Delivery",...(applicationSource.includes("function saAssertCAP19ValueSafety(")?["saAssertCAP19ValueSafety"]:[])])
   run(nodeText(applicationSource,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,name),name);
 }else run(sourceText("apps/extension/src/application/delivery.js"),"actual application delivery");
 for(const name of ["saCancelAdmission","saCancelAdmissionsForStore"]) {
  const text=applicationSource;
  run(nodeText(text,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name,name),name);
 }
 const artifact=runtime?fs.readFileSync(path.join(runtime,"shared/file_delivery_port_worker.js"),"utf8"):
  patched(recipe.baseline+"/shared/file_delivery_port_worker.js","shared/file_delivery_port_worker.js");
 run(runtime?fs.readFileSync(path.join(runtime,"shared/attachment_result_integrity.js"),"utf8"):sourceText("apps/extension/src/application/attachment-result-integrity.js"),"unchanged protected attachment result integrity");
 run(artifact,"actual effective artifact worker");
 realm.launchBatchProcessor=(_kind,_key,id)=>{
  pending=realm.runComposedBatchQueue({
   conversationKey:key,ownerKind:"manual",ownerId:id,getOwner,mutateOwner,
   ownerMatches:o=>o?.operation_id===id,isCollecting:o=>o?.status==="requesting",
   failOwner:(code,message)=>realm.failManualBatch(key,id,code,message),
   finalizeOwner:(owner,entries)=>realm.finalizeManualBatch(key,id,entries,owner.batch)
  });pending.catch(()=>{});
 };
 const sender={tab:{id:17,url:options.origin||"https://chatgpt.com/c/cap19-fixture"},url:options.origin||"https://chatgpt.com/c/cap19-fixture"};
 async function execute(text,opts={}) {
  const source=opts.source===undefined?{protocol:2,messageIdentity:{kind:"provider-message",id:"message-"+(++sequence)},documentKey:"fixture-document",workSessionId:live.workSessionId,bindingId:live.bindingId,conversationKey:key,blockOrdinal:0}:opts.source;
  const response=await realm.executeManualCommand(text,key,sender,"manual-"+sequence,source);
  assert.equal(response.accepted,true);await pending;
  return getOwner();
 }
 function block(pages,collectionId=null,extra={}) {
  const manifest=collectionId?{action:"continue",collectionId,pages:pages.map((p,i)=>({entryOrdinal:i,stream:p.stream,ordinal:p.ordinal}))}:
   {action:"begin",businessPeriod:fixture.scope.businessPeriod,salesAcquisition:{updatedSince:fixture.scope.salesAcquisition.updatedSince,flag:0},financePeriod:"daily",pages:pages.map((p,i)=>({entryOrdinal:i,stream:p.stream,ordinal:p.ordinal}))};
  Object.assign(manifest,extra);
  return "WB_CAP19_V1\n"+JSON.stringify(manifest)+"\n"+pages.map(p=>"WB_API_V1\n"+JSON.stringify(p.command)).join("\n");
 }
 async function ackFixture(){await mutateOwner(owner=>({...owner,status:"completed",delivery_confirmed:true}));}
 async function runSix({oneBlock=false,ack=ackFixture}={}) {
  let owner;
  if(oneBlock)owner=await execute(block(fixture.pages));
  else {
   let id=null;
   for(let i=0;i<3;i++){
    const pages=[fixture.pages[i],fixture.pages[i+3]];
    owner=await execute(block(pages,id));id=owner.cap19_collection?.collectionId;
    assert.ok(id);if(i<2)await ack();
   }
  }
  return owner;
 }
 assert.ok(listeners.length>=2,"actual integrity guard and artifact consumer listeners");
 async function port(type,extra={},senderOverride=sender) {
  const owner=await getOwner();let handler;
  const response=new Promise(resolve=>{
   const port={name:realm.OzonFileDeliveryWorker.PORT_NAME,sender:senderOverride,onMessage:{addListener:fn=>{handler=fn;}},postMessage:value=>resolve(value.response)};
   for(const listener of listeners)listener(port);
   handler({request_id:"request-"+(++sequence),type,conversation_key:key,owner_kind:"manual",owner_id:owner.operation_id,
    delivery_id:owner.delivery?.delivery_id,live_owner:{status:"confirmed",origin:owner.origin,conversation_id:owner.conversation_id},actor_id:"actor",...extra});
  });
  return response;
 }
 return {realm,coordinator,events,diagnostics,network,hooks,db,backing,getOwner,mutateOwner,execute,block,runSix,ackFixture,port,live,key,sender,
  advance(ms){clock+=ms;mono+=ms;},advanceMonotonic(ms){mono+=ms;},rollbackClock(ms){clock-=ms;},get clock(){return clock;},runtime,artifactSourceHash:hash(artifact)};
}

export async function reviewRepairCases(runtime=null,{collect=false}={}) {
 const cases=[];const test=async(name,fn)=>{try{await fn();cases.push({name,status:"PASS"});}catch(error){cases.push({name,status:"FAIL",code:error.code||error.name,message:error.message});if(!collect)throw error;}};
 for(const marker of ["WB_CAP19_V2","WB_CAP19_V10","WB_CAP19_V0","WB_CAP19_V01","WB_CAP19","WB_CAP19_V","WB_CAP19_V1extra","WB_CAP19-V1"])
 await test("reserved CAP19 family refuses "+marker+" before R3 and dispatch",async()=>{
  const h=await createHarness(runtime);
  await assert.rejects(()=>h.execute(h.block([fixture.pages[0],fixture.pages[3]]).replace("WB_CAP19_V1",marker)));
  assert.equal(h.events.includes("R3_reserve"),false);assert.equal(h.network.length,0);
 });
 await test("quoted family literals in API JSON are ordinary data",async()=>{
  const h=await createHarness(runtime);
  for(const marker of ["WB_CAP19_V1","WB_CAP19_V2","WB_CAP19","WB_CAP19-V1"])
   assert.equal(h.coordinator.parseSelection("WB_API_V1\n"+JSON.stringify({operation:"seller_info",params:{body:{label:marker}}}),[]),null);
 });
 for(const contentType of [null,"text/plain","application/octet-stream"])
 await test("real bodyless finance 204 accepts "+String(contentType)+" header",async()=>{
  const pages=clone(fixture.pages);pages.find(p=>p.stream==="finance"&&p.response.httpStatus===204).response.testContentType=contentType;
  const h=await createHarness(runtime,{pages}),owner=await h.runSix({oneBlock:true});
  assert.equal(h.network.length,6);assert.equal(owner.status,"delivering");assert.equal(owner.delivery.derived_file_refs.length,1);
  const record=h.db.records.get(owner.delivery.derived_file_refs[0].artifact_key);
  assert.equal(JSON.parse(new TextDecoder().decode(record.bytes)).streams.finance.terminal,"204_EMPTY_BODY");
 });
 for(const contentType of [null,"text/plain"])await test("non-JSON 200 remains rejected "+String(contentType),async()=>{
  const pages=clone(fixture.pages);pages[0].response.testContentType=contentType;
  const h=await createHarness(runtime,{pages}),owner=await h.runSix({oneBlock:true});
  assert.equal(owner.status,"failed");assert.equal(h.db.records.size,0);assert.equal(h.network.length,1);
 });
 const fields=[["sales","saleID"],["sales","srid"],["finance","srid"],["finance","sellerOperName"],["finance","docTypeName"]];
 for(const [stream,field]of fields)for(const escaped of [false,true])await test("credential echo veto "+stream+"."+field+(escaped?" escaped":" plain"),async()=>{
  const token="PUBLIC_SYNTHETIC_CAP19_TOKEN",pages=clone(fixture.pages);
  for(const p of pages.filter(p=>p.stream===stream&&p.response.httpStatus===200&&p.response.rawText!=="[]")){
   const pattern=new RegExp('("'+field+'"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*")',"g");
   p.response.rawText=p.response.rawText.replace(pattern,(_all,prefix,value)=>prefix+JSON.stringify(JSON.parse(value)+"-"+token+"-suffix"));
   if(escaped)p.response.rawText=p.response.rawText.replaceAll(token,Array.from(token,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0")).join(""));
  }
  const h=await createHarness(runtime,{pages,token}),owner=await h.runSix({oneBlock:true});
  assert.equal(owner.status,"failed");assert.equal(owner.last_error.code,"CAP19_COLLECTION_FAILED_NO_RETRY");
  assert.equal(h.db.records.size,0);assert.equal(owner.cap19_artifact_intent,undefined);
  assert.equal(owner.delivery?.derived_file_refs?.length||0,0);
  assert.equal(owner.batch.entries.filter(e=>e.status==="complete").length,h.network.length,"known results committed before stop");
  assert.ok(!JSON.stringify(owner).includes(token),"no exact credential in durable owner/descriptor/report");
  assert.ok(!JSON.stringify(h.diagnostics).includes(token),"no credential diagnostic");
  assert.equal(h.network.length,stream==="sales"?1:4,"no retry or later dispatch");
 });
 // These valid wire values exercise dates, currency, numeric IDs and decimals
 // without making invalid rows that would merely fail another parser rule.
 for(const [label,token]of [
  ["currency","KZT"],["source date","2026-09-26T"],["numeric ID","9007199254740993"],["decimal money","100.10"]
 ])await test("all retained value classes veto exact synthetic credential "+label,async()=>{
  const pages=clone(fixture.pages);
  if(label==="numeric ID")for(const p of pages)p.response.rawText=p.response.rawText.replaceAll('"reportId":901','"reportId":9007199254740993');
  const h=await createHarness(runtime,{token,pages}),owner=await h.runSix({oneBlock:true});
  assert.equal(owner.status,"failed");assert.equal(h.db.records.size,0);assert.equal(owner.delivery?.derived_file_refs?.length||0,0);
  assert.ok(!JSON.stringify(owner.cap19_artifact_intent||{}).includes(token));
 });
 await test("excluded unknown field echo is not retained and benign values stay lossless",async()=>{
  const token="PUBLIC_SYNTHETIC_CAP19_TOKEN",pages=clone(fixture.pages);
  for(const p of pages.filter(p=>p.response.httpStatus===200&&p.response.rawText!=="[]")){
   // Append without JSON number reserialization: preserve original numeric lexemes.
   p.response.rawText=p.response.rawText.replaceAll('{"','{"unusedProviderEcho":'+JSON.stringify(token)+',"');
  }
  const h=await createHarness(runtime,{pages,token}),owner=await h.runSix({oneBlock:true});
  assert.equal(owner.status,"delivering");const ref=owner.delivery.derived_file_refs[0],record=h.db.records.get(ref.artifact_key);
  const bytes=new TextDecoder().decode(record.bytes),report=JSON.parse(bytes);
  assert.ok(!bytes.includes(token));assert.ok(!JSON.stringify(ref).includes(token));
  assert.equal(report.sales.find(r=>r.saleID==="S-CAP19-1003").forPay,"0.00");
  assert.equal(report.financeTotals[0].retailAmountSourceSignedSum,"100.10");
  assert.equal(report.links.length,4);assert.equal(h.network.length,6);
 });
 await test("newly computed aggregate is vetted again before artifact intent",async()=>{
  const pages=clone(fixture.pages),p=pages.find(p=>p.pageId==="finance-2");
  p.response.rawText=p.response.rawText.replace('"forPay":"0.00"','"forPay":"13.31"').replace('"forPay":"55.50"','"forPay":"24.14"');
  const h=await createHarness(runtime,{pages,token:"37.45"});
  await assert.rejects(()=>h.runSix({oneBlock:true}),e=>e.code==="CAP19_CREDENTIAL_ECHO");
  const owner=await h.getOwner();assert.equal(h.network.length,6);assert.equal(h.db.records.size,0);
  assert.equal(owner.batch.entries.filter(e=>e.status==="complete").length,6);assert.equal(owner.cap19_artifact_intent,undefined);
  assert.equal(h.coordinator.progressForOwner(owner).state,"INCOMPLETE");
 });
 return cases;
}


export async function quoteContextCases(runtime=null,{collect=false}={}) {
 const cases=[],test=async(name,fn)=>{try{await fn();cases.push({name,status:"PASS"});}catch(error){cases.push({name,status:"FAIL",code:error.code||error.name,message:error.message});if(!collect)throw error;}};
 const prefixes=[
  ["raw LF after orphan quote",'"\n'],["raw CRLF after orphan quote",'"\r\n'],
  ["unclosed quote",'" '],["orphan escape",'"\\" \n'],
  ["backslash then raw LF",'"\\\n'],["incomplete unicode escape",'"\\u00\n'],
  ["unclosed object string",'{"note":"\n'],["unclosed array string",'["\n']
 ];
 for(const [label,prefix]of prefixes)for(const marker of ["WB_CAP19_V1","WB_CAP19_V2"])
 await test(label+" cannot hide "+marker+" from actual producer",async()=>{
  const h=await createHarness(runtime),text=prefix+h.block([fixture.pages[0],fixture.pages[3]]).replace("WB_CAP19_V1",marker);
  await assert.rejects(()=>h.execute(text));
  assert.equal(h.events.includes("R3_reserve"),false);assert.equal(h.network.length,0);
 });
 for(const suffix of ['"\nWB_CAP19_V2\n{}','\\" WB_CAP19_V2\n{}','"\nWB_CAP19_V1\n{}'])
 await test("misplaced family after valid API cannot be hidden "+JSON.stringify(suffix),async()=>{
  const h=await createHarness(runtime),text="WB_API_V1\n"+JSON.stringify(fixture.pages[0].command)+"\n"+suffix;
  await assert.rejects(()=>h.execute(text));
  assert.equal(h.events.includes("R3_reserve"),false);assert.equal(h.network.length,0);
 });
 for(const body of [
  '{"operation":"seller_info","params":{"body":{"WB_CAP19_V2":"literal","note":"WB_CAP19_V1"}}}',
  '{"operation":"seller_info","params":{"body":{"note":"quote \\" / slash \\\\ / escaped newline \\n WB_CAP19_V2"}}}',
  '{"operation":"seller_info","params":{"body":{"note":"WB_CAP19_V2","id":9007199254740993,"money":100.10,"rows":[{"key":"WB_CAP19"}]}}}',
  '{"operation":"seller_info","params":{"body":'+Array(40).fill('{"nested":').join("")+'{"value":"WB_CAP19_V2"}'+Array(40).fill("}").join("")+'}}'
 ])await test("family keys/values remain data only in complete valid envelope "+hash(body).slice(0,8),async()=>{
  const h=await createHarness(runtime);
  for(const separator of ["\n","\u200b"]){
   assert.equal(h.coordinator.parseSelection("WB_API_V1"+separator+body,[]),null);
  }
 });
 for(const body of [
  '{"note":"WB_CAP19_V2\n"}','{"note":"WB_CAP19_V2\\q"}','{"note":"WB_CAP19_V2}',
  '{"note":"prefix","nested":{"value":"WB_CAP19_V2"}'
 ])await test("malformed apparent API JSON cannot shelter a reserved family "+hash(body).slice(0,8),async()=>{
  const h=await createHarness(runtime);
  assert.throws(()=>h.coordinator.parseSelection("WB_API_V1\n"+body+"\nWB_API_V1\n"+JSON.stringify(fixture.pages[0].command),[]),e=>/^CAP19_/.test(e.code));
 });
 await test("actual V1 begin with valid HELP preserves original selected ordinals and raw R3 hash",async()=>{
  const h=await createHarness(runtime),pages=[fixture.pages[0],fixture.pages[3]],original=h.block(pages);
  const split=original.indexOf("\nWB_API_V1"),manifest=JSON.parse(original.slice(original.indexOf("\n")+1,split));
  for(const p of manifest.pages)p.entryOrdinal++;
  const help='WB_HELP_V1\n{"operation":"catalog","params":{"offset":0,"limit":25}}';
  const text="WB_CAP19_V1\n"+JSON.stringify(manifest)+"\n"+help+original.slice(split);
  const owner=await h.execute(text);
  assert.equal(owner.status,"delivering");assert.equal(h.network.length,2);
  assert.equal(owner.r3_block_version,hash(text));
  assert.deepEqual(plain(owner.cap19_collection.pages.map(p=>p.entryOrdinal)),[1,2]);
 });
 return cases;
}


export async function envelopeOwnershipCases(runtime=null,{collect=false}={}) {
 const cases=[],test=async(name,fn)=>{try{await fn();cases.push({name,status:"PASS"});}catch(error){cases.push({name,status:"FAIL",code:error.code||error.name,message:error.message});if(!collect)throw error;}};
 const tail="WB_API_V1\n"+JSON.stringify(fixture.pages[0].command),tokens=["WB_API_V1","WB_HELP_V1","WB_HELP_V2"];
 const malformed=(outer,inner,marker,shape)=>{
  const header=outer+"\n",nested=inner+"\n"+JSON.stringify({note:marker});
  if(shape==="escape")return header+'{"note":"\\q\n'+nested+'\n"}\n'+tail;
  if(shape==="bracket")return header+'{"open":]\n'+nested+'\n}\n'+tail;
  if(shape==="unclosed")return header+'{"note":"\n'+nested+'\n'+tail;
  return header+'{"note":"\n'+nested+'\n"}\n'+tail;
 };
 const inputs=[];
 for(const outer of tokens)for(const inner of tokens)for(const marker of ["WB_CAP19_V1","WB_CAP19_V2"])inputs.push({outer,inner,marker,shape:"raw LF"});
 for(const shape of ["escape","bracket","unclosed"])for(const outer of ["WB_API_V1","WB_HELP_V2"])for(const inner of ["WB_API_V1","WB_HELP_V1"])inputs.push({outer,inner,marker:"WB_CAP19_V2",shape});
 for(const x of inputs)await test("rejected outer "+x.outer+" cannot authorize "+x.inner+" shelter: "+x.shape+" "+x.marker,async()=>{
  const h=await createHarness(runtime),text=malformed(x.outer,x.inner,x.marker,x.shape);
  await assert.rejects(()=>h.execute(text),e=>/^CAP19_/.test(e.code));
  assert.equal(h.events.includes("R3_reserve"),false);assert.equal(h.network.length,0);
 });
 for(const nested of tokens)await test("complete valid frame owns nested protocol/family data "+nested,async()=>{
  const h=await createHarness(runtime),body={note:nested+"\n"+JSON.stringify({key:"WB_CAP19_V2"}),WB_CAP19_V1:"data"};
  const text="WB_API_V1\n"+JSON.stringify(body)+"\n"+tail;
  const owner=await h.execute(text);
  assert.equal(owner.status,"delivering");assert.equal(h.network.length,1);
  assert.equal(owner.cap19_selection,undefined);assert.equal(h.events.includes("R3_reserve"),true);
  assert.equal(owner.r3_block_version,hash(text));
  assert.equal(owner.batch.entries[0].kind,"pre_execution_error");assert.equal(owner.batch.entries[0].status,"complete");
 });
 await test("full actual TXT retains unsafe product ID and money lexemes after envelope proof",async()=>{
  const pages=clone(fixture.pages);
  for(const p of pages)p.response.rawText=p.response.rawText.replaceAll('"nmId":1001','"nmId":9223372036854775807');
  const h=await createHarness(runtime,{pages}),owner=await h.runSix({oneBlock:true}),ref=owner.delivery.derived_file_refs[0];
  const report=JSON.parse(new TextDecoder().decode(h.db.records.get(ref.artifact_key).bytes));
  assert.ok(report.sales.some(r=>r.nmId==="9223372036854775807"));assert.ok(report.finance.some(r=>r.nmId==="9223372036854775807"));
  assert.ok(report.links.some(r=>r.nmId==="9223372036854775807"));assert.equal(report.links.length,4);
  assert.equal(report.sales[0].finishedPrice,"100.10");assert.equal(report.sales.find(r=>r.saleID==="S-CAP19-1003").forPay,"0.00");
 });
 return cases;
}


export async function literalNeighborCases(runtime=null,{collect=false}={}) {
 const cases=[],test=async(name,fn)=>{try{await fn();cases.push({name,status:"PASS"});}catch(error){cases.push({name,status:"FAIL",code:error.code||error.name,message:error.message});if(!collect)throw error;}};
 const badBodies=[
  '{"operation":"catalog","params":]}',
  '{"operation":"catalog","params":{"limit":1,}}',
  '{"operation":"catalog","params":{"note":"bad\\q"}}',
  '{"operation":"catalog","params":{"note":"bad\nline"}}',
  '{"operation":"catalog","params":{"unknown":1}}'
 ];
 const apiFor=kind=>{
  const filter={textSearch:kind==="key"?"ordinary search":kind==="escaped"?'quote "WB_CAP19_V2" slash \\ text':"WB_CAP19_V2"};
  if(kind==="key")filter.WB_CAP19_V2="literal key data";
  const command={operation:"cards_list",params:{body:{settings:{cursor:{limit:1},filter}}}};
  let text="WB_API_V1\n"+JSON.stringify(command);
  if(kind==="unicode")text=text.replaceAll("WB_CAP19_V2","WB\\u005fCAP19\\u005fV2");
  const page={stream:"content",pageId:"cards-list-synthetic",expectedRequest:{pathname:"/content/v2/get/cards/list"},command,
   response:{httpStatus:200,rawText:'{"cards":[],"cursor":{"total":0}}'}};
  return {text,page,command};
 };
 async function ordinary(text,api,ordinal){
  const h=await createHarness(runtime,{pages:[api.page]}),owner=await h.execute(text);
  assert.equal(h.network.length,1);assert.equal(h.network[0].host,"content-api.wildberries.ru");
  assert.equal(owner.status,"delivering");assert.equal(owner.cap19_selection,undefined);
  assert.equal(owner.r3_block_version,hash(text));assert.equal(h.events.includes("R3_reserve"),true);
  const entry=owner.batch.entries[ordinal],error=owner.batch.entries[1-ordinal];
  assert.equal(entry.kind,"command");assert.equal(entry.operation,"cards_list");assert.equal(entry.command_text,api.text);
  assert.equal(entry.status,"complete");assert.equal(error.kind,"pre_execution_error");assert.equal(error.status,"complete");
  assert.deepEqual(plain(entry.command.body),api.command.params.body);
 }
 for(const [i,bad]of badBodies.entries())for(const kind of ["value","key","escaped","unicode"])for(const order of ["before","after"])
 await test("permitted cards_list literal "+kind+" independent of HELP error "+i+" "+order,async()=>{
  const api=apiFor(kind),help="WB_HELP_V1\n"+bad;
  await ordinary(order==="before"?help+"\n"+api.text:api.text+"\n"+help,api,order==="before"?1:0);
 });
 for(const kind of ["value","key","escaped","unicode"])await test("proven earlier literal survives later unclosed HELP "+kind,async()=>{
  const api=apiFor(kind);await ordinary(api.text+'\nWB_HELP_V1\n{"operation":"catalog","params":',api,0);
 });
 for(const outer of ["WB_API_V1","WB_HELP_V1"])for(const open of ['{"note":"\n','{"nested":\n'])
 await test("unfinished outer object still owns later apparent cards_list "+outer+" "+hash(open).slice(0,6),async()=>{
  const api=apiFor("value"),h=await createHarness(runtime,{pages:[api.page]});
  await assert.rejects(()=>h.execute(outer+"\n"+open+api.text),e=>/^CAP19_/.test(e.code));
  assert.equal(h.events.includes("R3_reserve"),false);assert.equal(h.network.length,0);
 });
 return cases;
}

async function runtimeTests(runtime) {
 const cases=[];const test=async(name,fn)=>{await fn();cases.push({name,status:"PASS"});};
 await test("actual approved producer three manual blocks and six real provider callbacks",async()=>{
  const h=await createHarness(runtime),owner=await h.runSix();
  assert.equal(h.network.length,6);assert.equal(owner.status,"delivering");
  assert.equal(owner.delivery.derived_file_refs.length,1);
  assert.equal(owner.delivery.derived_file_refs[0].source_kind,"derived_business_report");
  assert.equal(owner.delivery.mode,"attachment_watch_v1");
  assert.equal(h.events.filter(v=>v==="R3_reserve").length,3);
  const record=h.db.records.get(owner.delivery.derived_file_refs[0].artifact_key);
  const report=JSON.parse(new TextDecoder().decode(record.bytes));
  assert.equal(report.links.length,4);assert.equal(report.unmatchedSales.length,1);assert.equal(report.unmatchedFinance.length,1);
  assert.equal(report.financeTotals[0].retailAmountSourceSignedSum,"100.10");
  assert.equal(report.coverage.operationalCurrency,null);assert.equal(report.coverage.FX,null);assert.equal(report.coverage.businessCoverageProved,false);
  assert.equal(report.sales.find(r=>r.saleID==="S-CAP19-1003").forPay,"0.00");
  assert.equal(report.sales.find(r=>r.saleID==="S-CAP19-1004").forPay,null);
 });
 await test("real R3 block version pins the entire original manifest and API bytes",async()=>{
  const h=await createHarness(runtime),text=h.block([fixture.pages[0]]);
  const owner=await h.execute(text);assert.equal(owner.r3_block_version,hash(text));
  assert.notEqual(owner.r3_block_version,hash(text.replace("WB_CAP19_V1","WB_CAP19_V1 ")));
 });
 for(const field of ["documentKey","workSessionId","bindingId","conversationKey"])await test("real R3 source validation refuses mismatched "+field,async()=>{
  const h=await createHarness(runtime),source={protocol:2,messageIdentity:{kind:"provider-message",id:"fresh"},documentKey:"doc",workSessionId:h.live.workSessionId,bindingId:h.live.bindingId,conversationKey:h.key,blockOrdinal:0};
  source[field]=field==="documentKey"?"":"foreign";
  await assert.rejects(()=>h.execute(h.block([fixture.pages[0]]),{source}));assert.equal(h.network.length,0);assert.equal(h.events.includes("R3_reserve"),false);
 });
 await test("one approved explicit six-page block preserves original ordinals",async()=>{
  const h=await createHarness(runtime),owner=await h.runSix({oneBlock:true});
  assert.equal(h.network.length,6);assert.equal(owner.delivery.derived_file_refs.length,1);
 });
 for(const [name,mutate]of [
  ["duplicate manifest keys",text=>text.replace('"action":"begin"','"action":"begin","action":"begin"')],
  ["multiple top-level manifests",text=>text+"\nWB_CAP19_V1\n{}"],
  ["unknown manifest field",text=>text.replace('"action":"begin"','"extra":1,"action":"begin"')],
  ["unknown action",text=>text.replace('"action":"begin"','"action":"finish"')],
  ["non-first marker",text=>"explanation\n"+text],
  ["out-of-range original ordinal",text=>text.replace('"entryOrdinal":0','"entryOrdinal":99')],
  ["marker injection in manifest",text=>text.replace('"financePeriod":"daily"','"financePeriod":"WB_API_V1"')],
  ["fractional ordinal",text=>text.replace('"entryOrdinal":0','"entryOrdinal":0.5')],
  ["malformed adjacent metadata",text=>text.replace('"action":"begin"','"action":')]
 ])await test(name+" refuses before dispatch/reservation",async()=>{
  const h=await createHarness(runtime);await assert.rejects(()=>h.execute(mutate(h.block([fixture.pages[0],fixture.pages[3]]))));
  assert.equal(h.network.length,0);assert.equal(h.events.includes("R3_reserve"),false);
 });
 await test("legacy/no-source manifest cannot activate collection",async()=>{
  const h=await createHarness(runtime);await assert.rejects(()=>h.execute(h.block([fixture.pages[0]]),{source:{protocol:1}}));
  assert.equal(h.network.length,0);
 });
 await test("expiry between explicit blocks refuses without replay",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0],fixture.pages[3]]));await h.ackFixture();h.advance(300001);
  await assert.rejects(()=>h.execute(h.block([fixture.pages[1]],first.cap19_collection.collectionId)));
  assert.equal(h.network.length,2);
 });
 await test("restart loses unfinished collection and does not replay",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0],fixture.pages[3]]));await h.ackFixture();
  const fresh=h.realm.SellerAgentsWBSalesFinanceManual.createCoordinator({fetchImpl:()=>{throw new Error("NO_REPLAY");}});
  h.realm.SellerAgentsWBSalesFinanceManual=Object.freeze({createCoordinator:h.realm.SellerAgentsWBSalesFinanceManual.createCoordinator,...fresh});
  await assert.rejects(()=>h.execute(h.block([fixture.pages[1]],first.cap19_collection.collectionId)));assert.equal(h.network.length,2);
 });
 await test("empty-admission-map conversation OR tab cancellation invalidates",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0]]));await h.ackFixture();
  assert.equal(h.realm.saAdmissionEpochs.size,0);const waits=h.realm.saCancelAdmission(999,h.key);assert.equal(waits.length,0);
  await assert.rejects(()=>h.execute(h.block([fixture.pages[1]],first.cap19_collection.collectionId)));assert.equal(h.network.length,1);
 });
 await test("unrelated store cancellation preserves active collection",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0]]));await h.ackFixture();
  h.realm.saCancelAdmissionsForStore("OTHER_STORE");
  const owner=await h.execute(h.block([fixture.pages[1]],first.cap19_collection.collectionId));assert.equal(owner.status,"delivering");assert.equal(h.network.length,2);
 });
 await test("changed store is fenced before continuation dispatch",async()=>{
  const h=await createHarness(runtime),first=await h.execute(h.block([fixture.pages[0]]));await h.ackFixture();h.live.storeId="OTHER_STORE";
  await assert.rejects(()=>h.execute(h.block([fixture.pages[1]],first.cap19_collection.collectionId)));assert.equal(h.network.length,1);
 });
 await test("literal metadata token inside API string never activates",async()=>{
  const h=await createHarness(runtime);
  assert.equal(h.coordinator.parseSelection('WB_API_V1\n{"operation":"seller_info","params":{"body":{"label":"WB_CAP19_V1"}}}',[]),null);
 });
 cases.push(...await reviewRepairCases(runtime));
 cases.push(...await quoteContextCases(runtime));
 cases.push(...await envelopeOwnershipCases(runtime));
 cases.push(...await literalNeighborCases(runtime));
 console.log(JSON.stringify({status:"PASS_SOURCE_SYNTHETIC_CAP19_RUNTIME",runtime:runtime||"source",cases:cases.length,results:cases,installed:false,liveProviderCalls:0}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runtimeTests(process.argv[2]||null);
