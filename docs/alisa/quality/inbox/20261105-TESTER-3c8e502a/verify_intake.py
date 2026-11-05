"""Independent cancellation policy arithmetic, synthetic only; no network/runtime."""
import json,pathlib
from decimal import Decimal as D,ROUND_HALF_UP
p=pathlib.Path(__file__).parent;g=json.loads((p/'SYNTHETIC_GOLD.json').read_text());i=g['inputs'];e=g['expected'];c=json.loads((p/'TEMPLATE_CANDIDATE.json').read_text())
n=lambda x:D(str(x));q=i['gross_ordered_units'];fees=sum((n(v) for v in i['non_cogs_costs'].values()),D(0))
def calc(cancel_units,cancel_value):
 assert 0<=cancel_units<=q
 revenue=n(i['gross_order_revenue'])-n(cancel_value)
 cogs=n(i['user_cost_per_product'])*(q-cancel_units)
 return revenue,cogs,revenue-cogs-fees
r,cost,result=calc(i['cancelled_units'],i['cancelled_order_value'])
f=lambda v:str(v.quantize(D('.01'),rounding=ROUND_HALF_UP))
assert fees==n(e['non_cogs_costs']) and r==n(e['net_revenue']) and cost==n(e['cogs']) and result==n(e['result'])
assert f(result/q)==e['result_per_original_unit'] and f((cost+fees)/q)==e['expense_per_original_unit']
assert f(cost/q)==e['cogs_per_original_unit']
for v in g['variants']:
 if 'cancelled_units' in v:
  _,cost2,result2=calc(v['cancelled_units'],v['cancelled_order_value'])
  assert cost2==n(v['expected_cogs']) and result2==n(v['expected_result'])
 else:assert v['expected_final_result'] is None
assert c['answer_contract']['advertising_required'] and not c['runtime_enabled'] and c['state']=='BLOCKED'
assert 'realized-unit count' in c['answer_contract']['cogs_policy']
print(json.dumps({'status':'PASS','scope':'synthetic cancellation/no-COGS-on-cancellations policy; not live economics','network_calls':0}))
