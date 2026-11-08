#!/usr/bin/python3
"""One-shot repair: preserve APT lists/packages, remove two rebuildable indices."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

ROOT = Path('/var/lib/alisa-platform/stage/rollout-backups/swagger-watch-20261108')
CONFIG = Path('/etc/apt/apt.conf.d/99-alisa-binary-cache.conf')
CONTENTS = b'Dir::Cache::pkgcache "";\nDir::Cache::srcpkgcache "";\n'
CACHES = [Path('/var/cache/apt/pkgcache.bin'), Path('/var/cache/apt/srcpkgcache.bin')]
LOCKS = ['/var/lib/apt/lists/lock', '/var/cache/apt/archives/lock',
         '/var/lib/dpkg/lock-frontend', '/var/lib/dpkg/lock']

def free():
    v = os.statvfs('/')
    return {'bytes': v.f_bavail * v.f_frsize, 'inodes': v.f_favail}

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

require(os.geteuid() == 0, 'ROOT_REQUIRED')
for directory in [ROOT, *ROOT.parents, CONFIG.parent, *CONFIG.parent.parents]:
    meta = directory.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == 0 and not meta.st_mode & 0o022,
            'UNTRUSTED_DIRECTORY_CHAIN')
require(not CONFIG.exists() and not CONFIG.is_symlink(), 'CONFIG_ALREADY_EXISTS')
require(not (ROOT / 'apt-cache-maintenance.json').exists(), 'RECEIPT_ALREADY_EXISTS')
record = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'invocation': os.environ.get('INVOCATION_ID'), 'before': free(),
          'scope': 'APT_BINARY_INDICES_ONLY', 'result': 'FAILED', 'removed': []}
receipt = os.fdopen(os.open(ROOT / 'apt-cache-maintenance.json',
                           os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                           0o600), 'w')

def persist():
    receipt.seek(0)
    json.dump(record, receipt, indent=2)
    receipt.truncate()
    receipt.flush()
    os.fsync(receipt.fileno())

persist()
directory_fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
handles = []
try:
    for name in LOCKS:
        fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW)
        fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        handles.append(fd)
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            name = Path(os.readlink(proc / 'exe')).name
        except OSError:
            continue
        require(name not in {'apt', 'apt-get', 'apt-cache', 'dpkg',
                             'unattended-upgrade', 'apt-helper'}, 'APT_PROCESS_ACTIVE')
    status = Path('/var/lib/dpkg/status')
    record['dpkg_status_before'] = digest(status)
    record['retained_list_count'] = sum(1 for p in Path('/var/lib/apt/lists').iterdir()
                                        if p.is_file())
    require(record['retained_list_count'] > 1, 'APT_LISTS_MISSING')
    snapshots = []
    for path in CACHES:
        st = path.lstat()
        require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1,
                'CACHE_IDENTITY')
        require(0 < st.st_size < 100 * 1024 * 1024, 'CACHE_SIZE')
        snapshots.append((path, st))
        record.setdefault('cache_before', []).append(
            {'path': str(path), 'bytes': st.st_size, 'sha256': digest(path)})
    with CONFIG.open('xb') as stream:
        stream.write(CONTENTS)
        stream.flush()
        os.fsync(stream.fileno())
    CONFIG.chmod(0o644)
    effective = subprocess.run(['apt-config', 'dump'], check=True,
                               capture_output=True, text=True, timeout=10).stdout
    require(all(line in effective.splitlines() for line in
                ['Dir::Cache::pkgcache "";', 'Dir::Cache::srcpkgcache "";']),
            'APT_CONFIG_READBACK')
    record['config_sha256'] = digest(CONFIG)
    persist()
    for path, before in snapshots:
        now = path.lstat()
        require((now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns) == (
            before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns),
            'CACHE_CHANGED')
        record['next_cache_to_remove'] = str(path)
        persist()
        path.unlink()
        record['removed'].append(str(path))
        del record['next_cache_to_remove']
        persist()
    record['after'] = free()
    record['dpkg_status_after'] = digest(status)
    require(record['dpkg_status_after'] == record['dpkg_status_before'], 'DPKG_CHANGED')
    require(record['after']['bytes'] >= 3072 * 1024 * 1024, 'DISK_RESERVE')
    require(record['after']['inodes'] >= 200000, 'INODE_RESERVE')
    record['result'] = 'PASS'
finally:
    for fd in handles:
        os.close(fd)
    record['after'] = free()
    persist()
    receipt.close()
    print(json.dumps(record))
