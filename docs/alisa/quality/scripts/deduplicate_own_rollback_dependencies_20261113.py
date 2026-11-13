"""Finite deduplication of inactive, byte-identical owned dependency copies."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

ROOT = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a')
BASE = Path('/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991')
BASE_SHA = '9373ffa589af852e2fef523fbd76d2d5d2e502eaa07720806d10a37f1cc71206'
OLD = {
    BASE.parent / 'alisa-store-default-a6d5e19a87577d87': '21019b2345102f6324070513921291f78650dd3393e775b3383fa91d85f558dd',
    BASE.parent / 'alisa-voice-selection-ac5557cd456ab364': '4069054526175c134692c6458e3ccf25694271f3472710b4002ae2ec7b86a5e5',
    BASE.parent / 'alisa-voice-selection-be0995ebb00e4649': 'fef0d541d42e1ca3b36c0a74f86d8f151d15bc52eb4a541a2d189dd655c346e7',
}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout.strip()


def inventory(root):
    need(root.is_dir() and not root.is_symlink(), 'DEPENDENCY_ROOT_CHANGED')
    result = {}
    for folder, dirs, files in os.walk(root, followlinks=False):
        for p in [Path(folder), *[Path(folder) / n for n in dirs + files]]:
            s = p.lstat(); kind = stat.S_IFMT(s.st_mode)
            need(kind in (stat.S_IFDIR, stat.S_IFREG, stat.S_IFLNK), 'DEPENDENCY_TYPE')
            content = sha(p) if kind == stat.S_IFREG else os.readlink(p) if kind == stat.S_IFLNK else None
            result[str(p.relative_to(root))] = [kind, stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid,
                s.st_size if kind != stat.S_IFDIR else 0, content]
    return result


def consumers(release):
    """Inspect configured services and live processes without emitting their arguments."""
    found = set(); prefix = str(release)
    loaded = command('systemctl', 'list-units', '--all', '--type=service', '--plain', '--no-legend', '--no-pager')
    installed = command('systemctl', 'list-unit-files', '--type=service', '--plain', '--no-legend', '--no-pager')
    units = {line.split()[0] for line in (loaded + '\n' + installed).splitlines() if line.split()}
    for unit in sorted(units):
        if unit.endswith('@.service'):
            values = command('systemctl', 'cat', unit)
        else:
            values = command('systemctl', 'show', unit, '-p', 'WorkingDirectory', '-p', 'ExecStart',
                '-p', 'ExecStartPre', '-p', 'ExecStartPost', '-p', 'ExecStop', '-p', 'ExecStopPost',
                '-p', 'ExecReload', '-p', 'EnvironmentFiles', '-p', 'RootDirectory')
        if prefix in values: found.add('unit:' + unit)
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name) == os.getpid(): continue
        try:
            texts = [(proc / 'cmdline').read_bytes().decode(errors='replace'),
                     (proc / 'maps').read_text(errors='replace'), str((proc / 'cwd').resolve()),
                     str((proc / 'exe').resolve())]
            if any(prefix in v for v in texts): found.add('pid:' + proc.name)
            for p in (proc / 'fd').iterdir():
                try:
                    if prefix in os.readlink(p): found.add('pid:' + proc.name)
                except FileNotFoundError: pass
        except (FileNotFoundError, ProcessLookupError): pass
        except PermissionError: raise RuntimeError('CONSUMER_UNREADABLE') from None
    return sorted(found)


def base_check():
    need(sha(BASE / 'manifest.json') == BASE_SHA, 'ACTIVE_BASE_CHANGED')
    need(command('systemctl', 'show', 'alisa-platform@stage.service', '--value', '-p', 'WorkingDirectory') == str(BASE),
         'ACTIVE_BASE_MOVED')
    need((BASE / '.venv').is_dir() and not (BASE / '.venv').is_symlink(), 'ACTIVE_DEPENDENCY_MOVED')


def probe(path):
    """No application settings, credentials, DB, provider or bytecode writes."""
    script = 'import django,cryptography,psycopg,sys;from pathlib import Path;print(Path(sys.prefix).resolve())'
    value = subprocess.run([str(path / 'bin/python'), '-I', '-B', '-c', script], check=True,
        capture_output=True, text=True, timeout=20,
        env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'PYTHONDONTWRITEBYTECODE': '1'})
    need(value.stdout.strip() == str(BASE / '.venv'), 'SHARED_DEPENDENCY_PROBE')


def share(release, expected):
    path = release / '.venv'; backup = release / '.venv.owned-dedup-old'; link = release / '.venv.owned-dedup-new'
    need(not backup.exists() and not link.exists() and not link.is_symlink(), 'TEMP_EXISTS')
    need(not consumers(release), 'OLD_RELEASE_CONSUMER')
    need(inventory(path) == expected and inventory(BASE / '.venv') == expected, 'DEPENDENCIES_DIFFER')
    need(sha(release / 'manifest.json') == OLD[release], 'OLD_MANIFEST_CHANGED')
    moved = linked = False
    try:
        link.symlink_to(BASE / '.venv', target_is_directory=True)
        path.rename(backup); moved = True
        link.rename(path); linked = True
        need(path.is_symlink() and os.readlink(path) == str(BASE / '.venv'), 'DEPENDENCY_LINK_CHANGED')
        probe(path); base_check()
        need(sha(release / 'manifest.json') == OLD[release], 'OLD_MANIFEST_CHANGED')
    except BaseException:
        if linked:
            need(path.is_symlink() and os.readlink(path) == str(BASE / '.venv'), 'LATER_WRITER')
            path.unlink()
        if moved: backup.rename(path)
        if link.is_symlink(): link.unlink()
        raise
    # Canonical bytes are retained by the current release. Old source and manifest
    # are untouched; only the now-unreferenced identical directory tree is removed.
    shutil.rmtree(backup)
    return {'release': release.name, 'manifest_unchanged': True, 'dependency_reference': str(BASE / '.venv')}


def run(apply=False):
    base_check(); expected = inventory(BASE / '.venv')
    before = os.statvfs('/opt'); rows = []
    for release, digest in OLD.items():
        need(release.parent == BASE.parent and release != BASE and sha(release / 'manifest.json') == digest, 'OLD_SCOPE')
        need(not consumers(release), 'OLD_RELEASE_CONSUMER')
        p = release / '.venv'
        if p.is_symlink():
            need(os.readlink(p) == str(BASE / '.venv'), 'DEPENDENCY_LINK_CHANGED'); probe(p)
            rows.append({'release': release.name, 'already_shared': True}); continue
        need(inventory(p) == expected, 'DEPENDENCIES_DIFFER')
        rows.append(share(release, expected) if apply else {'release': release.name, 'identical': True})
    after = os.statvfs('/opt')
    report = {'status': 'OWN_INACTIVE_DEPENDENCIES_SHARED' if apply else 'CHECKED_IDENTICAL_INACTIVE_COPIES',
        'rows': rows, 'dependency_tree_sha256': hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest(),
        'entries': len(expected), 'freed_bytes': (after.f_bavail - before.f_bavail) * after.f_frsize,
        'free_bytes': after.f_bavail * after.f_frsize, 'source_and_manifests_preserved': True,
        'service_restarts': 0, 'database_changes': False}
    ROOT.mkdir(mode=0o700, exist_ok=True)
    (ROOT / ('DEPENDENCIES_SHARED.json' if apply else 'DEPENDENCIES_CHECKED.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        need(os.geteuid() == 0 and sys.argv[1:] in [['--check'], ['--apply']], 'ARGUMENTS')
        with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            run(sys.argv[1:] == ['--apply'])
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'status': 'BLOCKED', 'code': code})); raise SystemExit(1)
