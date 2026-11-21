import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,FLOW_COOKIE,cookie,accountApi,response} from '../../../server/auth';
import {siteOrigin} from '../../../server/origin';
export async function POST(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true)||new URL(request.url).search)return response({code:'ORIGIN_DENIED'},403);
  try{const token=readCookie(request,SESSION_COOKIE);if(token){const r=await accountApi('logout',{session_token:token});if(r.status!==200)return response({code:'LOGOUT_UNAVAILABLE'},503);}}
  catch{return response({code:'LOGOUT_UNAVAILABLE'},503);}
  const headers=new Headers({Location:siteOrigin()+'/login','Cache-Control':'no-store'});
  headers.append('Set-Cookie',cookie(SESSION_COOKIE,'',0));headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0));
  return new Response(null,{status:303,headers});
}
