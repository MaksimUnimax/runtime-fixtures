#!/usr/bin/env python3
"""Finite qualification on a NEW disposable PostgreSQL, never a stage/live database.

Requires ALISA_TEST_DB_ALLOW=1 and an admin DSN whose database AND user are
alisa_ci_admin, loopback only. All test credentials are generated or synthetic.
This author qualification cannot grant FOUNDATION_READY for a real stage.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from unittest.mock import patch

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]
DB_NAMES = ('alisa_stage_platform', 'alisa_stage_identity')
PROD_SENTINEL = 'alisa_prod_test_sentinel'
PROCESSES = []
RESULTS = []

def clean_environment():
    return {k: v for k, v in os.environ.items() if k in {'PATH', 'LANG', 'LC_ALL', 'TZ', 'LD_LIBRARY_PATH', 'HOME', 'TMPDIR'}}

def check(name, condition, **safe):
    if not condition:
        raise RuntimeError('Qualification failed: ' + name)
    RESULTS.append({'case': name, 'passed': True, **safe})
    print(json.dumps(RESULTS[-1]), flush=True)

def expected_database_connect_denial(exc):
    # libpq may omit SQLSTATE for errors raised during connection establishment.
    # Require the actual permission-denied diagnostic; network/auth errors fail.
    primary = exc.diag.message_primary or str(exc)
    return exc.sqlstate in {None, '42501'} and 'permission denied for database' in primary.lower()

def stop(process):
    if process and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)

def spawn(args, env, logs):
    process = subprocess.Popen(list(map(str, args)), env=env, stdout=logs, stderr=logs,
                               start_new_session=True, cwd=ROOT)
    PROCESSES.append(process)
    return process

def request(url, method='GET', data=None, token=None, origin=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = token
    if origin:
        headers['Origin'] = origin
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, method=method, data=body, headers=headers)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())

def wait_ready(url, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError('Test child exited before readiness')
        try:
            if request(url)[0] == 200:
                return
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    raise RuntimeError('Test child readiness timeout')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    params = psycopg.conninfo.conninfo_to_dict(os.environ.get('ALISA_TEST_PG_DSN', ''))
    if (os.environ.get('ALISA_TEST_DB_ALLOW') != '1' or
        params.get('host') != '127.0.0.1' or params.get('port') != '55480' or
        params.get('dbname') != 'alisa_ci_admin' or params.get('user') != 'alisa_ci_admin' or
        not params.get('password') or set(params) - {'host', 'port', 'dbname', 'user', 'password'}):
        raise RuntimeError('Dedicated disposable CI PostgreSQL identity is required')

    # Canonical route is explicit; libpq cannot obtain a different hostaddr/service
    # from the input DSN or the parent's PG* environment.
    params = {**params, 'hostaddr': '127.0.0.1', 'sslmode': 'disable'}

    def connect(name=None, user=None, password=None):
        config = {**params, 'connect_timeout': 3}
        if name: config['dbname'] = name
        if user: config['user'] = user
        if password: config['password'] = password
        with patch.dict(os.environ, clean_environment(), clear=True):
            return psycopg.connect(**config, autocommit=True)

    # Refuse a populated namespace before acquiring any destructive cleanup ownership.
    admin = connect()
    owned_names = [*DB_NAMES, PROD_SENTINEL]
    role_names = [name + '_' + role for name in DB_NAMES for role in ('migration', 'runtime')]
    try:
        databases = {row[0] for row in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')}
        if databases - {'postgres', 'alisa_ci_admin'}:
            raise RuntimeError('Dedicated disposable cluster is not empty; no cleanup ownership')
        for name in owned_names:
            if admin.execute('SELECT 1 FROM pg_database WHERE datname=%s', [name]).fetchone():
                raise RuntimeError('Disposable test database name already exists; no cleanup ownership')
        for name in role_names:
            if admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', [name]).fetchone():
                raise RuntimeError('Disposable test role name already exists; no cleanup ownership')
    except BaseException:
        admin.close()
        raise

    try:
        with tempfile.TemporaryDirectory(prefix='alisa-pg-qualification-') as temp_name:
            temp = Path(temp_name)
            with tarfile.open(args.artifact, 'r:gz') as archive:
                archive.extractall(temp / 'artifact', filter='data')
            release_dirs = list((temp / 'artifact').iterdir())
            check('single_artifact_root', len(release_dirs) == 1)
            release = release_dirs[0]
            manifest = json.loads((release / 'manifest.json').read_text())
            for name, checksum in manifest['files'].items():
                path = (release / name).resolve()
                if not path.is_relative_to(release.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
                    raise RuntimeError('Artifact file mismatch')
            check('artifact_integrity', True, source_sha=manifest['source_sha'])

            credentials = {component: {role + '_password': secrets.token_urlsafe(36)
                                      for role in ('migration', 'runtime')}
                           for component in ('platform', 'identity')}
            dsn_file = temp / 'admin.dsn'
            dsn_file.write_text(psycopg.conninfo.make_conninfo(**params)); dsn_file.chmod(0o600)
            credentials_file = temp / 'db-input.json'
            credentials_file.write_text(json.dumps(credentials)); credentials_file.chmod(0o600)
            logs = (temp / 'private-process.log').open('w+')
            subprocess.run([sys.executable, str(release / 'infra/db/provision.py'), '--env', 'stage',
                            '--admin-dsn-file', str(dsn_file), '--credentials-file', str(credentials_file)],
                           env=clean_environment(), stdout=logs, stderr=logs, check=True, timeout=15)
            check('fresh_separate_database_provision', True)
            token = secrets.token_urlsafe(36)
            origin = 'http://127.0.0.1:18200'
            basic = 'Basic ' + base64.b64encode(('engineer:' + secrets.token_urlsafe(24)).encode()).decode()

            def environment(component, migration=False, **override):
                name = 'alisa_stage_' + component
                role = 'migration' if migration else 'runtime'
                base = clean_environment()
                result = {**base, 'ALISA_ENV': 'stage', 'ALISA_RELEASE': manifest['artifact_id'],
                        'ALISA_SECRET_KEY': secrets.token_urlsafe(48), 'ALISA_SERVICE_TOKEN': token,
                        'ALISA_ALLOWED_HOSTS': '127.0.0.1,localhost', 'ALISA_DB_NAME': name,
                        'ALISA_DB_USER': name + '_' + role,
                        'ALISA_DB_PASSWORD': credentials[component][role + '_password'],
                        'ALISA_DB_HOST': '127.0.0.1', 'ALISA_DB_PORT': '55480',
                        'FOUNDATION_PROBE_ENABLED': '1', **override}
                if component == 'identity': result.pop('ALISA_SERVICE_TOKEN', None)
                return result

            def manage(component, command, migration=False, **override):
                return subprocess.run([sys.executable, str(release / 'services' / component / 'manage.py'), *command],
                                      env=environment(component, migration, **override), stdout=logs, stderr=logs,
                                      check=True, timeout=30)

            for component in ('platform', 'identity'):
                manage(component, ['migrate', '--noinput'], migration=True)
                manage(component, ['migrate', '--noinput'], migration=True)
                manage(component, ['makemigrations', '--check', '--dry-run'], migration=True)
            check('initial_and_repeat_migrations', True)
            with connect(DB_NAMES[1]) as identity_db:
                kind = identity_db.execute("SELECT data_type FROM information_schema.columns WHERE table_name='accounts_person' AND column_name='id'").fetchone()[0]
                check('identity_uuid_before_auth', kind == 'uuid')

            for component, other in [('platform', 'identity'), ('identity', 'platform')]:
                name = 'alisa_stage_' + component
                password = credentials[component]['runtime_password']
                with connect(name, name + '_runtime', password) as db:
                    flags = db.execute('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user').fetchone()
                    check(component + '_least_privilege', flags == (False, False, False))
                    try:
                        db.execute('CREATE TABLE unauthorized_ddl (id integer)')
                    except psycopg.errors.InsufficientPrivilege:
                        check(component + '_runtime_ddl_denied', True)
                    else: raise RuntimeError('Runtime DDL was allowed')
                privilege = admin.execute('SELECT has_database_privilege(%s,%s,%s)', [name + '_runtime', 'alisa_stage_' + other, 'CONNECT']).fetchone()[0]
                check(component + '_cross_database_acl_denied', privilege is False)
                try:
                    connect('alisa_stage_' + other, name + '_runtime', password).close()
                except psycopg.Error as exc:
                    check(component + '_cross_database_denied', privilege is False and expected_database_connect_denial(exc), sqlstate=exc.sqlstate)
                else: raise RuntimeError('Cross-authority database connection was allowed')
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(PROD_SENTINEL)))
            admin.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(PROD_SENTINEL)))
            privilege = admin.execute('SELECT has_database_privilege(%s,%s,%s)', [DB_NAMES[0] + '_runtime', PROD_SENTINEL, 'CONNECT']).fetchone()[0]
            check('synthetic_stage_to_prod_acl_denied', privilege is False)
            try:
                connect(PROD_SENTINEL, DB_NAMES[0] + '_runtime', credentials['platform']['runtime_password']).close()
            except psycopg.Error as exc:
                check('synthetic_stage_to_prod_database_denied', privilege is False and expected_database_connect_denial(exc), sqlstate=exc.sqlstate)
            else: raise RuntimeError('Synthetic production sentinel was accessible')

            def api(component, port, **override):
                module = 'alisa_platform' if component == 'platform' else 'octoport_identity'
                env = environment(component, PYTHONPATH=str(release / 'services' / component / 'src'), **override)
                process = spawn([sys.executable, '-m', 'gunicorn', module + '.config.wsgi:application',
                                 '--bind', '127.0.0.1:' + str(port), '--workers', '2', '--threads', '2'], env, logs)
                wait_ready('http://127.0.0.1:' + str(port) + '/health/live', process)
                return process

            platform = api('platform', 18202)
            identity = api('identity', 18203)
            direct = 'http://127.0.0.1:18202/internal/foundation/probes'
            auth = 'Bearer ' + token
            probe_id = str(uuid.uuid4())
            payload = {'probe_id': probe_id, 'kind': 'foundation-v1'}
            check('real_database_readiness', request('http://127.0.0.1:18202/health/ready')[0] == 200 and
                  request('http://127.0.0.1:18203/health/ready')[0] == 200)
            check('unauthorized_direct_call_denied', request(direct, 'POST', payload)[0] == 401)
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(lambda _: request(direct, 'POST', payload, auth), range(8)))
            check('concurrent_duplicate_posts', all(status in {200, 202} for status, _ in responses) and
                  len({data['correlation_id'] for _, data in responses}) == 1)
            with connect(DB_NAMES[0]) as db:
                check('one_durable_probe_and_job', db.execute('SELECT count(*) FROM foundation_foundationprobe WHERE id=%s', [probe_id]).fetchone()[0] == 1 and
                      db.execute('SELECT count(*) FROM foundation_foundationjob WHERE probe_id=%s', [probe_id]).fetchone()[0] == 1)
            check('conflicting_kind_rejected', request(direct, 'POST', {**payload, 'kind': 'other'}, auth)[0] == 422)
            stop(platform); platform = api('platform', 18202)
            check('accepted_probe_survives_api_restart', request(direct + '/' + probe_id, token=auth)[1]['state'] == 'ACCEPTED')
            workers = [spawn([sys.executable, release / 'services/platform/manage.py', 'foundation_worker', '--once'], environment('platform'), logs) for _ in range(2)]
            check('two_worker_processes_exit', all(p.wait(timeout=15) == 0 for p in workers))
            result = request(direct + '/' + probe_id, token=auth)[1]
            check('one_processed_effect', result['state'] == 'PROCESSED' and result['effect_count'] == 1)
            check('repeat_after_processing_no_second_effect', request(direct, 'POST', payload, auth)[1]['effect_count'] == 1)
            stop(platform); platform = api('platform', 18202)
            check('processed_probe_survives_restart', request(direct + '/' + probe_id, token=auth)[1]['effect_count'] == 1)
            bad_api = api('platform', 18204, ALISA_DB_PORT='1')
            check('real_database_refusal_is_503', request('http://127.0.0.1:18204/health/ready')[0] == 503 and
                  request('http://127.0.0.1:18204/internal/foundation/probes', 'POST', {'probe_id': str(uuid.uuid4()), 'kind': 'foundation-v1'}, auth)[0] == 503)
            stop(bad_api)

            # Test actual packaged Next bytes, not a fixture response.
            web_env = {**environment('platform'), 'ALISA_PLATFORM_URL': 'http://127.0.0.1:18202',
                       'ALISA_ENGINEERING_AUTH': basic.removeprefix('Basic '), 'ALISA_WEB_ORIGIN': origin,
                       'HOSTNAME': '127.0.0.1', 'PORT': '18200', 'NEXT_TELEMETRY_DISABLED': '1'}
            for name in list(web_env):
                if name.startswith('ALISA_DB_') or name == 'ALISA_SECRET_KEY': del web_env[name]
            web = spawn(['node', release / 'ui/web/apps/web/server.js'], web_env, logs)
            wait_ready(origin + '/health/ready', web)
            check('bff_without_admission_denied', request(origin + '/api/engineering/probes', 'POST', payload, origin=origin)[0] == 401)
            check('bff_wrong_origin_denied', request(origin + '/api/engineering/probes', 'POST', payload, basic, 'https://foreign.invalid')[0] == 403)
            worker = spawn([sys.executable, release / 'services/platform/manage.py', 'foundation_worker'], environment('platform'), logs)
            if args.browser:
                from playwright.sync_api import sync_playwright, expect
                with patch.dict(os.environ, clean_environment(), clear=True), sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True, env=clean_environment())
                    try:
                        context = browser.new_context(extra_http_headers={'Authorization': basic})
                        page = context.new_page(); page.goto(origin + '/__engineering')
                        browser_probe = str(uuid.uuid4())
                        page.get_by_label('UUID пробы').fill(browser_probe)
                        page.get_by_role('button', name='Отправить пробу').click()
                        expect(page.get_by_test_id('result')).to_contain_text('PROCESSED', timeout=15000)
                        browser_result = json.loads(page.get_by_test_id('result').inner_text())
                        check('browser_bff_api_postgresql_worker_roundtrip', browser_result['probe_id'] == browser_probe and browser_result['effect_count'] == 1)
                        page.reload(); page.get_by_label('UUID пробы').fill(browser_probe)
                        page.get_by_role('button', name='Отправить пробу').click()
                        expect(page.get_by_test_id('result')).to_contain_text('PROCESSED', timeout=15000)
                        check('browser_retry_keeps_one_effect', json.loads(page.get_by_test_id('result').inner_text())['effect_count'] == 1)
                    finally: browser.close()
            stop(worker)
            with connect(DB_NAMES[0]) as db:
                db.execute("UPDATE foundation_foundationprobe SET expires_at=now()-interval '1 second' WHERE id=%s", [probe_id])
            manage('platform', ['foundation_cleanup'], FOUNDATION_PROBE_ENABLED='0')
            with connect(DB_NAMES[0]) as db:
                check('ttl_cleanup_with_probe_disabled', db.execute('SELECT count(*) FROM foundation_foundationprobe WHERE id=%s', [probe_id]).fetchone()[0] == 0)
            with connect(DB_NAMES[0]) as db:
                db.execute('ALTER TABLE foundation_foundationprobe ADD COLUMN qualification_note text NULL')
            check('old_code_reads_compatible_expanded_schema', request('http://127.0.0.1:18202/health/ready')[0] == 200)

            # This is not a stage acceptance or an r1/r2/r1 release exercise.
            receipt = {'scope': 'DISPOSABLE_POSTGRESQL_AND_PACKAGED_UI_AUTHOR_QUALIFICATION',
                       'source_sha': manifest['source_sha'], 'cases': RESULTS, 'foundation_ready': False,
                       'not_run': ['real_stage_https_ingress', 'systemd_deploy', 'r1_r2_r1_release_rollback', 'independent_stage_handoff']}
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    finally:
        for process in reversed(PROCESSES): stop(process)
        # Names were proven absent before this run; only this dedicated CI cluster is owned.
        for name in owned_names:
            admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(name)))
        for role in role_names:
            admin.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
        admin.close()

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        # No driver DSN, passwords, request headers or process logs in public output.
        print('QUALIFICATION_FAILED: ' + (str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
