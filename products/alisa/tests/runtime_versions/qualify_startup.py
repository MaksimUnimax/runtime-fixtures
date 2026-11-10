#!/usr/bin/env python3
"""Disposable real-systemd startup qualification. Refuses a running Alice host."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import stat
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[2]
HELPER=ROOT/'infra/runtime_versions_sync.py'

def run(args,**kw):return subprocess.run(list(map(str,args)),check=True,capture_output=True,text=True,timeout=35,**kw)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--disposable-github-runner',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0:raise RuntimeError('Owned root qualification required')
    if subprocess.run(['systemctl','is-active','--quiet','alice-market.service']).returncode==0:
        raise RuntimeError('Refusing qualification on a running Alice host')
    if args.disposable_github_runner:
        if os.environ.get('GITHUB_ACTIONS')!='true'or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted':
            raise RuntimeError('Disposable GitHub-hosted runner required')
        if run(['systemctl','show','alice-market.service','--value','-p','LoadState']).stdout.strip()!='not-found':
            raise RuntimeError('Refusing fixture metadata changes on an installed Alice host')
    ident='alisa-pins-qual-'+secrets.token_hex(6);source=Path('/opt/alice-market/releases')/ident
    private=Path(tempfile.mkdtemp(prefix=ident+'-',dir='/run'));units=[];created=[];lock_created=False;lock_fd=None
    record={'scope':'DISPOSABLE_REAL_SYSTEMD_STARTUP_NO_PROVIDER_OR_OWNER_DATA','status':'RUNNING','checks':[],
            'source_helper_sha256':hashlib.sha256(HELPER.read_bytes()).hexdigest(),'marketplace_or_model_calls':0}
    opt=Path('/opt');opt_info=opt.lstat();opt_adjusted=False
    account=pwd.getpwnam('nobody')
    versions={'runtime_contract_version':'runtime_port_v1','task_schema_version':'runtime_task_v1',
        'task_schema_sha256':'a'*64,'registry_hash':'b'*64,'catalog_bundle_hash':'c'*64,
        'query_language':'fixture-v1','projection':'uid-'+str(account.pw_uid),'port_build':'fixture-port-v1','catalog_release_id':'fixture-catalog'}
    cfg=private/'config.json';pins=private/'versions.json';lock=Path('/run/lock/alisa-stage-rollout.lock')
    def source_version(build='fixture-port-v1'):
        emitted={k:v for k,v in versions.items()if k!='catalog_release_id'};emitted.update(catalog_bundle_hash='d'*64,port_build=build)
        code="import os\nassert os.geteuid()=="+str(account.pw_uid)+"\nassert os.getgroups()==[]\nassert 'CREDENTIALS_DIRECTORY'not in os.environ\nassert not any(k.startswith('ALISA_')for k in os.environ)\ndef current_versions():return "+repr(emitted)+'\n'
        (source/'runtime_port.py').write_text(code);(source/'runtime_port.py').chmod(0o644)
        names=['runtime_port.py','read_surface_data/schema.json','template_catalog.json']
        (source/'manifest.json').write_text(json.dumps({'schema':'alice-read-surface-release/v1','artifact_id':ident,
            'source_commit':'1'*40,'files':{n:hashlib.sha256((source/n).read_bytes()).hexdigest()for n in names}}))
        (source/'manifest.json').chmod(0o644)
    def reset():pins.write_text(json.dumps(versions));pins.chmod(0o640)
    def command(explicit_source=True):return ['/usr/bin/python3','-I','-B',HELPER,*(['--source',source]if explicit_source else[]),'--config',cfg,'--versions',pins]
    def start(label):
        unit=ident+'-'+label;units.append(unit+'.service')
        args=['systemd-run','--wait','--unit',unit,'--property=Type=oneshot','--property=User=nobody','--property=Group=nogroup',
            '--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=NoNewPrivileges=yes',
            '--property=PrivateTmp=yes','--property=WorkingDirectory='+str(source),'--property=CapabilityBoundingSet=',
            '--property=IPAddressDeny=any','--property=RestrictAddressFamilies=AF_UNIX',
            '--property=MemoryMax=128M','--property=MemorySwapMax=0','--property=TasksMax=64',
            '--property=CPUQuota=100%','--property=RuntimeMaxSec=20','--property=TimeoutStartSec=15',
            '--property=TimeoutStopSec=5','--property=KillMode=control-group','--property=OOMPolicy=stop',
            '--setenv=CREDENTIALS_DIRECTORY=synthetic-must-not-reach-computation',
            '--setenv=ALISA_RUNTIME_AUTHORITY_TOKEN=synthetic-not-a-credential',
            '--property=ExecStartPre=-+'+' '.join(map(str,command(False))),'/usr/bin/true']
        run(args)
        lines=run(['journalctl','-u',unit,'--no-pager','-o','cat']).stdout.splitlines()
        events=[]
        for line in lines:
            try:value=json.loads(line)
            except ValueError:continue
            if value.get('event')=='runtime_versions_sync':events.append(value)
        assert events,'Missing startup sync event'
        record.setdefault('startup_events',[]).append({'case':label,**events[-1]})
        print(json.dumps({'case':label,**events[-1]}),flush=True)
        return events[-1]
    try:
        # Hosted CI permits its runner to write /opt. Match the admitted production
        # namespace for this disposable fixture, then restore the exact metadata.
        assert stat.S_ISDIR(opt_info.st_mode)
        record['fixture_opt_before']={'uid':opt_info.st_uid,'gid':opt_info.st_gid,'mode':oct(stat.S_IMODE(opt_info.st_mode))}
        if args.disposable_github_runner:
            opt_adjusted=True;os.chown(opt,0,0);opt.chmod(0o755)
        for p in [Path('/opt/alice-market'),Path('/opt/alice-market/releases')]:
            if not p.exists():p.mkdir(mode=0o755);created.append(p)
        source.mkdir(mode=0o755);(source/'read_surface_data').mkdir(mode=0o755)
        (source/'read_surface_data/schema.json').write_text('{}');(source/'read_surface_data/schema.json').chmod(0o644)
        (source/'template_catalog.json').write_text('{}');(source/'template_catalog.json').chmod(0o644)
        source_version();cfg.write_text(json.dumps({'runtime_port':{'enabled':True,'catalog_release_id':'fixture-catalog'}}));cfg.chmod(0o640);reset()
        try:lock_fd=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);lock_created=True
        except FileExistsError:lock_fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
        info=os.fstat(lock_fd);assert info.st_uid==0 and not info.st_mode&0o022
        fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(lock_fd,fcntl.LOCK_UN)
        event=start('update');assert event['status']=='UPDATED'
        value=json.loads(pins.read_text());assert value=={**versions,'catalog_bundle_hash':'d'*64}
        assert pins.stat().st_mode&0o777==0o640 and pins.stat().st_uid==0
        record['checks'].append('root_prestart_updates_only_hash_under_real_service_hardening')
        record['checks'].append('source_computation_as_nobody_without_supplementary_groups_or_service_environment')
        inode=pins.stat().st_ino;event=start('unchanged');assert event['status']=='UNCHANGED'and pins.stat().st_ino==inode
        record['checks'].append('repeat_start_does_not_rewrite_unchanged_pins')
        reset();before=pins.read_bytes();event=json.loads(run(command()+['--check']).stdout)
        assert event['status']=='UPDATE_REQUIRED'and pins.read_bytes()==before
        record['checks'].append('check_mode_does_not_publish')
        source_version('fixture-port-v2');event=start('incompatible')
        assert event['status']=='BLOCKED'and event['code']=='CONTRACT_CHANGED'and pins.read_bytes()==before
        record['checks'].append('incompatible_release_keeps_pins_and_main_service_start')
        source_version();(source/'runtime_port.py').write_text('corrupted')
        event=start('corrupt');assert event['code']=='SOURCE_MISMATCH'and pins.read_bytes()==before
        record['checks'].append('corrupt_release_not_published_and_main_service_still_starts')
        source_version();fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            event=start('busy');assert event['code']=='ROLLOUT_BUSY'and pins.read_bytes()==before
            record['checks'].append('busy_rollout_lock_does_not_deadlock_service')
            event=json.loads(run(command()+['--lock-fd',str(lock_fd)],pass_fds=[lock_fd]).stdout)
            assert event['status']=='UPDATED';record['checks'].append('installer_inherited_lock_fd_can_publish_before_restart')
        finally:fcntl.flock(lock_fd,fcntl.LOCK_UN)
        record['status']='PASS'
    except Exception as error:
        record.update(status='FAILED',error_type=type(error).__name__)
        raise
    finally:
        cleanup_ok=False
        try:
            for unit in units:
                subprocess.run(['systemctl','stop',unit],capture_output=True)
                subprocess.run(['systemctl','reset-failed',unit],capture_output=True)
            if lock_fd is not None:
                try:
                    if lock_created:
                        fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                        if lock.exists()and lock.stat().st_ino==os.fstat(lock_fd).st_ino:lock.unlink()
                finally:os.close(lock_fd)
            if source.exists():shutil.rmtree(source)
            shutil.rmtree(private)
            for p in reversed(created):
                try:p.rmdir()
                except OSError:pass
            cleanup_ok=True
        except Exception as error:
            record.update(status='FAILED',cleanup_error_type=type(error).__name__)
            raise
        finally:
            try:
                if opt_adjusted:
                    os.chown(opt,opt_info.st_uid,opt_info.st_gid);opt.chmod(stat.S_IMODE(opt_info.st_mode))
                record['fixture_opt_restored']=(opt.stat().st_uid,opt.stat().st_gid,stat.S_IMODE(opt.stat().st_mode))==(opt_info.st_uid,opt_info.st_gid,stat.S_IMODE(opt_info.st_mode))
            except Exception as error:
                record.update(status='FAILED',restore_error_type=type(error).__name__)
                raise
            finally:
                record.update(owned_fixture_cleanup=cleanup_ok,units_started=len(units),checks_run=len(record['checks']))
                args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record));return 0

if __name__=='__main__':raise SystemExit(main())
