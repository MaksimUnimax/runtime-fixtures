"""Real filesystem checks for the exact owned dependency replacement boundary."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dedup', Path(__file__).with_name('deduplicate_own_rollback_dependencies_20261113.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
real_consumers = m.consumers


class DedupChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name); self.base = root / 'base'; self.old = root / 'old'
        for r in [self.base, self.old]:
            p = r / '.venv'; (p / 'lib').mkdir(parents=True); (p / 'lib/module.py').write_text('retained bytes')
            (p / 'lib64').symlink_to('lib'); (r / 'manifest.json').write_text('immutable manifest')
        for name, value in [('BASE', self.base), ('OLD', {self.old: m.sha(self.old / 'manifest.json')})]:
            p = patch.object(m, name, value); p.start(); self.addCleanup(p.stop)
        for p in [patch.object(m, 'consumers', return_value=[]), patch.object(m, 'base_check'), patch.object(m, 'probe')]:
            p.start(); self.addCleanup(p.stop)

    def test_exact_copy_becomes_shared_without_changing_sources(self):
        before = (self.old / 'manifest.json').read_bytes(); expected = m.inventory(self.base / '.venv')
        m.share(self.old, expected)
        self.assertEqual((self.old / '.venv').resolve(), self.base / '.venv')
        self.assertEqual((self.old / '.venv/lib/module.py').read_text(), 'retained bytes')
        self.assertEqual((self.old / 'manifest.json').read_bytes(), before)
        self.assertFalse((self.old / '.venv.owned-dedup-old').exists())

    def test_different_dependency_is_rejected_before_rename(self):
        (self.old / '.venv/lib/module.py').write_text('different')
        with self.assertRaisesRegex(RuntimeError, 'DEPENDENCIES_DIFFER'): m.share(self.old, m.inventory(self.base / '.venv'))
        self.assertFalse((self.old / '.venv').is_symlink())

    def test_configured_or_live_consumer_prevents_mutation(self):
        with patch.object(m, 'consumers', return_value=['unit:preserved']):
            with self.assertRaisesRegex(RuntimeError, 'OLD_RELEASE_CONSUMER'): m.share(self.old, m.inventory(self.base / '.venv'))
        self.assertFalse((self.old / '.venv').is_symlink())

    def test_failed_interpreter_probe_restores_original_tree(self):
        with patch.object(m, 'probe', side_effect=RuntimeError('probe failed')):
            with self.assertRaisesRegex(RuntimeError, 'probe failed'): m.share(self.old, m.inventory(self.base / '.venv'))
        self.assertFalse((self.old / '.venv').is_symlink())
        self.assertEqual((self.old / '.venv/lib/module.py').read_text(), 'retained bytes')
        self.assertFalse((self.old / '.venv.owned-dedup-old').exists())

    def check_unloaded_service(self, unit):
        def systemctl(*args):
            if args[1] == 'list-units': return 'loaded.service loaded active running'
            if args[1] == 'list-unit-files': return unit + ' disabled'
            if args[1] in ['show', 'cat']:
                return 'WorkingDirectory=' + str(self.old) if args[2] == unit else ''
            self.fail('Unexpected systemctl operation')
        iterator = Path.iterdir
        with patch.object(m, 'command', side_effect=systemctl), \
                patch.object(Path, 'iterdir', lambda p: iter(()) if p == Path('/proc') else iterator(p)):
            self.assertEqual(real_consumers(self.old), ['unit:' + unit])

    def test_installed_but_unloaded_service_is_a_consumer(self):
        self.check_unloaded_service('unloaded.service')

    def test_uninstantiated_template_is_checked_without_loading_an_instance(self):
        self.check_unloaded_service('preserved@.service')


if __name__ == '__main__': unittest.main()
