"""Finite web deployment failure checks. No actual services, network or database."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('pages_install',Path(__file__).with_name('install_cabinet_store_pages_20261113.py'))
install=importlib.util.module_from_spec(spec);spec.loader.exec_module(install)


class WebRolloutChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.base=self.root/'base';self.base.mkdir()
        self.app=self.root/'candidate';self.web=self.root/'web-current';self.web.symlink_to(self.base)
        self.operator=self.root/'operator';self.operator.mkdir();(self.base/'.venv').mkdir()
        (self.base/'.venv'/'preserved').write_text('rollback dependency')
        self.files={'ui/web/apps/web/server.js':b'unchanged web entry','infra/launch.py':b'old launch',
                    'ui/web/obsolete.js':b'old build chunk'}
        for name,raw in self.files.items():
            p=self.base/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        self.old={'artifact_id':'base','source_sha':'old','locks':{'pnpm':'same'},
            'files':{n:hashlib.sha256(b).hexdigest()for n,b in self.files.items()},'links':{}}
        (self.base/'manifest.json').write_text(json.dumps(self.old))
        self.new={'artifact_id':self.app.name,'source_sha':install.SOURCE,'locks':self.old['locks'],
            'files':{n:h for n,h in self.old['files'].items()if n!='ui/web/obsolete.js'},'links':{}}
        self.raw=b'new launch';self.new['files']['infra/launch.py']=hashlib.sha256(self.raw).hexdigest()
        for name,value in [('ROOT',self.operator),('BASE',self.base),('APP',self.app),('WEB',self.web),
                ('BASE_MANIFEST',install.sha(self.base/'manifest.json'))]:
            p=patch.object(install,name,value);p.start();self.addCleanup(p.stop)
        def prop(unit,key):return 'active'if key=='ActiveState'else str(self.base)if key=='WorkingDirectory'else'100'
        for p in [patch.object(install,'prop',side_effect=prop),patch.object(install,'reserve')]:
            p.start();self.addCleanup(p.stop)
        self.archive()

    def archive(self,name='infra/launch.py'):
        path=self.operator/'web-delta.tar.gz'
        with tarfile.open(path,'w:gz')as z:
            member=tarfile.TarInfo(name);member.size=len(self.raw);z.addfile(member,io.BytesIO(self.raw))
        self.plan={'source':install.SOURCE,'base_manifest_sha256':install.BASE_MANIFEST,
            'web_manifest':self.new,'delta_sha256':install.sha(path),'qualified_package_sha256':'fixture-package-hash'}
        (self.operator/'PLAN.json').write_text(json.dumps(self.plan))

    def test_delta_preserves_shared_base_and_omits_obsolete_chunks(self):
        install.prepare();install.check()
        old=self.base/'ui/web/apps/web/server.js';new=self.app/'ui/web/apps/web/server.js'
        self.assertEqual(old.stat().st_ino,new.stat().st_ino)
        self.assertEqual((self.base/'infra/launch.py').read_bytes(),b'old launch')
        self.assertEqual((self.app/'infra/launch.py').read_bytes(),self.raw)
        self.assertFalse((self.app/'ui/web/obsolete.js').exists())
        self.assertTrue((self.app/'.venv').is_symlink())
        self.assertEqual((self.app/'.venv').resolve(),self.base/'.venv')
        self.assertEqual((self.app/'.venv/preserved').read_text(),'rollback dependency')
        self.assertEqual(self.web.resolve(),self.base)
        self.assertFalse((self.operator/'web-delta.tar.gz').exists())

    def test_tar_path_outside_manifest_is_rejected_without_candidate(self):
        self.archive('../outside')
        with self.assertRaisesRegex(RuntimeError,'DELTA_SCOPE'):install.prepare()
        self.assertFalse(self.app.exists());self.assertEqual(self.web.resolve(),self.base)

    def test_dependency_change_is_rejected_before_preparation(self):
        self.plan['web_manifest']['locks']={'pnpm':'different'}
        (self.operator/'PLAN.json').write_text(json.dumps(self.plan))
        with self.assertRaisesRegex(RuntimeError,'DEPENDENCIES_CHANGED'):install.prepare()
        self.assertFalse(self.app.exists())

    def test_changed_dependency_reference_blocks_activation(self):
        install.prepare();(self.app/'.venv').unlink()
        other=self.root/'other-venv';other.mkdir();(self.app/'.venv').symlink_to(other)
        with patch.object(install,'run')as command:
            with self.assertRaisesRegex(RuntimeError,'DEPENDENCY_REFERENCE_CHANGED'):install.activate()
        command.assert_not_called();self.assertEqual(self.web.resolve(),self.base)

    def test_health_failure_restores_old_web_and_restarts_only_web(self):
        install.prepare()
        with patch.object(install,'run')as command,patch.object(install,'health',side_effect=[RuntimeError('failed'),{'release':'base'}]):
            with self.assertRaisesRegex(RuntimeError,'failed'):install.activate()
        self.assertEqual(self.web.resolve(),self.base)
        self.assertEqual(command.call_args_list,[unittest.mock.call('systemctl','restart',install.UNIT)]*2)
        self.assertEqual(json.loads((self.operator/'ROLLED_BACK.json').read_text())['status'],'ROLLED_BACK')

    def test_later_writer_is_not_overwritten_on_failed_update(self):
        install.prepare();other=self.root/'later';other.mkdir()
        def fail(_):install.pointer(str(other));raise RuntimeError('failed')
        with patch.object(install,'run'),patch.object(install,'health',side_effect=fail):
            with self.assertRaisesRegex(RuntimeError,'ROLLBACK_POINTER_MOVED'):install.activate()
        self.assertEqual(self.web.resolve(),other)


if __name__=='__main__':unittest.main()
