"""Independent resume tests for the scalar matrix. No live configuration or HTTP.
Run with ALISA_RUNTIME pointing to an inactive release. New-source checks modify
only JSON in a clean copy and run the real queue/transport against a fake server.
"""
from pathlib import Path
from decimal import Decimal
from datetime import date
from unittest.mock import patch
import copy, hashlib, json, os, shutil, socket, subprocess, sys, tempfile, unittest

ROOT = Path(os.environ.get('ALISA_RUNTIME', Path(__file__).parent)).resolve()

def python_hashes(root):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.glob('*.py')) if not p.name.startswith(('test_', 'verify_'))}

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def extension_child(root):
    sys.path.insert(0, str(root))
    from engine import Engine, Worker
    from repository import Repository
    from semantics import Scope, Store, fingerprint, strict_json
    from scalar_runtime import MATRIX, SOURCES
    from registry import REGISTRY_HASH
    from http_transport import HTTPTransport
    class Clock:
        value = 1793523600.0
        def __call__(self): return self.value
    clock = Clock()
    with tempfile.TemporaryDirectory() as temp:
        secret = Path(temp) / 'synthetic'
        secret.write_text(json.dumps({'seller_token':'synthetic-only-not-a-real-secret'}))
        secret.chmod(0o600)
        scope = Scope('fixture-tenant', 'access-v1',
                      (Store('fixture-store','wb','fixture-cabinet','r1','s1','RUB'),))
        proofs = {op:{'status':'READ_ONLY_CANARY','registry_hash':REGISTRY_HASH,
                     'scalar_hash':MATRIX.hash,'evidence_ref':'synthetic-offline-only'}
                  for op in SOURCES.sources}
        repo = Repository(Path(temp) / 'jobs.sqlite', clock)
        engine = Engine(repo, lambda _:scope)
        transport = HTTPTransport(temp, {'fixture-store':'synthetic'}, proofs, enabled=True)
        worker = Worker(engine, transport)
        calls = []
        ticket = '00000000-0000-0000-0000-000000000001'
        class Response:
            status = 200
            def __init__(self, value): self.raw = json.dumps(value).encode()
            def read(self, n): return self.raw[:n]
            def __enter__(self): return self
            def __exit__(self, *args): return False
        class Opener:
            def open(self, req, timeout):
                path = req.full_url.split('.ru', 1)[-1]
                calls.append(path)
                if path == '/fixture/metric':
                    return Response({'currency':'RUB','fee_fixture':'73.5'})
                if path.startswith('/fixture/create'):
                    return Response({'ticket':{'key':ticket}})
                if path == '/fixture/status/' + ticket:
                    return Response({'ticket':{'key':ticket,'phase':'ready'}})
                if path == '/fixture/report/' + ticket:
                    return Response({'currency':'RUB','fee_fixture':'19'})
                raise AssertionError('Unexpected synthetic endpoint')
        with patch('urllib.request.build_opener', return_value=Opener()), \
             patch.object(socket.socket, 'connect', side_effect=AssertionError('TCP forbidden')), \
             patch.object(socket, 'getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            answers = []
            for index, (question, metric, expected) in enumerate([
                ('контрольный сбор за октябрь 2026 на wb','fixture_charge',Decimal('73.5')),
                ('составной контрольный сбор за октябрь 2026 на wb','fixture_report_charge',Decimal('19'))]):
                reply = engine.submit(scope.tenant, question, 'initial-'+str(index), fingerprint(question), date(2026,11,4))
                for _ in range(12):
                    row = repo.get(scope.tenant, reply['job_id'])
                    if row['state'] not in ('QUEUED','RUNNING'): break
                    clock.value += 62
                    worker.step()
                row = repo.get(scope.tenant, reply['job_id'])
                assert row['state']=='READY', (row['state'],row['error'])
                result = strict_json(row['result'])
                assert Decimal(result['data'][0]['values'][metric])==expected
                before = len(calls)
                repeated = engine.submit(scope.tenant, question, 'repeat-'+str(index), fingerprint(question), date(2026,11,4))
                assert repeated['cache']=='HIT' and repeated['job_id']==reply['job_id']
                worker.step()
                assert len(calls)==before
                answers.append({'metric':metric,'state':'READY','exact_cache':'HIT'})
            assert len(calls)==4, calls
            assert b'synthetic-only-not-a-real-secret' not in Path(repo.path).read_bytes()
        print(json.dumps({'new_scalar_metric':True,'new_workflow':True,'fixture_http_calls':len(calls),
                          'external_network_calls':0,'answers':answers}))

if len(sys.argv)>1 and sys.argv[1]=='--child':
    extension_child(Path(sys.argv[2]))
    raise SystemExit(0)

sys.path.insert(0,str(ROOT))
from scalar_runtime import MATRIX, SOURCES, ScalarMatrix
from matrix_sources import SourceMatrix
from matrix_core import MatrixError, validate_expression, evaluate

class WorkflowGuards(unittest.TestCase):
    def setUp(self):
        self.store={'id':'fixture','identity':'synthetic','platform':'wb','currency':'RUB',
                    'access_revision':'a','source_revision':'s'}
        self.period={'from':'2026-11-04','to':'2026-11-04'}
        self.plan={'period':self.period,'filters':{},'metrics':['stock_fbo_units']}
        self.task={'recipe':'wb_stocks','metrics':['stock_fbo_units'],'period':self.period}
        self.catalog=copy.deepcopy(MATRIX.definition)
    def matrix(self, sources=None): return ScalarMatrix(self.catalog,sources or SOURCES)
    def progress(self,m):
        return m.compatibility_progress(self.plan,self.store,self.task,
               {'phase':'download','task_id':'00000000-0000-0000-0000-000000000001','polls':0})
    def rejected(self,code,call):
        with self.assertRaises(MatrixError) as ctx: call()
        self.assertEqual(ctx.exception.code,code)
    def test_final_false_guard_is_enforced(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[{'test':False,'code':'FINAL_GUARD'}]
        m=self.matrix();self.rejected('FINAL_GUARD',lambda:m.decode([],self.plan,self.store,self.task,self.progress(m)))
    def test_final_true_guard_accepts_empty_complete_report(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[{'test':True,'code':'FINAL_GUARD'}]
        m=self.matrix();self.assertTrue(m.decode([],self.plan,self.store,self.task,self.progress(m))['complete'])
    def test_final_response_dependent_guard(self):
        guard={'test':{'$fn':['eq',{'$fn':['len',{'$path':['response']}]},0]},'code':'FINAL_SHAPE'}
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[guard]
        m=self.matrix();self.assertTrue(m.decode([],self.plan,self.store,self.task,self.progress(m))['complete'])
    def test_missing_final_guard_field_is_rejected(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[{'test':{'$path':['response','missing']},'code':'FINAL_SHAPE'}]
        m=self.matrix();self.rejected('FINAL_SHAPE',lambda:m.decode([],self.plan,self.store,self.task,self.progress(m)))
    def test_wrong_version(self):
        m=self.matrix();p=self.progress(m);p['_workflow_hash']='wrong'
        self.rejected('WORKFLOW_PROGRESS_VERSION',lambda:m.build(self.plan,self.store,self.task,p))
    def test_wrong_scope(self):
        m=self.matrix();p=self.progress(m);p['_workflow_scope']='wrong'
        self.rejected('WORKFLOW_PROGRESS_SCOPE',lambda:m.build(self.plan,self.store,self.task,p))
    def test_wrong_store(self):
        m=self.matrix();p=self.progress(m);other={**self.store,'identity':'another'}
        self.rejected('WORKFLOW_PROGRESS_SCOPE',lambda:m.build(self.plan,other,self.task,p))
    def test_wrong_period(self):
        m=self.matrix();p=self.progress(m);other={**self.plan,'period':{'from':'2026-11-03','to':'2026-11-03'}}
        self.rejected('WORKFLOW_PROGRESS_SCOPE',lambda:m.build(other,self.store,self.task,p))
    def test_unpinned_progress_rejected_in_runtime(self):
        m=self.matrix();p=self.progress(m);p.pop('_workflow_hash')
        self.rejected('WORKFLOW_PROGRESS_VERSION',lambda:m.build(self.plan,self.store,self.task,p))
    def test_unknown_phase(self):
        m=self.matrix();p=self.progress(m);p['phase']='not_a_phase'
        self.rejected('PROVIDER_TASK_PHASE',lambda:m.build(self.plan,self.store,self.task,p))
    def test_budget_exhausted(self):
        m=self.matrix();p=self.progress(m);p['_workflow_steps']=128
        self.rejected('PROVIDER_REPORT_NOT_READY',lambda:m.build(self.plan,self.store,self.task,p))
    def test_boolean_step_count_rejected(self):
        m=self.matrix();p=self.progress(m);p['_workflow_steps']=True
        self.rejected('PROVIDER_REPORT_NOT_READY',lambda:m.build(self.plan,self.store,self.task,p))
    def test_negative_step_count_rejected(self):
        m=self.matrix();p=self.progress(m);p['_workflow_steps']=-1
        self.rejected('PROVIDER_REPORT_NOT_READY',lambda:m.build(self.plan,self.store,self.task,p))
    def test_missing_step_count_rejected(self):
        m=self.matrix();p=self.progress(m);p.pop('_workflow_steps')
        self.rejected('PROVIDER_REPORT_NOT_READY',lambda:m.build(self.plan,self.store,self.task,p))
    def test_final_pagination_consumes_step_budget(self):
        sources=copy.deepcopy(SOURCES.definition)
        sources['sources']['wb_stocks_download']['response']['pagination'].update(mode='offset',size=1)
        self.catalog['recipes']['wb_stocks']['workflow']['max_steps']=1
        m=self.matrix(SourceMatrix(sources));p=self.progress(m)
        body=[{'nmId':1,'warehouses':[{'warehouseName':'Всего находится на складах','quantity':0}]}]
        result=m.decode(body,self.plan,self.store,self.task,p)
        self.assertFalse(result['complete']);self.assertEqual(result['progress']['_workflow_steps'],1)
        self.rejected('PROVIDER_REPORT_NOT_READY',lambda:m.build(self.plan,self.store,self.task,result['progress']))
    def test_auth_operation_cannot_be_report_stage(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['operation']='ozon_ads_token'
        with self.assertRaises(MatrixError): self.matrix()
    def test_unknown_guard_operator_is_rejected_even_if_false_branch(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[{'test':{'$if':[True,True,{'$fn':['eval','bad']}]},'code':'FINAL_GUARD'}]
        with self.assertRaises(MatrixError):self.matrix()
    def test_reading_credentials_from_guard_is_forbidden(self):
        self.catalog['recipes']['wb_stocks']['workflow']['steps']['download']['guards']=[{'test':{'$path':['credentials','seller_token']},'code':'FINAL_GUARD'}]
        with self.assertRaises(MatrixError):self.matrix()
    def test_catalog_input_is_copied(self):
        m=self.matrix();before=m.hash;self.catalog['version']='changed';self.assertEqual(m.hash,before)
    def test_recipe_result_is_copied(self):
        m=self.matrix();r=m.recipe('wb_stocks');r['fields'].clear();self.assertTrue(m.recipe('wb_stocks')['fields'])

class MatrixOnlyExtension(unittest.TestCase):
    def test_new_scalar_and_new_workflow_require_json_only(self):
        with tempfile.TemporaryDirectory(prefix='matrix-only-resume-') as temp:
            root=Path(temp)
            for p in ROOT.iterdir():
                if p.is_file() and p.suffix in ('.py','.json') and not p.name.startswith(('edit_','test_','verify_')):
                    shutil.copy2(p,root/p.name)
            before=python_hashes(root)
            src=json.loads((root/'scalar_source_catalog.json').read_text())
            cat=json.loads((root/'scalar_catalog.json').read_text())
            reg=json.loads((root/'registry.json').read_text())
            speech=json.loads((root/'speech_catalog.json').read_text())
            P=lambda *x:{'$path':list(x)}
            F=lambda name,*x:{'$fn':[name,*x]}
            def add_metric(recipe,metric,label,source_op,workflow=None):
                rr=copy.deepcopy(cat['recipes']['wb_balance'])
                rr.update(family='finance',operation=source_op,fields={metric:'fee_fixture'},priority=50,workflow=workflow)
                cat['recipes'][recipe]=rr
                meta=copy.deepcopy(reg['metric_definitions']['finance_storage_cost'])
                meta.update(label=label,platforms=['wb']);reg['metric_definitions'][metric]=meta
                source=src['sources'][source_op]
                legacy=copy.deepcopy(reg['recipes']['wb_balance'])
                legacy.update(operation=source_op,url=source['url'],method=source['method'],metrics={metric:'fee_fixture'},min_interval=source['interval'],daily_limit=source['daily_limit'])
                reg['recipes'][recipe]=legacy;speech['phrases'][metric]=[label]
            source=copy.deepcopy(src['sources']['wb_balance']);source.update(url='https://finance-api.wildberries.ru/fixture/metric',quota_operation='fixture_scalar')
            src['sources']['fixture_scalar']=source
            add_metric('fixture_scalar_recipe','fixture_charge','контрольный сбор','fixture_scalar')
            begin=copy.deepcopy(src['sources']['wb_stocks_create']);begin.update(url='https://finance-api.wildberries.ru/fixture/create',quota_operation='fixture_create')
            src['sources']['fixture_create']=begin
            for op,path in [('fixture_status','status'),('fixture_download','report')]:
                item=copy.deepcopy(src['sources']['wb_balance'])
                item.update(url='https://finance-api.wildberries.ru/fixture/'+path+'/{ticket_id}',quota_operation=op,
                            request={'ticket_id':P('progress','job_ref')},
                            payload_schema={'type':'object','properties':{'ticket_id':{'type':'string','format':'uuid','max_length':36,'min_length':36}}})
                item['options']['path_fields']=['ticket_id'];src['sources'][op]=item
            workflow={'initial':'begin','max_steps':8,'limit_error':'FIXTURE_STEPS','steps':{
                'begin':{'operation':'fixture_create','capture':{'phase':'check','job_ref':F('uuid',P('response','ticket','key'))},'guards':[],'error':'FIXTURE_SHAPE','final':False},
                'check':{'operation':'fixture_status','capture':{'phase':'finish','job_ref':P('progress','job_ref')},'guards':[{'test':F('eq',P('response','ticket','phase'),'ready'),'code':'FIXTURE_NOT_READY'}],'error':'FIXTURE_SHAPE','final':False},
                'finish':{'operation':'fixture_download','capture':None,'guards':[{'test':F('eq',P('response','currency'),'RUB'),'code':'FIXTURE_CURRENCY'}],'error':'FIXTURE_SHAPE','final':True}}}
            add_metric('fixture_report_recipe','fixture_report_charge','составной контрольный сбор','fixture_create',workflow)
            for filename,obj in [('scalar_source_catalog.json',src),('scalar_catalog.json',cat),('registry.json',reg),('speech_catalog.json',speech)]:
                obj['version']='fixture-extension';write_json(root/filename,obj)
            proc=subprocess.run([sys.executable,'-B',str(Path(__file__).resolve()),'--child',str(root)],capture_output=True,text=True,timeout=30)
            self.assertEqual(proc.returncode,0,proc.stderr[-4000:])
            proof=json.loads(proc.stdout);self.assertEqual(proof['fixture_http_calls'],4)
            self.assertEqual(before,python_hashes(root))
            proof.update(python_files_unchanged=len(before),python_manifest_hash=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest())
            print('SCALAR_JSON_ONLY_PROOF '+json.dumps(proof,ensure_ascii=False))

if __name__=='__main__':
    with patch.object(socket.socket,'connect',side_effect=AssertionError('Network forbidden')), \
         patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS forbidden')):
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    print(json.dumps({'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
                      'external_calls':0,'live_credentials_read':False,'active_config_changed':False}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
