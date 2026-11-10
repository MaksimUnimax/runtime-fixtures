"""Coalesce identical immutable dependencies of our own S08 release only."""
import fcntl,hashlib,json,os,shutil,stat
from pathlib import Path
ROOT=Path('/root/alisa-s09-install-d11a9f2a-20261110')
OWN=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
BASE=Path('/opt/alisa-platform/stage/releases/alisa-report-archive-ab21d8fa3a940259')
MANIFESTS={OWN:'b5c200d250155424618aad5230fb3e276cd8e551545c82ad00a22bc20ef143e5',BASE:'8a2919d3e69f6f6e3fe08bf5ae40b676bf0eb28aa82857cc86901ebba2f07f18'}
def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(p):
    h=hashlib.sha256()
    with p.open('rb')as f:
        while data:=f.read(1024*1024):h.update(data)
    return h.hexdigest()
def dependency(name):return name.startswith('wheels/')or name.startswith('ui/')and'/node_modules/'in name
def trusted(p,root):
    need(p.resolve()==p and p.is_relative_to(root),'DEPENDENCY_PATH')
    s=p.lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'DEPENDENCY_PERMISSIONS');return s
def signature(s):return(s.st_size,stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid,s.st_dev)
def main():
    need(os.geteuid()==0,'ROOT_REQUIRED')
    with Path('/run/lock/alisa-stage-rollout.lock').open('r+')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for root,digest in MANIFESTS.items():need(sha(root/'manifest.json')==digest,'RELEASE_CHANGED')
        own=json.loads((OWN/'manifest.json').read_text());base=json.loads((BASE/'manifest.json').read_text())
        need(own['locks']==base['locks'],'DEPENDENCIES_CHANGED')
        canonical={}
        for name,digest in base['files'].items():
            if not dependency(name):continue
            p=BASE/name;s=trusted(p,BASE);canonical.setdefault((digest,*signature(s)),p)
        targets=[]
        for name,digest in own['files'].items():
            if not dependency(name):continue
            p=OWN/name;s=trusted(p,OWN);source=canonical.get((digest,*signature(s)))
            if source is not None and s.st_nlink==1 and s.st_ino!=source.stat().st_ino:
                targets.append((s.st_blocks*512,p,source,digest,s.st_ino))
        before=shutil.disk_usage('/opt').free;linked=[]
        for size,target,source,digest,inode in sorted(targets,key=lambda row:row[0],reverse=True):
            if shutil.disk_usage('/opt').free>=3*1024**3+432*1024**2:break
            a=trusted(target,OWN);b=trusted(source,BASE)
            need(a.st_ino==inode and a.st_nlink==1 and signature(a)==signature(b),'DEPENDENCY_CHANGED')
            need(sha(target)==digest and sha(source)==digest,'DEPENDENCY_HASH')
            # All destination names remain present. Identical root-owned bytes,
            # ownership and modes are retained; no private or mutable data enters.
            tmp=target.with_name(target.name+'.s09-dep-link');need(not os.path.lexists(tmp),'TEMP_PATH_EXISTS')
            os.link(source,tmp)
            try:
                need(target.lstat().st_ino==inode,'TARGET_MOVED');os.replace(tmp,target)
            finally:
                if os.path.lexists(tmp):tmp.unlink()
            need(sha(target)==digest,'LINK_HASH');linked.append(str(target.relative_to(OWN)))
        for name,digest in own['files'].items():need(sha(OWN/name)==digest,'OWN_RELEASE_HASH')
        for root,digest in MANIFESTS.items():need(sha(root/'manifest.json')==digest,'MANIFEST_CHANGED')
        report={'status':'OWN_IMMUTABLE_DEPENDENCIES_SHARED','own_release':OWN.name,'canonical_rollback':BASE.name,
            'target_count':len(linked),'free_before':before,'free_after':shutil.disk_usage('/opt').free,
            'all_own_file_hashes_unchanged':True,'manifest_hashes_unchanged':True,'release_paths_removed':0,
            'database_changes':False,'services_restarted':False}
        (ROOT/'OWN_DEPENDENCIES_SHARED.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'status':'BLOCKED','error_type':type(e).__name__}));raise SystemExit(1)
