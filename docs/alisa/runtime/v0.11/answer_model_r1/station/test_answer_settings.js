const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
async function main(){
 const nodes={},node=id=>nodes[id]??={value:'',textContent:'',disabled:false};
 let saved={revision:0,request_planning_prompt:'Разбери запрос',answer_prompt:'Ответь по данным',answer_extra_instruction:''};let calls=[];
 const context={document:{getElementById:node},Date,Number,Error,fetch:async(_,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  if(body.action==='answer_settings')return {ok:true,json:async()=>({...saved})};
  if(body.action==='answer_settings_save'){
   if(body.revision!==saved.revision)return {ok:false,json:async()=>({error:'settings_changed_reload'})};
   saved={revision:saved.revision+1,request_planning_prompt:body.request_planning_prompt,answer_prompt:body.answer_prompt,answer_extra_instruction:body.answer_extra_instruction};return {ok:true,json:async()=>({...saved})};
  }
  if(body.action==='model_usage')return {ok:true,json:async()=>({average:0,requests:0,attempts:0,collection_started_at:1,coverage_since:1})};
  return {ok:true,json:async()=>({revision:1,settings:{enabled:true,interval_seconds:10,pending_messages:['Жду'],manual_command:'дальше'}})};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/app-admin.js','utf8'),context);await new Promise(setImmediate);
 assert.equal(node('answer-extra-instruction').value,'');assert.equal(node('request-planning-prompt').value,'Разбери запрос');assert.equal(node('answer-save').disabled,false);
 node('answer-extra-instruction').value='Тест\nБез потери переноса';node('answer-prompt').value='Сформулируй ответ';await node('answer-settings').onsubmit({preventDefault(){}});
 assert.equal(saved.answer_extra_instruction,'Тест\nБез потери переноса');assert.equal(saved.answer_prompt,'Сформулируй ответ');
 node('answer-extra-instruction').value='';await node('answer-settings').onsubmit({preventDefault(){}});assert.equal(saved.answer_extra_instruction,'');
 saved.revision++;node('answer-extra-instruction').value='Моя несохраненная версия';await node('answer-settings').onsubmit({preventDefault(){}});
 assert.match(node('answer-status').textContent,/уже изменена/);assert.equal(node('answer-extra-instruction').value,'Моя несохраненная версия');
 await node('answer-reload').onclick();assert.equal(node('answer-extra-instruction').value,'');assert.equal(calls.filter(x=>x.action==='answer_settings_save').length,3);
 console.log('PASS: load three prompts, multiline save, clear, conflict retains draft, reload');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
