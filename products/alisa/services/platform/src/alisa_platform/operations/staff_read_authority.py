"""DB-backed staff read tickets using existing Django keys and staff policy.

No route, listener, permission grant, customer execution ticket or native write.
The authority process verifies current committed data in a bounded READ ONLY
transaction and never locks rows held by the initiating platform transaction.
The issuer/current checks may share that initiating transaction; they do not
change its isolation or acquire new row locks. Signing authenticates only this
five-second exact read, not a whole-job outcome or permission to replay it.
"""
from contextlib import contextmanager, nullcontext
from hashlib import sha256
import hmac
import math
import re
import time

from django.conf import settings
from django.core import signing
from django.db import connection, transaction
from django.utils import timezone

from alisa_platform.runtime_adapter.authority import RuntimeAuthority
from alisa_platform.staff.models import StaffSession
from alisa_platform.staff.policy import session_allowed
from . import reconciliation as core
from .platform_adapter import Target, target_snapshot

SCHEMA = 'alisa-staff-native-ticket/v1'
SALT = 'alisa.staff.native.read.v1'
LIFETIME = 5
FIELDS = frozenset({'schema','environment','service_id','catalog_bundle_hash',
    'session_id','staff_id','request_id','target_sha256','authority_revision',
    'scope','issued_at','expires_at'})
SCOPE_FIELDS = frozenset({'object_id','tenant_id','customer_id','runtime_job_ref',
                        'runtime_tenant','guard_sha256'})


def require(ok, code='AUTH_REQUIRED'):
    core.need(ok, code, 503 if code == 'AUTHORITY_UNAVAILABLE' else 403)


def _token(value):
    require(type(value) is str and 40 <= len(value) <= 80 and value.isascii())
    return sha256(value.encode()).hexdigest()


def _ticket(value):
    require(type(value) is str and 1 <= len(value) <= 4096 and value.isascii()
            and all(32 < ord(c) < 127 for c in value))
    return value


@contextmanager
def bounded_reads(seconds, *, ambient=False):
    """Real PostgreSQL per-statement deadline; no timeout-reset slow loop.

    Existing connection establishment and OS stalls are not preempted here.
    The authority RPC/Unix peer must also enforce its external I/O budget.
    This guard permits SELECT only, never a lock-taking callback or mutation.
    """
    require(type(seconds) in (int,float) and math.isfinite(seconds)
            and .005 <= seconds <= 2, 'AUTHORITY_UNAVAILABLE')
    require(connection.vendor == 'postgresql', 'AUTHORITY_UNAVAILABLE')
    joined = connection.in_atomic_block
    require(not joined or ambient, 'AUTHORITY_UNAVAILABLE')
    deadline = time.monotonic()+seconds
    def milliseconds():
        left = deadline-time.monotonic()
        require(left >= .002, 'AUTHORITY_UNAVAILABLE')
        return str(max(1, int(left*1000)))+'ms'
    with (nullcontext() if joined else transaction.atomic()):
        with connection.cursor() as cursor:
            if not joined:
                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            cursor.execute('SHOW statement_timeout');old_timeout=cursor.fetchone()[0]
        def execute_read(execute, sql, params, many, context):
            normalized = ' '.join(str(sql).upper().split())
            require(not many and normalized.startswith('SELECT ')
                    and re.search(r'\bFOR\s+(?:NO\s+KEY\s+UPDATE|KEY\s+SHARE|UPDATE|SHARE)\b',normalized) is None,
                    'AUTHORITY_UNAVAILABLE')
            # Apply the remaining TOTAL budget on the same driver cursor before
            # each statement, without recursive execute_wrapper invocations.
            context['cursor'].cursor.execute("SELECT set_config('statement_timeout', %s, true)",
                                             [milliseconds()])
            result = execute(sql, params, many, context)
            milliseconds()
            return result
        succeeded = False
        try:
            with connection.execute_wrapper(execute_read):
                yield
                milliseconds()
            succeeded = True
        except BaseException:
            if joined:
                transaction.set_rollback(True)
            raise
        finally:
            # A database error aborts the transaction: the caller must roll it
            # back rather than trying to repair/continue a failed read context.
            if succeeded and not connection.needs_rollback:
                try:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT set_config('statement_timeout', %s, true)",[old_timeout])
                except Exception:
                    if joined:
                        transaction.set_rollback(True)
                    raise


class StaffReadAuthority:
    def __init__(self, runtime_authority, catalog_bundle_hash):
        require(type(runtime_authority) is RuntimeAuthority,'AUTHORITY_UNAVAILABLE')
        core.digest_shape(catalog_bundle_hash)
        self.runtime,self.catalog = runtime_authority,catalog_bundle_hash

    def __repr__(self):
        return '<StaffReadAuthority; existing keys and current database authority>'

    def enabled(self):
        require(getattr(settings,'STAFF_ENABLED',False) is True)
        self.runtime.enabled()

    def _staff(self, *, token_hash=None, session_id=None):
        self.enabled()
        require((token_hash is None) != (session_id is None))
        rows = StaffSession.objects.select_related('member').only(
            'id','member_id','product_id','token_hash','revision','revoked_at',
            'expires_at','created_at','mfa_verified_at','mfa_type',
            'member__id','member__product_id','member__issuer','member__client_id',
            'member__active','member__revision','member__role','member__permissions')
        row = rows.filter(**({'token_hash':token_hash} if token_hash is not None
                             else {'pk':core.identifier(session_id)})).first()
        require(row is not None)
        member=row.member
        m={'product_id':member.product_id,'issuer':member.issuer,'client_id':member.client_id,
           'active':member.active,'revision':member.revision,'role':member.role,
           'permissions':member.permissions}
        s={'product_id':row.product_id,'revision':row.revision,'revoked':row.revoked_at is not None,
           'expires_at':row.expires_at.timestamp(),'created_at':row.created_at.timestamp(),
           'mfa_at':row.mfa_verified_at.timestamp(),'mfa_type':row.mfa_type}
        require(session_allowed(m,s,issuer=settings.IDENTITY_ISSUER,client=settings.STAFF_CLIENT_ID,
                                now=timezone.now().timestamp(),permission=core.PERMISSION) is True)
        # This data stays inside the hash. Neither token nor private encrypted
        # payload/subject/name is selected, returned or logged by this service.
        fingerprint=core.mark({'session_id':str(row.pk),'staff_id':str(member.pk),
                               'member':m,'session':s,'token_hash':row.token_hash})
        until=min(s['expires_at'],s['mfa_at']+300,s['created_at']+3600)
        return row,fingerprint,until

    def _context(self, row, staff_fingerprint, object_id):
        target=target_snapshot(object_id,lock_rows=False)
        require(type(target) is Target)
        pins,scope,access_until=self.runtime.read_state(target.customer_id,target.tenant_id,
                                                       [item[0] for item in target.store_scope])
        # Exact RuntimePort guard construction, not a customer SessionPrincipal
        # or manufactured execution ticket. No customer login is impersonated.
        guard={'version':'runtime_guard_v1','pins':pins,'scope_hash':core.mark(scope),
               'runtime_tenant':scope['tenant'],'catalog_bundle_hash':self.catalog}
        native={'object_id':target.object_id,'tenant_id':target.tenant_id,
                'customer_id':target.customer_id,'runtime_job_ref':target.runtime_job_ref,
                'runtime_tenant':scope['tenant'],'guard_sha256':core.mark(guard)}
        revision=core.mark({'staff':staff_fingerprint,'target':target.binding,'guard':guard})
        return target,native,revision,access_until

    def issue(self, token, target, request_id, *, remaining):
        try:
            require(type(target) is Target);core.digest_shape(request_id)
            with bounded_reads(remaining,ambient=True):
                row,fingerprint,until=self._staff(token_hash=_token(token))
                current,scope,revision,access_until=self._context(row,fingerprint,target.object_id)
                require(current == target,'AUTH_CHANGED')
                now=timezone.now().timestamp();expiry=min(now+LIFETIME,until,access_until)
                require(expiry>now)
                value={'schema':SCHEMA,'environment':settings.ALISA_ENV,
                    'service_id':self.runtime.service_id,'catalog_bundle_hash':self.catalog,
                    'session_id':str(row.pk),'staff_id':str(row.member_id),'request_id':request_id,
                    'target_sha256':target.binding,'authority_revision':revision,'scope':scope,
                    'issued_at':now,'expires_at':expiry}
                ticket=signing.dumps(value,salt=SALT,compress=False)
                _ticket(ticket)
            require(timezone.now().timestamp()<expiry)
            return ticket
        except core.ReconcileError:
            raise
        except Exception:
            raise core.ReconcileError('AUTHORITY_UNAVAILABLE',503) from None

    def _verify(self, ticket, request_id, target_sha256, *, remaining, token=None, ambient=False):
        try:
            _ticket(ticket);core.digest_shape(request_id);core.digest_shape(target_sha256)
            value=signing.loads(ticket,salt=SALT,max_age=LIFETIME)
            require(type(value) is dict and set(value)==FIELDS)
            require(value['schema']==SCHEMA and value['environment']==settings.ALISA_ENV
                    and value['service_id']==self.runtime.service_id
                    and value['catalog_bundle_hash']==self.catalog
                    and value['request_id']==request_id and value['target_sha256']==target_sha256)
            require(type(value['scope']) is dict and set(value['scope'])==SCOPE_FIELDS)
            core.identifier(value['staff_id']);core.identifier(value['session_id'])
            core.digest_shape(value['authority_revision'])
            issued=core.stamp(value['issued_at']);expiry=core.stamp(value['expires_at'])
            def live():require(issued<=timezone.now().timestamp()<expiry<=issued+LIFETIME)
            live()
            with bounded_reads(remaining,ambient=ambient):
                row,fingerprint,until=self._staff(session_id=value['session_id'])
                require(str(row.member_id)==value['staff_id'])
                if token is not None:require(hmac.compare_digest(row.token_hash,_token(token)))
                target,scope,revision,access_until=self._context(row,fingerprint,value['scope']['object_id'])
                require(target.binding==target_sha256 and scope==value['scope']
                        and revision==value['authority_revision'],'AUTH_CHANGED')
                require(expiry<=min(until,access_until))
                live()
            live()
            return {'request_id':request_id,'target_sha256':target_sha256,'staff_id':value['staff_id'],
                'authority_revision':revision,'scope':scope,'issued_at':issued,'expires_at':expiry,
                'permission':core.PERMISSION}
        except core.ReconcileError:
            raise
        except signing.BadSignature:
            raise core.ReconcileError('AUTH_REQUIRED',403) from None
        except Exception:
            raise core.ReconcileError('AUTHORITY_UNAVAILABLE',503) from None

    def verify(self,ticket,request_id,target_sha256,*,remaining):
        """Independent callback connection: no ambient transaction/row locking."""
        return self._verify(ticket,request_id,target_sha256,remaining=remaining)

    def current(self,token,ticket,request_id,target_sha256,*,remaining):
        self._verify(ticket,request_id,target_sha256,remaining=remaining,token=token,ambient=True)
        return True

    def for_target(self,token,target):
        return StaffReadAuthorizer(self,token,target)


class StaffReadAuthorizer:
    def __init__(self,authority,token,target):
        require(type(authority) is StaffReadAuthority and type(target) is Target)
        _token(token)
        self._authority,self._token,self._target=authority,token,target

    def __repr__(self):return '<StaffReadAuthorizer; private staff session>'

    def prepare(self,request_id,target_sha256,*,remaining):
        require(target_sha256==self._target.binding)
        return self._authority.issue(self._token,self._target,request_id,remaining=remaining)

    def current(self,ticket,request_id,target_sha256,*,remaining):
        require(target_sha256==self._target.binding)
        return self._authority.current(self._token,ticket,request_id,target_sha256,remaining=remaining)
