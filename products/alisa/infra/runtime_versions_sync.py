#!/usr/bin/env python3
"""Publish only compatible catalogue hashes from an admitted local runtime release.

Finite root deployment/startup step. No socket handshake, credentials, API calls,
new worker or access grants. Source imports run as nobody with an empty environment.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import resource
import stat
import subprocess
import sys
import tempfile

FIELDS={'runtime_contract_version','task_schema_version','task_schema_sha256','registry_hash',
        'catalog_bundle_hash','query_language','projection','port_build','catalog_release_id'}
HASHES={'task_schema_sha256','registry_hash','catalog_bundle_hash'}
LOCK=Path('/run/lock/alisa-stage-rollout.lock')
RELEASES=Path('/opt/alice-market/releases')
MAX_FILE=16*1024*1024
MAX_TOTAL=64*1024*1024

class Blocked(Exception):
    def __init__(self,code):self.code=code;super().__init__(code)

def need(condition,code):
    if not condition:raise Blocked(code)

def decode(raw):
    def pairs(items):
        out={}
        for k,v in items:
            need(k not in out,'INVALID_JSON');out[k]=v
        return out
    def bad(_):raise Blocked('INVALID_JSON')
    try:return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad)
    except (ValueError,UnicodeError):raise Blocked('INVALID_JSON')from None

def secure_path(path,owner_uid=0):
    need(path.is_absolute()and '..'not in path.parts,'UNTRUSTED_PATH')
    for parent in [path.parent,*path.parent.parents]:
        s=parent.lstat()
        need(stat.S_ISDIR(s.st_mode)and s.st_uid in {0,owner_uid} and not s.st_mode&0o022,'UNTRUSTED_PATH')

def read_file(path,limit,owner_uid=0):
    secure_path(path,owner_uid)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd)
        need(stat.S_ISREG(s.st_mode)and s.st_uid==owner_uid and s.st_nlink==1
             and not s.st_mode&0o022 and 0<=s.st_size<=limit,'UNTRUSTED_FILE')
        chunks=[];size=0
        while size<=limit:
            b=os.read(fd,min(65536,limit+1-size))
            if not b:break
            chunks.append(b);size+=len(b)
        after=os.fstat(fd)
        need(size==s.st_size and (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'FILE_CHANGED')
        return b''.join(chunks),s
    finally:os.close(fd)

def version_shape(value):
    need(type(value)is dict and set(value)==FIELDS,'VERSION_SCHEMA')
    need(all(type(v)is str and 0<len(v)<=128 for v in value.values()),'VERSION_SCHEMA')
    need(all(re.fullmatch('[a-f0-9]{64}',value[k])for k in HASHES),'VERSION_SCHEMA')
    return value

def validate_release(root,*,releases=RELEASES,owner_uid=0):
    need(root.parent==releases and root.resolve()==root,'UNTRUSTED_RELEASE')
    raw,manifest_info=read_file(root/'manifest.json',2*1024*1024,owner_uid)
    manifest=decode(raw)
    need(type(manifest)is dict and manifest.get('schema')=='alice-read-surface-release/v1'
         and manifest.get('artifact_id')==root.name and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',root.name)
         and re.fullmatch('[a-f0-9]{40}',str(manifest.get('source_commit',''))),'UNTRUSTED_RELEASE')
    files=manifest.get('files');need(type(files)is dict and 1<=len(files)<=1000,'UNTRUSTED_RELEASE')
    total=0;snapshots={'manifest.json':(manifest_info.st_dev,manifest_info.st_ino,manifest_info.st_size,manifest_info.st_mtime_ns,manifest_info.st_ctime_ns)}
    for name,digest in files.items():
        need(type(name)is str and name and not Path(name).is_absolute()and '..'not in Path(name).parts
             and str(Path(name))==name and name!='manifest.json'
             and type(digest)is str and re.fullmatch('[a-f0-9]{64}',digest),'UNTRUSTED_RELEASE')
        raw,s=read_file(root/name,MAX_FILE,owner_uid);total+=len(raw)
        need(total<=MAX_TOTAL and hashlib.sha256(raw).hexdigest()==digest,'SOURCE_MISMATCH')
        snapshots[name]=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    # Cover the entire immutable payload, including present and future data formats.
    # Do not follow symlinks or traverse an unbounded, undeclared directory tree.
    required=set();pending=[root];entries=0
    while pending:
        directory=pending.pop();secure_path(directory/'entry',owner_uid)
        with os.scandir(directory)as children:
            for child in children:
                entries+=1;need(entries<=2000,'SOURCE_MISMATCH')
                info=child.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):pending.append(Path(child.path))
                else:
                    need(stat.S_ISREG(info.st_mode),'SOURCE_MISMATCH')
                    required.add(str(Path(child.path).relative_to(root)))
    need(required==set(files)|{'manifest.json'}and 'runtime_port.py'in files,'SOURCE_MISMATCH')
    return snapshots

def unchanged(root,snapshots):
    for name,expected in snapshots.items():
        s=(root/name).lstat()
        need(stat.S_ISREG(s.st_mode)and (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==expected,'SOURCE_CHANGED')

def limits():
    resource.setrlimit(resource.RLIMIT_CPU,(5,5))
    resource.setrlimit(resource.RLIMIT_FSIZE,(16384,16384))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))

def compute(root):
    account=pwd.getpwnam('nobody');need(account.pw_uid!=0,'COMPUTE_IDENTITY')
    code='import sys,json;sys.path.insert(0,'+repr(str(root))+');from runtime_port import current_versions;print(json.dumps(current_versions()))'
    with tempfile.TemporaryFile()as output,tempfile.TemporaryFile()as error:
        try:
            result=subprocess.run(['/usr/bin/python3','-I','-B','-c',code],cwd=root,
                env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/nonexistent','PYTHONDONTWRITEBYTECODE':'1'},
                user=account.pw_uid,group=account.pw_gid,extra_groups=[],stdin=subprocess.DEVNULL,
                stdout=output,stderr=error,timeout=8,preexec_fn=limits)
        except (subprocess.TimeoutExpired,OSError):raise Blocked('COMPUTE_UNAVAILABLE')from None
        need(result.returncode==0,'COMPUTE_UNAVAILABLE');output.seek(0);raw=output.read(8193)
    need(len(raw)<=8192,'VERSION_SCHEMA');return decode(raw)

@contextmanager
def rollout_lock(lock_fd=None):
    fd=os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW)if lock_fd is None else os.dup(lock_fd)
    try:
        s=os.fstat(fd);expected=LOCK.lstat()
        need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022 and
             (s.st_dev,s.st_ino)==(expected.st_dev,expected.st_ino),'UNTRUSTED_LOCK')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Blocked('ROLLOUT_BUSY')from None
        yield
    finally:os.close(fd)

def publish(root,config_path,versions_path,*,check=False,calculate=compute,releases=RELEASES,owner_uid=0):
    config_raw,_=read_file(config_path,MAX_FILE,owner_uid);config=decode(config_raw)
    need(type(config)is dict,'CONFIG_SCHEMA');port=config.get('runtime_port')
    if port is None or type(port)is dict and port.get('enabled')is False:return {'status':'DISABLED'}
    need(type(port)is dict and port.get('enabled')is True and type(port.get('catalog_release_id'))is str,'CONFIG_SCHEMA')
    raw,info=read_file(versions_path,8192,owner_uid);old=version_shape(decode(raw))
    need(old['catalog_release_id']==port['catalog_release_id'],'CATALOG_BINDING_CHANGED')
    snapshots=validate_release(root,releases=releases,owner_uid=owner_uid)
    new=calculate(root);need(type(new)is dict and set(new)==FIELDS-{'catalog_release_id'},'VERSION_SCHEMA')
    new=version_shape({**new,'catalog_release_id':port['catalog_release_id']})
    changed={k for k in FIELDS if old[k]!=new[k]}
    need(changed<={'catalog_bundle_hash'},'CONTRACT_CHANGED')
    unchanged(root,snapshots)
    need(validate_release(root,releases=releases,owner_uid=owner_uid)==snapshots,'SOURCE_CHANGED')
    need(read_file(config_path,MAX_FILE,owner_uid)[0]==config_raw and read_file(versions_path,8192,owner_uid)[0]==raw,'CONFIG_CHANGED')
    if not changed:return {'status':'UNCHANGED','source_files':len(snapshots)}
    if check:return {'status':'UPDATE_REQUIRED','changed':['catalog_bundle_hash'],'source_files':len(snapshots)}
    # Atomic replacement under the existing rollout lock; no grants/bindings change.
    fd,name=tempfile.mkstemp(prefix='.runtime-versions-',dir=versions_path.parent)
    try:
        with os.fdopen(fd,'wb')as output:
            os.fchmod(output.fileno(),stat.S_IMODE(info.st_mode));os.fchown(output.fileno(),info.st_uid,info.st_gid)
            output.write((json.dumps(new,indent=2)+'\n').encode());output.flush();os.fsync(output.fileno())
        need(read_file(versions_path,8192,owner_uid)[0]==raw,'CONFIG_CHANGED')
        os.replace(name,versions_path)
        folder=os.open(versions_path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(folder)
        finally:os.close(folder)
    finally:
        if os.path.exists(name):os.unlink(name)
    return {'status':'UPDATED','changed':['catalog_bundle_hash'],'source_files':len(snapshots)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=Path.cwd())
    parser.add_argument('--config',type=Path,default=Path('/etc/alice-market/market-runtime.json'))
    parser.add_argument('--versions',type=Path,default=Path('/etc/alisa-platform/stage/runtime-versions.json'))
    parser.add_argument('--check',action='store_true');parser.add_argument('--lock-fd',type=int)
    args=parser.parse_args()
    try:
        need(os.geteuid()==0,'ROOT_REQUIRED')
        if args.lock_fd is not None:need(args.lock_fd>2,'UNTRUSTED_LOCK')
        with rollout_lock(args.lock_fd):result=publish(args.source,args.config,args.versions,check=args.check)
        print(json.dumps({'event':'runtime_versions_sync',**result}));return 0
    except (Blocked,OSError,ValueError,RecursionError)as error:
        print(json.dumps({'event':'runtime_versions_sync','status':'BLOCKED',
                          'code':error.code if isinstance(error,Blocked)else'DEPENDENCY_UNAVAILABLE'}))
        return 1

if __name__=='__main__':raise SystemExit(main())
