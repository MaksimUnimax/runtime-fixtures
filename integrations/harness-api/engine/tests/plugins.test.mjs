import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HarnessEngine } from '../engine.mjs';
import { harnessRequire } from '../runtime.mjs';
import { createPipelineClient } from '../pipeline-client.mjs';

let available=true;
try{harnessRequire().resolve('@deepseek-ai/dsh/package.json');}catch{available=false;}
const actor={actor_id:'actor-one',tenant_id:'tenant-one'};
const other={actor_id:'actor-two',tenant_id:'tenant-one'};
const developer={...actor,capabilities:['developer_meter']};
const usage={prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:10};
const presentation={schema:'octoport-chat-presentation/v1',summary:'Короткий ответ.',details:'Полные детали результата.',report_urls:[{id:'report-one',label:'Полный отчёт',url:'/harness/api/reports/00000000-0000-0000-0000-000000000001/'+ 'a'.repeat(64)}]};
const meter=id=>({schema:'octoport-request-meter/v1',request_id:id,calls:{model:1,selector:1,final:0},tokens:{prompt:100,completion:10,cache_hit:80,cache_miss:20,total:110},rub:{estimated:'0.003',known:'0.003',complete:true,currency:'RUB',basis:'published_tariff_at_dispatch_with_dated_fx_estimate_not_invoice',priced_attempts:1,unpriced_attempts:0},quotes:[{id:'historic-quote',as_of:'2026-11-18T00:00:00Z',fx_as_of:'2026-11-17',currency:'RUB'}],attempts:[{stage:'selector',model:'deepseek',state:'READY',rub:'0.003',quote_id:'historic-quote'}]});

async function done(engine,scope,id){
  for(let i=0;i<1000;i++){
    const result=await engine.status({...scope,job_id:id});
    if(result.finished)return result;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('request did not finish');
}

async function setup(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-plugins-'));
  let calls=0;
  const execute=async payload=>{calls++;return{text:'Результат обработчика.',presentation,usage,metadata:{state:'READY',meter:meter(payload.request_id)}};};
  const engine=await new HarnessEngine({stateDirectory:directory,execute,...options}).start();
  const running=[engine];
  t.after(async()=>{for(const item of running.reverse())if(!item.closing)await item.close();fs.rmSync(directory,{recursive:true,force:true});});
  return{engine,directory,calls:()=>calls,execute,track:item=>running.push(item)};
}

test('real Cordis manager: commands need no model, permissions and chat toggles stay isolated',{skip:!available},async t=>{
  const {engine,calls}=await setup(t);
  const a=await engine.create(actor),b=await engine.create(actor),c=await engine.create(other);
  assert.equal(engine.runtime.ctx.octoportPlugins.name,'octoportPlugins');
  const plugins=engine.pluginList({...actor,chat_id:a.chat_id}).plugins;
  assert.deepEqual(plugins.map(p=>p.id),['plugin-manager','matrix']);
  assert.equal(plugins.find(p=>p.id==='matrix').enabled,true);
  assert.throws(()=>engine.pluginSet({...actor,chat_id:a.chat_id,plugin_id:'dev-meter',enabled:true,scope:'chat'}),{code:'PLUGIN_UNAVAILABLE'});
  assert.throws(()=>engine.pluginSet({...actor,chat_id:c.chat_id,plugin_id:'matrix',enabled:false,scope:'chat'}),{code:'CHAT_NOT_FOUND'});
  assert.throws(()=>engine.pluginSet({...actor,chat_id:a.chat_id,plugin_id:'plugin-manager',enabled:false,scope:'chat'}),{code:'PLUGIN_REQUIRED'});
  for(const [index,text]of ['покажи плагины','включи плагин отсутствующий','/plugins unknown action','/plugin dev-meter requests','отключи плагин матрица'].entries()){
    assert.equal(engine.pluginParse({...actor,chat_id:a.chat_id,text}).handled,true);
    const request_id='command-'+index;
    engine.send({...actor,chat_id:a.chat_id,request_id,text});
    assert.equal((await done(engine,actor,request_id)).state,'completed');
  }
  assert.equal(calls(),0);
  assert.equal(engine.pluginList({...actor,chat_id:a.chat_id}).plugins.find(p=>p.id==='matrix').enabled,false);
  assert.equal(engine.pluginList({...actor,chat_id:b.chat_id}).plugins.find(p=>p.id==='matrix').enabled,true);
  assert.equal(engine.pluginList({...other,chat_id:c.chat_id}).plugins.find(p=>p.id==='matrix').enabled,true);
  engine.send({...actor,chat_id:a.chat_id,request_id:'disabled-query',text:'Продажи вчера'});
  assert.match((await done(engine,actor,'disabled-query')).text,/не включён обработчик/);
  assert.equal(calls(),0);
  engine.send({...other,chat_id:c.chat_id,request_id:'other-query',text:'Продажи вчера'});
  assert.equal((await done(engine,other,'other-query')).text,'Результат обработчика.');
  assert.equal(calls(),1);
});

test('request feature snapshot remains immutable while owner settings change',{skip:!available},async t=>{
  const {engine,calls}=await setup(t);
  const chat=await engine.create(actor);
  engine.send({...actor,chat_id:chat.chat_id,request_id:'admitted-on',text:'Продажи вчера'});
  engine.pluginSet({...actor,chat_id:chat.chat_id,plugin_id:'matrix',enabled:false,scope:'chat'});
  const result=await done(engine,actor,'admitted-on');
  assert.equal(result.text,'Результат обработчика.');
  assert.equal(calls(),1);
  engine.send({...actor,chat_id:chat.chat_id,request_id:'admitted-off',text:'Продажи сегодня'});
  assert.match((await done(engine,actor,'admitted-off')).text,/не включён обработчик/);
  assert.equal(calls(),1);
});

test('account defaults, chat overrides and permissions survive restart without crossing tenants',{skip:!available},async t=>{
  const {engine,directory,execute,track}=await setup(t);
  const first=await engine.create(actor),second=await engine.create(actor);
  engine.pluginSet({...actor,plugin_id:'matrix',enabled:false,scope:'account'});
  engine.pluginSet({...actor,chat_id:first.chat_id,plugin_id:'matrix',enabled:true,scope:'chat'});
  await engine.close();
  const resumed=await new HarnessEngine({stateDirectory:directory,execute}).start();
  track(resumed);
  assert.equal(resumed.pluginList({...actor,chat_id:first.chat_id}).plugins.find(p=>p.id==='matrix').enabled,true);
  assert.equal(resumed.pluginList({...actor,chat_id:second.chat_id}).plugins.find(p=>p.id==='matrix').enabled,false);
  assert.equal(resumed.pluginList({...actor,tenant_id:'other-tenant'}).plugins.find(p=>p.id==='matrix').enabled,true);
  assert.equal(resumed.pluginList(other).plugins.find(p=>p.id==='matrix').enabled,true);
});

test('dev meter is current-permission gated, preserves quotes and exact decimals, presentation persists',{skip:!available},async t=>{
  const {engine}=await setup(t);
  const chat=await engine.create(actor),otherChat=await engine.create(other);
  for(const id of ['meter-one','meter-two']){
    engine.send({...developer,chat_id:chat.chat_id,request_id:id,text:'Запрос'});
    const result=await done(engine,developer,id);
    assert.deepEqual(result.metadata.meter,meter(id));
    assert.deepEqual(result.presentation,presentation);
  }
  engine.send({...other,chat_id:otherChat.chat_id,request_id:'someone-else',text:'Запрос'});
  await done(engine,other,'someone-else');
  const publicStatus=await engine.status({...actor,job_id:'meter-one'});
  assert.equal(publicStatus.usage,null);
  assert.equal(publicStatus.metadata.meter,undefined);
  const call={...developer,chat_id:chat.chat_id,plugin_id:'dev-meter',action:'requests',arguments:{}};
  const data=await engine.pluginCall(call);
  assert.equal(data.requests.length,2);
  assert.equal(data.summary.rub.estimated,'0.006');
  assert.equal(data.requests[0].meter.quotes[0].id,'historic-quote');
  const developerHistory=await engine.history({...developer,chat_id:chat.chat_id});
  assert.deepEqual(developerHistory.messages[1].metadata.meter,meter('meter-one'));
  assert.deepEqual(developerHistory.messages[1].usage,usage);
  const ordinaryHistory=await engine.history({...actor,chat_id:chat.chat_id});
  assert.equal(ordinaryHistory.messages[1].metadata.meter,undefined);
  assert.equal(ordinaryHistory.messages[1].usage,null);
  await assert.rejects(engine.pluginCall({...call,arguments:{job_id:'someone-else'}}),{code:'JOB_NOT_FOUND'});
  await assert.rejects(engine.pluginCall({...call,capabilities:[]}),{code:'PLUGIN_UNAVAILABLE'});
  engine.pluginSet({...developer,chat_id:chat.chat_id,plugin_id:'dev-meter',enabled:false,scope:'chat'});
  assert.equal((await engine.status({...developer,job_id:'meter-one'})).metadata.meter,undefined);
  await assert.rejects(engine.pluginCall(call),{code:'PLUGIN_UNAVAILABLE'});
  const history=await engine.history({...actor,chat_id:chat.chat_id});
  assert.equal(history.messages[1].presentation.summary,'Короткий ответ.');
});

test('developer command text is redacted after revocation, including native-commit crash gap',{skip:!available},async t=>{
  const {engine}=await setup(t);
  const chat=await engine.create(actor);
  engine.send({...developer,chat_id:chat.chat_id,request_id:'charged',text:'Запрос'});
  await done(engine,developer,'charged');
  engine.send({...developer,chat_id:chat.chat_id,request_id:'meter-command',text:'покажи расход'});
  const completed=await done(engine,developer,'meter-command');
  assert.match(completed.text,/0\.003/);
  assert.equal(completed.metadata.meter.calls.model,0);
  assert.equal(completed.metadata.meter.rub.estimated,'0');
  const publicResult=await engine.status({...actor,job_id:'meter-command'});
  assert.match(publicResult.text,/только авторизованному разработчику/);
  let history=await engine.history({...actor,chat_id:chat.chat_id});
  assert.equal(JSON.stringify(history).includes('0.003'),false);
  const job=Object.values(engine.store.data.jobs).find(item=>item.job_id==='meter-command');
  delete job.result;delete job.assistant_message_id;engine.store.save();
  history=await engine.history({...actor,chat_id:chat.chat_id});
  assert.match(history.messages.at(-1).text,/только авторизованному разработчику/);
  assert.equal(JSON.stringify(history).includes('0.003'),false);
});

test('failed model request preserves its actual meter for developer only',{skip:!available},async t=>{
  const execute=createPipelineClient({url:'http://127.0.0.1:1/internal/harness/query',serviceKey:'fixture-service-key-at-least-32-characters',fetchImpl:async(_url,options)=>{
    const payload=JSON.parse(options.body);
    return new Response(JSON.stringify({code:'PROVIDER_FAILED',error:'Ошибка поставщика.',meter:meter(payload.request_id)}),{status:502});
  }});
  const {engine}=await setup(t,{execute});
  const chat=await engine.create(actor);
  engine.send({...developer,chat_id:chat.chat_id,request_id:'failed-paid-attempt',text:'Запрос'});
  const failure=await done(engine,developer,'failed-paid-attempt');
  assert.equal(failure.state,'failed');
  assert.deepEqual(failure.metadata.meter,meter('failed-paid-attempt'));
  assert.equal((await engine.status({...actor,job_id:'failed-paid-attempt'})).metadata.meter,undefined);
  const receipt=await engine.pluginCall({...developer,chat_id:chat.chat_id,plugin_id:'dev-meter',action:'requests',arguments:{job_id:'failed-paid-attempt'}});
  assert.equal(receipt.requests[0].state,'failed');
  assert.equal(receipt.summary.rub.estimated,'0.003');
});

test('trusted manifest adds a Cordis extension without dispatcher edits; unknown cost is never zeroed',{skip:!available},async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-installed-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const installed=path.join(folder,'installed');
  fs.cpSync(fileURLToPath(new URL('../plugins/installed/',import.meta.url)),installed,{recursive:true});
  const plugin=path.join(installed,'probe');fs.mkdirSync(plugin);
  const code=`export default {name:'probe-extension',inject:['octoportPlugins'],apply(ctx,{manifest}){ctx.octoportPlugins.register(ctx,manifest,{actions:{ping:async()=>({text:'Native extension reply'})}});}};\n`;
  fs.writeFileSync(path.join(plugin,'plugin.mjs'),code);
  const manifest={api_version:'octoport.harness-plugin/v1',harness_version:'0.2.2-rc.1',id:'probe',name:'Проверочный плагин',description:'Installed test fixture',version:'1.0.0',default_enabled:false,required:false,capability:null,priority:50,aliases:['проверочный'],actions:{ping:{title:'Probe',aliases:['проверка расширения']}},entry:'plugin.mjs',sha256:crypto.createHash('sha256').update(code).digest('hex')};
  fs.writeFileSync(path.join(plugin,'manifest.json'),JSON.stringify(manifest));
  const {engine,calls}=await setup(t,{pluginsDirectory:installed});
  const chat=await engine.create(actor);
  engine.send({...developer,chat_id:chat.chat_id,request_id:'enable-probe',text:'включи проверочный'});
  await done(engine,developer,'enable-probe');
  engine.send({...developer,chat_id:chat.chat_id,request_id:'invoke-probe',text:'проверка расширения'});
  const result=await done(engine,developer,'invoke-probe');
  assert.equal(result.text,'Native extension reply');
  assert.equal(calls(),0);
  assert.equal(result.usage,null);
  assert.equal(result.metadata.meter,undefined);
  const telemetry=await engine.pluginCall({...developer,chat_id:chat.chat_id,plugin_id:'dev-meter',action:'requests',arguments:{job_id:'invoke-probe'}});
  assert.equal(telemetry.requests[0].meter,null);
  assert.equal(telemetry.summary.rub.complete,false);
  const manager=engine.runtime.ctx.octoportPlugins;
  await engine.close();
  assert.equal(manager.records.has('probe'),false);
  fs.appendFileSync(path.join(plugin,'plugin.mjs'),'// unreviewed modification\n');
  const bad=new HarnessEngine({stateDirectory:path.join(folder,'bad-state'),execute:async()=>({text:'never'}),pluginsDirectory:installed});
  await assert.rejects(bad.start(),/module hash mismatch/);
});
