"""Build declarative source projections and binding policy; not an HTTP handler."""
from pathlib import Path
import json
R=Path(__file__).parent
UNSET=object()
def p(*parts,default=UNSET):
 x={'$path':list(parts)}
 if default is not UNSET:x['default']=default
 return x
def f(name,*args):return {'$fn':[name,*args]}
def dec(x):return f('decimal',x)
def ident(x):return f('integer_id',x)
def m(array,var,expression):return {'$map':[array,var,expression]}
def cond(test,yes,no):return {'$if':[test,yes,no]}
def rowitem(*parts):return p('row',*parts)
def expritem(*parts):return p('item',*parts)
tables={}
for scheme,clock in [('fbo','created_at'),('fbs','in_process_at')]:
 tables['orders_'+scheme]={'source':'orders_'+scheme,'items':p('response','postings'),'include':True,'project':m(rowitem('products'),'item',{
  'key':f('hash',[rowitem('posting_number'),p('item','sku')]),'posting':rowitem('posting_number'),'order':rowitem('order_number'),'sku':ident(p('item','sku')),'offer':p('item','offer_id'),
  'day':f('event_day',rowitem(clock),'Europe/Moscow'),'units':dec(p('item','quantity')),'unit_price':dec(p('item','price','amount')),'currency':p('item','price','currency'),
  'excluded':cond(f('eq',rowitem('status'),'cancelled'),dec(p('item','quantity')),'0'),'status':rowitem('status'),'scheme':scheme,
  'parent':p('row','parent_posting_number',default=''),'external':p('row','external_order','is_external',default=False)}),'identity':['key']}
tables['products']={'source':'products','items':p('response','result','items'),'include':True,'project':[{'sku':ident(rowitem('sku')),'offer':rowitem('offer_id'),'product':ident(rowitem('product_id'))}],'identity':['sku','offer']}
tariffrows=[]
for scheme in ['fbo','fbs']:
 tariffrows.append({'product':ident(rowitem('product_id')),'offer':rowitem('offer_id'),'scheme':scheme,'currency':rowitem('price','currency_code'),
 'commission_rate':dec(rowitem('commissions','sales_percent_'+scheme)),
 'transport_min':dec(rowitem('commissions',scheme+'_direct_flow_trans_min_amount')),'transport_max':dec(rowitem('commissions',scheme+'_direct_flow_trans_max_amount')),
 'last_mile':dec(rowitem('commissions',scheme+'_deliv_to_customer_amount')),
 'handling_min':dec(rowitem('commissions','fbs_first_mile_min_amount'))if scheme=='fbs'else'0',
 'handling_max':dec(rowitem('commissions','fbs_first_mile_max_amount'))if scheme=='fbs'else'0',
 'reverse':dec(rowitem('commissions',scheme+'_return_flow_amount')),'acquiring':dec(rowitem('acquiring'))})
tables['tariffs']={'source':'prices','items':p('response','items'),'include':True,'project':tariffrows,'identity':['product','offer','scheme']}
tables['fee_types']={'source':'fee_types','items':p('response','accrual_types'),'include':True,'project':[{'type_id':ident(rowitem('id')),'type_name':rowitem('name')}],'identity':['type_id']}
for role in ['accruals','accruals_asof']:
 prefix=role+'__'
 tables[prefix+'item_fees']={'source':role,'items':p('response','accruals'),'include':f('ne',rowitem('item_fees'),None),'project':f('flatten',m(rowitem('item_fees','fees'),'item',m(p('item','fees'),'fee',{
  'key':f('hash',[rowitem('accrual_id'),p('item','sku'),p('fee','type_id')]),'reference':rowitem('unit_number'),'reference_kind':'order','sku':ident(p('item','sku')),'quantity':dec(p('item','quantity')),
  'type_id':ident(p('fee','type_id')),'amount':f('negate',p('fee','accrued','amount')),'currency':p('fee','accrued','currency'),'date':f('day',rowitem('date'))}))), 'identity':['key']}
 tables[prefix+'commission']={'source':role,'items':p('response','accruals'),'include':f('ne',rowitem('posting'),None),'project':m(rowitem('posting','products'),'item',{
  'key':f('hash',[rowitem('accrual_id'),p('item','sku'),'commission']),'reference':rowitem('unit_number'),'reference_kind':'posting','sku':ident(p('item','sku')),'quantity':dec(p('item','quantity')),
  'type_name':'SaleCommission','amount':f('negate',p('item','commission','sale_commission','amount')),'currency':p('item','commission','sale_commission','currency'),'date':f('day',rowitem('date'))}), 'identity':['key']}
 tables[prefix+'services']={'source':role,'items':p('response','accruals'),'include':f('ne',rowitem('posting'),None),'project':f('flatten',m(rowitem('posting','products'),'item',m(p('item','delivery','services'),'fee',{
  'key':f('hash',[rowitem('accrual_id'),p('item','sku'),p('fee','type_id')]),'reference':rowitem('unit_number'),'reference_kind':'posting','sku':ident(p('item','sku')),'quantity':dec(p('item','quantity')),
  'type_id':ident(p('fee','type_id')),'amount':f('negate',p('fee','accrued','amount')),'currency':p('fee','accrued','currency'),'date':f('day',rowitem('date'))}))), 'identity':['key']}
tables['overhead']={'source':'finance','items':p('response','cashflows','services'),'include':True,'project':[{'name':rowitem('name'),'amount':f('negate',rowitem('amount','value')),'currency':rowitem('amount','currency_code')}],'identity':['name']}
tables['ads_daily']={'source':'advertising','items':p('response','rows'),'include':True,'project':[{'id':rowitem('id'),'date':f('day',rowitem('date')),'amount':f('decimal_comma',rowitem('moneySpent'))}],'identity':['id','date']}
profiles={
 'commission':{'actual_types':['SaleCommission'],'tariff_method':'explicit_percent','tariff_values':{'percent':'commission_rate'},'quantity':{'before':'original','after':'remaining'}},
 'direct_logistics':{'actual_types':['Logistic','Shipment'],'tariff_method':'interval_unit_amount','tariff_values':{'minimum':'transport_min','maximum':'transport_max'},'quantity':{'before':'original','after':'original'}},
 'last_mile':{'actual_types':['LastMile','LastMileCourier','LastMilePickUpPoint'],'tariff_method':'unit_amount','tariff_values':{'amount':'last_mile'},'quantity':{'before':'original','after':'original'}},
 'first_mile':{'actual_types':['Drop-Off','Drop-Off Agent','Pick-Up'],'tariff_method':'interval_unit_amount','tariff_values':{'minimum':'handling_min','maximum':'handling_max'},'quantity':{'before':'fbs_original','after':'fbs_original'}},
 'acquiring':{'actual_types':['Acquiring'],'tariff_method':'unit_amount','tariff_values':{'amount':'acquiring'},'quantity':{'before':'original','after':'original'}},
 'reverse_logistics':{'actual_types':['BackwardShipment','Cancellation','ClientReturn','ReturnFlowLogistic'],'tariff_method':'unit_amount','tariff_values':{'amount':'reverse'},'quantity':{'before':'none','after':'excluded'}}}
cat={'schema':'alice-normalized-source-policy/v1','version':'20261105-fresh-source-r1','max_rows':20000,'max_age_seconds':7200,'timezone':'Europe/Moscow','tables':tables,
 'cohort_tables':['orders_fbo','orders_fbs'],'product_table':'products','tariff_table':'tariffs','dictionary_table':'fee_types','actual_tables':[k for k in tables if k.startswith('accruals')],
 'allowed_order_statuses':['awaiting_approve','awaiting_packaging','awaiting_verification','awaiting_registration','awaiting_deliver','awaiting_dispatch','delivering','delivered','cancelled'],
 'profiles':profiles,
 'quantity_expressions':{'original':p('row','original_units'),'remaining':f('add_numbers',p('row','original_units'),f('negate',p('row','excluded_units'))),'excluded':p('row','excluded_units'),'none':'0','fbs_original':cond(f('eq',p('row','scheme'),'fbs'),p('row','original_units'),'0')},
 'scenarios':{'without_cancellations_counterfactual':'before','with_actual_cancellations':'after'},
 'overhead_components':{'advertising_cpo':'promotion_with_cost_per_order','advertising_cpc':'pay_per_click','storage':'product_placement_in_ozon_warehouses'},
 'excluded_store_period_variables':['drop_off_processing_by_partners','courier_client_reinvoice','acquiring','logistics'],
 'advertising_components':['advertising_cpo','advertising_cpc'],
 'actual_order_reference_field':'order','actual_posting_reference_field':'posting',
 'owner_profile':{'unit_cost':'250','tax':'EXCLUDED_BY_OWNER','own_costs':'NOT_PROVIDED','approval_ref':'tester-d391a4b1-r9:owner-explicit-example-only'},
 'labels':{'direct_logistics':'Прямая перевозка','last_mile':'Доставка до покупателя','first_mile':'Приёмка и первая миля FBS','advertising_cpo':'Реклама CPO','advertising_cpc':'Реклама CPC'}}
cat['currency']='RUB'
cat['scenario_source_expansions']={'delivery':['direct_logistics','last_mile','first_mile'],'advertising':['advertising_cpo','advertising_cpc']}
cat['additional_cohort_schema']={'scheme':{'kind':'id','minimum':None,'maximum':None}}
finance=p('sources','finance',0)
def fp(*parts):return p('sources','finance',0,*parts)
finance_sum=f('sum_values',[fp('cashflows','sales','amount','value'),fp('cashflows','sales','fee','value'),fp('cashflows','returns','amount','value'),fp('cashflows','returns','fee','value'),f('sum_values',m(fp('cashflows','services'),'service',p('service','amount','value')))])
accrual_sum=f('sum_values',f('flatten',m(p('sources','accruals'),'page',m(p('page','accruals'),'accrual',p('accrual','total_amount','amount')))))
cat['control_contracts']=[
 {'id':'finance_internal','left':finance_sum,'right':fp('total','accrued','value'),'error':'FINANCE_INTERNAL_RECONCILIATION'},
 {'id':'accrual_finance','left':accrual_sum,'right':fp('total','accrued','value'),'error':'ACCRUAL_FINANCE_RECONCILIATION'}]
cat['financial_result']=fp('total','accrued','value')
cat['control_currency_checks']=[f('all',m(fp('cashflows','services'),'service',f('eq',p('service','amount','currency_code'),'RUB'))),f('eq',fp('total','accrued','currency_code'),'RUB'),f('all',f('flatten',m(p('sources','accruals'),'page',m(p('page','accruals'),'accrual',f('eq',p('accrual','total_amount','currency'),'RUB')))))]
for section in ('sales','returns'):
 for field in ('amount','fee'):cat['control_currency_checks'].append(f('eq',fp('cashflows',section,field,'currency_code'),'RUB'))
(R/'normalization_catalog.json').write_text(json.dumps(cat,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tables':len(tables),'cost_components':len(profiles),'marketplace_calls':0}))
