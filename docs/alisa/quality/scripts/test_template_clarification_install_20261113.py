"""Filesystem, migration ordering and rollback boundaries; no actual services/DB."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('clarify_install', Path(__file__).with_name('install_template_clarification_20261113.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class InstallChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        r = Path(self.temp.name); self.r = r
        self.operator = r / 'operator'; self.operator.mkdir(); self.payload = r / 'payload'; self.payload.mkdir()
        paths = {'ROOT': self.operator, 'PAYLOAD': self.payload, 'BASE': r / 'base', 'APP': r / 'app',
            'NATIVE_BASE': r / 'native-base', 'NATIVE': r / 'native-new', 'CURRENT': r / 'native-current',
            'WEB_BASE': r / 'web-base', 'WEB_APP': r / 'web-new', 'WEB': r / 'web-current',
            'WEB_VENV': r / 'web-dependencies', 'VERSIONS': r / 'versions', 'PROJECTION': r / 'projection',
            'LINK_ENV': r / 'unchanged-env', 'SELECTORS': [r / ('selector-' + str(i)) for i in range(3)]}
        for name, value in paths.items():
            p = patch.object(m, name, value); p.start(); self.addCleanup(p.stop)
        for p in [m.BASE, m.NATIVE_BASE, m.WEB_BASE, m.WEB_VENV]: p.mkdir()
        (m.BASE / '.venv').mkdir(); (m.CURRENT).symlink_to(m.NATIVE_BASE); m.WEB.symlink_to(m.WEB_BASE)
        (m.WEB_BASE / '.venv').symlink_to(m.WEB_VENV)
        for p in m.SELECTORS: p.write_text('WorkingDirectory=' + str(m.BASE))
        for p in [m.VERSIONS, m.PROJECTION, m.LINK_ENV]: p.write_bytes(b'old ' + p.name.encode())
        self.oldbytes = {p: p.read_bytes() for p in m.SELECTORS + [m.VERSIONS, m.PROJECTION, m.LINK_ENV]}
        self.old = []
        for root, content in [(m.BASE, {'services/platform/src/unchanged.py': b'old source'}),
                (m.NATIVE_BASE, {'preserved.py': b'parallel native', 'runtime_port.py': b'old port'}),
                (m.WEB_BASE, {'ui/web/apps/web/server.js': b'old web', 'infra/launch.py': b'launch',
                              'ui/web/obsolete.js': b'old chunk'})]:
            for n, b in content.items():
                p = root / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b)
            v = {'files': {n: hashlib.sha256(b).hexdigest() for n, b in content.items()}, 'links': {},
                'locks': {'dependencies': 'unchanged'}, 'migrations': {}, 'schema_compatibility': {},
                'source_commit': 'parallel', 'source_sha': 'old'}
            (root / 'manifest.json').write_text(json.dumps(v)); self.old.append(v)
        platform_names = ['services/platform/src/alisa_platform/' + n for n in ['queries/models.py',
            'queries/service.py', 'queries/views.py', 'queries/voice.py', 'queries/voice_dialogue.py',
            'queries/migrations/0004_query_continuation.py', 'runtime_adapter/job_client.py']]
        native_names = ['template_clarification.py', 'tests/test_template_clarification_extension.py',
            'template_runtime.py', 'template_protocol.py', 'runtime_port.py', 'runtime_port_ipc.py',
            'repository.py', 'query_gap_terminal.py', 'tests/test_retention.py', 'tests/test_request_reliability.py']
        def payload(kind, names):
            values = {}
            for n in names:
                p = self.payload / kind / n; p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(('qualified ' + n).encode()); values[n] = m.sha(p)
            return values
        pf = payload('platform', platform_names); nf = payload('native', native_names)
        wf = payload('web', ['ui/web/apps/web/server.js', 'infra/launch.py'])
        core = {'files': {**self.old[1]['files'], **nf}}
        p = self.payload / 'native/CURRENT_CORE_MANIFEST.json'; p.write_text(json.dumps(core))
        patcher = patch.object(m, 'CORE_SHA', m.sha(p)); patcher.start(); self.addCleanup(patcher.stop)
        self.value = {'source': m.SOURCE, 'platform_files': pf, 'native_files': nf,
            'native_core_manifest': m.CORE_SHA,
            'web_manifest': {'artifact_id': m.WEB_APP.name, 'source_sha': m.SOURCE, 'files': wf,
                             'links': {}, 'locks': self.old[2]['locks']},
            'package_manifest': {'source_sha': m.SOURCE, 'files': {**pf, **wf}, 'links': {}},
            'payload': {str(p.relative_to(self.payload)): m.sha(p) for p in self.payload.rglob('*') if p.is_file()}}
        (self.operator / 'migrate.py').write_text('fixture migration'); self.value['migration_helper'] = m.sha(self.operator / 'migrate.py')
        (self.operator / 'pair_helpers.py').write_text('fixture pair')
        patcher = patch.object(m, 'PAIR_SHA', m.sha(self.operator / 'pair_helpers.py')); patcher.start(); self.addCleanup(patcher.stop)
        (self.operator / 'PLAN.json').write_text(json.dumps(self.value))
        for p in [patch.object(m, 'base_check', return_value=self.old), patch.object(m, 'reserve'),
                  patch.object(m, 'prop', side_effect=lambda u, k: 'active' if k == 'ActiveState' else 'same')]:
            p.start(); self.addCleanup(p.stop)

    def test_exact_deltas_preserve_all_three_bases_and_shared_dependencies(self):
        self.assertEqual(m.plan(), self.value); m.prepare(self.value)
        self.assertEqual((m.APP / 'services/platform/src/unchanged.py').stat().st_ino,
                         (m.BASE / 'services/platform/src/unchanged.py').stat().st_ino)
        self.assertEqual((m.NATIVE / 'preserved.py').read_bytes(), b'parallel native')
        self.assertEqual((m.APP / '.venv').resolve(), m.BASE / '.venv')
        self.assertEqual((m.WEB_APP / '.venv').resolve(), m.WEB_VENV)
        self.assertFalse((m.WEB_APP / 'ui/web/obsolete.js').exists())
        self.assertEqual(m.CURRENT.resolve(), m.NATIVE_BASE); self.assertEqual(m.WEB.resolve(), m.WEB_BASE)

    def test_corrupt_untouched_native_manifest_is_rejected_before_copy(self):
        p = self.payload / 'native/CURRENT_CORE_MANIFEST.json'; d = json.loads(p.read_text())
        d['files']['preserved.py'] = '0' * 64; p.write_text(json.dumps(d))
        with patch.object(m, 'CORE_SHA', m.sha(p)):
            with self.assertRaisesRegex(RuntimeError, 'NATIVE_UNTOUCHED_FILES_CHANGED'): m.prepare(self.value)
        self.assertFalse(m.APP.exists()); self.assertFalse(m.NATIVE.exists())

    def test_reserve_refusal_creates_no_candidates(self):
        with patch.object(m, 'reserve', side_effect=RuntimeError('RESOURCE_RESERVE')):
            with self.assertRaisesRegex(RuntimeError, 'RESOURCE_RESERVE'): m.prepare(self.value)
        self.assertFalse(m.APP.exists()); self.assertFalse(m.NATIVE.exists()); self.assertFalse(m.WEB_APP.exists())

    def test_late_base_change_removes_only_own_inactive_candidates(self):
        with patch.object(m, 'base_check', side_effect=[self.old, RuntimeError('BASE_MOVED')]):
            with self.assertRaisesRegex(RuntimeError, 'BASE_MOVED'): m.prepare(self.value)
        self.assertFalse(m.APP.exists()); self.assertTrue(m.BASE.exists()); self.assertTrue(m.NATIVE_BASE.exists())

    def test_changed_candidate_is_refused_before_database_preflight(self):
        m.prepare(self.value); (m.APP / 'services/platform/src/unchanged.py').unlink()
        (m.APP / 'services/platform/src/unchanged.py').write_text('changed candidate')
        with patch.object(m, 'migration') as migration:
            with self.assertRaisesRegex(RuntimeError, 'SOURCE_HASH'): m.check(self.value)
        migration.assert_not_called()

    def fake_pair(self):
        def sync(root, lock): m.VERSIONS.write_bytes(b'new versions' if root == m.NATIVE else self.oldbytes[m.VERSIONS])
        def refresh(original, on_write=None):
            raw = b'new projection' if m.CURRENT.resolve() == m.NATIVE else self.oldbytes[m.PROJECTION]
            m.PROJECTION.write_bytes(raw)
            if on_write: on_write(raw)
        return SimpleNamespace(projection_data=lambda: {'generation': 'original'},
            expected_version_bytes=lambda root: b'new versions', sync=sync, refresh_projection=refresh)

    def test_health_failure_restores_all_owned_selectors_and_keeps_additive_column(self):
        m.prepare(self.value); saved = json.loads((self.operator / 'SELECTORS.json').read_text())
        with patch.object(m, 'pair', return_value=self.fake_pair()), patch.object(m, 'run'), \
                patch.object(m, 'migration') as migration, patch.object(m, 'ready', side_effect=[RuntimeError('failed'), None]):
            with self.assertRaisesRegex(RuntimeError, 'failed'): m.activate(self.value, saved, object())
        migration.assert_called_once_with(True)
        self.assertEqual(m.CURRENT.resolve(), m.NATIVE_BASE); self.assertEqual(m.WEB.resolve(), m.WEB_BASE)
        self.assertTrue(all(p.read_bytes() == b for p, b in self.oldbytes.items()))
        receipt = json.loads((self.operator / 'ROLLED_BACK.json').read_text())
        self.assertEqual(receipt['status'], 'ROLLED_BACK'); self.assertTrue(receipt['additive_column_and_default_retained'])

    def test_migration_failure_leaves_pointers_and_selectors_unchanged(self):
        m.prepare(self.value); saved = json.loads((self.operator / 'SELECTORS.json').read_text())
        with patch.object(m, 'pair', return_value=self.fake_pair()), patch.object(m, 'run') as run, \
                patch.object(m, 'migration', side_effect=RuntimeError('migration failed')):
            with self.assertRaisesRegex(RuntimeError, 'migration failed'): m.activate(self.value, saved, object())
        run.assert_not_called(); self.assertTrue(all(p.read_bytes() == b for p, b in self.oldbytes.items()))
        self.assertEqual(m.CURRENT.resolve(), m.NATIVE_BASE)

    def test_later_native_writer_is_never_overwritten_by_rollback(self):
        m.prepare(self.value); saved = json.loads((self.operator / 'SELECTORS.json').read_text())
        later = self.r / 'later-native'; later.mkdir()
        def fail(*args): m.pointer(m.CURRENT, later); raise RuntimeError('failed')
        with patch.object(m, 'pair', return_value=self.fake_pair()), patch.object(m, 'run'), \
                patch.object(m, 'migration'), patch.object(m, 'ready', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_LATER_SELECTOR'): m.activate(self.value, saved, object())
        self.assertEqual(m.CURRENT.resolve(), later)


if __name__ == '__main__': unittest.main()
