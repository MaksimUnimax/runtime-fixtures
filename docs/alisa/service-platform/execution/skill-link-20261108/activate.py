"""Finite AL-S06 web/API/cleanup cutover. Never switch Identity/admin/native.

The single additive migration is retained on rollback. Existing environment
files, pointers except web-current, release bytes and customer rows are intact.
"""
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path as P
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.request
import uuid

sys.dont_write_bytecode = True
os.umask(0o077)
B = P('/opt/alisa-platform/stage')
T = B/'releases/alisa-d3cb053be14264c6'
D = P('/var/lib/alisa-platform/stage/rollout-backups/skill-link-20261109')
E = P('/etc/alisa-platform/stage/alice-link.env')
FLOOR = 3072*1048576
# No package extraction/dependency installation: <=1 MiB new config/schema,
# up to one 16 MiB WAL segment, plus 7 MiB for journals/concurrent writers.
BUDGET = 24*1048576
SOURCE = 'd3cb053be14264c6bb2332708abb32d4b0c005ae'
PREPARED_MANIFEST = '1385344b55484200d347e6976811dbff757e298fde859753cbd468e2c8c35bb5'
CI_SELECTED = 'e6d8982e1d3be34b6f648790b3b84cba1709cfd9f5d40319502d5cb10a6a5e23'
UNITS = ['alisa-web@stage.service', 'alisa-platform@stage.service',
         'alisa-account-cleanup@stage.service']
PROTECTED = ['alisa-identity@stage.service', 'alisa-admin@stage.service']
NATIVE = ['alice-market.service', 'alice-lab-web.service', 'alisa-station.service',
          'alisa-store-check.service']
DROP_NAME = 'zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf'
DROPS = {u: P('/etc/systemd/system')/(u+'.d')/DROP_NAME for u in UNITS}
record = {'status': 'FAILED', 'scope': 'WEB_PLATFORM_ACCOUNT_CLEANUP_ONLY', 'cases': []}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def check(name, ok):
    record['cases'].append({'case': name, 'passed': bool(ok)})
    if not ok:
        raise RuntimeError(name)


def cmd(args, timeout=25, env=None):
    return subprocess.run(args, check=True, capture_output=True, text=True,
                          timeout=timeout, env=env).stdout.strip()


def trusted(p, directory=False):
    # Ancestors must be real root-owned directories. The final object may only
    # be a regular file/directory; symlinks are checked by the release verifier.
    for q in [*reversed(p.parents), p]:
        s = q.lstat()
        if s.st_uid != 0 or s.st_mode & 0o022 or stat.S_ISLNK(s.st_mode):
            raise RuntimeError('Untrusted_path')
        if q != p or directory:
            if not stat.S_ISDIR(s.st_mode):
                raise RuntimeError('Untrusted_directory')


def fresh(p, raw, mode=0o600):
    trusted(p.parent, True)
    tmp = p.with_name('.'+p.name+'.s06-'+uuid.uuid4().hex)
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        # A hard-link publication is atomic and fails if the destination was
        # concurrently created. Readers never observe a partially written file.
        os.link(tmp, p, follow_symlinks=False)
    finally:
        if tmp.exists():
            tmp.unlink()


def config(p):
    trusted(p)
    if p.stat().st_mode & 0o007:
        raise RuntimeError('Public_private_configuration')
    out = {}
    for line in p.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        k, sep, value = line.partition('=')
        if not sep or not re.fullmatch('[A-Z0-9_]+', k) or k in out:
            raise RuntimeError('Invalid_private_configuration')
        v = shlex.split(value, comments=False)
        if len(v) > 1:
            raise RuntimeError('Invalid_private_value')
        out[k] = v[0] if v else ''
    return out


def profile(u):
    value = cmd(['systemctl', 'show', u, '-p',
                 'WorkingDirectory,ExecStart,EnvironmentFiles,User,Group,SupplementaryGroups,DropInPaths'])
    # Exclude last-run timestamps/PID/status from a scheduled oneshot's command
    # property. Its configured executable/argv remain an exact comparison.
    return '\n'.join(line.split(' ; ignore_errors=', 1)[0] if line.startswith('ExecStart=')
                     else line for line in value.splitlines())


def identity(u):
    return cmd(['systemctl', 'show', u, '-p', 'MainPID,InvocationID,ActiveState'])


def snapshot():
    return {'pointers': {n: os.readlink(B/n) for n in
                         ['current', 'site-current', 'web-current', 'admin-current', 'identity-current']},
            'profiles': {u: profile(u) for u in UNITS+PROTECTED},
            'protected': {u: identity(u) for u in PROTECTED},
            'native': {u: profile(u) for u in NATIVE},
            'environments': {n: sha(P('/etc/alisa-platform/stage')/(n+'.env')) for n in
                             ['web', 'platform', 'platform-migration', 'identity', 'identity-migration', 'admin']}}


def scoped(s):
    # Other actors may independently update native/Station while this finite
    # website rollout runs; record those profiles without making them our gate.
    return {k: v for k, v in s.items() if k != 'native'}


def resources(extra=BUDGET):
    check('disk_floor_and_bounded_install_budget', shutil.disk_usage('/').free >= FLOOR+extra)
    check('inode_reserve', os.statvfs('/').f_favail >= 200000)
    mem = next(int(x.split()[1]) for x in P('/proc/meminfo').read_text().splitlines()
               if x.startswith('MemAvailable:'))
    check('memory_reserve', mem >= 1536*1024)


def ready():
    out = {}
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for port in [18100, 18101, 18102, 18103]:
        with op.open('http://127.0.0.1:'+str(port)+'/health/ready', timeout=2) as r:
            out[str(port)] = json.loads(r.read(32768))
    return out


def verify_source():
    trusted(T, True)
    check('independently_recorded_prepared_manifest', sha(T/'manifest.json') == PREPARED_MANIFEST)
    m = json.loads((T/'manifest.json').read_text())
    check('qualified_product_source', m['source_sha'] == SOURCE and
          m['acceptance'] == 'PREPARED_NOT_ACTIVATED' and
          m['source_package_sha256'] == '86a684263b85791ac5bdaa010bc85208e460ba5841a9c83100eb35a52e2ee4eb')
    selected = {'infra/release.py', 'services/platform/pyproject.toml', 'services/platform/requirements.lock',
                'services/platform/src/alisa_platform/config/settings.py', 'services/platform/src/alisa_platform/config/urls.py',
                'services/platform/src/alisa_platform/foundation/views.py',
                'services/platform/src/alisa_platform/accounts/management/commands/accounts_cleanup.py'}
    def chosen(n):
        return n.startswith('ui/web/') or n in selected or n.startswith('services/platform/src/alisa_platform/alice_link/')
    subset = {k: {n: h for n, h in m[k].items() if chosen(n)} for k in ['files', 'links']}
    check('independent_exact_ci_selected_map', hashlib.sha256(json.dumps(subset, sort_keys=True,
          separators=(',', ':')).encode()).hexdigest() == CI_SELECTED)
    check('prepared_manifest_file_hashes', all(sha(T/n) == h for n, h in m['files'].items()))
    check('qualified_verifier_hash', sha(T/'infra/release.py') == m['files']['infra/release.py'])
    spec = importlib.util.spec_from_file_location('qualified_release', T/'infra/release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    check('exact_prepared_file_and_link_sets', module.installed_release(B, T.name) == T)
    base = m['overlay_base']
    for component, unit in [('web', UNITS[0]), ('platform', UNITS[1])]:
        pid = cmd(['systemctl', 'show', unit, '-p', 'MainPID', '--value'])
        wd = P(cmd(['systemctl','show',unit,'-p','WorkingDirectory','--value'])).resolve()
        check('effective_'+component+'_baseline', str(wd) == base[component] and
              P('/proc/'+pid+'/cwd').resolve().is_relative_to(wd))
        check(component+'_baseline_manifest', sha(P(base[component])/'manifest.json') == base[component+'_manifest'])
    old = P(base['platform'])
    check('all_preserved_platform_source', all(sha(old/n) == h for n, h in base['platform_files'].items()))
    check('preserved_launcher', sha(old/'infra/launch.py') == base['launcher'])
    check('current_staff_changes_preserved', all(sha(T/'services/platform/src/alisa_platform/staff'/n) == h
          for n, h in base['staff_files'].items()))
    return m


DB_CODE = r'''
import django,json,os,sys
django.setup()
from django.db import connection,transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
mode=sys.argv[1]
tables=['alice_link_alicelink','alice_link_authorizationrequest','alice_link_authorizationcode','alice_link_tokenfamily']
with connection.cursor() as c:
 c.execute("SET lock_timeout='5s'");c.execute("SET statement_timeout='15s'")
ex=MigrationExecutor(connection);plan=ex.migration_plan([('alice_link','0001_initial')])
expected=[('alice_link','0001_initial',False)]
actual=[(m.app_label,m.name,back)for m,back in plan]
if mode=='apply':
 if actual!=expected:raise RuntimeError('Unexpected_migration_plan')
 # MigrationExecutor's atomic schema transaction retains existing customer data.
 ex.migrate([('alice_link','0001_initial')])
 with transaction.atomic():
  with connection.cursor() as c:
   role=connection.ops.quote_name(os.environ['S06_RUNTIME_DB_ROLE'])
   for table in tables:c.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE '+connection.ops.quote_name(table)+' TO '+role)
 applied=MigrationRecorder(connection).applied_migrations()
 if ('alice_link','0001_initial')not in applied:raise RuntimeError('Migration_not_recorded')
else:
 if actual!=expected:raise RuntimeError('Unexpected_migration_plan')
with connection.cursor() as c:
 c.execute('SELECT count(*) FROM accounts_customer');customers=c.fetchone()[0]
 c.execute('SELECT count(*) FROM accounts_tenant');tenants=c.fetchone()[0]
 if mode=='apply':
  for table in tables:
   c.execute('SELECT has_table_privilege(%s,%s,%s)',[os.environ['S06_RUNTIME_DB_ROLE'],table,'SELECT,INSERT,UPDATE,DELETE'])
   if not c.fetchone()[0]:raise RuntimeError('Missing_runtime_table_grant')
print(json.dumps({'mode':mode,'migration_plan':actual,'customers':customers,'tenants':tenants,'alice_tables':tables if mode=='apply'else []}))
'''


def db(mode, alice):
    runtime = config(P('/etc/alisa-platform/stage/platform.env'))
    migration = config(P('/etc/alisa-platform/stage/platform-migration.env'))
    check('same_authorized_platform_database', all(runtime[k] == migration[k] for k in
          ['ALISA_DB_HOST', 'ALISA_DB_PORT', 'ALISA_DB_NAME']))
    check('separate_migration_role', runtime['ALISA_DB_USER'] != migration['ALISA_DB_USER'])
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1',
           **runtime, **alice, **{k: v for k, v in migration.items() if k.startswith('ALISA_DB_')},
           'PYTHONPATH': str(T/'services/platform/src'),
           'DJANGO_SETTINGS_MODULE': 'alisa_platform.config.settings',
           'ALISA_RELEASE': T.name, 'S06_RUNTIME_DB_ROLE': runtime['ALISA_DB_USER']}
    return json.loads(cmd([str(T/'.venv/bin/python'), '-B', '-c', DB_CODE, mode], 45, env))


def preflight():
    resources()
    check('no_previous_activation_attempt', not (D/'activation.private.json').exists() and not E.exists())
    check('own_dropins_fresh', all(not p.exists() and not p.is_symlink() for p in DROPS.values()))
    m = verify_source()
    before = snapshot()
    check('all_components_ready', all(v.get('status') == 'READY' for v in ready().values()))
    check('cleanup_not_running', cmd(['systemctl','show',UNITS[2],'-p','ActiveState','--value']) == 'inactive')
    native = config(P('/etc/alice-lab/lab.env'))
    check('existing_native_client_configured', 1 <= len(native.get('LAB_OAUTH_CLIENT_ID', '')) <= 100
          and len(native.get('LAB_OAUTH_CLIENT_SECRET', '')) >= 32)
    uuid.UUID(native['ALICE_SKILL_ID'])
    alice = {'ALISA_ALICE_LINK_ENABLED': '1', 'ALISA_ALICE_CLIENT_ID': native['LAB_OAUTH_CLIENT_ID'],
             'ALISA_ALICE_CLIENT_SECRET': native['LAB_OAUTH_CLIENT_SECRET'],
             'ALISA_ALICE_SKILL_ID': native['ALICE_SKILL_ID']}
    import base64
    alice['ALISA_ALICE_DATA_KEYS'] = base64.urlsafe_b64encode(os.urandom(32)).decode()
    plan = db('plan', alice)
    check('no_concurrent_scoped_change_during_preflight', scoped(snapshot()) == scoped(before))
    fresh(D/'activation.private.json', json.dumps({'before': before, 'manifest': sha(T/'manifest.json'),
          'alice': alice, 'database_before': plan}).encode())
    record.update(status='PASS', phase='ACTIVATION_PREFLIGHT', source_sha=SOURCE,
                  migration_plan=plan['migration_plan'], free_bytes=shutil.disk_usage('/').free)


def link(target, suffix):
    tmp = B/('web-current.'+suffix)
    check('fresh_pointer_temporary_'+suffix, not tmp.exists() and not tmp.is_symlink())
    tmp.symlink_to(target)
    os.replace(tmp, B/'web-current')


def activate():
    resources()
    p = json.loads((D/'activation.private.json').read_text())
    before = p['before']
    verify_source()
    native = config(P('/etc/alice-lab/lab.env'))
    check('existing_native_client_unchanged', all(native[k] == p['alice'][v] for k, v in
          [('LAB_OAUTH_CLIENT_ID','ALISA_ALICE_CLIENT_ID'),('LAB_OAUTH_CLIENT_SECRET','ALISA_ALICE_CLIENT_SECRET'),('ALICE_SKILL_ID','ALISA_ALICE_SKILL_ID')]))
    check('fresh_configuration_and_service_snapshot', scoped(snapshot()) == scoped(before) and
          sha(T/'manifest.json') == p['manifest'])
    check('fresh_own_config_and_dropins', not E.exists() and all(not q.exists() for q in DROPS.values()))
    check('cleanup_not_running_at_cutover', cmd(['systemctl','show',UNITS[2],'-p','ActiveState','--value']) == 'inactive')
    changed = []
    pointed = False
    try:
        # Retain this root-only keyring on any rollback: additive rows may refer
        # to it after customers start authorizing. Removal is never automatic.
        fresh(E, ''.join(k+'='+shlex.quote(v)+'\n' for k, v in p['alice'].items()).encode())
        result = db('apply', p['alice'])
        record['migration'] = result
        resources(extra=4*1048576)
        check('scoped_snapshot_still_current_after_migration', scoped(snapshot()) == scoped(before))
        for u, component in zip(UNITS, ['web','platform','account-cleanup']):
            q = DROPS[u]
            if not q.parent.exists():
                q.parent.mkdir(mode=0o755)
            lines = '[Service]\n'
            if component != 'web':
                lines += 'WorkingDirectory='+str(T)+'\nExecStart=\nExecStart='+str(T/'.venv/bin/python')+' '+str(T/'infra/launch.py')+' '+component+'\nEnvironmentFile='+str(E)+'\n'
            else:
                lines += 'Environment=ALISA_ALICE_LINK_ENABLED=1\n'
            changed.append((q, lines.encode()))
            fresh(q, lines.encode(), 0o644)
        link(T, 'alice-link-r1')
        pointed = True
        cmd(['systemctl','daemon-reload'])
        for u, component in zip(UNITS, ['web','platform','account-cleanup']):
            props = profile(u)
            check('effective_'+component+'_cutover_profile',
                  (str(T) in props if component != 'web' else str(B/'web-current') in props)
                  and str(DROPS[u]) in props)
        cmd(['systemctl','restart',UNITS[1],UNITS[0]], 40)
        deadline = time.monotonic()+22
        while True:
            try:
                health = ready()
                if all(v.get('status') == 'READY' for v in health.values()) and all(
                        health[k].get('release') == T.name for k in ['18100','18102']):
                    break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Cutover_readiness_timeout')
            time.sleep(.25)
        for u in UNITS[:2]:
            pid = cmd(['systemctl','show',u,'-p','MainPID','--value'])
            check('actual_new_process_'+u, P('/proc/'+pid+'/cwd').resolve().is_relative_to(T))
        after = snapshot()
        check('all_original_environment_files_preserved', after['environments'] == before['environments'])
        check('protected_admin_and_identity_preserved', after['protected'] == before['protected']
              and all(after['profiles'][u] == before['profiles'][u] for u in PROTECTED))
        check('only_web_pointer_changed', all(after['pointers'][n] == v for n, v in before['pointers'].items() if n != 'web-current'))
        resources(extra=0)
        record.update(status='PASS', phase='INSTALLED', source_sha=SOURCE,
                      readiness={k: v.get('status') for k, v in health.items()},
                      legacy_routes_changed=False, native_restart_requested=False,
                      real_yandex_broker='NOT_RUN', free_bytes=shutil.disk_usage('/').free)
    except BaseException:
        # Restore only our own changes. A concurrently replaced file/pointer is
        # a recovery conflict; never overwrite somebody else's newer rollout.
        conflict = False
        # Inspect the actual pointer even if a signal arrived between atomic
        # replacement and assigning pointed=True in the next instruction.
        if (B/'web-current').resolve() == T:
            link(before['pointers']['web-current'], 'alice-link-r1-rollback')
            pointed = True
        elif os.readlink(B/'web-current') != before['pointers']['web-current']:
            conflict = True
        for q, raw in reversed(changed):
            if q.exists():
                if not q.is_symlink() and q.read_bytes() == raw:
                    q.unlink()
                else:
                    conflict = True
        cmd(['systemctl','daemon-reload'])
        if not conflict and (changed or pointed):
            cmd(['systemctl','restart',UNITS[1],UNITS[0]], 40)
        record['recovery'] = 'CONCURRENT_CHANGE_REQUIRES_READBACK' if conflict else 'PRIOR_WEB_API_RESTORED_ADDITIVE_SCHEMA_AND_PRIVATE_KEY_RETAINED'
        raise


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError()))
    phase = sys.argv[1] if len(sys.argv) == 2 else ''
    check('allowed_finite_phase', phase in {'preflight', 'activate'})
    trusted(D, True)
    out = D/(phase+'.json')
    check('fresh_public_receipt', not out.exists())
    with contextlib.ExitStack() as stack:
        for n in ['alisa-stage-rollout.lock', 'alisa-s01-rollout.lock', 'alisa-s02-provider-probe.lock',
                  'alisa-s02-rollout.lock', 'alisa-s03-rollout.lock']:
            f = stack.enter_context(open('/run/lock/'+n, 'a'))
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            (preflight if phase == 'preflight' else activate)()
        except BaseException as e:
            record['error_type'] = type(e).__name__
        finally:
            fresh(out, json.dumps(record, indent=2).encode())
            print(json.dumps(record))
    sys.exit(0 if record['status'] == 'PASS' else 1)
