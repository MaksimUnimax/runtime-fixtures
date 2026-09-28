#!/usr/bin/env python3
"""Pinned 62024d19 owner-test deployment; apply requires separate owner authority.

Successor to C's prepared R7 wrapper. This does not deploy main or the monitor,
author registrations, or accept the STORE package. See the paired receipt.
"""
from __future__ import annotations
import datetime as dt, fcntl, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.request import urlopen

CANDIDATE='62024d192a8572c11aafab91653330d1f996699f'
FLOOR='d24838669c54f21dc161dc48a7e71e0e288384c2'
CANDIDATE_REL=Path('/opt/octoport/ops-releases')/CANDIDATE
FLOOR_REL=Path('/opt/octoport/ops-releases')/FLOOR
VERIFY=Path(__file__).with_name('verify_ops_release.py')
API_ENV=Path('/etc/seller-agents-owner-test/api.env')
PORTAL_ENV=Path('/etc/seller-agents-owner-test/portal.env')
DB_CONTAINER='seller-agents-owner-test-postgres'
UNITS=['seller-agents-owner-test-api.service','seller-agents-owner-test-worker.service','seller-agents-owner-test-portal.service']
MONITOR_UNITS=['octoport-telegram-operator.service','octoport-health-notifications.service']
EVID=Path('/root/octoport-control/logs/C/owner-test-deploy-62024d19')
BACKUPS=Path('/root/octoport-control/backups/C/owner-test-predeploy')
AUTH='OWNER_AUTHORIZE_BOUNDED_OWNER_TEST_DEPLOYMENT_62024D19'
NODE='/root/.nvm/versions/node/v24.20.0/bin/node'
TSX='packages/server/db/node_modules/tsx/dist/cli.mjs'
MIGRATE='packages/server/db/src/migrate.ts'

def run(args, *, check=True, input_bytes=None, stdout_file=None, env=None, timeout=120, cwd=None):
    out = subprocess.PIPE
    fh = None
    if stdout_file:
        fd=os.open(str(stdout_file), os.O_CREAT|os.O_TRUNC|os.O_WRONLY, 0o600)
        fh=os.fdopen(fd,'wb'); out=fh
    try:
        p=subprocess.run(args,input=input_bytes,stdout=out,stderr=subprocess.PIPE,env=env,timeout=timeout,cwd=cwd)
    finally:
        if fh: fh.close()
    if check and p.returncode:
        raise RuntimeError(f'COMMAND_FAILED:{p.returncode}')
    return p

def env_value(path: Path, key: str) -> str:
    for raw in path.read_text().splitlines():
        if raw.startswith(key+'='):
            v=raw.split('=',1)[1].strip()
            if len(v)>=2 and v[0]==v[-1] and v[0] in "\"'": v=v[1:-1]
            if not v: raise RuntimeError(key+'_EMPTY')
            return v
    raise RuntimeError(key+'_MISSING')

def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
    return h.hexdigest()

def verify_release(path: Path, expected: str):
    if not path.is_dir(): raise RuntimeError('RELEASE_MISSING:'+expected)
    p=run(['python3',str(VERIFY),str(path)])
    d=json.loads(p.stdout)
    if d.get('status')!='PASS' or d.get('sourceSha')!=expected:
        raise RuntimeError('RELEASE_VERIFY_FAILED:'+expected)
    return d

def database_url() -> str:
    return env_value(API_ENV,'DATABASE_URL')

def db_identity(url: str):
    u=urlparse(url)
    if not u.path or u.path=='/': raise RuntimeError('DB_NAME_MISSING')
    return u.username, u.password, u.path.lstrip('/'), u

def docker_pg(args, *, input_bytes=None, stdout_file=None, timeout=120):
    return run(['docker','exec',*(['-i'] if input_bytes is not None else []),DB_CONTAINER,*args],input_bytes=input_bytes,stdout_file=stdout_file,timeout=timeout)

def docker_psql_scalar(user: str, db: str, sql: str) -> str:
    p=docker_pg(['psql','-X','-v','ON_ERROR_STOP=1','-At','-U',user,'-d',db,'-c',sql])
    return p.stdout.decode().strip()

def http_status(url: str):
    with urlopen(url,timeout=5) as r:
        return r.status, r.read(256).decode('utf-8','replace')

def unit_prop(unit: str, prop: str) -> str:
    p=run(['systemctl','show','-p',prop,'--value',unit])
    return p.stdout.decode().strip()


def stable_exec_identity(value: str) -> str:
    """Drop systemd runtime fields while preserving configured path/argv identity."""
    body=value.strip()
    if body.startswith('{') and body.endswith('}'):
        body=body[1:-1]
    volatile={'start_time','stop_time','pid','code','status'}
    stable=[]
    for raw in body.split(';'):
        part=raw.strip()
        if not part:
            continue
        key=part.split('=',1)[0].strip()
        if key in volatile:
            continue
        stable.append(part)
    return '; '.join(stable)


def monitor_unit_snapshot(unit: str) -> dict:
    return {
        'active': unit_prop(unit,'ActiveState'),
        'sub': unit_prop(unit,'SubState'),
        'exec': stable_exec_identity(unit_prop(unit,'ExecStart')),
        'restarts': unit_prop(unit,'NRestarts'),
    }


def check_migration_prefix(url: str, expected_count: int) -> dict:
    env = os.environ.copy()
    env['DATABASE_URL'] = url
    script = Path(__file__).with_name('check_owner_test_migration_prefix.ts')
    p = run([str(CANDIDATE_REL / '.runtime/node'), str(CANDIDATE_REL / TSX),
             str(script)], env=env, cwd=str(CANDIDATE_REL))
    value = json.loads(p.stdout)
    if value.get('status') != 'PASS_PREFIX' or value.get('applied') != expected_count:
        raise RuntimeError('MIGRATION_PREFIX_COUNT_INVALID')
    return value


def preflight():
    candidate=verify_release(CANDIDATE_REL,CANDIDATE)
    floor=verify_release(FLOOR_REL,FLOOR)
    if not API_ENV.is_file() or not PORTAL_ENV.is_file(): raise RuntimeError('ENV_FILE_MISSING')
    user,password,db,u=db_identity(database_url())
    if not user or not db: raise RuntimeError('DB_IDENTITY_INVALID')
    prefix = check_migration_prefix(database_url(), 22)
    current={unit:{'active':unit_prop(unit,'ActiveState'),'sub':unit_prop(unit,'SubState'),'restarts':unit_prop(unit,'NRestarts'),'workingDirectory':unit_prop(unit,'WorkingDirectory')} for unit in UNITS}
    if any(v['active']!='active' or v['sub']!='running' for v in current.values()): raise RuntimeError('OWNER_TEST_UNIT_NOT_HEALTHY')
    monitor={unit:monitor_unit_snapshot(unit) for unit in MONITOR_UNITS}
    if any(v['active']!='active' or v['sub']!='running' for v in monitor.values()):
        raise RuntimeError('MONITOR_UNIT_NOT_HEALTHY')
    api_port=int(env_value(API_ENV,'API_PORT'))
    live=http_status(f'http://127.0.0.1:{api_port}/health/live')
    ready=http_status(f'http://127.0.0.1:{api_port}/health/ready')
    portal=http_status('http://127.0.0.1:3100/login')
    if live[0] != 200 or ready[0] != 200 or portal[0] != 200:
        raise RuntimeError('OWNER_TEST_HTTP_NOT_HEALTHY')
    db_bytes=int(docker_psql_scalar(user,db,'SELECT pg_database_size(current_database())::bigint'))
    disk=shutil.disk_usage(BACKUPS)
    if disk.free < max(db_bytes*10, 1024**3): raise RuntimeError('INSUFFICIENT_BACKUP_DISK')
    pgdump=docker_pg(['pg_dump','--version']).stdout.decode().strip()
    pgrestore=docker_pg(['pg_restore','--version']).stdout.decode().strip()
    return {'status':'PREFLIGHT_PASS','candidate':candidate,'floor':floor,'prefix':prefix,'units':current,'monitorUnits':monitor,'api':{'live':live[0],'ready':ready[0]},'portalLogin':portal[0],'databaseBytes':db_bytes,'diskFreeBytes':disk.free,'pgDumpVersion':pgdump,'pgRestoreVersion':pgrestore,'mutationPerformed':False}

DROPINS={
 'seller-agents-owner-test-api.service':Path('/etc/systemd/system/seller-agents-owner-test-api.service.d/10-preprod-current-line.conf'),
 'seller-agents-owner-test-worker.service':Path('/etc/systemd/system/seller-agents-owner-test-worker.service.d/10-preprod-current-line.conf'),
 'seller-agents-owner-test-portal.service':Path('/etc/systemd/system/seller-agents-owner-test-portal.service.d/10-preprod-current-line.conf'),
}

def unit_dropin(unit: str, release: Path) -> str:
    node=release/'.runtime/node'
    if unit.endswith('-api.service'):
        wd=release; cmd=f'{node} {release}/apps/api/node_modules/tsx/dist/cli.mjs {release}/apps/api/src/main.ts'
    elif unit.endswith('-worker.service'):
        wd=release; cmd=f'{node} {release}/apps/worker/node_modules/tsx/dist/cli.mjs {release}/apps/worker/src/main.ts'
    else:
        wd=release/'apps/portal'; cmd=f'{node} {release}/apps/portal/node_modules/next/dist/bin/next start -p 3100'
    return f'[Service]\nWorkingDirectory={wd}\nExecStart=\nExecStart={cmd}\n'

def write_dropins(release: Path):
    for unit,path in DROPINS.items():
        path.parent.mkdir(parents=True,exist_ok=True)
        tmp=path.with_suffix('.tmp')
        tmp.write_text(unit_dropin(unit,release)); os.chmod(tmp,0o644); os.replace(tmp,path)
    run(['systemctl','daemon-reload'])

def snapshot_dropins(dest: Path):
    dest.mkdir(parents=True,exist_ok=False); os.chmod(dest,0o700)
    for unit,path in DROPINS.items():
        if not path.is_file(): raise RuntimeError('DROPIN_MISSING:'+unit)
        target=dest/(unit+'.conf'); shutil.copy2(path,target); os.chmod(target,0o600)

def restore_dropins(src: Path):
    for unit,path in DROPINS.items():
        source=src/(unit+'.conf')
        if not source.is_file(): raise RuntimeError('DROPIN_BACKUP_MISSING:'+unit)
        shutil.copy2(source,path); os.chmod(path,0o644)
    run(['systemctl','daemon-reload'])

def stop_product_units():
    # A failed stop must not prevent attempts to quiesce the other product units.
    for unit in reversed(UNITS):
        try:
            run(['systemctl', 'stop', unit], timeout=30)
        except Exception:
            pass  # Actual inactive states below are the authority, not CLI success.
    if any(unit_prop(unit, 'ActiveState') != 'inactive' for unit in UNITS):
        raise RuntimeError('PRODUCT_UNITS_NOT_QUIESCED')


def start_product_units():
    for unit in ['seller-agents-owner-test-api.service','seller-agents-owner-test-worker.service','seller-agents-owner-test-portal.service']:
        run(['systemctl','start',unit],timeout=30)

def wait_runtime(started_at: str):
    end=time.time()+45
    last=None
    while time.time()<end:
        try:
            states=[(unit_prop(u,'ActiveState'),unit_prop(u,'SubState')) for u in UNITS]
            api_port=int(env_value(API_ENV,'API_PORT'))
            live=http_status(f'http://127.0.0.1:{api_port}/health/live')[0]
            ready=http_status(f'http://127.0.0.1:{api_port}/health/ready')[0]
            portal=http_status('http://127.0.0.1:3100/login')[0]
            if all(x==('active','running') for x in states) and live==ready==portal==200:
                j=run(['journalctl','-u','seller-agents-owner-test-worker.service','--since',started_at,'--no-pager','-o','cat'],check=False)
                if b'Worker ready' in j.stdout: return {'live':live,'ready':ready,'portal':portal,'workerReady':True}
            last={'states':states,'live':live,'ready':ready,'portal':portal}
        except Exception as e: last={'error':type(e).__name__}
        time.sleep(1)
    raise RuntimeError('POST_SWITCH_HEALTH_FAILED:'+json.dumps(last,sort_keys=True))

def migration_url(base: str, db: str) -> str:
    u=urlparse(base); return urlunparse((u.scheme,u.netloc,'/'+db,u.params,u.query,u.fragment))

def migrate(release: Path, url: str):
    env=os.environ.copy(); env['DATABASE_URL']=url; env['PATH']='/root/.nvm/versions/node/v24.20.0/bin:'+env.get('PATH','')
    run([str(release/'.runtime/node'),str(release/'packages/server/db/node_modules/tsx/dist/cli.mjs'),str(release/'packages/server/db/src/migrate.ts')],env=env,cwd=str(release),timeout=180)

def backup_live(user: str, db: str, stamp: str) -> Path:
    BACKUPS.mkdir(parents=True,exist_ok=True); os.chmod(BACKUPS,0o700)
    path=BACKUPS/f'owner-test-{stamp}.dump'
    docker_pg(['pg_dump','--format=custom','--no-owner','--no-privileges','--serializable-deferrable','-U',user,'-d',db],stdout_file=path,timeout=180)
    os.chmod(path,0o600)
    docker_pg(['pg_restore','--list'],input_bytes=path.read_bytes(),timeout=60)
    return path

def restore_isolated(user: str, base_url: str, backup: Path, stamp: str) -> dict:
    name='octoport_owner_restore_'+re.sub('[^0-9]','',stamp)
    # Fail if the unique name exists; never pre-delete somebody else's database.
    docker_pg(['createdb','-U',user,'-O',user,name],timeout=30)
    try:
        docker_pg(['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',name],input_bytes=backup.read_bytes(),timeout=180)
        isolated_url = migration_url(base_url, name)
        before = check_migration_prefix(isolated_url, 22)['applied']
        migrate(CANDIDATE_REL,migration_url(base_url,name))
        after = check_migration_prefix(isolated_url, 40)['applied']
        if before!=22 or after!=40: raise RuntimeError(f'ISOLATED_MIGRATION_COUNT:{before}->{after}')
        return {'database':name,'before':before,'after':after}
    finally:
        docker_pg(['dropdb','--if-exists','--force','-U',user,name],timeout=30)

def database_creation_meta(user: str, db: str) -> dict:
    raw=docker_psql_scalar(user,db,"SELECT json_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype)::text FROM pg_database WHERE datname=current_database()")
    value=json.loads(raw)
    if not all(isinstance(value.get(k),str) and value[k] for k in ('encoding','collate','ctype')):
        raise RuntimeError('DATABASE_CREATION_META_INVALID')
    return value

def restore_live_backup(user: str, db: str, backup: Path, meta: dict) -> int:
    docker_pg(['dropdb','--if-exists','--force','-U',user,db],timeout=60)
    docker_pg(['createdb','-U',user,'-O',user,'-T','template0','-E',meta['encoding'],'--lc-collate',meta['collate'],'--lc-ctype',meta['ctype'],db],timeout=60)
    docker_pg(['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',db],input_bytes=backup.read_bytes(),timeout=180)
    restored=int(docker_psql_scalar(user,db,'SELECT count(*) FROM drizzle.__drizzle_migrations'))
    if restored!=22: raise RuntimeError('LIVE_BACKUP_RESTORE_COUNT_INVALID:'+str(restored))
    return restored

@contextmanager
def deployment_guard():
    """One writer; a lost invocation requires explicit C recovery, never replay."""
    EVID.mkdir(parents=True, exist_ok=True)
    os.chmod(EVID, 0o700)
    fd = os.open(EVID / 'apply.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('OWNER_DEPLOY_ALREADY_RUNNING') from None
        journal = EVID / 'deployment-state.json'
        if journal.exists():
            try:
                state = json.loads(journal.read_text())
            except (ValueError, OSError):
                raise RuntimeError('OWNER_DEPLOY_RECOVERY_REQUIRED') from None
            if not isinstance(state, dict) or state.get('recoveryRequired') is not False:
                raise RuntimeError('OWNER_DEPLOY_RECOVERY_REQUIRED')
        yield journal
    finally:
        os.close(fd)


@contextmanager
def recovery_guard():
    """Serialize explicit recovery without treating the durable fence as replayable."""
    EVID.mkdir(parents=True, exist_ok=True)
    os.chmod(EVID, 0o700)
    fd = os.open(EVID / 'apply.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('OWNER_DEPLOY_ALREADY_RUNNING') from None
        journal = EVID / 'deployment-state.json'
        if not journal.is_file():
            raise RuntimeError('OWNER_DEPLOY_RECOVERY_STATE_MISSING')
        try:
            state = json.loads(journal.read_text())
        except (ValueError, OSError):
            raise RuntimeError('OWNER_DEPLOY_RECOVERY_REQUIRED') from None
        if not isinstance(state, dict) or state.get('recoveryRequired') is not True:
            raise RuntimeError('OWNER_DEPLOY_RECOVERY_NOT_REQUIRED')
        yield journal,state
    finally:
        os.close(fd)


def recovery_source_receipt(state: dict) -> tuple[Path,dict]:
    raw=state.get('receipt')
    if not isinstance(raw,str): raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    path=Path(raw)
    try:
        resolved=path.resolve(strict=True)
    except OSError:
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID') from None
    if path.is_symlink() or not resolved.is_relative_to(EVID.resolve()):
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    try:
        value=json.loads(resolved.read_text())
    except (ValueError,OSError):
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID') from None
    if not isinstance(value,dict): raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    return resolved,value


def verify_candidate_dropins():
    for unit,path in DROPINS.items():
        if not path.is_file() or path.is_symlink():
            raise RuntimeError('FORWARD_RECOVERY_DROPIN_INVALID:'+unit)
        if path.read_text()!=unit_dropin(unit,CANDIDATE_REL):
            raise RuntimeError('FORWARD_RECOVERY_DROPIN_MISMATCH:'+unit)


def verify_monitor_preflight(baseline: object) -> dict:
    if not isinstance(baseline,dict) or set(baseline)!=set(MONITOR_UNITS):
        raise RuntimeError('MONITOR_BASELINE_INVALID')
    current={}
    for unit in MONITOR_UNITS:
        expected=baseline.get(unit)
        if not isinstance(expected,dict): raise RuntimeError('MONITOR_BASELINE_INVALID')
        observed=monitor_unit_snapshot(unit)
        if observed['active']!='active' or observed['sub']!='running':
            raise RuntimeError('MONITOR_UNIT_NOT_HEALTHY')
        if expected.get('active')!='active' or expected.get('sub')!='running':
            raise RuntimeError('MONITOR_BASELINE_INVALID')
        if observed['exec']!=stable_exec_identity(str(expected.get('exec',''))):
            raise RuntimeError('MONITOR_UNIT_CHANGED')
        expected_restarts=expected.get('restarts')
        if expected_restarts is not None:
            if observed['restarts']!=str(expected_restarts):
                raise RuntimeError('MONITOR_UNIT_CHANGED')
        elif observed['restarts']!='0':
            raise RuntimeError('MONITOR_RESTART_UNPROVEN')
        current[unit]=observed
    return current


def write_json_durable(path: Path, value: dict):
    """Publish evidence atomically before crossing the database write boundary."""
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def error_code(error: BaseException) -> str:
    # Subprocess/library error text can contain connection details or raw output.
    message = str(error)
    return message if re.fullmatch(r'[A-Z0-9_:>.=-]{1,160}', message) else type(error).__name__


def apply():
    if os.environ.get('OCTOPORT_OWNER_DEPLOY_AUTHORIZATION') != AUTH:
        raise RuntimeError('OWNER_DEPLOY_AUTHORIZATION_REQUIRED')
    with deployment_guard() as journal:
        return apply_locked(journal)


def apply_locked(journal: Path):
    before = preflight()
    base_url = database_url()
    user, password, db, u = db_identity(base_url)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    evidence_dir = EVID / f'apply-{stamp}'
    evidence_dir.mkdir(parents=True, exist_ok=False)
    os.chmod(evidence_dir, 0o700)
    dropin_backup = evidence_dir / 'dropins-before'
    snapshot_dropins(dropin_backup)
    monitor_before = {unit: monitor_unit_snapshot(unit) for unit in MONITOR_UNITS}
    db_meta = database_creation_meta(user, db)
    schema = 'LEGACY_VERIFIED'
    phase = 'PRE'
    recovery_required = True
    result = {'status': 'STARTED', 'stamp': stamp, 'preflight': before,
              'candidate': CANDIDATE, 'floor': FLOOR}

    def record():
        result.update(phase=phase, schemaState=schema, recoveryRequired=recovery_required)
        write_json_durable(evidence_dir / 'receipt.json', result)
        write_json_durable(journal, {
            'candidate': CANDIDATE, 'phase': phase, 'schemaState': schema,
            'recoveryRequired': recovery_required,
            'receipt': str(evidence_dir / 'receipt.json'),
        })

    record()  # A kill after this point fences the next apply before any service stop.
    try:
        stop_product_units()
        phase = 'QUIESCED'
        backup = backup_live(user, db, stamp)
        phase = 'BACKUP_READY'
        result['backup'] = {'path': str(backup), 'sha256': sha256(backup),
                            'bytes': backup.stat().st_size}
        result['isolatedRestore'] = restore_isolated(user, base_url, backup, stamp)
        phase = 'LIVE_MIGRATION'
        schema = 'UNKNOWN'
        record()  # Never infer old-schema compatibility from an exception.
        try:
            migrate(CANDIDATE_REL, base_url)
            live = check_migration_prefix(base_url, 40)
        except Exception:
            phase = 'RESTORING_FRESH_BACKUP'
            result['liveMigrationRecovery'] = 'RESTORE_FRESH_BACKUP'
            record()
            result['restoredMigrationCount'] = restore_live_backup(user, db, backup, db_meta)
            check_migration_prefix(base_url, 22)
            schema = 'LEGACY_VERIFIED'
            raise

        schema = 'FORWARD_VERIFIED'
        phase = 'FORWARD_SCHEMA'
        result['liveMigrationCount'] = live['applied']
        record()
        try:
            write_dropins(CANDIDATE_REL)
            started = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            start_product_units()
            result['candidateHealth'] = wait_runtime(started)
            result['status'] = 'APPLY_PASS'
            phase = 'CANDIDATE_PASS'
        except Exception as candidate_error:
            result['candidateFailure'] = error_code(candidate_error)
            phase = 'APP_ROLLBACK_FLOOR'
            record()
            # Must prove all three are stopped before replacing any application path.
            stop_product_units()
            write_dropins(FLOOR_REL)
            started = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            start_product_units()
            result['floorHealth'] = wait_runtime(started)
            result['status'] = 'APP_ROLLBACK_FLOOR_PASS'
            phase = 'FLOOR_PASS'

        monitor_after = {unit: monitor_unit_snapshot(unit) for unit in MONITOR_UNITS}
        if monitor_after != monitor_before:
            raise RuntimeError('MONITOR_UNIT_CHANGED')
        result['monitorUnchanged'] = True
        recovery_required = False
    except BaseException as error:
        result['status'] = 'FAILED'
        result['error'] = error_code(error)
        if schema == 'LEGACY_VERIFIED':
            try:
                # Includes a partially failed stop; do not change paths under a running app.
                stop_product_units()
                restore_dropins(dropin_backup)
                started = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
                start_product_units()
                result['previousHealth'] = wait_runtime(started)
                result['previousUnitsRestored'] = True
                recovery_required = False
            except BaseException as recovery_error:
                result['recoveryError'] = error_code(recovery_error)
        if recovery_required:
            # An uncertain database or failed compatible recovery is never started blindly.
            try:
                stop_product_units()
                result['productQuiesced'] = True
            except BaseException as stop_error:
                result['quiesceError'] = error_code(stop_error)
        raise
    finally:
        record()
    return result


def recover_forward():
    """Resume only the proven candidate-pass/forward-schema monitor false-positive state."""
    if os.environ.get('OCTOPORT_OWNER_DEPLOY_AUTHORIZATION') != AUTH:
        raise RuntimeError('OWNER_DEPLOY_AUTHORIZATION_REQUIRED')
    with recovery_guard() as guarded:
        journal,state=guarded
        source_path,source=recovery_source_receipt(state)
        if (state.get('candidate')!=CANDIDATE or state.get('schemaState')!='FORWARD_VERIFIED'
                or state.get('phase')!='CANDIDATE_PASS'):
            raise RuntimeError('FORWARD_RECOVERY_STATE_NOT_ELIGIBLE')
        health=source.get('candidateHealth')
        if (source.get('status')!='FAILED' or source.get('error')!='MONITOR_UNIT_CHANGED'
                or source.get('candidate')!=CANDIDATE or source.get('schemaState')!='FORWARD_VERIFIED'
                or source.get('phase')!='CANDIDATE_PASS' or source.get('recoveryRequired') is not True
                or source.get('liveMigrationCount')!=40 or not isinstance(health,dict)
                or health.get('live')!=200 or health.get('ready')!=200
                or health.get('portal')!=200 or health.get('workerReady') is not True):
            raise RuntimeError('FORWARD_RECOVERY_RECEIPT_NOT_ELIGIBLE')
        preflight_data=source.get('preflight')
        if not isinstance(preflight_data,dict): raise RuntimeError('FORWARD_RECOVERY_RECEIPT_NOT_ELIGIBLE')
        verify_release(CANDIDATE_REL,CANDIDATE); verify_release(FLOOR_REL,FLOOR)
        prefix_before=check_migration_prefix(database_url(),40)
        verify_candidate_dropins()
        if any(unit_prop(unit,'ActiveState')!='inactive' for unit in UNITS):
            raise RuntimeError('FORWARD_RECOVERY_PRODUCT_NOT_QUIESCED')
        monitor_before=verify_monitor_preflight(preflight_data.get('monitorUnits'))
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        recovery_path=EVID/f'recovery-{stamp}.json'
        result={'status':'FORWARD_RECOVERY_STARTED','stamp':stamp,'candidate':CANDIDATE,
                'schemaState':'FORWARD_VERIFIED','recoveryRequired':True,
                'sourceReceipt':str(source_path),'prefixBefore':prefix_before,
                'monitorBefore':monitor_before}
        write_json_durable(recovery_path,result)
        write_json_durable(journal,{'candidate':CANDIDATE,'phase':'FORWARD_RECOVERY_START',
            'schemaState':'FORWARD_VERIFIED','recoveryRequired':True,'receipt':str(recovery_path),
            'recoveredFromReceipt':str(source_path)})
        try:
            started=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            start_product_units()
            result['candidateHealth']=wait_runtime(started)
            result['prefixAfter']=check_migration_prefix(database_url(),40)
            result['monitorAfter']=verify_monitor_preflight(preflight_data.get('monitorUnits'))
            result.update(status='FORWARD_RECOVERY_PASS',recoveryRequired=False,monitorUnchanged=True)
            write_json_durable(recovery_path,result)
            write_json_durable(journal,{'candidate':CANDIDATE,'phase':'FORWARD_RECOVERY_PASS',
                'schemaState':'FORWARD_VERIFIED','recoveryRequired':False,'receipt':str(recovery_path),
                'recoveredFromReceipt':str(source_path)})
            return result
        except BaseException as error:
            result.update(status='FAILED',error=error_code(error),recoveryRequired=True)
            try:
                stop_product_units(); result['productQuiesced']=True
            except BaseException as stop_error:
                result['quiesceError']=error_code(stop_error)
            write_json_durable(recovery_path,result)
            write_json_durable(journal,{'candidate':CANDIDATE,'phase':'FORWARD_RECOVERY_FAILED',
                'schemaState':'FORWARD_VERIFIED','recoveryRequired':True,'receipt':str(recovery_path),
                'recoveredFromReceipt':str(source_path)})
            raise


def main():
    EVID.mkdir(parents=True,exist_ok=True); BACKUPS.mkdir(parents=True,exist_ok=True); os.chmod(EVID,0o700); os.chmod(BACKUPS,0o700)
    mode=sys.argv[1] if len(sys.argv)>1 else 'preflight'
    if mode=='preflight': result=preflight()
    elif mode=='apply': result=apply()
    elif mode=='recover-forward': result=recover_forward()
    else: raise RuntimeError('USAGE: preflight|apply|recover-forward')
    print(json.dumps(result,sort_keys=True))
    if mode == 'apply' and result.get('status') != 'APPLY_PASS':
        raise SystemExit(2)
if __name__=='__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'status':'FAILED','error':error_code(e)}),file=sys.stderr); raise SystemExit(1)
