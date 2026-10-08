import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { makeWorker } from './worker-harness.mjs';
import { lateStartRouteCases } from './late-start-route-continuity.mjs';
const runtime=path.resolve(process.argv[2]);
const sandbox={URL, TextEncoder};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(runtime,'shared/conversation_identity.js'),'utf8'),sandbox);
const core=sandbox.SellerAgentsConversationIdentity;
const rows=[];
for (const [name, run] of lateStartRouteCases(fs.readFileSync(path.join(runtime,'shared/conversation_identity.js'),'utf8'))) { await test('late-route: '+name, run); }
async function test(name,fn){try{await fn();rows.push({name,status:'PASS'});}catch(error){rows.push({name,status:'FAIL',error:String(error.stack)});}}
const base={origin:'https://chatgpt.com',provider:'chatgpt',pathname:'/arbitrary/conversation?view=1',surfaceConfirmed:true,hasMessages:true,messageIds:['u-1','a-1'],root:{}};
function tracker(){let sequence=0;return core.createTracker({newToken:()=>String(++sequence)});}
await test('popup-keeps-active-work-through-temporary-external-id-loss',async()=>{
 const input={...base,provider:'alice',origin:'https://alice.yandex.ru',explicitIds:['Alice-Thread-A']};
 const t=tracker();const first=t.observe(input);
 const worker=await makeWorker(runtime,{aiFamily:'alice'});
 try{
  Object.assign(worker.identity,first);worker.setIdentity(first);
  await worker.settings();const key=await worker.start();
  const observations=[first,t.observe({...input,explicitIds:[],root:{}}),t.observe(input)];
  const results=[];
  for(const identity of observations){
   worker.setIdentity(identity);
   const popup=await worker.call('saPopupState',worker.tabId);
   results.push({key:popup.conversation_key,work:popup.work?.state,scope:identity.identity_scope});
  }
  assert.deepEqual(results,observations.map(()=>({key,work:'active_visible',scope:'conversation'})),JSON.stringify(results));
 }finally{worker.close();}
});
await test('external-id-loss-needs-history-proof-and-respects-context-fences',()=>{
 const input={...base,explicitIds:['Thread-A']};
 for(const interruption of [{messageIds:[]},{messageIds:['other']},{surfaceConfirmed:false},{conflict:'ambiguous'}]){
  const t=tracker();const first=t.observe(input);
  const suspended=t.observe({...input,explicitIds:[],...interruption});
  assert.notEqual(suspended.status,'confirmed');
  const resumed=t.observe({...input,explicitIds:[]});
  assert.equal(resumed.conversation_id,first.conversation_id);
 }
 for(const change of [{pathname:'/other'},{accountScope:'another'},{origin:'https://alice.yandex.ru',provider:'alice'}]){
  const t=tracker();const first=t.observe(input);
  assert.notEqual(t.observe({...input,...change,explicitIds:[]}).conversation_id,first.conversation_id);
 }
 const t=tracker();const first=t.observe(input);
 assert.notEqual(t.observe({...input,explicitIds:['Thread-B']}).conversation_id,first.conversation_id);
});
await test('url-shape-is-not-conversation-proof',()=>{
 for(const pathname of ['/','/c/11111111-1111-4111-8111-111111111111','/uc/22222222-2222-4222-8222-222222222222','/anything/nonuuid','#thread']){
  assert.equal(core.resolveEvidence({...base,pathname,surfaceConfirmed:false}).status,'unknown');
  const actual=tracker().observe({...base,pathname});
  assert.equal(actual.status,'confirmed');assert.equal(actual.identity_scope,'document');
 }
});
await test('provider-neutral-local-surface',()=>{
 for(const [provider,origin] of [['chatgpt','https://chatgpt.com'],['alice','https://alice.yandex.ru']]){
  assert.equal(tracker().observe({...base,provider,origin}).status,'confirmed');
 }
});
await test('typed-identifiers-remain-case-sensitive',()=>{
 const one=core.resolveEvidence({...base,explicitIds:['Thread-A']});
 const two=core.resolveEvidence({...base,explicitIds:['thread-a']});
 assert.equal(one.identity_scope,'conversation');assert.notEqual(one.conversation_id,two.conversation_id);
 assert.equal(core.resolveEvidence({...base,explicitIds:['Thread-A','thread-a']}).status,'conflict');
});
await test('navigation-isolates-local-dialogue-even-with-copied-history',()=>{
 const t=tracker();const a=t.observe(base);
 const b=t.observe({...base,pathname:'/different'});
 assert.notEqual(a.conversation_id,b.conversation_id);
});
await test('same-url-disjoint-history-suspends-and-explicit-start-rebinds',()=>{
 const t=tracker();const a=t.observe(base);
 const changed={...base,messageIds:['u-2','a-2']};
 assert.equal(t.observe(changed).status,'unknown');
 assert.equal(t.observe(base).conversation_id,a.conversation_id);
 assert.notEqual(t.confirmSurface(changed).conversation_id,a.conversation_id);
});
await test('virtualized-history-overlap-and-remount-preserve-binding',()=>{
 const t=tracker();const a=t.observe(base);
 const b=t.observe({...base,root:{},messageIds:['a-1','u-2','a-2']});
 assert.equal(a.conversation_id,b.conversation_id);
});
await test('message-ids-are-opaque',()=>{
 const t=tracker();t.observe({...base,messageIds:['A','B']});
 assert.equal(t.observe({...base,messageIds:['a','b']}).status,'unknown');
});
await test('blank-start-promotes-only-after-owned-message-witness',()=>{
 const t=tracker();const empty={...base,pathname:'/',messageIds:[],hasMessages:false};
 const before=t.observe(empty);t.beginStart('start-1');
 const uncertain=t.observe({...base,pathname:'/any/new'});
 assert.equal(uncertain.status,'unknown');assert.equal(uncertain.source,'pending_route_continuity');
 const after=t.observe({...base,pathname:'/any/new',startWitness:'start-1'});
 assert.equal(after.status,'confirmed');assert.equal(after.surface_id,before.surface_id);
});
await test('finish-removes-promotion-authority',()=>{
 const t=tracker();const a=t.observe({...base,pathname:'/',messageIds:[],hasMessages:false});
 t.beginStart('start-1');t.endStart('start-1');
 const b=t.observe({...base,pathname:'/other',startWitness:'start-1'});
 assert.notEqual(a.surface_id,b.surface_id);
});
await test('provider-origin-account-and-root-changes-are-fenced',()=>{
 const t=tracker();const a=t.observe(base);
 assert.notEqual(t.observe({...base,accountScope:'account-b'}).surface_id,a.surface_id);
 const empty={...base,messageIds:[],hasMessages:false};const u=tracker();
 assert.notEqual(u.observe(empty).surface_id,u.observe({...empty,root:{}}).surface_id);
});
await test('local-id-does-not-upgrade-mid-operation',()=>{
 const t=tracker();const a=t.observe(base);
 assert.equal(t.observe({...base,explicitIds:['provider-thread']}).conversation_id,a.conversation_id);
});
await test('explicit-id-change-splits-local-surface-even-with-shared-ancestry',()=>{
 const t=tracker();const a=t.observe(base);
 assert.equal(t.observe({...base,explicitIds:['thread-A']}).conversation_id,a.conversation_id);
 const b=t.observe({...base,explicitIds:['thread-B']});
 assert.notEqual(b.conversation_id,a.conversation_id);
 assert.notEqual(b.surface_id,a.surface_id);
});
await test('conflicting-surfaces-suspend',()=>{
 const t=tracker();t.observe(base);
 assert.equal(t.observe({...base,conflict:'multiple_conversation_surfaces'}).status,'conflict');
});
await test('reload-proof-needs-same-locator-and-two-case-exact-anchors',()=>{
 const proof={version:1,locator_digest:'a'.repeat(64),message_ids:['A','B']};
 assert(core.matchingProof(proof,{...proof,message_ids:['A','B','C']}));
 assert(!core.matchingProof(proof,{...proof,locator_digest:'b'.repeat(64)}));
 assert(!core.matchingProof(proof,{...proof,message_ids:['A']}));
 assert(!core.matchingProof(proof,{...proof,message_ids:['a','b']}));
 const t=tracker();const a=t.observe(base);
 assert(!t.adoptLocal('local:restored','stale-surface'));
 assert(t.adoptLocal('local:restored',a.surface_id));
 assert.equal(t.observe(base).conversation_id,'local:restored');
});
await test('real-worker-never-promotes-unknown-id',async()=>{
 const worker=await makeWorker(runtime);
 try{
  const input={origin:'https://chatgpt.com',ai_id:'chatgpt',conversation_id:'some-id',status:'unknown'};
  assert.equal((await worker.call('normalizeIdentity',input)).conversation_id,null);
  assert.equal(await worker.call('conversationKeyFromIdentity',input),null);
  assert.throws(()=>worker.call('normalizeIdentity',{...input,status:'conflict'}),/противоречат/);
 }finally{worker.close();}
});

await test('real-content-state-ignores-late-A-after-B-and-finish',async()=>{
 const source=fs.readFileSync(path.join(runtime,'content_script.js'),'utf8');
 const allStart=source.indexOf('  async function syncAllState() {');
 const allEnd=source.indexOf('\n  function restoreButtonPicker()',allStart);
 const manualStart=source.indexOf('  async function syncManualState() {');
 const manualEnd=source.indexOf('\n  const CHATGPT_ASSISTANT_EDITOR_DIRECT_SELECTOR',manualStart);
 assert(allStart>=0&&allEnd>allStart&&manualStart>=0&&manualEnd>manualStart);
 const requests=[],applied=[];
 let here={origin:'https://chatgpt.com',conversation_id:'A',status:'confirmed'};
 const ctx={
  queueMicrotask:()=>{},current:()=>true,currentAIAdapter:()=>({}),
  SellerAgentsConversationSurface:{ready:async()=>({...here})},
  sendRuntime:(type,payload)=>new Promise(resolve=>requests.push({type,payload,resolve})),
  sameConversation:(origin,id)=>origin===here.origin&&id===here.conversation_id,
  conversationKeyFromLocation:()=>here.conversation_id,
  saApplyContext:value=>applied.push(value.marker),saContentContext:null,
  applyManualMode:()=>{},stopAutoWatch:()=>{},setManualBridgeReady:()=>{},
  manualOperationLooksActive:()=>false,syncQuotaWaitFromState:()=>{}
 };
 vm.createContext(ctx);
 vm.runInContext('let stateSyncGeneration=0, fullSyncSequence=0, manualSyncSequence=0;\n'+source.slice(allStart,allEnd)+'\n'+source.slice(manualStart,manualEnd)+
 '\nglobalThis.syncAll=syncAllState;globalThis.syncManual=syncManualState;globalThis.finish=()=>{stateSyncGeneration+=1;};',ctx);
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const a=ctx.syncAll();await tick();
 here={...here,conversation_id:'B'};
 const b=ctx.syncAll();await tick();
 requests[1].resolve({ok:true,conversation_key:'B',store_context:{marker:'B'}});await b;
 requests[0].resolve({ok:true,conversation_key:'A',store_context:{marker:'A'}});
 assert.equal((await a).code,'CONTENT_SYNC_SUPERSEDED');
 assert.deepEqual(applied,['B']);
 const c=ctx.syncManual();await tick();ctx.finish();
 requests[2].resolve({ok:true,enabled:true,store_context:{marker:'stale-finish'}});
 assert.equal((await c).code,'CONTENT_SYNC_SUPERSEDED');
 assert.deepEqual(applied,['B']);
 const full=ctx.syncAll();await tick();
 const manual=ctx.syncManual();await tick();
 requests[4].resolve({ok:true,store_context:{marker:'manual-B'}});await manual;
 requests[3].resolve({ok:true,store_context:{marker:'full-B'}});
 assert.equal((await full).ok,true,'manual refresh must not discard complementary full-state recovery');
 assert.deepEqual(applied,['B','manual-B','full-B']);

});


await test('real-popup-refresh-and-finish-ignore-obsolete-actions',async()=>{
 const source=fs.readFileSync(path.join(runtime,'popup.js'),'utf8');
 const actionStart=source.indexOf('async function action(');
 const actionEnd=source.indexOf('\nfunction selected()',actionStart);
 const refreshStart=source.indexOf('async function refresh(');
 const refreshEnd=source.indexOf('\nfunction closeCard()',refreshStart);
 assert(actionStart>=0&&actionEnd>actionStart&&refreshStart>=0&&refreshEnd>refreshStart);
 const requests=[],status={textContent:''};
 let deferred=true;
 const ctx={clearTimeout,$:()=>status,render:()=>{},refreshFirefoxTechnicalConsent:async()=>{},
  actionSuccessText:result=>result.label,
  request:()=>deferred?new Promise(resolve=>requests.push(resolve)):Promise.resolve({context:{},stores:[],key:'B'})};
 vm.createContext(ctx);
 vm.runInContext('let busy=false, actionGeneration=0, refreshGeneration=0, state=null, refreshTimer=null, refreshRequested=false;\n'+
 source.slice(actionStart,actionEnd)+'\n'+source.slice(refreshStart,refreshEnd)+
 '\nglobalThis.api={action,refresh,read:()=>({busy,state})};',ctx);
 const a=ctx.api.refresh(),b=ctx.api.refresh();
 requests[1]({context:{},stores:[],key:'B'});await b;
 requests[0]({context:{},stores:[],key:'A'});await a;
 assert.equal(ctx.api.read().state.key,'B');
 deferred=false;
 let lateStart;
 const start=ctx.api.action(()=>new Promise((_,reject)=>{lateStart=reject;}));
 assert.equal(ctx.api.read().busy,true);
 let finished=false;
 await ctx.api.action(async()=>{finished=true;return {label:'finished'};},{interrupt:true});
 assert.equal(finished,true);assert.equal(ctx.api.read().busy,false);
 lateStart(new Error('late Start rejection'));await start;
 assert.equal(status.textContent,'finished');assert.equal(ctx.api.read().busy,false);
});



await test('real-popup-finish-refresh-cannot-silently-drop-next-start',async()=>{
 const source=fs.readFileSync(path.join(runtime,'popup.js'),'utf8');
 const actionStart=source.indexOf('async function action(');
 const actionEnd=source.indexOf('\nfunction selected()',actionStart);
 assert(actionStart>=0&&actionEnd>actionStart);
 const status={textContent:''};
 let refreshRelease,startVisible=false;
 const ctx={
  $:()=>status,
  render:()=>{},
  actionSuccessText:result=>result?.label||'ok',
  refresh:async()=>{startVisible=true;await new Promise(resolve=>{refreshRelease=resolve;});}
 };
 vm.createContext(ctx);
 vm.runInContext('let busy=false, actionGeneration=0, refreshGeneration=0, state={}, refreshRequested=false;\n'+
  source.slice(actionStart,actionEnd)+
  '\nglobalThis.api={action,read:()=>({busy})};',ctx);
 const finish=ctx.api.action(async()=>({label:'finished'}),{interrupt:true});
 for(let i=0;i<20&&!startVisible;i++) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(startVisible,true);
 assert.equal(ctx.api.read().busy,true);
 let startRan=false;
 const rejected=await ctx.api.action(async()=>{startRan=true;return {label:'started'};});
 assert.equal(startRan,false,'a non-interrupt Start must not execute while Finish action is still busy');
 assert.equal(rejected?.popupAction,'BUSY_REJECTED');
 assert.equal(status.textContent,'Дождитесь завершения текущего действия.');
 refreshRelease();
 await finish;
 assert.equal(ctx.api.read().busy,false);
});

await test('attachment-worker-uses-confirmed-shared-identity-without-route-shape',async()=>{
 const source=fs.readFileSync(path.join(runtime,'shared/file_delivery_port_worker.js'),'utf8');
 const begin=source.indexOf('  function normalizedLiveOwner(');
 const end=source.indexOf('\n  function assertSenderOwner(',begin);
 assert(begin>=0&&end>begin);
 const worker=await makeWorker(runtime);
 try{
  const ctx={normalizeIdentity:value=>worker.call('normalizeIdentity',value)};
  vm.createContext(ctx);vm.runInContext(source.slice(begin,end)+'\nglobalThis.read=normalizedLiveOwner;',ctx);
  const input={origin:'https://chatgpt.com',ai_id:'chatgpt',status:'confirmed',conversation_id:'local:binding-a'};
  assert.equal(ctx.read(input).conversation_id,'local:binding-a');
  assert.equal(ctx.read({...input,status:'unknown'}),null);
  assert.equal(ctx.read({...input,conversation_id:'invalid|owner'}),null);
  assert.equal(ctx.read({...input,origin:'https://unrelated.invalid'}),null);
 }finally{worker.close();}
});

console.log(JSON.stringify({level:'PACKAGE_OFFLINE',status:rows.every(r=>r.status==='PASS')?'PASS':'FAIL',cases:rows},null,2));
if(rows.some(r=>r.status==='FAIL')) process.exitCode=1;
