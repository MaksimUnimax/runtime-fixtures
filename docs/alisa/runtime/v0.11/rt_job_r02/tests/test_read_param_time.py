"""Common read parameter binding and current/upcoming timestamp semantics."""
from copy import deepcopy
from datetime import date
from decimal import Decimal
import json,unittest
import read_surface as rs
from universal_reads import identifier_provenance,resolve_params,snapshot_time,result
from matrix_core import evaluate,MatrixError
from semantics import Rejected
from test_method_applicability import WorkerApplicability as Fixture

class ParamsAndTime(unittest.TestCase):
 def test_array_and_csv_same_typed_ids(self):
  a=rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':[11,22]}});b=rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':'11, 22'}});self.assertEqual(a,b);self.assertEqual(a['query']['promotionIDs'],[11,22])
 def test_no_ids_added_or_dropped(self):
  p={'query':{'promotionIDs':'22,11'}};copy=deepcopy(p);v=rs.normalize_params('wb','calendar_promotion_details',p);self.assertEqual(v['query']['promotionIDs'],[22,11]);self.assertEqual(p,copy)
 def test_invalid_forms_fail_closed(self):
  for value in ['11,,22','11;22','11 or 1=1','',[],[True],[1.5],[0],['-1']]:
   with self.assertRaises(Rejected):rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':value}})
 def test_duplicate_ids_not_silently_deduplicated(self):
  with self.assertRaises(Rejected):rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':[11,11]}})
 def test_id_above_exact_json_integer_range_rejected(self):
  with self.assertRaises(Rejected):rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':['9007199254740999']}})
 def test_csv_members_still_need_provenance(self):
  p=rs.normalize_params('wb','calendar_promotion_details',{'query':{'promotionIDs':'11,22'}})
  with self.assertRaises(Rejected):identifier_provenance(p,'акции',[{'data':{'id':11}}])
  identifier_provenance(p,'акции',[{'data':[{'id':11},{'id':22}]}])
 def test_unrelated_params_not_coerced(self):self.assertEqual(rs.normalize_params('ozon','ozon_actions_list',{'example':'11,22'}),{'example':'11,22'})
 def test_params_expr_uses_actual_complete_response(self):
  calls=[{'data':{'rows':[{'id':n}for n in range(1,26)]}}];d={'params_expr':{'query':{'promotionIDs':{'$map':[{'$path':['calls',0,'data','rows']},'x',{'$path':['x','id']}]}}}}
  v=resolve_params(d,{'snapshot_slot':5980000},calls);self.assertEqual(v['query']['promotionIDs'],list(range(1,26)))
 def test_params_expr_cannot_execute_code(self):
  with self.assertRaises(MatrixError):resolve_params({'params_expr':{'$fn':['eval','danger']}},{'snapshot_slot':5980000},[])
 def test_missing_source_id_not_defaulted(self):
  with self.assertRaises(MatrixError):resolve_params({'params_expr':{'id':{'$path':['calls',0,'data','missing']}}},{'snapshot_slot':5980000},[{'data':{}}])
 def test_aware_offsets_compare_same_instant(self):
  a=evaluate({'$fn':['datetime_epoch','2026-11-08T13:00:00+03:00']},{})
  b=evaluate({'$fn':['datetime_epoch','2026-11-08T10:00:00Z']},{})
  self.assertEqual(a,b)
 def test_naive_time_not_guessed(self):
  with self.assertRaises(MatrixError)as e:evaluate({'$fn':['datetime_epoch','2026-11-08T13:00:00']},{})
  self.assertEqual(e.exception.code,'DATETIME_TIMEZONE_REQUIRED')
 def test_invalid_time_not_repaired(self):
  for s in ['not-a-date','2026-02-30T00:00:00Z',10,None]:
   with self.assertRaises(MatrixError):evaluate({'$fn':['datetime_epoch',s]},{})
 def test_time_fraction_has_no_float_rounding(self):
  a=evaluate({'$fn':['datetime_epoch','1970-01-01T00:00:00.000001Z']},{});self.assertEqual(a,Decimal('0.000001'))
 def test_future_start_is_not_active(self):
  expression={'$fn':['le',{'$fn':['datetime_epoch',{'$path':['item','start']}]},{'$fn':['datetime_epoch',{'$path':['as_of_utc']}]}]}
  self.assertFalse(evaluate(expression,{'item':{'start':'2026-11-10T21:00:00Z'},'as_of_utc':'2026-11-08T10:55:00Z'}))
 def test_source_future_and_active_can_be_separated(self):
  rows=[{'start':'2026-11-07T21:00:00Z','n':2},{'start':'2026-11-10T21:00:00Z','n':3}]
  expr={'$filter':[{'$path':['calls',0,'data','rows']},'x',{'$fn':['le',{'$fn':['datetime_epoch',{'$path':['x','start']}]},{'$fn':['datetime_epoch',{'$path':['as_of_utc']}]}]}]}
  self.assertEqual(len(evaluate(expr,{'calls':[{'data':{'rows':rows}}],'as_of_utc':'2026-11-08T10:55:00Z'})),1)

class BoundParamsWorker(unittest.TestCase):
 setUp=Fixture.setUp
 tearDown=Fixture.tearDown
 ask=Fixture.ask
 finish=Fixture.finish
 install=Fixture.install
 def test_server_binds_response_ids_without_model_copy(self):
  self.install();self.decisions[3]={'action':'read','store_id':self.sid,'operation':'calendar_promotion_details','params_expr':{'query':{'promotionIDs':{'$map':[{'$path':['calls',0,'data','data','promotions']},'x',{'$path':['x','id']}]}}}}
  a=self.ask('В каких акциях участвуют товары на wb');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);v=json.loads(r['result']);self.assertEqual(v['data']['calls'][1]['params']['query']['promotionIDs'],[77])
 def test_csv_normalizes_before_provenance_check(self):
  self.install();self.decisions[3]['params']={'query':{'promotionIDs':'77'}};a=self.ask('В каких акциях участвуют товары на wb');r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.physical.count('read.wb.calendar_promotion_details'),1)

del Fixture
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [ParamsAndTime,BoundParamsWorker]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
