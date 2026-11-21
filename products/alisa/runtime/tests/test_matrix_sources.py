"""Architecture acceptance, not just KPI acceptance. Fixtures are explicitly synthetic."""
import copy,hashlib,json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from datetime import date
import table_analytics as t
from matrix_core import MatrixError,evaluate,validate_expression,digest
from matrix_sources import SourceMatrix
from architecture_gate import audit,audit_source,code_hashes
from test_table_analytics import plan,oz_data,event,SCOPE
ROOT=Path(__file__).resolve().parent.parent

def path(*parts):return {'$path':list(parts)}
def function(name,*args):return {'$fn':[name,*args]}
def transform(node,fn):
    node=fn(copy.deepcopy(node))
    if isinstance(node,dict):return {k:transform(v,fn) for k,v in node.items()}
    if isinstance(node,list):return [transform(v,fn) for v in node]
    return node

def definition():return json.loads((ROOT/'source_matrix.json').read_text())

def fixture_matrix():
    m=definition()
    # Different endpoint names, body keys, response shape and page size. No
    # mutation of Python constants, functions, imports or callbacks is permitted.
    source=copy.deepcopy(m['sources']['ozon_table_orders'])
    source['url']='https://api-seller.ozon.ru/__synthetic__/new-nested-rows'
    source['quota_operation']='fixture-nested';source['interval']=1
    source['request']={'window':{'begin':path('period','from'),'end':path('period','to')},'offset':{'$path':['progress','offset'],'default':0},'pageSize':2}
    source['payload_schema']={'type':'object','properties':{
      'window':{'type':'object','properties':{'begin':{'type':'string','format':'iso_date'},'end':{'type':'string','format':'iso_date'}}},
      'offset':{'type':'integer','minimum':0},'pageSize':{'type':'integer','enum':[2]}}}
    r=source['response'];r.update(items=path('response','envelope','entries'),root_asserts=[],row_asserts=[],
      lets=[{'name':'key','value':function('string_id',path('row','code')),'code':'ROW_ID'}],
      map={'key':path('v','key'),'label':path('v','key'),'units':function('natural',path('row','count')),'revenue':function('nonnegative',path('row','paid'))},
      totals=None,dataset_asserts=[])
    r['pagination']['size']=2
    m['sources']['fixture_nested_rows']=source
    source=copy.deepcopy(m['sources']['wb_event_sales'])
    source['url']='https://statistics-api.wildberries.ru/__synthetic__/new-cursor-events'
    source['quota_operation']='fixture-cursor';source['interval']=1
    source['request']={'after':{'$path':['progress','cursor'],'default':path('period','from')}}
    source['payload_schema']={'type':'object','properties':{'after':{'type':'string','format':'naive_datetime_or_date','max_length':40}}}
    r=source['response'];r['items']=path('response','audit','events');r['currency']=path('response','audit','currency')
    rename={'saleID':'ticket','nmId':'productNumber','date':'completedAt','priceWithDisc':'paid','lastChangeDate':'changedAt'}
    def remap(node):
        if isinstance(node,dict) and '$path' in node and len(node['$path'])>1 and node['$path'][0]=='row':
            node['$path'][1]=rename.get(node['$path'][1],node['$path'][1])
        return node
    source['response']=transform(r,remap)
    source['response']['pagination']['mode']='cursor'
    m['sources']['fixture_cursor_rows']=source
    return m

class MatrixSafety(unittest.TestCase):
    def denied(self,fn,code=None):
        with self.assertRaises(MatrixError) as caught:fn()
        if code:self.assertEqual(caught.exception.code,code)
    def test_no_provider_specific_code_in_core_or_row_bridge(self):self.assertEqual(audit(ROOT),{})
    def test_architecture_audit_rejects_new_special_branch(self):
        self.assertTrue(audit_source("if op == 'wb_event_sales': return_value = 1",{'wb_event_sales'}))
    def test_architecture_audit_rejects_eval(self):self.assertTrue(audit_source('eval(x)',set()))
    def test_cold_unknown_operator_rejected(self):
        self.denied(lambda:evaluate({'$if':[True,1,{'$fn':['__import__','os']}]},{}),'MATRIX_OPERATOR_UNKNOWN')
    def test_unknown_root_rejected(self):self.denied(lambda:evaluate(path('credentials','token'),{'row':{}}),'MATRIX_PATH_SCHEMA')
    def test_missing_is_not_zero(self):self.denied(lambda:evaluate(path('row','money'),{'row':{}}),'BINDING_MISSING')
    def test_null_not_default(self):self.assertIsNone(evaluate({'$path':['row','money'],'default':0},{'row':{'money':None}}))
    def test_false_not_integer(self):self.denied(lambda:evaluate(function('natural',False),{}),'NUMBER_TYPE')
    def test_string_zero_becomes_null_only_explicitly(self):
        self.assertIsNone(evaluate(function('null_if_zero','0'),{}));self.assertEqual(evaluate(function('decimal','0'),{}),'0')
    def test_overdeep_ast_rejected(self):
        expr=1
        for _ in range(40):expr={'$if':[True,expr,0]}
        self.denied(lambda:validate_expression(expr,set()),'MATRIX_EXPRESSION_LIMIT')
    def test_attribute_path_not_executable(self):
        self.denied(lambda:evaluate(path('row','__class__'),{'row':5}),'BINDING_TYPE')
    def test_unknown_recipe_key_rejected(self):
        d=definition();d['sources']['ozon_table_orders']['python']='pass';self.denied(lambda:SourceMatrix(d),'MATRIX_RECIPE_SCHEMA')
    def test_decode_never_receives_credentials(self):
        d=definition();d['sources']['wb_event_sales']['response']['map']['secret']=path('credentials','token')
        self.denied(lambda:SourceMatrix(d),'MATRIX_PATH_SCHEMA')
    def test_request_never_receives_credentials(self):
        d=definition();d['sources']['wb_event_sales']['request']['token']=path('credentials','token')
        self.denied(lambda:SourceMatrix(d),'MATRIX_PATH_SCHEMA')
    def test_unknown_function_in_inactive_mapping_rejected(self):
        d=definition();d['sources']['wb_event_sales']['response']['include']={'$if':[True,True,{'$fn':['system','x']}]}
        self.denied(lambda:SourceMatrix(d),'MATRIX_OPERATOR_UNKNOWN')
    def test_query_schema_compiled_before_use(self):
        d=definition();d['sources']['wb_event_sales']['payload_schema']['properties']['flag']['type']='python'
        self.denied(lambda:SourceMatrix(d),'MATRIX_TYPE_SCHEMA')
    def test_array_type_name_denied_as_matrix_error(self):
        d=definition();d['sources']['wb_event_sales']['payload_schema']['properties']['flag']['type']=[]
        self.denied(lambda:SourceMatrix(d),'MATRIX_TYPE_SCHEMA')
    def test_object_type_name_denied_as_matrix_error(self):
        d=definition();d['sources']['wb_event_sales']['payload_schema']['properties']['flag']['type']={}
        self.denied(lambda:SourceMatrix(d),'MATRIX_TYPE_SCHEMA')
    def test_non_mapping_proof_requirements_denied(self):
        for invalid in (None,[],True,1,''):
            d=definition();d['sources']['wb_event_sales']['proof_requirements']=invalid
            self.denied(lambda:SourceMatrix(d),'MATRIX_PROOF_REQUIREMENTS')
    def test_nested_proof_requirements_denied(self):
        d=definition();d['sources']['wb_event_sales']['proof_requirements']={'token_class':{'anything':'accepted'}}
        self.denied(lambda:SourceMatrix(d),'MATRIX_PROOF_REQUIREMENTS')
    def test_invalid_expression_root_is_typed_error(self):
        self.denied(lambda:validate_expression({'$path':[[]]},set()),'MATRIX_PATH_SCHEMA')
    def test_host_header_not_configurable(self):
        d=definition();d['sources']['wb_event_sales']['auth']['headers']['Host']='different.example'
        self.denied(lambda:SourceMatrix(d),'MATRIX_AUTH_HEADER')
    def test_fixed_origin_not_substituted(self):
        d=definition();d['sources']['wb_event_sales']['url']='https://unreviewed.example/rows'
        self.denied(lambda:SourceMatrix(d),'MATRIX_ENDPOINT_ORIGIN')
    def test_ip_even_if_added_as_origin_denied(self):
        d=definition();d['origins']['wb'].append('https://127.0.0.1');d['sources']['wb_event_sales']['url']='https://127.0.0.1/rows'
        self.denied(lambda:SourceMatrix(d),'MATRIX_ENDPOINT')
    def test_url_userinfo_denied(self):
        d=definition();d['sources']['wb_event_sales']['url']='https://name:pass@statistics-api.wildberries.ru/rows'
        self.denied(lambda:SourceMatrix(d),'MATRIX_ENDPOINT')
    def test_url_dynamic_expression_denied(self):
        d=definition();d['sources']['wb_event_sales']['url']='https://statistics-api.wildberries.ru/rows?target=anything'
        self.denied(lambda:SourceMatrix(d),'MATRIX_ENDPOINT')
    def test_matrix_object_is_immutable_to_callers(self):
        obj=SourceMatrix(definition());h=obj.hash
        obj.sources['wb_event_sales']['interval']=999
        self.assertEqual(obj.recipe('wb_event_sales')['interval'],61);self.assertEqual(obj.hash,h)
    def test_recipe_copy_cannot_change_runtime(self):
        obj=SourceMatrix(definition());obj.recipe('wb_event_sales')['request']={}
        self.assertIn('flag',obj.recipe('wb_event_sales')['request'])
    def test_recipe_hash_changes_with_column_definition(self):
        d=definition();obj=SourceMatrix(d);d['sources']['wb_event_sales']['response']['map']['revenue']='0'
        self.assertNotEqual(SourceMatrix(d).hash,obj.hash)
    def test_explicit_unknown_operation_no_fallback(self):self.denied(lambda:SourceMatrix(definition()).recipe('unknown'),'MATRIX_SOURCE_UNKNOWN')
    def test_zero_interval_not_allowed(self):
        d=definition();d['sources']['wb_event_sales']['interval']=0;self.denied(lambda:SourceMatrix(d),'MATRIX_QUOTA')
    def test_bool_interval_not_allowed(self):
        d=definition();d['sources']['wb_event_sales']['interval']=True;self.denied(lambda:SourceMatrix(d),'MATRIX_QUOTA')
    def test_cursor_state_bound_to_recipe(self):
        p=plan('фактические выкупы за октябрь 2026 на wb');s=p['stores'][0];task=t.tasks(p,s)[0]
        first=t.SOURCE_MATRIX.decode(task['operation'],[event(day='2026-10-02')],p,s,task)
        stale={**first['progress'],'recipe_hash':'other'}
        self.denied(lambda:t.SOURCE_MATRIX.decode(task['operation'],[],p,s,task,stale),'MATRIX_PROGRESS_VERSION')
    def test_cursor_state_bound_to_scope(self):
        p=plan('фактические выкупы за октябрь 2026 на wb');s=p['stores'][0];task=t.tasks(p,s)[0]
        first=t.SOURCE_MATRIX.decode(task['operation'],[event(day='2026-10-02')],p,s,task)
        s={**s,'id':'other-store'}
        self.denied(lambda:t.SOURCE_MATRIX.decode(task['operation'],[],p,s,task,first['progress']),'MATRIX_PROGRESS_SCOPE')
    def test_duplicate_seen_checkpoint_rejected(self):
        p=plan('фактические выкупы за октябрь 2026 на wb');s=p['stores'][0];task=t.tasks(p,s)[0]
        first=t.SOURCE_MATRIX.decode(task['operation'],[event(day='2026-10-02')],p,s,task)
        first['progress']['seen']*=2
        self.denied(lambda:t.SOURCE_MATRIX.decode(task['operation'],[],p,s,task,first['progress']),'MATRIX_PROGRESS_DUPLICATE')

class MatrixOnlyExtension(unittest.TestCase):
    def test_two_novel_sources_json_only_queue_transport_normalization_ranking(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for f in list(ROOT.glob('*.py'))+list(ROOT.glob('*.json')):shutil.copy2(f,root/f.name)
            before=code_hashes(root)
            (root/'source_matrix.json').write_text(json.dumps(fixture_matrix(),ensure_ascii=False))
            cat=json.loads((root/'table_catalog.json').read_text());cat['version']='new-unseen-source-fixtures'
            for route in cat['routes']:
                if route.get('source')=='ozon_table_orders':route['source']='fixture_nested_rows'
                if route.get('source')=='wb_event_sales':route['source']='fixture_cursor_rows'
            (root/'table_catalog.json').write_text(json.dumps(cat,ensure_ascii=False))
            script=r'''import json,tempfile,socket,base64
from pathlib import Path
from datetime import date
from unittest.mock import patch
with patch.object(socket.socket,'connect',side_effect=AssertionError('TCP forbidden')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS forbidden')):
 import table_analytics as t
 from engine import Engine,Worker
 from repository import Repository
 from semantics import Scope,Store,fingerprint,strict_json
 from http_transport import HTTPTransport
 from registry import REGISTRY_HASH
 class Clock:
  value=1793750400
  def __call__(self):return self.value
 clock=Clock();scope=Scope('owner','rev',(Store('o','ozon','fixture-o','a','s','RUB'),Store('w','wb','fixture-w','a','s','RUB')))
 caps={s.id:{op:{'status':'READ_ONLY_CANARY','table_hash':t.HASH,'token_class':'personal','evidence_ref':'synthetic-extension'} for op,spec in t.OPERATIONS.items() if spec['platform']==s.platform} for s in scope.stores}
 q={op:{'status':'READ_ONLY_CANARY','table_hash':t.HASH,'registry_hash':REGISTRY_HASH,'evidence_ref':'synthetic-extension'} for op in t.OPERATIONS}
 with tempfile.TemporaryDirectory() as d:
  root=Path(d);(root/'o').write_text(json.dumps({'seller_client_id':'synthetic-client','seller_api_key':'synthetic-secret-not-real'}))
  claims=base64.urlsafe_b64encode(json.dumps({'acc':3,'for':'self','t':False}).encode()).decode().rstrip('=')
  (root/'w').write_text(json.dumps({'seller_token':'synthetic.'+claims+'.synthetic'}))
  repo=Repository(root/'jobs.sqlite',clock);e=Engine(repo,lambda _:scope,table_capabilities=lambda:caps)
  transport=HTTPTransport(str(root),{'o':'o','w':'w'},q,enabled=True);worker=Worker(e,transport)
  pages=[{'envelope':{'entries':[{'code':'11','count':2,'paid':'4'},{'code':'22','count':1,'paid':'2'}]}},
         {'envelope':{'entries':[{'code':'33','count':1,'paid':'20'}]}},
         {'audit':{'currency':'RUB','events':[{'ticket':'Sfixture1','productNumber':77,'completedAt':'2026-10-03T12:00:00','changedAt':'2026-10-04T09:00:00','paid':'90'},
                                           {'ticket':'Rfixture2','productNumber':77,'completedAt':'2026-10-04T12:00:00','changedAt':'2026-10-05T09:00:00','paid':'-8'}]}},
         {'audit':{'currency':'RUB','events':[]}}]
  calls=[]
  class Response:
   status=200
   def __init__(self,body):
    import io
    self.body=io.BytesIO(json.dumps(body).encode())
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read1(self,n):return self.body.read1(n)
  class Opener:
   def open(self,req,timeout):calls.append((req.method,req.full_url,req.data));return Response(pages.pop(0))
  statements=['топ 2 товаров по сумме заказов за октябрь 2026 на озоне','фактические выкупы за октябрь 2026 на wb']
  results=[]
  with patch('urllib.request.build_opener',return_value=Opener()):
   for i,text in enumerate(statements):
    out=e.submit('owner',text,str(i),fingerprint(text),date(2026,11,4));jid=out['job_id']
    for _ in range(5):
     clock.value+=2;worker.step()
     if repo.get('owner',jid)['state']=='READY':break
    job=repo.get('owner',jid);assert job['state']=='READY',(job['state'],job['error'])
    result=strict_json(job['result']);results.append(' '.join(result['pages']))
    repeat=e.submit('owner',text,'repeat-'+str(i),fingerprint(text),date(2026,11,4));assert repeat['cache']=='HIT'
  assert len(calls)==4 and not pages
  assert calls[0][0]=='POST' and '/__synthetic__/new-nested-rows' in calls[0][1]
  assert json.loads(calls[1][2])['offset']==2
  assert calls[2][0]=='GET' and 'after=2026-10-01' in calls[2][1]
  assert 'after=2026-10-05T09%3A00%3A00' in calls[3][1]
  assert results[0].index('код 33')<results[0].index('код 11') and 'код 22' not in results[0]
  assert 'выкуплено 1 шт., сумма 90' in results[1] and 'возвраты 1 шт., сумма 8' in results[1]
  assert 'Sfixture1' not in (root/'jobs.sqlite').read_bytes().decode(errors='ignore')
 print(json.dumps({'new_sources':2,'runtime_python_changed':False,'network_calls':0,'fixture_http_calls':len(calls),'full_queue_roundtrip':'PASS','pagination':'offset+cursor','ranking_after_all_pages':'PASS','source_fields_not_in_engine':True}))
'''
            run=subprocess.run([sys.executable,'-B','-c',script],cwd=root,capture_output=True,text=True,timeout=30)
            self.assertEqual(run.returncode,0,run.stderr+run.stdout)
            result=json.loads(run.stdout);self.assertEqual(result['new_sources'],2)
            self.assertEqual(before,code_hashes(root))
            print('MATRIX_ONLY_EXTENSION_PROOF '+json.dumps({**result,'python_files_unchanged':len(before),'python_manifest_hash':digest(before)},sort_keys=True))

if __name__=='__main__':unittest.main()
