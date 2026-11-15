from copy import deepcopy
from decimal import Decimal
from unittest import TestCase
from unittest.mock import patch
import json
from alisa_platform.owner_data import economics_cohort as e
from .fixtures import *

class Sources(TestCase):
 def rejected(self,data,code=None):
  with self.assertRaises((e.EconomicsError,e.c.ParameterError))as ctx:qualify(data)
  if code:self.assertEqual(ctx.exception.code,code)
 def test_tariff_commission_uses_original_price_and_quantity(self):
  row=qualify().rows[0];self.assertEqual(row['inputs']['turnover'],'2000');self.assertEqual(row['inputs']['commission_original'],'200');self.assertEqual(row['inputs']['acquiring'],'34.8')
 def test_complete_original_debit_replaces_tariff(self):
  row=qualify(bundle(fees=[event()])).rows[0];self.assertEqual(row['inputs']['commission_original'],'150');self.assertEqual(row['basis']['commission_original']['kind'],'QUALIFIED_ORIGINAL_DEBIT')
 def test_zero_original_debit_replaces_positive_tariff(self):
  row=qualify(bundle(fees=[event(amount='0')])).rows[0];self.assertEqual(row['inputs']['commission_original'],'0')
 def test_original_correction_keeps_signed_credit(self):
  data=bundle(fees=[event(),event('c',amount='10',nature='CORRECTION',parent='fee1')]);self.assertEqual(qualify(data).rows[0]['inputs']['commission_original'],'140')
 def test_sale_reversal_does_not_reduce_original_then_apply_loss_again(self):
  data=bundle(fees=[event(),event('r',amount='150',nature='SALE_REVERSAL',parent='fee1')]);self.assertEqual(qualify(data).rows[0]['inputs']['commission_original'],'150')
 def test_correction_scope_cannot_change_sku(self):
  self.rejected(bundle(fees=[event(),event('c',sku='999',amount='10',nature='CORRECTION',parent='fee1')]),'ECONOMICS_CORRECTION_SCOPE')
 def test_orphan_correction_not_made_original_debit(self):
  self.rejected(bundle(fees=[event('c',amount='10',nature='CORRECTION',parent='absent')]),'ECONOMICS_ORPHAN_CORRECTION')
 def test_duplicate_same_event_counted_once(self):
  q=qualify(bundle(fees=[event(),event()]));self.assertEqual(q.rows[0]['inputs']['commission_original'],'150');self.assertEqual(json.loads(q.evidence_json)['duplicates_removed'],1)
 def test_changed_same_event_id_not_silently_latest(self):self.rejected(bundle(fees=[event(),event(amount='-160')]),'ECONOMICS_CONFLICTING_EVENT_VERSION')
 def test_two_overlapping_original_debits_not_summed(self):self.rejected(bundle(fees=[event(),event('other')]),'ECONOMICS_OVERLAPPING_ORIGINAL_FEE')
 def test_partial_billed_units_not_replace_full_cohort_or_double_tariff(self):self.rejected(bundle(fees=[event(quantity='1')]),'ECONOMICS_PARTIAL_FEE_COVERAGE')
 def test_missing_event_id_not_invented_from_amount(self):self.rejected(bundle(fees=[event(eid='')]),'ECONOMICS_ID')
 def test_ambiguous_positive_original_commission_not_abs_value(self):self.rejected(bundle(fees=[event(amount='150')]),'ECONOMICS_ORIGINAL_DEBIT_SIGN')
 def test_correction_above_original_debit_not_negative_commission(self):self.rejected(bundle(fees=[event(),event('c',amount='151',nature='CORRECTION',parent='fee1')]),'ECONOMICS_ORIGINAL_DEBIT_SIGN')
 def test_posting_fee_93_allocates_by_physical_units_and_conserves(self):
  rows=[order(sku='101',quantity='1',price='9999'),order(sku='102',quantity='2',price='1')]
  q=qualify(bundle(rows=rows,quotes=[tariff('101'),tariff('102')],fees=[event(sku=None,quantity=None,typ=93,amount='-10')]))
  vals=[Decimal(r['inputs']['other'])for r in q.rows]
  with __import__('decimal').localcontext()as ctx:ctx.prec=60;self.assertEqual(sum(vals),Decimal(10));self.assertEqual(vals[1],Decimal(10)-vals[0])
 def test_posting_commission_cannot_be_allocated_as_sku_actual(self):
  self.rejected(bundle(fees=[event(sku=None,quantity=None)]),'ECONOMICS_ITEM_ATTRIBUTION_REQUIRED')
 def test_posting_acquiring_without_approved_allocation_is_rejected(self):
  self.rejected(bundle(fees=[event(sku=None,quantity=None,typ=1)]),'ECONOMICS_ITEM_ATTRIBUTION_REQUIRED')
 def test_posting_other_allocation_is_not_item_level_actual(self):
  q=qualify(bundle(fees=[event(sku=None,quantity=None,typ=93)]))
  self.assertEqual(q.rows[0]['basis']['other']['kind'],'QUALIFIED_POSTING_ALLOCATION')
  self.assertEqual(q.rows[0]['basis']['other']['allocation'],'ORIGINAL_PHYSICAL_UNITS')
 def test_posting_fee_and_same_sku_fee_overlap_rejected(self):
  self.rejected(bundle(fees=[event(sku=None,quantity=None,typ=93),event('other',typ=93)]),'ECONOMICS_OVERLAPPING_ORIGINAL_FEE')
 def test_other_signed_credit_not_abs_value(self):
  q=qualify(bundle(fees=[event(typ=93,amount='15')]));self.assertEqual(q.rows[0]['inputs']['other'],'-15')
 def test_forward_last_reverse_actuals_not_added_on_top_of_normative(self):
  q=qualify(bundle(fees=[event(typ=32,amount='-999'),event('last',typ=29,amount='-100'),event('back',typ=6,amount='-55')]));self.assertEqual(q.rows[0]['inputs']['other'],'0');self.assertEqual(json.loads(q.evidence_json)['ignored']['excluded_delivery'],3)
 def test_unknown_matched_fee_type_not_hidden_in_other_zero(self):self.rejected(bundle(fees=[event(typ=999)]),'ECONOMICS_UNCLASSIFIED_FEE')
 def test_same_posting_wrong_scheme_not_treated_foreign(self):self.rejected(bundle(fees=[event(scheme='fbs')]),'ECONOMICS_FEE_SCHEME_CONFLICT')
 def test_outside_cohort_debit_not_mixed(self):
  q=qualify(bundle(fees=[event(posting='old-posting')]));self.assertEqual(q.rows[0]['inputs']['commission_original'],'200');self.assertEqual(json.loads(q.evidence_json)['ignored']['outside_cohort'],1)
 def test_late_accrual_for_same_original_order_included(self):
  fee=event();fee['accrual_day']='2026-11-14';q=qualify(bundle(fees=[fee]));self.assertEqual(q.rows[0]['inputs']['commission_original'],'150')
 def test_order_outside_original_period_not_financial_day_alias(self):
  row=order();row['day']='2026-11-12';self.rejected(bundle(rows=[row]),'ECONOMICS_WRONG_COHORT_DAY')
 def test_duplicate_order_rows_not_double_quantity(self):self.rejected(bundle(rows=[order(),order()]),'ECONOMICS_DUPLICATE_ORDER_LINE')
 def test_quantity_is_physical_integer_not_float(self):self.rejected(bundle(rows=[order(quantity='1.5')]),'ECONOMICS_QUANTITY')
 def test_zero_quantity_row_rejected_not_missing_order(self):self.rejected(bundle(rows=[order(quantity='0')]),'ECONOMICS_ORDER_VALUE')
 def test_fbs_uses_scheme_specific_processing_midpoint(self):
  q=qualify(bundle(rows=[order(scheme='fbs')],quotes=[tariff(scheme='fbs')]));self.assertEqual(q.rows[0]['inputs']['processing'],'10')
 def test_fbo_has_explicit_not_applicable_processing(self):
  q=qualify();self.assertEqual(q.rows[0]['inputs']['processing'],'0');self.assertEqual(q.rows[0]['basis']['processing']['kind'],'FBS_PROCESSING_NOT_APPLICABLE')
 def test_no_matching_tariff_not_zero(self):self.rejected(bundle(quotes=[]))
 def test_wrong_scheme_tariff_not_borrowed(self):self.rejected(bundle(quotes=[tariff(scheme='fbs')]))
 def test_duplicate_tariff_not_latest_without_proof(self):self.rejected(bundle(quotes=[tariff(),tariff()]),'ECONOMICS_AMBIGUOUS_TARIFF')
 def test_unknown_tariff_field_not_submitted_formula(self):
  t=tariff();t['fields']['python']='1';self.rejected(bundle(quotes=[t]),'ECONOMICS_TARIFF_FIELDS')
 def test_tariff_float_rejected(self):
  t=tariff();t['fields']['acquiring_per_unit']=1.25;self.rejected(bundle(quotes=[t]))
 def test_tariff_percentage_out_of_range(self):
  t=tariff();t['fields']['commission_percent']='101';self.rejected(bundle(quotes=[t]),'ECONOMICS_TARIFF_RANGE')
 def test_currency_not_converted_or_ignored(self):
  f=event();f['currency']='USD';self.rejected(bundle(fees=[f]),'ECONOMICS_SOURCE_CURRENCY')
 def test_unknown_marketplace_not_reused_ozon(self):
  target={**TARGET,'provider':'WB'}
  with self.assertRaises(e.EconomicsError):qualify(bundle(target=target),target)
 def test_source_scope_tamper_denied(self):
  data=bundle();data['fees']['scope']['store_id']='other';self.rejected(data,'ECONOMICS_SOURCE_SCOPE')
 def test_source_period_tamper_denied(self):
  data=bundle();data['fees']['period']['from']='2026-11-01';self.rejected(data,'ECONOMICS_SOURCE_SCOPE')
 def test_flag_complete_is_not_authority(self):
  with self.assertRaises(e.EconomicsError)as ex:e.qualify(bundle(),TARGET,PERIOD,verify=lambda *x:False)
  self.assertEqual(ex.exception.code,'ECONOMICS_SOURCE_NOT_QUALIFIED')
 def test_missing_verifier_denied(self):
  with self.assertRaises(e.EconomicsError):e.qualify(bundle(),TARGET,PERIOD,verify=None)
 def test_payload_changed_after_attestation_denied(self):
  data=bundle();verify=attested(data);data['tariffs']['rows'][0]['fields']['commission_percent']='99'
  with self.assertRaises(e.EconomicsError):e.qualify(data,TARGET,PERIOD,verify=verify)
 def test_nonterminal_source_never_falls_back_to_tariff(self):
  data=bundle();data['fees']['complete']=False;self.rejected(data,'ECONOMICS_SOURCE_INCOMPLETE')
 def test_period_cost_absence_never_zero(self):
  data=bundle();data['period_costs']['rows'].pop();self.rejected(data,'ECONOMICS_MISSING_PERIOD_COST')
 def test_intraday_not_silently_full_day_allocation(self):
  data=bundle();data['period_costs']['rows'][0]['basis']='INTRADAY';self.rejected(data,'ECONOMICS_PERIOD_ALLOCATION_UNQUALIFIED')
 def test_qualified_instance_not_json_serializable(self):
  with self.assertRaises(TypeError):json.dumps(qualify())
 def test_checkpoint_excludes_costs_and_quotes(self):
  s=json.dumps(qualify(bundle(fees=[event(amount='-123.4567')])).checkpoint());self.assertNotIn('123.4567',s);self.assertNotIn('fee1',s);self.assertNotIn('quote-',s)
 def test_original_source_objects_not_mutated(self):
  data=bundle(fees=[event()]);before=deepcopy(data);qualify(data);self.assertEqual(data,before)

 def test_processing_min_greater_than_max_is_rejected(self):
  quote=tariff();quote['fields'].update(processing_min='9',processing_max='3')
  self.rejected(bundle(quotes=[quote]),'ECONOMICS_TARIFF_INTERVAL')
 def test_invalid_fee_scheme_has_typed_error(self):
  f=event();f['scheme']=['fbo'];self.rejected(bundle(fees=[f]),'ECONOMICS_SCHEME')
 def test_verifier_cannot_change_source_in_place_after_capture(self):
  data=bundle();seen=[]
  def verify(name,snapshot,target,period):
   if name=='orders':data['tariffs']['rows'][0]['fields']['commission_percent']='99'
   seen.append(name);return True
  q=e.qualify(data,TARGET,PERIOD,verify=verify)
  self.assertEqual(q.rows[0]['inputs']['commission_original'],'200')

 def test_correction_cannot_cross_cohort_boundary_via_parent_id(self):
  self.rejected(bundle(fees=[event(),event('c',posting='old-posting',amount='10',nature='CORRECTION',parent='fee1')]),'ECONOMICS_CORRECTION_SCOPE')
 def test_sale_reversal_cannot_hide_wrong_parent_scope_outside_cohort(self):
  self.rejected(bundle(fees=[event(),event('r',posting='old-posting',amount='150',nature='SALE_REVERSAL',parent='fee1')]),'ECONOMICS_CORRECTION_SCOPE')
 def test_valid_foreign_original_and_correction_are_both_excluded(self):
  q=qualify(bundle(fees=[event(posting='old-posting'),event('c',posting='old-posting',amount='10',nature='CORRECTION',parent='fee1')]))
  self.assertEqual(q.rows[0]['inputs']['commission_original'],'200')

class Formula(TestCase):
 def test_coefficient_only_on_revenue_commission_cogs(self):
  r=calculated();a=r['scenarios']['with_loss']['totals'];b=r['scenarios']['without_loss']['totals']
  for n in ['revenue','commission','cogs']:self.assertEqual(Decimal(a[n]),Decimal(b[n])*Decimal('0.8'))
  for n in ['acquiring','forward_last','processing','other','storage','advertising']:self.assertEqual(a[n],b[n])
 def test_forward_last_once_without_loss_multiplier(self):
  r=calculated();self.assertEqual(r['scenarios']['with_loss']['totals']['forward_last'],'200')
 def test_reverse_reserve_uses_full_quantity_tariff_and_loss(self):
  r=calculated();self.assertEqual(r['scenarios']['with_loss']['totals']['reverse'],'39.6');self.assertEqual(r['scenarios']['without_loss']['totals']['reverse'],'0')
 def test_both_primary_money_columns_use_original_N(self):
  r=calculated()
  for row in r['scenarios'].values():
   for n,value in row['per_original_unit'].items():self.assertEqual(Decimal(value)*Decimal(row['totals']['original_units']),Decimal(row['totals'][n]))
 def test_zero_orders_keeps_advertising_and_storage(self):
  r=calculated(bundle(rows=[],quotes=[]));row=r['scenarios']['with_loss'];self.assertEqual(row['totals']['remainder_before_owner_inputs'],'-130');self.assertTrue(all(v is None for v in row['per_original_unit'].values()))
 def test_loss_one_preserves_original_unit_costs_not_divide_by_Q(self):
  r=calculated(loss='1');row=r['scenarios']['with_loss'];self.assertEqual(row['totals']['expected_retained_units'],'0');self.assertIsNotNone(row['per_original_unit']['acquiring'])
 def test_zero_loss_two_scenarios_equal(self):
  r=calculated(loss='0');self.assertEqual(r['scenarios']['with_loss'],r['scenarios']['without_loss'])
 def test_unknown_tax_never_net_profit_or_numeric_zero(self):
  r=calculated();row=r['scenarios']['with_loss'];self.assertIsNone(row['after_declared_owner_inputs']);self.assertFalse(row['owner_inputs_complete']);self.assertTrue(row['not_actual_profit'])
 def test_explicit_zero_tax_distinct_from_missing(self):
  owner={k:{'state':'VALUE','value':'0'}for k in unknown()};row=calculated(owner=owner)['scenarios']['with_loss'];self.assertTrue(row['owner_inputs_complete']);self.assertEqual(row['after_declared_owner_inputs'],row['totals']['remainder_before_owner_inputs'])
 def test_tax_and_custom_costs_deducted_once_not_by_loss(self):
  owner={'tax_amount':{'state':'VALUE','value':'100'},'own_cost_amount':{'state':'VALUE','value':'50'}}
  for row in calculated(owner=owner)['scenarios'].values():self.assertEqual(Decimal(row['totals']['remainder_before_owner_inputs'])-Decimal(row['after_declared_owner_inputs']),Decimal('150'))
 def test_excluded_tax_not_called_zero(self):
  owner=unknown();owner['tax_amount']['state']='EXCLUDED_BY_OWNER';self.assertIsNone(calculated(owner=owner)['scenarios']['with_loss']['after_declared_owner_inputs'])
 def test_missing_cogs_not_hardcoded_250(self):
  q=qualify();cost,p=numbers(q)
  with self.assertRaises(e.EconomicsError):e.calculate(q,{},p,unknown())
 def test_zero_cogs_valid(self):self.assertEqual(calculated(cost='0')['scenarios']['with_loss']['totals']['cogs'],'0')
 def test_different_sku_coefficients_are_weighted_by_actual_rows(self):
  data=bundle(rows=[order(quantity='1'),order('p2','102',quantity='1',price='2000')],quotes=[tariff(),tariff('102')]);q=qualify(data);cost,p=numbers(q)
  for k,v in p.items():v['loss_rate']='0'if json.loads(k)[1]=='101'else'0.5'
  r=e.calculate(q,cost,p,unknown());self.assertEqual(r['scenarios']['with_loss']['totals']['revenue'],'2000')
 def test_unregistered_expression_never_executes(self):
  with self.assertRaises(e.EconomicsError):e.expression({'python':'import os'}, {})
 def test_bare_dict_cannot_be_qualified_input(self):
  with self.assertRaises(e.EconomicsError):e.calculate({'rows':[]},{},{},unknown())
 def test_all_selected_expenses_reconcile(self):
  r=calculated()
  for row in r['scenarios'].values():
   t=row['totals'];s=sum(Decimal(t[k])for k in ['commission','acquiring','forward_last','reverse','processing','other','cogs','storage','advertising']);self.assertEqual(s,Decimal(t['all_selected_costs']));self.assertEqual(Decimal(t['revenue'])-s,Decimal(t['remainder_before_owner_inputs']))

 def test_drr_uses_original_turnover_in_both_scenarios(self):
  r=calculated(loss='0.5');self.assertEqual(r['scenarios']['with_loss']['totals']['drr_percent'],'5');self.assertEqual(r['scenarios']['without_loss']['totals']['drr_percent'],'5')
 def test_zero_revenue_drr_is_undefined_not_free_advertising(self):
  r=calculated(bundle(rows=[order(price='0')]));self.assertIsNone(r['scenarios']['with_loss']['totals']['drr_percent']);self.assertEqual(r['scenarios']['with_loss']['totals']['advertising'],'100')
