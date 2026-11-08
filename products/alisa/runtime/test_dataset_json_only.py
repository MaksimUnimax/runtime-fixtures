"""Add a two-source report using only JSON, then exercise real queue and HTTP boundary with fixtures."""
from pathlib import Path
import os,sys,json,copy,tempfile,hashlib,subprocess,shutil,socket
from unittest.mock import patch
from datetime import date
ROOT=Path(__file__).parent

def hashes(root):return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.py')}

def child(root):
 sys.path.insert(0,str(root))
 import dataset_pipeline as dp
 from registry import REGISTRY_HASH
 from repository import Repository
 from engine import Engine,Worker
 from semantics import Scope,Store,fingerprint,strict_json
 from http_transport import HTTPTransport
 with tempfile.TemporaryDirectory() as tmp:
  Path(tmp,'secret').write_text(json.dumps({'seller_client_id':'synthetic-id','seller_api_key':'synthetic-key-not-real'}))
  scope=Scope('fixture','r',(Store('o','ozon','fixture','a','s','RUB'),))
  proof={op:{'status':'READ_ONLY_CANARY','registry_hash':REGISTRY_HASH,'dataset_source_hash':dp.SOURCES.hash,'dataset_query_hash':dp.HASH,'evidence_ref':'fixture-only',**d['proof_requirements']} for op,d in dp.SOURCES.sources.items()}
  class Clock:
   t=1793865600
   def __call__(self):return self.t
  clock=Clock();repo=Repository(Path(tmp,'db'),clock);engine=Engine(repo,lambda _:scope,dataset_capabilities=lambda:{'o':proof})
  transport=HTTPTransport(tmp,{'o':'secret'},proof,True);worker=Worker(engine,transport);calls=[]
  class Response:
   status=200
   def __init__(self,n):self.n=n
   def __enter__(self):return self
   def __exit__(self,*a):return False
   def read(self,n):return json.dumps({'payload':{'records':[{'external_id':self.n,'vendor_label':'fixture'+str(self.n)}]}}).encode()
  class Opener:
   def open(self,req,timeout):
    calls.append(req.full_url)
    assert '/fixture/' in req.full_url
    return Response(len(calls))
  with patch('urllib.request.build_opener',return_value=Opener()),patch.object(socket.socket,'connect',side_effect=AssertionError('NO_TCP')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('NO_DNS')):
   q='контрольный справочник сейчас на озоне';a=engine.safe_submit(scope.tenant,q,'rid',fingerprint(q),date(2026,11,5));assert 'job_id'in a,a
   for _ in range(5):
    clock.t+=62;worker.step()
    if repo.get(scope.tenant,a['job_id'])['state']=='READY':break
   row=repo.get(scope.tenant,a['job_id']);assert row['state']=='READY',row['error'];result=strict_json(row['result'])
   assert result['complete'] and len(calls)==2
   b=engine.safe_submit(scope.tenant,q,'rid2',fingerprint(q),date(2026,11,5));assert b['cache']=='HIT' and b['job_id']==a['job_id']
   assert len(calls)==2
  print(json.dumps({'new_sources':2,'new_two_stage_template':True,'state':'READY','exact_cache':'HIT','synthetic_http_calls':len(calls),'external_calls':0}))

def main():
 with tempfile.TemporaryDirectory(prefix='dataset-json-only-') as tmp:
  root=Path(tmp)
  for p in ROOT.glob('*'):
   if p.is_file() and p.suffix in ('.py','.json'):shutil.copy2(p,root/p.name)
  before=hashes(root);sources=json.loads((root/'dataset_sources.json').read_text());queries=json.loads((root/'dataset_queries.json').read_text())
  P=lambda *x:{'$path':list(x)};F=lambda n,*x:{'$fn':[n,*x]}
  for n in (1,2):
   source=copy.deepcopy(sources['sources']['ds_ozon_products']);source['url']='https://api-seller.ozon.ru/fixture/source'+str(n);source['quota_operation']='fixture_source'+str(n)
   response=source['response'];response.update(items=P('response','payload','records'),root_asserts=[],map={'key':F('positive_integer',P('row','external_id')),'product_id':F('positive_integer',P('row','external_id')),'offer_id':P('row','vendor_label')},identity=F('positive_integer',P('row','external_id')),totals=None)
   response['pagination'].update(mode='single',cursor=None);sources['sources']['fixture_source'+str(n)]=source
  q=copy.deepcopy(queries['queries']['product_registry']);q['phrases']=['контрольный справочник'];q['flows']={'ozon':[{'id':'a','source':'fixture_source1','period_mode':'whole','foreach':[{}]},{'id':'b','source':'fixture_source2','period_mode':'whole','foreach':[{}]}]};q['output_stage']=['a','b'];queries['queries']['fixture_registry']=q
  for name,value in [('dataset_sources.json',sources),('dataset_queries.json',queries)]:Path(root,name).write_text(json.dumps(value,ensure_ascii=False))
  proc=subprocess.run([sys.executable,'-B',str(Path(__file__).resolve()),'--child',str(root)],capture_output=True,text=True,timeout=30)
  assert proc.returncode==0,proc.stderr[-3000:]+proc.stdout[-1000:]
  assert hashes(root)==before,'PYTHON_CHANGED'
  report=json.loads(proc.stdout);report.update(status='PASS',python_files_unchanged=len(before),python_hash_manifest=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest())
  print(json.dumps(report))
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--child':child(Path(sys.argv[2]))
 else:main()
