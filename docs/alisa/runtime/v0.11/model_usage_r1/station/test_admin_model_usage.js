const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
async function check(average,failed=false){
 const nodes={};const node=id=>nodes[id]??=( {textContent:'',value:'',checked:false} );
 const context={document:{getElementById:node},Date,Number,Error,
  fetch:async(_,options)=>{const {action}=JSON.parse(options.body);if(action==='model_usage'){
   if(failed)throw Error('fixture outage');return {ok:true,json:async()=>({average,attempts:10,requests:average===null?0:5,received:8,failed:1,unknown:1,pending:0,full_window:false,collection_started_at:1,coverage_since:2})};}
   return {ok:true,json:async()=>({revision:1,settings:{enabled:true,interval_seconds:25,pending_messages:['Осталось {remaining}'],manual_command:'результат'}})};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/app-admin.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 if(failed)assert.match(node('model-usage').textContent,/временно недоступна/);
 else {assert.match(node('model-usage').textContent,/Обращений: 10/);assert.match(node('model-usage-period').textContent,/не подтверждено/);if(average===null)assert.match(node('model-usage').textContent,/нет принятых запросов/);else assert.match(node('model-usage').textContent,/Среднее: 2/);}
 assert.equal(node('enabled').checked,true);assert.equal(node('interval').value,25);
}
(async()=>{await check(2);await check(null);await check(2,true);console.log('3 admin rendering scenarios passed');})().catch(error=>{console.error(error);process.exitCode=1;});
