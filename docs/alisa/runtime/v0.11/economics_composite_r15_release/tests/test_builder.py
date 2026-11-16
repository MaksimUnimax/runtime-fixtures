"""Filesystem fault tests; synthetic bases are never production qualification."""
from copy import deepcopy
from pathlib import Path
import importlib.util
import os
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import build_candidate as b
import release_contract as c


class CandidateBuilder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='r15-package-test-')
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        for name in c.SOURCE_FILES:
            raw = (('VALUE = ' + repr('source:' + name) + '\n')
                   if name.endswith('.py') else 'source:' + name).encode()
            b.write_new(self.source / name, raw)
        self.env = self.root / 'environment'
        self.env.mkdir()
        b.write_new(self.env / 'python', b'owned fake interpreter', 0o755)
        b.write_new(self.env / 'node', b'owned fake node', 0o755)
        b.write_new(self.env / 'venv/pyvenv.cfg', b'owned test environment')
        (self.env / 'venv/bin').mkdir()
        (self.env / 'venv/bin/python').symlink_to(self.env / 'python')
        self.locks = {'services/platform/requirements.lock': c.digest(b'locked dependency')}
        self.spec = {'schema': 'alisa-economics-release-readback/v1', 'observed_on': 'synthetic',
                     'bases': {}, 'publisher': {}, 'environment': {
                         'python': {'path': str(self.env / 'python'), 'sha256': c.digest(b'owned fake interpreter')},
                         'node': {'path': str(self.env / 'node'), 'sha256': c.digest(b'owned fake node')},
                         'venv_root': str(self.env / 'venv'), 'pyvenv_cfg_sha256': c.digest(b'owned test environment'),
                         'locks': self.locks}}
        for role in c.ROLES:
            root = self.root / ('base-' + role)
            root.mkdir()
            data = {'assets/kept.txt': ('kept:' + role).encode()}
            if role == 'native':
                data.update({n: ('old-native:' + n).encode() for n in c.NATIVE_EXISTING})
                data['template_catalog.json'] = c.encoded({'schema': 'old', 'templates': {'old.card': {'v': 1}}})
                data['read_surface.py'] = b'preserved native read surface'
                data['parameter_support/parameter_resolution.py'] = (self.source / c.SOURCE_PLATFORM /
                                                                     'owner_data/parameter_resolution.py').read_bytes()
                data.update({'parameter_support/' + name: (self.source / c.SOURCE_PLATFORM /
                             'owner_data' / name).read_bytes() for name in c.NATIVE_COMPATIBILITY})
                data['CURRENT_CORE_MANIFEST.json'] = c.encoded({'schema': 'old-core', 'files':
                    {n: c.digest(raw) for n, raw in data.items()}})
            else:
                data.update({c.PLATFORM + n: ('old:' + n).encode() for n in c.EXISTING_PLATFORM})
                data.update({c.PLATFORM + n: (self.source / c.SOURCE_PLATFORM / n).read_bytes()
                             for n in c.COMPATIBILITY_FILES})
                data[c.PLATFORM + 'catalog/reader.py'] = b'preserved catalogue'
                data[c.PLATFORM + 'accounts/service.py'] = ('preserved login:' + role).encode()
                data['services/platform/requirements.lock'] = b'locked dependency'
            for name, raw in data.items():
                b.write_new(root / name, raw)
            (root / 'assets/current.txt').symlink_to('kept.txt')
            m = {'schema': 'old-release', 'artifact_id': 'base-' + role,
                 'files': {n: c.digest(raw) for n, raw in data.items()},
                 'links': {'assets/current.txt': 'kept.txt'},
                 'acceptance': {'status': 'OLD_ACCEPTED'}, 'locks': self.locks,
                 'migrations': {'old-migration': 'untouched'}}
            raw = c.encoded(m)
            b.write_new(root / 'manifest.json', raw)
            entry = {'root': str(root), 'manifest_sha256': c.digest(raw)}
            if role != 'native':
                (root / '.venv').symlink_to(self.env / 'venv')
                entry['venv_link'] = str(self.env / 'venv')
            self.spec['bases'][role] = entry
        b.write_new(self.root / 'publisher.py', b'preserved publisher')
        self.spec['publisher'] = {'path': str(self.root / 'publisher.py'), 'sha256': c.digest(b'preserved publisher')}
        self.patch = patch.object(b, 'baseline', return_value=deepcopy(self.spec))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.live = patch.object(b, 'live_references', return_value={'synthetic_live': 'same bases'})
        self.live_mock = self.live.start()
        self.addCleanup(self.live.stop)
        self.review = {'schema': 'alisa-economics-release-compatibility/v1', 'preserved_differences': [],
                       'replacement_deltas': {name: {
                           'source_sha256': c.digest((self.source / c.SOURCE_PLATFORM / name).read_bytes()),
                           'base_sha256': {role: c.digest((Path(self.spec['bases'][role]['root']) /
                                                        c.PLATFORM / name).read_bytes())
                                           for role in ('platform', 'authority')},
                           'reason': 'synthetic filesystem contract test only'} for name in c.EXISTING_PLATFORM}}
        self.review_patch = patch.object(b, 'compatibility_review', return_value=self.review)
        self.review_patch.start()
        self.addCleanup(self.review_patch.stop)
        self.space_patch = patch.object(b, 'space_budget', return_value={'synthetic_budget': True})
        self.space_patch.start()
        self.addCleanup(self.space_patch.stop)
        self.plan = b.make_plan(self.source, 'c' * 40)
        self.raw = c.encoded(self.plan)
        self.out = self.root / 'candidate'

    def tearDown(self):
        for root, dirs, _ in os.walk(self.root, followlinks=False):
            Path(root).chmod(0o700)
            for name in dirs:
                path = Path(root) / name
                if not path.is_symlink():
                    path.chmod(0o700)
        self.tmp.cleanup()

    def native(self, target, source):
        for name in c.NATIVE_OVERLAY:
            if name == 'template_catalog.json':
                value = c.strict_json((target / name).read_bytes())
                value['templates'].update({k: {'id': k} for k in c.REPORT_IDS})
                raw = c.encoded(value)
            elif name in c.LEAVES:
                raw = (source / c.RUNTIME / c.LEAVES[name]).read_bytes()
            elif name.startswith('parameter_support/'):
                raw = (source / c.SOURCE_PLATFORM / 'owner_data' / Path(name).name).read_bytes()
            else:
                raw = ('new-native:' + name).encode()
            path = target / name
            if path.exists():
                b.replace_file(path, raw)
            else:
                b.write_new(path, raw)

    def probe(self, target, python):
        old = str(target) == self.spec['bases']['native']['root']
        return {'versions': {'runtime_contract_version': '1', 'catalog_bundle_hash': ('a' if old else 'b') * 64},
                'read_surface_pin': 'f' * 64, 'parameter_sources_pin': ('1' if old else '4') * 64,
                'parameter_compounds_pin': None if old else '2' * 64,
                'economics_composites_pin': None if old else '3' * 64}

    def build(self, apply=None, probe=None):
        with patch.object(b, 'apply_native', side_effect=apply or self.native), \
                patch.object(b, 'native_probe', side_effect=probe or self.probe):
            return b.build(self.source, self.raw, c.digest(self.raw), self.out)

    def assert_no_partial(self):
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.root.glob('.candidate-*')), [])

    def test_complete_candidate_preserves_distinct_bases_and_runtime_environment(self):
        result = self.build()
        self.assertEqual(result['status'], 'BUILT_NOT_ACTIVATED')
        self.assertFalse(result['production_deployed'])
        for role in ('platform', 'authority'):
            path = c.PLATFORM + 'accounts/service.py'
            base = Path(self.spec['bases'][role]['root'])
            new = self.out / 'releases' / role
            self.assertEqual((new / path).read_bytes(), ('preserved login:' + role).encode())
            self.assertNotEqual((new / path).stat().st_ino, (base / path).stat().st_ino)
            self.assertTrue((base / path).stat().st_mode & 0o200)
            self.assertFalse((new / path).stat().st_mode & 0o222)
            self.assertEqual(os.readlink(new / '.venv'), self.spec['environment']['venv_root'])
        self.assertFalse((self.out / 'releases/web').exists())
        self.assertEqual((self.root / 'publisher.py').read_bytes(), b'preserved publisher')
        checked = b.verify_prepared(self.out, c.digest(c.encoded(result)))
        self.assertEqual(checked['status'], 'CANDIDATE_VERIFIED_NOT_ACTIVATED')
        self.assertEqual(result['installed_synthetic'], 'NOT_RUN')

    def test_old_acceptance_is_only_historical_provenance(self):
        self.build()
        value = c.strict_json((self.out / 'releases/platform/manifest.json').read_bytes())
        self.assertEqual(value['acceptance']['status'], 'CANDIDATE_BUILT_NOT_INSTALLED')
        self.assertEqual(value['base_provenance']['acceptance']['status'], 'OLD_ACCEPTED')
        self.assertEqual(value['migrations'], {'old-migration': 'untouched'})

    def test_program_recovery_consumer_is_pinned_staged_and_copied_exactly(self):
        name = c.RUNTIME + 'current_parameters_r8/program_recovery/model_program.py'
        expected = (self.source / name).read_bytes()
        self.assertEqual(self.plan['source_files'][name], c.digest(expected))

        def staged(target, source):
            self.assertNotEqual(source, self.source)
            self.assertEqual(set(b.file_hashes(source)), set(self.plan['source_files']))
            self.assertEqual((source / name).read_bytes(), expected)
            self.native(target, source)

        self.build(apply=staged)
        native = self.out / 'releases/native'
        self.assertEqual((native / 'model_program.py').read_bytes(), expected)
        manifest = c.strict_json((native / 'manifest.json').read_bytes())
        self.assertEqual(manifest['files']['model_program.py'], self.plan['source_files'][name])

    def test_missing_program_recovery_consumer_cannot_get_a_plan(self):
        name = c.RUNTIME + 'current_parameters_r8/program_recovery/model_program.py'
        self.assertIn(name, self.plan['source_files'])
        (self.source / name).unlink()
        with self.assertRaises(FileNotFoundError):
            b.make_plan(self.source, 'd' * 40)

    def test_owner_source_and_query_adapter_are_copied_to_both_platform_roles(self):
        self.assertIn('owner_data/source.py', c.EXISTING_PLATFORM)
        self.assertNotIn('owner_data/source.py', c.COMPATIBILITY_FILES)
        self.build()
        for role in ('platform', 'authority'):
            base = Path(self.spec['bases'][role]['root'])
            candidate = self.out / 'releases' / role
            for name in ('owner_data/source.py', 'owner_data/economics_query.py'):
                expected = (self.source / c.SOURCE_PLATFORM / name).read_bytes()
                self.assertEqual((candidate / c.PLATFORM / name).read_bytes(), expected)
            self.assertNotEqual((base / c.PLATFORM / 'owner_data/source.py').read_bytes(),
                                (candidate / c.PLATFORM / 'owner_data/source.py').read_bytes())
            self.assertFalse((base / c.PLATFORM / 'owner_data/economics_query.py').exists())
        self.assertFalse((self.out / 'releases/native/parameter_support/source.py').exists())

    def test_source_mutation_during_build_refuses_publication(self):
        def mutate(target, source):
            self.native(target, source)
            (self.source / next(iter(c.SOURCE_FILES))).write_bytes(b'other writer')
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_CHANGED_DURING_BUILD'):
            self.build(apply=mutate)
        self.assert_no_partial()

    def test_web_mutation_during_build_refuses_publication_and_does_not_restore_it(self):
        path = Path(self.spec['bases']['web']['root']) / 'assets/kept.txt'
        def mutate(target, source):
            self.native(target, source)
            path.write_bytes(b'parallel accepted web')
        with self.assertRaisesRegex(c.ReleaseError, 'BASE_FILE_CHANGED'):
            self.build(apply=mutate)
        self.assertEqual(path.read_bytes(), b'parallel accepted web')
        self.assert_no_partial()

    def test_publisher_change_is_a_cas_failure(self):
        (self.root / 'publisher.py').write_bytes(b'new publisher')
        with self.assertRaisesRegex(c.ReleaseError, 'PUBLISHER_CHANGED'):
            self.build()
        self.assert_no_partial()

    def test_current_service_reference_change_is_a_cas_failure(self):
        self.live_mock.return_value = {'synthetic_live': 'parallel new base'}
        with self.assertRaisesRegex(c.ReleaseError, 'BASE_CAS_CHANGED'):
            self.build()
        self.assert_no_partial()

    def test_service_switch_during_build_blocks_publication(self):
        def switch(target, source):
            self.native(target, source)
            self.live_mock.return_value = {'synthetic_live': 'parallel new base'}
        with self.assertRaisesRegex(c.ReleaseError, 'BASE_OR_TOOL_CHANGED_DURING_BUILD'):
            self.build(apply=switch)
        self.assert_no_partial()

    def test_native_unlisted_change_fails_even_when_r8_files_would_match(self):
        def mutate(target, source):
            self.native(target, source)
            (target / 'read_surface.py').write_bytes(b'test interpreter rewrite')
        with self.assertRaisesRegex(c.ReleaseError, 'OVERLAY_SCOPE'):
            self.build(apply=mutate)
        self.assert_no_partial()

    def test_existing_catalog_definition_cannot_be_replaced(self):
        def mutate(target, source):
            self.native(target, source)
            value = c.strict_json((target / 'template_catalog.json').read_bytes())
            value['templates']['old.card']['v'] = 2
            (target / 'template_catalog.json').write_bytes(c.encoded(value))
        with self.assertRaisesRegex(c.ReleaseError, 'EXISTING_TEMPLATE_CHANGED'):
            self.build(apply=mutate)
        self.assert_no_partial()

    def test_partial_native_overlay_is_not_a_candidate(self):
        def mutate(target, source):
            self.native(target, source)
            (target / 'parameter_support/economics_other.py').unlink()
        with self.assertRaisesRegex(c.ReleaseError, 'OVERLAY_FILE_MISSING'):
            self.build(apply=mutate)
        self.assert_no_partial()

    def test_existing_new_module_in_base_is_refused(self):
        old = {c.PLATFORM + 'owner_data/' + c.NEW_OWNER[0]: 'a' * 64}
        after = {c.PLATFORM + n: 'a' * 64 for n in c.PLATFORM_OVERLAY}
        with self.assertRaisesRegex(c.ReleaseError, 'NEW_MODULE_ALREADY_PRESENT'):
            c.check_delta('platform', old, after)

    def test_protocol_change_cannot_hide_behind_new_bundle_hash(self):
        def probe(target, python):
            result = self.probe(target, python)
            if target.name == 'native':
                result['versions']['runtime_contract_version'] = '999'
            return result
        with self.assertRaisesRegex(c.ReleaseError, 'RUNTIME_PROTOCOL_CHANGED'):
            self.build(probe=probe)
        self.assert_no_partial()

    def test_read_surface_pin_change_blocks(self):
        def probe(target, python):
            result = self.probe(target, python)
            if target.name == 'native':
                result['read_surface_pin'] = '0' * 64
            return result
        with self.assertRaisesRegex(c.ReleaseError, 'READ_SURFACE_PIN_CHANGED'):
            self.build(probe=probe)
        self.assert_no_partial()

    def test_node_substitution_is_refused_before_build(self):
        (self.env / 'node').write_bytes(b'different interpreter')
        with self.assertRaisesRegex(c.ReleaseError, 'ENVIRONMENT_CHANGED:node'):
            self.build()
        self.assert_no_partial()

    def test_plan_hash_and_scope_are_separate_guards(self):
        with self.assertRaisesRegex(c.ReleaseError, 'PLAN_HASH_CHANGED'):
            b.build(self.source, self.raw, '0' * 64, self.out)
        plan = deepcopy(self.plan)
        plan['source_files']['products/alisa/credentials.py'] = 'a' * 64
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_SCOPE'):
            c.check_plan(plan, self.spec, b.tool_hashes())

    def test_preserved_source_dependency_drift_cannot_get_a_new_plan(self):
        path = self.source / c.SOURCE_PLATFORM / 'owner_data/owner_inputs.py'
        path.write_text('CHANGED = True\n')
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_BASE_COMPATIBILITY_REQUIRED'):
            b.make_plan(self.source, 'd' * 40)
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_CHANGED'):
            self.build()

    def test_parameter_resolution_must_match_both_retaining_platform_roles(self):
        hashes = deepcopy(self.plan['source_files'])
        hashes[c.SOURCE_PLATFORM + 'owner_data/parameter_resolution.py'] = 'd' * 64
        _, bases, _ = b.snapshot(self.spec)
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_BASE_COMPATIBILITY_REQUIRED'):
            c.check_compatibility(hashes, bases, self.review)

    def test_native_shared_contract_must_equal_exact_source(self):
        _, bases, _ = b.snapshot(self.spec)
        bases['native']['files']['parameter_support/parameter_contract.py'] = 'd' * 64
        with self.assertRaisesRegex(c.ReleaseError, 'NATIVE_SUPPORT_COMPATIBILITY_REQUIRED'):
            c.check_compatibility(self.plan['source_files'], bases, self.review)

    def test_preserved_exception_pins_role_and_both_hashes(self):
        _, bases, _ = b.snapshot(self.spec)
        name = 'accounts/views.py'
        bases['platform']['files'][c.PLATFORM + name] = 'd' * 64
        review = deepcopy(self.review)
        review['preserved_differences'] = [{'role': 'platform', 'path': name,
            'base_sha256': 'd' * 64, 'source_sha256': self.plan['source_files'][c.SOURCE_PLATFORM + name],
            'reason': 'synthetic separately accepted parallel file'}]
        c.check_compatibility(self.plan['source_files'], bases, review)
        for field in ('source_sha256', 'base_sha256'):
            wrong = deepcopy(review)
            wrong['preserved_differences'][0][field] = '0' * 64
            with self.assertRaisesRegex(c.ReleaseError, 'COMPATIBILITY_EXCEPTION_CHANGED'):
                c.check_compatibility(self.plan['source_files'], bases, wrong)
        bases['authority']['files'][c.PLATFORM + name] = 'd' * 64
        with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_BASE_COMPATIBILITY_REQUIRED:authority'):
            c.check_compatibility(self.plan['source_files'], bases, review)

    def test_new_project_import_is_not_implicitly_preserved(self):
        blobs, _ = b.source_bytes(self.source)
        for code in (b'from alisa_platform.new_unreviewed import code\n',
                     b'from alisa_platform.owner_data import unreviewed_new_module\n',
                     b'from ..owner_data import unreviewed_new_module\n'):
            with self.subTest(code=code):
                blobs[c.SOURCE_PLATFORM + 'owner_data/economics_query.py'] = code
                with self.assertRaisesRegex(c.ReleaseError, 'SOURCE_DEPENDENCY_UNDECLARED'):
                    c.check_source_imports(blobs)

    def test_full_copy_requires_the_existing_rollout_space_reserve(self):
        self.space_patch.stop()
        _, bases, sizes = b.snapshot(self.spec)
        blobs, _ = b.source_bytes(self.source)
        fs = SimpleNamespace(f_frsize=4096, f_bavail=8000000, f_favail=9000000)
        with patch.object(b.os, 'statvfs', return_value=fs):
            budget = b.space_budget(self.root, bases, sizes, blobs)
            self.assertEqual(budget['minimum_free_bytes_after'], 3 * 1024**3)
            fs.f_bavail = (budget['required_bytes_upper_bound'] + 3 * 1024**3 - 1) // 4096
            with self.assertRaisesRegex(c.ReleaseError, 'BUILD_DISK_RESERVE'):
                b.space_budget(self.root, bases, sizes, blobs)

    def test_whole_file_replacement_requires_exact_before_after_review(self):
        _, bases, _ = b.snapshot(self.spec)
        for name in c.EXISTING_PLATFORM:
            wrong = deepcopy(self.review)
            wrong['replacement_deltas'][name]['source_sha256'] = '0' * 64
            with self.subTest(path=name, side='source'):
                with self.assertRaisesRegex(c.ReleaseError, 'REPLACEMENT_SOURCE_CHANGED'):
                    c.check_compatibility(self.plan['source_files'], bases, wrong)
            for role in ('platform', 'authority'):
                wrong = deepcopy(self.review)
                wrong['replacement_deltas'][name]['base_sha256'][role] = '0' * 64
                with self.subTest(path=name, side=role):
                    with self.assertRaisesRegex(c.ReleaseError, 'REPLACEMENT_BASE_CHANGED:' + role):
                        c.check_compatibility(self.plan['source_files'], bases, wrong)

    def test_direct_copy_must_match_source_even_inside_allowed_scope(self):
        for name in ('other_source_runtime.py', 'model_program.py'):
            with self.subTest(path=name):
                def mutate(target, source):
                    self.native(target, source)
                    (target / name).write_bytes(b'wrong but allowlisted')
                with self.assertRaisesRegex(c.ReleaseError, 'DIRECT_SOURCE_OUTPUT_CHANGED'):
                    self.build(apply=mutate)
                self.assert_no_partial()

    def test_existing_target_is_not_reused_or_deleted(self):
        self.out.mkdir()
        (self.out / 'parallel').write_text('preserve')
        with self.assertRaisesRegex(c.ReleaseError, 'NEW_STAGING_OUTPUT_REQUIRED'):
            self.build()
        self.assertEqual((self.out / 'parallel').read_text(), 'preserve')

    def test_atomic_publish_refuses_new_empty_target_and_keeps_it(self):
        original = b.publish_noreplace
        def competing_writer(source, output):
            output.mkdir()
            return original(source, output)
        with patch.object(b, 'publish_noreplace', side_effect=competing_writer):
            with self.assertRaisesRegex(c.ReleaseError, 'OUTPUT_ALREADY_EXISTS'):
                self.build()
        self.assertTrue(self.out.is_dir())
        self.assertEqual(list(self.root.glob('.candidate-*')), [])

    def test_symlink_and_fifo_cannot_be_regular_files(self):
        link = self.root / 'symlink'
        link.symlink_to(self.root / 'publisher.py')
        with self.assertRaises(OSError):
            b.regular(self.root, link.name)
        fifo = self.root / 'fifo'
        os.mkfifo(fifo)
        with self.assertRaisesRegex(c.ReleaseError, 'REGULAR_FILE_REQUIRED'):
            b.regular(self.root, fifo.name)

    def test_parent_symlink_cannot_escape_root(self):
        (self.root / 'escape').symlink_to(self.env, target_is_directory=True)
        with self.assertRaises(OSError):
            b.regular(self.root, 'escape/node')

    def test_service_probe_uses_only_safe_metadata_and_actual_process_cwd(self):
        pointer = self.root / 'native-current'
        pointer.symlink_to(Path.cwd(), target_is_directory=True)
        spec = {'bases': {'native': {'root': str(Path.cwd())}}, 'live_references': {
            'pointers': {'native': str(pointer)},
            'services': {'native': {'unit': 'owned-test.service', 'unit_cwd_suffix': '',
                                    'process_cwd_suffix': ''}}}}
        text = f'WorkingDirectory={Path.cwd()}\nMainPID={os.getpid()}\nActiveState=active\nSubState=running\n'
        # Unpatch only this helper; subprocess itself remains a deterministic fake.
        self.live.stop()
        with patch.object(b.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=text)) as run:
            result = b.live_references(spec)
            self.assertEqual(result['services']['native']['state'], 'active/running')
            self.assertNotIn('Environment', run.call_args.args[0])
            run.return_value.stdout = text.replace(str(Path.cwd()), str(self.env))
            with self.assertRaisesRegex(c.ReleaseError, 'LIVE_SERVICE_BASE_CHANGED'):
                b.live_references(spec)

    def test_manifest_escape_and_duplicate_json_keys_fail_closed(self):
        with self.assertRaisesRegex(c.ReleaseError, 'MANIFEST_LINK_ESCAPE'):
            c.manifest_shape({'files': {'safe': 'a' * 64}, 'links': {'link': '../../outside'}})
        with self.assertRaises(c.ReleaseError):
            c.strict_json(b'{"files":{},"files":{"rogue":"hash"}}')

    def test_prepared_receipt_and_extra_candidate_file_are_verified(self):
        result = self.build()
        with self.assertRaisesRegex(c.ReleaseError, 'PREPARED_RECEIPT_CHANGED'):
            b.verify_prepared(self.out, '0' * 64)
        native = self.out / 'releases/native'
        native.chmod(0o755)
        (native / 'unlisted.py').write_text('unexpected')
        with self.assertRaisesRegex(c.ReleaseError, 'CANDIDATE_EXTRA_FILE'):
            b.verify_prepared(self.out, c.digest(c.encoded(result)))

    def test_rollback_only_recognizes_before_or_this_candidate(self):
        result = self.build()
        before, ours = result['rollback_before'], result['rollback_candidate']
        self.assertTrue(c.rollback_allowed(before, ours, before))
        mixed = {**before, 'native': ours['native']}
        self.assertTrue(c.rollback_allowed(before, ours, mixed))
        with self.assertRaisesRegex(c.ReleaseError, 'ROLLBACK_LATER_WRITER:native'):
            c.rollback_allowed(before, ours, {**mixed, 'native': {**ours['native'], 'manifest_sha256': '0' * 64}})
        with self.assertRaisesRegex(c.ReleaseError, 'PRESERVED_COMPONENT_CHANGED'):
            c.rollback_allowed(before, {**ours, 'publisher': {**ours['publisher'], 'sha256': '0' * 64}}, before)


class LiveReferencePaths(unittest.TestCase):
    """Observed four-role cwd shape, reproduced locally without service calls."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='r15-service-paths-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        descriptors = deepcopy(b.baseline()['live_references']['services'])
        self.spec = {'bases': {}, 'live_references': {'pointers': {}, 'services': descriptors}}
        self.unit_cwds, self.process_cwds, self.pid_roles = {}, {}, {}
        self.units = {v['unit']: role for role, v in descriptors.items()}
        self.pids = {role: str(990001 + i) for i, role in enumerate(descriptors)}
        for role, descriptor in descriptors.items():
            base = self.root / ('release-' + role)
            base.mkdir()
            self.spec['bases'][role] = {'root': str(base)}
            unit_cwd = base / descriptor['unit_cwd_suffix']
            process_cwd = base / descriptor['process_cwd_suffix']
            unit_cwd.mkdir(parents=True, exist_ok=True)
            process_cwd.mkdir(parents=True, exist_ok=True)
            if role in ('native', 'web'):
                pointer = self.root / (role + '-current')
                pointer.symlink_to(base, target_is_directory=True)
                self.spec['live_references']['pointers'][role] = str(pointer)
                unit_cwd = pointer
            self.unit_cwds[role] = unit_cwd
            self.process_cwds[role] = process_cwd
            self.pid_roles['/proc/' + self.pids[role] + '/cwd'] = role
        resolve = Path.resolve

        def process_path(path, *args, **kwargs):
            role = self.pid_roles.get(str(path))
            return resolve(self.process_cwds[role] if role else path, *args, **kwargs)

        def service_metadata(args, **kwargs):
            role = self.units[args[2]]
            self.assertEqual(args, ['systemctl', 'show', args[2], '-p', 'WorkingDirectory',
                                   '-p', 'MainPID', '-p', 'ActiveState', '-p', 'SubState'])
            return SimpleNamespace(returncode=0, stdout=(
                f'WorkingDirectory={self.unit_cwds[role]}\nMainPID={self.pids[role]}\n'
                'ActiveState=active\nSubState=running\n'))

        self.resolve_patch = patch.object(Path, 'resolve', new=process_path)
        self.resolve_patch.start()
        self.addCleanup(self.resolve_patch.stop)
        self.run_patch = patch.object(b.subprocess, 'run', side_effect=service_metadata)
        self.run_patch.start()
        self.addCleanup(self.run_patch.stop)

    def test_observed_unit_and_process_cwds_are_independently_pinned(self):
        expected = {'platform': ('', ''), 'authority': ('services/platform', 'services/platform'),
                    'native': ('', ''), 'web': ('', 'ui/web/apps/web')}
        result = b.live_references(self.spec)
        for role, (unit_suffix, process_suffix) in expected.items():
            base = Path(self.spec['bases'][role]['root'])
            descriptor = self.spec['live_references']['services'][role]
            self.assertEqual((descriptor['unit_cwd_suffix'], descriptor['process_cwd_suffix']),
                             (unit_suffix, process_suffix))
            self.assertEqual(result['services'][role], {
                'unit': descriptor['unit'], 'unit_cwd': str(base / unit_suffix),
                'process_cwd': str(base / process_suffix), 'state': 'active/running'})

    def test_wrong_unit_cwd_fails_even_inside_the_pinned_web_release(self):
        self.unit_cwds['web'] = self.process_cwds['web']
        with self.assertRaisesRegex(c.ReleaseError, 'LIVE_SERVICE_BASE_CHANGED:web'):
            b.live_references(self.spec)

    def test_wrong_process_cwd_fails_for_release_root_and_matching_prefix(self):
        base = Path(self.spec['bases']['web']['root'])
        sibling = base / 'ui/web/apps/web-parallel'
        sibling.mkdir()
        for wrong in (base, sibling):
            with self.subTest(wrong=wrong):
                self.process_cwds['web'] = wrong
                with self.assertRaisesRegex(c.ReleaseError, 'LIVE_SERVICE_BASE_CHANGED:web'):
                    b.live_references(self.spec)


class NativeSourceChain(unittest.TestCase):
    def test_actual_source_prepare_chain_preserves_r5_catalog_and_probe_boundary(self):
        self._actual_source_prepare_chain(wb_activity=False)

    def test_actual_wb_activity_source_prepare_chain_preserves_all_existing_templates(self):
        self._actual_source_prepare_chain(wb_activity=True)

    def _actual_source_prepare_chain(self, *, wb_activity):
        """Real prepare chain with exact legacy or observed WB input bytes."""
        repo = HERE.parents[4]
        blobs, hashes = b.source_bytes(repo)
        c.check_source_imports(blobs)
        fixture = repo / 'products/alisa/tests/current_parameters/native_fixture'
        manifest = c.strict_json((fixture / 'MANIFEST.json').read_bytes())
        archive = fixture / 'qualified_core_source.tar.gz'
        self.assertEqual(c.digest(archive.read_bytes()), manifest['archive_sha256'])
        with tempfile.TemporaryDirectory(prefix='r15-native-package-source-') as name:
            target = Path(name) / 'native'
            target.mkdir()
            with tarfile.open(archive, 'r:gz') as tar:
                members = tar.getmembers()
                self.assertEqual({m.name for m in members}, set(manifest['files']))
                for member in members:
                    self.assertTrue(member.isfile() and c.safe_path(member.name))
                    raw = tar.extractfile(member).read()
                    self.assertEqual(c.digest(raw), manifest['files'][member.name])
                    b.write_new(target / member.name, raw)
            platform = repo / c.SOURCE_PLATFORM / 'owner_data'
            with patch.object(sys, 'dont_write_bytecode', True):
                for version in ('current_parameters_r4', 'current_parameters_r5'):
                    p = repo / c.RUNTIME / version / 'prepare_candidate.py'
                    spec = importlib.util.spec_from_file_location('test_' + version, p)
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)
                    module.prepare(target) if version.endswith('r5') else module.prepare(target, platform)
            pinned = c.strict_json((repo / c.RUNTIME / 'current_parameters_r8/BASELINE.json').read_bytes())
            for path, h in pinned.items():
                self.assertEqual(c.digest((target / path).read_bytes()), h)
            self.assertEqual(c.digest((target / 'read_surface.py').read_bytes()),
                             '4a8d913906afea360a275c75343db25736141e215f42a2a967bab450de2271a1')
            if wb_activity:
                import json
                blocks_path = target / 'base_blocks.json'
                catalog_path = target / 'template_catalog.json'
                old_blocks = blocks_path.read_bytes()
                old_catalog = catalog_path.read_bytes()
                blocks = c.strict_json(old_blocks)
                value = c.strict_json(old_catalog)
                self.assertEqual(c.digest(blocks_path.read_bytes()),
                    'd96af17568ae241c530ee2a0b22a8b645871bd550b456809f8756e366b37f292')
                changed = []
                for entry in blocks['entries']:
                    if entry['id'] in ('B14.card_views', 'B14.cart_additions'):
                        self.assertEqual(entry['time_axis'], 'order_period')
                        entry['time_axis'] = 'analytics_period'
                        changed.append(entry['id'])
                self.assertEqual(set(changed), {'B14.card_views', 'B14.cart_additions'})
                for tid in changed:
                    self.assertEqual(value['templates'][tid]['version'], 1)
                    self.assertEqual(value['templates'][tid]['input_policy']['time_axis'], 'order_period')
                    value['templates'][tid]['version'] = 2
                    value['templates'][tid]['input_policy']['time_axis'] = 'analytics_period'
                blocks_path.write_text(json.dumps(blocks, ensure_ascii=False, indent=2) + '\n')
                catalog_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
                self.assertEqual(c.digest(blocks_path.read_bytes()),
                    'ab0be86975ee62a11301741d389f8fd431873b583159d55a04737342b8ecad05')
                self.assertEqual(c.digest(catalog_path.read_bytes()),
                    'f17710716c186396869b4868a9d1650972414ccceaeba023e6c0ef1a8d0a933e')
                new_catalog, new_blocks = catalog_path.read_bytes(), blocks_path.read_bytes()
                script = repo / c.RUNTIME / 'current_parameters_r8/prepare_candidate.py'
                spec = importlib.util.spec_from_file_location('test_r8_wb_input_contract', script)
                r8 = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(r8)
                # Every mismatched pair or extra mutation must fail BEFORE copy/write.
                for bad_catalog, bad_blocks in ((old_catalog, new_blocks),
                        (new_catalog, old_blocks), (new_catalog+b' ', new_blocks),
                        (new_catalog, new_blocks+b' ')):
                    with self.subTest(catalog=c.digest(bad_catalog), blocks=c.digest(bad_blocks)):
                        catalog_path.write_bytes(bad_catalog); blocks_path.write_bytes(bad_blocks)
                        before_files = b.file_hashes(target)
                        with patch.object(r8.shutil, 'copy2') as copied:
                            with self.assertRaisesRegex(AssertionError, 'BASELINE_CATALOG_PAIR'):
                                r8.prepare(target, platform)
                        copied.assert_not_called()
                        self.assertEqual(b.file_hashes(target), before_files)
                catalog_path.write_bytes(new_catalog); blocks_path.write_bytes(new_blocks)
                engine = target / 'engine.py'; engine_raw = engine.read_bytes()
                engine.write_bytes(engine_raw+b'\n# unexpected executable change\n')
                before_files = b.file_hashes(target)
                with patch.object(r8.shutil, 'copy2') as copied:
                    with self.assertRaisesRegex(AssertionError, 'BASELINE_CHANGED'):
                        r8.prepare(target, platform)
                copied.assert_not_called()
                self.assertEqual(b.file_hashes(target), before_files)
                engine.write_bytes(engine_raw)
            preserved_blocks = (target / 'base_blocks.json').read_bytes()
            catalog = c.strict_json((target / 'template_catalog.json').read_bytes())
            old_probe = b.native_probe(target, sys.executable)
            # Match build(): the prepares see only the declared staged inputs,
            # never undeclared files that happen to exist in a full checkout.
            source = Path(name) / 'source'
            for path, raw in blobs.items():
                b.write_new(source / path, raw, 0o444)
            b.apply_native(target, source)
            consumer = c.RUNTIME + 'current_parameters_r8/program_recovery/model_program.py'
            self.assertEqual(c.digest((target / 'model_program.py').read_bytes()), hashes[consumer])
            c.check_catalog(catalog, c.strict_json((target / 'template_catalog.json').read_bytes()))
            probe = b.native_probe(target, sys.executable)
            self.assertEqual(old_probe['read_surface_pin'], probe['read_surface_pin'])
            self.assertNotEqual(old_probe['parameter_sources_pin'], probe['parameter_sources_pin'])
            self.assertTrue(c.sha(probe['economics_composites_pin']))
            self.assertFalse(any(target.rglob('__pycache__')))
            self.assertEqual((target / 'base_blocks.json').read_bytes(), preserved_blocks)
            if wb_activity:
                actual = c.strict_json((target / 'template_catalog.json').read_bytes())
                for tid in ('B14.card_views', 'B14.cart_additions'):
                    self.assertEqual(actual['templates'][tid], catalog['templates'][tid])




class NativeCoreProvenance(unittest.TestCase):
    def setUp(self):
        self.before = {'file-%03d.py' % i: 'a'*64 for i in range(181)}
        self.before.update({name: old for name, (old, _) in c.WB_CORE_METADATA_DELTA.items()})
        self.after = {**self.before, **{name: new for name, (_, new) in c.WB_CORE_METADATA_DELTA.items()}}
        self.core = {'files': self.before}
        self.manifest = {'files': {**self.after, 'CURRENT_CORE_MANIFEST.json': c.WB_CORE_PROVENANCE_SHA256}}

    def test_exact_legacy_current_core_still_accepted(self):
        self.assertEqual(c.check_native_core_provenance(self.core, {'files': self.before}), 'EXACT_CURRENT_CORE')

    def test_only_exact_frozen_core_and_complete_metadata_pair_accepted(self):
        self.assertEqual(c.check_native_core_provenance(self.core, self.manifest), 'PINNED_WB_METADATA_OVERLAY')
        for name in ('base_blocks.json', 'template_catalog.json', 'CURRENT_CORE_MANIFEST.json'):
            with self.subTest(name=name):
                bad = deepcopy(self.manifest); bad['files'][name] = 'b'*64
                with self.assertRaisesRegex(c.ReleaseError, 'CORE_MANIFEST_MISMATCH'):
                    c.check_native_core_provenance(self.core, bad)

    def test_other_executable_change_addition_or_deletion_is_refused(self):
        for mutation in ('change', 'add', 'delete'):
            with self.subTest(mutation=mutation):
                bad = deepcopy(self.manifest)
                if mutation == 'change': bad['files']['file-000.py'] = 'b'*64
                if mutation == 'add': bad['files']['new.py'] = 'b'*64
                if mutation == 'delete': del bad['files']['file-000.py']
                with self.assertRaisesRegex(c.ReleaseError, 'CORE_MANIFEST_MISMATCH'):
                    c.check_native_core_provenance(self.core, bad)

    def test_unrelated_or_partial_provenance_is_refused(self):
        for name in ('base_blocks.json', 'template_catalog.json'):
            bad = deepcopy(self.core); bad['files'][name] = 'f'*64
            with self.assertRaisesRegex(c.ReleaseError, 'CORE_MANIFEST_MISMATCH'):
                c.check_native_core_provenance(bad, self.manifest)

if __name__ == '__main__':
    unittest.main()
