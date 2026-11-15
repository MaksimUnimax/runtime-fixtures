"""Finite tests with pinned native code and an owned network-isolated database."""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import argparse,sys,os,json,socket,time,unittest
ROOT=Path(__file__).resolve().parents[2];REPO=ROOT.parents[1]
sys.path[:0]=[str(ROOT/'tests'),str(ROOT/'services/platform/src')]
from suite_routing import inventory,labels
p=argparse.ArgumentParser();p.add_argument('--suite',choices=['base','collection','compound','ledger'],required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args();inventory(ROOT/'tests')
N=Path(os.environ['PARAMETER_TEST_RUNTIME_ROOT']).resolve();sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not str(N).startswith('/dev/shm/alisa-parameter-ci-')or not(N/'parameter_report_runtime.py').is_file():raise RuntimeError('PINNED_TEST_NATIVE_REQUIRED')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-ci-')or not Path(sock).is_dir():raise RuntimeError('OWN_TEST_POSTGRES_REQUIRED')
sys.path[:0]=[str(N),str(N/'tests'),str(REPO/'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
attempts=[];original=socket.socket.connect

def connect(self,address):
 if self.family!=socket.AF_UNIX:attempts.append('non-unix');raise AssertionError('EXTERNAL_NETWORK_PROHIBITED')
 return original(self,address)

start=time.monotonic()
with patch.object(socket.socket,'connect',connect),patch('socket.getaddrinfo',side_effect=AssertionError('DNS_PROHIBITED')):
 if args.suite=='ledger':
  loaded=unittest.TestLoader().loadTestsFromNames(labels(args.suite));result=unittest.TextTestRunner(verbosity=2).run(loaded)
 else:
  os.environ['DJANGO_SETTINGS_MODULE']={'base':'economics_cohort.settings','collection':'current_parameters.collection_settings','compound':'parameter_compound.settings'}[args.suite]
  import django
  django.setup()
  from django.test.runner import DiscoverRunner
  from django.core.management import call_command
  class Capture(DiscoverRunner):
   def run_suite(self,suite,**kwargs):self.result=super().run_suite(suite,**kwargs);return self.result
  call_command('makemigrations','owner_data',check=True,dry_run=True,verbosity=1)
  runner=Capture(verbosity=2,interactive=False);runner.run_tests(labels(args.suite));result=runner.result
status='PASS'if result.wasSuccessful()and not result.skipped and not attempts else'FAIL'
receipt={'utc':datetime.now(timezone.utc).isoformat(),'suite':args.suite,'status':status,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'external_connections':len(attempts),'elapsed_seconds':round(time.monotonic()-start,3),'live_configuration_loaded':False}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));raise SystemExit(0 if status=='PASS'else 1)
