"""Finite owner OAuth qualification; only disposable local PostgreSQL.
The suite uses real OAuthlib and the existing Django callback boundary.
"""
import os,sys,json,time,socket,argparse
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
P=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-oauth-') or not Path(sock).is_dir():raise RuntimeError('OWNED_TEST_DB_REQUIRED')
if os.getenv('DATABASE_URL') or os.getenv('ALISA_CONFIG'):raise RuntimeError('LIVE_DB_FORBIDDEN')
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.collection_settings'
sys.path[:0]=[str(P/'services/platform/src'),str(P/'tests')]
import django
django.setup()
from django.test.runner import DiscoverRunner
from unittest import TextTestResult
from django.core.management import call_command
class Result(TextTestResult):
 def __init__(self,*a,**kw):super().__init__(*a,**kw);self.ids=[]
 def addSuccess(self,t):self.ids.append(t.id());super().addSuccess(t)
class Runner(DiscoverRunner):
 def get_resultclass(self):return Result
 def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
attempt=[];original=socket.socket.connect

def connect(sock,addr):
 if sock.family!=socket.AF_UNIX:attempt.append('EXTERNAL');raise AssertionError('NO_EXTERNAL_NETWORK')
 return original(sock,addr)
runner=Runner(verbosity=2,interactive=False);start=time.monotonic()
with patch.object(socket.socket,'connect',connect),patch('socket.getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
 call_command('makemigrations','alice_link',check=True,dry_run=True,verbosity=0)
 failures=runner.run_tests(['current_parameters.test_oauth_owner_bridge'])
r=runner.result
status='PASS' if not failures and not r.skipped and not attempt else 'FAIL'
receipt={'utc':datetime.now(timezone.utc).isoformat(),'status':status,'tests':r.testsRun,
         'errors':len(r.errors),'failures':len(r.failures),'skipped':len(r.skipped),
         'passed_ids':r.ids,'external_connections':len(attempt),'duration_seconds':round(time.monotonic()-start,3),
         'database':'OWNED_DISPOSABLE_POSTGRESQL','live_grants_or_data_modified':False}
args.output.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='passed_ids'}))
raise SystemExit(0 if status=='PASS' else 1)
