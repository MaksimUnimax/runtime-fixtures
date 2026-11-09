#!/usr/bin/env python3
"""Finite S06 preparation only. Does not migrate, restart, change config or pointers."""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import resource
import shutil
import stat
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path('/opt/alisa-platform/stage/releases')
FLOOR = 3 * 1024**3
EVIDENCE = Path('/run/alisa-s06-prepare-20261108')
MAX_PACKAGE = 80*1024**2
MAX_SELECTED = 80*1024**2
MAX_FILE = 32*1024**2
# Independently read from successful GitHub Actions run 42477897100, artifact
# 13616487167. These are authority pins, never inferred from caller/archive data.
APPROVED_SOURCE = 'd3cb053be14264c6bb2332708abb32d4b0c005ae'
APPROVED_ZIP_SHA256 = '71b40a05f999c823bf8c7cfd581cbddedcc55e54746396aefe5cef7ad9bf8524'
APPROVED_TAR_SHA256 = '86a684263b85791ac5bdaa010bc85208e460ba5841a9c83100eb35a52e2ee4eb'
# Independently read from the running platform, before any S06 host change.
# Another author kept these two updated files with an older manifest. Preserve
# their exact active bytes; do not edit that author's release or admit fresh drift.
ACTIVE_BASE = ROOT/'alisa-staff-session-r1-20261108'
ACTIVE_MANIFEST_SHA256 = 'b9f76bd48ea07355085cd89d14232d5de4df9641bf966c2c6c7fd8b514449cf1'
PRESERVED_STAFF = {
    'services/platform/src/alisa_platform/staff/views.py': 'c5e8ccc53d7641969db6b51947c2b0883b1cc35042a7889bb9fa06c62cb1f7be',
    'services/platform/src/alisa_platform/staff/policy.py': '0412338f34441ded37b0cfc3fedab8ae9338926fde70d60f69b24a780dc1841b',
}
ALICE_FILES = {'services/platform/src/alisa_platform/alice_link/'+name for name in
               ['__init__.py', 'models.py', 'oauth.py', 'vault.py', 'views.py', 'cleanup.py',
                'migrations/__init__.py', 'migrations/0001_initial.py']}
PLATFORM_FILES = {
    'infra/release.py',
    'services/platform/pyproject.toml', 'services/platform/requirements.lock',
    'services/platform/src/alisa_platform/config/settings.py',
    'services/platform/src/alisa_platform/config/urls.py',
    'services/platform/src/alisa_platform/foundation/views.py',
    'services/platform/src/alisa_platform/accounts/management/commands/accounts_cleanup.py',
}


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def trusted(path):
    path = path.resolve(strict=True)
    for current in [path, *path.parents]:
        info = current.stat()
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('Dependency or output ancestor is not root-owned and immutable to other users')
    return path


def safe_parent(target, destination):
    if not destination.is_relative_to(target):
        raise RuntimeError('Destination outside prepared target')
    current = target
    for part in destination.relative_to(target).parts[:-1]:
        current = current/part
        if current.is_symlink():
            raise RuntimeError('Destination traverses a symlink')
        if current.exists() and not current.is_dir():
            raise RuntimeError('Destination ancestor is not a directory')
    if destination.is_symlink():
        raise RuntimeError('Destination is already a symlink')


def emit(path, value):
    if path != EVIDENCE/'prepare.json' or EVIDENCE.is_symlink() or trusted(EVIDENCE) != EVIDENCE:
        raise RuntimeError('Exact private RuntimeDirectory output required')
    if stat.S_IMODE(EVIDENCE.stat().st_mode) != 0o700:
        raise RuntimeError('Private output directory required')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(json.dumps(value, indent=2)+'\n')
    print(json.dumps(value), flush=True)


def unit_root(unit):
    value = subprocess.check_output(['systemctl', 'show', unit, '--property=WorkingDirectory', '--value'], text=True, timeout=10).strip()
    path = Path(value).resolve()
    if not path.is_dir() or path.parent != ROOT:
        raise RuntimeError('Unexpected active component root')
    return path


def platform_hashes(api):
    """Walk the active shared-source layout, but never clone its directory links."""
    result, seen = {}, set()
    for folder, directories, names in os.walk(api/'services/platform', followlinks=True):
        current = Path(folder)
        resolved = trusted(current)
        if not resolved.is_relative_to(ROOT) or resolved in seen or len(seen) > 2000:
            raise RuntimeError('Untrusted or cyclic active source directory')
        seen.add(resolved)
        directories[:] = [name for name in directories if name != '__pycache__']
        for name in names:
            path = current/name
            if path.suffix == '.pyc':
                continue
            actual = trusted(path)
            if not actual.is_relative_to(ROOT) or not actual.is_file() or len(result) > 10000:
                raise RuntimeError('Untrusted active source file')
            result[str(path.relative_to(api))] = digest(actual)
    return result


def snapshot():
    web, api = unit_root('alisa-web@stage.service'), unit_root('alisa-platform@stage.service')
    safe_parent(api, api/'infra/launch.py')
    if not (api/'infra/launch.py').is_file() or (api/'infra/launch.py').is_symlink():
        raise RuntimeError('Active launcher is not a regular file')
    return {'web': str(web), 'platform': str(api),
            'web_manifest': digest(web/'manifest.json'), 'platform_manifest': digest(api/'manifest.json'),
            'launcher': digest(api/'infra/launch.py'),
            'platform_files': platform_hashes(api),
            'staff_files': {name: digest(api/'services/platform/src/alisa_platform/staff'/name)
                            for name in ['views.py', 'policy.py']}}


def install_bytes(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.s06-new-' + path.name)
    with temporary.open('xb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)  # never write through a hard link to active code


def main():
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', type=Path, required=True)
    parser.add_argument('--zip-sha256', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    resource.setrlimit(resource.RLIMIT_AS, (384*1024**2, 384*1024**2))
    if os.geteuid() != 0 or len(args.source) != 40 or any(c not in '0123456789abcdef' for c in args.source):
        raise RuntimeError('Root and exact source required')
    if args.source != APPROVED_SOURCE or args.zip_sha256 != APPROVED_ZIP_SHA256:
        raise RuntimeError('Only the independently qualified exact CI candidate is admitted')
    if digest(args.zip) != args.zip_sha256:
        raise RuntimeError('Downloaded CI archive hash differs')
    if args.output != EVIDENCE/'prepare.json' or args.output.exists() or args.output.is_symlink():
        raise RuntimeError('Exact new owned output path required')
    trusted(EVIDENCE)
    if EVIDENCE.is_symlink() or stat.S_IMODE(EVIDENCE.stat().st_mode) != 0o700:
        raise RuntimeError('Private real RuntimeDirectory required')
    mem = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
    if mem < 1536*1024**2:
        raise RuntimeError('Preparation RAM plus 1 GiB reserve required')
    before = snapshot()
    web, api = Path(before['web']), Path(before['platform'])
    if api != ACTIVE_BASE or before['platform_manifest'] != ACTIVE_MANIFEST_SHA256:
        raise RuntimeError('Active platform baseline changed; independent requalification required')
    active_manifest = json.loads((api/'manifest.json').read_text())
    inherited = {name: checksum for name, checksum in active_manifest.get('files', {}).items()
                 if name.startswith('services/platform/') or name == 'infra/launch.py'}
    if not set(PRESERVED_STAFF) <= set(inherited):
        raise RuntimeError('Expected preserved staff paths absent')
    inherited.update(PRESERVED_STAFF)
    actual_inherited = {**before['platform_files'], 'infra/launch.py': before['launcher']}
    if inherited != actual_inherited:
        raise RuntimeError('Active inherited platform/launcher differs from its installed manifest')
    target = ROOT/('alisa-' + args.source[:16])
    if target.exists():
        raise RuntimeError('Prepared target already exists; inspect it instead of overwriting')
    venv = (ROOT.parent/'identity-current/.venv').resolve()
    trusted(venv/'bin/python')
    if not venv.is_relative_to(ROOT):
        raise RuntimeError('Unexpected installed dependency environment')
    for path in [venv, *venv.rglob('*')]:
        trusted(path)
    expected = {'Django': '5.2.19', 'psycopg': '3.3.8', 'gunicorn': '26.2.0', 'cryptography': '50.0.2', 'oauthlib': '4.0.1'}
    found = json.loads(subprocess.check_output([str(venv/'bin/python'), '-I', '-B', '-c',
        'import importlib.metadata as m,json;print(json.dumps({n:m.version(n) for n in '+repr(list(expected))+'}))'],
        env={'PATH': '/usr/bin:/bin'}, text=True, timeout=10))
    if found != expected:
        raise RuntimeError('Existing read-only dependency environment differs from candidate locks')
    with zipfile.ZipFile(args.zip) as bundle:
        name = 'alisa-' + args.source[:16] + '.tar.gz'
        if bundle.getinfo(name).file_size > MAX_PACKAGE:
            raise RuntimeError('CI tarball exceeds preparation memory budget')
        package = bundle.read(name)
        if (hashlib.sha256(package).hexdigest() != APPROVED_TAR_SHA256
                or APPROVED_TAR_SHA256 != bundle.read(name+'.sha256').decode().split()[0]):
            raise RuntimeError('CI tarball hash differs')
    with tarfile.open(fileobj=io.BytesIO(package), mode='r:gz') as archive:
        prefix = 'alisa-' + args.source[:16] + '/'
        manifest = json.load(archive.extractfile(prefix+'manifest.json'))
        if manifest['source_sha'] != args.source:
            raise RuntimeError('CI package source differs')
        selected = []
        members = archive.getmembers()
        if len(members) > 20000 or sum(member.size for member in members) > 512*1024**2:
            raise RuntimeError('CI archive exceeds declared preparation budget')
        for member in members:
            if member.name == prefix[:-1] and member.isdir():
                continue
            if not member.name.startswith(prefix):
                raise RuntimeError('Unexpected archive prefix')
            relative = member.name[len(prefix):]
            if not relative:
                continue
            parts = PurePosixPath(relative)
            if parts.is_absolute() or '..' in parts.parts:
                raise RuntimeError('Unsafe archive path')
            if relative.startswith('ui/web/') or relative in PLATFORM_FILES or relative.startswith('services/platform/src/alisa_platform/alice_link/'):
                if not (member.isfile() or member.islnk() or member.issym() or member.isdir()):
                    raise RuntimeError('Unsupported selected archive entry')
                selected.append((relative, member))
        names = [relative for relative, _ in selected]
        expected_files = {name for name in manifest['files'] if name.startswith('ui/web/') or name in PLATFORM_FILES or name.startswith('services/platform/src/alisa_platform/alice_link/')}
        actual_files = {name for name, member in selected if member.isfile() or member.islnk()}
        if len(names) != len(set(names)) or not (PLATFORM_FILES | ALICE_FILES) <= actual_files or actual_files != expected_files:
            raise RuntimeError('Incomplete or duplicated selected package paths')
        # S06 has no new JS dependency: require both the qualified manifest link
        # map and the active, locked dependency baseline.
        old_links = {str(path.relative_to(web)): os.readlink(path) for path in (web/'ui/web').rglob('*') if path.is_symlink()}
        new_links = {name: member.linkname for name, member in selected if member.issym()}
        expected_links = {name: value for name, value in manifest['links'].items()
                          if name.startswith('ui/web/') or name in PLATFORM_FILES or name.startswith('services/platform/src/alisa_platform/alice_link/')}
        if new_links != expected_links or old_links != new_links:
            raise RuntimeError('Frontend links differ from the active dependency baseline')
        writes = []
        selected_bytes = 0
        for relative, member in selected:
            if not (member.isfile() or member.islnk()):
                continue
            data = archive.extractfile(member).read(MAX_FILE+1)
            selected_bytes += len(data)
            if len(data) > MAX_FILE or selected_bytes > MAX_SELECTED:
                raise RuntimeError('Selected data exceeds preparation memory budget')
            if hashlib.sha256(data).hexdigest() != manifest['files'][relative]:
                raise RuntimeError('Selected CI file hash differs')
            old = (web if relative.startswith('ui/web/') else api)/relative
            reusable = old.is_file() and not old.is_symlink() and digest(old) == manifest['files'][relative]
            writes.append((relative, data, old if reusable else None, member.mode))
        budget = sum(math.ceil(len(data)/4096)*4096 for _, data, old, _ in writes if old is None) + 2*1024**2
        free = shutil.disk_usage(ROOT).free
        if free - budget < FLOOR or os.statvfs(ROOT).f_favail < 205000:
            emit(args.output, {'status': 'RESOURCE_HOLD_BEFORE_WRITES', 'source': args.source,
                'free_bytes': free, 'estimated_write_bytes': budget, 'required_free_floor_bytes': FLOOR})
            return 3
        if snapshot() != before:
            raise RuntimeError('Parallel web/platform change before preparation')
        target.mkdir()
        for relative in before['platform_files']:
            destination = target/relative
            safe_parent(target, destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = trusted(api/relative)
            if not source.is_relative_to(ROOT) or digest(source) != before['platform_files'][relative]:
                raise RuntimeError('Inherited source changed before materialization')
            os.link(source, destination)
        (target/'infra').mkdir()
        os.link(api/'infra/launch.py', target/'infra/launch.py')
        (target/'.venv').symlink_to(venv, target_is_directory=True)
        for relative, data, old, mode in writes:
            destination = target/relative
            safe_parent(target, destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if old is not None and not destination.exists():
                os.link(old, destination)
            elif old is None or digest(destination) != hashlib.sha256(data).hexdigest():
                install_bytes(destination, data)
                destination.chmod(mode & 0o755)
        for relative, member in selected:
            if member.issym():
                destination = target/relative
                safe_parent(target, destination)
                resolved = (destination.parent/member.linkname).resolve()
                if not resolved.is_relative_to(target):
                    raise RuntimeError('Selected symlink escapes prepared release')
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.symlink_to(member.linkname)
        for relative, member in selected:
            path = target/relative
            if member.issym() and (not path.is_symlink() or os.readlink(path) != member.linkname or not path.exists()):
                raise RuntimeError('Prepared link readback differs')
            if (member.isfile() or member.islnk()) and (not path.is_file() or digest(path) != manifest['files'][relative]):
                raise RuntimeError('Prepared file readback differs')
        preserved = {name: digest(target/'services/platform/src/alisa_platform/staff'/name)
                     for name in ['views.py', 'policy.py']}
        if preserved != before['staff_files'] or snapshot() != before:
            raise RuntimeError('Parallel staff/web/platform change during preparation; target stays inactive')
        manifest.update(artifact_id=target.name, overlay_base=before, source_package_sha256=hashlib.sha256(package).hexdigest(),
                        dependency_environment=str(venv), activated_components=[], acceptance='PREPARED_NOT_ACTIVATED')
        payload = [path for path in target.rglob('*') if path.relative_to(target).parts[0] != '.venv']
        manifest['files'] = {str(path.relative_to(target)): digest(path) for path in payload
                             if path.is_file() and not path.is_symlink() and path != target/'manifest.json'}
        manifest['links'] = {str(path.relative_to(target)): os.readlink(path) for path in payload if path.is_symlink()}
        if any(not (target/name).resolve().is_relative_to(target) for name in manifest['links']):
            raise RuntimeError('Prepared link escapes namespace')
        install_bytes(target/'manifest.json', (json.dumps(manifest, indent=2)+'\n').encode())
        # Execute only the qualified package's side-effect-free verifier, never
        # its deploy/migrate entry points. It checks exact file/link sets and SHA.
        import importlib.util
        spec = importlib.util.spec_from_file_location('s06_release_verifier', target/'infra/release.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        if verifier.installed_release(ROOT.parent, target.name) != target:
            raise RuntimeError('Standard installed-release readback differs')
        if shutil.disk_usage(ROOT).free < FLOOR:
            raise RuntimeError('Resource floor changed; prepared release stays inactive')
    emit(args.output, {'status': 'PREPARED_NOT_ACTIVATED', 'source': args.source,
        'target': str(target), 'preserved_staff_files': preserved, 'estimated_write_bytes': budget,
        'free_after_bytes': shutil.disk_usage(ROOT).free, 'migration_applied': False,
        'configs_or_pointers_changed': False, 'services_restarted': False})
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
