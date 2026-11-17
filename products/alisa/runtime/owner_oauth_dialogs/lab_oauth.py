"""Legacy skill token identity adapter for already configured Station socket.

This does not issue credentials. For modern platform tokens the actual Station
revalidates the owner identity using its existing service authentication. The
skill retains its ordinary account-linked response on failure.
"""
import re
import station_client


def account(token):
    if not isinstance(token,str) or not token.startswith('as6_') or len(token)>2048:
        return None
    try:
        reply=station_client.call({'op':'oauth_identity','access_token':token}, timeout=2.8)
        tenant=reply.get('native_tenant') if isinstance(reply,dict) else None
        if isinstance(tenant,str) and re.fullmatch(r'[A-Za-z0-9_:-]{1,128}',tenant):
            return tenant
    except (OSError,ValueError,TimeoutError):
        pass
    return None
