"""Installer recovery against temporary files and mocked service commands."""
import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('packing_install_review', Path(__file__).with_name('install.py'))
install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install)


class InstallerRecovery(unittest.TestCase):
    def exercise(self, when):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base, target, candidate = root/'base', root/'target', root/'candidate'
            directory, receipt = root/'systemd', root/'receipt.json'
            base.mkdir(); candidate.mkdir(); directory.mkdir()
            (base/'tests').mkdir()
            (base/'model_answer.py').write_text('old source')
            (base/'manifest.json').write_text(json.dumps({'files': {'model_answer.py': install.digest(base/'model_answer.py')}}))
            install.shutil.copytree(base, candidate/'runtime')
            for name in install.CHANGED:
                (candidate/'runtime'/name).write_text('new source '+name)
            before = install.hashes(base)
            (candidate/'base_hashes.json').write_text(json.dumps(before))
            (candidate/'full_results.json').write_text(json.dumps({
                'status': 'PASS', 'failures': 0, 'errors': 0, 'skipped': 0,
                'tests_run': 3, 'tested_files': install.hashes(candidate/'runtime')}))
            (candidate/'qualification_review.json').write_text(json.dumps({
                'status': 'PASS', 'runtime_files': {
                    name: install.digest(candidate/'runtime'/name) for name in install.CHANGED}}))
            (directory/'base.conf').write_text('[Service]\nWorkingDirectory='+str(base)+'\n')
            override = directory/'basez-input-packing-v1.conf'
            service = {'working': str(base), 'active': 'active'}
            commands, queue_calls = [], []
            actual_atomic = install.atomic

            def command(*args):
                commands.append(args)
                if args[:2] == ('systemctl', 'stop'):
                    service['active'] = 'inactive'
                elif args[:2] == ('systemctl', 'start'):
                    service['working'] = str(target if override.exists() else base)
                    service['active'] = 'active'

            def show(prop):
                return service['working'] if prop == 'WorkingDirectory' else service['active']

            def empty_queue():
                queue_calls.append(True)
                if when == 'before_switch' and len(queue_calls) >= 3:
                    raise AssertionError('ACTIVE_JOBS')
                if when == 'after_start' and len(queue_calls) >= 4:
                    raise AssertionError('ACTIVE_JOBS')

            def atomic(path, data):
                if path == receipt:
                    raise OSError('synthetic receipt write failure')
                return actual_atomic(path, data)

            def path_factory(value):
                return directory if str(value) == '/etc/systemd/system/alice-market.service.d' else Path(value)

            with contextlib.ExitStack() as stack:
                for name, value in {'BASE': base, 'TARGET': target, 'CANDIDATE': candidate,
                                    'RECEIPT': receipt, 'command': command, 'show': show,
                                    'empty_queue': empty_queue, 'atomic': atomic,
                                    'Path': path_factory}.items():
                    stack.enter_context(patch.object(install, name, value))
                if when == 'empty_rollback':
                    with self.assertRaisesRegex(OSError, 'synthetic receipt'):
                        install.main('a'*40)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_DEFERRED_ACTIVE_WORK_SERVICE_RESTORED'):
                        install.main('a'*40)
            self.assertEqual(service['active'], 'active')
            self.assertEqual(service['working'], str(target if when == 'after_start' else base))
            self.assertEqual(override.exists(), when == 'after_start')
            self.assertEqual(install.hashes(base), before)
            self.assertIn(('systemctl', 'start', 'alice-market.service'), commands)

    def test_new_job_before_switch_restores_base_service(self):
        self.exercise('before_switch')

    def test_new_job_after_start_keeps_v1_service(self):
        self.exercise('after_start')

    def test_empty_queue_failure_rolls_back_base_service(self):
        self.exercise('empty_rollback')


if __name__ == '__main__':
    unittest.main()
