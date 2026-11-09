"""Safe diagnosis of a received 403, never a permission bypass or raw-body log.

The shared HTTP layer already buffers nonretryable errors within its deadline.
This parser consumes only that memory-backed body, exports fixed labels/hashes,
never retries, changes keys or resets the existing source-denial ledger.
"""
import hashlib,json,re
from typing import Any
from urllib.parse import urlsplit
from semantics import strict_json,Rejected

MAX_DIAGNOSTIC_BYTES=16384

def diagnose_denial(operation: str, url: str, status: int, body: bytes) -> dict[str, Any]:
    result={'event':'provider_access_denied','operation':operation,'http':status,
            'reason':'UNSPECIFIED_ACCESS_DENIED','body_sha256':hashlib.sha256(body).hexdigest(),
            'body_bytes_observed':len(body),'body_truncated':len(body)>MAX_DIAGNOSTIC_BYTES,
            'body_format':'NOT_PARSED','public_code':'HTTP_'+str(status)}
    if status!=403 or len(body)>MAX_DIAGNOSTIC_BYTES:return result
    try:value=strict_json(body.decode('utf-8'))
    except (ValueError,UnicodeError,TypeError,Rejected):return result
    if type(value)is not dict:return result
    result['body_format']='JSON_OBJECT'
    code=value.get('code');message=value.get('message')
    if type(code)is int:result['provider_code']=code
    # Treat only Ozon's received denial on its pinned API host as an Ozon cause.
    if urlsplit(url).netloc!='api-seller.ozon.ru' or type(message)is not str:return result
    text=message.casefold().replace('_',' ').replace('-',' ')
    from subscription_access import explicit_denial_products
    if code==7 and explicit_denial_products(message) and re.search(r'subscription|подписк|premium|управлени[ея]\s+отзывами',text):
        result.update(reason='OZON_PAID_SUBSCRIPTION_REQUIREMENT',public_code='HTTP_403_OZON_SUBSCRIPTION_REQUIRED')
    elif code==7 and re.search(r'(?:invalid|missing|insufficient|not enough|недостаточн|отсутств)\w*.*(?:permission|role|прав|роль)',text):
        result.update(reason='OZON_METHOD_PERMISSION_REQUIREMENT',public_code='HTTP_403_OZON_METHOD_PERMISSION')
    elif code==7 and re.search(r'access denied|permissiondenied|permission denied|доступ запрещ',text):
        result['reason']='OZON_ACCESS_DENIED_UNSPECIFIED'
    from subscription_access import enrich_denial
    return enrich_denial(result,'POST',url,code,message)
