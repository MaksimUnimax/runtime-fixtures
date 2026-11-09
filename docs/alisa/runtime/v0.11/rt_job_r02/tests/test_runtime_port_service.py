"""Opt-in configuration remains disabled and secret-free until explicit startup."""
import copy
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from runtime_port_service import validate, attach
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
