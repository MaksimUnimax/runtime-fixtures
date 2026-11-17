"""Read-only staff callback over the EXISTING private authority protocol.

Startup supplies the already-authorized PlatformAuthorityClient. No secret
file, signing key, fallback, listener or customer execution ticket is created.
The request uses its own short-lived client copy to avoid mutating a shared
transport timeout; peer authentication, MAC and outer request binding are the
existing native authority client's implementation, not a boolean substitute.
"""
from copy import copy
import math
import time

from platform_authority_client import PlatformAuthorityClient
from .read_channel import Grant, ChannelError, require, hash_value, ticket_value
from .native_snapshot import NativeScope

OPERATION='staff_reconciliation_read'
FIELDS=frozenset({'request_id','target_sha256','staff_id','authority_revision',
                 'scope','issued_at','expires_at','permission'})
SCOPE_FIELDS=frozenset({'object_id','tenant_id','customer_id','runtime_job_ref',
                       'runtime_tenant','guard_sha256'})


class PrivateStaffVerifier:
    def __init__(self, authority_client):
        require(type(authority_client) is PlatformAuthorityClient,'AUTH_REQUIRED')
        self._authority=authority_client

    def __repr__(self):return '<PrivateStaffVerifier; existing authenticated authority transport>'

    def verify(self,ticket,request_id,target_sha256,*,remaining):
        try:
            ticket_value(ticket);hash_value(request_id);hash_value(target_sha256)
            require(type(remaining) in (int,float) and math.isfinite(remaining)
                    and .02 <= remaining <= 2,'CHANNEL_TIMEOUT')
            deadline=time.monotonic()+remaining
            client=copy(self._authority)
            client.timeout=min(client.timeout,remaining)
            result=client._call(OPERATION,{'ticket':ticket,'request_id':request_id,
                'target_sha256':target_sha256,'budget_ms':max(5,int(remaining*1000))})
            require(time.monotonic()<deadline,'CHANNEL_TIMEOUT')
            require(type(result) is dict and set(result)==FIELDS
                    and type(result['scope']) is dict and set(result['scope'])==SCOPE_FIELDS,
                    'AUTH_REQUIRED')
            grant=Grant(**{**result,'scope':NativeScope(**result['scope'])})
            return grant.validate(request_id,target_sha256,time.time())
        except ChannelError:
            raise
        except Exception as error:
            code = 'AUTH_REQUIRED' if getattr(error,'code',None) in {
                'AUTH_REQUIRED','PERMISSION_DENIED','ACCOUNT_BLOCKED','ACCESS_REQUIRED','CREDENTIAL_REVOKED'
            } else 'CHANNEL_UNAVAILABLE'
            raise ChannelError(code) from None
