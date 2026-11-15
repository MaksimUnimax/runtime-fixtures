"""Read-only arithmetic replay of explicitly pinned reference report amounts.

This is evidence, not a product collector or a new profit template. No API, model,
DB, customer data, inferred SKU tariffs, or production coefficient defaults.
"""
from decimal import Decimal,localcontext
from pathlib import Path
import json

SOURCE='6b7d8fe8a8e164e0c2b52e4b6deb212a78eb4c08'
# Amounts transcribed from the reopened original UNIT_ECONOMICS.json. Corrected
# display expectations come from the report designated by CURRENT_STATISTICS.
CASES={
 'turnover':('7492.675686122922303826826440','8592','1498.535137','1718.400000'),
 'commission':('3746.337843061461151913413220','4296.00','749.267569','859.200000'),
 'acquiring':('87.0','87.0','17.400000','17.400000'),
 'forward_last':('508.0741242140382394456563583','508.0741242140382394456563583','101.614825','101.614825'),
 'reverse':('86.74835717046772323154232700','0','17.349671','0.000000'),
 'processing':('5','5','1.000000','1.000000'),
 'other':('0','0','0.000000','0.000000'),
 'advertising':('1032.50','1032.50','206.500000','206.500000'),
 'storage':('132.95','132.95','26.590000','26.590000'),
 'cogs':('1090.065713181291070738306919','1250','218.013143','250.000000'),
 'remainder_after_cogs_and_ads':('5370.109972941631233088519521','6309.50','1074.021995','1261.900000'),
 'all_included_costs':('6688.676037627258185328918824','7311.524124214038239445656358','1337.735208','1462.304825'),
 'remainder_before_tax':('803.999648495664118497907616','1280.475875785961760554343642','160.799930','256.095175')}
COSTS=['commission','acquiring','forward_last','reverse','processing','other','advertising','storage','cogs']

def replay():
 with localcontext()as context:
  context.prec=60
  n=Decimal(5);loss=Decimal(993)/Decimal(7761);rows={}
  for name,(with_loss,without_loss,display_with,display_without) in CASES.items():
   result=[]
   for amount,display in [(with_loss,display_with),(without_loss,display_without)]:
    actual=Decimal(amount)/n
    assert actual.quantize(Decimal('.000001'))==Decimal(display),(name,actual,display)
    assert(actual*n).quantize(Decimal('.01'))==Decimal(amount).quantize(Decimal('.01'))
    result.append(str(actual))
   rows[name]=result
  # The source totals were produced with Decimal precision28; tolerate only
  # sub-kopeck serialization residue, not economic amount differences.
  for index in (0,1):
   cost=sum(Decimal(CASES[k][index])for k in COSTS)
   assert abs(cost-Decimal(CASES['all_included_costs'][index]))<Decimal('1e-20')
   assert abs(Decimal(CASES['turnover'][index])-cost-Decimal(CASES['remainder_before_tax'][index]))<Decimal('1e-20')
  for name in ('turnover','commission','cogs'):
   assert abs(Decimal(CASES[name][0])-Decimal(CASES[name][1])*(1-loss))<Decimal('1e-20')
  for name in ('acquiring','forward_last','processing','advertising','storage','other'):
   assert Decimal(CASES[name][0])==Decimal(CASES[name][1])
  assert abs(Decimal(CASES['forward_last'][0])-n*Decimal('791884.33')/Decimal(7793))<Decimal('1e-20')
  old_unit=Decimal(CASES['remainder_before_tax'][0])/(n*(1-loss))
  assert old_unit.quantize(Decimal('.000001'))==Decimal('184.392473')
  assert rows['remainder_before_tax'][0].startswith('160.799929')
  return {'status':'PASS_PINNED_FINANCIAL_REFERENCE_ARITHMETIC','source_commit':SOURCE,
    'reference_day':'2026-11-13','original_units':'5','rows_checked':len(CASES),'paired_unit_cells_checked':2*len(CASES),
    'primary_denominator_both_scenarios':'original_N','per_original_unit_before_tax_with_loss':'160.799930',
    'old_per_retained_unit_not_primary':'184.392473','financial_cost_groups_checked':len(COSTS),
    'tax_assumed_zero':False,'net_profit_claimed':False,'api_or_database_calls':0,
    'this_does_not_qualify_live_source_completeness':True}

if __name__=='__main__':print(json.dumps(replay(),ensure_ascii=False,indent=2))
