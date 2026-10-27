#!/usr/bin/env python3
"""Pinned 62024d19 owner-test deployment; apply requires separate owner authority.

Successor to C's prepared R7 wrapper. This does not deploy main or the monitor,
author registrations, or accept the STORE package. See the paired receipt.
"""
from __future__ import annotations
import argparse, datetime as dt, fcntl, hashlib, json, os, re, shlex, shutil, stat, subprocess, sys, tempfile, time
from contextlib import ExitStack, contextmanager
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.request import urlopen

from four_root_owner_test_units import contracts as four_unit_contracts
from owner_test_nonroot_hardening import canonical_identities
from owner_test_service_permissions import parse_environment_files
from verify_owner_test_release import verify_owner_test_release

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
CGROUP_ROOT=Path('/sys/fs/cgroup')
AUTH='OWNER_AUTHORIZE_BOUNDED_OWNER_TEST_DEPLOYMENT_62024D19'
FORWARD_RECOVERY_SOURCE_RECEIPT=Path('apply-20260928T111855095131Z')/'receipt.json'
FORWARD_RECOVERY_SOURCE_RECEIPT_SHA256='619e0c6f86b2a4128e7f5ab2f9e8db8c9a6115acb12d5904e02137bc7db7222c'
NODE='/root/.nvm/versions/node/v24.20.0/bin/node'
TSX='packages/server/db/node_modules/tsx/dist/cli.mjs'
MIGRATE='packages/server/db/src/migrate.ts'

MIGRATION_JOURNAL=Path('packages/server/db/drizzle/meta/_journal.json')

def migration_target_from_verified_release(release: Path) -> dict:
    path=release/MIGRATION_JOURNAL
    if not path.is_file() or path.is_symlink():
        raise RuntimeError('MIGRATION_JOURNAL_INVALID')
    try:
        value=json.loads(path.read_text(encoding='utf-8'))
    except (OSError,UnicodeError,ValueError):
        raise RuntimeError('MIGRATION_JOURNAL_INVALID') from None
    entries=value.get('entries') if isinstance(value,dict) else None
    if not isinstance(entries,list) or not entries:
        raise RuntimeError('MIGRATION_JOURNAL_INVALID')
    tags=set()
    for expected,item in enumerate(entries):
        if not isinstance(item,dict):
            raise RuntimeError('MIGRATION_JOURNAL_INVALID')
        idx=item.get('idx'); tag=item.get('tag')
        if type(idx) is not int or idx!=expected or not isinstance(tag,str) or not tag.strip():
            raise RuntimeError('MIGRATION_JOURNAL_INVALID')
        if tag in tags:
            raise RuntimeError('MIGRATION_JOURNAL_INVALID')
        tags.add(tag)
    return {'count':len(entries),'latestIndex':len(entries)-1,'latestTag':entries[-1]['tag']}

def four_service_source_plan(release: Path) -> dict:
    raw=str(release)
    identities=canonical_identities()
    result={}
    for role,contract in four_unit_contracts(raw).items():
        if contract.dynamic_user:
            identity={'mode':'DYNAMIC_USER'}
        else:
            item=identities.get(role)
            if item is None:
                raise RuntimeError('FOUR_SERVICE_IDENTITY_MISSING:'+role)
            identity={'mode':'STATIC_CANONICAL','user':item['user'],'group':item['group']}
        result[role]={
            'unit':'seller-agents-owner-test-'+role+'.service',
            'workingDirectory':contract.working_directory,
            'execArgv':list(contract.exec_argv),
            'environmentFiles':[str(path) for path in contract.environment_files],
            'identity':identity,
        }
    if set(result)!={'api','worker','portal','admin'}:
        raise RuntimeError('FOUR_SERVICE_SET_INVALID')
    return {
        'status':'SOURCE_PLAN_PASS',
        'release':raw,
        'services':result,
        'migrationTarget':migration_target_from_verified_release(release),
        'liveMutationPerformed':False,
    }

def verified_current_source_plan(
    release: Path,
    *,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
) -> dict:
    verified = verify_owner_test_release(
        release,
        expected_source_sha=expected_source_sha,
        expected_source_tree=expected_source_tree,
        expected_inventory_sha256=expected_inventory_sha256,
    )
    plan = four_service_source_plan(release)
    if verified.get("status") != "PASS_SOURCE_PACKAGE_ONLY":
        raise RuntimeError("CURRENT_PACKAGE_VERIFICATION_INVALID")
    if verified.get("sourceSha") != expected_source_sha or verified.get("sourceTree") != expected_source_tree:
        raise RuntimeError("CURRENT_PACKAGE_IDENTITY_MISMATCH")
    if set(verified.get("services", [])) != set(plan["services"]):
        raise RuntimeError("CURRENT_PACKAGE_SERVICE_SET_MISMATCH")
    return {
        "status": "CURRENT_FOUR_SERVICE_SOURCE_PLAN_PASS",
        "sourceSha": expected_source_sha,
        "sourceTree": expected_source_tree,
        "trustedInventorySha256": expected_inventory_sha256,
        "services": plan["services"],
        "migrationTarget": plan["migrationTarget"],
        "adminBuildBasePath": verified.get("adminBuildBasePath"),
        "liveMutationPerformed": False,
        "databaseReadPerformed": False,
        "secretMaterialRead": False,
    }


CURRENT_DROPIN_ROOT=Path('/etc/systemd/system')
CURRENT_FENCE_NAME='00-octoport-current-recovery-fence.conf'
CURRENT_FENCE_ALLOW=Path('/run/octoport-owner-test-current-apply-allow')
CURRENT_AUTHORITY_FILE=Path('/root/octoport-control/authorizations/B05-current-four-service-deploy.json')
CURRENT_EVIDENCE_ROOT=Path('/root/octoport-control/logs/B/current-four-service-deploy')

def current_trusted_evidence_root(*, create: bool) -> Path:
    root=CURRENT_EVIDENCE_ROOT
    trusted_parent=Path('/root/octoport-control/logs/B')
    if root.parent!=trusted_parent or not root.is_absolute():
        raise RuntimeError('CURRENT_EVIDENCE_ROOT_INVALID')
    _assert_no_symlink_ancestors(trusted_parent)
    if not trusted_parent.is_dir() or trusted_parent.is_symlink():
        raise RuntimeError('CURRENT_EVIDENCE_ROOT_INVALID')
    if create and not root.exists():
        root.mkdir(mode=0o700)
        directory=os.open(trusted_parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    _assert_no_symlink_ancestors(root)
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError('CURRENT_EVIDENCE_ROOT_INVALID')
    metadata=root.stat()
    if metadata.st_uid!=0 or metadata.st_gid!=0 or stat.S_IMODE(metadata.st_mode)!=0o700:
        raise RuntimeError('CURRENT_EVIDENCE_ROOT_INVALID')
    return root

def current_require_cli_authority(
    mode: str,
    *,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
) -> dict:
    if mode not in ('apply','recover'):
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_MODE_INVALID')
    path=CURRENT_AUTHORITY_FILE
    _assert_no_symlink_ancestors(path)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_REQUIRED')
    metadata=path.stat()
    if metadata.st_uid!=0 or stat.S_IMODE(metadata.st_mode)!=0o600:
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_INVALID')
    try:
        value=json.loads(path.read_text(encoding='utf-8'))
    except (OSError,UnicodeError,ValueError):
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_INVALID') from None
    required={
        'status','scope','authorizationId','allowedModes',
        'sourceSha','sourceTree','trustedInventorySha256',
    }
    if not isinstance(value,dict) or set(value)!=required:
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_INVALID')
    if (
        value.get('status')!='AUTHORIZED'
        or value.get('scope')!='B05_CURRENT_FOUR_SERVICE_DEPLOY'
        or not isinstance(value.get('authorizationId'),str)
        or not value['authorizationId'].strip()
        or not isinstance(value.get('allowedModes'),list)
        or set(value['allowedModes'])-{'apply','recover'}
        or mode not in value['allowedModes']
        or value.get('sourceSha')!=expected_source_sha
        or value.get('sourceTree')!=expected_source_tree
        or value.get('trustedInventorySha256')!=expected_inventory_sha256
    ):
        raise RuntimeError('CURRENT_DEPLOY_AUTHORIZATION_INVALID')
    return {'authorizationId':value['authorizationId'],'mode':mode}


def _assert_no_symlink_ancestors(path: Path) -> None:
    absolute=path if path.is_absolute() else path.absolute()
    parts=absolute.parts
    current=Path(parts[0])
    for part in parts[1:]:
        current=current/part
        if os.path.lexists(current) and current.is_symlink():
            raise RuntimeError('CURRENT_PATH_SYMLINK_FORBIDDEN:'+str(current))

def _contained_child(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return path!=root
    except ValueError:
        return False

def current_validate_evidence_paths(
    evidence_root: Path, journal: Path, evidence_dir: Path
) -> None:
    if not evidence_root.is_absolute() or not journal.is_absolute() or not evidence_dir.is_absolute():
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    if not evidence_root.is_dir() or evidence_root.is_symlink() or not evidence_dir.is_dir() or evidence_dir.is_symlink():
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    if not _contained_child(evidence_root,journal) or not _contained_child(evidence_root,evidence_dir):
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    if journal.parent!=evidence_root or evidence_dir.parent!=evidence_root:
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    if journal.name!='deployment-state.json' or not evidence_dir.name.startswith('apply-'):
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    _assert_no_symlink_ancestors(evidence_root)
    _assert_no_symlink_ancestors(journal)
    _assert_no_symlink_ancestors(evidence_dir)

def current_fence_paths(plan: dict) -> dict[str,Path]:
    return {
        role: CURRENT_DROPIN_ROOT/(str(item['unit'])+'.d')/CURRENT_FENCE_NAME
        for role,item in plan['services'].items()
    }

def current_install_reboot_fence(plan: dict, *, allow_existing: bool=False) -> None:
    if os.path.lexists(CURRENT_FENCE_ALLOW):
        raise RuntimeError('CURRENT_FENCE_ALLOW_UNEXPECTED')
    text='[Unit]\nConditionPathExists='+str(CURRENT_FENCE_ALLOW)+'\n'
    for role,path in current_fence_paths(plan).items():
        _assert_no_symlink_ancestors(path.parent)
        path.parent.mkdir(parents=True,exist_ok=True)
        _assert_no_symlink_ancestors(path.parent)
        if os.path.lexists(path):
            if (
                allow_existing and path.is_file() and not path.is_symlink()
                and path.read_text()==text
            ):
                continue
            raise RuntimeError('CURRENT_RECOVERY_FENCE_CONFLICT:'+role)
        fd,tmp=tempfile.mkstemp(prefix='.'+CURRENT_FENCE_NAME+'.',dir=path.parent)
        try:
            with os.fdopen(fd,'w') as output:
                output.write(text);output.flush();os.fsync(output.fileno())
            os.chmod(tmp,0o644);os.replace(tmp,path)
            directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(directory)
            finally:os.close(directory)
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
    run(['systemctl','daemon-reload'])

def current_enable_fenced_start() -> None:
    _assert_no_symlink_ancestors(CURRENT_FENCE_ALLOW.parent)
    if os.path.lexists(CURRENT_FENCE_ALLOW):
        raise RuntimeError('CURRENT_FENCE_ALLOW_UNEXPECTED')
    fd=os.open(CURRENT_FENCE_ALLOW,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        os.write(fd,b'current-boot-only\n');os.fsync(fd)
    finally:os.close(fd)

def current_disable_fenced_start() -> None:
    if os.path.lexists(CURRENT_FENCE_ALLOW) and CURRENT_FENCE_ALLOW.is_symlink():
        raise RuntimeError('CURRENT_FENCE_ALLOW_SYMLINK')
    CURRENT_FENCE_ALLOW.unlink(missing_ok=True)

def current_prepare_recovery_fence(plan: dict) -> None:
    # A process may die after creating the ephemeral allow file. Recovery must
    # remove that boot-local allowance first, then accept/reinstall the durable
    # persistent fence in the same invocation.
    current_disable_fenced_start()
    current_install_reboot_fence(plan,allow_existing=True)

def current_remove_reboot_fence(plan: dict) -> None:
    for role,path in current_fence_paths(plan).items():
        _assert_no_symlink_ancestors(path.parent)
        if os.path.lexists(path):
            if path.is_symlink() or not path.is_file():
                raise RuntimeError('CURRENT_RECOVERY_FENCE_CONFLICT:'+role)
            path.unlink()
            directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(directory)
            finally:os.close(directory)
    run(['systemctl','daemon-reload'])
    current_disable_fenced_start()

def current_units(plan: dict) -> tuple[str, ...]:
    services=plan.get('services')
    if not isinstance(services,dict) or tuple(services)!=('api','worker','portal','admin'):
        raise RuntimeError('CURRENT_SERVICE_PLAN_INVALID')
    units=tuple(str(services[role].get('unit','')) for role in services)
    if units!=tuple(f'seller-agents-owner-test-{role}.service' for role in services):
        raise RuntimeError('CURRENT_SERVICE_PLAN_INVALID')
    return units

def current_dropin_paths(plan: dict) -> dict[str,Path]:
    return {
        role: CURRENT_DROPIN_ROOT/(str(item['unit'])+'.d')/'10-preprod-current-line.conf'
        for role,item in plan['services'].items()
    }

def current_unit_dropin(plan: dict, role: str) -> str:
    try:
        item=plan['services'][role]
        working=str(item['workingDirectory'])
        argv=item['execArgv']
    except (KeyError,TypeError):
        raise RuntimeError('CURRENT_SERVICE_PLAN_INVALID') from None
    if not isinstance(argv,list) or not argv or any(not isinstance(v,str) or not v for v in argv):
        raise RuntimeError('CURRENT_SERVICE_PLAN_INVALID')
    # The authoritative four-root plan already validates every argument as a
    # pinned compiled entry. Drop-ins only switch release identity/argv.
    return '[Service]\nWorkingDirectory='+working+'\nExecStart=\nExecStart='+' '.join(argv)+'\n'

def current_write_dropins(plan: dict) -> None:
    paths=current_dropin_paths(plan)
    for role,path in paths.items():
        _assert_no_symlink_ancestors(path.parent)
        path.parent.mkdir(parents=True,exist_ok=True)
        _assert_no_symlink_ancestors(path.parent)
        tmp=path.with_suffix('.tmp')
        tmp.write_text(current_unit_dropin(plan,role))
        os.chmod(tmp,0o644)
        os.replace(tmp,path)
    run(['systemctl','daemon-reload'])


def current_snapshot_dropins(plan: dict, dest: Path) -> dict:
    dest.mkdir(parents=True,exist_ok=False)
    os.chmod(dest,0o700)
    manifest={}
    for role,path in current_dropin_paths(plan).items():
        _assert_no_symlink_ancestors(path.parent)
        if path.is_symlink():
            raise RuntimeError('CURRENT_DROPIN_SYMLINK_FORBIDDEN:'+role)
        if path.exists():
            metadata=path.stat()
            if not path.is_file():
                raise RuntimeError('CURRENT_DROPIN_NOT_REGULAR:'+role)
            target=dest/(role+'.conf')
            shutil.copy2(path,target)
            os.chmod(target,0o600)
            manifest[role]={'present':True,'mode':stat.S_IMODE(metadata.st_mode)}
        else:
            manifest[role]={'present':False}
    write_json_durable(dest/'manifest.json',manifest)
    return manifest

def current_restore_dropins(plan: dict, src: Path) -> None:
    try:
        manifest=json.loads((src/'manifest.json').read_text())
    except (OSError,ValueError):
        raise RuntimeError('CURRENT_DROPIN_BASELINE_INVALID') from None
    paths=current_dropin_paths(plan)
    if not isinstance(manifest,dict) or set(manifest)!=set(paths):
        raise RuntimeError('CURRENT_DROPIN_BASELINE_INVALID')
    for role,path in paths.items():
        _assert_no_symlink_ancestors(path.parent)
        state=manifest[role]
        if not isinstance(state,dict) or type(state.get('present')) is not bool:
            raise RuntimeError('CURRENT_DROPIN_BASELINE_INVALID')
        if path.is_symlink():
            raise RuntimeError('CURRENT_DROPIN_SYMLINK_FORBIDDEN:'+role)
        if state['present']:
            source=src/(role+'.conf')
            mode=state.get('mode')
            if not source.is_file() or source.is_symlink() or type(mode) is not int:
                raise RuntimeError('CURRENT_DROPIN_BASELINE_INVALID')
            path.parent.mkdir(parents=True,exist_ok=True)
            tmp=path.with_suffix('.restore-tmp')
            shutil.copyfile(source,tmp)
            os.chmod(tmp,mode)
            os.replace(tmp,path)
        else:
            if path.exists() and not path.is_file():
                raise RuntimeError('CURRENT_DROPIN_NOT_REGULAR:'+role)
            path.unlink(missing_ok=True)
    run(['systemctl','daemon-reload'])

def current_capture_unit_states(plan: dict) -> dict:
    states={}
    for unit in current_units(plan):
        load=unit_prop(unit,'LoadState')
        active=unit_prop(unit,'ActiveState')
        sub=unit_prop(unit,'SubState')
        if load not in ('loaded','masked'):
            raise RuntimeError('CURRENT_BASE_UNIT_NOT_INSTALLED:'+unit)
        if active not in ('active','inactive'):
            raise RuntimeError('CURRENT_BASE_UNIT_STATE_INVALID:'+unit)
        states[unit]={'load':load,'active':active,'sub':sub}
    return states


def current_validate_base_units(plan: dict) -> dict:
    checked={}
    for role,item in plan['services'].items():
        unit=str(item['unit'])
        load=unit_prop(unit,'LoadState')
        if load not in ('loaded','masked'):
            raise RuntimeError('CURRENT_BASE_UNIT_NOT_INSTALLED:'+unit)
        expected_env=tuple(Path(value) for value in item.get('environmentFiles',[]))
        observed_env=tuple(parse_environment_files(
            unit_prop(unit,'EnvironmentFiles'),allow_empty=not expected_env
        ))
        if observed_env!=expected_env:
            raise RuntimeError('CURRENT_BASE_ENVIRONMENT_SCOPE_MISMATCH:'+role)
        identity=item.get('identity')
        if not isinstance(identity,dict):
            raise RuntimeError('CURRENT_BASE_IDENTITY_INVALID:'+role)
        dynamic=unit_prop(unit,'DynamicUser')
        user=unit_prop(unit,'User')
        group=unit_prop(unit,'Group')
        if identity.get('mode')=='DYNAMIC_USER':
            if dynamic!='yes' or user=='root' or group=='root':
                raise RuntimeError('CURRENT_BASE_IDENTITY_INVALID:'+role)
        elif identity.get('mode')=='STATIC_CANONICAL':
            if dynamic=='yes' or user!=identity.get('user') or group!=identity.get('group'):
                raise RuntimeError('CURRENT_BASE_IDENTITY_INVALID:'+role)
        else:
            raise RuntimeError('CURRENT_BASE_IDENTITY_INVALID:'+role)
        checked[role]={'unit':unit,'environmentFiles':[str(x) for x in observed_env],
                       'identityMode':identity['mode']}
    return checked

def current_restore_unit_states(plan: dict, baseline: dict) -> None:
    units=current_units(plan)
    if not isinstance(baseline,dict) or set(baseline)!=set(units):
        raise RuntimeError('CURRENT_UNIT_BASELINE_INVALID')
    current_stop_product_units(plan)
    for unit in units:
        state=baseline[unit]
        if state.get('load')=='masked':
            continue
        run(['systemctl','unmask','--runtime',unit],timeout=30)
    for unit in units:
        state=baseline[unit]
        if state.get('load')!='masked' and state.get('active')=='active':
            run(['systemctl','start',unit],timeout=30)
    for unit in units:
        expected=baseline[unit]
        observed_active=unit_prop(unit,'ActiveState')
        if expected.get('load')=='masked':
            if unit_prop(unit,'LoadState')!='masked' or observed_active!='inactive':
                raise RuntimeError('CURRENT_UNIT_BASELINE_RESTORE_FAILED:'+unit)
        elif expected.get('active')=='active':
            if observed_active!='active':
                raise RuntimeError('CURRENT_UNIT_BASELINE_RESTORE_FAILED:'+unit)
        elif observed_active!='inactive':
            raise RuntimeError('CURRENT_UNIT_BASELINE_RESTORE_FAILED:'+unit)

def current_stop_product_units(plan: dict) -> dict:
    units=current_units(plan)
    for unit in reversed(units):
        try:
            run(['systemctl','mask','--runtime','--now',unit],timeout=30)
        except Exception:
            pass
    return {unit:unit_quiescence_snapshot(unit) for unit in units}

def current_start_product_units(plan: dict) -> None:
    units=current_units(plan)
    for unit in units:
        run(['systemctl','unmask','--runtime',unit],timeout=30)
    if any(unit_prop(unit,'LoadState')!='loaded' for unit in units):
        raise RuntimeError('CURRENT_UNIT_RUNTIME_UNMASK_FAILED')
    for unit in units:
        run(['systemctl','start',unit],timeout=30)

def _admin_login_path(base_path: object) -> str:
    if base_path not in ('','/admin'):
        raise RuntimeError('CURRENT_ADMIN_BASE_PATH_INVALID')
    return str(base_path)+'/login' if base_path else '/login'

def current_wait_runtime(plan: dict, started_at: str) -> dict:
    units=current_units(plan)
    end=time.time()+45
    last=None
    admin_path=_admin_login_path(plan.get('adminBuildBasePath'))
    while time.time()<end:
        try:
            states=[(unit_prop(u,'ActiveState'),unit_prop(u,'SubState')) for u in units]
            api_port=int(env_value(API_ENV,'API_PORT'))
            live=http_status(f'http://127.0.0.1:{api_port}/health/live')[0]
            ready=http_status(f'http://127.0.0.1:{api_port}/health/ready')[0]
            portal=http_status('http://127.0.0.1:3100/login')[0]
            admin=http_status('http://127.0.0.1:3101'+admin_path)[0]
            if all(x==('active','running') for x in states) and live==ready==portal==admin==200:
                j=run(['journalctl','-u','seller-agents-owner-test-worker.service','--since',started_at,'--no-pager','-o','cat'],check=False)
                if b'Worker ready' in j.stdout:
                    return {'live':live,'ready':ready,'portal':portal,'admin':admin,'workerReady':True}
            last={'states':states,'live':live,'ready':ready,'portal':portal,'admin':admin}
        except Exception as error:
            last={'error':type(error).__name__}
        time.sleep(1)
    raise RuntimeError('CURRENT_POST_SWITCH_HEALTH_FAILED:'+json.dumps(last,sort_keys=True))

def current_exec_argv(value: str) -> list[str]:
    body=stable_exec_identity(value)
    match=re.search(r'(?:^|;\s*)argv\[\]=([^;]+)',body)
    if not match:
        raise RuntimeError('CURRENT_LOADED_EXECSTART_INVALID')
    try:
        argv=shlex.split(match.group(1).strip())
    except ValueError:
        raise RuntimeError('CURRENT_LOADED_EXECSTART_INVALID') from None
    if not argv:
        raise RuntimeError('CURRENT_LOADED_EXECSTART_INVALID')
    return argv

def current_verify_loaded_plan(plan: dict) -> dict:
    units=current_units(plan)
    result={}
    for role,item in plan['services'].items():
        unit=str(item['unit'])
        working=unit_prop(unit,'WorkingDirectory')
        if working!=str(item['workingDirectory']):
            raise RuntimeError('CURRENT_LOADED_WORKING_DIRECTORY_MISMATCH:'+role)
        observed_argv=current_exec_argv(unit_prop(unit,'ExecStart'))
        if observed_argv!=[str(value) for value in item['execArgv']]:
            raise RuntimeError('CURRENT_LOADED_EXECSTART_MISMATCH:'+role)
        result[role]={'unit':unit,'workingDirectory':working,'execMatched':True}
    if set(x['unit'] for x in result.values())!=set(units):
        raise RuntimeError('CURRENT_LOADED_SERVICE_SET_MISMATCH')
    return result

def run(args, *, check=True, input_bytes=None, stdin_file=None, stdout_file=None, env=None, timeout=120, cwd=None):
    if input_bytes is not None and stdin_file is not None:
        raise RuntimeError("RUN_STDIN_AMBIGUOUS")
    # The archive remains an open file descriptor until subprocess.run finishes.
    # Never materialize the whole custom-format PostgreSQL dump in Python memory.
    with ExitStack() as handles:
        incoming = handles.enter_context(Path(stdin_file).open("rb")) if stdin_file is not None else None
        out = subprocess.PIPE
        if stdout_file:
            fd = os.open(str(stdout_file), os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
            out = handles.enter_context(os.fdopen(fd, "wb"))
        p = subprocess.run(
            args, input=input_bytes, stdin=incoming, stdout=out,
            stderr=subprocess.PIPE, env=env, timeout=timeout, cwd=cwd,
        )
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

def docker_pg(args, *, input_bytes=None, stdin_file=None, stdout_file=None, timeout=120):
    interactive = input_bytes is not None or stdin_file is not None
    return run(
        ['docker', 'exec', *(['-i'] if interactive else []), DB_CONTAINER, *args],
        input_bytes=input_bytes, stdin_file=stdin_file,
        stdout_file=stdout_file, timeout=timeout,
    )

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


def check_migration_prefix_for_release(
    release: Path,
    url: str,
    expected_count: int | None = None,
) -> dict:
    env = os.environ.copy()
    env['DATABASE_URL'] = url
    env['OCTOPORT_RELEASE_ROOT'] = str(release)
    script = Path(__file__).with_name('check_owner_test_migration_prefix.ts')
    p = run(
        [str(release / '.runtime/node'), str(release / TSX), str(script)],
        env=env,
        cwd=str(release),
    )
    value = json.loads(p.stdout)
    applied = value.get('applied')
    if (
        value.get('status') != 'PASS_PREFIX'
        or type(applied) is not int
        or applied < 0
        or (expected_count is not None and applied != expected_count)
    ):
        raise RuntimeError('MIGRATION_PREFIX_COUNT_INVALID')
    return value


def check_migration_prefix(url: str, expected_count: int) -> dict:
    # Legacy pinned deployment compatibility only.
    return check_migration_prefix_for_release(CANDIDATE_REL, url, expected_count)


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

def read_cgroup_pids(control_group: str) -> list[str]:
    if not control_group.startswith('/'):
        raise RuntimeError('PRODUCT_UNIT_CGROUP_INVALID')
    parts=[part for part in control_group.split('/') if part]
    if not parts or any(part in ('.','..') for part in parts):
        raise RuntimeError('PRODUCT_UNIT_CGROUP_INVALID')
    directory_flags=os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC|os.O_NOFOLLOW
    try:
        root_fd=os.open(CGROUP_ROOT,directory_flags)
    except OSError:
        raise RuntimeError('PRODUCT_UNIT_CGROUP_UNREADABLE') from None
    current_fd=root_fd
    try:
        for part in parts:
            try:
                next_fd=os.open(part,directory_flags,dir_fd=current_fd)
            except FileNotFoundError:
                # systemd normally removes an empty unit cgroup after stop.
                return []
            except OSError:
                raise RuntimeError('PRODUCT_UNIT_CGROUP_UNREADABLE') from None
            if current_fd!=root_fd:
                os.close(current_fd)
            current_fd=next_fd
        try:
            proc_fd=os.open(
                'cgroup.procs',
                os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW,
                dir_fd=current_fd,
            )
        except OSError:
            raise RuntimeError('PRODUCT_UNIT_CGROUP_UNREADABLE') from None
        try:
            with os.fdopen(proc_fd,'r',encoding='ascii',errors='strict') as source:
                return [line.strip() for line in source if line.strip()]
        except (OSError,UnicodeError):
            raise RuntimeError('PRODUCT_UNIT_CGROUP_UNREADABLE') from None
    finally:
        if current_fd!=root_fd:
            os.close(current_fd)
        os.close(root_fd)


def unit_quiescence_snapshot(unit: str) -> dict:
    load=unit_prop(unit,'LoadState')
    active=unit_prop(unit,'ActiveState')
    sub=unit_prop(unit,'SubState')
    main_pid=unit_prop(unit,'MainPID')
    control_group=unit_prop(unit,'ControlGroup')
    if load!='masked' or active!='inactive' or main_pid!='0':
        raise RuntimeError('PRODUCT_UNITS_NOT_QUIESCED')
    cgroup_pids=read_cgroup_pids(control_group) if control_group else []
    if cgroup_pids:
        raise RuntimeError('PRODUCT_UNITS_NOT_QUIESCED')
    return {'load':load,'active':active,'sub':sub,'mainPid':main_pid,
            'controlGroup':control_group,'cgroupPids':cgroup_pids}


def stop_product_units():
    # Runtime masking closes the external restart race for the whole destructive
    # interval. A host reboot kills the old process; a new API must claim a new
    # instance identity before writing after recovery.
    for unit in reversed(UNITS):
        try:
            run(['systemctl','mask','--runtime','--now',unit],timeout=30)
        except Exception:
            pass  # Exact manager/process/cgroup state below is authoritative.
    return {unit:unit_quiescence_snapshot(unit) for unit in UNITS}


def start_product_units():
    for unit in UNITS:
        run(['systemctl','unmask','--runtime',unit],timeout=30)
    if any(unit_prop(unit,'LoadState')!='loaded' for unit in UNITS):
        raise RuntimeError('PRODUCT_UNIT_RUNTIME_UNMASK_FAILED')
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
    _assert_no_symlink_ancestors(BACKUPS)
    BACKUPS.mkdir(parents=True,exist_ok=True); os.chmod(BACKUPS,0o700)
    _assert_no_symlink_ancestors(BACKUPS)
    path=BACKUPS/f'owner-test-{stamp}.dump'
    docker_pg(['pg_dump','--format=custom','--no-owner','--no-privileges','--serializable-deferrable','-U',user,'-d',db],stdout_file=path,timeout=180)
    os.chmod(path,0o600)
    docker_pg(['pg_restore','--list'],stdin_file=path,timeout=60)
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
    try:os.fsync(fd)
    finally:os.close(fd)
    directory=os.open(BACKUPS,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(directory)
    finally:os.close(directory)
    return path

def restore_isolated(user: str, base_url: str, backup: Path, stamp: str) -> dict:
    name='octoport_owner_restore_'+re.sub('[^0-9]','',stamp)
    # Fail if the unique name exists; never pre-delete somebody else's database.
    docker_pg(['createdb','-U',user,'-O',user,name],timeout=30)
    try:
        docker_pg(['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',name],stdin_file=backup,timeout=180)
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
    docker_pg(['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',db],stdin_file=backup,timeout=180)
    restored=int(docker_psql_scalar(user,db,'SELECT count(*) FROM drizzle.__drizzle_migrations'))
    if restored!=22: raise RuntimeError('LIVE_BACKUP_RESTORE_COUNT_INVALID:'+str(restored))
    return restored

def current_verify_backup_receipt(backup_info: object) -> Path:
    if not isinstance(backup_info,dict) or not isinstance(backup_info.get('path'),str):
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    path=Path(backup_info['path'])
    if not path.is_absolute() or path.parent!=BACKUPS:
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    _assert_no_symlink_ancestors(path)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    metadata=path.stat()
    if stat.S_IMODE(metadata.st_mode)!=0o600 or metadata.st_uid!=0:
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    expected_bytes=backup_info.get('bytes');expected_sha=backup_info.get('sha256')
    if type(expected_bytes) is not int or expected_bytes!=metadata.st_size:
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    if not isinstance(expected_sha,str) or not re.fullmatch(r'[0-9a-f]{64}',expected_sha):
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    if sha256(path)!=expected_sha:
        raise RuntimeError('CURRENT_RECOVERY_BACKUP_INVALID')
    return path

def current_restore_isolated(
    user: str,
    base_url: str,
    backup: Path,
    stamp: str,
    release: Path,
    *,
    expected_before: int,
    expected_target: int,
) -> dict:
    name='octoport_owner_restore_'+re.sub('[^0-9]','',stamp)
    docker_pg(['createdb','-U',user,'-O',user,name],timeout=30)
    try:
        docker_pg(
            ['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',name],
            stdin_file=backup,timeout=180,
        )
        isolated_url=migration_url(base_url,name)
        before=check_migration_prefix_for_release(release,isolated_url)['applied']
        if before!=expected_before:
            raise RuntimeError(f'CURRENT_ISOLATED_PREDEPLOY_PREFIX_MISMATCH:{before}!={expected_before}')
        migrate(release,isolated_url)
        after=check_migration_prefix_for_release(
            release,isolated_url,expected_count=expected_target
        )['applied']
        return {'database':name,'before':before,'after':after}
    finally:
        docker_pg(['dropdb','--if-exists','--force','-U',user,name],timeout=30)

def current_restore_live_backup(
    user: str,
    db: str,
    base_url: str,
    backup: Path,
    meta: dict,
    release: Path,
    *,
    expected_prefix: int,
) -> int:
    docker_pg(['dropdb','--if-exists','--force','-U',user,db],timeout=60)
    docker_pg([
        'createdb','-U',user,'-O',user,'-T','template0','-E',meta['encoding'],
        '--lc-collate',meta['collate'],'--lc-ctype',meta['ctype'],db
    ],timeout=60)
    docker_pg(
        ['pg_restore','--exit-on-error','--no-owner','--no-privileges','-U',user,'-d',db],
        stdin_file=backup,timeout=180,
    )
    restored=check_migration_prefix_for_release(
        release,base_url,expected_count=expected_prefix
    )['applied']
    return restored

@contextmanager
def current_operation_lock(evidence_root: Path):
    evidence_root.mkdir(parents=True,exist_ok=True)
    _assert_no_symlink_ancestors(evidence_root)
    lock=evidence_root/'apply.lock'
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
    try:
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('CURRENT_APPLY_ALREADY_RUNNING') from None
        yield
    finally:
        os.close(fd)

def current_assert_apply_journal_clear(journal: Path) -> None:
    if not journal.exists():
        return
    if journal.is_symlink() or not journal.is_file():
        raise RuntimeError('CURRENT_RECOVERY_REQUIRED')
    try:
        state=json.loads(journal.read_text())
    except (OSError,ValueError):
        raise RuntimeError('CURRENT_RECOVERY_REQUIRED') from None
    if not isinstance(state,dict) or state.get('recoveryRequired') is not False:
        raise RuntimeError('CURRENT_RECOVERY_REQUIRED')

def current_apply_engine(
    *,
    candidate_release: Path,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
    evidence_root: Path,
    journal: Path,
    evidence_dir: Path,
) -> dict:
    current_validate_evidence_paths(evidence_root,journal,evidence_dir)
    with current_operation_lock(evidence_root):
        current_assert_apply_journal_clear(journal)
        return _current_apply_engine_locked(
            candidate_release=candidate_release,
            expected_source_sha=expected_source_sha,
            expected_source_tree=expected_source_tree,
            expected_inventory_sha256=expected_inventory_sha256,
            evidence_root=evidence_root,
            journal=journal,
            evidence_dir=evidence_dir,
        )

def _current_apply_engine_locked(
    *,
    candidate_release: Path,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
    evidence_root: Path,
    journal: Path,
    evidence_dir: Path,
) -> dict:
    """Current four-service mutation engine. No CLI/live authority is wired here."""
    if not journal.is_absolute() or journal.parent!=evidence_root:
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    _assert_no_symlink_ancestors(evidence_root)
    _assert_no_symlink_ancestors(journal)
    plan=verified_current_source_plan(
        candidate_release,
        expected_source_sha=expected_source_sha,
        expected_source_tree=expected_source_tree,
        expected_inventory_sha256=expected_inventory_sha256,
    )
    target=plan.get('migrationTarget',{}).get('count')
    if type(target) is not int or target < 0:
        raise RuntimeError('CURRENT_MIGRATION_TARGET_INVALID')
    base_url=database_url()
    user,_password,db,_parsed=db_identity(base_url)
    if not user or not db:
        raise RuntimeError('DB_IDENTITY_INVALID')
    live=check_migration_prefix_for_release(candidate_release,base_url)
    predeploy=live['applied']
    if predeploy>target:
        raise RuntimeError('CURRENT_PREDEPLOY_PREFIX_AHEAD_OF_CANDIDATE')
    result_base_units=current_validate_base_units(plan)
    baseline_units=current_capture_unit_states(plan)
    dropin_backup=evidence_dir/'dropins-before'
    current_snapshot_dropins(plan,dropin_backup)
    db_meta=database_creation_meta(user,db)
    phase='PRE'
    schema_state='PREDEPLOY_VERIFIED'
    backup=None
    result={
        'status':'STARTED',
        'phase':phase,
        'recoveryRequired':True,
        'candidateSourceSha':plan.get('sourceSha'),
        'candidateSourceTree':plan.get('sourceTree'),
        'trustedInventorySha256':plan.get('trustedInventorySha256'),
        'predeployPrefix':predeploy,
        'candidateTarget':target,
        'candidateLatestTag':plan.get('migrationTarget',{}).get('latestTag'),
        'baselineUnits':baseline_units,
        'baseUnitContract':result_base_units,
        'databaseMeta':db_meta,
        'applicationMayHaveWritten':False,
    }
    def record():
        result['phase']=phase
        result['schemaState']=schema_state
        write_json_durable(evidence_dir/'receipt.json',result)
        write_json_durable(journal,{
            'phase':phase,
            'schemaState':schema_state,
            'recoveryRequired':result['recoveryRequired'],
            'receipt':str(evidence_dir/'receipt.json'),
            'applicationMayHaveWritten':result['applicationMayHaveWritten'],
            'candidateSourceSha':result.get('candidateSourceSha'),
            'candidateSourceTree':result.get('candidateSourceTree'),
            'predeployPrefix':predeploy,
            'candidateTarget':target,
        })
    record()
    try:
        current_install_reboot_fence(plan)
        phase='REBOOT_FENCED'; record()
        result['quiescence']=current_stop_product_units(plan)
        phase='QUIESCED'; record()
        stamp=evidence_dir.name.replace('apply-','')
        backup=backup_live(user,db,stamp)
        result['backup']={'path':str(backup),'sha256':sha256(backup),'bytes':backup.stat().st_size}
        result['isolatedRestore']=current_restore_isolated(
            user,base_url,backup,stamp,candidate_release,
            expected_before=predeploy,expected_target=target,
        )
        phase='ISOLATED_TARGET_VERIFIED'; record()
        if predeploy<target:
            phase='LIVE_MIGRATION'; schema_state='UNKNOWN'; record()
            migrate(candidate_release,base_url)
            result['liveMigration']=check_migration_prefix_for_release(
                candidate_release,base_url,expected_count=target
            )
            schema_state='CANDIDATE_VERIFIED'
        else:
            result['liveMigration']={'status':'NOOP_ALREADY_TARGET','applied':predeploy}
            schema_state='CANDIDATE_VERIFIED'
        phase='SWITCHING_APPLICATION'; record()
        current_write_dropins(plan)
        result['applicationMayHaveWritten']=True
        phase='APPLICATION_START_REQUESTED'; record()
        current_enable_fenced_start()
        started=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        current_start_product_units(plan)
        result['applicationHealth']=current_wait_runtime(plan,started)
        result['loadedIdentity']=current_verify_loaded_plan(plan)
        current_remove_reboot_fence(plan)
        result['status']='APPLY_PASS'
        result['recoveryRequired']=False
        phase='CANDIDATE_PASS'
        record()
        return result
    except BaseException as error:
        result['status']='FAILED'
        result['error']=error_code(error)
        phase='ROLLBACK'
        result['recoveryRequired']=True
        try:
            current_disable_fenced_start()
            current_stop_product_units(plan)
            result['rollbackQuiesced']=True
            if result['applicationMayHaveWritten'] and predeploy<target:
                # Starting even one service can admit durable writes before health
                # acceptance. Restoring a predeploy dump would discard them.
                raise RuntimeError('CURRENT_FORWARD_RECOVERY_REQUIRED')
            if backup is not None and schema_state in ('UNKNOWN','CANDIDATE_VERIFIED') and predeploy<target:
                current_verify_backup_receipt(result.get('backup'))
                result['restoredMigrationCount']=current_restore_live_backup(
                    user,db,base_url,backup,db_meta,candidate_release,
                    expected_prefix=predeploy,
                )
                schema_state='PREDEPLOY_VERIFIED'
            current_restore_dropins(plan,dropin_backup)
            current_enable_fenced_start()
            current_restore_unit_states(plan,baseline_units)
            current_remove_reboot_fence(plan)
            result['baselineRestored']=True
            result['recoveryRequired']=False
            phase='ROLLBACK_PASS'
        except BaseException as rollback_error:
            result['rollbackError']=error_code(rollback_error)
            try:
                current_stop_product_units(plan)
                result['productQuiesced']=True
            except BaseException as stop_error:
                result['quiesceError']=error_code(stop_error)
        record()
        raise

def current_recover_engine(
    *,
    candidate_release: Path,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
    evidence_root: Path,
    journal: Path,
) -> dict:
    if not evidence_root.is_absolute() or not evidence_root.is_dir() or evidence_root.is_symlink():
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    if not journal.is_absolute() or journal.parent!=evidence_root:
        raise RuntimeError('CURRENT_EVIDENCE_PATH_INVALID')
    with current_operation_lock(evidence_root):
        return _current_recover_engine_locked(
            candidate_release=candidate_release,
            expected_source_sha=expected_source_sha,
            expected_source_tree=expected_source_tree,
            expected_inventory_sha256=expected_inventory_sha256,
            evidence_root=evidence_root,
            journal=journal,
        )


def current_application_may_have_written(state: dict, receipt: dict) -> bool:
    """A persisted start intent is conservative across crashes and older receipts."""
    possible=False
    for item in (state, receipt):
        marker=item.get('applicationMayHaveWritten')
        if marker is not None and type(marker) is not bool:
            raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
        if marker is True or item.get('phase') in (
            'APPLICATION_START_REQUESTED','SWITCHING_APPLICATION','CANDIDATE_PASS',
        ):
            possible=True
    # Older receipts did not persist the start boundary. A verified migrated
    # schema cannot prove that the candidate has never accepted a write.
    return possible or state.get('schemaState')=='CANDIDATE_VERIFIED'


def current_forward_recover(
    *, plan: dict, candidate_release: Path, state: dict, receipt: dict,
    evidence_dir: Path, journal: Path, target: int,
) -> dict:
    """Use the separately authorized exact target on the retained forward DB."""
    if state.get('schemaState')!='CANDIDATE_VERIFIED':
        raise RuntimeError('CURRENT_FORWARD_SCHEMA_UNCONFIRMED')
    if plan.get('migrationTarget',{}).get('count')!=target:
        raise RuntimeError('CURRENT_FORWARD_SCHEMA_TARGET_MISMATCH')
    for field in ('candidateSourceSha','candidateSourceTree','predeployPrefix','candidateTarget'):
        if state.get(field)!=receipt.get(field):
            raise RuntimeError('CURRENT_FORWARD_ORIGIN_UNCONFIRMED')
    current_validate_base_units(plan)
    result={
        'status':'CURRENT_FORWARD_RECOVERY_STARTED','recoveryRequired':True,
        'originSourceSha':receipt['candidateSourceSha'],
        'originSourceTree':receipt['candidateSourceTree'],
        'candidateSourceSha':plan['sourceSha'],
        'candidateSourceTree':plan['sourceTree'],
        'trustedInventorySha256':plan['trustedInventorySha256'],
        'predeployPrefix':receipt['predeployPrefix'],'candidateTarget':target,
        'schemaState':'CANDIDATE_VERIFIED','applicationMayHaveWritten':True,
        'databaseRestored':False,
    }
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output=evidence_dir/f'forward-recovery-{stamp}.json'
    write_json_durable(output,result)
    recovering_state={
        **state,'phase':'CURRENT_FORWARD_RECOVERY_STARTED',
        'applicationMayHaveWritten':True,'lastRecoveryReceipt':str(output),
        'requestedRecoverySourceSha':plan['sourceSha'],
    }
    write_json_durable(journal,recovering_state)
    try:
        current_prepare_recovery_fence(plan)
        current_stop_product_units(plan)
        result['productQuiesced']=True
        # The native prefix check compares migration hashes, not just a count.
        # No migrate/restore/dropdb path is reachable from forward recovery.
        result['forwardSchema']=check_migration_prefix_for_release(
            candidate_release,database_url(),expected_count=target,
        )
        current_write_dropins(plan)
        current_enable_fenced_start()
        started=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
        current_start_product_units(plan)
        result['applicationHealth']=current_wait_runtime(plan,started)
        result['loadedIdentity']=current_verify_loaded_plan(plan)
        current_remove_reboot_fence(plan)
        result.update(status='CURRENT_FORWARD_RECOVERY_PASS',recoveryRequired=False)
        write_json_durable(output,result)
        write_json_durable(journal,{
            'phase':'CURRENT_FORWARD_RECOVERY_PASS',
            'schemaState':'CANDIDATE_VERIFIED','recoveryRequired':False,
            'applicationMayHaveWritten':True,'receipt':str(output),
            'originSourceSha':receipt['candidateSourceSha'],
            'candidateSourceSha':plan['sourceSha'],
            'candidateSourceTree':plan['sourceTree'],
            'predeployPrefix':receipt['predeployPrefix'],'candidateTarget':target,
        })
        return result
    except BaseException as error:
        result.update(status='FAILED',error=error_code(error),recoveryRequired=True)
        try:
            current_disable_fenced_start()
            current_stop_product_units(plan)
            result['productQuiesced']=True
        except BaseException as stop_error:
            result['quiesceError']=error_code(stop_error)
        write_json_durable(output,result)
        # Preserve the original apply receipt and source binding for a later
        # explicit recovery, and retain each failed recovery outcome separately.
        write_json_durable(journal,{
            **recovering_state,'phase':'CURRENT_FORWARD_RECOVERY_FAILED',
            'recoveryRequired':True,'applicationMayHaveWritten':True,
            'lastRecoveryReceipt':str(output),
        })
        raise


def _current_recover_engine_locked(
    *,
    candidate_release: Path,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
    evidence_root: Path,
    journal: Path,
) -> dict:
    """Recover before startup, or retain the forward DB after possible writes."""
    plan=verified_current_source_plan(
        candidate_release,
        expected_source_sha=expected_source_sha,
        expected_source_tree=expected_source_tree,
        expected_inventory_sha256=expected_inventory_sha256,
    )
    try:
        state=json.loads(journal.read_text())
    except (OSError,ValueError):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID') from None
    if not isinstance(state,dict) or state.get('recoveryRequired') is not True:
        raise RuntimeError('CURRENT_RECOVERY_NOT_REQUIRED')
    raw_receipt=state.get('receipt')
    if not isinstance(raw_receipt,str):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    receipt_path=Path(raw_receipt)
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    try:
        receipt=json.loads(receipt_path.read_text())
    except (OSError,ValueError):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID') from None
    evidence_dir=receipt_path.parent
    current_validate_evidence_paths(evidence_root,journal,evidence_dir)
    if receipt_path!=evidence_dir/'receipt.json':
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    if not isinstance(receipt,dict):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    same_source=(
        receipt.get('candidateSourceSha')==expected_source_sha
        and receipt.get('candidateSourceTree')==expected_source_tree
        and receipt.get('trustedInventorySha256')==expected_inventory_sha256
    )
    may_have_written=current_application_may_have_written(state,receipt)
    if not same_source and not may_have_written:
        raise RuntimeError('CURRENT_RECOVERY_IDENTITY_MISMATCH')
    if any(not isinstance(receipt.get(field),str) or not re.fullmatch(pattern,receipt[field])
           for field,pattern in (
               ('candidateSourceSha',r'[0-9a-f]{40}'),
               ('candidateSourceTree',r'[0-9a-f]{40}'),
               ('trustedInventorySha256',r'[0-9a-f]{64}'),
           )):
        raise RuntimeError('CURRENT_RECOVERY_IDENTITY_MISMATCH')
    predeploy=receipt.get('predeployPrefix')
    target=receipt.get('candidateTarget')
    baseline=receipt.get('baselineUnits')
    if (
        type(predeploy) is not int or predeploy<0
        or type(target) is not int or target<predeploy
        or not isinstance(baseline,dict)
    ):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    schema_state=state.get('schemaState')
    if schema_state not in ('PREDEPLOY_VERIFIED','UNKNOWN','CANDIDATE_VERIFIED'):
        raise RuntimeError('CURRENT_RECOVERY_STATE_INVALID')
    if may_have_written and predeploy<target:
        return current_forward_recover(
            plan=plan,candidate_release=candidate_release,state=state,receipt=receipt,
            evidence_dir=evidence_dir,journal=journal,target=target,
        )
    if not same_source:
        raise RuntimeError('CURRENT_RECOVERY_IDENTITY_MISMATCH')
    result={
        'status':'CURRENT_RECOVERY_STARTED',
        'recoveryRequired':True,
        'candidateSourceSha':expected_source_sha,
        'candidateSourceTree':expected_source_tree,
        'predeployPrefix':predeploy,
        'candidateTarget':target,
        'schemaState':schema_state,
    }
    try:
        current_prepare_recovery_fence(plan)
        current_stop_product_units(plan)
        result['productQuiesced']=True
        if schema_state in ('UNKNOWN','CANDIDATE_VERIFIED') and predeploy<target:
            backup_info=receipt.get('backup')
            if not isinstance(backup_info,dict) or not isinstance(backup_info.get('path'),str):
                raise RuntimeError('CURRENT_RECOVERY_BACKUP_MISSING')
            backup=current_verify_backup_receipt(backup_info)
            base_url=database_url()
            user,_password,db,_parsed=db_identity(base_url)
            meta=receipt.get('databaseMeta')
            if not isinstance(meta,dict):
                # Older interrupted receipt may not expose this field; do not
                # infer database creation metadata after destructive failure.
                raise RuntimeError('CURRENT_RECOVERY_DATABASE_META_MISSING')
            result['restoredMigrationCount']=current_restore_live_backup(
                user,db,base_url,backup,meta,candidate_release,
                expected_prefix=predeploy,
            )
            schema_state='PREDEPLOY_VERIFIED'
        current_restore_dropins(plan,evidence_dir/'dropins-before')
        current_enable_fenced_start()
        current_restore_unit_states(plan,baseline)
        current_remove_reboot_fence(plan)
        result.update(
            status='CURRENT_RECOVERY_PASS',
            recoveryRequired=False,
            schemaState=schema_state,
            baselineRestored=True,
        )
        write_json_durable(evidence_dir/'recovery.json',result)
        write_json_durable(journal,{
            'phase':'CURRENT_RECOVERY_PASS',
            'schemaState':schema_state,
            'recoveryRequired':False,
            'receipt':str(evidence_dir/'recovery.json'),
            'candidateSourceSha':expected_source_sha,
            'candidateSourceTree':expected_source_tree,
            'predeployPrefix':predeploy,
            'candidateTarget':target,
        })
        return result
    except BaseException as error:
        result.update(status='FAILED',error=error_code(error),recoveryRequired=True)
        try:
            current_disable_fenced_start()
            current_stop_product_units(plan)
            result['productQuiesced']=True
        except BaseException as stop_error:
            result['quiesceError']=error_code(stop_error)
        write_json_durable(evidence_dir/'recovery.json',result)
        raise

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
    expected=EVID/FORWARD_RECOVERY_SOURCE_RECEIPT
    if path!=expected or EVID.is_symlink() or expected.parent.is_symlink() or expected.is_symlink():
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    try:
        fd=os.open(expected,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(fd,'rb') as source_file:
            source_bytes=source_file.read()
    except OSError:
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID') from None
    if hashlib.sha256(source_bytes).hexdigest()!=FORWARD_RECOVERY_SOURCE_RECEIPT_SHA256:
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    try:
        value=json.loads(source_bytes)
    except (ValueError,UnicodeDecodeError):
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID') from None
    if not isinstance(value,dict) or value.get('stamp')!='20260928T111855095131Z':
        raise RuntimeError('OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID')
    return expected.resolve(),value


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
        result['quiescenceBeforeBackup']=stop_product_units()
        phase = 'QUIESCED'
        record()
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
            result['quiescenceBeforeDatabaseRestore']=stop_product_units()
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
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        recovery_path=EVID/f'recovery-{stamp}.json'
        result={'status':'FORWARD_RECOVERY_STARTED','stamp':stamp,'candidate':CANDIDATE,
                'schemaState':'FORWARD_VERIFIED','recoveryRequired':True,
                'sourceReceipt':str(source_path)}
        write_json_durable(recovery_path,result)
        write_json_durable(journal,{'candidate':CANDIDATE,'phase':'FORWARD_RECOVERY_START',
            'schemaState':'FORWARD_VERIFIED','recoveryRequired':True,'receipt':str(recovery_path),
            'recoveredFromReceipt':str(source_path)})
        try:
            verify_release(CANDIDATE_REL,CANDIDATE); verify_release(FLOOR_REL,FLOOR)
            result['prefixBefore']=check_migration_prefix(database_url(),40)
            verify_candidate_dropins()
            result['quiescenceBeforeRestart']=stop_product_units()
            result['monitorBefore']=verify_monitor_preflight(preflight_data.get('monitorUnits'))
            write_json_durable(recovery_path,result)
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


def current_cli(argv: list[str]) -> dict:
    parser=argparse.ArgumentParser(prog='deploy_owner_test.py current')
    parser.add_argument('mode',choices=('current-plan','current-apply','current-recover'))
    parser.add_argument('--candidate-release',type=Path,required=True)
    parser.add_argument('--source-sha',required=True)
    parser.add_argument('--source-tree',required=True)
    parser.add_argument('--inventory-sha256',required=True)
    args=parser.parse_args(argv)
    identity={
        'expected_source_sha':args.source_sha,
        'expected_source_tree':args.source_tree,
        'expected_inventory_sha256':args.inventory_sha256,
    }
    if args.mode=='current-plan':
        return verified_current_source_plan(args.candidate_release,**identity)

    action='apply' if args.mode=='current-apply' else 'recover'
    authority=current_require_cli_authority(action,**identity)
    root=current_trusted_evidence_root(create=action=='apply')
    if action=='apply':
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        evidence_dir=root/f'apply-{stamp}'
        evidence_dir.mkdir(mode=0o700)
        result=current_apply_engine(
            candidate_release=args.candidate_release,
            evidence_root=root,
            journal=root/'deployment-state.json',
            evidence_dir=evidence_dir,
            **identity,
        )
    else:
        result=current_recover_engine(
            candidate_release=args.candidate_release,
            evidence_root=root,
            journal=root/'deployment-state.json',
            **identity,
        )
    if not isinstance(result,dict):
        raise RuntimeError('CURRENT_DEPLOY_RESULT_INVALID')
    result=dict(result)
    result['authorizationId']=authority['authorizationId']
    result['authorityMode']=authority['mode']
    return result

def main():
    mode=sys.argv[1] if len(sys.argv)>1 else 'preflight'
    if mode.startswith('current-'):
        result=current_cli(sys.argv[1:])
        print(json.dumps(result,sort_keys=True))
        if mode=='current-apply' and result.get('status')!='APPLY_PASS':
            raise SystemExit(2)
        return
    EVID.mkdir(parents=True,exist_ok=True); BACKUPS.mkdir(parents=True,exist_ok=True); os.chmod(EVID,0o700); os.chmod(BACKUPS,0o700)
    if mode=='preflight': result=preflight()
    elif mode=='apply': result=apply()
    elif mode=='recover-forward': result=recover_forward()
    else: raise RuntimeError('USAGE: preflight|apply|recover-forward|current-plan|current-apply|current-recover')
    print(json.dumps(result,sort_keys=True))
    if mode == 'apply' and result.get('status') != 'APPLY_PASS':
        raise SystemExit(2)
if __name__=='__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'status':'FAILED','error':error_code(e)}),file=sys.stderr); raise SystemExit(1)
