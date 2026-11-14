"""Finite isolated test entry point. Never loads live settings or provider keys."""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import os,sys,json,socket,time
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests')]
sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-r7-') or not Path(sock).is_dir():
 raise RuntimeError('OWN_R7_TEST_POSTGRES_REQUIRED')
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.settings'
import django
django.setup()
from django.test.runner import DiscoverRunner
from django.core.management import call_command
class Capture(DiscoverRunner):
 def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
attempts=[];original=socket.socket.connect

def connect(self,address):
 if self.family!=socket.AF_UNIX:attempts.append('external');raise AssertionError('EXTERNAL_NETWORK_FORBIDDEN')
 return original(self,address)

runner=Capture(verbosity=2,interactive=False);start=time.monotonic()
with patch.object(socket.socket,'connect',connect):
 call_command('makemigrations','owner_data',check=True,dry_run=True,verbosity=1)
 failures=runner.run_tests(['parameter_dependencies','current_parameters.test_parameters','current_parameters.test_producers'])
r=runner.result
receipt={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS'if not failures and not attempts and not r.skipped else'FAIL',
 'tests':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'skipped':len(r.skipped),'external_connections':len(attempts),
 'database':'owned disposable PostgreSQL16.15 network=none','production_code_or_data_changed':False,
 'elapsed_seconds':round(time.monotonic()-start,3)}
p=Path(os.environ['PARAMETER_TEST_RECEIPT']);p.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));raise SystemExit(0 if receipt['status']=='PASS'else 1)
