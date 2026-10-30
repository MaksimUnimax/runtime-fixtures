"""Actual Chromium storage + unchanged recovery/queue consumers, synthetic data.
The isolated MV3 extension has only storage permission, no host permissions and
no existing browser/profile. Every assertion is captured; failure stays nonzero.
"""
from pathlib import Path
import argparse,asyncio,hashlib,json,tempfile,datetime,os,sys
from playwright.async_api import async_playwright
SOURCES={
 'provider-outcome.js':'packages/bridge-core/src/execution/provider-outcome.js',
 'result-recovery.js':'packages/bridge-core/src/execution/result-recovery.js',
 'batch-queue.js':'packages/bridge-core/src/execution/batch-queue.js',
}
PROBE=r'''globalThis.runProbe=async()=>{
 const R=SellerAgentsResultRecovery,O=SellerAgentsProviderOutcome;
 const record=SellerAgentsBatchQueue.create({}).__storageTestRecord;
 const rows=[];const clone=x=>JSON.parse(JSON.stringify(x));
 const assert=(condition,message)=>{if(!condition)throw new Error(message)};
 const test=async(id,fn)=>{try{const details=await fn();rows.push({id,status:'PASS',details:details||null})}catch(e){rows.push({id,status:'FAIL',error:e.code||e.message})}};
 const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const roundtrip=async x=>{await chrome.storage.local.set({test_value:x});return (await chrome.storage.local.get('test_value')).test_value};
 const initialContext={storeId:'s',accountId:'a',conversationKey:'c',marketplace:'wildberries',bindingId:'b',bindingRevision:3,workSessionId:'ws',workGeneration:1,credentialRevision:'cr',grantEpoch:4,aiSurface:'chatgpt',aiProfile:'p'};
 const attempt=O.markResponseReceived(O.createIntent({provider_attempt_id:'p1',logical_execution_id:'op:0',execution_id:'op',command_index:0,account:'a',conversation:'c',store:'s',binding:'b',binding_revision:3,marketplace:'wildberries',work_generation:'ws',credential_revision:'cr',operation:'read'}),{ok:true,httpStatus:200,external_request_executed:true});
 const owner={operation_id:'op',status:'collecting',payload_expires_at_ms:Date.now()+600000,execution_context:initialContext,batch:{entries:[{status:'requesting',provider_attempt_id:'p1',provider_attempt:attempt,command_index:0}],next_index:0,request_state:'requesting',request_worker_session_id:'worker'}};
 const rawReport='  EXACT\r\nЮникод 😀 नमस्ते\nEND  ';
 const input={ok:true,request_id:'request',operation:'read',http_status:200,external_request_executed:true,report_text:rawReport,result:JSON.parse('{"z":1,"a":2,"__proto__":{"safe":"data"},"array":[3,1,null,{"z":2,"a":1}]}'),context:initialContext,logical_execution_id:'op:0',provider_attempt_id:'p1',execution_id:'op',command_index:0,expires_at_ms:owner.payload_expires_at_ms};
 const buffer=await R.createBuffer(input),stored=await roundtrip(buffer);
 await test('native-object-order-really-changed',async()=>{assert(JSON.stringify(Object.keys(buffer.payload))!==JSON.stringify(Object.keys(stored.payload)),'fixture must cross real storage object reordering');return {before:Object.keys(buffer.payload),after:Object.keys(stored.payload)}});
 await test('exact-full-report-roundtrip',async()=>{assert(stored.payload.report_text===rawReport,'all report code units must be retained');assert(R.structuralSnapshot(stored.payload.result.array)===R.structuralSnapshot(input.result.array),'array positions/values, ignoring object-key order only');assert(Object.hasOwn(stored.payload.result,'__proto__'),'own JSON key');assert(stored.payload.result.__proto__.safe==='data'&&!Object.prototype.safe,'prototype untouched')});
 await test('version3-stable-digest-roundtrip',async()=>{assert(stored.integrity.version===3,'version');assert(stored.integrity.serialization_policy==='json-object-keys-v1','format');assert((await R.validateBuffer(stored)).valid,'native roundtrip must validate')});
 await test('native-known-result-resumes-without-provider',async()=>{const d=await R.recoveryDecision({providerAttempt:attempt,resultBuffer:stored,currentContext:initialContext});assert(d.code==='KNOWN_RESULT_RECOVERY_SAFE'&&d.provider_calls===0,'validated recovery');assert(JSON.parse(d.integrity_snapshot).payload.report_text===rawReport,'verified snapshot report exact')});
 await test('stable-snapshot-only-key-order-insensitive',async()=>{const a={b:2,a:{d:4,c:3}},b={a:{c:3,d:4},b:2};assert(R.structuralSnapshot(a)===R.structuralSnapshot(b),'object order');assert(R.structuralSnapshot([a,7])!==R.structuralSnapshot([7,a]),'array order');assert(R.structuralSnapshot({a:'1'})!==R.structuralSnapshot({a:1}),'type');assert(R.structuralSnapshot({a:null})!==R.structuralSnapshot({}),'presence');assert(R.structuralSnapshot({s:'\r\n'})!==R.structuralSnapshot({s:'\n'}),'text bytes');assert(R.structuralSnapshot({'10':1,'2':2})===R.structuralSnapshot({'2':2,'10':1}),'numeric ownkeys')});
 await test('verified-snapshot-roundtrip-match',async()=>{const v=await R.validateBuffer(buffer);assert(v.valid&&R.matchesValidatedSnapshot(stored,v.snapshot),'same value storage snapshot');const changed=clone(stored);changed.payload.result.array.reverse();assert(!R.matchesValidatedSnapshot(changed,v.snapshot),'changed values must fail');assert(!R.matchesValidatedSnapshot(stored,'not-json'),'malformed snapshot')});
 for(const [id,mutate] of [
  ['report-byte',x=>x.payload.report_text+='!'],['result-value',x=>x.payload.result.z=3],
  ['result-type',x=>x.payload.result.z='1'],['array-order',x=>x.payload.result.array.reverse()],
  ['nested-value',x=>x.payload.result.array[3].a=9],['missing-field',x=>delete x.payload.result.z],
  ['extra-field',x=>x.payload.result.extra=true],['payload-hash',x=>x.integrity.payload_sha256='0'.repeat(64)],
  ['report-hash',x=>x.integrity.report_text_sha256='0'.repeat(64)],['byte-length',x=>x.integrity.report_text_bytes++],
  ['policy-missing',x=>delete x.integrity.serialization_policy],['policy-unknown',x=>x.integrity.serialization_policy='untrusted'],
  ['provenance-missing',x=>delete x.integrity.sanitization_policy],['version-unknown',x=>x.integrity.version=99],
  ['legacy-v1',x=>x.integrity.version=1],['sensitive-key',x=>x.payload.result.api_key='test-only'],
 ])await test('tamper-'+id,async()=>{assert((await R.validateBuffer(stored)).valid,'untampered control must validate');const x=clone(stored);mutate(x);assert(!(await R.validateBuffer(x)).valid,'must reject '+id)});
 await test('native-invalid-utf16-loss-fails-closed',async()=>{
  const malformed=await R.createBuffer({...input,report_text:'prefix '+String.fromCharCode(0xd800)+' suffix'});
  assert((await R.validateBuffer(malformed)).valid,'valid initial integrity before storage');
  const after=await roundtrip(malformed);
  assert(after.payload.report_text!==malformed.payload.report_text,'Chromium replaces unpaired UTF16, unlike normal valid Unicode');
  assert(!(await R.validateBuffer(after)).valid,'lossy text conversion is corruption, never a usable full report');
 });
 await test('unchanged-privacy-safe-v2-still-validates-legacy-digest',async()=>{
  const legacy=clone(buffer);legacy.integrity.version=2;delete legacy.integrity.serialization_policy;
  const payload=JSON.stringify(legacy.payload);legacy.integrity.payload_bytes=new TextEncoder().encode(payload).byteLength;legacy.integrity.payload_sha256=await digest(payload);
  assert((await R.validateBuffer(legacy)).valid,'old exact hash preserved');
  const legacyStored=await roundtrip(legacy);assert(!(await R.validateBuffer(legacyStored)).valid,'old changed digest must not be silently reinterpreted as v3');
  assert(legacyStored.payload.report_text===legacy.payload.report_text,'same report does not waive old payload digest');
 });
 await test('credential-reflected-in-report-never-saved',async()=>{
  const x=await R.createBuffer({...input,report_text:'prefix SYNTHETIC_SECRET suffix',result:{api_key:'SYNTHETIC_SECRET',data:42}});
  assert(x.phase==='UNAVAILABLE'&&x.unavailable_code==='RESULT_BUFFER_SENSITIVE_REPORT'&&!Object.hasOwn(x,'payload'),'no partial/redacted success');assert(x.provider_replay_forbidden&&x.delivery_replay_forbidden,'no replay')
 });
 for(const [id,extra,code] of [
  ['expired',{now:owner.payload_expires_at_ms+1},'RESULT_BUFFER_EXPIRED'],
  ['finish',{finish:true},'STALE_DELIVERY_CONTEXT'],
  ['unknown-provider',{providerAttempt:{state:'OUTCOME_UNKNOWN'}},'PROVIDER_OUTCOME_UNKNOWN_NO_RETRY'],
  ['unknown-send',{deliveryOutcome:R.DELIVERY_OUTCOMES.UNKNOWN},'DELIVERY_OUTCOME_UNKNOWN_NO_RETRY'],
  ['foreign-attempt',{providerAttempt:{...attempt,provider_attempt_id:'p2'}},'RESULT_BUFFER_ATTEMPT_MISMATCH'],
  ['foreign-store',{currentContext:{...initialContext,storeId:'s2'}},'STALE_DELIVERY_CONTEXT'],
  ['foreign-account',{currentContext:{...initialContext,accountId:'a2'}},'STALE_DELIVERY_CONTEXT'],
 ])await test('recovery-'+id,async()=>{const d=await R.recoveryDecision({providerAttempt:attempt,resultBuffer:stored,currentContext:initialContext,...extra});assert(d.type==='blocked'&&d.code===code,'fence '+id+': '+d.code)});
 const mutationCases=[['same',null],
  ...['accountId','storeId','credentialRevision','grantEpoch','workGeneration','workSessionId','bindingRevision','aiProfile','conversationKey'].map(key=>['context-'+key,x=>{x.execution_context[key]=String(x.execution_context[key])+'-changed'}]),
  ['owner-operation',x=>x.operation_id='other'],['not-collecting',x=>x.status='completed'],
  ['next-index',x=>x.batch.next_index=1],['request-state',x=>x.batch.request_state='idle'],['worker',x=>x.batch.request_worker_session_id='other'],
  ['expiry',x=>x.payload_expires_at_ms++],['entry-state',x=>x.batch.entries[0].status='complete'],
  ['attempt-id',x=>x.batch.entries[0].provider_attempt_id='other'],['attempt-state',x=>x.batch.entries[0].provider_attempt.state='OUTCOME_UNKNOWN'],
  ['attempt-metadata',x=>x.batch.entries[0].provider_attempt.response.http_status=201],['command-index',x=>x.batch.entries[0].command_index=1],
  ['query-group',x=>x.batch.entries[0].query_group_id='other'],['old-buffer-added',x=>x.batch.entries[0].result_buffer={phase:'BUFFERED'}],
 ];
 for(const [id,mutate] of mutationCases)await test('native-queue-'+id,async()=>{
  await chrome.storage.local.set({test_owner:owner});let mutations=0;
  const mutateOwner=async fn=>{const current=(await chrome.storage.local.get('test_owner')).test_owner;if(mutate){mutate(current);mutations++}const next=await fn(current);await chrome.storage.local.set({test_owner:next});return next};
  let error=null;try{await record({owner:clone(owner),indexes:[0],mutateOwner,ownerMatches:x=>x.operation_id===owner.operation_id,isCollecting:x=>x.status==='collecting',providerAttemptId:'p1',providerResult:input})}catch(e){error=e.code||e.message}
  const after=(await chrome.storage.local.get('test_owner')).test_owner;
  if(mutate)assert(error==='RESULT_BUFFER_STORE_FAILED'&&mutations===1,'changed owner must reject, got '+error);
  else {assert(!error&&after.batch.entries[0].result_buffer,'native store allowed');assert((await R.validateBuffer(after.batch.entries[0].result_buffer)).valid,'persisted buffer valid');assert(after.batch.entries[0].result_buffer.payload.report_text===rawReport,'full bytes')}
  return {error,mutations,bufferWritten:!error};
 });
 await chrome.storage.local.remove(['test_value','test_owner']);
 return {rows,sourceNetworkRequests:0,credentialValuesUsed:false};
};'''
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def get_modules(root):
 if (root/SOURCES['result-recovery.js']).exists():return {name:(root/p).read_text() for name,p in SOURCES.items()}
 worker=(root/'service_worker.js').read_text();found={}
 markers={'result-recovery.js':'  // Result recovery is deliberately a separate journal dimension from the','provider-outcome.js':'  const STATES = Object.freeze({','batch-queue.js':'  function create(ports) {'}
 for name,marker in markers.items():
  if worker.count(marker)!=1:raise ValueError('Module marker not unique: '+name)
  pos=worker.index(marker);start=worker.rfind('(() => {',0,pos);end=worker.index('\n})();',pos)+len('\n})();');found[name]=worker[start:end]+'\n'
 return found
async def main(args):
 os.umask(0o077);root=Path(args.runtime).resolve();out=Path(args.output).resolve();out.parent.mkdir(parents=True,exist_ok=True)
 if out.exists():raise RuntimeError('Inspect previous result; no duplicate invocation')
 modules=get_modules(root);queue=modules['batch-queue.js'];anchor='    return Object.freeze({ process });'
 if queue.count(anchor)!=1:raise ValueError('Exact private export anchor missing')
 instrumented=queue.replace(anchor,'    return Object.freeze({ process, __storageTestRecord:recordResultBuffer });')
 record={'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'level':'NATIVE_CHROME_STORAGE_SYNTHETIC_DATA_REAL_PRODUCT_FUNCTIONS','test_sha256':sha(Path(__file__)),'inputs':{n:hashlib.sha256(x.encode()).hexdigest() for n,x in modules.items()},'live_profile_access':False}
 with tempfile.TemporaryDirectory(prefix='octoport-storage-contract-') as directory:
  temp=Path(directory);ext=temp/'extension';ext.mkdir()
  (ext/'manifest.json').write_text(json.dumps({'manifest_version':3,'name':'Octoport isolated storage contract','version':'1.0','permissions':['storage'],'background':{'service_worker':'test.js'}}))
  for name,text in modules.items():(ext/name).write_text(instrumented if name=='batch-queue.js' else text)
  (ext/'test.js').write_text("importScripts('provider-outcome.js','result-recovery.js','batch-queue.js');\n"+PROBE)
  async with async_playwright() as p:
   opts={'channel':'chromium','headless':True,'args':['--no-sandbox','--disable-extensions-except='+str(ext),'--load-extension='+str(ext)]}
   if args.browser:opts['executable_path']=args.browser;opts.pop('channel')
   context=await p.chromium.launch_persistent_context(str(temp/'profile'),**opts)
   try:
    worker=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker',timeout=15000)
    record['browser']=context.browser.version;record['result']=await asyncio.wait_for(worker.evaluate('()=>runProbe()'),timeout=45)
   finally:await context.close()
 record['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();rows=record['result']['rows'];record['summary']={s:sum(x['status']==s for x in rows) for s in ['PASS','FAIL']}
 out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'summary':record['summary'],'failed':[x for x in rows if x['status']!='PASS'],'sha256':sha(out)}),flush=True)
 return 0 if all(x['status']=='PASS' for x in rows) else 1
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--runtime',required=True);p.add_argument('--output',required=True);p.add_argument('--browser');sys.exit(asyncio.run(main(p.parse_args())))
