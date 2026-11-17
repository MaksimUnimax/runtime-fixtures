"""Read-only cross-version OAuth verification via current platform service.

Only the existing Station ingress, uid alice-lab, may invoke this helper. The
legacy OAuth token does not become a staff/cabinet permission. Fail closed if
no verified owner/native binding exists. Never save/print/store token bytes.
"""
import re
import json
import os
import time
import http.client


def platform(data):
    """Bounded read-only OAuth RPC on the existing authenticated endpoint.

    Not station_parameters.platform: that function intentionally targets the
    coefficient mutation endpoint. No proxy environment, redirects or retries.
    This client accepts only the two currentness actions, not token issuance.
    """
    if type(data) is not dict or data.get('action') not in (
            'legacy_station_identity','legacy_station_token_current',
            'legacy_station_token_refreshable'):
        raise ValueError('OAUTH_RPC_ACTION')
    base=os.environ.get('ALISA_PLATFORM_URL','').rstrip('/')
    ports={'http://127.0.0.1:18102':18102,'http://127.0.0.1:18104':18104}
    secret=os.environ.get('ALISA_AUTH_SERVICE_TOKEN','')
    if base not in ports or not 32<=len(secret)<=4096 or any(ord(c)<33 or ord(c)>126 for c in secret):
        raise ValueError('OAUTH_RPC_CONFIG')
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    if len(raw)>4096:raise ValueError('OAUTH_RPC_SIZE')
    deadline=time.monotonic()+1.5
    connection=http.client.HTTPConnection('127.0.0.1',ports[base],timeout=1.5)
    try:
        connection.request('POST','/api/v1/account/alice',raw,
            {'Authorization':'Bearer '+secret,'Content-Type':'application/json','Connection':'close'})
        response=connection.getresponse()
        if response.status!=200:raise ValueError('OAUTH_RPC_REJECTED')
        if response.getheader('Transfer-Encoding') or response.getheader('Content-Encoding'):
            raise ValueError('OAUTH_RPC_ENCODING')
        length=response.getheader('Content-Length')
        if length is None or not length.isascii() or not length.isdecimal() or not 0<int(length)<=4096:
            raise ValueError('OAUTH_RPC_SIZE')
        chunks=[];left=int(length)
        # read1 makes progress with available bytes; each wait uses the remaining
        # whole-call budget instead of resetting a timeout for every fragment.
        while left:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('OAUTH_RPC_TIMEOUT')
            response.fp.raw._sock.settimeout(remaining)
            part=response.read1(left)
            if not part:raise ValueError('OAUTH_RPC_TRUNCATED')
            chunks.append(part);left-=len(part)
        def unique(pairs):
            result={}
            for key,value in pairs:
                if key in result:raise ValueError('OAUTH_RPC_DUPLICATE')
                result[key]=value
            return result
        value=json.loads(b''.join(chunks),object_pairs_hook=unique)
        if type(value)is not dict:raise ValueError('OAUTH_RPC_RESPONSE')
        return value
    finally:connection.close()



class InvalidOAuth(ValueError):
    pass


def owner(token):
    if not isinstance(token,str) or not token.startswith('as6_') or len(token)>2048:
        raise InvalidOAuth('VOICE_AUTH_REQUIRED')
    try:
        reply=platform({'action':'legacy_station_identity','access_token':token})
        if not isinstance(reply,dict) or set(reply) not in (
                {'identity'},{'identity','environment','release'}):raise ValueError()
        value=reply['identity']
        if not isinstance(value,dict) or set(value)!={'owner','native_tenant','platform_tenant'}:raise ValueError()
        if not all(isinstance(value[k],str) and value[k] and len(value[k])<=128 for k in value):raise ValueError()
        if re.fullmatch(r'[A-Za-z0-9_:-]{1,128}',value['native_tenant']) is None:raise ValueError()
        return value
    except Exception:
        # Do not leak tokens, upstream URLs, DB errors, tenant IDs or auth hints.
        raise InvalidOAuth('VOICE_AUTH_REQUIRED') from None


def current(owner,tenant,token_hash):
    """Recheck access validity without retaining a bearer in Station state."""
    if not all(isinstance(v,str) for v in (owner,tenant,token_hash)):
        return False
    if re.fullmatch(r'[a-f0-9]{64}',token_hash) is None or re.fullmatch(r'[A-Za-z0-9_:-]{1,128}',tenant) is None:
        return False
    try:
        value=platform({'action':'legacy_station_token_current',
                        'owner':owner,'native_tenant':tenant,'token_hash':token_hash})
        return (type(value) is dict and set(value) in (
                {'current'},{'current','environment','release'}) and
                value.get('current') is True)
    except Exception:
        return False


def refreshable(owner,tenant,token_hash):
    """Only allow existing job wake-up; never substitute for current access."""
    if not all(isinstance(v,str) for v in (owner,tenant,token_hash)):
        return False
    if re.fullmatch(r'[a-f0-9]{64}',token_hash) is None or re.fullmatch(r'[A-Za-z0-9_:-]{1,128}',tenant) is None:
        return False
    try:
        value=platform({'action':'legacy_station_token_refreshable',
                        'owner':owner,'native_tenant':tenant,'token_hash':token_hash})
        return (type(value)is dict and set(value) in (
                {'current'},{'current','environment','release'}) and value.get('current') is True)
    except Exception:return False


def job_access(owner,tenant,token_hash):
    """Unavailable authority is retryable, not evidence of token revocation."""
    if not all(isinstance(v,str) for v in (owner,tenant,token_hash)) or re.fullmatch(r'[a-f0-9]{64}',token_hash) is None:
        raise InvalidOAuth('VOICE_AUTH_REQUIRED')
    def checked(action):
        value=platform({'action':action,'owner':owner,'native_tenant':tenant,'token_hash':token_hash})
        if type(value)is not dict or set(value) not in ({'current'},{'current','environment','release'}) or type(value['current'])is not bool:
            raise InvalidOAuth('VOICE_AUTH_UNAVAILABLE')
        return value['current']
    active=checked('legacy_station_token_current')
    return active,active or checked('legacy_station_token_refreshable')
