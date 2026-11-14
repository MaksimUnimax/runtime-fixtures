import {strictJson} from '../../../../server/strict-json';
import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,response,boundedBody} from '../../../../server/auth';
import {parameterApi} from '../../../../server/parameters';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 if(!authEnabled()||process.env.ALISA_OWNER_DATA_ENABLED!=='1'||process.env.ALISA_OWNER_PARAMETERS_ENABLED!=='1')return response({code:'NOT_FOUND'},404);
 if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
 if(new URL(request.url).search||request.headers.get('content-type')!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
 const token=readCookie(request,SESSION_COOKIE);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({code:'AUTHENTICATION_REQUIRED'},401);
 let c:Record<string,unknown>;try{c=strictJson(await boundedBody(request,12000))as Record<string,unknown>;}catch{return response({code:'INVALID_PAYLOAD'},422);}
 if(!c||Array.isArray(c)||typeof c!=='object'||typeof c.store_id!=='string'||!uuid.test(c.store_id)||typeof c.action!=='string')return response({code:'INVALID_PAYLOAD'},422);
 const base=['action','store_id','parameter','scope','sku_reference'];
 const fields:Record<string,string[]>={catalog:['action','store_id'],read:base,status:[...base,'command_id'],prepare_calculation:[...base,'period','mode'],set_manual:[...base,'value','unit','command_id','expected_revision','confirmed','not_after'],use_general:[...base,'command_id','expected_revision','confirmed','not_after']};
 if(!Object.hasOwn(fields,c.action)||Object.keys(c).sort().join(',')!==[...fields[c.action]].sort().join(','))return response({code:'INVALID_PAYLOAD'},422);
 if(c.action!=='catalog'){
  const area=c.scope as {kind?:unknown;sku?:unknown};
  if(typeof c.parameter!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(c.parameter)||!area||Array.isArray(area)||Object.keys(area).sort().join(',')!=='kind,sku'||!(area.kind==='store'&&area.sku===''&&c.sku_reference===null||area.kind==='sku'&&typeof area.sku==='string'&&/^[1-9]\d{0,19}$/.test(area.sku)&&typeof c.sku_reference==='string'&&c.sku_reference.length<=4096))return response({code:'INVALID_PAYLOAD'},422);
 }
 if(['status','set_manual','use_general'].includes(c.action)&&(typeof c.command_id!=='string'||!uuid.test(c.command_id)))return response({code:'INVALID_PAYLOAD'},422);
 if(['set_manual','use_general'].includes(c.action)&&(!Number.isSafeInteger(c.expected_revision)||(c.expected_revision as number)<0||!Number.isSafeInteger(c.not_after)||c.confirmed!==true))return response({code:'INVALID_PAYLOAD'},422);
 if(c.action==='set_manual'&&(typeof c.value!=='string'||typeof c.unit!=='string'))return response({code:'INVALID_PAYLOAD'},422);
 if(c.action==='prepare_calculation'&&!['preview','replace'].includes(String(c.mode)))return response({code:'INVALID_PAYLOAD'},422);
 try{const r=await parameterApi(token,c);return response(r.body,r.status);}catch{return response({code:'PARAMETER_OUTCOME_UNKNOWN'},503);}
}
