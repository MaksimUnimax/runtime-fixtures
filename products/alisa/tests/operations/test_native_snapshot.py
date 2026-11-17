"""Native read-only snapshot against disposable SQLite including uncheckpointed WAL.

No production files/configuration, authorization grant, runtime socket or API.
The deliberately explicit schema mirrors only the columns this reader requires.
"""
from dataclasses import replace
import ast
import time
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT/'docs/alisa/runtime/v0.11/rt_job_r02/reconciliation_snapshot.py'
spec = importlib.util.spec_from_file_location('s16_native_snapshot', SOURCE)
n = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = n
spec.loader.exec_module(n)

SCHEMA = '''
CREATE TABLE rt_job_refs(ref TEXT PRIMARY KEY,tenant TEXT,actor TEXT,logical_id TEXT,
 body_hash TEXT,guard_hash TEXT,runtime_tenant TEXT,jid TEXT,created REAL);
CREATE TABLE jobs(id TEXT PRIMARY KEY,tenant TEXT,state TEXT,created REAL,updated REAL,
 due REAL,lease REAL,owner TEXT,expires REAL,alias TEXT,dispatch_order INTEGER,
 resume_safe INTEGER,draft TEXT,plan TEXT,progress TEXT,result TEXT,error TEXT);
CREATE TABLE reader_cursors(tenant TEXT,conversation TEXT,jid TEXT,cancelled INTEGER,
 updated REAL,PRIMARY KEY(tenant,conversation,jid));
CREATE TABLE calls(id INTEGER PRIMARY KEY,jid TEXT,at REAL,state TEXT,http INTEGER,
 elapsed_ms INTEGER,response_bytes INTEGER,source TEXT);
'''


class NativeSnapshot(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='alisa-s16-snapshot-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root/'native.sqlite3'
        self.c = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(self.c.close)
        self.c.execute('PRAGMA journal_mode=WAL')
        self.c.execute('PRAGMA wal_autocheckpoint=0')
        self.c.executescript(SCHEMA)
        self.path.chmod(0o600)
        self.scope = n.NativeScope(*(str(uuid4()) for _ in range(4)), 'native-synthetic', 'a'*64)
        self.jid = uuid4().hex
        self.c.execute('INSERT INTO rt_job_refs VALUES(?,?,?,?,?,?,?,?,?)',
            (self.scope.runtime_job_ref,self.scope.tenant_id,self.scope.customer_id,
             self.scope.object_id,'b'*64,self.scope.guard_sha256,self.scope.runtime_tenant,self.jid,900.25))
        self.c.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (self.jid,self.scope.runtime_tenant,'UNKNOWN',900.125,901.75,900.,None,None,None,None,0,0,
             'private question','private plan','private progress','private result','private error'))
        self.c.execute('INSERT INTO reader_cursors VALUES(?,?,?,?,?)',
            (self.scope.runtime_tenant,'rt_'+self.scope.runtime_job_ref.replace('-',''),self.jid,0,901.))
        self.before = self.c.total_changes

    def read(self, **kw):
        return n.read_snapshot(self.path,self.scope,expected_uid=os.getuid(),clock=lambda:1000.,**kw)

    def assert_closed(self, code, function=None):
        with self.assertRaises(n.SnapshotUnavailable) as error:
            (function or self.read)()
        self.assertEqual(error.exception.code, code)
        self.assertNotIn(str(self.path),str(error.exception))

    def call(self, *, jid=None, state='UNKNOWN', http=None, at=902.):
        self.c.execute('INSERT INTO calls(jid,at,state,http,elapsed_ms,response_bytes,source) VALUES(?,?,?,?,?,?,?)',
            (jid or self.jid,at,state,http,None,None,'private account/endpoint'))

    def test_exact_native_metadata_without_fake_dispatch_uuid_or_revision(self):
        v=self.read();b=v['binding']
        self.assertEqual(v['schema'],n.SCHEMA)
        self.assertEqual(b['request_sha256'],'b'*64)
        self.assertEqual(b['dispatch_sequence'],0)
        self.assertEqual(b['native_created_at'],900.125)
        self.assertEqual(b['native_updated_at'],901.75)
        self.assertNotIn('revision',b);self.assertNotIn('dispatch_id',b)
        self.assertEqual(b['native_job_ref_sha256'],hashlib.sha256(self.jid.encode()).hexdigest())
        self.assertEqual(v['binding_sha256'],n.digest(b))

    def test_unknown_does_not_expire_clear_requeue_or_create_any_logical_write(self):
        before=list(self.c.iterdump());self.read()
        self.assertEqual(list(self.c.iterdump()),before)
        self.assertEqual(self.c.total_changes,self.before)

    def test_absent_calls_never_prove_absent_external_execution(self):
        v=self.read()
        self.assertEqual(v['retained_calls'],[])
        self.assertFalse(v['call_history_complete'])
        self.assertEqual(v['whole_job_outcome'],'UNPROVEN')
        self.assertFalse(v['job_state_changed']);self.assertFalse(v['replay_permitted'])

    def test_received_200_call_never_proves_complete_job(self):
        self.call(state='RECEIVED',http=200);v=self.read()
        self.assertEqual(v['retained_calls'][0]['http'],200)
        self.assertEqual(v['whole_job_outcome'],'UNPROVEN')
        self.assertFalse(v['call_history_complete'])

    def test_payload_credentials_raw_job_and_owner_never_returned(self):
        self.call();self.c.execute('UPDATE jobs SET owner=?',(uuid4().hex,))
        v=self.read();raw=json.dumps(v)
        for value in ('private','native-synthetic',self.jid,'question','plan','result','progress'):
            self.assertNotIn(value,raw)
        self.assertTrue(v['binding']['has_owner'])

    def test_all_exact_reference_scope_fields_are_required(self):
        for field in ('object_id','tenant_id','customer_id','runtime_job_ref'):
            with self.subTest(field=field):
                wrong=replace(self.scope,**{field:str(uuid4())})
                self.assert_closed('OPERATION_BINDING_UNAVAILABLE',lambda:n.read_snapshot(
                    self.path,wrong,expected_uid=os.getuid(),clock=lambda:1000.))

    def test_native_tenant_and_guard_changes_are_not_same_operation(self):
        for field,value in [('runtime_tenant','another'),('guard_sha256','c'*64)]:
            with self.subTest(field=field):
                wrong=replace(self.scope,**{field:value})
                self.assert_closed('OPERATION_SCOPE_CHANGED',lambda:n.read_snapshot(
                    self.path,wrong,expected_uid=os.getuid(),clock=lambda:1000.))

    def test_pruned_reference_is_unavailable_not_empty_success(self):
        self.c.execute('DELETE FROM rt_job_refs');self.assert_closed('OPERATION_BINDING_UNAVAILABLE')

    def test_missing_native_job_is_not_reconstructed(self):
        self.c.execute('DELETE FROM jobs');self.assert_closed('NATIVE_JOB_UNAVAILABLE')

    def test_foreign_native_job_is_not_followed(self):
        self.c.execute("UPDATE jobs SET tenant='another'");self.assert_closed('NATIVE_JOB_UNAVAILABLE')

    def test_alias_is_explicitly_unsupported_not_followed_to_another_job(self):
        self.c.execute('UPDATE jobs SET alias=?',(uuid4().hex,))
        self.assert_closed('ALIAS_REQUIRES_SEPARATE_PROOF')

    def test_pruned_reader_is_explicitly_unavailable(self):
        self.c.execute('DELETE FROM reader_cursors');self.assert_closed('READER_BINDING_UNAVAILABLE')

    def test_cancelled_reader_is_not_converted_into_job_cancellation(self):
        self.c.execute('UPDATE reader_cursors SET cancelled=1')
        self.assert_closed('READER_CANCELLED')
        self.assertEqual(self.c.execute('SELECT state FROM jobs').fetchone()[0],'UNKNOWN')

    def test_one_reader_does_not_inherit_another_conversation(self):
        self.c.execute("UPDATE reader_cursors SET conversation='different'")
        self.assert_closed('READER_BINDING_UNAVAILABLE')

    def test_uncheckpointed_wal_is_visible_not_stale_main_file(self):
        self.c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        old=hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.c.execute('UPDATE jobs SET dispatch_order=7,updated=904.125')
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),old)
        self.assertGreater(Path(str(self.path)+'-wal').stat().st_size,0)
        v=self.read();self.assertEqual(v['binding']['dispatch_sequence'],7)
        self.assertEqual(v['binding']['native_updated_at'],904.125)

    def test_consistent_read_snapshot_when_writer_commits_between_selects(self):
        original=n._one;seen=[]
        def interleave(connection,query,values,missing):
            row=original(connection,query,values,missing)
            if not seen:
                seen.append(True);self.c.execute('UPDATE jobs SET dispatch_order=9,updated=905.')
            return row
        with patch.object(n,'_one',side_effect=interleave):v=self.read()
        self.assertEqual(v['binding']['dispatch_sequence'],0)
        self.assertEqual(self.read()['binding']['dispatch_sequence'],9)

    def test_dispatch_change_changes_snapshot_binding(self):
        old=self.read()['binding_sha256']
        self.c.execute('UPDATE jobs SET dispatch_order=1')
        self.assertNotEqual(self.read()['binding_sha256'],old)

    def test_subsecond_update_change_changes_binding(self):
        old=self.read()['binding_sha256']
        self.c.execute('UPDATE jobs SET updated=901.750001')
        self.assertNotEqual(self.read()['binding_sha256'],old)

    def test_observation_time_is_not_operation_identity(self):
        left=self.read();right=n.read_snapshot(self.path,self.scope,expected_uid=os.getuid(),clock=lambda:1001.)
        self.assertEqual(left['binding_sha256'],right['binding_sha256'])
        self.assertNotEqual(left['observed_at'],right['observed_at'])

    def test_calls_are_bounded_and_truncation_is_not_complete_history(self):
        for _ in range(20):self.call()
        v=self.read();self.assertEqual(len(v['retained_calls']),16)
        self.assertTrue(v['retained_calls_truncated']);self.assertFalse(v['call_history_complete'])
        self.assertEqual([x['id'] for x in v['retained_calls']],list(range(20,4,-1)))

    def test_other_jobs_calls_are_never_mixed(self):
        self.call(jid=uuid4().hex);self.assertEqual(self.read()['retained_calls'],[])

    def test_corrupt_native_fields_fail_closed(self):
        for column,value in [('state','MADE_UP'),('created',float('inf')),('updated',899.),
                             ('dispatch_order',-1),('resume_safe',2),('lease',-1.)]:
            with self.subTest(column=column):
                old=self.c.execute('SELECT '+column+' FROM jobs').fetchone()[0]
                self.c.execute('UPDATE jobs SET '+column+'=?',(value,))
                with self.assertRaises(n.SnapshotUnavailable):self.read()
                self.c.execute('UPDATE jobs SET '+column+'=?',(old,))

    def test_invalid_call_data_fail_closed_not_ignored(self):
        self.call()
        for column,value in [('state','DONE_FROM_GUESS'),('http',999),('at',float('inf')),
                             ('elapsed_ms',-1),('response_bytes',-1)]:
            with self.subTest(column=column):
                old=self.c.execute('SELECT '+column+' FROM calls').fetchone()[0]
                self.c.execute('UPDATE calls SET '+column+'=?',(value,))
                self.assert_closed('SNAPSHOT_INVALID')
                self.c.execute('UPDATE calls SET '+column+'=?',(old,))

    def test_schema_missing_is_unavailable_not_zero(self):
        self.c.execute('DROP TABLE calls');self.assert_closed('NATIVE_SNAPSHOT_UNAVAILABLE')

    def test_readonly_authorizer_denies_every_write_and_private_column(self):
        with sqlite3.connect(':memory:') as c:
            c.executescript(SCHEMA);c.set_authorizer(n._authorizer)
            for statement in ('UPDATE jobs SET state=state','DELETE FROM jobs','CREATE TABLE x(a)',
                              "ATTACH DATABASE ':memory:' AS other",'PRAGMA query_only=OFF',
                              'SELECT draft FROM jobs','SELECT source FROM calls','SELECT sqlite_version()'):
                with self.subTest(statement=statement),self.assertRaises(sqlite3.DatabaseError):c.execute(statement)
            c.execute('SELECT state FROM jobs')

    def test_view_cannot_substitute_for_exact_table(self):
        self.c.execute('ALTER TABLE jobs RENAME TO secret_jobs')
        self.c.execute('CREATE VIEW jobs AS SELECT * FROM secret_jobs')
        self.assert_closed('NATIVE_SNAPSHOT_UNAVAILABLE')

    def test_symlink_database_is_refused(self):
        p=self.root/'alias.sqlite3';p.symlink_to(self.path)
        self.assert_closed('DATABASE_PATH_INVALID',lambda:n.read_snapshot(p,self.scope,expected_uid=os.getuid()))

    def test_symlink_parent_is_refused(self):
        link=self.root/'alias';link.symlink_to(self.root,target_is_directory=True)
        self.assert_closed('DATABASE_PATH_INVALID',lambda:n.read_snapshot(link/self.path.name,self.scope,expected_uid=os.getuid()))

    def test_hardlink_is_refused(self):
        os.link(self.path,self.root/'second');self.assert_closed('DATABASE_IDENTITY_INVALID')

    def test_wrong_owner_is_refused_without_chmod(self):
        self.assert_closed('DATABASE_IDENTITY_INVALID',lambda:n.read_snapshot(
            self.path,self.scope,expected_uid=os.getuid()+12345))
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)

    def test_group_writable_database_is_refused(self):
        self.path.chmod(0o660);self.assert_closed('DATABASE_IDENTITY_INVALID')

    def test_group_writable_parent_is_refused(self):
        self.root.chmod(0o770);self.assert_closed('DATABASE_IDENTITY_INVALID')

    def test_missing_database_is_not_created(self):
        missing=self.root/'missing'
        self.assert_closed('NATIVE_SNAPSHOT_UNAVAILABLE',lambda:n.read_snapshot(
            missing,self.scope,expected_uid=os.getuid()))
        self.assertFalse(missing.exists())

    def test_path_replacement_during_read_is_detected(self):
        original=n._read
        def replaced(c,scope,now):
            value=original(c,scope,now)
            self.path.rename(self.root/'moved');self.path.write_bytes(b'replacement');self.path.chmod(0o600)
            return value
        with patch.object(n,'_read',side_effect=replaced):self.assert_closed('DATABASE_IDENTITY_CHANGED')

    def test_invalid_clock_and_backwards_clock_are_refused(self):
        for value in (float('nan'),float('inf'),True,-1.):
            with self.subTest(value=value),self.assertRaises(n.SnapshotUnavailable):
                n.read_snapshot(self.path,self.scope,expected_uid=os.getuid(),clock=lambda:value)
        clock=iter([1000.,999.])
        self.assert_closed('SNAPSHOT_CLOCK_CHANGED',lambda:n.read_snapshot(
            self.path,self.scope,expected_uid=os.getuid(),clock=lambda:next(clock)))

    def test_deadline_expiry_is_refused_without_retry(self):
        clock=iter([0.,1.])
        with patch.object(n.sqlite3,'connect') as connect:
            self.assert_closed('SNAPSHOT_TIMEOUT',lambda:self.read(monotonic=lambda:next(clock)))
        connect.assert_not_called()

    def test_invalid_scope_timeout_and_untrusted_verified_flag_refused(self):
        for value in ({'verified':True},None,True):
            with self.subTest(value=value),self.assertRaises(n.SnapshotUnavailable):
                n.read_snapshot(self.path,value,expected_uid=os.getuid())
        for value in (0,True,2,float('inf')):
            with self.subTest(timeout=value):self.assert_closed('TIMEOUT_INVALID',lambda:self.read(timeout=value))

    def test_actual_repository_ddl_not_only_handwritten_fixture(self):
        native=SOURCE.parent
        sql=[]
        for filename in ('repository.py','runtime_port.py','reader_state.py'):
            tree=ast.parse((native/filename).read_text())
            for node in ast.walk(tree):
                if not (isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute)
                        and node.func.attr in ('execute','executescript') and node.args
                        and isinstance(node.args[0],ast.Constant) and isinstance(node.args[0].value,str)):
                    continue
                text=node.args[0].value.strip()
                if (filename=='repository.py' and text.startswith('CREATE TABLE IF NOT EXISTS jobs(')
                    or text.startswith('CREATE TABLE IF NOT EXISTS rt_job_refs(')
                    or text.startswith('CREATE TABLE IF NOT EXISTS reader_cursors(')
                    or text.startswith('ALTER TABLE jobs ADD COLUMN ')):
                    sql.append(text)
        self.assertEqual(len([x for x in sql if x.startswith('CREATE TABLE')]),3)
        path=self.root/'exact-native.sqlite3'
        with sqlite3.connect(path) as c:
            for statement in sql:c.executescript(statement)
            c.execute('INSERT INTO jobs(id,tenant,key,state,draft,created,updated,due) VALUES(?,?,?,?,?,?,?,?)',
                      (self.jid,self.scope.runtime_tenant,'synthetic-key','UNKNOWN','{}',900.,901.,900.))
            c.execute('INSERT INTO rt_job_refs VALUES(?,?,?,?,?,?,?,?,?)',
                (self.scope.runtime_job_ref,self.scope.tenant_id,self.scope.customer_id,
                 self.scope.object_id,'b'*64,self.scope.guard_sha256,self.scope.runtime_tenant,self.jid,900.5))
            c.execute('INSERT INTO reader_cursors(tenant,conversation,jid,updated) VALUES(?,?,?,?)',
                (self.scope.runtime_tenant,'rt_'+self.scope.runtime_job_ref.replace('-',''),self.jid,901.))
            c.commit()
        path.chmod(0o600)
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        value=n.read_snapshot(path,self.scope,expected_uid=os.getuid(),clock=lambda:1000.)
        self.assertEqual(value['binding']['state'],'UNKNOWN')
        self.assertEqual(value['binding']['dispatch_sequence'],0)
        self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())

    def test_sqlite_exclusive_contention_is_bounded_without_retry(self):
        self.c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.c.execute('PRAGMA journal_mode=DELETE')
        self.c.execute('BEGIN EXCLUSIVE')
        start=time.monotonic()
        try:self.assert_closed('NATIVE_SNAPSHOT_UNAVAILABLE',lambda:self.read(timeout=0.1))
        finally:self.c.rollback()
        self.assertLess(time.monotonic()-start,1.5)

    def test_import_opens_no_database_and_starts_no_process(self):
        with patch.object(sqlite3,'connect',side_effect=AssertionError('no db on import')):
            s=importlib.util.spec_from_file_location('s16_snapshot_import_probe',SOURCE)
            module=importlib.util.module_from_spec(s);sys.modules[s.name]=module
            try:s.loader.exec_module(module)
            finally:sys.modules.pop(s.name,None)


if __name__ == '__main__':unittest.main()
