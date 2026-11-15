"""Build new R15 release directories from the exact installed immutable bases.

No fixture archive, package manager, database, HTTP, service control, live config,
selector, migration or activation operation is provided. CLI plan is read-only;
build writes only its new output directory and its own private sibling staging.
"""
from pathlib import Path
from copy import deepcopy
import argparse
import ctypes
import errno
import importlib.util
import os
import shutil
import stat
import subprocess
import sys
import tempfile

import release_contract as c

HERE = Path(__file__).resolve().parent


def regular(root, name):
    """Open each relative component without following links; reject FIFOs/devices."""
    c.need(c.safe_path(name), 'UNSAFE_PATH')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = Path(name).parts
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            before = os.fstat(child)
            c.need(stat.S_ISREG(before.st_mode), 'REGULAR_FILE_REQUIRED:' + name)
            with os.fdopen(child, 'rb', closefd=False) as stream:
                raw = stream.read()
            after = os.fstat(child)
            c.need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                    before.st_ctime_ns) ==
                   (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                    after.st_ctime_ns), 'FILE_CHANGED_DURING_READ:' + name)
            return raw, stat.S_IMODE(before.st_mode)
        finally:
            os.close(child)
    finally:
        os.close(fd)


def directory(path):
    path = Path(path)
    c.need(path.is_absolute() and str(path) == os.path.normpath(str(path)), 'ABSOLUTE_CANONICAL_ROOT')
    for part in (path, *path.parents):
        c.need(stat.S_ISDIR(part.lstat().st_mode), 'DIRECTORY_WITHOUT_SYMLINK_REQUIRED')
    return path


def read_file(path):
    path = Path(path)
    directory(path.parent)
    return regular(path.parent, path.name)


def tool_hashes():
    return {n: c.digest(regular(HERE, n)[0]) for n in c.TOOL_FILES}


def baseline():
    return c.strict_json(regular(HERE, 'baseline_20261115.json')[0])


def compatibility_review():
    return c.strict_json(regular(HERE, 'compatibility_review.json')[0])


def verify_manifest(root, expected):
    root = directory(root)
    raw = regular(root, 'manifest.json')[0]
    c.need(c.digest(raw) == expected, 'BASE_MANIFEST_CHANGED')
    manifest = c.manifest_shape(c.strict_json(raw))
    size = 0
    for name, h in manifest['files'].items():
        data, _ = regular(root, name)
        c.need(c.digest(data) == h, 'BASE_FILE_CHANGED:' + name)
        size += len(data)
    for name, target in manifest.get('links', {}).items():
        path = root / name
        directory(path.parent)
        c.need(path.is_symlink() and os.readlink(path) == target
               and path.resolve(strict=True).is_relative_to(root), 'BASE_LINK_CHANGED:' + name)
    return manifest, size


def snapshot(spec):
    """Full source-file integrity plus only approved environment/helper metadata."""
    manifests, sizes, observed = {}, {}, {'bases': {}, 'publisher': {}, 'environment': {}, 'live_references': {}}
    env = spec['environment']
    for role in c.ROLES:
        entry = spec['bases'][role]
        root = Path(entry['root'])
        m, size = verify_manifest(root, entry['manifest_sha256'])
        manifests[role], sizes[role] = m, size
        item = {'root': str(root), 'manifest_sha256': entry['manifest_sha256']}
        if role != 'native':
            venv = root / '.venv'
            c.need(venv.is_symlink() and os.readlink(venv) == entry['venv_link']
                   and str(venv.resolve(strict=True)) == env['venv_root'], 'VENV_BINDING_CHANGED')
            c.need(m.get('locks') == env['locks']
                   and all(m['files'].get(n) == h for n, h in env['locks'].items()), 'DEPENDENCY_LOCK_CHANGED')
            item['venv_link'] = entry['venv_link']
        observed['bases'][role] = item
    core = c.strict_json(regular(spec['bases']['native']['root'], 'CURRENT_CORE_MANIFEST.json')[0])
    c.need(core.get('files') == {n: h for n, h in manifests['native']['files'].items()
                               if n != 'CURRENT_CORE_MANIFEST.json'}, 'CORE_MANIFEST_MISMATCH')
    publisher = spec['publisher']
    c.need(c.digest(read_file(publisher['path'])[0]) == publisher['sha256'], 'PUBLISHER_CHANGED')
    observed['publisher'] = deepcopy(publisher)
    for kind in ('python', 'node'):
        entry = env[kind]
        raw, mode = read_file(entry['path'])
        c.need(mode & 0o111 and c.digest(raw) == entry['sha256'], 'ENVIRONMENT_CHANGED:' + kind)
    venv = directory(env['venv_root'])
    c.need(c.digest(regular(venv, 'pyvenv.cfg')[0]) == env['pyvenv_cfg_sha256']
           and str((venv / 'bin/python').resolve(strict=True)) == env['python']['path'], 'VENV_ENVIRONMENT_CHANGED')
    observed['environment'] = deepcopy(env)
    observed['live_references'] = live_references(spec)
    return observed, manifests, sizes


def live_references(spec):
    """Only service cwd/state/PID lookup and two link targets; never Environment."""
    result = {'pointers': {}, 'services': {}}
    for role, name in spec['live_references']['pointers'].items():
        path = Path(name)
        directory(path.parent)
        c.need(path.is_symlink() and str(path.resolve(strict=True)) == spec['bases'][role]['root'],
               'LIVE_POINTER_CHANGED:' + role)
        result['pointers'][role] = {'path': name, 'link': os.readlink(path)}
    for role, descriptor in spec['live_references']['services'].items():
        response = subprocess.run(
            ['systemctl', 'show', descriptor['unit'], '-p', 'WorkingDirectory', '-p', 'MainPID',
             '-p', 'ActiveState', '-p', 'SubState'], capture_output=True, text=True, check=False, timeout=10)
        c.need(response.returncode == 0, 'SERVICE_METADATA_UNAVAILABLE:' + role)
        values = dict(line.split('=', 1) for line in response.stdout.splitlines() if '=' in line)
        pid = values.get('MainPID', '')
        c.need(set(values) == {'WorkingDirectory', 'MainPID', 'ActiveState', 'SubState'}
               and values['WorkingDirectory'].startswith('/')
               and values.get('ActiveState') == 'active' and values.get('SubState') == 'running'
               and pid.isdecimal() and int(pid) > 0, 'SERVICE_NOT_RUNNING:' + role)
        expected = Path(spec['bases'][role]['root']) / descriptor['cwd_suffix']
        c.need(Path(values.get('WorkingDirectory', '')).resolve(strict=True) == expected
               and (Path('/proc') / pid / 'cwd').resolve(strict=True) == expected,
               'LIVE_SERVICE_BASE_CHANGED:' + role)
        result['services'][role] = {'unit': descriptor['unit'], 'cwd': str(expected), 'state': 'active/running'}
    return result


def source_bytes(root):
    root = directory(root)
    blobs = {n: regular(root, n)[0] for n in sorted(c.SOURCE_FILES)}
    return blobs, {n: c.digest(raw) for n, raw in blobs.items()}


def make_plan(source_root, source_commit):
    spec = baseline()
    observed, bases, _ = snapshot(spec)
    blobs, source = source_bytes(source_root)
    c.check_source_imports(blobs)
    c.check_compatibility(source, bases, compatibility_review())
    plan = {'schema': 'alisa-economics-candidate-plan/v1', 'source_commit': source_commit,
            'source_files': source, 'tool_files': tool_hashes(), 'baseline': spec,
            'before': observed, 'production_deployed': False, 'status': 'PLAN_NOT_BUILT'}
    c.check_plan(plan, spec, tool_hashes())
    return plan


def write_new(path, raw, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def copy_base(root, target, manifest):
    target.mkdir(mode=0o700)
    for name, h in manifest['files'].items():
        raw, mode = regular(root, name)
        c.need(c.digest(raw) == h, 'BASE_FILE_CHANGED:' + name)
        # Independent inodes: subsequent prepare writes/chmod cannot edit a base.
        write_new(target / name, raw, 0o755 if mode & 0o111 else 0o644)
    for name, link in manifest.get('links', {}).items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(link)


def replace_file(path, raw):
    c.need(path.is_file() and not path.is_symlink(), 'OVERLAY_REGULAR_REQUIRED')
    with path.open('wb') as stream:
        stream.write(raw)


def apply_native(target, source):
    platform = source / c.SOURCE_PLATFORM / 'owner_data'
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        for version in c.PREPARES:
            if version == 'economics_period_r14':
                for name in ('accrual_source_runtime.py', 'realization_source_runtime.py',
                             'realization_source_catalog.json'):
                    shutil.copy2(source / c.RUNTIME / c.LEAVES[name], target / name)
                for name in ('economics_accruals.py', 'economics_realization.py',
                             'economics_cohort.py', 'economics_cohort_catalog.json'):
                    shutil.copy2(platform / name, target / 'parameter_support' / name)
            script = source / c.RUNTIME / version / 'prepare_candidate.py'
            spec = importlib.util.spec_from_file_location('release_' + version, script)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.prepare(target, platform)
    finally:
        sys.dont_write_bytecode = previous


def file_hashes(root, links=()):
    result = {}
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in (*dirs, *files):
            path = Path(base) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                c.need(relative in links, 'UNEXPECTED_OUTPUT_LINK')
            elif path.is_file():
                result[relative] = c.digest(regular(root, relative)[0])
            else:
                c.need(path.is_dir(), 'UNEXPECTED_OUTPUT_TYPE')
    return result


def native_probe(root, python):
    result = subprocess.run(
        [python, '-I', '-B', str(HERE / 'inspect_native.py'), str(root)],
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'},
        cwd=root, capture_output=True, timeout=45, check=False,
    )
    c.need(result.returncode == 0, 'NATIVE_IMPORT_PROBE_FAILED')
    return c.strict_json(result.stdout)


def publish_noreplace(source, target):
    """Linux atomic rename which refuses even an existing empty destination."""
    libc = ctypes.CDLL(None, use_errno=True)
    c.need(hasattr(libc, 'renameat2'), 'ATOMIC_NOREPLACE_UNAVAILABLE')
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise c.ReleaseError('OUTPUT_ALREADY_EXISTS')
        raise c.ReleaseError('ATOMIC_PUBLISH_FAILED')


def space_budget(parent, bases, sizes, blobs):
    """Conservative full-copy budget; retain the previous R5 rollout reserve."""
    fs = os.statvfs(parent)
    block = fs.f_frsize
    entries = sum(len(bases[k]['files']) + len(bases[k].get('links', {})) for k in c.BUILD_ROLES)
    entries += len(blobs) * 4 + 8
    dirs = sum(len({str(p) for n in (*bases[k]['files'], *bases[k].get('links', {}))
                    for p in Path(n).parents}) for k in c.BUILD_ROLES)
    dirs += len({str(p) for n in blobs for p in Path(n).parents}) + 8
    required = (sum(sizes[k] for k in c.BUILD_ROLES) + 4 * sum(map(len, blobs.values()))
                + block * (entries + 2 * dirs) + 4 * 1024**2)
    reserve = 3 * 1024**3
    c.need(fs.f_bavail * block >= required + reserve, 'BUILD_DISK_RESERVE')
    c.need(fs.f_favail >= entries + dirs + 200000, 'BUILD_INODE_RESERVE')
    return {'required_bytes_upper_bound': required, 'required_inodes_upper_bound': entries + dirs,
            'minimum_free_bytes_after': reserve, 'minimum_free_inodes_after': 200000}


def freeze(root):
    for base, dirs, files in os.walk(root, topdown=False, followlinks=False):
        for name in files:
            path = Path(base) / name
            if not path.is_symlink():
                path.chmod(0o555 if path.stat().st_mode & 0o111 else 0o444)
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        for name in dirs:
            path = Path(base) / name
            if not path.is_symlink():
                path.chmod(0o555)
        fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    root.chmod(0o555)


def discard_own_stage(path, identity):
    if not path.exists():
        return
    actual = path.lstat()
    c.need((actual.st_dev, actual.st_ino) == identity and stat.S_ISDIR(actual.st_mode),
           'STAGING_OWNERSHIP_CHANGED')
    for base, dirs, _ in os.walk(path, followlinks=False):
        Path(base).chmod(0o700)
        for name in dirs:
            p = Path(base) / name
            if not p.is_symlink():
                p.chmod(0o700)
    shutil.rmtree(path)


def build(source_root, plan_raw, plan_sha256, output):
    c.need(c.sha(plan_sha256) and c.digest(plan_raw) == plan_sha256, 'PLAN_HASH_CHANGED')
    plan, spec = c.strict_json(plan_raw), baseline()
    c.check_plan(plan, spec, tool_hashes())
    observed, bases, sizes = snapshot(spec)
    c.need(observed == plan['before'], 'BASE_CAS_CHANGED')
    blobs, hashes = source_bytes(source_root)
    c.need(hashes == plan['source_files'], 'SOURCE_CHANGED')
    c.check_source_imports(blobs)
    c.check_compatibility(hashes, bases, compatibility_review())
    output = Path(output)
    directory(output.parent)
    c.need(output.is_absolute() and output.name not in ('', '.', '..')
           and str(output) == os.path.normpath(str(output)), 'OUTPUT_PATH')
    # Existing prepare contracts deliberately forbid /opt. Build in a separate
    # finite directory; a later reviewed installer owns transfer and switching.
    c.need(not output.is_relative_to('/opt') and not os.path.lexists(output), 'NEW_STAGING_OUTPUT_REQUIRED')
    for root in [Path(source_root), HERE, *(Path(x['root']) for x in spec['bases'].values())]:
        c.need(not output.is_relative_to(root) and not root.is_relative_to(output), 'OUTPUT_OVERLAP')
    budget = space_budget(output.parent, bases, sizes, blobs)
    stage = Path(tempfile.mkdtemp(prefix='.' + output.name + '-', dir=output.parent))
    st = stage.stat()
    identity = (st.st_dev, st.st_ino)
    try:
        inputs = stage / 'source'
        for name, raw in blobs.items():
            write_new(inputs / name, raw, 0o444)
        release_root = stage / 'releases'
        release_root.mkdir(mode=0o700)
        for role in c.BUILD_ROLES:
            target = release_root / role
            copy_base(spec['bases'][role]['root'], target, bases[role])
            if role in ('platform', 'authority'):
                for name in c.PLATFORM_OVERLAY:
                    path, raw = target / c.PLATFORM / name, blobs[c.SOURCE_PLATFORM + name]
                    if name in c.EXISTING_PLATFORM:
                        replace_file(path, raw)
                    else:
                        write_new(path, raw)
            else:
                apply_native(target, inputs)
        old_catalog = c.strict_json(regular(spec['bases']['native']['root'], 'template_catalog.json')[0])
        native = release_root / 'native'
        c.check_catalog(old_catalog, c.strict_json(regular(native, 'template_catalog.json')[0]))
        before_probe = native_probe(Path(spec['bases']['native']['root']), spec['environment']['python']['path'])
        after_probe = native_probe(native, spec['environment']['python']['path'])
        c.need(before_probe['read_surface_pin'] == after_probe['read_surface_pin'], 'READ_SURFACE_PIN_CHANGED')
        c.need({k: v for k, v in before_probe['versions'].items() if k != 'catalog_bundle_hash'} ==
               {k: v for k, v in after_probe['versions'].items() if k != 'catalog_bundle_hash'},
               'RUNTIME_PROTOCOL_CHANGED')
        c.need(c.sha(after_probe['versions'].get('catalog_bundle_hash')) and
               before_probe['versions']['catalog_bundle_hash'] != after_probe['versions']['catalog_bundle_hash'],
               'CATALOG_BUNDLE_NOT_UPDATED')
        c.need(all(c.sha(after_probe[k]) for k in ('parameter_sources_pin', 'parameter_compounds_pin',
                                                 'economics_composites_pin')), 'SOURCE_POLICY_PIN_MISSING')
        receipts = {}
        for role in c.BUILD_ROLES:
            target, old = release_root / role, bases[role]
            files = file_hashes(target, old.get('links', {}))
            changed = c.check_delta(role, old['files'], files)
            c.check_output_sources(role, files, hashes)
            external = {}
            if role == 'native':
                core = c.strict_json(regular(target, 'CURRENT_CORE_MANIFEST.json')[0])
                core['files'] = {n: h for n, h in files.items() if n != 'CURRENT_CORE_MANIFEST.json'}
                core['economics_source'] = plan['source_commit']
                raw = c.encoded(core)
                replace_file(target / 'CURRENT_CORE_MANIFEST.json', raw)
                files['CURRENT_CORE_MANIFEST.json'] = c.digest(raw)
            else:
                external['.venv'] = spec['environment']['venv_root']
                (target / '.venv').symlink_to(external['.venv'], target_is_directory=True)
            manifest = c.candidate_manifest(role, old, files, plan['source_commit'],
                                            spec['bases'][role]['manifest_sha256'], external)
            raw = c.encoded(manifest)
            write_new(target / 'manifest.json', raw)
            verify_manifest(target, c.digest(raw))
            receipts[role] = {'artifact_id': manifest['artifact_id'], 'manifest_sha256': c.digest(raw),
                              'changed_files': changed, 'base_manifest_sha256': spec['bases'][role]['manifest_sha256']}
        shutil.rmtree(inputs)
        receipt = {'schema': 'alisa-economics-candidate/v1', 'status': 'BUILT_NOT_ACTIVATED',
                   'source_commit': plan['source_commit'], 'plan_sha256': plan_sha256,
                   'candidates': receipts, 'preserved': {'web': observed['bases']['web'],
                                                      'publisher': observed['publisher']},
                   'environment': observed['environment'], 'native_before': before_probe,
                   'build_budget': budget,
                   'native_candidate': after_probe, 'production_deployed': False,
                   'services_changed': False, 'database_changed': False,
                   'installed_synthetic': 'NOT_RUN', 'live_owner': 'NOT_RUN'}
        receipt['rollback_before'] = c.rollback_state(observed)
        receipt['rollback_candidate'] = {
            **{k: {'root': str(Path(spec['bases'][k]['root']).parent / receipts[k]['artifact_id']),
                   'manifest_sha256': receipts[k]['manifest_sha256']}
               for k in c.BUILD_ROLES},
            'web': receipt['rollback_before']['web'], 'publisher': observed['publisher']}
        c.rollback_allowed(receipt['rollback_before'], receipt['rollback_candidate'], receipt['rollback_before'])
        write_new(stage / 'PLAN.json', plan_raw)
        write_new(stage / 'PREPARED.json', c.encoded(receipt))
        freeze(stage)
        # Repeat integrity/current-reference checks after all build writes and
        # immediately before publishing. A later installer must repeat its CAS.
        final_source = source_bytes(source_root)[1]
        c.need(final_source == hashes, 'SOURCE_CHANGED_DURING_BUILD')
        final_observed, final_bases, _ = snapshot(spec)
        c.need(final_observed == observed and tool_hashes() == plan['tool_files'], 'BASE_OR_TOOL_CHANGED_DURING_BUILD')
        c.check_compatibility(final_source, final_bases, compatibility_review())
        publish_noreplace(stage, output)
        parent = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        return receipt
    finally:
        discard_own_stage(stage, identity)


def verify_prepared(output, prepared_sha256):
    """Recheck a pinned package and current bases; no admission/activation claim."""
    output = directory(output)
    raw = regular(output, 'PREPARED.json')[0]
    c.need(c.sha(prepared_sha256) and c.digest(raw) == prepared_sha256, 'PREPARED_RECEIPT_CHANGED')
    receipt = c.strict_json(raw)
    c.need(receipt.get('schema') == 'alisa-economics-candidate/v1'
           and receipt.get('status') == 'BUILT_NOT_ACTIVATED'
           and receipt.get('production_deployed') is False, 'PREPARED_STAGE')
    plan_raw = regular(output, 'PLAN.json')[0]
    c.need(c.digest(plan_raw) == receipt['plan_sha256'], 'PLAN_HASH_CHANGED')
    plan, spec = c.strict_json(plan_raw), baseline()
    c.check_plan(plan, spec, tool_hashes())
    observed, bases, _ = snapshot(spec)
    c.need(observed == plan['before'] and receipt['source_commit'] == plan['source_commit'], 'BASE_CAS_CHANGED')
    c.check_compatibility(plan['source_files'], bases, compatibility_review())
    expected_bundle = {'PLAN.json', 'PREPARED.json'}
    bundle_links = set()
    for role in c.BUILD_ROLES:
        target = output / 'releases' / role
        manifest, _ = verify_manifest(target, receipt['candidates'][role]['manifest_sha256'])
        files = file_hashes(target, {*manifest.get('links', {}), *manifest.get('external_links', {})})
        c.need(files == {**manifest['files'], 'manifest.json': receipt['candidates'][role]['manifest_sha256']},
               'CANDIDATE_EXTRA_FILE')
        before, after = bases[role]['files'], manifest['files']
        if role == 'native':
            before = {n: h for n, h in before.items() if n != 'CURRENT_CORE_MANIFEST.json'}
            after = {n: h for n, h in after.items() if n != 'CURRENT_CORE_MANIFEST.json'}
            core = c.strict_json(regular(target, 'CURRENT_CORE_MANIFEST.json')[0])
            c.need(core.get('files') == after and core.get('economics_source') == plan['source_commit'],
                   'CANDIDATE_CORE_MANIFEST')
        c.check_delta(role, before, after)
        c.check_output_sources(role, after, plan['source_files'])
        expected_external = {} if role == 'native' else {'.venv': spec['environment']['venv_root']}
        c.need(manifest.get('external_links') == expected_external, 'CANDIDATE_ENVIRONMENT')
        for name, dest in expected_external.items():
            c.need((target / name).is_symlink() and os.readlink(target / name) == dest, 'CANDIDATE_ENVIRONMENT')
        prefix = 'releases/' + role + '/'
        expected_bundle.update(prefix + n for n in files)
        bundle_links.update(prefix + n for n in (*manifest.get('links', {}), *expected_external))
    c.need(set(file_hashes(output, bundle_links)) == expected_bundle, 'BUNDLE_EXTRA_FILE')
    c.check_catalog(c.strict_json(regular(spec['bases']['native']['root'], 'template_catalog.json')[0]),
                    c.strict_json(regular(output / 'releases/native', 'template_catalog.json')[0]))
    c.rollback_allowed(receipt['rollback_before'], receipt['rollback_candidate'],
                       c.rollback_state(observed))
    return {'status': 'CANDIDATE_VERIFIED_NOT_ACTIVATED', 'prepared_sha256': prepared_sha256,
            'production_deployed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    plan = commands.add_parser('plan')
    plan.add_argument('--source-root', type=Path, required=True)
    plan.add_argument('--source-commit', required=True)
    candidate = commands.add_parser('build')
    candidate.add_argument('--source-root', type=Path, required=True)
    candidate.add_argument('--plan', type=Path, required=True)
    candidate.add_argument('--plan-sha256', required=True)
    candidate.add_argument('--output', type=Path, required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('--output', type=Path, required=True)
    verify.add_argument('--prepared-sha256', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'plan':
            result = make_plan(args.source_root, args.source_commit)
        elif args.command == 'verify':
            result = verify_prepared(args.output, args.prepared_sha256)
        else:
            result = build(args.source_root, read_file(args.plan)[0], args.plan_sha256, args.output)
            result = {**{k: result[k] for k in ('status', 'source_commit', 'plan_sha256', 'production_deployed')},
                      'prepared_sha256': c.digest(c.encoded(result))}
        print(c.encoded(result).decode(), end='')
    except (c.ReleaseError, OSError, AssertionError) as error:
        # No traceback, source contents or subprocess stderr in public output.
        print(str(error) if isinstance(error, c.ReleaseError) else 'R15_CANDIDATE_BUILD_REFUSED', file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()
