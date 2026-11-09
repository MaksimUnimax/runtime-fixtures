"""Archive read authority is current and independent of the execution receipt."""
from dataclasses import asdict, replace
from unittest.mock import patch
from types import SimpleNamespace
from uuid import uuid4
import hashlib
from test_runtime_port_r01_contract import Setup, uid
from semantics import canonical_json, Rejected
from report_archive import Archive, CHUNK, owner
from runtime_port_ipc import dispatch
import template_catalog as tc


class ReportsPort(Setup):
    def setUp(self):
        super().setUp()
        self.archive=Archive(self.repo);self.engine.report_archive=self.archive
        self.disk=patch('report_archive.shutil.disk_usage',return_value=SimpleNamespace(free=10*1024**3));self.disk.start();self.addCleanup(self.disk.stop)
        ctx,guard,scope=self.port._auth(self.ctx,self.peer,'list_reports')
        raw=b'actual-original-file\n'*5000
        job={'id':'already-collected','tenant':scope.tenant,'plan':canonical_json({'runtime_guard':guard,'template_execution':{'catalog_hash':tc.HASH}})}
        self.ident=self.archive.save(job,{'id':'invocation'},next(iter(tc.TEMPLATES.values())),asdict(scope.stores[0]),'fixture-source','fixture_operation',raw,'text/csv',hashlib.sha256(raw).hexdigest(),dependencies=['fixture-source'])

    def test_private_list_and_chunk_are_read_only(self):
        value=dispatch(self.port,self.peer,{'schema_version':'runtime_port_v1','operation':'list_reports','payload':{'context':self.ctx,'cursor':None}})
        self.assertEqual(value['items'][0]['id'],self.ident)
        first=self.port.read_report(self.ident,0,self.ctx,self.peer);second=self.port.read_report(self.ident,CHUNK,self.ctx,self.peer)
        self.assertFalse(first['eof']);self.assertTrue(second['eof']);self.assertEqual(self.transport.calls,[])
        self.assertEqual(self.count('jobs'),0);self.assertEqual(self.count('rt_job_refs'),0)

    def test_no_grant_no_saved_file(self):
        self.auth.revoked=True
        self.reject('ACCESS_REQUIRED',lambda:self.port.read_report(self.ident,0,self.ctx,self.peer))

    def test_other_actor_cannot_read_existing_file(self):
        other=self.auth.issue({**self.ctx,'actor_id':uid()})
        self.reject('NOT_FOUND',lambda:self.port.read_report(self.ident,0,other,self.peer))

    def test_other_tenant_cannot_read_existing_file(self):
        other=self.auth.issue({**self.ctx,'tenant_id':uid()})
        self.reject('NOT_FOUND',lambda:self.port.read_report(self.ident,0,other,self.peer))

    def test_key_revision_change_blocks_existing_file(self):
        self.auth.scope=replace(self.auth.scope,stores=tuple(replace(s,access_revision='new')for s in self.auth.scope.stores))
        self.reject('NOT_FOUND',lambda:self.port.read_report(self.ident,0,self.ctx,self.peer))

    def test_revocation_after_decryption_blocks_chunk(self):
        original=self.archive.read
        def revoke(*args,**kwargs):
            data=original(*args,**kwargs);self.auth.revoked=True;return data
        with patch.object(self.archive,'read',side_effect=revoke):
            self.reject('ACCESS_REQUIRED',lambda:self.port.read_report(self.ident,0,self.ctx,self.peer))

    def test_source_deny_after_decryption_blocks_chunk(self):
        original=self.archive.read
        def revoke(*args,**kwargs):
            data=original(*args,**kwargs);self.repo.deny('fixture-source',self.auth.scope.stores[0].access_revision);return data
        with patch.object(self.archive,'read',side_effect=revoke):
            self.reject('NOT_FOUND',lambda:self.port.read_report(self.ident,0,self.ctx,self.peer))

    def test_expired_file_not_reopened_by_fresh_session(self):
        with self.archive.connection()as c:c.execute('UPDATE reports SET expires=?',(self.clock()-1,))
        self.assertEqual(self.port.list_reports(self.ctx,self.peer)['items'],[])
        self.reject('RESULT_EXPIRED',lambda:self.port.read_report(self.ident,0,self.ctx,self.peer))

    def test_wrong_peer_and_unknown_fields_rejected(self):
        from runtime_port import Peer
        self.reject('AUTH_REQUIRED',lambda:self.port.list_reports(self.ctx,Peer('other','alisa_market')))
        payload={'context':self.ctx,'file_id':self.ident,'offset':0,'path':'/etc/passwd'}
        self.reject('VALIDATION_FAILED',lambda:dispatch(self.port,self.peer,{'schema_version':'runtime_port_v1','operation':'read_report','payload':payload}))

    def test_archiving_can_be_disabled_without_changing_legacy_methods(self):
        self.engine.report_archive=None
        self.reject('CAPABILITY_UNAVAILABLE',lambda:self.port.list_reports(self.ctx,self.peer))
        self.assertIn('read_report',self.port.capabilities(self.ctx,self.peer)['operations'])

    def test_new_catalog_release_does_not_require_old_job_to_reexecute(self):
        self.port.catalog_release_id='next-published-catalog'
        self.port.versions['catalog_bundle_hash']='a'*64
        current=self.auth.issue({**self.ctx,'catalog_release_id':'next-published-catalog'})
        value=self.port.read_report(self.ident,0,current,self.peer)
        self.assertEqual(value['id'],self.ident);self.assertEqual(self.transport.calls,[])
