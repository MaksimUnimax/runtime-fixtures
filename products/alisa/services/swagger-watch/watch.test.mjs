import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile,symlink,mkdir,access} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documents,runWatch,loadState,publicStatus,importCandidate,acceptReviewed,canonicalProviderIdentity,digest,readBounded} from './dist/watch.mjs';
import {serveStatus} from './dist/status.mjs';
const options={diskReserve:0,stateBudget:8*1024*1024};
const start=new Date('2026-11-08T00:00:00Z');
const clock=offset=>()=>new Date(start.valueOf()+offset);
function spec(d,extra=false){
  const root={openapi:'3.0.0',info:{title:d.family==='OZON_PERFORMANCE'?'Ozon Performance API':d.family==='OZON_SELLER'?'Ozon Seller API':'Wildberries API',version:'1'},servers:[{url:d.family==='OZON_PERFORMANCE'?'https://api-performance.ozon.ru:443':d.family==='OZON_SELLER'?'https://api-seller.ozon.ru':'https://common-api.wildberries.ru'}],paths:{'/first':{get:{operationId:'one',responses:{200:{description:'OK'}}}}}};
  if(extra)root.paths['/added']={post:{responses:{200:{description:'OK'}}}};return Buffer.from(JSON.stringify(root));
}
function acquire(changed=false){return async({entry,document})=>{const d=documents().find(d=>d.key===document.documentKey),bytes=spec(d,changed&&d.family==='OZON_PERFORMANCE');return {kind:'ACQUIRED_OFFICIAL_SOURCE_CANDIDATE',sourceFamily:entry.sourceFamily,documentKey:d.key,officialUrl:d.url,bytes,sha256:digest(bytes),sizeBytes:bytes.length};};}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'alisa-swagger-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('registry covers exactly two Ozon documents and all thirteen WB documents',()=>{
  const ds=documents();assert.equal(ds.length,15);assert.equal(new Set(ds.map(d=>d.key)).size,15);assert.equal(ds.filter(d=>d.family==='WILDBERRIES').length,13);assert.ok(ds.every(d=>d.url.startsWith('https://')));
});
test('default HTTPS port is equivalent; credentials, wrong paths and origins are rejected',()=>{
  const valid={openapi:'3.0.0',servers:[{url:'https://api-performance.ozon.ru:443'}]};assert.equal(canonicalProviderIdentity(valid,'https://api-performance.ozon.ru'),true);
  for(const url of ['https://api-performance.ozon.ru.evil.invalid','https://user@api-performance.ozon.ru','https://api-performance.ozon.ru/path','https://api-performance.ozon.ru?x=1','https://api-performance.ozon.ru#x','http://api-performance.ozon.ru','https://api-performance.ozon.ru:8443'])assert.equal(canonicalProviderIdentity({...valid,servers:[{url}]},'https://api-performance.ozon.ru'),false);
  assert.equal(canonicalProviderIdentity({...valid,servers:[...valid.servers,{url:'https://evil.invalid'}]},'https://api-performance.ozon.ru'),false);
});
test('automatic acquisition produces complete snapshots with no provider keys or LLM lane',async t=>{
  const root=await fixture(t),status=await runWatch(root,{...options,acquire:acquire(),now:clock(0)});
  assert.equal(status.status,'READY');assert.equal(status.llm_monitoring,false);assert.equal(status.provider_credentials_used,false);assert.equal(status.runtime_catalog_auto_update,false);assert.equal(status.families[2].fresh_documents,13);
  assert.equal((await readdir(join(root,'blobs'))).length,3);
});
test('restart and unchanged run reuse blobs and do not grow diff artifacts',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:clock(0)});
  let calls=0;await runWatch(root,{...options,acquire:async()=>{calls++;throw Error();},now:clock(1000)});assert.equal(calls,0);
  const status=await runWatch(root,{...options,acquire:acquire(),now:clock(6*3600_000)});assert.ok(status.documents.every(d=>d.outcome==='UNCHANGED'));assert.equal((await readdir(join(root,'diffs'))).length,0);
});
test('semantic additions are reported without a runtime/catalog mutation',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:clock(0)});
  const status=await runWatch(root,{...options,acquire:acquire(true),now:clock(6*3600_000)}),r=status.documents.find(d=>d.family==='OZON_PERFORMANCE');
  assert.equal(r.outcome,'CHANGED');assert.equal(r.changes.added,1);assert.equal(status.runtime_catalog_auto_update,false);assert.ok(r.changes.diff_sha256);
});
test('blocked source preserves last good document, remains degraded, and uses bounded backoff',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:clock(0)});
  const status=await runWatch(root,{...options,acquire:async()=>({kind:'OPERATOR_SOURCE_REQUIRED',httpStatus:403}),now:clock(6*3600_000)});
  assert.equal(status.status,'DEGRADED');assert.ok(status.documents.every(d=>d.last_good&&d.outcome==='OPERATOR_SOURCE_REQUIRED'));assert.equal(Date.parse(status.documents[0].next_attempt_at),start.valueOf()+30*3600_000);
});
test('missing WB document cannot imply complete WB family coverage',async t=>{
  const root=await fixture(t),f=acquire(),status=await runWatch(root,{...options,now:clock(0),acquire:async x=>x.document.documentKey==='WB_13_FINANCES'?{kind:'SOURCE_TEMPORARILY_UNAVAILABLE'}:f(x)});
  assert.equal(status.status,'DEGRADED');assert.equal(status.families[2].complete,false);assert.equal(status.families[2].fresh_documents,12);
});
test('freshness expires even without a new scheduled run',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:clock(0)});
  assert.equal(publicStatus(await loadState(root),clock(19*3600_000)()).status,'DEGRADED');
});
test('owner file is a candidate until exact digest review, and never invents automatic freshness',async t=>{
  const root=await fixture(t),d=documents().find(d=>d.family==='OZON_PERFORMANCE'),c=await importCandidate(root,d.key,spec(d),{...options,now:start});
  let status=publicStatus(await loadState(root),start);assert.equal(status.documents.find(r=>r.key===d.key).last_good,null);
  await assert.rejects(acceptReviewed(root,d.key,'0'.repeat(64),{...options,now:start}),/REVIEW_CONTEXT/);
  status=await acceptReviewed(root,d.key,c.sha256,{...options,now:start});const row=status.documents.find(r=>r.key===d.key);assert.equal(row.last_good.origin,'OWNER_SUPPLIED_REVIEWED');assert.equal(row.last_automatic_success_at,null);assert.equal(row.fresh,false);
});
test('HTML and wrong Ozon identity cannot replace accepted data',async t=>{
  const root=await fixture(t),d=documents()[0];await assert.rejects(importCandidate(root,d.key,Buffer.from('<html>Access denied</html>'),options));
  const wrong=JSON.parse(spec(d));wrong.servers=[{url:'https://evil.invalid'}];await assert.rejects(importCandidate(root,d.key,Buffer.from(JSON.stringify(wrong)),options),/SOURCE_SERVER_IDENTITY_MISMATCH/);
});
test('corrupt cached artifact is not reported as a successful acquisition',async t=>{
  const root=await fixture(t);const before=await runWatch(root,{...options,acquire:acquire(),now:clock(0)});const r=before.documents[0];await writeFile(join(root,'blobs',r.last_good.sha256+'.json'),'corrupt');
  const after=await runWatch(root,{...options,acquire:acquire(),now:clock(6*3600_000)});assert.equal(after.documents[0].outcome,'ARTIFACT_HASH_MISMATCH');assert.equal(after.status,'DEGRADED');
});
test('budget exhaustion does not remove previous snapshots or accept a new document',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:clock(0)});const previous=await readdir(join(root,'blobs'));
  const result=await runWatch(root,{...options,stateBudget:1,acquire:acquire(true),now:clock(6*3600_000)});assert.equal(result.status,'DEGRADED');assert.equal(result.documents.find(d=>d.family==='OZON_PERFORMANCE').outcome,'STATE_BUDGET');assert.deepEqual(await readdir(join(root,'blobs')),previous);
});
test('no-follow file and directory checks reject links',async t=>{
  const root=await fixture(t),outside=await fixture(t);await writeFile(join(outside,'file'),'private');await symlink(join(outside,'file'),join(root,'link'));await assert.rejects(readBounded(join(root,'link')));
  await mkdir(join(root,'state'));await symlink(outside,join(root,'state','blobs'));await assert.rejects(runWatch(join(root,'state'),{...options,acquire:acquire(),now:clock(0)}));
});
test('public status route is read-only and does not expose raw artifacts or arbitrary paths',async t=>{
  const root=await fixture(t);await runWatch(root,{...options,acquire:acquire(),now:()=>new Date('2020-01-01T00:00:00Z')});
  const server=serveStatus(root,{port:0});await new Promise(resolve=>server.on('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url='http://127.0.0.1:'+server.address().port;
  const r=await fetch(url+'/health/swagger');assert.equal(r.status,503);assert.equal((await r.json()).status,'DEGRADED');assert.equal((await fetch(url+'/health/swagger',{method:'POST'})).status,404);assert.equal((await fetch(url+'/state.json')).status,404);assert.equal((await fetch(url+'/health/swagger?file=x')).status,404);
});
test('pinned launcher serializes run/import/accept-reviewed while status stays available',async t=>{
  const root=await fixture(t),script=join(root,'entry.sh'),probe=join(root,'probe.mjs'),started=join(root,'started'),release=join(root,'release');
  const original=await readFile(new URL('./entry.sh',import.meta.url),'utf8');
  await writeFile(script,original.replaceAll('/var/lib/alisa-swagger-watch/.run.lock',join(root,'.run.lock')).replaceAll('/usr/local/bin/node',process.execPath).replaceAll('/opt/alisa-swagger-watch/current/cli.mjs',probe),{mode:0o700});
  await writeFile(probe,`import {writeFile,access} from 'node:fs/promises';if(process.argv[2]==='status')process.exit(0);await writeFile(${JSON.stringify(started)},'1');for(let i=0;i<200;i++){try{await access(${JSON.stringify(release)});process.exit(0);}catch{}await new Promise(r=>setTimeout(r,10));}process.exit(2);`);
  const first=spawn(script,['run'],{stdio:'ignore'});t.after(()=>first.kill('SIGTERM'));
  for(let i=0;i<200;i++){try{await access(started);break;}catch{}await new Promise(r=>setTimeout(r,10));}
  await access(started);
  for(const command of ['run','import','accept-reviewed'])assert.equal(spawnSync(script,[command],{timeout:2000}).status,75);
  assert.equal(spawnSync(script,['status'],{timeout:2000}).status,0);
  const finished=new Promise(resolve=>first.on('exit',resolve));await writeFile(release,'1');assert.equal(await finished,0);
  assert.equal(spawnSync(script,['accept-reviewed'],{timeout:2000}).status,0);
});
test('direct mutating CLI invocation without native launcher is rejected before any state access',()=>{
  const r=spawnSync(process.execPath,[new URL('./dist/cli.mjs',import.meta.url).pathname,'run'],{env:{...process.env,ALISA_SWAGGER_MUTATION_LOCKED:''},encoding:'utf8',timeout:3000});assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'ALISA_SWAGGER_WATCH_FAILED');
});
