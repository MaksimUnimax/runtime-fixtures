"""Finite root-owned development experiment; no live config or cluster access.

Requires input files already staged beneath the fixed owned probe directory.
Never installs packages globally, opens a TCP listener, or reads stage secrets.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys

ROOT = Path(sys.argv[1])
if not re.fullmatch(r'/var/lib/alisa-platform/testing/s02-provider-[0-9a-f]{12}',str(ROOT)):
    raise RuntimeError('Only a named private disposable probe directory is admitted')
PG = Path('/usr/lib/postgresql/16/bin')
RESULT = ROOT/'environment-result.json'
ENV = {k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL'}}
ENV.update(PIP_CONFIG_FILE='/dev/null', PIP_CACHE_DIR=str(ROOT/'wheel-cache'),
           PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1')

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def run(args, env=None):
    return subprocess.run(list(map(str,args)),env=env or ENV,check=True,text=True,
                          stdout=subprocess.PIPE,stderr=subprocess.STDOUT)

def main():
    if os.geteuid()!=0 or ROOT.is_symlink() or ROOT.stat().st_uid!=0:
        raise RuntimeError('Expected root-owned private experiment directory')
    if (ROOT/'PROBE_ONLY').read_text().strip()!='ALISA_S02_DISPOSABLE_PROVIDER':
        raise RuntimeError('Probe marker missing')
    if RESULT.exists() or (ROOT/'pgdata').exists():
        raise RuntimeError('Existing outcome/data: inspect it before another operation')
    proof={'record_type':'AL_S02_DISPOSABLE_ENVIRONMENT','started_at_utc':now(),
           'status':'STARTED','tcp_listener':False,'live_database_access':False,
           'source_hashes':{},'phase':'verify_inputs'}
    for item in json.loads((ROOT/'input-manifest.json').read_text()):
        relative=Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:raise RuntimeError('Unsafe probe input')
        p=ROOT/'source'/relative
        if not p.resolve().is_relative_to(ROOT/'source'):raise RuntimeError('Input escaped probe')
        digest=hashlib.sha256(p.read_bytes()).hexdigest()
        if digest!=item['sha256']:raise RuntimeError('Probe source changed')
        proof['source_hashes'][str(relative)]=digest
    started=False
    try:
        proof['phase']='locked_private_venv'
        run([sys.executable,'-m','venv',ROOT/'venv'])
        run([ROOT/'venv/bin/python','-m','pip','install','--only-binary=:all:',
             '--require-hashes','-r',ROOT/'source/tests/identity_probe/requirements.lock'])
        proof['phase']='separate_unix_socket_postgresql'
        account=pwd.getpwnam('postgres')
        for name in ['pgdata','socket']:
            p=ROOT/name;p.mkdir(mode=0o700);os.chown(p,account.pw_uid,account.pw_gid)
        run(['runuser','-u','postgres','--',PG/'initdb','-D',ROOT/'pgdata',
             '--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject'])
        run(['runuser','-u','postgres','--',PG/'pg_ctl','-D',ROOT/'pgdata',
             '-o',"-c listen_addresses='' -c unix_socket_directories="+str(ROOT/'socket')+
             ' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=16MB',
             '-l',ROOT/'pgdata/postgres.log','-w','start'])
        started=True
        run([PG/'createdb','-h',ROOT/'socket','-U','postgres','alisa_s02_probe'])
        proof['phase']='candidate_probe'
        env={**ENV,'ALISA_S02_PROBE_SOCKET':str(ROOT/'socket')}
        r=subprocess.run([str(ROOT/'venv/bin/python'),str(ROOT/'source/tests/identity_probe/run_probe.py'),str(ROOT/'provider-result.json')],
                         env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (ROOT/'private-run.log').write_text(r.stdout);(ROOT/'private-run.log').chmod(0o600)
        proof['probe_exit_code']=r.returncode
        proof['baseline_exit_code']=r.returncode
        if r.returncode==0:
            proof['phase']='policy_adapter_probe'
            env['ALISA_S02_PROBE_POLICY']='1'
            # Each mode has its own empty logical database inside this disposable
            # cluster; the baseline report remains immutable and is not overwritten.
            run([PG/'dropdb','-h',ROOT/'socket','-U','postgres','alisa_s02_probe'])
            run([PG/'createdb','-h',ROOT/'socket','-U','postgres','alisa_s02_probe'])
            r=subprocess.run([str(ROOT/'venv/bin/python'),str(ROOT/'source/tests/identity_probe/run_probe.py'),str(ROOT/'hardened-result.json')],
                             env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            (ROOT/'private-hardened-run.log').write_text(r.stdout);(ROOT/'private-hardened-run.log').chmod(0o600)
            proof['hardened_exit_code']=r.returncode
        proof['status']='PROBE_COMPLETED' if r.returncode==0 else 'PROBE_FAILED'
    except Exception as exc:
        proof['status']='ENVIRONMENT_FAILED';proof['error_type']=type(exc).__name__
    finally:
        if started:
            try:
                run(['runuser','-u','postgres','--',PG/'pg_ctl','-D',ROOT/'pgdata','-m','fast','-w','stop'])
                proof['cluster_stopped']=True
            except Exception as exc:
                proof['cluster_stopped']=False;proof['cleanup_error_type']=type(exc).__name__
        else:proof['cluster_stopped']=True
        if proof['cluster_stopped']:
            for name in ['pgdata','socket','wheel-cache','venv']:
                p=ROOT/name
                if p.is_symlink() or not p.resolve().is_relative_to(ROOT):raise RuntimeError('Cleanup path escaped owned probe')
                if p.exists():shutil.rmtree(p)
            proof['disposable_cluster_and_cache_removed']=True
        proof['finished_at_utc']=now();RESULT.write_text(json.dumps(proof,indent=2)+'\n');RESULT.chmod(0o600)
        print(json.dumps({'status':proof['status'],'phase':proof['phase'],'cluster_stopped':proof['cluster_stopped']}))
    return 0 if proof['status']=='PROBE_COMPLETED' and proof['cluster_stopped'] else 1

if __name__=='__main__':sys.exit(main())
