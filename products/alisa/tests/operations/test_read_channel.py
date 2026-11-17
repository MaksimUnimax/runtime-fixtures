"""Real local Unix peers and SQLite; synthetic ticket issuer/current-staff state.

No production listener/config/key/DB or platform grant is created. The existing
staff policy runs on synthetic snapshots; real DB-backed verifier wiring is NOT
qualified by these tests. No imported TestCase is rediscovered as this module.
"""
from dataclasses import asdict, replace
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import socket
import struct
import sys
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT))
from products.alisa.runtime.reconciliation import read_channel as ch
import test_native_snapshot as fixture
policy_file = ROOT/'products/alisa/services/platform/src/alisa_platform/staff/policy.py'
spec=importlib.util.spec_from_file_location('read_channel_staff_policy',policy_file)
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)


class Authority:
    """Real existing policy + test-only HMAC, not the production signing adapter."""
    def __init__(self,scope):
        self.scope=scope;self.key=b'isolated-test-ticket-only';self.staff=str(uuid4())
        self.member={'product_id':'alisa_market','issuer':'fixture','client_id':'fixture',
            'active':True,'revision':1,'role':'ADMIN','permissions':['ops.reconcile']}
        self.session={'product_id':'alisa_market','revision':1,'revoked':False,
            'created_at':950.,'expires_at':1500.,'mfa_at':990.,'mfa_type':'totp'}
        self.now=1000.;self.prepares=0;self.current_checks=0;self.verifies=0;self.after_verify=None

    def permitted(self):
        return policy.session_allowed(self.member,self.session,issuer='fixture',client='fixture',
                                      now=self.now,permission=ch.PERMISSION)

    def prepare(self,nonce,target,*,remaining):
        self.prepares+=1
        ch.require(self.permitted(),'AUTH_REQUIRED')
        body=ch.encoded({'nonce':nonce,'target':target,'staff':self.staff,'revision':self.member['revision']})
        return body.hex()+'.'+hmac.digest(self.key,body,'sha256').hex()

    def current(self,ticket,nonce,target,*,remaining):
        self.current_checks+=1
        return self.permitted()

    def verify(self,ticket,nonce,target,*,remaining):
        self.verifies+=1
        body,signature=ticket.split('.')
        body=bytes.fromhex(body)
        ch.require(hmac.compare_digest(signature,hmac.digest(self.key,body,'sha256').hex()),'AUTH_REQUIRED')
        data=ch.decoded(body)
        ch.require(data=={'nonce':nonce,'target':target,'staff':self.staff,'revision':self.member['revision']}
                   and self.permitted(),'AUTH_REQUIRED')
        value=ch.Grant(nonce,target,self.staff,hashlib.sha256(str(self.member['revision']).encode()).hexdigest(),
                       self.scope,1000.,1005.)
        if self.after_verify:self.after_verify(self.verifies)
        return value


class UnixReadChannel(unittest.TestCase):
    def setUp(self):
        self.f=fixture.NativeSnapshot('test_exact_native_metadata_without_fake_dispatch_uuid_or_revision')
        self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.scope=ch.native.NativeScope(**asdict(self.f.scope))
        self.auth=Authority(self.scope);self.target='a'*64;self.before=list(self.f.c.iterdump())
        self.path=self.f.root/'reader.sock';self.listener=None;self.thread=None;self.status=[]

    def server(self,*,allowed_uid=None,handler=None,timeout=.4):
        self.listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.listener.bind(str(self.path));self.path.chmod(0o600)
        self.listener.listen(1);self.listener.settimeout(.5)
        def work():
            try:
                peer,_=self.listener.accept()
                with peer:
                    if handler is not None:handler(peer)
                    else:self.status.append(ch.serve_connected(peer,
                        allowed_uid=os.getuid() if allowed_uid is None else allowed_uid,
                        authority=self.auth,database=self.f.path,native_uid=os.getuid(),
                        timeout=timeout,clock=lambda:self.auth.now))
            except (OSError,TimeoutError):pass
        self.thread=threading.Thread(target=work)
        self.thread.start();self.addCleanup(self.finish)

    def finish(self):
        if self.thread is not None:
            self.thread.join(timeout=2)
            self.assertFalse(self.thread.is_alive(),'own fixture still running')
        if self.listener is not None:self.listener.close()
        if self.path.exists():self.path.unlink()

    def client(self,**kw):
        return ch.Client(str(self.path),expected_uid=kw.pop('expected_uid',os.getuid()),
                         expected_pid=kw.pop('expected_pid',os.getpid()),
                         expected_producer=kw.pop('expected_producer',ch.producer_pin()),
                         timeout=kw.pop('timeout',.8),**kw)

    def refused(self,code,call):
        with self.assertRaises(ch.ChannelError) as error:call()
        self.assertEqual(error.exception.code,code)
        self.assertNotIn(str(self.f.path),str(error.exception))
        self.assertEqual(list(self.f.c.iterdump()),self.before)

    def test_actual_peer_and_current_staff_checked_both_sides_sqlite_unchanged(self):
        self.server();v=self.client().read(self.target,self.auth);self.finish()
        self.assertEqual(v['binding']['dispatch_sequence'],0)
        self.assertEqual(v['whole_job_outcome'],'UNPROVEN')
        self.assertIs(v['replay_permitted'],False)
        self.assertEqual(self.auth.verifies,2);self.assertEqual(self.auth.current_checks,3)
        self.assertEqual(self.status,['SENT']);self.assertEqual(list(self.f.c.iterdump()),self.before)

    def test_wrong_server_uid_refuses_before_ticket_leaves_client(self):
        self.server()
        self.refused('PEER_REJECTED',lambda:self.client(expected_uid=os.getuid()+1234).read(self.target,self.auth))
        self.assertEqual(self.auth.verifies,0)

    def test_wrong_server_process_refuses_before_native_authority(self):
        self.server()
        self.refused('PEER_REJECTED',lambda:self.client(expected_pid=os.getpid()+100000).read(self.target,self.auth))
        self.finish();self.assertEqual(self.auth.verifies,0)

    def test_server_rejects_wrong_client_uid_before_read_or_verify(self):
        self.server(allowed_uid=os.getuid()+1234)
        with patch.object(ch.native,'read_snapshot',side_effect=AssertionError('must not read')) as read:
            with self.assertRaises(ch.ChannelError):self.client().read(self.target,self.auth)
            self.finish();read.assert_not_called()
        self.assertEqual(self.auth.verifies,0)

    def test_forged_verified_boolean_not_grant(self):
        self.auth.verify=lambda *a,**kw:True;self.server()
        self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_server_without_verifier_does_not_read(self):
        self.auth.verify=None;self.server()
        with patch.object(ch.native,'read_snapshot',side_effect=AssertionError('must not read')) as read:
            with self.assertRaises(ch.ChannelError):self.client().read(self.target,self.auth)
            self.finish();read.assert_not_called()

    def test_client_numerical_truth_is_not_authority(self):
        self.auth.current=lambda *a,**kw:1
        self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_revoked_session_does_not_connect(self):
        self.auth.session['revoked']=True
        with patch.object(ch.socket,'socket') as sock:
            self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))
        sock.assert_not_called()

    def test_mfa_expiry_is_real_existing_staff_policy_not_flag(self):
        self.auth.session['mfa_at']=600.
        self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_other_permission_and_disabled_member_refuse(self):
        for delta in ({'permissions':['users.read']},{'active':False},{'revision':2},{'product_id':'other'}):
            old=dict(self.auth.member);self.auth.member.update(delta)
            self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))
            self.auth.member=old

    def test_revocation_after_native_read_hides_answer(self):
        original=ch.native.read_snapshot
        def revoke(*a,**kw):
            result=original(*a,**kw);self.auth.session['revoked']=True;return result
        with patch.object(ch.native,'read_snapshot',side_effect=revoke):
            self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth));self.finish()
        self.assertEqual(self.auth.verifies,2)

    def test_client_final_recheck_hides_completed_reply_after_revoke(self):
        self.auth.after_verify=lambda count:self.auth.session.update(revoked=True) if count==2 else None
        self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_changed_authorized_scope_between_reads_is_not_same_grant(self):
        original=self.auth.verify
        def changed(*a,**kw):
            grant=original(*a,**kw)
            return replace(grant,authority_revision='b'*64) if self.auth.verifies==2 else grant
        self.auth.verify=changed;self.server()
        self.refused('AUTH_CHANGED',lambda:self.client().read(self.target,self.auth))

    def test_ticket_signature_tamper_refused(self):
        prepare=self.auth.prepare
        self.auth.prepare=lambda *a,**kw:prepare(*a,**kw)[:-64]+'0'*64
        self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_ticket_bound_to_exact_nonce_and_target(self):
        prepare=self.auth.prepare
        self.auth.prepare=lambda nonce,target,**kw:prepare('f'*64,target,**kw)
        self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_expired_grant_refused_before_native_read(self):
        verify=self.auth.verify
        self.auth.verify=lambda *a,**kw:replace(verify(*a,**kw),expires_at=999.)
        with patch.object(ch.native,'read_snapshot') as read:
            self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth));self.finish()
            read.assert_not_called()

    def test_grant_cannot_extend_lifetime(self):
        verify=self.auth.verify
        self.auth.verify=lambda *a,**kw:replace(verify(*a,**kw),expires_at=1006.)
        self.server();self.refused('AUTH_REQUIRED',lambda:self.client().read(self.target,self.auth))

    def test_other_scope_is_checked_against_actual_native_rows(self):
        self.auth.scope=replace(self.scope,object_id=str(uuid4()))
        self.server();self.refused('SNAPSHOT_UNAVAILABLE',lambda:self.client().read(self.target,self.auth))

    def test_dependency_exception_never_echoes_token_path_or_payload(self):
        def bad(*a,**kw):raise ValueError('private-token-'+str(self.f.path))
        self.auth.verify=bad;self.server()
        self.refused('CHANNEL_UNAVAILABLE',lambda:self.client().read(self.target,self.auth))

    def test_source_pin_mismatch_never_returns_data(self):
        self.server();self.refused('PRODUCER_MISMATCH',lambda:self.client(expected_producer='0'*64).read(self.target,self.auth))

    def fake_reply(self,peer,changes=None):
        b=ch.Budget(.8);request=ch.receive(peer,ch.MAX_REQUEST,b)
        value={'schema':ch.SCHEMA,'request_id':request['request_id'],'target_sha256':request['target_sha256'],
               'producer_sha256':ch.producer_pin(),'ok':True,'snapshot':{'synthetic':True}}
        value.update(changes or {});ch.send(peer,value,ch.MAX_RESPONSE,b)

    def test_response_nonce_mismatch_is_rejected(self):
        self.server(handler=lambda p:self.fake_reply(p,{'request_id':'0'*64}))
        self.refused('RESPONSE_MISMATCH',lambda:self.client().read(self.target,self.auth))

    def test_response_target_mismatch_is_rejected(self):
        self.server(handler=lambda p:self.fake_reply(p,{'target_sha256':'0'*64}))
        self.refused('RESPONSE_MISMATCH',lambda:self.client().read(self.target,self.auth))

    def test_multiple_or_duplicate_response_fields_rejected(self):
        def bad(peer):
            b=ch.Budget(.5);ch.receive(peer,ch.MAX_REQUEST,b)
            raw=b'{"ok":true,"ok":false}'
            peer.sendall(struct.pack('!I',len(raw))+raw);peer.shutdown(socket.SHUT_WR)
        self.server(handler=bad)
        self.refused('CHANNEL_INVALID',lambda:self.client().read(self.target,self.auth))

    def test_wire_response_length_bound_is_enforced_before_body_read(self):
        def bad(peer):
            b=ch.Budget(.5);ch.receive(peer,ch.MAX_REQUEST,b)
            peer.sendall(struct.pack('!I',ch.MAX_RESPONSE+1));peer.shutdown(socket.SHUT_WR)
        self.server(handler=bad)
        self.refused('CHANNEL_INVALID',lambda:self.client().read(self.target,self.auth))

    def test_suffix_after_response_is_not_silently_ignored(self):
        def bad(peer):
            ch.receive(peer,ch.MAX_REQUEST,ch.Budget(.5))
            raw=b'{}';peer.sendall(struct.pack('!I',len(raw))+raw+b'!');peer.shutdown(socket.SHUT_WR)
        self.server(handler=bad)
        self.refused('CHANNEL_INVALID',lambda:self.client().read(self.target,self.auth))

    def test_slow_drip_does_not_reset_total_io_deadline(self):
        def slow(peer):
            ch.receive(peer,ch.MAX_REQUEST,ch.Budget(.5))
            for char in struct.pack('!I',20):
                try:peer.send(bytes([char]));time.sleep(.06)
                except OSError:break
        self.server(handler=slow);start=time.monotonic()
        self.refused('CHANNEL_TIMEOUT',lambda:self.client(timeout=.12).read(self.target,self.auth))
        self.assertLess(time.monotonic()-start,.5)

    def test_timeout_does_not_retry_or_make_second_connection(self):
        def slow(peer):
            ch.receive(peer,ch.MAX_REQUEST,ch.Budget(.5));time.sleep(.15)
        self.server(handler=slow)
        self.refused('CHANNEL_TIMEOUT',lambda:self.client(timeout=.08).read(self.target,self.auth))
        self.assertEqual(self.auth.prepares,1)

    def test_symlink_socket_path_refused(self):
        self.server();link=self.f.root/'alias.sock';link.symlink_to(self.path)
        client=self.client();client.path=str(link)
        self.refused('PEER_REJECTED',lambda:client.read(self.target,self.auth))
        link.unlink()

    def test_writable_socket_parent_refused_without_chmod_fix(self):
        self.server();self.f.root.chmod(0o770)
        self.refused('PEER_REJECTED',lambda:self.client().read(self.target,self.auth))
        self.assertEqual(self.f.root.stat().st_mode & 0o777,0o770)
        self.f.root.chmod(0o700)

    def test_input_cannot_supply_native_path_or_verified_authority(self):
        self.server()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as peer:
            peer.connect(str(self.path));b=ch.Budget(.5)
            ch.send(peer,{'schema':ch.SCHEMA,'request_id':'a'*64,'target_sha256':'b'*64,
                         'ticket':'synthetic','database':str(self.f.path),'verified':True},ch.MAX_REQUEST,b)
            result=ch.receive(peer,ch.MAX_RESPONSE,b)
        self.finish();self.assertFalse(result['ok']);self.assertEqual(self.auth.verifies,0)

    def test_grant_and_client_repr_exclude_private_identity(self):
        grant=ch.Grant('a'*64,'b'*64,self.auth.staff,'c'*64,self.scope,1000.,1005.)
        self.assertNotIn(self.auth.staff,repr(grant));self.assertNotIn(str(self.path),repr(self.client()))

    def test_no_listener_or_database_on_module_import(self):
        path=Path(ch.__file__)
        spec=importlib.util.spec_from_file_location('products.alisa.runtime.reconciliation.import_probe',path)
        module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module
        try:
            with patch.object(ch.socket,'socket',side_effect=AssertionError('no listener')),\
                 patch.object(ch.native,'read_snapshot',side_effect=AssertionError('no database')):
                spec.loader.exec_module(module)
        finally:sys.modules.pop(spec.name,None)


if __name__=='__main__':unittest.main()
