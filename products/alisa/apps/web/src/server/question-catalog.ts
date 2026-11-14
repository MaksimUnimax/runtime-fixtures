import {accountApi,authEnabled,readCookie,response,SESSION_COOKIE,validBrowserRequest} from './auth';
export function catalogEnabled(){return authEnabled()&&process.env.ALISA_QUESTION_CATALOG_ENABLED==='1';}
export async function catalogApi(request:Request){
  if(!catalogEnabled())return response({code:'NOT_FOUND'},404);
  if(request.method!=='GET'||!validBrowserRequest(request))return response({code:'ORIGIN_DENIED'},403);
  const params=new URL(request.url).searchParams,store=params.get('store_id')||'';
  const keys=[...params.keys()],search=params.get('search')||'',kind=params.get('kind')||'',offset=params.get('offset')||'0';
  if(keys.length!==new Set(keys).size||keys.some(k=>!['store_id','search','kind','offset'].includes(k))||!params.has('store_id')||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(store)||search.length>200||!['','scalar','compound','dataset','formula','event','information','parameter'].includes(kind)||!/^\d{1,4}$/.test(offset)||Number(offset)>1000)return response({code:'INVALID_PAYLOAD'},422);
  const token=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({code:'AUTH_REQUIRED'},401);
  const result=await accountApi('catalog',{session_token:token,store_id:store,query:{search,kind,offset:Number(offset)}});
  return response(result.body,result.status);
}
