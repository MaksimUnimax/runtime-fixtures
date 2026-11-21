import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,accountApi,response} from '../../../../server/auth';

export async function GET(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  if(new URL(request.url).search)return response({code:'INVALID_PAYLOAD'},422);
  try{
    const result=await accountApi('access',{session_token:readCookie(request,SESSION_COOKIE)});
    return response(result.body,result.status);
  }catch{return response({code:'ACCESS_UNAVAILABLE'},503);}
}
