"""Finite catalog installation with pinned bases, shared lock and guarded rollback."""
import fcntl,hashlib,importlib.util,json,os,re,sqlite3,subprocess,sys,time,urllib.request
from pathlib import Path
from decimal import Decimal,InvalidOperation

ROOT=Path('/root/alisa-question-catalog-install-20261114')
OLD=Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a')
OPS_SHA='f8e68d5e0ad7502c8bd31f7c859a44921ba904f3265f8607e0f4091d2e596307'
FLAG=Path('/etc/alisa-platform/stage/question-catalog.env')
UNITS=['alice-market.service','alisa-runtime-authority-stage.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-admin@stage.service']
CHECKER='alisa-store-check.service'
PRESERVE=['alisa-station.service','alisa-identity@stage.service','alisa-smtp-sandbox-stage.service']
SELECTORS={u:Path('/etc/systemd/system')/(u+'.d')/('z'*64+'-question-catalog.conf') for u in UNITS[1:]}

def need(ok,code):
    if not ok:raise RuntimeError(code)

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def admin_cookie_contract(raw):
    """Check the emitted session-cookie call, allowing JavaScript numeric notation."""
    try:text=raw.decode('utf-8')
    except UnicodeDecodeError:return False
    ident=r'[A-Za-z_$][A-Za-z0-9_$]*'
    number=r'[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?'
    pattern=(r'\.append\(["\']Set-Cookie["\'],\s*'+ident+
             r'\(\s*'+ident+r'\s*,\s*'+ident+r'\s*,\s*('+number+r')\s*\)\)')
    values=re.findall(pattern,text)
    if len(values)!=1 or len(values[0])>32:return False
    try:return Decimal(values[0])==Decimal(2592000) and 'HttpOnly; Secure; SameSite=Lax; Max-Age=${' in text
    except InvalidOperation:return False

def load(digest):
    need(re.fullmatch('[a-f0-9]{64}',digest) and sha(ROOT/'PLAN.json')==digest,'PLAN_CHANGED')
    v=json.loads((ROOT/'PLAN.json').read_text())
    need(re.fullmatch('[a-f0-9]{40}',v['source']) and set(v['bases'])=={'platform','native','web','admin'},'PLAN_SCOPE')
    need(sha(OLD/'install.py')==OPS_SHA,'UTILITY_CHANGED')
    spec=importlib.util.spec_from_file_location('catalog_ops',OLD/'install.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    m.ROOT=ROOT;m.PAYLOAD=ROOT/'payload';m.SOURCE=v['source']
    for kind,field in [('platform','BASE'),('native','NATIVE_BASE'),('web','WEB_BASE'),('admin','ADMIN_BASE')]:
        p=Path(v['bases'][kind]['path'])
        parent=Path('/opt/alice-market/releases' if kind=='native' else '/opt/alisa-platform/stage/releases')
        need(p.parent==parent and re.fullmatch('alisa-[a-zA-Z0-9_-]{1,120}',p.name) and not p.is_symlink(),'BASE_PATH')
        setattr(m,field,p)
    m.APP=m.BASE.parent/('alisa-question-catalog-'+m.SOURCE[:16])
    m.NATIVE=m.NATIVE_BASE.parent/m.APP.name
    m.WEB_APP=m.BASE.parent/('alisa-cabinet-catalog-'+m.SOURCE[:16])
    m.WEB_VENV=(m.WEB_BASE/'.venv').resolve()
    return v,m

def idle():
    d=json.loads(Path('/etc/alice-market/market-runtime.json').read_text())
    p=Path(d['database']);need(p.is_absolute() and p.is_file(),'STATE_PATH')
    with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=2) as db:
        need(db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_RUNTIME_JOBS')

def snapshots(m,units):
    return {u:{k:m.prop(u,k) for k in ('MainPID','WorkingDirectory','DropInPaths')} for u in units}

def bases(v,m):
    m.reserve();idle()
    for row in v['bases'].values():need(sha(Path(row['path'])/'manifest.json')==row['sha256'],'BASE_MANIFEST_MOVED')
    need(m.CURRENT.is_symlink() and m.CURRENT.resolve()==m.NATIVE_BASE and m.WEB.is_symlink() and m.WEB.resolve()==m.WEB_BASE,'SELECTOR_MOVED')
    for u,p in {UNITS[1]:m.BASE/'services/platform',UNITS[2]:m.BASE,UNITS[3]:m.WEB_BASE,UNITS[4]:m.ADMIN_BASE}.items():
        need(Path(m.prop(u,'WorkingDirectory')).resolve()==p,'PROCESS_BASE_MOVED')
    need(Path('/proc/'+m.prop(UNITS[0],'MainPID')+'/cwd').resolve()==m.NATIVE_BASE,'NATIVE_MOVED')
    need(all(m.prop(u,'ActiveState')=='active' for u in UNITS+PRESERVE+[CHECKER]),'SERVICE_INACTIVE')
    need(not FLAG.exists() and not any(p.exists() for p in SELECTORS.values()),'ALREADY_CONFIGURED')
    need((m.BASE/'.venv').is_dir() and (m.WEB_BASE/'.venv').is_dir(),'DEPENDENCY_MISSING')
    m.manifest(m.ADMIN_BASE)
    return [m.manifest(p) for p in (m.BASE,m.NATIVE_BASE,m.WEB_BASE)]

def candidates(v,m,old):
    platform,native,_=[json.loads(json.dumps(x)) for x in old];package=v['package_manifest']
    need(package['source_sha']==m.SOURCE and package['locks']==platform['locks']==old[2]['locks'],'PACKAGE_SOURCE_OR_DEPENDENCIES')
    admin_base=m.manifest(m.ADMIN_BASE)
    need(package['locks']==admin_base['locks'] and admin_base.get('preserved_admin_cookie_seconds')==2592000,'ADMIN_BASE_CONTRACT')
    callback='ui/admin/apps/admin/.next/server/app/auth/callback/route.js'
    need(callback in package['files'] and admin_cookie_contract((m.PAYLOAD/'platform'/callback).read_bytes()),'ADMIN_COOKIE_REGRESSION')
    allowed={'services/platform/src/alisa_platform/'+n for n in ['catalog/__init__.py','catalog/reader.py','catalog/views.py','config/settings.py','config/urls.py']}
    need(set(v['platform_files'])==allowed and v['platform_files']=={n:package['files'][n] for n in allowed},'PLATFORM_SCOPE')
    platform['files']={n:h for n,h in platform['files'].items() if not n.startswith('ui/admin/')}
    platform['files'].update({n:h for n,h in package['files'].items() if n.startswith('ui/admin/')})
    platform['files'].update(v['platform_files'])
    platform['links']={n:h for n,h in platform.get('links',{}).items() if not n.startswith('ui/admin/')}
    platform['links'].update({n:h for n,h in package.get('links',{}).items() if n.startswith('ui/admin/')})
    platform.update(artifact_id=m.APP.name,source_sha=m.SOURCE,base_release=m.BASE.name,base_manifest_sha256=v['bases']['platform']['sha256'],question_catalog_source=m.SOURCE)
    need(set(v['native_files'])=={'question_catalog_extension.py','runtime_port_service.py','CURRENT_CORE_MANIFEST.json'},'NATIVE_SCOPE')
    core=json.loads((m.PAYLOAD/'native/CURRENT_CORE_MANIFEST.json').read_text())
    expected={n:h for n,h in native['files'].items() if n!='CURRENT_CORE_MANIFEST.json'}
    expected.update({n:h for n,h in v['native_files'].items() if n!='CURRENT_CORE_MANIFEST.json'})
    need(core['files']==expected,'UNTOUCHED_NATIVE_FILES_CHANGED')
    native['files'].update(v['native_files'])
    native.update(artifact_id=m.NATIVE.name,source_commit=m.SOURCE,base_release=m.NATIVE_BASE.name,base_manifest_sha256=v['bases']['native']['sha256'],parallel_source_commit=native.get('source_commit'),question_catalog_source=m.SOURCE)
    web=json.loads(json.dumps(package))
    web['files']={n:h for n,h in package['files'].items() if n.startswith('ui/web/') or n=='infra/launch.py'}
    web['links']={n:h for n,h in package.get('links',{}).items() if n.startswith('ui/web/')}
    web.update(artifact_id=m.WEB_APP.name,base_release=m.WEB_BASE.name,base_manifest_sha256=v['bases']['web']['sha256'],question_catalog_source=m.SOURCE)
    for kind,a,b in zip(['platform','native','web'],old,[platform,native,web]):
        for n,h in b['files'].items():
            need(m.safe(n),'PAYLOAD_PATH')
            if a['files'].get(n)!=h:
                p=m.PAYLOAD/kind/n
                need(not p.is_symlink() and p.resolve().is_relative_to(m.PAYLOAD) and sha(p)==h,'PAYLOAD_HASH')
    return platform,native,web

def prepare(v,m):
    old=bases(v,m);new=candidates(v,m,old);targets=[m.APP,m.NATIVE,m.WEB_APP]
    need(not any(p.exists() for p in targets) and not (ROOT/'PREPARED.json').exists(),'CANDIDATE_EXISTS')
    extra,inodes=m.budget(old,new);m.reserve(extra,inodes)
    need(sha(OLD/'pair_helpers.py')==m.PAIR_SHA,'PAIR_HELPER_CHANGED')
    m.atomic(ROOT/'pair_helpers.py',(OLD/'pair_helpers.py').read_bytes())
    for base,target,a,b,kind in zip([m.BASE,m.NATIVE_BASE,m.WEB_BASE],targets,old,new,['platform','native','web']):
        m.copy_release(base,target,a,b,kind)
    m.pair().expected_version_bytes(m.NATIVE)
    m.run('/usr/bin/python3','-B',str(m.NATIVE/'runtime.py'),'--config','/etc/alice-market/market-runtime.json','--check')
    bases(v,m)
    m.record('PREPARED.json',{'source':m.SOURCE,'manifests':{str(p):sha(p/'manifest.json') for p in targets},'units':snapshots(m,UNITS+PRESERVE),'budget_bytes':extra,'migrations':[],'service_changes':False})

def checked(v,m):
    old=bases(v,m);new=candidates(v,m,old);saved=json.loads((ROOT/'PREPARED.json').read_text())
    need(saved['source']==m.SOURCE and snapshots(m,UNITS+PRESERVE)==saved['units'],'PROCESS_CHANGED')
    for p,want in zip([m.APP,m.NATIVE,m.WEB_APP],new):
        need(sha(p/'manifest.json')==saved['manifests'][str(p)] and m.manifest(p)==want,'CANDIDATE_CHANGED')
    return saved

def stop(m,unit):
    state=m.prop(unit,'ActiveState')
    if state in ('inactive','failed'):return
    if state!='deactivating':m.run('systemctl','--no-block','stop',unit)
    deadline=time.monotonic()+125
    while m.prop(unit,'ActiveState') not in ('inactive','failed'):
        need(time.monotonic()<deadline,'STOP_OUTCOME_UNRESOLVED');time.sleep(.3)

def drops(m):
    result={}
    for unit,path in SELECTORS.items():
        text='[Service]\n'
        if unit==UNITS[1]:
            original=Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d/z-report-archive.conf').read_text()
            need(str(m.BASE) in original,'AUTHORITY_SELECTOR_CHANGED')
            text=original.replace(str(m.BASE),str(m.APP)).replace(m.BASE.name,m.APP.name)+'\n'
        elif unit in (UNITS[2],UNITS[4]):
            component='platform' if unit==UNITS[2] else 'admin'
            text+='WorkingDirectory='+str(m.APP)+'\nExecStart=\nExecStart='+str(m.APP/'.venv/bin/python')+' '+str(m.APP/'infra/launch.py')+' '+component+'\n'
        text+='EnvironmentFile='+str(FLAG)+'\n';result[path]=text.encode()
    return result

def ready(m,rollback=False):
    app=m.BASE if rollback else m.APP;web=m.WEB_BASE if rollback else m.WEB_APP
    native=m.NATIVE_BASE if rollback else m.NATIVE
    deadline=time.monotonic()+40;opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while True:
        try:
            need(all(m.prop(u,'ActiveState')=='active' for u in UNITS+PRESERVE+[CHECKER]),'SERVICE_NOT_READY')
            need(Path('/proc/'+m.prop(UNITS[0],'MainPID')+'/cwd').resolve()==native,'NATIVE_PROCESS_MISMATCH')
            admin=m.ADMIN_BASE if rollback else app
            for port,target in ((18102,app),(18100,web),(18101,admin)):
                with opener.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as response:
                    need(response.status==200 and json.loads(response.read(8192))['release']==target.name,'HEALTH_RELEASE')
            authority=json.loads(m.run('curl','--silent','--show-error','--fail','--max-time','3','--unix-socket','/run/alisa-runtime-rpc/authority/authority.sock','http://localhost/health/ready'))
            need(authority['release']==app.name,'AUTHORITY_RELEASE')
            break
        except (OSError,RuntimeError):
            if time.monotonic()>=deadline:raise
            time.sleep(.3)
    need(Path(m.prop(UNITS[2],'WorkingDirectory')).resolve()==app and Path(m.prop(UNITS[3],'WorkingDirectory')).resolve()==web,'PROCESS_MISMATCH')
    need(Path(m.prop(UNITS[1],'WorkingDirectory')).resolve()==app/'services/platform' and
         Path(m.prop(UNITS[4],'WorkingDirectory')).resolve()==(m.ADMIN_BASE if rollback else app),'ADMIN_AUTHORITY_PROCESS_MISMATCH')
    pid=m.prop(UNITS[2],'MainPID')
    fields={l.split(':',1)[0]:l.split(':',1)[1].strip() for l in Path('/proc/'+pid+'/status').read_text().splitlines() if ':' in l}
    env={k.decode():v.decode() for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0') if b'=' in item for k,v in [item.split(b'=',1)]}
    code="""import django,json,sys
django.setup()
from alisa_platform.runtime_adapter.client import configured_client
class MetadataOnly:
 def prepare(self,*a):raise AssertionError('OWNER_ADMISSION_FORBIDDEN')
 def current(self,*a):return False
api=configured_client(MetadataOnly())
if sys.argv[1]=='catalog':
 from alisa_platform.catalog.reader import read
 value=read(api,scoped=False)
 print(json.dumps({'versions':value['versions'],'count':len(value['items'])}))
else:print(json.dumps({'versions':api.current_versions()}))
"""
    result=subprocess.run([str(app/'.venv/bin/python'),'-B','-c',code,'versions' if rollback else 'catalog'],user=int(fields['Uid'].split()[0]),group=int(fields['Gid'].split()[0]),extra_groups=list(map(int,fields['Groups'].split())),cwd=app,env={**env,'PYTHONPATH':str(app/'services/platform/src')},capture_output=True,text=True,timeout=12)
    need(result.returncode==0,'INSTALLED_METADATA_READ')
    value=json.loads(result.stdout);need(value['versions']==json.loads(m.VERSIONS.read_text()),'VERSION_HANDSHAKE')
    if not rollback:need(value['count']>0,'EMPTY_CATALOG')
    m.pair().projection_data();m.reserve()
    need(Path(m.prop(CHECKER,'WorkingDirectory')).resolve()==Path('/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b'),'CHECKER_RELEASE_MOVED')

def rollback_guard(m,old,expected,contents,flag):
    need(m.CURRENT.resolve() in (m.NATIVE_BASE,m.NATIVE) and m.WEB.resolve() in (m.WEB_BASE,m.WEB_APP)
        and all(p.read_bytes() in (old[p],expected[p]) for p in old)
        and (not FLAG.exists() or FLAG.read_bytes()==flag)
        and all(not p.exists() or p.read_bytes()==raw for p,raw in contents.items()),'ROLLBACK_LATER_WRITER')

def apply(v,m,lock):
    saved=checked(v,m)
    need(not (ROOT/'BACKUP.json').exists() and not (ROOT/'ACTIVATED.json').exists(),'ALREADY_STARTED')
    pair=m.pair();original=pair.projection_data();paths=[m.VERSIONS,m.PROJECTION,m.LINK_ENV]
    old={p:p.read_bytes() for p in paths};expected=dict(old);expected[m.VERSIONS]=pair.expected_version_bytes(m.NATIVE)
    contents=drops(m);flag=b'ALISA_QUESTION_CATALOG_ENABLED=1\n'
    (ROOT/'backup').mkdir(mode=0o700)
    for i,p in enumerate(paths):m.atomic(ROOT/'backup'/str(i),old[p])
    m.record('BACKUP.json',{'paths':[str(p) for p in paths],'source':m.SOURCE})
    try:
        stop(m,UNITS[0]);idle()
        for u in UNITS[1:]:stop(m,u)
        m.atomic(FLAG,flag)
        for p,raw in contents.items():m.atomic(p,raw,0o644)
        m.pointer(m.CURRENT,m.NATIVE);m.pointer(m.WEB,m.WEB_APP);pair.sync(m.NATIVE,lock)
        m.run('systemctl','daemon-reload');m.run('systemctl','start',UNITS[0])
        pair.refresh_projection(original,on_write=lambda raw:expected.update({m.PROJECTION:raw}))
        for u in UNITS[1:]:m.run('systemctl','start',u)
        ready(m)
        need(m.LINK_ENV.read_bytes()==old[m.LINK_ENV],'AUTH_CONFIG_CHANGED')
        need(snapshots(m,PRESERVE)=={u:saved['units'][u] for u in PRESERVE},'UNRELATED_PROCESS_CHANGED')
        m.record('ACTIVATED.json',{'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':m.SOURCE,'native_release':m.NATIVE.name,'platform_admin_release':m.APP.name,'web_release':m.WEB_APP.name,'migrations':[],'new_accounts_links_grants':0,'verifier_model_marketplace_calls':0,'owner_browser_acceptance':'NOT_PERFORMED','physical_voice_acceptance':'NOT_PERFORMED','store_check_restart':'EXPECTED_OWNER_PROJECTION_REFRESH'})
    except BaseException:
        rollback_guard(m,old,expected,contents,flag);failures=[]
        def attempt(label,action):
            try:action()
            except BaseException:failures.append(label)
        for u in reversed(UNITS):attempt('stop_'+u,lambda u=u:stop(m,u))
        if failures:
            m.record('ROLLED_BACK.json',{'status':'ROLLBACK_STOP_UNRESOLVED','failures':failures})
            raise RuntimeError('ROLLBACK_STOP_UNRESOLVED')
        rollback_guard(m,old,expected,contents,flag)
        for p in [*contents,FLAG]:
            if p.exists():p.unlink()
        attempt('native_selector',lambda:m.pointer(m.CURRENT,m.NATIVE_BASE))
        attempt('web_selector',lambda:m.pointer(m.WEB,m.WEB_BASE))
        attempt('versions',lambda:pair.sync(m.NATIVE_BASE,lock))
        attempt('reload',lambda:m.run('systemctl','daemon-reload'))
        if failures:
            m.record('ROLLED_BACK.json',{'status':'ROLLBACK_PREREQUISITE_FAILED','failures':failures})
            raise RuntimeError('ROLLBACK_PREREQUISITE_FAILED')
        attempt('native_start',lambda:m.run('systemctl','start',UNITS[0]))
        if failures:
            m.record('ROLLED_BACK.json',{'status':'ROLLBACK_NATIVE_START_FAILED','failures':failures})
            raise RuntimeError('ROLLBACK_NATIVE_START_FAILED')
        attempt('projection',lambda:pair.refresh_projection(original))
        if failures:
            m.record('ROLLED_BACK.json',{'status':'ROLLBACK_PROJECTION_FAILED','failures':failures})
            raise RuntimeError('ROLLBACK_PROJECTION_FAILED')
        for u in UNITS[1:]:attempt('start_'+u,lambda u=u:m.run('systemctl','start',u))
        attempt('readiness',lambda:ready(m,True))
        m.record('ROLLED_BACK.json',{'status':'ROLLBACK_NEEDS_ATTENTION' if failures else 'ROLLED_BACK','failures':failures})
        raise

def main():
    need(os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1] in ('--prepare','--check','--apply'),'ARGUMENTS')
    v,m=load(sys.argv[2])
    with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1]=='--prepare':prepare(v,m)
        elif sys.argv[1]=='--check':checked(v,m)
        else:apply(v,m,lock)
    print(json.dumps({'status':'PASS','operation':sys.argv[1],'source':m.SOURCE}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'BLOCKED','code':str(error) if isinstance(error,RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
