import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,accountApi,response,boundedBody} from '../../../../server/auth';

export async function GET(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(k=>k!=='cursor')||params.getAll('cursor').length>1)return response({code:'INVALID_PAYLOAD'},422);
  const sessionToken=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))return response({code:'AUTHENTICATION_REQUIRED'},401);
  try{
    const result=await accountApi('stores',{session_token:sessionToken,command:{action:'list',...(params.has('cursor')?{cursor:params.get('cursor')}: {})}});
    return response(result.body,result.status);
  }catch{return response({code:'STORES_UNAVAILABLE'},503);}
}
export async function POST(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||request.headers.get('content-type')!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
  const sessionToken=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))return response({code:'AUTHENTICATION_REQUIRED'},401);
  let command;
  try{command=JSON.parse(await boundedBody(request,24000));}catch{return response({code:'INVALID_PAYLOAD'},422);}
  if(!command||Array.isArray(command)||typeof command!=='object'||command.action==='list')return response({code:'INVALID_PAYLOAD'},422);
  try{
    const result=await accountApi('stores',{session_token:sessionToken,command});
    return response(result.body,result.status);
  }catch{return response({code:'STORES_UNAVAILABLE'},503);}
}
