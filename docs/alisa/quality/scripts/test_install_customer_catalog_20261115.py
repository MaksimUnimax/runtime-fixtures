"""Disposable failure boundaries; never reads live configuration or services."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('rollout', Path(__file__).with_name('install_customer_catalog_20261115.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class InstallTests(unittest.TestCase):
    def test_unchanged_files_are_shared_without_overwriting_base(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root/'old';base.mkdir();(base/'.venv').mkdir()
            (base/'same').write_bytes(b'unchanged')
            src = root/'new-bytes';src.write_bytes(b'new')
            target = root/'candidate'
            h = M.sha(base/'same')
            value = {'files': {'same': h, 'changed': M.sha(src)}, 'links': {'alias': 'same'}}
            M.materialize(base, target, value, {'same': base/'same', 'changed': src}, {h: base/'same'})
            self.assertEqual((base/'same').stat().st_ino, (target/'same').stat().st_ino)
            self.assertEqual((base/'same').read_bytes(), b'unchanged')
            self.assertEqual((target/'changed').read_bytes(), b'new')
            self.assertEqual((target/'.venv').resolve(), base/'.venv')
            (target/'changed').write_bytes(b'bad')
            with self.assertRaisesRegex(RuntimeError, 'FILE_HASH'):
                M.manifest(target)

    def trace_switch(self, fail_new_pair=False):
        trace = []
        with tempfile.TemporaryDirectory() as folder:
            drop = Path(folder)/'owned.conf'
            def pair(rollback):
                trace.append(('ready_pair', rollback))
                if fail_new_pair and not rollback:
                    raise RuntimeError('SYNTHETIC_PAIR_FAILURE')
            def command(*args):
                trace.append(tuple(args))
                return ''
            patches = [patch.object(M, 'DROP', drop),
                       patch.object(M, 'selection_guard', lambda: trace.append(('guard',))),
                       patch.object(M, 'stop', lambda u: trace.append(('stop', u))),
                       patch.object(M, 'select', lambda link, dest: trace.append(('select', link.name, dest.name))),
                       patch.object(M, 'run', command), patch.object(M, 'ready_pair', pair),
                       patch.object(M, 'ready_web', lambda b: trace.append(('ready_web', b))),
                       patch.object(M, 'reserve', lambda *a: None), patch.object(M, 'idle', lambda: None),
                       patch.object(M, 'protected', lambda: {'fixed': True}),
                       patch.object(M, 'static', lambda u: {}),
                       patch.object(M, 'record', lambda n, v: trace.append(('receipt', n)))]
            for p in patches:p.start()
            try:
                if fail_new_pair:
                    value = {'protected': {'fixed': True}, 'units': {}}
                    with patch.object(M, 'WEB_LINK', Path(folder)/'old-web'), patch.object(M, 'IDENTITY_LINK', Path(folder)/'old-id'):
                        M.WEB_LINK.symlink_to(M.BASE);M.IDENTITY_LINK.symlink_to(M.IDENTITY_BASE)
                        with self.assertRaisesRegex(RuntimeError, 'SYNTHETIC_PAIR_FAILURE'):
                            M.apply(value)
                else:
                    M.switch()
            finally:
                for p in reversed(patches):p.stop()
        return trace

    def test_web_is_drained_before_backends_and_started_after_pair_ready(self):
        trace = self.trace_switch()
        self.assertLess(trace.index(('stop', M.WEB)), trace.index(('stop', M.PLATFORM)))
        self.assertLess(trace.index(('stop', M.WEB)), trace.index(('stop', M.IDP)))
        self.assertLess(trace.index(('ready_pair', False)), trace.index(('systemctl', 'start', M.WEB)))
        self.assertEqual(trace[-1], ('ready_web', False))

    def test_new_backend_failure_restores_pair_before_reopening_web(self):
        trace = self.trace_switch(True)
        self.assertEqual(trace.count(('stop', M.WEB)), 2)
        self.assertEqual(trace.count(('systemctl', 'start', M.WEB)), 1)
        self.assertLess(trace.index(('ready_pair', True)), trace.index(('systemctl', 'start', M.WEB)))
        self.assertNotIn(('ready_web', False), trace)
        self.assertEqual(trace[-1], ('receipt', 'ROLLED_BACK.json'))

    def test_foreign_selector_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);web = root/'web';identity = root/'id';drop = root/'drop'
            foreign = root/'foreign';foreign.mkdir();web.symlink_to(foreign);identity.symlink_to(M.IDENTITY_BASE)
            with patch.object(M, 'WEB_LINK', web), patch.object(M, 'IDENTITY_LINK', identity), patch.object(M, 'DROP', drop):
                with self.assertRaisesRegex(RuntimeError, 'WEB_SELECTOR_MOVED'):
                    M.selection_guard()
                self.assertEqual(web.resolve(), foreign)

    def test_in_place_file_change_is_rejected_without_touching_base(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);source = root/'data';source.write_bytes(b'a')
            digest = M.sha(source);source.write_bytes(b'b')
            with self.assertRaisesRegex(RuntimeError, 'DEDUP_SOURCE_CHANGED'):
                M.materialize(root, root/'target', {'files': {'data': digest}}, {}, {digest: source})
            self.assertEqual(source.read_bytes(), b'b')


if __name__ == '__main__':
    unittest.main()

