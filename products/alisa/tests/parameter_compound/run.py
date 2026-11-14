from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
import sys,os,json,socket,time,unittest
ROOT=Path(__file__).resolve().parents[2];N=Path(os.environ['PARAMETER_TEST_RUNTIME_ROOT'])
assert str(N).startswith('/dev/shm/alisa-parameter-compound-r8-')and(N/'parameter_report_runtime.py').is_file()
assert os.environ['PARAMETER_TEST_SOCKET'].startswith('/dev/shm/alisa-current-parameters-pg-r8-')
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests'),str(N),str(N/'tests'),str(ROOT.parents[1]/'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
os.environ['DJANGO_SETTINGS_MODULE']='parameter_compound.settings'
import django
django.setup()
from django.test.runner import DiscoverRunner
class Capture(DiscoverRunner):
 def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
original=socket.socket.connect;attempts=[]
def connect(self,address):
 if self.family!=socket.AF_UNIX:attempts.append('external');raise AssertionError('EXTERNAL_NETWORK_FORBIDDEN')
 return original(self,address)
start=time.monotonic();runner=Capture(verbosity=2,interactive=False)
labels=sys.argv[1:]or['parameter_compound']
with patch.object(socket.socket,'connect',connect):
 from django.core.management import call_command
 call_command('makemigrations','owner_data','queries',check=True,dry_run=True,verbosity=1)
 failures=runner.run_tests(labels)
r=runner.result;out={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS'if not failures and not attempts and not r.skipped else'FAIL','tests':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'skipped':len(r.skipped),'external_connections':len(attempts),'elapsed_seconds':round(time.monotonic()-start,3),'live_changes':False}
Path(os.environ['PARAMETER_TEST_RECEIPT']).write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out));raise SystemExit(0 if out['status']=='PASS'else 1)
