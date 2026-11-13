"""Official Messages transport with incremental receipts and idle timeout."""
import base64,json,time,urllib.request,urllib.error,http.client,socket,ssl
from email.utils import parsedate_to_datetime
from engine import CallError
from shared_http import read_response
from model_program_policy import validate
from model_program_stream import Stream
from model_usage import RECEIPT_OBSERVER

def execute(transport,request,on_dispatch):
    payload=dict(request.body['payload'])
    if not transport.enabled:raise CallError('LIVE_DISABLED')
    validate(payload,transport.model_source.removeprefix('model:'))
    payload.pop('max_tokens',None)
    headers={'Content-Type':'application/json','x-api-key':transport._credential('deepseek'),
      'anthropic-version':'2023-06-01','anthropic-beta':'mid-conversation-tool-changes-2026-07-01'}
    http_request=urllib.request.Request('https://api.deepseek.com/anthropic/v1/messages',
        data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode(),headers=headers,method='POST')
    stream=Stream(payload['model'],RECEIPT_OBSERVER.get());start=time.monotonic()
    try:
        raw,status=read_response(http_request,timeout=transport.max_request_seconds,limit=12000000,
          on_dispatch=on_dispatch,on_chunk=stream.feed,
          idle_timeout=getattr(transport,'stream_idle_seconds',180))
    except urllib.error.HTTPError as exc:
        retry=exc.headers.get('Retry-After');due=None
        try:due=time.time()+max(0,int(retry)) if retry else None
        except (ValueError,TypeError):
            try:due=parsedate_to_datetime(retry).timestamp()
            except (ValueError,TypeError,OverflowError):pass
        status=exc.code;exc.close()
        raise CallError('HTTP_'+str(status),status=status,retry_at=due,model_usage=stream.billing)from None
    except (urllib.error.URLError,TimeoutError,ConnectionError,OSError,http.client.HTTPException) as exc:
        cause=exc.reason if isinstance(exc,urllib.error.URLError) else exc
        code=('NETWORK_DNS' if isinstance(cause,socket.gaierror) else
              'NETWORK_TLS' if isinstance(cause,ssl.SSLError) else
              'NETWORK_TIMEOUT' if isinstance(cause,TimeoutError) else
              'NETWORK_RESET' if isinstance(cause,ConnectionError) else 'NETWORK_OUTCOME_UNKNOWN')
        raise CallError(code,unknown=True,model_usage=stream.billing)from None
    except (ValueError,UnicodeError,TypeError):
        raise CallError('MODEL_ENVELOPE',unknown=True,model_usage=stream.billing)from None
    try:
        if not stream.seen:stream.feed(raw)
    except (ValueError,UnicodeError,TypeError):
        raise CallError('MODEL_ENVELOPE',status=status,unknown=True,model_usage=stream.billing)from None
    if stream.forbidden:raise CallError('MODEL_CAPABILITY_VIOLATION',status=status,unknown=True,model_usage=stream.billing)
    if not stream.complete:raise CallError('MODEL_ENVELOPE',status=status,unknown=True,model_usage=stream.billing)
    return {'body':base64.b64encode(raw).decode()}, {'status':status,
      'elapsed_ms':round((time.monotonic()-start)*1000),'bytes':len(raw),'model_usage':stream.billing}
