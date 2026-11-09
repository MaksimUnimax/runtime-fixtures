"""Opt-in configuration remains disabled and secret-free until explicit startup."""
import copy
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from runtime_port_service import validate, attach
from runtime_port_service import private_credential
from pathlib import Path
import struct,stat,os
from semantics import Rejected


class Configuration(unittest.TestCase):
    def setUp(self):
        self.config={'socket':'/run/native.sock','credential_bindings':{'oz':'ozon-private'},
            'runtime_port':{'enabled':True,'socket':'/run/runtime.sock','allowed_user':'platform',
                'service_id':'platform','catalog_release_id':'qualified-catalog',
                'authority_socket':'/run/authority.sock','authority_user':'platform',
                'authority_credential':'runtime-authority'}}
    def denied(self):
        with self.assertRaises(Rejected)as e:validate(self.config)
        self.assertEqual(e.exception.code,'RUNTIME_PORT_CONFIG')
    def test_absent_and_explicit_off_read_no_secret(self):
        with patch('pathlib.Path.read_text',side_effect=AssertionError('Secret read')):
            self.assertIsNone(attach(None,{},'/absent'))
            self.assertIsNone(attach(None,{'runtime_port':{'enabled':False}},'/absent'))
    def test_configuration_check_reads_no_secret(self):
        with patch('pathlib.Path.read_text',side_effect=AssertionError('Secret read')):
            self.assertEqual(validate(self.config),self.config['runtime_port'])
    def test_bool_type_is_strict(self):
        self.config['runtime_port']={'enabled':0};self.denied()
    def test_missing_settings_have_no_fallback(self):
        del self.config['runtime_port']['service_id'];self.denied()
    def test_unknown_setting_rejected(self):
        self.config['runtime_port']['provider_secret']='fixture';self.denied()
    def test_public_and_native_socket_cannot_collide(self):
        self.config['runtime_port']['socket']=self.config['socket'];self.denied()
    def test_authority_and_runtime_socket_cannot_collide(self):
        self.config['runtime_port']['authority_socket']=self.config['runtime_port']['socket'];self.denied()
    def test_model_credential_cannot_be_reused(self):
        self.config['runtime_port']['authority_credential']='deepseek';self.denied()
    def test_store_credential_cannot_be_reused(self):
        self.config['runtime_port']['authority_credential']='ozon-private';self.denied()
    def test_path_traversal_rejected(self):
        self.config['runtime_port']['authority_socket']='/run/../tmp/authority.sock';self.denied()


class CredentialPermissions(unittest.TestCase):
    def check(self, *, mode=0o440, uid=0, gid=0, size=48, readonly=True, acl=None,
              path='/run/credentials/fixture.service/platform_authority', parent_mode=0o550, parent_uid=0):
        path=Path(path);nobody=0xffffffff
        rows=[(1,4,nobody),(2,4,1001),(4,0,nobody),(16,4,nobody),(32,0,nobody)]
        raw=struct.pack('<I',2)+b''.join(struct.pack('<HHI',*r)for r in rows) if acl is None else acl
        def metadata(p):
            return SimpleNamespace(st_mode=stat.S_IFREG|mode,st_uid=uid,st_gid=gid,st_size=size) if p==path else SimpleNamespace(st_mode=stat.S_IFDIR|parent_mode,st_uid=parent_uid)
        with patch('runtime_port_service.os.getuid',return_value=1001),patch.object(Path,'lstat',metadata),\
             patch('runtime_port_service.os.statvfs',return_value=SimpleNamespace(f_flag=os.ST_RDONLY if readonly else 0)),\
             patch('runtime_port_service.os.getxattr',return_value=raw):
            return private_credential(path)
    def test_exact_readonly_systemd_service_acl_is_private(self):self.assertTrue(self.check())
    def test_owner_only_file_remains_supported(self):self.assertTrue(self.check(mode=0o400,uid=1001,path='/private/key'))
    def test_plain_group_readable_file_is_not_systemd_acl(self):self.assertFalse(self.check(acl=b''))
    def test_writable_mount_is_rejected(self):self.assertFalse(self.check(readonly=False))
    def test_systemd_name_outside_credential_root_is_rejected(self):self.assertFalse(self.check(path='/private/fixture.service/key'))
    def test_nonroot_owner_or_group_is_rejected(self):
        self.assertFalse(self.check(uid=1001));self.assertFalse(self.check(gid=1001))
    def test_world_read_or_group_write_is_rejected(self):
        self.assertFalse(self.check(mode=0o444));self.assertFalse(self.check(mode=0o460))
    def test_changed_parent_owner_or_writable_parent_is_rejected(self):
        self.assertFalse(self.check(parent_uid=1001));self.assertFalse(self.check(parent_mode=0o570))
    def test_other_uid_group_permission_and_extra_acl_are_rejected(self):
        nobody=0xffffffff
        base=[(1,4,nobody),(2,4,1001),(4,0,nobody),(16,4,nobody),(32,0,nobody)]
        for rows in ([base[0],(2,4,1002),*base[2:]], [*base[:2],(4,4,nobody),*base[3:]], [*base,(2,4,1002)]):
            self.assertFalse(self.check(acl=struct.pack('<I',2)+b''.join(struct.pack('<HHI',*r)for r in rows)))
    def test_truncated_or_wrong_acl_version_is_rejected(self):
        self.assertFalse(self.check(acl=b'\x02'));self.assertFalse(self.check(acl=struct.pack('<I',3)))
    def test_oversized_secret_is_rejected(self):self.assertFalse(self.check(size=258))


class StartupCleanup(unittest.TestCase):
    def fail_start(self, failure, target):
        import runtime
        d={'database':'/fixture/not-opened.sqlite','socket':'/fixture/not-bound.sock',
           'web_user':'fixture-user','credential_bindings':{},'qualifications':{}}
        with ExitStack()as stack:
            configuration=stack.enter_context(patch('runtime.Configuration'))
            configuration.return_value.read.return_value=d
            configuration.return_value.ready.return_value=d
            stack.enter_context(patch('runtime.os.geteuid',return_value=1001))
            stack.enter_context(patch.dict('os.environ',{'CREDENTIALS_DIRECTORY':'/fixture/credentials'}))
            for name in ['Repository','Engine','HTTPTransport','Worker']:
                stack.enter_context(patch('runtime.'+name))
            stack.enter_context(patch('model_usage.begin_run'))
            stack.enter_context(patch('retention.sweep'))
            attached=stack.enter_context(patch('runtime_port_service.attach'))
            closed=stack.enter_context(patch('runtime_port_service.close'))
            stack.enter_context(patch('runtime.Path.mkdir'))
            stack.enter_context(patch('runtime.pwd.getpwnam',return_value=SimpleNamespace(pw_uid=1002)))
            stack.enter_context(patch(target,side_effect=failure))
            with self.assertRaises(type(failure)):runtime.main(['--config','/fixture/config'])
            closed.assert_called_once_with(attached.return_value)
    def test_user_lookup_failure_closes_attached_port(self):
        self.fail_start(KeyError('missing-user'),'runtime.pwd.getpwnam')
    def test_directory_failure_closes_attached_port(self):
        self.fail_start(PermissionError('fixture'),'runtime.Path.mkdir')
    def test_native_gateway_failure_closes_attached_port(self):
        self.fail_start(OSError('fixture'),'runtime.Gateway')
