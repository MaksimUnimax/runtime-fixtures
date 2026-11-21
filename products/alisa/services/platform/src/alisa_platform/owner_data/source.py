"""Current DB-backed producer/verifier for the existing matrix owner boundary.

The authenticated platform session stays in memory, never in graph inputs.
Only nonsecret credential state is read. No marketplace or arbitrary URL access.
"""
from dataclasses import asdict
from datetime import datetime,timezone as dt_timezone
from copy import deepcopy
import json
from zoneinfo import ZoneInfo
from django.conf import settings
from django.db import transaction,DatabaseError
from django.utils import timezone
from alisa_platform.stores.models import CredentialRevision
from alisa_platform.entitlements.service import snapshot as access_snapshot
from .models import PRODUCT,OwnerDataset
from .service import actor_store,need,Rejected,RESOLVER,CATALOG,validate_facts
from .owner_inputs import digest,period

ISSUER='alisa-platform-owner-data-v1'

class DjangoOwnerSource:
    """A trusted service object, not callable code accepted from an NLP request."""
    def __init__(self,session_token,store_id,required_credentials=('SELLER','PERFORMANCE')):
        need(type(session_token)is str and 40<=len(session_token)<=80,'AUTHENTICATION_REQUIRED',401)
        need(type(required_credentials)is tuple and required_credentials in
             (('SELLER','PERFORMANCE'),('SELLER',),('WB',)),'OWNER_SOURCE_POLICY')
        self._token=session_token;self.store_id=store_id;self.required_credentials=required_credentials
        self.bound=None;self.bound_period=None

    def _actor_store(self):
        return actor_store(self._token,self.store_id)

    @transaction.atomic
    def current(self):
        need(getattr(settings,'OWNER_DATA_ENABLED',False)is True,'OWNER_SOURCE_DISABLED',403)
        actor,store=self._actor_store()
        need(bool(store.verified_identity),'OWNER_SOURCE_STORE_UNVERIFIED')
        need((store.provider=='OZON' and self.required_credentials in (('SELLER','PERFORMANCE'),('SELLER',)))or
             (store.provider=='WB'and self.required_credentials==('WB',)),'OWNER_SOURCE_POLICY')
        access=access_snapshot(actor.tenant_id)
        need(access['status']=='ACTIVE'and access['active_until'],'OWNER_SOURCE_ACCESS_DENIED',403)
        credentials=[]
        for kind in self.required_credentials:
            rows=list(CredentialRevision.objects.filter(product_id=PRODUCT,tenant_id=actor.tenant_id,
                store=store,kind=kind,status='ACTIVE').values('id','kind','revision','check_code')[:2])
            need(len(rows)==1 and rows[0]['check_code']=='CONNECTED','OWNER_SOURCE_CREDENTIAL_UNQUALIFIED',403)
            credentials.append({**rows[0],'id':str(rows[0]['id'])})
        row=OwnerDataset.objects.select_for_update().filter(store=store,tenant_id=actor.tenant_id,
                                                           product_id=PRODUCT).first()
        need(row is not None and row.status=='APPROVED'and row.approval_id is not None,'OWNER_SOURCE_NOT_APPROVED')
        need(row.approved_by_id==actor.customer_id and
             row.approved_security_revision==actor.customer.security_revision,'OWNER_SOURCE_APPROVAL_CHANGED',403)
        need(row.catalog_hash==RESOLVER.hash,'OWNER_SOURCE_CATALOG_CHANGED')
        need(row.content_hash==digest(row.facts),'OWNER_SOURCE_FACTS_CHANGED')
        validate_facts(row.facts,actor,store)
        need(settings.ALISA_ENV in ('stage','prod','synthetic'),'OWNER_SOURCE_ENVIRONMENT')
        rights={'environment':settings.ALISA_ENV,'product_id':PRODUCT,'tenant':str(actor.tenant_id),'actor':str(actor.customer_id),'security_revision':actor.customer.security_revision,
                'access_revision':access['revision'],'store_revision':store.revision}
        credential_hash=digest(credentials)
        scope={'tenant':str(actor.tenant_id),'revision':'platform:'+digest(rights),'stores':[{
            'id':str(store.pk),'platform':store.provider.lower(),'identity':store.verified_identity,
            'access_revision':'store:'+str(store.revision),'source_revision':'credentials:'+credential_hash,'currency':'RUB'}]}
        return {'scope':scope,'rights':rights,'revision':row.revision,'approval_id':str(row.approval_id),
                'approved_at':int(row.approved_at.timestamp()),'facts':deepcopy(row.facts),
                'catalog_hash':row.catalog_hash,'content_hash':row.content_hash,'issuer':ISSUER+':'+settings.ALISA_ENV,
                'authority_expires_at':min(int(actor.expires_at.timestamp()),
                      int(datetime.fromisoformat(access['active_until']).timestamp()))}

    @staticmethod
    def make_bundle(state,issued,expires):
        scope=state['scope'];scope_hash=digest(scope);sid=scope['stores'][0]['id']
        payload={'schema':'alice-owner-input-snapshot/v1','revision':'owner:'+sid+':'+str(state['revision']),
            'scope_hash':scope_hash,'catalog_hash':state['catalog_hash'],'issued_at':issued,'expires_at':expires,
            'entries':deepcopy(state['facts']['entries'])}
        return {'schema':'alice-owner-binding/v1','issuer':state['issuer'],'approval_ref':'approval:'+state['approval_id'],
            'binding_revision':'owner-binding:'+str(state['revision']),'scope_hash':scope_hash,'store_id':sid,
            'store_entity':'store:'+sid,'mapping_revision':'sku-map:'+digest(state['facts']['product_map']),
            'product_map':deepcopy(state['facts']['product_map']),'snapshot':{'payload':payload,'sha256':digest(payload)}}

    def issue(self,report_period,lifetime_seconds=300):
        period(report_period)
        need(type(lifetime_seconds)is int and 30<=lifetime_seconds<=300,'OWNER_SOURCE_LIFETIME')
        state=self.current();now=int(timezone.now().timestamp());expires=min(now+lifetime_seconds,state['authority_expires_at'])
        need(expires>now,'OWNER_SOURCE_AUTH_EXPIRED',403)
        bundle=self.make_bundle(state,now,expires)
        inputs={'schema':'alice-graph-inputs/v1','revision':'platform-owner:'+str(state['revision']),
            'issued_at':now,'expires_at':expires,'payload':{'owner_bundle':bundle,'scope_hash':digest(state['scope']),
            'started_utc':datetime.fromtimestamp(now,dt_timezone.utc).isoformat(),
            'lookup_day':datetime.fromtimestamp(now,ZoneInfo('Europe/Moscow')).date().isoformat()}}
        self.bind(inputs,report_period)
        return deepcopy(inputs)

    def bind(self,inputs,report_period):
        """Recreate verifier after restart from persisted input plus CURRENT DB state."""
        period(report_period)
        need(type(inputs)is dict and set(inputs)=={'schema','revision','issued_at','expires_at','payload'},'OWNER_SOURCE_INPUT')
        need(inputs['schema']=='alice-graph-inputs/v1','OWNER_SOURCE_INPUT')
        p=inputs['payload'];need(type(p)is dict and set(p)=={'owner_bundle','scope_hash','started_utc','lookup_day'},'OWNER_SOURCE_INPUT')
        state=self.current();now=int(timezone.now().timestamp());a,b=inputs['issued_at'],inputs['expires_at']
        need(type(a)is int and type(b)is int and state['approved_at']<=a<=now<b and 0<b-a<=300 and
             b<=state['authority_expires_at'],'OWNER_SOURCE_INPUT_EXPIRED')
        expected=self.make_bundle(state,a,b)
        need(expected==p['owner_bundle']and p['scope_hash']==digest(state['scope'])and
             inputs['revision']=='platform-owner:'+str(state['revision']),'OWNER_SOURCE_INPUT_CHANGED')
        need(p['started_utc']==datetime.fromtimestamp(a,dt_timezone.utc).isoformat()and
             p['lookup_day']==datetime.fromtimestamp(a,ZoneInfo('Europe/Moscow')).date().isoformat(),'OWNER_SOURCE_INPUT_CHANGED')
        self.bound=deepcopy(inputs);self.bound_period=deepcopy(report_period)
        return self

    def _current_bound(self):
        need(self.bound is not None,'OWNER_SOURCE_BIND_REQUIRED')
        state=self.current();now=int(timezone.now().timestamp());a,b=self.bound['issued_at'],self.bound['expires_at']
        need(a<=now<b<=state['authority_expires_at'],'OWNER_SOURCE_INPUT_EXPIRED')
        need(self.make_bundle(state,a,b)==self.bound['payload']['owner_bundle'],'OWNER_SOURCE_INPUT_CHANGED')
        return state

    def scope_for(self,tenant):
        from semantics import Scope,Store,Rejected as RuntimeRejected
        try:
            state=self._current_bound();s=state['scope'];need(tenant==s['tenant'],'OWNER_SOURCE_TENANT',403)
            return Scope(s['tenant'],s['revision'],tuple(Store(**x)for x in s['stores']))
        except Rejected as error:
            raise RuntimeRejected(error.code) from None
        except DatabaseError:
            raise RuntimeRejected('OWNER_SOURCE_AUTH_UNAVAILABLE') from None

    def graph_authority(self,action,plan):
        try:
            state=self._current_bound();scope=state['scope']
            return (action in ('execute','read','commit')and self.required_credentials==('SELLER','PERFORMANCE')and
                plan['task_graph']['id']=='cue01_ozon_day'and plan['tenant']==scope['tenant']and
                plan['access_revision']==scope['revision']and plan['stores']==scope['stores']and
                plan['graph_inputs']==self.bound and plan['period']==self.bound_period and
                plan['task_graph']['input_hash']==digest(self.bound)and plan['timezone']=='Europe/Moscow')
        except (Rejected,DatabaseError,ValueError,TypeError,KeyError):return False

    def owner_authority(self,kind,metadata,request,action):
        try:
            state=self._current_bound();scope=state['scope'];store=scope['stores'][0]
            bundle=self.bound['payload']['owner_bundle'];snapshot=bundle['snapshot'];p=snapshot['payload']
            if kind not in ('binding','owner_input'):return False
            allowed=('read','execute','commit')if kind=='binding'else('resolve','execute','read')
            if action not in allowed:return False
            # Every authority field must be derived from the current source, never
            # accepted because a client echoed an issuer name or content hash.
            expected={'issuer':state['issuer'],'approval_ref':bundle['approval_ref'],'binding_revision':bundle['binding_revision'],
               'binding_hash':digest(bundle),'mapping_revision':bundle['mapping_revision'],'mapping_hash':digest(bundle['product_map']),
               'snapshot_hash':snapshot['sha256'],'owner_revision':p['revision'],'owner_catalog_hash':RESOLVER.hash,
               'tenant':scope['tenant'],'scope_hash':digest(scope),'store_id':store['id'],'store_hash':digest(store),
               'access_revision':scope['revision'],'store_access_revision':store['access_revision'],
               'source_revision':store['source_revision'],'period':self.bound_period,'currency':'RUB',
               'timezone':'Europe/Moscow','expires_at':self.bound['expires_at']}
            # Exact policy pin is supplied by the trusted, versioned integration;
            # no user JSON can select arbitrary binding behavior.
            from pathlib import Path
            policy=json.loads(Path(__file__).with_name('owner_binding_policy.json').read_text())
            expected['policy_hash']=digest(policy)
            if kind=='binding':
                ctx={'scope_hash':digest(scope),'store_entity':bundle['store_entity'],'currency':'RUB',
                     'period':self.bound_period,'as_of':self.bound['issued_at']}
                return metadata==expected and request==ctx
            if type(request)is not dict or set(request)!={'scope_hash','entity','currency','period','fields'}:return False
            if request['scope_hash']!=digest(scope)or request['currency']!='RUB'or request['period']!=self.bound_period:return False
            entity=request['entity'];store_entity=entity==bundle['store_entity']
            has_default=any(x['field']=='unit_cost'and x['entity']=='all-products'for x in p['entries'])
            default_target=has_default and (entity=='all-products' or __import__('re').fullmatch(r'sku:[1-9][0-9]{0,19}',entity))
            if not store_entity and entity not in bundle['product_map'].values() and not default_target:return False
            fields=sorted(k for k,v in CATALOG['fields'].items()if(v['mode']=='exact_period')==store_entity)
            if type(request['fields'])is not list or not request['fields']or len(set(request['fields']))!=len(request['fields'])or not set(request['fields'])<=set(fields):return False
            normalized={**request,'fields':sorted(request['fields'])}
            expected['resolution']={'catalog_hash':RESOLVER.hash,'facts_sha256':snapshot['sha256'],
                 'revision':p['revision'],'request_sha256':digest(normalized),'scope_hash':digest(scope),
                 'issued_at':p['issued_at'],'expires_at':p['expires_at']}
            return metadata==expected
        except (Rejected,DatabaseError,ValueError,TypeError,KeyError,OSError):return False
