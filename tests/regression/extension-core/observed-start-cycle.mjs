import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { makeWorker, until } from "./worker-harness.mjs";

const runtimePath=path.resolve(process.argv[2]), out=path.resolve(process.argv[3]);
const rows=[], trace=[];
const record=(name,detail={})=>{rows.push({name,status:"PASS",...detail});};
const source=await fs.readFile(path.join(runtimePath,"content_script.js"),"utf8");
const attachment=await fs.readFile(path.join(runtimePath,"attachment_delivery_port_content.js"),"utf8");
const slice=(text,a,b)=>{const start=text.indexOf(a);assert(start>=0,a);const end=text.indexOf(b,start);assert(end>start,b);return text.slice(start,end);};
const clickSource=slice(source,"  async function handleCopy(","  function decorateBinding(");
const attachSource=slice(attachment,"  function ownerPayload(","  async function queryRecovery(");
const commandSource=await fs.readFile(path.resolve(import.meta.dirname,"../../../apps/extension/src/content/command-receipts.js"),"utf8");
assert((await fs.readFile(path.join(runtimePath,"shared/ai_adapters.js"),"utf8")).includes(commandSource.trim()),"receipt module is the composed source");
assert(commandSource,"current command source receipt module");
const command='OZON_API_V1\n'+JSON.stringify({operation:"description_category_dependent_attribute_values",params:{parent_attribute_id:85,child_attribute_id:10096,description_category_id:87515080,type_id:93733,limit:1}});
const big={result:[{id:1,value:"BEGIN_B02\n"+"full-result-line\n".repeat(90000)+"END_B02",info:"whole synthetic result"}]};
let worker;

async function startObserved(w,storeId) {
 const started=await w.popup({type:"SA_WORK_START",tab_id:w.tabId,store_id:storeId,start_intent_id:crypto.randomUUID(),confirm_change:true});
 assert.equal(started.ok,true,JSON.stringify(started));
 const pending=await until(async()=>{const p=(await w.call("getPendingWorkStarts"))[w.tabId];return p?.send_outcome==="sent_acknowledged"?p:null;},"initial prompt");
 const active=await w.request({type:"OZ_WORK_PENDING_IDENTITY",intent_id:pending.intent_id,revision:pending.revision,identity:w.identity,first_response_observed:true,first_response_complete:false});
 assert.equal(active.ok,true,JSON.stringify(active));return active;
}
async function edgeCycles() {
 for(const scenario of (process.argv[5]||"finish,dialogue_changed,store_changed,marketplace_changed").split(",").filter(Boolean)) {
  let nextStore,endedSnapshot;let release;const held=new Promise(resolve=>release=resolve);
  const w=await makeWorker(runtimePath,{fetch:async()=>{await held;return Response.json({result:[{id:1,value:"late original result"}]});}});
  try {
   await w.settings();const storeId=await w.call("(async()=>{const s=await saCatalog.list();return s[0].id;})");
   const active=await startObserved(w,storeId),key=active.binding.conversation_key,session=await w.call("workSessionFor",key);
   const admitted=await w.request({type:"OZ_EXECUTE_COMMAND",conversation_key:key,command_text:command,manual_request_id:"linked-"+scenario,work_session_id:session.start_intent_id});
   assert.equal(admitted.accepted,true,JSON.stringify(admitted));
   await until(async()=>w.network.length===1,"one pending ordinary read");
   if(scenario==="finish") {
    const ended=await w.popup({type:"OZ_WORK_FINISH",tab_id:w.tabId,conversation_key:key});assert.equal(ended.ok,true,JSON.stringify(ended));endedSnapshot=JSON.parse(JSON.stringify(await w.call("workSessionFor",key)));
   } else if(scenario==="dialogue_changed") w.setIdentity({conversation_id:"different-current-dialogue"});
   else {
    const marketplace=scenario==="marketplace_changed"?"wildberries":"ozon";
    const saved=await w.popup({type:"SA_STORE_SAVE",store:{marketplace,name:"separate synthetic store",personalDataEnabled:true,credentials:marketplace==="ozon"?{seller:{clientId:"OTHER_FIXTURE",apiKey:"OTHER_FIXTURE"},performance:{}}:{token:"WB_FIXTURE_TOKEN"}}});
    assert.equal(saved.ok,true,JSON.stringify(saved));
    const changed=await w.popup({type:"SA_WORK_START",tab_id:w.tabId,store_id:saved.store.id,start_intent_id:crypto.randomUUID(),confirm_change:true});
    assert.equal(changed.ok,false,JSON.stringify(changed));
    assert.equal(changed.code,"WORK_START_ALREADY_IN_PROGRESS","active read cannot silently adopt another store");
    nextStore=saved.store;

   }
   const pushBefore=w.messages.filter(x=>["OZ_BATCH_DELIVERY_AVAILABLE","OZ_ATTACHMENT_DELIVERY_AVAILABLE"].includes(x.type)).length;
   release();
   const owner=await until(async()=>{const o=await w.call("getManualOperation",key);return o&&(["failed","completed","cancelled"].includes(o.status)||(scenario!=="finish"&&o.delivery))?o:null;},"late-result local owner settled");
   assert.equal(owner.delivery_confirmed===true,false);
   assert.equal(w.network.length,1);
   if(scenario==="dialogue_changed") {
    assert.equal(owner.conversation_key,key);assert(owner.delivery,"keep original buffered report");
    let mutations=0;
    const c={sameConversation:()=>false,conversationKeyFromLocation:()=>"different-current-dialogue",
     primaryComposerContext:()=>{mutations++;return null;}};
    vm.createContext(c);vm.runInContext(slice(source,"  async function performBatchClaimedDelivery(","  function composerSendDeps("),c);
    const recovery=await w.call("manualBatchRecoveryPayload",owner,"deliver_claimed");
    await assert.rejects(c.performBatchClaimedDelivery(recovery),{code:"CONVERSATION_MISMATCH"});
    assert.equal(mutations,0,"different current dialogue cannot be written");
   } else if(scenario==="finish") {
    assert.equal(w.messages.filter(x=>["OZ_BATCH_DELIVERY_AVAILABLE","OZ_ATTACHMENT_DELIVERY_AVAILABLE"].includes(x.type)).length,pushBefore);
   }
   if(scenario==="finish"){const ended=await w.call("workSessionFor",key);assert.equal(ended.state,"inactive");assert.equal(ended.finished,true);assert.deepEqual(JSON.parse(JSON.stringify(ended)),endedSnapshot,"late result must not mutate finished Work");}
   if(nextStore) {
    assert.equal(owner.execution_context.storeId,storeId);
    assert.equal(owner.execution_context.marketplace,"ozon");
    const end=await w.popup({type:"OZ_WORK_FINISH",tab_id:w.tabId,conversation_key:key});assert.equal(end.ok,true,JSON.stringify(end));
    const next=await startObserved(w,nextStore.id),nextContext=await w.call("bindingForConversationKey",next.binding.conversation_key);
    assert.equal(nextContext.store_context.storeId,nextStore.id);
    assert.equal(nextContext.store_context.marketplace,nextStore.marketplace);
    assert.notEqual(next.session.start_intent_id,session.start_intent_id);
    assert.equal(w.network.length,1,"new store Start cannot replay old request");
    const recovery=await w.portRequest({type:"OZ_ATTACHMENT_RECOVERY_GET",conversation_key:key});assert(!recovery.recovery);
   }
   record(scenario+"_keeps_original_context_and_no_old_work_restore",{owner_status:owner.status,error:owner.last_error?.code||null});
  } finally {release();w.close();}
 }
 const w=await makeWorker(runtimePath,{fetch:async()=>Response.json({message:"Synthetic ordinary request error"},{status:400})});
 try {
  await w.settings();const storeId=await w.call("(async()=>{const s=await saCatalog.list();return s[0].id;})");
  const active=await startObserved(w,storeId),key=active.binding.conversation_key;
  const admitted=await w.request({type:"OZ_EXECUTE_COMMAND",conversation_key:key,command_text:command,manual_request_id:"ordinary-error",work_session_id:active.session.start_intent_id});
  assert.equal(admitted.accepted,true,JSON.stringify(admitted));
  const owner=await until(async()=>{const o=await w.call("getManualOperation",key);return o?.delivery?o:null;},"error report ready");
  assert.equal(owner.delivery.mode,"batch_watch_v1");assert(owner.outgoing_text.includes("400"));assert.equal(w.network.length,1);
  const recovery=await w.call("manualBatchRecoveryPayload",owner,"deliver_claimed");
  let text="",busy=true,sends=0,wake;const users=[];
  class Element {constructor(){this.isConnected=true;this.disabled=false;}click(){assert(!busy);sends++;users.push({id:"error-own-turn",text});text="";}}
  const composer=new Element(),button=new Element(),adapter={id:"chatgpt",userMessages:()=>users,messageId:n=>n.id,messageText:n=>n.text};
  const c={console,Date,Error,Set,HTMLElement:Element,current:()=>true,activeDeliveryWatch:null,
   sameConversation:(o,id)=>o===recovery.origin&&id===recovery.conversation_id,conversationKeyFromLocation:()=>key,
   currentAIAdapter:()=>adapter,userTurnIds:()=>users.map(n=>n.id),assistantTurnIds:()=>["own-assistant"],
   primaryComposerContext:()=>({composer,root:composer}),composerText:()=>text,setComposerText:(_,v)=>text=v,
   canonicalText:v=>String(v||"").replace(/\s+/g," ").trim(),
   classifyComposerControl:()=>busy?{kind:"stop",button:null}:text?{kind:"work_send_active",button}:{kind:"work_send_disabled",button:null},
   recordContentDiagnostic:()=>{},diagnosticForControlKind:x=>x,visible:n=>n.isConnected,controlDisabled:n=>n.disabled,
   runtimeId:"error-content",saContentContext:{work_active:true},manualEnabled:true,manualConversationKey:key,
   setManualBridgeReady:()=>{},toast:()=>{},clearToast:()=>{},MANUAL_COMPOSER_WAIT_TOAST_KEY:"wait",
   DELIVERY_WATCH_INTERVAL_MS:1,sleep:async()=>new Promise(setImmediate),startManualComposerClearWait:()=>{throw Error("unexpected draft");},
   saCheckDelivery:async()=>{await w.call("assertManualBatchContext",key,owner.operation_id);},
   sendRuntime:async(type,payload)=>w.request({type,...payload}),
   waitForDeliveryWatchWake:async()=>{await new Promise(resolve=>{wake=resolve;});},
   stopDeliveryWatch:()=>{if(c.activeDeliveryWatch)c.activeDeliveryWatch.cancelled=true;c.activeDeliveryWatch=null;}};
  vm.createContext(c);
  vm.runInContext(slice(source,"  async function runBatchDeliveryWatch(","  function stopManualComposerWait(")+slice(source,"  async function performBatchClaimedDelivery(","  function composerSendDeps("),c);
  await c.performBatchClaimedDelivery(recovery);
  await until(async()=>wake?true:null,"busy error report staged");
  assert.equal(sends,0);assert(text.includes("400"));record("ordinary_error_report_waits_while_early_active_surface_busy");
  busy=false;wake();await until(async()=>sends===1&&wake?true:null,"one error report Send");wake();
  await until(async()=>{const o=await w.call("getManualOperation",key);return o.delivery_confirmed?o:null;},"owned error report confirmed");
  assert.equal(w.network.length,1);assert.equal(sends,1);
  record("ordinary_error_full_text_delivered_once_to_original_context");
 } finally {w.close();}
}

try {
 if(process.argv[4]==="edges"){await edgeCycles();} else {
 worker=await makeWorker(runtimePath,{fetch:async(url)=>{assert(url.startsWith("https://api-seller.ozon.ru/"));trace.push({event:"fixture_provider_request",url});return Response.json(big);}});
 await worker.settings();
 const startId=crypto.randomUUID();
 const first=await worker.popup({type:"SA_WORK_START",tab_id:worker.tabId,store_id:await worker.call("(async()=>{const s=await saCatalog.list();return s[0].id;})"),start_intent_id:startId,confirm_change:true});
 assert.equal(first.ok,true,JSON.stringify(first));
 const pending=await until(async()=>{const p=(await worker.call("getPendingWorkStarts"))[worker.tabId];return p?.send_outcome==="sent_acknowledged"?p:null;},"single initial prompt ack");
 const activated=await worker.request({type:"OZ_WORK_PENDING_IDENTITY",intent_id:pending.intent_id,revision:pending.revision,identity:worker.identity,first_response_observed:true,first_response_complete:false});
 assert.equal(activated.ok,true,JSON.stringify(activated));
 const key=activated.binding.conversation_key, work=await worker.call("workSessionFor",key);
 assert.equal(work.state,"active_visible");
 assert.equal(worker.messages.filter(m=>m.type==="OZ_WORK_SEND_INITIAL_PROMPT").length,1);
 assert.equal(worker.network.length,0);
 record("early_observed_activation_one_instruction_zero_business_requests",{first_response_complete:false});
 const domState={busy:true,text:"",files:[],users:[],assistant:{id:"own-assistant",isConnected:true},attached:0,sends:0,accepts:[],sync:0};
 class Element {
  constructor(){this.isConnected=true;this.listeners=new Map();this.disabled=false;}
  addEventListener(t,f){const a=this.listeners.get(t)||[];a.push(f);this.listeners.set(t,a);}
  removeEventListener(t,f){this.listeners.set(t,(this.listeners.get(t)||[]).filter(x=>x!==f));}
  getAttribute(){return null;} closest(){return null;} contains(n){return n===this||n===composer||n===button;}
  click(){for(const f of [...(this.listeners.get("click")||[])])f({target:this,isTrusted:false,defaultPrevented:false});}
 }
 const root=new Element(),composer=new Element(),button=new Element(),block=new Element(),doc=new Element();
 const binding={adapter_id:"chatgpt",root:block,section:domState.assistant};
 const adapter={id:"chatgpt",assistantMessages:()=>[domState.assistant],messageId:n=>n.id,
  findCodeBlocks:n=>n===domState.assistant?[block]:[],readCodeText:()=>command,
  composerContext:()=>({root,composer}),readComposerText:()=>domState.text,setComposerText:(_,v)=>domState.text=v,
  deliveryCapabilities:()=>({attachment_strategy:"file_input_v1",max_files_per_turn:10}),
  attachmentSurface:()=>({kind:"file_input_v1",root}),attachFiles:(_,files)=>{domState.files=files;domState.attached++;},
  attachmentReady:()=>domState.files.length>0,
  sendButton:()=>domState.busy?null:button,sendButtonCandidates:()=>domState.busy?[]:[button],
  sendButtonFingerprint:()=>"synthetic-work-send",userMessages:()=>domState.users,messageText:n=>n.text,
  sentAttachmentMessage:(n,descriptors)=>n.files?.length===descriptors.length?{text:n.text}:null};
 button.addEventListener("click",()=>{assert.equal(domState.busy,false,"busy is not ready-to-Send");domState.sends++;domState.users.push({id:"sent-"+domState.sends,text:domState.text,files:domState.files});domState.text="";});
 const ctx={console,Date,Error,Object,Set,Map,WeakMap,WeakSet,JSON,Number,String,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,File,Blob,crypto:webcrypto,atob,btoa,
  HTMLElement:Element,HTMLButtonElement:Element,document:doc,
  manualEnabled:true,manualBridgeReady:true,manualConversationKey:key,BUSY_BLOCKS:new WeakSet(),OWN_BUTTONS:new Map(),
  saContentContext:{command_protocol:2,work_active:true,work_session_id:work.start_intent_id,binding_id:activated.binding.binding_id},
  conversationKeyFromLocation:()=>key,currentAIAdapter:()=>adapter,OzonAIAdapters:{ADAPTERS:{chatgpt:adapter},visible:n=>n.isConnected},
  commandText:()=>command,toast:()=>{},scheduleManualRescan:()=>{},renderOwnButton:()=>{},startQuotaWaitProbe:()=>{},
  setManualBridgeReady:(on)=>ctx.manualBridgeReady=on,syncManualState:async()=>{domState.sync++;},
  sendRuntime:async(type,payload)=>{const r=await worker.request({type,...payload});domState.accepts.push(r);return r;}};
 vm.createContext(ctx);vm.runInContext(commandSource,ctx);vm.runInContext(clickSource,ctx);
 assert.equal(worker.network.length,0);
 // The extension-owned explicit handler is the only command entry used here.
 await ctx.handleCopy(binding);
 assert.equal(domState.accepts.length,1);assert.equal(domState.accepts[0].accepted,true,JSON.stringify(domState.accepts[0]));
 await ctx.handleCopy(binding);
 assert.equal(domState.accepts.length,1,"busy explicit click is not a second command");
 const owner=await until(async()=>{const o=await worker.call("getManualOperation",key);return o?.delivery?o:null;},"full result ready");
 assert.equal(worker.network.length,1);assert(owner.r3_execution_id);assert.equal(owner.delivery.mode,"attachment_watch_v1");
 record("explicit_current_whole_block_one_execution_one_request_large_result",{execution_id:owner.r3_execution_id,mode:owner.delivery.mode});
 const before=worker.messages.filter(m=>m.type==="OZ_WORK_SEND_INITIAL_PROMPT").length;
 const hidden=await worker.popup({type:"OZ_WORK_HIDE",tab_id:worker.tabId,conversation_key:key});assert.equal(hidden.ok,true,JSON.stringify(hidden));
 const shown=await worker.popup({type:"OZ_WORK_SHOW",tab_id:worker.tabId,conversation_key:key});assert.equal(shown.ok,true,JSON.stringify(shown));
 assert.equal(worker.network.length,1);assert.equal(worker.messages.filter(m=>m.type==="OZ_WORK_SEND_INITIAL_PROMPT").length,before);
 record("hide_show_preserves_authorized_result_without_instruction_or_execution_replay");
 const recoveryResult=await worker.portRequest({type:"OZ_ATTACHMENT_RECOVERY_GET",conversation_key:key});assert.equal(recoveryResult.ok,true,JSON.stringify(recoveryResult));assert(recoveryResult.recovery);
 const recovery=recoveryResult.recovery;
 const attachmentMessages=[];
 Object.assign(ctx,{runtime:{id:"linked-content",in_flight:new Set()},current:()=>true,
  sameConversation:r=>r.conversation_key===key,adapter:()=>adapter,status:()=>{},
  normalizeText:v=>String(v||"").replace(/\s+/g," ").trim(),
  ARTIFACT_CHUNK_BYTES:65536,ATTACH_READY_TIMEOUT_MS:1000,ATTACH_RECONCILE_TIMEOUT_MS:1000,SEND_TARGET_TIMEOUT_MS:1000,SEND_RECONCILE_TIMEOUT_MS:1000,
  request:async(type,payload)=>{attachmentMessages.push(type);return worker.portRequest({type,...payload});},
  sleep:async()=>{await new Promise(setImmediate);}
 });
 for(const f of ["shared/web_file_attachment.js","shared/ai_delivery_capabilities.js","shared/composer_send.js"])vm.runInContext(await fs.readFile(path.join(runtimePath,f),"utf8"),ctx,{filename:f});
 vm.runInContext(attachSource,ctx);
 const task=ctx.processRecovery(recovery);
 await until(async()=>domState.attached===1&&domState.text?true:null,"attachment staged while assistant remains busy");
 assert.equal(domState.sends,0);assert(!attachmentMessages.includes("OZ_ATTACHMENT_SEND_COMMIT"));
 assert.equal(domState.attached,1);
 const file=domState.files[0], bytes=await file.text();
 assert(bytes.includes("BEGIN_B02")&&bytes.includes("END_B02"));assert(bytes.length>250000);assert.equal(bytes.split("full-result-line").length-1,90000,"all provider rows survive report generation and chunk transport");
 record("full_artifact_bytes_preserved_busy_does_not_commit_or_send",{filename:file.name,bytes:file.size});
 domState.busy=false;
 const delivered=await task;assert.equal(delivered.confirmed,true,JSON.stringify(delivered));assert.equal(domState.sends,1);assert.equal(domState.attached,1);
 const done=await worker.call("getManualOperation",key);assert.equal(done.delivery_confirmed,true);assert.equal(done.status,"completed");
 record("same_original_context_new_owned_file_turn_confirms_one_send");
 ctx.manualBridgeReady=true;await ctx.handleCopy(binding);
 assert.equal(worker.network.length,1);assert.equal((await worker.call("getManualOperation",key)).r3_execution_id,owner.r3_execution_id);assert.equal(domState.sends,1);
 record("explicit_click_on_completed_same_block_keeps_one_execution_and_request");
 const finished=await worker.popup({type:"OZ_WORK_FINISH",tab_id:worker.tabId,conversation_key:key});assert.equal(finished.ok,true,JSON.stringify(finished));
 const inactive=await worker.call("workSessionFor",key);assert.equal(inactive.state,"inactive");assert.equal(inactive.finished,true);
 const afterFinish=await worker.portRequest({type:"OZ_ATTACHMENT_RECOVERY_GET",conversation_key:key});assert(!afterFinish.recovery);
 assert.equal(worker.network.length,1);record("finish_keeps_result_and_closes_recovery");
 const next=await worker.popup({type:"SA_WORK_START",tab_id:worker.tabId,store_id:owner.execution_context.storeId,start_intent_id:crypto.randomUUID(),confirm_change:true});assert.equal(next.ok,true,JSON.stringify(next));
 const nextPending=await until(async()=>{const p=(await worker.call("getPendingWorkStarts"))[worker.tabId];return p?.send_outcome==="sent_acknowledged"?p:null;},"restart initial prompt ack");
 const nextActive=await worker.request({type:"OZ_WORK_PENDING_IDENTITY",intent_id:nextPending.intent_id,revision:nextPending.revision,identity:worker.identity,first_response_observed:true,first_response_complete:false});assert.equal(nextActive.ok,true,JSON.stringify(nextActive));
 assert.notEqual(nextActive.session.start_intent_id,work.start_intent_id);assert.equal(worker.network.length,1);
 assert.equal(worker.messages.filter(m=>m.type==="OZ_WORK_SEND_INITIAL_PROMPT").length,2);
 record("finish_restart_new_generation_one_new_instruction_no_old_execution");
}
} catch(error){rows.push({name:"linked_cycle",status:"FAIL",error:error.stack});process.exitCode=1;}
finally {worker?.close();await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,"result.json"),JSON.stringify({status:process.exitCode?"FAIL":"PASS",scope:"offline linked composed worker + actual explicit handler + attachment content controller; synthetic DOM and provider transport; not installed/authority/provider UI acceptance",cases:rows,trace},null,2)+"\n");console.log(JSON.stringify({status:process.exitCode?"FAIL":"PASS",cases:rows.length,last:rows.at(-1)}));}
