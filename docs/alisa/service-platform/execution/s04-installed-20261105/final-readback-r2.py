"""Read installed S04 evidence; release only this operation's bounded lock holder."""
import os, sys, json, pathlib, hashlib, datetime, subprocess, shutil, urllib.request
import psycopg
sys.dont_write_bytecode = True
os.umask(0o077)
B = pathlib.Path('/opt/alisa-platform/stage')
D = pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105')
E = pathlib.Path('/var/lib/alisa-platform/stage/evidence')
C = pathlib.Path('/etc/alisa-platform/stage')
OUT = E/'AL_S04_QUALIFICATION_WINDOW_RELEASE_R2_20261105.json'
R = 'alisa-c8666516683e7b2b'
UNIT = 'alisa-s04-qualified-window-20261105g003.service'
rec = {'scope':'POST_WINDOW_INSTALLED_READ_ONLY_AND_OWN_LOCK_RELEASE', 'status':'RUNNING',
       'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'cases':[],
       'window_invocation':'0a0794815ed04aefadb673510b37498b',
       'functional_owner_grant_test':'NOT_RUN_AUTHORITY_HANDED_OVER'}
def cmd(args):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=10).stdout
def check(name, ok):
    rec['cases'].append({'case':name,'passed':bool(ok)})
    if not ok: raise RuntimeError(name)
def cfg(n):
    return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
assert not OUT.exists()
try:
    rec['window_before_release'] = cmd(['systemctl','show',UNIT,'-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStatus']).splitlines()
    if 'ActiveState=active' in rec['window_before_release']:
        cmd(['systemctl','stop',UNIT])
    else:
        rec['release_action']='ALREADY_EXPIRED_NO_STOP_NEEDED'
    rec['window_after_release'] = cmd(['systemctl','show',UNIT,'-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStatus']).splitlines()
    check('own_bounded_window_no_longer_active', 'ActiveState=inactive' in rec['window_after_release'])
    check('window_had_clean_exit', 'Result=success' in rec['window_before_release'] and 'ExecMainStatus=0' in rec['window_before_release'])
    p = B/'releases'/R
    raw = (p/'manifest.json').read_bytes(); m = json.loads(raw)
    check('exact_installed_manifest', hashlib.sha256(raw).hexdigest()=='3287fa567545e9598a04e4ba57f7a484814e45195f6cd724bb0532c24b6606f5' and m['source_sha']=='c8666516683e7b2bedc2c1a7d939e9e3c4489d38')
    files={}; links={}
    for f in p.rglob('*'):
        name=f.relative_to(p)
        if name.parts[0]=='.venv': continue
        if f.is_symlink(): links[str(name)] = os.readlink(f)
        elif f.is_file() and str(name)!='manifest.json': files[str(name)] = hashlib.sha256(f.read_bytes()).hexdigest()
    check('all_4433_files_42_links_match', files==m['files'] and links==m['links'] and len(files)==4433 and len(links)==42)
    rec['pointers']={n:(B/n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
    check('current_tuple_c866_and_preserved_identity_482', all(rec['pointers'][n]==R for n in ['web-current','site-current','admin-current']) and all(rec['pointers'][n]=='alisa-482ed11832b666af' for n in ['identity-current','current']))
    check('private_config_modes', all((C/(n+'.env')).stat().st_uid==0 and (C/(n+'.env')).stat().st_mode&0o777==0o600 for n in ['web','platform','admin','identity','platform-migration','identity-migration']))
    check('other_config_bytes_preserved', all((C/(n+'.env')).read_bytes()==(D/'before'/(n+'.env')).read_bytes() for n in ['web','admin','identity','platform-migration','identity-migration']))
    old=(D/'before/platform.env').read_bytes()
    expected=old+(b'' if not old or old.endswith(b'\n') else b'\n')+b'ALISA_ENTITLEMENTS_ENABLED=1\n'
    check('only_platform_capability_flag_added', (C/'platform.env').read_bytes()==expected)
    ingress=json.loads((D/'before/ingress-and-dropin-hashes.private.json').read_text())
    check('ingress_and_dropins_preserved', all(pathlib.Path(n).is_file() and hashlib.sha256(pathlib.Path(n).read_bytes()).hexdigest()==h for n,h in ingress.items()))
    rec['health']={}
    for component,port in [('web',18100),('admin',18101),('platform',18102),('identity',18103)]:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=4) as response: data=json.load(response)
        rec['health'][component]={'status':data.get('status'),'release':data.get('release')}
        check(component+'_ready', data.get('status')=='READY' and data.get('release')==('alisa-482ed11832b666af' if component=='identity' else R))
    rec['public_health']={}
    for component,url in [('web','https://alisa.octoport.ru'),('admin','https://alisa-admin.octoport.ru'),('identity','https://id.octoport.ru')]:
        with urllib.request.urlopen(url+'/health/ready',timeout=5) as response:data=json.load(response)
        rec['public_health'][component]={'status':data.get('status'),'release':data.get('release')}
        check(component+'_canonical_tls_ready',data.get('status')=='READY' and data.get('release')==('alisa-482ed11832b666af' if component=='identity' else R))
    d=cfg('platform')
    with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3) as con:
        con.execute('SET TRANSACTION READ ONLY')
        with con.cursor() as cur:
            cur.execute("SELECT count(*) FROM django_migrations WHERE app='entitlements' AND name='0001_initial'")
            check('single_entitlements_migration_present', cur.fetchone()[0]==1)
            for table in ['accessgrant','accessadjustment','accesspreview']:
                for permission in ['UPDATE','DELETE','TRUNCATE']:
                    cur.execute('SELECT has_table_privilege(current_user,%s,%s)',['entitlements_'+table,permission])
                    check(table+'_'+permission.lower()+'_denied',not cur.fetchone()[0])
            cur.execute('SELECT count(*) FROM entitlements_accessgrant');rec['current_grant_count']=cur.fetchone()[0]
            cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id')
            fingerprint=hashlib.sha256(json.dumps(cur.fetchall(),default=str).encode()).hexdigest()
            rec['staff_authority_fingerprint']=fingerprint
            check('staff_authority_still_matches_activation',fingerprint==json.loads((E/'AL_S04_ACTIVATION_20261105.json').read_text())['staff_authority_before_fingerprint'])
    for name in ['AL_S04_PACKAGE_INSTALL_20261105.json','AL_S04_ACTIVATION_20261105.json','AL_S04_CUSTOMER_READBACK_20261105.json']:
        check(name+'_passed',json.loads((E/name).read_text())['status']=='PASS')
    rec['procedure_sha256']={n:hashlib.sha256((D/n).read_bytes()).hexdigest() for n in ['install-package.py','activate.py','customer-readback.py','inactive-runtime-dedup.py','inactive-vendor-dedup.py','ci-binding.json']}
    rec['resources']={'disk_free_mib':shutil.disk_usage(B).free//1048576,'free_inodes':os.statvfs(B).f_favail}
    mem=dict((l.split(':',1)[0],int(l.split(':',1)[1].strip().split()[0])) for l in pathlib.Path('/proc/meminfo').read_text().splitlines())
    rec['resources']['mem_available_mib']=mem['MemAvailable']//1024
    check('resource_reserve_preserved',rec['resources']['disk_free_mib']>=3072 and rec['resources']['free_inodes']>=200000 and rec['resources']['mem_available_mib']>=1024)
    units=['alisa-s04-install-20261105g001.service','alisa-s04-activate-20261105g001.service','alisa-s04-customer-20261105g001.service','alisa-s04-runtime-reserve-20261105g001.service','alisa-s04-reserve-20261105g001.service']
    rec['bounded_units']={u:cmd(['systemctl','show',u,'-p','ActiveState','-p','SubState','-p','Result','-p','ExecMainStatus']).splitlines() for u in units}
    check('all_own_previous_bounded_units_closed',all('ActiveState=inactive' in value for value in rec['bounded_units'].values()))
    rec['status']='PASS'
except Exception as error:
    rec['status']='FAILED';rec['error_type']=type(error).__name__
    if isinstance(error,RuntimeError):rec['failed_case']=str(error)
finally:
    rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    OUT.write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec))
sys.exit(0 if rec['status']=='PASS' else 1)
