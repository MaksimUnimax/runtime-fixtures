"""Counts-only rollout readiness; no environment, schema or application bootstrap.

Call the samplers afresh before and after the activator closes admission. A
successful sample is not an admission lock. The parent owns current path/source
pins, invokes sqlite_counts as the existing native service UID/GID and voice_count
as the existing Station service identity. Shared read access is not assumed.
SQLite uses normal WAL locking: mode=ro/query_only prohibit logical writes, but
SQLite may use/create its auxiliary shared-memory lock files. Never use immutable
mode, a copied database, Repository/GapStore constructors, pending() or ACK here.

The PostgreSQL caller supplies a fresh normally configured Django connection;
systemd, not this module, loads its exact EnvironmentFiles. Require startup
default_transaction_read_only=on (for example through reviewed PGOPTIONS).
Only PostgreSQL metadata and aggregate counts are selected. No model, payload,
credential, owner fact, continuation value or identifier is returned.
"""
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import sqlite3
import stat
import time


DB_ROLE = 'alisa_stage_platform_runtime'
DB_NAME = 'alisa_stage_platform'
NATIVE_KEYS = ('native_active_jobs', 'native_unknown_jobs', 'native_live_leases',
               'native_unexpired_jobs', 'event_outbox_pending',
               'terminal_outbox_pending', 'voice_undelivered')
SQLITE_KEYS = NATIVE_KEYS[:-1]
POSTGRES_KEYS = ('active_queries', 'live_query_leases', 'unresolved_continuations')
NATIVE_SECONDS = 3
MAX_STATE_BYTES = 1048576
JOBS_COLUMNS = {
    **{key: 'TEXT' for key in ('id', 'tenant', 'key', 'state', 'draft', 'plan',
                              'progress', 'result', 'error', 'owner', 'alias')},
    **{key: 'REAL' for key in ('created', 'updated', 'due', 'lease', 'expires')},
    **{key: 'INTEGER' for key in ('delivered', 'page', 'dispatch_order',
                                 'queue_order', 'resume_safe')},
}
EVENT_COLUMNS = {**{key: 'TEXT' for key in ('id', 'case_id', 'rid', 'body', 'sha256')},
                 'created': 'REAL', 'sealed': 'INTEGER'}
TERMINAL_COLUMNS = {
    **{key: 'TEXT' for key in ('tenant', 'rid', 'jid', 'reason', 'reader_state', 'body', 'sha256')},
    'revision': 'INTEGER', 'created': 'REAL', 'input_pending': 'INTEGER',
}
PG_COLUMNS = [('continuation', 'jsonb', True), ('expires_at', 'timestamptz', True),
              ('lease_until', 'timestamptz', False), ('state', 'varchar', True)]
_CODES = {
    'READINESS_SCHEMA', 'READINESS_BUSY', 'READINESS_UNAVAILABLE',
    'NATIVE_READINESS_UNAVAILABLE', 'NATIVE_READINESS_TIMEOUT',
    'NATIVE_PATH_UNSAFE', 'NATIVE_PATH_CHANGED', 'NATIVE_SCHEMA_CHANGED',
    'NATIVE_METADATA_INVALID', 'SQLITE_READONLY_REQUIRED', 'SQLITE_WAL_REQUIRED',
    'VOICE_STATE_INVALID', 'POSTGRES_CONNECTION_SCOPE', 'POSTGRES_IDENTITY_SCOPE',
    'POSTGRES_VISIBILITY_UNPROVEN', 'POSTGRES_SCHEMA_CHANGED',
    'POSTGRES_METADATA_INVALID', 'POSTGRES_READINESS_UNAVAILABLE',
}


class Blocked(Exception):
    def __init__(self, code):
        self.code = code if type(code) is str and code in _CODES else 'READINESS_UNAVAILABLE'
        super().__init__(self.code)


def _need(condition, code):
    if not condition:
        raise Blocked(code)


def _deadline(deadline):
    _need(time.monotonic() < deadline, 'NATIVE_READINESS_TIMEOUT')


def _path(value, *, directory=False):
    path = Path(value)
    _need(path.is_absolute() and path.resolve(strict=True) == path, 'NATIVE_PATH_UNSAFE')
    info = path.lstat()
    _need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
          'NATIVE_PATH_UNSAFE')
    return path, info


def _identity(info):
    return info.st_dev, info.st_ino


def _snapshot(info):
    return (*_identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@contextmanager
def _sqlite(path, deadline):
    path, before = _path(path)
    _deadline(deadline)
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True,
                                 timeout=.25, isolation_level=None)
    try:
        connection.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
        connection.execute('PRAGMA query_only=ON')
        connection.execute('PRAGMA trusted_schema=OFF')
        _need(connection.execute('PRAGMA query_only').fetchone() == (1,),
              'SQLITE_READONLY_REQUIRED')
        _need(connection.execute('PRAGMA journal_mode').fetchone() == ('wal',),
              'SQLITE_WAL_REQUIRED')
        connection.execute('BEGIN')
        yield connection
        _deadline(deadline)
        _need(_identity(path.lstat()) == _identity(before) and not path.is_symlink(),
              'NATIVE_PATH_CHANGED')
    finally:
        connection.close()


def _sqlite_schema(connection, table, columns):
    _need(connection.execute('SELECT type FROM sqlite_schema WHERE name=? AND tbl_name=?',
                             (table, table)).fetchall() == [('table',)], 'NATIVE_SCHEMA_CHANGED')
    # Identifiers are the three constants below, never an external SQL fragment.
    rows = connection.execute('PRAGMA table_xinfo(' + table + ')').fetchall()
    _need({row[1]: row[2].upper() for row in rows} == columns
          and all(row[6] == 0 for row in rows), 'NATIVE_SCHEMA_CHANGED')


def _counts(row, length):
    _need(type(row) in (tuple, list) and len(row) == length
          and all(type(value) is int and value >= 0 for value in row), 'READINESS_SCHEMA')
    return row


def _object(pairs):
    result = {}
    for key, value in pairs:
        _need(key not in result, 'VOICE_STATE_INVALID')
        result[key] = value
    return result


def _constant(_value):
    raise Blocked('VOICE_STATE_INVALID')


def _voice(root, deadline):
    root, before = _path(root, directory=True)
    count = 0
    with os.scandir(root) as entries:
        for entry in entries:
            _deadline(deadline)
            _need(not entry.is_symlink(), 'NATIVE_PATH_UNSAFE')
            if not entry.is_dir(follow_symlinks=False):
                continue
            directory = Path(entry.path)
            directory_before = directory.stat()
            path = directory / 'state.json'
            try:
                info = path.lstat()
            except FileNotFoundError:
                _need(_snapshot(directory.stat()) == _snapshot(directory_before), 'NATIVE_PATH_CHANGED')
                continue
            _need(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_STATE_BYTES,
                  'VOICE_STATE_INVALID')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                _need(_snapshot(os.fstat(fd)) == _snapshot(info), 'NATIVE_PATH_CHANGED')
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    raw = stream.read(MAX_STATE_BYTES + 1)
                _need(len(raw) <= MAX_STATE_BYTES, 'VOICE_STATE_INVALID')
                _need(_snapshot(os.fstat(fd)) == _snapshot(info)
                      and _snapshot(path.lstat()) == _snapshot(info)
                      and _snapshot(directory.stat()) == _snapshot(directory_before), 'NATIVE_PATH_CHANGED')
            finally:
                os.close(fd)
            value = json.loads(raw, object_pairs_hook=_object, parse_constant=_constant)
            _need(type(value) is dict, 'VOICE_STATE_INVALID')
            job = value.get('job')
            _need(job is None or type(job) is dict, 'VOICE_STATE_INVALID')
            if job is not None and job.get('delivery') != 'responded_to_skill':
                count += 1
    _need(_snapshot(root.stat()) == _snapshot(before), 'NATIVE_PATH_CHANGED')
    _deadline(deadline)
    return count


def sqlite_counts(state_database, gap_database):
    """Read current WAL-visible counts; no keys, reports or event bodies selected."""
    deadline = time.monotonic() + NATIVE_SECONDS
    now = time.time()
    try:
        _need(type(now) in (int, float) and math.isfinite(now), 'NATIVE_METADATA_INVALID')
        with _sqlite(state_database, deadline) as connection:
            _sqlite_schema(connection, 'jobs', JOBS_COLUMNS)
            _sqlite_schema(connection, 'gap_terminal_outbox', TERMINAL_COLUMNS)
            # complete/complete_answer set READY expiry; retention preserves it
            # when changing READY to EXPIRED. fail/cancel/alias may retain NULL.
            # A bound Python NaN becomes SQLite NULL, so required NULL timestamps
            # must fail too. RUNNING always receives a lease from Repository.claim.
            counts = _counts(connection.execute("""SELECT
                count(CASE WHEN state IN ('QUEUED','RUNNING') THEN 1 END),
                count(CASE WHEN state='UNKNOWN' THEN 1 END),
                count(CASE WHEN lease>? THEN 1 END),
                count(CASE WHEN expires>? THEN 1 END),
                count(CASE WHEN typeof(state)<>'text' OR state NOT IN
                    ('QUEUED','RUNNING','UNKNOWN','READY','EXPIRED','FAILED','CANCELLED','CANCELED','ALIASED')
                    OR typeof(lease) NOT IN ('null','integer','real')
                    OR typeof(expires) NOT IN ('null','integer','real')
                    OR state IN ('READY','EXPIRED') AND expires IS NULL
                    OR state='RUNNING' AND lease IS NULL
                    OR lease<=0 OR expires<=0
                    OR abs(lease)>1.7976931348623157e308
                    OR abs(expires)>1.7976931348623157e308 THEN 1 END)
                FROM jobs""", (now, now)).fetchone(), 5)
            _need(counts[4] == 0, 'NATIVE_METADATA_INVALID')
            terminal = _counts(connection.execute('SELECT count(*) FROM gap_terminal_outbox').fetchone(), 1)[0]
        with _sqlite(gap_database, deadline) as connection:
            _sqlite_schema(connection, 'gap_event_outbox', EVENT_COLUMNS)
            events = _counts(connection.execute('SELECT count(*) FROM gap_event_outbox').fetchone(), 1)[0]
        return dict(zip(SQLITE_KEYS, (*counts[:4], events, terminal)))
    except Blocked:
        raise
    except Exception:
        raise Blocked('NATIVE_READINESS_UNAVAILABLE') from None


def voice_count(station_root):
    """Run as the existing authorized Station reader; return one count only."""
    try:
        return {'voice_undelivered': _voice(station_root, time.monotonic() + NATIVE_SECONDS)}
    except Blocked:
        raise
    except Exception:
        raise Blocked('NATIVE_READINESS_UNAVAILABLE') from None


def native_counts(state_database, gap_database, station_root):
    """Convenience composition only where one identity already has both read rights.

    Production orchestration runs the two functions above under their respective
    existing identities and combines their exact disjoint keys. This function
    never changes OS credentials, ownership or permissions to obtain access.
    """
    return {**sqlite_counts(state_database, gap_database), **voice_count(station_root)}


PG_IDENTITY = """SELECT current_user=%s, session_user=%s, current_database()=%s,
    current_setting('default_transaction_read_only')='on',
    current_setting('transaction_read_only')='on', current_setting('row_security')='off',
    current_setting('search_path')='pg_catalog',
    NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)
    FROM pg_catalog.pg_roles WHERE rolname=current_user"""
PG_VISIBILITY = """SELECT c.relkind='r', NOT c.relispartition,
    NOT c.relrowsecurity, NOT c.relforcerowsecurity,
    NOT pg_catalog.row_security_active(c.oid),
    pg_catalog.has_table_privilege(current_user,c.oid,'SELECT'),
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='queries_query'"""
PG_COLUMN_PROOF = """SELECT a.attname,t.typname,a.attnotnull
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    WHERE a.attrelid='public.queries_query'::pg_catalog.regclass
    AND a.attnum>0 AND NOT a.attisdropped
    AND a.attname IN ('state','expires_at','lease_until','continuation') ORDER BY a.attname"""
PG_AGGREGATE = """SELECT
    count(*) FILTER (WHERE expires_at>transaction_timestamp() AND state IN
        ('UNKNOWN','QUEUED','RUNNING','NEEDS_CLARIFICATION','NEEDS_INPUT','ALIASED')),
    count(*) FILTER (WHERE lease_until>transaction_timestamp()),
    count(*) FILTER (WHERE expires_at>transaction_timestamp()
        AND continuation->>'outcome' IN ('SENDING','UNKNOWN')),
    count(*) FILTER (WHERE expires_at>transaction_timestamp() AND
        (state NOT IN ('UNKNOWN','QUEUED','RUNNING','NEEDS_CLARIFICATION','NEEDS_INPUT','ALIASED',
                      'READY','FAILED','CANCELLED','EXPIRED')
         OR jsonb_typeof(continuation)<>'object'
         OR continuation ? 'outcome' AND
            (jsonb_typeof(continuation->'outcome')<>'string'
             OR continuation->>'outcome' NOT IN ('SENDING','UNKNOWN','REJECTED','CONFIRMED'))))
    FROM public.queries_query"""


def _true_row(row, length):
    return type(row) in (tuple, list) and len(row) == length and all(value is True for value in row)


def postgres_counts(connection):
    """One current ordinary-runtime READ ONLY transaction; no inherited transaction."""
    try:
        _need(connection.vendor == 'postgresql' and connection.in_atomic_block is False
              and connection.get_autocommit() is True, 'POSTGRES_CONNECTION_SCOPE')
        with connection.cursor() as cursor:
            cursor.execute('BEGIN TRANSACTION READ ONLY')
            try:
                cursor.execute("SET LOCAL statement_timeout='1500ms'")
                cursor.execute("SET LOCAL lock_timeout='250ms'")
                cursor.execute("SET LOCAL idle_in_transaction_session_timeout='5000ms'")
                cursor.execute('SET LOCAL row_security=off')
                cursor.execute('SET LOCAL search_path=pg_catalog')
                cursor.execute(PG_IDENTITY, (DB_ROLE, DB_ROLE, DB_NAME))
                _need(_true_row(cursor.fetchone(), 8), 'POSTGRES_IDENTITY_SCOPE')
                # The same AccessShare lock a SELECT takes, retained until ROLLBACK:
                # prevent a DROP/view/RLS/schema substitution between proof and count.
                # ONLY prevents expanding an inheritance tree before its denial below.
                cursor.execute('LOCK TABLE ONLY public.queries_query IN ACCESS SHARE MODE')
                cursor.execute(PG_VISIBILITY)
                rows = cursor.fetchall()
                _need(len(rows) == 1 and _true_row(rows[0], 7), 'POSTGRES_VISIBILITY_UNPROVEN')
                cursor.execute(PG_COLUMN_PROOF)
                _need(cursor.fetchall() == PG_COLUMNS, 'POSTGRES_SCHEMA_CHANGED')
                cursor.execute(PG_AGGREGATE)
                counts = _counts(cursor.fetchone(), 4)
                _need(counts[3] == 0, 'POSTGRES_METADATA_INVALID')
                return dict(zip(POSTGRES_KEYS, counts[:3]))
            finally:
                cursor.execute('ROLLBACK')
    except Blocked:
        raise
    except Exception:
        raise Blocked('POSTGRES_READINESS_UNAVAILABLE') from None


def check_idle(native, postgres):
    """Validate fresh internal sampler output; callers must not accept saved receipts."""
    for value, keys in ((native, NATIVE_KEYS), (postgres, POSTGRES_KEYS)):
        _need(type(value) is dict and set(value) == set(keys), 'READINESS_SCHEMA')
        _counts(list(value.values()), len(keys))
    _need(not any((*native.values(), *postgres.values())), 'READINESS_BUSY')
    return {'idle': True}
