"""Retain another actor's finished native-core/checker restart; activate Identity only."""
import contextlib,fcntl,hashlib,importlib.util,json,os,signal,sys
from pathlib import Path as P
sys.dont_write_bytecode=True;os.umask(0o077)
D=P('/var/lib/alisa-platform/stage/rollout-backups/direct-login-20261108');SOURCE=D/'install.py'
if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!='68d4d0d634b4a0904dd10c3067c70b9fef8c5b504a594107326f3ead35a891a0':raise ValueError('UNEXPECTED_INSTALLER')
spec=importlib.util.spec_from_file_location('installation',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=D/'activate-resume.json'
def interrupted(*_):raise InterruptedError()
signal.signal(signal.SIGTERM,interrupted);m.secure(D)
m.check('fresh_resume_receipt',not OUT.exists())
try:
 with contextlib.ExitStack()as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  p=json.loads((D/'prepared.private.json').read_text());old=p['before'];current=m.snapshot()
  changes=[u for u,v in old['protected'].items()if v!=current['protected'][u]]
  m.check('only_native_core_and_checker_restart_since_preparation',bool(changes)
      and set(changes)<={'alice-market.service','alisa-store-check.service'}
      and all('ActiveState=active'in current['protected'][u]for u in changes)
      and all(old[k]==current[k]for k in old if k!='protected'))
  m.check('identity_overlay_and_manifest_still_exact',m.sha((m.TARGET/'manifest.json').read_bytes())==p['manifest_sha256']and m.verify(m.TARGET,p['files']))
  m.check('all_four_services_ready_before_resume',all(v.get('status')=='READY'for v in m.ready().values()))
  retained=D/'prepared.before-native-restart.private.json';m.check('fresh_snapshot_history',not retained.exists())
  # Only private deployment metadata is renewed; retain its original bytes.
  (D/'prepared.private.json').rename(retained);p['before']=current
  m.fresh(D/'prepared.private.json',json.dumps(p).encode())
  m.record['other_actor_restarted_units_preserved']=changes
  m.activate()
except BaseException as e:m.record['error_type']=type(e).__name__
finally:
 m.fresh(OUT,json.dumps(m.record,indent=2).encode());print(json.dumps(m.record))
sys.exit(0 if m.record['status']=='PASS'else 1)
