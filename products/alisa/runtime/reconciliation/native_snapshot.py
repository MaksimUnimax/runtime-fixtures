"""Bounded native AL-S16 metadata snapshot; no state transition or authenticity claim.

Caller supplies an already-authorized exact RuntimePort scope, on the native
side. This module is NOT an authority adapter or an IPC endpoint. It never
opens a configured/live database on import, follows an alias, calls a provider,
or uses Repository.get(), whose expiry handling may write. Transport and staff
proof integration require separate qualification before exposing this reader.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
from uuid import UUID

SCHEMA = 'alisa-native-reconciliation-snapshot/v1'
MAX_CALLS = 16
MAX_BYTES = 16384
MAX_TIME = 253402300799
# Exact column allowlist: notably excludes questions, plan/result/progress,
# error text, source/account identifiers, credentials, and raw owner tokens.
COLUMNS = {
    'rt_job_refs': {'ref', 'tenant', 'actor', 'logical_id', 'body_hash',
                    'guard_hash', 'runtime_tenant', 'jid', 'created'},
    'jobs': {'id', 'tenant', 'state', 'created', 'updated', 'due', 'lease',
             'owner', 'expires', 'alias', 'dispatch_order', 'resume_safe'},
    'reader_cursors': {'tenant', 'conversation', 'jid', 'cancelled', 'updated'},
    'calls': {'id', 'jid', 'at', 'state', 'http', 'elapsed_ms', 'response_bytes'},
}


class SnapshotUnavailable(Exception):
    """Closed diagnostic code only, never SQLite text, path, or row values."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def need(value, code='SNAPSHOT_INVALID'):
    if not value:
        raise SnapshotUnavailable(code)


def uuid_text(value):
    need(type(value) is str and len(value) == 36, 'SCOPE_INVALID')
    try:
        need(str(UUID(value)) == value, 'SCOPE_INVALID')
    except ValueError:
        raise SnapshotUnavailable('SCOPE_INVALID') from None


def finite(value):
    need(type(value) in (int, float) and math.isfinite(value)
         and 0 <= value <= MAX_TIME)
    return value


def hash_text(value):
    need(type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None)
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True,
                      separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return sha256(canonical(value)).hexdigest()


@dataclass(frozen=True, repr=False)
class NativeScope:
    """Data produced by existing authority after verification, not permission.

    No verified=True switch or fallback customer identity. A future transport
    MUST independently construct/revalidate this scope; accepting it from a
    browser would not authenticate anything.
    """
    object_id: str
    tenant_id: str
    customer_id: str
    runtime_job_ref: str
    runtime_tenant: str
    guard_sha256: str

    def __repr__(self):
        return '<NativeScope; caller must independently authorize>'

    def validate(self):
        for value in (self.object_id, self.tenant_id, self.customer_id, self.runtime_job_ref):
            uuid_text(value)
        need(type(self.runtime_tenant) is str and 1 <= len(self.runtime_tenant) <= 128
             and all(32 <= ord(ch) <= 126 for ch in self.runtime_tenant), 'SCOPE_INVALID')
        hash_text(self.guard_sha256)


def _authorizer(action, table, column, database, origin):
    if action == sqlite3.SQLITE_SELECT:
        return sqlite3.SQLITE_OK
    if (action == sqlite3.SQLITE_READ and database == 'main' and origin is None
            and table in COLUMNS and column in COLUMNS[table]):
        return sqlite3.SQLITE_OK
    # No writes, functions, schema access, ATTACH, triggers/views or PRAGMA.
    return sqlite3.SQLITE_DENY


def _identity(path, uid, *, directory=False):
    st = path.lstat()
    need((stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode))
         and st.st_uid in ({0, uid} if directory else {uid})
         and not st.st_mode & 0o022
         and (directory or st.st_nlink == 1), 'DATABASE_IDENTITY_INVALID')
    return st.st_dev, st.st_ino, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode), st.st_nlink


def _one(connection, query, values, missing):
    rows = connection.execute(query, values).fetchmany(2)
    need(len(rows) <= 1, 'SNAPSHOT_AMBIGUOUS')
    need(bool(rows), missing)
    return dict(rows[0])


def _read(connection, scope, observed_at):
    ref = _one(connection, '''SELECT ref,tenant,actor,logical_id,body_hash,
        guard_hash,runtime_tenant,jid,created FROM rt_job_refs
        WHERE ref=? AND tenant=? AND actor=? AND logical_id=? LIMIT 2''',
        (scope.runtime_job_ref, scope.tenant_id, scope.customer_id, scope.object_id),
        'OPERATION_BINDING_UNAVAILABLE')
    need(ref['guard_hash'] == scope.guard_sha256 and ref['runtime_tenant'] == scope.runtime_tenant,
         'OPERATION_SCOPE_CHANGED')
    hash_text(ref['body_hash']); hash_text(ref['guard_hash'])
    jid = ref['jid']
    need(type(jid) is str and re.fullmatch('[a-f0-9]{32}', jid) is not None,
         'NATIVE_IDENTITY_INVALID')
    finite(ref['created'])
    job = _one(connection, '''SELECT id,tenant,state,created,updated,due,lease,
        owner IS NOT NULL AS has_owner,expires,alias,dispatch_order,resume_safe FROM jobs
        WHERE id=? AND tenant=? LIMIT 2''', (jid, scope.runtime_tenant),
        'NATIVE_JOB_UNAVAILABLE')
    need(job['alias'] is None, 'ALIAS_REQUIRES_SEPARATE_PROOF')
    need(job['state'] in {'UNKNOWN','QUEUED','RUNNING','READY','NEEDS_INPUT',
                          'FAILED','CANCELLED','EXPIRED'}, 'NATIVE_STATE_INVALID')
    for key in ('created', 'updated', 'due'):
        finite(job[key])
    for key in ('lease', 'expires'):
        if job[key] is not None:
            finite(job[key])
    need(job['created'] <= job['updated'] <= observed_at
         and job['created'] <= ref['created'] <= observed_at)
    need(type(job['dispatch_order']) is int and 0 <= job['dispatch_order'] < 2**63)
    need(type(job['resume_safe']) is int and job['resume_safe'] in (0, 1))
    need(type(job['has_owner']) is int and job['has_owner'] in (0, 1))
    reader = _one(connection, '''SELECT cancelled,updated FROM reader_cursors
        WHERE tenant=? AND conversation=? AND jid=? LIMIT 2''',
        (scope.runtime_tenant, 'rt_'+scope.runtime_job_ref.replace('-', ''), jid),
        'READER_BINDING_UNAVAILABLE')
    need(type(reader['cancelled']) is int and reader['cancelled'] in (0, 1))
    finite(reader['updated']); need(reader['updated'] <= observed_at)
    need(reader['cancelled'] == 0, 'READER_CANCELLED')
    # LIMIT+1 bounds payload, while the SQLite VM deadline bounds a sparse scan.
    calls = [dict(row) for row in connection.execute('''SELECT id,at,state,http,
        elapsed_ms,response_bytes FROM calls WHERE jid=? ORDER BY id DESC LIMIT ?''',
        (jid, MAX_CALLS+1))]
    truncated = len(calls) > MAX_CALLS
    calls = calls[:MAX_CALLS]
    for call in calls:
        need(type(call['id']) is int and 0 < call['id'] < 2**63)
        finite(call['at']); need(job['created'] <= call['at'] <= observed_at)
        need(call['state'] in {'SENDING','RECEIVED','UNKNOWN','HTTP_ERROR'})
        need(call['http'] is None or (type(call['http']) is int and 100 <= call['http'] <= 599))
        for key in ('elapsed_ms', 'response_bytes'):
            need(call[key] is None or (type(call[key]) is int and 0 <= call[key] < 2**63))
    # Snapshot is exact metadata, not an authenticated whole-job outcome.
    binding = {'product_id':'alisa_market', 'object_id':scope.object_id,
        'tenant_id':scope.tenant_id, 'customer_id':scope.customer_id,
        'runtime_job_ref':scope.runtime_job_ref, 'request_sha256':ref['body_hash'],
        'guard_sha256':ref['guard_hash'], 'reference_created_at':ref['created'],
        'native_job_ref_sha256':sha256(jid.encode()).hexdigest(),
        'native_created_at':job['created'], 'native_updated_at':job['updated'],
        'dispatch_sequence':job['dispatch_order'], 'state':job['state'],
        'due':job['due'], 'lease':job['lease'], 'expires':job['expires'],
        'has_owner':bool(job['has_owner']), 'resume_safe':bool(job['resume_safe']),
        'reader_updated_at':reader['updated']}
    return {'schema':SCHEMA, 'binding':binding, 'binding_sha256':digest(binding),
        'observed_at':observed_at, 'retained_calls':calls,
        'retained_calls_truncated':truncated,
        'call_history_complete':False, 'whole_job_outcome':'UNPROVEN',
        'job_state_changed':False, 'replay_permitted':False}


def read_snapshot(path, scope, *, expected_uid, timeout=0.25,
                  clock=time.time, monotonic=time.monotonic):
    """Read current WAL state in ONE read transaction, never immutable/stale mode.

    Path/uid are trusted native startup configuration, never request parameters.
    Existing SQLite WAL coordination may touch sidecars; no logical DB writes.
    Deadline bounds SQLite work and lock waits, not arbitrary OS I/O stalls.
    No worker, retry, fallback DB, chmod, migration or registration is created.
    """
    need(type(scope) is NativeScope, 'SCOPE_INVALID'); scope.validate()
    need(type(expected_uid) is int and expected_uid >= 0, 'SCOPE_INVALID')
    need(type(timeout) in (float,int) and math.isfinite(timeout)
         and 0.05 <= timeout <= 1, 'TIMEOUT_INVALID')
    need(isinstance(path, (str, Path)), 'DATABASE_PATH_INVALID')
    path = Path(path)
    need(path.is_absolute(), 'DATABASE_PATH_INVALID')
    connection = None
    deadline = monotonic()+timeout
    def check_time():
        need(monotonic() < deadline, 'SNAPSHOT_TIMEOUT')
    try:
        need(path.resolve(strict=True) == path, 'DATABASE_PATH_INVALID')
        parent = _identity(path.parent, expected_uid, directory=True)
        before = _identity(path, expected_uid)
        observed = finite(clock()); check_time()
        connection = sqlite3.connect(path.as_uri()+'?mode=ro&cache=private', uri=True,
                                     timeout=min(timeout, 0.05), isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.enable_load_extension(False)
        connection.execute('PRAGMA trusted_schema=OFF')
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        connection.set_progress_handler(lambda: int(monotonic() >= deadline), 100)
        connection.set_authorizer(_authorizer)
        result = _read(connection, scope, observed)
        check_time(); after = finite(clock())
        need(after >= observed, 'SNAPSHOT_CLOCK_CHANGED')
        need(_identity(path, expected_uid) == before
             and _identity(path.parent, expected_uid, directory=True) == parent,
             'DATABASE_IDENTITY_CHANGED')
        need(len(canonical(result)) <= MAX_BYTES, 'SNAPSHOT_TOO_LARGE')
        return result
    except SnapshotUnavailable:
        raise
    except (sqlite3.Error, OSError, ValueError, TypeError, OverflowError):
        raise SnapshotUnavailable('NATIVE_SNAPSHOT_UNAVAILABLE') from None
    finally:
        if connection is not None:
            connection.set_authorizer(None)
            try:
                connection.rollback()
            finally:
                connection.close()
