"""Disposable SQLite and PostgreSQL protocol doubles; no production connections.

The PostgreSQL doubles prove fail-closed orchestration, not SQL execution or real
role/RLS behavior. A separate owned PostgreSQL gate is required before rollout.
"""
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'readiness.py'
spec = importlib.util.spec_from_file_location('r15_activation_readiness_tested', SOURCE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
NOW = 1700000000.0
UNSET = object()

# Actual registered Repository schema plus its three additive scheduling columns.
# Kept independent of readiness's schema maps to catch a misspelled source column.
STATE_SCHEMA = """
CREATE TABLE jobs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,key TEXT NOT NULL,
 state TEXT NOT NULL,draft TEXT NOT NULL,plan TEXT,progress TEXT,result TEXT,error TEXT,
 created REAL NOT NULL,updated REAL NOT NULL,due REAL NOT NULL,lease REAL,owner TEXT,expires REAL,
 alias TEXT,delivered INTEGER NOT NULL DEFAULT 0,page INTEGER NOT NULL DEFAULT 0,
 dispatch_order INTEGER NOT NULL DEFAULT 0,queue_order INTEGER NOT NULL DEFAULT 0,
 resume_safe INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gap_terminal_outbox(tenant TEXT NOT NULL,rid TEXT NOT NULL,jid TEXT NOT NULL,
 revision INTEGER NOT NULL,created REAL NOT NULL,reason TEXT NOT NULL,reader_state TEXT NOT NULL,
 body TEXT,sha256 TEXT,input_pending INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,rid,revision));
"""
GAP_SCHEMA = """
CREATE TABLE gap_event_outbox(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,rid TEXT NOT NULL,
 body TEXT NOT NULL,sha256 TEXT NOT NULL,created REAL NOT NULL,sealed INTEGER NOT NULL DEFAULT 0);
"""


class NativeReadiness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_path, self.gap_path = self.root / 'state.sqlite3', self.root / 'gaps.sqlite3'
        self.station = self.root / 'users'
        self.station.mkdir()
        self.state, self.gaps = self.database(self.state_path, STATE_SCHEMA), self.database(self.gap_path, GAP_SCHEMA)
        self.addCleanup(self.state.close)
        self.addCleanup(self.gaps.close)
        self.sequence = 0

    @staticmethod
    def database(path, schema):
        connection = sqlite3.connect(path)
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA wal_autocheckpoint=0')
        connection.executescript(schema)
        connection.commit()
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        return connection

    def job(self, state='READY', *, expires=UNSET, lease=UNSET):
        if expires is UNSET:
            expires = NOW-1 if state in ('READY', 'EXPIRED') else None
        if lease is UNSET:
            lease = NOW-1 if state == 'RUNNING' else None
        self.sequence += 1
        self.state.execute('''INSERT INTO jobs(id,tenant,key,state,draft,created,updated,due,expires,lease)
            VALUES(?,?,?,?,?,?,?,?,?,?)''', (str(self.sequence), 'private-tenant', 'k', state,
                'PRIVATE_QUESTION_AND_FINANCIAL_DATA', NOW, NOW, NOW, expires, lease))
        self.state.commit()

    def voice(self, name, value):
        directory = self.station / name
        directory.mkdir()
        (directory / 'state.json').write_text(json.dumps(value))

    def sample(self):
        with patch.object(r.time, 'time', return_value=NOW):
            return r.native_counts(self.state_path, self.gap_path, self.station)

    def blocked(self, fn, code=None):
        with self.assertRaises(r.Blocked) as caught:
            fn()
        if code:
            self.assertEqual(caught.exception.code, code)
        self.assertNotIn('PRIVATE', str(caught.exception))
        self.assertNotIn(str(self.root), str(caught.exception))

    def test_current_uncheckpointed_wal_and_both_outboxes_are_visible_without_data_changes(self):
        before = {p: sha256(p.read_bytes()).hexdigest() for p in (self.state_path, self.gap_path)}
        self.job('QUEUED')
        self.state.execute('INSERT INTO gap_terminal_outbox VALUES(?,?,?,?,?,?,?,?,?,?)',
                           ('tenant', 'rid', 'job', 1, NOW, 'FAILED', 'READY', 'PRIVATE_BODY', 'digest', 0))
        self.state.commit()
        self.gaps.execute('INSERT INTO gap_event_outbox VALUES(?,?,?,?,?,?,?)',
                          ('event', 'case', 'rid', 'PRIVATE_BODY', 'digest', NOW, 0))
        self.gaps.commit()
        self.assertEqual(before, {p: sha256(p.read_bytes()).hexdigest() for p in before})
        paths = (self.state_path, self.gap_path, Path(str(self.state_path) + '-wal'), Path(str(self.gap_path) + '-wal'))
        fingerprints = {p: sha256(p.read_bytes()).hexdigest() for p in paths}
        result = self.sample()
        self.assertEqual(result, dict(zip(r.NATIVE_KEYS, (1, 0, 0, 0, 1, 1, 0))))
        self.assertEqual(fingerprints, {p: sha256(p.read_bytes()).hexdigest() for p in paths})
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertEqual(self.state.execute('SELECT count(*) FROM jobs').fetchone(), (1,))
        self.assertEqual(self.gaps.execute('SELECT count(*) FROM gap_event_outbox').fetchone(), (1,))

    def test_each_active_unknown_lease_and_unexpired_predicate_has_its_own_count(self):
        self.job('QUEUED')
        self.job('RUNNING', expires=NOW-1)
        self.job('UNKNOWN')
        self.job('FAILED', expires=NOW+1)
        self.job('READY', expires=NOW-1, lease=NOW+1)
        self.job('READY', expires=NOW, lease=NOW)
        self.job('ALIASED')
        self.assertEqual(self.sample(), dict(zip(r.NATIVE_KEYS, (2, 1, 1, 1, 0, 0, 0))))

    def test_each_call_uses_a_fresh_clock_and_read_snapshot(self):
        self.job(expires=NOW+10)
        self.assertEqual(self.sample()['native_unexpired_jobs'], 1)
        with patch.object(r.time, 'time', return_value=NOW+11):
            self.assertEqual(r.native_counts(self.state_path, self.gap_path, self.station)['native_unexpired_jobs'], 0)
        self.job('QUEUED')
        self.assertEqual(self.sample()['native_active_jobs'], 1)

    def test_all_outbox_rows_count_even_if_payload_or_seal_is_not_usable(self):
        for index in range(3):
            self.gaps.execute('INSERT INTO gap_event_outbox VALUES(?,?,?,?,?,?,?)',
                              (str(index), 'case', 'rid', 'not json PRIVATE', 'bad', NOW, index))
            self.state.execute('INSERT INTO gap_terminal_outbox VALUES(?,?,?,?,?,?,?,?,?,?)',
                               ('tenant', 'rid', 'job', index, NOW, 'UNKNOWN', 'UNKNOWN', None, None, 0))
        self.gaps.commit()
        self.state.commit()
        result = self.sample()
        self.assertEqual((result['event_outbox_pending'], result['terminal_outbox_pending']), (3, 3))
        self.assertEqual(self.gaps.execute('SELECT count(*) FROM gap_event_outbox').fetchone(), (3,))
        self.assertEqual(self.state.execute('SELECT count(*) FROM gap_terminal_outbox').fetchone(), (3,))

    def test_voice_delivery_only_and_missing_delivery_are_counted_without_export(self):
        self.voice('done', {'job': {'delivery': 'responded_to_skill'}, 'PRIVATE': 'ignored'})
        self.voice('pending', {'job': {'delivery': 'pending', 'answer': 'PRIVATE'}})
        self.voice('unknown', {'job': {'answer': 'PRIVATE'}})
        self.voice('none', {'job': None})
        self.voice('empty', {})
        (self.station / 'no_state').mkdir()
        result = self.sample()
        self.assertEqual(result['voice_undelivered'], 2)
        self.assertEqual(set(result), set(r.NATIVE_KEYS))
        self.assertNotIn('PRIVATE', json.dumps(result))

    def test_split_native_and_station_samplers_need_no_cross_identity_read_access(self):
        with patch.object(r, '_voice', side_effect=AssertionError('Station access forbidden')):
            native = r.sqlite_counts(self.state_path, self.gap_path)
        self.assertEqual(native, dict.fromkeys(r.SQLITE_KEYS, 0))
        with patch.object(r.sqlite3, 'connect', side_effect=AssertionError('Native DB access forbidden')):
            voice = r.voice_count(self.station)
        self.assertEqual(voice, {'voice_undelivered': 0})
        self.assertEqual({**native, **voice}, dict.fromkeys(r.NATIVE_KEYS, 0))

    def test_malformed_voice_state_and_duplicate_keys_are_never_idle(self):
        directory = self.station / 'user'
        directory.mkdir()
        for raw in ('[1]', '{"job":[]}', '{"job":null,"job":null}', '{"private":NaN}', 'PRIVATE malformed'):
            with self.subTest(raw=raw):
                (directory / 'state.json').write_text(raw)
                self.blocked(self.sample)

    def test_voice_file_size_is_bounded(self):
        self.voice('large', {})
        (self.station / 'large' / 'state.json').write_bytes(b' ' * (r.MAX_STATE_BYTES+1))
        self.blocked(self.sample, 'VOICE_STATE_INVALID')

    def test_missing_paths_and_missing_schema_refuse_without_creating_database(self):
        missing = self.root / 'absent.sqlite3'
        self.blocked(lambda: r.native_counts(missing, self.gap_path, self.station))
        self.assertFalse(missing.exists())
        self.state.execute('DROP TABLE gap_terminal_outbox')
        self.state.commit()
        self.blocked(self.sample, 'NATIVE_SCHEMA_CHANGED')

    def test_wrong_columns_or_view_cannot_produce_zero(self):
        self.state.execute('ALTER TABLE jobs ADD COLUMN unexpected TEXT')
        self.state.commit()
        self.blocked(self.sample, 'NATIVE_SCHEMA_CHANGED')
        self.state.execute('DROP TABLE jobs')
        self.state.execute('CREATE VIEW jobs AS SELECT 0 AS state')
        self.state.commit()
        self.blocked(self.sample, 'NATIVE_SCHEMA_CHANGED')

    def test_non_wal_database_is_not_silently_accepted(self):
        path = self.root / 'rollback.sqlite3'
        with sqlite3.connect(path) as connection:
            connection.executescript(STATE_SCHEMA)
        self.blocked(lambda: r.native_counts(path, self.gap_path, self.station), 'SQLITE_WAL_REQUIRED')

    def test_symlink_database_and_station_entry_are_refused(self):
        linked = self.root / 'link.sqlite3'
        linked.symlink_to(self.state_path)
        self.blocked(lambda: r.native_counts(linked, self.gap_path, self.station), 'NATIVE_PATH_UNSAFE')
        (self.station / 'link').symlink_to(self.root, target_is_directory=True)
        self.blocked(self.sample, 'NATIVE_PATH_UNSAFE')

    def test_replaced_database_inode_during_read_refuses(self):
        copy = self.root / 'replacement.sqlite3'
        shutil.copyfile(self.state_path, copy)
        held = self.root / 'held.sqlite3'
        original = r._sqlite_schema
        moved = False

        def swap(connection, table, columns):
            nonlocal moved
            original(connection, table, columns)
            if not moved:
                moved = True
                os.replace(self.state_path, held)
                os.replace(copy, self.state_path)

        try:
            with patch.object(r, '_sqlite_schema', side_effect=swap):
                self.blocked(self.sample, 'NATIVE_PATH_CHANGED')
        finally:
            if moved:
                os.replace(held, self.state_path)

    def test_invalid_persisted_job_metadata_is_not_interpreted_as_expired(self):
        for kwargs in ({'lease': 'PRIVATE invalid'}, {'expires': float('inf')}, {'expires': -float('inf')},
                       {'state': 'PRIVATE'}, {'expires': None}, {'expires': float('nan')},
                       {'expires': 0}, {'lease': 0}, {'state': 'RUNNING', 'lease': None},
                       {'state': 'RUNNING', 'lease': float('nan')}, {'state': 'EXPIRED', 'expires': None}):
            with self.subTest(kwargs=kwargs):
                self.state.execute('DELETE FROM jobs')
                self.state.commit()
                self.job(**kwargs)
                self.blocked(self.sample, 'NATIVE_METADATA_INVALID')

    def test_expired_retention_state_and_known_nullable_terminal_expiries_are_valid(self):
        self.job('EXPIRED', expires=NOW-1)
        for state in ('FAILED', 'CANCELLED', 'ALIASED'):
            self.job(state, expires=None, lease=None)
        self.assertEqual(self.sample(), dict.fromkeys(r.NATIVE_KEYS, 0))

    def test_sqlite_connection_rejects_dml_and_bounded_query_is_interruptible(self):
        with r._sqlite(self.state_path, time.monotonic()+2) as connection:
            self.assertEqual(connection.execute('PRAGMA query_only').fetchone(), (1,))
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute('DELETE FROM jobs')
        with self.assertRaises(sqlite3.OperationalError):
            with r._sqlite(self.state_path, time.monotonic()+.01) as connection:
                connection.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n').fetchone()
        self.assertEqual(self.sample(), dict.fromkeys(r.NATIVE_KEYS, 0))

    def test_deadline_and_permission_errors_are_typed_without_payloads(self):
        with patch.object(r.time, 'monotonic', side_effect=(0, 4)):
            self.blocked(self.sample, 'NATIVE_READINESS_TIMEOUT')
        with patch.object(r.sqlite3, 'connect', side_effect=PermissionError('PRIVATE path')):
            self.blocked(self.sample, 'NATIVE_READINESS_UNAVAILABLE')


class CursorDouble:
    def __init__(self):
        self.calls = []
        self.identity = (True,) * 8
        self.visibility = [(True,) * 7]
        self.columns = [('continuation', 'jsonb', True), ('expires_at', 'timestamptz', True),
                        ('lease_until', 'timestamptz', False), ('state', 'varchar', True)]
        self.aggregate = (0, 0, 0, 0)
        self.error_sql = None
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        self.last = sql
        if sql == self.error_sql:
            raise RuntimeError('PRIVATE database address or value')

    def fetchone(self):
        return self.identity if self.last == r.PG_IDENTITY else self.aggregate

    def fetchall(self):
        return self.visibility if self.last == r.PG_VISIBILITY else self.columns


class ConnectionDouble:
    vendor = 'postgresql'
    in_atomic_block = False
    autocommit = True

    def __init__(self):
        self.stream = CursorDouble()

    def get_autocommit(self):
        return self.autocommit

    def cursor(self):
        return self.stream


class PostgresReadiness(unittest.TestCase):
    def setUp(self):
        self.connection = ConnectionDouble()
        self.cursor = self.connection.stream

    def blocked(self, code):
        with self.assertRaises(r.Blocked) as caught:
            r.postgres_counts(self.connection)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn('PRIVATE', str(caught.exception))

    def statements(self):
        return [sql for sql, _ in self.cursor.calls]

    def test_current_identity_visibility_schema_and_counts_share_readonly_transaction(self):
        self.cursor.aggregate = (2, 3, 4, 0)
        self.assertEqual(r.postgres_counts(self.connection),
                         {'active_queries': 2, 'live_query_leases': 3, 'unresolved_continuations': 4})
        statements = self.statements()
        self.assertEqual(statements[0], 'BEGIN TRANSACTION READ ONLY')
        self.assertEqual(statements[-1], 'ROLLBACK')
        self.assertEqual([sql for sql in statements if sql.startswith('SET LOCAL ')], [
            "SET LOCAL statement_timeout='1500ms'", "SET LOCAL lock_timeout='250ms'",
            "SET LOCAL idle_in_transaction_session_timeout='5000ms'", 'SET LOCAL row_security=off',
            'SET LOCAL search_path=pg_catalog'])
        lock = 'LOCK TABLE ONLY public.queries_query IN ACCESS SHARE MODE'
        self.assertLess(statements.index(r.PG_IDENTITY), statements.index(lock))
        self.assertLess(statements.index(lock), statements.index(r.PG_VISIBILITY))
        self.assertLess(statements.index(r.PG_VISIBILITY), statements.index(r.PG_COLUMN_PROOF))
        self.assertLess(statements.index(r.PG_COLUMN_PROOF), statements.index(r.PG_AGGREGATE))
        self.assertIn((r.PG_IDENTITY, ('alisa_stage_platform_runtime', 'alisa_stage_platform_runtime', 'alisa_stage_platform')), self.cursor.calls)
        self.assertTrue(self.cursor.closed)

    def test_inherited_transaction_or_non_postgres_refuses_before_sql(self):
        for attr, value in (('vendor', 'sqlite'), ('in_atomic_block', True), ('autocommit', False)):
            with self.subTest(attr=attr):
                self.connection = ConnectionDouble()
                self.cursor = self.connection.stream
                setattr(self.connection, attr, value)
                self.blocked('POSTGRES_CONNECTION_SCOPE')
                self.assertEqual(self.statements(), [])

    def test_each_identity_readonly_or_role_failure_stops_before_table_access(self):
        for index in range(8):
            with self.subTest(index=index):
                self.cursor.calls.clear()
                self.cursor.identity = tuple(i != index for i in range(8))
                self.blocked('POSTGRES_IDENTITY_SCOPE')
                self.assertNotIn(r.PG_VISIBILITY, self.statements())
                self.assertFalse(any(sql.startswith('LOCK ') for sql in self.statements()))
                self.assertEqual(self.statements()[-1], 'ROLLBACK')

    def test_rls_view_partition_inheritance_and_select_visibility_all_fail_closed(self):
        for index in range(7):
            with self.subTest(index=index):
                self.cursor.calls.clear()
                self.cursor.visibility = [tuple(i != index for i in range(7))]
                self.blocked('POSTGRES_VISIBILITY_UNPROVEN')
                self.assertNotIn(r.PG_COLUMN_PROOF, self.statements())
                self.assertNotIn(r.PG_AGGREGATE, self.statements())
        for rows in ([], [(True,) * 7, (True,) * 7], [(1,) * 7]):
            self.cursor.visibility = rows
            self.blocked('POSTGRES_VISIBILITY_UNPROVEN')

    def test_missing_changed_nullable_or_wrong_type_column_stops_before_count(self):
        for rows in (self.cursor.columns[:-1], [('state', 'text', True)],
                     [('continuation', 'jsonb', True), ('expires_at', 'timestamptz', False),
                      ('lease_until', 'timestamptz', False), ('state', 'varchar', True)]):
            self.cursor.calls.clear()
            self.cursor.columns = rows
            self.blocked('POSTGRES_SCHEMA_CHANGED')
            self.assertNotIn(r.PG_AGGREGATE, self.statements())

    def test_failed_queries_and_rollback_failure_are_redacted_not_zero(self):
        for sql in (r.PG_IDENTITY, 'LOCK TABLE ONLY public.queries_query IN ACCESS SHARE MODE',
                    r.PG_VISIBILITY, r.PG_COLUMN_PROOF, r.PG_AGGREGATE, 'ROLLBACK'):
            with self.subTest(sql=sql):
                self.cursor.error_sql = sql
                self.blocked('POSTGRES_READINESS_UNAVAILABLE')
                self.assertEqual(self.statements()[-1], 'ROLLBACK')

    def test_malformed_counts_or_live_query_metadata_refuse(self):
        for row in ((True, 0, 0, 0), (-1, 0, 0, 0), (0.0, 0, 0, 0), (0, 0, 0), None):
            self.cursor.aggregate = row
            self.blocked('READINESS_SCHEMA')
        self.cursor.aggregate = (0, 0, 0, 1)
        self.blocked('POSTGRES_METADATA_INVALID')

    def test_fresh_repeated_samples_do_not_cache_counts_or_authority(self):
        self.assertEqual(r.postgres_counts(self.connection), dict.fromkeys(r.POSTGRES_KEYS, 0))
        self.cursor.aggregate = (1, 0, 0, 0)
        self.assertEqual(r.postgres_counts(self.connection)['active_queries'], 1)
        self.cursor.identity = (False,) + (True,) * 7
        self.blocked('POSTGRES_IDENTITY_SCOPE')
        self.assertEqual(self.statements().count(r.PG_IDENTITY), 3)


class IdleContract(unittest.TestCase):
    def test_exact_zero_counts_are_idle_and_each_nonzero_counter_blocks(self):
        native, postgres = dict.fromkeys(r.NATIVE_KEYS, 0), dict.fromkeys(r.POSTGRES_KEYS, 0)
        self.assertEqual(r.check_idle(native, postgres), {'idle': True})
        for target in (native, postgres):
            for key in target:
                target[key] = 1
                with self.assertRaisesRegex(r.Blocked, '^READINESS_BUSY$'):
                    r.check_idle(native, postgres)
                target[key] = 0

    def test_receipt_shape_boolean_negative_and_unknown_field_are_rejected(self):
        native, postgres = dict.fromkeys(r.NATIVE_KEYS, 0), dict.fromkeys(r.POSTGRES_KEYS, 0)
        malformed = ({}, {**native, 'extra': 0}, {key: value for key, value in native.items() if key != 'voice_undelivered'})
        for candidate in (*malformed, *({**native, 'voice_undelivered': value} for value in (True, -1, 0.0, '0', None))):
            with self.assertRaisesRegex(r.Blocked, '^READINESS_SCHEMA$'):
                r.check_idle(candidate, postgres)

    def test_unknown_error_code_cannot_reflect_private_text(self):
        self.assertEqual(str(r.Blocked('PRIVATE path or value')), 'READINESS_UNAVAILABLE')


if __name__ == '__main__':
    unittest.main()
