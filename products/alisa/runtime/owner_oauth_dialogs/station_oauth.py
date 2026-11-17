"""Read-only cross-version OAuth verification via current platform service.

Only the existing Station ingress, uid alice-lab, may invoke this helper. The
legacy OAuth token does not become a staff/cabinet permission. Fail closed if
no verified owner/native binding exists. Never save/print/store token bytes.
"""
import re
from station_parameters import platform


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
