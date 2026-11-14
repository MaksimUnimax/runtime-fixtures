"""Reproducible R5 isolated suites; no real account/provider/secret configuration."""
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
import argparse,os,sys,json,socket,time
ROOT=Path(__file__).resolve().parents[2]
ap=argparse.ArgumentParser();ap.add_argument('--suite',choices=['existing','collection'],required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args()
N=Path(os.environ['PARAMETER_TEST_RUNTIME_ROOT']).resolve()
if '/opt/'in str(N)or not(N/'parameter_collection_runtime.py').is_file():raise RuntimeError('Explicit isolated R5 runtime required')
sys.path[:0]=[str(ROOT/'services/platform/src'),str(ROOT/'tests'),str(N),str(N/'tests'),str(ROOT.parents[1]/'docs/alisa/runtime/v0.11/current_parameters_r4/tests')]
os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.collection_settings'if args.suite=='collection'else'current_parameters.settings'
import django
django.setup()
from django.core.management import call_command
from django.test.runner import DiscoverRunner
class Runner(DiscoverRunner):
    def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
attempts=[];original=socket.socket.connect

def confined(sock,address):
    if sock.family!=socket.AF_UNIX:attempts.append('non-unix connection');raise AssertionError('External network prohibited')
    return original(sock,address)
labels=['current_parameters.test_collection']if args.suite=='collection'else['current_parameters.test_parameters','current_parameters.test_producers','current_parameters.test_runtime_writer']
runner=Runner(verbosity=2,interactive=False);start=time.monotonic()
with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('DNS prohibited')):
    call_command('makemigrations','owner_data',check=True,dry_run=True,verbosity=1)
    failures=runner.run_tests(labels)
r=runner.result
receipt={'utc':datetime.now(timezone.utc).isoformat(),'suite':args.suite,'status':'PASS'if not failures and not attempts else'FAIL','tests':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'skipped':len(r.skipped),'external_connection_attempts':len(attempts),'elapsed_seconds':round(time.monotonic()-start,3),'production_changed':False}
args.output.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));raise SystemExit(0 if receipt['status']=='PASS'else 1)
