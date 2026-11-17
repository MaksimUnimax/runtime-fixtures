"""Disposable release copies and process/invocation readback; no systemd calls."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

def load():
    p=Path(__file__).with_name('install_diagnostics.py')
    with patch.dict('sys.modules',{'activate':SimpleNamespace()}):
        spec=importlib.util.spec_from_file_location('diagnostic_install_fixture',p)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

class InstallationBoundaries(unittest.TestCase):
    def setUp(self):
        self.m=load()
        self.m.healthy=lambda:True
        self.m.prop=lambda unit,key:str(os.getpid())if key=='MainPID'else'active'
        self.expected={'command':{'path':'pinned','argv':'pinned'},'source_hashes':{'fixture':'pinned'}}
        self.m.a.unit_static=lambda _:self.expected

    def test_ready_requires_current_process_cwd_and_full_invocation(self):
        self.m.ready(Path.cwd().resolve(),self.expected)

    def test_healthy_foreign_invocation_is_not_ready(self):
        with patch.object(self.m.time,'monotonic',side_effect=[0,20]):
            with self.assertRaisesRegex(RuntimeError,'PROCESS_INVOCATION_CHANGED'):
                self.m.ready(Path.cwd().resolve(),{'command':'different'})

    def test_healthy_wrong_process_directory_is_not_ready(self):
        with patch.object(self.m.time,'monotonic',side_effect=[0,20]):
            with self.assertRaisesRegex(RuntimeError,'PROCESS_SOURCE_CHANGED'):
                self.m.ready(Path('/nonexistent-synthetic-release'),self.expected)

    def test_partial_preparation_paths_do_not_collide_with_a_new_attempt(self):
        other=load()
        self.assertNotEqual(self.m.NEW_BASE,other.NEW_BASE)
        self.assertNotEqual(self.m.NEW_ENTRY,other.NEW_ENTRY)
        self.assertNotEqual(self.m.ATTEMPT,other.ATTEMPT)

    def test_copy_preserves_old_sources_and_unrelated_role_targets(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);old=root/'old';entry=root/'old-entry';old.mkdir();entry.mkdir()
            (old/'alice_lab.py').write_bytes(b'old code\n')
            (old/'README.md').write_text('unchanged')
            (old/'manifest.json').write_text('old manifest')
            targets={'alice-lab-web':{'target':'old','sha256':'old','mode':'serve','argv':['old']},
                     'alice-lab-worker':{'target':'preserved-worker','mode':'worker'}}
            (entry/'targets.json').write_text(json.dumps(targets))
            (entry/'lab_entry.py').write_text('unchanged launcher')
            (entry/'deepseek_lab.py').write_text('unchanged adapter')
            self.m.NEW_BASE=root/'new';self.m.NEW_ENTRY=root/'new-entry';self.m.SOURCE=root/'candidate.py'
            self.m.SOURCE.write_text('new diagnostic source')
            self.m.SOURCE_SHA=self.m.sha(self.m.SOURCE.read_bytes())
            def write_new(p,raw,mode=0o600):
                with p.open('xb')as f:f.write(raw)
                p.chmod(mode)
            self.m.a.write_new=write_new
            baseline={'base':{'root':str(old),'files':self.m.files(old)},
                      'entry':{'root':str(entry),'files':self.m.files(entry)}}
            before={str(p):p.read_bytes()for p in [*old.iterdir(),*entry.iterdir()]}
            try:
                self.m.prepare(baseline)
                self.assertEqual({p:Path(p).read_bytes()for p in before},before)
                actual=json.loads((self.m.NEW_ENTRY/'targets.json').read_text())
                self.assertEqual(actual['alice-lab-worker'],targets['alice-lab-worker'])
                self.assertEqual((self.m.NEW_ENTRY/'deepseek_lab.py').read_text(),'unchanged adapter')
                self.assertEqual((self.m.NEW_BASE/'alice_lab.py').read_bytes(),self.m.SOURCE.read_bytes())
                self.assertEqual(self.m.NEW_BASE.stat().st_mode&0o222,0)
            finally:
                for p in root.rglob('*'):
                    if p.is_dir():p.chmod(0o700)

if __name__=='__main__':unittest.main()
