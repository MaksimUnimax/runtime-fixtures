"""Finite voice/manual parameter suite on an already owned disposable PG socket.

No native build, Node execution, browser, live settings or provider is required.
The caller owns container creation and cleanup; credentials are synthetic.
"""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import argparse,json,os,socket,sys,time

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-voice-') or not Path(sock).is_dir():
    raise RuntimeError('Owned voice PostgreSQL socket required')
if os.environ.get('DATABASE_URL') or os.environ.get('ALISA_CONFIG'):
    raise RuntimeError('Live configuration is not permitted')
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests')]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.collection_settings'
import django
django.setup()
from django.core.management import call_command
from django.test.runner import DiscoverRunner
from unittest import TextTestResult

class Result(TextTestResult):
    def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.passed=[]
    def addSuccess(self,test):self.passed.append(test.id());super().addSuccess(test)
class Runner(DiscoverRunner):
    def get_resultclass(self):return Result
    def run_suite(self,suite,**kwargs):self.result=super().run_suite(suite,**kwargs);return self.result

attempts=[];original=socket.socket.connect

def connect(sock,address):
    if sock.family!=socket.AF_UNIX:
        attempts.append('external');raise AssertionError('External network forbidden')
    return original(sock,address)

started=time.monotonic();runner=Runner(verbosity=2,interactive=False)
with patch.object(socket.socket,'connect',connect),patch('socket.getaddrinfo',side_effect=AssertionError('DNS forbidden')):
    call_command('makemigrations','owner_data','alice_link',check=True,dry_run=True,verbosity=0)
    failures=runner.run_tests(['current_parameters.test_parameters','current_parameters.test_voice_parameters'])
result=runner.result
record={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS' if not failures and not attempts and not result.skipped else 'FAIL',
        'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
        'passed_test_ids':result.passed,'external_connections':len(attempts),'elapsed_seconds':round(time.monotonic()-started,3),
        'real_postgresql_and_oauth_validation':True,'identities_and_grants':'SYNTHETIC',
        'live_grants_migrations_or_services_changed':False,'installed_station_acceptance':False}
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k!='passed_test_ids'}))
raise SystemExit(0 if record['status']=='PASS' else 1)
