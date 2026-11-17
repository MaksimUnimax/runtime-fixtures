"""Prepare the existing gap-ingest authority role; never activate or migrate."""
from pathlib import Path
from copy import deepcopy
import ast,fcntl,hashlib,importlib.util,json,os,stat

ROOT=Path('/root/alisa-demand-s12-13f01118-prepare-20261117')
PREPARER=ROOT/'prepare_candidates.py'
PREPARER_SHA='e6c98facaee60e92817929e17bd9e950c9c99760dd3158563dad463494a3bd7f'
BASE=Path('/opt/alisa-platform/stage/releases/alisa-economics-r15-authority-cafb743c94672104')
BASE_SHA='8c0c364ebba9292817519cd15db4a4a6b105e5e4ab1b219f5a1faa36e5d10935'
SETTINGS_SHA='e65b8930beb9cc8f955645cdb1108febf1d4a4d3ebd2ce72e72c21891b84de18'
TARGET=BASE.parent/'alisa-demand-authority-13f01118c7402814'
SOURCE_HASHES={"services/platform/src/alisa_platform/query_insights/demand.py":"56a2c8831118f24fb81e2b035941a63babb663c1d60d6ac54de16537bb2c085c","services/platform/src/alisa_platform/query_insights/demand_rules.py":"a50bb2527bd24f7e01c3f1795e5aeff0b26169cfba86fde8da3db192bc89cfc1","services/platform/src/alisa_platform/query_insights/migrations/0002_demand_queue.py":"80fe0eff327e578cdeda714475bb866e8eb45bae01a58147363cd2ec538254fe","services/platform/src/alisa_platform/query_insights/models.py":"b3eec4d8c145dd8a6ae5e91c50d899ea454b4a4cab11f6aba1db5535c1fa8a65","services/platform/src/alisa_platform/query_insights/service.py":"20161d893df98a1a6b0060d6c66d7a26e86f20170c69a462cd2b1045e7c92536","services/platform/src/alisa_platform/query_insights/views.py":"81a829f98aa93c70825887523bc634e87856b78c52f09716504959e9674a7416"}


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def main():
    if os.geteuid()!=0:raise RuntimeError('ROOT_REQUIRED')
    if hashlib.sha256(PREPARER.read_bytes()).hexdigest()!=PREPARER_SHA:
        raise RuntimeError('PREPARER_CHANGED')
    m=load('reviewed_s12_preparer',PREPARER)
    m.need(m.sha(m.PRIMITIVES)==m.PRIMITIVES_SHA,'PRIMITIVES_CHANGED')
    h=load('accepted_s12_primitives',m.PRIMITIVES)
    m.need(not(ROOT/'AUTHORITY_CANDIDATE_INTENT.json').exists(),'REVIEW_PREVIOUS_OUTCOME')
    fd=os.open('/run/lock/alisa-stage-rollout.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd);expected=os.stat('/run/lock/alisa-stage-rollout.lock',follow_symlinks=False)
        m.need(stat.S_ISREG(info.st_mode)and info.st_uid==0 and not info.st_mode&0o022 and
               (info.st_dev,info.st_ino)==(expected.st_dev,expected.st_ino),'ROLLOUT_LOCK_CHANGED')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);h.reserve(64*1024**2,12000)
        before=m.services();m.need(before['alisa-runtime-authority-stage.service']['WorkingDirectory']==
            str(BASE/'services/platform'),'AUTHORITY_BASE_MOVED')
        m.need(m.sha(BASE/'manifest.json')==BASE_SHA,'AUTHORITY_MANIFEST_CHANGED')
        old=h.manifest(BASE);h.exact_tree(BASE,old,['.venv'])
        for name,digest in m.PARENT_BACKEND.items():
            m.need(m.sha(BASE/name)==digest,'AUTHORITY_PARENT_CHANGED')
        m.need(not os.path.lexists(TARGET),'AUTHORITY_CANDIDATE_EXISTS')
        m.record('AUTHORITY_CANDIDATE_INTENT.json',{'source':m.HEAD,'base':str(BASE),
            'base_manifest':BASE_SHA,'target':str(TARGET),'services':before,
            'reason':'actual gap_ingest handler runs in this separate authority process',
            'database_or_service_actions':False})
        payload=ROOT/'authority-selected-source';payload.mkdir(mode=0o700)
        for name,digest in SOURCE_HASHES.items():
            source=ROOT/'selected-source'/name;m.need(m.sha(source)==digest,'AUTHORITY_SOURCE_CHANGED')
            target=payload/name;target.parent.mkdir(parents=True,exist_ok=True)
            h.atomic_copy(target,source,digest);target.chmod(0o444)
        settings=m.PREFIX+'config/settings.py';original=(BASE/settings).read_bytes()
        m.need(hashlib.sha256(original).hexdigest()==SETTINGS_SHA and original.endswith(b'\n')and
               b'QUERY_DEMAND_ENABLED'not in original,'AUTHORITY_SETTINGS_CHANGED')
        target=payload/settings;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(original+m.SETTINGS_SUFFIX);target.chmod(0o444)
        value=deepcopy(old);files=dict(value['files']);sources={n:BASE/n for n in files}
        additions={n:m.sha(payload/n)for n in m.BACKEND};files.update(additions)
        sources.update({n:payload/n for n in additions})
        value.update(artifact_id=TARGET.name,source_sha=m.HEAD,files=files,
            base_release=BASE.name,base_manifest_sha256=BASE_SHA,demand_source_sha=m.HEAD,
            demand_component='authority',acceptance='PREPARED_NOT_INSTALLED')
        value['external_links']={'.venv':str(BASE/'.venv')}
        migration=m.PREFIX+'query_insights/migrations/0002_demand_queue.py'
        value.setdefault('migrations',{})[migration]=additions[migration]
        value.setdefault('schema_compatibility',{})['platform_query_insights']=['0001_initial','0002_demand_queue']
        pool={};private=ROOT/'authority-private-pool';private.mkdir(mode=0o700)
        for name,digest in files.items():
            if digest in pool:continue
            source=sources[name];mode=source.stat().st_mode
            if not mode&0o222 and source.stat().st_uid==0:pool[digest]=source
            else:
                copy=private/digest;h.atomic_copy(copy,source,digest);m.need(copy.stat().st_nlink==1,'POOL_NOT_PRIVATE')
                copy.chmod(0o555 if mode&0o111 else 0o444);pool[digest]=copy
        h.materialize(BASE,TARGET,value,sources,pool)
        for name,digest in files.items():
            path=TARGET/name;wanted=0o555 if sources[name].stat().st_mode&0o111 else 0o444
            if stat.S_IMODE(path.stat().st_mode)!=wanted:
                h.atomic_copy(path,sources[name],digest);m.need(path.stat().st_nlink==1,'MODE_NOT_PRIVATE');path.chmod(wanted)
            m.need(stat.S_IMODE(path.stat().st_mode)==wanted,'MODE_CHANGED')
        (TARGET/'manifest.json').chmod(0o444);h.candidate_manifest(TARGET,BASE)
        for name in m.BACKEND:ast.parse((TARGET/name).read_text(),filename=name)
        m.need(m.sha(BASE/'manifest.json')==BASE_SHA and h.manifest(BASE)==old,'AUTHORITY_BASE_CHANGED')
        m.need(m.services()==before,'SERVICE_GENERATION_CHANGED');h.reserve()
        result={'source':m.HEAD,'status':'AUTHORITY_INACTIVE_CANDIDATE_HASH_VERIFIED',
            'root':str(TARGET),'manifest_sha256':m.sha(TARGET/'manifest.json'),
            'files':len(files),'links':len(value.get('links',{})),
            'services_changed':False,'database_changed':False,'feature_enabled':False,
            'required_migration':'query_insights.0002_demand_queue'}
        m.record('AUTHORITY_CANDIDATE_PREPARED.json',result);print(json.dumps(result))
    finally:os.close(fd)


if __name__=='__main__':main()
