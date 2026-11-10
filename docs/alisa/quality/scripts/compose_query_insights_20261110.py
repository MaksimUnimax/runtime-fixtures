"""Finite composition of the admitted S08 package; does not select services or migrate."""
import ast,base64,fcntl,hashlib,importlib.util,io,json,os,shutil,subprocess,tarfile
from pathlib import Path

ROOT=Path('/root/alisa-s08-install-d11a9f2a-20261110')
SOURCE='f4127277e9c25557b02c25eb73e21477affd995c'
PLATFORM=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
NATIVE=Path('/opt/alice-market/releases/alisa-query-insights-r1-20261110')
OLD_PLATFORM=Path('/opt/alisa-platform/stage/releases/alisa-report-archive-ab21d8fa3a940259')
OLD_ADMIN=Path('/opt/alisa-platform/stage/releases/alisa-admin-session-r1-20261108')
BASE_NATIVE_HASHES={'template_gaps.py':'ea89ef8eed006bec5a1418d0ee92c39699f2ee3f902a087a0851237e8ac3b380','repository.py':'a5dd89764e026db47c6b9420a25620c70a866f1b783fea770aee7194c308481c','platform_authority_client.py':'735ea5f0e0a77a0c50d047ea4cc1c48049123c64536425659f0d64add023c32e'}
STAFF='services/platform/src/alisa_platform/staff/'
POLICY_HASH='0412338f34441ded37b0cfc3fedab8ae9338926fde70d60f69b24a780dc1841b'
VIEWS_HASH='c5e8ccc53d7641969db6b51947c2b0883b1cc35042a7889bb9fa06c62cb1f7be'
SERVICES=['alice-market.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-admin@stage.service','alisa-runtime-authority-stage.service']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def need(ok,code):
    if not ok:raise RuntimeError(code)
def cwd(service):return Path(subprocess.run(['systemctl','show',service,'--value','-p','WorkingDirectory'],check=True,capture_output=True,text=True).stdout.strip()).resolve()
def write(p,raw):
    p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+'.s08-new')
    with tmp.open('xb')as f:f.write(raw)
    tmp.chmod(0o644);os.replace(tmp,p)
def load_admission():
    spec=importlib.util.spec_from_file_location('admission','/usr/local/libexec/alisa/runtime_versions_sync.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def compose():
    need(os.geteuid()==0,'ROOT_INSTALLER_REQUIRED')
    with Path('/run/lock/alisa-stage-rollout.lock').open('r+')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        before={s:str(cwd(s))for s in SERVICES};base_native=Path(before['alice-market.service'])
        need(Path(before['alisa-platform@stage.service'])==OLD_PLATFORM,'PLATFORM_MOVED')
        need(Path(before['alisa-web@stage.service'])==OLD_PLATFORM,'WEB_MOVED')
        need(Path(before['alisa-admin@stage.service'])==OLD_ADMIN,'ADMIN_MOVED')
        need(Path(before['alisa-runtime-authority-stage.service'])==OLD_PLATFORM/'services/platform','AUTHORITY_MOVED')
        need(not PLATFORM.exists()and not NATIVE.exists(),'CANDIDATE_EXISTS')
        need(shutil.disk_usage('/opt').free>3*1024**3+200*1024**2,'DISK_HEADROOM')
        admission=load_admission();admission.validate_release(base_native)
        for name,digest in BASE_NATIVE_HASHES.items():need(sha(base_native/name)==digest,'NATIVE_TARGET_CHANGED')
        need(sha(OLD_PLATFORM/(STAFF+'policy.py'))==POLICY_HASH,'POLICY_MOVED')
        need(sha(OLD_PLATFORM/(STAFF+'views.py'))==VIEWS_HASH,'STAFF_VIEWS_MOVED')
        staged=ROOT/'staged/alisa-f4127277e9c25557';m=json.loads((staged/'manifest.json').read_text())
        need(m['source_sha']==SOURCE,'WRONG_SOURCE')
        need(m['locks']==json.loads((OLD_PLATFORM/'manifest.json').read_text())['locks'],'DEPENDENCIES_CHANGED')
        # Existing long session is verified in the actually selected admin callback.
        old_callback=OLD_ADMIN/'ui/admin/apps/admin/.next/server/app/auth/callback/route.js'
        need('append("Set-Cookie",s(j,x,2592000))'in old_callback.read_text(),'LIVE_COOKIE_POLICY_CHANGED')
        for name,digest in m['files'].items():need(sha(staged/name)==digest,'STAGED_PACKAGE_CHANGED')
        os.replace(staged,PLATFORM)
        shutil.copytree(OLD_PLATFORM/'.venv',PLATFORM/'.venv',symlinks=True,copy_function=os.link)
        # Preserve the installed policy/functions, adding only the two new permissions.
        original=(OLD_PLATFORM/(STAFF+'policy.py')).read_text();lines=original.splitlines(True)
        assignments=[n for n in ast.parse(original).body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='ADMIN_PERMISSIONS'for t in n.targets)]
        need(len(assignments)==1,'PERMISSION_ASSIGNMENT');node=assignments[0];need(node.lineno==node.end_lineno,'MULTILINE_POLICY')
        values=ast.literal_eval(node.value.args[0]);need(type(values)is set and all(type(x)is str for x in values),'PERMISSION_SET')
        values|={'insights.read','insights.export'};lines[node.lineno-1]='ADMIN_PERMISSIONS=frozenset({'+','.join(repr(v)for v in sorted(values))+'})\n'
        policy=''.join(lines);write(PLATFORM/(STAFF+'policy.py'),policy.encode());write(PLATFORM/(STAFF+'views.py'),(OLD_PLATFORM/(STAFF+'views.py')).read_bytes())
        # The sole private UI variant is the existing 30-day reference-cookie TTL.
        old='append("Set-Cookie",s(j,x,3600))';new='append("Set-Cookie",s(j,x,2592000))';patched=[]
        for p in (PLATFORM/'ui/admin/apps/admin/.next/server').rglob('*.js'):
            if p.stat().st_size>5000000:continue
            s=p.read_text()
            if '__Host-alisa_staff'not in s or old not in s:continue
            need(s.count(old)==1,'AMBIGUOUS_COOKIE_PATCH');write(p,s.replace(old,new).encode());patched.append(str(p.relative_to(PLATFORM)))
        need(len(patched)==6,'COOKIE_PATCH_COUNT')
        for name in m['files']:m['files'][name]=sha(PLATFORM/name)
        m.update(artifact_id=PLATFORM.name,base_release=OLD_PLATFORM.name,admin_base_release=OLD_ADMIN.name,qualified_source_sha=SOURCE,qualified_tar_sha256='be9d9e2c9a05fb214bcb026d0d22c9047bff5bfbceb0f500ba2add19843a22a5',preserved_parallel_files={STAFF+'policy.py':sha(PLATFORM/(STAFF+'policy.py')),STAFF+'views.py':VIEWS_HASH},preserved_admin_cookie_seconds=2592000,preserved_admin_cookie_files=sorted(patched),acceptance='INSTALLED_NOT_ACTIVATED')
        write(PLATFORM/'manifest.json',(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode())
        nm=json.loads((base_native/'manifest.json').read_text());base_manifest=sha(base_native/'manifest.json');NATIVE.mkdir(mode=0o755)
        for name in nm['files']:
            target=NATIVE/name;target.parent.mkdir(parents=True,exist_ok=True);os.link(base_native/name,target)
        with tarfile.open(fileobj=io.BytesIO(base64.b64decode((ROOT/'native-patch.b64').read_bytes())),mode='r:gz')as tar:
            for member in tar:
                need(member.isfile()and'/'not in member.name,'NATIVE_PATCH_LAYOUT')
                raw=tar.extractfile(member).read()
                if member.name=='test_query_gap_events.py':write(ROOT/member.name,raw);continue
                need(member.name in json.loads((ROOT/'patch-hashes.json').read_text()),'NATIVE_PATCH_FILE')
                write(NATIVE/member.name,raw);nm['files'][member.name]=sha(NATIVE/member.name)
        for name,digest in json.loads((ROOT/'patch-hashes.json').read_text()).items():need(sha(NATIVE/name)==digest,'NATIVE_PATCH_HASH')
        for name,digest in nm['files'].items():
            if name not in json.loads((ROOT/'patch-hashes.json').read_text()):need(sha(NATIVE/name)==digest,'PARALLEL_NATIVE_CHANGED')
        nm.update(artifact_id=NATIVE.name,source_commit=SOURCE,base_release=base_native.name,base_manifest_sha256=base_manifest,patch_source_commit=SOURCE)
        write(NATIVE/'manifest.json',(json.dumps(nm,ensure_ascii=False,indent=2)+'\n').encode());admission.validate_release(NATIVE)
        for name in json.loads((ROOT/'patch-hashes.json').read_text()):compile((NATIVE/name).read_text(),str(NATIVE/name),'exec')
        report={'source_sha':SOURCE,'platform_candidate':str(PLATFORM),'native_candidate':str(NATIVE),'before_working_directories':before,'base_native_manifest_sha256':base_manifest,'base_platform_manifest_sha256':sha(OLD_PLATFORM/'manifest.json'),'base_admin_manifest_sha256':sha(OLD_ADMIN/'manifest.json'),'platform_manifest_sha256':sha(PLATFORM/'manifest.json'),'native_manifest_sha256':sha(NATIVE/'manifest.json'),'preserved_admin_cookie_seconds':2592000,'cookie_files':sorted(patched),'preserved_staff_views_sha256':VIEWS_HASH,'native_changed_files':sorted(json.loads((ROOT/'patch-hashes.json').read_text())),'selected_services_changed':False,'live_db_changes':False}
        write(ROOT/'COMPOSED.json',(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode());print(json.dumps(report))
if __name__=='__main__':
    try:compose()
    except Exception as error:print(json.dumps({'status':'BLOCKED','error_type':type(error).__name__}));raise SystemExit(1)
