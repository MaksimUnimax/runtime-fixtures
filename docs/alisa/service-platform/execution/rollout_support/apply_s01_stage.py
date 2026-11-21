"""Finite authorized S01 stage activation. Never restarts identity/admin/lab.

Run under flock. Package identity is fixed; data rollback is deliberately absent.
"""
import sys
sys.dont_write_bytecode = True
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import time
import urllib.request
import uuid

BASE = Path('/opt/alisa-platform/stage')
EVIDENCE = Path('/var/lib/alisa-platform/stage/evidence')
NEW = BASE/'releases/alisa-8d680f775c8ccdf2'
SOURCE = '8d680f775c8ccdf2a9520fa93c4909dd0aaaa986'
PACKAGE = 'fd28f38960c50f5375fe4ff74ca0a29fd01aaf168673fe31213e3e662f094642'
SMTP_SHA256 = '77ae3701d5181870ded5867a79b6977e7a3f4af718a2a368cbcde8da8219cdd8'
OLD = BASE/'releases/alisa-77d0f8ee2643ef65'
CONFIG = Path('/etc/alisa-platform/stage')
NGINX = Path('/etc/nginx/sites-available/alisa-platform-stage.conf')
RECEIPT = EVIDENCE/'AL_S01_ACTIVATION_20261105.json'
TABLES = {'leads_lead','leads_mailoutbox','leads_ratebucket','leads_submission','funnel_funnelevent'}
TARGETS = ['alisa-platform@stage.service','alisa-web@stage.service']

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(*args, **kwargs): return subprocess.run(list(map(str,args)),check=True,text=True,capture_output=True,**kwargs)
def write(path, data, mode):
    path = Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    temp = path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    temp.write_text(data);temp.chmod(mode);os.replace(temp,path)
def pointer(target):
    temp=BASE/('.site-current-'+uuid.uuid4().hex);temp.symlink_to(target);os.replace(temp,BASE/'site-current')
def config(name):
    p=CONFIG/(name+'.env')
    if p.stat().st_mode & 0o077: raise RuntimeError('Configuration must be root-private')
    return dict(line.split('=',1) for line in p.read_text().splitlines() if line and not line.startswith('#'))
def env_for_migration():
    data=config('platform-migration')
    if data['ALISA_DB_NAME']!='alisa_stage_platform' or data['ALISA_DB_USER']!='alisa_stage_platform_migration' or data['ALISA_ENV']!='stage':
        raise RuntimeError('Wrong migration authority')
    return {**{k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL'}},**data,
            'PYTHONDONTWRITEBYTECODE':'1','PYTHONPATH':str(NEW/'services/platform/src'),
            'DJANGO_SETTINGS_MODULE':'alisa_platform.config.settings','ALISA_RELEASE':NEW.name}
def python(code):return run(NEW/'.venv/bin/python','-c',code,env=env_for_migration()).stdout.strip()
def unit_state(name):
    return dict(line.split('=',1) for line in run('systemctl','show',name,'-p','MainPID','-p','ActiveState','-p','ActiveEnterTimestamp').stdout.splitlines())
def wait(port, release):
    for _ in range(50):
        try:
            with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as response: data=json.load(response)
            if data.get('release')==release:return data
        except (OSError,ValueError):pass
        time.sleep(.25)
    raise RuntimeError('Target readiness timeout')
def amend(name, additions):
    p=CONFIG/(name+'.env');original=p.read_text();existing=config(name)
    for key,value in additions.items():existing[key]=value
    write(p,'\n'.join(key+'='+value for key,value in existing.items())+'\n',0o600)

def main():
    if RECEIPT.exists():raise RuntimeError('Activation checkpoint exists; inspect exact outcome before any retry')
    before=json.loads((EVIDENCE/'AL_S01_PREFLIGHT_20261105.json').read_text())
    if (BASE/'current').resolve()!=OLD:raise RuntimeError('Excluded component pointer changed')
    for name,digest in before['own_original_hashes'].items():
        if sha(name)!=digest:raise RuntimeError('Own configuration changed since preflight')
    for name,digest in before['protected_hashes'].items():
        if sha(name)!=digest:raise RuntimeError('Protected file changed since preflight')
    for name,state in before['excluded_units'].items():
        if unit_state(name)!=state:raise RuntimeError('Excluded service changed since preflight')
    manifest=json.loads((NEW/'manifest.json').read_text())
    if manifest['source_sha']!=SOURCE:raise RuntimeError('Wrong installed source')
    artifact=Path('/var/lib/alisa-platform/stage/artifacts')/(NEW.name+'.tar.gz')
    if sha(artifact)!=PACKAGE:raise RuntimeError('Wrong package hash')
    smtp_source=BASE/'testing/synthetic_smtp.py'
    if not smtp_source.is_file() or sha(smtp_source)!=SMTP_SHA256:
        raise RuntimeError('Staged private SMTP source missing or changed')
    spec=importlib.util.spec_from_file_location('release_verifier',NEW/'infra/release.py')
    verifier=importlib.util.module_from_spec(spec);spec.loader.exec_module(verifier)
    verifier.installed_release(BASE,NEW.name);verifier.installed_release(BASE,OLD.name)
    record={'record_type':'AL_S01_TARGETED_STAGE_ACTIVATION','source_commit':SOURCE,'artifact_sha256':PACKAGE,
            'started_at_utc':now(),'status':'STARTED','steps':[],'scope':'web/platform only; excluded shared current pointer remains S00'}
    def step(name, **details):
        record['steps'].append({'step':name,'at_utc':now(),**details});write(RECEIPT,json.dumps(record,indent=2)+'\n',0o644)
    changed=False;dropins=[];created_units=[]
    original_nginx=NGINX.read_text();nginx_mode=NGINX.stat().st_mode & 0o777
    try:
        plan=json.loads(python("import django,json;django.setup();from django.db import connection;from django.db.migrations.executor import MigrationExecutor;ex=MigrationExecutor(connection);print(json.dumps([[m.app_label,m.name,b] for m,b in ex.migration_plan(ex.loader.graph.leaf_nodes())]))"))
        expected={('leads','0001_initial',False),('funnel','0001_initial',False)}
        if plan and set(map(tuple,plan))!=expected:raise RuntimeError('Unapproved pending migration')
        old_tables=set(json.loads(python("import django,json;django.setup();from django.db import connection;print(json.dumps(connection.introspection.table_names()))")))
        if plan and old_tables & TABLES:raise RuntimeError('Unexpected preexisting S01 tables')
        step('migration_plan_verified',plan=plan,new_tables=sorted(TABLES))
        if plan:
            result=run(NEW/'.venv/bin/python',NEW/'services/platform/manage.py','migrate','--noinput',env=env_for_migration())
            step('platform_migrations_applied',output=result.stdout.strip())
        else:step('platform_migrations_already_applied_no_repeat')
        new_tables=set(json.loads(python("import django,json;django.setup();from django.db import connection;print(json.dumps(connection.introspection.table_names()))")))
        if plan and new_tables-old_tables!=TABLES:raise RuntimeError('Unexpected schema delta')
        if not TABLES<=new_tables:raise RuntimeError('New tables missing')
        step('five_additive_tables_verified',created=sorted(new_tables-old_tables))
        changed=True
        common={'ALISA_LEAD_INTAKE_ENABLED':'1','ALISA_LANDING_MODE':'CLOSED','ALISA_PUBLIC_BASE_URL':'https://alisa-stage.octoport.ru'}
        amend('web',common);amend('platform',{**common,'ALISA_SMTP_HOST':'127.0.0.1','ALISA_SMTP_PORT':'18225'})
        for component in ['web','platform','lead-mail']:
            folder=Path('/etc/systemd/system')/('alisa-'+component+'@stage.service.d')
            path=folder/'s01-release.conf'
            if path.exists():raise RuntimeError('Unexpected existing target drop-in')
            text='[Service]\nWorkingDirectory='+str(BASE/'site-current')+'\nExecStart=\nExecStart='+str(BASE/'site-current/.venv/bin/python')+' '+str(BASE/'site-current/infra/launch.py')+' '+('lead-mail' if component=='lead-mail' else component)+'\n'
            write(path,text,0o644);dropins.append(path)
        for filename in ['alisa-lead-mail@.service','alisa-lead-mail@.timer']:
            dest=Path('/etc/systemd/system')/filename
            if dest.exists():raise RuntimeError('Mail unit already exists; inspect before replacement')
            write(dest,(NEW/'infra/systemd'/filename).read_text(),0o644)
            created_units.append(dest)
        inbox=Path('/var/lib/alisa-platform/stage/mail-sandbox');inbox.mkdir(exist_ok=True,mode=0o700);inbox.chmod(0o700)
        account=pwd.getpwnam('alisa-worker-stage');os.chown(inbox,account.pw_uid,account.pw_gid)
        smtp_unit='''[Unit]
Description=Alisa private synthetic SMTP sandbox
After=network.target
[Service]
Type=simple
User=alisa-worker-stage
Group=alisa-worker-stage
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/usr/bin/python3 /opt/alisa-platform/stage/testing/synthetic_smtp.py --inbox /var/lib/alisa-platform/stage/mail-sandbox
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/alisa-platform/stage/mail-sandbox
RestrictAddressFamilies=AF_UNIX AF_INET
MemoryMax=96M
MemorySwapMax=0
TasksMax=32
UMask=0077
[Install]
WantedBy=multi-user.target
'''
        dest=Path('/etc/systemd/system/alisa-smtp-sandbox-stage.service')
        if dest.exists():raise RuntimeError('SMTP service already present; inspect rather than replace')
        write(dest,smtp_unit,0o644)
        created_units.append(dest)
        if original_nginx.count('server_name alisa-stage.octoport.ru;')!=1:raise RuntimeError('Unexpected site vhost layout')
        safe="log_format alisa_platform_site_safe '$request_method $uri $status';\n"
        safe+=original_nginx.replace('server_name alisa-stage.octoport.ru;','server_name alisa-stage.octoport.ru;\n access_log /var/log/nginx/alisa-platform-stage.access.log alisa_platform_site_safe;',1)
        write(NGINX,safe,nginx_mode);run('nginx','-t')
        pointer(NEW);run('systemctl','daemon-reload')
        run('systemctl','enable','--now','alisa-smtp-sandbox-stage.service')
        run('systemctl','restart',TARGETS[0]);api=wait(18102,NEW.name)
        run('systemctl','restart',TARGETS[1]);web=wait(18100,NEW.name)
        run('systemctl','enable','--now','alisa-lead-mail@stage.timer');run('systemctl','reload','nginx')
        step('targeted_activation_ready',web=web,platform=api,selected_pointer=str((BASE/'site-current').resolve()),excluded_pointer=str((BASE/'current').resolve()))
        if (BASE/'current').resolve()!=OLD:raise RuntimeError('Excluded pointer changed')
        for name,digest in before['protected_hashes'].items():
            if sha(name)!=digest:raise RuntimeError('Protected file changed')
        for name,state in before['excluded_units'].items():
            if unit_state(name)!=state:raise RuntimeError('Excluded unit changed')
        step('excluded_identity_admin_lab_and_configs_unchanged',checks=len(before['protected_hashes'])+len(before['excluded_units']))
        record['status']='INSTALLED_AWAITING_INDEPENDENT_ACCEPTANCE';record['finished_at_utc']=now()
        write(RECEIPT,json.dumps(record,indent=2)+'\n',0o644)
    except Exception as exc:
        record['status']='FAILED';record['error_type']=type(exc).__name__;record['error']=str(exc) if isinstance(exc,RuntimeError) else 'Private diagnostic required'
        if changed:
            actions=[]
            def restore_action(name, callback):
                try:
                    callback();actions.append({'action':name,'status':'PASS'});return True
                except Exception as error:
                    actions.append({'action':name,'status':'FAILED','error_type':type(error).__name__});return False
            for filename,unit in [('alisa-lead-mail@.timer','alisa-lead-mail@stage.timer'),('alisa-smtp-sandbox-stage.service','alisa-smtp-sandbox-stage.service')]:
                if any(p.name==filename for p in created_units):restore_action('disable '+unit,lambda unit=unit:run('systemctl','disable','--now',unit))
            if any(p.name=='alisa-lead-mail@.service' for p in created_units):restore_action('stop active mail batch',lambda:run('systemctl','stop','alisa-lead-mail@stage.service'))
            backup=Path(before['backup_directory'])
            restore_action('restore web config',lambda:write(CONFIG/'web.env',(backup/'0-web.env').read_text(),0o600))
            restore_action('restore platform config',lambda:write(CONFIG/'platform.env',(backup/'1-platform.env').read_text(),0o600))
            restore_action('restore own nginx config',lambda:write(NGINX,original_nginx,nginx_mode))
            restore_action('restore target code pointer',lambda:pointer(OLD))
            for path in dropins+created_units:
                restore_action('remove created '+path.name,lambda path=path:path.unlink(missing_ok=True))
            restore_action('reload unit definitions',lambda:run('systemctl','daemon-reload'))
            restore_action('restart only target services',lambda:run('systemctl','restart',*TARGETS))
            if restore_action('validate restored nginx',lambda:run('nginx','-t')):
                restore_action('reload restored nginx',lambda:run('systemctl','reload','nginx'))
            restore_action('verify restored web version',lambda:wait(18100,OLD.name))
            restore_action('verify restored platform version',lambda:wait(18102,OLD.name))
            record['rollback']={'status':'COMPLETE' if all(a['status']=='PASS' for a in actions) else 'PARTIAL',
                                'actions':actions,'database_restore_or_delete_performed':False}
        record['finished_at_utc']=now();write(RECEIPT,json.dumps(record,indent=2)+'\n',0o644)
        raise

if __name__=='__main__': main()
