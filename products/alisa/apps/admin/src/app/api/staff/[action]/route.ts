import {authEnabled,validBrowserRequest,readCookie,SESSION_COOKIE,boundedBody,accountApi,response} from '../../../../server/auth';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))return response({code:'INVALID_PAYLOAD'},422);
  const {action}=await params;if(!['read','command','me'].includes(action))return response({code:'NOT_FOUND'},404);
  let data:Record<string,unknown>;
  try{
    data=JSON.parse(await boundedBody(request,8192));
    if(!data||typeof data!=='object'||Array.isArray(data)||'session_token' in data)throw new Error();
    const fields=action==='command'?['command_id','action','payload','reason']:action==='read'?['resource','query','id']:[];
    if(Object.keys(data).some(key=>!fields.includes(key)))throw new Error();
  }catch{return response({code:'INVALID_PAYLOAD'},422);}
  try{const result=await accountApi(action,{...data,session_token:readCookie(request,SESSION_COOKIE)});return response(result.body,result.status);}
  catch{return response({code:'STAFF_UNAVAILABLE'},503);}
}
