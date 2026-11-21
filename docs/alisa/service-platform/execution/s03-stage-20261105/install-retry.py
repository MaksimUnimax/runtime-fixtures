"""Finite approved exact S03 offline install and private snapshots, no activation."""
import os,sys,json,pathlib,datetime,hashlib,shutil,subprocess,urllib.request,zipfile,fcntl,contextlib,importlib.util
os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');C=pathlib.Path('/etc/alisa-platform/stage')
sys.path.append(str(B/'releases/alisa-6ae348354b3db0d3/.venv/lib/python3.12/site-packages'))
import psycopg
rec={'record_type':'AUTHORIZED_S03_STAGE_EXACT_INSTALL','source_sha':'3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae','artifact_sha256':'b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21','plan_sha256':'7efbcf47e2ea5f8c0ec1245a9108037c482b506fbae11975841f28615344572d','owner_allowance':'User explicitly answered да to exact stage plan','status':'RUNNING','started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[]}
def check(name,ok):
 rec['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def cfg(n):return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
def pg_env(d):return {**os.environ,**{p:d[k] for p,k in [('PGHOST','ALISA_DB_HOST'),('PGPORT','ALISA_DB_PORT'),('PGDATABASE','ALISA_DB_NAME'),('PGUSER','ALISA_DB_USER'),('PGPASSWORD','ALISA_DB_PASSWORD')]}}
def run():
 output=D/'install-retry-result.json';assert not output.exists()
 with (D/'install-retry-private.log').open('w') as log:
  try:
   expected={'current':'alisa-77d0f8ee2643ef65','web-current':'alisa-e82003211bdcd687','site-current':'alisa-6ae348354b3db0d3','identity-current':'alisa-e82003211bdcd687','admin-current':'alisa-e82003211bdcd687'}
   check('approved_pointer_baseline',all((B/n).resolve().name==v for n,v in expected.items()))
   check('resources_before_install',shutil.disk_usage(B).free>=(3072+650)*1048576 and os.statvfs(B).f_favail>=200000)
   check('candidate_not_previously_installed',not (B/'releases'/R).exists())
   check('prior_private_snapshots_available',all((D/'before'/n).is_file() for n in ['platform.dump','identity.dump','database-baseline.json']))
   blob=D/'package-input.json';blob.chmod(0o600);data=json.loads(blob.read_text());archive=D/'package.zip'
   with urllib.request.urlopen(data['url'],timeout=50) as response,archive.open('wb') as dest:shutil.copyfileobj(response,dest)
   check('download_zip_sha256',hashlib.sha256(archive.read_bytes()).hexdigest()==data['zip_sha256'])
   with zipfile.ZipFile(archive) as z:
    check('download_zip_exact_file_allowlist',set(z.namelist())=={R+'.tar.gz',R+'.tar.gz.sha256'})
    for n in z.namelist():
     with z.open(n) as inp,(D/n).open('wb') as out:shutil.copyfileobj(inp,out)
   tar=D/(R+'.tar.gz');check('exact_tar_sha256',hashlib.sha256(tar.read_bytes()).hexdigest()==data['tar_sha256']);blob.unlink()
   spec=importlib.util.spec_from_file_location('owned_release',B/'releases/alisa-6ae348354b3db0d3/infra/release.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
   with contextlib.redirect_stdout(log),contextlib.redirect_stderr(log):
    # subprocess inherits OS descriptors; keep installer output private too.
    subprocess.run(['/usr/bin/python3',str(B/'releases/alisa-6ae348354b3db0d3/infra/release.py'),'deploy','--env','stage','--artifact',str(tar),'--sha256',data['tar_sha256']],stdout=log,stderr=log,check=True,timeout=150)
   release.installed_release(B,R);check('installed_manifest_all_files_and_links_verified',True)
   check('no_pointers_activated',all((B/n).resolve().name==v for n,v in expected.items()))
   archive.unlink();check('resource_reserve_after_install',shutil.disk_usage(B).free>=3072*1048576)
   rec['free_mib_after']=shutil.disk_usage(B).free//1048576;rec['status']='PASS_INSTALLED_NOT_ACTIVATED'
  except Exception as ex:
   rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  finally:
   rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();output.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS_INSTALLED_NOT_ACTIVATED'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
