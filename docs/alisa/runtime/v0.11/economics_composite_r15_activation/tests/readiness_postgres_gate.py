"""Explicit real-SQL gate on the already owned, network-none Easyscript fixture.

Run only after the parent's fresh resource/ownership check, using env -i and a
finite unit (client <=128 MiB, RuntimeMaxSec<=60). No connection is made on import.
Invoke this file with --owned-fixture; it is intentionally outside test_*.py
discovery so a protocol-double suite cannot silently claim a PostgreSQL gate.

Uses the existing socket/container, creates the exact production *names* solely
inside that isolated server, and refuses either pre-existing name. It reads no
live environment files or passwords. Cleanup drops only this invocation's marked
database/role, refuses active connections, and never uses FORCE or termination.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import unittest
from uuid import uuid4


HERE = Path(__file__).resolve().parent
READINESS = HERE.parent / 'readiness.py'
CONTAINER = 'alisa-economics-composite-r15-20261115'
TASK = 'economics-composite-r15-20261115'
SOCKET = Path('/dev/shm/alisa-current-parameters-pg-ci-r15-20261115/socket')
DATABASE = 'alisa_stage_platform'
ROLE = 'alisa_stage_platform_runtime'
SCHEMA = 'alisa-economics-readiness-postgres-gate/v1'


class FixtureBlocked(Exception):
    pass


def need(condition, code):
    if not condition:
        raise FixtureBlocked(code)


def fixture_identity():
    need(not any(key.startswith('PG') or key.startswith('ALISA_DB_') or key == 'DATABASE_URL'
                 for key in os.environ), 'INHERITED_DATABASE_ENVIRONMENT')
    template = ('{"running":{{json .State.Running}},"task":{{json (index .Config.Labels "alisa.task")}},'
                '"network":{{json .HostConfig.NetworkMode}},"memory":{{json .HostConfig.Memory}},'
                '"pids":{{json .HostConfig.PidsLimit}},"mounts":{{json .Mounts}}}')
    result = subprocess.run(['/usr/bin/docker', 'inspect', '--type', 'container', '--format', template, CONTAINER],
                            check=True, capture_output=True, text=True, timeout=5,
                            env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'DOCKER_CONFIG': '/nonexistent',
                                 'DOCKER_HOST': 'unix:///var/run/docker.sock'})
    need(len(result.stdout) <= 65536, 'FIXTURE_METADATA_SIZE')
    value = json.loads(result.stdout)
    need(value['running'] is True and value['task'] == TASK and value['network'] == 'none'
         and value['memory'] == 384 * 1024**2 and value['pids'] == 256, 'FIXTURE_IDENTITY_CHANGED')
    mounts = [item for item in value['mounts'] if item['Destination'] == '/var/run/postgresql']
    need(len(mounts) == 1 and mounts[0]['Type'] == 'bind'
         and mounts[0]['Source'] == str(SOCKET) and mounts[0]['RW'] is True,
         'FIXTURE_SOCKET_MOUNT_CHANGED')
    need(SOCKET.is_absolute() and SOCKET.resolve(strict=True) == SOCKET, 'FIXTURE_SOCKET_CHANGED')
    path = SOCKET / '.s.PGSQL.5432'
    info = path.lstat()
    need(stat.S_ISSOCK(info.st_mode), 'FIXTURE_SOCKET_CHANGED')
    return info.st_dev, info.st_ino


class Adapter:
    """The exact small Django connection protocol consumed by readiness.py."""
    vendor = 'postgresql'
    in_atomic_block = False

    def __init__(self, connection):
        self.connection = connection

    def get_autocommit(self):
        return self.connection.autocommit

    def cursor(self):
        return self.connection.cursor()


class Fixture:
    def __init__(self, psycopg):
        self.psycopg = psycopg
        self.sql = psycopg.sql
        self.marker = 'alisa-readiness-owned-fixture:' + uuid4().hex
        self.role_oid = self.database_oid = None

    def connect(self, *, database=DATABASE, role=ROLE, readonly=True):
        need(database in (DATABASE, 'postgres') and role in (ROLE, 'postgres'), 'FIXTURE_SCOPE')
        options = ('-c default_transaction_read_only=' + ('on' if readonly else 'off')
                   + ' -c statement_timeout=5000 -c lock_timeout=500'
                   + ' -c idle_in_transaction_session_timeout=10000 -c search_path=pg_catalog')
        return self.psycopg.connect(host=str(SOCKET), port=5432, dbname=database,
            user=role, password='', passfile='/dev/null', sslmode='disable',
            connect_timeout=3, application_name='alisa-r15-readiness-owned-test',
            options=options, autocommit=True)

    def identity(self, connection):
        role = connection.execute("SELECT oid,pg_catalog.shobj_description(oid,'pg_authid') FROM pg_catalog.pg_roles WHERE rolname=%s", (ROLE,)).fetchone()
        database = connection.execute("SELECT oid,pg_catalog.shobj_description(oid,'pg_database') FROM pg_catalog.pg_database WHERE datname=%s", (DATABASE,)).fetchone()
        return role, database

    def create(self):
        with self.connect(database='postgres', role='postgres', readonly=False) as connection:
            need(connection.execute('SELECT current_user,session_user,current_database()').fetchone()
                 == ('postgres', 'postgres', 'postgres'), 'FIXTURE_ADMIN_SCOPE')
            need(self.identity(connection) == (None, None), 'FIXTURE_NAMES_ALREADY_EXIST')
            with connection.transaction():
                connection.execute(self.sql.SQL('CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT').format(self.sql.Identifier(ROLE)))
                connection.execute(self.sql.SQL('COMMENT ON ROLE {} IS {}').format(self.sql.Identifier(ROLE), self.sql.Literal(self.marker)))
            self.role_oid = self.identity(connection)[0][0]
            connection.execute(self.sql.SQL('CREATE DATABASE {} OWNER postgres TEMPLATE template0').format(self.sql.Identifier(DATABASE)))
            self.database_oid = self.identity(connection)[1][0]
            connection.execute(self.sql.SQL('COMMENT ON DATABASE {} IS {}').format(self.sql.Identifier(DATABASE), self.sql.Literal(self.marker)))
            self.require_owned(connection)

    def require_owned(self, connection):
        role, database = self.identity(connection)
        need(role == (self.role_oid, self.marker)
             and database == (self.database_oid, self.marker), 'FIXTURE_OWNERSHIP_CHANGED')

    @contextmanager
    def admin(self):
        with self.connect(role='postgres', readonly=False) as connection:
            self.require_owned(connection)
            yield connection

    def reset(self):
        with self.admin() as connection:
            connection.execute(self.sql.SQL('ALTER ROLE {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT').format(self.sql.Identifier(ROLE)))
            connection.execute('DROP SCHEMA public CASCADE')
            connection.execute('CREATE SCHEMA public AUTHORIZATION postgres')
            connection.execute(self.sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(self.sql.Identifier(ROLE)))
            connection.execute('''CREATE TABLE public.queries_query(
                id integer PRIMARY KEY, state varchar(16) NOT NULL,
                expires_at timestamptz NOT NULL, lease_until timestamptz,
                continuation jsonb NOT NULL DEFAULT '{}')''')
            self.grant_select(connection)

    def grant_select(self, connection):
        connection.execute(self.sql.SQL('GRANT SELECT,INSERT ON public.queries_query TO {}').format(self.sql.Identifier(ROLE)))

    def insert(self, rows):
        now = datetime.now(timezone.utc)
        with self.admin() as connection:
            for index, (state, expiry_delta, lease_delta, continuation) in enumerate(rows, 1):
                connection.execute('INSERT INTO public.queries_query VALUES(%s,%s,%s,%s,%s::jsonb)',
                    (index, state, now + timedelta(seconds=expiry_delta),
                     None if lease_delta is None else now + timedelta(seconds=lease_delta),
                     json.dumps(continuation)))

    def cleanup(self):
        if self.role_oid is None and self.database_oid is None:
            return
        with self.connect(database='postgres', role='postgres', readonly=False) as connection:
            role, database = self.identity(connection)
            if self.database_oid is not None:
                need(database == (self.database_oid, self.marker), 'FIXTURE_CLEANUP_OWNERSHIP')
                need(connection.execute('SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=%s', (DATABASE,)).fetchone() == (0,), 'FIXTURE_CLEANUP_CONNECTIONS')
                connection.execute(self.sql.SQL('DROP DATABASE {}').format(self.sql.Identifier(DATABASE)))
                self.database_oid = None
            need(role == (self.role_oid, self.marker), 'FIXTURE_CLEANUP_OWNERSHIP')
            connection.execute(self.sql.SQL('DROP ROLE {}').format(self.sql.Identifier(ROLE)))
            self.role_oid = None


class ActualPostgres(unittest.TestCase):
    fixture = readiness = None

    def setUp(self):
        self.fixture.reset()

    def sample(self, **kwargs):
        with self.fixture.connect(**kwargs) as connection:
            result = self.readiness.postgres_counts(Adapter(connection))
            self.assertEqual(connection.info.transaction_status.name, 'IDLE')
            return result

    def blocked(self, *codes, **kwargs):
        with self.assertRaises(self.readiness.Blocked) as caught:
            self.sample(**kwargs)
        self.assertIn(caught.exception.code, codes)

    def test_empty_ordinary_runtime_readonly_connection_is_authoritative(self):
        self.assertEqual(self.sample(), {'active_queries': 0, 'live_query_leases': 0, 'unresolved_continuations': 0})
        with self.fixture.connect() as connection:
            self.assertEqual(connection.execute("SELECT current_setting('default_transaction_read_only'),rolsuper,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user").fetchone(), ('on', False, False))
            with self.assertRaises(self.fixture.psycopg.errors.ReadOnlySqlTransaction):
                connection.execute("INSERT INTO public.queries_query VALUES(1,'READY',transaction_timestamp(),NULL,'{}')")

    def test_unknown_pending_native_states_sending_and_live_leases_are_not_empty(self):
        # Query.state is the actual varchar(16); this historical guard label is
        # longer and must not be made storable by widening the fixture schema.
        with self.assertRaises(self.fixture.psycopg.errors.StringDataRightTruncation):
            self.fixture.insert([('NEEDS_CLARIFICATION', 3600, None, {})])
        rows = [(state, 3600, None, {}) for state in
                ('UNKNOWN', 'QUEUED', 'RUNNING', 'NEEDS_INPUT', 'ALIASED')]
        rows += [('READY', 3600, None, {'outcome': 'SENDING'}),
                 ('READY', 3600, None, {'outcome': 'UNKNOWN'}),
                 ('READY', 3600, 3600, {}), ('READY', -3600, 3600, {}),
                 ('UNKNOWN', -3600, None, {}), ('READY', -3600, None, {'outcome': 'SENDING'})]
        self.fixture.insert(rows)
        self.assertEqual(self.sample(), {'active_queries': 5, 'live_query_leases': 2, 'unresolved_continuations': 2})

    def test_known_terminal_and_expired_pending_rows_remain_nonactive(self):
        rows = [(state, 3600, None, {'outcome': 'CONFIRMED'}) for state in ('READY', 'FAILED', 'CANCELLED', 'EXPIRED')]
        rows += [('UNKNOWN', -3600, None, {'outcome': 'UNKNOWN'})]
        self.fixture.insert(rows)
        self.assertEqual(self.sample(), dict.fromkeys(self.readiness.POSTGRES_KEYS, 0))

    def test_actual_rls_false_empty_is_denied(self):
        self.fixture.insert([('UNKNOWN', 3600, None, {})])
        with self.fixture.admin() as connection:
            connection.execute('ALTER TABLE public.queries_query ENABLE ROW LEVEL SECURITY')
            connection.execute('CREATE POLICY hidden ON public.queries_query FOR SELECT USING(false)')
        with self.fixture.connect() as connection:
            self.assertEqual(connection.execute('SELECT count(*) FROM public.queries_query').fetchone(), (0,))
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN')

    def test_forced_rls_policy_cannot_be_mistaken_for_full_visibility(self):
        with self.fixture.admin() as connection:
            connection.execute('ALTER TABLE public.queries_query ENABLE ROW LEVEL SECURITY')
            connection.execute('ALTER TABLE public.queries_query FORCE ROW LEVEL SECURITY')
            connection.execute('CREATE POLICY all_rows ON public.queries_query FOR SELECT USING(true)')
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN')

    def test_view_cannot_substitute_false_empty(self):
        with self.fixture.admin() as connection:
            connection.execute('DROP TABLE public.queries_query')
            connection.execute("""CREATE VIEW public.queries_query AS SELECT
                1::integer AS id,'READY'::varchar(16) AS state,transaction_timestamp() AS expires_at,
                NULL::timestamptz AS lease_until,'{}'::jsonb AS continuation WHERE false""")
            self.fixture.grant_select(connection)
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN', 'POSTGRES_READINESS_UNAVAILABLE')

    def test_inheritance_requires_a_new_reviewed_schema(self):
        with self.fixture.admin() as connection:
            connection.execute('CREATE TABLE public.query_child() INHERITS(public.queries_query)')
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN')

    def test_partitioned_relation_requires_a_new_reviewed_schema(self):
        with self.fixture.admin() as connection:
            connection.execute('DROP TABLE public.queries_query')
            connection.execute("""CREATE TABLE public.queries_query(id integer,state varchar(16) NOT NULL,
                expires_at timestamptz NOT NULL,lease_until timestamptz,
                continuation jsonb NOT NULL DEFAULT '{}') PARTITION BY RANGE(id)""")
            self.fixture.grant_select(connection)
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN')

    def test_changed_state_type_is_not_accepted(self):
        with self.fixture.admin() as connection:
            connection.execute('ALTER TABLE public.queries_query ALTER COLUMN state TYPE text')
        self.blocked('POSTGRES_SCHEMA_CHANGED')

    def test_nullable_expiry_is_not_accepted(self):
        with self.fixture.admin() as connection:
            connection.execute('ALTER TABLE public.queries_query ALTER COLUMN expires_at DROP NOT NULL')
        self.blocked('POSTGRES_SCHEMA_CHANGED')

    def test_missing_continuation_column_is_not_zero(self):
        with self.fixture.admin() as connection:
            connection.execute('ALTER TABLE public.queries_query DROP COLUMN continuation')
        self.blocked('POSTGRES_SCHEMA_CHANGED')

    def test_missing_table_is_not_zero(self):
        with self.fixture.admin() as connection:
            connection.execute('DROP TABLE public.queries_query')
        self.blocked('POSTGRES_READINESS_UNAVAILABLE')

    def test_select_denied_is_not_zero(self):
        with self.fixture.admin() as connection:
            connection.execute(self.fixture.sql.SQL('REVOKE SELECT ON public.queries_query FROM {}').format(self.fixture.sql.Identifier(ROLE)))
        self.blocked('POSTGRES_VISIBILITY_UNPROVEN', 'POSTGRES_READINESS_UNAVAILABLE')

    def test_wrong_current_role_and_database_fail_before_counts(self):
        self.blocked('POSTGRES_IDENTITY_SCOPE', role='postgres')
        self.blocked('POSTGRES_IDENTITY_SCOPE', database='postgres')

    def test_set_role_does_not_hide_wrong_session_user(self):
        with self.fixture.connect(role='postgres') as connection:
            connection.execute(self.fixture.sql.SQL('SET ROLE {}').format(self.fixture.sql.Identifier(ROLE)))
            with self.assertRaises(self.readiness.Blocked) as caught:
                self.readiness.postgres_counts(Adapter(connection))
            self.assertEqual(caught.exception.code, 'POSTGRES_IDENTITY_SCOPE')

    def test_missing_startup_readonly_is_rejected_despite_local_readonly_transaction(self):
        self.blocked('POSTGRES_IDENTITY_SCOPE', readonly=False)

    def test_bypassrls_runtime_role_is_not_ordinary_authority(self):
        with self.fixture.admin() as connection:
            connection.execute(self.fixture.sql.SQL('ALTER ROLE {} BYPASSRLS').format(self.fixture.sql.Identifier(ROLE)))
        try:
            self.blocked('POSTGRES_IDENTITY_SCOPE')
        finally:
            with self.fixture.admin() as connection:
                connection.execute(self.fixture.sql.SQL('ALTER ROLE {} NOBYPASSRLS').format(self.fixture.sql.Identifier(ROLE)))

    def test_actual_lock_timeout_is_an_error_not_an_empty_sample(self):
        with self.fixture.admin() as connection:
            connection.execute('BEGIN')
            connection.execute('LOCK TABLE public.queries_query IN ACCESS EXCLUSIVE MODE')
            try:
                self.blocked('POSTGRES_READINESS_UNAVAILABLE')
            finally:
                connection.execute('ROLLBACK')

    def test_malformed_live_state_or_json_metadata_refuses(self):
        for state, continuation in (('UNRECOGNIZED', {}), ('READY', []), ('READY', None),
                                    ('READY', {'outcome': 1}), ('READY', {'outcome': 'UNRECOGNIZED'})):
            with self.subTest(state=state, continuation=continuation):
                self.fixture.reset()
                self.fixture.insert([(state, 3600, None, continuation)])
                self.blocked('POSTGRES_METADATA_INVALID')

    def test_preexisting_fixture_names_are_refused_without_overwriting(self):
        other = Fixture(self.fixture.psycopg)
        with self.assertRaisesRegex(FixtureBlocked, '^FIXTURE_NAMES_ALREADY_EXIST$'):
            other.create()
        self.assertIsNone(other.role_oid)
        self.assertIsNone(other.database_oid)
        with self.fixture.admin() as connection:
            self.fixture.require_owned(connection)


def run():
    need(sys.argv[1:] == ['--owned-fixture'], 'EXPLICIT_OWNED_FIXTURE_REQUIRED')
    socket_before = fixture_identity()
    source_hashes = {path.name: sha256(path.read_bytes()).hexdigest() for path in (READINESS, Path(__file__))}
    spec = importlib.util.spec_from_file_location('r15_readiness_actual_postgres', READINESS)
    readiness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(readiness)
    need((readiness.DB_ROLE, readiness.DB_NAME) == (ROLE, DATABASE), 'READINESS_IDENTITY_CHANGED')
    import psycopg
    fixture = Fixture(psycopg)
    result = None
    cleanup_ok = False
    try:
        fixture.create()
        ActualPostgres.fixture, ActualPostgres.readiness = fixture, readiness
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ActualPostgres)
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    finally:
        fixture.cleanup()
        cleanup_ok = True
    need(socket_before == fixture_identity(), 'FIXTURE_SOCKET_CHANGED')
    need(source_hashes == {path.name: sha256(path.read_bytes()).hexdigest() for path in (READINESS, Path(__file__))},
         'TEST_SOURCE_CHANGED')
    need(result is not None and result.testsRun > 0 and not result.skipped, 'REAL_SQL_GATE_NOT_EXECUTED')
    return {'schema': SCHEMA, 'status': 'PASS' if result.wasSuccessful() and cleanup_ok else 'FAIL',
            'tests_run': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
            'skipped': len(result.skipped), 'failed_tests': [test.id().split('.')[-1] for test, _ in result.failures + result.errors],
            'source_sha256': source_hashes, 'actual_postgresql': True, 'network_isolated_fixture': True,
            'new_test_database_removed': cleanup_ok, 'new_test_role_removed': cleanup_ok,
            'production_access': False}


def main():
    try:
        result = run()
    except FixtureBlocked as error:
        # All FixtureBlocked values above are fixed code literals, never a DB exception.
        result = {'schema': SCHEMA, 'status': 'BLOCKED', 'code': error.args[0], 'production_access': False}
    except Exception:
        result = {'schema': SCHEMA, 'status': 'BLOCKED', 'code': 'OWNED_POSTGRES_GATE_UNAVAILABLE',
                  'production_access': False}
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
