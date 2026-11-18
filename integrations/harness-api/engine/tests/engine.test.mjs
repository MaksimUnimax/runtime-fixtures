import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HarnessEngine } from '../engine.mjs';
import { harnessRequire } from '../runtime.mjs';

let available=true;
try{harnessRequire().resolve('@deepseek-ai/dsh/package.json');}catch{available=false;}
const tenant={actor_id:'actor-a',tenant_id:'tenant-a'};
const usage={prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:10};
async function done(engine,id){
 for(let i=0;i<1000;i++){
  const result=await engine.status({...tenant,job_id:id});
  if(result.finished)return result;
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.fail('job never completed');
}

test('real pinned Harness: sessions, exact response, no duplicate dispatch, isolation and restart', {skip:!available},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-harness-test-'));
 const running=[];
 t.after(async()=>{for(const e of running)await e.close().catch(()=>{});fs.rmSync(dir,{recursive:true,force:true});});
 let calls=0;
 const execute=async payload=>{calls++;return {text:`Обработчик: ${payload.text}`,usage,metadata:{selector_calls:1,answer_calls:0,template_ids:['sales']}};};
 let engine=await new HarnessEngine({stateDirectory:dir,execute}).start();running.push(engine);
 assert.equal(engine.health().harness_version,'0.2.2-rc.1');
 const chat=await engine.create(tenant);
 assert.equal(chat.chat_id,chat.session_id);
 const request={...tenant,chat_id:chat.chat_id,request_id:'req-one',text:'Продажи вчера'};
 const first=engine.send(request),again=engine.send(request);
 assert.equal(first.job_id,again.job_id);assert.equal(again.duplicate,true);
 assert.throws(()=>engine.send({...request,text:'Другой вопрос'}),{code:'REQUEST_CONFLICT'});
 const result=await done(engine,'req-one');
 assert.equal(result.error,null);assert.equal(result.text,'Обработчик: Продажи вчера');assert.equal(calls,1);
 assert.deepEqual(result.messages.map(m=>m.role),['user','assistant']);
 assert.equal(result.messages[1].text,result.text);
 assert.deepEqual(result.usage,usage);
 assert.equal(result.metadata.answer_calls,0);
 await assert.rejects(engine.history({...tenant,tenant_id:'other-tenant',chat_id:chat.chat_id}),{code:'CHAT_NOT_FOUND'});
 await assert.rejects(engine.history({...tenant,actor_id:'other-actor',chat_id:chat.chat_id}),{code:'CHAT_NOT_FOUND'});
 assert.equal(engine.list({...tenant,actor_id:'other-actor'}).chats.length,0);
 await engine.close();running.pop();
 engine=await new HarnessEngine({stateDirectory:dir,execute}).start();running.push(engine);
 const history=await engine.history({...tenant,chat_id:chat.chat_id});
 assert.equal(history.messages.length,2);assert.equal(calls,1);
 assert.equal(engine.send(request).duplicate,true);assert.equal(calls,1);
 const second={...request,request_id:'req-two'};
 engine.send(second);
 const secondResult=await done(engine,'req-two');
 assert.equal(secondResult.error,null);assert.equal(calls,2);assert.equal(secondResult.messages.length,4);
});

test('real Harness: cancel prevents late handler answer and retry from status polling', {skip:!available},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-harness-cancel-'));
 let calls=0,started;
 const didStart=new Promise(resolve=>{started=resolve;});
 const execute=async(_payload,signal)=>{calls++;started();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});return {text:'late answer'};};
 const engine=await new HarnessEngine({stateDirectory:dir,execute}).start();
 t.after(async()=>{await engine.close();fs.rmSync(dir,{recursive:true,force:true});});
 const chat=await engine.create(tenant);
 engine.send({...tenant,chat_id:chat.chat_id,request_id:'req-cancel',text:'Долгий вопрос'});
 await didStart;
 await engine.cancel({...tenant,chat_id:chat.chat_id});
 const result=await done(engine,'req-cancel');
 assert.equal(result.finished,true);assert.equal(result.state,'cancelled');assert.equal(result.error.code,'CANCELED');assert.equal(result.text,null);assert.equal(calls,1);
 await done(engine,'req-cancel');assert.equal(calls,1);
});

test('official API provider is configured server side without inference or discovery calls', {skip:!available},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-harness-key-'));
 let networkCalls=0;
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{networkCalls++;throw new Error('Network is forbidden in this test');};
 let engine;
 t.after(async()=>{if(engine)await engine.close();globalThis.fetch=originalFetch;fs.rmSync(dir,{recursive:true,force:true});});
 engine=await new HarnessEngine({stateDirectory:dir,execute:async()=>({text:'OK'}),deepseekKey:'sk-test-only-credential-never-used-for-inference'}).start();
 assert.equal(engine.health().default_api_key_configured,true);
 assert.ok(engine.runtime.ctx.llm.listProviders().some(provider=>provider.id==='deepseek-official'));
 assert.equal(networkCalls,0);
 assert.equal(JSON.stringify(engine.health()).includes('sk-test'),false);
 const chat=await engine.create(tenant);
 engine.send({...tenant,chat_id:chat.chat_id,request_id:'req-key',text:'Вопрос'});
 const result=await done(engine,'req-key');
 assert.equal(result.text,'OK');assert.equal(networkCalls,0);
});

test('old completed request keeps its own native assistant after later turns and restart', {skip:!available},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-harness-receipt-'));
 let engine;
 const execute=async payload=>({text:`Ответ: ${payload.text}`});
 t.after(async()=>{if(engine)await engine.close();fs.rmSync(dir,{recursive:true,force:true});});
 engine=await new HarnessEngine({stateDirectory:dir,execute}).start();
 const chat=await engine.create(tenant);
 engine.send({...tenant,chat_id:chat.chat_id,request_id:'receipt-a',text:'Вопрос А'});
 const first=await done(engine,'receipt-a');
 assert.deepEqual(first.message,first.messages.at(-1));
 assert.equal(first.assistant_message_id,first.message.id);
 engine.send({...tenant,chat_id:chat.chat_id,request_id:'receipt-b',text:'Вопрос Б'});
 const second=await done(engine,'receipt-b');
 assert.notEqual(second.message.id,first.message.id);
 assert.equal(second.message.text,'Ответ: Вопрос Б');
 const old=await done(engine,'receipt-a');
 assert.equal(old.messages.at(-1).text,'Ответ: Вопрос Б');
 assert.deepEqual(old.message,first.message);
 assert.equal(old.text,'Ответ: Вопрос А');
 await engine.close();
 engine=await new HarnessEngine({stateDirectory:dir,execute}).start();
 const restored=await done(engine,'receipt-a');
 assert.deepEqual(restored.message,first.message);
 assert.equal(restored.assistant_message_id,first.assistant_message_id);
});
