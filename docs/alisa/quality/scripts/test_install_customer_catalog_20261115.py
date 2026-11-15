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
            staged_expected = M.path_state(staged)
            original = M.rename_no_replace
            def race(src, dst):
                if src == live:
                    live.unlink();live.symlink_to('foreign')
                original(src, dst)
            with patch.object(M, 'rename_no_replace', race):
                with self.assertRaisesRegex(RuntimeError, 'DISPLACED_SELECTOR_CHANGED'):
                    M.replace_selection(live, staged, expected, staged_expected)
            self.assertEqual(live.readlink(), Path('foreign'))
            self.assertEqual(staged.readlink(), Path('ours'))

    def test_concurrent_creation_in_gap_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);live = root/'live';staged = root/'new'
            live.symlink_to('old');staged.symlink_to('ours')
            expected = M.path_state(live)
            staged_expected = M.path_state(staged)
            original = M.rename_no_replace
            def race(src, dst):
                if src == staged:
                    live.symlink_to('foreign')
                original(src, dst)
            with patch.object(M, 'rename_no_replace', race):
                with self.assertRaisesRegex(RuntimeError, 'SELECTOR_OCCUPIED'):
                    M.replace_selection(live, staged, expected, staged_expected)
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

    def test_staging_replacement_is_rejected_before_live_selector_moves(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);live = root/'live';stage = root/'stage'
            live.symlink_to('old');stage.symlink_to('ours')
            expected = M.path_state(live);staged = M.path_state(stage)
            stage.unlink();stage.symlink_to('foreign')
            with self.assertRaisesRegex(RuntimeError, 'STAGED_SELECTOR_CHANGED'):
                M.replace_selection(live, stage, expected, staged)
            self.assertEqual(live.readlink(), Path('old'))

    def test_staging_replacement_during_rename_keeps_held_selector(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);live = root/'live';stage = root/'stage'
            live.symlink_to('old');stage.symlink_to('ours')
            expected = M.path_state(live);staged = M.path_state(stage)
            original = M.rename_no_replace
            def race(src, dst):
                if src == stage:
                    stage.unlink();stage.symlink_to('foreign')
                original(src, dst)
            with patch.object(M, 'rename_no_replace', race):
                with self.assertRaisesRegex(RuntimeError, 'INSTALLED_SELECTOR_CHANGED'):
                    M.replace_selection(live, stage, expected, staged)
            self.assertEqual(live.readlink(), Path('foreign'))
            self.assertEqual((root/'.live.customer-catalog-held').readlink(), Path('old'))

    def test_pinned_legacy_identity_overlay_is_verified_before_dereferencing(self):
        with tempfile.TemporaryDirectory() as folder:
            stage = Path(folder);base = stage/'releases/base';identity = stage/'releases/identity'
            base.mkdir(parents=True);identity.mkdir()
            (base/'code.py').write_bytes(b'qualified baseline')
            digest = M.sha(base/'code.py')
            (base/'manifest.json').write_text(json.dumps({'files': {'code.py': digest}}))
            (identity/'code.py').symlink_to(base/'code.py')
            value = {'files': {'code.py': digest}, 'overlay_base': str(base),
                     'overlay_references': {'code.py': str(base/'code.py')},
                     'base_manifest_sha256': M.sha(base/'manifest.json')}
            (identity/'manifest.json').write_text(json.dumps(value))
            with patch.object(M, 'STAGE', stage), patch.object(M, 'IDENTITY_BASE', identity), patch.object(M, 'PINS', {identity:M.sha(identity/'manifest.json')}):
                M.manifest(identity, True)
                (identity/'code.py').unlink()
                (stage/'foreign.py').write_bytes(b'qualified baseline')
                (identity/'code.py').symlink_to(stage/'foreign.py')
                with self.assertRaisesRegex(RuntimeError, 'OVERLAY_REF_CHANGED'):
                    M.manifest(identity, True)

    def test_selector_cleanup_keeps_a_new_same_target_staging_object(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);link = root/'live';link.symlink_to('old')
            temp = root/'.live.customer-catalog-new'
            def concurrent(*args):
                temp.unlink();temp.symlink_to('ours')
                os.utime(temp, ns=(1,1), follow_symlinks=False)
                raise RuntimeError('SYNTHETIC_OTHER_WRITER')
            with patch.object(M, 'replace_selection', concurrent):
                with self.assertRaisesRegex(RuntimeError, 'SYNTHETIC_OTHER_WRITER'):
                    M.select(link, Path('ours'), M.path_state(link))
            self.assertTrue(temp.is_symlink())
            self.assertEqual(link.readlink(), Path('old'))

    def test_pinned_identity_directory_reference_checks_each_admitted_leaf(self):
        with tempfile.TemporaryDirectory() as folder:
            stage = Path(folder);base = stage/'releases/base';identity = stage/'releases/identity'
            (base/'config').mkdir(parents=True);identity.mkdir()
            (base/'config/code.py').write_bytes(b'original')
            digest = M.sha(base/'config/code.py')
            (base/'manifest.json').write_text(json.dumps({'files': {'config/code.py': digest}}))
            (identity/'config').symlink_to(base/'config')
            value = {'files': {'config/code.py': digest}, 'overlay_base':str(base),
                     'overlay_references': {'config':str(base/'config')},
                     'base_manifest_sha256':M.sha(base/'manifest.json')}
            (identity/'manifest.json').write_text(json.dumps(value))
            with patch.object(M, 'STAGE', stage), patch.object(M, 'IDENTITY_BASE', identity), patch.object(M, 'PINS', {identity:M.sha(identity/'manifest.json')}):
                M.manifest(identity, True)
                foreign = stage/'foreign';foreign.mkdir();(foreign/'code.py').write_bytes(b'original')
                (identity/'config').unlink();(identity/'config').symlink_to(foreign)
                with self.assertRaisesRegex(RuntimeError, 'OVERLAY_REF_CHANGED'):
                    M.manifest(identity, True)

    def test_overlay_keeps_deployed_staff_and_r5_migration(self):
        staff = 'services/platform/src/alisa_platform/staff/policy.py'
        migration = 'services/platform/src/alisa_platform/owner_data/migrations/0002_current_parameter_only.py'
        baseline = {staff:'live-staff', migration:'live-r5'}
        package = {n:'qualified-patch' for n in M.PLATFORM_PATCH | M.AUTH_CONTRACTS}
        package.update({staff:'different-staff', migration:'different-r5', 'ui/web/page.js':'qualified-ui'})
        result = baseline | M.selected_files(package, 'app')
        self.assertEqual(result[staff], 'live-staff')
        self.assertEqual(result[migration], 'live-r5')
        self.assertEqual(result['ui/web/page.js'], 'qualified-ui')
        self.assertEqual(M.APP_BASE, M.PLATFORM_BASE)


if __name__ == '__main__':
    unittest.main()
