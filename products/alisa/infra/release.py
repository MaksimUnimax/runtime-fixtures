"""Install immutable bytes and switch only Alisa's own stage services.

Production release authorization is deliberately absent at AL-S00.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def command(*args):subprocess.run([str(x) for x in args],check=True)
def valid_id(value):
    if not re.fullmatch(r'alisa-[0-9a-f]{16}',value):raise RuntimeError('Invalid release ID')
    return value

def private_config(env,name):
    p=Path('/etc/alisa-platform')/env/(name+'.env')
    if p.stat().st_mode & 0o007:raise RuntimeError('World-accessible configuration')
    result={}
    for line in p.read_text().splitlines():
        if line and not line.startswith('#'):
            key,sep,value=line.partition('=')
            if not sep:raise RuntimeError('Invalid configuration')
            result[key]=value
    if result.get('ALISA_ENV')!=env:raise RuntimeError('Wrong environment')
    return result

def readback(env):
    result={}
    for component,port in [('web',18100),('admin',18101),('platform',18102),('identity',18103)]:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=5) as r: data=json.load(r)
        if data.get('environment')!=env or data.get('component')!=component:raise RuntimeError('Wrong process/environment')
        result[component]=data
    return result

def switch(env,release):
    base=Path('/opt/alisa-platform')/env
    target=base/'releases'/valid_id(release)
    if not (target/'manifest.json').is_file():raise RuntimeError('Unknown release')
    if not (target/'.venv/bin/python').exists():raise RuntimeError('Incomplete installation')
    old=(base/'current').resolve() if (base/'current').exists() else None
    # Never touch a production/foreign unit or change PostgreSQL data here.
    tmp=base/('.current-'+str(uuid.uuid4()))
    tmp.symlink_to(target);os.replace(tmp,base/'current')
    components=['platform','identity','web','admin']
    if private_config(env,'platform').get('FOUNDATION_PROBE_ENABLED')=='1':components.append('worker')
    try:
        command('systemctl','restart',*[f'alisa-{c}@{env}.service' for c in components])
        last=None
        for _ in range(30):
            try:
                actual=readback(env)
                if any(x['release']!=release for x in actual.values()):raise RuntimeError('Version readback mismatch')
                return actual
            except (OSError,RuntimeError) as exc:last=exc;time.sleep(1)
        raise RuntimeError('Readiness failed') from last
    except Exception:
        # Restore the code pointer only; no database restore or migration down.
        if old:
            tmp.symlink_to(old);os.replace(tmp,base/'current')
            command('systemctl','restart',*[f'alisa-{c}@{env}.service' for c in components])
        raise

def install(env,artifact,expected):
    artifact=Path(artifact)
    if not re.fullmatch(r'[0-9a-f]{64}',expected) or digest(artifact)!=expected:raise RuntimeError('Artifact checksum mismatch')
    base=Path('/opt/alisa-platform')/env/'releases'
    if not base.is_dir():raise RuntimeError('ENV-00 must provision release namespace first')
    with tempfile.TemporaryDirectory(prefix='.install-',dir=base) as temp:
        temp=Path(temp)
        with tarfile.open(artifact,'r:gz') as archive:
            members=archive.getmembers()
            roots={m.name.split('/')[0] for m in members}
            if len(roots)!=1:raise RuntimeError('Invalid archive layout')
            release=valid_id(next(iter(roots)))
            # Python's data filter rejects escaping links, absolute paths and devices.
            archive.extractall(temp,filter='data')
        root=temp/release
        m=json.loads((root/'manifest.json').read_text())
        if m.get('artifact_id')!=release:raise RuntimeError('Manifest mismatch')
        for name,checksum in m['files'].items():
            p=(root/name).resolve()
            if not p.is_relative_to(root.resolve()) or digest(p)!=checksum:raise RuntimeError('Manifest file checksum mismatch')
        if base.joinpath(release).exists():raise RuntimeError('Immutable release already installed')
        command(sys.executable,'-m','venv',root/'.venv')
        command(root/'.venv/bin/python','-m','pip','install','--no-index','--find-links',root/'wheels','--require-hashes','-r',root/'services/platform/requirements.lock')
        # venv shebangs embed an absolute path. Recreate at its final path before use.
        shutil.rmtree(root/'.venv')
        os.replace(root,base/release)
        command(sys.executable,'-m','venv',base/release/'.venv')
        command(base/release/'.venv/bin/python','-m','pip','install','--no-index','--find-links',base/release/'wheels','--require-hashes','-r',base/release/'services/platform/requirements.lock')
        return release

def verify(env):
    cfg=private_config(env,'web')
    origin=cfg['ALISA_WEB_ORIGIN']
    if not origin.startswith('https://'):raise RuntimeError('TLS origin required')
    auth='Basic '+cfg['ALISA_ENGINEERING_AUTH']
    probe_id=str(uuid.uuid4())
    payload=json.dumps({'probe_id':probe_id,'kind':'foundation-v1'}).encode()
    def fetch(path,body=None):
        req=urllib.request.Request(origin+path,data=body,headers={'Authorization':auth,'Origin':origin,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=8) as r:return json.load(r)
    first=fetch('/api/engineering/probes',payload)
    for _ in range(40):
        data=fetch('/api/engineering/probes/'+probe_id)
        if data.get('state')=='PROCESSED':break
        time.sleep(.25)
    else:raise RuntimeError('Probe not processed')
    again=fetch('/api/engineering/probes',payload)
    if data['probe_id']!=probe_id or again['effect_count']!=1 or first['correlation_id']!=data['correlation_id']:raise RuntimeError('Probe invariants failed')
    return {'scope':'HTTP_ROUNDTRIP_ONLY_BROWSER_NOT_INCLUDED','probe_id':probe_id,'correlation_id':data['correlation_id'],'readback':readback(env)}

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['deploy','rollback','verify','evidence']);p.add_argument('--env',choices=['stage','prod'],required=True)
    p.add_argument('--artifact');p.add_argument('--sha256');p.add_argument('--release');p.add_argument('--scope');p.add_argument('--step');a=p.parse_args()
    if a.env!='stage':raise RuntimeError('Production authorization is outside AL-S00')
    if a.action=='deploy':
        release=install(a.env,a.artifact,a.sha256)
        print(json.dumps({'installed_release':release,'state':'INSTALLED_NOT_ACTIVATED','next':'migrate --plan, migrate --apply, then rollback --release to activate'}))
    elif a.action=='rollback':print(json.dumps(switch(a.env,a.release)))
    elif a.action=='verify':print(json.dumps(verify(a.env)))
    else:
        current=Path('/opt/alisa-platform')/a.env/'current'
        m=json.loads((current/'manifest.json').read_text())
        print(json.dumps({'step':'AL-S00','source_sha':m['source_sha'],'artifact_id':m['artifact_id'],'environment':a.env,'processes':readback(a.env),'acceptance':'NOT_ACCEPTED','remaining':['Independent 18-case acceptance receipt required']}))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('RELEASE_FAILED: '+(str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__),file=sys.stderr);sys.exit(1)
