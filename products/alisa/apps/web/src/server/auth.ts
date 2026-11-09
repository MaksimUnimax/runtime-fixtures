import * as oidc from 'openid-client';
import {EncryptJWT,jwtDecrypt} from 'jose';
import {createHash,randomBytes} from 'node:crypto';
import {cache} from 'react';
import {siteOrigin} from './public';
import {permittedAuthOrigins} from './auth-origins';
import type {AuthFlowInput,AuthSessionInput} from '@alisa/contracts';

import {SESSION_COOKIE,SESSION_MAX_AGE_SECONDS,cookie} from './session-cookie';
export {SESSION_COOKIE,SESSION_MAX_AGE_SECONDS,cookie} from './session-cookie';
export const FLOW_COOKIE='__Host-alisa_login';
export const HANDOFF_COOKIE='__Host-alisa_handoff';
export function realLoginEnabled(){return (process.env.ALISA_REAL_LOGIN_ENABLED==='1'||process.env.ALISA_REAL_LOGIN_OPEN==='1')&&authEnabled();}
export function registrationOpen(){return process.env.ALISA_REAL_LOGIN_OPEN==='1'&&authEnabled();}
export function authEnabled(){return process.env.ALISA_ACCOUNTS_ENABLED==='1'&&['stage','dev'].includes(process.env.ALISA_ENV||'');}
export class AuthUnavailable extends Error{
  stage:string;safeCode:string;
  constructor(stage='configuration',cause?:unknown){
    super('Authentication temporarily unavailable');this.stage=stage;
    const code=(cause as {code?:unknown})?.code;
    this.safeCode=typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code)?code:'UNAVAILABLE';
  }
}
export function reportAuthFailure(error:unknown){
  const failure=error instanceof AuthUnavailable?error:new AuthUnavailable('protocol',error);
  console.warn(JSON.stringify({event:'alisa.auth.failure',stage:failure.stage,code:failure.safeCode}));
}
export type Profile={customer_id:string;tenant_id:string;email:string;display_name:string;role:'OWNER_CLIENT';access_status:'NOT_PROVISIONED'|'ACTIVE'|'SCHEDULED'|'EXPIRED'|'REVOKED';stores:never[]};
function configuration(){
  if(!authEnabled())throw new AuthUnavailable();
  const origin=new URL(siteOrigin()),issuer=new URL(process.env.ALISA_IDENTITY_ISSUER||'');
  const clientId=process.env.ALISA_WEB_OIDC_CLIENT_ID||'',secret=process.env.ALISA_WEB_OIDC_CLIENT_SECRET||'';
  if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password||issuer.pathname!=='/'||issuer.search||issuer.hash||issuer.username||issuer.password||!clientId||secret.length<32)throw new AuthUnavailable();
  const canonicalAuth=process.env.ALISA_CANONICAL_AUTH_ENABLED||'0';
  if(!['0','1'].includes(canonicalAuth)||!permittedAuthOrigins(process.env.ALISA_ENV,origin,issuer,process.env.ALISA_CANONICAL_SITE_ENABLED==='1',canonicalAuth==='1'))throw new AuthUnavailable();
  const encoded=process.env.ALISA_WEB_SESSION_KEY||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(encoded))throw new AuthUnavailable();
  const key=Buffer.from(encoded,'base64url');if(key.length!==32)throw new AuthUnavailable();
  return {origin:origin.origin,issuer,clientId,secret,key};
}
export function validBrowserRequest(request:Request,post=false){
  try{const own=new URL(siteOrigin());return request.headers.get('host')===own.host&&(!post||request.headers.get('origin')===own.origin);}catch{return false;}
}
export function readCookie(request:Request,name:string){
  const values=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  return values.length===1?values[0].slice(name.length+1):'';
}
export function response(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export async function accountApi(action:string,data:Record<string,unknown>,timeoutMs=5000){
  const paths:Record<string,string>={createFlow:'auth/flows',consumeFlow:'auth/flows/consume',createSession:'auth/sessions',me:'account/me',profile:'account/profile',access:'account/access',stores:'account/stores',alice:'account/alice',queries:'account/queries',reports:'account/reports',ownerInputs:'account/owner-inputs',ownerProducts:'account/owner-products',logout:'auth/logout'};
  const base=new URL(process.env.ALISA_PLATFORM_URL||''),token=process.env.ALISA_AUTH_SERVICE_TOKEN||'';
  if(!paths[action]||base.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(base.hostname)||base.pathname!=='/'||base.search||base.hash||base.username||base.password||token.length<32)throw new AuthUnavailable();
  try{
    const r=await fetch(new URL('/api/v1/'+paths[action],base),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
    const body=await r.json();if(r.status>=500)throw new AuthUnavailable();return {status:r.status,body};
  }catch(error){throw new AuthUnavailable('platform',error);}
}
let clientPromise:Promise<oidc.Configuration>|undefined;
async function client(){
  if(!clientPromise){
    const c=configuration();
    const pinnedFetch:oidc.CustomFetch=async(url,options)=>{
      const target=new URL(url.toString());if(target.origin!==c.issuer.origin||target.username||target.password)throw new AuthUnavailable();
      const body=options.body instanceof Uint8Array?new Uint8Array(options.body):options.body;
      return fetch(url,{...options,body,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
    };
    clientPromise=oidc.discovery(c.issuer,c.clientId,{token_endpoint_auth_method:'client_secret_basic',id_token_signed_response_alg:'RS256'},oidc.ClientSecretBasic(c.secret),{
      timeout:5,[oidc.customFetch]:pinnedFetch,execute:[oidc.enableNonRepudiationChecks,...(c.issuer.protocol==='http:'?[oidc.allowInsecureRequests]:[])]
    }).then(config=>{
      const metadata=config.serverMetadata();
      for(const field of ['authorization_endpoint','token_endpoint','jwks_uri'] as const){
        const endpoint=metadata[field];if(typeof endpoint!=='string'||new URL(endpoint).origin!==c.issuer.origin)throw new AuthUnavailable();
      }
      return config;
    }).catch(error=>{clientPromise=undefined;throw new AuthUnavailable('discovery',error);});
  }
  return clientPromise;
}
async function seal(value:Record<string,unknown>,purpose:string,ttl:string){
  const c=configuration();return new EncryptJWT(value).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:'alisa-bff+jwt'}).setIssuer(c.origin).setAudience(purpose).setIssuedAt().setExpirationTime(ttl).encrypt(c.key);
}
export async function begin(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request,true))return response({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search)return response({code:'INVALID_PAYLOAD'},422);
  const text=await boundedBody(request,2048);const form=new URLSearchParams(text);
  if([...form.keys()].some(k=>!['service','privacy','return_to'].includes(k))||form.getAll('service').length!==1||form.getAll('privacy').length!==1||form.get('service')!=='on'||form.get('privacy')!=='on'||(form.get('return_to')||'/app')!=='/app')return response({code:'INVALID_PAYLOAD'},422);
  if(await getProfile(readCookie(request,SESSION_COOKIE)))return new Response(null,{status:303,headers:{Location:siteOrigin()+await customerReturn(request),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  const config=await client(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
  const encrypted=await seal({state,nonce,verifier,session_token:randomBytes(32).toString('base64url'),return_to:'/app'},'alisa-flow','10m');
  const handoff=readCookie(request,HANDOFF_COOKIE);
  const input:AuthFlowInput={encrypted_payload:encrypted,service_consent:true,privacy_consent:true,...(/^[0-9a-f-]{36}$/i.test(handoff)?{handoff_id:handoff}:{})};
  const flow=await accountApi('createFlow',input);if(flow.status!==201||typeof flow.body.flow_ref!=='string')throw new AuthUnavailable();
  const redirect=oidc.buildAuthorizationUrl(config,{redirect_uri:configuration().origin+'/auth/callback',scope:'openid email profile',response_type:'code',prompt:'login',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
  return new Response(null,{status:303,headers:{Location:redirect.href,'Set-Cookie':cookie(FLOW_COOKIE,flow.body.flow_ref,600),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
export async function callback(request:Request){
  if(!authEnabled())return response({code:'NOT_FOUND'},404);
  if(!validBrowserRequest(request))return response({code:'HOST_DENIED'},403);
  const c=configuration(),target=new URL('/login?error=AUTH_FAILED',c.origin);
  try{
    const ref=readCookie(request,FLOW_COOKIE),incoming=new URL(request.url);
    if(!/^[A-Za-z0-9_-]{43}$/.test(ref)||incoming.searchParams.getAll('code').length!==1||incoming.searchParams.getAll('state').length!==1)throw new Error();
    const flow=await accountApi('consumeFlow',{flow_ref:ref});
    if(flow.status===400){target.search='?error=ALREADY_HANDLED_OR_EXPIRED';throw new Error();}
    if(flow.status!==200||typeof flow.body.encrypted_payload!=='string'||typeof flow.body.flow_id!=='string')throw new Error();
    const {payload}=await jwtDecrypt(flow.body.encrypted_payload,c.key,{issuer:c.origin,audience:'alisa-flow'});
    if(typeof payload.state!=='string'||typeof payload.nonce!=='string'||typeof payload.verifier!=='string'||typeof payload.session_token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(payload.session_token)||payload.return_to!=='/app')throw new Error();
    const url=new URL('/auth/callback',c.origin);url.search=incoming.search;
    const tokens=await oidc.authorizationCodeGrant(await client(),url,{expectedState:payload.state,expectedNonce:payload.nonce,pkceCodeVerifier:payload.verifier,idTokenExpected:true});
    const claims=tokens.claims();
    if(!claims||typeof claims.sub!=='string'||typeof claims.email!=='string'||claims.email_verified!==true
      ||claims.acr!=='urn:octoport:customer:password-email:v1'||!Array.isArray(claims.amr)
      ||!claims.amr.includes('pwd')||!claims.amr.includes('email_otp')
      ||typeof claims.auth_time!=='number'||claims.auth_time<Date.now()/1000-300||claims.auth_time>Date.now()/1000+5)throw new Error();
    const sessionToken=payload.session_token;
    const encrypted=await seal({access_token:tokens.access_token,id_token:tokens.id_token,token_type:tokens.token_type},'alisa-tokens','1h');
    const input:AuthSessionInput={flow_id:flow.body.flow_id,issuer:c.issuer.origin,client_id:c.clientId,subject:claims.sub,email:claims.email,email_verified:true,
      session_hash:createHash('sha256').update(sessionToken).digest('hex'),encrypted_payload:encrypted};
    let result;
    try{result=await accountApi('createSession',input);}
    catch{result=await accountApi('createSession',input);}
    if(result.status!==201&&!(result.status===200&&result.body.state==='ALREADY_CREATED'))throw new Error();
    const headers=new Headers({Location:c.origin+await customerReturn(request),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    headers.append('Set-Cookie',cookie(SESSION_COOKIE,sessionToken,SESSION_MAX_AGE_SECONDS));headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0));headers.append('Set-Cookie',cookie(HANDOFF_COOKIE,'',0));
    return new Response(null,{status:303,headers});
  }catch(error){
    reportAuthFailure(error);
    return new Response(null,{status:303,headers:{Location:target.href,'Set-Cookie':cookie(FLOW_COOKIE,'',0),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
}
// React scopes this memoization to one server render; route handlers perform
// fresh lookups. Do not replace it with a process-wide session cache.
export const getProfile=cache(async(token:string):Promise<Profile|null>=>{
  if(!authEnabled()||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const result=await accountApi('me',{session_token:token});
  if(result.status===401)return null;if(result.status!==200||!result.body.profile)throw new AuthUnavailable();return result.body.profile as Profile;
});
export async function boundedBody(request:Request,limit=4096){
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new Error('INVALID_PAYLOAD');}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
}

async function customerReturn(request:Request){
  // Dynamic import keeps the normal OIDC path independent of skill configuration.
  const {aliceReturn}=await import('./alice-link');return aliceReturn(request);
}
