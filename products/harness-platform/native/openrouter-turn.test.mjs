import assert from 'node:assert/strict';
import test from 'node:test';
import {project} from './openrouter-turn.mjs';
import {publicEvents} from './public-events.mjs';

test('tool continuation replays signed model data only to the same model and keeps it out of browser events',()=>{
  const details=[{type:'reasoning.encrypted',data:'private-fixture-signature',index:0}];
  const message={role:'assistant',source:{provider:'platform-openrouter',model:'maker/a',replayState:{response:{reasoning_details:details}}},
    content:[{type:'text',text:'Looking up the value'},{type:'tool-call',id:'lookup-1',name:'lookup',arguments:'{}'}]};
  assert.deepEqual(project([message],[],null,'maker/a').messages[0].reasoning_details,details);
  assert.equal(project([message],[],null,'maker/b').messages[0].reasoning_details,undefined);
  assert.ok(!JSON.stringify(publicEvents([{type:'assistant/message',data:{message}}])).includes('private-fixture-signature'));
});

test('the outbound request has one leading system instruction ending with current settings',()=>{
  const row = (role,text) => ({role,content:[{type:'text',text}]});
  const out=project([row('system','native'),row('developer','guide'),row('user','hello')],[],'current','x');
  assert.deepEqual(out.messages,[{role:'system',content:'native\n\nguide\n\ncurrent'},{role:'user',content:'hello'}]);
});
