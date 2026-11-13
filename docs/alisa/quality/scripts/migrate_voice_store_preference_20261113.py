"""Finite, exact-app current-store preference migration under the existing admitted migration role."""
import hashlib,json,os,re,sys
from pathlib import Path
ROOT=Path('/root/alisa-s09-voice-install-d11a9f2a-20261110/preference-a6d5e19a')
APP=Path('/opt/alisa-platform/stage/releases/alisa-store-default-a6d5e19a87577d87')
TARGET=('queries','0003_voicestorepreference')
TABLES=['queries_voicestorepreference']
PROTECTED=['entitlements_accessgrant','entitlements_accessadjustment','entitlements_accesspreview','staff_staffauditevent']
ROLE='alisa_stage_platform_runtime'
def need(value,code):
    if not value:raise RuntimeError(code)
def config():
    env={}
    for name in ['platform.env','runtime-link.env','alice-link.env','platform-migration.env']:
        p=Path('/etc/alisa-platform/stage')/name
        need(p.is_file()and p.stat().st_uid==0 and not p.stat().st_mode&0o007,'PRIVATE_CONFIG')
        values={}
        for line in p.read_text().splitlines():
            if not line or line.startswith('#'):continue
            key,sep,value=line.partition('=');need(sep and re.fullmatch('[A-Z][A-Z0-9_]*',key),'CONFIG_SCHEMA');values[key]=value
        if name=='platform-migration.env':
            # This legacy file also contains stale copies of login settings.
            # Admit only its database identity, preserving the live auth boundary.
            for key in ['ALISA_ENV','ALISA_DB_NAME','ALISA_DB_HOST','ALISA_DB_PORT']:
                need(values.get(key)==env.get(key),'MIGRATION_DATABASE_MISMATCH')
            for key in ['ALISA_DB_USER','ALISA_DB_PASSWORD']:env[key]=values[key]
        else:env.update(values)
    need(env.get('ALISA_ENV')=='stage'and env.get('ALISA_DB_NAME')=='alisa_stage_platform'and env.get('ALISA_DB_USER')=='alisa_stage_platform_migration'and env.get('ALISA_DB_HOST')=='127.0.0.1','DATABASE_SCOPE')
    env.update(DJANGO_SETTINGS_MODULE='alisa_platform.config.settings',PYTHONDONTWRITEBYTECODE='1',ALISA_QUERY_INSIGHTS_ENABLED='1',ALISA_RELEASE=APP.name)
    os.environ.update(env);sys.path.insert(0,str(APP/'services/platform/src'))
def run(apply=False):
    need(os.geteuid()==0,'ROOT_REQUIRED');config()
    migration=APP/'services/platform/src/alisa_platform/queries/migrations/0003_voicestorepreference.py'
    need(hashlib.sha256(migration.read_bytes()).hexdigest()=='eaa24eba9bd504659a70961f1b117aa2c9a3bdbf173669a78d1b4fd1655539aa','MIGRATION_CHANGED')
    import django
    django.setup()
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    try:
        with connection.cursor()as c:
            if not apply:c.execute('SET default_transaction_read_only=on')
            c.execute("SET lock_timeout='2s'");c.execute("SET statement_timeout='10s'")
            c.execute('SHOW server_version_num');need(str(c.fetchone()[0]).startswith('16'),'POSTGRES_VERSION')
            c.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=%s',[ROLE]);need(c.fetchone()==(False,False,False,False),'RUNTIME_ROLE_SCOPE')
        def privileges():
            values={}
            with connection.cursor()as c:
                for table in PROTECTED:
                    values[table]={}
                    for permission in ['UPDATE','DELETE','TRUNCATE']:
                        c.execute('SELECT has_table_privilege(%s,%s,%s)',[ROLE,table,permission]);values[table][permission]=c.fetchone()[0]
            return values
        original=privileges();heads=set(MigrationRecorder(connection).applied_migrations());executor=MigrationExecutor(connection)
        plan=executor.migration_plan([TARGET]);summary=[(m.app_label,m.name,back)for m,back in plan]
        need(summary==[(*TARGET,False)]or(not summary and TARGET in heads),'UNEXPECTED_MIGRATION_PLAN')
        with connection.cursor()as c:
            c.execute('SELECT tablename FROM pg_tables WHERE schemaname=%s AND tablename=ANY(%s)',['public',TABLES]);present={r[0]for r in c.fetchall()}
        need(present==(set(TABLES)if TARGET in heads else set()),'TABLE_COLLISION')
        def shape():
            with connection.cursor() as c:
                c.execute('SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s', ['public', TABLES[0]])
                columns = dict(c.fetchall())
            need(columns == {'customer_id':'uuid','tenant_id':'uuid','store_id':'uuid','updated_at':'timestamptz'}, 'PREFERENCE_SCHEMA')
        if present:shape()
        if not apply:
            report={'phase':'MIGRATION_PREFLIGHT','plan':summary,'new_tables_expected':TABLES,'protected_runtime_privileges':original,'live_db_changes':False}
        else:
            executor.migrate([TARGET])
            shape()
            after=set(MigrationRecorder(connection).applied_migrations());need(after-heads<={TARGET}and heads<=after,'UNRELATED_MIGRATION')
            need(privileges()==original,'PROTECTED_PRIVILEGES_CHANGED')
            granted=[]
            with connection.cursor()as c:
                for table in TABLES:
                    for permission in ['SELECT','INSERT','UPDATE','DELETE']:
                        c.execute('SELECT has_table_privilege(%s,%s,%s)',[ROLE,table,permission])
                        if not c.fetchone()[0]:
                            # Only the new voice-state table; never a grant on existing business data.
                            c.execute('GRANT '+permission+' ON TABLE public.'+table+' TO '+ROLE);granted.append(table+':'+permission)
                    c.execute('SELECT has_table_privilege(%s,%s,%s)',[ROLE,table,'TRUNCATE']);need(c.fetchone()[0]is False,'RUNTIME_TRUNCATE')
            report={'phase':'MIGRATED','migration':list(TARGET),'tables':TABLES,'new_migrations':sorted(after-heads),'protected_runtime_privileges_unchanged':True,'explicit_new_table_grants':granted,'live_db_changes':True}
        (ROOT/('MIGRATED.json'if apply else'MIGRATION_PREFLIGHT.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    finally:connection.close()
if __name__=='__main__':
    try:
        need(sys.argv[1:]in [[],['--apply']],'ARGUMENTS');run(sys.argv[1:]==['--apply'])
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) and str(error).replace('_','').isalnum() else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
