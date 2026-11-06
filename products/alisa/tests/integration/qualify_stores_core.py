#!/usr/bin/env python3
"""Finite S05 PostgreSQL qualification; empty isolated CI cluster only."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import psycopg
from psycopg import sql
from run_postgres import clean_environment

ROOT=Path(__file__).resolve().parents[2]
NAME='alisa_s05_core_platform'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    params=psycopg.conninfo.conninfo_to_dict(os.environ.get('ALISA_TEST_PG_DSN',''))
    if (os.environ.get('ALISA_TEST_DB_ALLOW')!='1' or params.get('host')!='127.0.0.1'
        or params.get('port')!='55480' or params.get('dbname')!='alisa_ci_admin'
        or params.get('user')!='alisa_ci_admin' or not params.get('password')
        or set(params)-{'host','port','dbname','user','password'}):
        raise RuntimeError('Owned empty disposable CI cluster required')
    params.update(sslmode='disable',connect_timeout=3)
    admin=psycopg.connect(**params,autocommit=True)
    record={'scope':'S05_DISPOSABLE_POSTGRES_BACKEND_NOT_INSTALLED','status':'FAILED','cases':[]}
    roles=[];created=False
    try:
        if {r[0] for r in admin.execute('SELECT datname FROM pg_database WHERE NOT datistemplate')}-{'postgres','alisa_ci_admin'}:
            raise RuntimeError('Disposable cluster is not empty')
        passwords={r:secrets.token_urlsafe(36) for r in ['migration','runtime']}
        for r,p in passwords.items():
            name=NAME+'_'+r
            if admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',[name]).fetchone():raise RuntimeError('Role exists')
            admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(name),sql.Literal(p)));roles.append(name)
        admin.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(NAME),sql.Identifier(NAME+'_migration')));created=True
        admin.execute(sql.SQL('REVOKE CONNECT ON DATABASE {} FROM PUBLIC').format(sql.Identifier(NAME)))
        admin.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {},{}').format(sql.Identifier(NAME),sql.Identifier(NAME+'_migration'),sql.Identifier(NAME+'_runtime')))
        with psycopg.connect(**{**params,'dbname':NAME},autocommit=True) as conn:
            conn.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
            conn.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(NAME+'_runtime')))
            conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO {}').format(sql.Identifier(NAME+'_migration'),sql.Identifier(NAME+'_runtime')))
            conn.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO {}').format(sql.Identifier(NAME+'_migration'),sql.Identifier(NAME+'_runtime')))
        env={**clean_environment(),'ALISA_ENV':'dev','ALISA_RELEASE':'s05-source-core',
            'ALISA_ALLOWED_HOSTS':'localhost,127.0.0.1','ALISA_SECRET_KEY':secrets.token_urlsafe(40),
            'ALISA_SERVICE_TOKEN':secrets.token_urlsafe(40),'ALISA_AUTH_SERVICE_TOKEN':secrets.token_urlsafe(40),
            'ALISA_STAFF_SERVICE_TOKEN':secrets.token_urlsafe(40),'ALISA_ACCOUNTS_ENABLED':'1','ALISA_STAFF_ENABLED':'1',
            'ALISA_STAFF_OIDC_CLIENT_ID':'s05_admin','ALISA_WEB_OIDC_CLIENT_ID':'s05_web',
            'ALISA_IDENTITY_ISSUER':'https://localhost:19443','ALISA_ENTITLEMENTS_ENABLED':'1', 'ALISA_STORES_ENABLED':'1', 'ALISA_STORE_DATA_KEYS':__import__('cryptography.fernet',fromlist=['Fernet']).Fernet.generate_key().decode(),
            'ALISA_STORES_CORE_TEST_ALLOW':'1','ALISA_DB_HOST':'127.0.0.1','ALISA_DB_PORT':'55480','ALISA_DB_NAME':NAME,
            'DJANGO_SETTINGS_MODULE':'alisa_platform.config.settings','PYTHONPATH':str(ROOT/'services/platform/src'),
            'PYTHONDONTWRITEBYTECODE':'1'}
        runtime={**env,'ALISA_DB_USER':NAME+'_runtime','ALISA_DB_PASSWORD':passwords['runtime']}
        migration={**env,'ALISA_DB_USER':NAME+'_migration','ALISA_DB_PASSWORD':passwords['migration']}
        py=ROOT/'.venv/bin/python'
        with tempfile.TemporaryDirectory(prefix='alisa-s05-private-') as folder:
            temp=Path(folder)
            with (temp/'migration.log').open('w+') as log:
                subprocess.run([str(py),str(ROOT/'services/platform/manage.py'),'migrate','--noinput'],env=migration,check=True,stdout=log,stderr=log,timeout=45)
                subprocess.run([str(py),str(ROOT/'services/platform/manage.py'),'makemigrations','--check','--dry-run'],env=migration,check=True,stdout=log,stderr=log,timeout=20)
            output=temp/'result.json'
            with (temp/'checks.log').open('w+') as log:
                result=subprocess.run([str(py),str(ROOT/'tests/integration/stores_backend_checks.py'),str(output)],env=runtime,stdout=log,stderr=log,timeout=150)
            if output.exists():record.update(json.loads(output.read_text()))
            if result.returncode:raise RuntimeError('Access qualification failed')
            record['migrations_and_model_consistency']='PASS'
            record['schema_rollback_policy']='Retain additive store history and audit; disable stores capability and preserve vault keys. Never migrate down over customer data.'
            record['status']='PASS'
    except Exception as error:
        record['status']='FAILED';record['error_type']=type(error).__name__
    finally:
        if created:admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(NAME)))
        for name in reversed(roles):admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(name)))
        admin.close();record['owned_database_and_role_cleanup']=True
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    return 0 if record['status']=='PASS' else 1


if __name__=='__main__':sys.exit(main())
