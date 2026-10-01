"""Trusted capability preparation. No product checks, DB access or service startup."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

NODE_VERSION = '24.20.0'
PNPM_VERSION = '10.34.5'
NODE_BIN = Path('/root/.nvm/versions/node/v24.20.0/bin')
CONTROL = Path('/root/octoport-control')
STORE = Path('/root/.local/share/pnpm/store')
MIN_FREE_BYTES = 2 * 1024**3
MAX_OUTPUT_BYTES = 2 * 1024**2
ROOT_INPUTS = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')
CAPABILITIES = {'python-stdlib', 'node-stdlib', 'node-workspace', 'chromium-local'}
BUILDS = {name + '-build': name for name in
          ('api', 'worker', 'health-runner', 'portal', 'admin', 'telegram-operator')}


class Blocked(Exception):
    def __init__(self, reason, **evidence):
        super().__init__(reason)
        self.reason, self.evidence = reason, evidence


def _sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(128 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _inside(root, relative):
    p = Path(relative)
    if p.is_absolute() or not p.parts or any(x in ('..', '.') for x in p.parts):
        raise Blocked('UNSAFE_RELATIVE_PATH')
    target = root / p
    if not target.resolve().is_relative_to(root):
        raise Blocked('PATH_OUTSIDE_WORKTREE')
    return target


def _root(worktree):
    path = Path(worktree)
    if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
        raise Blocked('UNSAFE_WORKTREE')
    if not path.is_relative_to(CONTROL / 'worktrees') or len(path.relative_to(CONTROL / 'worktrees').parts) != 2:
        raise Blocked('ISOLATED_WORKTREE_REQUIRED')
    if path.relative_to(CONTROL / 'worktrees').parts[0] not in ('A', 'B', 'C'):
        raise Blocked('ISOLATED_WORKTREE_REQUIRED')
    if not path.is_dir() or not (path / '.git').exists():
        raise Blocked('GIT_WORKTREE_REQUIRED')
    return path


def _verify(root, hashes, required=()):
    if not isinstance(hashes, dict) or any(p not in hashes for p in required):
        raise Blocked('SOURCE_HASHES_REQUIRED')
    for relative, expected in hashes.items():
        if not isinstance(relative, str) or not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
            raise Blocked('INVALID_SOURCE_HASH')
        path = _inside(root, relative)
        if path.is_symlink() or not path.is_file() or _sha(path) != expected:
            raise Blocked('SOURCE_CHANGED', path=relative)


def _managed_job():
    try:
        text = Path('/proc/self/cgroup').read_text()
        match = re.search(r'/octoport-test-([abc])-([0-9a-f]{32})\.service(?:/|$)', text, re.M)
        if not match:
            raise Blocked('RESOURCE_RUNNER_REQUIRED')
        job_id = match.group(2)
        receipt = json.loads((CONTROL / 'resource-jobs' / job_id / 'receipt.json').read_text())
        if receipt.get('id') != job_id or receipt.get('state') not in {'STARTING', 'RUNNING'}:
            raise Blocked('RESOURCE_RUNNER_REQUIRED')
        if not 1 <= receipt.get('timeout_seconds', 0) <= 14400 or receipt.get('memory_mib', 0) < 64:
            raise Blocked('RESOURCE_BUDGET_REQUIRED')
        return job_id
    except (OSError, ValueError, TypeError):
        raise Blocked('RESOURCE_RUNNER_REQUIRED') from None


def _execution_env():
    # No product DB/session/credential variables are inherited by preparation.
    env = {k: os.environ[k] for k in ('HOME', 'LANG', 'LC_ALL', 'TMPDIR') if k in os.environ}
    env.update(PATH=str(NODE_BIN) + ':/usr/local/bin:/usr/bin:/bin', CI='true',
               npm_config_update_notifier='false', PNPM_DISABLE_SELF_UPDATE_CHECK='true')
    return env


def _run(argv, root, env, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise Blocked('ENVIRONMENT_DEADLINE')
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT, shell=False)
        except OSError:
            raise Blocked('ENVIRONMENT_TOOL_UNAVAILABLE') from None
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise Blocked('ENVIRONMENT_DEADLINE')
                if os.fstat(output.fileno()).st_size > MAX_OUTPUT_BYTES:
                    raise Blocked('ENVIRONMENT_OUTPUT_LIMIT')
                time.sleep(0.02)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
        size = os.fstat(output.fileno()).st_size
        if size > MAX_OUTPUT_BYTES:
            raise Blocked('ENVIRONMENT_OUTPUT_LIMIT')
        output.seek(max(0, size - 16384))
        return process.returncode, output.read().decode('utf-8', errors='replace')


def _version(argv, expected, root, env, deadline):
    code, output = _run(argv, root, env, min(deadline, time.monotonic() + 10))
    if code or output.strip().lstrip('v') != expected:
        raise Blocked('ENVIRONMENT_VERSION_MISMATCH', tool=Path(argv[0]).name, expected=expected)


def _dependency_links(root, deadline):
    # pnpm links may point within this worktree; hard-linked store content is fine.
    count = 0
    for current, directories, files in os.walk(root, followlinks=False):
        if time.monotonic() >= deadline:
            raise Blocked('ENVIRONMENT_DEADLINE')
        current = Path(current)
        if current == root:
            directories[:] = [p for p in directories if p not in ('.git', '.next')]
        if 'node_modules' not in current.parts:
            directories[:] = [p for p in directories if p not in ('.git', 'dist', '.next')]
        for name in directories + files:
            path = current / name
            if name == 'node_modules' or 'node_modules' in path.parts:
                count += 1
                if count > 250000:
                    raise Blocked('ENVIRONMENT_SCAN_LIMIT')
                if path.is_symlink() and (name == 'node_modules' or not path.resolve().is_relative_to(root)):
                    raise Blocked('CROSS_WORKTREE_DEPENDENCY_LINK')


def _prepare_workspace(root, req, env, deadline, hashes):
    if shutil.disk_usage(root).free < MIN_FREE_BYTES:
        raise Blocked('ENVIRONMENT_DISK_LOW', minimum_free_bytes=MIN_FREE_BYTES)
    _dependency_links(root, deadline)
    signature = {p: hashes[p] for p in ROOT_INPUTS}
    marker = root / 'node_modules' / '.octoport-environment.json'
    if marker.is_symlink():
        raise Blocked('DEPENDENCY_MARKER_SYMLINK')
    expected = {'node': NODE_VERSION, 'pnpm': PNPM_VERSION, 'inputs': signature}
    try:
        ready = json.loads(marker.read_text()) == expected
    except (OSError, ValueError):
        ready = False
    if not ready:
        if not req.get('allow_install', False):
            raise Blocked('ENVIRONMENT_DEPENDENCIES_NOT_PREPARED')
        offline = req.get('offline', True)
        if offline and (not STORE.is_dir() or not any(STORE.iterdir())):
            raise Blocked('ENVIRONMENT_CACHE_MISSING')
        argv = ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts',
                '--store-dir', str(STORE), '--modules-dir', 'node_modules',
                '--virtual-store-dir', 'node_modules/.pnpm']
        if offline:
            argv.append('--offline')
        _verify(root, hashes, ROOT_INPUTS)
        code, output = _run(argv, root, env, deadline)
        if code:
            if 'ERR_PNPM_NO_OFFLINE_TARBALL' in output or 'ERR_PNPM_NO_OFFLINE_META' in output:
                raise Blocked('ENVIRONMENT_CACHE_MISSING')
            if any(x in output for x in ('ENOSPC', 'No space left')):
                raise Blocked('ENVIRONMENT_DISK_LOW')
            if any(x in output for x in ('ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN')):
                raise Blocked('ENVIRONMENT_NETWORK_UNAVAILABLE')
            raise Blocked('ENVIRONMENT_INSTALL_FAILED', exit_code=code)
        _verify(root, hashes, ROOT_INPUTS)
        _dependency_links(root, deadline)
        if not (root / 'node_modules').is_dir():
            raise Blocked('ENVIRONMENT_INSTALL_INCOMPLETE')
        marker.write_text(json.dumps(expected, sort_keys=True) + '\n')
    code, _ = _run(['node', '-e', "for (const p of ['vitest/package.json','tsx/package.json']) require.resolve(p)"], root, env, deadline)
    if code:
        raise Blocked('ENVIRONMENT_DEPENDENCY_PROBE_FAILED')


def ensure_environment(worktree, requirements, *, managed=True):
    """Run only immutable catalog capabilities; BLOCKED never claims a product failure."""
    evidence = {'scope': 'ENVIRONMENT_PREFLIGHT', 'product_check_executed': False}
    try:
        root = _root(worktree)
        if not isinstance(requirements, dict):
            raise Blocked('INVALID_ENVIRONMENT_REQUIREMENTS')
        req = requirements
        allowed = {'capability', 'source_sha256', 'allow_install', 'offline', 'prerequisites', 'deadline_seconds'}
        if set(req) - allowed or req.get('capability') not in CAPABILITIES:
            raise Blocked('UNKNOWN_ENVIRONMENT_CAPABILITY')
        if any(type(req[k]) is not bool for k in ('allow_install', 'offline') if k in req):
            raise Blocked('INVALID_ENVIRONMENT_REQUIREMENTS')
        seconds = req.get('deadline_seconds', 300)
        if type(seconds) is not int or not 1 <= seconds <= 3600:
            raise Blocked('INVALID_ENVIRONMENT_DEADLINE')
        deadline = time.monotonic() + seconds
        capability, hashes = req['capability'], req.get('source_sha256', {})
        prerequisites = req.get('prerequisites', [])
        if not isinstance(prerequisites, list) or any(x not in BUILDS for x in prerequisites):
            raise Blocked('UNKNOWN_BUILD_PREREQUISITE')
        if capability in {'python-stdlib', 'node-stdlib'} and prerequisites:
            raise Blocked('WORKSPACE_CAPABILITY_REQUIRED')
        _verify(root, hashes)
        if capability == 'python-stdlib':
            return {'status': 'READY', 'reason': None, 'evidence': evidence, 'execution_env': {}}
        env = _execution_env()
        _version(['node', '--version'], NODE_VERSION, root, env, deadline)
        evidence['node'] = NODE_VERSION
        if capability == 'node-stdlib':
            _verify(root, hashes)
            return {'status': 'READY', 'reason': None, 'evidence': evidence, 'execution_env': {'PATH': env['PATH']}}
        if not managed:
            raise Blocked('RESOURCE_RUNNER_REQUIRED')
        job_id = _managed_job()
        evidence['resource_job'] = job_id
        required = list(ROOT_INPUTS) + [f'apps/{BUILDS[p]}/package.json' for p in prerequisites]
        _verify(root, hashes, required)
        _version(['pnpm', '--version'], PNPM_VERSION, root, env, deadline)
        evidence['pnpm'] = PNPM_VERSION
        _prepare_workspace(root, req, env, deadline, hashes)
        for name in prerequisites:
            _verify(root, hashes, required)
            code, _ = _run(['pnpm', '--filter', '@product/' + BUILDS[name], 'build'], root, env, deadline)
            if code:
                raise Blocked('PREREQUISITE_BUILD_FAILED', prerequisite=name, exit_code=code)
        if capability == 'chromium-local':
            code, _ = _run(['node', '-e', "const f=require('node:fs'); const p=require('@playwright/test').chromium.executablePath(); if(!f.existsSync(p))process.exit(42)"], root, env, deadline)
            if code:
                raise Blocked('ENVIRONMENT_BROWSER_UNAVAILABLE')
        _verify(root, hashes, required)
        evidence['prerequisites'] = prerequisites
        return {'status': 'READY', 'reason': None, 'evidence': evidence, 'execution_env': {'PATH': env['PATH']}}
    except Blocked as error:
        evidence.update(error.evidence)
        return {'status': 'BLOCKED', 'reason': error.reason, 'evidence': evidence, 'execution_env': {}}
    except (OSError, ValueError, TypeError):
        return {'status': 'BLOCKED', 'reason': 'ENVIRONMENT_PREFLIGHT_ERROR', 'evidence': evidence, 'execution_env': {}}


def cleanup_environment(worktree, job_id):
    """Only remove the helper's named ephemeral directory after its cgroup ended.

    Dependencies, package stores, build outputs and historical evidence are retained.
    """
    try:
        root = _root(worktree)
        if not isinstance(job_id, str) or not re.fullmatch('[0-9a-f]{32}', job_id):
            raise Blocked('INVALID_RESOURCE_JOB')
        receipt = json.loads((CONTROL / 'resource-jobs' / job_id / 'receipt.json').read_text())
        if receipt.get('id') != job_id or receipt.get('state') != 'FINISHED' or receipt.get('cleanup_verified') is not True:
            raise Blocked('RESOURCE_LIFECYCLE_NOT_FINISHED')
        target = _inside(root, '.octoport-environment/' + job_id)
        if target.is_symlink():
            raise Blocked('CLEANUP_SYMLINK_REFUSED')
        existed = target.exists()
        if existed:
            marker = json.loads((target / 'owner.json').read_text())
            if marker != {'worktree': str(root), 'job_id': job_id, 'kind': 'environment-temporary'}:
                raise Blocked('CLEANUP_OWNERSHIP_UNPROVEN')
            shutil.rmtree(target)
        return {'status': 'READY', 'removed': existed}
    except (Blocked, OSError, ValueError, TypeError) as error:
        return {'status': 'BLOCKED', 'reason': getattr(error, 'reason', 'CLEANUP_PREFLIGHT_ERROR')}
