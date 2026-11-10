import {accountApi,authEnabled,boundedBody,readCookie,response,SESSION_COOKIE,validBrowserRequest} from './auth';
import {strictJson} from './strict-json';

export function queriesEnabled(){return authEnabled()&&process.env.ALISA_QUERIES_ENABLED==='1';}
const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export async function queryApi(request:Request,id?:string,operation?:'result'|'cancel'|'feedback'){
  if(!queriesEnabled())return response({code:'NOT_FOUND'},404);
  const mutation=request.method==='POST';
  if(!validBrowserRequest(request,mutation))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||id!==undefined&&!uuid(id))return response({code:'INVALID_PAYLOAD'},422);
  const token=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({code:'AUTH_REQUIRED'},401);
  let command:Record<string,unknown>;
  if(!mutation){command=id?{action:operation||'status',id}:{action:'list'};}
  else{
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
    let data:Record<string,unknown>;
    try{const value=strictJson(await boundedBody(request,12000));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();data=value as Record<string,unknown>;}catch{return response({code:'INVALID_PAYLOAD'},422);}
    if(operation==='feedback'){
      if(Object.keys(data).length)return response({code:'INVALID_PAYLOAD'},422);
      command={action:'feedback',id};
    }else if(operation==='cancel'){
      if(Object.keys(data).join()!=='request_id')return response({code:'INVALID_PAYLOAD'},422);
      command={...data,action:'cancel',id};
    }else{
      if(id||Object.keys(data).some(k=>!['id','store_ids','utterance','recover'].includes(k)))return response({code:'INVALID_PAYLOAD'},422);
      command={...data,action:'submit'};
    }
  }
  // This is one request only. A transport failure never creates a new submission ID.
  const result=await accountApi('queries',{session_token:token,command},8000);
  return response(result.body,result.status);
}
