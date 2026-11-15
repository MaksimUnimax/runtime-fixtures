"""Arithmetic replay of explicitly reopened, pinned historical selected components.

This does NOT assert normalized fee-event or live ledger qualification. The old
CSV itself labels the Nov13 fees PREVIOUS_MATCHED_DEBIT_OR_SAVED_API_TARIFF.
That ambiguity is preserved, not silently promoted to an actual debit.
"""
from decimal import Decimal,localcontext
from unittest import TestCase
import json
from alisa_platform.owner_data import economics_cohort as e
from .fixtures import unknown
SOURCE='6b7d8fe8a8e164e0c2b52e4b6deb212a78eb4c08'
CSV='стратегии рекламы/аудит статистики/2026-11-14_unit_111213_r15/ORDER_ITEMS.csv'
# Explicit fields read from rows34–38 of that exact CSV; order IDs pseudonymized.
ITEMS=[('1720151850','1670','fbo','835','17.4','0','99','145.379133'),
 ('2271285786','1740','fbo','870','17.4','0','99','175.900973'),
 ('1842444165','1740','fbo','870','17.4','0','99','175.900973'),
 ('1602722942','1740','fbo','870','17.4','0','99','175.900973'),
 ('2186852750','1702','fbs','851','17.4','5','282','130.917595')]
EXPECTED={
 'revenue':('1498.535137','1718.400000'),'commission':('749.267569','859.200000'),
 'acquiring':('17.400000','17.400000'),'forward_last':('101.614825','101.614825'),
 'reverse':('17.349671','0.000000'),'processing':('1.000000','1.000000'),
 'other':('0.000000','0.000000'),'advertising':('206.500000','206.500000'),
 'storage':('26.590000','26.590000'),'cogs':('218.013143','250.000000'),
 'all_selected_costs':('1337.735208','1462.304825'),
 'remainder_before_owner_inputs':('160.799930','256.095175'),
 'remainder_after_cogs_and_ads':('1074.021995','1261.900000')}

def reference():
 rows=[]
 for index,(sku,price,scheme,commission,acquiring,processing,return_base,expected)in enumerate(ITEMS):
  inputs={'quantity':'1','seller_price':price,'turnover':price,'commission_original':commission,
          'acquiring':acquiring,'processing':processing,'other':'0','return_tariff_base':return_base}
  rows.append({'order':{'posting':'historical-'+str(index),'sku':sku,'scheme':scheme,'quantity':'1','seller_price':price,'day':'2026-11-13'},
               'inputs':inputs,'basis':{'commission_original':{'kind':'ARCHIVED_PREVIOUS_DEBIT_OR_TARIFF_UNRESOLVED'},'acquiring':{'kind':'ARCHIVED_PREVIOUS_DEBIT_OR_TARIFF_UNRESOLVED'}}})
 evidence={'receipts':{'pinned_reference_commit':SOURCE},'period_costs':{'advertising':'1032.50','storage':'132.95'}}
 return e.QualifiedCohort(e.c.CANON({'tenant_id':'reference','store_id':'reference','provider':'OZON','currency':'RUB'}),e.c.CANON({'from':'2026-11-13','to':'2026-11-13'}),e.c.CANON(rows),e.c.CANON(evidence),e.HASH)

def replay():
 with localcontext()as context:
  context.prec=50
  q=reference();costs={e.c.CANON(e.key(r['order'])):'250'for r in q.rows}
  parameters={k:{'loss_rate':e.c.decimal_text(Decimal(993)/Decimal(7761)),'delivery_mean':e.c.decimal_text(Decimal('791884.33')/Decimal(7793))}for k in costs}
  result=e.calculate(q,costs,parameters,unknown())
  for name,pair in EXPECTED.items():
   for scenario,expected in zip(('with_loss','without_loss'),pair):
    assert Decimal(result['scenarios'][scenario]['per_original_unit'][name]).quantize(Decimal('.000001'))==Decimal(expected),(name,scenario)
  assert result['scenarios']['with_loss']['totals']['original_units']=='5'
  assert result['scenarios']['with_loss']['after_declared_owner_inputs']is None
  for row,source in zip(q.rows,ITEMS):
   piece=e.QualifiedCohort(q.scope_json,q.period_json,e.c.CANON([row]),e.c.CANON({'receipts':{},'period_costs':{'advertising':'206.50','storage':'26.59'}}),q.definition_hash)
   k=e.c.CANON(e.key(row['order']));v=e.calculate(piece,{k:'250'},{k:parameters[k]},unknown())
   assert Decimal(v['scenarios']['with_loss']['totals']['remainder_before_owner_inputs']).quantize(Decimal('.000001'))==Decimal(source[-1])
  return {'status':'PASS_ARCHIVED_COMPONENT_ARITHMETIC','source_commit':SOURCE,'source_csv':CSV,
          'product_rows':5,'expense_groups':9,'money_rows':13,'paired_money_cells':26,
          'primary_denominator':'original_N','profit_per_original_unit_before_tax':'160.799930',
          'raw_provider_source_qualification':False,'new_api_calls':0,'old_ambiguous_fee_origin_promoted_to_actual':False,
          'live_values_imported':False,'net_profit_claimed':False}

class Reference(TestCase):
 def test_pinned_five_rows_and_26_money_cells(self):self.assertEqual(replay()['paired_money_cells'],26)

if __name__=='__main__':print(json.dumps(replay(),ensure_ascii=False,indent=2))
