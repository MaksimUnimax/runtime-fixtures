"""Run in disposable PostgreSQL only. External sockets are blocked in-process.

Create an owned network=none postgres:16.15 container with a private Unix socket,
parameter_test DB and test_parameter_test_runtime NOLOGIN role; see settings.py.
Does not load live settings, provider credentials or copy live data.
"""
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
import os,sys,socket,json,time,hashlib
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests')]
runtime=os.environ.get('PARAMETER_TEST_RUNTIME_ROOT')
if runtime:
    native=Path(runtime).resolve()
    if '/opt/'in str(native)or not(native/'parameter_source_runtime.py').is_file():raise RuntimeError('Only an explicit isolated R4 candidate is allowed')
    sys.path[:0]=[str(native),str(native/'tests'),str(ROOT.parents[1]/'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.settings'
assert os.environ.get('PARAMETER_TEST_SOCKET','').startswith('/dev/shm/alisa-current-parameters-pg-')
import django
django.setup()
from django.core.management import call_command
from django.test.runner import DiscoverRunner
class Capture(DiscoverRunner):
    def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
attempts=[]
def deny_connect(self,address):
    if self.family!=socket.AF_UNIX:attempts.append('non_unix_socket');raise AssertionError('EXTERNAL_NETWORK_FORBIDDEN')
    return original_connect(self,address)
original_connect=socket.socket.connect
start=time.monotonic();runner=Capture(verbosity=2,interactive=False)
with patch.object(socket.socket,'connect',deny_connect):
    call_command('makemigrations','owner_data',check=True,dry_run=True,verbosity=1)
    failures=runner.run_tests(['current_parameters'])
result=runner.result
out={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS'if not failures and not attempts else'FAIL',
     'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
     'external_socket_attempts':len(attempts),'postgresql':'16.15 disposable network=none container',
     'production_data_or_services_modified':False,'elapsed_seconds':round(time.monotonic()-start,3)}
path=os.environ.get('PARAMETER_TEST_RECEIPT')
if path:Path(path).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out));raise SystemExit(0 if out['status']=='PASS'else 1)
