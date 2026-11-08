"""Remove our artificial DeepSeek daily budget without touching provider limits."""
import contextlib, fcntl, hashlib, json, os, shutil, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path

OLD=Path('/opt/alice-market/releases/alisa-runtime-read-surface-r3-20261108')
NEW=Path('/opt/alice-market/releases/alisa-runtime-model-unlimited-r1-20261108')
DROP=Path('/etc/systemd/system/alice-market.service.d/zzzzzzzzzzzzzzzzzzzzzzz-model-unlimited-r1.conf')
DB='/var/lib/alice-market/state.sqlite3'
EXPECTED={'engine.py':'177f44e051e1028e03cebbede3f158d031a69751e1a5c3fce3fda1daccd8eec9',
          'repository.py':'05ec81063042d6926fd44c3f7f3057aacac50ca11ded1b432ac339e749d3d4e5',
          'resource_limits.json':'353a0fc46d46ce8dc643f11cd76f4b2e3c2d521cb64226650163a6bf586837ca'}
OLD_ARG=f'/usr/bin/python3 -B {OLD}/runtime.py --config /etc/alice-market/market-runtime.json'
NEW_ARG=f'/usr/bin/python3 -B {NEW}/runtime.py --config /etc/alice-market/market-runtime.json'
REPORT=Path('/run/alisa-model-unlimited-r1.json')
checks=[];cut=False;rescheduled=False
def run(args,timeout=25,**kw):
 r=subprocess.run(args,capture_output=True,timeout=timeout,**kw)
 if r.returncode:raise RuntimeError('command_failed_'+str(args[:2]))
 return r.stdout.decode()
def check(name,value):
 checks.append({'name':name,'passed':bool(value)})
 if not value:raise RuntimeError(name)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def argv():
 s=run(['systemctl','show','alice-market','--value','--property=ExecStart'],5)
 return s.split('argv[]=',1)[1].split(' ;',1)[0]
def replace(path,old,new):
 source=path.read_text()
 check('unique_patch_'+path.name,source.count(old)==1)
 target=source.replace(old,new)
 temp=path.with_name(path.name+'.new')
 temp.write_text(target);os.chmod(temp,0o644);os.replace(temp,path)
def test():
 env=dict(os.environ,PYTHONPATH=str(NEW),TMPDIR='/run',PYTHONDONTWRITEBYTECODE='1')
 run(['/usr/bin/python3','-B','-m','unittest','discover','-s','tests','-p','test_query_program.py'],40,cwd=NEW,env=env)
 code='''import tempfile,time,sqlite3\nfrom engine import validate_model_budget\nfrom repository import Repository,Deferred\nfrom semantics import Rejected\nassert validate_model_budget({'schema':'alice-model-budget/v1','daily_calls':0,'min_interval_seconds':2})['daily_calls']==0\nwith tempfile.TemporaryDirectory(dir='/run') as d:\n t=[1000.0];r=Repository(d+'/test.db',clock=lambda:t[0]);\n with r.connection(True) as c:c.execute("INSERT INTO jobs(id,tenant,key,state,draft,created,updated,due,owner,lease) VALUES('j','A','k','RUNNING','{}',1000,1000,1000,'o',2000)")\n for i in range(25):r.reserve('j','o','model:deepseek-flash',2,0);t[0]+=2\n assert r.call_count()==25\n r.reserve('j','o','provider:limited',1,1);t[0]+=2\n try:r.reserve('j','o','provider:limited',1,1)\n except Deferred:pass\n else:raise AssertionError('provider_limit_removed')\n try:r.reserve('j','o','provider:limited',1,0)\n except Rejected:pass\n else:raise AssertionError('zero_for_non_model')\n'''
 run(['/usr/bin/python3','-B','-c',code],20,cwd=NEW,env=env)
 check('model_unlimited_provider_limited',True)
def reschedule():
 global rescheduled
 jobs=[]
 for p in Path('/var/lib/alisa-station/users').glob('*/state.json'):
  j=json.loads(p.read_text()).get('job')
  if j and j['delivery']=='manual':jobs.append((j['jid'],j['tenant']))
 check('one_waiting_owner_job',len(jobs)==1)
 code='''import json,sqlite3,time,sys\nfrom pathlib import Path\njob,tenant=json.loads(sys.stdin.read());c=sqlite3.connect(sys.argv[1],timeout=2);now=time.time()\nc.execute('BEGIN IMMEDIATE');r=c.execute('SELECT due,state FROM jobs WHERE id=? AND tenant=?',(job,tenant)).fetchone()\nassert r and r[1]=='QUEUED' and r[0]>now+3600\nc.execute('UPDATE jobs SET due=?,updated=? WHERE id=? AND tenant=? AND state=?',(now,now,job,tenant,'QUEUED'));assert c.total_changes==1;c.commit();print('DEFERRED_JOB_RESCHEDULED')\n'''
 proc=subprocess.run(['runuser','-u','alice-market','--','/usr/bin/python3','-B','-c',code,DB],input=json.dumps(jobs[0]).encode(),capture_output=True,timeout=8)
 check('queued_job_rescheduled',proc.returncode==0 and b'DEFERRED_JOB_RESCHEDULED' in proc.stdout)
 rescheduled=True
 # The already connected sidecar will silently poll this job and still speak READY.
 run(['systemctl','stop','alisa-station'],12)
 p=next(p for p in Path('/var/lib/alisa-station/users').glob('*/state.json') if (json.loads(p.read_text()).get('job') or {}).get('jid')==jobs[0][0])
 s=json.loads(p.read_text());check('same_connected_station',s['connected'] and s['binding'] and s['job']['delivery']=='manual')
 s['job']['delivery']='waiting';s['job']['message']=3;s['job']['next_at']=time.time()+10;s['generation']+=1
 fd,name=tempfile.mkstemp(prefix='state-unlimited-',dir=p.parent)
 with os.fdopen(fd,'wb') as f:
  os.fchmod(f.fileno(),0o600);f.write(json.dumps(s,ensure_ascii=False).encode());f.flush();os.fsync(f.fileno())
 os.replace(name,p);run(['systemctl','start','alisa-station'],12)
 check('station_connection_retained',json.loads(p.read_text())['connected'])
def main():
 global cut
 check('root',os.geteuid()==0)
 check('exact_current_runtime',argv()==OLD_ARG and not NEW.exists() and not DROP.exists())
 check('source_integrity',all(sha(OLD/n)==v for n,v in EXPECTED.items()))
 check('space',shutil.disk_usage('/').free>3072*1048576+1000000)
 shutil.copytree(OLD,NEW,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 replace(NEW/'engine.py',"or not 1<=value['daily_calls']<=100 or type(value['min_interval_seconds']) is not int", "or not 0<=value['daily_calls']<=100 or type(value['min_interval_seconds']) is not int")
 replace(NEW/'repository.py',"if interval<1 or daily_limit<1: raise Rejected('RATE_CONFIG')", "if interval<1 or daily_limit<0 or (daily_limit==0 and source!='model:deepseek-flash'): raise Rejected('RATE_CONFIG')")
 replace(NEW/'repository.py',"recent = c.execute('SELECT at FROM calls WHERE source=? AND at>? ORDER BY at',(source,now-86400)).fetchall()\n            if len(recent)>=daily_limit: raise Deferred(recent[-daily_limit]['at']+86400)", "if daily_limit:\n                recent = c.execute('SELECT at FROM calls WHERE source=? AND at>? ORDER BY at',(source,now-86400)).fetchall()\n                if len(recent)>=daily_limit: raise Deferred(recent[-daily_limit]['at']+86400)")
 replace(NEW/'resource_limits.json','"daily_calls": 20','"daily_calls": 0')
 replace(NEW/'tests/test_query_program.py',"for n in (0,-1,True,101,'20'):","self.assertEqual(validate_model_budget({'schema':'alice-model-budget/v1','daily_calls':0,'min_interval_seconds':2})['daily_calls'],0)\n        for n in (-1,True,101,'20'):")
 check('source_not_modified',all(sha(OLD/n)==v for n,v in EXPECTED.items()))
 test();check('pre_cutover_pointer',argv()==OLD_ARG)
 DROP.write_text('[Service]\nWorkingDirectory='+str(NEW)+'\nExecStart=\nExecStart='+NEW_ARG+'\n')
 run(['systemctl','daemon-reload']);check('new_pointer',argv()==NEW_ARG)
 cut=True
 run(['systemctl','restart','alice-market'],15)
 for i in range(30):
  if run(['systemctl','is-active','alice-market'],5).strip()=='active':break
  time.sleep(.2)
 check('new_runtime_active',argv()==NEW_ARG)
 reschedule()
 check('station_active',run(['systemctl','is-active','alisa-station'],5).strip()=='active')
def rollback():
 if not cut:return 'NO_CUTOVER'
 if argv()!=NEW_ARG:return 'FOREIGN_CHANGE_PRESERVED'
 DROP.unlink(missing_ok=True);run(['systemctl','daemon-reload']);run(['systemctl','restart','alice-market'],15)
 try:run(['systemctl','start','alisa-station'],12)
 except Exception:pass
 return 'PREVIOUS_RUNTIME_RESTORED'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ('alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock'):
   f=stack.enter_context(open('/run/lock/'+n,'a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  status='FAILED';error=None;restoration=None
  try:main();status='INSTALLED'
  except Exception as e:
   error=str(e) if isinstance(e,RuntimeError) else type(e).__name__
   try:restoration=rollback()
   except Exception as x:restoration='ROLLBACK_FAILED_'+type(x).__name__
  REPORT.write_text(json.dumps({'status':status,'checks':checks,'rescheduled':rescheduled,'error':error,'rollback':restoration},indent=2)+'\n')
  print(json.dumps({'status':status,'checks':checks,'rescheduled':rescheduled,'error':error,'rollback':restoration}))
  sys.exit(0 if status=='INSTALLED' else 1)
