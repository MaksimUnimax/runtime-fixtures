import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,lstat,readdir,rename,unlink,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {acquireOfficialSource} from '../../../../tooling/api-watch/src/acquire.ts';
import {productionSourceRegistry} from '../../../../tooling/api-watch/src/source-registry.ts';
import {buildCompleteOperationInventory} from '../../../../tooling/api-watch/src/inventory.ts';
import {diffInventories,canonicalSemanticDiff} from '../../../../tooling/api-watch/src/diff.ts';

export const PRODUCT='alisa_market';
export const INTERVAL_MS=6*3600_000;
export const BLOCKED_RETRY_MS=24*3600_000;
export const STALE_MS=18*3600_000;
export const MAX_BYTES=25*1024*1024;
export const STATE_BUDGET=40*1024*1024;
export const DISK_RESERVE=3*1024**3;
const INDEX_LIMIT=1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const SAFE_FAILURES=new Set(['OPERATOR_SOURCE_REQUIRED','SOURCE_TEMPORARILY_UNAVAILABLE','SOURCE_URL_AUTHORITY_MISSING','INVALID_OFFICIAL_SOURCE_RESPONSE']);
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function documents(){
  return productionSourceRegistry.list().flatMap(entry=>entry.documents.map(document=>({
    family:entry.sourceFamily,key:document.documentKey,url:document.officialUrl,
    filename:document.officialUrl.split('?')[0].endsWith('.yaml')?'source.yaml':'source.json',entry,document,
  })));
}
function descriptor(key){const d=documents().find(d=>d.key===key);if(!d)throw Error('UNKNOWN_DOCUMENT');return d;}
async function directory(path,mode=0o700){
  await mkdir(path,{recursive:true,mode});const s=await lstat(path);
  if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o022)throw Error('UNTRUSTED_STATE_DIRECTORY');
}
export async function readBounded(path,limit=MAX_BYTES){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=await f.stat();if(!s.isFile()||s.size>limit)throw Error('INVALID_FILE');
    const b=Buffer.alloc(s.size+1);let n=0;
    while(n<b.length){const r=await f.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
    if(n!==s.size)throw Error('FILE_CHANGED');return b.subarray(0,n);
  }finally{await f.close();}
}
export async function initialize(root){
  await directory(root,0o755);
  for(const name of ['blobs','inventories','diffs'])await directory(join(root,name));
  await directory(join(root,'public'),0o755);
}
async function storageBytes(root){
  let n=0;
  for(const name of ['blobs','inventories','diffs'])for(const file of await readdir(join(root,name))){
    const s=await lstat(join(root,name,file));if(s.isSymbolicLink()||!s.isFile())throw Error('UNTRUSTED_ARTIFACT');n+=s.size;
  }
  return n;
}
async function reserve(root,size,{diskReserve=DISK_RESERVE,stateBudget=STATE_BUDGET}={}){
  const f=await statfs(root,{bigint:true});
  if(f.bavail*f.bsize<BigInt(diskReserve+size+INDEX_LIMIT))throw Error('DISK_RESERVE');
  if(await storageBytes(root)+size>stateBudget)throw Error('STATE_BUDGET');
}
async function atomic(path,bytes,mode=0o600){
  const temp=path+'.'+randomUUID()+'.tmp';let f;
  try{f=await open(temp,'wx',mode);await f.writeFile(bytes);await f.sync();await f.close();f=null;await rename(temp,path);}
  finally{if(f)await f.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function blob(root,folder,bytes,extension,options){
  if(bytes.length>MAX_BYTES)throw Error('ARTIFACT_TOO_LARGE');
  const sha=digest(bytes),name=sha+extension,path=join(root,folder,name);
  try{if(digest(await readBounded(path,MAX_BYTES))!==sha)throw Error('ARTIFACT_HASH_MISMATCH');return sha;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await reserve(root,bytes.length,options);
  // All mutators are serialized by the one native flock used by the service/CLI.
  await atomic(path,bytes);return sha;
}
async function jsonArtifact(root,folder,value,options){return blob(root,folder,Buffer.from(JSON.stringify(value)),'.json',options);}
export async function loadState(root){
  try{
    const d=JSON.parse(await readBounded(join(root,'state.json'),INDEX_LIMIT));
    if(d.schema_version!==1||d.product_id!==PRODUCT||!d.documents||Array.isArray(d.documents)||typeof d.documents!=='object')throw Error('STATE_SCHEMA');
    const keys=documents().map(x=>x.key);if(Object.keys(d.documents).some(k=>!keys.includes(k)))throw Error('STATE_DOCUMENT');
    for(const [key,r] of Object.entries(d.documents)){
      const spec=descriptor(key);
      if(r.key!==key||r.family!==spec.family||r.url!==spec.url)throw Error('STATE_DOCUMENT');
      for(const x of [r.current,r.candidate])if(x&&(!HASH.test(x.sha256)||!HASH.test(x.inventory_sha256)||!['AUTOMATIC_OFFICIAL','OWNER_SUPPLIED_REVIEWED','OWNER_SUPPLIED_CANDIDATE'].includes(x.origin)||!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>MAX_BYTES))throw Error('STATE_ARTIFACT');
      for(const field of ['last_attempt_at','last_automatic_success_at','next_attempt_at'])if(r[field]!==undefined&&!Number.isFinite(Date.parse(r[field])))throw Error('STATE_TIME');
    }
    return d;
  }catch(e){if(e.code!=='ENOENT')throw e;return {schema_version:1,product_id:PRODUCT,documents:{}};}
}
function row(state,d){return state.documents[d.key]??={key:d.key,family:d.family,url:d.url};}
export function canonicalProviderIdentity(root,expected){
  if(!expected)return true;
  const same=value=>{try{const u=new URL(value),v=new URL(expected);return u.protocol==='https:'&&u.origin===v.origin&&u.pathname===v.pathname&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
  if(typeof root.openapi==='string')return Array.isArray(root.servers)&&root.servers.length>0&&root.servers.every(s=>s&&typeof s.url==='string'&&same(s.url));
  if(root.swagger==='2.0')return typeof root.host==='string'&&Array.isArray(root.schemes)&&root.schemes.includes('https')&&(root.basePath??'/')==='/'&&same('https://'+root.host+'/');
  return false;
}
export function validateDocument(d,bytes){
  // API Watch performs full JSON/YAML OpenAPI parsing, root and reference
  // validation. Product services do not import the sibling server package.
  const inventory=buildCompleteOperationInventory({sourceFamily:d.family,documentKey:d.key,snapshotSha256:digest(bytes),bytes,filename:d.filename});
  let version=null;
  if(d.entry.requiredServerIdentity||d.entry.titlePattern){
    // Both Ozon registry documents are JSON. WB YAML remains parsed solely
    // by the existing API Watch implementation, without a second YAML stack.
    const root=JSON.parse(Buffer.from(bytes).toString('utf8'));version=root.openapi??root.swagger;
    if(!canonicalProviderIdentity(root,d.entry.requiredServerIdentity))throw Error('SOURCE_SERVER_IDENTITY_MISMATCH');
    if(d.entry.titlePattern&&!d.entry.titlePattern.test(root.info?.title??''))throw Error('SOURCE_TITLE_IDENTITY_MISMATCH');
  }
  return {inventory,version};
}
async function previousInventory(root,r){
  if(!r.current)return null;
  const b=await readBounded(join(root,'inventories',r.current.inventory_sha256+'.json'));
  if(digest(b)!==r.current.inventory_sha256)throw Error('ARTIFACT_HASH_MISMATCH');
  const raw=await readBounded(join(root,'blobs',r.current.sha256+(r.url.split('?')[0].endsWith('.yaml')?'.yaml':'.json')));
  if(digest(raw)!==r.current.sha256||raw.length!==r.current.bytes)throw Error('ARTIFACT_HASH_MISMATCH');
  const i=JSON.parse(b);if(i.sourceFamily!==r.family||i.snapshotSha256!==r.current.sha256||!Array.isArray(i.operations)||!i.operations.every(o=>o.documentKey===r.key&&o.sourceFamily===r.family&&o.snapshotSha256===r.current.sha256))throw Error('INVENTORY_CONTEXT');return i;
}
async function storeDocument(root,d,bytes,origin,now,options){
  const {inventory,version}=validateDocument(d,bytes);
  const sha256=await blob(root,'blobs',bytes,d.filename.endsWith('.yaml')?'.yaml':'.json',options);
  const inventory_sha256=await jsonArtifact(root,'inventories',inventory,options);
  return {sha256,inventory_sha256,bytes:bytes.length,version,operations:inventory.operationCount,origin,accepted_at:now.toISOString()};
}
export function publicStatus(state,now=new Date()){
  const docs=documents().map(d=>{
    const r=state.documents[d.key]??{},age=r.last_automatic_success_at?Math.max(0,now-Date.parse(r.last_automatic_success_at)):null;
    const fresh=age!==null&&age<=STALE_MS&&r.current?.origin==='AUTOMATIC_OFFICIAL';
    const lastGood=r.current?{sha256:r.current.sha256,bytes:r.current.bytes,operations:r.current.operations,origin:r.current.origin,accepted_at:r.current.accepted_at}:null;
    return {key:d.key,family:d.family,official_url:d.url,last_attempt_at:r.last_attempt_at??null,last_automatic_success_at:r.last_automatic_success_at??null,next_attempt_at:r.next_attempt_at??null,outcome:r.outcome??'NOT_CHECKED',http_status:r.http_status??null,fresh,automatic_age_seconds:age===null?null:Math.floor(age/1000),last_good:lastGood,candidate_pending:!!r.candidate,changes:r.changes??null};
  });
  const families=['OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES'].map(family=>{const rows=docs.filter(d=>d.family===family);return {family,expected_documents:rows.length,available_documents:rows.filter(d=>d.last_good).length,fresh_documents:rows.filter(d=>d.fresh).length,complete:rows.every(d=>d.fresh)};});
  const ready=docs.every(d=>d.fresh&&['UNCHANGED','CHANGED','INITIAL'].includes(d.outcome));
  return {schema_version:1,product_id:PRODUCT,scope:'PUBLIC_OPENAPI_DOCUMENTS_ONLY',generated_at:now.toISOString(),status:ready?'READY':'DEGRADED',interval_seconds:INTERVAL_MS/1000,llm_monitoring:false,provider_credentials_used:false,runtime_catalog_auto_update:false,families,documents:docs};
}
async function save(root,state,now,options){
  const raw=Buffer.from(JSON.stringify(state));if(raw.length>INDEX_LIMIT)throw Error('STATE_TOO_LARGE');
  const status=Buffer.from(JSON.stringify(publicStatus(state,now),null,2)+'\n');if(status.length>INDEX_LIMIT)throw Error('STATE_TOO_LARGE');
  // Artifact quota exhaustion must still be recorded. Reserve separate bounded
  // metadata space while preserving the same mandatory disk floor.
  await reserve(root,2*(raw.length+status.length),{...options,stateBudget:Number.MAX_SAFE_INTEGER});await atomic(join(root,'state.json'),raw);
  await atomic(join(root,'public','status.json'),status,0o644);
}
export async function runWatch(root,{acquire=acquireOfficialSource,now=()=>new Date(),force=false,...options}={}){
  await initialize(root);const state=await loadState(root);
  for(const d of documents()){
    const started=now(),r=row(state,d);
    if(!force&&r.next_attempt_at&&Date.parse(r.next_attempt_at)>started.valueOf())continue;
    r.last_attempt_at=started.toISOString();delete r.http_status;
    try{
      // The shared OAS3 check compares URL strings literally (:443 differs).
      // Alisa applies the same pinned identity with URL normalization below,
      // while retaining the common TLS/DNS/host/size/parser/title guards.
      const result=await acquire({entry:{...d.entry,requiredServerIdentity:undefined},document:d.document});
      if(result.kind==='ACQUIRED_OFFICIAL_SOURCE_CANDIDATE'){
        if(result.sourceFamily!==d.family||result.officialUrl!==d.url||result.documentKey&&result.documentKey!==d.key||result.sha256!==digest(result.bytes)||result.sizeBytes!==result.bytes.length)throw Error('ACQUISITION_CONTEXT');
        const previous=await previousInventory(root,r),current=await storeDocument(root,d,result.bytes,'AUTOMATIC_OFFICIAL',now(),options);
        const inventory=validateDocument(d,result.bytes).inventory;
        if(previous){
          const diff=diffInventories({base:previous,target:inventory,createdAt:now()});
          const changed=diff.operations.filter(o=>o.state!=='UNCHANGED');
          const diff_sha256=current.sha256===r.current.sha256?null:await blob(root,'diffs',Buffer.from(canonicalSemanticDiff(diff)),'.json',options);
          r.changes={diff_sha256,added:changed.filter(o=>o.state==='ADDED').length,removed:changed.filter(o=>o.state==='REMOVED').length,changed:changed.filter(o=>o.state==='CHANGED').length};
          r.outcome=changed.length?'CHANGED':'UNCHANGED';
        }else{r.changes=null;r.outcome='INITIAL';}
        r.current=current;r.last_automatic_success_at=now().toISOString();
        if(r.candidate?.sha256===current.sha256)delete r.candidate;
        r.next_attempt_at=new Date(started.valueOf()+INTERVAL_MS).toISOString();
      }else{
        r.outcome=SAFE_FAILURES.has(result.kind)?result.kind:'WATCH_FAILED';
        if(Number.isInteger(result.httpStatus)&&result.httpStatus>=100&&result.httpStatus<600)r.http_status=result.httpStatus;
        const delay=result.kind==='OPERATOR_SOURCE_REQUIRED'?BLOCKED_RETRY_MS:INTERVAL_MS;
        const retry=Number.isFinite(result.retryAfterSeconds)?Math.min(7*86400_000,Math.max(delay,result.retryAfterSeconds*1000)):delay;
        r.next_attempt_at=new Date(started.valueOf()+retry).toISOString();
      }
    }catch(e){
      r.outcome=['DISK_RESERVE','STATE_BUDGET','SOURCE_SERVER_IDENTITY_MISMATCH','SOURCE_TITLE_IDENTITY_MISMATCH','ARTIFACT_HASH_MISMATCH','ACQUISITION_CONTEXT','INVENTORY_CONTEXT'].includes(e.message)?e.message:'INVALID_DOCUMENT';
      r.next_attempt_at=new Date(started.valueOf()+INTERVAL_MS).toISOString();
    }
    await save(root,state,now(),options);
  }
  await save(root,state,now(),options);return publicStatus(state,now());
}
export async function importCandidate(root,key,bytes,{now=new Date(),...options}={}){
  await initialize(root);const state=await loadState(root),d=descriptor(key),r=row(state,d);
  r.candidate=await storeDocument(root,d,bytes,'OWNER_SUPPLIED_CANDIDATE',now,options);
  await save(root,state,now,options);return r.candidate;
}
export async function acceptReviewed(root,key,sha256,{now=new Date(),...options}={}){
  if(!HASH.test(sha256))throw Error('INVALID_DIGEST');
  const state=await loadState(root),d=descriptor(key),r=row(state,d);
  if(!r.candidate||r.candidate.sha256!==sha256)throw Error('REVIEW_CONTEXT');
  const bytes=await readBounded(join(root,'blobs',sha256+(d.filename.endsWith('.yaml')?'.yaml':'.json')));
  if(digest(bytes)!==sha256)throw Error('ARTIFACT_HASH_MISMATCH');validateDocument(d,bytes);
  // Review accepts supplied documentation, never invents a successful fetch.
  r.current={...r.candidate,origin:'OWNER_SUPPLIED_REVIEWED',accepted_at:now.toISOString()};delete r.candidate;
  await save(root,state,now,options);return publicStatus(state,now);
}
