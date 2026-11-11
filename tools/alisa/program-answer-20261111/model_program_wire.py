"""Provider adapter for official Harness Messages, using the normal HTTP boundary."""
import base64,json,time,urllib.request,urllib.error,http.client
from email.utils import parsedate_to_datetime
from engine import CallError
from shared_http import read_response
from model_program_receipts import receipts

FIELDS={'model','messages','system','max_tokens','tools','tool_choice','stream','thinking',
        'output_config','reasoning_effort','temperature','top_p','top_k','stop_sequences','metadata'}

def execute(transport,request,on_dispatch):
    payload=dict(request.body['payload'])
    if not transport.enabled:raise CallError('LIVE_DISABLED')
    if set(payload)-FIELDS or payload.get('model')!=transport.model_source.removeprefix('model:') or payload.get('stream')is not True:
        raise CallError('MODEL_POLICY_CHANGED')
    payload.pop('max_tokens',None)
    # Tenant identity is intentionally absent; the surrounding job supplies a
    # one-way isolated user hash, never an owner/store identifier.
    headers={'Content-Type':'application/json','x-api-key':transport._credential('deepseek'),'anthropic-version':'2023-06-01','anthropic-beta':'mid-conversation-tool-changes-2026-07-01'}
    http=urllib.request.Request('https://api.deepseek.com/anthropic/v1/messages',
        data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode(),headers=headers,method='POST')
    start=time.monotonic()
    try:raw,status=read_response(http,timeout=transport.max_request_seconds,limit=12000000,on_dispatch=on_dispatch)
    except urllib.error.HTTPError as exc:
        retry=exc.headers.get('Retry-After');due=None
        try:due=time.time()+max(0,int(retry)) if retry else None
        except (ValueError,TypeError):
            try:due=parsedate_to_datetime(retry).timestamp()
            except (ValueError,TypeError,OverflowError):pass
        status=exc.code;exc.close();raise CallError('HTTP_'+str(status),status=status,retry_at=due)from None
    except (urllib.error.URLError,TimeoutError,ConnectionError,OSError,http.client.HTTPException):
        raise CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True)from None
    try:r=receipts(raw,'/v1/messages')
    except (ValueError,UnicodeError,TypeError):raise CallError('MODEL_ENVELOPE',status=status,unknown=True)from None
    u=r.get('usage');billing=None
    if r.get('usage_complete'):
        miss,hit,out=(u[k]for k in ['input_tokens','cache_read_input_tokens','output_tokens'])
        from model_usage import receipt
        billing=receipt({'model':r.get('model'),'usage':{'prompt_tokens':miss+hit,'prompt_cache_hit_tokens':hit,'prompt_cache_miss_tokens':miss,
                          'completion_tokens':out,'total_tokens':miss+hit+out}},payload['model'])
    if not r.get('response_complete'):raise CallError('MODEL_ENVELOPE',status=status,unknown=True,model_usage=billing)
    return {'body':base64.b64encode(raw).decode()}, {'status':status,'elapsed_ms':round((time.monotonic()-start)*1000),
             'bytes':len(raw),'model_usage':billing}
