"""File-boundary regression checks on new temporary trees; never host preparation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


def module(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


HERE=Path(__file__).resolve().parent
REPO=next(p for p in HERE.parents if (p/'products/alisa/infra/release.py').is_file())
prepare=module('s06_prepare_fixture',HERE/'prepare.py')
release=module('s06_release_fixture',REPO/'products/alisa/infra/release.py')


class PreparationBoundaryChecks(unittest.TestCase):
    def test_existing_active_hardlink_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            active=Path(folder)/'active.py';target=Path(folder)/'prepared.py'
            active.write_bytes(b'active');os.link(active,target)
            prepare.install_bytes(target,b'new')
            self.assertEqual(active.read_bytes(),b'active')
            self.assertEqual(target.read_bytes(),b'new')
            self.assertNotEqual(active.stat().st_ino,target.stat().st_ino)

    def test_symlink_parent_never_receives_selected_write(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);active=root/'active';target=root/'prepared'
            active.mkdir();target.mkdir();(active/'settings.py').write_bytes(b'active')
            (target/'config').symlink_to(active,target_is_directory=True)
            with self.assertRaises(RuntimeError):prepare.safe_parent(target,target/'config/settings.py')
            self.assertEqual((active/'settings.py').read_bytes(),b'active')

    def test_arbitrary_output_is_rejected_without_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            outside=Path(folder)/'must-remain';outside.write_bytes(b'unchanged')
            with self.assertRaises(RuntimeError):prepare.emit(outside,{'status':'fake'})
            self.assertEqual(outside.read_bytes(),b'unchanged')

    def test_canonical_verifier_checks_file_and_link_sets_and_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);target=base/'releases/alisa-0000000000000000'
            target.mkdir(parents=True);(target/'real.py').write_bytes(b'qualified')
            (target/'alias.py').symlink_to('real.py')
            (target/'.venv/bin').mkdir(parents=True);(target/'.venv/bin/python').touch()
            manifest={'artifact_id':target.name,'files':{'real.py':hashlib.sha256(b'qualified').hexdigest()},'links':{'alias.py':'real.py'}}
            (target/'manifest.json').write_text(json.dumps(manifest))
            self.assertEqual(release.installed_release(base,target.name),target)
            (target/'real.py').write_bytes(b'drift')
            with self.assertRaises(RuntimeError):release.installed_release(base,target.name)
            (target/'real.py').write_bytes(b'qualified');(target/'unexpected.py').touch()
            with self.assertRaises(RuntimeError):release.installed_release(base,target.name)


if __name__=='__main__':unittest.main(verbosity=2)
