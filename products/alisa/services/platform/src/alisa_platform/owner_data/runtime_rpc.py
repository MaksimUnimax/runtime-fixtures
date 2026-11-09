"""Read-only owner authority across a trusted service boundary.

Browser sessions issue scoped signed tickets only inside the platform. The market
runtime receives no session token and no database credentials. Every check reads
current platform state; a signature never substitutes for current permissions.
"""
from copy import deepcopy
import hashlib,hmac,json,re
from django.conf import settings
from django.core import signing
from django.db import transaction,DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from alisa_platform.accounts.models import WebSession,Customer,Tenant,Membership
from alisa_platform.accounts.views import session
from alisa_platform.stores.service import owned,Rejected as StoreRejected
from .source import DjangoOwnerSource
from .service import Rejected,need
from .owner_inputs import canonical,digest,strict_loads,period

SALT='alisa.owner.runtime.ticket.v1'
SCHEMA='alice-owner-rpc/v1'
MAX_BODY=131072


def enabled():
    key=getattr(settings,'OWNER_RUNTIME_AUTH_TOKEN','')
    return (getattr(settings,'OWNER_RUNTIME_ENABLED',False)is True and
            getattr(settings,'OWNER_DATA_ENABLED',False)is True and
            type(key)is str and re.fullmatch(r'[A-Za-z0-9_-]{43,128}',key)is not None)


def prepare_for_runtime(session_token,store_id,report_period):
    """Trusted platform call; never expose this return value through the browser API."""
    need(enabled(),'OWNER_RUNTIME_UNAVAILABLE',503)
    source=DjangoOwnerSource(session_token,store_id)
    inputs=source.issue(report_period)
    actor=session({'session_token':session_token})
    need(actor is not None,'AUTHENTICATION_REQUIRED',401)
    source.bind(inputs,report_period)
    data={'schema':'alice-owner-ticket/v1','environment':settings.ALISA_ENV,'product':'alisa_market',
          'session_id':str(actor.pk),'tenant':str(actor.tenant_id),'actor':str(actor.customer_id),
          'store':store_id,'issued_at':inputs['issued_at'],'expires_at':inputs['expires_at'],
          'inputs_hash':digest(inputs),'period':deepcopy(report_period)}
    return {'schema':'alice-owner-runtime-prepared/v1','inputs':inputs,'period':deepcopy(report_period),
            'ticket':signing.dumps(data,salt=SALT,compress=False)}


class _TicketSource(DjangoOwnerSource):
    def __init__(self,reference):
        # Only constructed below AFTER signature/audience/period validation.
        self._reference=deepcopy(reference);self.store_id=reference['store']
        self.required_credentials=('SELLER','PERFORMANCE');self.bound=None;self.bound_period=None

    def _actor_store(self):
        ref=self._reference
        def current_session():
            row=WebSession.objects.select_related('customer','tenant').filter(pk=ref['session_id'],
                customer_id=ref['actor'],tenant_id=ref['tenant'],revoked_at__isnull=True,
                expires_at__gt=timezone.now()).first()
            if not row or not row.customer.is_active or row.security_revision!=row.customer.security_revision:return None
            if not Membership.objects.filter(customer=row.customer,tenant=row.tenant,role='OWNER_CLIENT').exists():return None
            return row
        row=current_session();need(row is not None,'OWNER_SOURCE_AUTH_CHANGED',403)
        Customer.objects.select_for_update().get(pk=row.customer_id)
        row=current_session();need(row is not None,'OWNER_SOURCE_AUTH_CHANGED',403)
        Tenant.objects.select_for_update().get(pk=row.tenant_id)
        try:store=owned(row,self.store_id)
        except StoreRejected as e:raise Rejected(e.code,e.status)from None
        need(store.status=='ACTIVE','OWNER_SOURCE_STORE_DISABLED',403)
        return row,store


def ticket_source(ticket,inputs,report_period):
    need(type(ticket)is str and 1<=len(ticket)<=4096,'OWNER_TICKET_INVALID',403)
    try:data=signing.loads(ticket,salt=SALT,max_age=300)
    except signing.BadSignature:raise Rejected('OWNER_TICKET_INVALID',403)from None
    fields={'schema','environment','product','session_id','tenant','actor','store','issued_at','expires_at','inputs_hash','period'}
    need(type(data)is dict and set(data)==fields and data['schema']=='alice-owner-ticket/v1'and
         data['environment']==settings.ALISA_ENV and data['product']=='alisa_market','OWNER_TICKET_INVALID',403)
    for k in ('session_id','tenant','actor','store'):
        need(type(data[k])is str and re.fullmatch(r'[a-f0-9-]{36}',data[k])is not None,'OWNER_TICKET_INVALID',403)
    now=int(timezone.now().timestamp());a,b=data['issued_at'],data['expires_at']
    need(type(a)is int and type(b)is int and a<=now<b and 0<b-a<=300,'OWNER_TICKET_EXPIRED',403)
    period(report_period)
    need(data['period']==report_period and data['inputs_hash']==digest(inputs),'OWNER_TICKET_INPUT_CHANGED',403)
    source=_TicketSource(data)
    source.bind(inputs,report_period)
    return source


def dispatch(body):
    common={'schema','request_id','ticket','inputs','period','operation'}
    extra={'scope':{'tenant'},'graph':{'action','plan'},'owner':{'kind','metadata','request','action'}}
    need(type(body)is dict and body.get('operation')in extra,'OWNER_RPC_SCHEMA',422)
    op=body['operation'];need(set(body)==common|extra[op]and body['schema']==SCHEMA,'OWNER_RPC_SCHEMA',422)
    need(type(body['request_id'])is str and re.fullmatch(r'[a-f0-9]{32}',body['request_id'])is not None,'OWNER_RPC_SCHEMA',422)
    source=ticket_source(body['ticket'],body['inputs'],body['period'])
    result={'schema':SCHEMA,'request_id':body['request_id'],'allowed':False}
    if op=='scope':
        state=source._current_bound();need(body['tenant']==state['scope']['tenant'],'OWNER_RUNTIME_DENIED',403)
        result.update(allowed=True,scope=state['scope'])
    elif op=='graph':result['allowed']=source.graph_authority(body['action'],body['plan'])is True
    else:result['allowed']=source.owner_authority(body['kind'],body['metadata'],body['request'],body['action'])is True
    if not result['allowed']:result['code']='OWNER_RUNTIME_DENIED'
    return result


def signed_reply(value,key,status=200):
    mac=hmac.new(key.encode(),canonical(value),hashlib.sha256).hexdigest()
    return JsonResponse({'payload':value,'mac':mac},status=status,json_dumps_params={'ensure_ascii':False},
       headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})


@csrf_exempt
def check(request):
    if not enabled():return JsonResponse({'code':'NOT_FOUND'},status=404)
    key=settings.OWNER_RUNTIME_AUTH_TOKEN
    if request.method!='POST'or request.content_type!='application/json'or request.META.get('QUERY_STRING')or request.headers.get('Origin'):
        return JsonResponse({'code':'OWNER_RPC_SCHEMA'},status=422)
    expected=('Bearer '+key).encode()
    if not hmac.compare_digest(request.headers.get('Authorization','').encode(),expected):return JsonResponse({'code':'UNAUTHORIZED'},status=401)
    if len(request.body)>MAX_BODY:return JsonResponse({'code':'OWNER_RPC_CAPACITY'},status=413)
    request_id=None
    try:
        body=strict_loads(request.body.decode('utf-8'))
        if type(body)is dict and type(body.get('request_id'))is str and re.fullmatch(r'[a-f0-9]{32}',body['request_id']):request_id=body['request_id']
        value=dispatch(body)
        return signed_reply(value,key)
    except (Rejected,ValueError,TypeError,KeyError,DatabaseError):
        # Never reflect exception text, user facts, ticket or backend diagnostics.
        return signed_reply({'schema':SCHEMA,'request_id':request_id,'allowed':False,'code':'OWNER_RUNTIME_DENIED'},key,403)
