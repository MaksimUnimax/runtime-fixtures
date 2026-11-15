"""Disposable file/model doubles only. Never imports Django or connects to a DB."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
import importlib.util
import json
import os
import tempfile

PATH = Path(__file__).resolve().parents[1]/'preflight.py'
SPEC = importlib.util.spec_from_file_location('bounded_owner_preflight', PATH)
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)

QID = '11111111-1111-1111-1111-111111111111'
TID = '22222222-2222-2222-2222-222222222222'
CID = '33333333-3333-3333-3333-333333333333'
SID = '44444444-4444-4444-4444-444444444444'
CATALOG = {'fields': {name: {} for name in p.OWNER_FIELDS}}
CATALOG_HASH = sha256(json.dumps(CATALOG, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Selected:
    def __init__(self, name, rows, filters, calls):
        self.name, self.rows, self.filters, self.calls = name, rows, filters, calls
        self.exclusions = {}

    def exclude(self, **kwargs):
        self.exclusions.update(kwargs)
        return self

    def values(self, *fields):
        if not fields or tuple(fields) not in p.PROJECTIONS.values():
            raise AssertionError('UNDECLARED_PROJECTION')
        self.fields = fields
        return self

    def __getitem__(self, limit):
        if limit != slice(None, 2):
            raise AssertionError('UNBOUNDED_SELECT')
        self.calls.append((self.name, deepcopy(self.filters), deepcopy(self.exclusions), self.fields))
        def matches(row):
            for field, value in self.filters.items():
                if field.endswith('__isnull'):
                    if (row.get(field[:-8]) is None) != value: return False
                elif row.get('id' if field == 'pk' else field) != value:
                    return False
            return not any(row.get(key) == value for key, value in self.exclusions.items())
        return [{key: row[key] for key in self.fields} for row in self.rows if matches(row)][:2]


class Manager:
    def __init__(self, name, rows, calls):
        self.name, self.rows, self.calls = name, rows, calls

    def filter(self, **kwargs):
        return Selected(self.name, self.rows, kwargs, self.calls)


class Preflight(TestCase):
    def fixture(self):
        tables = {
            'Query': [{'id': QID, 'tenant_id': TID, 'customer_id': CID, 'store_ids': [SID],
                       'channel': 'WEB', 'continuation': 'NEVER_READ_QUERY_STATE'}],
            'Store': [{'id': SID, 'tenant_id': TID, 'product_id': p.PRODUCT, 'provider': 'OZON',
                       'status': 'ACTIVE', 'verified_identity': 'NEVER_PRINT_PROVIDER_ID'}],
            'Customer': [{'id': CID, 'is_active': True, 'security_revision': 7,
                          'email': 'NEVER_PRINT_EMAIL', 'token': 'NEVER_READ_TOKEN'}],
            'Membership': [{'tenant_id': TID, 'customer_id': CID, 'role': 'OWNER_CLIENT'}],
            'CredentialRevision': [{'tenant_id': TID, 'store_id': SID, 'product_id': p.PRODUCT,
                'kind': kind, 'status': 'ACTIVE', 'check_code': 'CONNECTED', 'secret': 'NEVER_READ_SECRET'}
                for kind in ('SELLER', 'PERFORMANCE')],
            'OwnerDataset': [{'tenant_id': TID, 'store_id': SID, 'product_id': p.PRODUCT,
                'status': 'APPROVED', 'approval_id': QID, 'approved_by_id': CID,
                'approved_security_revision': 7, 'approved_at': object(), 'catalog_hash': CATALOG_HASH,
                'facts': 'NEVER_READ_FACTS', 'content_hash': 'NEVER_READ_CONTENT'}],
        }
        calls = []
        models = SimpleNamespace(**{name: SimpleNamespace(objects=Manager(name, rows, calls))
                                  for name, rows in tables.items()})
        return tables, models, calls

    def test_anchor_is_pinned_regular_file_and_returns_only_one_fixed_pointer(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'receipt.json'
            raw = json.dumps({'finance': {'query_id': QID, 'value_rub': 'NEVER_PRINT'},
                              'other_query': CID}).encode()
            path.write_bytes(raw); path.chmod(0o600)
            self.assertEqual(p._anchor(path, sha256(raw).hexdigest(), owner_uid=os.getuid()), QID)
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_MOVED'):
                p._anchor(path, '0'*64, owner_uid=os.getuid())
            link = Path(folder)/'link'; link.symlink_to(path)
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_FILE_UNSAFE'):
                p._anchor(link, sha256(raw).hexdigest(), owner_uid=os.getuid())
            path.chmod(0o666)
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_FILE_UNSAFE'):
                p._anchor(path, sha256(raw).hexdigest(), owner_uid=os.getuid())

    def test_anchor_does_not_fall_back_to_another_identifier(self):
        for value in ({'finance': {}, 'query_id': QID}, {'finance': {'query_id': [QID]}},
                      {'finance': {'query_id': 'not-a-uuid'}}):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as folder:
                path = Path(folder)/'receipt.json'; raw = json.dumps(value).encode()
                path.write_bytes(raw); path.chmod(0o600)
                with self.assertRaises(p.Blocked): p._anchor(path, sha256(raw).hexdigest(), owner_uid=os.getuid())

    def test_pinned_manifest_has_explicit_one_mib_limit_without_changing_default(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'manifest.json'
            raw = b'{"artifact_id":"disposable","files":{}}'.ljust(984658, b' ')
            path.write_bytes(raw); path.chmod(0o644)
            digest = sha256(raw).hexdigest()
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_FILE_UNSAFE'):
                p._regular(path, digest, owner_uid=os.getuid())
            self.assertEqual(p._regular(path, digest, owner_uid=os.getuid(), maximum=1048576), raw)
            self.assertEqual(json.loads(raw)['artifact_id'], 'disposable')
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_MOVED'):
                p._regular(path, '0'*64, owner_uid=os.getuid(), maximum=1048576)
            raw = b' ' * 1048577
            path.write_bytes(raw)
            with self.assertRaisesRegex(p.Blocked, 'SOURCE_FILE_UNSAFE'):
                p._regular(path, sha256(raw).hexdigest(), owner_uid=os.getuid(), maximum=1048576)

    def test_setup_source_hashes_and_absent_app_or_model_packages_are_checked_before_setup(self):
        with tempfile.TemporaryDirectory() as folder:
            here = Path(folder); root = here/'release'; root.mkdir()
            (root/'.venv').mkdir()
            ordinary = b'VALUE = 1\n'; setup = b'"""Definitions only."""\n'
            (root/'settings.py').write_bytes(ordinary); (root/'models.py').write_bytes(setup)
            sources = {'settings.py': sha256(ordinary).hexdigest()}
            imports = {'models.py': sha256(setup).hexdigest()}
            manifest = json.dumps({'artifact_id': 'disposable', 'files': {**sources, **imports}}).encode()
            manifest = manifest.ljust(984658, b' ')
            (root/'manifest.json').write_bytes(manifest)
            context = {'schema': 'alisa-owner-metadata-source/v1', 'properties': {}, 'source_stats': {},
                       'release_root': str(root), 'venv_root': str(root/'.venv'), 'artifact_id': 'disposable',
                       'manifest_sha256': sha256(manifest).hexdigest(), 'source_files': sources,
                       'setup_source_files': imports, 'setup_absent_paths': ['apps.py', 'apps', 'models']}
            raw = json.dumps(context).encode(); (here/'source_context.json').write_bytes(raw)
            read_regular = p._regular
            def local_regular(path, expected=None, **kwargs):
                return read_regular(path, expected, owner_uid=os.getuid(), **kwargs)
            with patch.object(p, 'HERE', here), patch.object(p, 'SOURCE_SHA256', sha256(raw).hexdigest()), \
                 patch.object(p, '_regular', side_effect=local_regular):
                self.assertEqual(p._source(), context)
                (root/'models.py').write_bytes(b'CHANGED = True\n')
                with self.assertRaisesRegex(p.Blocked, '^SOURCE_MOVED$'): p._source()
                (root/'models.py').write_bytes(setup)
                for name in ('apps.py', 'apps', 'models'):
                    with self.subTest(unexpected=name):
                        path = root/name
                        if name.endswith('.py'): path.write_text('raise RuntimeError("MUST_NOT_IMPORT")\n')
                        else: path.mkdir()
                        with self.assertRaisesRegex(p.Blocked, '^SETUP_SOURCE_MOVED$'): p._source()
                        if path.is_dir(): path.rmdir()
                        else: path.unlink()
                (root/'apps.py').symlink_to(root/'absent-target')
                with self.assertRaisesRegex(p.Blocked, '^SETUP_SOURCE_MOVED$'): p._source()

    def test_exact_target_scope_and_explicit_projections_leave_no_values_in_output(self):
        _, models, calls = self.fixture(); result = p._metadata(models, QID, CATALOG)
        self.assertTrue(result['metadata_compatible']); self.assertEqual(result['profile_coverage'], 'NOT_CHECKED')
        self.assertFalse(result['execution_authorized'])
        self.assertEqual(len(calls), 8)
        self.assertEqual(calls[0], ('Query', {'pk': QID, 'channel': 'WEB'}, {}, p.PROJECTIONS['Query']))
        for name, filters, excluded, fields in calls:
            self.assertNotIn('facts', fields); self.assertNotIn('continuation', fields)
            self.assertNotIn('email', fields); self.assertNotIn('secret', fields)
            if name in ('CredentialRevision', 'OwnerDataset'):
                self.assertEqual({key: filters[key] for key in ('product_id', 'tenant_id', 'store_id')},
                                 {'product_id': p.PRODUCT, 'tenant_id': TID, 'store_id': SID})
            if name == 'Store':
                self.assertEqual({key: filters[key] for key in ('pk', 'tenant_id', 'product_id', 'provider')},
                                 {'pk': SID, 'tenant_id': TID, 'product_id': p.PRODUCT, 'provider': 'OZON'})
        encoded = json.dumps(result)
        for forbidden in (QID, TID, CID, SID, 'NEVER_', 'value_rub'):
            self.assertNotIn(forbidden, encoded)

    def test_stat_identity_strings_preserve_above_2_to_53_and_reject_one_ns_drift(self):
        info = SimpleNamespace(st_dev=64769, st_ino=9007199254740993, st_mode=33152,
                               st_uid=0, st_gid=0, st_size=31,
                               st_mtime_ns=1794187615257088574, st_ctime_ns=1794187615259088532)
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        row = [str(getattr(info, field)) for field in fields]
        context = {'schema': 'alisa-owner-metadata-source/v1', 'properties': {},
                   'source_stats': {'/disposable/runtime.env': row},
                   'release_root': '/disposable/release', 'venv_root': '/disposable/venv',
                   'artifact_id': 'disposable', 'manifest_sha256': 'synthetic',
                   'source_files': {}, 'setup_source_files': {}, 'setup_absent_paths': []}
        raw = json.dumps(context).encode()
        blobs = {'source_context.json': raw,
                 'manifest.json': json.dumps({'artifact_id': 'disposable', 'files': {}}).encode()}
        self.assertEqual(json.loads(raw)['source_stats']['/disposable/runtime.env'], row)
        self.assertEqual(row[1], '9007199254740993')
        def read_source(path, expected=None, **kwargs):
            return blobs[path.name]
        with patch.object(p, '_regular', side_effect=read_source), \
             patch.object(Path, 'lstat', return_value=info), \
             patch.object(Path, 'resolve', return_value=Path('/disposable/venv')):
            self.assertEqual(p._source(), context)
            for field in fields:
                with self.subTest(changed=field):
                    original = getattr(info, field)
                    if field.endswith('_ns'):
                        self.assertGreater(original, 2**53)
                        self.assertEqual(float(original), float(original+1))
                    setattr(info, field, original+1)
                    with self.assertRaisesRegex(p.Blocked, '^ENVIRONMENT_SOURCE_MOVED$'):
                        p._source()
                    setattr(info, field, original)

    def test_missing_or_multi_store_anchor_stops_before_other_model_reads(self):
        for stores in ([], [SID, CID]):
            tables, models, calls = self.fixture(); tables['Query'][0]['store_ids'] = stores
            with self.assertRaisesRegex(p.Blocked, 'SINGLE_STORE_REQUIRED'): p._metadata(models, QID, CATALOG)
            self.assertEqual([item[0] for item in calls], ['Query'])
        tables, models, calls = self.fixture(); tables['Query'][0]['channel'] = 'ALICE'
        with self.assertRaisesRegex(p.Blocked, 'ACCEPTED_QUERY_UNAVAILABLE'): p._metadata(models, QID, CATALOG)
        self.assertEqual([item[0] for item in calls], ['Query'])

    def test_cross_tenant_or_non_ozon_store_is_not_retargeted(self):
        for key, value in (('tenant_id', CID), ('provider', 'WB'), ('product_id', 'other')):
            tables, models, calls = self.fixture(); tables['Store'][0][key] = value
            with self.assertRaisesRegex(p.Blocked, 'ACCEPTED_STORE_UNAVAILABLE'): p._metadata(models, QID, CATALOG)
            self.assertEqual([item[0] for item in calls], ['Query', 'Store'])

    def test_strict_credentials_do_not_relabel_native_owner_or_echo_arbitrary_codes(self):
        for code, expected in (('CONNECTED_NATIVE_OWNER', 'CONNECTED_NATIVE_OWNER'),
                               ('SECRET_VALUE_OR_EMAIL', 'UNQUALIFIED')):
            tables, models, _ = self.fixture(); tables['CredentialRevision'][1]['check_code'] = code
            result = p._metadata(models, QID, CATALOG)
            self.assertFalse(result['metadata_compatible'])
            self.assertEqual(result['credentials']['PERFORMANCE'], expected)
            self.assertFalse(result['checks']['performance_strict_compatible'])
        self.assertEqual(p._credential([]), 'MISSING')
        self.assertEqual(p._credential([{'check_code': 'CONNECTED'}]*2), 'AMBIGUOUS')

    def test_changed_current_owner_scope_stops_before_identity_credentials_or_dataset(self):
        for table, key, value in (('Customer', 'is_active', False), ('Membership', 'role', 'VIEWER'),
                                  ('Store', 'status', 'DISABLED')):
            with self.subTest(table=table, key=key):
                tables, models, calls = self.fixture(); tables[table][0][key] = value
                with self.assertRaisesRegex(p.Blocked, '^CURRENT_OWNER_SCOPE_CHANGED$'):
                    p._metadata(models, QID, CATALOG)
                self.assertEqual([item[0] for item in calls], ['Query', 'Store', 'Customer', 'Membership'])
        for member_count in (0, 2):
            with self.subTest(member_count=member_count):
                tables, models, calls = self.fixture()
                tables['Membership'][:] = tables['Membership'] * member_count
                with self.assertRaisesRegex(p.Blocked, '^CURRENT_OWNER_SCOPE_CHANGED$'):
                    p._metadata(models, QID, CATALOG)
                self.assertEqual([item[0] for item in calls], ['Query', 'Store', 'Customer', 'Membership'])

    def test_approval_security_catalog_timestamp_and_identity_are_current_checks(self):
        cases = [('OwnerDataset', 'approved_by_id', TID), ('OwnerDataset', 'approved_security_revision', 8),
                 ('OwnerDataset', 'catalog_hash', 'different'), ('OwnerDataset', 'approval_id', None),
                 ('OwnerDataset', 'approved_at', None), ('OwnerDataset', 'status', 'REVOKED'),
                 ('Store', 'verified_identity', None)]
        for table, key, value in cases:
            with self.subTest(table=table, key=key):
                tables, models, _ = self.fixture(); tables[table][0][key] = value
                self.assertFalse(p._metadata(models, QID, CATALOG)['metadata_compatible'])
