"""Install only the qualified web component in a new private release namespace."""
import contextlib,fcntl,hashlib,io,json,math,os,pathlib,shutil,stat,subprocess,sys,tarfile,urllib.parse,urllib.request,zipfile
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;B=P('/opt/alisa-platform/stage');D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108')
SOURCE='5dff6e8883e25ac464d6e8c64e4ab5a7280c70f7';R='alisa-'+SOURCE[:16];TARGET=B/'releases'/R;OUT=D/'install-platform-web.json'
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
record={'scope':'EXACT_CI_WEB_AND_PLATFORM_SOURCE_NO_ACTIVATION_ENV_DB_CORE_IDENTITY_CHANGES','source_sha':SOURCE,'status':'FAILED','cases':[]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def check(name,passed):
    record['cases'].append({'case':name,'passed':bool(passed)})
    if not passed:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def pointers():return {n:(B/n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
def selected(name):return name=='infra/launch.py' or name.startswith(('ui/web/','services/platform/'))
def virtual_target(name,links):
    todo=list(P(name).parts);out=[];expansions=0
    while todo:
        part=todo.pop(0)
        if part=='.':continue
        if part=='..':
            if not out:raise RuntimeError('archive_link_escape')
            out.pop();continue
        out.append(part);key='/'.join(out)
        if key in links:
            out.pop();expansions+=1
            if expansions>100 or P(links[key]).is_absolute():raise RuntimeError('archive_link_cycle_or_absolute')
            todo=list(P(links[key]).parts)+todo
    return '/'.join(out)
def secure_chain(path):
    for p in [*reversed(path.parents),path]:
        s=p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:raise SystemExit('Untrusted directory chain')
def main():
    check('new_root_private_namespace_and_target',D.stat().st_uid==D.stat().st_gid==0 and stat.S_IMODE(D.stat().st_mode)==0o700 and not D.is_symlink() and not TARGET.exists() and not TARGET.is_symlink())
    old=pointers();record['before_pointers']=old
    check('qualified_predecessor',old['web-current']=='alisa-7afaf646b9b35a58' and old['site-current']=='alisa-6098b31384ae23a4')
    for name in ['package-binding.json','artifact-input.private.json']:
        p=D/name;check('private_root_input_'+name,p.is_file() and not p.is_symlink() and p.stat().st_uid==0 and stat.S_IMODE(p.stat().st_mode)==0o600)
    pins=json.loads((D/'package-binding.json').read_text());incoming=json.loads((D/'artifact-input.private.json').read_text())
    check('exact_source_successful_ci_binding',pins['source_sha']==SOURCE and pins['source_tree']=='9afeb3e88268606e1d51bdc842093c9be483a7da' and pins['ci']['platform']==42440668842 and pins['ci']['documentation']==42440668853 and pins['ci']['conclusion']=='success')
    check('bounded_download_size',0<pins['zip_size']<=64*1048576 and 0<pins['tar_size']<=64*1048576)
    check('physical_reserve_before_download',shutil.disk_usage(B).free>=3072*1048576+1048576 and os.statvfs(B).f_favail>=210000)
    available=next(int(l.split()[1]) for l in P('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))
    check('memory_reserve',available>=1536*1024)
    url=urllib.parse.urlsplit(incoming['download_url'])
    check('https_download_without_credentials',url.scheme=='https' and url.hostname.endswith('.oaiusercontent.com') and url.port in {None,443} and not url.username and not url.password)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(incoming['download_url'],timeout=40) as response:raw=response.read(pins['zip_size']+1)
    check('exact_ci_zip',len(raw)==pins['zip_size'] and sha(raw)==pins['zip_sha256'])
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        check('exact_zip_members',len(z.infolist())==2 and set(z.namelist())=={R+'.tar.gz',R+'.tar.gz.sha256'})
        check('bounded_zip_expansion',z.getinfo(R+'.tar.gz').file_size==pins['tar_size'] and z.getinfo(R+'.tar.gz.sha256').file_size<256)
        tarraw=z.read(R+'.tar.gz');check('checksum_sidecar',z.read(R+'.tar.gz.sha256').decode().split()[0]==pins['tar_sha256'])
    del raw
    check('exact_tar',len(tarraw)==pins['tar_size'] and sha(tarraw)==pins['tar_sha256'])
    with tarfile.open(fileobj=io.BytesIO(tarraw),mode='r:gz') as t:
        members=t.getmembers();check('bounded_unique_member_paths',len(members)<=12000 and len({m.name for m in members})==len(members) and all(not P(m.name).is_absolute() and '..' not in P(m.name).parts and m.name.split('/')[0]==R and (m.isdir() or m.isfile() or m.issym()) for m in members))
        manifest_bytes=t.extractfile(R+'/manifest.json').read();manifest=json.loads(manifest_bytes)
        check('exact_manifest',sha(manifest_bytes)==pins['manifest_sha256'] and manifest['source_sha']==SOURCE and manifest['artifact_id']==R and manifest['schema']==1)
        prior=json.loads((B/'web-current/manifest.json').read_text())
        previous=B/'releases'/old['site-current'];old_manifest=json.loads((previous/'manifest.json').read_text())
        check('same_contracts_locks_migrations',all(manifest[k]==prior[k]==old_manifest[k] for k in ['contracts','locks','migrations','schema_compatibility']))
        allowed='services/platform/src/alisa_platform/runtime_adapter/store_check.py'
        backend=lambda m:{n:h for n,h in m['files'].items() if (n.startswith('services/platform/') or n=='infra/launch.py') and n!=allowed}
        check('only_declared_platform_adapter_change',backend(manifest)==backend(old_manifest))
        files={};links={};chosen=[];bytes_needed=0
        for member in members:
            name=str(P(member.name).relative_to(R))
            if member.issym():links[name]=member.linkname
            elif member.isfile() and name!='manifest.json':
                with t.extractfile(member) as f:files[name]=hashlib.file_digest(f,'sha256').hexdigest()
            if selected(name):
                chosen.append(member)
                if member.isfile():bytes_needed+=member.size
        check('complete_archive_payload_before_component_selection',files==manifest['files'] and links==manifest['links'])
        for name,value in links.items():
            resolved=P(virtual_target(name,links))
            check('internal_package_link_'+name,not P(value).is_absolute() and (not selected(name) or resolved.is_relative_to(P('ui/web'))))
        growth=math.ceil(bytes_needed*1.15)+128*1048576
        record.update(web_component_logical_bytes=bytes_needed,maximum_disk_growth_bytes=growth,free_before=shutil.disk_usage(B).free)
        check('physical_component_reserve',record['free_before']>=3072*1048576+growth)
        check('only_fixed_launcher_and_web_selected',any(m.name==R+'/infra/launch.py' for m in chosen) and any(m.name==R+'/ui/web/apps/web/server.js' for m in chosen))
        old_umask=os.umask(0o022)
        try:
            TARGET.mkdir(mode=0o755);t.extractall(B/'releases',members=chosen,filter='data');(TARGET/'manifest.json').write_bytes(manifest_bytes);(TARGET/'manifest.json').chmod(0o644)
            subprocess.run(['/usr/bin/python3','-I','-B','-m','venv',str(TARGET/'.venv')],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'},check=True,capture_output=True,timeout=30)
            previous=B/'releases'/old['site-current'];old_manifest=json.loads((previous/'manifest.json').read_text())
            wheels={n:h for n,h in manifest['files'].items() if n.startswith('wheels/')}
            check('same_exact_offline_locked_wheel_set',wheels=={n:h for n,h in old_manifest['files'].items() if n.startswith('wheels/')} and all(sha((previous/n).read_bytes())==h for n,h in wheels.items()))
            check('same_locked_platform_dependencies',manifest['files']['services/platform/requirements.lock']==old_manifest['files']['services/platform/requirements.lock'])
            subprocess.run([str(TARGET/'.venv/bin/python'),'-I','-B','-m','pip','install','--no-index','--no-cache-dir','--no-compile','--require-hashes','--find-links',str(previous/'wheels'),'-r',str(TARGET/'services/platform/requirements.lock')],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'},cwd=TARGET,check=True,capture_output=True,timeout=45)
            subprocess.run([str(TARGET/'.venv/bin/python'),'-I','-B','-m','pip','check'],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},cwd=TARGET,check=True,capture_output=True,timeout=10)
        finally:os.umask(old_umask)
    extracted_files={};extracted_links={}
    for p in TARGET.rglob('*'):
        name=str(p.relative_to(TARGET))
        if name=='.venv' or name.startswith('.venv/'):continue
        if p.is_symlink():extracted_links[name]=os.readlink(p)
        elif p.is_file() and name!='manifest.json':extracted_files[name]=sha(p.read_bytes())
    check('exact_selected_component',extracted_files=={n:h for n,h in manifest['files'].items() if selected(n)} and extracted_links=={n:v for n,v in manifest['links'].items() if selected(n)})
    check('no_admin_or_identity_component_payload',(TARGET/'.venv/bin/python').is_file() and not (TARGET/'ui/admin').exists() and (TARGET/'services/platform/manage.py').is_file() and not (TARGET/'services/identity').exists())
    check('actual_selected_links_stay_in_web',all((TARGET/n).resolve(strict=True).is_relative_to((TARGET/'ui/web').resolve()) for n in extracted_links))
    check('pointers_unchanged',pointers()==old)
    record['free_after']=shutil.disk_usage(B).free;check('reserve_retained',record['free_after']>=3072*1048576 and os.statvfs(B).f_favail>=200000)
    record['component_files']=len(extracted_files);record['component_links']=len(extracted_links);record['manifest_sha256']=pins['manifest_sha256'];record['status']='PASS'
if __name__=='__main__':
    secure_chain(B/'releases');secure_chain(D)
    if stat.S_IMODE(D.lstat().st_mode)!=0o700:raise SystemExit('Private namespace required')
    if OUT.exists() or OUT.is_symlink():raise SystemExit('Previous outcome retained')
    with contextlib.ExitStack() as stack:
        directory_fd=os.open(D,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);stack.callback(os.close,directory_fd)
        for name in LOCKS:
            f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:main()
        except Exception as error:record['error_type']=type(error).__name__
        finally:
            fd=os.open(OUT.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
            with os.fdopen(fd,'w') as output:output.write(json.dumps(record,indent=2)+'\n')
            print(json.dumps(record))
    sys.exit(0 if record['status']=='PASS' else 1)

