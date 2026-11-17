"""Actual native SQLite -> exact identity -> receipt core; authority is synthetic.

This suite does NOT authenticate a production transport or enable an endpoint.
No live database, provider, account, permission or result payload is accessed.
"""
from copy import deepcopy
from dataclasses import asdict, replace
import json
import unittest

from test_reconciliation import r, Auth, SqliteStore, Reader, uid
import test_native_snapshot as native_fixture


class NativeBinding(unittest.TestCase):
    def setUp(self):
        self.native=native_fixture.NativeSnapshot('runTest');self.native.setUp()
        self.addCleanup(self.native.doCleanups)
        self.target={k:getattr(self.native.scope,k) for k in
                     ('object_id','tenant_id','customer_id','runtime_job_ref')}
        self.snapshot=self.native.read()
        self.op=self.convert(self.snapshot)
        self.auth=Auth();self.auth.scope=self.op.tenant_id
        self.store=SqliteStore();self.addCleanup(self.store.db.close)
        self.store.operation=lambda oid:self.convert(self.native.read()) if oid==self.op.object_id else None
        self.reader=Reader();self.command=uid(991)
        self.body={'object_id':self.op.object_id,'kind':'RUNTIME_UNKNOWN','reason':'Synthetic native check'}
        self.before=list(self.native.c.iterdump())

    def convert(self, value, **target):
        return r.operation_from_native_snapshot(value,**{**self.target,**target})

    def run_command(self):
        return r.reconcile(self.body,self.command,authority=self.auth,store=self.store,
                           reader=self.reader,clock=lambda:1000.)

    def assert_invalid(self, value):
        with self.assertRaises(r.ReconcileError) as error:self.convert(value)
        self.assertEqual((error.exception.code,error.exception.status),('OPERATION_BINDING_INVALID',503))

    def changed(self, **fields):
        v=deepcopy(self.snapshot);v['binding'].update(fields)
        v['binding_sha256']=r.mark(v['binding']);return v

    def signed(self):
        return Reader.signed(operation=self.op,recorded=self.op.created_at,observed=1000)

    def test_native_zero_sequence_and_subsecond_times_survive_exactly(self):
        self.assertEqual(asdict(self.op.native_identity),self.snapshot['binding'])
        self.assertEqual(self.op.native_identity.dispatch_sequence,0)
        self.assertEqual(self.op.created_at,900.125)
        self.assertEqual(self.op.native_identity.native_updated_at,901.75)
        self.assertIsNone(self.op.dispatch_id);self.assertIsNone(self.op.revision)
        self.assertEqual(self.op.receipt_revision,1)

    def test_no_native_uuid_or_revision_is_invented(self):
        for field,value in [('dispatch_id',uid(11)),('revision',1),('revision',0)]:
            with self.subTest(field=field),self.assertRaises(r.ReconcileError):
                replace(self.op,**{field:value}).validate()

    def test_legacy_draft_binding_remains_byte_compatible(self):
        from test_reconciliation import OP
        old=asdict(OP);old.pop('native_identity')
        self.assertEqual(OP.binding,r.mark(old));self.assertEqual(OP.receipt_revision,7)

    def test_native_identity_is_immutable_and_not_a_dict_flag(self):
        with self.assertRaises(Exception):self.op.native_identity.state='READY'
        with self.assertRaises(r.ReconcileError):
            replace(self.op,native_identity={'verified':True}).validate()

    def test_no_proofs_persists_unknown_receipt_version_not_native_revision(self):
        reply,status=self.run_command()
        self.assertEqual((reply['state'],reply['revision'],status),('UNKNOWN',1,202))
        self.assertEqual(self.store.count(),1)
        self.assertEqual(list(self.native.c.iterdump()),self.before)
        saved=self.store.receipt(self.command)
        self.assertEqual(saved.operation_binding,self.op.binding)

    def test_repeat_recovers_one_receipt_without_second_primary_read(self):
        first=self.run_command();self.assertEqual(self.run_command(),first)
        self.assertEqual(self.store.count(),1);self.assertEqual(self.reader.read_count,1)

    def test_actual_fractional_native_update_invalidates_old_receipt(self):
        self.run_command();self.native.c.execute('UPDATE jobs SET updated=901.750001')
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'REVISION_CONFLICT')
        self.assertEqual(self.store.count(),1);self.assertEqual(self.reader.read_count,1)

    def test_sequence_change_during_evidence_prevents_commit(self):
        self.reader.on_read=lambda:self.native.c.execute('UPDATE jobs SET dispatch_order=1')
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'REVISION_CONFLICT');self.assertEqual(self.store.count(),0)

    def test_scope_is_never_derived_from_query_attempt_or_hash(self):
        for key in self.target:
            with self.subTest(key=key),self.assertRaises(r.ReconcileError):
                self.convert(self.snapshot,**{key:uid(999)})
        self.assertEqual(self.op.request_sha256,'b'*64)
        self.assertNotIn('attempt',asdict(self.op.native_identity))

    def test_mismatched_digest_fails_without_native_access(self):
        v=deepcopy(self.snapshot);v['binding_sha256']='c'*64;self.assert_invalid(v)

    def test_extra_verified_field_is_not_accepted(self):
        self.assert_invalid({**self.snapshot,'verified':True})
        self.assert_invalid(self.changed(verified=True))

    def test_missing_binding_field_is_not_reconstructed(self):
        for key in self.snapshot['binding']:
            v=deepcopy(self.snapshot);del v['binding'][key]
            with self.subTest(key=key):self.assert_invalid(v)

    def test_corrupt_native_types_and_sequences_refuse(self):
        cases={'dispatch_sequence':[True,-1,2**63,'1'],
               'has_owner':[0,1,None], 'resume_safe':[0,1],
               'native_updated_at':[float('nan'),float('inf'),True,-1],
               'native_job_ref_sha256':['a'*32,None], 'guard_sha256':['bad'],
               'state':['DONE',True]}
        for key,values in cases.items():
            for value in values:
                with self.subTest(key=key,value=value):
                    v=deepcopy(self.snapshot);v['binding'][key]=value
                    # An invalid canonical payload may have no recomputable hash.
                    try:v['binding_sha256']=r.mark(v['binding'])
                    except r.ReconcileError:pass
                    self.assert_invalid(v)

    def test_claimed_outcome_replay_or_complete_history_is_not_metadata(self):
        for key,value in [('whole_job_outcome','EXECUTED'),('replay_permitted',True),
                          ('job_state_changed',True),('call_history_complete',True),
                          ('call_history_complete',0),('retained_calls_truncated',1)]:
            with self.subTest(key=key):self.assert_invalid({**self.snapshot,key:value})

    def test_out_of_order_and_duplicate_call_ids_are_rejected(self):
        self.native.call();self.native.call();v=self.native.read()
        self.convert(v)
        v['retained_calls'].reverse();self.assert_invalid(v)
        v=self.native.read();v['retained_calls'][1]['id']=v['retained_calls'][0]['id'];self.assert_invalid(v)

    def test_fabricated_call_fields_are_rejected(self):
        self.native.call();v=self.native.read()
        for key,value in [('state','DONE'),('http',True),('at',0),('response_bytes',-1)]:
            candidate=deepcopy(v);candidate['retained_calls'][0][key]=value
            with self.subTest(key=key):self.assert_invalid(candidate)

    def test_false_truncation_shape_is_refused(self):
        self.assert_invalid({**self.snapshot,'retained_calls_truncated':True})

    def test_one_http_success_never_proves_whole_job(self):
        self.native.call(state='RECEIVED',http=200)
        reply,_=self.run_command();self.assertEqual(reply['state'],'UNKNOWN')
        self.assertEqual(self.store.receipt(self.command).assessment.verified_count,0)

    def test_ready_metadata_does_not_infer_execution(self):
        self.native.c.execute("UPDATE jobs SET state='READY'")
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'STATE_CONFLICT');self.assertEqual(self.store.count(),0)

    def test_observation_time_does_not_create_a_new_native_version(self):
        v=deepcopy(self.snapshot);v['observed_at']=1001.25
        self.assertEqual(self.convert(v).binding,self.op.binding)

    def test_future_or_reversed_native_metadata_is_rejected(self):
        for fields in ({'native_updated_at':1001.},{'reference_created_at':899.},
                       {'reader_updated_at':1001.},{'native_created_at':999.}):
            with self.subTest(fields=fields):self.assert_invalid(self.changed(**fields))

    def test_native_state_copy_cannot_be_changed_independently(self):
        for field,value in [('created_at',900.),('request_sha256','c'*64),('state','READY')]:
            with self.subTest(field=field),self.assertRaises(r.ReconcileError):
                replace(self.op,**{field:value}).validate()

    def test_matching_authenticated_primary_assesses_without_job_change(self):
        self.reader.proofs=(self.signed(),)
        reply,status=self.run_command()
        self.assertEqual((reply['state'],status),('NO_CHANGE',202))
        self.assertEqual(list(self.native.c.iterdump()),self.before)

    def test_snapshot_itself_is_not_a_primary_proof(self):
        self.reader.proofs=(self.snapshot,)
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'EVIDENCE_INVALID');self.assertEqual(self.store.count(),0)

    def test_recomputed_hash_does_not_authenticate_a_proof(self):
        proof=self.signed();self.reader.proofs=(replace(proof,authentication=b'forged'),)
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'EVIDENCE_UNVERIFIED');self.assertEqual(self.store.count(),0)

    def test_current_authority_is_required_for_native_receipt(self):
        self.auth.enabled=False
        self.store.operation=lambda _:self.fail('unauthorized native lookup')
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'AUTH_REQUIRED')

    def test_revocation_during_evidence_rolls_back_native_assessment(self):
        self.reader.on_read=lambda:setattr(self.auth,'enabled',False)
        with self.assertRaises(r.ReconcileError) as error:self.run_command()
        self.assertEqual(error.exception.code,'AUTH_REQUIRED');self.assertEqual(self.store.count(),0)

    def test_lost_commit_response_recovers_only_original_receipt(self):
        self.store.fail_after_commit=True
        with self.assertRaises(r.ReconcileError):self.run_command()
        self.assertEqual(self.store.count(),1)
        previous=self.store.receipt(self.command).public()
        self.assertEqual(self.run_command()[0],previous);self.assertEqual(self.reader.read_count,1)

    def test_fractional_clock_is_preserved_without_flooring(self):
        result=r.assessed(self.op,self.reader,clock=lambda:1000.75)
        self.assertEqual(result.assessed_at,1000.75)
        result.validate()
        self.assertEqual(r.now_seconds(lambda:1000.75),1000.75)

    def test_diagnostic_repr_excludes_native_and_customer_identity(self):
        text=repr(self.op)+repr(self.op.native_identity)
        for private in (self.op.object_id,self.op.native_identity.customer_id,
                        self.op.native_identity.native_job_ref_sha256):self.assertNotIn(private,text)


if __name__=='__main__':unittest.main()
