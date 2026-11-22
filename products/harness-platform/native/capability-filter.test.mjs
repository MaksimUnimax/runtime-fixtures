import assert from 'node:assert/strict';
import test from 'node:test';
import {activate,installFilter,turnFilter} from './capability-filter.mjs';
import {projectCompletedKnowledge} from './octopus-knowledge.mjs';

function fixture(restored,history) {
  // Unknown to the filter: the test registers a future module and a private schema provider.
  const name='mcp__new__audit_inventory';
  const resolver='mcp__new__describe__audit_inventory';
  const definitions=new Map([[name,{name,description:'Проверить остатки',parameters:{secretSchema:true}}],
    [resolver,{name:resolver,description:'private',execute:async()=>({structuredContent:{result:['fixture-contract']}})}],
    ['tiny_read',{name:'tiny_read',description:'Короткая операция',parameters:{}}],
    ['octoport_help',{name:'octoport_help'}]]);
  const ctx={tools:{definitions:()=>[...definitions.values()],register:t=>definitions.set(t.name,t),
    get:k=>definitions.get(k),guard:f=>ctx.guard=f},systemPrompt:{section(){}}};
  installFilter(ctx,t=>t,restored,history);
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
  assert.ok(ctx.guard({name:'mcp__new__describe__audit_inventory'}));
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
  const detail={id:'detail',role:'tool',toolCallId:'c',content:[{type:'text',text:JSON.stringify({opened:'future',details:'SENSITIVE_TEMPLATE'})}]};
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
    content:[{type:'text',text:'Сейчас запрошу показатели.'},{type:'tool-call',id:'a',name:activate},{type:'tool-call',id:'b',name:'check_access'}]};
  const messages=[calls,...['a','b'].map(id=>({role:'tool',id:'result-'+id,toolCallId:id,content:[{type:'text',text:'private-template'}]}))];
  const seed=messages.map(message=>({type:message.role==='tool'?'tool/result':'assistant/message',data:{turn:1,message}}));
  assert.deepEqual(projectCompletedKnowledge(seed)(messages),[]);
});

test('ordinary activation keeps the following historical result and signed final',()=>{
  const messages=[
    {role:'assistant',id:'a',content:[{type:'tool-call',id:'one',name:activate}]},
    {role:'tool',id:'b',toolCallId:'one',content:[{type:'text',text:'{"opened":"tiny_read"}'}]},
    {role:'assistant',id:'c',content:[{type:'tool-call',id:'two',name:'tiny_read'}]},
    {role:'tool',id:'d',toolCallId:'two',content:[{type:'text',text:'access OK'}]},
    {role:'assistant',id:'e',content:[{type:'text',text:'Доступ подтверждён.'}]}
  ].map(m=>({...m,source:{kind:'model',replayState:{signature:m.id}}}));
  const seed=messages.map(message=>({type:message.role==='tool'?'tool/result':'assistant/message',data:{turn:1,message}}));
  assert.deepEqual(projectCompletedKnowledge(seed)(messages),messages.slice(2));
});

test('only the opened module receives prior arguments from its own settled calls',async()=>{
  const name='mcp__new__audit_inventory';
  const history=[
    {type:'assistant/message',data:{turn:1,message:{content:[{type:'tool-call',name,id:'ok',arguments:'{"metric":"units"}'}]}}},
    {type:'tool/result',data:{turn:1,message:{toolCallId:'ok'}}},
    {type:'assistant/message',data:{turn:2,message:{content:[{type:'tool-call',name,id:'bad',arguments:'{"metric":"failed"}'}]}}},
    {type:'tool/result',data:{turn:2,message:{toolCallId:'bad',isError:true}}}
  ];
  const {defs,project}=fixture([],history);
  const provider=defs.get('mcp__new__describe__audit_inventory');
  provider.parameters={properties:{previous:{type:'string'}}};
  let sent;
  provider.execute=async (args)=>{sent=args;return {content:[]};};
  assert.deepEqual(project(),['octoport_help',activate]);
  await defs.get(activate).execute({action:name,query:'позавчера',reuse:true},{});
  assert.equal(sent.reuse,true);
  assert.deepEqual(JSON.parse(sent.previous),[{metric:'units'}]);
});

test('the user request follows the latest runtime context on both transports',()=>{
  const user={role:'user',source:{kind:'user'},content:[{type:'text',text:'Получать здесь.'}]};
  const context={role:'user',source:{kind:'runtime-context',form:'snapshot'},content:[{type:'text',text:'Сервисы'}]};
  const assistant={role:'assistant',content:[]};
  assert.deepEqual(projectCompletedKnowledge([])([user,context,assistant]),[context,user,assistant]);
});

test('help-first turns keep all action contracts closed, including after recovery', async()=>{
  const {ctx,name,defs,project}=fixture();
  turnFilter(ctx).recordHelp(false);
  assert.deepEqual(project(),['octoport_help']);
  assert.ok(ctx.guard({name:activate}));
  const result=JSON.parse(await defs.get(activate).execute({action:name,query:'учебный пример'},{}));
  assert.ok(result.error);
  const help={type:'assistant/message',data:{message:{content:[{type:'tool-call',name:'octoport_help',arguments:'{"runNow":false}'}]}}};
  assert.deepEqual(fixture([help]).project(),['octoport_help']);
  const mixed=fixture();
  await mixed.defs.get(activate).execute({action:name,query:'данные сейчас'},{});
  turnFilter(mixed.ctx).recordHelp(false);
  assert.ok(mixed.project().includes(name));
});

test('looking up prerequisites for an immediate request keeps actions available', ()=>{
  const {ctx,project}=fixture();
  turnFilter(ctx).recordHelp(true);
  assert.ok(project().includes(activate));
  const lookup={type:'assistant/message',data:{message:{content:[{type:'tool-call',name:'octoport_help',arguments:'{"runNow":true}'}]}}};
  assert.ok(fixture([lookup]).project().includes(activate));
});
