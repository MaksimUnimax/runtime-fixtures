from copy import deepcopy
from datetime import date
from unittest import TestCase
from unittest.mock import patch
import json
from alisa_platform.owner_data import parameter_dependencies as d, parameter_contract as c

PROFILE='unit_economics.ozon.v1'
TODAY=date(2026,11,14)
STORE={'kind':'store','sku':''}
REPORT={'from':'2026-11-13','to':'2026-11-13'}


def consumer(cid='daily',store='store-A',sku=None):
 return {'id':cid,'store_id':store,'scope':{'kind':'sku','sku':sku}if sku else deepcopy(STORE),
         'sku_reference':'synthetic-proof-'+sku if sku else None}


def view(store='store-A',key='loss_rate',scope=None,value=None,revision=0,inherited=False):
 area=deepcopy(scope or STORE)
 current=None if value is None else {'parameter':key,'state':'VALUE','scope':deepcopy(STORE if inherited else area),
   'value':value,'unit':c.definition(key)['unit'],'revision':revision,'definition_hash':c.CATALOG_HASH,
   'origin':'manual','collected_at':None,'calculated_at':None,'updated_at':'2026-11-01T10:00:00+00:00',
   'actual_period':None,'evidence':{}}
 return {'store_id':store,'parameter':key,'scope':area,'revision':revision,'effective':current,'inherited':inherited}


def views(consumers,values=None):
 values=values or {}
 return [view(r['store_id'],r['parameter'],r['scope'],values.get(r['parameter']),
              1 if r['parameter']in values else 0)for r in d.read_requests(PROFILE,consumers)]


class Binding(TestCase):
 def plan(self,consumers=None,data=None,**kwargs):
  consumers=consumers or[consumer()]
  return d.resolve(PROFILE,consumers,data if data is not None else views(consumers),TODAY,report_period=REPORT,**kwargs)
 def test_existing_numbers_are_ready_without_producers(self):
  people=[consumer()];r=self.plan(people,views(people,{'loss_rate':'0.1','delivery_mean':'100.2'}))
  self.assertTrue(r.ready);self.assertEqual(r.producers,[]);self.assertEqual(r.formula_inputs('daily'),{'loss_rate':'0.1','delivery_mean':'100.2'})
 def test_zero_is_not_missing(self):
  people=[consumer()];r=self.plan(people,views(people,{'loss_rate':'0','delivery_mean':'0'}));self.assertTrue(r.ready)
 def test_only_missing_value_is_collected(self):
  people=[consumer()];r=self.plan(people,views(people,{'loss_rate':'0'}));self.assertFalse(r.ready);self.assertEqual([p['parameter']for p in r.producers],['delivery_mean'])
 def test_missing_values_dont_turn_into_zero_formula_inputs(self):
  r=self.plan()
  with self.assertRaises(c.ParameterError):r.formula_inputs('daily')
 def test_missing_values_dont_form_successful_answer_basis(self):
  with self.assertRaises(c.ParameterError):self.plan().answer_basis()
 def test_daily_report_does_not_shrink_default_year(self):
  r=self.plan();self.assertEqual(r.checkpoint()['report_period'],REPORT)
  self.assertTrue(all(x['parameter_period']['actual']=={'from':'2025-11-14','to':'2026-11-13'}for x in r.producers))
 def test_each_missing_slot_has_independent_period(self):
  r=self.plan(parameter_periods={'loss_rate':{'months':6}})
  periods={x['parameter']:x['parameter_period']['actual']for x in r.producers}
  self.assertEqual(periods['loss_rate']['from'],'2026-05-14');self.assertEqual(periods['delivery_mean']['from'],'2025-11-14')
 def test_current_half_year_value_kept_without_year_refresh(self):
  people=[consumer()];data=views(people,{'loss_rate':'0.1','delivery_mean':'100'})
  for v in data:v['effective'].update(origin='calculated',actual_period={'from':'2025-01-01','to':'2025-06-30'},calculated_at='2025-07-01T00:00:00Z',collected_at='2025-07-01T00:00:00Z')
  r=self.plan(people,data);self.assertTrue(r.ready);self.assertEqual(r.answer_basis()[0]['actual_period']['to'],'2025-06-30')
 def test_unknown_period_slot_denied(self):
  with self.assertRaises(c.ParameterError):self.plan(parameter_periods={'invented':{'months':6}})
 def test_missing_period_request_is_not_explicit(self):
  self.assertTrue(all(not p['parameter_period']['explicit']for p in self.plan().producers))
 def test_confirmed_short_history_allowed_for_default_only(self):
  target={'store_id':'store-A','parameter':'loss_rate','scope':STORE};proof={d.identity(target):{'available_from':date(2026,8,14),'confirmed':True}}
  r=self.plan(history_proofs=proof);p=next(x for x in r.producers if x['parameter']=='loss_rate');self.assertTrue(p['parameter_period']['short_history']);self.assertEqual(p['parameter_period']['actual']['from'],'2026-08-14')
 def test_unconfirmed_history_is_not_short_store(self):
  k=d.identity({'store_id':'store-A','parameter':'loss_rate','scope':STORE})
  with self.assertRaises(c.ParameterError):self.plan(history_proofs={k:{'available_from':date(2026,8,14)}})
 def test_explicit_period_not_shortened(self):
  k=d.identity({'store_id':'store-A','parameter':'loss_rate','scope':STORE})
  with self.assertRaises(c.ParameterError):self.plan(parameter_periods={'loss_rate':{'months':6}},history_proofs={k:{'available_from':date(2026,8,14),'confirmed':True}})
 def test_77_sku_consumers_only_two_common_producers(self):
  people=[consumer('sku-'+str(i),sku=str(i))for i in range(1,78)];r=self.plan(people)
  self.assertEqual(len(r.producers),2);self.assertEqual(len(r.checkpoint()['bindings']),154);self.assertTrue(all(x['scope']==STORE for x in r.producers))
 def test_two_stores_have_separate_producers(self):
  r=self.plan([consumer('a','store-A'),consumer('b','store-B')]);self.assertEqual(len(r.producers),4);self.assertEqual({x['store_id']for x in r.producers},{'store-A','store-B'})
 def test_target_revision_not_sku_tombstone_revision(self):
  people=[consumer(sku='123')];data=views(people)
  for v in data:v['revision']=9 if v['scope']['kind']=='sku'else 2
  r=self.plan(people,data);self.assertTrue(all(x['expected_revision']==2 for x in r.producers))
 def test_sku_lookup_without_general_read_is_not_assumed_empty(self):
  people=[consumer(sku='123')];data=[v for v in views(people)if v['scope']['kind']=='sku']
  with self.assertRaises(c.ParameterError):self.plan(people,data)
 def test_general_filled_but_sku_view_empty_is_incoherent(self):
  people=[consumer(sku='123')];data=views(people)
  for v in data:
   if v['scope']['kind']=='store':v.update(view(key=v['parameter'],value='0.1',revision=1))
  with self.assertRaises(c.ParameterError):self.plan(people,data)
 def test_inherited_values_disclosed_and_current_dates_preserved(self):
  people=[consumer(sku='123')];data=views(people,{'loss_rate':'0.1','delivery_mean':'100'})
  for v in data:
   if v['scope']['kind']=='sku':v['inherited']=True;v['effective']['scope']=deepcopy(STORE)
  r=self.plan(people,data);self.assertTrue(r.ready);self.assertTrue(all(x['inherited']for x in r.answer_basis()))
 def test_wrong_sku_current_value_refused(self):
  people=[consumer(sku='123')];data=views(people,{'loss_rate':'0.1','delivery_mean':'100'})
  next(v for v in data if v['scope']['kind']=='sku')['effective']['scope']={'kind':'sku','sku':'999'}
  with self.assertRaises(c.ParameterError):self.plan(people,data)
 def test_wrong_unit_refused_not_auto_refreshed(self):
  people=[consumer()];data=views(people,{'loss_rate':'0.1','delivery_mean':'100'});data[0]['effective']['unit']='RUB'
  with self.assertRaises(c.ParameterError):self.plan(people,data)
 def test_out_of_range_saved_value_not_used(self):
  people=[consumer()];data=views(people,{'loss_rate':'2','delivery_mean':'100'})
  with self.assertRaises(c.ParameterError):self.plan(people,data)
 def test_unknown_consumer_cannot_read_formula_inputs(self):
  people=[consumer()];r=self.plan(people,views(people,{'loss_rate':'0.1','delivery_mean':'100'}))
  with self.assertRaises(c.ParameterError):r.formula_inputs('other')
 def test_value_object_not_json_serializable(self):
  with self.assertRaises(TypeError):json.dumps(self.plan())
 def test_checkpoint_has_no_old_value_or_collection_passport(self):
  people=[consumer()];data=views(people,{'loss_rate':'0.083721','delivery_mean':'101.612345'})
  for v in data:v['effective'].update(origin='calculated',calculated_at='2026-10-15T07:23:19Z',collected_at='2026-10-14T02:21:17Z',actual_period={'from':'2026-01-01','to':'2026-06-30'})
  r=self.plan(people,data);saved=json.dumps(r.checkpoint())
  for forbidden in ['0.083721','101.612345','2026-10-15','2026-10-14','2026-01-01','collected_at','updated_at','sku_reference']:
   self.assertNotIn(forbidden,saved)
  self.assertNotIn('0.083721',repr(r));self.assertFalse(r.checkpoint()['execution_authorized'])
 def test_original_inputs_untouched(self):
  people=[consumer()];data=views(people,{'loss_rate':'0.1'});before=deepcopy((people,data));self.plan(people,data);self.assertEqual((people,data),before)
 def test_public_output_copy_cannot_change_other_reads(self):
  people=[consumer()];r=self.plan(people,views(people,{'loss_rate':'0.1','delivery_mean':'100'}));v=r.answer_basis();v[0]['value']='999';self.assertNotEqual(r.answer_basis()[0]['value'],'999')
 def test_readset_wrong_store_rejected(self):
  data=views([consumer()]);data[0]['store_id']='other'
  with self.assertRaises(c.ParameterError):self.plan(data=data)
 def test_duplicate_readset_rejected(self):
  data=views([consumer()]);data.append(deepcopy(data[0]))
  with self.assertRaises(c.ParameterError):self.plan(data=data)
 def test_duplicate_consumer_id_rejected(self):
  with self.assertRaises(c.ParameterError):self.plan([consumer(),consumer()])
 def test_unregistered_profile_rejected(self):
  with self.assertRaises(c.ParameterError):d.resolve('invented',[consumer()],[],TODAY)
 def test_declaration_drives_duplicate_slot_aliases_without_new_code(self):
  rule=deepcopy(d.CATALOG['profiles'][PROFILE]);rule['bindings'].append({**rule['bindings'][0],'slot':'loss_second_use'})
  with patch.dict(d.CATALOG['profiles'],{PROFILE:rule}):
   r=self.plan();self.assertEqual(len(r.producers),2);self.assertEqual(len(r.checkpoint()['bindings']),3)
 def test_conflicting_periods_for_one_saved_variable_rejected(self):
  rule=deepcopy(d.CATALOG['profiles'][PROFILE]);rule['bindings'].append({**rule['bindings'][0],'slot':'loss_other'})
  with patch.dict(d.CATALOG['profiles'],{PROFILE:rule}):
   with self.assertRaises(c.ParameterError)as e:self.plan(parameter_periods={'loss_other':{'months':6}})
   self.assertEqual(e.exception.code,'PARAMETER_DEPENDENCY_CONFLICT')
 def test_mutating_action_cannot_be_added_to_binding(self):
  rule=deepcopy(d.CATALOG['profiles'][PROFILE]);rule['bindings'][0]['write']='replace_calculated'
  with patch.dict(d.CATALOG['profiles'],{PROFILE:rule}):
   with self.assertRaises(c.ParameterError):self.plan()
 def test_every_generated_producer_is_only_fill_missing_and_unauthorized(self):
  for row in self.plan().producers:self.assertEqual(row['write_intent'],'fill_missing');self.assertFalse(row['execution_authorized'])

 def test_checkpoint_records_original_coefficient_date_anchor(self):
  cp=self.plan().checkpoint();self.assertEqual(cp['coefficient_period_anchor'],'2026-11-14');self.assertEqual(cp['parameter_period_requests'],{})
 def test_malformed_view_is_typed_failure_not_key_error(self):
  with self.assertRaises(c.ParameterError):self.plan(data=[{}])
 def test_empty_readset_not_assumed_missing(self):
  with self.assertRaises(c.ParameterError):self.plan(data=[])
