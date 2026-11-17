"""Prepare two inactive S12 releases from the exact CI package and live bases.

No database, environment, selector, service or Station-state writes.
"""
from pathlib import Path
from copy import deepcopy
import ast, fcntl, hashlib, importlib.util, json, os, stat, subprocess, tarfile

ROOT=Path('/root/alisa-demand-s12-13f01118-prepare-20261117')
HEAD='13f01118c7402814ba96cf42e8a75635220fbb45'
ARCHIVE=ROOT/'alisa-13f01118c7402814.tar.gz'
ARCHIVE_SHA='d4f21d7ac1f9b976a22d7e0491f3c401f7203b20e09e1c86e0c9fb07ba5b2298'
PRIMITIVES=Path('/root/alisa-login-catalog-install-20261115/install.py')
PRIMITIVES_SHA='73a13e0d510901aed20b0aace60387720769f184e6b2c5c653b60dcb1b3b7862'
BASES={
    'platform':(Path('/opt/alisa-platform/stage/releases/alisa-coefficient-station-platform-485a2034ac0dc36f'),
                'b489d1f5ee7bea8fc8cd495c516fc05c605bf3eae4dede2bef64c62566111b6c'),
    'admin':(Path('/opt/alisa-platform/stage/releases/alisa-question-catalog-d4eb0ccf798fbb45'),
             'f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579'),
}
PREFIX='services/platform/src/alisa_platform/'
BACKEND={PREFIX+n for n in ('config/settings.py','query_insights/models.py',
    'query_insights/service.py','query_insights/views.py','query_insights/demand.py',
    'query_insights/demand_rules.py','query_insights/migrations/0002_demand_queue.py')}
SETTINGS_SUFFIX=("QUERY_DEMAND_ENABLED = os.environ.get('ALISA_QUERY_DEMAND_ENABLED', '0') == '1'\n"
    "if os.environ.get('ALISA_QUERY_DEMAND_ENABLED', '0') not in {'0','1'} or QUERY_DEMAND_ENABLED and not QUERY_INSIGHTS_ENABLED:\n"
    "    raise ImproperlyConfigured('Demand queue requires the existing query journal')\n").encode()
PARENT_BACKEND={"services/platform/src/alisa_platform/query_insights/models.py":"aaff9f7b28875f2bfcaaf6bf897d3dacb1070f98eef7a93503e81950f0a0366d","services/platform/src/alisa_platform/query_insights/service.py":"61fbc9e51501894cebf3b76991f4619b3e7941bfddd1d1af5247ea6d8892e8d7","services/platform/src/alisa_platform/query_insights/views.py":"4bb909dee420019ac8706aec7c63a69ecdc0eb4d20d4802cc052aff5efe6051c"}


def need(value,code):
    if not value:raise RuntimeError(code)


def sha(path):
    digest=hashlib.sha256()
    with path.open('rb')as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def record(name,value):
    path=ROOT/name
    with path.open('x')as out:
        json.dump(value,out,sort_keys=True,indent=2);out.write('\n');out.flush();os.fsync(out.fileno())


def services():
    units=('alice-market.service','alisa-platform@stage.service','alisa-admin@stage.service',
        'alisa-station.service','alisa-web@stage.service','alisa-runtime-authority-stage.service',
        'alisa-identity@stage.service','alisa-store-check.service','alisa-smtp-sandbox-stage.service')
    result={}
    for unit in units:
        values=dict(line.split('=',1)for line in subprocess.check_output(
            ['systemctl','show',unit,'-p','MainPID','-p','ActiveState','-p','WorkingDirectory'],text=True,timeout=5).splitlines())
        need(values['ActiveState']=='active','SERVICE_NOT_ACTIVE');result[unit]=values
    return result


def main():
    need(os.geteuid()==0,'ROOT_REQUIRED')
    need(not(ROOT/'CANDIDATE_INTENT.json').exists(),'REVIEW_PREVIOUS_OUTCOME')
    need(sha(PRIMITIVES)==PRIMITIVES_SHA and sha(ARCHIVE)==ARCHIVE_SHA,'INPUT_CHANGED')
    spec=importlib.util.spec_from_file_location('accepted_s12_release_primitives',PRIMITIVES)
    h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
    fd=os.open('/run/lock/alisa-stage-rollout.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd);expected=os.stat('/run/lock/alisa-stage-rollout.lock',follow_symlinks=False)
        need(stat.S_ISREG(info.st_mode)and info.st_uid==0 and not info.st_mode&0o022 and
             (info.st_dev,info.st_ino)==(expected.st_dev,expected.st_ino),'ROLLOUT_LOCK_CHANGED')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        h.reserve(350*1024**2,30000);before=services();old={}
        for role,(base,pin)in BASES.items():
            need(sha(base/'manifest.json')==pin,'BASE_MANIFEST_CHANGED')
            old[role]=h.manifest(base);h.exact_tree(base,old[role],['.venv'])
        need(before['alisa-platform@stage.service']['WorkingDirectory']==str(BASES['platform'][0])and
             before['alisa-admin@stage.service']['WorkingDirectory']==str(BASES['admin'][0]),'ROLE_BASE_MOVED')
        for name,digest in PARENT_BACKEND.items():
            need(sha(BASES['platform'][0]/name)==digest,'PARENT_BACKEND_CHANGED')
        targets={'platform':BASES['platform'][0].parent/'alisa-demand-platform-13f01118c7402814',
                 'admin':BASES['admin'][0].parent/'alisa-demand-admin-13f01118c7402814'}
        need(all(not os.path.lexists(p)for p in targets.values()),'TARGET_EXISTS')
        record('CANDIDATE_INTENT.json',{'source':HEAD,'targets':{k:str(v)for k,v in targets.items()},
            'bases':{k:{'root':str(v[0]),'manifest':v[1]}for k,v in BASES.items()},
            'services':before,'database_or_service_actions':False})
        payload=ROOT/'selected-source';need(not payload.exists(),'PAYLOAD_EXISTS');payload.mkdir(mode=0o700)
        with tarfile.open(ARCHIVE)as archive:
            members=archive.getmembers();head='alisa-13f01118c7402814/'
            indexed={m.name[len(head):]:m for m in members if m.name.startswith(head)}
            entry=indexed['manifest.json'];need(entry.isfile()and entry.size<=2*1024**2,'PACKAGE_MANIFEST_BOUND')
            package=json.load(archive.extractfile(entry));need(package['source_sha']==HEAD,'WRONG_SOURCE')
            selected=BACKEND|{n for n in package['files']if n.startswith('ui/admin/')}
            need(BACKEND<=set(package['files']),'BACKEND_MISSING')
            for name in sorted(selected,key=lambda n:indexed[n].offset_data):
                need(h.safe(name)and indexed[name].isfile(),'UNSAFE_PAYLOAD')
                path=payload/name;path.parent.mkdir(parents=True,exist_ok=True);digest=hashlib.sha256()
                with archive.extractfile(indexed[name])as src,path.open('xb')as dst:
                    for block in iter(lambda:src.read(1024*1024),b''):digest.update(block);dst.write(block)
                need(digest.hexdigest()==package['files'][name],'PAYLOAD_HASH_CHANGED')
                path.chmod(0o555 if indexed[name].mode&0o111 else 0o444)
        settings=payload/(PREFIX+'config/settings.py');data=settings.read_bytes()
        need(data.endswith(SETTINGS_SUFFIX),'SETTINGS_DELTA_CHANGED');parent=data[:-len(SETTINGS_SUFFIX)]
        need(hashlib.sha1(b'blob '+str(len(parent)).encode()+b'\0'+parent).hexdigest()==
             '33d7051b4b0a3c2b39c9a5e5343f4495b69f7b86','SETTINGS_PARENT_CHANGED')
        live_settings=BASES['platform'][0]/(PREFIX+'config/settings.py')
        need(sha(live_settings)=='715421db8a44f5d54f9c662622063d62f1f6750c51dcae321633961b69020ddd',
             'R15_SETTINGS_CHANGED')
        original=live_settings.read_bytes();need(original.endswith(b'\n')and b'QUERY_DEMAND_ENABLED'not in original,'SETTINGS_ALREADY_CHANGED')
        settings.chmod(0o600);settings.write_bytes(original+SETTINGS_SUFFIX);settings.chmod(0o444)
        pool={};results={};private_pool=ROOT/'private-readonly-pool';private_pool.mkdir(mode=0o700)
        for role,(base,pin)in BASES.items():
            value=deepcopy(old[role]);files=dict(value['files']);links=dict(value.get('links',{}));sources={n:base/n for n in files}
            if role=='admin':
                files={n:d for n,d in files.items()if not n.startswith('ui/admin/')}
                links={n:d for n,d in links.items()if not n.startswith('ui/admin/')}
                added={n:package['files'][n]for n in selected if n.startswith('ui/admin/')}
                links.update({n:d for n,d in package.get('links',{}).items()if n.startswith('ui/admin/')})
            else:
                added={n:sha(payload/n)for n in BACKEND}
                migration=PREFIX+'query_insights/migrations/0002_demand_queue.py'
                value.setdefault('migrations',{})[migration]=added[migration]
                value.setdefault('schema_compatibility',{})['platform_query_insights']=['0001_initial','0002_demand_queue']
            files.update(added);sources.update({n:payload/n for n in added})
            # Every inode admitted to deduplication is already read-only.
            # Writable old files are privately copied; no chmod touches a base.
            for name,digest in files.items():
                src=sources[name];source_mode=src.stat().st_mode
                cached=pool.get(digest)
                if cached is not None and (not source_mode&0o111 or cached.stat().st_mode&0o111):continue
                if cached is None and not source_mode&0o222 and src.stat().st_uid==0:
                    pool[digest]=src;continue
                copy=private_pool/(digest+('-exec'if source_mode&0o111 else'-read'))
                need(not copy.exists(),'PRIVATE_POOL_COLLISION');h.atomic_copy(copy,src,digest)
                need(copy.stat().st_nlink==1,'PRIVATE_COPY_NOT_OWNED')
                copy.chmod(0o555 if source_mode&0o111 else 0o444);pool[digest]=copy
            target=targets[role]
            value.update(artifact_id=target.name,files=files,links=links,source_sha=HEAD,
                base_release=base.name,base_manifest_sha256=pin,demand_source_sha=HEAD,
                demand_component=role,components=[role],acceptance='PREPARED_NOT_INSTALLED')
            value['external_links']={'.venv':str(base/'.venv')}
            h.materialize(base,target,value,sources,pool)
            for name in files:
                p=target/name;s=p.stat();wanted=0o555 if sources[name].stat().st_mode&0o111 else 0o444
                if stat.S_IMODE(s.st_mode)!=wanted:
                    # Content-only pooling may join two different execute modes.
                    # Replace this candidate's link with a private inode before
                    # correcting its mode; never chmod an old/shared inode.
                    h.atomic_copy(p,sources[name],files[name])
                    need(p.stat().st_nlink==1,'MODE_COPY_NOT_PRIVATE');p.chmod(wanted)
                need(stat.S_IMODE(p.stat().st_mode)==wanted,'FILE_MODE_CHANGED')
            (target/'manifest.json').chmod(0o444)
            h.candidate_manifest(target,base)
            for name in BACKEND if role=='platform'else []:
                ast.parse((target/name).read_text(),filename=name)
            results[role]={'root':str(target),'manifest_sha256':sha(target/'manifest.json'),'files':len(files),'links':len(links)}
        for role,(base,pin)in BASES.items():
            need(sha(base/'manifest.json')==pin and h.manifest(base)==old[role],'BASE_CHANGED')
        need(services()==before,'SERVICE_GENERATION_CHANGED');h.reserve(0,0)
        record('CANDIDATES_PREPARED.json',{'source':HEAD,'status':'TWO_INACTIVE_CANDIDATES_HASH_VERIFIED',
            'candidates':results,'required_migration':'query_insights.0002_demand_queue',
            'feature_enabled':False,'services_changed':False,'database_changed':False,
            'native_station_changed':False,'owner_acceptance':'NOT_RUN'})
        print(json.dumps(results))
    finally:os.close(fd)


if __name__=='__main__':main()
