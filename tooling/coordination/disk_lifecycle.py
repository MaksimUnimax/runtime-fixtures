#!/usr/bin/env python3
"""Account for temporary disk allocations. No deletion or process execution.

This is an admission/closure gate used by the existing chat executors, not a
daemon, filesystem quota, or replacement for the heavy process supervisor.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid

MIB = 1024 * 1024
CONTROL = Path('/root/octoport-control')
RESERVE_MIB = 5120
INODE_RESERVE = 200000
MAX_HOURS = 72
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,119}')
ROLES = ('A', 'B', 'C', 'CONTROLLER')
BASELINE_VERSION = 1
MANAGED_KINDS = ('worktrees', 'temporary')


def text(value, field):
    if not isinstance(value, str) or not 8 <= len(value.strip()) <= 1000:
        raise ValueError(field + '_REQUIRED_8_TO_1000_CHARACTERS')
    return value.strip()


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('INVALID_IDENTIFIER')
    return value


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, data):
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        sync_directory(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


class Registry:
    def __init__(self, control=CONTROL, clock=time.time):
        self.control = Path(control)
        self.directory = self.control / 'disk-allocations'
        self.clock = clock

    @contextmanager
    def locked(self):
        if self.control.resolve() != self.control or self.control.is_symlink():
            raise ValueError('NONCANONICAL_CONTROL_PATH')
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink():
            raise ValueError('NONCANONICAL_REGISTRY_PATH')
        sync_directory(self.control)
        # Shared with the existing heavy admission decision; no work is done
        # while this short lock is held, only inventory/atomic metadata updates.
        with (self.control / 'resource-admission.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def rows(self):
        rows = []
        for path in sorted(self.directory.glob('*.json')):
            if path.is_symlink():
                raise ValueError('REGISTRY_SYMLINK')
            item = json.loads(path.read_text())
            empty = item.get('kind') == 'NO_TEMPORARY_OUTPUTS'
            if (item.get('version') != 1 or item.get('id') != path.stem or
                    item.get('state') not in ('OPEN', 'HELD', 'CLOSED') or
                    item.get('role') not in ROLES or
                    type(item.get('reserve_mib')) is not int or
                    (item['reserve_mib'] != 0 if empty else item['reserve_mib'] < 16) or
                    not isinstance(item.get('paths'), list) or
                    not isinstance(item.get('volumes'), list) or
                    ((item['state'] != 'CLOSED' or item['paths'] or item['volumes']) if empty
                     else not (item['paths'] or item['volumes']))):
                raise ValueError('INVALID_REGISTRY_RECORD:' + path.name)
            rows.append(item)
        return rows

    @property
    def baseline_path(self):
        return self.control / 'controllers' / 'organization' / 'disk-lifecycle-baseline-v1.json'

    @property
    def completion_directory(self):
        return self.control / 'disk-task-completions'

    def completion_path(self, role, task):
        if role not in ROLES:
            raise ValueError('INVALID_ROLE')
        task = identifier(task)
        return self.completion_directory / (role + '--' + task + '.json')

    def completion_record(self, role, task):
        path = self.completion_path(role, task)
        if not os.path.lexists(path):
            return None
        if path.is_symlink() or not path.is_file():
            raise ValueError('INVALID_TASK_COMPLETION_RECORD')
        item = json.loads(path.read_text())
        if (item.get('version') != 1 or item.get('role') != role or item.get('task') != task or
                item.get('state') not in ('SEALING', 'SEALED', 'REOPENED') or
                not isinstance(item.get('history'), list)):
            raise ValueError('INVALID_TASK_COMPLETION_RECORD')
        return item

    def record_completion_state(self, role, task, state):
        if state not in ('SEALING', 'SEALED', 'REOPENED'):
            raise ValueError('INVALID_TASK_COMPLETION_STATE')
        path = self.completion_path(role, task)
        self.completion_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.completion_directory.is_symlink():
            raise ValueError('NONCANONICAL_TASK_COMPLETION_DIRECTORY')
        item = self.completion_record(role, task) or {
            'version': 1, 'role': role, 'task': task, 'history': []
        }
        if state == 'REOPENED' and item.get('state') in ('SEALING', 'SEALED'):
            # Guard the durable state transition itself, not only a helper:
            # queue completion error handling can call this method directly.
            # A CONTROLLER-produced resource needs V2 journal-certified
            # recovery authority; no ordinary REOPENED route provides it.
            if any(row['task'] == task and row['role'] != role
                   for row in self.rows()):
                raise ValueError('CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED')
        now = self.clock()
        item['state'] = state
        item['updated_at'] = now
        item['history'].append({'at': now, 'state': state})
        atomic_json(path, item)
        return item

    def require_task_not_completed(self, role, task):
        # The task ID is globally unique in the work board. A final role-A
        # administrative seal also blocks the actual CONTROLLER producer from
        # allocating new same-task artifacts. Explicit REOPENED allows rework.
        for owner in ROLES:
            item = self.completion_record(owner, task)
            if item and item['state'] in ('SEALING', 'SEALED'):
                raise ValueError('TASK_DISK_LIFECYCLE_ALREADY_COMPLETED')

    def managed_roots(self, role=None):
        roles = (role,) if role else ROLES
        answer = []
        for item in roles:
            lane = item if item != 'CONTROLLER' else 'controller'
            for kind in MANAGED_KINDS:
                answer.append((item, self.control / kind / lane))
        return answer

    @staticmethod
    def path_identity(path):
        st = os.lstat(path)
        birth = subprocess.run(['stat','--printf=%w','--',str(path)], capture_output=True,
                               text=True, timeout=2)
        if birth.returncode != 0 or not birth.stdout or birth.stdout == '-':
            raise ValueError('MANAGED_PATH_BIRTH_TIME_UNAVAILABLE:' + str(path))
        return {'path': str(path), 'device': st.st_dev, 'inode': st.st_ino,
                'birth_time': birth.stdout}

    def seed_baseline(self):
        with self.locked():
            if os.path.lexists(self.baseline_path):
                raise ValueError('DISK_LIFECYCLE_BASELINE_ALREADY_EXISTS')
            entries = []
            for _, root in self.managed_roots():
                if not os.path.lexists(root):
                    continue
                if root.is_symlink() or not root.is_dir():
                    raise ValueError('INVALID_MANAGED_ROOT:' + str(root))
                for child in sorted(root.iterdir(), key=lambda item: str(item)):
                    entries.append(self.path_identity(child))
            self.baseline_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            data = {'version': BASELINE_VERSION, 'created_at': self.clock(), 'entries': entries}
            atomic_json(self.baseline_path, data)
            return data

    def load_baseline(self):
        if not os.path.lexists(self.baseline_path):
            return None
        if self.baseline_path.is_symlink() or not self.baseline_path.is_file():
            raise ValueError('INVALID_DISK_LIFECYCLE_BASELINE')
        data = json.loads(self.baseline_path.read_text())
        if data.get('version') != BASELINE_VERSION or not isinstance(data.get('entries'), list):
            raise ValueError('INVALID_DISK_LIFECYCLE_BASELINE')
        roots = [root for _, root in self.managed_roots()]
        seen = set()
        for row in data['entries']:
            if (not isinstance(row, dict) or not isinstance(row.get('path'), str) or
                    type(row.get('device')) is not int or type(row.get('inode')) is not int or
                    not isinstance(row.get('birth_time'), str) or not row['birth_time']):
                raise ValueError('INVALID_DISK_LIFECYCLE_BASELINE_ENTRY')
            path = Path(row['path'])
            if path in seen or not path.is_absolute() or not any(path.parent == root for root in roots):
                raise ValueError('INVALID_DISK_LIFECYCLE_BASELINE_ENTRY')
            seen.add(path)
        return data

    def managed_guard(self, rows=None, role=None):
        rows = self.rows() if rows is None else rows
        baseline = self.load_baseline()
        if baseline is None:
            return {'baseline_required': True, 'unregistered_managed_paths': []}
        active = [Path(path) for row in rows if row['state'] != 'CLOSED' for path in row['paths']]
        known = {row['path']: row for row in baseline['entries']}
        unregistered = []
        for owner, root in self.managed_roots(role):
            if not os.path.lexists(root):
                continue
            if root.is_symlink() or not root.is_dir():
                raise ValueError('INVALID_MANAGED_ROOT:' + str(root))
            for child in sorted(root.iterdir(), key=lambda item: str(item)):
                if child in active:
                    continue
                old = known.get(str(child))
                current = self.path_identity(child)
                if (old and old['device'] == current['device'] and old['inode'] == current['inode'] and
                        old['birth_time'] == current['birth_time']):
                    continue
                unregistered.append({'role': owner, 'path': str(child)})
        return {'baseline_required': False, 'baseline_created_at': baseline['created_at'],
                'unregistered_managed_paths': unregistered}

    def require_managed_guard(self, rows, role):
        guard = self.managed_guard(rows, role)
        if guard['baseline_required']:
            raise ValueError('DISK_LIFECYCLE_BASELINE_REQUIRED')
        if guard['unregistered_managed_paths']:
            paths = ','.join(item['path'] for item in guard['unregistered_managed_paths'])
            raise ValueError('UNREGISTERED_MANAGED_PATHS:' + paths)
        return guard

    def snapshot(self):
        st = os.statvfs(self.control)
        return {'available_mib': st.f_bavail * st.f_frsize // MIB,
                'inodes_free': st.f_favail, 'filesystem_device': self.control.stat().st_dev}

    def check_role(self, role):
        if role not in ROLES:
            raise ValueError('INVALID_ROLE')
        if role != 'CONTROLLER':
            state = json.loads((self.control / (role + '.json')).read_text())
            if state.get('status') != 'RUNNING':
                raise ValueError('ROLE_NOT_RUNNING_NO_RESUME')

    def paths(self, role, values):
        if len(values) > 32:
            raise ValueError('AT_MOST_32_EXACT_NEW_PATHS')
        lane = role if role != 'CONTROLLER' else 'controller'
        roots = [self.control / 'worktrees' / lane, self.control / 'temporary' / lane]
        answer = []
        device = self.control.stat().st_dev
        for raw in values:
            path = Path(raw)
            if (not path.is_absolute() or path.resolve() != path or
                    path.parent not in roots):
                raise ValueError('USE_CANONICAL_OWNED_TEMPORARY_ROOT')
            if os.path.lexists(path):
                raise ValueError('NEW_PATH_ALREADY_EXISTS:' + str(path))
            parent = path.parent
            while not parent.exists():
                parent = parent.parent
            if parent.stat().st_dev != device:
                raise ValueError('DIFFERENT_FILESYSTEM_UNBUDGETED')
            if any(path == p or path.is_relative_to(p) or p.is_relative_to(path) for p in answer):
                raise ValueError('OVERLAPPING_PATHS')
            answer.append(path)
        return [str(p) for p in answer]

    def volume_exists(self, name):
        result = subprocess.run(['docker','volume','inspect','--format','{{.Name}}',name],
                                capture_output=True,text=True,timeout=5)
        if result.returncode == 0 and result.stdout.strip() == name:
            return True
        if result.returncode != 0 and 'no such volume' in result.stderr.lower():
            return False
        raise ValueError('DOCKER_VOLUME_STATE_UNKNOWN')

    def volume_names(self, role, values):
        if len(values) > 4 or len(set(values)) != len(values):
            raise ValueError('AT_MOST_4_UNIQUE_NAMED_VOLUMES')
        prefix = 'octoport-' + role.lower() + '-'
        for name in values:
            if not ID.fullmatch(name) or not name.startswith(prefix) or len(name) <= len(prefix):
                raise ValueError('OWNED_NAMED_VOLUME_REQUIRED')
            if self.volume_exists(name):
                raise ValueError('NEW_VOLUME_ALREADY_EXISTS:' + name)
        return values

    def begin(self, role, task, purpose, values, reserve_mib, hours, volumes=None):
        task = identifier(task)
        purpose = text(purpose, 'PURPOSE')
        if type(reserve_mib) is not int or not 16 <= reserve_mib <= 65536:
            raise ValueError('RESERVE_REQUIRED_16_TO_65536_MIB')
        if type(hours) not in (int, float) or not 0 < hours <= MAX_HOURS:
            raise ValueError('BOUNDED_HOURS_REQUIRED_MAX_72')
        with self.locked():
            self.check_role(role)
            self.require_task_not_completed(role, task)
            paths = self.paths(role, values)
            volumes = self.volume_names(role, volumes or [])
            if not paths and not volumes:
                raise ValueError('ARTIFACT_PATH_OR_NAMED_VOLUME_REQUIRED')
            rows = self.rows()
            self.require_managed_guard(rows, role)
            now = self.clock()
            active = [r for r in rows if r['state'] != 'CLOSED']
            # Same-task parallel checks remain possible; unfinished prior tasks
            # must first be removed or given a specific, time-bounded consumer.
            stale = [r['id'] for r in active if r['role'] == role and
                     (r['due_at'] <= now or (r['state'] == 'OPEN' and r['task'] != task))]
            if stale:
                raise ValueError('PREVIOUS_ARTIFACTS_UNACCOUNTED:' + ','.join(stale))
            for r in active:
                if set(volumes).intersection(r['volumes']):
                    raise ValueError('VOLUME_ALREADY_RESERVED:' + r['id'])
                if any(Path(x) == Path(y) or Path(x).is_relative_to(Path(y)) or
                       Path(y).is_relative_to(Path(x)) for x in paths for y in r['paths']):
                    raise ValueError('PATH_ALREADY_RESERVED:' + r['id'])
            resources = self.snapshot()
            reserved = sum(r['reserve_mib'] for r in active)
            # Conservative reservation: retain the full declared growth budget
            # until closure, even if some has already been written. Never infer
            # that observed space reductions came from this particular task.
            required = RESERVE_MIB + reserved + reserve_mib
            if resources['available_mib'] < required or resources['inodes_free'] < INODE_RESERVE:
                raise ValueError(f'DISK_CAPACITY_REQUIRED:available={resources["available_mib"]};required={required};inodes={resources["inodes_free"]}')
            item = {'version': 1, 'id': uuid.uuid4().hex, 'role': role, 'task': task,
                    'purpose': purpose, 'paths': paths, 'volumes': volumes, 'reserve_mib': reserve_mib,
                    'kind': 'TEMPORARY_OUTPUTS',
                    'cache_policy': 'TASK_LOCAL_STORES_INSIDE_DECLARED_PATHS; no shared-store installation under this allocation',
                    'state': 'OPEN', 'created_at': now, 'due_at': now + hours * 3600,
                    'before': resources, 'history': []}
            atomic_json(self.directory / (item['id'] + '.json'), item)
            return item

    def declare_none(self, role, task, purpose):
        if role not in ROLES:
            raise ValueError('INVALID_ROLE')
        task = identifier(task)
        purpose = text(purpose, 'READONLY_NO_OUTPUT_REASON')
        with self.locked():
            self.require_task_not_completed(role, task)
            rows = self.rows()
            self.require_managed_guard(rows, role)
            if any(r['role'] == role and r['task'] == task for r in rows):
                raise ValueError('TASK_ALREADY_HAS_INVENTORY')
            now = self.clock()
            item = {'version':1,'id':uuid.uuid4().hex,'role':role,'task':task,
                    'kind':'NO_TEMPORARY_OUTPUTS','purpose':purpose,'paths':[],
                    'volumes':[],'reserve_mib':0,'state':'CLOSED','created_at':now,
                    'due_at':now,'closed_at':now,'history':[],
                    'statement':'Author attests no temporary files, dependencies, profiles or volumes were created; reviewer must verify task evidence.'}
            atomic_json(self.directory/(item['id']+'.json'),item)
            return item

    def change(self, lease_id, role, action, reason='', consumer='', hours=24):
        identifier(lease_id)
        if role not in ROLES:
            raise ValueError('INVALID_ROLE')
        with self.locked():
            item = next((r for r in self.rows() if r['id'] == lease_id), None)
            if item is None or item['role'] != role:
                raise ValueError('OWNED_ALLOCATION_NOT_FOUND')
            if item['state'] == 'CLOSED':
                raise ValueError('ALREADY_CLOSED')
            now = self.clock()
            event = {'at': now, 'previous_state': item['state'], 'action': action}
            if action == 'close':
                present = [p for p in item['paths'] if os.path.lexists(p)]
                if present:
                    raise ValueError('ARTIFACTS_STILL_PRESENT:' + ','.join(present))
                if any(self.volume_exists(name) for name in item['volumes']):
                    raise ValueError('DOCKER_VOLUMES_STILL_PRESENT')
                # The tool does not remove anything: the existing reviewed
                # cleanup procedure must preserve refs/evidence before removal.
                event['cleanup_receipt'] = text(reason, 'CLEANUP_RECEIPT')
                receipt = Path(reason)
                if not receipt.is_absolute() or not receipt.is_file():
                    raise ValueError('EXISTING_CLEANUP_RECEIPT_REQUIRED')
                raw = receipt.read_bytes()
                proof = json.loads(raw)
                if (proof.get('cleanup_verified') is not True or
                        sorted(proof.get('managed_paths', [])) != sorted(item['paths']) or
                        sorted(proof.get('managed_volumes', [])) != sorted(item['volumes'])):
                    raise ValueError('CLEANUP_RECEIPT_PATHS_OR_VERIFICATION_MISMATCH')
                event['receipt_sha256'] = hashlib.sha256(raw).hexdigest()
                item.update(state='CLOSED', closed_at=now, after=self.snapshot())
            elif action == 'hold':
                if type(hours) not in (int, float) or not 0 < hours <= MAX_HOURS:
                    raise ValueError('BOUNDED_HOURS_REQUIRED_MAX_72')
                event.update(reason=text(reason, 'HOLD_REASON'), consumer=text(consumer, 'CONCRETE_CONSUMER'))
                item.update(state='HELD', due_at=now + hours * 3600,
                            hold_reason=event['reason'], consumer=event['consumer'])
            else:
                raise ValueError('UNKNOWN_ACTION')
            item['history'].append(event)
            atomic_json(self.directory / (item['id'] + '.json'), item)
            return item

    def retained_archive_inventory(self, lease_id, role):
        """Inspect finite, flat recovery archives; never alter retained bytes.

        Hashing is outside the admission lock. Reconciliation rechecks metadata
        under that lock. This remains a cooperative budget, not a disk quota.
        """
        identifier(lease_id)
        with self.locked():
            item = self._retained_archive_item(lease_id, role)
        before = self._retained_archive_stats(item)
        files = []
        root = Path(item['paths'][0])
        for entry in before['files']:
            fd = os.open(root / entry['name'], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                if self._archive_stat(os.fstat(fd)) != entry['stat']:
                    raise ValueError('RETAINED_ARCHIVE_CHANGED')
                digest = hashlib.sha256()
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    for chunk in iter(lambda: stream.read(MIB), b''):
                        digest.update(chunk)
                if self._archive_stat(os.fstat(fd)) != entry['stat']:
                    raise ValueError('RETAINED_ARCHIVE_CHANGED')
                files.append(dict(entry, sha256=digest.hexdigest()))
            finally:
                os.close(fd)
        if self._retained_archive_stats(item) != before:
            raise ValueError('RETAINED_ARCHIVE_CHANGED')
        measured = max(sum(x['stat']['size'] for x in files),
                       sum(x['stat']['allocated'] for x in files))
        minimum = (measured + max(256 * MIB, (measured + 4) // 5) + MIB - 1) // MIB
        return {'kind': 'RETAINED_ARCHIVE_INVENTORY', 'version': 1,
                'allocation_id': item['id'], 'role': role, 'task': item['task'],
                'paths': item['paths'], 'reserve_mib': item['reserve_mib'],
                'due_at': item['due_at'], 'root_stat': before['root_stat'],
                'files': files, 'measured_bytes': measured,
                'minimum_reserve_mib': minimum, 'observed_at': self.clock()}

    @staticmethod
    def _archive_stat(st):
        return {'device': st.st_dev, 'inode': st.st_ino, 'mode': st.st_mode,
                'links': st.st_nlink, 'size': st.st_size,
                'allocated': st.st_blocks * 512,
                'mtime_ns': st.st_mtime_ns, 'ctime_ns': st.st_ctime_ns}

    def _retained_archive_item(self, lease_id, role):
        # Deliberately narrow: controller-owned completed recovery archives.
        # Worktrees, live volumes and unfinished task outputs are ineligible.
        item = next((r for r in self.rows() if r['id'] == lease_id), None)
        if role != 'CONTROLLER' or item is None or item['role'] != role:
            raise ValueError('CONTROLLER_RETAINED_ARCHIVE_REQUIRED')
        if item['state'] != 'HELD' or item['due_at'] <= self.clock():
            raise ValueError('CURRENT_HELD_ARCHIVE_REQUIRED')
        if item['volumes'] or len(item['paths']) != 1:
            raise ValueError('SINGLE_ARCHIVE_PATH_WITHOUT_VOLUMES_REQUIRED')
        root = Path(item['paths'][0])
        if (root.parent != self.control / 'temporary' / 'controller' or
                root.resolve() != root or root.is_symlink()):
            raise ValueError('CANONICAL_CONTROLLER_ARCHIVE_REQUIRED')
        self.require_task_not_completed(role, item['task'])
        self.require_managed_guard(self.rows(), role)
        return item

    def _retained_archive_stats(self, item):
        root = Path(item['paths'][0])
        first = self._archive_stat(root.lstat())
        if not stat.S_ISDIR(first['mode']) or first['device'] != self.control.stat().st_dev:
            raise ValueError('SAME_FILESYSTEM_ARCHIVE_DIRECTORY_REQUIRED')
        files = []
        for p in sorted(root.iterdir()):
            st = self._archive_stat(p.lstat())
            if (not stat.S_ISREG(st['mode']) or st['links'] != 1 or
                    st['device'] != first['device'] or
                    not re.fullmatch(r'[A-Za-z0-9_-]+\.(json|tar\.gz)', p.name)):
                raise ValueError('ONLY_REGULAR_ARCHIVE_PAIRS_ALLOWED')
            files.append({'name': p.name, 'stat': st})
            if len(files) > 512 or sum(x['stat']['size'] for x in files) > 8192 * MIB:
                raise ValueError('ARCHIVE_INVENTORY_LIMIT')
        names = {x['name'] for x in files}
        manifests = {n[:-5] for n in names if n.endswith('.json')}
        archives = {n[:-7] for n in names if n.endswith('.tar.gz')}
        if not manifests or manifests != archives:
            raise ValueError('COMPLETE_ARCHIVE_MANIFEST_PAIRS_REQUIRED')
        if self._archive_stat(root.lstat()) != first:
            raise ValueError('RETAINED_ARCHIVE_CHANGED')
        return {'root_stat': first, 'files': files}

    @staticmethod
    def _require_no_archive_writers(root):
        """Fail closed on live consumers that can still grow the retained set."""
        def inside(value):
            return value == str(root) or value.startswith(str(root) + '/')
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                if inside(os.readlink(proc / 'cwd')):
                    raise ValueError('RETAINED_ARCHIVE_ACTIVE_CONSUMER')
                for fd in (proc / 'fd').iterdir():
                    try:
                        target = os.readlink(fd)
                        if not inside(target):
                            continue
                        # A directory fd opened O_RDONLY/O_PATH is still mutation-capable
                        # through openat/renameat/unlinkat. Retained archives are fixed,
                        # so any live descriptor to the archive root fails closed.
                        if target == str(root):
                            raise ValueError('RETAINED_ARCHIVE_ACTIVE_WRITER')
                        info = (proc / 'fdinfo' / fd.name).read_text()
                        flags = next(int(line.split()[1], 8) for line in info.splitlines()
                                     if line.startswith('flags:'))
                        if flags & os.O_ACCMODE != os.O_RDONLY:
                            raise ValueError('RETAINED_ARCHIVE_ACTIVE_WRITER')
                    except FileNotFoundError:
                        continue  # descriptor/process ended during observation
                for line in (proc / 'maps').read_text().splitlines():
                    fields = line.split(None, 5)
                    if len(fields) == 6 and 'w' in fields[1] and inside(fields[5]):
                        raise ValueError('RETAINED_ARCHIVE_ACTIVE_WRITER')
            except FileNotFoundError:
                continue

    def reconcile_retained(self, lease_id, role, reserve_mib, proof_path, review_path):
        """Reduce an overestimated fixed retention budget after independent review."""
        if type(reserve_mib) is not int or reserve_mib < 16:
            raise ValueError('POSITIVE_RETAINED_RESERVE_REQUIRED')
        proof_raw = Path(proof_path).read_bytes()
        proof = json.loads(proof_raw)
        review_raw = Path(review_path).read_bytes()
        review = json.loads(review_raw)
        if (review.get('verdict') != 'PASS' or
                review.get('reviewer_role') not in ('A', 'B', 'C', 'INDEPENDENT_CODEX') or
                review.get('allocation_id') != lease_id or
                review.get('inventory_sha256') != hashlib.sha256(proof_raw).hexdigest() or
                review.get('reserve_mib') != reserve_mib or
                review.get('fixed_retention_only') is not True or
                review.get('no_active_writers_verified') is not True):
            raise ValueError('INDEPENDENT_FIXED_RETENTION_REVIEW_REQUIRED')
        current = self.retained_archive_inventory(lease_id, role)
        # Bind the exact bytes, filesystem identities, original budget and due
        # date reviewed. Timestamp alone is excluded; fresh hashing is required.
        if ({k: v for k, v in current.items() if k != 'observed_at'} !=
                {k: v for k, v in proof.items() if k != 'observed_at'}):
            raise ValueError('RETAINED_INVENTORY_MISMATCH')
        if not current['minimum_reserve_mib'] <= reserve_mib < current['reserve_mib']:
            raise ValueError('RETAINED_RESERVE_REDUCTION_WITH_MARGIN_REQUIRED')
        observed = proof.get('observed_at')
        if type(observed) not in (int, float) or not 0 <= self.clock() - observed <= 3600:
            raise ValueError('FRESH_RETAINED_INVENTORY_REQUIRED')
        self._require_no_archive_writers(Path(current['paths'][0]))
        with self.locked():
            item = self._retained_archive_item(lease_id, role)
            if (item['reserve_mib'] != current['reserve_mib'] or
                    item['due_at'] != current['due_at'] or
                    item['task'] != current['task'] or item['paths'] != current['paths'] or
                    self._retained_archive_stats(item) != {
                        'root_stat': current['root_stat'],
                        'files': [{'name': f['name'], 'stat': f['stat']} for f in current['files']]}):
                raise ValueError('RETAINED_ARCHIVE_CHANGED')
            event = {'at': self.clock(), 'action': 'reconcile-retained',
                     'previous_state': item['state'], 'previous_reserve_mib': item['reserve_mib'],
                     'reserve_mib': reserve_mib, 'inventory_path': str(Path(proof_path).resolve()),
                     'inventory_sha256': hashlib.sha256(proof_raw).hexdigest(),
                     'review_path': str(Path(review_path).resolve()),
                     'review_sha256': hashlib.sha256(review_raw).hexdigest(),
                     'measured_bytes': current['measured_bytes'],
                     'minimum_reserve_mib': current['minimum_reserve_mib']}
            item['history'].append(event)
            item['reserve_mib'] = reserve_mib
            item['fixed_retention_only'] = True
            atomic_json(self.directory / (item['id'] + '.json'), item)
            return item

    def _verify_controller_authored_task_inventory(self, role, task, foreign_rows):
        """Bind a CONTROLLER worktree to a normally published role task.

        A shared task id or a locally written no-output declaration is not
        delegation authority. The publisher's exact closed registration and
        hashed review/close receipts must refer to the real reserved worktree.
        """
        if role not in ('A', 'B', 'C') or not foreign_rows or any(
                row['role'] != 'CONTROLLER' for row in foreign_rows):
            raise ValueError('CROSS_ROLE_RESOURCE_AUTHORITY_REQUIRED')
        board_path = self.control / 'controllers' / 'work-board.json'
        if board_path.is_symlink() or not board_path.is_file():
            raise ValueError('CROSS_ROLE_TASK_IDENTITY_MISSING')
        # Native V2 keeps DONE tasks in a verified immutable archive, outside
        # the hot tasks array. Read the complete logical board through the
        # versioned queue loader (including committed journal/archive checks),
        # not the partial hot JSON. V1 continues through that same validator.
        try:
            from work_queue import load_board
        except ImportError:
            # The installed resource CLI can be provisioned separately from
            # its trusted native queue reader. Never substitute hot JSON.
            raise ValueError('CROSS_ROLE_NATIVE_VERIFIER_UNAVAILABLE') from None
        try:
            board = load_board(self.control)
        except (RuntimeError, OSError, ValueError, KeyError, TypeError):
            raise ValueError('CROSS_ROLE_TASK_LEDGER_UNVERIFIED') from None
        tasks = [item for item in board['tasks']
                 if item.get('id') == task and item.get('role') == role
                 and item.get('state') in ('IN_PROGRESS', 'DONE')]
        if len(tasks) != 1:
            raise ValueError('CROSS_ROLE_TASK_IDENTITY_MISMATCH')
        if tasks[0]['state'] == 'DONE':
            # DONE may be committed just before the resource SEALING->SEALED
            # metadata write. Never re-attest the finished delegated task
            # as complete while that second durable transition is pending.
            # The queue dependency evaluator must separately enforce this
            # seal; this check only protects resource inventory consumers.
            seal = self.completion_record(role, task)
            if seal is None or seal['state'] != 'SEALED':
                raise ValueError('CROSS_ROLE_COMPLETION_SEAL_REQUIRED')
        # Never mistake a role-local no-output declaration for the work of
        # the actual controller author. Every real allocation remains visible.
        if any(row['role'] == role and row.get('kind') == 'NO_TEMPORARY_OUTPUTS'
               for row in self.rows() if row['task'] == task):
            raise ValueError('CROSS_ROLE_FALSE_NO_OUTPUT_DECLARATION')
        foreign_paths = {path for row in foreign_rows for path in row['paths']}
        active_foreign_paths = [path for row in foreign_rows
                                if row['state'] != 'CLOSED' for path in row['paths']]
        if len(active_foreign_paths) != len(set(active_foreign_paths)):
            raise ValueError('CROSS_ROLE_DUPLICATE_ACTIVE_ARTIFACT')
        allowed_roots = (self.control / 'worktrees' / 'controller',
                         self.control / 'temporary' / 'controller')
        for row in foreign_rows:
            if row['volumes'] or any(Path(path).parent not in allowed_roots
                                     for path in row['paths']):
                raise ValueError('CROSS_ROLE_RESOURCE_SCOPE_INVALID')
            if row['state'] == 'HELD':
                if (not row.get('consumer') or not row.get('hold_reason') or
                        row['due_at'] <= self.clock() or
                        any(not Path(path).is_dir() or Path(path).is_symlink()
                            for path in row['paths'])):
                    raise ValueError('CROSS_ROLE_HELD_RESOURCE_INVALID')
        registration_dir = self.control / 'controllers' / 'task-publication' / 'registrations'
        if registration_dir.is_symlink() or not registration_dir.is_dir():
            raise ValueError('CROSS_ROLE_PUBLICATION_MISSING')
        files = list(registration_dir.glob('*.json'))
        if len(files) > 512 or any(path.is_symlink() for path in files):
            raise ValueError('CROSS_ROLE_PUBLICATION_INVENTORY_INVALID')

        def verified_receipt(item, path=None):
            if not isinstance(item, dict) or not isinstance(item.get('path'), str):
                raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_MISSING')
            receipt = Path(item['path'])
            if (not receipt.is_absolute() or
                    not receipt.is_relative_to(self.control) or
                    (path is not None and receipt != path)):
                raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_INVALID')
            parts = receipt.relative_to(self.control).parts
            if not parts or any(part in ('.', '..') for part in parts):
                raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_INVALID')

            # Pin the entire trusted directory chain, not only the final file.
            # No component may traverse a symlink. All reads and the last
            # lstat use the same pinned parent directory descriptor; a final
            # ordinary path readback also detects a renamed ancestor.
            dir_flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
            file_flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
            parent_fd = None
            try:
                parent_fd = os.open(self.control, dir_flags)
                for part in parts[:-1]:
                    child_fd = os.open(part, dir_flags, dir_fd=parent_fd)
                    os.close(parent_fd)
                    parent_fd = child_fd
                fd = os.open(parts[-1], file_flags, dir_fd=parent_fd)
                with os.fdopen(fd, 'rb') as handle:
                    before = os.fstat(handle.fileno())
                    if not stat.S_ISREG(before.st_mode) or before.st_size > 4 * MIB:
                        raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_INVALID')
                    raw = handle.read(4 * MIB + 1)
                    after = os.fstat(handle.fileno())
                pinned = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
                current = receipt.lstat()
            except OSError as exc:
                raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_INVALID') from exc
            finally:
                if parent_fd is not None:
                    os.close(parent_fd)
            def identity(st):
                return (st.st_dev, st.st_ino, st.st_size,
                        st.st_mtime_ns, st.st_ctime_ns)
            if (len(raw) > 4 * MIB or not stat.S_ISREG(pinned.st_mode) or
                    not stat.S_ISREG(current.st_mode) or
                    identity(before) != identity(after) or
                    identity(before) != identity(pinned) or
                    identity(before) != identity(current) or
                    hashlib.sha256(raw).hexdigest() != item.get('sha256')):
                raise ValueError('CROSS_ROLE_PUBLICATION_RECEIPT_INVALID')
            return json.loads(raw)

        # Reuse the native publisher's core SHA and immutable versioned state
        # validation. A fabricated self-hashed review and close JSON cannot
        # supply task-ref publication authority on its own.
        try:
            from task_publication import _read_registration, PublicationError
            from work_queue import _publication_completion_candidate
        except ImportError as exc:
            # The standalone operational script is not by itself a trusted
            # native publisher. A deployment missing the approved verifier
            # must fail closed, not improvise a weaker JSON-only fallback.
            raise ValueError('CROSS_ROLE_NATIVE_VERIFIER_UNAVAILABLE') from exc
        # Every registration, including an unrelated one, must be bounded
        # before JSON parsing. Skip no unreadable record: its true task/role
        # cannot be established without a trusted native issuer identity.
        # Pin all ancestors with O_NOFOLLOW to bound symlink/replacement races
        # while the disk inventory lock is held.
        max_registration_bytes = 64 * 1024
        max_inventory_bytes = 8 * MIB
        inventory_bytes = 0

        def pinned_registration(registration_file):
            if (registration_file.parent != registration_dir or
                    not re.fullmatch(r'[0-9a-f]{64}\.json', registration_file.name)):
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_INVALID')
            dir_flags = (os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) |
                         getattr(os, 'O_NOFOLLOW', 0))
            file_flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
            dir_fd = None
            try:
                dir_fd = os.open(self.control, dir_flags)
                for part in ('controllers', 'task-publication', 'registrations'):
                    next_fd = os.open(part, dir_flags, dir_fd=dir_fd)
                    os.close(dir_fd)
                    dir_fd = next_fd
                file_fd = os.open(registration_file.name, file_flags, dir_fd=dir_fd)
                with os.fdopen(file_fd, 'rb') as handle:
                    before = os.fstat(handle.fileno())
                    if not stat.S_ISREG(before.st_mode) or before.st_size > max_registration_bytes:
                        raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_TOO_LARGE')
                    raw = handle.read(max_registration_bytes + 1)
                    after = os.fstat(handle.fileno())
                pinned = os.stat(registration_file.name, dir_fd=dir_fd,
                                 follow_symlinks=False)
                current = registration_file.lstat()
                pinned_parent = os.fstat(dir_fd)
                current_parent = registration_dir.lstat()
            except OSError as exc:
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_READ_INVALID') from exc
            finally:
                if dir_fd is not None:
                    os.close(dir_fd)

            def identity(st):
                return (st.st_dev, st.st_ino, st.st_size,
                        st.st_mtime_ns, st.st_ctime_ns)
            if (len(raw) > max_registration_bytes or not stat.S_ISREG(pinned.st_mode) or
                    not stat.S_ISREG(current.st_mode) or len(raw) != before.st_size or
                    identity(before) != identity(after) or
                    identity(before) != identity(pinned) or
                    identity(before) != identity(current) or
                    not stat.S_ISDIR(current_parent.st_mode) or
                    identity(pinned_parent) != identity(current_parent)):
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_CHANGED')
            try:
                record = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_INVALID_JSON') from exc
            if not isinstance(record, dict):
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_INVALID_JSON')
            return record, hashlib.sha256(raw).hexdigest(), len(raw)

        proven_worktrees = {}
        for registration_file in files:
            registration, initial_sha, byte_count = pinned_registration(registration_file)
            inventory_bytes += byte_count
            if inventory_bytes > max_inventory_bytes:
                raise ValueError('CROSS_ROLE_PUBLICATION_REGISTRATION_BUDGET_EXCEEDED')
            core = registration.get('core') or {}
            if (core.get('role') != role or core.get('task_id') != task or
                    core.get('worktree_path') not in foreign_paths):
                continue
            registration_id = registration_file.stem
            try:
                registration, native_raw_sha = _read_registration(
                    self.control, registration_id)
            except (PublicationError, OSError, ValueError, KeyError, TypeError) as exc:
                raise ValueError('CROSS_ROLE_NATIVE_PUBLISHER_INVALID') from exc
            if initial_sha != native_raw_sha:
                raise ValueError('CROSS_ROLE_PUBLICATION_VERSION_DRIFT')
            core = registration.get('core') or {}
            if (registration.get('kind') != 'octoport.task-publication-registration' or
                    registration.get('registration_id') != registration_id or
                    registration.get('registration_sha256') != registration_id or
                    registration.get('state') != 'CLOSED' or
                    registration.get('task_ref_cleanup_status') != 'DELETED' or
                    not re.fullmatch(r'[0-9a-f]{40}', str(core.get('candidate_head'))) or
                    not re.fullmatch(r'[0-9a-f]{40}', str(core.get('candidate_tree')))):
                raise ValueError('CROSS_ROLE_PUBLICATION_NOT_ACCEPTED')
            # The queue completion verifier additionally checks the native
            # READY evidence, task fingerprint, exact five successful CI runs,
            # PUBLISHED predecessor and final close. A CLOSED JSON alone is
            # not proof that a normal accepted source publication occurred.
            try:
                native_candidate, native_snapshot = _publication_completion_candidate(
                    self.control, role, tasks[0], registration_id,
                    allow_done=tasks[0]['state'] == 'DONE')
            except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
                raise ValueError('CROSS_ROLE_NATIVE_COMPLETION_PROOF_INVALID') from exc
            if (native_candidate != core['candidate_head'] or
                    native_snapshot.get('registration_id') != registration_id or
                    native_snapshot.get('role') != role or
                    native_snapshot.get('task_paths') != tasks[0].get('paths')):
                raise ValueError('CROSS_ROLE_NATIVE_COMPLETION_IDENTITY_DRIFT')
            review = verified_receipt(core.get('review'))
            manifest = verified_receipt(core.get('accepted_manifest'))
            close = verified_receipt(
                registration.get('close_receipt'),
                self.control / 'controllers' / 'task-publication' / 'close' /
                registration_id / 'receipt.json')
            accepted = manifest.get('accepted')
            if (not isinstance(accepted, list) or len(accepted) != 1 or
                    not isinstance(accepted[0], dict)):
                raise ValueError('CROSS_ROLE_PUBLICATION_MANIFEST_INVALID')
            source = accepted[0]
            if (review.get('verdict') != 'PASS' or
                    review.get('candidate_sha') != core['candidate_head'] or
                    source.get('task_id') != task or
                    source.get('source_head') != core['candidate_head'] or
                    source.get('source_tree') != core['candidate_tree'] or
                    source.get('source_base') != core.get('base_sha') or
                    sorted(source.get('exact_task_paths') or []) != sorted(tasks[0].get('paths') or []) or
                    sorted(core.get('task_paths') or []) != sorted(tasks[0].get('paths') or []) or
                    close.get('kind') != 'octoport.task-publication-close' or
                    close.get('registration_id') != registration_id or
                    close.get('state_before') != 'PUBLISHED'):
                raise ValueError('CROSS_ROLE_PUBLICATION_SOURCE_MISMATCH')
            if core['worktree_path'] in proven_worktrees:
                # Two independent accepted publications for one live source
                # would leave the later DONE caller free to choose either.
                raise ValueError('CROSS_ROLE_PUBLISHER_IDENTITY_AMBIGUOUS')
            proven_worktrees[core['worktree_path']] = registration_id
        if not proven_worktrees:
            raise ValueError('CROSS_ROLE_PUBLICATION_NOT_FOUND_FOR_RESOURCE')
        if set(active_foreign_paths) - proven_worktrees.keys():
            # One accepted source registration does not authorize another
            # unrelated active CONTROLLER output of this same task.
            raise ValueError('CROSS_ROLE_ACTIVE_ARTIFACT_UNATTESTED')
        identities = (set(proven_worktrees.values()) if not active_foreign_paths
                      else {proven_worktrees[path] for path in active_foreign_paths})
        if len(identities) != 1:
            raise ValueError('CROSS_ROLE_PUBLISHER_IDENTITY_AMBIGUOUS')
        return identities.pop()

    def status_locked(self, role=None, task=None, complete=False):
        rows = self.rows()
        selected = [r for r in rows if (not role or r['role'] == role) and
                    (not task or r['task'] == task)]
        delegated_registration = None
        foreign_allocation_count = None
        if complete and role is not None and task is not None:
            # An absent delegation field is not proof of zero foreign work.
            # This inventory attestation is mandatory even for role-local
            # completion, and it is derived from this locked registry snapshot.
            foreign = [r for r in rows if r['task'] == task and r['role'] != role]
            foreign_allocation_count = len(foreign)
            if foreign:
                delegated_registration = self._verify_controller_authored_task_inventory(
                    role, task, foreign)
                selected = [r for r in rows if r['task'] == task]
        unresolved = [r['id'] for r in selected if r['state'] != 'CLOSED' and
                      (r['state'] == 'OPEN' or r['due_at'] <= self.clock())]
        guard = self.managed_guard(rows, role)
        if foreign_allocation_count is not None and role in ('A', 'B', 'C'):
            # V1 count=0 means the locked registry contained no foreign rows,
            # not permission to ignore unregistered CONTROLLER outputs.
            # Check the real producer lane even for exact zero, so a missing
            # lease cannot be misreported as an exhaustive empty inventory.
            # Ordinary non-completion status calls retain their own scope.
            controller_guard = self.managed_guard(rows, 'CONTROLLER')
            guard['baseline_required'] |= controller_guard['baseline_required']
            guard['unregistered_managed_paths'].extend(
                controller_guard['unregistered_managed_paths'])
        if complete and not selected:
            raise ValueError('ARTIFACT_INVENTORY_MISSING')
        if complete and guard['baseline_required']:
            raise ValueError('DISK_LIFECYCLE_BASELINE_REQUIRED')
        if complete and guard['unregistered_managed_paths']:
            paths = ','.join(item['path'] for item in guard['unregistered_managed_paths'])
            raise ValueError('UNREGISTERED_MANAGED_PATHS:' + paths)
        if complete and unresolved:
            raise ValueError('CLEANUP_NOT_COMPLETE:' + ','.join(unresolved))
        result = {'resources': self.snapshot(), 'reserve_floor_mib': RESERVE_MIB,
                  'all_open_reservations_mib': sum(r['reserve_mib'] for r in rows if r['state'] != 'CLOSED'),
                  'unresolved': unresolved, 'allocations': selected, 'managed_guard': guard,
                  'note': 'HELD means retained for the named consumer. New unmanaged roots after the sealed baseline are fail-closed.'}
        if foreign_allocation_count is not None:
            # Explicit locked snapshot contract for the C-owned atomic DONE
            # gate. Version 1 always attests a complete inventory: zero means
            # an observed zero, not a missing or untrusted response field.
            # The producer's accepted native registration must be the exact
            # publication_registration of the normal guarded queue transition.
            result.update(delegation_inventory_version=1,
                          delegation_inventory_attested=True,
                          foreign_allocation_count=foreign_allocation_count,
                          delegated_publication_registration=delegated_registration)
        return result

    def status(self, role=None, task=None, complete=False):
        with self.locked():
            return self.status_locked(role, task, complete)

    def reopen_if_completion_locked(self, role, task):
        item = self.completion_record(role, task)
        if item and item['state'] in ('SEALING', 'SEALED'):
            # Both ordinary queue reopening and the direct exception path
            # share the durable transition guard in record_completion_state.
            return self.record_completion_state(role, task, 'REOPENED')
        return item


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['seed-baseline','begin','declare-none','close','hold','status','check-complete','retention-inventory','reconcile-retained'])
    p.add_argument('--role', choices=ROLES)
    p.add_argument('--task')
    p.add_argument('--purpose')
    p.add_argument('--path', action='append', default=[])
    p.add_argument('--volume', action='append', default=[])
    p.add_argument('--reserve-mib', type=int)
    p.add_argument('--hours', type=float, default=24)
    p.add_argument('--id')
    p.add_argument('--reason', default='')
    p.add_argument('--consumer', default='')
    p.add_argument('--review')
    args=p.parse_args(argv)
    registry=Registry()
    try:
        if args.action=='seed-baseline':
            result=registry.seed_baseline()
        elif args.action=='begin':
            result=registry.begin(args.role,args.task,args.purpose,args.path,args.reserve_mib,args.hours,args.volume)
        elif args.action=='declare-none':
            result=registry.declare_none(args.role,args.task,args.purpose)
        elif args.action in ('close','hold'):
            result=registry.change(args.id,args.role,args.action,args.reason,args.consumer,args.hours)
        elif args.action=='retention-inventory':
            result=registry.retained_archive_inventory(args.id,args.role)
        elif args.action=='reconcile-retained':
            result=registry.reconcile_retained(args.id,args.role,args.reserve_mib,args.reason,args.review)
        else:
            if args.action=='check-complete' and (not args.role or not args.task):
                raise ValueError('ROLE_AND_TASK_REQUIRED')
            result=registry.status(args.role,args.task,args.action=='check-complete')
        print(json.dumps(result,ensure_ascii=False,indent=2))
        return 0
    except (ValueError,OSError,KeyError,TypeError,subprocess.TimeoutExpired) as exc:
        print(json.dumps({'status':'DISK_LIFECYCLE_BLOCKED','reason':str(exc)},ensure_ascii=False))
        return 75


if __name__=='__main__':
    sys.exit(main())
