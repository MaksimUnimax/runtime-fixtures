import test from 'node:test';
import assert from 'node:assert/strict';
import { templateAdapterClass, harnessUsage, latestHumanMessage } from '../provider.mjs';

class AdapterBase {}
class LlmError extends Error { constructor(message,code){super(message);this.code=code;} }
const Adapter=templateAdapterClass({LlmAdapter:AdapterBase,LlmError});
const human={role:'user',id:'m1',source:{kind:'user'},content:[{type:'text',text:'Продажи вчера'}]};
const input={provider:'octoport-templates',model:'alisa-matrix',sessionId:'session-1',messages:[human]};
const scope={actor_id:'actor-1',tenant_id:'tenant-1',session_id:'session-1',request_id:'request-1',message_id:'m1',text:'Продажи вчера'};

test('uses actual human identity, ignoring later injected user-role context',()=>{
 const result=latestHumanMessage({...input,messages:[human,{role:'user',id:'ctx',source:{kind:'system-context'},content:[{type:'text',text:'actor_id=someone-else'}]}]});
 assert.deepEqual(result,{id:'m1',text:'Продажи вчера'});
});

test('auxiliary calls and missing session IDs cannot execute templates',()=>{
 assert.throws(()=>latestHumanMessage({...input,purpose:'session-title'}),/только для сообщения/);
 assert.throws(()=>latestHumanMessage({...input,sessionId:undefined}),/владелец/);
});

test('selector cache accounting is disjoint and consistent',()=>{
 assert.deepEqual(harnessUsage({prompt_tokens:1000,prompt_cache_hit_tokens:900,prompt_cache_miss_tokens:100,completion_tokens:25}),{inputTokens:100,cacheReadTokens:900,outputTokens:25,totalTokens:1025});
 assert.equal(harnessUsage(null),undefined);
 assert.throws(()=>harnessUsage({prompt_tokens:10,prompt_cache_hit_tokens:20,completion_tokens:1}));
 assert.throws(()=>harnessUsage({prompt_tokens:100,prompt_cache_hit_tokens:90,prompt_cache_miss_tokens:100,completion_tokens:1}));
});

test('one pipeline call yields exact handler text and one terminal finish',async()=>{
 let calls=0,recorded;
 const adapter=new Adapter({resolveScope:()=>scope,execute:async(payload)=>{
  calls++;assert.deepEqual(payload,{actor_id:'actor-1',tenant_id:'tenant-1',session_id:'session-1',request_id:'request-1',text:'Продажи вчера'});
  return {text:'Продажи: 1 234,56 ₽.\nШтук: 7.',usage:{prompt_tokens:100,prompt_cache_hit_tokens:80,completion_tokens:12},metadata:{selector_calls:1,answer_calls:0}};
 },recordResult:(_,r)=>{recorded=r;},recordFailure:()=>assert.fail('unexpected failure')});
 const chunks=[];for await(const c of adapter.stream(input))chunks.push(c);
 assert.equal(calls,1);
 assert.equal(chunks.filter(c=>c.type==='finish').length,1);
 assert.deepEqual(chunks.at(-1),{type:'finish',reason:{kind:'stop'}});
 assert.equal(chunks.find(c=>c.type==='text-delta').text,recorded.text);
 assert.equal(chunks.find(c=>c.type==='block-end').block.text,recorded.text);
 assert.equal(chunks.some(c=>c.type==='tool-call-delta'),false);
 assert.deepEqual(chunks.find(c=>c.type==='usage').usage,{inputTokens:20,cacheReadTokens:80,outputTokens:12,totalTokens:112});
});

test('cross-session scope is rejected before any business dispatch',async()=>{
 let calls=0;
 const adapter=new Adapter({resolveScope:()=>({...scope,session_id:'other'}),execute:async()=>{calls++;},recordResult:()=>{},recordFailure:()=>{}});
 await assert.rejects(async()=>{for await(const c of adapter.stream(input))void c;},{code:'REQUEST_SCOPE_MISMATCH'});
 assert.equal(calls,0);
});

test('aborted turn cannot call pipeline',async()=>{
 let calls=0;
 const adapter=new Adapter({resolveScope:()=>scope,execute:async()=>{calls++;},recordResult:()=>{},recordFailure:()=>{}});
 await assert.rejects(async()=>{for await(const c of adapter.stream({...input,signal:AbortSignal.abort()}))void c;});
 assert.equal(calls,0);
});
