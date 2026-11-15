"""Disposable failure boundaries; never reads live configuration or services."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import tarfile
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
                       patch.object(M, 'select', lambda link, dest, expected: trace.append(('select', link.name, dest.name))),
                       patch.object(M, 'run', command), patch.object(M, 'ready_pair', pair),
                       patch.object(M, 'fence_service', lambda unit: trace.append(('fence', unit))),
                       patch.object(M, 'require_fence', lambda unit, *a: trace.append(('check_fence', unit))),
                       patch.object(M, 'release_fence', lambda unit: trace.append(('release_fence', unit))),
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
        self.assertEqual(trace.count(('stop', M.WEB)), 3)
        self.assertEqual(trace.count(('systemctl', 'start', M.WEB)), 1)
        self.assertLess(trace.index(('ready_pair', True)), trace.index(('systemctl', 'start', M.WEB)))
        self.assertNotIn(('ready_web', False), trace)
        self.assertEqual(trace[-1], ('receipt', 'ROLLED_BACK.json'))
        self.assertLess(trace.index(('ready_pair', True)), trace.index(('release_fence', M.WEB)))

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

    def test_concurrent_replacement_before_move_is_detected_and_restored(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);live = root/'live';staged = root/'new'
            live.symlink_to('old');staged.symlink_to('ours')
            expected = M.path_state(live)
            original = M.rename_no_replace
            def race(src, dst):
                if src == live:
                    live.unlink();live.symlink_to('foreign')
                original(src, dst)
            with patch.object(M, 'rename_no_replace', race):
                with self.assertRaisesRegex(RuntimeError, 'DISPLACED_SELECTOR_CHANGED'):
                    M.replace_selection(live, staged, expected)
            self.assertEqual(live.readlink(), Path('foreign'))
            self.assertEqual(staged.readlink(), Path('ours'))

    def test_concurrent_creation_in_gap_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);live = root/'live';staged = root/'new'
            live.symlink_to('old');staged.symlink_to('ours')
            expected = M.path_state(live)
            original = M.rename_no_replace
            def race(src, dst):
                if src == staged:
                    live.symlink_to('foreign')
                original(src, dst)
            with patch.object(M, 'rename_no_replace', race):
                with self.assertRaisesRegex(RuntimeError, 'SELECTOR_OCCUPIED'):
                    M.replace_selection(live, staged, expected)
            self.assertEqual(live.readlink(), Path('foreign'))
            self.assertEqual((root/'.live.customer-catalog-held').readlink(), Path('old'))

    def test_stream_copy_handles_multiple_chunks_and_validates_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);src = root/'src';dst = root/'dst'
            src.write_bytes(b'z'*(3*1024*1024+1))
            M.atomic_copy(dst, src, M.sha(src))
            self.assertEqual(M.sha(dst), M.sha(src))

    def test_unlisted_file_or_empty_directory_blocks_candidate_activation(self):
        for extra_kind in ['file', 'directory', 'symlink']:
            with self.subTest(extra_kind=extra_kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder);base = root/'base';base.mkdir();(base/'.venv').mkdir()
                src = root/'source';src.write_bytes(b'admitted')
                target = root/'candidate';value = {'files': {'code.py': M.sha(src)}}
                M.materialize(base, target, value, {'code.py': src}, {})
                M.candidate_manifest(target, base)
                extra = target/'unlisted'
                if extra_kind == 'file':extra.write_bytes(b'extra')
                elif extra_kind == 'directory':extra.mkdir()
                else:extra.symlink_to(src)
                with self.assertRaisesRegex(RuntimeError, 'UNDECLARED_RELEASE_ENTRY'):
                    M.candidate_manifest(target, base)

    def test_payload_and_manifest_must_match_the_pinned_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);payload = root/'release';payload.mkdir()
            code = payload/'code.py';code.write_bytes(b'qualified')
            record = {'files': {'code.py': M.sha(code)}}
            (payload/'manifest.json').write_text(json.dumps(record)+'\n')
            archive = root/'qualified.tar.gz'
            with tarfile.open(archive, 'w:gz') as t:t.add(payload, arcname=payload.name)
            digest = M.sha(archive)
            M.package_manifest(payload, archive, digest)
            code.write_bytes(b'changed after extraction')
            record['files']['code.py'] = M.sha(code)
            (payload/'manifest.json').write_text(json.dumps(record)+'\n')
            M.manifest(payload)  # Internally consistent, but not the CI package.
            with self.assertRaisesRegex(RuntimeError, 'PACKAGE_MANIFEST_CHANGED'):
                M.package_manifest(payload, archive, digest)

    def test_duplicate_new_bytes_are_written_once_across_candidate_releases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);base = root/'base';base.mkdir();(base/'.venv').mkdir()
            src = root/'src';src.write_bytes(b'shared new content')
            digest = M.sha(src);pool = {};value = {'files': {'new.py': digest}}
            M.materialize(base, root/'first', value, {'new.py': src}, pool)
            M.materialize(base, root/'second', value, {'new.py': src}, pool)
            self.assertEqual((root/'first/new.py').stat().st_ino, (root/'second/new.py').stat().st_ino)

    def test_web_fence_is_checked_before_switch_and_released_after_pair_ready(self):
        trace = self.trace_switch()
        self.assertLess(trace.index(('fence', M.WEB)), trace.index(('stop', M.WEB)))
        self.assertLess(trace.index(('check_fence', M.WEB)), trace.index(('stop', M.PLATFORM)))
        self.assertLess(trace.index(('ready_pair', False)), trace.index(('release_fence', M.WEB)))
        self.assertLess(trace.index(('release_fence', M.WEB)), trace.index(('systemctl', 'start', M.WEB)))

    def test_foreign_web_mask_cannot_be_released(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);mask = root/'web.service';mask.symlink_to('/dev/null')
            proof = {'source': M.SOURCE, 'installer_sha256': M.sha(M.__file__),
                     'mask_state': list(M.path_state(mask)), 'mask_ctime_ns':mask.lstat().st_ctime_ns, 'phase': 'active'}
            (root/'WEB_FENCE.json').write_text(json.dumps(proof))
            mask.unlink();mask.symlink_to('/dev/null')
            # Some filesystems immediately recycle a symlink inode and have
            # coarse timestamps; make the distinct replacement deterministic.
            os.utime(mask, ns=(1, 1), follow_symlinks=False)
            with patch.object(M, 'ROOT', root), patch.object(M, 'WEB_MASK', mask), patch.object(M, 'prop', lambda *a:'masked'):
                with self.assertRaisesRegex(RuntimeError, 'WEB_FENCE_LOST'):
                    M.release_fence(M.WEB)
                self.assertTrue(mask.is_symlink())

    def test_metadata_read_rejects_bytes_beyond_its_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'manifest';path.write_bytes(b'x'*33)
            with self.assertRaisesRegex(RuntimeError, 'METADATA_BOUND'):
                M.bounded(path, 32)

    def test_backend_start_fences_cover_selector_changes(self):
        trace = self.trace_switch()
        selectors = [i for i, item in enumerate(trace) if item[0] == 'select']
        for unit in [M.PLATFORM, M.IDP]:
            self.assertLess(trace.index(('fence', unit)), trace.index(('stop', unit)))
            self.assertGreater(trace.index(('release_fence', unit)), max(selectors))
            self.assertLess(trace.index(('release_fence', unit)), trace.index(('systemctl', 'start', M.PLATFORM, M.IDP)))


if __name__ == '__main__':
    unittest.main()
