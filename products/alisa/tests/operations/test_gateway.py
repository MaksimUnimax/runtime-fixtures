"""Actual existing socketserver lifecycle; synthetic authority for focused tests.

The PostgreSQL suite separately drives concrete signing/private RPC. These
checks do not install a runtime, create roles, or qualify primary outcomes.
"""
from dataclasses import asdict, replace
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[4]
NATIVE=ROOT/'docs/alisa/runtime/v0.11/rt_job_r02'
sys.path[:0]=[str(ROOT),str(NATIVE)]
from products.alisa.runtime.reconciliation import gateway as g,read_channel as ch
from runtime_port import RuntimePort
from runtime_port_ipc import Gateway as OriginalGateway,request as legacy_request
from platform_authority_client import PlatformAuthorityClient
import runtime_port_service
import test_native_snapshot as fixture
import test_read_channel as channel_fixture


class SharedGateway(unittest.TestCase):
    def setUp(self):
        self.f=fixture.NativeSnapshot('test_exact_native_metadata_without_fake_dispatch_uuid_or_revision')
        self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.path=self.f.root/'s';self.target='a'*64
        self.auth=channel_fixture.Authority(ch.native.NativeScope(**asdict(self.f.scope)))
        self.grant_start=time.time()
        original=self.auth.verify
        def verify(*args,**kwargs):
            value=original(*args,**kwargs)
            return replace(value,issued_at=self.grant_start,expires_at=self.grant_start+5)
        self.auth.verify=verify
        self.port=object.__new__(RuntimePort)
        self.port.repo=SimpleNamespace(path=str(self.f.path))
        self.port.service_id='gateway-fixture';self.port.catalog_release_id='fixture-catalog'
        self.port.versions={'runtime_contract_version':'runtime_port_v1'}
        self.port.authority=PlatformAuthorityClient(str(self.f.root/'a'),expected_uid=os.getuid(),
            service_token='synthetic-only-'+'s'*40,service_id=self.port.service_id)
        self.server=None;self.thread=None
        self.before=list(self.f.c.iterdump())

    def start(self,capacity=2):
        self.server=g.Gateway(str(self.path),self.port,allowed_uid=os.getuid(),
                              service_id=self.port.service_id,max_inflight=capacity)
        # Explicit focused-test authority substitution, never product default.
        self.server._staff_verifier=self.auth
        self.server.bound_identity=(self.path.stat().st_dev,self.path.stat().st_ino)
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.01})
        self.thread.start();self.addCleanup(self.finish)

    def finish(self):
        if self.thread is not None:
            self.server.shutdown();self.thread.join(timeout=3)
            self.assertFalse(self.thread.is_alive())
            runtime_port_service.close(self.server)
            self.thread=None

    def client(self):
        return ch.Client(str(self.path),expected_uid=os.getuid(),expected_pid=os.getpid(),
                         expected_producer=ch.producer_pin(),timeout=1.5)

    def test_original_line_json_versions_unchanged(self):
        self.start()
        self.assertEqual(legacy_request(str(self.path),'current_versions',{}),
                         {**self.port.versions,'catalog_release_id':'fixture-catalog'})
        self.assertEqual(self.auth.verifies,0)

    def test_binary_staff_read_and_legacy_share_one_socket(self):
        self.start();inode=self.path.stat().st_ino
        value=self.client().read(self.target,self.auth)
        self.assertEqual(value['whole_job_outcome'],'UNPROVEN')
        self.assertEqual(self.auth.verifies,2)
        self.assertEqual(legacy_request(str(self.path),'current_versions',{})['catalog_release_id'],'fixture-catalog')
        self.assertEqual(self.path.stat().st_ino,inode)
        self.assertEqual(list(self.f.c.iterdump()),self.before)

    def test_fake_legacy_staff_opcode_cannot_reach_read_handler(self):
        self.start()
        with self.assertRaises(Exception) as error:
            legacy_request(str(self.path),'staff_reconciliation_read',{'verified':True})
        self.assertEqual(getattr(error.exception,'code',None),'CAPABILITY_UNAVAILABLE')
        self.assertEqual(self.auth.verifies,0)

    def test_one_shared_capacity_refuses_both_protocols_before_verification(self):
        self.start(capacity=1);self.assertTrue(self.server.capacity.acquire(False))
        try:
            with self.assertRaises(Exception) as error:legacy_request(str(self.path),'current_versions',{})
            self.assertEqual(getattr(error.exception,'code',None),'DEPENDENCY_UNAVAILABLE')
            with self.assertRaises(ch.ChannelError):self.client().read(self.target,self.auth)
            self.assertEqual(self.auth.verifies,0)
        finally:self.server.capacity.release()
        self.assertEqual(legacy_request(str(self.path),'current_versions',{})['catalog_release_id'],'fixture-catalog')

    def test_wrong_peer_is_closed_without_reading_or_verifying(self):
        self.start();self.server.allowed_uid=os.getuid()+12345
        with self.assertRaises(ch.ChannelError):self.client().read(self.target,self.auth)
        self.assertEqual(self.auth.verifies,0);self.assertEqual(list(self.f.c.iterdump()),self.before)

    def test_malformed_binary_never_falls_back_to_legacy(self):
        self.start()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as peer:
            peer.settimeout(1);peer.connect(str(self.path));peer.sendall(b'\x00\x00\x00\x00');peer.shutdown(socket.SHUT_WR)
            value=ch.receive(peer,ch.MAX_RESPONSE,ch.Budget(1))
        self.assertFalse(value['ok']);self.assertEqual(self.auth.verifies,0)
        self.assertEqual(legacy_request(str(self.path),'current_versions',{})['catalog_release_id'],'fixture-catalog')

    def test_silent_connection_deadline_releases_existing_semaphore(self):
        with patch.object(g,'READ_TIMEOUT',.12):
            self.start(capacity=1)
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as peer:
                peer.settimeout(1);peer.connect(str(self.path));self.assertEqual(peer.recv(1),b'')
            self.assertEqual(self.auth.verifies,0)
            self.assertEqual(legacy_request(str(self.path),'current_versions',{})['catalog_release_id'],'fixture-catalog')

    def test_bad_ticket_refuses_but_leaves_legacy_available(self):
        self.start()
        with patch.object(self.auth,'prepare',return_value='forged'):
            with self.assertRaises(ch.ChannelError):self.client().read(self.target,self.auth)
        self.assertEqual(legacy_request(str(self.path),'current_versions',{})['catalog_release_id'],'fixture-catalog')
        self.assertEqual(list(self.f.c.iterdump()),self.before)

    def test_missing_concrete_authority_never_binds_socket(self):
        self.port.authority=SimpleNamespace(service_id=self.port.service_id)
        with self.assertRaises(ch.ChannelError):g.Gateway(str(self.path),self.port,allowed_uid=os.getuid(),service_id=self.port.service_id)
        self.assertFalse(self.path.exists())

    def test_mismatched_service_never_binds_socket(self):
        with self.assertRaises(ch.ChannelError):g.Gateway(str(self.path),self.port,allowed_uid=os.getuid(),service_id='other')
        self.assertFalse(self.path.exists())

    def test_existing_file_preserved(self):
        self.path.write_bytes(b'owned-before')
        with self.assertRaises(RuntimeError):g.Gateway(str(self.path),self.port,allowed_uid=os.getuid(),service_id=self.port.service_id)
        self.assertEqual(self.path.read_bytes(),b'owned-before')

    def test_writable_parent_refused_without_repair(self):
        self.f.root.chmod(0o770)
        with self.assertRaises(ch.ChannelError):g.Gateway(str(self.path),self.port,allowed_uid=os.getuid(),service_id=self.port.service_id)
        self.assertEqual(self.f.root.stat().st_mode&0o777,0o770)

    def test_symlink_parent_refused(self):
        path=self.f.root/'link';path.symlink_to(self.f.root)
        with self.assertRaises(ch.ChannelError):g.Gateway(str(path/'s'),self.port,allowed_uid=os.getuid(),service_id=self.port.service_id)
        self.assertFalse(self.path.exists())

    def test_existing_close_owns_exact_socket_only(self):
        self.start();self.finish();self.assertFalse(self.path.exists())

    def test_source_transform_changes_only_bootstrap_import(self):
        p=NATIVE/'runtime_port_service.py';raw=p.read_bytes()
        value=g.service_source(raw.decode())
        self.assertEqual(value.replace('from reconciliation.gateway import Gateway\n',
                                      'from runtime_port_ipc import Gateway\n'),raw.decode())
        self.assertEqual(p.read_bytes(),raw)
        self.assertIs(runtime_port_service.Gateway,OriginalGateway)

    def test_changed_bootstrap_context_refused_not_guessed(self):
        for value in ('', 'from runtime_port_ipc import Gateway\n'*2):
            with self.subTest(value=value),self.assertRaises(ch.ChannelError):g.service_source(value)

    def test_constructor_does_not_open_database_or_start_worker(self):
        with patch.object(ch.native.sqlite3,'connect',side_effect=AssertionError('no DB on attach')):
            self.start();self.finish()
        self.assertEqual(self.auth.verifies,0)


if __name__=='__main__':unittest.main()
