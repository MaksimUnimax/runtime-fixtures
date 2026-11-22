import assert from 'node:assert/strict';
import test from 'node:test';
import {activate,installFilter,turnFilter} from './capability-filter.mjs';
import {projectCompletedKnowledge} from './octopus-knowledge.mjs';

function fixture(restored) {
  // Unknown to the filter: the test registers a future module and a private schema provider.
  const name='mcp__new__audit_inventory';
  const definitions=new Map([[name,{name,description:'Проверить остатки',parameters:{secretSchema:true}}],
    ['describe__'+name,{name:'describe__'+name,description:'private',execute:async()=>({structuredContent:{result:['fixture-contract']}})}],
    ['tiny_read',{name:'tiny_read',description:'Короткая операция',parameters:{}}],
    ['octoport_help',{name:'octoport_help'}]]);
  const ctx={tools:{definitions:()=>[...definitions.values()],register:t=>definitions.set(t.name,t),
    get:k=>definitions.get(k),guard:f=>ctx.guard=f},systemPrompt:{section(){}}};
  installFilter(ctx,t=>t,restored);
  const project=()=>turnFilter(ctx).project(ctx.tools.definitions()).map(t=>t.name);
  return {ctx,defs:definitions,name,project};
}
test('future tool contracts are closed until explicitly opened for this turn and step',async()=>{
  const {ctx,name,defs,project}=fixture();
  assert.deepEqual(project(),['octoport_help',activate]);
  assert.ok(ctx.guard({name}));
  assert.ok(ctx.guard({name:"tiny_read"}));
  const tool=defs.get(activate);
  const result=JSON.parse(await tool.execute({action:name,query:'остатки'},{}));
  assert.deepEqual(result,{opened:name,details:['fixture-contract']});
  assert.ok(ctx.guard({name})); // same-batch guesses cannot run
  assert.ok(project().includes(name));
  assert.equal(ctx.guard({name}),undefined);
  assert.ok(ctx.guard({name:'describe__'+name}));
  assert.deepEqual(fixture().project(),['octoport_help',activate]);
  assert.ok(!JSON.stringify(tool).includes('secretSchema'));
});
test('current checkpoint can restore the grant; failed and foreign calls cannot',()=>{
  const {name}=fixture();
  const call={type:'assistant/message',data:{message:{content:[{type:'tool-call',id:'s',name:activate}]}}};
  const result={type:'tool/result',data:{message:{toolCallId:'s',content:[{type:'text',text:JSON.stringify({opened:name})}]}}};
  assert.ok(fixture([call,result]).project().includes(name));
  assert.ok(!fixture([result]).project().includes(name));
  result.data.message.isError=true;
  assert.ok(!fixture([call,result]).project().includes(name));
});
test('completed tool contracts leave the next request while figures and unrelated signed calls survive',()=>{
  const scoped={id:'select',role:'assistant',source:{kind:'model'},content:[{type:'tool-call',id:'c',name:activate}]};
  const detail={id:'detail',role:'tool',toolCallId:'c',content:[{type:'text',text:'SENSITIVE_TEMPLATE'}]};
  const final={id:'reply',role:'assistant',source:{kind:'model'},content:[{type:'reasoning',text:'SENSITIVE_TEMPLATE'},{type:'text',text:'Выкупили 7 штук.'}]};
  const other={id:'signed',role:'assistant',source:{kind:'model',replayState:{signature:'must-survive'}},
    content:[{type:'tool-call',id:'d',name:'create_illustration'}]};
  const seed=[scoped,detail,final,other].map(m=>({type:m.role==='tool'?'tool/result':'assistant/message',data:{turn:m===other?2:1,message:m}}));
  const rows=projectCompletedKnowledge(seed)([scoped,detail,final,other]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0].content,[{type:'text',text:'Выкупили 7 штук.'}]);
  assert.deepEqual(rows[1],other);
});

test('a historical mixed signed batch never leaves an orphan call, signature or tool result',()=>{
  const calls={id:'mixed',role:'assistant',source:{kind:'model',replayState:{reasoning:'private-template'}},
    content:[{type:'tool-call',id:'a',name:activate},{type:'tool-call',id:'b',name:'check_access'}]};
  const messages=[calls,...['a','b'].map(id=>({role:'tool',id:'result-'+id,toolCallId:id,content:[{type:'text',text:'private-template'}]}))];
  const seed=messages.map(message=>({type:message.role==='tool'?'tool/result':'assistant/message',data:{turn:1,message}}));
  assert.deepEqual(projectCompletedKnowledge(seed)(messages),[]);
});
