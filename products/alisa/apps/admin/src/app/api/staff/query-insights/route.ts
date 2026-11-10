import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,boundedBody,accountApi,response} from '../../../../server/auth';
export async function POST(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
  let data:Record<string,unknown>;
  try{data=JSON.parse(await boundedBody(request,4096));if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join()!=='action,filters')throw new Error();}
  catch{return response({code:'INVALID_PAYLOAD'},422);}
  try{const result=await accountApi('insights',{...data,session_token:readCookie(request,SESSION_COOKIE)});return response(result.body,result.status);}
  catch{return response({code:'STAFF_UNAVAILABLE'},503);}
}
