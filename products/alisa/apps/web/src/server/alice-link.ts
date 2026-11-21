import {accountApi,authEnabled,boundedBody,cookie,getProfile,readCookie,response,SESSION_COOKIE,validBrowserRequest} from './auth';
import {siteOrigin} from './public';
import {strictJson} from './strict-json';

export const ALICE_FLOW_COOKIE='__Host-alisa_alice';
export function aliceEnabled(){return authEnabled()&&process.env.ALISA_ALICE_LINK_ENABLED==='1';}
export function aliceReturn(request:Request){
  return aliceEnabled()&&/^[A-Za-z0-9_-]{43}$/.test(readCookie(request,ALICE_FLOW_COOKIE))?'/app/alice/connect':'/app';
}
function redirect(path:string,clear=false){
  const headers=new Headers({Location:siteOrigin()+path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  if(clear)headers.append('Set-Cookie',cookie(ALICE_FLOW_COOKIE,'',0));
  return new Response(null,{status:303,headers});
}
export type AliceStatus={state:'DISCONNECTED'|'WAITING_FOR_ALICE'|'CONNECTED';voice_private:boolean};
export async function getAlice(token:string):Promise<AliceStatus>{
  const result=await accountApi('alice',{action:'status',session_token:token});
  if(result.status!==200||!result.body.alice)throw new Error('ALICE_UNAVAILABLE');
  return result.body.alice as AliceStatus;
}
export async function previewAlice(token:string,flow:string){
  const result=await accountApi('alice',{action:'preview',session_token:token,flow_ref:flow});
  return result.status===200&&result.body.state==='AWAITING_CONSENT';
}
export function cancelAlice(request:Request){
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  return redirect('/app/alice?notice=EXPIRED',true);
}
export async function authorize(request:Request){
  if(!aliceEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  const query=new URL(request.url).search.slice(1);
  if(!query||query.length>8192)return response({code:'INVALID_AUTHORIZATION_REQUEST'},400);
  const token=readCookie(request,SESSION_COOKIE),profile=await getProfile(token);
  const result=await accountApi('alice',{action:'request',query,...(profile?{session_token:token}:{})});
  if(result.status!==201||typeof result.body.flow_ref!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(result.body.flow_ref))return response({code:'INVALID_AUTHORIZATION_REQUEST'},400);
  const headers=new Headers({Location:siteOrigin()+(profile?'/app/alice/connect':'/login'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  headers.append('Set-Cookie',cookie(ALICE_FLOW_COOKIE,result.body.flow_ref,600));
  return new Response(null,{status:303,headers});
}
export async function command(request:Request){
  if(!aliceEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search||request.headers.get('content-type')!=='application/x-www-form-urlencoded')return response({code:'INVALID_PAYLOAD'},422);
  const form=new URLSearchParams(await boundedBody(request,1024));
  if([...form.keys()].some(k=>!['action','voice_private'].includes(k))||form.getAll('action').length!==1||form.getAll('voice_private').length>1)return response({code:'INVALID_PAYLOAD'},422);
  const action=form.get('action')||'';
  if(!['approve','deny','unlink','privacy'].includes(action)||action!=='privacy'&&form.has('voice_private'))return response({code:'INVALID_PAYLOAD'},422);
  const token=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return redirect('/login');
  const data:Record<string,unknown>={action,session_token:token};
  if(action==='approve'||action==='deny'){
    const flow=readCookie(request,ALICE_FLOW_COOKIE);
    if(!/^[A-Za-z0-9_-]{43}$/.test(flow))return redirect('/app/alice?notice=EXPIRED',true);
    data.flow_ref=flow;
  }
  if(action==='privacy'){
    if(!['on','off'].includes(form.get('voice_private')||''))return response({code:'INVALID_PAYLOAD'},422);
    data.voice_private=form.get('voice_private')==='on';
  }
  const result=await accountApi('alice',data);
  if(result.status===401)return redirect('/login');
  if(result.status!==200)return redirect('/app/alice?notice=RETRY',true);
  if(action==='approve'||action==='deny'){
    if(typeof result.body.redirect_uri!=='string')throw new Error('ALICE_UNAVAILABLE');
    const target=new URL(result.body.redirect_uri);
    if(target.origin!=='https://social.yandex.net'||target.pathname!=='/broker/redirect'||target.username||target.password||target.hash)throw new Error('ALICE_UNAVAILABLE');
    return new Response(null,{status:303,headers:{Location:target.href,'Set-Cookie':cookie(ALICE_FLOW_COOKIE,'',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  return redirect('/app/alice?notice='+ (action==='unlink'?'DISCONNECTED':'SAVED'),action==='unlink');
}
export async function protocol(request:Request,revoke=false){
  if(!aliceEnabled())return response({error:'temporarily_unavailable'},503);
  if(!validBrowserRequest(request)||new URL(request.url).search)return response({error:'invalid_request'},400);
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')return response({error:'invalid_request'},400);
  let body:string;try{body=await boundedBody(request,8192);}catch{return response({error:'invalid_request'},400);}
  const authorization=request.headers.get('authorization')||'';
  const result=await accountApi('alice',{action:revoke?'revoke':'token',body,authorization},3500);
  if(result.status!==200||typeof result.body.oauth_status!=='number'||!result.body.oauth_body)return response({error:'invalid_request'},400);
  const status=result.body.oauth_status;
  if(![200,400,401,403].includes(status))throw new Error('ALICE_UNAVAILABLE');
  const output=response(result.body.oauth_body,status);
  output.headers.set('Pragma','no-cache');
  if(status===401)output.headers.set('WWW-Authenticate','Basic realm="Alice"');
  return output;
}
export async function webhook(request:Request){
  if(!aliceEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request)||new URL(request.url).search||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return response({code:'INVALID_PAYLOAD'},422);
  let payload:unknown;try{payload=strictJson(await boundedBody(request,24000));}catch{return response({code:'INVALID_PAYLOAD'},422);}
  const result=await accountApi('alice',{action:'webhook',payload,authorization:request.headers.get('authorization')||''},3500);
  if(result.status!==200)return response({code:typeof result.body.code==='string'?result.body.code:'INVALID_PAYLOAD'},result.status);
  if(!result.body.skill_response)throw new Error('ALICE_UNAVAILABLE');
  return response(result.body.skill_response);
}
