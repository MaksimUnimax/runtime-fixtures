import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';

// Execute the actual BFF function with a synthetic internal account boundary.
// PG/Unix tests independently cover that account boundary's real authority.
const source=readFileSync(new URL('../../apps/web/src/server/reports.ts',import.meta.url),'utf8');
const executable=stripTypeScriptTypes(source).replace(/^import .*;\s*$/gm,'').replace('export async function reportApi','async function reportApi');
const id='11111111-1111-4111-8111-111111111111',store='22222222-2222-4222-8222-222222222222';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function client(api,{enabled=true,origin=true,cookie='x'.repeat(43)}={}){
  return new Function('accountApi','readCookie','response','SESSION_COOKIE','validBrowserRequest','queriesEnabled','createHash',executable+'\nreturn reportApi;')(
    api,()=>cookie,(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}}),'cookie',()=>origin,()=>enabled,createHash);
}
function chunk(raw,offset=0){
  const part=raw.subarray(offset,offset+65536);
  return {id,filename:'Отчёт площадки.csv',media_type:'text/csv',bytes:raw.length,sha256:sha(raw),
    created_at:Date.now()/1000,expires_at:Math.floor(Date.now()/1000)+172800,offset,next_offset:offset+part.length,
    eof:offset+part.length===raw.length,base64:part.toString('base64'),chunk_sha256:sha(part)};
}
const request=(query='?store='+store)=>new Request('https://alisa.octoport.ru/api/v1/reports/'+id+query);

test('streams original bytes through bounded chunks with attachment and no-store',async()=>{
  const raw=Buffer.from('a,b\n'.repeat(22000)),calls=[];const first=chunk(raw);
  const fn=client(async(action,body)=>{calls.push({action,body});const next=chunk(raw,body.command.offset);return {status:200,body:{...next,expires_at:first.expires_at}};});
  const response=await fn(request(),id);assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),raw);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.match(response.headers.get('Content-Disposition'),/^attachment;/);
  assert.match(response.headers.get('Content-Disposition'),/filename\*=UTF-8''/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(calls.map(v=>v.body.command.offset),[0,65536]);assert.ok(calls.every(v=>v.action==='reports'&&v.body.store_id===store));
});

test('expired session returns safe error before sending a file',async()=>{
  const response=await client(async()=>({status:401,body:{code:'AUTH_REQUIRED'}}))(request(),id);
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{code:'AUTH_REQUIRED'});
});

test('revoked access between chunks interrupts download',async()=>{
  const raw=Buffer.alloc(90000,42);let calls=0;
  const response=await client(async()=>++calls===1?{status:200,body:chunk(raw)}:{status:403,body:{code:'CREDENTIAL_REVOKED'}})(request(),id);
  await assert.rejects(response.arrayBuffer());assert.equal(calls,2);
});

test('corrupted chunk rejected before it can enter the download',async()=>{
  const raw=Buffer.from('marketplace');const value=chunk(raw);value.base64=Buffer.from('not-source!').toString('base64');
  const response=await client(async()=>({status:200,body:value}))(request(),id);
  await assert.rejects(response.arrayBuffer());
});

test('changed file metadata on second chunk is rejected',async()=>{
  const raw=Buffer.alloc(90000,42);let calls=0;
  const response=await client(async()=>({status:200,body:{...chunk(raw,calls++?65536:0),sha256:calls>1?'0'.repeat(64):sha(raw)}}))(request(),id);
  await assert.rejects(response.arrayBuffer());assert.equal(calls,2);
});

test('unsafe filename cannot become a response header',async()=>{
  const value={...chunk(Buffer.from('x')),filename:'file\r\nSet-Cookie: leaked'};
  const response=await client(async()=>({status:200,body:value}))(request(),id);assert.equal(response.status,503);
});

test('foreign origin, no cookie, traversal and duplicate query are rejected without internal calls',async()=>{
  const forbidden=async()=>{throw Error('Must not reach account API');};
  assert.equal((await client(forbidden,{origin:false})(request(),id)).status,403);
  assert.equal((await client(forbidden,{cookie:''})(request(),id)).status,401);
  assert.equal((await client(forbidden)(request(),'../../etc/passwd')).status,422);
  assert.equal((await client(forbidden)(request('?store='+store+'&store='+store),id)).status,422);
  assert.equal((await client(forbidden)(request('?store='+store+'&path=/etc/passwd'),id)).status,422);
});

test('metadata list uses current store and cursor, never submits a question',async()=>{
  const calls=[];const fn=client(async(action,body)=>{calls.push({action,body});return {status:200,body:{items:[],next_cursor:null}};});
  const response=await fn(request('?store='+store+'&cursor='+id));assert.equal(response.status,200);
  assert.deepEqual(calls[0].body.command,{action:'list',cursor:id});assert.equal(calls[0].action,'reports');
});
