import {gunzipSync} from 'node:zlib';
/* Exact Octoport validators in a network-free VM. No credentials enter here. */
import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const pack=JSON.parse(gunzipSync(fs.readFileSync(path.join(ROOT,'donor.json.gz'))).toString('utf8'));
const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,console:{log(){},warn(){},error(){}},crypto:crypto.webcrypto});
for(const [name,hash]of Object.entries(pack.inventory.source.hashes)){
 const text=pack.files[name];if(typeof text!=='string'||crypto.createHash('sha256').update(text).digest('hex')!==hash)throw Error('DONOR_HASH_CHANGED');
 vm.runInContext(text,context,{filename:name,timeout:2500});
}
const active=JSON.parse(gunzipSync(fs.readFileSync(path.join(ROOT,'catalog.json.gz'))).toString('utf8'));
const inputText=fs.readFileSync(0,'utf8');if(Buffer.byteLength(inputText)>64000)throw Error('REQUEST_TOO_LARGE');
const input=JSON.parse(inputText);const keys=Object.keys(input).sort().join(',');
function fail(code){const e=Error(code);e.code=code;throw e;}
const updates={ozon_action_products:'/v2/actions/products',ozon_action_candidates:'/v2/actions/candidates',ozon_auto_add_products:'/v2/actions/auto-add/products/list',ozon_auto_add_candidates:'/v2/actions/auto-add/products/candidates'};
try{
 if(keys!=='operation,params,platform')fail('BRIDGE_INPUT_SCHEMA');
 if(!['ozon','wb'].includes(input.platform)||typeof input.operation!=='string')fail('BRIDGE_INPUT_SCHEMA');
 const inventory=pack.inventory[input.platform].operations;const meta=inventory[input.operation];if(!meta)fail('READ_METHOD_UNKNOWN');
 if(meta.effect!=='READ')fail('NON_READ_OPERATION_FORBIDDEN');
 const row=active.providers[input.platform].operations[input.operation];const profile=row?.response_projection?active.response_projections?.[row.response_projection]:null;
 const ownerProtected=meta.effect==='READ'&&meta.execution_enabled===true&&row?.completion?.mode==='ozon-protected'&&row?.method===meta.method&&row?.path===meta.path;
 const projected=meta.privacy_policy==='operator_personal_data_gate'&&row?.effect==='READ'&&row?.execution_enabled===true&&row?.method===meta.method&&row?.path===meta.path&&profile?.schema==='alice-business-response/v1'&&profile?.default==='DROP';
 const wbProjected=input.platform==='wb'&&meta.execution_enabled===false&&meta.current===true&&meta.source_readonly===true&&meta.blocked_reason==='DIRECT_PII_SURFACE'&&meta.privacy==='blocked_pii'&&meta.method==='GET'&&meta.query_keys.length===0&&meta.required_query_keys.length===0&&meta.body_required===false&&!meta.path.includes('{')&&row?.projected_request==='empty-params-get-v1'&&row?.path===meta.path&&row?.host===meta.host&&row?.method===meta.method&&profile?.schema==='alice-business-response/v1'&&profile?.default==='DROP';
 if(meta.execution_enabled!==true&&!wbProjected)fail(meta.blocked_reason||'READ_METHOD_DISABLED');
 if((meta.privacy_policy==='operator_personal_data_gate'&&!projected&&!ownerProtected)||(meta.privacy==='blocked_pii'&&!wbProjected))fail('PERSONAL_DATA_PERMISSION_REQUIRED');
 if(wbProjected){
  if(!input.params||typeof input.params!=='object'||Array.isArray(input.params))fail('READ_PARAMS_SCHEMA');
  for(const[k,v]of Object.entries(input.params)){if(!['path','query'].includes(k)||!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length)fail('UNSUPPORTED_QUERY_PARAM');}
  context.businessAlias=input.operation;context.businessMeta=JSON.stringify({...meta,execution_enabled:true});context.businessOrigin=pack.inventory.wb.hosts[meta.host];
  vm.runInContext(`globalThis.BusinessReadContract=WBContractFactory.createWBContract({operations:{[businessAlias]:{...JSON.parse(businessMeta),normalizeParams(p){if(Object.keys(p).length)throw Object.assign(Error('params'),{code:'READ_PARAMS_SCHEMA'});return p;}}},sellerApiBase:businessOrigin});`,context,{timeout:2500});
  input.params={};
 }

 if(meta.privacy_policy==='opaque_ref_provenance_gate')fail('OPAQUE_FILE_PROVENANCE_REQUIRED');
 const reg=wbProjected?'BusinessReadContract':input.platform==='ozon'?'OzonContract':'WBContract';
 context.inputJSON=JSON.stringify({operation:input.operation,params:input.params});
 const performance=input.platform==='ozon'&&meta.provider==='performance_api';
 const built=vm.runInContext(`(()=>{const c=JSON.parse(inputJSON);const k=${reg};const normalized=k.normalizeCommand(c);const r=k.${performance?'buildPerformanceRequest':'buildRequest'}(normalized,{});return JSON.stringify({normalized,request:r});})()`,context,{timeout:2500});
 const output=JSON.parse(built);const request=output.request;if(wbProjected)request.host_alias=meta.host;const url=new URL(request.url);
 if(input.platform==='ozon'&&Object.hasOwn(updates,input.operation)){
  if(url.origin!=='https://api-seller.ozon.ru'||request.method!=='POST')fail('UPDATE_TARGET_DRIFT');
  url.pathname=updates[input.operation];request.url=url.href;request.path=url.pathname;
 }
 const origins=input.platform==='ozon'?['https://api-seller.ozon.ru','https://api-performance.ozon.ru']:Object.values(pack.inventory.wb.hosts);
 if(!origins.includes(url.origin)||url.username||url.password||url.hash||!['GET','POST'].includes(request.method))fail('FIXED_TRANSPORT_REQUIRED');
 if(Object.keys(request.headers||{}).length)fail('NO_CREDENTIALS_IN_BUILDER');
 process.stdout.write(JSON.stringify({ok:true,platform:input.platform,operation:input.operation,normalized:output.normalized,request}));
}catch(error){
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,90}$/.test(error.code)?error.code:'READ_REQUEST_INVALID';
 process.stdout.write(JSON.stringify({ok:false,error:code}));process.exitCode=2;
}
