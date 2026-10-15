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
function fixture(){
 let composers=[],reply={ok:true,text:"OZON_HELP_V2 "+JSON.stringify({topic:"account_access"})},onRead=null,requests=[];
 const location={origin:"https://chat.qwen.ai"},document={querySelectorAll:s=>s==="textarea.message-input-textarea"?composers:[]};
 const box={Element,HTMLElement:Element,location,document,chrome:{runtime:{sendMessage:async r=>{requests.push(r);onRead?.();return reply;}}}};
 runInNewContext(readFileSync(root+"apps/extension/src/content/qwen-adapter.js","utf8"),box);
 const adapter=box.SellerAgentsQwenAdapter.create({visible:e=>e.visible,readComposerText:e=>e.value||"",setComposerText:(e,v)=>{e.value=v;}});
 const composer=new Element(),container=new Element(),send=new Element({"aria-label":"Send","type":"submit"}),stop=new Element({"aria-label":"Stop"});
 composer.parents.set(".message-input-container",container);container.queries.set('button[aria-label="Send"]',[send]);composers=[composer];
 const section=new Element();section.selectors.add(M);section.selectors.add(A);
 const body=new Element({"data-msg-id":"public-assistant-1"});body.parents.set(M,section);section.queries.set("[data-msg-id]",[body]);
 const block=new Element();block.textContent="TRUNCATED_VISIBLE_LINES";block.parents.set(M,section);block.parents.set(A,section);section.queries.set(CODE,[block]);
 return {adapter,location,composer,container,send,stop,section,body,block,requests,
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
 f.container.queries.set('button[aria-label="Stop"]',[f.stop]);assert.equal(f.adapter.isGenerating(),true);assert.equal(f.adapter.sendButton(ctx),null);
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
await test("unverified attachments remain closed and cannot be reported ready",()=>{
 const f=fixture();assert.equal(f.adapter.attachmentReady(),false);assert.equal(f.adapter.attachmentSurface(),null);
 assert.throws(()=>f.adapter.attachFiles(),/TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE/);
});
console.log(JSON.stringify({level:"SOURCE",passed,installed:"NOT_RUN",providerCalls:0,sendCalls:0}));
