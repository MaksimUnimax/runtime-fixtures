"""Real template worker + encrypted archive, synthetic provider/model only."""
from copy import deepcopy
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import base64
import hashlib
import tempfile
import unittest
from engine import Engine, Worker, CallError
from repository import Repository
from semantics import Rejected, fingerprint, strict_json
from model_answer import Settings
from report_archive import Archive, TTL, CHUNK, document
from test_runtime import Clock, SCOPE, TODAY
from test_template_only import Transport, selection
import test_template_only as fixture
import template_catalog as tc
import retention


class Documents(unittest.TestCase):
    ask=fixture.Pilot.ask
    finish=fixture.Pilot.finish
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.clock=Clock();self.scope=SCOPE;self.seq=0
        self.repo=Repository(self.root/'state.sqlite3',self.clock)
        self.archive=Archive(self.repo,budget=16*1024*1024)
        self.settings=Settings(self.root/'answer.json')
        self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=self.settings,template_mode=True,report_archive=self.archive)
        self.transport=Transport();self.worker=Worker(self.engine,self.transport)
        self.disk=patch('report_archive.shutil.disk_usage',return_value=SimpleNamespace(free=10*1024**3));self.disk.start()
    def tearDown(self):self.disk.stop();self.temp.cleanup()
    def reports(self):return self.archive.list(self.scope,{})['items']
    def read(self, item):
        offset=0;result=b''
        while True:
            part=self.archive.read(self.scope,{},item['id'],offset)
            result+=base64.b64decode(part['base64']);offset=part['next_offset']
            if part['eof']:return result
    def complete(self):
        row=self.finish(self.ask());self.assertEqual(row['state'],'READY',row['error']);return row
    def direct(self,raw=b'actual-marketplace-file',mime='application/pdf',*,guard=None,tenant='A',jid='direct-job',operation='report_get',dependencies=None):
        template=next(iter(tc.TEMPLATES.values()))
        job={'id':jid,'tenant':tenant,'plan':__import__('semantics').canonical_json({'template_execution':{'catalog_hash':tc.HASH},'runtime_guard':guard})}
        invocation={'id':'direct-invocation'}
        ident=self.archive.save(job,invocation,template,asdict(self.scope.stores[0]),'ozon:oz:report',operation,raw,mime,hashlib.sha256(raw).hexdigest(),dependencies=['ozon:oz:report',*(dependencies or [])])
        with self.archive.connection()as c:return self.archive.metadata(c.execute('SELECT * FROM reports WHERE id=?',(ident,)).fetchone())

    def test_real_template_worker_archives_api_not_model_answer(self):
        self.complete();items=self.reports();self.assertEqual(len(items),1)
        self.assertEqual(items[0]['template']['id'],'SUMMARY.43')
        self.assertIn('Ответ API маркетплейса',self.read(items[0]).decode())
        self.assertNotIn(self.transport.answer,self.read(items[0]).decode())
        self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),1)

    def test_new_catalog_template_automatically_gets_name_and_file(self):
        added=deepcopy(tc.TEMPLATES['SUMMARY.43']);added.update(id='NEW.GENERIC.REPORT',purpose='Новый отчёт без правок архиватора')
        with patch.dict(tc.TEMPLATES,{added['id']:added}):
            self.transport.selection=selection((added['id'],));self.complete()
            item=self.reports()[0]
            self.assertEqual(item['template']['name'],added['purpose']);self.assertEqual(item['template']['id'],added['id'])
            self.assertIn(added['purpose'],self.read(item).decode())

    def test_shared_api_call_is_linked_to_both_requested_templates(self):
        added=deepcopy(tc.TEMPLATES['SUMMARY.43']);added.update(id='NEW.SECOND',purpose='Второй шаблон')
        with patch.dict(tc.TEMPLATES,{added['id']:added}):
            self.transport.selection=selection(('SUMMARY.43',added['id']));self.complete()
        self.assertEqual({r['template']['id']for r in self.reports()},{'SUMMARY.43',added['id']})
        self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),1)

    def test_coalesced_different_sources_are_not_attached_to_unrelated_templates(self):
        self.transport.selection=selection(('SUMMARY.43','B12.ad_spend'))
        original=self.transport.execute
        def execute(req,store):
            if req.operation=='ozon_ads_daily':
                self.transport.calls.append(req)
                return {'rows':[{'date':'2026-11-02','moneySpent':'5.25'}]},{'status':200}
            return original(req,store)
        self.transport.execute=execute;self.finish(self.ask())
        for item in self.reports():
            expected='B12.ad_spend' if item['operation']=='ozon_ads_daily' else 'SUMMARY.43'
            self.assertEqual(item['template']['id'],expected)
        self.assertTrue(any(x['operation']=='ozon_orders' for x in self.reports()))
        self.assertTrue(any(x['operation']=='ozon_ads_daily' for x in self.reports()))

    def test_auth_dependency_deny_hides_saved_document(self):
        from report_archive import template_operations, dependency_sources
        store=asdict(self.scope.stores[0])
        operations=template_operations('B12.ad_spend',store['platform'])
        sources=dependency_sources(operations,store)
        self.assertIn('ozon_ads_token',operations)
        item=self.direct(dependencies=sources)
        self.assertTrue(self.read(item))
        dependency=next(x for x in sources if x.endswith(':ozon_ads_token'))
        self.repo.deny(dependency,self.scope.stores[0].access_revision)
        self.assertEqual(self.reports(),[])
        with self.assertRaises(Rejected):self.read(item)

    def test_lease_expiring_during_document_render_rolls_back_archive(self):
        original=document
        def render(*args):
            value=original(*args);self.clock.advance(self.repo.lease+1);return value
        with patch('report_archive.document',render):
            self.ask()
            for _ in range(6):
                self.clock.advance(1);self.worker.step()
                if any(r.store_id for r in self.transport.calls):break
        self.assertTrue(any(r.store_id for r in self.transport.calls))
        self.assertEqual(self.reports(),[])

    def test_sparse_rows_use_complete_json_before_rectangular_expansion(self):
        value=[{'column_'+str(i):i} for i in range(2000)]
        raw,mime,_=document(value,'Sparse','op','now',{})
        self.assertEqual(mime,'application/json');self.assertEqual(strict_json(raw),value)

    def test_large_scalar_uses_complete_json(self):
        value={'text':'x'*1048577}
        raw,mime,_=document(value,'Large','op','now',{})
        self.assertEqual(mime,'application/json');self.assertEqual(strict_json(raw),value)

    def test_deep_value_uses_complete_json(self):
        value={'amount':'1.234567890123456789'}
        for _ in range(100):value={'nested':value}
        raw,mime,_=document(value,'Deep','op','now',{})
        self.assertEqual(mime,'application/json');self.assertEqual(strict_json(raw),value)

    def test_repeat_download_never_calls_provider_or_model(self):
        self.complete();calls=len(self.transport.calls);item=self.reports()[0]
        self.assertEqual(self.read(item),self.read(item));self.clock.advance(20);self.read(item)
        self.assertEqual(len(self.transport.calls),calls);self.assertEqual(self.reports()[0]['expires_at'],item['expires_at'])

    def test_original_binary_file_is_exact(self):
        raw=b'%PDF-1.7\n'+bytes(range(256))*300
        item=self.direct(raw);self.assertEqual(self.read(item),raw)
        self.assertEqual(item['sha256'],hashlib.sha256(raw).hexdigest())

    def test_archive_survives_short_job_ttl_and_job_deletion(self):
        row=self.complete();item=self.reports()[0]
        self.clock.advance(86401);retention.sweep(self.repo)
        with self.repo.connection(True)as c:c.execute('DELETE FROM jobs WHERE id=?',(row['id'],))
        self.assertTrue(self.read(item));self.assertEqual(len(self.reports()),1)

    def test_exact_48_hour_boundary_and_cleanup(self):
        item=self.direct();self.clock.advance(TTL-1);self.assertTrue(self.read(item))
        self.clock.advance(1)
        with self.assertRaises(Rejected)as e:self.read(item)
        self.assertEqual(e.exception.code,'RESULT_EXPIRED');self.assertEqual(self.reports(),[])
        self.assertEqual(self.archive.prune(),1)
        with self.archive.connection()as c:
            self.assertEqual(c.execute('SELECT COUNT(*)FROM reports').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT COUNT(*)FROM blocks').fetchone()[0],0)

    def test_independent_existing_retention_timer_removes_archive(self):
        self.direct();self.clock.advance(TTL)
        result=retention.maintain(self.repo.path)
        # Maintenance wall clock is later than fixture time, so this is expired.
        self.assertEqual(result['removed_or_redacted']['expired_marketplace_documents'],1)

    def test_tenant_store_and_owner_are_checked(self):
        guard={'pins':{'tenant_id':'public-tenant','actor_id':'owner'}}
        item=self.direct(guard=guard)
        for scope,who in [(replace(self.scope,tenant='other'),{'tenant_id':'public-tenant','actor_id':'owner'}),
                          (self.scope,{'tenant_id':'public-tenant','actor_id':'other'}),
                          (replace(self.scope,stores=(replace(self.scope.stores[0],access_revision='new-key'),)),{'tenant_id':'public-tenant','actor_id':'owner'})]:
            with self.assertRaises(Rejected):self.archive.read(scope,who,item['id'],0)
        part=self.archive.read(self.scope,{'tenant_id':'public-tenant','actor_id':'owner'},item['id'],0)
        self.assertTrue(part['eof'])

    def test_source_deny_blocks_previously_saved_file(self):
        item=self.direct();self.repo.deny('ozon:oz:report',self.scope.stores[0].access_revision)
        self.assertEqual(self.reports(),[])
        with self.assertRaises(Rejected):self.read(item)

    def test_duplicate_received_response_does_not_extend_lifetime(self):
        first=self.direct();self.clock.advance(60);second=self.direct()
        self.assertEqual(first['id'],second['id']);self.assertEqual(first['expires_at'],second['expires_at'])

    def test_payload_is_encrypted_and_tampering_is_rejected(self):
        marker=b'private-marketplace-number-9187362';item=self.direct(marker)
        self.assertNotIn(marker,self.archive.path.read_bytes())
        with self.archive.connection()as c:c.execute('UPDATE blocks SET payload=?',(b'changed',))
        with self.assertRaises(Rejected)as e:self.read(item)
        self.assertEqual(e.exception.code,'DEPENDENCY_UNAVAILABLE')

    def test_render_is_generic_and_escapes_html(self):
        value={'products':[{'unknown_column':'<script>alert(1)</script>','n':1},{'new_column':False}], 'empty':[], 'null':None}
        raw,mime,_=document(value,'<img src=x>','generic_new_operation','now',{'period':None})
        text=raw.decode();self.assertEqual(mime,'text/html');self.assertIn('<table>',text)
        self.assertIn('new_column',text);self.assertNotIn('<script>',text);self.assertIn('&lt;script&gt;',text)
        self.assertNotIn('<img',text)

    def test_sensitive_keys_and_signed_urls_do_not_enter_document(self):
        raw,_,_=document({'api_key':'do-not-store-123','download':'https://example.test/a?signature=do-not-store-456'},'Title','op','now',{})
        self.assertNotIn(b'do-not-store',raw)

    def test_owner_document_keeps_business_fields_and_exact_decimal(self):
        from decimal import Decimal
        value={'buyer_name':'Иван','email':'owner@example.test','amount':Decimal('123.456789012345678901')}
        raw,_,_=document(value,'Title','op','now',{})
        self.assertIn('Иван',raw.decode());self.assertIn(b'owner@example.test',raw)
        self.assertIn(b'123.456789012345678901',raw)

    def test_original_file_from_transport_metadata_is_not_reencoded(self):
        from report_archive import BINARY_META
        original=self.transport.execute;raw=b'%PDF-1.7\noriginal marketplace file'
        def execute(req,store):
            value,meta=original(req,store)
            if store is not None:meta[BINARY_META]=(raw,'application/pdf')
            return value,meta
        self.transport.execute=execute;self.complete()
        self.assertEqual(self.read(self.reports()[0]),raw)

    def test_model_failure_does_not_lose_received_marketplace_data(self):
        original=self.transport.execute
        def execute(req,store):
            if req.operation=='model_answer':raise CallError('HTTP_400',status=400)
            return original(req,store)
        self.transport.execute=execute;row=self.finish(self.ask())
        self.assertEqual(row['state'],'FAILED');self.assertEqual(len(self.reports()),1)

    def test_denied_api_is_not_saved_as_report(self):
        original=self.transport.execute
        def execute(req,store):
            if store:raise CallError('HTTP_403',status=403)
            return original(req,store)
        self.transport.execute=execute;self.finish(self.ask());self.assertEqual(self.reports(),[])

    def test_cancel_during_io_prevents_late_archive_publication(self):
        def cancel(req):
            if req.store_id:
                with self.repo.reader_scope('A','template-test-session'):self.repo.cancel('A')
        self.transport.on_call=cancel;self.finish(self.ask());self.assertEqual(self.reports(),[])

    def test_scope_revoked_during_api_io_is_not_archived(self):
        def revoke(req):
            if req.store_id:self.scope=replace(self.scope,revision='revoked-during-io')
        self.transport.on_call=revoke
        row=self.finish(self.ask());self.assertEqual(row['state'],'FAILED')
        self.assertEqual(self.reports(),[])

    def test_storage_reserve_failure_visible_without_repeating_api(self):
        self.archive.budget=0
        self.complete()
        item=self.reports()[0];self.assertEqual(item['error'],'STORAGE_CAPACITY')
        self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),1)
        with self.assertRaises(Rejected)as e:self.read(item)
        self.assertEqual(e.exception.code,'STORAGE_CAPACITY')

    def test_restart_and_catalog_changes_preserve_original_title(self):
        self.complete();item=self.reports()[0];title=item['template']['name']
        self.archive=Archive(self.repo)
        with patch.dict(tc.TEMPLATES,{'SUMMARY.43':{**tc.TEMPLATES['SUMMARY.43'],'purpose':'Новое название'}}):
            self.assertEqual(self.reports()[0]['template']['name'],title);self.assertTrue(self.read(item))

    def test_pagination_does_not_drop_same_timestamp_files(self):
        for i in range(53):self.direct(jid='job-'+str(i))
        a=self.archive.list(self.scope,{});b=self.archive.list(self.scope,{},a['next_cursor'])
        self.assertEqual(len(a['items']),50);self.assertEqual(len(b['items']),3)
        self.assertEqual(len({r['id']for r in a['items']+b['items']}),53)

    def test_chunk_alignment_and_foreign_id_rejected(self):
        item=self.direct(b'x'*(CHUNK+1))
        for offset in (-1,1,CHUNK*2):
            with self.assertRaises(Rejected):self.archive.read(self.scope,{},item['id'],offset)
        with self.assertRaises(Rejected):self.archive.read(self.scope,{},'00000000-0000-0000-0000-000000000000',0)

    def test_unrelated_non_template_jobs_are_not_backfilled(self):
        self.engine.template_mode=False;self.finish(self.ask())
        self.assertEqual(self.reports(),[])


if __name__=='__main__':unittest.main()
