"""Runtime side of RT-JOB-R01. No issuer, identity service or platform database.
Authority is an injected trusted service: verify ticket, then resolve current rights
and the exact mapping of public UUID/revisions to the existing runtime Scope.
"""
from __future__ import annotations
import copy,hashlib
from dataclasses import dataclass,asdict
from datetime import datetime
from pathlib import Path
from typing import Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo
from semantics import Scope,Rejected,canonical_json,strict_json,fingerprint
from registry import REGISTRY_HASH
from query_program import LANGUAGE,PROJECTION
from runtime_port_contract import (CONTRACT,PRODUCT,TASK_SCHEMA,context_shape,task_shape,
                                   claims_shape,uuid_text,timestamp,utc)
import retention

GUARD_VERSION='runtime_guard_v1'
ACCEPTED='runtime_acceptance_v1'

@dataclass(frozen=True)
class Peer:
    """Constructed by server-side peer authentication, never decoded from a message."""
    service_id:str
    product_id:str

class Authority(Protocol):
    def verify(self,ticket:str,service_id:str)->dict:
        """Verify signature/audience/revocation; return approved nonsecret claims."""
        ...
    def resolve(self,pins:dict,action:str)->Scope:
        """Check current grant/security/stores/credential revisions; map IDs exactly.
        No interpretation of a UUID as an implicit runtime tenant/store ID.
        Raise Rejected for a denial; any other exception is an unavailable dependency.
        """
        ...

def bundle_hash():
    names={'registry.json','expression_catalog.json','speech_catalog.json',
           'scalar_catalog.json','scalar_source_catalog.json','source_matrix.json','table_catalog.json',
           'dataset_queries.json','dataset_sources.json','base_blocks.json','information_catalog.json',
           'failure_catalog.json','report_contract_catalog.json','resource_limits.json','subscription_access.json.gz','template_catalog.json'}
    root=Path(__file__).parent
    names.update(p.name for p in root.glob('*.py'))
    names.update(str(p.relative_to(root)) for p in (root/'read_surface_data').iterdir() if p.is_file())
    return fingerprint({n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in sorted(names)})

def current_versions():
    return {'runtime_contract_version':CONTRACT,'task_schema_version':'runtime_task_v1',
            'task_schema_sha256':hashlib.sha256(Path(__file__).with_name('runtime_task_v1.schema.json').read_bytes()).hexdigest(),
            'registry_hash':REGISTRY_HASH,'catalog_bundle_hash':bundle_hash(),
            'query_language':LANGUAGE,'projection':PROJECTION,'port_build':'RT-JOB-R02.4'}

def pins(context):
    return {'product_id':PRODUCT,**{k:copy.deepcopy(v) for k,v in context.items()
                                   if k not in ('execution_ticket','not_after')}}

class RuntimePort:
    def __init__(self,engine,authority:Authority|None,*,catalog_release_id:str,service_id:str):
        if not isinstance(catalog_release_id,str) or not 0<len(catalog_release_id)<=128:
            raise ValueError('explicit catalog release binding required')
        if not isinstance(service_id,str) or not 0<len(service_id)<=128:
            raise ValueError('explicit service identity required')
        if engine.execution_policy is not None:
            raise ValueError('one execution-policy owner per engine')
        self.engine,self.repo,self.authority=engine,engine.repo,authority
        self.catalog_release_id,self.service_id=catalog_release_id,service_id
        self.versions=current_versions()
        engine.execution_policy=self
        with self.repo.connection(True) as c:
            c.execute('''CREATE TABLE IF NOT EXISTS rt_job_refs(
             ref TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,
             logical_id TEXT NOT NULL,body_hash TEXT NOT NULL,guard_hash TEXT NOT NULL,
             runtime_tenant TEXT NOT NULL,jid TEXT NOT NULL,created REAL NOT NULL,
             UNIQUE(tenant,actor,logical_id))''')
            c.execute('''CREATE TABLE IF NOT EXISTS rt_job_receipts(
             tenant TEXT NOT NULL,actor TEXT NOT NULL,rid TEXT NOT NULL,
             action TEXT NOT NULL,body_hash TEXT NOT NULL,reply TEXT NOT NULL,
             created REAL NOT NULL,PRIMARY KEY(tenant,actor,rid))''')
            c.execute('CREATE INDEX IF NOT EXISTS rt_refs_time ON rt_job_refs(created)')
            c.execute('CREATE INDEX IF NOT EXISTS rt_refs_job ON rt_job_refs(jid)')
            c.execute('CREATE INDEX IF NOT EXISTS rt_receipts_time ON rt_job_receipts(created)')

    def _peer(self,peer):
        if (not isinstance(peer,Peer) or peer.product_id!=PRODUCT or peer.service_id!=self.service_id):
            raise Rejected('AUTH_REQUIRED')

    def _resolve(self,approved_pins,action):
        if self.authority is None:raise Rejected('AUTH_REQUIRED')
        if approved_pins.get('product_id')!=PRODUCT:raise Rejected('AUTH_REQUIRED')
        if approved_pins.get('catalog_release_id')!=self.catalog_release_id:
            raise Rejected('CATALOG_INCOMPATIBLE')
        if approved_pins.get('business_timezone')!='Europe/Moscow':
            raise Rejected('CAPABILITY_UNAVAILABLE')
        try:scope=self.authority.resolve(copy.deepcopy(approved_pins),action)
        except Rejected:raise
        except Exception:raise Rejected('DEPENDENCY_UNAVAILABLE') from None
        if not isinstance(scope,Scope) or not scope.tenant or not scope.revision:
            raise Rejected('PERMISSION_DENIED')
        # An authority mapping must neither silently omit nor add a requested store.
        if (len(scope.stores)!=len(approved_pins['store_scope']) or
            len({s.id for s in scope.stores})!=len(scope.stores) or
            len({(s.platform,s.identity) for s in scope.stores})!=len(scope.stores)):
            raise Rejected('PERMISSION_DENIED')
        scope.select(sorted({s.platform for s in scope.stores}))
        return scope

    def _auth(self,context,peer,action):
        self._peer(peer)
        ctx=context_shape(context)
        if timestamp(ctx['not_after'])<=self.repo.clock():raise Rejected('AUTH_REQUIRED')
        if self.authority is None:raise Rejected('AUTH_REQUIRED')
        try:verified=claims_shape(self.authority.verify(ctx['execution_ticket'],peer.service_id))
        except Rejected:raise
        except Exception:raise Rejected('DEPENDENCY_UNAVAILABLE') from None
        # Compare every context field to the independently verified ticket claims.
        expected={'product_id':PRODUCT,**{k:v for k,v in ctx.items() if k!='execution_ticket'}}
        verified['not_after']=utc(timestamp(verified['not_after']))
        expected['not_after']=utc(timestamp(expected['not_after']))
        if verified!=expected:raise Rejected('PERMISSION_DENIED')
        approved=pins(ctx);scope=self._resolve(approved,action)
        guard={'version':GUARD_VERSION,'pins':approved,'scope_hash':fingerprint(asdict(scope)),
               'runtime_tenant':scope.tenant,'catalog_bundle_hash':self.versions['catalog_bundle_hash']}
        return ctx,guard,scope

    def scope_for(self,guard):
        """Core callback used again for accepted work, not a ticket replay.
        The acceptance ticket may expire; current authority is still mandatory.
        """
        if (type(guard)is not dict or set(guard)!={'version','pins','scope_hash','runtime_tenant','catalog_bundle_hash'}
            or guard['version']!=GUARD_VERSION or guard['catalog_bundle_hash']!=self.versions['catalog_bundle_hash']):
            raise Rejected('CATALOG_INCOMPATIBLE')
        scope=self._resolve(guard['pins'],'execute')
        if scope.tenant!=guard['runtime_tenant'] or fingerprint(asdict(scope))!=guard['scope_hash']:
            raise Rejected('PERMISSION_DENIED')
        return scope

    def versions_for(self,peer):
        self._peer(peer)
        return {**self.versions,'catalog_release_id':self.catalog_release_id}

    def capabilities(self,context,peer):
        self._auth(context,peer,'capabilities')
        return {**self.versions_for(peer),'operations':['submit','status','read_result','cancel','capabilities','current_versions','list_reports','read_report'],
                'query_input_kinds':['utterance'],'utterance_max_chars':1200,
                'business_timezones':['Europe/Moscow'],'unsupported':['template','revoke_scope'],
                'replay_retention_seconds':retention.REPLAY_TTL,'read_recomputes':False}

    def _old(self,c,ctx,rid,action,digest):
        old=c.execute('SELECT * FROM rt_job_receipts WHERE tenant=? AND actor=? AND rid=?',
                      (ctx['tenant_id'],ctx['actor_id'],rid)).fetchone()
        if old:
            if old['action']!=action or old['body_hash']!=digest:raise Rejected('IDEMPOTENCY_CONFLICT')
            if old['created']+retention.REPLAY_TTL<=self.repo.clock():raise Rejected('RESULT_EXPIRED')
            return strict_json(old['reply'])
        return None

    def _admission(self,c,tenant):
        retention.admission(c,tenant,'inbox')

    @staticmethod
    def reader(ref):
        return 'rt_'+ref.replace('-','')

    def _save(self,c,ctx,rid,action,digest,reply):
        c.execute('INSERT INTO rt_job_receipts VALUES(?,?,?,?,?,?,?)',
                  (ctx['tenant_id'],ctx['actor_id'],rid,action,digest,canonical_json(reply),self.repo.clock()))

    def submit(self,task,peer):
        task=task_shape(task)
        ctx,guard,scope=self._auth(task['context'],peer,'submit')
        query=task['query_input']
        if query['kind']!='utterance' or len(query['text'])>1200:raise Rejected('CAPABILITY_UNAVAILABLE')
        request_id=task['request_id'];logical_id=task['logical_query_id']
        digest=fingerprint({'query':query,'logical_query_id':logical_id,'guard':guard})
        with self.repo.connection(True) as c:
            old=self._old(c,ctx,request_id,'submit',digest)
            if old:
                self._lookup(c,old['job_ref'],ctx,guard)
                return old
            self._admission(c,ctx['tenant_id'])
            prior=c.execute('SELECT * FROM rt_job_refs WHERE tenant=? AND actor=? AND logical_id=?',
                            (ctx['tenant_id'],ctx['actor_id'],logical_id)).fetchone()
            if prior:
                if prior['body_hash']!=digest:raise Rejected('IDEMPOTENCY_CONFLICT')
                self._lookup(c,prior['ref'],ctx,guard)
                ref,created=prior['ref'],prior['created']
            else:
                # Internal rid is namespaced; a trusted platform UUID cannot collide with legacy ingress.
                rid='rt1:'+fingerprint([ctx['tenant_id'],ctx['actor_id'],request_id])
                today=datetime.fromtimestamp(self.repo.clock(),ZoneInfo(ctx['business_timezone'])).date()
                from model_answer import ORIGINAL_QUESTION
                token=ORIGINAL_QUESTION.set(query['text'])
                try:answer=self.engine._submit(scope.tenant,query['text'],rid,digest,today,execution_context=guard)
                finally:ORIGINAL_QUESTION.reset(token)
                ref=str(uuid4());created=self.repo.clock()
                c.execute('INSERT INTO rt_job_refs VALUES(?,?,?,?,?,?,?,?,?)',
                          (ref,ctx['tenant_id'],ctx['actor_id'],logical_id,digest,fingerprint(guard),scope.tenant,answer['job_id'],created))
                # Register a reader of the shared canonical job without touching
                # any existing voice/cabinet conversation's selection or cursor.
                from reader_state import _attach
                _attach(self.repo,c,scope.tenant,self.reader(ref),answer['job_id'],created)
            receipt={'schema_version':ACCEPTED,'job_ref':ref,'logical_query_id':logical_id,
                     'state':'ACCEPTED','accepted_at':utc(created),'trace_id':task['trace_id']}
            self._save(c,ctx,request_id,'submit',digest,receipt)
            return receipt

    def _lookup(self,c,ref,ctx,guard):
        ref=uuid_text(ref)
        match=c.execute('SELECT * FROM rt_job_refs WHERE ref=? AND tenant=? AND actor=?',
                        (ref,ctx['tenant_id'],ctx['actor_id'])).fetchone()
        if not match:raise Rejected('NOT_FOUND')
        if match['guard_hash']!=fingerprint(guard):raise Rejected('PERMISSION_DENIED')
        # Follow only the core's authenticated exact-cache aliases. Never a global pointer.
        row=self.repo.get(match['runtime_tenant'],match['jid'])
        if row is None:raise Rejected('RESULT_EXPIRED')
        self.engine.authorize_job(row)
        if row['plan']:
            plan=strict_json(row['plan'])
            if plan.get('runtime_guard')!=guard or not self.engine.output_authorized(row):
                raise Rejected('PERMISSION_DENIED')
        elif row['state'] in ('QUEUED','RUNNING'):
            draft=strict_json(row['draft'])
            if draft.get('runtime_guard')!=guard:raise Rejected('PERMISSION_DENIED')
        cursor=c.execute('SELECT cancelled FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                         (match['runtime_tenant'],self.reader(ref),match['jid'])).fetchone()
        if cursor is None:raise Rejected('RESULT_EXPIRED')
        if cursor['cancelled']:row={**row,'state':'CANCELLED','result':None}
        return match,row

    def _status(self,ref,row):
        state=row['state']
        if state=='READY' and (row['expires'] or 0)<=self.repo.clock():state='EXPIRED'
        result={'job_ref':ref,'state':state,'updated_at':utc(row['updated']),
                'retryable':False,'result_expires_at':utc(row['expires']) if row['expires'] else None}
        if state=='UNKNOWN':result['code']='UNKNOWN_OUTCOME'
        if state=='EXPIRED':result['code']='RESULT_EXPIRED'
        if state=='FAILED':result['code']='EXECUTION_FAILED' # internal/provider text stays private
        if state=='QUEUED' and row['due']>self.repo.clock():
            result.update(code='QUOTA_WAIT',retry_after_seconds=max(1,int(row['due']-self.repo.clock())))
        return result

    def status(self,job_ref,context,peer):
        ctx,guard,_=self._auth(context,peer,'status')
        with self.repo.connection(True) as c:
            ref,row=self._lookup(c,job_ref,ctx,guard)
            return self._status(ref['ref'],row)

    def read_result(self,job_ref,context,peer):
        ctx,guard,_=self._auth(context,peer,'read_result')
        with self.repo.connection(True) as c:
            ref,row=self._lookup(c,job_ref,ctx,guard)
            status=self._status(ref['ref'],row)
            if status['state']=='EXPIRED':raise Rejected('RESULT_EXPIRED')
            if status['state']=='UNKNOWN':raise Rejected('UNKNOWN_OUTCOME')
            if status['state']!='READY':raise Rejected('RESULT_NOT_READY')
            result=strict_json(row['result'])
            if result.get('complete') is not True:raise Rejected('RESULT_NOT_READY')
            access=self.engine.access_failure_result(row)
            # Rights/TTL can change while a slow final authorizer is running.
            _,current_guard,_=self._auth(context,peer,'read_result')
            if current_guard!=guard:raise Rejected('PERMISSION_DENIED')
            if (row['expires'] or 0)<=self.repo.clock():raise Rejected('RESULT_EXPIRED')
            # Do not change page/delivered cursors, and do not copy internal store IDs or rows.
            reply={**status,'schema_version':'runtime_result_v1','complete':True,
                   'pages':result['pages'],'fetched_at':result['fetched_at'],
                   'result_kind':'PROVIDER_REFUSAL' if result.get('failure_code') else 'DATA'}
            if access is not None:reply['model_result']=access
            return reply

    def list_reports(self,context,peer,cursor=None):
        from report_archive import owner
        ctx,guard,scope=self._auth(context,peer,'list_reports')
        archive=self.engine.report_archive
        if archive is None:raise Rejected('CAPABILITY_UNAVAILABLE')
        if cursor is not None:uuid_text(cursor)
        result=archive.list(scope,owner(guard),cursor)
        _,fresh,current=self._auth(context,peer,'list_reports')
        if fresh!=guard:raise Rejected('PERMISSION_DENIED')
        now=self.repo.clock()
        result['items']=[r for r in result['items']if r['expires_at']>now and archive.authorize(current,owner(fresh),r['id'])]
        return {'schema_version':'runtime_reports_v1',**result}

    def read_report(self,file_id,offset,context,peer):
        from report_archive import owner
        ctx,guard,scope=self._auth(context,peer,'read_report')
        if self.engine.report_archive is None:raise Rejected('CAPABILITY_UNAVAILABLE')
        result=self.engine.report_archive.read(scope,owner(guard),uuid_text(file_id),offset)
        _,fresh,current=self._auth(context,peer,'read_report')
        if fresh!=guard:raise Rejected('PERMISSION_DENIED')
        if result['expires_at']<=self.repo.clock():raise Rejected('RESULT_EXPIRED')
        self.engine.report_archive.authorize(current,owner(fresh),file_id)
        return {'schema_version':'runtime_report_chunk_v1',**result}

    def cancel(self,job_ref,context,request_id,peer):
        ctx,guard,_=self._auth(context,peer,'cancel')
        ref_id=uuid_text(job_ref);rid=uuid_text(request_id)
        digest=fingerprint({'job_ref':ref_id,'guard':guard})
        with self.repo.connection(True) as c:
            ref,row=self._lookup(c,ref_id,ctx,guard)
            old=self._old(c,ctx,rid,'cancel',digest)
            if old:return old
            self._admission(c,ctx['tenant_id'])
            changed=False
            if row['state'] in ('QUEUED','RUNNING'):
                with self.repo.reader_scope(ref['runtime_tenant'],self.reader(ref_id)):
                    changed=self.repo.cancel(ref['runtime_tenant'])
                _,row=self._lookup(c,ref_id,ctx,guard)
            reply={**self._status(ref_id,row),'cancelled':changed,'in_flight_may_complete':True}
            self._save(c,ctx,rid,'cancel',digest,reply)
            return reply
