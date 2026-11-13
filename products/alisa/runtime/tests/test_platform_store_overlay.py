"""Overlay checks protect the admitted native source and parallel edits."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('store_overlay_builder', ROOT / 'platform_stores/build_overlay.py')
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
FROZEN = ROOT.parents[2] / 'docs/alisa/runtime/v0.11/rt_job_r02'


class StoreOverlayChecks(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)

    def test_build_preserves_every_other_admitted_file_and_input(self):
        before = {str(p.relative_to(FROZEN)): p.read_bytes() for p in FROZEN.rglob('*')
                  if p.is_file() and '__pycache__' not in p.parts}
        result = builder.build(FROZEN, self.root / 'candidate')
        manifest = json.loads((result / 'CURRENT_CORE_MANIFEST.json').read_text())
        changed = set(builder.sources(FROZEN))
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((result / name).read_bytes()).hexdigest(), digest)
            if name not in changed: self.assertEqual((result / name).read_bytes(), before[name])
        for name, raw in before.items(): self.assertEqual((FROZEN / name).read_bytes(), raw)
        self.assertEqual(len(changed), 4)

    def source(self):
        target = self.root / 'source'; shutil.copytree(FROZEN, target)
        return target

    def test_moved_parallel_context_fails_without_candidate(self):
        source = self.source()
        file = source / 'report_archive.py'
        file.write_text(file.read_text().replace('def observe(', 'def moved_observe('))
        manifest = json.loads((source / 'CURRENT_CORE_MANIFEST.json').read_text())
        manifest['files']['report_archive.py'] = hashlib.sha256(file.read_bytes()).hexdigest()
        (source / 'CURRENT_CORE_MANIFEST.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'CONTEXT_MOVED'): builder.build(source, self.root / 'candidate')
        self.assertFalse((self.root / 'candidate').exists())

    def test_corrupted_base_is_denied(self):
        source = self.source(); (source / 'engine.py').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'BASE_HASH'): builder.build(source, self.root / 'candidate')

    def test_unmanifested_executable_is_denied(self):
        source = self.source(); (source / 'unexpected.py').write_text('pass')
        with self.assertRaisesRegex(ValueError, 'BASE_COVERAGE'): builder.build(source, self.root / 'candidate')

    def test_existing_destination_is_preserved(self):
        target = self.root / 'candidate'; target.mkdir(); (target / 'other').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'DESTINATION_EXISTS'): builder.build(FROZEN, target)
        self.assertEqual((target / 'other').read_text(), 'keep')

    def test_symlink_is_denied(self):
        source = self.source(); file = source / 'engine.py'
        raw = file.read_bytes(); file.unlink(); elsewhere = self.root / 'engine.py'; elsewhere.write_bytes(raw)
        file.symlink_to(elsewhere)
        with self.assertRaisesRegex(ValueError, 'BASE_HASH'): builder.build(source, self.root / 'candidate')


if __name__ == '__main__': unittest.main()
