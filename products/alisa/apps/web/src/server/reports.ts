import {createHash} from 'node:crypto';
import {accountApi,readCookie,response,SESSION_COOKIE,validBrowserRequest} from './auth';
import {queriesEnabled} from './queries';

const uuid=(v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export async function reportApi(request:Request,id?:string){
  if(!queriesEnabled())return response({code:'NOT_FOUND'},404);
  if(request.method!=='GET'||!validBrowserRequest(request))return response({code:'ORIGIN_DENIED'},403);
  const query=new URL(request.url).searchParams,store=query.get('store')||'',cursor=query.get('cursor');
  if(!uuid(store)||id!==undefined&&!uuid(id)||query.getAll('store').length!==1||query.getAll('cursor').length>1
    ||Array.from(query.keys()).some(k=>!['store','cursor'].includes(k))||cursor!==null&&!uuid(cursor)||id&&cursor)return response({code:'INVALID_PAYLOAD'},422);
  const token=readCookie(request,SESSION_COOKIE);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return response({code:'AUTH_REQUIRED'},401);
  const call=(command:Record<string,unknown>)=>accountApi('reports',{session_token:token,store_id:store,command},8000);
  try{
    if(!id){const value=await call({action:'list',cursor});return response(value.body,value.status);}
    const first=await call({action:'read',id,offset:0});
    if(first.status!==200)return response(first.body,first.status);
    const initial=first.body;
    if(initial.id!==id||typeof initial.filename!=='string'||/[\r\n\\/]/.test(initial.filename)
      ||typeof initial.media_type!=='string'||!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(initial.media_type)
      ||!Number.isFinite(initial.expires_at)||initial.expires_at*1000<=Date.now())throw new Error('REPORT_INVALID');
    let offset=0,part:typeof initial|null=initial;
    const deadline=Date.now()+300000;
    const stream=new ReadableStream<Uint8Array>({
      async pull(controller){
        try{
          if(request.signal.aborted||Date.now()>=deadline||Date.now()>=initial.expires_at*1000)throw new Error('REPORT_EXPIRED');
          if(!part){const next=await call({action:'read',id,offset});if(next.status!==200)throw new Error('REPORT_ACCESS_CHANGED');part=next.body;}
          if(request.signal.aborted||Date.now()>=initial.expires_at*1000||part.id!==id||part.offset!==offset
            ||part.sha256!==initial.sha256||part.bytes!==initial.bytes||part.expires_at!==initial.expires_at
            ||typeof part.base64!=='string'||part.base64.length>87384||typeof part.eof!=='boolean')throw new Error('REPORT_CHANGED');
          if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.base64))throw new Error('REPORT_BASE64_INVALID');
          const bytes=Buffer.from(part.base64,'base64');
          if(part.chunk_sha256!==createHash('sha256').update(bytes).digest('hex'))throw new Error('REPORT_CHECKSUM_INVALID');
          if(bytes.length!==Math.min(65536,initial.bytes-offset)||part.next_offset!==offset+bytes.length
            ||part.eof!==(part.next_offset===initial.bytes))throw new Error('REPORT_CHUNK_INVALID');
          const end=part.eof;offset=part.next_offset;part=null;
          controller.enqueue(bytes);if(end)controller.close();
        }catch{controller.error(new Error('Скачивание остановлено: документ недоступен.'));}
      },cancel(){part=null;}
    });
    const filename=encodeURIComponent(initial.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
    return new Response(stream,{headers:{'Content-Type':initial.media_type,'Content-Length':String(initial.bytes),
      'Content-Disposition':"attachment; filename=report; filename*=UTF-8''"+filename,
      'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"}});
  }catch{return response({code:'DEPENDENCY_UNAVAILABLE'},503);}
}
