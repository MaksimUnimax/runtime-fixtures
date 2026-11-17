#!/usr/bin/env python3
"""S07 authority qualification on a new database in the empty CI PG cluster."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from unittest.mock import patch

from cryptography.fernet import Fernet
import psycopg
from psycopg import sql
from run_postgres import clean_environment

ROOT = Path(__file__).resolve().parents[2]
NAME = 'alisa_s07_authority_platform'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runtime-source', type=Path)
    parser.add_argument('--current-core-source', type=Path)
    parser.add_argument('--report-browser-artifact', type=Path)
    parser.add_argument('--platform-stores-overlay', action='store_true')
    parser.add_argument('--template-clarification-overlay', action='store_true')
    parser.add_argument('--question-catalog-overlay', action='store_true')
    parser.add_argument('--catalog-release-overlay', action='store_true')
    parser.add_argument('--catalog-r15-context', type=Path)
    parser.add_argument('--catalog-release-only', action='store_true')
    parser.add_argument('--catalog-r15-evidence', type=Path)
    args = parser.parse_args()
    if args.catalog_release_overlay and not (args.current_core_source and args.question_catalog_overlay):
        parser.error('--catalog-release-overlay requires current core and question catalogue')
    if args.catalog_r15_context and not args.catalog_release_overlay:
        parser.error('--catalog-r15-context requires --catalog-release-overlay')
    if bool(args.catalog_r15_context)!=bool(args.catalog_r15_evidence):
        parser.error('R15 context requires all current-run qualified-suite evidence')
    if args.catalog_release_only and not args.catalog_release_overlay:
        parser.error('--catalog-release-only requires --catalog-release-overlay')
    if args.question_catalog_overlay and not args.current_core_source:
        parser.error('--question-catalog-overlay requires --current-core-source')
    if args.runtime_source and args.current_core_source:
        parser.error('Select one pinned runtime source')
    params = psycopg.conninfo.conninfo_to_dict(os.environ.get('ALISA_TEST_PG_DSN', ''))
    if (os.environ.get('ALISA_TEST_DB_ALLOW') != '1' or params.get('host') != '127.0.0.1'
        or params.get('port') != '55480' or params.get('dbname') != 'alisa_ci_admin'
        or params.get('user') != 'alisa_ci_admin' or not params.get('password')
        or set(params) - {'host', 'port', 'dbname', 'user', 'password'}):
        raise RuntimeError('Owned empty disposable CI cluster required')
    params.update(hostaddr='127.0.0.1', sslmode='disable', connect_timeout=3)

    def connect(**extra):
        with patch.dict(os.environ, clean_environment(), clear=True):
            return psycopg.connect(**{**params, **extra}, autocommit=True)

    admin = connect()
    record = {'scope': 'S07_DISPOSABLE_POSTGRES_AUTHORITY_NOT_INSTALLED', 'status': 'FAILED'}
    roles, created = [], False
    try:
        if {row[0] for row in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')} - {'postgres', 'alisa_ci_admin'}:
            raise RuntimeError('Disposable cluster is not empty')
        passwords = {role: secrets.token_urlsafe(36) for role in ['migration', 'runtime']}
        for role, password in passwords.items():
            name = NAME + '_' + role
            if admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', [name]).fetchone():
                raise RuntimeError('Role already exists')
            admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(name), sql.Literal(password)))
            roles.append(name)
        admin.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(NAME), sql.Identifier(NAME + '_migration')))
        created = True
        admin.execute(sql.SQL('REVOKE CONNECT ON DATABASE {} FROM PUBLIC').format(sql.Identifier(NAME)))
        admin.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {},{}').format(
            sql.Identifier(NAME), sql.Identifier(NAME + '_migration'), sql.Identifier(NAME + '_runtime')))
        with connect(dbname=NAME) as conn:
            conn.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
            conn.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(NAME + '_runtime')))
            conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {}').format(
                sql.Identifier(NAME + '_migration'), sql.Identifier(NAME + '_runtime')))
            conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO {}').format(
                sql.Identifier(NAME + '_migration'), sql.Identifier(NAME + '_runtime')))
        env = {**clean_environment(), 'ALISA_ENV': 'dev', 'ALISA_RELEASE': 's07-authority-source',
            'ALISA_ALLOWED_HOSTS': 'localhost,127.0.0.1', 'ALISA_SECRET_KEY': secrets.token_urlsafe(40),
            'ALISA_SERVICE_TOKEN': secrets.token_urlsafe(40), 'ALISA_AUTH_SERVICE_TOKEN': secrets.token_urlsafe(40),
            'ALISA_ACCOUNTS_ENABLED': '1', 'ALISA_WEB_OIDC_CLIENT_ID': 's07_web',
            'ALISA_IDENTITY_ISSUER': 'https://localhost:19443', 'ALISA_ENTITLEMENTS_ENABLED': '1',
            'ALISA_STORES_ENABLED': '1', 'ALISA_STORE_DATA_KEYS': Fernet.generate_key().decode(),
            'ALISA_ALICE_LINK_ENABLED': '1', 'ALISA_ALICE_CLIENT_ID': 'fixture-alice',
            'ALISA_ALICE_CLIENT_SECRET': secrets.token_urlsafe(40),
            'ALISA_ALICE_SKILL_ID': 'e1c48501-7b1f-47fe-87d7-e6bec9c45673',
            'ALISA_ALICE_DATA_KEYS': Fernet.generate_key().decode(), 'ALISA_RUNTIME_AUTHORITY_ENABLED': '1',
            'ALISA_QUERY_INSIGHTS_ENABLED': '1',
            'ALISA_RUNTIME_AUTHORITY_TOKEN': secrets.token_urlsafe(40),
            'ALISA_RUNTIME_SERVICE_ID': 'fixture-platform', 'ALISA_RUNTIME_CATALOG_RELEASE_ID': 'fixture-catalog',
            'ALISA_RUNTIME_BINDINGS_PATH': '/fixture-not-used-by-test-injection',
            'ALISA_AUTHORITY_CORE_TEST_ALLOW': '1', 'ALISA_DB_HOST': '127.0.0.1', 'ALISA_DB_PORT': '55480',
            'ALISA_DB_NAME': NAME, 'DJANGO_SETTINGS_MODULE': 'alisa_platform.config.settings',
            'PYTHONPATH': str(ROOT / 'services/platform/src'), 'PYTHONDONTWRITEBYTECODE': '1'}
        migration = {**env, 'ALISA_DB_USER': NAME + '_migration', 'ALISA_DB_PASSWORD': passwords['migration']}
        runtime = {**env, 'ALISA_DB_USER': NAME + '_runtime', 'ALISA_DB_PASSWORD': passwords['runtime']}
        if args.catalog_release_overlay:
            if os.environ.get('GITHUB_ACTIONS')!='true':raise RuntimeError('Owned GitHub catalog CI required')
            runtime['GITHUB_ACTIONS']='true'
            for key in ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT']:
                if not os.environ.get(key,'').isdigit():raise RuntimeError('Owned GitHub run identity required')
                runtime[key]=os.environ[key]
        if args.report_browser_artifact:
            if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':raise RuntimeError('Owned CI root browser context required')
            runtime.update(ALISA_REPORT_BROWSER_ARTIFACT=str(args.report_browser_artifact.resolve()),GITHUB_ACTIONS='true',PLAYWRIGHT_BROWSERS_PATH=os.environ['PLAYWRIGHT_BROWSERS_PATH'])
        with tempfile.TemporaryDirectory(prefix='s07-qual-', dir=ROOT) as folder:
            temp = Path(folder)
            # Failure logs contain generated fixtures only, and stay with this run.
            for command in [['migrate', '--noinput'], ['makemigrations', '--check', '--dry-run']]:
                result = subprocess.run([sys.executable, str(ROOT / 'services/platform/manage.py'), *command],
                    env=migration, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=45)
                if result.returncode:
                    print(result.stdout[-8000:], file=sys.stderr)
                    raise RuntimeError('Migration/model consistency failed')
            cases = [('authority', ROOT / 'tests/runtime_authority/checks.py')]
            if args.runtime_source:
                runtime['ALISA_RT_JOB_TEST_SOURCE'] = str(args.runtime_source.resolve())
                cases.append(('runtime_roundtrip', ROOT / 'tests/runtime_authority/roundtrip.py'))
            if args.current_core_source:
                source=args.current_core_source.resolve()
                if args.platform_stores_overlay:
                    sys.path.insert(0, str(ROOT / 'runtime/platform_stores'))
                    from build_overlay import build
                    source = build(source, temp / 'platform-store-core')
                if args.template_clarification_overlay:
                    import importlib.util
                    spec=importlib.util.spec_from_file_location('clarification_overlay',ROOT/'runtime/template_clarification/build_overlay.py')
                    extension=importlib.util.module_from_spec(spec);spec.loader.exec_module(extension)
                    source=extension.build(source,temp/'template-clarification-core')
                    runtime['ALISA_TEMPLATE_CLARIFICATION_TEST']='1'
                if args.question_catalog_overlay:
                    import importlib.util
                    spec=importlib.util.spec_from_file_location('catalog_overlay',ROOT/'runtime/question_catalog/build_overlay.py')
                    extension=importlib.util.module_from_spec(spec);spec.loader.exec_module(extension)
                    source=extension.build(source,temp/'question-catalog-core')
                if args.catalog_release_overlay:
                    record['phase']='CATALOG_OVERLAY_COMPOSITION'
                    import importlib.util
                    spec=importlib.util.spec_from_file_location('catalog_release_overlay',ROOT/'runtime/catalog_release/build_overlay.py')
                    extension=importlib.util.module_from_spec(spec);spec.loader.exec_module(extension)
                    source=extension.build(source,temp/'catalog-release-core')
                    record['phase']='CATALOG_BASE_QUALIFICATION'
                    result=subprocess.run([sys.executable,'-B',str(ROOT/'tests/catalog_release/qualify_base.py'),
                        '--core',str(source),'--output',str(temp/'catalog-base-qualification.json')],
                        env={**runtime,'GITHUB_ACTIONS':os.environ.get('GITHUB_ACTIONS','')},
                        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=280)
                    print(result.stdout[-8000:])
                    if result.returncode:raise RuntimeError('Catalog base qualification failed')
                    record['catalog_base']=json.loads((temp/'catalog-base-qualification.json').read_text())
                runtime['ALISA_RT_JOB_TEST_SOURCE']=str(source)
                runtime['ALISA_RT_JOB_MANIFEST_SHA256']=hashlib.sha256((source/'CURRENT_CORE_MANIFEST.json').read_bytes()).hexdigest()
                cases.append(('current_core_roundtrip', ROOT / 'tests/runtime_authority/current_core_roundtrip.py'))
                cases.append(('query_roundtrip', ROOT / 'tests/runtime_authority/query_roundtrip.py'))
                cases.append(('voice_selection', ROOT / 'tests/runtime_authority/voice_selection.py'))
                if args.template_clarification_overlay:
                    cases.append(('template_clarification', ROOT / 'tests/runtime_authority/template_clarification.py'))
                if args.question_catalog_overlay:
                    cases.append(('question_catalog', ROOT / 'tests/runtime_authority/question_catalog.py'))
                if args.platform_stores_overlay:
                    cases.append(('store_enrollment', ROOT / 'tests/runtime_authority/store_enrollment.py'))
                cases.append(('report_roundtrip', ROOT / 'tests/runtime_authority/report_roundtrip.py'))
                cases.append(('query_insights', ROOT / 'tests/runtime_authority/query_insights.py'))
                cases.append(('query_demand', ROOT / 'tests/runtime_authority/query_demand.py'))
                if args.catalog_release_overlay:
                    cases.append(('catalog_release', ROOT / 'tests/runtime_authority/catalog_release.py'))
            if args.catalog_release_only:
                cases=[case for case in cases if case[0]=='catalog_release']
            for label, script in cases:
                record['phase']=label
                output = temp / (label + '.json')
                result = subprocess.run([sys.executable, str(script), '--output', str(output)],
                    env=runtime, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=150)
                print(result.stdout[-20000:])
                if output.exists(): record[label] = json.loads(output.read_text())
                if result.returncode: raise RuntimeError('Authority qualification failed')
            if args.catalog_r15_context:
                record['phase']='R15_SOURCE_CONTEXT'
                import importlib.util
                spec=importlib.util.spec_from_file_location('s13_r15_context',ROOT/'tests/catalog_release/context_r15.py')
                context=importlib.util.module_from_spec(spec);spec.loader.exec_module(context)
                historical=context.build(args.catalog_r15_context,temp/'r15-source-context')
                spec=importlib.util.spec_from_file_location('s13_r15_overlay',ROOT/'runtime/catalog_release/build_overlay.py')
                extension=importlib.util.module_from_spec(spec);spec.loader.exec_module(extension)
                source=extension.build(historical,temp/'r15-catalog-core')
                record['phase']='R15_BASE_QUALIFICATION'
                output=temp/'r15-catalog-base.json'
                result=subprocess.run([sys.executable,'-B',str(ROOT/'tests/catalog_release/qualify_base.py'),
                    '--core',str(source),'--output',str(output),'--r15-evidence',str(args.catalog_r15_evidence.resolve())],
                    env={**runtime,'GITHUB_ACTIONS':os.environ.get('GITHUB_ACTIONS','')},
                    stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=280)
                print(result.stdout[-8000:])
                if result.returncode:raise RuntimeError('R15 catalog base qualification failed')
                record['catalog_r15_base']=json.loads(output.read_text())
                runtime['ALISA_RT_JOB_TEST_SOURCE']=str(source)
                runtime['ALISA_RT_JOB_MANIFEST_SHA256']=hashlib.sha256((source/'CURRENT_CORE_MANIFEST.json').read_bytes()).hexdigest()
                output=temp/'r15-catalog-release.json'
                record['phase']='R15_CATALOG_AUTHORITY'
                result=subprocess.run([sys.executable,str(ROOT/'tests/runtime_authority/catalog_release.py'),
                    '--output',str(output)],env=runtime,
                    stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=150)
                print(result.stdout[-12000:])
                if output.exists():record['catalog_r15_release']=json.loads(output.read_text())
                if result.returncode:raise RuntimeError('R15 catalog authority qualification failed')
            with connect(dbname=NAME) as conn:
                receipts = conn.execute('SELECT count(*) FROM queries_query').fetchone()[0]
            for target in ['0003', '0004', '0002', '0003', '0001', '0004']:
                result = subprocess.run([sys.executable, str(ROOT / 'services/platform/manage.py'),
                    'migrate', 'queries', target, '--noinput'], env=migration,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=45)
                if result.returncode: raise RuntimeError('Voice migration roundtrip failed')
                with connect(dbname=NAME) as conn:
                    if conn.execute('SELECT count(*) FROM queries_query').fetchone()[0] != receipts:
                        raise RuntimeError('Voice migration changed query receipts')
                    present = conn.execute("SELECT to_regclass('queries_voicedialogue') IS NOT NULL").fetchone()[0]
                    if present != (target != '0001'): raise RuntimeError('Voice migration table boundary failed')
                    preference = conn.execute("SELECT to_regclass('queries_voicestorepreference') IS NOT NULL").fetchone()[0]
                    if preference != (target in {'0003','0004'}): raise RuntimeError('Voice preference migration boundary failed')
                    continuation=conn.execute("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='queries_query' AND column_name='continuation')").fetchone()[0]
                    if continuation != (target=='0004'):raise RuntimeError('Query continuation column boundary failed')
            record['voice_migration_upgrade_rollback'] = 'PASS'
            record['voice_preference_upgrade_rollback'] = 'PASS'
            record['query_continuation_upgrade_rollback'] = 'PASS'
            for target in ['0001', '0002']:
                result = subprocess.run([sys.executable, str(ROOT / 'services/platform/manage.py'),
                    'migrate', 'stores', target, '--noinput'], env=migration,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=45)
                if result.returncode: raise RuntimeError('Store registry migration roundtrip failed')
                with connect(dbname=NAME) as conn:
                    for table in ['stores_runtimetenantbinding', 'stores_runtimestorebinding']:
                        if conn.execute('SELECT to_regclass(%s) IS NOT NULL', [table]).fetchone()[0] != (target == '0002'):
                            raise RuntimeError('Store registry migration table boundary failed')
                    if conn.execute('SELECT count(*) FROM queries_query').fetchone()[0] != receipts:
                        raise RuntimeError('Store registry migration changed query receipts')
            record['store_registry_upgrade_rollback'] = 'PASS'
            with connect(dbname=NAME, user=NAME + '_runtime', password=passwords['runtime']) as conn:
                # A fixture setup must not have weakened append-only history.
                rights = conn.execute("SELECT has_table_privilege(current_user,'entitlements_accessgrant','UPDATE'), has_table_privilege(current_user,'entitlements_accessgrant','TRUNCATE')").fetchone()
                if rights != (False, False): raise RuntimeError('Append-only rights weakened')
            record.update(status='PASS', phase='COMPLETE', migrations_and_model_consistency='PASS', append_only_runtime_role='PASS')
    except Exception as error:
        record.update(status='FAILED', error_type=type(error).__name__)
    finally:
        try:
            if created:
                admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(NAME)))
            for name in reversed(roles): admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(name)))
            record['owned_database_and_role_cleanup'] = True
        finally:
            admin.close()
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(record, indent=2) + '\n')
    return 0 if record['status'] == 'PASS' else 1


if __name__ == '__main__': sys.exit(main())
