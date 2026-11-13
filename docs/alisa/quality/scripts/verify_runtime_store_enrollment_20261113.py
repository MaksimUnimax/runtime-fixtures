"""Installed read-only checks; zero grants, sessions, jobs or provider/model calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request

ROOT=Path('/root/alisa-s09-enrollment-install-20261113-d11a9f2a')
APP=Path('/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991')


def need(value,code):
    if not value:raise RuntimeError(code)


def proc(unit):
    pid=subprocess.check_output(['systemctl','show',unit,'--value','--property=MainPID'],text=True).strip()
    need(pid.isdigit() and int(pid)>1,'SERVICE_INACTIVE')
    status={line.split(':',1)[0]:line.split(':',1)[1].strip()for line in Path('/proc/'+pid+'/status').read_text().splitlines()if ':'in line}
    return pid,int(status['Uid'].split()[0]),int(status['Gid'].split()[0]),list(map(int,status['Groups'].split()))


def verify():
    need(os.geteuid()==0,'ROOT_REQUIRED')
    pid,uid,gid,groups=proc('alisa-platform@stage.service')
    env={k.decode():v.decode()for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0')if b'='in item for k,v in[item.split(b'=',1)]}
    need(env.get('ALISA_RELEASE')==APP.name and env.get('ALISA_RUNTIME_AUTO_BINDINGS_ENABLED')=='1','FEATURE_OR_RELEASE')
    os.environ.update(env);sys.path.insert(0,str(APP/'services/platform/src'))
    import django
    django.setup()
    from django.db import connection
    from django.conf import settings
    need(settings.RUNTIME_AUTO_BINDINGS_ENABLED is True,'FEATURE_DISABLED')
    tables=['stores_runtimetenantbinding','stores_runtimestorebinding']
    with connection.cursor()as cursor:
        cursor.execute('SET default_transaction_read_only=on')
        cursor.execute('SELECT current_user');need(cursor.fetchone()[0]=='alisa_stage_platform_runtime','RUNTIME_ROLE')
        cursor.execute("SELECT count(*)FROM django_migrations WHERE app='stores'AND name='0002_runtime_bindings'")
        need(cursor.fetchone()[0]==1,'MIGRATION_MISSING')
        for table in tables:
            for permission in ['SELECT','INSERT','UPDATE','DELETE']:
                cursor.execute('SELECT has_table_privilege(current_user,%s,%s)',[table,permission]);need(cursor.fetchone()[0]is True,'RUNTIME_CRUD')
            cursor.execute('SELECT has_table_privilege(current_user,%s,%s)',[table,'TRUNCATE']);need(cursor.fetchone()[0]is False,'RUNTIME_TRUNCATE')
        prior=json.loads((ROOT/'MIGRATED.json').read_text())
        need(prior['protected_runtime_privileges_unchanged']is True,'PROTECTED_RIGHTS')
    connection.close()
    code="""import django,json
django.setup()
from alisa_platform.runtime_adapter.client import configured_client
class MetadataOnly:
 def prepare(self,*args):raise AssertionError('OWNER_ADMISSION_FORBIDDEN_IN_METADATA_CHECK')
 def current(self,*args):raise AssertionError('OWNER_ADMISSION_FORBIDDEN_IN_METADATA_CHECK')
print(json.dumps(configured_client(MetadataOnly()).current_versions()))
"""
    result=subprocess.run([str(APP/'.venv/bin/python'),'-B','-c',code],env={**env,'PYTHONPATH':str(APP/'services/platform/src')},
        cwd=APP,user=uid,group=gid,extra_groups=groups,capture_output=True,text=True,timeout=12)
    need(result.returncode==0,'REAL_SERVICE_UID_RUNTIME_HANDSHAKE')
    versions=json.loads(result.stdout)
    need(versions==json.loads(Path(settings.RUNTIME_VERSIONS_PATH).read_text()),'VERSION_PIN_MISMATCH')
    # Resolve the existing owner-pair inside the actual checker's readonly mounts
    # and Unix identity. Only a boolean leaves that namespace, never credentials.
    checker,cuid,cgid,cgroups=proc('alisa-store-check.service')
    code="""import os,json,sys
sys.path.insert(0,'/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b')
os.setgroups(GROUPS);os.setgid(GID);os.setuid(UID)
import native_store_binding as n
d=n.root_json(n.PROJECTION,65536);ok=[]
for row in d['bindings']:
 m=n.root_json(n.CREDENTIALS/row['credential_name'],32768,readonly=True)
 pins={'environment':d['environment'],'product_id':d['product_id'],'provider':'OZON','kind':'PERFORMANCE','tenant_id':row['tenant_id'],'store_id':row['store_id']}
 ok.append(n.resolve(pins,{'client_id':m['performance_client_id'],'client_secret':m['performance_client_secret']})==row['identity'])
print(json.dumps({'owner_pair_current_generation':bool(ok)and all(ok)}))
""".replace('GROUPS',repr(cgroups)).replace('GID',str(cgid)).replace('UID',str(cuid))
    result=subprocess.run(['nsenter','--target',checker,'--mount','--','/usr/bin/python3','-B','-c',code],
        capture_output=True,text=True,timeout=12)
    need(result.returncode==0 and json.loads(result.stdout)['owner_pair_current_generation']is True,'OWNER_PAIR_READONLY_CHECKER')
    gates={}
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for path in ['/api/v1/account/stores','/api/v1/account/reports']:
        request=urllib.request.Request('http://127.0.0.1:18102'+path,data=b'{}',headers={'Content-Type':'application/json'})
        try:
            with opener.open(request,timeout=4)as response:status=response.status
        except urllib.error.HTTPError as error:status=error.code
        need(status in [401,403],'UNAUTHENTICATED_ROUTE_OPEN');gates[path]=status
    report={'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':'592cc8bb006a4991a876c875cd497701791a5593',
        'new_tables':tables,'runtime_crud_no_truncate':True,'protected_rights_unchanged':True,
        'actual_service_uid_runtime_versions':'PASS','owner_pair_current_generation_readonly_mounts':'PASS',
        'unauthenticated_routes':gates,'marketplace_calls':0,'model_calls':0,'test_sessions_grants_jobs_created':0,
        'live_owner':'NOT_PERFORMED'}
    (ROOT/'VERIFIED.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':
    try:verify()
    except Exception as error:
        code=str(error)if isinstance(error,RuntimeError)and str(error).replace('_','').isalnum()else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
