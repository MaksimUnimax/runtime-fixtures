"""Regression of external TESTER-2b217a24 N06/N08/N09; no marketplace calls.
Exact normalized command fixtures from the tester, not copied OAuth envelopes.
"""
from pathlib import Path
from datetime import date,datetime,timezone
from unittest.mock import patch
import copy,json,os,socket,tempfile,threading,unittest,uuid,sys
ROOT=Path(os.environ.get('ALISA_RUNTIME',str(Path(__file__).resolve().parents[1]))).resolve();sys.path.insert(0,str(ROOT))
from semantics import Scope,Store,Rejected,normalize,period_from_text,parse,fingerprint,strict_json
from repository import Repository
from engine import Engine
from local_gateway import Gateway,request
import dataset_pipeline as dp
from failure_explanations import explain,CATALOG
DAY=date(2026,11,5)
SCOPE=Scope('test-dialogs','r1',(Store('o','ozon','synthetic-o','r1','s1','RUB'),Store('w','wb','synthetic-w','r1','s1','RUB')))
N06='метаданные отправлений с 2026-10-01 по 2026-11-04 на озоне'
N06_Y='метаданные отправлений с 2026 - 10 - 01 по 2026 - 11 - 04 на озоне'
N08='текущие цены предложения за октябрь 2026 на озоне'
N09='текущие цены предложения сейчас на озоне кроме артикула а'

def capabilities():
 return {s.id:{op:{'status':'READ_ONLY_CANARY','dataset_source_hash':dp.SOURCES.hash,'dataset_query_hash':dp.HASH,'evidence_ref':'synthetic-fixture-only',**spec['proof_requirements']} for op,spec in dp.SOURCES.sources.items() if spec['platform']==s.platform} for s in SCOPE.stores}

class EngineCases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='dialogs-fix-');self.repo=Repository(Path(self.tmp.name)/'state.sqlite',lambda:datetime(2026,11,5,8,tzinfo=timezone.utc).timestamp())
  self.caps=capabilities();self.engine=Engine(self.repo,lambda _:SCOPE,dataset_capabilities=lambda:self.caps)
 def tearDown(self):self.tmp.cleanup()
 def ask(self,q,dialogue=False,rid=None,seq=0,conversation=None):
  kw={'conversation_id':conversation or 'case-'+uuid.uuid4().hex,'message_id':seq} if dialogue else {}
  return self.engine.safe_submit(SCOPE.tenant,q,rid or uuid.uuid4().hex,fingerprint(q),DAY,**kw)
 def no_jobs(self):
  with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0],0)
  self.assertEqual(self.repo.call_count(),0)
 def test_normalized_range_reaches_dataset_limit(self):
  r=self.ask(N06_Y);self.assertEqual(r.get('error'),'DATASET_PERIOD_LIMIT');self.assertTrue(r.get('next_action'));self.no_jobs()
 def test_original_and_normalized_limit_same_answer(self):
  self.assertEqual(self.ask(N06),self.ask(N06_Y));self.no_jobs()
 def test_dialogue_normalized_range_no_period_question(self):
  r=self.ask(N06_Y,True);self.assertEqual(r.get('error'),'DATASET_PERIOD_LIMIT');self.assertNotIn('clarification_required',r);self.no_jobs()
 def test_historical_price_names_price(self):
  r=self.ask(N08);self.assertEqual(r.get('error'),'HISTORICAL_SNAPSHOT');self.assertIn('текущие цены предложения',r['text']);self.assertIn('сейчас',r['text']);self.assertNotIn('остатки',r['text']);self.assertNotIn('баланс',r['text']);self.no_jobs()
 def test_historical_price_dialogue_names_price(self):
  r=self.ask(N08,True);self.assertEqual(r.get('error'),'HISTORICAL_SNAPSHOT');self.assertIn('текущие цены предложения',r['text']);self.assertTrue(r.get('next_action'));self.no_jobs()
 def test_historical_other_dataset_uses_catalog_subject(self):
  r=self.ask('справочник товаров за октябрь 2026 на озоне');self.assertEqual(r.get('error'),'HISTORICAL_SNAPSHOT');self.assertIn('справочник товаров',r['text']);self.assertNotIn('текущие цены',r['text']);self.no_jobs()
 def test_historical_wb_prices_keep_same_semantics(self):
  r=self.ask(N08.replace('на озоне','на wb'));self.assertEqual(r.get('error'),'HISTORICAL_SNAPSHOT');self.assertIn('текущие цены предложения',r['text']);self.no_jobs()
 def test_ozon_filter_does_not_suggest_wb(self):
  r=self.ask(N09);self.assertEqual(r.get('error'),'OPERATION_NOT_ENABLED');self.assertNotIn('wb',r['text'].lower());self.assertIn('текущие цены предложения',r['text']);self.assertTrue(r.get('next_action'));self.no_jobs()
 def test_ozon_filter_dialogue_does_not_suggest_wb(self):
  r=self.ask(N09,True);self.assertEqual(r.get('error'),'OPERATION_NOT_ENABLED');self.assertNotIn('wb',r['text'].lower());self.assertEqual(r['text'],r['tts']);self.no_jobs()
 def test_original_ozcp001_scalar_guard_neutral(self):
  r=self.ask('сумма заказов за вчера на озоне кроме артикула а');self.assertEqual(r.get('error'),'OPERATION_NOT_ENABLED');self.assertNotIn('wb',r['text'].lower());self.no_jobs()
 def test_original_ozcp001_parser_message_neutral(self):
  with self.assertRaises(Rejected) as e:parse('сумма заказов за вчера на озоне кроме артикула а',DAY)
  self.assertNotIn('wb',e.exception.message.lower())
 def test_current_prices_still_plan(self):
  r=self.ask('текущие цены предложения сейчас на озоне');self.assertEqual(r.get('state'),'QUEUED');p=strict_json(self.repo.get(SCOPE.tenant,r['job_id'])['plan']);self.assertEqual(p['dataset']['id'],'offer_prices');self.assertTrue(p['snapshot']);self.assertEqual(self.repo.call_count(),0)
 def test_short_normalized_period_constructs_exact_plan(self):
  r=self.ask('метаданные отправлений с 2026 - 11 - 03 по 2026 - 11 - 04 на озоне');self.assertEqual(r.get('state'),'QUEUED')
  p=strict_json(self.repo.get(SCOPE.tenant,r['job_id'])['plan']);self.assertEqual(p['period'],{'from':'2026-11-03','to':'2026-11-04'});self.assertEqual([s['platform'] for s in p['stores']],['ozon']);self.assertEqual(self.repo.call_count(),0)
 def test_original_normalized_plan_equal(self):
  a=self.ask('метаданные отправлений с 2026-11-03 по 2026-11-04 на озоне');b=self.ask('метаданные отправлений с 2026 - 11 - 03 по 2026 - 11 - 04 на озоне')
  pa=strict_json(self.repo.get(SCOPE.tenant,a['job_id'])['plan']);pb=strict_json(self.repo.get(SCOPE.tenant,b['job_id'])['plan']);self.assertEqual(pa,pb)
 def test_missing_period_followup_uses_normalized_range(self):
  conv='period-followup';a=self.ask('метаданные отправлений на озоне',True,conversation=conv);self.assertEqual(a.get('error'),'PERIOD_REQUIRED')
  b=self.ask('с 2026 - 11 - 03 по 2026 - 11 - 04',True,seq=1,conversation=conv);self.assertEqual(b.get('state'),'QUEUED');self.assertEqual(self.repo.call_count(),0)
 def test_help_does_not_lose_followup(self):
  conv='period-help-followup';self.ask('метаданные отправлений на озоне',True,conversation=conv);self.ask('что ты умеешь',True,seq=1,conversation=conv)
  b=self.ask('с 2026 - 11 - 03 по 2026 - 11 - 04',True,seq=2,conversation=conv);self.assertEqual(b.get('state'),'QUEUED')
 def test_bad_date_does_not_enqueue(self):
  r=self.ask('метаданные отправлений с 2026 - 02 - 30 по 2026 - 03 - 01 на озоне');self.assertEqual(r.get('error'),'INVALID_DATE');self.no_jobs()
 def test_iso_invalid_filter_not_dropped(self):
  r=self.ask('сумма заказов с 2026 - 11 - 03 по 2026 - 11 - 04 на озоне кроме артикула а');self.assertEqual(r.get('error'),'OPERATION_NOT_ENABLED');self.no_jobs()
 def test_valid_wb_filter_preserved(self):
  d=parse('сумма заказов с 2026 - 11 - 03 по 2026 - 11 - 04 на wb артикул wb 123',DAY);self.assertEqual(d['filters'],{'nm_ids':[123]});self.assertEqual(d['platforms'],['wb']);self.assertEqual(d['route'],'P1')
 def test_valid_wb_exclusion_preserved(self):
  d=parse('сумма заказов за вчера на wb кроме артикула wb 123',DAY);self.assertEqual(d['filters'],{'exclude_nm_ids':[123]})
 def test_brand_identifier_dates_are_not_normalized(self):
  q='сумма заказов за вчера на wb бренд "модель 2026 - 10 - 01"';d=parse(q,DAY);self.assertEqual(d['filters']['brands'],['модель 2026 - 10 - 01']);self.assertEqual(d['period'],{'from':'2026-11-04','to':'2026-11-04'})
 def test_dates_in_brand_not_used_as_period(self):
  q='сумма заказов на wb бренд "с 2026 - 10 - 01 по 2026 - 11 - 04"';r=self.ask(q);self.assertEqual(r.get('error'),'PERIOD_REQUIRED');self.no_jobs()
 def test_dataset_phrase_inside_quotes_does_not_select_route(self):
  self.assertIsNone(dp.parse_request('бренд «текущие цены предложения» за октябрь',DAY))
 def test_snapshot_without_historical_date_stays_supported(self):
  d=parse('текущий баланс кабинета сейчас на wb',DAY);self.assertTrue(d['snapshot'])
 def test_source_qualifications_unchanged_after_errors(self):
  before=copy.deepcopy(self.caps)
  for q in (N06_Y,N08,N09):self.ask(q,True)
  self.assertEqual(before,self.caps);self.no_jobs()

for i,q in enumerate((N06_Y,N08,N09)):
 def replay(self,q=q):
  rid='same-id';conv='same-message-context';a=self.ask(q,True,rid=rid,conversation=conv);b=self.ask(q,True,rid=rid,conversation=conv);self.assertEqual(a,b);self.assertTrue(a.get('error'));self.no_jobs()
 setattr(EngineCases,'test_exact_replay_'+str(i),replay)

class PeriodCases(unittest.TestCase):
 def test_global_normalize_does_not_rewrite_codes(self):self.assertEqual(normalize('SKU 2026 - 10 - 01'),'sku 2026 - 10 - 01')
 def test_comparison_keeps_two_ranges(self):
  p,r=period_from_text('с 2026 - 11 - 01 по 2026 - 11 - 02 и с 2026 - 10 - 01 по 2026 - 10 - 02',DAY,True)
  self.assertEqual(p,{'from':'2026-11-01','to':'2026-11-02','comparison':{'from':'2026-10-01','to':'2026-10-02'}});self.assertEqual(r,'и')
 def test_no_implicit_period_from_sku(self):
  with self.assertRaises(Rejected) as e:period_from_text('артикул 2026 - 10 - 01',DAY)
  self.assertEqual(e.exception.code,'PERIOD_REQUIRED')
 def test_extra_numeric_residue_is_not_deleted(self):
  _,r=period_from_text('с 2026 - 10 - 01 по 2026 - 11 - 04 123',DAY);self.assertEqual(r,'123')

for i,(left,right) in enumerate([('',''),(' ',' '),('  ',''),('','  '),('\t','\t'),('\u00a0','\u00a0'),(' \t','  ')]):
 def valid(self,left=left,right=right):
  sep=left+'-'+right;q='с '+sep.join(['2026','10','01'])+' по '+sep.join(['2026','11','04']);p,r=period_from_text(q,DAY);self.assertEqual(p,{'from':'2026-10-01','to':'2026-11-04'});self.assertEqual(r,'')
 setattr(PeriodCases,'test_iso_spacing_'+str(i),valid)
for i,(a,b,code) in enumerate([('2026 - 02 - 30','2026 - 03 - 01','INVALID_DATE'),('2026 - 13 - 01','2026 - 13 - 02','INVALID_DATE'),('2026 - 10 - 00','2026 - 11 - 04','INVALID_DATE'),('2026 - 11 - 04','2026 - 10 - 01','PERIOD_RANGE'),('2026 - 11 - 05','2026 - 11 - 06','PERIOD_RANGE'),('2025 - 10 - 01','2026 - 11 - 04','PERIOD_RANGE'),('2026 - 1 - 01','2026 - 11 - 04','PERIOD_REQUIRED')]):
 def invalid(self,a=a,b=b,code=code):
  with self.assertRaises(Rejected) as e:period_from_text('с '+a+' по '+b,DAY)
  self.assertEqual(e.exception.code,code)
 setattr(PeriodCases,'test_invalid_range_'+str(i),invalid)

class ContextSafety(unittest.TestCase):
 def test_valid_subject_ref(self):self.assertIn('текущие цены предложения',explain('HISTORICAL_SNAPSHOT',context={'subject_ref':'offer_prices'})['text'])
 def test_no_raw_context_echo(self):
  for ctx in ({'subject_ref':'Bearer synthetic-private-token'}, {'subject':'/private/path'}, {'subject_ref':[]}, None, 'raw'):
   r=explain('HISTORICAL_SNAPSHOT',context=ctx);self.assertNotIn('synthetic',json.dumps(r));self.assertNotIn('/private',json.dumps(r));self.assertNotIn('{subject}',r['text'])
 def test_context_does_not_mutate_catalog(self):
  before=copy.deepcopy(CATALOG);explain('HISTORICAL_SNAPSHOT',context={'subject_ref':'offer_prices'});self.assertEqual(before,CATALOG)
 def test_unknown_code_does_not_reflect_subject_ref(self):
  r=explain('secret/untrusted',context={'subject_ref':'secret/untrusted'});self.assertEqual(r['reason_code'],'UNSPECIFIED');self.assertNotIn('secret',json.dumps(r))

class GatewayCases(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='external-edge-');self.repo=Repository(Path(self.temp.name)/'state.sqlite');self.engine=Engine(self.repo,lambda _:SCOPE,dataset_capabilities=capabilities)
  self.path=str(Path(self.temp.name)/'gateway.sock');self.server=Gateway(self.path,self.engine,os.getuid());self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.01},daemon=True);self.thread.start()
  self.clock=patch('local_gateway.datetime');self.clock.start().now.return_value=datetime(2026,11,5,8,tzinfo=timezone.utc)
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.clock.stop();self.temp.cleanup()
 def check(self,q,code,subject=None):
  a=request(self.path,SCOPE.tenant,q,'unix-'+uuid.uuid4().hex,fingerprint(q),conversation_id='unix-case-'+uuid.uuid4().hex,message_id=0)
  self.assertEqual(a.get('error'),code);self.assertTrue(a.get('next_action'));self.assertEqual(a['text'],a['tts']);self.assertEqual(self.repo.call_count(),0)
  if subject:self.assertIn(subject,a['text'])
  with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0],0)
 def test_n06_normalized_unix(self):self.check(N06_Y,'DATASET_PERIOD_LIMIT')
 def test_n08_unix(self):self.check(N08,'HISTORICAL_SNAPSHOT','текущие цены предложения')
 def test_n09_unix(self):self.check(N09,'OPERATION_NOT_ENABLED','текущие цены предложения')

if __name__=='__main__':
 original=socket.socket.connect
 def no_tcp(sock,address):
  if sock.family in (socket.AF_INET,socket.AF_INET6):raise AssertionError('NETWORK_FORBIDDEN')
  return original(sock,address)
 with patch.object(socket.socket,'connect',no_tcp),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
 print(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'external_calls':0,'live_db_used':False,'status':'PASS' if result.wasSuccessful() else 'FAIL'}))
 raise SystemExit(0 if result.wasSuccessful() else 1)
