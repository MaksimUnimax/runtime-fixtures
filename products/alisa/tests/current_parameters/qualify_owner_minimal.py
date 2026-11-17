"""Qualify a byte-pinned old-schema platform + only private OAuth actions.
Own RAM copy is deleted. No installed file, grant or migration is changed.
"""
from pathlib import Path
import argparse,hashlib,importlib.util,json,os,shutil,socket,subprocess,sys,tempfile,time
from datetime import datetime,timezone
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2];REPO=ROOT.parents[1]
BASE='3f2527482db8fd7edb240258fae814d38adc0f4f'
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
if os.readlink('/proc/self/ns/net')==os.readlink('/proc/1/ns/net'):raise RuntimeError('PRIVATE_NETWORK_REQUIRED')
sock=os.environ.get('PARAMETER_TEST_SOCKET','')
if not sock.startswith('/dev/shm/alisa-current-parameters-pg-oauth-') or not Path(sock).is_dir():raise RuntimeError('OWNED_TEST_DB_REQUIRED')
if os.getenv('DATABASE_URL') or os.getenv('ALISA_CONFIG'):raise RuntimeError('LIVE_CONFIGURATION_FORBIDDEN')
source=ROOT/'services/platform/src'
pins={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
if sum((source/n).stat().st_size for n in pins)>4*1024*1024:raise RuntimeError('SOURCE_COPY_BUDGET')
started=time.monotonic();record={};attempt=[]
with tempfile.TemporaryDirectory(prefix='alisa-oauth-minimal-',dir='/dev/shm') as tmp:
    dest=Path(tmp)/'src'
    shutil.copytree(source,dest,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    package=dest/'alisa_platform/alice_link'
    basepins={}
    for name in ('models.py','views.py','oauth.py'):
        fixture=ROOT/'runtime/owner_oauth_dialogs/platform_base'/name
        raw=(fixture.read_bytes() if name!='oauth.py' else
             (source/'alisa_platform/alice_link/oauth.py').read_bytes())
        (package/name).write_bytes(raw);basepins[name]=hashlib.sha256(raw).hexdigest()
    migration=package/'migrations/0002_parameter_voice_consent.py'
    if migration.exists():migration.unlink()
    file=ROOT/'runtime/owner_oauth_dialogs/compose.py'
    spec=importlib.util.spec_from_file_location('minimal_oauth_composer',file)
    compose=importlib.util.module_from_spec(spec);spec.loader.exec_module(compose)
    for name,text in compose.platform_sources(package).items():(package/name).write_text(text)
    sys.path[:0]=[str(dest),str(ROOT/'tests'),str(ROOT/'runtime/owner_oauth_dialogs')]
    os.environ['DJANGO_SETTINGS_MODULE']='current_parameters.collection_settings'
    os.environ['ALISA_ISOLATED_OAUTH_HTTP_TEST']='1'
    import django
    django.setup()
    from django.test.runner import DiscoverRunner
    from django.core.management import call_command
    from unittest import TextTestResult
    class Result(TextTestResult):
        def __init__(self,*a,**kw):super().__init__(*a,**kw);self.ids=[]
        def addSuccess(self,test):self.ids.append(test.id());super().addSuccess(test)
    class Runner(DiscoverRunner):
        def get_resultclass(self):return Result
        def run_suite(self,suite,**kw):self.result=super().run_suite(suite,**kw);return self.result
    original=socket.socket.connect;resolve=socket.getaddrinfo
    def connect(s,address):
        if s.family!=socket.AF_UNIX and not(s.family==socket.AF_INET and address==('127.0.0.1',18102)):
            attempt.append('external');raise AssertionError('NO_EXTERNAL_NETWORK')
        return original(s,address)
    def resolved(host,port,*a,**kw):
        if host!='127.0.0.1' or port!=18102:raise AssertionError('NO_DNS')
        return resolve(host,port,*a,**kw)
    runner=Runner(verbosity=2,interactive=False)
    with patch.object(socket.socket,'connect',connect),patch('socket.getaddrinfo',side_effect=resolved):
        call_command('makemigrations','alice_link','owner_data',check=True,dry_run=True,verbosity=0)
        failures=runner.run_tests(['current_parameters.test_parameters','current_parameters.test_station_parameters',
            'current_parameters.test_oauth_owner_bridge','current_parameters.test_oauth_http_chain',
            'current_parameters.test_oauth_minimal','test_http_transport'])
    result=runner.result
    record={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS' if not failures and not result.skipped and not attempt else 'FAIL',
        'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
        'passed_ids':result.ids,'external_connections':len(attempt),'elapsed_seconds':round(time.monotonic()-started,3),
        'baseline_old_schema_pins':basepins,'no_new_schema_required':True,
        'candidate_views_sha256':hashlib.sha256((package/'views.py').read_bytes()).hexdigest(),
        'live_values_changed':False}
    from django.db import connections
    connections.close_all()
record['own_source_copy_removed']=not Path(tmp).exists()
record['original_source_unchanged']=all(hashlib.sha256((source/n).read_bytes()).hexdigest()==pin for n,pin in pins.items())
args.output.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k!='passed_ids'}))
raise SystemExit(0 if record['status']=='PASS' and record['own_source_copy_removed'] and record['original_source_unchanged'] else 1)
