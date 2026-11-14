"""Exercise the new overlay in CI; never modify the frozen native input."""
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
EXTENSION = ROOT / 'legacy_voice_clarification'
FROZEN = ROOT.parents[2] / 'docs/alisa/runtime/v0.11/rt_job_r02'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class VoiceOverlay(unittest.TestCase):
    def test_existing_station_authorization_and_platform_clarifications_together(self):
        old_manifest = (FROZEN / 'CURRENT_CORE_MANIFEST.json').read_bytes()
        base = load('voice_clarification_base', ROOT / 'template_clarification/build_overlay.py')
        extension = load('voice_clarification_extension', EXTENSION / 'build_overlay.py')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            native = base.build(FROZEN, root / 'native')
            fixture = EXTENSION / 'station_base'
            manifest = json.loads((fixture / 'SOURCE.json').read_text())
            for name, digest in manifest['files'].items():
                self.assertEqual(hashlib.sha256((fixture / name).read_bytes()).hexdigest(), digest)
            station = root / 'station'; shutil.copytree(fixture, station)
            for directory, changes in ((native, extension.native_sources(native)),
                                       (station, extension.station_sources(station))):
                for name, source in changes.items():
                    (directory / name).write_text(source)
            shutil.copyfile(EXTENSION / 'checks.py', native / 'tests/test_legacy_voice_clarification.py')
            environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1',
                PYTHONPATH=os.pathsep.join(map(str, [native, native / 'tests', station])),
                TEST_STATION_SOURCE=str(station))
            script = '''import socket,sys,unittest
from unittest.mock import patch
connect=socket.socket.connect
def confined(stream,address):
    if stream.family!=socket.AF_UNIX:raise AssertionError('External network forbidden')
    return connect(stream,address)
def no_dns(*a,**kw):raise AssertionError('DNS forbidden')
with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',no_dns):
    suite=unittest.defaultTestLoader.loadTestsFromNames(['test_legacy_voice_clarification','test_template_clarification_extension'])
    result=unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
'''
            result = subprocess.run([sys.executable, '-B', '-c', script],
                cwd=native, env=environment, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-6500:])
            self.assertIn('Ran 47 tests', result.stderr)
        self.assertEqual((FROZEN / 'CURRENT_CORE_MANIFEST.json').read_bytes(), old_manifest)


if __name__ == '__main__':
    unittest.main()
