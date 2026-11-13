const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function node(){return {textContent:'',children:[],appendChild(v){this.children.push(v)}}}
const nodes={},context={document:{getElementById:id=>nodes[id]??=node(),createElement:node},Date,Number,Error,fetch:async()=>({ok:false,json:async()=>({error:'offline fixture'})})};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/app-admin.js','utf8'),context);
context.showEconomics({requests:[{request:'safe-id',route:'program',attempts:3,complete_receipts:2,known_rub:'0.123456',cost_complete:false,quotes:[],timing:{total_ms:5000,provider_ms:3000,outside_provider_ms:2000}}]});
const output=JSON.stringify(nodes['request-economics']);
assert.match(output,/Программа/);assert.match(output,/3 \/ 2/);assert.match(output,/неизвестная часть/);assert.match(output,/5.0/);assert.match(output,/2.0/);
assert(!output.includes('innerHTML'));
console.log('PASS: request route, attempts, missing costs and timing shown safely');
