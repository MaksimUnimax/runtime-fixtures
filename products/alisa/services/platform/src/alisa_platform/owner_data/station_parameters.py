"""Existing Station binding -> current owner -> shared manual parameter writer.

The service credential is transport admission, not an owner grant. Mutations
also require an exact turn proved by the native peer through Station's existing
private authority, and cabinet-signed consent. No OAuth family is fabricated.
"""
import hashlib,json,re,uuid
from types import SimpleNamespace
from django.conf import settings
from django.core import signing
from django.db import transaction
from alisa_platform.accounts.models import Customer,Tenant,WebSession,Membership
from alisa_platform.accounts.views import boundary,session
from alisa_platform.foundation.views import reply
from alisa_platform.stores.models import RuntimeTenantBinding
from alisa_platform.runtime_adapter.client import configured_client
from .service import need,Rejected
from . import parameter_voice as voice,parameter_service as parameters

SALT='alisa-station-parameter-consent/v1'
SCHEMA='alisa-station-parameter-authority/v1'

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def grant(data):
    need(set(data)=={'action','session_token','binding','permission_revision','confirmed'},'PARAMETER_SCHEMA',422)
    need(data['confirmed'] is True,'OWNER_CONFIRMATION_REQUIRED',422)
    need(type(data['binding'])is str and re.fullmatch('[a-f0-9]{64}',data['binding'])is not None,'PARAMETER_SCHEMA',422)
    need(type(data['permission_revision'])is int and 1<=data['permission_revision']<=2147483647,'PARAMETER_REVISION',422)
    with transaction.atomic():
        row=session(data);need(row is not None,'AUTHENTICATION_REQUIRED',401)
        Customer.objects.select_for_update().get(pk=row.customer_id)
        WebSession.objects.select_for_update().get(pk=row.pk)
        row=session(data);need(row is not None,'AUTHENTICATION_REQUIRED',401)
        value={'schema':SCHEMA,'owner':str(row.customer_id),'tenant':str(row.tenant_id),
               'security_revision':row.customer.security_revision,'binding':data['binding'],
               'permission_revision':data['permission_revision']}
        return {'grant':signing.dumps(value,salt=SALT,compress=True)}

class _NoRuntimeMutation:
    # configured_client requires an authorizer but this operation ONLY verifies
    # a current Station turn. It never submits/reads/cancels a runtime job.
    def prepare(self,operation):raise Rejected('PERMISSION_DENIED',403)
    def current(self,context,operation):return False

class StationProof:
    def __init__(self):self.client=configured_client(_NoRuntimeMutation())
    def current(self,guard,turn_hash):
        self.client.current_versions()
        def checked(value):
            fields={'schema','allowed','owner','native_tenant','binding','permission_revision','grant','conversation','message_id','turn_hash'}
            need(type(value)is dict and set(value)==fields and value['schema']==SCHEMA
                 and value['allowed'] is True and value['turn_hash']==turn_hash,'VOICE_PARAMETER_CONSENT_REQUIRED',403)
            need(value['owner']==guard['owner'] and value['native_tenant']==guard['tenant']
                 and value['conversation']==guard['conversation'],'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
            need(type(value['message_id'])is int and 0<=value['message_id']<2**31,'PARAMETER_VOICE_SESSION',422)
            return value
        return self.client._exchange('station_parameter_authority',{'guard':guard,'turn_hash':turn_hash},checked)

def execute(data,*,verifier=None):
    need(voice.enabled(),'NOT_FOUND',404);parameters._enabled()
    need(set(data)=={'action','guard','turn'},'PARAMETER_SCHEMA',422)
    guard,turn=data['guard'],data['turn']
    need(type(guard)is dict and set(guard)=={'schema','owner','tenant','application','conversation','ticket'}
         and guard['schema']=='station-clarification-authority/v1','PARAMETER_SCHEMA',422)
    need(all(type(guard[k])is str and 1<=len(guard[k])<=128 for k in guard),'PARAMETER_SCHEMA',422)
    need(type(turn)is dict and set(turn)=={'text','pending','message_id'},'PARAMETER_SCHEMA',422)
    need(type(turn['text'])is str and len(turn['text'])<=1200 and
         (turn['pending']is None or type(turn['pending'])is str and len(turn['pending'])<=4096),'PARAMETER_SCHEMA',422)
    need(type(turn['message_id'])is int and 0<=turn['message_id']<2**31,'PARAMETER_VOICE_SESSION',422)
    authority=verifier if verifier is not None else StationProof()
    turn_hash=digest(turn)
    proof=authority.current(guard,turn_hash)
    try:consent=signing.loads(proof['grant'],salt=SALT)
    except (signing.BadSignature,ValueError,TypeError):raise Rejected('VOICE_PARAMETER_CONSENT_REQUIRED',403)from None
    expected={'schema','owner','tenant','security_revision','binding','permission_revision'}
    need(type(consent)is dict and set(consent)==expected and consent['schema']==SCHEMA,'VOICE_PARAMETER_CONSENT_REQUIRED',403)
    need(consent['owner']==proof['owner'] and consent['binding']==proof['binding']
         and consent['permission_revision']==proof['permission_revision']
         and turn['message_id']==proof['message_id'],'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
    with transaction.atomic():
        customer=Customer.objects.select_for_update().get(pk=uuid.UUID(consent['owner']))
        tenant=Tenant.objects.select_for_update().get(pk=uuid.UUID(consent['tenant']))
        need(customer.is_active and customer.security_revision==consent['security_revision']
             and Membership.objects.filter(customer=customer,tenant=tenant,role='OWNER_CLIENT').exists(),'AUTH_REQUIRED',403)
        need(RuntimeTenantBinding.objects.filter(tenant=tenant,native_tenant=proof['native_tenant']).exists(),'PARAMETER_VOICE_BINDING_UNAVAILABLE',403)
        need(authority.current(guard,turn_hash)==proof,'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
        actor=SimpleNamespace(customer=customer,customer_id=customer.pk,tenant=tenant,tenant_id=tenant.pk)
        binding={'kind':'LEGACY_STATION','id':proof['binding'],'revision':proof['permission_revision'],
                 'security_revision':customer.security_revision}
        sid=hashlib.sha256(proof['conversation'].encode()).hexdigest()
        result=voice.turn(actor,binding,turn['text'],turn['pending'],sid,turn['message_id'],private=True)
        need(result is not None,'PARAMETER_VOICE_INPUT',422)
        # A changed read proof aborts the SAME database transaction, including
        # the shared coefficient mutation and metadata-only receipt.
        need(authority.current(guard,turn_hash)==proof,'PARAMETER_VOICE_CONFIRMATION_CHANGED',409)
        return result

@boundary
def handle(request,data):
    from alisa_platform.runtime_adapter.job_client import RuntimeFailure
    try:
        need(voice.enabled(),'NOT_FOUND',404)
        if data.get('action')=='grant':return reply(grant(data))
        need(data.get('action')=='turn','PARAMETER_ACTION',422)
        return reply({'skill_response':execute(data)})
    except (Rejected,voice.ParameterError) as error:return reply({'code':error.code},getattr(error,'status',422))
    except RuntimeFailure as error:return reply({'code':error.code},error.http_status)
    except (Customer.DoesNotExist,Tenant.DoesNotExist):return reply({'code':'AUTH_REQUIRED'},403)
