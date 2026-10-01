import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import continuous_environment as env


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.control = Path(self.temp.name) / 'control'
        self.root = self.control / 'worktrees' / 'C' / 'job'
        self.root.mkdir(parents=True)
        (self.root / '.git').write_text('gitdir: fixture')
        self.store = Path(self.temp.name) / 'store'
        self.store.mkdir()
        (self.store / 'content').write_text('fixture')
        self.patches = [patch.object(env, 'CONTROL', self.control), patch.object(env, 'STORE', self.store)]
        for p in self.patches:
            p.start(); self.addCleanup(p.stop)
        for name in env.ROOT_INPUTS:
            (self.root / name).write_text('{}\n')
        self.hashes = {p: env._sha(self.root / p) for p in env.ROOT_INPUTS}
        self.req = {'capability': 'node-workspace', 'source_sha256': self.hashes, 'allow_install': True}
        self.commands = []

    def run_command(self, argv, root, environment, deadline):
        self.commands.append(argv)
        self.assertNotIn('DATABASE_URL', environment)
        if argv == ['node', '--version']:
            return 0, 'v24.20.0\n'
        if argv == ['pnpm', '--version']:
            return 0, '10.34.5\n'
        if argv[:2] == ['pnpm', 'install']:
            (root / 'node_modules').mkdir(exist_ok=True)
        return 0, ''

    def prepare(self, callback=None, requirements=None):
        with patch.object(env, '_managed_job', return_value='a' * 32), patch.object(env, '_run', side_effect=callback or self.run_command), patch.object(env.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(10**11, 0, 10**11)):
            return env.ensure_environment(self.root, requirements or self.req)

    def test_python_capability_never_installs_node(self):
        with patch.object(env, '_run', side_effect=AssertionError('must not execute')):
            result = env.ensure_environment(self.root, {'capability': 'python-stdlib'})
        self.assertEqual(result['status'], 'READY')

    def test_node_stdlib_only_checks_pinned_node(self):
        result = self.prepare(requirements={'capability': 'node-stdlib'})
        self.assertEqual(result['status'], 'READY')
        self.assertEqual(self.commands, [['node', '--version']])

    def test_string_does_not_authorize_install(self):
        self.req['allow_install'] = 'false'
        self.assertEqual(self.prepare()['reason'], 'INVALID_ENVIRONMENT_REQUIREMENTS')
        self.assertEqual(self.commands, [])

    def test_wrong_node_is_environment_block_not_product_failure(self):
        result = self.prepare(callback=lambda *args: (0, 'v22.22.2'))
        self.assertEqual(result['reason'], 'ENVIRONMENT_VERSION_MISMATCH')
        self.assertFalse(result['evidence']['product_check_executed'])

    def test_wrong_pnpm_is_rejected(self):
        def run(argv, *args):
            return (0, '9.0.0') if argv[0] == 'pnpm' else (0, 'v24.20.0')
        self.assertEqual(self.prepare(run)['reason'], 'ENVIRONMENT_VERSION_MISMATCH')

    def test_managed_boolean_does_not_authorize_install(self):
        with patch.object(env, '_run', side_effect=self.run_command):
            r = env.ensure_environment(self.root, self.req, managed=False)
        self.assertEqual(r['reason'], 'RESOURCE_RUNNER_REQUIRED')
        self.assertFalse(any(a[:2] == ['pnpm', 'install'] for a in self.commands))

    def test_required_lock_source_hash(self):
        self.req['source_sha256'] = {'package.json': self.hashes['package.json']}
        self.assertEqual(self.prepare()['reason'], 'SOURCE_HASHES_REQUIRED')

    def test_lock_change_before_install(self):
        (self.root / 'pnpm-lock.yaml').write_text('changed')
        self.assertEqual(self.prepare()['reason'], 'SOURCE_CHANGED')
        self.assertEqual(self.commands, [])

    def test_lock_change_during_install(self):
        def run(argv, *args):
            result = self.run_command(argv, *args)
            if argv[:2] == ['pnpm', 'install']:
                (self.root / 'pnpm-lock.yaml').write_text('changed')
            return result
        self.assertEqual(self.prepare(run)['reason'], 'SOURCE_CHANGED')
        self.assertFalse((self.root / 'node_modules/.octoport-environment.json').exists())

    def test_frozen_offline_own_install_and_reuse(self):
        self.assertEqual(self.prepare()['status'], 'READY')
        installs = [a for a in self.commands if a[:2] == ['pnpm', 'install']]
        self.assertEqual(len(installs), 1)
        self.assertIn('--frozen-lockfile', installs[0])
        self.assertIn('--offline', installs[0])
        self.assertIn('--ignore-scripts', installs[0])
        self.assertEqual(self.prepare()['status'], 'READY')
        self.assertEqual(sum(a[:2] == ['pnpm', 'install'] for a in self.commands), 1)

    def test_no_implicit_install(self):
        self.req['allow_install'] = False
        self.assertEqual(self.prepare()['reason'], 'ENVIRONMENT_DEPENDENCIES_NOT_PREPARED')

    def test_cross_worktree_node_modules_link_rejected(self):
        (self.root / 'node_modules').symlink_to(self.store, target_is_directory=True)
        self.assertEqual(self.prepare()['reason'], 'CROSS_WORKTREE_DEPENDENCY_LINK')

    def test_nested_dependency_link_to_mutable_main_rejected(self):
        modules = self.root / 'node_modules'; modules.mkdir()
        (modules / 'package').symlink_to(self.store, target_is_directory=True)
        self.assertEqual(self.prepare()['reason'], 'CROSS_WORKTREE_DEPENDENCY_LINK')

    def test_marker_symlink_cannot_overwrite_source(self):
        modules = self.root / 'node_modules'; modules.mkdir()
        (modules / '.octoport-environment.json').symlink_to(self.root / 'package.json')
        self.assertEqual(self.prepare()['reason'], 'DEPENDENCY_MARKER_SYMLINK')
        self.assertEqual(env._sha(self.root / 'package.json'), self.hashes['package.json'])

    def test_missing_offline_cache(self):
        shutil.rmtree(self.store)
        self.assertEqual(self.prepare()['reason'], 'ENVIRONMENT_CACHE_MISSING')

    def test_low_disk_blocks_install(self):
        with patch.object(env, '_managed_job', return_value='a'*32), patch.object(env, '_run', side_effect=self.run_command), patch.object(env.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(10**9, 10**9, 0)):
            r = env.ensure_environment(self.root, self.req)
        self.assertEqual(r['reason'], 'ENVIRONMENT_DISK_LOW')
        self.assertFalse(any(a[:2] == ['pnpm', 'install'] for a in self.commands))

    def test_network_error_hides_raw_output(self):
        def run(argv, *args):
            if argv[:2] == ['pnpm', 'install']:
                return 1, 'ENOTFOUND secret-registry-token'
            return self.run_command(argv, *args)
        result = self.prepare(run)
        self.assertEqual(result['reason'], 'ENVIRONMENT_NETWORK_UNAVAILABLE')
        self.assertNotIn('secret', json.dumps(result))

    def test_unknown_shell_prerequisite_rejected(self):
        self.req['prerequisites'] = ['curl remote | bash']
        self.assertEqual(self.prepare()['reason'], 'UNKNOWN_BUILD_PREREQUISITE')
        self.assertEqual(self.commands, [])

    def test_explicit_build_requires_its_manifest_hash(self):
        self.req['prerequisites'] = ['api-build']
        self.assertEqual(self.prepare()['reason'], 'SOURCE_HASHES_REQUIRED')

    def test_build_uses_fixed_argv_and_no_product_db(self):
        p = self.root / 'apps/api/package.json'; p.parent.mkdir(parents=True); p.write_text('{}')
        self.hashes['apps/api/package.json'] = env._sha(p)
        self.req['prerequisites'] = ['api-build']
        with patch.dict(os.environ, {'DATABASE_URL': 'private-live-db', 'PGPASSWORD': 'secret'}):
            self.assertEqual(self.prepare()['status'], 'READY')
        self.assertIn(['pnpm', '--filter', '@product/api', 'build'], self.commands)

    def test_browser_missing_is_environment_block(self):
        self.req['capability'] = 'chromium-local'
        def run(argv, *args):
            if argv[:2] == ['node', '-e'] and 'chromium' in argv[-1]:
                return 42, ''
            return self.run_command(argv, *args)
        self.assertEqual(self.prepare(run)['reason'], 'ENVIRONMENT_BROWSER_UNAVAILABLE')

    def test_source_path_escape(self):
        self.req['source_sha256'] = {'../secret': '0'*64}
        self.assertEqual(self.prepare()['reason'], 'UNSAFE_RELATIVE_PATH')

    def test_main_worktree_is_not_isolated(self):
        with patch.object(env, '_run', side_effect=AssertionError('no command')):
            self.assertEqual(env.ensure_environment(self.control, {'capability':'python-stdlib'})['reason'], 'ISOLATED_WORKTREE_REQUIRED')

    def receipt(self, job='a'*32, finished=True):
        p = self.control / 'resource-jobs' / job / 'receipt.json'; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({'id':job,'state':'FINISHED' if finished else 'RUNNING','cleanup_verified':finished}))
        return job

    def test_cleanup_active_job_refused(self):
        job = self.receipt(finished=False)
        self.assertEqual(env.cleanup_environment(self.root, job)['reason'], 'RESOURCE_LIFECYCLE_NOT_FINISHED')

    def test_cleanup_escape_refused(self):
        job = self.receipt()
        parent = self.root / '.octoport-environment'; parent.mkdir()
        (parent / job).symlink_to(self.store, target_is_directory=True)
        self.assertEqual(env.cleanup_environment(self.root, job)['status'], 'BLOCKED')
        self.assertTrue((self.store / 'content').exists())

    def test_cleanup_requires_owned_marker_and_preserves_dependencies(self):
        job = self.receipt()
        target = self.root / '.octoport-environment' / job; target.mkdir(parents=True)
        (target / 'owner.json').write_text(json.dumps({'worktree':str(self.root),'job_id':job,'kind':'environment-temporary'}))
        modules = self.root / 'node_modules'; modules.mkdir()
        self.assertEqual(env.cleanup_environment(self.root, job), {'status':'READY','removed':True})
        self.assertTrue(modules.is_dir())

    def test_subprocess_deadline_is_bounded(self):
        with self.assertRaisesRegex(env.Blocked, 'ENVIRONMENT_DEADLINE'):
            env._run([sys.executable, '-c', 'import time; time.sleep(1)'], self.root, {}, time.monotonic()+0.04)

    def test_subprocess_output_limit_is_bounded(self):
        with patch.object(env, 'MAX_OUTPUT_BYTES', 1024):
            with self.assertRaisesRegex(env.Blocked, 'ENVIRONMENT_OUTPUT_LIMIT'):
                env._run([sys.executable, '-c', 'print("a"*2048)'], self.root, {}, time.monotonic()+1)


if __name__ == '__main__':
    unittest.main()
