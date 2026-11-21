import {strictJson} from '../../../../server/strict-json';
import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,accountApi,response,boundedBody} from '../../../../server/auth';
export async function POST(request:Request){
 if(!authEnabled()||process.env.ALISA_OWNER_DATA_ENABLED!=='1')return response({code:'NOT_FOUND'},404);
 if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
 const token=readCookie(request,SESSION_COOKIE);if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({code:'AUTHENTICATION_REQUIRED'},401);
 if(new URL(request.url).search||request.headers.get('content-type')!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
 let value:unknown;try{value=strictJson(await boundedBody(request,5000));}catch{return response({code:'INVALID_PAYLOAD'},422);}
 const data=value as Record<string,unknown>;
 if(!data||Array.isArray(data)||Object.keys(data).sort().join(',')!=='cursor,store_id'||typeof data.store_id!=='string'||!/^[-0-9a-f]{36}$/i.test(data.store_id)||typeof data.cursor!=='string'||data.cursor.length>4096)return response({code:'INVALID_PAYLOAD'},422);
 try{const r=await accountApi('ownerProducts',{session_token:token,...data});return response(r.body,r.status);}catch{return response({code:'CATALOG_UNAVAILABLE'},503);}
}
