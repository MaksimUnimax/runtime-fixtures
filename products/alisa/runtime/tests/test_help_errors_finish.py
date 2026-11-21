"""R3 regressions: information/catalog failures on exact runtime, no business HTTP.
Run ALISA_RUNTIME=<inactive snapshot> python3 -B this_file.py.
"""
from pathlib import Path
from datetime import date,datetime,timezone
from unittest.mock import patch
import copy,json,os,socket,sys,tempfile,unittest,uuid
ROOT=Path(os.environ.get('ALISA_RUNTIME',str(Path(__file__).resolve().parents[1]))).resolve();sys.path.insert(0,str(ROOT))
from semantics import Scope,Store,Rejected,fingerprint,strict_json
from repository import Repository
from engine import Engine
import information
import dataset_pipeline as datasets
from failure_explanations import CATALOG,explain
TODAY=date(2026,11,5)
class FinishTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='h00-r3-test-');self.repo=Repository(Path(self.temp.name)/'db.sqlite',lambda:1793865600.0)
  self.scope=Scope('fixture','r1',(Store('o','ozon','synthetic-o','r1','s1','RUB'),Store('w','wb','synthetic-w','r1','s1','RUB')))
  enabled={'ds_ozon_products','ds_wb_products','ds_ozon_prices','ds_wb_prices','ds_ozon_fbo_postings','ds_ozon_fbs_postings'}
  self.caps={s.id:{op:{'status':'READ_ONLY_CANARY','dataset_source_hash':datasets.SOURCES.hash,'dataset_query_hash':datasets.HASH,'evidence_ref':'synthetic-only',**spec['proof_requirements']} for op,spec in datasets.SOURCES.sources.items() if spec['platform']==s.platform and op in enabled} for s in self.scope.stores}
  self.engine=Engine(self.repo,lambda _:self.scope,dataset_capabilities=lambda:self.caps)
 def tearDown(self):self.temp.cleanup()
 def ask(self,q,**kw):return self.engine.safe_submit('fixture',q,str(uuid.uuid4()),fingerprint(q),TODAY,**kw)
 def counts(self):
  with self.repo.connection() as c:return(c.execute('SELECT count(*) FROM jobs').fetchone()[0],self.repo.call_count())
 def test_help_advertises_qualified_datasets(self):
  r=self.ask('что ты умеешь');self.assertNotIn('error',r)
  for label in ('справочники товаров','текущие цены предложения','метаданные отправлений'):self.assertIn(label,r['text'])
  self.assertLessEqual(len(r['text']),800);self.assertEqual(r['text'],r['tts']);self.assertEqual(self.counts(),(0,0))
 def test_help_does_not_claim_completed_unit_economics(self):
  text=self.ask('что ты умеешь')['text'];self.assertIn('Юнит-экономика запланирована',text)
  self.assertIn('пропуски',text);self.assertNotIn('после подключения себестоимости',text)
 def test_no_dataset_adapter_no_dataset_advertising(self):
  self.engine.dataset_capabilities=None;text=self.ask('что ты умеешь')['text']
  for label in ('справочники товаров','текущие цены предложения','метаданные отправлений'):self.assertNotIn(label,text)
 def test_missing_proof_omits_feature(self):
  self.caps={};self.assertNotIn('текущие цены предложения',self.ask('что ты умеешь')['text'])
 def test_wrong_query_hash_omits_feature(self):
  for value in self.caps.values():
   for p in value.values():p['dataset_query_hash']='0'*64
  self.assertNotIn('справочники товаров',self.ask('что ты умеешь')['text'])
 def test_source_deny_omits_feature(self):
  self.scope=Scope('fixture','r1',(self.scope.stores[0],));self.repo.deny('ozon:synthetic-o:'+datasets.SOURCES.recipe('ds_ozon_prices')['quota_operation'],'r1')
  self.assertNotIn('текущие цены предложения',self.ask('что ты умеешь')['text'])
 def test_missing_one_stage_omits_compound_feature(self):
  self.caps['o'].pop('ds_ozon_fbs_postings');self.assertNotIn('метаданные отправлений',self.ask('что ты умеешь')['text'])
 def test_unqualified_new_feature_is_not_advertised(self):
  c=copy.deepcopy(information.CATALOG);c['features'].append({'label':'непроверенная реклама','dataset':'wb_active_ads'})
  with patch.object(information,'CATALOG',c):self.assertNotIn('непроверенная реклама',self.ask('что ты умеешь')['text'])
 def test_help_declared_new_feature_needs_no_special_code(self):
  c=copy.deepcopy(information.CATALOG);c['features']=[{'label':'проверенный общий набор','dataset':'product_registry'}]
  with patch.object(information,'CATALOG',c):self.assertIn('проверенный общий набор',self.ask('что ты умеешь')['text'])
 def test_unknown_dataset_ref_not_silently_advertised(self):
  c=copy.deepcopy(information.CATALOG);c['features']=[{'label':'несуществующий отчёт','dataset':'missing'}]
  with patch.object(information,'CATALOG',c):self.assertNotIn('несуществующий отчёт',self.ask('что ты умеешь')['text'])
 def test_pending_preserved(self):
  sid='help-clarification'
  a=self.ask('дай продажи за вчера',conversation_id=sid,message_id=0);self.assertTrue(a.get('clarification_required'))
  self.assertNotIn('error',self.ask('что ты умеешь',conversation_id=sid,message_id=1))
  b=self.ask('заказанные',conversation_id=sid,message_id=2);self.assertIn('job_id',b)
  p=strict_json(self.repo.get('fixture',b['job_id'])['plan']);self.assertEqual(p['period'],{'from':'2026-11-04','to':'2026-11-04'})
 def test_help_grammar_not_broadened_to_business(self):
  self.assertFalse(information.is_help('что ты умеешь и сколько было заказов вчера'))
 def test_actual_dataset_denial_direct_has_explanation(self):
  r=self.ask('статистика активных рекламных кампаний с 4 по 4 ноября 2026 на wb')
  self.assertEqual(r.get('error'),'DATASET_NOT_QUALIFIED');self.assertEqual(r.get('reason_code'),'DATASET_NOT_QUALIFIED');self.assertTrue(r.get('next_action'));self.assertEqual(self.counts(),(0,0))
 def test_actual_dataset_denial_dialogue_has_explanation(self):
  r=self.ask('статистика активных рекламных кампаний с 4 по 4 ноября 2026 на wb',conversation_id='denial-dialogue',message_id=0)
  self.assertEqual(r.get('error'),'DATASET_NOT_QUALIFIED');self.assertTrue(r.get('next_action'));self.assertEqual(r['text'],r['tts']);self.assertEqual(self.counts(),(0,0))
 def test_dialogue_error_replay_exact_and_no_job(self):
  q='статистика активных рекламных кампаний с 4 по 4 ноября 2026 на wb';args=('fixture',q,'replay-rid',fingerprint(q),TODAY)
  a=self.engine.safe_submit(*args,conversation_id='error-replay-test',message_id=0)
  b=self.engine.safe_submit(*args,conversation_id='error-replay-test',message_id=0)
  self.assertEqual(a,b);self.assertTrue(a.get('next_action'));self.assertEqual(self.counts(),(0,0))
 def test_human_period_clarification_preserved(self):
  with patch.object(self.engine,'submit',side_effect=Rejected('PERIOD_REQUIRED','Какой период сохранить?')):r=self.engine.safe_submit()
  self.assertEqual(r['text'],'Какой период сохранить?')
 def test_untrusted_raw_exception_no_echo(self):
  with patch.object(self.engine,'submit',side_effect=Rejected('Bearer synthetic_secret_123 /private/path')):r=self.engine.safe_submit()
  self.assertNotIn('synthetic_secret',json.dumps(r));self.assertEqual(r['error'],'UNSPECIFIED')
 def test_existing_incomplete_failed_state_stays_safe(self):
  row={'tenant':'fixture','state':'FAILED','error':'DATASET_NOT_QUALIFIED','plan':None}
  self.assertEqual(self.engine.describe('fixture',row),explain('DATASET_NOT_QUALIFIED')['text'])

ERRORS=['DATASET_NOT_QUALIFIED','DATASET_PLATFORM_UNAVAILABLE','DATASET_UNSUPPORTED_CONDITION','DATASET_PERIOD_LIMIT','DATASET_TIME_AXIS','DATASET_TOKEN_POLICY','SOURCE_PROOF_REQUIRED','SOURCE_PERIOD_NOT_COMPLETED','ADS_EMPTY_UNCONFIRMED']
for index,code in enumerate(ERRORS):
 def case(self,code=code):
  with patch.object(self.engine,'submit',side_effect=Rejected(code,'Техническая заглушка: '+code)):
   r=self.engine.safe_submit()
  self.assertEqual(r['text'],explain(code)['text']);self.assertTrue(r.get('reason'));self.assertTrue(r.get('next_action'));self.assertEqual(r['text'],r['tts']);self.assertEqual(r['error'],code)
 setattr(FinishTests,'test_catalog_precedes_generic_'+str(index),case)
if __name__=='__main__':
 with patch.object(socket.socket,'connect',side_effect=AssertionError('NETWORK_FORBIDDEN')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FinishTests))
 print(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'external_calls':0}))
 raise SystemExit(0 if result.wasSuccessful() else 1)
