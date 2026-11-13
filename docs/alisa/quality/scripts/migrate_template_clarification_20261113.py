"""Finite exact additive column migration; old code keeps working on rollback."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a')
APP = Path('/opt/alisa-platform/stage/releases/alisa-template-clarification-81579c18d4725c7f')
TARGET = ('queries', '0004_query_continuation')
MIGRATION_SHA = 'e785ccf9138f839ebb3e42a0aace49eec41c5f72b2cb7f322715b7837a69d592'
ROLE = 'alisa_stage_platform_runtime'
TABLE = 'queries_query'
PROTECTED = ['entitlements_accessgrant', 'entitlements_accessadjustment',
             'entitlements_accesspreview', 'staff_staffauditevent']


def need(ok, code):
    if not ok: raise RuntimeError(code)


def config():
    values = {}
    for name in ['platform.env', 'runtime-link.env', 'alice-link.env', 'platform-migration.env']:
        p = Path('/etc/alisa-platform/stage') / name
        need(p.is_file() and p.stat().st_uid == 0 and not p.stat().st_mode & 0o007, 'PRIVATE_CONFIG')
        env = {}
        for line in p.read_text().splitlines():
            if not line or line.startswith('#'): continue
            key, sep, value = line.partition('=')
            need(sep and re.fullmatch('[A-Z][A-Z0-9_]*', key), 'CONFIG_SCHEMA'); env[key] = value
        if name == 'platform-migration.env':
            for key in ['ALISA_ENV', 'ALISA_DB_NAME', 'ALISA_DB_HOST', 'ALISA_DB_PORT']:
                need(env.get(key) == values.get(key), 'MIGRATION_DATABASE_MISMATCH')
            for key in ['ALISA_DB_USER', 'ALISA_DB_PASSWORD']: values[key] = env[key]
        else: values.update(env)
    need(values.get('ALISA_ENV') == 'stage' and values.get('ALISA_DB_NAME') == 'alisa_stage_platform'
         and values.get('ALISA_DB_USER') == 'alisa_stage_platform_migration'
         and values.get('ALISA_DB_HOST') == '127.0.0.1', 'DATABASE_SCOPE')
    values.update(DJANGO_SETTINGS_MODULE='alisa_platform.config.settings', PYTHONDONTWRITEBYTECODE='1',
        ALISA_QUERY_INSIGHTS_ENABLED='1', ALISA_RELEASE=APP.name)
    os.environ.update(values); sys.path.insert(0, str(APP / 'services/platform/src'))


def run(apply=False):
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    p = APP / 'services/platform/src/alisa_platform/queries/migrations/0004_query_continuation.py'
    need(hashlib.sha256(p.read_bytes()).hexdigest() == MIGRATION_SHA, 'MIGRATION_CHANGED')
    config()
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    try:
        with connection.cursor() as c:
            if not apply: c.execute('SET default_transaction_read_only=on')
            c.execute("SET lock_timeout='2s'"); c.execute("SET statement_timeout='10s'")
            c.execute('SHOW server_version_num'); need(str(c.fetchone()[0]).startswith('16'), 'POSTGRES_VERSION')
            c.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=%s', [ROLE])
            need(c.fetchone() == (False, False, False, False), 'RUNTIME_ROLE_SCOPE')
        def privileges():
            result = {}
            with connection.cursor() as c:
                for table in [TABLE, *PROTECTED]:
                    result[table] = {}
                    for permission in ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']:
                        c.execute('SELECT has_table_privilege(%s,%s,%s)', [ROLE, table, permission])
                        result[table][permission] = c.fetchone()[0]
            return result
        def shape():
            with connection.cursor() as c:
                c.execute('SELECT udt_name,is_nullable,column_default FROM information_schema.columns '
                          'WHERE table_schema=%s AND table_name=%s AND column_name=%s',
                          ['public', TABLE, 'continuation'])
                return c.fetchone()
        def correct(row):
            return row is not None and row[:2] == ('jsonb', 'NO') and type(row[2]) is str \
                and row[2].replace(' ', '').strip('()') == "'{}'::jsonb"
        before = privileges(); heads = set(MigrationRecorder(connection).applied_migrations())
        executor = MigrationExecutor(connection); steps = [(m.app_label, m.name, back)
            for m, back in executor.migration_plan([TARGET])]
        need(steps == [(*TARGET, False)] or not steps and TARGET in heads, 'UNEXPECTED_MIGRATION_PLAN')
        row = shape(); need(correct(row) if TARGET in heads else row is None, 'COLUMN_COLLISION')
        if apply:
            executor.migrate([TARGET]); need(correct(shape()), 'CONTINUATION_SCHEMA')
            after = set(MigrationRecorder(connection).applied_migrations())
            need(after - heads <= {TARGET} and heads <= after, 'UNRELATED_MIGRATION')
            need(privileges() == before, 'PRIVILEGES_CHANGED')
        report = {'phase': 'MIGRATED' if apply else 'MIGRATION_PREFLIGHT', 'target': list(TARGET),
            'plan': steps, 'column': 'continuation jsonb NOT NULL DEFAULT empty-object',
            'privileges_unchanged': True, 'grants': [], 'live_db_changes': apply,
            'rollback': 'retain additive column and DB default while rolling application code back'}
        (ROOT / ('MIGRATED.json' if apply else 'MIGRATION_PREFLIGHT.json')).write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    finally: connection.close()


if __name__ == '__main__':
    try:
        need(sys.argv[1:] in [[], ['--apply']], 'ARGUMENTS'); run(sys.argv[1:] == ['--apply'])
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'status': 'BLOCKED', 'code': code})); raise SystemExit(1)
