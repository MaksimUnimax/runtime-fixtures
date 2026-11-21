import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,boundedBody,accountApi,response} from '../../../../server/auth';
import {siteOrigin} from '../../../../server/public';
export async function POST(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search)return response({code:'INVALID_PAYLOAD'},422);
  try{
    const body=await boundedBody(request),form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded');
    const data=form?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body);
    if(!data||Object.keys(data).length!==1||typeof data.display_name!=='string'||data.display_name.length>80)return response({code:'INVALID_PAYLOAD'},422);
    const result=await accountApi('profile',{session_token:readCookie(request,SESSION_COOKIE),display_name:data.display_name});
    if(result.status!==200)return response({code:result.body.code},result.status);
    return form?new Response(null,{status:303,headers:{Location:siteOrigin()+'/app','Cache-Control':'no-store'}}):response({profile:result.body.profile});
  }catch{return response({code:'ACCOUNT_UNAVAILABLE'},503);}
}
