"""Independent synthetic intake gold checks; no network and no runtime imports."""
import json,pathlib
from decimal import Decimal as D, ROUND_HALF_UP
p=pathlib.Path(__file__).parent
g=json.loads((p/'SYNTHETIC_GOLD.json').read_text());i=g['inputs'];e=g['expected'];c=json.loads((p/'TEMPLATE_CANDIDATE.json').read_text())
money=lambda x:D(x)
q=i['ordered_units']
assert q==i['cancelled_units']+i['kept_units']+i['returned_and_restocked_units']
assert q!=i['order_count']
revenue=money(i['gross_seller_revenue'])+money(i['refund_signed'])
expenses=sum((money(v) for v in i['expenses'].values()),D(0))
consumed=i['realized_units']-i['returned_and_restocked_units']
cost=money(i['cost_per_unit'])*consumed
result=revenue-expenses-cost
rounded=lambda x:str(x.quantize(D('.01'),rounding=ROUND_HALF_UP))
assert revenue==money(e['net_revenue'])
assert expenses==money(e['all_expenses'])
assert cost==money(e['cogs'])
assert result==money(e['result'])
assert rounded(result/q)==e['per_ordered_unit']
assert q!=q+i['cancelled_units']+i['returned_and_restocked_units']
variants={v['id']:v for v in g['variants']}
for case in ['COST_MISSING','COST_EXPLICIT_ZERO']:
 v=variants[case];r=revenue-expenses
 assert r==money(v['expected_result']) and rounded(r/q)==v['expected_per_unit']
assert variants['COST_MISSING']['expected_cost_inclusion']!=variants['COST_EXPLICIT_ZERO']['expected_cost_inclusion']
assert result-money(variants['USER_FIXED_TAX']['tax_amount'])==money(variants['USER_FIXED_TAX']['expected_result'])
v=variants['ADS_DUPLICATE_IN_FINANCE'];assert v['qualified_same_charge'] and money(v['finance_ads'])==money(v['performance_ads'])==money(v['expected_ads_cost']);assert result==money(v['expected_result'])
for case,key in [('OPEN_COHORT','expected_final_result'),('NO_QUANTITY','expected_per_unit'),('MISSING_EXPENSE_COVERAGE','expected_final_result'),('UNKNOWN_RESTOCK','expected_cogs_recovery')]:assert variants[case][key] is None
assert c['slots']['cost_per_unit']['missing_policy']=='OMIT_WITH_LABEL_COST_NOT_INCLUDED'
assert c['slots']['tax']['missing_policy']=='OMIT_WITH_LABEL_TAX_NOT_INCLUDED'
assert c['slots']['denominator']['values']==['ordered_units_gross']
assert c['runtime_enabled'] is False and c['state']=='NEW'
print(json.dumps({'status':'PASS','scope':'manual synthetic gold arithmetic, variants and intake policy; no runtime execution','fixture_variants':len(variants),'network_calls':0}))

