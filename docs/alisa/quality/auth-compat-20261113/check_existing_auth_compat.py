"""Current authorization boundaries, synthetic SQLite, no product DB or network.

This does not implement or enable a compatibility adapter. Platform model
lookups are test doubles; the real OAuth and authority decision code executes.
"""
import argparse
from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import threading
import time
from types import SimpleNamespace as Obj
import unittest
from unittest.mock import Mock, patch

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--only', nargs='+')
args = parser.parse_args()
ROOT = args.root.resolve()
INPUTS = ROOT / 'inputs'
NATIVE = ROOT / 'native'
before = json.loads((INPUTS / 'SOURCE_HASHES.json').read_text())


def verify_sources():
    for name, digest in before.items():
        assert hashlib.sha256((INPUTS / name).read_bytes()).hexdigest() == digest, name
    manifest = json.loads((NATIVE / 'manifest.json').read_text())
    for name, digest in manifest['files'].items():
        assert hashlib.sha256((NATIVE / name).read_bytes()).hexdigest() == digest, name


verify_sources()
network_attempts = []


def forbidden_network(*unused, **options):
    network_attempts.append(True)
    raise AssertionError('Network is forbidden in authorization compatibility tests')


isolation = ExitStack()
isolation.enter_context(patch.object(socket.socket, 'connect', forbidden_network))
isolation.enter_context(patch.object(socket.socket, 'connect_ex', forbidden_network))
isolation.enter_context(patch('socket.getaddrinfo', forbidden_network))
sys.path[:0] = [str(INPUTS / 'platform'), str(NATIVE), str(INPUTS / 'station')]
from django.conf import settings
assert not settings.configured
settings.configure(
    SECRET_KEY='synthetic-compatibility-only-key-not-used-on-any-service',
    INSTALLED_APPS=['alisa_platform.foundation', 'alisa_platform.leads',
        'alisa_platform.funnel', 'alisa_platform.accounts', 'alisa_platform.staff',
        'alisa_platform.entitlements', 'alisa_platform.stores', 'alisa_platform.alice_link'],
    DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
    DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', USE_TZ=True,
    RUNTIME_AUTHORITY_ENABLED=True, ACCOUNTS_ENABLED=True, STORES_ENABLED=True,
    ENTITLEMENTS_ENABLED=True, ALICE_LINK_ENABLED=True,
    ALICE_CLIENT_ID='synthetic-current-client', ALISA_ENV='dev')
import django
django.setup()
from django.db.backends.base.base import BaseDatabaseWrapper
isolation.enter_context(patch.object(BaseDatabaseWrapper, 'ensure_connection',
    side_effect=AssertionError('No Django database is permitted in this unit qualification')))
from alisa_platform.runtime_adapter import authority as platform_authority
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.alice_link import oauth
from runtime_port import RuntimePort
from semantics import Rejected
from template_clarification import continue_task
spec = importlib.util.spec_from_file_location('station_source', INPUTS / 'station/service.py')
station = importlib.util.module_from_spec(spec)
spec.loader.exec_module(station)


class ExistingAuthorizationCompatibility(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='synthetic-auth-', dir=ROOT)
        self.addCleanup(self.folder.cleanup)
        self.db = Path(self.folder.name) / 'legacy.sqlite3'
        self.legacy_token = 'legacy-synthetic-token-never-valid-outside-this-fixture'
        self.hash = hashlib.sha256(self.legacy_token.encode()).hexdigest()
        now = time.time()
        with sqlite3.connect(self.db) as c:
            c.execute('CREATE TABLE tokens(hash TEXT PRIMARY KEY,account TEXT,kind TEXT,expires REAL,revoked INTEGER)')
            c.executemany('INSERT INTO tokens VALUES(?,?,?,?,?)', [
                (self.hash, 'fixture-native', 'access', now + 3600, 0),
                ('revoked-fixture', 'fixture-native', 'access', now + 3600, 1),
                ('expired-fixture', 'fixture-native', 'access', now - 1, 0),
                ('refresh-fixture', 'fixture-native', 'refresh', now + 3600, 0)])
        switch = patch.object(station, 'TOKEN_DB', str(self.db)); switch.start()
        self.addCleanup(switch.stop)

    def deny(self, code, action, error_type=RuntimeFailure):
        with self.assertRaises(error_type) as error:
            action()
        self.assertEqual(error.exception.code, code)

    def test_existing_legacy_authorization_is_valid_without_new_platform_rows(self):
        self.assertTrue(station.token_active('fixture-native', self.hash))

    def test_a_valid_legacy_hash_does_not_authorize_another_native_account(self):
        self.assertFalse(station.token_active('another-fixture-native', self.hash))

    def test_revoked_and_expired_legacy_access_remain_denied(self):
        for digest in ['revoked-fixture', 'expired-fixture']:
            with self.subTest(digest=digest):
                self.assertFalse(station.token_active('fixture-native', digest))

    def test_refresh_capability_alone_is_not_access_authority(self):
        self.assertTrue(station.token_refresh_possible('fixture-native'))
        self.assertFalse(station.token_active('fixture-native', 'refresh-fixture'))

    def registry(self, duplicate=False):
        binding = {'tenant': 'fixture-native', 'application': 'fixture-app-A'}
        config = {'enabled': True, 'manual_command': 'результат'}
        a = Obj(state={'binding': binding, 'settings': config}, ingress=Mock(return_value={'reply': 'A'}))
        b = Obj(state={'binding': dict(binding) if duplicate else
            {'tenant': 'fixture-native', 'application': 'fixture-app-B'}, 'settings': config},
            ingress=Mock(return_value={'reply': 'B'}))
        registry = object.__new__(station.Registry)
        registry.lock = threading.RLock(); registry.users = {'owner-A': a, 'owner-B': b}
        registry.policy = Obj(state={'settings': config}); registry.pair_fail = {}
        return registry, a, b

    def test_station_selects_the_saved_owner_not_a_supplied_owner_field(self):
        registry, a, b = self.registry()
        value = registry.ingress({'tenant': 'fixture-native', 'application': 'fixture-app-A',
            'owner': 'owner-B', 'op': 'before', 'command': 'за октябрь 2026'})
        self.assertEqual(value, {'reply': 'A'}); a.ingress.assert_called_once(); b.ingress.assert_not_called()

    def test_ambiguous_saved_station_bindings_are_denied(self):
        registry, a, b = self.registry(duplicate=True)
        value = registry.ingress({'tenant': 'fixture-native', 'application': 'fixture-app-A',
            'op': 'before', 'command': 'за октябрь 2026'})
        self.assertEqual(value, {'error': 'ambiguous_station_binding'})
        a.ingress.assert_not_called(); b.ingress.assert_not_called()

    def test_unknown_application_does_not_acquire_a_cabinet_owner(self):
        registry, a, b = self.registry()
        value = registry.ingress({'tenant': 'fixture-native', 'application': 'unknown-application',
            'op': 'before', 'command': 'за октябрь 2026'})
        self.assertEqual(value, {'command': 'за октябрь 2026'})
        a.ingress.assert_not_called(); b.ingress.assert_not_called()

    def test_valid_legacy_token_is_rejected_by_actual_new_oauth_validator(self):
        self.assertTrue(station.token_active('fixture-native', self.hash))
        valid, _ = oauth.server().verify_request('https://alisa.octoport.ru/alice/oauth/token',
            http_method='POST', headers={'Authorization': 'Bearer ' + self.legacy_token}, scopes=['reports:read'])
        self.assertFalse(valid)
        self.deny('AUTH_REQUIRED', lambda: platform_authority.AlicePrincipal(self.legacy_token).current())

    def test_changing_token_format_does_not_create_a_platform_oauth_family(self):
        value = 'as6_synthetic-legacy-row-only'
        digest = hashlib.sha256(value.encode()).hexdigest()
        with sqlite3.connect(self.db) as c:
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,0)',
                (digest, 'fixture-native', 'access', time.time() + 3600))
        self.assertTrue(station.token_active('fixture-native', digest))
        manager = Mock(); manager.select_related.return_value.filter.return_value.first.return_value = None
        with patch.object(oauth, 'TokenFamily', Obj(objects=manager)):
            valid, _ = oauth.server().verify_request('https://alisa.octoport.ru/alice/oauth/token',
                http_method='POST', headers={'Authorization': 'Bearer ' + value}, scopes=['reports:read'])
        self.assertFalse(valid); manager.select_related.assert_called_once()

    def platform_gate(self, ledger, state):
        actor = Obj(is_active=True)
        managers = {name: Mock() for name in ['Customer', 'Tenant', 'Membership', 'AccessLedger']}
        managers['Customer'].select_for_update.return_value.filter.return_value.first.return_value = actor
        managers['Tenant'].select_for_update.return_value.filter.return_value.exists.return_value = True
        managers['Membership'].filter.return_value.exists.return_value = True
        managers['AccessLedger'].select_for_update.return_value.filter.return_value.exists.return_value = ledger
        resolver = Mock()
        bindings = platform_authority.BindingFile(str(Path(self.folder.name) / 'unused-bindings.json'))
        authority = platform_authority.RuntimeAuthority(
            bindings, service_id='synthetic', catalog_release_id='synthetic')
        with ExitStack() as stack:
            stack.enter_context(patch.object(bindings, 'for_tenant', resolver))
            for name, manager in managers.items():
                stack.enter_context(patch.object(platform_authority, name, Obj(objects=manager)))
            snapshot = stack.enter_context(patch.object(platform_authority, 'access_snapshot',
                return_value={'status': state, 'active_until': None}))
            self.deny('ACCESS_REQUIRED', lambda: platform_authority.RuntimeAuthority.state.__wrapped__(
                authority, '11111111-1111-4111-8111-111111111111',
                '22222222-2222-4222-8222-222222222222', ['33333333-3333-4333-8333-333333333333']))
            if not ledger: snapshot.assert_not_called()
        resolver.assert_not_called()

    def test_exact_owner_and_membership_do_not_replace_the_required_ledger(self):
        self.platform_gate(False, 'NOT_PROVISIONED')

    def test_existing_ledger_without_an_active_period_does_not_grant_new_authority(self):
        self.platform_gate(True, 'NOT_PROVISIONED')

    def test_station_identity_is_not_a_signed_runtimeport_context(self):
        peer = Obj(service_id='synthetic')
        port = Obj(_peer=Mock(), authority=Obj(verify=Mock()), repo=Obj(clock=lambda: time.time()))
        legacy = {'tenant': 'fixture-native', 'application': 'fixture-app-A', 'token_hash': self.hash}
        self.deny('VALIDATION_FAILED', lambda: RuntimePort._auth(port, legacy, peer, 'submit'), Rejected)
        port.authority.verify.assert_not_called()

    def test_an_empty_runtime_guard_is_not_an_authority_proof(self):
        port = Obj(versions={'catalog_bundle_hash': 'synthetic'}, _resolve=Mock())
        self.deny('CATALOG_INCOMPATIBLE', lambda: RuntimePort.scope_for(port, {}), Rejected)
        port._resolve.assert_not_called()

    def test_clarification_reauth_failure_precedes_receipt_lookup_or_job_changes(self):
        port = Obj(_auth=Mock(side_effect=Rejected('AUTH_REQUIRED')), repo=Obj(connection=Mock()))
        task = {'context': {}, 'logical_query_id': 'synthetic-query', 'request_id': 'synthetic-request',
            'query_input': {'kind': 'clarification', 'text': 'за октябрь 2026',
                'job_ref': 'synthetic-ref', 'expected_revision': 'a' * 64}}
        self.deny('AUTH_REQUIRED', lambda: continue_task(port, task, Obj()), Rejected)
        port.repo.connection.assert_not_called()


suite = (unittest.TestSuite(ExistingAuthorizationCompatibility(name) for name in args.only)
         if args.only else unittest.defaultTestLoader.loadTestsFromTestCase(ExistingAuthorizationCompatibility))
selected_tests = [test._testMethodName for test in suite]
result = unittest.TextTestRunner(verbosity=2).run(suite)
verify_sources()
isolation.close()
report = {'scope': 'CURRENT_AUTHORIZATION_BOUNDARIES_SYNTHETIC_SQLITE_AND_MODEL_DOUBLES',
    'status': 'PASS' if result.wasSuccessful() and not result.skipped and not network_attempts else 'FAILED',
    'tests_run': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
    'selected_tests': selected_tests,
    'skipped': len(result.skipped), 'network_attempts': len(network_attempts),
    'test_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'station_manifest_sha256': 'c4f389e45398ff933ae4d3dd86c8bab8dba0802b039accc8381e37e6f027a53d',
    'native_manifest_sha256': hashlib.sha256((NATIVE / 'manifest.json').read_bytes()).hexdigest(),
    'source_files_unchanged': True, 'django_database_connections': 0,
    'live_data_or_credentials_loaded': False, 'product_security_code_changed': False,
    'compatibility_adapter_implemented': False, 'live_owner': 'NOT_PERFORMED'}
(ROOT / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
raise SystemExit(0 if report['status'] == 'PASS' else 1)
