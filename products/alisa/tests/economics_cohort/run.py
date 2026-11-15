"""Isolated R10 qualification, using only owned local test PostgreSQL."""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import sys,os,socket,json,time
ROOT=Path(__file__).resolve().parents[2]
sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-r10-') or not Path(sock).is_dir():raise RuntimeError('OWN_R10_TEST_POSTGRES_REQUIRED')
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests')]
os.environ['DJANGO_SETTINGS_MODULE']='economics_cohort.settings'
import django
django.setup()
from django.test.runner import DiscoverRunner
from django.core.management import call_command
class Capture(DiscoverRunner):
 def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
original=socket.socket.connect;attempts=[]
def connect(self,address):
 if self.family!=socket.AF_UNIX:attempts.append('external');raise AssertionError('EXTERNAL_NETWORK_FORBIDDEN')
 return original(self,address)
start=time.monotonic();runner=Capture(verbosity=2,interactive=False)
with patch.object(socket.socket,'connect',connect):
 call_command('makemigrations','owner_data',check=True,dry_run=True,verbosity=1)
 failures=runner.run_tests(sys.argv[1:]or['economics_cohort','parameter_dependencies','current_parameters.test_parameters','current_parameters.test_producers'])
r=runner.result;result={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS'if not failures and not r.skipped and not attempts else'FAIL','tests':r.testsRun,'errors':len(r.errors),'failures':len(r.failures),'skipped':len(r.skipped),'external_connections':len(attempts),'elapsed_seconds':round(time.monotonic()-start,3),'live_changes':False}
Path(os.environ['PARAMETER_TEST_RECEIPT']).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));raise SystemExit(0 if result['status']=='PASS'else 1)
