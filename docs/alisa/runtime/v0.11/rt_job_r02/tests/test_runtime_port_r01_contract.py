"""RT-JOB-R01: real queue/SQLite/Unix IPC, fake authority/provider only.
A schema-valid synthetic ticket must never pass as platform authorization.
"""
import copy,json,os,sqlite3,tempfile,threading,unittest,socket
from pathlib import Path
from uuid import uuid4
from dataclasses import replace
from datetime import datetime,timezone
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from test_runtime import FakeTransport,Clock,SCOPE,TODAY,oz_response
from engine import Engine,Worker,CallError
from repository import Repository
from semantics import Rejected,fingerprint,strict_json
from runtime_port_contract import (PRODUCT,task_shape,context_shape,claims_shape,utc)
from runtime_port import RuntimePort,Peer,current_versions
from runtime_port_ipc import Gateway,request,dispatch,MAX_REQUEST
import retention

def uid():return str(uuid4())

class FakeAuthority:
    """Synthetic fixture only. No production permissive verifier is included."""
    def __init__(self,clock):
        self.clock=clock;self.tickets={};self.grants={};self.scope=SCOPE
        self.down=False;self.revoked=False;self.calls=[]
    def issue(self,ctx):
        result=copy.deepcopy(ctx);result['execution_ticket']='fixture-ticket-'+uid()
        self.tickets[result['execution_ticket']]={'product_id':PRODUCT,**{k:v for k,v in result.items() if k!='execution_ticket'}}
        key=(result['tenant_id'],result['actor_id'])
        self.grants[key]={k:v for k,v in self.tickets[result['execution_ticket']].items() if k!='not_after'}
        return result
    def verify(self,ticket,service_id):
        if self.down:raise TimeoutError('private internal address not for clients')
        if ticket not in self.tickets or service_id!='fixture-platform':raise Rejected('AUTH_REQUIRED')
        return copy.deepcopy(self.tickets[ticket])
    def resolve(self,pins,action):
        self.calls.append(action)
        if self.down:raise TimeoutError('private error must not leak')
        if self.revoked:raise Rejected('ACCESS_REQUIRED')
        if pins!=self.grants.get((pins['tenant_id'],pins['actor_id'])):raise Rejected('PERMISSION_DENIED')
        return self.scope

class Setup(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.clock=Clock();self.auth=FakeAuthority(self.clock);self.repo=Repository(self.root/'jobs.sqlite',self.clock)
        self.engine=Engine(self.repo,lambda _:self.auth.scope)
        self.port=RuntimePort(self.engine,self.auth,catalog_release_id='fixture-catalog',service_id='fixture-platform')
        self.peer=Peer('fixture-platform',PRODUCT);self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport)
        self.ctx=self.auth.issue({'tenant_id':uid(),'actor_id':uid(),'store_scope':[
            {'store_id':uid(),'credential_revision':1,'scope_revision':1},
            {'store_id':uid(),'credential_revision':1,'scope_revision':1}],
            'security_revision':1,'access_revision':1,'business_timezone':'Europe/Moscow',
            'catalog_release_id':'fixture-catalog','runtime_contract_version':'runtime_port_v1',
            'execution_ticket':'placeholder','not_after':utc(self.clock()+3600)})
        # Canonical ordering mirrors runtime normalization before ticket verification.
        self.ctx['store_scope'].sort(key=lambda x:x['store_id']);self.ctx=self.auth.issue(self.ctx)
    def tearDown(self):self.tmp.cleanup()
    def task(self,q='сводка заказов за октябрь 2026 на озоне'):
        return {'schema_version':'runtime_task_v1','request_id':uid(),'logical_query_id':uid(),
                'trace_id':uid(),'context':copy.deepcopy(self.ctx),'query_input':{'kind':'utterance','text':q}}
    def submit(self,q=None):
        t=self.task(q) if q else self.task();return t,self.port.submit(t,self.peer)
    def finish(self,receipt):
        for _ in range(12):
            state=self.port.status(receipt['job_ref'],self.ctx,self.peer)['state']
            if state not in ('QUEUED','RUNNING'):break
            self.clock.advance(62);self.worker.step()
        self.assertEqual(self.port.status(receipt['job_ref'],self.ctx,self.peer)['state'],'READY')
        return self.port.read_result(receipt['job_ref'],self.ctx,self.peer)
    def reject(self,code,fn):
        with self.assertRaises(Rejected) as e:fn()
        self.assertEqual(e.exception.code,code)
    def count(self,table):
        with self.repo.connection() as c:return c.execute('SELECT count(*) FROM '+table).fetchone()[0]
    def inner_id(self,receipt):
        with self.repo.connection() as c:return c.execute('SELECT jid FROM rt_job_refs WHERE ref=?',(receipt['job_ref'],)).fetchone()[0]

class ContractTests(Setup):
    def test_shape_valid_is_not_authorization(self):
        task=self.task();task['context']['execution_ticket']='SYNTHETIC_NOT_A_VALID_AUTHORIZATION'
        task_shape(task)
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(task,self.peer));self.assertEqual(self.count('jobs'),0)
    def test_no_authority_denies(self):
        self.port.authority=None
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(self.task(),self.peer))
    def test_unknown_task_field_denied(self):
        task=self.task();task['product_id']=PRODUCT
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_unknown_context_secret_denied(self):
        task=self.task();task['context']['api_key']='not-real'
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_bool_revision_denied(self):
        task=self.task();task['context']['security_revision']=True
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_zero_revision_denied(self):
        task=self.task();task['context']['access_revision']=0
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_duplicate_store_denied(self):
        task=self.task();task['context']['store_scope'].append(copy.deepcopy(task['context']['store_scope'][0]))
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_invalid_uuid(self):
        task=self.task();task['request_id']='A'
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_invalid_timezone(self):
        task=self.task();task['context']['business_timezone']='../../etc/passwd'
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_template_is_explicitly_unsupported(self):
        task=self.task();task['query_input']={'kind':'template','template_id':'future','slots':{}}
        self.reject('CAPABILITY_UNAVAILABLE',lambda:self.port.submit(task,self.peer))
    def test_schema_support_does_not_overpromise_engine_size(self):
        task=self.task('x'*1201);task_shape(task)
        self.reject('CAPABILITY_UNAVAILABLE',lambda:self.port.submit(task,self.peer))
    def test_valid_unsupported_timezone_no_silent_conversion(self):
        task=self.task();task['context']['business_timezone']='UTC';task['context']=self.auth.issue(task['context'])
        self.reject('CAPABILITY_UNAVAILABLE',lambda:self.port.submit(task,self.peer))
    def test_control_utterance_is_not_report(self):
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(self.task('отмени отчет'),self.peer))
        self.assertEqual(self.count('control_inbox'),0)
    def test_authority_failure_closed(self):
        self.auth.down=True
        self.reject('DEPENDENCY_UNAVAILABLE',lambda:self.port.submit(self.task(),self.peer));self.assertEqual(self.count('jobs'),0)
    def test_wrong_product_peer(self):
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(self.task(),Peer('fixture-platform','octoport')))
    def test_wrong_service_peer(self):
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(self.task(),Peer('another',PRODUCT)))
    def test_client_context_cannot_override_ticket_claims(self):
        task=self.task();task['context']['actor_id']=uid()
        self.reject('PERMISSION_DENIED',lambda:self.port.submit(task,self.peer))
    def test_expired_ticket_before_side_effect(self):
        task=self.task();task['context']['not_after']=utc(self.clock()-1)
        task['context']=self.auth.issue(task['context'])
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(task,self.peer));self.assertEqual(self.count('jobs'),0)
    def test_wrong_catalog(self):
        task=self.task();task['context']['catalog_release_id']='wrong';task['context']=self.auth.issue(task['context'])
        self.reject('CATALOG_INCOMPATIBLE',lambda:self.port.submit(task,self.peer))
    def test_mapping_not_guessed_from_public_uuid(self):
        _,r=self.submit();self.finish(r)
        with self.repo.connection() as c:
            j=c.execute('SELECT tenant FROM jobs').fetchone()[0]
        self.assertEqual(j,'A');self.assertNotEqual(j,self.ctx['tenant_id'])
    def test_scope_expansion_denied(self):
        self.auth.scope=replace(SCOPE,stores=SCOPE.stores+(replace(SCOPE.stores[0],id='extra',identity='extra'),))
        self.reject('PERMISSION_DENIED',lambda:self.port.submit(self.task(),self.peer))

class JobTests(Setup):
    def test_submit_durable_without_provider_http(self):
        _,r=self.submit();self.assertEqual(r['state'],'ACCEPTED');self.assertEqual(self.count('jobs'),1)
        self.assertEqual(self.transport.calls,[]);self.assertEqual(self.port.status(r['job_ref'],self.ctx,self.peer)['state'],'QUEUED')
    def test_complete_and_read_repeat_without_http(self):
        _,r=self.submit();expected=self.finish(r);count=self.repo.call_count()
        for _ in range(5):self.assertEqual(self.port.read_result(r['job_ref'],self.ctx,self.peer),expected)
        self.assertEqual(self.repo.call_count(),count);self.assertNotIn('data',expected)
    def test_submit_replay_same_receipt(self):
        t,r=self.submit();self.assertEqual(self.port.submit(t,self.peer),r);self.assertEqual(self.count('jobs'),1)
    def test_changed_request_body_conflict(self):
        t,r=self.submit();t['query_input']['text']='сводка заказов за сентябрь 2026 на озоне'
        self.reject('IDEMPOTENCY_CONFLICT',lambda:self.port.submit(t,self.peer));self.assertEqual(self.count('jobs'),1)
    def test_same_logical_new_request_returns_same_ref(self):
        t,r=self.submit();t['request_id']=uid()
        self.assertEqual(self.port.submit(t,self.peer)['job_ref'],r['job_ref']);self.assertEqual(self.count('jobs'),1)
    def test_same_logical_changed_query_conflict(self):
        t,r=self.submit();t['request_id']=uid();t['query_input']['text']='сводка заказов за сентябрь 2026 на озоне'
        self.reject('IDEMPOTENCY_CONFLICT',lambda:self.port.submit(t,self.peer))
    def test_ticket_refresh_does_not_duplicate_job(self):
        t,r=self.submit();self.clock.advance(1);t['context']['not_after']=utc(self.clock()+3600)
        t['context']=self.auth.issue(t['context']);t['trace_id']=uid()
        self.assertEqual(self.port.submit(t,self.peer),r);self.assertEqual(self.count('jobs'),1)
    def test_two_logical_refs_one_exact_ready_calculation(self):
        _,a=self.submit();self.finish(a);n=len(self.transport.calls)
        _,b=self.submit();self.assertNotEqual(a['job_ref'],b['job_ref']);self.assertEqual(self.count('jobs'),1)
        self.assertEqual(self.port.read_result(a['job_ref'],self.ctx,self.peer)['pages'],self.port.read_result(b['job_ref'],self.ctx,self.peer)['pages']);self.assertEqual(len(self.transport.calls),n)
    def test_read_not_last_pointer(self):
        _,a=self.submit();first=self.finish(a)
        # A separate legacy path changes the global pointer. Explicit ref is unaffected.
        legacy=self.engine.submit('A','сводка заказов за сентябрь 2026 на озоне','legacy',fingerprint('legacy'),TODAY)
        self.assertNotEqual(legacy['job_id'],self.inner_id(a))
        self.assertEqual(self.port.read_result(a['job_ref'],self.ctx,self.peer),first)
    def test_port_submit_does_not_change_voice_pointer(self):
        legacy=self.engine.submit('A','сводка заказов за сентябрь 2026 на озоне','legacy',fingerprint('legacy'),TODAY)
        _,r=self.submit();self.finish(r)
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT jid FROM pointers WHERE tenant="A"').fetchone()[0],legacy['job_id'])
            row=c.execute('SELECT page,delivered FROM jobs WHERE id=?',(self.inner_id(r),)).fetchone();self.assertEqual(tuple(row),(0,0))
    def test_cancel_by_old_ref_not_new_job(self):
        _,a=self.submit();_,b=self.submit('сводка заказов за сентябрь 2026 на озоне')
        rid=uid();first=self.port.cancel(a['job_ref'],self.ctx,rid,self.peer)
        self.assertTrue(first['cancelled']);self.assertEqual(self.port.cancel(a['job_ref'],self.ctx,rid,self.peer),first)
        self.assertEqual(self.port.status(b['job_ref'],self.ctx,self.peer)['state'],'QUEUED')
    def test_cancel_replay_ref_change_conflict(self):
        _,a=self.submit();_,b=self.submit('сводка заказов за сентябрь 2026 на озоне');rid=uid()
        self.port.cancel(a['job_ref'],self.ctx,rid,self.peer)
        self.reject('IDEMPOTENCY_CONFLICT',lambda:self.port.cancel(b['job_ref'],self.ctx,rid,self.peer))
    def test_cancel_ready_does_not_destroy_report(self):
        _,r=self.submit();self.finish(r)
        self.assertFalse(self.port.cancel(r['job_ref'],self.ctx,uid(),self.peer)['cancelled'])
        self.assertTrue(self.port.read_result(r['job_ref'],self.ctx,self.peer)['complete'])
    def test_result_expired_no_new_calculation(self):
        _,r=self.submit();self.finish(r);self.clock.advance(901);n=self.repo.call_count()
        self.reject('RESULT_EXPIRED',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
        self.assertEqual(self.port.status(r['job_ref'],self.ctx,self.peer)['state'],'EXPIRED');self.assertEqual(self.repo.call_count(),n)
    def test_not_ready_no_calculation(self):
        _,r=self.submit();self.reject('RESULT_NOT_READY',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer));self.assertEqual(self.transport.calls,[])
    def test_unknown_never_retries(self):
        _,r=self.submit();self.transport.failure=CallError('UNKNOWN_TEST',unknown=True);self.worker.step()
        self.assertEqual(self.port.status(r['job_ref'],self.ctx,self.peer)['code'],'UNKNOWN_OUTCOME')
        self.reject('UNKNOWN_OUTCOME',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
        self.worker.step();self.assertEqual(len(self.transport.calls),1)
    def test_other_actor_ref_hidden(self):
        _,r=self.submit();ctx=copy.deepcopy(self.ctx);ctx['actor_id']=uid();ctx=self.auth.issue(ctx)
        self.reject('NOT_FOUND',lambda:self.port.status(r['job_ref'],ctx,self.peer))
    def test_other_tenant_ref_hidden(self):
        _,r=self.submit();ctx=copy.deepcopy(self.ctx);ctx['tenant_id']=uid();ctx=self.auth.issue(ctx)
        self.reject('NOT_FOUND',lambda:self.port.read_result(r['job_ref'],ctx,self.peer))
    def test_unrelated_uuid_not_found(self):
        self.reject('NOT_FOUND',lambda:self.port.status(uid(),self.ctx,self.peer))
    def test_changed_revisions_deny_read_even_fresh_ticket(self):
        _,r=self.submit();self.finish(r);ctx=copy.deepcopy(self.ctx);ctx['security_revision']=2;ctx=self.auth.issue(ctx)
        self.reject('PERMISSION_DENIED',lambda:self.port.read_result(r['job_ref'],ctx,self.peer))
    def test_stale_context_denied_current_authority(self):
        _,r=self.submit();self.finish(r);new=copy.deepcopy(self.ctx);new['access_revision']=2;self.auth.issue(new)
        self.reject('PERMISSION_DENIED',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
    def test_revocation_before_dispatch_blocks_http(self):
        _,r=self.submit();self.auth.revoked=True;self.worker.step()
        self.assertEqual(self.transport.calls,[]);self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'FAILED')
    def test_revocation_during_call_prevents_ready(self):
        _,r=self.submit();self.transport.on_call=lambda _:setattr(self.auth,'revoked',True);self.worker.step()
        self.assertEqual(len(self.transport.calls),1);self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'FAILED')
    def test_authority_unavailable_in_worker_denies_dispatch(self):
        _,r=self.submit();self.auth.down=True;self.worker.step();self.assertEqual(self.transport.calls,[])
    def test_expired_acceptance_ticket_not_security_revocation(self):
        self.ctx['not_after']=utc(self.clock()+1);self.ctx=self.auth.issue(self.ctx)
        _,r=self.submit();self.clock.advance(2);self.worker.step()
        self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'READY')
        self.reject('AUTH_REQUIRED',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
        self.ctx['not_after']=utc(self.clock()+60);self.ctx=self.auth.issue(self.ctx)
        self.assertTrue(self.port.read_result(r['job_ref'],self.ctx,self.peer)['complete'])
    def test_restart_preserves_receipt_and_job(self):
        task,r=self.submit();repo2=Repository(self.repo.path,self.clock);engine2=Engine(repo2,lambda _:self.auth.scope)
        port2=RuntimePort(engine2,self.auth,catalog_release_id='fixture-catalog',service_id='fixture-platform')
        self.assertEqual(port2.submit(task,self.peer),r)
        Worker(engine2,self.transport).step();self.assertTrue(port2.read_result(r['job_ref'],self.ctx,self.peer)['complete'])
    def test_plain_engine_cannot_execute_guarded_job(self):
        _,r=self.submit();unsafe=Engine(self.repo,lambda _:SCOPE);Worker(unsafe,self.transport).step()
        self.assertEqual(self.transport.calls,[]);self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'FAILED')
    def test_binding_change_denied_despite_same_external_revision(self):
        _,r=self.submit();self.auth.scope=replace(SCOPE,stores=(replace(SCOPE.stores[0],access_revision='other'),SCOPE.stores[1]))
        self.worker.step();self.assertEqual(self.transport.calls,[])
    def test_concurrent_same_request_single_job(self):
        task=self.task()
        with ThreadPoolExecutor(max_workers=6) as pool:answers=list(pool.map(lambda _:self.port.submit(task,self.peer),range(12)))
        self.assertTrue(all(x==answers[0] for x in answers));self.assertEqual(self.count('jobs'),1)
    def test_ticket_not_in_database_or_provider(self):
        _,r=self.submit();self.finish(r)
        for file in self.root.glob('jobs.sqlite*'):self.assertNotIn(self.ctx['execution_ticket'].encode(),file.read_bytes())
        for call in self.transport.calls:self.assertNotIn(self.ctx['execution_ticket'],json.dumps(call.body))
    def test_p2_uses_same_worker_without_leaking_guard(self):
        _,r=self.submit('Каков объем заказанных единиц за октябрь на озоне')
        self.finish(r);self.assertEqual(self.transport.calls[0].operation,'deepseek_parse')
        payload=json.dumps(self.transport.calls[0].body)
        self.assertNotIn(self.ctx['tenant_id'],payload);self.assertNotIn(self.ctx['execution_ticket'],payload)
    def test_ref_and_receipt_gc_without_active_job_deletion(self):
        _,a=self.submit();self.finish(a);_,b=self.submit('сводка заказов за сентябрь 2026 на озоне')
        self.clock.advance(86401)
        for _ in range(5):retention.sweep(self.repo)
        with self.repo.connection() as c:
            refs=[r[0] for r in c.execute('SELECT ref FROM rt_job_refs')]
        self.assertNotIn(a['job_ref'],refs);self.assertIn(b['job_ref'],refs)
        self.assertEqual(self.repo.get('A',self.inner_id(b))['state'],'QUEUED')
    def test_metadata_capacity_denies_no_side_effect(self):
        with patch('retention.MAX_USED_BYTES',0):
            self.reject('STORAGE_CAPACITY',lambda:self.port.submit(self.task(),self.peer))
        self.assertEqual(self.count('jobs'),0)

class IPCTests(Setup):
    def setUp(self):
        super().setUp();self.path=str(self.root/'port.sock')
        self.server=Gateway(self.path,self.port,allowed_uid=os.getuid(),service_id='fixture-platform')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();super().tearDown()
    def test_unix_roundtrip(self):
        r=request(self.path,'submit',self.task());self.worker.step()
        result=request(self.path,'read_result',{'job_ref':r['job_ref'],'context':self.ctx})
        self.assertTrue(result['complete']);self.assertEqual(len(self.transport.calls),1)
    def test_capabilities_exact_supported_subset(self):
        result=request(self.path,'capabilities',{'context':self.ctx})
        self.assertEqual(result['query_input_kinds'],['utterance']);self.assertFalse(result['read_recomputes'])
    def test_unknown_operation_denied(self):
        self.reject('CAPABILITY_UNAVAILABLE',lambda:request(self.path,'revoke_scope',{'context':self.ctx}))
    def test_wrong_peer_uid_denied(self):
        self.server.allowed_uid=os.getuid()+1000
        self.reject('AUTH_REQUIRED',lambda:request(self.path,'current_versions',{}))
    def test_no_service_identity_from_payload(self):
        self.reject('VALIDATION_FAILED',lambda:request(self.path,'status',{'context':self.ctx,'job_ref':uid(),'product_id':PRODUCT}))
    def test_duplicate_json_key_denied(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
            sock.connect(self.path);sock.sendall(b'{"operation":"submit","operation":"cancel"}\n')
            reply=json.loads(sock.recv(4096))
        self.assertFalse(reply['ok']);self.assertEqual(reply['error']['code'],'VALIDATION_FAILED')
    def test_size_denied_before_submit(self):
        self.reject('VALIDATION_FAILED',lambda:request(self.path,'submit',{'oversize':'x'*MAX_REQUEST}))
        self.assertEqual(self.count('jobs'),0)
    def test_dependency_error_message_not_leaked(self):
        self.auth.down=True
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
            sock.connect(self.path);sock.sendall((json.dumps({'schema_version':'runtime_port_v1','operation':'submit','payload':self.task()})+'\n').encode());raw=sock.recv(4096)
        self.assertNotIn(b'private internal',raw);self.assertEqual(json.loads(raw)['error']['code'],'DEPENDENCY_UNAVAILABLE')
    def test_current_versions_no_provider(self):
        self.assertEqual(request(self.path,'current_versions',{})['runtime_contract_version'],'runtime_port_v1')
        self.assertEqual(self.repo.call_count(),0)
    def test_existing_socket_not_deleted(self):
        with self.assertRaises(RuntimeError):Gateway(self.path,self.port,allowed_uid=os.getuid(),service_id='fixture-platform')
        self.assertTrue(Path(self.path).exists())


class AdditionalInvariants(Setup):
    def test_cancel_while_provider_in_flight_blocks_publication(self):
        _,r=self.submit()
        self.transport.on_call=lambda _:self.port.cancel(r['job_ref'],self.ctx,uid(),self.peer)
        self.worker.step()
        self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'CANCELLED')
        self.assertEqual(len(self.transport.calls),1)
        self.reject('RESULT_NOT_READY',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
    def test_revocation_between_prepare_and_dispatch(self):
        _,r=self.submit()
        self.transport.prepare=lambda *args:setattr(self.auth,'revoked',True)
        self.worker.step();self.assertEqual(len(self.transport.calls),0)
    def test_actor_scope_separates_exact_jobs(self):
        _,a=self.submit();self.finish(a)
        ctx=copy.deepcopy(self.ctx);ctx['actor_id']=uid();ctx=self.auth.issue(ctx)
        task=self.task();task['context']=ctx;b=self.port.submit(task,self.peer)
        self.assertEqual(self.count('jobs'),2)
        self.assertEqual(self.port.status(b['job_ref'],ctx,self.peer)['state'],'QUEUED')
    def test_public_ref_follows_p2_alias_without_using_pointer(self):
        _,a=self.submit('Каков объем заказанных единиц за октябрь на озоне');self.clock.advance(1)
        _,b=self.submit('количество заказанных товаров за октябрь на озоне')
        self.worker.step()
        with self.repo.connection() as c:
            state=c.execute('SELECT state FROM jobs WHERE id=?',(self.inner_id(a),)).fetchone()[0]
        self.assertEqual(state,'ALIASED')
        self.finish(b)
        self.assertEqual(self.port.read_result(a['job_ref'],self.ctx,self.peer)['pages'],self.port.read_result(b['job_ref'],self.ctx,self.peer)['pages'])
    def test_active_alias_ref_survives_retention(self):
        _,a=self.submit('Каков объем заказанных единиц за октябрь на озоне');self.clock.advance(1)
        _,b=self.submit('количество заказанных товаров за октябрь на озоне');self.worker.step()
        self.clock.advance(90001)
        for _ in range(5):retention.sweep(self.repo)
        with self.repo.connection() as c:
            refs={r[0] for r in c.execute('SELECT ref FROM rt_job_refs')}
            self.assertEqual(c.execute('SELECT state FROM jobs WHERE id=?',(self.inner_id(a),)).fetchone()[0],'ALIASED')
        self.assertIn(a['job_ref'],refs);self.assertIn(b['job_ref'],refs)
    def test_no_ticket_in_wal_after_failed_submission(self):
        task=self.task();task['query_input']['text']='продажи за вчера'
        self.reject('METRIC_AMBIGUOUS',lambda:self.port.submit(task,self.peer))
        self.assertEqual(self.count('rt_job_refs'),0);self.assertEqual(self.count('jobs'),0)
        for file in self.root.glob('jobs.sqlite*'):self.assertNotIn(self.ctx['execution_ticket'].encode(),file.read_bytes())
    def test_acceptance_transaction_rollback(self):
        with patch.object(self.port,'_save',side_effect=RuntimeError('injected_receipt_failure')):
            with self.assertRaises(RuntimeError):self.port.submit(self.task(),self.peer)
        self.assertEqual(self.count('jobs'),0);self.assertEqual(self.count('rt_job_refs'),0);self.assertEqual(self.count('inbox'),0)
    def test_status_never_exposes_internal_error_text(self):
        _,r=self.submit();self.transport.failure=CallError('private-exception-do-not-expose');self.worker.step()
        st=self.port.status(r['job_ref'],self.ctx,self.peer)
        self.assertNotIn('private-exception',json.dumps(st));self.assertEqual(st['code'],'EXECUTION_FAILED')
    def test_read_does_not_mutate_pagination(self):
        _,r=self.submit();self.finish(r)
        with self.repo.connection(True) as c:c.execute('UPDATE jobs SET page=4,delivered=1 WHERE id=?',(self.inner_id(r),))
        self.port.read_result(r['job_ref'],self.ctx,self.peer)
        with self.repo.connection() as c:self.assertEqual(tuple(c.execute('SELECT page,delivered FROM jobs WHERE id=?',(self.inner_id(r),)).fetchone()),(4,1))
    def test_fresh_ticket_cannot_restore_revoked_credential(self):
        _,r=self.submit();self.finish(r)
        self.ctx['store_scope'][0]['credential_revision']=2;self.ctx=self.auth.issue(self.ctx)
        self.reject('PERMISSION_DENIED',lambda:self.port.read_result(r['job_ref'],self.ctx,self.peer))
    def test_shape_non_utc_timestamp_rejected(self):
        task=self.task();task['context']['not_after']='2026-11-03T15:00:00+03:00'
        self.reject('VALIDATION_FAILED',lambda:self.port.submit(task,self.peer))
    def test_conflicting_logical_request_after_resolve_not_reexecuted(self):
        task,r=self.submit();self.finish(r);task['request_id']=uid();task['query_input']['text']='обнови сводка заказов за октябрь 2026 на озоне'
        count=self.repo.call_count()
        self.reject('IDEMPOTENCY_CONFLICT',lambda:self.port.submit(task,self.peer));self.assertEqual(self.repo.call_count(),count)
    def test_old_receipts_and_result_payload_are_removed(self):
        _,r=self.submit();self.finish(r);self.clock.advance(90001)
        for _ in range(8):retention.sweep(self.repo)
        self.assertEqual(self.count('rt_job_refs'),0);self.assertEqual(self.count('rt_job_receipts'),0)
        with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM jobs WHERE result IS NOT NULL').fetchone()[0],0)
    def test_guarded_execution_works_after_authority_rebind_restart(self):
        _,r=self.submit()
        self.clock.advance(62)
        new_engine=Engine(self.repo,lambda _:self.auth.scope)
        new_port=RuntimePort(new_engine,self.auth,catalog_release_id='fixture-catalog',service_id='fixture-platform')
        Worker(new_engine,self.transport).step()
        self.assertTrue(new_port.read_result(r['job_ref'],self.ctx,self.peer)['complete'])

class DeliveryInvariants(Setup):
    def test_new_logical_explicit_refresh_creates_new_calculation(self):
        _,a=self.submit();self.finish(a)
        _,b=self.submit('обнови сводка заказов за октябрь 2026 на озоне')
        self.assertNotEqual(self.inner_id(a),self.inner_id(b));self.finish(b)
        self.assertEqual(len(self.transport.calls),2)
    def test_revoke_between_provider_pages_prevents_second_call(self):
        from test_runtime import wb_response
        _,r=self.submit('сводка заказов за октябрь 2026 на wb')
        def first_page(req,store):
            self.transport.calls.append(req)
            p={'period':{'from':req.body['selectedPeriod']['start'],'to':req.body['selectedPeriod']['end']}}
            return wb_response(p,n=1000),{'status':200,'elapsed_ms':1,'bytes':1000}
        self.transport.execute=first_page
        self.worker.step();self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'QUEUED')
        self.auth.revoked=True;self.clock.advance(62);self.worker.step()
        self.assertEqual(len(self.transport.calls),1);self.assertEqual(self.repo.get('A',self.inner_id(r))['state'],'FAILED')
    def test_schema_bytes_pinned_to_supplied_v05(self):
        import hashlib
        p=Path(__file__).resolve().parent.parent/'runtime_task_v1.schema.json'
        self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),'08b4b6c708c5ae1d5387dbd593fde7ea40c9f671efdad8b9aacbcab9bd683d34')
    def test_supplied_shape_valid_unauthorized_fixture(self):
        p=Path(__file__).resolve().parent.parent/'port_fixtures/runtime_shape_valid_but_unauthorized.json'
        t=json.loads(p.read_text());task_shape(t)
        self.reject('AUTH_REQUIRED',lambda:self.port.submit(t,self.peer));self.assertEqual(self.count('jobs'),0)
    def test_lost_delivery_replayed_with_same_id_not_recalculated(self):
        path=str(self.root/'lost.sock');server=Gateway(path,self.port,allowed_uid=os.getuid(),service_id='fixture-platform')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        task=self.task()
        try:
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
                sock.connect(path);sock.sendall((json.dumps({'schema_version':'runtime_port_v1','operation':'submit','payload':task})+'\n').encode())
                # Simulate the caller losing the response; it repeats the exact ID.
            again=request(path,'submit',task)
            self.worker.step();self.assertTrue(self.port.read_result(again['job_ref'],self.ctx,self.peer)['complete'])
            self.assertEqual(self.count('jobs'),1);self.assertEqual(len(self.transport.calls),1)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
