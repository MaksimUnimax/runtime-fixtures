"""Real accepted Results writer + read-only consumer on disposable files.

No production store/DB, paid execution, socket, actor or authority is created.
Server progress and scope are fixtures; authenticated progress wiring remains
separate. Native/frozen/producer code is loaded unchanged, not patched.
"""
from dataclasses import replace
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
from products.alisa.runtime.reconciliation import program_evidence as e
PRODUCER=ROOT/'docs/alisa/runtime/v0.11/current_parameters_r8/program_recovery/program_results.py'
spec=importlib.util.spec_from_file_location('s16_original_results_writer',PRODUCER)
producer=importlib.util.module_from_spec(spec);spec.loader.exec_module(producer)


class RetainedProgramEvidence(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='s16-program-proof-')
        self.addCleanup(self.temp.cleanup)
        self.parent=Path(self.temp.name);self.parent.chmod(0o700)
        self.root=self.parent/'results';self.writer=producer.Results(self.root)
        self.tenant='fixture-tenant';self.jid='c'*32;self.generation='d'*64
        self.key=sha256((self.tenant+'\0'+self.jid+'\0parameter-revision:'+self.generation).encode()).hexdigest()
        self.envelope={'job_id':self.key,'user_id':'alisa_p_'+'e'*64,'messages':[{'role':'user','content':'private question'}],
                       'document':'private old coefficients','model':'synthetic-no-model-call'}
        self.fingerprint=producer.binding(self.envelope)
        self.progress={'_program_started':True,'_program_started_at':100.,
            '_program_request_binding':{'job_id':self.key,'fingerprint':self.fingerprint},
            '_compound_answer_generation':self.generation,'_compound_answer_fences':[['private','original-fence']],
            'private':'must never be returned'}
        self.binding=self.bind();self.path=self.root/(self.key+'.json');self.now=103.

    def bind(self,**kw):
        return e.from_progress(kw.get('operation','a'*64),kw.get('tenant',self.tenant),
            kw.get('jid',self.jid),kw.get('progress',self.progress),created_at=99.,observed_at=104.)

    def complete(self,content='synthetic completed calculation'):
        with patch.object(producer.time,'time',return_value=101.):
            self.writer.complete(self.key,self.fingerprint,content)

    def start(self):
        with patch.object(producer.time,'time',return_value=100.5):
            self.writer.start(self.key,self.fingerprint,'f'*32)

    def observe(self,**kw):
        return e.observe(self.root,self.binding,owner_uid=kw.pop('owner_uid',os.getuid()),
                         clock=kw.pop('clock',lambda:self.now),**kw)

    def refused(self,call,code=None):
        with self.assertRaises(e.EvidenceUnavailable) as error:call()
        self.assertIn(error.exception.code,e.CODES)
        self.assertEqual(str(error.exception),error.exception.code)
        if code:self.assertEqual(error.exception.code,code)
        return error.exception.code

    def tree(self):
        return {p.name:p.read_bytes() for p in self.root.iterdir() if p.is_file() and not p.is_symlink()}

    def rewrite(self,value):
        with patch.object(producer.time,'time',return_value=101.):self.writer.save(self.key,value)

    def test_actual_writer_pinned_and_unchanged(self):
        self.assertEqual(sha256(PRODUCER.read_bytes()).hexdigest(),
                         '1bf19d8d15587efecc88a4b1cf5c2609c5731a7fc7dcf2e4f7152a9b565ae952')
        self.assertEqual(e.TTL,producer.TTL)

    def test_actual_complete_record_matches_original_identity_and_digest(self):
        self.complete();before=self.tree();out=self.observe()
        self.assertEqual(out['status'],'COMPLETE');self.assertTrue(out['content_verified'])
        self.assertTrue(out['program_completion_recorded'])
        self.assertEqual(out['content_sha256'],sha256(b'synthetic completed calculation').hexdigest())
        self.assertEqual(out['primary_sha256'],sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(out['whole_job_outcome'],'UNPROVEN');self.assertEqual(before,self.tree())

    def test_real_ack_is_not_ready_or_verified_retained_payload(self):
        self.complete();digest=json.loads(self.path.read_text())['digest']
        with patch.object(producer.time,'time',return_value=102.):self.writer.ack(self.key,self.fingerprint,digest)
        before=self.tree();out=self.observe()
        self.assertEqual(out['status'],'ACKNOWLEDGED');self.assertTrue(out['program_completion_recorded'])
        self.assertFalse(out['content_verified']);self.assertEqual(out['whole_job_outcome'],'UNPROVEN')
        self.assertEqual(before,self.tree())

    def test_started_record_not_promoted_or_expired_by_age(self):
        self.start();self.now=10000.;before=self.tree();out=self.observe()
        self.assertEqual(out['status'],'INCOMPLETE');self.assertFalse(out['program_completion_recorded'])
        self.assertIsNone(out['content_sha256']);self.assertEqual(before,self.tree())

    def test_absent_file_is_not_retained_not_not_executed(self):
        out=self.observe();self.assertEqual(out['status'],'NOT_RETAINED')
        self.assertFalse(out['not_retained_means_not_executed']);self.assertEqual(self.tree(),{})

    def test_expired_complete_stays_on_disk_and_cannot_confirm_current_result(self):
        self.complete();self.now=3701.001;before=self.tree();out=self.observe()
        self.assertEqual(out['status'],'EXPIRED');self.assertFalse(out['program_completion_recorded'])
        self.assertIsNone(out['content_sha256']);self.assertEqual(before,self.tree())

    def test_ttl_exact_boundary_matches_existing_producer(self):
        self.complete();self.now=3701.;self.assertEqual(self.observe()['status'],'COMPLETE')
        self.now=3701.00001;self.assertEqual(self.observe()['status'],'EXPIRED')

    def test_expired_ack_is_not_fresh_completion(self):
        self.complete();digest=json.loads(self.path.read_text())['digest']
        with patch.object(producer.time,'time',return_value=102.):self.writer.ack(self.key,self.fingerprint,digest)
        self.now=3702.1;self.assertEqual(self.observe()['status'],'EXPIRED')

    def test_ttl_crossed_during_projection_is_rechecked(self):
        self.complete();clock=iter([3700.9,3701.,3701.1])
        self.assertEqual(self.observe(clock=lambda:next(clock))['status'],'EXPIRED')

    def test_missing_store_is_unavailable_and_not_created(self):
        self.root.rmdir();self.refused(self.observe,'PROGRAM_STORE_UNAVAILABLE');self.assertFalse(self.root.exists())

    def test_permission_error_is_unavailable_not_absent(self):
        self.complete()
        with patch.object(e.os,'open',side_effect=PermissionError('private path must not leak')):
            self.refused(self.observe,'PROGRAM_STORE_UNAVAILABLE')

    def test_wrong_saved_fingerprint_is_not_empty_search(self):
        self.complete();v=json.loads(self.path.read_text());v['fingerprint']='0'*64;self.rewrite(v)
        self.refused(self.observe,'PROGRAM_BINDING_MISMATCH')

    def test_corrupt_content_or_digest_cannot_be_complete(self):
        for change in ({'content':'changed'},{'digest':'0'*64},{'content':'   '},{'digest':True},{'content':'\ud800'}):
            with self.subTest(change=repr(change)):
                self.complete();v=json.loads(self.path.read_text());v.update(change)
                if change.get('content') == '\ud800':
                    # The unchanged writer correctly refuses this. Inject a
                    # damaged on-disk JSON escape, not a writer success.
                    self.path.write_bytes(json.dumps(v,ensure_ascii=True).encode('ascii'))
                else:
                    self.rewrite(v)
                self.refused(self.observe)

    def test_bad_json_duplicate_nan_and_wrong_shapes_never_mean_absence(self):
        for raw in (b'[]',b'null',b'{',b'{"state":"complete","state":"started"}',b'{"at":NaN}',b'\xff'):
            with self.subTest(raw=raw):
                self.path.write_bytes(raw);self.path.chmod(0o600);self.refused(self.observe)

    def test_unexpected_record_fields_and_future_time_refused(self):
        for change in ({'at':104.},{'at':99.},{'at':True},{'verified':True},{'state':'failed'},{'content':None}):
            with self.subTest(change=change):
                self.complete();v=json.loads(self.path.read_text());v.update(change);self.rewrite(v);self.refused(self.observe)

    def test_started_workspace_never_opened_or_returned(self):
        self.start();out=self.observe();text=json.dumps(out)
        self.assertNotIn('workspace',text);self.assertNotIn('f'*32,text)
        self.assertEqual(out['status'],'INCOMPLETE')

    def test_parent_store_and_file_uid_must_match(self):
        self.complete();self.refused(lambda:self.observe(owner_uid=os.getuid()+100000),'PROGRAM_STORE_IDENTITY')

    def test_file_public_mode_refused_without_permission_repair(self):
        self.complete();self.path.chmod(0o644)
        self.refused(self.observe,'PROGRAM_STORE_IDENTITY');self.assertEqual(self.path.stat().st_mode&0o777,0o644)

    def test_private_store_and_nonwritable_parent_required(self):
        self.root.chmod(0o750);self.refused(self.observe,'PROGRAM_STORE_IDENTITY')
        self.root.chmod(0o700);self.parent.chmod(0o770);self.refused(self.observe,'PROGRAM_STORE_IDENTITY')

    def test_symlink_file_and_store_never_followed(self):
        self.complete();other=self.parent/'other.json';self.path.rename(other);self.path.symlink_to(other)
        self.refused(self.observe)
        link=self.parent/'link';link.symlink_to(self.root)
        self.refused(lambda:e.observe(link,self.binding,owner_uid=os.getuid(),clock=lambda:103.),'PROGRAM_STORE_IDENTITY')

    def test_symlink_loop_returns_safe_unavailability_not_private_path(self):
        loop=self.parent/'loop';loop.symlink_to(loop)
        self.refused(lambda:e.observe(loop,self.binding,owner_uid=os.getuid(),clock=lambda:103.))

    def test_hardlinked_record_refused(self):
        self.complete();os.link(self.path,self.parent/'hardlink')
        self.refused(self.observe,'PROGRAM_STORE_IDENTITY')

    def test_fifo_refused_without_waiting_for_writer(self):
        os.mkfifo(self.path,0o600);self.refused(self.observe,'PROGRAM_STORE_IDENTITY')

    def test_file_too_large_refused_before_payload_read(self):
        with self.path.open('wb') as f:f.truncate(e.MAX_FILE_BYTES+1)
        self.path.chmod(0o600)
        with patch.object(e.os,'read',side_effect=AssertionError('must not allocate/read oversized record')):
            self.refused(self.observe,'PROGRAM_RECORD_TOO_LARGE')

    def test_in_place_change_during_read_refused(self):
        self.complete();original=e.os.read;changed=False
        def read(fd,count):
            nonlocal changed
            data=original(fd,count)
            if not changed:
                changed=True
                with self.path.open('ab') as f:f.write(b' ')
            return data
        with patch.object(e.os,'read',side_effect=read):self.refused(self.observe,'PROGRAM_RECORD_CHANGED')

    def test_replacement_during_read_refused_even_if_bytes_equal(self):
        self.complete();original=e.os.read;changed=False;content=self.path.read_bytes()
        def read(fd,count):
            nonlocal changed
            data=original(fd,count)
            if not changed:
                changed=True;p=self.root/'replacement';p.write_bytes(content);p.chmod(0o600);os.replace(p,self.path)
            return data
        with patch.object(e.os,'read',side_effect=read):self.refused(self.observe,'PROGRAM_RECORD_CHANGED')

    def test_replacement_during_projection_is_detected_at_final_check(self):
        self.complete();original=e._projection
        def project(*args):
            result=original(*args)
            p=self.root/'replacement';p.write_bytes(self.path.read_bytes());p.chmod(0o600)
            os.replace(p,self.path)
            return result
        with patch.object(e,'_projection',side_effect=project):
            self.refused(self.observe,'PROGRAM_RECORD_CHANGED')

    def test_file_created_after_missing_observation_is_not_reported_missing(self):
        original=e._projection
        def project(*args):
            result=original(*args);self.complete();return result
        with patch.object(e,'_projection',side_effect=project):
            self.refused(self.observe,'PROGRAM_RECORD_CHANGED')

    def test_completed_workspace_is_not_promoted_or_deleted(self):
        self.start();job=self.parent/'jobs'/('f'*32);job.mkdir(parents=True)
        result=job/'result.private.json';result.write_text('{"final_response":"retained but not committed"}')
        before=result.read_bytes();out=self.observe()
        self.assertEqual(out['status'],'INCOMPLETE');self.assertEqual(result.read_bytes(),before)
        self.assertEqual(json.loads(self.path.read_text())['state'],'started')

    def test_clock_backwards_or_future_binding_refused(self):
        self.complete();clock=iter([103.,102.])
        self.refused(lambda:self.observe(clock=lambda:next(clock)),'PROGRAM_CLOCK_INVALID')
        self.binding=replace(self.binding,started_at=104.)
        self.refused(self.observe,'PROGRAM_BINDING_MISMATCH')

    def test_deadline_never_retries_or_reopens_record(self):
        self.complete();ticks=iter([0.,1.])
        with patch.object(e.os,'read',side_effect=AssertionError('past deadline')):
            self.refused(lambda:self.observe(monotonic=lambda:next(ticks)),'PROGRAM_OBSERVATION_TIMEOUT')

    def test_no_producer_mutator_or_network_invoked(self):
        self.complete();before=self.tree()
        with (patch.object(producer.Results,'__init__',side_effect=AssertionError('no mkdir')),
             patch.object(producer.Results,'save',side_effect=AssertionError('no persistence')),
             patch.object(producer.Results,'ack',side_effect=AssertionError('no ACK')),
             patch.object(producer.Results,'sweep',side_effect=AssertionError('no cleanup')),
             patch.object(socket,'socket',side_effect=AssertionError('no network'))):
            self.assertEqual(self.observe()['status'],'COMPLETE')
        self.assertEqual(before,self.tree())

    def test_private_payload_identity_workspace_and_token_not_in_output(self):
        self.complete('secret answer, 999999 RUB, customer@example.invalid');out=self.observe();text=json.dumps(out)
        for value in ('secret answer','customer@example.invalid',self.key,self.fingerprint,self.tenant,self.jid,'workspace','private question'):
            self.assertNotIn(value,text)
        self.assertFalse(out['payload_returned']);self.assertFalse(out['native_state_changed']);self.assertFalse(out['replay_permitted'])
        self.assertNotIn(self.key,repr(self.binding))

    def test_original_generation_and_fingerprint_are_not_rebuilt(self):
        changed={**self.envelope,'document':'new coefficients'}
        self.assertNotEqual(producer.binding(changed),self.bind().fingerprint)
        self.assertEqual(self.bind().fingerprint,self.fingerprint)
        self.progress['_compound_answer_generation']='e'*64
        self.refused(self.bind,'PROGRAM_BINDING_MISMATCH')

    def test_other_tenant_job_or_scope_cannot_reuse_observation_binding(self):
        for kw in ({'tenant':'other'},{'jid':'d'*32}):
            self.refused(lambda kw=kw:self.bind(**kw),'PROGRAM_BINDING_MISMATCH')
        self.assertNotEqual(self.bind(operation='b'*64).digest,self.binding.digest)

    def test_missing_original_fingerprint_is_not_backfilled(self):
        for field in ('_program_started','_program_request_binding','_program_started_at'):
            with self.subTest(field=field):
                p=dict(self.progress);p.pop(field);self.refused(lambda:self.bind(progress=p))

    def test_legacy_without_generation_uses_actual_original_key(self):
        p={'_program_started':True,'_program_started_at':100.,'_program_request_binding':{
            'job_id':sha256((self.tenant+'\0'+self.jid).encode()).hexdigest(),'fingerprint':self.fingerprint}}
        self.assertEqual(self.bind(progress=p).job_id,p['_program_request_binding']['job_id'])

    def test_null_or_invalid_generation_and_nontrue_started_refused(self):
        for change in ({'_compound_answer_generation':None},{'_compound_answer_generation':'fake'},
                       {'_program_started':1},{'_program_started_at':105.}):
            with self.subTest(change=change):self.refused(lambda:self.bind(progress={**self.progress,**change}))

    def test_corrupt_binding_or_path_is_never_used(self):
        self.refused(lambda:e.observe(self.root,replace(self.binding,job_id='../x'),owner_uid=os.getuid()),'PROGRAM_BINDING_UNAVAILABLE')
        self.refused(lambda:e.observe('relative',self.binding,owner_uid=os.getuid()),'PROGRAM_STORE_IDENTITY')


if __name__=='__main__':unittest.main()
