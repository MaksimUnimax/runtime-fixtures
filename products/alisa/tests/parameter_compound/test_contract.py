import importlib.util, unittest
if importlib.util.find_spec('parameter_report_runtime') is None:
 raise unittest.SkipTest('Requires the explicit isolated R8 runtime candidate; not an installed-feature assertion')
from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from types import SimpleNamespace
import json,hashlib
from alisa_platform.owner_data import parameter_report_contract as c,parameter_contract as p
import parameter_report_runtime as native
TID='economics.delivery_projection.v1'

class Contract(TestCase):
 def test_estimates_are_not_profit_or_actual_buyouts(self):
  r=c.evaluate(TID,{'ordered_units':'4'},{'loss_rate':'0.1','delivery_mean':'100'})
  self.assertEqual(r['estimated_failed_units']['value'],'0.4');self.assertEqual(r['estimated_retained_units']['value'],'3.6');self.assertEqual(r['estimated_forward_last_delivery']['value'],'400');self.assertTrue(c.definition(TID)['not_profit']);self.assertTrue(all(v['estimated']for v in r.values()))
 def test_no_logistics_loss_factor_or_double_last_delivery(self):
  r=c.evaluate(TID,{'ordered_units':'16'},{'loss_rate':'0.125','delivery_mean':'101.614824'})
  self.assertEqual(r['estimated_retained_units']['value'],'14');self.assertEqual(r['estimated_forward_last_delivery']['value'],'1625.837184')
 def test_decimal_inputs_remain_exact(self):
  r=c.evaluate(TID,{'ordered_units':'3'},{'loss_rate':'0','delivery_mean':'0.1'});self.assertEqual(r['estimated_forward_last_delivery']['value'],'0.3')
 def test_zero_order_units_is_valid_not_zero_denominator(self):
  r=c.evaluate(TID,{'ordered_units':'0'},{'loss_rate':'0.1','delivery_mean':'100'});self.assertEqual({v['value']for v in r.values()},{'0'})
 def test_unknown_template_denied(self):
  with self.assertRaises(p.ParameterError):c.definition('unregistered')
 def test_no_extra_market_metric(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'4','profit':'9'},{'loss_rate':'0','delivery_mean':'1'})
 def test_missing_coefficient_not_zero(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'4'},{'loss_rate':'0'})
 def test_no_arbitrary_parameter(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'4'},{'loss_rate':'0','delivery_mean':'1','secret':'1'})
 def test_parameter_range_validated_again(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'4'},{'loss_rate':'1.1','delivery_mean':'1'})
 def test_binary_float_rejected(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':4.0},{'loss_rate':'0','delivery_mean':'1'})
 def test_fractional_physical_quantity_rejected(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'1.5'},{'loss_rate':'0','delivery_mean':'1'})
 def test_negative_order_units_rejected(self):
  with self.assertRaises(p.ParameterError):c.evaluate(TID,{'ordered_units':'-1'},{'loss_rate':'0','delivery_mean':'1'})
 def test_whole_store_only_never_fakes_sku(self):
  with self.assertRaises(p.ParameterError):c.normalized_input({'period':{'from':'2026-10-01','to':'2026-10-31'},'filters':{'sku':'123'}})
 def test_false_filter_type_rejected(self):
  with self.assertRaises(p.ParameterError):c.normalized_input({'period':{'from':'2026-10-01','to':'2026-10-31'},'filters':[]})
 def test_old_templates_unchanged_exactly(self):
  import template_catalog
  repo=next(parent for parent in Path(__file__).resolve().parents if(parent/'docs/alisa/runtime/v0.11/current_parameters_r8').is_dir())
  old=json.loads((repo/'docs/alisa/runtime/v0.11/current_parameters_r8/BASELINE_TEMPLATE_HASHES.json').read_text())
  self.assertEqual(len(old),88)
  for key,digest in old.items():self.assertEqual(hashlib.sha256(json.dumps(template_catalog.TEMPLATES[key],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest(),digest,key)
  self.assertEqual(set(template_catalog.TEMPLATES)-set(old),{TID})
 def test_default_disabled(self):self.assertFalse(native.enabled(SimpleNamespace()))
 def test_policy_is_exact_not_integer_true(self):self.assertFalse(native.enabled(SimpleNamespace(parameter_compound_policy={'enabled':1,'pin':native.PIN})))
 def test_no_generation_for_ordinary_answer(self):
  self.assertEqual(native.answer_generation(None,None,{},[]),([],None))
 def test_started_plugin_keeps_original_revision_fence(self):
  old=[('r8:old',{'pins':[1]})];progress={'_program_started':True,'_compound_answer_fences':deepcopy(old),'_compound_answer_generation':'old-generation'}
  self.assertEqual(native.answer_generation(None,None,progress,[('r8:new',{'pins':[2]})]),(old,'old-generation'))
 def test_unpinned_started_plugin_does_not_adopt_new_values(self):
  from semantics import Rejected
  with self.assertRaises(Rejected):native.answer_generation(None,None,{'_program_started':True},[('ref',{})])

 def test_legacy_list_result_is_not_a_compound_marker(self):
  from model_answer import PENDING
  self.assertEqual(native.markers({PENDING:{'data':[{'store_id':'legacy','values':{}}]}}),[])
 def test_legacy_none_result_is_not_a_compound_marker(self):
  from model_answer import PENDING
  self.assertEqual(native.markers({PENDING:{'data':None}}),[])
