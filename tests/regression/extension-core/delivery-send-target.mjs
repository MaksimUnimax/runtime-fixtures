import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const runtime=path.resolve(process.argv[2]);
const source=fs.readFileSync(path.join(runtime,"content_script.js"),"utf8");
const start=source.indexOf("  async function runBatchDeliveryWatch("),end=source.indexOf("\n  function stopManualComposerWait",start);
assert(start>=0&&end>start);
const helper=fs.readFileSync(path.join(runtime,"shared/composer_send.js"),"utf8");
const scenarios=[
{name:"replace_during_context_check",at:"check",change:"replace",clicks:1,newClicks:1},
{name:"replace_during_commit",at:"commit",change:"replace",clicks:1,newClicks:1},
{name:"disabled_during_commit",at:"commit",change:"disabled",clicks:0},
{name:"detached_during_commit",at:"commit",change:"detached",clicks:0},
{name:"draft_changed_during_commit",at:"commit",change:"draft",clicks:0},
{name:"dialogue_changed_during_commit",at:"commit",change:"dialogue",clicks:0},
{name:"runtime_replaced_during_commit",at:"commit",change:"runtime",clicks:0},
{name:"cancelled_during_commit",at:"commit",change:"cancel",clicks:0},
{name:"commit_denied",deny:true,clicks:0},
{name:"observed_click_never_retried",clicks:1,newClicks:0}
];
const results=[];
for(const s of scenarios){
 try{
 let running=true,dialogue=true,wakes=0,commits=0,clicks=0,newClicks=0,text="SYNTHETIC REPORT",changed=false;
 class Element{
 constructor(name){this.name=name;this.isConnected=true;this.disabled=false;}
 getAttribute(name){return name==="aria-disabled"?"false":null;}
 closest(){return null;}
 contains(node){return this===root&&(node===composer||node===button);}
 click(){clicks++;if(this.name==="replacement")newClicks++;}
 }
 const composer=new Element("composer"),root=new Element("root");
 let button=new Element("original");
 const context=()=>({composer,root});
 const mutate=at=>{
 if(s.at!==at||changed)return;changed=true;
 if(s.change==="replace"){button.isConnected=false;button=new Element("replacement");}
 if(s.change==="disabled")button.disabled=true;
 if(s.change==="detached")button.isConnected=false;
 if(s.change==="draft")text="USER DRAFT DO NOT SEND";
 if(s.change==="dialogue")dialogue=false;
 if(s.change==="runtime")running=false;
 if(s.change==="cancel")c.activeDeliveryWatch.cancelled=true;
 };
 const c={Set,HTMLElement:Element,HTMLButtonElement:Element,activeDeliveryWatch:null,manualEnabled:true,manualConversationKey:"chat",
 runtimeId:"fixture-content",saContentContext:{},DELIVERY_WATCH_INTERVAL_MS:1,
 current:()=>running,sameConversation:()=>dialogue,conversationKeyFromLocation:()=>"chat",
 currentAIAdapter:()=>({id:"chatgpt",userMessages:()=>[]}),userTurnIds:()=>[],
 canonicalText:x=>String(x??"").trim(),primaryComposerContext:context,composerText:()=>text,
 classifyComposerControl:()=>({kind:"work_send_active",context:context(),button}),
 visible:n=>n.isConnected,controlDisabled:n=>n.disabled,
 composerSendDeps:()=>({visible:n=>n.isConnected,readComposerText:()=>text}),
 saCheckDelivery:async()=>mutate("check"),
 sendRuntime:async(type)=>{if(type==="OZ_WORK_SEND_COMMIT"){commits++;mutate("commit");return{ok:true,click_allowed:!s.deny,send_click_committed:true,chatgpt_user_baseline:[]};}throw Error("No delivery witness should be manufactured");},
 recordContentDiagnostic:()=>{},diagnosticForControlKind:x=>x,toast:()=>{},setManualBridgeReady:()=>{},
 waitForDeliveryWatchWake:async()=>{if(++wakes>3)running=false;},sleep:async()=>{running=false;},
 stopDeliveryWatch:()=>{c.activeDeliveryWatch=null;running=false;}
 };
 vm.createContext(c);vm.runInContext(helper,c);
 vm.runInContext(source.slice(start,end)+"\nglobalThis.watch=runBatchDeliveryWatch;",c);
 await c.watch({delivery_mode:"batch_watch_v1",owner_kind:"manual",owner_id:"fixture",delivery_id:"fixture-delivery",conversation_key:"chat",origin:"https://chatgpt.com",conversation_id:"fixture",outgoing_text:"SYNTHETIC REPORT"});
 assert.equal(clicks,s.clicks,"physical clicks");if(s.newClicks!==undefined)assert.equal(newClicks,s.newClicks,"fresh target clicks");
 assert.equal(commits,1,"one durable commit");assert.ok(clicks<=1,"no send replay");
 results.push({name:s.name,status:"PASS"});
 }catch(error){results.push({name:s.name,status:"FAIL",reason:error.message});}
}

for (const s of [
 {name:"standard_nested_control_scope",native:true,ok:true},
 {name:"standard_scope_without_native_form",native:false,ok:true},
 {name:"standard_button_outside_scope",native:true,outside:true,ok:false},
 {name:"standard_button_other_native_form",native:true,other:true,ok:false},
 {name:"standard_native_form_detached",native:true,detached:true,ok:false},
 {name:"legacy_native_form_preserved",legacy:true,ok:true},
 {name:"legacy_wrong_form_rejected",legacy:true,other:true,ok:false}
]) {
 try {
 class Element {constructor(name){this.name=name;this.isConnected=true;this.disabled=false;}
 getAttribute(){return null;} closest(){return this===button&&s.other?otherForm:nativeForm;}
 contains(n){return n===composer||n===button&&!s.outside;}}
 const nativeForm=new Element("native"),otherForm=new Element("other"),scope=new Element("scope");
 const composer=new Element("composer"),button=new Element("button");
 if(s.detached)nativeForm.isConnected=false;
 const context=s.legacy?{composer,form:nativeForm,root:nativeForm}:{composer,form:scope,root:scope,nativeForm:s.native?nativeForm:null};
 const c={HTMLElement:Element,HTMLButtonElement:Element};vm.createContext(c);vm.runInContext(helper,c);
 const result=c.BB2ComposerSend.validateTarget({context,button},"OWN REPORT",{visible:()=>true,readComposerText:()=>"OWN REPORT"});
 assert.equal(result.ok,s.ok,JSON.stringify(result));
 results.push({name:s.name,status:"PASS"});
 }catch(error){results.push({name:s.name,status:"FAIL",reason:error.message});}
}

console.log(JSON.stringify({scope:"offline composed delivery watcher and actual target validator; no provider requests",results},null,2));
if(results.some(r=>r.status==="FAIL"))process.exitCode=1;
