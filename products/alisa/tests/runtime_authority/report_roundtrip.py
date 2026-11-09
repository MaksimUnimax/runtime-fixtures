#!/usr/bin/env python3
"""48-hour archive through real PG authority + Unix consumer + account API.

Only the marketplace/model are synthetic. No owner grants or sessions are used.
"""
import argparse
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from query_roundtrip import QueryChecks, connections, TEMP
from checks import uid, timezone, AccessAdjustment
from django.test import RequestFactory
from django.conf import settings
from model_answer import Settings
from report_archive import Archive, CHUNK
from test_template_only import Transport, selection
from engine import Worker
from alisa_platform.queries import reports as endpoint
from alisa_platform.queries.models import Query
import template_catalog as catalog


OWNED_LOOPBACK_PORTS={55480}


class ReportChecks(QueryChecks):
    def setUp(self):
        super().setUp()
        self.engine.template_mode=True
        self.engine.answer_settings=Settings(Path(self.repo.path).with_name('answer.json'))
        self.repo.answer_settings=self.engine.answer_settings
        self.archive=Archive(self.repo);self.engine.report_archive=self.archive
        _,_,scope=self.port._auth(self.client._context('submit'),self.peer,'submit')
        self.transport=Transport();self.transport.selection=selection(store=scope.stores[0].id)
        self.worker=Worker(self.engine,self.transport)
        self.disk=patch('report_archive.shutil.disk_usage',return_value=SimpleNamespace(free=10*1024**3));self.disk.start();self.addCleanup(self.disk.stop)
        self.factory=RequestFactory()

    def api(self,action='list',**values):
        request=self.factory.post('/api/v1/account/reports',data=json.dumps({'session_token':self.web_token,
            'store_id':str(self.store.pk),'command':{'action':action,**values}}),content_type='application/json',
            HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
        response=endpoint.reports(request)
        return response.status_code,json.loads(response.content)

    def produce(self):
        value,status=self.send();self.assertEqual(status,201)
        for _ in range(10):
            row=Query.objects.get(pk=self.qid)
            current=self.row({'job_ref':str(row.runtime_job_ref)})
            if current['state']not in('QUEUED','RUNNING'):break
            self.worker.step();self.clock.advance(1)
        self.assertEqual(current['state'],'READY',current['error'])
        status,body=self.api(cursor=None);self.assertEqual(status,200,body)
        self.assertEqual(len(body['items']),1);return body['items'][0]

    def test_report_real_template_to_account_api_and_same_file_twice(self):
        item=self.produce();calls=len(self.transport.calls)
        first=self.api('read',id=item['id'],offset=0);second=self.api('read',id=item['id'],offset=0)
        self.assertEqual(first,second);self.assertEqual(first[0],200,first[1])
        raw=base64.b64decode(first[1]['base64']);self.assertIn('Ответ API',raw.decode())
        self.assertEqual(len(self.transport.calls),calls)
        self.assertEqual(sum(bool(r.store_id)for r in self.transport.calls),1)

    def test_report_new_template_is_automatically_named(self):
        t=deepcopy(catalog.TEMPLATES['SUMMARY.43']);t.update(id='FUTURE.API.DATA',purpose='Новый шаблон автоматически')
        with patch.dict(catalog.TEMPLATES,{t['id']:t}):
            self.transport.selection['invocations'][0]['template_id']=t['id']
            item=self.produce()
        self.assertEqual(item['template']['name'],t['purpose'])

    def test_report_survives_expired_job_and_deleted_query_receipt(self):
        item=self.produce()
        with self.repo.connection(True)as c:c.execute("UPDATE jobs SET state='EXPIRED',expires=?",(self.clock()-1,))
        Query.objects.all().delete()
        self.assertEqual(self.api('read',id=item['id'],offset=0)[0],200)

    def test_report_session_revoked_after_file_exists(self):
        item=self.produce();self.session.revoked_at=timezone.now();self.session.save(update_fields=['revoked_at'])
        self.assertEqual(self.api('read',id=item['id'],offset=0)[0],401)

    def test_report_grant_revoked_after_file_exists(self):
        item=self.produce();AccessAdjustment.objects.create(id=uid(),grant=self.grant,cutoff=timezone.now(),actor_id=uid(),reason='INITIAL_TEST')
        status,body=self.api('read',id=item['id'],offset=0);self.assertEqual(status,403);self.assertEqual(body['code'],'ACCESS_REQUIRED')

    def test_report_key_revoked_after_file_exists(self):
        item=self.produce();row=self.credentials[0];row.status='REVOKED';row.save(update_fields=['status'])
        status,body=self.api('read',id=item['id'],offset=0);self.assertEqual(status,403);self.assertEqual(body['code'],'CREDENTIAL_REVOKED')

    def test_report_foreign_file_and_store_not_accepted(self):
        self.produce();self.assertEqual(self.api('read',id=uid(),offset=0)[0],404)
        self.assertEqual(self.api('read',id='../../etc/passwd',offset=0)[0],422)

    def test_report_expired_even_before_physical_cleanup(self):
        item=self.produce()
        with self.archive.connection()as c:c.execute('UPDATE reports SET expires=?,created=?',(self.clock()-1,self.clock()-1-172800))
        self.assertEqual(self.api('read',id=item['id'],offset=0)[0],410)
        self.assertEqual(self.api(cursor=None)[1]['items'],[])

    def test_report_revocation_between_download_chunks_stops_rest(self):
        item=self.produce()
        self.assertEqual(self.api('read',id=item['id'],offset=0)[0],200)
        row=self.credentials[0];row.status='REVOKED';row.save(update_fields=['status'])
        self.assertEqual(self.api('read',id=item['id'],offset=CHUNK)[0],403)

    def test_report_safe_metadata_has_no_native_identity_or_question(self):
        item=self.produce();dump=json.dumps(item,ensure_ascii=False)
        self.assertNotIn(self.web_token,dump);self.assertNotIn('runtime_tenant',dump)
        self.assertNotIn('execution_ticket',dump);self.assertNotIn('original_question',dump)

    def test_report_packaged_https_browser_download(self):
        from report_browser import run
        self.browser_record=run(self,OWNED_LOOPBACK_PORTS)

    def test_report_endpoint_rejects_unauthenticated_boundary(self):
        request=self.factory.post('/api/v1/account/reports',data='{}',content_type='application/json')
        self.assertEqual(endpoint.reports(request).status_code,401)

    def test_report_archive_budget_failure_is_explicit(self):
        self.archive.budget=0
        item=self.produce()
        self.assertEqual(item['error'],'STORAGE_CAPACITY')
        self.assertEqual(self.api('read',id=item['id'],offset=0)[1]['code'],'STORAGE_CAPACITY')

    def test_report_grant_revoked_during_io_never_publishes_file(self):
        def revoke(req):
            if req.store_id:AccessAdjustment.objects.create(id=uid(),grant=self.grant,cutoff=timezone.now(),actor_id=uid(),reason='INITIAL_TEST')
        self.transport.on_call=revoke
        self.send()
        for _ in range(4):self.worker.step();self.clock.advance(1)
        with self.archive.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM reports').fetchone()[0],0)
        self.assertEqual(sum(bool(r.store_id)for r in self.transport.calls),1)

    def test_report_key_revoked_during_io_never_publishes_file(self):
        def revoke(req):
            if req.store_id:
                row=self.credentials[0];row.status='REVOKED';row.save(update_fields=['status'])
        self.transport.on_call=revoke
        self.send()
        for _ in range(4):self.worker.step();self.clock.advance(1)
        with self.archive.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM reports').fetchone()[0],0)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    connect=socket.socket.connect
    def confined(peer,address):
        if peer.family==socket.AF_UNIX or peer.family==socket.AF_INET and address[0]=='127.0.0.1' and address[1]in OWNED_LOOPBACK_PORTS:return connect(peer,address)
        raise AssertionError('External network forbidden')
    resolver=socket.getaddrinfo
    def resolve(host,port,*a,**kw):
        if host=='127.0.0.1' and int(port)in OWNED_LOOPBACK_PORTS:return resolver(host,port,family=socket.AF_INET,type=socket.SOCK_STREAM,flags=socket.AI_NUMERICHOST)
        raise AssertionError('External DNS forbidden')
    try:
        suite=unittest.TestSuite(ReportChecks(name)for name in ReportChecks.__dict__ if name.startswith('test_report_') and (name!='test_report_packaged_https_browser_download' or __import__('os').environ.get('ALISA_REPORT_BROWSER_ARTIFACT')))
        with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=resolve):
            result=unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope':'REPORT_ARCHIVE_REAL_PG_UNIX_ACCOUNT_API_SYNTHETIC_MARKETPLACE_MODEL','status':'PASS'if result.wasSuccessful()else'FAIL','browser_requested':bool(__import__('os').environ.get('ALISA_REPORT_BROWSER_ARTIFACT')),'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful()else 1)
    finally:connections.close_all();TEMP.cleanup()
