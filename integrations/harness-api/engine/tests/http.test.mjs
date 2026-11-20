import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { createPipelineClient } from '../pipeline-client.mjs';

test('engine HTTP requires service secret before forwarding any actor scope',async t=>{
 let calls=0;
 const engine={health:()=>({ok:true}),create:async input=>{calls++;return {chat_id:'test',...input};}};
 const key='test-only-service-key-at-least-32-characters';
 const server=createServer(engine,key);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/v1/chats/create`;
 const anon=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor_id:'target'})});
 assert.equal(anon.status,401);assert.equal(calls,0);
 const auth=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({actor_id:'actor-a',tenant_id:'tenant-a'})});
 assert.equal(auth.status,201);assert.equal(calls,1);
 const bad=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:'[]'});
 assert.equal(bad.status,400);assert.equal(calls,1);
});

test('pipeline rejects non-loopback endpoints and does not retry transport errors',async()=>{
 const key='test-only-service-key-at-least-32-characters';
 assert.throws(()=>createPipelineClient({url:'https://example.com/query',serviceKey:key}),/loopback/);
 let calls=0;
 const client=createPipelineClient({url:'http://127.0.0.1:18131/internal/harness/query',serviceKey:key,fetchImpl:async()=>{calls++;throw new Error('no connection');}});
 await assert.rejects(client({text:'question'}),{code:'PIPELINE_UNAVAILABLE'});
 assert.equal(calls,1);
});

test('trusted failure meter is retained only for its exact request without retry',async()=>{
 const meter={schema:'octoport-request-meter/v1',request_id:'request-one',tokens:{prompt:12},rub:{known:'0.01',complete:false}};
 let calls=0;
 const client=createPipelineClient({url:'http://127.0.0.1:18131/internal/harness/query',serviceKey:'fixture-service-key-at-least-32-characters',fetchImpl:async()=>{
  calls++;return new Response(JSON.stringify({code:'PROVIDER_FAILED',error:'Запрос не завершён.',meter}),{status:502});
 }});
 await assert.rejects(client({request_id:'request-one'}),error=>{assert.deepEqual(error.meter,meter);return true;});
 await assert.rejects(client({request_id:'different-request'}),error=>{assert.equal(error.meter,undefined);return true;});
 assert.equal(calls,2);
});
