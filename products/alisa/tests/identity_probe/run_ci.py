"""Run the candidate comparison on an ephemeral CI runner, never a live host.

Requires sudo on the runner solely for an owned Unix-socket mount and locked
venv. PostgreSQL is an exactly named disposable Docker container with no network.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

PRODUCT=Path(__file__).resolve().parents[2]
OUT=PRODUCT/'dist/identity-probe'
IMAGE='postgres:16.15@sha256:5db6dac2ef5dcff512f4f00a009c3c332b9f2f28f24277175bf3e4a3d02ef83a'

def run(args,env,check=True):
    return subprocess.run(list(map(str,args)),env=env,check=check,text=True,capture_output=True)

def main():
    if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':
        raise RuntimeError('This entrypoint is restricted to an ephemeral CI runner')
    run_id=os.environ['GITHUB_RUN_ID'];attempt=os.environ['GITHUB_RUN_ATTEMPT']
    nonce=hashlib.sha256((run_id+':'+attempt).encode()).hexdigest()[:12]
    root=Path('/var/lib/alisa-platform/testing')/('s02-provider-'+nonce)
    name='alisa-s02-probe-'+nonce
    if root.exists():raise RuntimeError('Existing CI probe outcome; inspect it first')
    root.parent.mkdir(parents=True,exist_ok=True);root.mkdir(mode=0o711)
    (root/'PROBE_ONLY').write_text('ALISA_S02_DISPOSABLE_PROVIDER\n');(root/'PROBE_ONLY').chmod(0o400)
    source=root/'source';source.mkdir(mode=0o700)
    paths=list((PRODUCT/'tests/identity_probe').glob('*.py'))+list((PRODUCT/'tests/identity_probe').glob('requirements.*'))
    identity=PRODUCT/'services/identity/src/octoport_identity'
    paths+=list(identity.glob('__init__.py'))+list((identity/'accounts').glob('*.py'))+list((identity/'accounts/migrations').glob('*.py'))
    hashes={}
    for p in paths:
        if p.is_symlink():raise RuntimeError('Source symlink refused')
        relative=p.relative_to(PRODUCT);dest=source/relative
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(p.read_bytes())
        hashes[str(relative)]=hashlib.sha256(p.read_bytes()).hexdigest()
    OUT.mkdir(parents=True,exist_ok=True)
    env={k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL'}}
    env.update(PIP_CONFIG_FILE='/dev/null',PIP_CACHE_DIR=str(root/'wheel-cache'),PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1')
    proof={'record_type':'AL_S02_CI_DISPOSABLE_ENVIRONMENT','source_sha':os.environ['GITHUB_SHA'],
           'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'source_hashes':hashes,'postgres_image':IMAGE,'docker_network':'none',
           'live_database_or_credentials_access':False,'status':'STARTED','phase':'locked_venv'}
    container_id=None
    try:
        run([sys.executable,'-m','venv',root/'venv'],env)
        run([root/'venv/bin/python','-m','pip','install','--only-binary=:all:','--require-hashes',
             '-r',source/'tests/identity_probe/requirements.lock'],env)
        proof['phase']='networkless_postgresql'
        run(['docker','pull',IMAGE],env)
        proof['postgres_image_digests']=json.loads(run(['docker','image','inspect',IMAGE,'--format','{{json .RepoDigests}}'],env).stdout)
        if not any(d.endswith(IMAGE.split('@')[1]) for d in proof['postgres_image_digests']):
            raise RuntimeError('Disposable image digest mismatch')
        socket=root/'socket';socket.mkdir(mode=0o777);socket.chmod(0o777)
        result=run(['docker','run','--detach','--rm','--name',name,'--label','org.octoport.alisa.scope=s02-provider-probe',
                    '--network','none','--cpus','1','--memory','256m','--memory-swap','256m',
                    '-e','POSTGRES_DB=alisa_s02_probe','-e','POSTGRES_PASSWORD=synthetic-probe-only',
                    '-v',str(socket)+':/var/run/postgresql',IMAGE,
                    '-c',"listen_addresses=",'-c','unix_socket_permissions=0700','-c','shared_buffers=16MB'],env)
        container_id=result.stdout.strip()
        if len(container_id)!=64 or any(c not in '0123456789abcdef' for c in container_id):
            raise RuntimeError('Unexpected disposable container identity')
        network=json.loads(run(['docker','inspect',container_id,'--format','{{json .HostConfig.NetworkMode}}'],env).stdout)
        bindings=json.loads(run(['docker','inspect',container_id,'--format','{{json .HostConfig.PortBindings}}'],env).stdout)
        proof['actual_container_network']=network;proof['actual_host_port_bindings']=bindings
        if network!='none' or bindings:raise RuntimeError('Disposable database network boundary changed')
        ready=False
        for _ in range(60):
            p=run(['docker','exec',container_id,'pg_isready','-h','/var/run/postgresql','-U','postgres','-d','alisa_s02_probe'],env,False)
            if p.returncode==0:ready=True;break
            time.sleep(1)
        if not ready:raise RuntimeError('Disposable database startup timeout')
        for index,mode in enumerate(['baseline','hardened']):
            proof['phase']=mode
            if index:
                run(['docker','exec',container_id,'dropdb','-h','/var/run/postgresql','-U','postgres','alisa_s02_probe'],env)
                run(['docker','exec',container_id,'createdb','-h','/var/run/postgresql','-U','postgres','alisa_s02_probe'],env)
            probe_env={**env,'ALISA_S02_PROBE_SOCKET':str(socket),'ALISA_S02_PROBE_POLICY':'1' if index else '0'}
            output=OUT/(mode+'.json')
            result=run([root/'venv/bin/python',source/'tests/identity_probe/run_probe.py',output],probe_env,False)
            (root/(mode+'.private.log')).write_text(result.stdout+result.stderr);(root/(mode+'.private.log')).chmod(0o600)
            proof[mode+'_exit_code']=result.returncode
            if result.returncode!=0:raise RuntimeError('Candidate probe failed: '+mode)
        hardened=json.loads((OUT/'hardened.json').read_text())
        if hardened['status']!='PROBE_PASSED':raise RuntimeError('Required candidate policies remain unqualified')
        proof['status']='PROVIDER_CORE_QUALIFIED_NOT_S02_ACCEPTANCE'
    except Exception as exc:
        proof['status']='FAILED';proof['error_type']=type(exc).__name__
    finally:
        cleanup=[]
        if container_id:
            p=run(['docker','rm','--force','--volumes',container_id],env,False)
            cleanup.append({'object':'own_disposable_container','removed':p.returncode==0})
        for part in ['venv','wheel-cache','socket']:
            p=root/part
            if p.is_symlink() or not p.resolve().is_relative_to(root):raise RuntimeError('Unsafe CI cleanup path')
            if p.exists():shutil.rmtree(p)
        proof['cleanup']=cleanup
        if any(not item['removed'] for item in cleanup):proof['status']='FAILED_CLEANUP'
        proof['finished_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        (OUT/'environment.json').write_text(json.dumps(proof,indent=2)+'\n')
        print(json.dumps({'status':proof['status'],'phase':proof['phase'],'cleanup':cleanup}))
    return 0 if proof['status']=='PROVIDER_CORE_QUALIFIED_NOT_S02_ACCEPTANCE' else 1

if __name__=='__main__':sys.exit(main())
