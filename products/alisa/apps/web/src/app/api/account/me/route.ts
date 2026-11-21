import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,getProfile,response} from '../../../../server/auth';
export async function GET(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  if(new URL(request.url).search)return response({code:'INVALID_PAYLOAD'},422);
  try{const profile=await getProfile(readCookie(request,SESSION_COOKIE));return profile?response({profile}):response({code:'AUTHENTICATION_REQUIRED'},401);}
  catch{return response({code:'ACCOUNT_UNAVAILABLE'},503);}
}
