const paths: Record<string, string> = {leads:'/api/v1/leads', confirm:'/api/v1/leads/confirm', events:'/api/v1/funnel/events'};
export function siteOrigin() { return (process.env.ALISA_PUBLIC_BASE_URL || process.env.ALISA_WEB_ORIGIN || 'https://alisa.octoport.ru').replace(/\/+$/, ''); }
export function intakeEnabled() { return ['stage','dev'].includes(process.env.ALISA_ENV || '') && process.env.ALISA_LEAD_INTAKE_ENABLED === '1' && (process.env.ALISA_LANDING_MODE || 'CLOSED') === 'CLOSED'; }
export async function publicRequest(request: Request, action: string) {
  const base = process.env.ALISA_PLATFORM_URL, token = process.env.ALISA_SERVICE_TOKEN;
  if (!intakeEnabled() || !paths[action]) return Response.json({code:'NOT_FOUND'}, {status:404});
  if (new URL(request.url).search || request.headers.get('origin') !== siteOrigin() || request.headers.get('host') !== new URL(siteOrigin()).host) return Response.json({code:'ORIGIN_DENIED'}, {status:403});
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({code:'INVALID_PAYLOAD'}, {status:422});
  if (!base || !token || token.length < 32) return Response.json({code:'CONFIGURATION_ERROR'}, {status:503});
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return Response.json({code:'INVALID_UPSTREAM'}, {status:503});
  try {
    const reader=request.body?.getReader(); if(!reader) throw new Error();
    let size=0; const chunks:Uint8Array[]=[];
    while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return Response.json({code:'INVALID_PAYLOAD'},{status:422});}chunks.push(value); }
    const body=Buffer.concat(chunks).toString('utf8');JSON.parse(body);
    const result=await fetch(base+paths[action],{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
    const data=await result.json();const keys=['state','delivery','code','environment','release'];
    return Response.json(Object.fromEntries(Object.entries(data).filter(([k])=>keys.includes(k))),{status:result.status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch { return Response.json({code:'PLATFORM_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
