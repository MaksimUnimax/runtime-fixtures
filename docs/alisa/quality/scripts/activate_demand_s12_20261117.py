"""Finite, leased three-role S12 delivery; keep history on disable/recovery.

plan writes only a private receipt. apply changes six new tables and three owned
systemd drop-ins. recover disables S12 without downgrading a migrated schema.
No owner session, provider request, coefficient, access grant or Station change.
"""
from pathlib import Path
import fcntl, hashlib, http.client, importlib.util, json, os, re, runpy
import socket, stat, subprocess, sys, time

ROOT=Path('/root/alisa-demand-s12-13f01118-prepare-20261117')
SOURCE='13f01118c7402814ba96cf42e8a75635220fbb45'
PRIMITIVES=Path('/root/alisa-login-catalog-install-20261115/install.py')
PRIMITIVES_SHA='73a13e0d510901aed20b0aace60387720769f184e6b2c5c653b60dcb1b3b7862'
STAGE=Path('/opt/alisa-platform/stage/releases')
ROLES={
 'platform':('alisa-platform@stage.service','alisa-coefficient-station-platform-485a2034ac0dc36f',
  'b489d1f5ee7bea8fc8cd495c516fc05c605bf3eae4dede2bef64c62566111b6c',
  'alisa-demand-platform-13f01118c7402814','3de5506935f76e482560076facc683815e4963aecede144f88b8fb267a563d1a'),
 'admin':('alisa-admin@stage.service','alisa-question-catalog-d4eb0ccf798fbb45',
  'f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579',
  'alisa-demand-admin-13f01118c7402814','d27bc1c64f7104ffaf02091cc65fc695dfcf93684748fac9cae9196346b53ff7'),
 'authority':('alisa-runtime-authority-stage.service','alisa-economics-r15-authority-cafb743c94672104',
  '8c0c364ebba9292817519cd15db4a4a6b105e5e4ab1b219f5a1faa36e5d10935',
  'alisa-demand-authority-13f01118c7402814','58261d96e9140bf402e5a3d60809b4305683298e327b4929c0533eede2a4a2cf'),
}
PRESERVE=('alice-market.service','alisa-station.service','alisa-web@stage.service',
 'alisa-identity@stage.service','alisa-store-check.service','alisa-smtp-sandbox-stage.service')
UNITS=tuple(v[0]for v in ROLES.values())+PRESERVE
NAME='z'*180+'-demand-s12.conf'
PROPS=('MainPID','ActiveState','WorkingDirectory','FragmentPath','DropInPaths',
 'EnvironmentFiles','ExecStart','Restart','RefuseManualStart')


def need(value,code):
 if not value:raise RuntimeError(code)


def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()


def run(*args,timeout=15):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 need(p.returncode==0,'COMMAND_FAILED_'+Path(args[0]).name)
 return p.stdout.strip()


def props(unit):
 raw=run('systemctl','show',unit,*['--property='+p for p in PROPS])
 return dict(line.split('=',1)for line in raw.splitlines())


def drop(role):return Path('/etc/systemd/system')/(ROLES[role][0]+'.d')/NAME


def state(path):
 p=Path(path);s=p.lstat()
 need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'UNSAFE_CONFIG')
 return [s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,sha(p)]


def configuration(units):
 result={}
 for v in units.values():
  paths=[v['FragmentPath']]+v['DropInPaths'].split()
  paths+=re.findall(r'(\S+) \(ignore_errors=(?:yes|no)\)',v['EnvironmentFiles'])
  for p in paths:
   need(p.startswith('/etc/')or p.startswith('/usr/lib/')or p.startswith('/lib/'),'CONFIG_SCOPE')
   result[p]=state(p)
   if p.endswith('.env'):
    need(not re.search(rb'^\s*ALISA_QUERY_DEMAND_ENABLED\s*=',Path(p).read_bytes(),re.M),
         'DEMAND_FLAG_ALREADY_CONFIGURED')
 return result


def snapshot():
 result={u:props(u)for u in UNITS}
 for u,v in result.items():
  need(v['ActiveState']=='active'and int(v['MainPID'])>0,'SERVICE_NOT_ACTIVE')
  v['actual_cwd']=os.readlink('/proc/'+v['MainPID']+'/cwd')
 return result


def record(name,value):
 h.atomic(ROOT/name,(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())


def verify_candidates():
 for role,(_,base,bpin,target,tpin)in ROLES.items():
  b,t=STAGE/base,STAGE/target
  need(sha(b/'manifest.json')==bpin and sha(t/'manifest.json')==tpin,'RELEASE_CHANGED')
  h.manifest(b);h.candidate_manifest(t,b)
  for p in (b,t):
   need(p.is_dir()and not p.is_symlink()and p.stat().st_uid==0,'UNSAFE_RELEASE')


def config_guard(plan):
 need({p:state(p)for p in plan['configuration']}==plan['configuration'],'FOREIGN_CONFIG_CHANGED')


def selection_guard(plan):
 for role,(u,*_)in ROLES.items():
  now=props(u);old=plan['units'][u]
  expected=old['DropInPaths'].split()+([str(drop(role))]if os.path.lexists(drop(role))else[])
  need(now['DropInPaths'].split()==expected and now['FragmentPath']==old['FragmentPath']and
       now['EnvironmentFiles']==old['EnvironmentFiles'],'FOREIGN_UNIT_SELECTION')
  if os.path.lexists(drop(role)):
   need(state(drop(role))[-1]in own_hashes(role,plan),'FOREIGN_SELECTOR')


def preserved(plan):
 for u in PRESERVE:
  v=props(u);v['actual_cwd']=os.readlink('/proc/'+v['MainPID']+'/cwd')
  need(v==plan['units'][u],'PRESERVED_SERVICE_CHANGED')


def content(role,plan,mode,enabled=False):
 old=plan['units'][ROLES[role][0]]
 if mode=='fence':
  return b'[Unit]\nRefuseManualStart=yes\n[Service]\nRestart=no\n'
 root=STAGE/ROLES[role][3]
 if role=='authority':
  wd=root/'services/platform'
  start=(f'{root}/.venv/bin/python -B -m gunicorn alisa_platform.config.wsgi:application '
   f'--pythonpath {wd}/src --env ALISA_ALLOWED_HOSTS=localhost --env ALISA_RELEASE={root.name} '
   '--bind unix:/run/alisa-runtime-rpc/authority/authority.sock --workers 1 --threads 4 '
   '--timeout 10 --no-control-socket --umask 0o007 --access-logfile - '
   '--access-logformat "%%(m)s %%(U)s %%(s)s" --error-logfile -')
 else:
  wd=root;start=f'{root}/.venv/bin/python {root}/infra/launch.py {role}'
 return (f'[Unit]\nRefuseManualStart={"yes"if mode=="held"else"no"}\n[Service]\n'
  f'Restart={old["Restart"]}\nWorkingDirectory={wd}\n'
  f'Environment=ALISA_RELEASE={root.name}\nEnvironment=ALISA_QUERY_DEMAND_ENABLED={int(enabled)}\n'
  'Environment=PYTHONDONTWRITEBYTECODE=1\nExecStart=\nExecStart='+start+'\n').encode()


def own_hashes(role,plan):
 return {hashlib.sha256(content(role,plan,m,e)).hexdigest()
         for m in ('fence','held','selected')for e in (False,True)}


def final_selection(plan,enabled):
 selection_guard(plan)
 for role,(u,_,_,target,_)in ROLES.items():
  need(state(drop(role))[-1]==hashlib.sha256(content(role,plan,'selected',enabled)).hexdigest(),
       'FINAL_SELECTOR_CHANGED')
  v=props(u);wd=str(STAGE/target)+('/services/platform'if role=='authority'else'')
  need(v['WorkingDirectory']==wd and v['RefuseManualStart']=='no'and
       v['Restart']==plan['units'][u]['Restart'],'FINAL_UNIT_CHANGED')


def select(role,plan,mode,enabled=False):
 p=drop(role);expected=h.path_state(p)
 need(expected is None or (state(p)[-1]in own_hashes(role,plan)),'FOREIGN_SELECTOR')
 temp=p.with_name('.'+p.name+'.s12-new')
 need(h.path_state(temp)is None,'SELECTOR_TEMP_EXISTS')
 h.atomic(temp,content(role,plan,mode,enabled),0o644)
 staged=h.path_state(temp)
 h.replace_selection(p,temp,expected,staged)
 need(state(p)[-1]==hashlib.sha256(content(role,plan,mode,enabled)).hexdigest(),'SELECTOR_NOT_OWNED')


def stop_all():
 run('systemctl','--no-block','stop',*ROLES_UNITS)
 deadline=time.monotonic()+40
 while True:
  stopped=True
  for u in ROLES_UNITS:
   p={k:run('systemctl','show',u,'--value','--property='+k)for k in ('MainPID','ControlPID','ActiveState','ControlGroup')}
   stopped&=p['MainPID']=='0'and p['ControlPID']=='0'and p['ActiveState']in ('inactive','failed')
   group=Path('/sys/fs/cgroup')/p['ControlGroup'].lstrip('/')/'cgroup.events'
   if p['ControlGroup']and group.exists():stopped&='populated 0'in group.read_text()
  if stopped:return
  need(time.monotonic()<deadline,'DRAIN_UNRESOLVED');time.sleep(.2)


def held():
 for u in ROLES_UNITS:
  need(run('systemctl','show',u,'--value','--property=RefuseManualStart')=='yes','START_FENCE_LOST')


class UnixConnection(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(self.timeout)
  self.sock.connect('/run/alisa-runtime-rpc/authority/authority.sock')


def health(role,target):
 c=UnixConnection('localhost',timeout=2)if role=='authority'else http.client.HTTPConnection(
   '127.0.0.1',18101 if role=='admin'else 18102,timeout=2)
 try:
  c.request('GET','/health/ready');r=c.getresponse();raw=r.read(8193)
  need(r.status==200 and len(raw)<=8192 and json.loads(raw)['release']==target,'HEALTH_RELEASE')
 finally:c.close()


def ready(role,target,enabled):
 deadline=time.monotonic()+30
 while True:
  try:
   u=ROLES[role][0];p=props(u)
   need(p['ActiveState']=='active'and int(p['MainPID'])>0,'ROLE_NOT_RUNNING')
   env=dict(x.split(b'=',1)for x in Path('/proc/'+p['MainPID']+'/environ').read_bytes().split(b'\0')if b'='in x)
   need(env.get(b'ALISA_QUERY_DEMAND_ENABLED')==str(int(enabled)).encode(),'FLAG_NOT_EFFECTIVE')
   health(role,target);return
  except (OSError,RuntimeError,ValueError,http.client.HTTPException):
   need(time.monotonic()<deadline,'ROLE_NOT_READY_'+role);time.sleep(.3)


def database(operation):
 root=STAGE/ROLES['platform'][3];entry=root/'bin/alisa'
 manifest=json.loads((root/'manifest.json').read_text())
 need(sha(entry)==manifest['files']['bin/alisa'],'CONFIG_LOADER_CHANGED')
 env=runpy.run_path(str(entry))['config']('stage','platform'if operation=='runtime_privileges'else'platform-migration')
 env.update(PYTHONDONTWRITEBYTECODE='1',ALISA_QUERY_DEMAND_ENABLED='0',
  PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=3000'+
   (' -c default_transaction_read_only=on'if operation!='apply'else''))
 args=[str(root/'.venv/bin/python'),'-B',str(root/'services/platform/manage.py')]
 if operation=='apply':args+=['migrate','query_insights','0002_demand_queue','--noinput']
 elif operation=='status':
  args+=['shell','-c',"from django.db import connection; c=connection.cursor(); c.execute(\"SELECT COUNT(*) FROM django_migrations WHERE app='query_insights' AND name='0002_demand_queue'\"); print('S12_MIGRATED='+str(c.fetchone()[0]))"]
 else:
  args+=['shell','-c',"from django.db import connection; c=connection.cursor(); c.execute(\"SELECT bool_and(has_table_privilege(current_user,'query_insights_demand'||t,p)) FROM unnest(ARRAY['policy','cluster','contribution','receipt','candidate','decision']) t CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p\"); print('S12_RUNTIME_PRIVILEGES='+str(c.fetchone()[0]))"]
 result=subprocess.run(args,cwd=root,env=env,capture_output=True,text=True,timeout=45)
 need(len(result.stdout)+len(result.stderr)<32768,'MIGRATION_OUTPUT_BOUND')
 if operation=='apply':
  record('MIGRATION_RESULT.json',{'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
 need(result.returncode==0,'MIGRATION_'+operation.upper()+'_FAILED')
 if operation=='runtime_privileges':need('S12_RUNTIME_PRIVILEGES=True'in result.stdout,'RUNTIME_PRIVILEGES_MISSING')
 return 'S12_MIGRATED=1'in result.stdout if operation=='status'else None


def start_selected(plan,enabled):
 for role in ROLES:select(role,plan,'held',enabled)
 run('systemctl','daemon-reload');selection_guard(plan);held()
 for role in ('platform','authority'):select(role,plan,'selected',enabled)
 run('systemctl','daemon-reload');selection_guard(plan);config_guard(plan);preserved(plan)
 run('systemctl','start',ROLES['platform'][0],ROLES['authority'][0],timeout=40)
 for role in ('platform','authority'):ready(role,ROLES[role][3],enabled)
 select('admin',plan,'selected',enabled);run('systemctl','daemon-reload');selection_guard(plan)
 run('systemctl','start',ROLES['admin'][0],timeout=35);ready('admin',ROLES['admin'][3],enabled)
 final_selection(plan,enabled)


def recover(plan):
 config_guard(plan);preserved(plan);selection_guard(plan)
 for role in ROLES:
  p=drop(role)
  need(h.path_state(p)is None or state(p)[-1]in own_hashes(role,plan),'FOREIGN_RECOVERY_SELECTOR')
 for role in ROLES:select(role,plan,'fence')
 run('systemctl','daemon-reload');selection_guard(plan);held();stop_all()
 if database('status'):
  start_selected(plan,False);final_selection(plan,False);outcome='DISABLED_KEEP_COMPATIBLE_MODELS_AND_HISTORY'
 else:
  for role in ROLES:
   p=drop(role);h.replace_selection(p,None,h.path_state(p))
  run('systemctl','daemon-reload');selection_guard(plan);run('systemctl','start',*ROLES_UNITS,timeout=40)
  for role in ROLES:health(role,ROLES[role][1])
  outcome='BASE_RESTORED_BEFORE_MIGRATION'
 config_guard(plan);preserved(plan)
 record('ACTIVATION_RECOVERED.json',{'source':SOURCE,'outcome':outcome,'enabled':False,'down_migration':False})


def main():
 need(os.geteuid()==0,'ROOT_REQUIRED');need(sha(PRIMITIVES)==PRIMITIVES_SHA,'PRIMITIVES_CHANGED')
 global h
 spec=importlib.util.spec_from_file_location('accepted_s12_selector_primitives',PRIMITIVES)
 h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
 fd=os.open('/run/lock/alisa-stage-rollout.lock',os.O_RDWR|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd);p=os.stat('/run/lock/alisa-stage-rollout.lock',follow_symlinks=False)
  need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022 and
       (s.st_dev,s.st_ino)==(p.st_dev,p.st_ino),'ROLLOUT_LOCK_CHANGED')
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);h.reserve();verify_candidates()
  action=sys.argv[1]
  if action=='plan':
   need(len(sys.argv)==2 and not(ROOT/'ACTIVATION_PLAN.json').exists(),'REVIEW_PREVIOUS_PLAN')
   units=snapshot();config=configuration(units)
   for role,(u,base,_,_,_)in ROLES.items():
    expected=str(STAGE/base)+('/services/platform'if role=='authority'else'')
    need(units[u]['WorkingDirectory']==expected,'ACTIVE_BASE_MOVED')
    need(units[u]['RefuseManualStart']=='no','BASE_MANUAL_START_REFUSED')
    p=drop(role);need(not p.parent.is_symlink()and p.parent.stat().st_uid==0,'DROP_DIR_CHANGED')
    need(not os.path.lexists(p)and all(Path(x).name<NAME for x in units[u]['DropInPaths'].split()),'SELECTOR_OCCUPIED')
    health(role,base)
   need(not database('status'),'ALREADY_MIGRATED')
   value={'source':SOURCE,'installer_sha256':sha(__file__),'units':units,'configuration':config,
          'scope':'six new demand tables and three systemd drop-ins; no grants or owner writes',
          'recovery':'recover with this exact plan digest; keep compatible models and history after migration'}
   record('ACTIVATION_PLAN.json',value)
   print(json.dumps({'status':'PLAN_ONLY','plan_sha256':sha(ROOT/'ACTIVATION_PLAN.json')}));return
  need(action in ('apply','recover')and len(sys.argv)==3,'ACTION_INVALID')
  path=ROOT/'ACTIVATION_PLAN.json';need(sha(path)==sys.argv[2],'PLAN_CHANGED');plan=json.loads(path.read_text())
  need(plan['source']==SOURCE and plan['installer_sha256']==sha(__file__),'INSTALLER_CHANGED')
  config_guard(plan);preserved(plan);selection_guard(plan)
  if action=='recover':
   need((ROOT/'ACTIVATION_INTENT.json').exists(),'NO_ACTIVATION_TO_RECOVER')
   recover(plan);print('RECOVERY_COMPLETED');return
  need(not(ROOT/'ACTIVATION_INTENT.json').exists(),'REVIEW_PREVIOUS_OUTCOME')
  need(snapshot()==plan['units']and all(not os.path.lexists(drop(r))for r in ROLES),'ACTIVATION_LEASE_CHANGED')
  record('ACTIVATION_INTENT.json',{'source':SOURCE,'plan_sha256':sys.argv[2],'installer_sha256':sha(__file__)})
  try:
   for role in ROLES:select(role,plan,'fence')
   run('systemctl','daemon-reload');selection_guard(plan);held();stop_all();config_guard(plan);preserved(plan)
   database('apply');need(database('status'),'MIGRATION_NOT_RECORDED')
   database('runtime_privileges')
   config_guard(plan);preserved(plan);held();start_selected(plan,True)
   config_guard(plan);preserved(plan);final_selection(plan,True);h.reserve()
   record('ACTIVATED.json',{'source':SOURCE,'status':'INSTALLED_HEALTH_READY','feature_enabled':True,
    'migration':'query_insights.0002_demand_queue','roles':list(ROLES),'owner_acceptance':'NOT_RUN',
    'station_native_and_permissions_preserved':True})
   print(json.dumps({'status':'INSTALLED_HEALTH_READY','source':SOURCE,'owner_acceptance':'NOT_RUN'}))
  except BaseException:
   try:record('ACTIVATION_INTERRUPTED.json',{'source':SOURCE,'recovery_required':True})
   finally:recover(plan)
   raise
 finally:os.close(fd)


ROLES_UNITS=tuple(v[0]for v in ROLES.values())
if __name__=='__main__':main()
