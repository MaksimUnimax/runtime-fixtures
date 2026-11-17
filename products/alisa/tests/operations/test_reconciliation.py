"""Isolated AL-S16 tests; real SQLite receipts, synthetic authority/proof ports.

No live database, staff policy grant, signing key, provider or HTTP route is used.
The HMAC below is a test authenticator, NOT a proposed production key mechanism.
"""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import asdict, replace
from hashlib import sha256
import hmac
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import threading
import unittest
from uuid import UUID

# Works from the repository or from the self-contained exported source bundle.
HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
PATH = ROOT / 'services/platform/src/alisa_platform/operations/reconciliation.py'
if not PATH.is_file():
    PATH = HERE.parents[1] / 'source/operations/reconciliation.py'
spec = importlib.util.spec_from_file_location('s16_reconciliation', PATH)
r = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = r
spec.loader.exec_module(r)


def uid(n):
    return str(UUID(int=n))


NOW = 1794825600
OP = r.Operation(r.PRODUCT, uid(1), uid(2), uid(3), uid(4), 'a'*64, 7, NOW-1000, 'UNKNOWN')
BODY = {'object_id': OP.object_id, 'kind': 'RUNTIME_UNKNOWN', 'reason': 'Recheck original receipt'}


class Auth:
    def __init__(self):
        self.id = uid(5)
        self.enabled = True
        self.scope = OP.tenant_id
        self.permission = r.PERMISSION
        self.checks = []

    def actor(self):
        return self.id if self.enabled else None

    def allowed(self, actor, operation, permission):
        self.checks.append(permission)
        return (actor == self.id and operation.tenant_id == self.scope
                and permission == self.permission and self.enabled)


class SqliteStore:
    """Exercise actual receipt uniqueness/commit/rollback, not production locking."""
    def __init__(self):
        self.db = sqlite3.connect(':memory:', isolation_level=None, check_same_thread=False)
        self.db.execute('CREATE TABLE jobs (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)')
        self.db.execute('CREATE TABLE receipts (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)')
        self.lock = threading.RLock()
        self.fail_insert = False
        self.fail_after_commit = False
        self.wrote = False
        self.put_operation(OP)

    @contextmanager
    def atomic(self):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            self.wrote = False
            try:
                yield
            except BaseException:
                self.db.execute('ROLLBACK')
                raise
            else:
                self.db.execute('COMMIT')
                if self.wrote and self.fail_after_commit:
                    self.fail_after_commit = False
                    raise OSError('synthetic secret must never escape')

    def put_operation(self, value):
        self.db.execute('INSERT OR REPLACE INTO jobs VALUES (?,?)', (value.object_id, json.dumps(asdict(value))))

    def operation(self, object_id):
        row = self.db.execute('SELECT metadata FROM jobs WHERE id=?', (object_id,)).fetchone()
        return r.Operation(**json.loads(row[0])) if row else None

    def receipt(self, command_id):
        row = self.db.execute('SELECT metadata FROM receipts WHERE id=?', (command_id,)).fetchone()
        if not row:
            return None
        value = json.loads(row[0])
        value['assessment'] = r.Assessment(**value['assessment'])
        return r.CommandReceipt(**value)

    def insert_receipt(self, value):
        self.db.execute('INSERT INTO receipts VALUES (?,?)', (value.command_id, json.dumps(asdict(value))))
        self.wrote = True
        if self.fail_insert:
            raise OSError('synthetic secret must never escape')

    def count(self):
        return self.db.execute('SELECT count(*) FROM receipts').fetchone()[0]

    def job_snapshot(self):
        return tuple(self.db.execute('SELECT id,metadata FROM jobs ORDER BY id'))


class Reader:
    KEY = b'synthetic-test-authentication-only-not-a-live-secret'

    def __init__(self):
        self.proofs = ()
        self.read_count = 0
        self.verify_count = 0
        self.on_read = None

    @classmethod
    def signed(cls, *, operation=OP, scope='JOB', outcome='EXECUTED', primary='b'*64,
               recorded=None, observed=NOW, edits=None):
        value = {'schema': r.PROOF_SCHEMA, 'binding_sha256': operation.binding,
                 'source': 'RUNTIME_TERMINAL_RECEIPT' if scope == 'JOB' else 'PROVIDER_OPERATION_RECEIPT',
                 'scope': scope, 'outcome': outcome, 'recorded_at': operation.created_at if recorded is None else recorded,
                 'observed_at': observed, 'primary_sha256': primary}
        value.update(edits or {})
        return cls.raw(r.canonical(value))

    @classmethod
    def raw(cls, payload):
        return r.PrimaryProof(payload, hmac.digest(cls.KEY, payload, 'sha256'))

    def read(self, operation):
        self.read_count += 1
        if self.on_read:
            self.on_read()
        return self.proofs

    def verify(self, proof, operation):
        self.verify_count += 1
        return hmac.compare_digest(proof.authentication, hmac.digest(self.KEY, proof.payload, 'sha256'))


class Base(unittest.TestCase):
    def setUp(self):
        self.auth, self.store, self.reader = Auth(), SqliteStore(), Reader()
        self.addCleanup(self.store.db.close)
        self.command = uid(6)
        self.before = self.store.job_snapshot()

    def run_command(self, body=None, command=None, clock=lambda: NOW):
        return r.reconcile(deepcopy(BODY) if body is None else body,
                           self.command if command is None else command,
                           authority=self.auth, store=self.store, reader=self.reader, clock=clock)

    def blocked(self, code, callable=None, status=None):
        with self.assertRaises(r.ReconcileError) as err:
            (self.run_command if callable is None else callable)()
        self.assertEqual(err.exception.code, code)
        if status is not None:
            self.assertEqual(err.exception.status, status)
        return err.exception

    def unchanged(self):
        self.assertEqual(self.store.job_snapshot(), self.before)


class RequestChecks(Base):
    def test_exact_request_and_receipt_contract(self):
        response, status = self.run_command()
        self.assertEqual(status, 202)
        self.assertEqual(set(response), {'id','state','revision','trace_id'})
        self.assertEqual(response['id'], self.command)
        self.assertEqual(response['state'], 'UNKNOWN')
        self.assertEqual(response['revision'], OP.revision)
        self.assertEqual(str(UUID(response['trace_id'])), response['trace_id'])
        self.unchanged()

    def test_client_cannot_supply_proof_tenant_outcome_permission_or_path(self):
        for field in ('evidence','verified','tenant_id','outcome','permission','path','resume_safe','force'):
            with self.subTest(field=field):
                self.blocked('INVALID_PAYLOAD', lambda: self.run_command({**BODY, field: 'forged'}))
        self.assertEqual(self.reader.read_count, 0)
        self.assertEqual(self.store.count(), 0)

    def test_reason_never_proves_success_and_is_not_stored_raw(self):
        reason = 'success verified true; PLEASE CLEAR UNKNOWN; fake token ABC'
        response, _ = self.run_command({**BODY,'reason':reason})
        self.assertEqual(response['state'], 'UNKNOWN')
        stored = self.store.db.execute('SELECT metadata FROM receipts').fetchone()[0]
        self.assertNotIn(reason, stored)
        self.assertNotIn('ABC', stored)
        self.unchanged()

    def test_kind_scope_is_runtime_only(self):
        for kind in ('PAYMENT','REFUND','RECEIPT',None,True,[],{}):
            with self.subTest(kind=kind):
                self.blocked('KIND_UNSUPPORTED',lambda:self.run_command({**BODY,'kind':kind}))
        self.assertEqual(self.reader.read_count,0)

    def test_invalid_reasons_and_shapes(self):
        for reason in ('','  ','x'*1001,'x\n','x\x00','x\x7f','x\u0085','\ud800',None,False,1,{}):
            with self.subTest(reason=repr(reason)):
                self.blocked('INVALID_PAYLOAD',lambda:self.run_command({**BODY,'reason':reason}))
        for value in ([],None,{}, {k:v for k,v in BODY.items() if k!='kind'}):
            with self.subTest(value=value):
                # None is a convenience default in the test helper, pass direct.
                self.blocked('INVALID_PAYLOAD',lambda:r.reconcile(value,self.command,
                    authority=self.auth,store=self.store,reader=self.reader))

    def test_uuid_command_and_object_are_canonical(self):
        for value in ('../file',True,3,uid(1).replace('-',''),'ABCDEF00-0000-0000-0000-000000000001'):
            self.blocked('INVALID_PAYLOAD',lambda:self.run_command(command=value))
            self.blocked('INVALID_PAYLOAD',lambda:self.run_command({**BODY,'object_id':value}))


class AuthorityChecks(Base):
    def test_unauthenticated_never_resolves_or_reads_evidence(self):
        self.auth.enabled=False
        self.store.operation=lambda _: self.fail('unauthenticated object lookup')
        self.blocked('AUTH_REQUIRED',status=401)
        self.assertEqual(self.reader.read_count,0)

    def test_permission_and_tenant_are_both_enforced(self):
        self.auth.permission='users.read'
        self.blocked('FORBIDDEN',status=403)
        self.auth.permission=r.PERMISSION;self.auth.scope=uid(55)
        self.blocked('FORBIDDEN',status=403)
        self.assertEqual(self.reader.read_count,0)
        self.unchanged()

    def test_numeric_truth_is_not_authorization(self):
        self.auth.allowed=lambda *args:1
        self.blocked('FORBIDDEN')

    def test_missing_or_other_product_is_not_found(self):
        self.blocked('NOT_FOUND',lambda:self.run_command({**BODY,'object_id':uid(99)}),404)
        self.store.put_operation(replace(OP, product_id='other'))
        self.blocked('NOT_FOUND',status=404)

    def test_revocation_during_primary_read_blocks_receipt(self):
        self.reader.on_read=lambda:setattr(self.auth,'enabled',False)
        self.blocked('AUTH_REQUIRED')
        self.assertEqual(self.store.count(),0)
        self.unchanged()

    def test_actor_switch_during_read_is_not_new_authority(self):
        self.reader.on_read=lambda:setattr(self.auth,'id',uid(20))
        self.blocked('AUTH_REQUIRED')
        self.assertEqual(self.store.count(),0)

    def test_replay_still_rechecks_current_authority(self):
        self.run_command();self.auth.enabled=False
        self.blocked('AUTH_REQUIRED')
        self.assertEqual(self.reader.read_count,1)
        self.assertEqual(self.store.count(),1)


class EvidenceChecks(Base):
    def evaluate(self, *proofs, clock=lambda:NOW):
        self.reader.proofs=proofs
        return r.assessed(OP,self.reader,clock)

    def test_absence_is_unknown_not_proof_of_non_dispatch(self):
        result=self.evaluate()
        self.assertEqual((result.classification,result.code),('UNKNOWN','NO_EVIDENCE'))

    def test_three_authenticated_whole_job_outcomes_are_only_assessments(self):
        for value in ('EXECUTED','NOT_EXECUTED','REJECTED'):
            with self.subTest(outcome=value):
                assessment=self.evaluate(Reader.signed(outcome=value))
                self.assertEqual(assessment.classification,'CONFIRMED_'+value)
                self.assertEqual(assessment.receipt_state,'NO_CHANGE')
                self.assertIs(assessment.job_state_changed,False)
                self.assertIs(assessment.replay_permitted,False)

    def test_single_provider_success_never_proves_whole_job(self):
        for value in ('EXECUTED','NOT_EXECUTED','REJECTED','UNKNOWN'):
            assessment=self.evaluate(Reader.signed(scope='CALL',outcome=value))
            self.assertEqual((assessment.classification,assessment.code),('UNKNOWN','CALL_ONLY_PROOF'))

    def test_explicit_unknown_stays_unknown(self):
        assessment=self.evaluate(Reader.signed(outcome='UNKNOWN'))
        self.assertEqual(assessment.classification,'UNKNOWN')

    def test_conflicting_authenticated_terminal_outcomes_stay_unknown(self):
        for second in ('REJECTED','NOT_EXECUTED','UNKNOWN'):
            assessment=self.evaluate(Reader.signed(),Reader.signed(outcome=second,primary='c'*64))
            self.assertEqual(assessment.code,'CONFLICTING_EVIDENCE')
            self.assertEqual(assessment.receipt_state,'UNKNOWN')

    def test_same_primary_id_with_changed_outcome_is_corruption(self):
        self.blocked('EVIDENCE_CONFLICT',lambda:self.evaluate(
            Reader.signed(),Reader.signed(outcome='REJECTED')))

    def test_exact_duplicate_primary_counted_once(self):
        proof=Reader.signed();assessment=self.evaluate(proof,proof)
        self.assertEqual(assessment.verified_count,1)
        self.assertEqual(assessment.classification,'CONFIRMED_EXECUTED')

    def test_signature_tamper_fails_without_success_or_receipt(self):
        proof=Reader.signed()
        self.reader.proofs=(replace(proof,authentication=b'not valid'),)
        self.blocked('EVIDENCE_UNVERIFIED',status=503)
        self.assertEqual(self.store.count(),0)
        self.unchanged()

    def test_payload_tamper_invalidates_authentication(self):
        proof=Reader.signed();payload=proof.payload.replace(b'EXECUTED',b'REJECTED')
        self.blocked('EVIDENCE_UNVERIFIED',lambda:self.evaluate(replace(proof,payload=payload)))

    def test_verified_boolean_is_not_an_authenticator(self):
        self.reader.verify=lambda *args:1
        self.blocked('EVIDENCE_UNVERIFIED',lambda:self.evaluate(Reader.signed()))

    def test_every_binding_dimension_rejects_other_operation_proof(self):
        changes={'object_id':uid(11),'tenant_id':uid(12),'runtime_job_ref':uid(13),
                 'dispatch_id':uid(14),'request_sha256':'c'*64,'revision':8,'created_at':OP.created_at-1}
        for field,value in changes.items():
            with self.subTest(field=field):
                self.blocked('EVIDENCE_BINDING_MISMATCH',lambda:self.evaluate(
                    Reader.signed(operation=replace(OP,**{field:value}))))

    def test_metadata_hash_is_not_authentication(self):
        value=json.loads(Reader.signed().payload);value['primary_sha256']='d'*64
        forged=r.PrimaryProof(r.canonical(value),b'forged')
        self.blocked('EVIDENCE_UNVERIFIED',lambda:self.evaluate(forged))

    def test_future_and_stale_observation_fail(self):
        for observed in (NOW+1,NOW-r.OBSERVATION_TTL-1):
            self.blocked('EVIDENCE_STALE',lambda:self.evaluate(Reader.signed(observed=observed)))
        self.assertEqual(self.evaluate(Reader.signed(observed=NOW-r.OBSERVATION_TTL)).classification,'CONFIRMED_EXECUTED')

    def test_old_primary_receipt_with_fresh_observation_can_be_assessed(self):
        assessment=self.evaluate(Reader.signed(recorded=OP.created_at,observed=NOW))
        self.assertEqual(assessment.classification,'CONFIRMED_EXECUTED')

    def test_recording_before_operation_is_invalid(self):
        self.blocked('EVIDENCE_INVALID',lambda:self.evaluate(Reader.signed(recorded=OP.created_at-1)))

    def test_time_crossing_during_verification_rechecked(self):
        values=iter([NOW,NOW+r.OBSERVATION_TTL+1])
        self.blocked('EVIDENCE_STALE',lambda:self.evaluate(Reader.signed(),clock=lambda:next(values)))

    def test_clock_reversal_is_not_fresh(self):
        values=iter([NOW,NOW-1])
        self.blocked('EVIDENCE_CLOCK_CHANGED',lambda:self.evaluate(Reader.signed(),clock=lambda:next(values)))

    def test_invalid_shapes_duplicates_and_nonfinite_json(self):
        good=Reader.signed().payload
        invalids=(b'{}',b'[]',b'null',b'{"x":1,"x":2}',b'{"x":NaN}',b'\xff',b'{')
        for raw in invalids:
            self.blocked('EVIDENCE_INVALID',lambda:self.evaluate(Reader.raw(raw)))
        for edits in ({'outcome':True},{'observed_at':True},{'recorded_at':1.5},
                      {'primary_sha256':'bad'},{'verified':True},{'scope':'JOB','source':'USER_REASON'}):
            self.blocked('EVIDENCE_INVALID',lambda:self.evaluate(Reader.signed(edits=edits)))
        self.assertTrue(good)

    def test_limits_reject_large_unbounded_or_wrong_source_values(self):
        for proofs in ([],None,iter(()),tuple(Reader.signed() for _ in range(r.MAX_PROOFS+1)),
                       (r.PrimaryProof(b'x'*(r.MAX_PROOF_BYTES+1),b'a'),),
                       (r.PrimaryProof(b'{}',b'a'*4097),),('fake',)):
            self.reader.proofs=proofs
            self.blocked('EVIDENCE_INVALID',lambda:r.assessed(OP,self.reader,lambda:NOW))

    def test_source_unavailable_is_not_empty_proof(self):
        def failed(_):raise RuntimeError('private raw evidence')
        self.reader.read=failed
        error=self.blocked('EVIDENCE_UNAVAILABLE',status=503)
        self.assertNotIn('private',str(error))
        self.assertEqual(self.store.count(),0)


class DurableCommandChecks(Base):
    def test_repeat_same_command_returns_same_receipt_without_second_read(self):
        first=self.run_command();second=self.run_command()
        self.assertEqual(first,second)
        self.assertEqual(self.reader.read_count,1)
        self.assertEqual(self.store.count(),1)
        self.unchanged()

    def test_new_command_can_check_again_but_never_replays_operation(self):
        self.run_command();self.run_command(command=uid(66))
        self.assertEqual(self.reader.read_count,2)
        self.assertEqual(self.store.count(),2)
        self.unchanged()

    def test_reused_command_with_different_reason_or_actor_conflicts(self):
        self.run_command()
        self.blocked('IDEMPOTENCY_CONFLICT',lambda:self.run_command({**BODY,'reason':'different'}),409)
        self.auth.id=uid(8)
        self.blocked('IDEMPOTENCY_CONFLICT',status=409)
        self.assertEqual(self.store.count(),1)
        self.assertEqual(self.reader.read_count,1)

    def test_changed_revision_on_replay_is_not_fresh_assessment(self):
        self.run_command();self.store.put_operation(replace(OP,revision=8))
        self.blocked('REVISION_CONFLICT',status=409)
        self.assertEqual(self.reader.read_count,1)

    def test_revision_state_or_attempt_changes_during_read_block_commit(self):
        for delta in ({'revision':8},{'dispatch_id':uid(77)},{'state':'RUNNING'}):
            self.store.put_operation(OP)
            self.reader.on_read=lambda d=delta:self.store.put_operation(replace(OP,**d))
            self.blocked('REVISION_CONFLICT',status=409)
        self.assertEqual(self.store.count(),0)

    def test_other_states_are_not_treated_as_unknown(self):
        for state in ('QUEUED','RUNNING','READY','FAILED','CANCELLED','EXPIRED','ALIASED'):
            self.store.put_operation(replace(OP,state=state))
            self.blocked('STATE_CONFLICT')
        self.assertEqual(self.reader.read_count,0)

    def test_successful_proof_does_not_modify_native_state_or_renew_result(self):
        self.reader.proofs=(Reader.signed(),)
        response,status=self.run_command()
        self.assertEqual((response['state'],status),('NO_CHANGE',202))
        self.assertEqual(self.store.receipt(self.command).assessment.classification,'CONFIRMED_EXECUTED')
        self.unchanged()

    def test_storage_failure_rolls_back_receipt(self):
        self.store.fail_insert=True
        self.blocked('RECONCILIATION_UNAVAILABLE')
        self.assertEqual(self.store.count(),0)
        self.unchanged()
        self.store.fail_insert=False
        self.run_command()
        self.assertEqual(self.store.count(),1)

    def test_lost_commit_reply_recovers_same_command_without_second_evidence_read(self):
        self.store.fail_after_commit=True
        self.blocked('RECONCILIATION_UNAVAILABLE')
        self.assertEqual(self.store.count(),1)
        previous=self.store.receipt(self.command).public()
        response,status=self.run_command()
        self.assertEqual((response,status),(previous,202))
        self.assertEqual(self.reader.read_count,1)
        self.unchanged()

    def test_concurrent_duplicates_commit_only_one_immutable_receipt(self):
        barrier=threading.Barrier(2)
        self.reader.on_read=lambda:barrier.wait(timeout=5)
        responses=[];errors=[]
        def work():
            try:responses.append(self.run_command())
            except BaseException as error:errors.append(error)
        threads=[threading.Thread(target=work) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join(timeout=8)
        self.assertTrue(all(not t.is_alive() for t in threads))
        self.assertEqual(errors,[])
        self.assertEqual(len(responses),2)
        self.assertEqual(responses[0],responses[1])
        self.assertEqual(self.store.count(),1)
        self.unchanged()

    def test_receipt_cannot_be_for_another_command_after_storage_read(self):
        self.run_command()
        saved=self.store.receipt(self.command)
        self.store.receipt=lambda _:replace(saved,command_id=uid(123))
        self.blocked('RECEIPT_INVALID',status=503)

    def test_corrupt_stored_assessment_cannot_mint_a_reply(self):
        self.run_command()
        saved=self.store.receipt(self.command)
        bad=replace(saved,assessment=replace(saved.assessment,replay_permitted=True))
        self.store.receipt=lambda _:bad
        self.blocked('RECEIPT_INVALID',status=503)

    def test_wait_for_commit_does_not_make_expired_evidence_current(self):
        self.reader.proofs=(Reader.signed(),)
        now=[NOW];entered=[0]
        original=self.store.atomic
        @contextmanager
        def delayed():
            entered[0]+=1
            if entered[0]==2:now[0]+=r.OBSERVATION_TTL+1
            with original():yield
        self.store.atomic=delayed
        self.blocked('EVIDENCE_STALE',lambda:self.run_command(clock=lambda:now[0]),503)
        self.assertEqual(self.store.count(),0)
        self.unchanged()

    def test_nonfinite_boolean_or_negative_clock_is_not_observation_time(self):
        for value in (True,False,float('nan'),float('inf'),-1,'1794825600'):
            self.blocked('EVIDENCE_CLOCK_INVALID',lambda:self.run_command(clock=lambda:value),503)
        self.assertEqual(self.store.count(),0)

    def test_diagnostic_reprs_do_not_export_identity_or_primary_payload(self):
        self.assertNotIn(OP.object_id,repr(OP))
        self.assertNotIn('EXECUTED',repr(Reader.signed()))
        self.run_command();self.assertNotIn(uid(5),repr(self.store.receipt(self.command)))

    def test_dependencies_may_not_mint_success_on_exceptions(self):
        def failed():raise RuntimeError('credential private secret')
        self.auth.actor=failed
        error=self.blocked('RECONCILIATION_UNAVAILABLE')
        self.assertEqual(str(error),'RECONCILIATION_UNAVAILABLE')
        self.assertEqual(self.store.count(),0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
