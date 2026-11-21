import {strictJson} from '../../../../server/strict-json';
import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,accountApi,response,boundedBody} from '../../../../server/auth';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
  if(!authEnabled()||process.env.ALISA_OWNER_DATA_ENABLED!=='1')return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||request.headers.get('content-type')!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
  const sessionToken=readCookie(request,SESSION_COOKIE);if(!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))return response({code:'AUTHENTICATION_REQUIRED'},401);
  let command:Record<string,unknown>;
  try{command=strictJson(await boundedBody(request,24000)) as Record<string,unknown>;}catch{return response({code:'INVALID_PAYLOAD'},422);}
  if(!command||Array.isArray(command)||typeof command!=='object'||typeof command.store_id!=='string'||!uuid.test(command.store_id))return response({code:'INVALID_PAYLOAD'},422);
  const required:Record<string,string[]>={read:['action','store_id'],status:['action','store_id','command_id'],approve:['action','store_id','command_id','expected_revision','confirmed','facts','not_after'],revoke:['action','store_id','command_id','expected_revision','not_after']};
  if(typeof command.action!=='string'||!Object.hasOwn(required,command.action)||Object.keys(command).sort().join(',')!==required[command.action].sort().join(','))return response({code:'INVALID_PAYLOAD'},422);
  if(command.action!=='read'&&(typeof command.command_id!=='string'||!uuid.test(command.command_id)))return response({code:'INVALID_PAYLOAD'},422);
  if(command.action==='approve'||command.action==='revoke'){
    if(!Number.isSafeInteger(command.expected_revision)||(command.expected_revision as number)<0||!Number.isSafeInteger(command.not_after))return response({code:'INVALID_PAYLOAD'},422);
    if(command.action==='approve'&&command.confirmed!==true)return response({code:'OWNER_CONFIRMATION_REQUIRED'},422);
  }
  try{const r=await accountApi('ownerInputs',{session_token:sessionToken,command});return response(r.body,r.status);}
  catch{return response({code:'OWNER_DATA_UNAVAILABLE'},503);}
}
