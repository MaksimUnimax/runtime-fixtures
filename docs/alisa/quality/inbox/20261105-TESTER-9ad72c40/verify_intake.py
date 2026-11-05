"""Synthetic independent cost checks; no network or runtime imports."""
import pathlib,json
from decimal import Decimal as D,ROUND_HALF_UP
p=pathlib.Path(__file__).parent;g=json.loads((p/'SYNTHETIC_GOLD.json').read_text());i=g['inputs'];e=g['expected'];c=json.loads((p/'TEMPLATE_CANDIDATE.json').read_text())
n=lambda v:D(str(v).replace(',','.'))
ads=sum((n(x['moneySpent']) for x in i['daily_rows']),D(0))
control=sum((n(x['expense']) for x in i['cpo_control_rows']),D(0))
assert ads==n(e['ads']) and control==n(e['cpo_control']) and ads!=ads+control
assert i['legacy_expense_rows']==[] and i['selected_cpo']['rows']==[] and n(i['selected_cpo']['overExpenses'])==0
cost=n(i['cost_per_product'])*i['consumed_units'];expenses=n(i['marketplace_costs'])+ads+cost
f=lambda v:str(v.quantize(D('.01'),rounding=ROUND_HALF_UP))
assert cost==n(e['cogs']) and expenses==n(e['total_expenses'])
assert f(expenses/i['ordered_units'])==e['cost_per_ordered_unit']
result=n(i['recognized_revenue'])-expenses
assert result==n(e['result']) and f(result/i['ordered_units'])==e['result_per_ordered_unit']
assert f((n(i['marketplace_costs'])+ads)/i['ordered_units']+n(i['cost_per_product']))==e['product_cost_model']
assert c['answer_contract']['advertising_required'] is True and c['runtime_enabled'] is False
assert c['slots']['cost_per_unit']['missing_policy']=='OMIT_WITH_LABEL_COST_NOT_INCLUDED'
assert c['slots']['tax']['missing_policy']=='OMIT_WITH_LABEL_TAX_NOT_INCLUDED'
print(json.dumps({'status':'PASS','scope':'synthetic expense arithmetic and mandatory ads intake; not runtime','network_calls':0}))
