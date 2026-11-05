#!/usr/bin/env python3
"""Finite S03 protocol/command qualification on an empty owned CI PostgreSQL.

No live configuration is read. Synthetic keys and factor values stay in a
private temporary directory, which is removed along with both databases/roles.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

import psycopg
from psycopg import sql
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from run_postgres import clean_environment

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['alisa_s03_core_platform', 'alisa_s03_core_identity']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    params = psycopg.conninfo.conninfo_to_dict(os.environ.get('ALISA_TEST_PG_DSN', ''))
    if (os.environ.get('ALISA_TEST_DB_ALLOW') != '1' or params.get('host') != '127.0.0.1'
            or params.get('port') != '55480' or params.get('dbname') != 'alisa_ci_admin'
            or params.get('user') != 'alisa_ci_admin' or not params.get('password')
            or set(params) - {'host', 'port', 'dbname', 'user', 'password'}):
        raise RuntimeError('Guarded empty disposable CI cluster required')
    params.update(sslmode='disable', connect_timeout=3)
    admin = psycopg.connect(**params, autocommit=True)
    record = {'scope': 'S03_NATIVE_MFA_AND_PLATFORM_CORE_NOT_BROWSER_NOT_STAGE', 'status': 'FAILED', 'cases': []}
    owned_databases, owned_roles = [], []
    try:
        databases = {r[0] for r in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')}
        if databases - {'postgres', 'alisa_ci_admin'}:
            raise RuntimeError('Disposable cluster is not empty')
        if any(admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s', [n+'_'+r]).fetchone()
                for n in NAMES for r in ['migration','runtime']):
            raise RuntimeError('Disposable role exists')
        with tempfile.TemporaryDirectory(prefix='alisa-s03-private-') as temporary:
            temp = Path(temporary)
            py = ROOT / '.venv/bin/python'
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
            staff_secret = secrets.token_urlsafe(40)
            web_secret = secrets.token_urlsafe(40)
            issuer = 'https://localhost:19443'
            base = {**clean_environment(), 'ALISA_ENV':'dev', 'ALISA_RELEASE':'s03-core-source',
                'ALISA_ALLOWED_HOSTS':'localhost,127.0.0.1', 'ALISA_DB_HOST':'127.0.0.1', 'ALISA_DB_PORT':'55480',
                'ALISA_STAFF_ENABLED':'1', 'ALISA_STAFF_OIDC_CLIENT_ID':'s03_admin', 'ALISA_IDENTITY_ISSUER':issuer,
                'ALISA_STAFF_CORE_TEST_ALLOW':'1'}
            identity = {'ALISA_IDENTITY_ENABLED':'1', 'ALISA_IDENTITY_DATA_KEYS':Fernet.generate_key().decode(),
                'ALISA_IDENTITY_SIGNING_KEYS_B64':base64.b64encode(json.dumps([{'pem':key,'issued_at':'2026-01-01T00:00:00+00:00'}]).encode()).decode(),
                'ALISA_STAFF_OIDC_CLIENT_SECRET':staff_secret, 'ALISA_STAFF_OIDC_REDIRECT_URI':'https://127.0.0.1:19441/auth/callback',
                'ALISA_WEB_OIDC_CLIENT_ID':'s03_web', 'ALISA_WEB_OIDC_CLIENT_SECRET':web_secret,
                'ALISA_WEB_OIDC_REDIRECT_URI':'https://127.0.0.1:19440/auth/callback',
                'ALISA_PROBE_OIDC_CLIENT_ID':'s03_probe', 'ALISA_PROBE_OIDC_CLIENT_SECRET':secrets.token_urlsafe(40),
                'ALISA_PROBE_OIDC_REDIRECT_URI':'https://127.0.0.1:19440/oidc-probe/callback'}
            platform = {'ALISA_ACCOUNTS_ENABLED':'1','ALISA_AUTH_SERVICE_TOKEN':secrets.token_urlsafe(40),
                'ALISA_STAFF_SERVICE_TOKEN':secrets.token_urlsafe(40),'ALISA_SERVICE_TOKEN':secrets.token_urlsafe(40),
                'ALISA_WEB_OIDC_CLIENT_ID':'s03_web'}
            environments = {}
            for component, extra in [('platform', platform), ('identity', identity)]:
                name = 'alisa_s03_core_' + component
                passwords = {role:secrets.token_urlsafe(36) for role in ['migration','runtime']}
                for role in passwords:
                    role_name = name + '_' + role
                    admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role_name),sql.Literal(passwords[role])))
                    owned_roles.append(role_name)
                admin.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(name),sql.Identifier(name+'_migration')))
                owned_databases.append(name)
                admin.execute(sql.SQL('REVOKE CONNECT ON DATABASE {} FROM PUBLIC').format(sql.Identifier(name)))
                admin.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {},{}').format(sql.Identifier(name),sql.Identifier(name+'_migration'),sql.Identifier(name+'_runtime')))
                with psycopg.connect(**{**params,'dbname':name},autocommit=True) as conn:
                    conn.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
                    conn.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(name+'_runtime')))
                    conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {}').format(sql.Identifier(name+'_migration'),sql.Identifier(name+'_runtime')))
                    conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO {}').format(sql.Identifier(name+'_migration'),sql.Identifier(name+'_runtime')))
                own = {**base,**extra,'ALISA_SECRET_KEY':secrets.token_urlsafe(48),'ALISA_DB_NAME':name,
                    'PYTHONPATH':str(ROOT/'services'/component/'src'),
                    'DJANGO_SETTINGS_MODULE':('alisa_platform' if component=='platform' else 'octoport_identity')+'.config.settings'}
                environments[component] = {**own,'ALISA_DB_USER':name+'_runtime','ALISA_DB_PASSWORD':passwords['runtime']}
                migration = {**own,'ALISA_DB_USER':name+'_migration','ALISA_DB_PASSWORD':passwords['migration']}
                with (temp/(component+'.log')).open('w+') as log:
                    subprocess.run([str(py),str(ROOT/'services'/component/'manage.py'),'migrate','--noinput'],env=migration,stdout=log,stderr=log,check=True,timeout=40)
                    if component=='identity':
                        subprocess.run([str(py),str(ROOT/'services/identity/manage.py'),'identity_clients','--apply'],env=migration,stdout=log,stderr=log,check=True,timeout=15)
                record[component+'_migrations_applied'] = True
            for component, filename in [('identity','staff_identity_checks.py'),('platform','staff_backend_checks.py')]:
                output = temp/(component+'-result.json')
                with (temp/(component+'-checks.log')).open('w+') as log:
                    result = subprocess.run([str(py),str(ROOT/'tests/integration'/filename),str(output)],
                        env=environments[component],stdout=log,stderr=log,timeout=90)
                    if output.exists():
                        part = json.loads(output.read_text())
                        record['cases'].extend(part['cases'])
                        if part['status']!='PASS':record['safe_script_error']={k:v for k,v in part.items() if k in {'error_type','error_location'}}
                    if result.returncode:
                        log.seek(0)
                        text = log.read()
                        import re
                        failures = re.findall(r'CHECK_FAILED:([a-z0-9_]+)',text)
                        record['failed_case'] = failures[-1] if failures else 'SCRIPT_FAILED'
                        record['error_classes'] = sorted(set(re.findall(r'(?m)^([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception)):',text)))
                        raise RuntimeError('Staff core qualification failed')
            record['status'] = 'PASS'
    except Exception as exc:
        record['error_type'] = type(exc).__name__
    finally:
        for name in reversed(owned_databases):
            admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
        for role in reversed(owned_roles):
            admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
        record['owned_database_and_role_cleanup'] = True
        admin.close()
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(record,indent=2)+'\n')
    return 0 if record['status']=='PASS' else 1

if __name__=='__main__':
    sys.exit(main())
