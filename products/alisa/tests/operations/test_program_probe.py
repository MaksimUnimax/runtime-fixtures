"""Real Unix producer observation, plus unchanged accepted broker composition.

Private disposable outbox, actual Results records; no staff capability claim.
Only the broker fixture's configured BASE, native peer name and lock path are
mapped to the owned test context. Native-to-staff current-state wiring is not
qualified by substituting the fixture's OS user for a live native principal.
"""
from dataclasses import asdict,replace
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
from products.alisa.runtime.reconciliation import program_probe as p
import test_program_evidence as fixture
BROKER=ROOT/'docs/alisa/runtime/v0.11/current_parameters_r8/program_recovery/program_broker.py'


class ProgramProbe(unittest.TestCase):
    def setUp(self):
        self.f=fixture.RetainedProgramEvidence('test_actual_writer_pinned_and_unchanged')
        self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.binding=replace(self.f.binding,started_at=time.time()-2)
        self.f.writer.complete(self.f.key,self.f.fingerprint,'private synthetic answer')
        self.path=self.f.parent/'s';self.listener=None;self.thread=None;self.process=None
        self.before=self.f.tree();self.status=[];self.frames=[];self.errors=[]

    def start(self,*,handler=None,uid=None,broker_protocol=None):
        self.listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.listener.bind(str(self.path));self.path.chmod(0o600);self.listener.listen(1);self.listener.settimeout(2)
        def serve():
            try:
                stream,_=self.listener.accept()
                with stream:
                    if broker_protocol is not None:
                        self.run_broker(stream,broker_protocol);return
                    if handler is not None:handler(stream);return
                    stream.settimeout(1)
                    with stream.makefile('rwb') as wire:
                        raw=wire.readline(p.MAX_REQUEST+1)
                        if not raw:return
                        value=json.loads(raw)
                        def send(value):
                            self.frames.append(value);wire.write(p.evidence.encoded(value)+b'\n');wire.flush()
                        self.status.append(p.serve_request(stream,value,send,root=self.f.root,
                            owner_uid=os.getuid(),native_uid=os.getuid() if uid is None else uid))
            except (OSError,TimeoutError):pass
            except BaseException as error:self.errors.append(type(error).__name__+':'+str(error)[:500])
        self.thread=threading.Thread(target=serve);self.thread.start();self.addCleanup(self.finish)

    def finish(self):
        if self.thread is not None:
            self.thread.join(timeout=4);self.assertFalse(self.thread.is_alive(),'own probe fixture still active')
        if self.listener is not None:self.listener.close()
        if self.path.exists():self.path.unlink()
        if self.process is not None and self.process.poll() is None:
            self.process.kill();self.process.wait(timeout=2);self.fail('own broker fixture exceeded deadline')

    def client(self,**kwargs):
        return p.Client(str(self.path),socket_owner_uid=kwargs.pop('socket_owner_uid',os.getuid()),
            peer_uid=kwargs.pop('peer_uid',os.getuid()),expected_producer=kwargs.pop('expected_producer',p.producer_pin()),
            timeout=kwargs.pop('timeout',1.),**kwargs)

    def run_broker(self,stream,protocol):
        source=p.broker_source(BROKER.read_text())
        code="""import sys,os,types,builtins
from pathlib import Path
sys.path[:0]=[RUNTIME,PROGRAM]
from reconciliation.program_probe import broker_source
source=broker_source(Path(BROKER).read_text())
m=types.ModuleType('owned_s16_program_fixture');m.__file__=BROKER
exec(compile(source,BROKER,'exec'),m.__dict__)
m.BASE=Path(BASE)
m.pwd=types.SimpleNamespace(getpwnam=lambda name:types.SimpleNamespace(pw_uid=os.getuid()))
def forbidden(*args,**kwargs):raise AssertionError('forbidden fixture dispatch/mutation')
m.subprocess=types.SimpleNamespace(run=forbidden,Popen=forbidden)
original=builtins.open
def opened(path,*args,**kwargs):
 if str(path)=='/run/lock/alisa-program.lock':
  if PROTOCOL==4:raise AssertionError('read-only probe reached recovery lock')
  return original(Path(BASE)/'fixture.lock',*args,**kwargs)
 return original(path,*args,**kwargs)
m.open=opened
if PROTOCOL==4:
 import program_results
 program_results.Results.__init__=forbidden
 program_results.Results.save=forbidden
 program_results.Results.ack=forbidden
 program_results.Results.sweep=forbidden
m.serve()
"""
        variables={'RUNTIME':str(ROOT/'products/alisa/runtime'),'PROGRAM':str(BROKER.parent),
                   'BROKER':str(BROKER),'BASE':str(self.f.parent),'PROTOCOL':protocol}
        code='\n'.join(k+'='+repr(v) for k,v in variables.items())+'\n'+code
        self.process=subprocess.Popen([sys.executable,'-I','-B','-c',code],stdin=stream,
                                      stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        _,error=self.process.communicate(timeout=3)
        self.assertEqual(self.process.returncode,0,error.decode()[-1000:])

    def test_actual_probe_verifies_content_without_returning_answer(self):
        self.start();out=self.client().observe(self.f.binding);self.finish()
        self.assertEqual(out['status'],'COMPLETE');self.assertTrue(out['content_verified'])
        self.assertEqual(out['whole_job_outcome'],'UNPROVEN');self.assertNotIn('private synthetic answer',json.dumps(out))
        self.assertEqual(self.before,self.f.tree());self.assertEqual(self.status,['SENT'])

    def test_actual_accepted_broker_dispatches_probe_before_results_or_lock(self):
        self.assertEqual(sha256(BROKER.read_bytes()).hexdigest(),
                         '70f50e3345c2408e039dd7811ecf1282f8b606990d2ec96e931291708ac41423')
        self.start(broker_protocol=4);out=self.client(timeout=2.).observe(self.f.binding);self.finish()
        self.assertEqual(out['status'],'COMPLETE');self.assertEqual(self.before,self.f.tree())

    def test_existing_protocol3_still_returns_original_bound_payload_without_ack(self):
        self.start(broker_protocol=3)
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
            stream.settimeout(2);stream.connect(str(self.path))
            stream.sendall(json.dumps({'protocol':3,'job_id':self.f.key,'fingerprint':self.f.fingerprint,
                                       'resume_only':True}).encode()+b'\n');stream.shutdown(socket.SHUT_WR)
            with stream.makefile('rb') as wire:out=json.loads(wire.readline(8193))
        self.finish();self.assertEqual(out['kind'],'complete');self.assertEqual(out['fingerprint'],self.f.fingerprint)
        self.assertEqual(self.before,self.f.tree())

    def test_existing_protocol2_retained_path_is_unchanged(self):
        self.start(broker_protocol=2)
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
            stream.settimeout(2);stream.connect(str(self.path))
            stream.sendall(json.dumps({'protocol':2,'resume_only':True,**self.f.envelope}).encode()+b'\n')
            stream.shutdown(socket.SHUT_WR)
            with stream.makefile('rb') as wire:out=json.loads(wire.readline(8193))
        self.finish();self.assertEqual(out['kind'],'complete');self.assertEqual(self.before,self.f.tree())

    def test_actual_writer_ack_is_not_promoted_to_whole_job(self):
        value=json.loads(self.f.path.read_text());self.f.writer.ack(self.f.key,self.f.fingerprint,value['digest'])
        self.before=self.f.tree();self.start();out=self.client().observe(self.f.binding)
        self.assertEqual(out['status'],'ACKNOWLEDGED');self.assertFalse(out['content_verified'])
        self.assertEqual(out['whole_job_outcome'],'UNPROVEN');self.assertEqual(self.before,self.f.tree())

    def test_missing_file_is_true_not_retained_not_nonexecution(self):
        self.f.path.unlink();self.start();out=self.client().observe(self.f.binding)
        self.assertEqual(out['status'],'NOT_RETAINED');self.assertFalse(out['not_retained_means_not_executed'])

    def test_missing_store_is_error_not_not_retained(self):
        self.f.path.unlink();self.f.root.rmdir();self.start()
        with self.assertRaises(p.ProbeUnavailable) as error:self.client().observe(self.f.binding)
        self.assertEqual(error.exception.code,'PROGRAM_STORE_UNAVAILABLE');self.assertFalse(self.f.root.exists())

    def test_wrong_fingerprint_is_refused_without_recovery(self):
        self.start()
        with self.assertRaises(p.ProbeUnavailable) as error:self.client().observe(replace(self.f.binding,fingerprint='0'*64))
        self.assertEqual(error.exception.code,'PROGRAM_BINDING_MISMATCH');self.assertEqual(self.before,self.f.tree())

    def test_wrong_server_uid_refused_before_request(self):
        self.start()
        with self.assertRaises(p.ProbeUnavailable) as error:self.client(peer_uid=os.getuid()+100000).observe(self.f.binding)
        self.assertEqual(error.exception.code,'PROBE_PEER_REJECTED');self.assertEqual(self.before,self.f.tree())

    def test_wrong_native_uid_never_opens_record(self):
        self.start(uid=os.getuid()+100000)
        with patch.object(p.evidence,'observe',side_effect=AssertionError('must not read')) as observed:
            with self.assertRaises(p.ProbeUnavailable):self.client().observe(self.f.binding)
            self.finish();observed.assert_not_called()

    def test_socket_owner_distinct_from_broker_peer_is_checked(self):
        self.start()
        with self.assertRaises(p.ProbeUnavailable) as error:self.client(socket_owner_uid=os.getuid()+100000).observe(self.f.binding)
        self.assertEqual(error.exception.code,'PROBE_PEER_REJECTED')

    def test_source_pin_mismatch_refused(self):
        self.start()
        with self.assertRaises(p.ProbeUnavailable) as error:self.client(expected_producer='0'*64).observe(self.f.binding)
        self.assertEqual(error.exception.code,'PROBE_PRODUCER_MISMATCH')

    def forged_response(self,change,*,suffix=b''):
        def handler(stream):
            with stream.makefile('rwb') as wire:
                value=json.loads(wire.readline(p.MAX_REQUEST+1))
                out={'protocol':4,'request_id':value['request_id'],'reference_sha256':self.f.binding.digest,
                     'producer_sha256':p.producer_pin(),'ok':True,
                     'observation':p.evidence.observe(self.f.root,self.f.binding,owner_uid=os.getuid())}
                change(out);wire.write(p.evidence.encoded(out)+b'\n'+suffix);wire.flush()
        self.start(handler=handler)
        with self.assertRaises(p.ProbeUnavailable):self.client().observe(self.f.binding)

    def test_reply_nonce_cannot_be_substituted(self):
        self.forged_response(lambda v:v.update(request_id='0'*64))

    def test_reply_reference_cannot_be_substituted(self):
        self.forged_response(lambda v:v.update(reference_sha256='0'*64))

    def test_payload_cannot_claim_whole_job_execution(self):
        self.forged_response(lambda v:v['observation'].update(whole_job_outcome='EXECUTED'))

    def test_payload_cannot_permit_replay_or_hide_fields(self):
        self.forged_response(lambda v:v['observation'].update(replay_permitted=True))

    def test_reply_cannot_add_private_answer(self):
        self.forged_response(lambda v:v['observation'].update(content='private answer'))

    def test_extra_frame_or_suffix_rejected(self):
        self.forged_response(lambda v:None,suffix=b'{}\n')

    def test_expiry_during_transport_is_not_fresh_completion(self):
        self.start()
        with self.assertRaises(p.ProbeUnavailable):self.client().observe(self.f.binding,clock=lambda:time.time()+3601)

    def test_bounded_response_before_json(self):
        def handler(stream):
            stream.recv(4096);stream.sendall(b'x'*(p.MAX_RESPONSE+1))
        self.start(handler=handler)
        with self.assertRaises(p.ProbeUnavailable):self.client().observe(self.f.binding)

    def test_slow_reply_times_out_without_reconnect(self):
        calls=[]
        def handler(stream):calls.append(1);stream.recv(4096);time.sleep(.12)
        self.start(handler=handler)
        with self.assertRaises(p.ProbeUnavailable) as error:self.client(timeout=.05).observe(self.f.binding)
        self.assertEqual(error.exception.code,'PROBE_TIMEOUT');self.finish();self.assertEqual(calls,[1])

    def test_unsafe_request_field_never_selects_a_path(self):
        self.start()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
            stream.settimeout(1);stream.connect(str(self.path))
            stream.sendall(json.dumps({'protocol':4,'request_id':'a'*64,'binding':asdict(self.f.binding),
                                       'path':'/never/open/from/client'}).encode()+b'\n');stream.shutdown(socket.SHUT_WR)
            with stream.makefile('rb') as wire:reply=json.loads(wire.readline(p.MAX_RESPONSE+1))
        self.assertFalse(reply['ok']);self.assertEqual(self.before,self.f.tree())

    def test_invalid_nonce_is_not_echoed_as_private_payload(self):
        self.start()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
            stream.settimeout(1);stream.connect(str(self.path))
            stream.sendall(json.dumps({'protocol':4,'request_id':{'secret':'not-a-nonce'},
                'binding':asdict(self.f.binding)}).encode()+b'\n');stream.shutdown(socket.SHUT_WR)
            with stream.makefile('rb') as wire:reply=json.loads(wire.readline(p.MAX_RESPONSE+1))
        self.assertFalse(reply['ok']);self.assertIsNone(reply['request_id'])
        self.assertNotIn('not-a-nonce',json.dumps(reply));self.assertEqual(self.before,self.f.tree())

    def test_exact_optin_broker_transform_keeps_original_peer_check_first(self):
        raw=BROKER.read_text();transformed=p.broker_source(raw)
        self.assertLess(transformed.index("raise PermissionError('peer')"),
                        transformed.index('from reconciliation.program_probe import serve_request'))
        self.assertLess(transformed.index('from reconciliation.program_probe import serve_request'),
                        transformed.index('from program_results import Results,binding'))
        self.assertEqual(sha256(BROKER.read_bytes()).hexdigest(),
                         '70f50e3345c2408e039dd7811ecf1282f8b606990d2ec96e931291708ac41423')
        with self.assertRaises(p.ProbeUnavailable):p.broker_source('changed source')

    def test_changed_peer_refusal_cannot_be_silently_composed(self):
        raw=BROKER.read_text();marker="raise PermissionError('peer')"
        self.assertEqual(raw.count(marker),1)
        changed=raw.replace(marker,"pass # fixture removed peer refusal")
        with self.assertRaises(p.ProbeUnavailable):p.broker_source(changed)

    def test_repr_does_not_return_socket_path(self):
        self.assertNotIn(str(self.path),repr(self.client()))


if __name__=='__main__':unittest.main()
