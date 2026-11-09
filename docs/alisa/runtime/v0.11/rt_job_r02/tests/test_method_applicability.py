"""Generic catalogue constraints; retain method-first routing and no usage quotas."""
from copy import deepcopy
from datetime import date
from dataclasses import asdict
from unittest.mock import patch
import json,unittest
from semantics import Rejected,fingerprint
from test_read_surface import Universal as Fixture
from engine import Worker
import read_surface as rs

class ContextRules(unittest.TestCase):
 def calls(self,kind='regular',store='wb1',operation='calendar_promotions'):
  return [{'store_id':store,'operation':operation,'params':{},'data':{'data':{'promotions':[{'id':77,'type':kind,'name':'Synthetic promotion'}]}}}]
 def validate(self,calls):return rs.validate_context('wb','calendar_promotion_nomenclatures',{'query':{'promotionID':77}},'wb1',calls)
 def test_regular_allowed(self):self.assertTrue(self.validate(self.calls()))
 def test_auto_rejected_before_io(self):
  with self.assertRaises(Rejected)as e:self.validate(self.calls('auto'))
  self.assertEqual(e.exception.code,'READ_METHOD_NOT_APPLICABLE')
 def test_other_store_cannot_supply_evidence(self):self.assertTrue(self.validate(self.calls('auto','not-my-store')))
 def test_other_id_not_used(self):
  rows=self.calls('auto');rows[0]['data']['data']['promotions'][0]['id']=88;self.assertTrue(self.validate(rows))
 def test_details_are_valid_context_evidence(self):
  with self.assertRaises(Rejected):self.validate(self.calls('auto',operation='calendar_promotion_details'))
 def test_missing_type_not_assumed_regular(self):
  rows=self.calls();del rows[0]['data']['data']['promotions'][0]['type']
  with self.assertRaises(Rejected)as e:self.validate(rows)
  self.assertEqual(e.exception.code,'READ_CONTEXT_EVIDENCE_MISSING')
 def test_conflicting_evidence_does_not_choose_convenient_value(self):
  with self.assertRaises(Rejected):self.validate(self.calls()+self.calls('auto'))
 def test_without_previous_response_original_direct_contract_stays(self):self.assertTrue(self.validate([]))
 def test_input_response_not_mutated(self):
  rows=self.calls();old=deepcopy(rows);self.validate(rows);self.assertEqual(rows,old)
 def test_alternative_is_catalogue_metadata(self):
  hint=rs.context_feedback('wb','calendar_promotion_nomenclatures','READ_METHOD_NOT_APPLICABLE');self.assertEqual(hint['alternative_operations'],['calendar_promotion_details']);self.assertIn('auto',hint['reason'])
 def test_unknown_code_does_not_invent_alternative(self):self.assertEqual(rs.context_feedback('wb','calendar_promotion_nomenclatures','OTHER'),{})
 def test_russian_participation_query_finds_details(self):
  r=rs.discover('wb','участие товаров','calendar');self.assertIn('calendar_promotion_details',[x['operation']for x in r['items']])
 def test_discovery_exposes_constraints_and_scope(self):
  r=rs.discover('wb','nomenclatures','calendar');item=next(x for x in r['items']if x['operation']=='calendar_promotion_nomenclatures');self.assertEqual(item['context_rules'][0]['allowed_values'],['regular']);self.assertIn('calendar_promotion_details',item['related_read_methods'])
 def test_ozon_two_scopes_not_same_source(self):
  for alias,related in [('ozon_actions_list','seller_actions_list'),('seller_actions_list','ozon_actions_list')]:
   r=rs.method('ozon',alias);self.assertIn(related,r['related_read_methods']);self.assertTrue(r['scope_note'])
 def test_details_counts_named_not_defaulted(self):
  m=rs.method('wb','calendar_promotion_details');self.assertIn('inPromoActionTotal',m['response_fields']);self.assertNotIn('default',json.dumps(m['response_fields']))
 def test_another_catalogue_method_uses_same_generic_logic(self):
  rule=deepcopy(rs.method('wb','calendar_promotion_nomenclatures'));rule['context_rules'][0].update(source_operations=['arbitrary_catalogue'],rows_path=['rows'],field_path=['state'],allowed_values=['READY'])
  rows=[{'store_id':'wb1','operation':'arbitrary_catalogue','data':{'rows':[{'id':77,'state':'PENDING'}]}}]
  with patch.dict(rs.CATALOG['providers']['wb']['operations'],{'synthetic_read':rule}):
   with self.assertRaises(Rejected):rs.validate_context('wb','synthetic_read',{'query':{'promotionID':77}},'wb1',rows)

class WorkerApplicability(unittest.TestCase):
 setUp=Fixture.setUp
 tearDown=Fixture.tearDown
 ask=Fixture.ask
 finish=Fixture.finish
 def install(self):
  sid=next(s.id for s in self.scope.stores if s.platform=='wb');self.sid=sid
  self.decisions=[{'action':'discover','platform':'wb','cluster':'calendar','query':'участие','offset':0},
   {'action':'read','store_id':sid,'operation':'calendar_promotions','params':{'query':{'startDateTime':'2026-11-08T00:00:00Z','endDateTime':'2026-11-08T23:59:59Z','allPromo':True}}},
   {'action':'read','store_id':sid,'operation':'calendar_promotion_nomenclatures','params':{'query':{'promotionID':77,'inAction':True}}},
   {'action':'read','store_id':sid,'operation':'calendar_promotion_details','params':{'query':{'promotionIDs':[77]}}},
   {'action':'finish','coverage':'complete','facts':[{'label':'Участвующих товаров','expr':{'$path':['calls',1,'data','data','promotions',0,'inPromoActionTotal']}}]}]
  outer=self;self.observed_feedback=[]
  class Fake:
   def prepare(self,*a):return None
   def execute(self,request,store=None):
    outer.physical.append(request.operation)
    if request.operation=='deepseek_read_plan':
     outer.observed_feedback.append(request.body['context'].get('feedback'))
     return {'content':json.dumps(outer.decisions.pop(0),ensure_ascii=False),'finish_reason':'stop'},{'status':200,'bytes':100}
    if request.operation=='read.wb.calendar_promotions':return {'data':{'promotions':[{'id':77,'name':'Synthetic auto','type':'auto'}]}},{'status':200,'bytes':100}
    if request.operation=='read.wb.calendar_promotion_details':return {'data':{'promotions':[{'id':77,'type':'auto','inPromoActionTotal':3}]}},{'status':200,'bytes':100}
    raise AssertionError('INAPPLICABLE_PROVIDER_MUST_NOT_RUN:'+request.operation)
  self.worker=Worker(self.engine,Fake())
 def test_known_inapplicable_call_replanned_same_job_without_http(self):
  self.install();a=self.ask('В каких акциях участвуют товары на wb');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertNotIn('read.wb.calendar_promotion_nomenclatures',self.physical);self.assertEqual(len([x for x in self.physical if x.startswith('read.')]),2)
 def test_replan_feedback_contains_real_alternative(self):
  self.install();a=self.ask('В каких акциях участвуют товары на wb');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);f=next(x for x in self.observed_feedback if x and x.get('code')=='READ_METHOD_NOT_APPLICABLE');self.assertEqual(f['alternative_operations'],['calendar_promotion_details']);self.assertFalse(f['provider_request_executed'])
 def test_previously_received_data_preserved_not_rerequested(self):
  self.install();a=self.ask('В каких акциях участвуют товары на wb');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.physical.count('read.wb.calendar_promotions'),1);data=json.loads(r['result']);self.assertEqual(len(data['data']['calls']),2);self.assertIn('3',data['pages'][0])

del Fixture
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [ContextRules,WorkerApplicability]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
