import {gunzipSync} from 'node:zlib';
import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import path from 'node:path';import {fileURLToPath}from'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));const d=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,'donor.json.gz'))).toString('utf8'));
const ctx=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,crypto:crypto.webcrypto,console:{log(){},warn(){},error(){}}});
for(const[n,h]of Object.entries(d.inventory.source.hashes)){const text=d.files[n];if(crypto.createHash('sha256').update(text).digest('hex')!==h)throw Error('DONOR_HASH');vm.runInContext(text,ctx,{filename:n,timeout:3000});}
const rows=[];
for(const platform of ['ozon','wb'])for(const[operation,meta]of Object.entries(d.inventory[platform].operations)){
 const policy=meta.execution_enabled!==true?'DONOR_DISABLED':meta.privacy_policy==='operator_personal_data_gate'||meta.privacy==='blocked_pii'?'PERSONAL_DATA_PERMISSION_REQUIRED':meta.privacy_policy==='opaque_ref_provenance_gate'?'FILE_PROVENANCE_REQUIRED':'BASE_READ_ALLOWED';
 let code='NOT_ATTEMPTED_POLICY',status='POLICY_GATED',normalized=null;
 if(policy==='BASE_READ_ALLOWED'){
  ctx.inputJSON=JSON.stringify({operation,params:meta.template?.params||{}});
  try{
   const provider=platform==='ozon'?'OzonContract':'WBContract';const builder=meta.provider==='performance_api'?'buildPerformanceRequest':'buildRequest';
   normalized=JSON.parse(vm.runInContext(`JSON.stringify(${provider}.${builder}(${provider}.normalizeCommand(JSON.parse(inputJSON)),{}))`,ctx,{timeout:3000}));status='BUILDER_OK_FOR_DONOR_EXAMPLE';code=null;
  }catch(e){code=e.code||'UNCLASSIFIED';status='PARAMETERS_OR_EXPLICIT_POLICY_REQUIRED';}
 }
 rows.push({platform,operation,registered:true,method:meta.method,path:meta.path,policy,status,code});
}
console.log(JSON.stringify({status:rows.length===490?'PASS_INVENTORY':'FAIL',rows,total:rows.length,counts:rows.reduce((a,r)=>(a[r.policy]=(a[r.policy]||0)+1,a),{}),builder_outcomes:rows.reduce((a,r)=>(a[r.code||'OK']=(a[r.code||'OK']||0)+1,a),{}),provider_http:0,live_certification:false}));
