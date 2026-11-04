#!/usr/bin/env python3
"""Create only NEW Alisa databases/roles; never modify an existing database.

Input: private JSON with platform/identity -> migration_password/runtime_password.
Admin DSN is read from a private file. Neither DSN nor passwords are printed.
"""
import argparse
import json
from pathlib import Path
import psycopg
from psycopg import sql

def private(path):
    p=Path(path)
    if p.stat().st_mode & 0o077:raise RuntimeError('Private input must have mode 0600')
    return p.read_text().strip()

def main():
    # Provisioning an empty namespace does not activate production applications.
    # The complete name/role preflight below still refuses every existing target.
    parser=argparse.ArgumentParser();parser.add_argument('--env',choices=['stage','prod'],required=True)
    parser.add_argument('--admin-dsn-file',required=True);parser.add_argument('--credentials-file',required=True)
    a=parser.parse_args();dsn=private(a.admin_dsn_file);secrets=json.loads(private(a.credentials_file))
    names=[f'alisa_{a.env}_{component}' for component in ['platform','identity']]
    for component in ['platform','identity']:
        for suffix in ['migration','runtime']:
            value=secrets[component][suffix+'_password']
            if not isinstance(value,str) or len(value)<32:raise RuntimeError('Secret is too short')
    with psycopg.connect(dsn,autocommit=True) as admin:
        for name in names:
            if admin.execute('SELECT 1 FROM pg_database WHERE datname=%s',[name]).fetchone():raise RuntimeError('Database exists; inspect before retry')
            for suffix in ['migration','runtime']:
                if admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',[name+'_'+suffix]).fetchone():raise RuntimeError('Role exists; inspect before retry')
        for component,name in zip(['platform','identity'],names):
            for suffix in ['migration','runtime']:
                password=secrets[component][suffix+'_password']
                if len(password)<32:raise RuntimeError('Secret is too short')
                admin.execute(sql.SQL('CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD {}').format(sql.Identifier(name+'_'+suffix),sql.Literal(password)))
            admin.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(name),sql.Identifier(name+'_migration')))
            admin.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(name)))
            admin.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(name),sql.Identifier(name+'_runtime')))
            params=psycopg.conninfo.conninfo_to_dict(dsn);params['dbname']=name
            with psycopg.connect(**params,autocommit=True) as db:
                db.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
                db.execute(sql.SQL('ALTER SCHEMA public OWNER TO {}').format(sql.Identifier(name+'_migration')))
                db.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(name+'_runtime')))
                for kind,rights in [('TABLES','SELECT, INSERT, UPDATE, DELETE'),('SEQUENCES','USAGE, SELECT')]:
                    db.execute(sql.SQL('ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT '+rights+' ON '+kind+' TO {}').format(sql.Identifier(name+'_migration'),sql.Identifier(name+'_runtime')))
    print(json.dumps({'environment':a.env,'databases':names,'status':'PROVISIONED_MIGRATIONS_NOT_APPLIED'}))

if __name__=='__main__':
    try:main()
    except Exception as exc:raise SystemExit('DB_PROVISION_FAILED: '+(str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__))
