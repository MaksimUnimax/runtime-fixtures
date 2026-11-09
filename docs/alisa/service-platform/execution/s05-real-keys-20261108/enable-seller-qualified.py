"""Enable the existing qualified Seller check only; preserve source and other services."""
import contextlib,fcntl,hashlib,json,os,pathlib,shutil,stat,subprocess,sys,time,uuid
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108')
CORE=P('/opt/alice-market/releases/20261106-store-check-6098-r1');B=P('/opt/alisa-platform/stage')
UNIT='alisa-store-check.service';DROP=P('/etc/systemd/system/alisa-store-check.service.d/s05-seller-qualified.conf')
LAUNCH='/usr/bin/python3 -B '+str(CORE)+'/store_check_ipc.py --socket /run/alice-market/store-check.sock --allowed-uid 993 --environment stage --enable-kind WB --enable-kind SELLER --enable-kind PERFORMANCE'
CONTENT=('[Service]\nExecStart=\nExecStart='+LAUNCH+' --seller-binding-qualified\n').encode()
HASHES={'store_checker.py':'d5434f76b9f29b7354b246f93371fee794976cea2c84f380857e0e85a1e8ffd0','store_check_ipc.py':'ea9e523a49e95fe13f659562eb6a539f444057c47345f4d5433b7753e4502018','store_check_worker.py':'5db26735109f38503f429e033e7f9ae0c0317ad7b601653a4cc36e118229fc51','shared_http.py':'da3ecbb2ceb2671adda1fd8a4cab7ea4331eb1cd43b0b6a1f70dc9cb12ec34cb','store-check-permissions.py':'e63b20c9079a986120b90daa4dac5edf2ced63516be3f6bb577fd653b7b96905'}
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
record={'scope':'EXISTING_SELLER_QUALIFICATION_FLAG_ONLY_NO_DB_SOURCE_OR_OTHER_SERVICE_CHANGES','status':'FAILED','cases':[]};changed=False;created_directory=False
def command(args):return subprocess.check_output(args,text=True,timeout=20).strip()
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def sources():return {n:sha((CORE/n).read_bytes()) for n in HASHES}
def protected():
 units=['alice-market.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-identity@stage.service','alisa-admin@stage.service']
 return {u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in units}
def pointers():return {n:str((B/n).resolve()) for n in ['web-current','site-current','identity-current','admin-current','current']}
def configs():return {n:sha((P('/etc/alisa-platform/stage')/(n+'.env')).read_bytes()) for n in ['web','platform','identity','admin','platform-migration','identity-migration']}
def profile():
 value=command(['systemctl','show',UNIT,'-p','User,Group,WorkingDirectory,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,MemorySwapMax,TasksMax,TimeoutStopUSec,KillMode,RestrictAddressFamilies,PrivateTmp'])
 pre=command(['systemctl','show',UNIT,'-p','ExecStartPre'])
 check('pinned_root_permissions_launch',('argv[]=/usr/bin/python3 -B '+str(CORE)+'/store-check-permissions.py ;') in pre)
 return value
def env():
 values={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','DJANGO_SETTINGS_MODULE':'alisa_platform.config.settings','PYTHONPATH':str(B/'site-current/services/platform/src')}
 for line in P('/etc/alisa-platform/stage/platform.env').read_text().splitlines():
  if line and not line.startswith('#'):
   k,sep,v=line.partition('=')
   if not sep:raise ValueError()
   values[k]=v
 return values
CHILD="""import sys,json
sys.path.insert(0,'/opt/alisa-platform/stage/site-current/services/platform/src')
from alisa_platform.runtime_adapter.store_check import check_store
v=json.load(sys.stdin);r=check_store(v['pins'],v['credential'])
out={'code':r['code']}
if r['code']=='CONNECTED':out['identity_matches']=r['identity']==v['expected_identity'] if v['pins']['kind']=='SELLER' else r['identity'].startswith('wb:sid:')
print(json.dumps(out))
"""
def ipc_cases():
 oz=json.loads(P('/etc/alice-lab/marketplaces/ozon.json').read_text());wb=json.loads(P('/etc/alice-lab/marketplaces/wb.json').read_text())
 seller={'client_id':str(oz['seller_client_id']),'api_key':oz['seller_api_key']}
 cases=[('seller_actual','SELLER',seller,'CONNECTED'),('seller_wrong_client','SELLER',{**seller,'client_id':str(int(seller['client_id'])+1)},'AUTH_DENIED'),('seller_wrong_key','SELLER',{**seller,'api_key':str(uuid.uuid4())},'AUTH_DENIED'),('performance_preserved','PERFORMANCE',{'client_id':oz['performance_client_id'],'client_secret':oz['performance_client_secret']},'IDENTITY_NOT_VERIFIED'),('wb_preserved','WB',{'token':wb['seller_token']},'CONNECTED')]
 results=[]
 for name,kind,credential,expected in cases:
  pins={'environment':'stage','product_id':'alisa_market','tenant_id':str(uuid.uuid4()),'store_id':str(uuid.uuid4()),'request_id':str(uuid.uuid4()),'provider':'WB' if kind=='WB' else 'OZON','kind':kind,'credential_revision':1,'store_revision':1}
  payload={'pins':pins,'credential':credential,'expected_identity':'ozon:client:'+str(int(seller['client_id']))}
  p=subprocess.run([str(B/'site-current/.venv/bin/python'),'-I','-B','-c',CHILD],env=env(),input=json.dumps(payload),capture_output=True,text=True,timeout=8,user=993,group=985,extra_groups=[982],cwd=CORE)
  check(name+'_child_completed',p.returncode==0)
  result=json.loads(p.stdout);check(name+'_through_installed_adapter_and_socket',result['code']==expected and (expected!='CONNECTED' or result.get('identity_matches') is True))
  results.append({'case':name,**result})
 record['real_installed_ipc']=results
def main():
 global changed,created_directory
 check('private_root_namespace',D.stat().st_uid==D.stat().st_gid==0 and stat.S_IMODE(D.stat().st_mode)==0o700 and not D.is_symlink())
 receipt=json.loads((D/'owner-key-probe.json').read_text());cases={r['case']:r for r in receipt['cases']}
 check('positive_and_both_negative_live_owner_canaries',cases['seller_actual']['http_status']==200 and cases['seller_actual']['expected_company_fields_present'] and cases['seller_wrong_client_canary']['current_product_code']=='AUTH_DENIED' and cases['seller_wrong_key_canary']['current_product_code']=='AUTH_DENIED')
 check('exact_unchanged_checker_and_shared_transport',sources()==HASHES)
 check('no_existing_dropin',not DROP.exists() and not DROP.is_symlink() and not command(['systemctl','show',UNIT,'--value','-p','DropInPaths']))
 launch=command(['systemctl','show',UNIT,'-p','ExecStart']);check('exact_existing_launch',('argv[]='+LAUNCH+' ;') in launch)
 before_profile=profile();before_services=protected();before_pointers=pointers();before_configs=configs()
 before_fragment=P('/etc/systemd/system/alisa-store-check.service').read_bytes()
 with (D/'checker-before.service').open('xb') as f:f.write(before_fragment)
 check('resource_reserve',shutil.disk_usage(B).free>=3072*1048576+65536 and os.statvfs(B).f_favail>=200000)
 if not DROP.parent.exists():DROP.parent.mkdir(mode=0o755);created_directory=True
 s=DROP.parent.lstat();check('root_owned_dropin_directory',stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022)
 with DROP.open('xb') as f:f.write(CONTENT)
 changed=True;DROP.chmod(0o644)
 command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
 check('checker_active',command(['systemctl','is-active',UNIT])=='active')
 check('qualified_launch',('argv[]='+LAUNCH+' --seller-binding-qualified ;') in command(['systemctl','show',UNIT,'-p','ExecStart']))
 check('sandbox_and_source_preserved',profile()==before_profile and sources()==HASHES and P('/etc/systemd/system/alisa-store-check.service').read_bytes()==before_fragment)
 ipc_cases()
 check('other_services_pointers_configs_preserved',protected()==before_services and pointers()==before_pointers and configs()==before_configs)
 check('disk_reserve_retained',shutil.disk_usage(B).free>=3072*1048576)
 record.update(status='PASS',new_flag='--seller-binding-qualified',production_customer_store_changed=False)
if __name__=='__main__':
 out=D/'enable-seller-qualified.json'
 if out.exists() or out.is_symlink():raise SystemExit('Previous outcome retained')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   record['error_type']=type(e).__name__
   if changed and DROP.read_bytes()==CONTENT:
    DROP.unlink()
    if created_directory and not any(DROP.parent.iterdir()):DROP.parent.rmdir()
    command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT]);record['recovery']='OWN_DROPIN_REMOVED_CHECKER_RESTORED'
  finally:
   with out.open('x') as f:json.dump(record,f,indent=2)
   out.chmod(0o600);print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)
