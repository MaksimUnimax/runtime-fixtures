/* Offline F05: source/packaged guard and the actual composed frozen port consumer.
 * Only storage, IDB, capabilities and server admission are synthetic. No browser,
 * user data, credentials, provider request, Send or installed change is involved.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node 24; production source is never rewritten for an older parser');

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, i, all) => {
  if (i % 2 === 0) rows.push([value, all[i + 1]]); return rows;
}, []));
assert.ok(args['--runtime'] && args['--output']);
const runtime = path.resolve(args['--runtime']);
const output = path.resolve(args['--output']);
assert.ok(!fs.existsSync(output), 'Inspect existing result; never overwrite a prior run');
const hash = value => createHash('sha256').update(value).digest('hex');
const files = new Map();
function read(name) { const bytes = fs.readFileSync(path.join(runtime, name)); files.set(name, bytes); return bytes.toString('utf8'); }
const identity = read('shared/conversation_identity.js');
const bundle = read('service_worker.js');
const start = bundle.indexOf('function normalizeIdentity(identity) {');
const end = bundle.indexOf('\nfunction conversationKeyFromIdentity(', start);
assert.ok(start >= 0 && end > start);
const normalize = bundle.slice(start, end);
function moduleAt(marker) {
  const at = bundle.indexOf(marker), first = bundle.lastIndexOf('(() => {', at), last = bundle.indexOf('\n})();', at);
  assert.ok(at >= 0 && first >= 0 && last > at, marker);
  return bundle.slice(first, last + '\n})();'.length);
}
const recovery = moduleAt('const SCHEMA_VERSION = 2;');
const outcome = moduleAt('const STATES = Object.freeze({');
const guardPath = args['--guard'] ? path.resolve(args['--guard']) : path.join(runtime, 'shared/attachment_result_integrity.js');
const guard = fs.readFileSync(guardPath, 'utf8');
const autorun = read('shared/bridge_autorun_model.js');
const policy = read('shared/file_delivery_model_policy.js');
const worker = read('shared/file_delivery_port_worker.js');
assert.ok(worker.includes('const identity = normalizeIdentity(value);'), 'Use composed worker, not the unpatched frozen donor');
const report = { started_at: new Date().toISOString(), level: 'OFFLINE_ACTUAL_ASSEMBLED_WORKER_IDENTITY_MATRIX',
  guard_mode: args['--guard'] ? 'SOURCE_WITH_IDENTICAL_ASSEMBLED_DEPENDENCIES' : 'EXTRACTED_PACKAGE',
  guard_sha256: hash(guard), inputs: Object.fromEntries([...files].map(([k,v]) => [k,hash(v)])),
  test_sha256: hash(fs.readFileSync(new URL(import.meta.url))), external_provider_calls: 0, installed_acceptance: false, cases: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
fs.mkdirSync(path.dirname(output), { recursive: true });
const storage = new Map(), artifacts = new Map(), listeners = [];
const MANUAL='test_manual', AUTO='test_auto';
let activeAccount='account-a', authChecks=0, providerCalls=0;
function idbRequest(value, tx) { const q={}; queueMicrotask(()=>{q.result=value;q.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());}); return q; }
const indexedDB={open(){const q={};const db={objectStoreNames:{contains:()=>true},createObjectStore(){},close(){},transaction(){const tx={objectStore(){return {
 get:key=>idbRequest(structuredClone(artifacts.get(key)),tx),getAll:()=>idbRequest([...artifacts.values()].map(x=>structuredClone(x)),tx),
 put:value=>{artifacts.set(value.artifact_key,structuredClone(value));return idbRequest(value.artifact_key,tx);},
 delete:key=>{artifacts.delete(key);return idbRequest(undefined,tx);}
};}};return tx;}};q.result=db;queueMicrotask(()=>{q.onupgradeneeded?.();q.onsuccess?.();});return q;}};
const chrome={runtime:{onConnect:{addListener:fn=>listeners.push(fn)}},storage:{local:{
 async get(k){return {[k]:structuredClone(storage.get(k)||{})};},
 async set(values){for(const [k,v] of Object.entries(values))storage.set(k,structuredClone(v));}
}}};
const context=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,structuredClone,indexedDB,chrome,
 OzonRuntime:{STORAGE_KEYS:{MANUAL_OPERATIONS:MANUAL,AUTO_RUNS:AUTO}},ProviderTransportCore:{},
 OzonAIDeliveryCapabilities:{adapterIdForOrigin:()=> 'chatgpt',unicodeLength:s=>[...s].length,utf8ByteLength:s=>Buffer.byteLength(s),
 profile:()=>({status:'implemented',attachment_strategy:'file_input_v1',max_files_per_turn:10}),fileDispatchDecision:()=>({dispatch_allowed:true})},
 setTimeout:()=>0,clearTimeout:()=>{},fetch:()=>{providerCalls++;throw new Error('EXTERNAL_REQUEST_FORBIDDEN');}});
context.globalThis=context;
for(const [label,code] of [['identity',identity],['actual normalizer',normalize+'\nglobalThis.normalizeIdentity=normalizeIdentity;'],['recovery',recovery],['outcome',outcome],['F05 prelude',guard],['autorun',autorun],['policy',policy],['actual packaged worker',worker],['F05 postload',guard]])vm.runInContext(code,context,{filename:label});
assert.equal(listeners.length,2,'Guard install stays idempotent');
context.saEnabled=async()=>true;
context.getManualOperation=async key=>structuredClone(storage.get(MANUAL)?.[key]||null);
context.saAssertDeliveryOwner=async owner=>{authChecks++;if(owner?.execution_context?.accountId!==activeAccount)throw Object.assign(new Error('Synthetic account admission rejected'),{code:'SYNTHETIC_ACCOUNT_DENIED'});};
context.mutateManualOperation=async(key,fn)=>{const map=storage.get(MANUAL)||{};const next=await fn(structuredClone(map[key]));map[key]=structuredClone(next);storage.set(MANUAL,map);return structuredClone(next);};
function port(sender){const callbacks=[],p={name:'ozon-attachment-delivery-v1',sender,onMessage:{addListener:fn=>callbacks.push(fn)},disconnect(){this.closed=true;},postMessage(){}};for(const fn of listeners)fn(p);return {p,callbacks};}
async function send(sender,message){const {p,callbacks}=port(sender);let timer;
 return new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('NO_RESPONSE')),1500);p.postMessage=v=>{if(v.request_id===message.request_id){clearTimeout(timer);resolve(v.response);}};for(const fn of callbacks)fn(message);});}
const classes={UUID:'00000000-0000-4000-8000-000000000005',LOCAL:'local:confirmed-surface-01',REF:'ref:73796e746865746963'};
const operations={COMMIT:['OZ_ATTACHMENT_COMMIT','attachment_claimed'],SEND:['OZ_ATTACHMENT_SEND_COMMIT','attachment_ready'],META:['OZ_ATTACHMENT_ARTIFACT_META','attachment_ready'],CHUNK:['OZ_ATTACHMENT_ARTIFACT_CHUNK','attachment_ready']};
const body='OWNED COMPLETE REPORT\r\nТест 😀\nEND\n',bytes=Buffer.from(body);
const descriptor={artifact_key:'fixture-artifact',source_kind:'generated_bridge_text',filename:'test.txt',mime_type:'text/plain;charset=utf-8',extension:'txt',byte_length:bytes.length,unicode_char_length:[...body].length,sha256:hash(bytes),complete:true};
async function scenario(kind,op,version,variant='valid',ownerKind='manual'){
 storage.clear();artifacts.clear();activeAccount='account-a';authChecks=0;
 const id=classes[kind],key='chatgpt:'+id,origin='https://chatgpt.com',ownerId='own-operation',deliveryId='own-delivery';
 const exec={accountId:'account-a',conversationKey:key,marketplace:'ozon',storeId:'own-store',bindingId:'own-binding',bindingRevision:1,workSessionId:'own-session',workGeneration:'own-generation'};
 const api=context.SellerAgentsResultRecovery;let buffer;
 if(version==='legacy')buffer={schema_version:1,phase:'BUFFERED',provider_replay_forbidden:true,payload:{report_text:'old incomplete',result:{value:1}}};
 else{
  buffer=structuredClone(await api.createBuffer({logical_execution_id:'logical',provider_attempt_id:'attempt',execution_id:'execution',command_index:0,context:exec,report_text:body,result:{value:42},ok:true,request_id:'request',operation:'seller_info',http_status:200}));
  if(version==='v2'){
   buffer.integrity.version=2;delete buffer.integrity.serialization_policy;
   const payload=JSON.stringify(buffer.payload);buffer.integrity.payload_bytes=Buffer.byteLength(payload);buffer.integrity.payload_sha256=hash(payload);
  }
  assert.equal((await api.validateBuffer(buffer)).valid,true,'Every positive buffer must first pass its actual v2/v3 integrity rule');
 }
 const [type,phase]=operations[op];
 const owner={conversation_key:key,conversation_id:id,origin,tab_id:22,status:'delivering',operation_id:ownerId,run_id:ownerId,execution_context:exec,payload_expires_at_ms:Date.now()+600000,
  batch:{entries:[{kind:'command',status:'complete',result_phase:'MATERIALIZED',provider_attempt_id:'attempt',provider_attempt:{state:'COMPLETED_KNOWN',provider_attempt_id:'attempt'},result_buffer:buffer}]},
  delivery:{delivery_id:deliveryId,mode:'attachment_watch_v1',phase,adapter_id:'chatgpt',artifact_text:body,payload_expires_at_ms:Date.now()+600000,generated_text_document:{artifact_id:'fixture-generated',filename:'test.txt',unicode_char_length:[...body].length,byte_length:bytes.length,complete:true},provider_file_refs:[],artifact_descriptors:[descriptor],outgoing_text:'owned marker'}};
 const sender={tab:{id:22,url:origin+'/'},url:origin+'/'};
 const message={type,request_id:'request-'+report.cases.length,conversation_key:key,owner_kind:ownerKind,owner_id:ownerId,delivery_id:deliveryId,actor_id:'own-actor',live_owner:{origin,conversation_id:id},artifact_key:descriptor.artifact_key,offset:0,length:bytes.length};
 const errors={tab:'ATTACHMENT_NON_OWNER_TAB',origin:'ATTACHMENT_ORIGIN_MISMATCH',conversation:'ATTACHMENT_CONVERSATION_MISMATCH',delivery:'ATTACHMENT_DELIVERY_ID_MISMATCH',owner:'ATTACHMENT_DELIVERY_NOT_FOUND',key:'ATTACHMENT_DELIVERY_NOT_FOUND',missing_live:'ATTACHMENT_LIVE_OWNER_REQUIRED',unknown_live:'ATTACHMENT_LIVE_OWNER_REQUIRED',conflict_live:'ATTACHMENT_LIVE_OWNER_REQUIRED',wrong_ai:'ATTACHMENT_LIVE_OWNER_REQUIRED',account:'SYNTHETIC_ACCOUNT_DENIED',missing_owner:'ATTACHMENT_DELIVERY_NOT_FOUND'};
 if(variant==='tab')sender.tab.id=23;
 if(variant==='origin')sender.url='https://foreign.example/';
 if(variant==='conversation')message.live_owner.conversation_id='local:other';
 if(variant==='delivery')message.delivery_id='foreign-delivery';
 if(variant==='owner')message.owner_id='foreign-owner';
 if(variant==='key')message.conversation_key='chatgpt:foreign';
 if(variant==='missing_live')delete message.live_owner;
 if(variant==='unknown_live')message.live_owner.status='unknown';
 if(variant==='conflict_live')message.live_owner.status='conflict';
 if(variant==='wrong_ai')message.live_owner.ai_id='alice';
 if(variant==='account')activeAccount='account-other';
 if(variant==='already_attach')owner.delivery.phase='attachment_committed';
 if(variant==='already_send')owner.delivery.phase='attachment_send_committed';
 if(variant==='unknown_provider')owner.batch.entries[0].provider_attempt.state='OUTCOME_UNKNOWN';
 const storageKey=ownerKind==='manual'?MANUAL:AUTO;storage.set(storageKey,variant==='missing_owner'?{}:{[key]:owner});
 artifacts.set(descriptor.artifact_key,{...descriptor,bytes:Uint8Array.from(bytes).buffer,created_at_ms:Date.now()-1000,expires_at_ms:Date.now()+600000});
 const before=JSON.stringify([...storage]),artifactBefore=JSON.stringify([...artifacts]);
 const response=await send(sender,message);
 let expectation;
 if(errors[variant]){
  assert.equal(response.code,errors[variant],'Authority rejection must retain the original consumer code, never disclose legacy state');
  expectation='ORIGINAL_AUTHORITY_DENIAL';
 }else if(variant==='already_attach'){
  assert.equal(response.code,'ATTACH_OUTCOME_UNKNOWN_NO_RETRY');assert.equal(response.attach_allowed,false);expectation='NO_ATTACH_REPLAY';
 }else if(variant==='already_send'){
  assert.equal(response.click_allowed,false);assert.equal(response.already_committed,true);expectation='NO_SEND_REPLAY';
 }else if(version==='legacy'){
  assert.equal(response.code,'RESULT_BUFFER_INTEGRITY_UNVERIFIABLE','Every supported matched identity must deny the known legacy result');
  assert.equal(response.ok,false);assert.equal(response.click_allowed,undefined);assert.equal(response.attach_allowed,undefined);assert.equal(response.descriptors,undefined);assert.equal(response.chunk_base64,undefined);expectation='LEGACY_DENIED';
 }else{
  assert.equal(response.ok,true,JSON.stringify(response));
  if(op==='COMMIT')assert.equal(response.attach_allowed,true);
  if(op==='SEND')assert.equal(response.click_allowed,true);
  if(op==='META')assert.equal(response.descriptors[0].sha256,descriptor.sha256);
  if(op==='CHUNK')assert.deepEqual(Buffer.from(response.chunk_base64,'base64'),bytes);
  assert.ok(authChecks>0,'Actual frozen consumer rechecks synthetic server admission');expectation='VERIFIED_CURRENT_RESULT_ALLOWED';
 }
 if(expectation!=='VERIFIED_CURRENT_RESULT_ALLOWED'){
  assert.equal(JSON.stringify([...storage]),before,'Denial/committed replay must not mutate any owner or phase');
  assert.equal(JSON.stringify([...artifacts]),artifactBefore,'Denied artifact request must not materialize or disclose new data');
 }
 assert.equal(providerCalls,0);
 return {expectation,code:response.code||null,click_allowed:response.click_allowed??null,attach_allowed:response.attach_allowed??null,admission_checks:authChecks};
}
const cases=[];
for(const kind of Object.keys(classes))for(const op of Object.keys(operations)){
 for(const ownerKind of ['manual','autorun'])cases.push([kind,op,'legacy','valid',ownerKind]);
 for(const version of ['v2','v3'])cases.push([kind,op,version,'valid','manual']);
 for(const variant of ['tab','origin','conversation','delivery','owner','key','missing_live','unknown_live','conflict_live','wrong_ai','account','missing_owner'])cases.push([kind,op,'legacy',variant,'manual']);
}
for(const kind of Object.keys(classes)){
 cases.push([kind,'COMMIT','legacy','already_attach','manual']);
 cases.push([kind,'SEND','legacy','already_send','manual']);
}
for(const input of cases){const row={id:input.join('/'),status:'NOT_RUN'};
 try{row.actual=await scenario(...input);row.status='PASS';}catch(error){row.status='FAIL';row.error=String(error.message).slice(0,1200);}
 report.cases.push(row);
}
report.finished_at=new Date().toISOString();report.summary={PASS:report.cases.filter(x=>x.status==='PASS').length,FAIL:report.cases.filter(x=>x.status==='FAIL').length};
report.source_unchanged=hash(fs.readFileSync(guardPath))===report.guard_sha256&&[...files].every(([k,b])=>hash(fs.readFileSync(path.join(runtime,k)))===hash(b));
assert.ok(report.source_unchanged);save();console.log(JSON.stringify({summary:report.summary,failed:report.cases.filter(x=>x.status==='FAIL'),output,sha256:hash(fs.readFileSync(output))}));process.exitCode=report.summary.FAIL?1:0;
