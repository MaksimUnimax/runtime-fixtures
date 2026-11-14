"""Exact additive CurrentParameter migration; no grants, data edits or downgrade.

Called only with the already configured migration connection. Private credentials
are not read by this module. CLI installation must separately pin the release,
assert the intended database and acquire the existing rollout lock.
"""
from hashlib import sha256
import json
from django.db import transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder

TARGET=('owner_data','0002_current_parameter_only')
TABLE='owner_data_currentparameter'
EXISTING=('owner_data_ownerdataset','owner_data_ownercommand')
PERMISSIONS=('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
REQUIRED_CONSTRAINTS={'current_parameter_one','current_parameter_product','current_parameter_scope',
                      'current_parameter_state','current_parameter_origin','current_parameter_tenant_store_fk'}

class GuardError(RuntimeError):pass

def need(ok,code):
    if not ok:raise GuardError(code)


def _role(connection,role):
    need(type(role)is str and role,'RUNTIME_ROLE')
    with connection.cursor()as c:
        c.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=%s',[role])
        need(c.fetchone()==(False,False,False,False),'RUNTIME_ROLE_SCOPE')


def _table(connection,name):
    with connection.cursor()as c:c.execute('SELECT to_regclass(%s)',[name]);return c.fetchone()[0]


def _privileges(connection,role,names):
    result={}
    with connection.cursor()as c:
        for name in names:
            result[name]={}
            for permission in PERMISSIONS:
                c.execute('SELECT has_table_privilege(%s,%s,%s)',[role,name,permission]);result[name][permission]=c.fetchone()[0]
    return result


def _fingerprints(connection):
    # Only the existing owner-data rows. Raw values never leave PostgreSQL or
    # enter a receipt; no broad account or provider-data snapshot is made.
    out={}
    with connection.cursor()as c:
        for name in EXISTING:
            quoted=connection.ops.quote_name(name)
            c.execute(f"SELECT COUNT(*),md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) FROM {quoted} t")
            count,digest=c.fetchone();out[name]={'count':count,'fingerprint':digest}
    return out


def _schema(connection,role):
    need(_table(connection,TABLE)is not None,'CURRENT_PARAMETER_TABLE_MISSING')
    from alisa_platform.owner_data.models import CurrentParameter
    expected={f.column for f in CurrentParameter._meta.concrete_fields}
    with connection.cursor()as c:
        columns={d.name for d in connection.introspection.get_table_description(c,TABLE)}
        need(columns==expected,'CURRENT_PARAMETER_COLUMN_DRIFT')
        c.execute('SELECT conname,condeferrable,condeferred FROM pg_constraint WHERE conrelid=%s::regclass',[TABLE]);constraints={n:(a,b)for n,a,b in c.fetchall()}
        need(REQUIRED_CONSTRAINTS<=set(constraints),'CURRENT_PARAMETER_CONSTRAINT_MISSING')
        need(constraints['current_parameter_tenant_store_fk']==(True,True),'CURRENT_PARAMETER_TENANT_FK')
        c.execute('SELECT pg_has_role(%s,relowner,\'MEMBER\') FROM pg_class WHERE oid=%s::regclass',[role,TABLE]);need(c.fetchone()[0]is False,'RUNTIME_ROLE_OWNS_TABLE')
    privileges=_privileges(connection,role,[TABLE])[TABLE]
    need(all(privileges[p]for p in ('SELECT','INSERT','UPDATE','DELETE')),'CURRENT_PARAMETER_RUNTIME_CRUD_MISSING')
    need(not any(privileges[p]for p in ('TRUNCATE','REFERENCES','TRIGGER')),'CURRENT_PARAMETER_RUNTIME_DDL_PRIVILEGE')
    return {'columns':len(columns),'constraints':sorted(REQUIRED_CONSTRAINTS),'runtime_crud':True,'runtime_owns_table':False}


def run(connection,role,*,apply=False):
    """Validate exactly one additive migration, or validate a completed replay.

    Any failure, including post-migration privilege/schema checks, rolls back the
    transaction. On later application rollback this table must be retained.
    """
    need(connection.vendor=='postgresql','POSTGRESQL_REQUIRED')
    with transaction.atomic(using=connection.alias):
        with connection.cursor()as c:
            if not apply:c.execute('SET LOCAL transaction_read_only=on')
            c.execute("SET LOCAL lock_timeout='2s'");c.execute("SET LOCAL statement_timeout='30s'")
            c.execute('SHOW server_version_num');need(str(c.fetchone()[0]).startswith('16'),'POSTGRES_VERSION')
        _role(connection,role)
        recorder=MigrationRecorder(connection);before_heads=set(recorder.applied_migrations())
        executor=MigrationExecutor(connection);plan=[(m.app_label,m.name,back)for m,back in executor.migration_plan([TARGET])]
        need(plan==[(*TARGET,False)]or not plan and TARGET in before_heads,'UNEXPECTED_MIGRATION_PLAN')
        present=_table(connection,TABLE)is not None
        need(present==(TARGET in before_heads),'CURRENT_PARAMETER_TABLE_COLLISION')
        before_data=_fingerprints(connection);before_privileges=_privileges(connection,role,EXISTING)
        schema=_schema(connection,role)if present else None
        if apply:
            executor.migrate([TARGET]);schema=_schema(connection,role)
            after_heads=set(recorder.applied_migrations())
            need(after_heads-before_heads<={TARGET}and before_heads<=after_heads,'UNRELATED_MIGRATION_CHANGED')
            need(_fingerprints(connection)==before_data,'EXISTING_OWNER_DATA_CHANGED')
            need(_privileges(connection,role,EXISTING)==before_privileges,'EXISTING_OWNER_PRIVILEGES_CHANGED')
        return {'status':'MIGRATED'if apply else'MIGRATION_PREFLIGHT','target':list(TARGET),'plan':plan,
                'already_applied':not plan,'current_schema':schema,'existing_owner_data_unchanged':True,
                'existing_privileges_unchanged':True,'grant_statements':0,'writes_other_than_additive_schema':0,
                'rollback_policy':'Restore previous code/config; retain additive table and any current parameter data.'}
