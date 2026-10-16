import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
class Element {
 constructor(attrs={}) {this.attrs=attrs;this.isConnected=true;this.visible=true;this.queries=new Map();this.parents=new Map();this.selectors=new Set();}
 getAttribute(name){return this.attrs[name]??null;}
 matches(selector){return this.selectors.has(selector);}
 closest(selector){return this.selectors.has(selector)?this:this.parents.get(selector)||null;}
 querySelectorAll(selector){return this.queries.get(selector)||[];}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
const M=".qwen-chat-message", A=M+".qwen-chat-message-assistant", U=M+".qwen-chat-message-user", CODE="pre.qwen-markdown-code";
const SEND='.chat-prompt-send-button > button.send-button, button[aria-label="Send"]';
const STOP='.chat-prompt-send-button > button.stop-button, button[aria-label="Stop"]';
function fixture(){
 let composers=[],reply={ok:true,text:"OZON_HELP_V2 "+JSON.stringify({topic:"account_access"})},onRead=null,requests=[];
 const location={origin:"https://chat.qwen.ai"},document={querySelectorAll:s=>s==="textarea.message-input-textarea"?composers:[]};
 const attachments=[];
 const box={Element,HTMLElement:Element,HTMLInputElement:Element,location,document,OzonWebFileAttachment:{setInputFiles:(input,files)=>{attachments.push({input,files});return files;}},chrome:{runtime:{sendMessage:async r=>{requests.push(r);onRead?.();return reply;}}}};
 runInNewContext(readFileSync(root+"apps/extension/src/content/qwen-adapter.js","utf8"),box);
 const adapter=box.SellerAgentsQwenAdapter.create({visible:e=>e.visible,readComposerText:e=>e.value||"",setComposerText:(e,v)=>{e.value=v;}});
 const composer=new Element(),container=new Element(),send=new Element({"aria-label":"Send","type":"submit"}),stop=new Element({"aria-label":"Stop"});
 composer.parents.set(".message-input-container",container);container.queries.set(SEND,[send]);composers=[composer];
 const section=new Element();section.selectors.add(M);section.selectors.add(A);
 const body=new Element({"data-msg-id":"public-assistant-1"});body.parents.set(M,section);section.queries.set("[data-msg-id]",[body]);
 const block=new Element();block.textContent="TRUNCATED_VISIBLE_LINES";block.parents.set(M,section);block.parents.set(A,section);section.queries.set(CODE,[block]);
 return {adapter,location,composer,container,send,stop,section,body,block,requests,attachments,
  setComposers:v=>{composers=v;},setReply:v=>{reply=v;},onRead:f=>{onRead=f;}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log("PASS "+name);}
await test("exact origin and a single visible observed composer",()=>{
 const f=fixture();assert.equal(f.adapter.matchesLocation(),true);f.location.origin="https://chat.qwen.ai.evil.invalid";assert.equal(f.adapter.matchesLocation(),false);
 assert.equal(f.adapter.composerContext().composer,f.composer);f.setComposers([f.composer,new Element()]);assert.equal(f.adapter.composerContext(),null);
 f.setComposers([f.composer]);f.composer.visible=false;assert.equal(f.adapter.composerContext(),null);
});
await test("disabled Send is ready only for an empty composer; Stop is never a send",()=>{
 const f=fixture(),ctx=f.adapter.composerContext();f.send.disabled=true;
 assert.equal(f.adapter.classifyComposerControl(ctx).kind,"ready");assert.equal(f.adapter.sendButton(ctx),null);
 f.composer.value="UNSENT";assert.equal(f.adapter.classifyComposerControl(ctx).kind,"send_disabled");
 f.send.disabled=false;assert.equal(f.adapter.sendButton(ctx),f.send);
 f.send.attrs["aria-label"]="Отправить";f.stop.attrs["aria-label"]="Остановить";
 assert.equal(f.adapter.sendButton(ctx),f.send,"observed structural Send survives localized labels");
 f.container.queries.set(STOP,[f.stop]);assert.equal(f.adapter.isGenerating(),true);assert.equal(f.adapter.sendButton(ctx),null);
 f.container.queries.set(STOP,[f.stop,new Element()]);assert.equal(f.adapter.classifyComposerControl(ctx).kind,"unknown");assert.equal(f.adapter.sendButton(ctx),null);
 f.container.queries.set(STOP,[]);f.container.queries.set(SEND,[f.send,new Element()]);
 assert.equal(f.adapter.sendButton(ctx),null,"ambiguous Send controls must not be clicked");
});
await test("duplicate and nested foreign message IDs cannot identify this block",()=>{
 const f=fixture();assert.equal(f.adapter.messageId(f.section),"public-assistant-1");
 const second=new Element({"data-msg-id":"other"});second.parents.set(M,new Element());f.section.queries.set("[data-msg-id]",[f.body,second]);
 assert.equal(f.adapter.messageId(f.section),"public-assistant-1");second.parents.set(M,f.section);assert.equal(f.adapter.messageId(f.section),"");
});
await test("explicit read returns only complete bytes and never visible Monaco text",async()=>{
 const f=fixture();assert.equal(f.adapter.readCodeText(f.block),"");assert.match(await f.adapter.readCodeTextAsync(f.block),/^OZON_HELP_V2 /);
 assert.deepEqual(JSON.parse(JSON.stringify(f.requests)),[{type:"OZ_QWEN_READ_CODE",messageId:"public-assistant-1",blockOrdinal:0}]);
 f.setReply({ok:false});await assert.rejects(f.adapter.readCodeTextAsync(f.block),/QWEN_COMPLETE_CODE_UNAVAILABLE/);
});
await test("replacement during asynchronous code read cancels the old block",async()=>{
 const f=fixture();f.onRead(()=>{f.section.queries.set(CODE,[new Element()]);});
 await assert.rejects(f.adapter.readCodeTextAsync(f.block),/QWEN_CODE_CONTEXT_CHANGED/);
});
await test("attachment input must belong to the unchanged empty composer",()=>{
 const f=fixture(),input=new Element();input.files=[];f.container.queries.set('input[type="file"]',[input]);
 const surface=f.adapter.attachmentSurface();assert.equal(surface.input,input);
 const file={name:"report.txt"};f.adapter.attachFiles(surface,[file]);assert.equal(f.attachments.length,1);
 f.composer.value="user draft entered while file bytes were loading";
 assert.equal(f.adapter.attachmentSurface(),null);
 assert.throws(()=>f.adapter.attachFiles(surface,[file]),/TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE/);
 assert.equal(f.composer.value,"user draft entered while file bytes were loading");
 assert.equal(f.attachments.length,1,"draft entered after preflight must prevent file assignment");
 f.composer.value="";
 assert.throws(()=>f.adapter.attachFiles(surface,[{name:"report.pdf"}]),/TARGET_AI_FILE_TYPE_UNSUPPORTED/);
 assert.throws(()=>f.adapter.attachFiles(surface,[file,file]),/TARGET_AI_FILE_TYPE_UNSUPPORTED/);
 f.container.queries.set('input[type="file"]',[new Element()]);
 assert.throws(()=>f.adapter.attachFiles(surface,[file]),/TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE/);
 f.container.queries.set('input[type="file"]',[input,new Element()]);assert.equal(f.adapter.attachmentSurface(),null);
 f.container.queries.set('input[type="file"]',[input]);input.disabled=true;assert.equal(f.adapter.attachmentSurface(),null);
 input.disabled=false;input.files=[file];assert.equal(f.adapter.attachmentSurface(),null);
 input.files=[];input.isConnected=false;assert.equal(f.adapter.attachmentSurface(),null);
 input.isConnected=true;f.container.queries.set(".file-card-list .fileitem-btn",[new Element()]);
 assert.equal(f.adapter.attachmentSurface(),null,"never replace an existing user attachment");
 assert.equal(f.attachments.length,1,"no rejected call mutates the input");
});
await test("a filename or upload spinner is insufficient; exact finished TXT card is required",()=>{
 const f=fixture(),card=new Element(),name=new Element(),icon=new Element({"xlink:href":"#qwenFileicon-txt1"});
 const descriptors=[{filename:"report.txt"}];name.textContent="report.txt";card.queries.set(".fileitem-file-name",[name]);
 f.container.queries.set(".file-card-list .fileitem-btn",[card]);
 assert.equal(f.adapter.attachmentReady(descriptors),false,"new card with spinner is not ready");
 card.queries.set(".fileitem-icon-wrapper .fileitem-icon use",[icon]);assert.equal(f.adapter.attachmentReady(descriptors),true);
 icon.attrs["xlink:href"]="#unknown";assert.equal(f.adapter.attachmentReady(descriptors),false);
 icon.attrs["xlink:href"]="#qwenFileicon-txt1";card.queries.set('[aria-busy="true"]',[new Element()]);
 assert.equal(f.adapter.attachmentReady(descriptors),false);
 card.queries.set('[aria-busy="true"]',[]);name.textContent="other.txt";assert.equal(f.adapter.attachmentReady(descriptors),false);
 name.textContent="report.txt";f.container.queries.set(".file-card-list .fileitem-btn",[card,new Element()]);
 assert.equal(f.adapter.attachmentReady(descriptors),false,"extra attachments make ownership ambiguous");
 f.container.queries.set(".file-card-list .fileitem-btn",[card]);card.visible=false;assert.equal(f.adapter.attachmentReady(descriptors),false);
 card.visible=true;card.isConnected=false;assert.equal(f.adapter.attachmentReady(descriptors),false);
 card.isConnected=true;assert.equal(f.adapter.attachmentReady([...descriptors,...descriptors]),false);
 assert.equal(f.adapter.attachmentReady([{filename:"report.pdf"}]),false);assert.equal(f.adapter.attachmentReady(),false);
 f.setComposers([f.composer,new Element()]);assert.equal(f.adapter.attachmentReady(descriptors),false);
});
await test("composed Qwen profile routes complete reports at the UTF16 cutoff",()=>{
 const source=readFileSync(root+"apps/extension/src/imported/ozon-v0.1.22/shared/ai_delivery_capabilities.js","utf8");
 const patches=JSON.parse(readFileSync(root+"apps/extension/application-patches.json","utf8")).filter(p=>p.target==="shared/ai_delivery_capabilities.js");
 let composed=source;
 for(const p of patches){assert.equal(composed.split(p.old).length,2);composed=composed.replace(p.old,p.new);}
 const box={URL,TextEncoder};runInNewContext(composed,box);
 const capabilities=box.OzonAIDeliveryCapabilities;
 assert.equal(capabilities.adapterIdForOrigin("https://chat.qwen.ai"),"qwen");
 assert.equal(capabilities.generatedTextDecision("qwen","a".repeat(4096)).representation,"plain_text");
 assert.equal(capabilities.generatedTextDecision("qwen","a".repeat(4097)).representation,"text_document");
 assert.equal(capabilities.generatedTextDecision("qwen","😀".repeat(2049)).representation,"text_document");
 assert.equal(capabilities.fileDispatchDecision("qwen",{filename:"full-report.txt",byte_length:16384}).dispatch_allowed,true);
 assert.equal(capabilities.fileDispatchDecision("qwen",{filename:"other.pdf",byte_length:16384}).dispatch_allowed,false);
 assert.equal(capabilities.profile("qwen").max_files_per_turn,1);
});
console.log(JSON.stringify({level:"SOURCE",passed,installed:"NOT_RUN",providerCalls:0,sendCalls:0}));
