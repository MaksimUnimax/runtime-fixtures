"""Build boundary and real native clarification regressions; immutable input."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT.parents[2] / 'docs/alisa/runtime/v0.11/rt_job_r02'
spec = importlib.util.spec_from_file_location('clarification_builder', ROOT / 'template_clarification/build_overlay.py')
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)


class ClarificationOverlayChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_overlay_preserves_both_frozen_input_and_store_extension(self):
        old = (FROZEN / 'CURRENT_CORE_MANIFEST.json').read_bytes()
        stores = builder.base.build(FROZEN, self.root / 'stores')
        result = builder.build(stores, self.root / 'result')
        manifest = json.loads((result / 'CURRENT_CORE_MANIFEST.json').read_text())
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((result / name).read_bytes()).hexdigest(), digest)
        self.assertEqual((result / 'platform_store_credentials.py').read_bytes(),
                         (stores / 'platform_store_credentials.py').read_bytes())
        self.assertEqual((FROZEN / 'CURRENT_CORE_MANIFEST.json').read_bytes(), old)
        self.assertEqual(manifest['template_clarification_overlay'], 'template-clarification-v1')

    def test_moved_hook_is_rejected_without_writing_candidate(self):
        source = self.root / 'source'; shutil.copytree(FROZEN, source)
        p = source / 'template_runtime.py'; p.write_text(p.read_text().replace(
            '# Validate the selected registered recipes locally.', '# A parallel hook moved.'))
        manifest = json.loads((source / 'CURRENT_CORE_MANIFEST.json').read_text())
        manifest['files']['template_runtime.py'] = hashlib.sha256(p.read_bytes()).hexdigest()
        (source / 'CURRENT_CORE_MANIFEST.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'CONTEXT_MOVED'):
            builder.build(source, self.root / 'candidate')
        self.assertFalse((self.root / 'candidate').exists())

    def test_native_lifecycle_uses_real_queue_port_and_journal(self):
        candidate = builder.build(FROZEN, self.root / 'candidate')
        environment = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(candidate), str(candidate / 'tests')]),
                       'PYTHONDONTWRITEBYTECODE': '1'}
        result = subprocess.run([sys.executable, '-m', 'unittest', 'test_template_clarification_extension', '-q'],
                                cwd=candidate, env=environment, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-6000:])
        self.assertIn('Ran 16 tests', result.stderr)

    def test_extended_native_keeps_the_existing_general_regression(self):
        candidate = builder.build(FROZEN, self.root / 'candidate')
        environment = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(candidate), str(candidate / 'tests')]),
                       'PYTHONDONTWRITEBYTECODE': '1'}
        script = '''import ipaddress,socket,sys,unittest
from unittest.mock import patch
connect=socket.socket.connect;resolve=socket.getaddrinfo
def allowed(host):
    if host=='localhost':return True
    try:return ipaddress.ip_address(host).is_loopback
    except ValueError:return False
def dns(host,*args,**kw):
    if not allowed(host):raise AssertionError('External DNS forbidden')
    return resolve(host,*args,**kw)
def confined(sock,address):
    if sock.family!=socket.AF_UNIX and not allowed(address[0]):raise AssertionError('External network forbidden')
    return connect(sock,address)
with patch('socket.getaddrinfo',dns),patch.object(socket.socket,'connect',confined):
    loader=unittest.TestLoader()
    suite=unittest.TestSuite([loader.discover('tests'),loader.loadTestsFromName('test_dataset_json_only'),loader.loadTestsFromName('test_dataset_pipeline')])
    result=unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if result.wasSuccessful() and not result.skipped and result.testsRun>=1900 else 1)
'''
        result = subprocess.run([sys.executable, '-c', script], cwd=candidate,
            env=environment, capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-8000:])


if __name__ == '__main__':
    unittest.main()
